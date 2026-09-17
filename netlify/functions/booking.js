/* Booking form endpoint — POST /.netlify/functions/booking
 *
 * Takes the order form, sends the booking to CLENCH and a copy to whoever
 * filled it in. Mail goes out through Brevo's HTTP API, because Netlify
 * Functions run on AWS and Domeneshop refuses to relay for Amazon IPs.
 *
 * Netlify environment variables (Site configuration -> Environment variables):
 *   BREVO_API_KEY         required — Brevo dashboard -> SMTP & API -> API keys
 *   BOOKING_TO            optional — where bookings land   (default post@clench.no)
 *   BOOKING_FROM          optional — verified sender in Brevo (default post@clench.no)
 *   SUPABASE_URL          required — see lib/supabase.js
 *   SUPABASE_SERVICE_KEY  required — see lib/supabase.js
 *   BOOKING_SECRET        required — see lib/ticket.js
 *   RATE_LIMIT_PEPPER     required — see lib/ratelimit.js
 *   RETENTION_MONTHS      optional — how long an order is kept (default 24)
 */

const store = require('./lib/supabase');
const ticket = require('./lib/ticket');
const rateLimit = require('./lib/ratelimit');

// Where bookings land. Override without a deploy by setting BOOKING_TO.
const DEFAULT_TO = 'post@clench.no';

// Public sender address, verified in Brevo. Leave this one alone.
const DEFAULT_FROM = 'post@clench.no';

// Longest we accept per field. Anything past this is a bot or a mistake.
const MAX_LENGTH = 2000;

/* ----- Branding for the customer's copy -----
 * Edit these freely. The logo has to be a full https URL to a raster image:
 * email clients don't render SVG, and many block images until the reader
 * allows them, so nothing important should live inside the picture.
 */
const SITE_URL = 'https://clench.no';

/* The logo has to load from a public address whatever machine sent the mail —
 * it's read in an inbox, not on the network the site was served from. So this
 * one stays pinned to production even when links point somewhere else. */
const LOGO_URL = SITE_URL + '/images/clench-email-logo.png';
const TAGLINE = 'Custom-fit mouthguards';
const RED = '#ff2a39';

// Lines of the signature. Add a phone number or Instagram link here.
const SIGNATURE_LINES = [
  { label: 'post@clench.no', href: 'mailto:post@clench.no' },
  { label: 'clench.no', href: SITE_URL }
];

const FIELDS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['sport', 'Sport'],
  ['club', 'Club / team'],
  ['availability', 'Preferred days / times'],
  ['notes', 'Design notes'],
  ['records', 'Existing impression / scan'],
  ['braces', 'Braces'],
  ['message', 'Message']
];

const REQUIRED = ['name', 'email', 'phone', 'sport'];

/* Rough ceiling on the design payload. A logo is embedded in the canvas JSON as
 * a data URL, so a booking is naturally a few MB; Netlify stops accepting a
 * request body somewhere past 6. Refuse early with a message that makes sense
 * rather than letting the platform return an opaque 413. */
const MAX_DESIGN_BYTES = 5 * 1024 * 1024;

/* Bookings one caller may make in an hour. A real customer sends one, or two if
 * they change their mind; anything past this is not ordering a mouthguard. */
const BOOKING_MAX_PER_HOUR = 5;
const BOOKING_WINDOW_MINUTES = 60;

/* What the customer is agreeing to. Held here rather than taken from the
 * request, so the record of what was consented to can't be rewritten by whoever
 * is submitting. Keep these two strings identical to the wording in order.html —
 * if the page changes, change these, and treat it as a new consent.
 *
 * Two separate agreements because the second covers health data, which under
 * Article 9 needs explicit and specific consent rather than being folded into a
 * general one. The site never receives a scan or an impression — those go
 * through the clinic — but a statement about orthodontic treatment is still
 * information about someone's health. */
const CONSENT_TEXT =
  'I agree that CLENCH may store my contact details to arrange my appointment ' +
  'and produce my mouthguard.';

const HEALTH_CONSENT_TEXT =
  'I agree that CLENCH may store what I have said about my teeth and any ' +
  'orthodontic treatment, so my mouthguard fits safely.';

/* How long an order is kept before it becomes eligible for deletion.
 *
 * Article 5(1)(e) requires a limit, and this is a business decision as much as
 * a legal one — CLENCH tells customers their record is kept so they need only
 * be scanned once. Two years is a starting point, not a considered answer.
 * Override with RETENTION_MONTHS once the real period is decided. */
