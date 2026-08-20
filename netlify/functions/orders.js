/* Dashboard data — /.netlify/functions/orders
 *
 *   GET  ?q=<text>     search by email, phone, name or reference
 *   GET                the most recent orders, for an empty search box
 *   GET  ?ref=CL-...   one order in full, with its current design
 *   POST { ref, status }  move an order along the pipeline
 *
 * Everything here needs a signed-in session — this is the only place customer
 * contact details leave the database.
 */

const store = require('./lib/supabase');
const session = require('./lib/session');

// A search is a person scanning a list, not a report. Enough to find someone.
const SEARCH_LIMIT = 25;
const RECENT_LIMIT = 15;

// Long enough to look at an order and print it, short enough that a copied
// image URL stops working before it can be passed around.
const LINK_SECONDS = 60 * 60;

const STATUSES = ['new', 'impression', 'printed', 'delivered'];

const LIST_COLUMNS = 'ref,created_at,name,email,phone,sport,club,status';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

/* PostgREST reads commas, parentheses and quotes as filter syntax, so they are
 * stripped rather than escaped: none of them appear in an email address, a
 * phone number or a name anybody would search for. */
function sanitise(query) {
  return query.replace(/[(),"*\\]/g, '').trim().slice(0, 60);
}

/* A reference has exactly one shape, so anything else is rejected outright
 * rather than escaped and hoped for. encodeURIComponent leaves . ! * ' ( ) as
 * they are, which is a thin thing to be relying on when the value is being
 * concatenated into a PostgREST filter. */
const REF_PATTERN = /^CL-\d{4}-[0-9A-F]{4}$/;

function validRef(ref) {
  return REF_PATTERN.test(String(ref || '').toUpperCase().trim());
}

/* Searching one box against four columns. Phone numbers are matched against the
 * digits-only column, so "45 12" finds "+47 900 45 12". */
function searchFilter(query) {
  const text = encodeURIComponent(sanitise(query));
  const digits = query.replace(/\D/g, '');

  const clauses = [
    'email.ilike.*' + text + '*',
    'name.ilike.*' + text + '*',
    'ref.ilike.*' + text + '*'
  ];

  if (digits) clauses.push('phone_digits.ilike.*' + digits + '*');

  return 'or=(' + clauses.join(',') + ')';
}

exports.handler = async event => {
  if (!session.isSignedIn(event)) {
    return json(401, { error: 'Please sign in.' });
  }

  const params = event.queryStringParameters || {};

  try {
    if (event.httpMethod === 'GET' && params.ref) {
      if (!validRef(params.ref)) return json(400, { error: 'Not a reference.' });

      // Export for a subject access request — the order and every design version
      if (params.export === '1') return json(200, await exportOrder(params.ref));

      const found = await readOrder(params.ref);

      // readOrder reports a miss in its body; that's a 404, not a 200
      return json(found.error ? 404 : 200, found);
    }

    /* Erasure. Removes the order, its design versions by cascade, and the files
     * in storage — which the cascade does not reach, and which would otherwise
     * sit in the bucket after somebody asked to be forgotten. */
    if (event.httpMethod === 'DELETE') {
      if (!validRef(params.ref)) return json(400, { error: 'Not a reference.' });

      const erased = await eraseOrder(params.ref);
      if (!erased) return json(404, { error: 'No order with that reference.' });

      return json(200, { ref: params.ref, erased: true, files: erased.files });
    }

    if (event.httpMethod === 'GET') {
      return json(200, { orders: await searchOrders(params.q || '') });
    }

    if (event.httpMethod === 'POST') {
      let submitted;
      try {
        submitted = JSON.parse(event.body || '{}');
      } catch (err) {
        return json(400, { error: 'Malformed request.' });
      }

      const { ref, status } = submitted;

      if (!validRef(ref)) return json(400, { error: 'Not a reference.' });

      if (!STATUSES.includes(status)) {
        return json(400, { error: 'Unknown status: ' + status });
      }

      const updated = await store.update(
        'orders',
        'ref=eq.' + encodeURIComponent(ref),
        { status, updated_at: new Date().toISOString() }
      );

      if (!updated) return json(404, { error: 'No order with that reference.' });
      return json(200, { ref: updated.ref, status: updated.status });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Dashboard request failed:', err);
    return json(500, { error: 'Something went wrong reading the orders.' });
  }
};

/* ----- reads ----- */

async function searchOrders(query) {
  const filter = query
    ? searchFilter(query) + '&limit=' + SEARCH_LIMIT
    : 'limit=' + RECENT_LIMIT;

  const orders = await store.select(
    'orders?select=id,' + LIST_COLUMNS + '&order=created_at.desc&' + filter
  );

  if (!orders.length) return [];

  /* One query for every thumbnail rather than one per row: PostgREST's `in`
   * filter takes the whole set of order ids at once. */
  const ids = orders.map(order => order.id).join(',');
  const versions = await store.select(
    'design_versions?select=order_id,version,thumb_path&order_id=in.(' + ids + ')' +
    '&order=version.desc'
  );

  // First row per order wins, and they arrive newest version first.
  const newest = new Map();
  versions.forEach(version => {
    if (!newest.has(version.order_id)) newest.set(version.order_id, version);
  });

  return Promise.all(orders.map(async order => {
    const version = newest.get(order.id);

    return {
      ref: order.ref,
      createdAt: order.created_at,
      name: order.name,
      email: order.email,
      phone: order.phone,
      sport: order.sport,
      club: order.club,
      status: order.status,
      thumb: version ? await store.signedUrl(version.thumb_path, LINK_SECONDS) : null
    };
  }));
}

async function readOrder(ref) {
  const found = await store.select(
    'orders?ref=eq.' + encodeURIComponent(sanitise(ref)) + '&select=*&limit=1'
  );

  if (!found.length) return { error: 'No order with that reference.' };

  const order = found[0];

  const versions = await store.select(
    'design_versions?order_id=eq.' + order.id +
    '&select=version,author,created_at,base_color,canvas,print_path,thumb_path' +
    '&order=version.desc'
  );

  const current = versions[0] || null;

  return {
    order: {
      ref: order.ref,
      createdAt: order.created_at,
      status: order.status,
      name: order.name,
      email: order.email,
      phone: order.phone,
      sport: order.sport,
      club: order.club,
      availability: order.availability,
      records: order.records,
      braces: order.braces,
      message: order.message,
      notes: order.notes,
      viewLink: '/designer.html?d=' + order.view_token
    },
    design: current && {
      version: current.version,
      author: current.author,
      createdAt: current.created_at,
      baseColor: current.base_color,
      canvas: current.canvas,
      print: await store.signedUrl(current.print_path, LINK_SECONDS),
      thumb: await store.signedUrl(current.thumb_path, LINK_SECONDS)
    },
    versionCount: versions.length
  };
}

/* ----- erasure and export -----
 *
 * Articles 15, 17 and 20. Doing these by hand in the Supabase console doesn't
 * happen reliably and leaves no trace, so both live behind the dashboard.
 */

async function eraseOrder(ref) {
  const found = await store.select(
    'orders?ref=eq.' + encodeURIComponent(ref) + '&select=id&limit=1'
  );

  if (!found.length) return null;

  const id = found[0].id;

  /* Files first. If the row went first and this failed, nothing would remain to
   * say those files existed, and they'd stay in the bucket forever. */
  const files = await store.removeFolder(id);

  // design_versions goes with it, via on delete cascade
  await store.removeRows('orders', 'id=eq.' + id);

  console.log('Order erased: ' + ref + ' (' + files + ' files)');
  return { files };
}

/* Everything held about one order, as JSON. Answers a subject access request
 * and doubles as portability, since the design is the part worth taking. */
async function exportOrder(ref) {
  const found = await store.select(
    'orders?ref=eq.' + encodeURIComponent(ref) + '&select=*&limit=1'
  );

  if (!found.length) return { error: 'No order with that reference.' };

  const order = found[0];

  const versions = await store.select(
    'design_versions?order_id=eq.' + order.id + '&select=*&order=version.asc'
  );

  // The token is a credential, not data about the customer
  delete order.view_token;

  return { exportedAt: new Date().toISOString(), order, designs: versions };
}
