/* Booking ticket — GET /.netlify/functions/ticket
 *
 * Handed to the order page when it loads, and sent back with the booking. See
 * lib/ticket.js for why the booking endpoint needs one.
 *
 * Deliberately cheap and anonymous: it takes no input, stores nothing, and
 * identifies nobody. Anyone can fetch one — the point is only that a caller has
 * to make a round trip and use the result promptly.
 */

const ticket = require('./lib/ticket');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // Every caller needs their own, and it expires
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ ticket: ticket.issue() })
    };
  } catch (err) {
    console.error('Could not issue a booking ticket:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Bookings are not configured yet.' })
    };
  }
};
