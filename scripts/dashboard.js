/* ===== ORDERS DASHBOARD =====
 *
 * CLENCH's own view of incoming orders: search for a customer, look at the
 * guard they designed, print it, and move it along as it's made.
 *
 * Deliberately a separate page from the designer. It's a different tool for a
 * different person, and keeping them apart means a change to the customer's
 * designer can't quietly break this. The one thing shared is the engine —
 * MouthguardDesigner — so the guard here is the guard they designed.
 *
 * Every request needs the session cookie set by /.netlify/functions/admin.
 */

import { MouthguardDesigner } from '../mouthguardDesigner.js';
import { TEXTURE_WIDTH, TEXTURE_HEIGHT, allFontsReady } from '../designFormat.js';

const ADMIN_ENDPOINT = '/.netlify/functions/admin';
const ORDERS_ENDPOINT = '/.netlify/functions/orders';

// Long enough that typing an email doesn't fire a request per keystroke.
const SEARCH_DEBOUNCE = 250;

const STATUS_LABELS = {
  new: 'New',
  impression: 'Impression taken',
  printed: 'Printed',
  delivered: 'Delivered'
};

const el = id => document.getElementById(id);

const signinView = el('signin');
const appView = el('app');
const listView = el('view-list');
const detailView = el('view-detail');

// The order currently open, so printing knows what it's printing.
let openOrder = null;

/* ----- session ----- */

async function start() {
  try {
    const response = await fetch(ADMIN_ENDPOINT);
    const { signedIn } = await response.json();

    if (signedIn) showApp();
    else showSignIn();
  } catch (error) {
    console.error('Could not reach the dashboard:', error);
    showSignIn();
  }
}

function showSignIn() {
  signinView.hidden = false;
  appView.hidden = true;
  el('password').focus();
}

function showApp() {
  signinView.hidden = true;
  appView.hidden = false;

  /* The booking email links straight to one order. Load the list underneath it
     anyway, so closing the order lands somewhere useful rather than empty. */
  const wanted = new URLSearchParams(window.location.search).get('order');

  loadOrders('');
  if (wanted) showOrder(wanted);
}

el('signin-form').addEventListener('submit', async event => {
  event.preventDefault();

  const button = el('signin-submit');
  const error = el('signin-error');

  button.disabled = true;
  error.textContent = '';

  try {
    const response = await fetch(ADMIN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: el('password').value })
    });

    const data = await response.json();

    if (!response.ok) {
      error.textContent = data.error || 'That didn\'t work.';
      button.disabled = false;
      el('password').select();
      return;
    }

    el('password').value = '';
    showApp();
  } catch (err) {
    console.error('Sign in failed:', err);
    error.textContent = 'Couldn\'t reach the server. Check your connection.';
  } finally {
    button.disabled = false;
  }
});

el('signout').addEventListener('click', async () => {
  await fetch(ADMIN_ENDPOINT, { method: 'DELETE' }).catch(() => {});
  window.location.reload();
});

/* ----- the list ----- */

const searchInput = el('search');
let searchTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadOrders(searchInput.value.trim()), SEARCH_DEBOUNCE);
});

