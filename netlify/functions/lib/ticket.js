/* Proof that a booking came from a browser that loaded the order page.
 *
 * The booking endpoint sends mail from a DKIM-signed clench.no address and
 * writes to the database, and it has no login in front of it — so on its own it
 * would send whatever a script asked it to, to whatever address the script
 * chose. A ticket doesn't make it private, but it means a caller has to fetch
 * one first and use it inside the hour, which ends drive-by abuse.
 *
 * Stateless: the ticket carries its own expiry and an HMAC of that expiry, the
 * same shape as the dashboard session. Nothing is stored to check it against.
 *
 * Netlify environment variables:
 *   BOOKING_SECRET  long random string used to sign tickets
 */

const crypto = require('crypto');

// Long enough to fill in a booking form without hurrying, short enough that a
// harvested ticket is worth little.
const TICKET_MINUTES = 60;

function secret() {
  const value = process.env.BOOKING_SECRET;
  if (!value || value.length < 16) {
    throw new Error('BOOKING_SECRET must be set to a long random string');
  }
  return value;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

function issue() {
  const expires = Date.now() + TICKET_MINUTES * 60 * 1000;
  return expires + '.' + sign(String(expires));
}

/* Both halves are hex of a fixed length, so the comparison is over equal-length
 * buffers and timingSafeEqual can't throw. */
function isValid(value) {
  const [expires, signature] = String(value || '').split('.');
  if (!expires || !signature) return false;

  let expected;
  try {
    expected = sign(expires);
  } catch (err) {
    console.error('Ticket check failed:', err.message);
    return false;
  }

  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  return Number(expires) > Date.now();
}

module.exports = { issue, isValid };