const DEFAULT_RETENTION_MONTHS = 24;

/* What a design may contain. Anything the customer builds is one of these, and
 * everything here is later rebuilt by Fabric inside the dashboard — the one
 * page holding every customer's contact details. Unknown types don't get to
 * make the trip. */
const ALLOWED_OBJECT_TYPES = ['i-text', 'text', 'textbox', 'image'];
const MAX_CANVAS_OBJECTS = 40;

function clean(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_LENGTH) : '';
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

// The order as plain text and as a simple table, same content either way
function render(booking) {
  const rows = FIELDS.map(([key, label]) => [label, booking[key] || '—']);

  const text = rows.map(([label, value]) => label + ': ' + value).join('\n');

  const html = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px">' +
    rows.map(([label, value]) =>
      '<tr>' +
      '<td style="padding:6px 16px 6px 0;color:#777;vertical-align:top;white-space:nowrap">' +
        escapeHtml(label) +
      '</td>' +
      '<td style="padding:6px 0;color:#111">' +
        escapeHtml(value).replace(/\n/g, '<br>') +
      '</td>' +
      '</tr>'
    ).join('') +
    '</table>';

  return { text, html };
}

/* Wraps content in the branded shell: black header with the logo, white card,
 * signature underneath. Tables and inline styles throughout — Outlook ignores
 * most modern CSS, so this is the layout language email still agrees on.
 */
function shell(inner) {
  const signature = SIGNATURE_LINES
    .map(line =>
      '<a href="' + line.href + '" style="color:' + RED + ';text-decoration:none">' +
      escapeHtml(line.label) + '</a>'
    )
    .join('<span style="color:#ccc"> &nbsp;·&nbsp; </span>');

  return '' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
         'style="background:#f4f4f4;padding:24px 12px">' +
    '<tr><td align="center">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" ' +
             'style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">' +

        // If the reader blocks images, the styled alt text still reads as the
        // wordmark — white on the black bar, rather than invisible black on black.
        '<tr><td align="center" style="background:#000000;padding:28px 24px">' +
          '<img src="' + LOGO_URL + '" width="180" alt="CLENCH" ' +
               'style="display:block;border:0;width:180px;height:auto;' +
               'color:#ffffff;font-family:Arial,Helvetica,sans-serif;' +
               'font-size:26px;font-weight:bold;letter-spacing:0.06em">' +
        '</td></tr>' +

        '<tr><td style="padding:32px 32px 8px;font-family:Arial,Helvetica,sans-serif;' +
                       'font-size:15px;line-height:1.6;color:#111111">' +
          inner +
        '</td></tr>' +

        '<tr><td style="padding:24px 32px 32px">' +
          '<div style="border-top:1px solid #eeeeee;padding-top:20px;' +
                      'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#555555">' +
            '<div style="font-weight:bold;color:#111111;letter-spacing:0.04em">CLENCH</div>' +
            '<div style="padding:2px 0 8px">' + escapeHtml(TAGLINE) + '</div>' +
            '<div>' + signature + '</div>' +
          '</div>' +
        '</td></tr>' +

      '</table>' +
    '</td></tr>' +
  '</table>';
}

function signatureText() {
  return '– CLENCH\n' + TAGLINE + '\n' +
    SIGNATURE_LINES.map(line => line.label).join(' · ');
}

function sendEmail(apiKey, payload) {
  return fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  }).then(res => {
    if (res.ok) return res.json();
    return res.text().then(body => {
      throw new Error('Brevo responded ' + res.status + ': ' + body);
    });
  });
}

/* ----- Saving the order -----
 *
 * The design travels with the booking as one submission: the canvas JSON, the
 * guard colour, and two rendered PNGs the browser already had to make. Storing
 * it here means the dashboard never has to re-run Fabric to show an order.
 */

const crypto = require('crypto');

/* Short reference the client can read down the phone. The month keeps the
 * random half small enough to say out loud while staying unique in practice. */
