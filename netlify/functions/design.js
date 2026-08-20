/* Customer's design link — GET /.netlify/functions/design?d=<view_token>
 *
 * Serves the design behind the link in the confirmation email, for the view
 * mode in designer.html. Returns the newest version, so if CLENCH refines the
 * design after impression taking, the customer's link shows the current one.
 *
 * The token is the entire permission, so this deliberately returns nothing that
 * identifies anybody: the canvas, the colour, and the order reference. No name,
 * no email, no phone. Somebody guessing a token learns nothing about a person.
 */

const store = require('./lib/supabase');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // A design link is per-customer; nothing in between should keep a copy.
      'Cache-Control': 'private, no-store'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async event => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const token = (event.queryStringParameters || {}).d || '';

  // Tokens are 32 hex characters. Anything else is a typo or a probe, and
  // checking the shape first keeps malformed input away from the query.
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return json(404, { error: 'No design found for that link.' });
  }

  try {
    const orders = await store.select(
      'orders?view_token=eq.' + token + '&select=id,ref&limit=1'
    );

    if (!orders.length) {
      return json(404, { error: 'No design found for that link.' });
    }

    const order = orders[0];

    // Newest version wins: what the customer sees is what will be made.
    const versions = await store.select(
      'design_versions?order_id=eq.' + order.id +
      '&select=base_color,canvas&order=version.desc&limit=1'
    );

    if (!versions.length) {
      return json(404, { error: 'That order has no design attached.' });
    }

    return json(200, {
      ref: order.ref,
      baseColor: versions[0].base_color,
      canvas: versions[0].canvas
    });
  } catch (err) {
    console.error('Loading a design failed:', err);
    return json(500, { error: 'We could not load that design right now.' });
  }
};
