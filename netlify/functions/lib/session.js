/* Dashboard session — a signed cookie, nothing more.
 *
 * One person uses the dashboard, so there are no accounts, no roles and no user
 * table. A shared password is exchanged for a cookie carrying its own expiry
 * and an HMAC of that expiry. Nothing is stored server side: if the signature
 * checks out and the date hasn't passed, the request is from someone who knew
 * the password.
 *
 * Netlify environment variables:
 *   DASHBOARD_PASSWORD  what the client types on the login screen
 *   DASHBOARD_SECRET    long random string used to sign cookies. Changing it
 *                       logs everyone out, which is the way to revoke a session.
 */

const crypto = require('crypto');

const COOKIE = 'clench_admin';

// Long enough that he isn't logging in every visit, short enough that a
// forgotten laptop stops being a way in.
const SESSION_DAYS = 30;

function secret() {
  const value = process.env.DASHBOARD_SECRET;
  if (!value || value.length < 16) {
    throw new Error('DASHBOARD_SECRET must be set to a long random string');
  }
  return value;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

/* Compares two values without leaking, through timing, how much of one matched.
 *
 * Both sides are hashed first so the comparison is always over 32 bytes. The
 * previous version returned early when the lengths differed, which answered
 * "how long is the password" to anyone willing to measure — and length is a
 * meaningful head start when guessing. */
function matches(a, b) {
  const digest = value => crypto.createHmac('sha256', secret())
                                .update(String(value)).digest();

  return crypto.timingSafeEqual(digest(a), digest(b));
}

function checkPassword(submitted) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) throw new Error('DASHBOARD_PASSWORD is not set');

  return matches(submitted || '', expected);
}

/* The Set-Cookie header for a fresh session.
 *
 * HttpOnly so no script can read it, and Secure so it never crosses plain HTTP.
 *
 * SameSite is Lax rather than Strict on purpose. Strict withholds the cookie on
 * any navigation that starts on another site — including clicking the dashboard
 * link in the booking email, which would drop him on the login screen every
 * single time. Lax still refuses to send it on cross-site POSTs, so the status
 * endpoint keeps its CSRF protection.
 */
function loginCookie() {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const value = expiresAt + '.' + sign(String(expiresAt));

  return COOKIE + '=' + value +
    '; HttpOnly; Secure; SameSite=Lax; Path=/' +
    '; Max-Age=' + SESSION_DAYS * 24 * 60 * 60;
}

function logoutCookie() {
  return COOKIE + '=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

function readCookie(header) {
  const found = (header || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(COOKIE + '='));

  return found ? found.slice(COOKIE.length + 1) : '';
}

/* True when the request carries a cookie this server signed and that hasn't
 * expired. Any malformed value is simply not a session. */
function isSignedIn(event) {
  const headers = event.headers || {};
  const value = readCookie(headers.cookie || headers.Cookie);

  const [expiresAt, signature] = value.split('.');
  if (!expiresAt || !signature) return false;

  try {
    if (!matches(signature, sign(expiresAt))) return false;
  } catch (err) {
    // No secret configured means no session can be trusted, which is the same
    // answer as a bad signature — and a safer one than a 500.
    console.error('Session check failed:', err);
    return false;
  }

  return Number(expiresAt) > Date.now();
}

module.exports = { checkPassword, loginCookie, logoutCookie, isSignedIn };
