/* Booking form endpoint — POST /.netlify/functions/booking
 *
 * Takes the order form, sends the booking to CLENCH and a copy to whoever
 * filled it in. Mail goes out through Brevo's HTTP API, because Netlify
 * Functions run on AWS and Domeneshop refuses to relay for Amazon IPs.
 *
 * Netlify environment variables (Site configuration -> Environment variables):
 *   BREVO_API_KEY   required — Brevo dashboard -> SMTP & API -> API keys
 *   BOOKING_TO      optional — where bookings land   (default post@clench.no)
 *   BOOKING_FROM    optional — verified sender in Brevo (default post@clench.no)
 */

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
  ['design', 'Preferred design or colors'],
  ['records', 'Existing impression / scan'],
  ['braces', 'Braces'],
  ['message', 'Message']
];

const REQUIRED = ['name', 'email', 'phone', 'sport', 'design'];

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

  const booking = {};
  FIELDS.forEach(([key]) => { booking[key] = clean(submitted[key]); });

  const missing = REQUIRED.filter(key => !booking[key]);
  if (missing.length) {
    return json(400, { error: 'Missing required fields: ' + missing.join(', ') });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(booking.email)) {
    return json(400, { error: 'That email address looks wrong.' });
  }

  const to = process.env.BOOKING_TO || DEFAULT_TO;
  const from = process.env.BOOKING_FROM || DEFAULT_FROM;
  const sender = { name: 'CLENCH', email: from };
  const body = render(booking);

  // The booking itself. If this fails the whole request fails.
  try {
    await sendEmail(apiKey, {
      sender,
      to: [{ email: to }],
      replyTo: { email: booking.email, name: booking.name },
      subject: 'Booking – ' + booking.name + ' (' + booking.sport + ')',
      textContent: 'New booking request from the website.\n\n' + body.text,
      htmlContent: '<p style="font-family:Arial,sans-serif">New booking request from the website.</p>' + body.html
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
        'available times for impression taking.\n\nHere\'s what you sent us:\n\n' +
        body.text + '\n\nIf anything is wrong, just reply to this email.\n\n' +
        signatureText(),
      htmlContent: shell(
        '<p style="margin:0 0 16px">Hi ' + escapeHtml(booking.name.split(' ')[0]) + ',</p>' +
        '<p style="margin:0 0 16px">Thanks for booking an appointment with CLENCH. ' +
        'We\'ll get back to you with available times for impression taking.</p>' +
        '<p style="margin:0 0 12px"><strong>Here\'s what you sent us</strong></p>' +
        body.html +
        '<p style="margin:20px 0 0">If anything is wrong, just reply to this email.</p>'
      )
    });
  } catch (err) {
    console.error('Customer copy failed:', err);
    copySent = false;
  }

  return json(200, { ok: true, copySent });
};
