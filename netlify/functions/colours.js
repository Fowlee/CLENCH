/* Which guard colours are currently orderable.
 *
 * GET  — public. The designer asks on load so it can grey out what's out of
 *        stock. Returns nothing personal, so it needs no session.
 * POST — dashboard only. Switches one colour off or back on.
 *
 * The table stores only the colours that are OFF. Anything the palette knows
 * about and this table doesn't is available, so adding a colour to colours.js
 * needs no database change.
 */

const store = require('./lib/supabase');
const session = require('./lib/session');

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify(body)
  };
}

// The palette is a closed set, so anything not shaped like one of its entries
// is rejected rather than written to the table.
const HEX = /^#[0-9a-f]{6}$/;

exports.handler = async event => {
  try {
    if (event.httpMethod === 'GET') {
      const rows = await store.select('colour_availability?select=hex,note');

      return json(200, {
        unavailable: rows.map(row => row.hex),
        notes: Object.fromEntries(rows.filter(r => r.note).map(r => [r.hex, r.note]))
      }, {
        /* Short cache: a colour going out of stock should reach customers
         * quickly, but this is hit on every designer load. */
        'Cache-Control': 'public, max-age=60'
      });
    }

    if (event.httpMethod === 'POST') {
      if (!session.isSignedIn(event)) return json(401, { error: 'Please sign in.' });

      let submitted;
      try {
        submitted = JSON.parse(event.body || '{}');
      } catch (err) {
        return json(400, { error: 'Malformed request.' });
      }

      const hex = String(submitted.hex || '').toLowerCase();
      if (!HEX.test(hex)) return json(400, { error: 'Not a colour.' });

      if (submitted.available === true) {
        await store.removeRows('colour_availability', 'hex=eq.' + encodeURIComponent(hex));
        return json(200, { hex, available: true });
      }

      if (submitted.available === false) {
        const note = typeof submitted.note === 'string'
          ? submitted.note.trim().slice(0, 200)
          : null;

        /* Upsert, so switching an already-off colour off again is not an error
         * — two people with the dashboard open should not be able to break it. */
        await store.upsert('colour_availability', {
          hex,
          note: note || null,
          updated_at: new Date().toISOString()
        });

        return json(200, { hex, available: false, note });
      }

      return json(400, { error: 'Say whether it is available.' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Colour availability request failed:', err.message);
    return json(500, { error: 'Could not reach the colour list.' });
  }
};
