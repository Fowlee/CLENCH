/* Supabase over plain fetch.
 *
 * No SDK on purpose: Supabase's REST and Storage APIs are ordinary HTTPS, and
 * the site has no build step to install a dependency into. Same approach as the
 * Brevo call in booking.js.
 *
 * This module lives in lib/ rather than beside the functions because Netlify
 * turns every top-level file in netlify/functions into an endpoint, and a
 * directory without an index.js of its own is left alone.
 *
 * Netlify environment variables (Site configuration -> Environment variables):
 *   SUPABASE_URL          https://<project>.supabase.co
 *   SUPABASE_SERVICE_KEY  Project settings -> API -> service_role
 *
 * The service role key bypasses row level security, which is exactly why it may
 * only ever be read here, server side. It must never reach the browser.
 */

const BUCKET = 'designs';

function credentials() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must both be set');
  }

  // A trailing slash in the dashboard-copied URL would double up the path
  return { url: url.replace(/\/+$/, ''), key };
}

function headers(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key
  }, extra || {});
}

/* Raises an error describing what went wrong without carrying customer data
 * into it. PostgREST puts the offending values in `details` and `hint` — a
 * unique-violation body quotes the row — and these errors are logged, so the
 * whole body would end up in Netlify's log with names and emails in it. Only
 * the code and the generic message come through. */
async function failure(response, what) {
  const body = await response.text();

  let summary = '';
  try {
    const parsed = JSON.parse(body);
    summary = [parsed.code, parsed.message].filter(Boolean).join(' ');
  } catch (err) {
    // Not JSON — say nothing rather than risk quoting a row
    summary = '';
  }

  throw new Error(
    what + ' failed (' + response.status + (summary ? ': ' + summary : '') + ')'
  );
}

/* ----- database -----
 *
 * PostgREST: the table name is the path and filters are query parameters.
 *   select('orders?ref=eq.CL-8F3A&select=*')
 *   insert('orders', { name: 'A' })
 */

async function select(query) {
  const { url, key } = credentials();

  const response = await fetch(url + '/rest/v1/' + query, {
    headers: headers(key)
  });

  if (!response.ok) await failure(response, 'Select');
  return response.json();
}

async function insert(table, row) {
  const { url, key } = credentials();

  const response = await fetch(url + '/rest/v1/' + table, {
    method: 'POST',
    headers: headers(key, {
      'Content-Type': 'application/json',
      // Without this PostgREST returns an empty body, and callers need the id
      Prefer: 'return=representation'
    }),
    body: JSON.stringify(row)
  });

  if (!response.ok) await failure(response, 'Insert into ' + table);

  const rows = await response.json();
  return rows[0];
}

async function update(table, query, patch) {
  const { url, key } = credentials();

  const response = await fetch(url + '/rest/v1/' + table + '?' + query, {
    method: 'PATCH',
    headers: headers(key, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    }),
    body: JSON.stringify(patch)
  });

  if (!response.ok) await failure(response, 'Update ' + table);

  const rows = await response.json();
  return rows[0];
}

/* ----- storage ----- */

// The first four bytes of every PNG file.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/* Takes a data URL from canvas.toDataURL() and stores the bytes as a PNG.
 *
 * Both the type and the content are checked here rather than trusted. The data
 * URL arrives from the browser, and an earlier version passed its declared type
 * straight through as the stored object's Content-Type — so a booking could
 * store `data:text/html;…` and Supabase would later serve it as a web page from
 * a signed URL, which is a URL the dashboard invites the client to open. The
 * type we serve is ours, and the bytes have to actually be a PNG.
 */
async function uploadPng(path, dataUrl) {
  const { url, key } = credentials();

  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Not a base64 PNG: ' + path);

  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.subarray(0, 4).equals(PNG_MAGIC)) {
    throw new Error('Payload is not a PNG: ' + path);
  }

  const response = await fetch(
    url + '/storage/v1/object/' + BUCKET + '/' + path,
    {
      method: 'POST',
      headers: headers(key, {
        'Content-Type': 'image/png',
        // Re-saving a design overwrites its own file rather than erroring
        'x-upsert': 'true'
      }),
      body: bytes
    }
  );

  if (!response.ok) await failure(response, 'Upload of ' + path);
  return path;
}

/* ----- erasure -----
 *
 * Deleting an order cascades to its design_versions rows, but not to the files
 * in the bucket — those are keyed by order id and would otherwise be left
 * behind after someone asked to be forgotten. These two exist so an erasure
 * removes both halves.
 */

async function removeRows(table, query) {
  const { url, key } = credentials();

  const response = await fetch(url + '/rest/v1/' + table + '?' + query, {
    method: 'DELETE',
    headers: headers(key, { Prefer: 'return=representation' })
  });

  if (!response.ok) await failure(response, 'Delete from ' + table);
  return response.json();
}

// Removes every object stored under one order's folder.
async function removeFolder(prefix) {
  const { url, key } = credentials();

  const listed = await fetch(url + '/storage/v1/object/list/' + BUCKET, {
    method: 'POST',
    headers: headers(key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix, limit: 100 })
  });

  if (!listed.ok) await failure(listed, 'Listing ' + prefix);

  const files = await listed.json();
  if (!files.length) return 0;

  const paths = files.map(file => prefix + '/' + file.name);

  const removed = await fetch(url + '/storage/v1/object/' + BUCKET, {
    method: 'DELETE',
    headers: headers(key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths })
  });

  if (!removed.ok) await failure(removed, 'Deleting files under ' + prefix);
  return paths.length;
}

/* The bucket is private, so the dashboard gets a URL that stops working. One
 * hour is long enough to look at an order and print it. */
async function signedUrl(path, expiresIn) {
  if (!path) return null;

  const { url, key } = credentials();

  const response = await fetch(
    url + '/storage/v1/object/sign/' + BUCKET + '/' + path,
    {
      method: 'POST',
      headers: headers(key, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: expiresIn || 3600 })
    }
  );

  if (!response.ok) await failure(response, 'Signing ' + path);

  const { signedURL } = await response.json();
  return url + '/storage/v1' + signedURL;
}

module.exports = { select, insert, update, uploadPng, signedUrl, removeRows, removeFolder };