function makeRef() {
  const now = new Date();
  const month = String(now.getFullYear()).slice(2) +
                String(now.getMonth() + 1).padStart(2, '0');

  return 'CL-' + month + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

// The customer's link is the capability, so it has to be unguessable.
function makeViewToken() {
  return crypto.randomBytes(16).toString('hex');
}

/* What a usable design looks like. The canvas alone can rebuild everything, so
 * that is the only part we refuse to accept a booking without. */
function readDesign(submitted) {
  const design = submitted && submitted.design;

  if (!design || typeof design !== 'object') return null;
  if (!/^#[0-9a-f]{6}$/i.test(design.baseColor || '')) return null;
  if (!safeCanvas(design.canvas)) return null;

  return {
    canvas: design.canvas,
    baseColor: design.baseColor.toLowerCase(),
    print: typeof design.print === 'string' ? design.print : '',
    thumb: typeof design.thumb === 'string' ? design.thumb : ''
  };
}

/* Checks the canvas is something we're willing to hand to Fabric later.
 *
 * This JSON arrives from the browser, is stored, and is then deserialised in
 * the dashboard — so an image object naming a remote src would have the
 * client's own browser fetch it, and an unbounded array would hang the page.
 * Artwork must be pixels we already hold, never an address to go and load.
 */
function safeCanvas(canvas) {
  if (!canvas || !Array.isArray(canvas.objects)) return false;
  if (canvas.objects.length > MAX_CANVAS_OBJECTS) return false;

  return canvas.objects.every(object => {
    if (!object || !ALLOWED_OBJECT_TYPES.includes(object.type)) return false;

    if (object.type === 'image') {
      return /^data:image\/(png|jpeg|webp);base64,/.test(object.src || '');
    }

    return true;
  });
}

/* Consent has to be demonstrable, so what was agreed is recorded from the
 * server's own copy of the wording rather than from the request. */
function readConsent(submitted) {
  if (submitted.consent !== true || submitted.healthConsent !== true) return null;

  const now = new Date().toISOString();

  return {
    consent_at: now,
    consent_text: CONSENT_TEXT,
    health_consent_at: now,
    health_consent_text: HEALTH_CONSENT_TEXT
  };
}

// When this order becomes eligible for deletion.
function deleteAfter() {
  const months = Number(process.env.RETENTION_MONTHS) || DEFAULT_RETENTION_MONTHS;
  const when = new Date();
  when.setMonth(when.getMonth() + months);
  return when.toISOString();
}

/* Writes the order and its first design version. Version 1 is the customer's
 * own work and is never rewritten — refinements from the dashboard append. */
async function saveOrder(booking, design, consent) {
  let order;

  // ref collisions are rare but cheap to survive, so just try another one
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      order = await store.insert('orders', Object.assign({
        ref: makeRef(),
        view_token: makeViewToken(),
        delete_after: deleteAfter(),
        name: booking.name,
        email: booking.email.toLowerCase(),
        phone: booking.phone,
        sport: booking.sport,
        club: booking.club,
        availability: booking.availability,
        records: booking.records,
        braces: booking.braces,
        message: booking.message,
        notes: booking.notes
      }, consent));
      break;
    } catch (err) {
      // 23505 is Postgres' unique violation: a ref we'd already used
      if (attempt === 4 || !/23505|duplicate key/.test(err.message)) throw err;
    }
  }

  /* The PNGs are a convenience — the canvas can regenerate both. Losing an
   * upload should not lose the order, so failures here are logged and dropped. */
  let printPath = null;
  let thumbPath = null;

  try {
    if (design.print) {
      printPath = await store.uploadPng(order.id + '/v1-print.png', design.print);
    }
    if (design.thumb) {
      thumbPath = await store.uploadPng(order.id + '/v1-thumb.png', design.thumb);
    }
  } catch (err) {
    console.error('Design image upload failed for ' + order.ref + ':', err);
  }

  await store.insert('design_versions', {
    order_id: order.id,
    version: 1,
    author: 'customer',
    base_color: design.baseColor,
    canvas: design.canvas,
    print_path: printPath,
    thumb_path: thumbPath
  });

  return order;
}

/* Where the links in these emails should point.
 *
 * Hardcoding production meant a booking made against a local server or a deploy
 * preview emailed links to the live site, which doesn't have that order — so
 * the design link and the dashboard link both led nowhere.
 *
 * Netlify sets URL in production and DEPLOY_PRIME_URL on a branch preview, so
 * those win wherever they exist. Only when neither is set — which in practice
 * means local development — do we read the address off the request, so a
 * booking made from a phone on the LAN links back to that same machine.
 *
 * The order matters for more than convenience: trusting the Host header in
 * production would let someone send a request with a forged host and receive an
 * email full of links to their own domain. In production the env vars are
 * always present, so the header is never consulted.
 */
