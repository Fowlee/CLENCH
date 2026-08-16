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

const DEFAULT_TO = 'post@clench.no';
const DEFAULT_FROM = 'post@clench.no';

// Longest we accept per field. Anything past this is a bot or a mistake.
const MAX_LENGTH = 2000;

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
  // TEMPORARY diagnostic — remove once mail is working. Reports which of our
  // variables the function can actually see. Names and lengths only, no values.
  if (event.httpMethod === 'GET' && event.queryStringParameters &&
      event.queryStringParameters.debug === 'env') {
    const seen = Object.keys(process.env)
      .filter(key => /BREVO|BOOKING/i.test(key))
      .map(key => key + ' (' + String(process.env[key]).length + ' chars)');

    return json(200, {
      matching: seen,
      totalEnvVars: Object.keys(process.env).length,
      context: process.env.CONTEXT || null,
      branch: process.env.BRANCH || null,
      siteName: process.env.SITE_NAME || null
    });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('BREVO_API_KEY is not set');
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
      textContent: 'Hi ' + booking.name + ',\n\n' +
        'Thanks for booking an appointment with CLENCH. We\'ll get back to you with ' +
        'available times for impression taking.\n\nHere\'s what you sent us:\n\n' +
        body.text + '\n\nIf anything is wrong, just reply to this email.\n\n– CLENCH',
      htmlContent:
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">' +
        '<p>Hi ' + escapeHtml(booking.name) + ',</p>' +
        '<p>Thanks for booking an appointment with CLENCH. We\'ll get back to you with ' +
        'available times for impression taking.</p>' +
        '<p><strong>Here\'s what you sent us:</strong></p>' +
        body.html +
        '<p>If anything is wrong, just reply to this email.</p>' +
        '<p>– CLENCH</p>' +
        '</div>'
    });
  } catch (err) {
    console.error('Customer copy failed:', err);
    copySent = false;
  }

  return json(200, { ok: true, copySent });
};