async function loadOrders(query) {
  const note = el('search-note');
  note.textContent = query ? 'Searching…' : 'Most recent orders';

  try {
    const response = await fetch(ORDERS_ENDPOINT + '?q=' + encodeURIComponent(query));

    // The cookie expired while the tab sat open
    if (response.status === 401) return showSignIn();

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    renderOrders(data.orders);

    note.textContent = query
      ? data.orders.length + (data.orders.length === 1 ? ' match' : ' matches')
      : 'Most recent orders';
  } catch (error) {
    console.error('Loading orders failed:', error);
    note.textContent = 'Couldn\'t load orders.';
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('nb-NO', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function renderOrders(orders) {
  const list = el('orders');
  list.textContent = '';

  el('empty').hidden = orders.length > 0;

  orders.forEach(order => {
    const item = document.createElement('li');
    item.className = 'order';

    /* A button, not a div with a click handler: the whole row is one action,
       and this way it's reachable by keyboard for free. */
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'order-row';
    button.addEventListener('click', () => showOrder(order.ref));

    const thumb = document.createElement('img');
    thumb.className = 'order-thumb';
    thumb.alt = '';
    if (order.thumb) thumb.src = order.thumb;

    const body = document.createElement('div');
    body.className = 'order-body';
    body.innerHTML =
      '<p class="order-name"></p>' +
      '<p class="order-contact"></p>' +
      '<p class="order-sport"></p>';

    // Customer-supplied text, so it's set as text and never parsed as markup
    body.querySelector('.order-name').textContent = order.name;
    body.querySelector('.order-contact').textContent = order.email + ' · ' + order.phone;
    body.querySelector('.order-sport').textContent =
      order.club ? order.sport + ' · ' + order.club : order.sport;

    const meta = document.createElement('div');
    meta.className = 'order-meta';

    const status = document.createElement('span');
    status.className = 'chip chip-' + order.status;
    status.textContent = STATUS_LABELS[order.status] || order.status;

    const when = document.createElement('p');
    when.className = 'order-when';
    when.textContent = order.ref + ' · ' + formatDate(order.createdAt);

    meta.append(status, when);
    button.append(thumb, body, meta);
    item.append(button);
    list.append(item);
  });
}

/* ----- one order ----- */

el('back').addEventListener('click', () => {
  detailView.hidden = true;
  listView.hidden = false;
  openOrder = null;
});

async function showOrder(ref) {
  try {
    const response = await fetch(ORDERS_ENDPOINT + '?ref=' + encodeURIComponent(ref));
    if (response.status === 401) return showSignIn();

    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Not found');

    openOrder = data;

    listView.hidden = true;
    detailView.hidden = false;
    window.scrollTo(0, 0);

    renderDetail(data);

    /* An order with no design row would otherwise still show the guard from
       whichever order was opened before it. */
    if (data.design) await showDesign(data.design);
    else clearGuard();
  } catch (error) {
    console.error('Opening the order failed:', error);
  }
}

function renderDetail({ order, design, versionCount }) {
  el('detail-ref').textContent = order.ref;
  el('detail-name').textContent = order.name;
  el('detail-when').textContent = 'Ordered ' + formatDate(order.createdAt);

  el('status').value = order.status;
  el('status-note').textContent = '';

  el('customer-link').href = order.viewLink;

  /* Only the fields that were filled in. An empty row tells the client nothing
     and makes the ones that matter harder to find. */
  const facts = [
    ['Email', order.email],
    ['Phone', order.phone],
    ['Sport', order.sport],
    ['Club / team', order.club],
    ['Preferred times', order.availability],
    ['Existing records', order.records],
    ['Braces', order.braces === 'Yes' ? 'Yes' : ''],
    ['Design notes', order.notes],
    ['Message', order.message],
    ['Guard colour', design ? design.baseColor : ''],
    ['Design version', versionCount > 1 ? versionCount + ' (refined)' : 'Original']
  ];

  const list = el('detail-facts');
  list.textContent = '';

  facts.forEach(([label, value]) => {
    if (!value || value === '—') return;

    const term = document.createElement('dt');
    term.textContent = label;

    const detail = document.createElement('dd');
    detail.textContent = value;

    list.append(term, detail);
  });
}

/* ----- the guard -----
 *
 * Built once and reused: loading the .glb takes a moment, and the client moves
 * between orders far more often than he opens the page.
 */

let designer = null;
let artCanvas = null;

function ensureGuard() {
  if (designer) return;

  designer = new MouthguardDesigner(el('guard-stage'));
  designer.lockToViewing();

  /* A StaticCanvas rather than the interactive one the designer uses: nothing
     here is editable, so it never draws selection handles and its own element
     can go straight onto the model as the texture. */
  artCanvas = new fabric.StaticCanvas(null, {
    width: TEXTURE_WIDTH,
    height: TEXTURE_HEIGHT,
    backgroundColor: null
  });

  designer.applyCanvasTexture(artCanvas.lowerCanvasEl);
}

// Nothing to show: blank the artwork rather than leaving a stale design up.
function clearGuard() {
  if (!artCanvas) return;

  artCanvas.clear();
  artCanvas.renderAll();
  designer.refreshTexture();
}

async function showDesign(design) {
  ensureGuard();

  designer.setColor(design.baseColor);

  // Fabric bakes the font in as it draws, so a face that hasn't arrived yet
  // would be permanently wrong on the guard.
  await allFontsReady();

  await new Promise(resolve => artCanvas.loadFromJSON(design.canvas, resolve));

  artCanvas.renderAll();
  designer.refreshTexture();
}

/* ----- status ----- */

el('status').addEventListener('change', async event => {
  if (!openOrder) return;

  const status = event.target.value;
  const note = el('status-note');
  note.textContent = 'Saving…';

  try {
    const response = await fetch(ORDERS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: openOrder.order.ref, status })
    });

    if (response.status === 401) return showSignIn();

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    openOrder.order.status = status;
    note.textContent = 'Saved.';
  } catch (error) {
    console.error('Saving the status failed:', error);
    note.textContent = 'Couldn\'t save that. Try again.';
  }
});

