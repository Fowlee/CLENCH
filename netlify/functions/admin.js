/* Dashboard login — /.netlify/functions/admin
 *
 *   POST   { password }   sign in, sets the session cookie
 *   GET                   is this browser signed in? used on page load
 *   DELETE                sign out
 *
 * See lib/session.js for how the cookie is built and checked.
 */

const session = require('./lib/session');
const rateLimit = require('./lib/ratelimit');

// Slows a script down without being noticeable to a person typing a password
// once. On its own this only delays sequential guessing — requests made in
// parallel are unaffected — so it works alongside the limiter below.
const WRONG_PASSWORD_DELAY = 1000;

/* Attempts allowed from one caller before the door closes for a while. Generous
 * enough to survive genuine fumbling, small enough that guessing is pointless.
 * The password's own entropy is the real defence; this stops that from being
 * the only defence, in case it is ever changed to something weaker. */
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MINUTES = 15;

function json(statusCode, body, cookie) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;

  return { statusCode, headers, body: JSON.stringify(body) };
}

exports.handler = async event => {
  if (event.httpMethod === 'GET') {
    return json(200, { signedIn: session.isSignedIn(event) });
  }

  if (event.httpMethod === 'DELETE') {
    return json(200, { signedIn: false }, session.logoutCookie());
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let submitted;
  try {
    submitted = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Malformed request.' });
  }

  const allowance = await rateLimit.check(
    event, 'login', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MINUTES
  );

  if (!allowance.allowed) {
    return allowance.reason === 'over'
      ? json(429, { error: 'Too many attempts. Please wait a few minutes.' })
      : json(503, { error: 'Sign-in is unavailable — the server can\'t reach its database.' });
  }

  try {
    if (!session.checkPassword(submitted.password)) {
      await new Promise(resolve => setTimeout(resolve, WRONG_PASSWORD_DELAY));
      return json(401, { error: 'That password is wrong.' });
    }

    return json(200, { signedIn: true }, session.loginCookie());
  } catch (err) {
    // A missing password or secret is a setup problem, not the client's fault
    console.error('Dashboard login is misconfigured:', err);
    return json(500, { error: 'The dashboard is not configured yet.' });
  }
};