function siteUrl(event) {
  const headers = event.headers || {};
  const host = headers['x-forwarded-host'] || headers.host;
  const clean = value => value.replace(/\/+$/, '');

  /* Running under `netlify dev`. Its URL variable is a placeholder
   * (https://main--site-name.netlify.app on an unlinked site), so the request's
   * own address is the only thing that actually leads back here — and it's what
   * makes a link work on a phone testing over the LAN. */
  if (process.env.NETLIFY_DEV === 'true' && host) {
    return (headers['x-forwarded-proto'] || 'http') + '://' + host;
  }

  /* A preview links to itself, and this beats SITE_URL deliberately.
   *
   * SITE_URL used to be checked first, which meant that setting it to the live
   * domain — a perfectly reasonable thing to do — made every booking made on a
   * preview email links pointing at production, where the order does not exist
   * and the page may not either. A preview emailing you to production is never
   * what anyone wants, so the context wins here. */
  const context = process.env.CONTEXT;
  if ((context === 'deploy-preview' || context === 'branch-deploy') &&
      process.env.DEPLOY_PRIME_URL) {
    return clean(process.env.DEPLOY_PRIME_URL);
  }

  // Production: an explicit setting, then whatever Netlify says the site is.
  const configured = process.env.SITE_URL || process.env.URL;
  if (configured) return clean(configured);

  return SITE_URL;
}

// A link styled as a button, in the table-and-inline-styles dialect email needs
function button(href, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">' +
    '<tr><td style="background:' + RED + ';border-radius:6px">' +
      '<a href="' + href + '" style="display:inline-block;padding:12px 22px;' +
         'font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;' +
         'color:#ffffff;text-decoration:none">' + escapeHtml(label) + '</a>' +
    '</td></tr></table>';
}

