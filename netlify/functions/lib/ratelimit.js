/* Rate limiting for the endpoints anyone can reach.
 *
 * Two of them are exposed to the open internet with no credential: the booking
 * form, which sends mail and writes rows, and the dashboard login. Both need a
 * ceiling on how often one caller may try.
 *
 * Counts are kept against a salted hash of the caller's address rather than the
 * address itself. An IP is personal data, and a limiter that stored them would
 * become a log of everyone who ever visited — exactly the kind of collection
 * that has to be justified and then deleted. A hash answers "is this the same
 * caller as a minute ago" without answering "who is it".
 *
 * Netlify environment variables:
 *   RATE_LIMIT_PEPPER  long random string. Rotating it resets every counter.
 */

const crypto = require('crypto');
const store = require('./supabase');

/* Fails closed on purpose. If the limiter can't be consulted we can't tell an
 * attacker from a customer, and the endpoints it guards send mail from a
 * verified domain — letting them through unmeasured is the worse outcome. */
const FAIL_OPEN = false;

function clientKey(event) {
  const headers = event.headers || {};

  /* Netlify sets x-nf-client-connection-ip; x-forwarded-for is the fallback and
   * may be a list, in which case the first entry is the original client. */
  const address = headers['x-nf-client-connection-ip'] ||
                  (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
                  'unknown';

  const pepper = process.env.RATE_LIMIT_PEPPER;
  if (!pepper) throw new Error('RATE_LIMIT_PEPPER is not set');

  return crypto.createHmac('sha256', pepper).update(address).digest('hex');
}

/* Records this attempt and reports whether the caller may continue.
 *
 * Returns one of three answers, because "you have made too many requests" and
 * "we cannot tell how many requests you have made" are different things and
 * deserve different words. Telling a customer they are booking too often when
 * the real problem is a missing environment variable sends them away for no
 * reason and hides the fault from whoever could fix it.
 *
 *   { allowed: true }
 *   { allowed: false, reason: 'over' }         genuinely too many
 *   { allowed: false, reason: 'unavailable' }  the limiter itself is broken
 *
 * Counting after inserting means a caller who is already over keeps adding
 * rows, which is intentional: it makes a sustained attack visible in the table
 * rather than invisible once the gate closes. */
async function check(event, bucket, max, windowMinutes) {
  let key;
  try {
    key = clientKey(event);
  } catch (err) {
    console.error('Rate limiting is misconfigured:', err.message);
    return { allowed: FAIL_OPEN, reason: 'unavailable' };
  }

  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  try {
    await store.insert('rate_limits', { bucket, client_key: key });

    const recent = await store.select(
      'rate_limits?select=id&bucket=eq.' + encodeURIComponent(bucket) +
      '&client_key=eq.' + key +
      '&created_at=gte.' + encodeURIComponent(since) +
      '&limit=' + (max + 1)
    );

    if (recent.length > max) return { allowed: false, reason: 'over' };
    return { allowed: true };
  } catch (err) {
    console.error('Rate limit store unreachable for bucket ' + bucket + ': ' + err.message);
    return { allowed: FAIL_OPEN, reason: 'unavailable' };
  }
}

module.exports = { check };