/* ----- printing -----
 *
 * The sheet the workshop works from. It shows the design the way the designer
 * shows it: the artwork sitting inside the guard's printable front, on the
 * guard's own colour, with the outline and the V-notch as a trim guide.
 *
 * The shape comes from images/print-zone.svg rather than being copied here, so
 * changing the guide in the designer changes the sheet too. It's fetched once
 * and kept, because the print window has to open synchronously inside the click
 * or the pop-up blocker swallows it.
 */

/* How wide the printable front actually is on a finished guard. The sheet is
 * printed at this size so artwork can be checked against the real thing.
 * MEASURE A REAL GUARD AND CORRECT THIS — everything else on the sheet scales
 * from it, and the aspect (1024:357) is fixed by the texture. */
const PRINT_ZONE_MM = 70;

let zonePath = null;

fetch('/images/print-zone.svg')
  .then(response => response.text())
  .then(svg => {
    const match = /<path[^>]*\sd="([^"]+)"/.exec(svg);
    if (match) zonePath = match[1];
  })
  .catch(error => console.error('Could not load the print zone outline:', error));

el('print').addEventListener('click', () => {
  if (!openOrder || !openOrder.design || !openOrder.design.print) return;

  const { order, design } = openOrder;

  // Opened synchronously inside the click, or the pop-up blocker eats it
  const sheet = window.open('', '_blank');
  if (!sheet) return;

  const height = (PRINT_ZONE_MM * TEXTURE_HEIGHT / TEXTURE_WIDTH).toFixed(1);

  /* One SVG, three layers: the guard's colour in the shape of its front, the
     artwork on top, then the outline drawn over both so it stays visible
     against dark artwork. */
  const artwork = zonePath
    ? '<svg class="zone" viewBox="0 0 ' + TEXTURE_WIDTH + ' ' + TEXTURE_HEIGHT + '" ' +
          'xmlns="http://www.w3.org/2000/svg">' +
        '<path d="' + zonePath + '" fill="' + escapeHtml(design.baseColor) + '"/>' +
        '<image href="' + escapeHtml(design.print) + '" x="0" y="0" ' +
               'width="' + TEXTURE_WIDTH + '" height="' + TEXTURE_HEIGHT + '"/>' +
        /* Two strokes, because one can't work on every guard. A dark dash
           vanishes on a black guard and a light one vanishes on white, so a
           white halo goes underneath and the dark dash sits on top of it. */
        '<path d="' + zonePath + '" fill="none" stroke="#ffffff" stroke-width="6"/>' +
        '<path d="' + zonePath + '" fill="none" stroke="#111111" stroke-width="2.5" ' +
              'stroke-dasharray="10 8"/>' +
      '</svg>'
    // The outline failed to load; the artwork alone is still worth printing
    : '<img class="zone" src="' + escapeHtml(design.print) + '" alt="">';

  sheet.document.write(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<title>' + escapeHtml(order.ref) + ' – ' + escapeHtml(order.name) + '</title>' +
    '<style>' +
    'body{margin:0;padding:20mm 18mm;font:13px Arial,sans-serif;color:#111}' +
    'h1{margin:0 0 1mm;font-size:19px;letter-spacing:0.06em}' +
    '.meta{margin:0 0 1mm;color:#555}' +
    '.swatch{display:inline-block;width:11px;height:11px;border:1px solid #999;' +
      'vertical-align:-1px;margin-right:5px}' +
    // Sized in millimetres so the sheet comes off the printer life-size
    '.zone{display:block;margin-top:12mm;width:' + PRINT_ZONE_MM + 'mm;' +
      'height:' + height + 'mm}' +
    '.scale{margin-top:4mm;font-size:10px;color:#777}' +
    '@page{size:A4 portrait;margin:0}' +
    '</style></head><body>' +
    '<h1>' + escapeHtml(order.ref) + '</h1>' +
    '<p class="meta">' + escapeHtml(order.name) + ' · ' + escapeHtml(order.sport) +
      (order.club ? ' · ' + escapeHtml(order.club) : '') + '</p>' +
    '<p class="meta"><span class="swatch" style="background:' +
      escapeHtml(design.baseColor) + '"></span>' + escapeHtml(design.baseColor) +
      ' · design v' + design.version + '</p>' +
    '<p class="meta">Ordered ' + escapeHtml(formatDate(order.createdAt)) + '</p>' +
    artwork +
    '<p class="scale">Printed at ' + PRINT_ZONE_MM + ' mm wide — actual size. ' +
      'Dashed line is the edge of the printable front.</p>' +
    '</body></html>'
  );
  sheet.document.close();

  /* Wait for the artwork to arrive before the print dialog measures the page.
     The SVG route has no load event of its own, so give the image inside it a
     moment; the <img> fallback has one. */
  /* Print once the artwork has arrived — and only once. On the normal path the
     artwork is an SVG <image>, which has no .complete, so matching on 'img'
     alone found nothing and both the fallback timer and the load handler fired
     a dialog. The timer stays as a backstop for a URL that never loads. */
  let printed = false;

  function printOnce() {
    if (printed || sheet.closed) return;
    printed = true;
    sheet.print();
  }

  const artworkNode = sheet.document.querySelector('img, image');

  if (artworkNode && artworkNode.complete) printOnce();
  else if (artworkNode) artworkNode.addEventListener('load', printOnce);

  // Belongs to the new window, so closing it cancels the timer with it
  sheet.setTimeout(printOnce, 3000);
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

start();

/* ----- data-protection actions -----
 *
 * Articles 15, 17 and 20 give a customer the right to a copy of what's held
 * about them and to have it deleted. Done from here so it actually happens, and
 * so deletion removes the stored files too — the database cascade doesn't reach
 * the bucket, and artwork left behind after an erasure request is exactly the
 * kind of thing that makes the request meaningless.
 */

const eraseButton = el('erase');
const eraseNote = el('erase-note');

// Deleting a customer is not undoable, so it takes two deliberate clicks.
let erasePrimed = false;

function resetErase() {
  erasePrimed = false;
  eraseButton.textContent = 'DELETE THIS ORDER';
  eraseButton.classList.remove('is-armed');
}

eraseButton.addEventListener('click', async () => {
  if (!openOrder) return;

  if (!erasePrimed) {
    erasePrimed = true;
    eraseButton.textContent = 'CLICK AGAIN TO DELETE PERMANENTLY';
    eraseButton.classList.add('is-armed');
    eraseNote.textContent =
      'This removes the customer\'s details, their design and its files. It cannot be undone.';
    return;
  }

  eraseButton.disabled = true;
  eraseNote.textContent = 'Deleting…';

  try {
    const response = await fetch(
      ORDERS_ENDPOINT + '?ref=' + encodeURIComponent(openOrder.order.ref),
      { method: 'DELETE' }
    );

    if (response.status === 401) return showSignIn();

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    // Nothing left to show, so go back to a list that no longer contains it
    detailView.hidden = true;
    listView.hidden = false;
    openOrder = null;
    loadOrders(searchInput.value.trim());
  } catch (error) {
    console.error('Erasing the order failed:', error);
    eraseNote.textContent = 'Couldn\'t delete that. Try again.';
  } finally {
    eraseButton.disabled = false;
    resetErase();
  }
});

/* A copy of everything held about one order, for a subject access request.
 * Downloaded as JSON rather than shown, so it can be sent on as it is. */
el('export').addEventListener('click', async () => {
  if (!openOrder) return;

  const reference = openOrder.order.ref;
  eraseNote.textContent = 'Preparing the export…';

  try {
    const response = await fetch(
      ORDERS_ENDPOINT + '?ref=' + encodeURIComponent(reference) + '&export=1'
    );

    if (response.status === 401) return showSignIn();

    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Export failed');

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = reference + '-data.json';
    link.click();

    URL.revokeObjectURL(url);
    eraseNote.textContent = 'Exported ' + reference + '-data.json';
  } catch (error) {
    console.error('Exporting the order failed:', error);
    eraseNote.textContent = 'Couldn\'t build that export.';
  }
});