// Brevo wants the payload without the data URL prefix
function attachment(dataUrl, name) {
  const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl || '');
  return match ? { content: match[1], name } : null;
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // Netlify holds it as BREVO_APIKEY; accept the conventional spelling too
  const apiKey = process.env.BREVO_APIKEY || process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('BREVO_APIKEY is not set');
    return json(500, { error: 'Email is not configured yet.' });
  }

  let submitted;
  try {
    submitted = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Malformed request.' });
  }

  // Honeypot: the field is hidden, so only bots fill it in. Answer 200 so
  // they think it worked and don't come back to retry.
  if (clean(submitted.company)) {
    return json(200, { ok: true, copySent: true });
  }

  /* This endpoint sends mail from a DKIM-signed clench.no address to whatever
   * recipient the request names, and writes a row and two files per call. With
   * nothing in front of it, that is a spam relay wearing your own domain's
   * reputation, and a way to burn a 300-a-day mail quota so real customers
   * silently can't book. Two gates, cheapest first. */
  if (!ticket.isValid(submitted.ticket)) {
    return json(403, {
      error: 'This booking form has expired. Please reload the page and try again.'
    });
  }

  const allowance = await rateLimit.check(
    event, 'booking', BOOKING_MAX_PER_HOUR, BOOKING_WINDOW_MINUTES
  );

  if (!allowance.allowed) {
    /* Still refused either way — an ungated mail sender is worse than a closed
     * one — but the customer is told which it is. */
    return allowance.reason === 'over'
      ? json(429, {
          error: 'That is a lot of bookings from one place. Please wait a while, ' +
                 'or email post@clench.no.'
        })
      : json(503, {
          error: 'We can\'t take bookings right now — this is our fault, not ' +
                 'yours. Please email post@clench.no and we\'ll sort it out.'
        });
  }

  /* Article 7(1): the controller must be able to demonstrate consent, and
   * Article 9 wants the health part agreed to separately. Enforced here rather
   * than only in the browser, where it proves nothing. */
  const consent = readConsent(submitted);
  if (!consent) {
    return json(400, {
      error: 'Please agree to both statements before sending your booking.'
    });
  }

  const booking = {};
  FIELDS.forEach(([key]) => { booking[key] = clean(submitted[key]); });

  const missing = REQUIRED.filter(key => !booking[key]);
  if (missing.length) {
    return json(400, { error: 'Missing required fields: ' + missing.join(', ') });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(booking.email)) {
    return json(400, { error: 'That email address looks wrong.' });
  }

  if ((event.body || '').length > MAX_DESIGN_BYTES) {
    return json(413, {
      error: 'That design is too large to send. Try a smaller image on the guard.'
    });
  }

  // Every order carries a design now — there is no path to this form without one
  const design = readDesign(submitted);
  if (!design) {
    return json(400, { error: 'This booking arrived without a design. Please design your guard first.' });
  }

  /* Storing is what makes the order findable later, but the emails below are a
   * second copy of the same thing. So a database that is down costs the client
   * his dashboard entry, not the customer's booking. */
  let order = null;
  try {
    order = await saveOrder(booking, design, consent);
  } catch (err) {
    console.error('Saving the order failed:', err);
  }

  const to = process.env.BOOKING_TO || DEFAULT_TO;
  const from = process.env.BOOKING_FROM || DEFAULT_FROM;
  const sender = { name: 'CLENCH', email: from };
  const body = render(booking);

  const reference = order ? order.ref : null;
  const base = siteUrl(event);
  const dashboardLink = order ? base + '/dashboard.html?order=' + order.ref : null;
  const customerLink = order ? base + '/designer.html?d=' + order.view_token : null;

  // The print file rides along, so the design survives even if the store doesn't
  const printFile = attachment(design.print, (reference || 'clench') + '-print.png');

  // The booking itself. If this fails the whole request fails.
  try {
    await sendEmail(apiKey, {
      sender,
      to: [{ email: to }],
      replyTo: { email: booking.email, name: booking.name },
      subject: 'Booking – ' + booking.name + ' (' + booking.sport + ')' +
        (reference ? ' – ' + reference : ''),
      attachment: printFile ? [printFile] : undefined,
      textContent: 'New booking request from the website.\n\n' +
        (reference ? 'Reference: ' + reference + '\n' : '') +
        (dashboardLink ? 'Open in the dashboard: ' + dashboardLink + '\n' : '') +
        (order ? '' : 'NOTE: this order could not be saved to the dashboard. ' +
          'The print file is attached to this email.\n') +
        '\n' + body.text,
      htmlContent:
        '<p style="font-family:Arial,sans-serif">New booking request from the website.' +
        (reference ? ' Reference <strong>' + escapeHtml(reference) + '</strong>.' : '') +
        '</p>' +
        (dashboardLink ? button(dashboardLink, 'Open in the dashboard') : '') +
        (order ? '' :
          '<p style="font-family:Arial,sans-serif;color:#b00020">This order could not be ' +
          'saved to the dashboard, so it will not show up in search. The print file is ' +
          'attached to this email.</p>') +
        body.html
    });
  } catch (err) {
    console.error('Booking email failed:', err);
    return json(502, { error: 'We could not send your booking. Please try again.' });
  }

  // The customer's copy is a nice-to-have — never fail the booking over it.
  let copySent = true;
  try {
    await sendEmail(apiKey, {
      sender,
      to: [{ email: booking.email, name: booking.name }],
      replyTo: { email: to, name: 'CLENCH' },
      subject: 'Your CLENCH booking request',
      textContent: 'Hi ' + booking.name.split(' ')[0] + ',\n\n' +
        'Thanks for booking an appointment with CLENCH. We\'ll get back to you with ' +
        'available times for impression taking.\n\n' +
        (customerLink ? 'See your design any time: ' + customerLink + '\n\n' : '') +
        'Here\'s what you sent us:\n\n' +
        body.text + '\n\nIf anything is wrong, just reply to this email.\n\n' +
        signatureText(),
      htmlContent: shell(
        '<p style="margin:0 0 16px">Hi ' + escapeHtml(booking.name.split(' ')[0]) + ',</p>' +
        '<p style="margin:0 0 16px">Thanks for booking an appointment with CLENCH. ' +
        'We\'ll get back to you with available times for impression taking.</p>' +
        (customerLink
          ? '<p style="margin:0 0 4px"><strong>Your design</strong></p>' +
            '<p style="margin:0 0 10px;color:#555555">This link stays live, so you can ' +
            'come back to it whenever you like.</p>' +
            button(customerLink, 'See your design')
          : '') +
        '<p style="margin:0 0 12px"><strong>Here\'s what you sent us</strong></p>' +
        body.html +
        '<p style="margin:20px 0 0">If anything is wrong, just reply to this email.</p>'
      )
    });
  } catch (err) {
    console.error('Customer copy failed:', err);
    copySent = false;
  }

  return json(200, { ok: true, copySent, ref: reference, view: customerLink });
};
