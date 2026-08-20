import { MouthguardDesigner } from './mouthguardDesigner.js';
import { TEXTURE_WIDTH, TEXTURE_HEIGHT, FONTS, loadFont, allFontsReady } from './designFormat.js';

const designer = new MouthguardDesigner(document.querySelector('#designer'));

const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');

tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        const tool = tab.dataset.tool

        tabs.forEach((t) => t.classList.remove('active'));
        panels.forEach((p) => p.classList.remove('active'))

        tab.classList.add('active')

        const panel = document.querySelector(`.panel[data-tool="${tool}"]`);
        panel.classList.add('active');

        /* Re-fit on every tab, not just one. Switching panels changes the
         * toolmenu's height, which can add or remove its scrollbar and so
         * change the width the canvas has to fill. Sizing only on the text tab
         * left the canvas stale on the other two. */
        fitCanvasToPanel();

        /* Repaint now, synchronously.
         *
         * requestRenderAll() only queues a repaint for the next animation
         * frame, and paintTexture() runs toCanvasElement() on every render,
         * which calls Fabric's cancelRequestedRender() internally — so a queued
         * repaint can be thrown away before it happens. The canvas then holds
         * whatever it last drew until some other event forces a render, which
         * looks exactly like the design vanishing until you click it.
         *
         * renderAll() draws immediately and can't be cancelled. */
        artCanvas.renderAll();

        // Swing the guard back to the front, so the customer can see the area
        // they're about to design on however they'd rotated it.
        if (tool === 'text' || tool === 'image') designer.focusFront();
    })
})

const swatches = document.querySelectorAll('.swatch');
const artStage = document.querySelector('.art-stage');

/* Start on a dark guard. The model's own material is near-white, and text
 * defaults to white, so a fresh designer would show an invisible design. */
const DEFAULT_COLOR = '#000000';

/* The guard's colour is a three.js material property, not something Fabric
 * knows about, so it has to be tracked here and saved beside the canvas. */
let currentColor = DEFAULT_COLOR;

function selectColor(hex) {
    currentColor = hex;
    designer.setColor(hex);

    /* The 2D canvas sits on the guard's own colour, so what the customer draws
     * looks the way it will look on the finished guard. A fixed backdrop lies:
     * white text on a light background reads as invisible here while rendering
     * perfectly on a black guard, and the customer "fixes" something that was
     * never broken. */
    if (artStage) artStage.style.setProperty('--stage-bg', hex);

    swatches.forEach((swatch) => {
        swatch.classList.toggle('selected', swatch.dataset.color === hex);
    });
}

swatches.forEach((swatch) => {
    swatch.style.backgroundColor = swatch.dataset.color;
    swatch.addEventListener('click', () => selectColor(swatch.dataset.color));
})

selectColor(DEFAULT_COLOR);

/* ===== TEXT TOOL =====
 *
 * One Fabric canvas is the single source of truth for the design: three.js
 * wears it as a texture on the guard, and the same canvas exports as the flat
 * print file the workshop needs. Design once, two outputs.
 */

/* How big a resize handle should be on screen, in real screen pixels. The touch
 * figure is the usual minimum for something a thumb has to hit.
 *
 * Declared up here on purpose: fitCanvasToPanel() runs during setup below and
 * reaches scaleHandles(), which reads these. `const` isn't hoisted, so leaving
 * them further down put them in the temporal dead zone and threw. */
const HANDLE_SCREEN_PX = 16;
const HANDLE_SCREEN_PX_TOUCH = 24;

/* The invisible grab area is what actually needs to be thumb-sized. Drawing the
 * circles that big buries the design underneath them, so the visible handle
 * stays modest and only the hit region grows. */
const HANDLE_GRAB_PX_TOUCH = 44;

/* Selection styling, set before any object exists so everything inherits it.
 *
 * Fabric's defaults are a pale blue border with small square corners — close to
 * invisible on a pale guard, and far too small to grab with a thumb. These are
 * chosen to read against any guard colour: white corners outlined in near-black
 * show on both, and touchCornerSize gives phones a target worth aiming at
 * without making the desktop handles clumsy. */
fabric.Object.prototype.set({
    borderColor: '#ff2a39',
    borderScaleFactor: 2,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#111111',
    cornerStyle: 'circle',
    transparentCorners: false,
    // Starting values only — scaleHandles() recomputes these from the canvas's
    // displayed size as soon as it's laid out, and on every resize after.
    cornerSize: 14,
    touchCornerSize: 34,
    padding: 6
});

const artCanvas = new fabric.Canvas('art-canvas', {
    // Transparent, so the guard's colour shows through everywhere the customer
    // hasn't drawn. The transparent edge is also what hides artwork on the back.
    backgroundColor: null,
    preserveObjectStacking: true
});

// Two sizes: the real pixel size (the texture) and the CSS size it's displayed
// at in the panel. Fabric keeps mouse coordinates correct across the two.
artCanvas.setDimensions({ width: TEXTURE_WIDTH, height: TEXTURE_HEIGHT });
fitCanvasToPanel();
window.addEventListener('resize', fitCanvasToPanel);

function fitCanvasToPanel() {
    const stage = document.querySelector('.art-stage');
    const width = stage.clientWidth;
    if (!width) return;

    artCanvas.setDimensions(
        {
            width: width + 'px',
            height: (width * TEXTURE_HEIGHT / TEXTURE_WIDTH) + 'px'
        },
        { cssOnly: true }
    );

    scaleHandles(width);
}

/* Sizes the selection handles against how large the canvas actually appears.
 *
 * Fabric draws controls in canvas coordinates, and this canvas has a 1024px
 * backing store shown at whatever width the panel allows — around 390px on a
 * phone. So a handle set to 14 arrives on screen at roughly 5px, which is why
 * they were impossible to grab. Multiplying by the same factor the browser
 * scales the canvas down by puts them back at the size they were meant to be.
 *
 * Set on the prototype so every object picks it up, including ones already on
 * the canvas — none of them override these. */
function scaleHandles(displayedWidth) {
    const scale = TEXTURE_WIDTH / displayedWidth;

    // A coarse pointer means a finger rather than a mouse.
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const target = coarse ? HANDLE_SCREEN_PX_TOUCH : HANDLE_SCREEN_PX;

    fabric.Object.prototype.cornerSize = Math.round(target * scale);

    // What a finger actually has to land on, independent of the circle's size
    fabric.Object.prototype.touchCornerSize = Math.round(
        (coarse ? HANDLE_GRAB_PX_TOUCH : target) * scale
    );

    // The outline and its gap have to grow by the same factor or they vanish
    fabric.Object.prototype.borderScaleFactor = Math.max(2, Math.round(2 * scale));
    fabric.Object.prototype.padding = Math.round(6 * scale);

    artCanvas.forEachObject(applyControlVisibility);
    artCanvas.renderAll();
}

/* On a touch screen, drop the four mid-edge handles. At thumb size they sit
 * close enough to the corners to be hit by accident, and they're the ones that
 * stretch a logo out of shape — corners scale it evenly.
 *
 * Applied per object rather than once over the canvas, because anything added
 * after the last resize would otherwise keep the full set of handles. */
function applyControlVisibility(object) {
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    object.setControlsVisibility({
        ml: !coarse, mr: !coarse, mt: !coarse, mb: !coarse
    });
}

// Everything new gets the same treatment as everything already on the canvas.
artCanvas.on('object:added', (event) => {
    if (event.target) applyControlVisibility(event.target);
});

/* Fabric's own canvas can't be the texture: it draws selection handles onto it
 * while an object is active, and those would appear on the mouthguard. So we
 * keep a separate canvas and ask Fabric to render just the objects into it.
 *
 * This canvas is also exactly what the workshop needs — the design with no
 * editing UI in it — so the flat print file comes from here too. */
const textureCanvas = document.createElement('canvas');
textureCanvas.width = TEXTURE_WIDTH;
textureCanvas.height = TEXTURE_HEIGHT;
const textureContext = textureCanvas.getContext('2d');

designer.applyCanvasTexture(textureCanvas);

// renderCanvas() fires 'after:render' itself, so without this flag the handler
// below would call itself forever.
let painting = false;

function paintTexture() {
    if (painting) return;
    painting = true;

    // toCanvasElement() is Fabric's export path: objects only, never the
    // selection handles that renderCanvas() would draw in.
    const snapshot = artCanvas.toCanvasElement();

    textureContext.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    textureContext.drawImage(snapshot, 0, 0);

    painting = false;
    designer.refreshTexture();
}

// Fires on every Fabric repaint, including mid-drag, so the 3D preview follows
// live. Repainting a handful of objects twice per frame is cheap.
artCanvas.on('after:render', paintTexture);

/* Everything needed to rebuild this design anywhere, later.
 *
 * The canvas JSON is the source of truth — it alone can regenerate both the 3D
 * preview and the print file. The two PNGs are conveniences: the print file so
 * the workshop never has to run Fabric, and the thumbnail so the dashboard can
 * show a list of orders without loading a 3D scene per row.
 */
function collectDesign() {
    return {
        canvas: artCanvas.toJSON(),
        baseColor: currentColor,
        print: textureCanvas.toDataURL('image/png'),
        thumb: designer.snapshot() || flatThumbnail()
    };
}

/* Stand-in for the 3D snapshot when there's no WebGL to render one — the
 * artwork laid flat on the guard's colour. Not as good as a picture of the
 * guard, but it means every order still arrives with something to look at in
 * the dashboard rather than an empty tile. */
function flatThumbnail() {
    const width = 480;
    const height = Math.round(width * TEXTURE_HEIGHT / TEXTURE_WIDTH);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    context.fillStyle = currentColor;
    context.fillRect(0, 0, width, height);
    context.drawImage(textureCanvas, 0, 0, width, height);

    return canvas.toDataURL('image/png');
}

const textInput = document.querySelector('#text-input');
const textColor = document.querySelector('#text-color');
const textSize = document.querySelector('#text-size');
const fontPicker = document.querySelector('#font-picker');
const fontButton = document.querySelector('#font-picker-button');
const fontCurrent = document.querySelector('#font-picker-current');
const fontList = document.querySelector('#font-picker-list');

let currentFont = FONTS[0].family;

// Pull them all down now so the dropdown previews are right the first time it
// opens, rather than flashing the fallback font.
FONTS.forEach((font) => loadFont(font.family));

FONTS.forEach((font) => {
    const item = document.createElement('li');
    item.className = 'font-picker-option';
    item.textContent = font.label;
    item.dataset.family = font.family;
    item.setAttribute('role', 'option');
    item.style.fontFamily = '"' + font.family + '", sans-serif';

    item.addEventListener('click', () => selectFont(font));
    fontList.appendChild(item);
});

function openFontList(open) {
    fontList.hidden = !open;
    fontButton.setAttribute('aria-expanded', String(open));
}

async function selectFont(font) {
    currentFont = font.family;

    fontCurrent.textContent = font.label;
    // Show the chosen font in the closed button too.
    fontCurrent.style.fontFamily = '"' + font.family + '", sans-serif';

    fontList.querySelectorAll('.font-picker-option').forEach((item) => {
        item.setAttribute('aria-selected', String(item.dataset.family === font.family));
    });

    openFontList(false);

    await loadFont(currentFont);
    updateSelected('fontFamily', currentFont);
}

fontButton.addEventListener('click', () => openFontList(fontList.hidden));

// Close when clicking anywhere else, or on Escape.
document.addEventListener('click', (event) => {
    if (!fontPicker.contains(event.target)) openFontList(false);
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') openFontList(false);
});

selectFont(FONTS[0]);

document.querySelector('#text-add').addEventListener('click', addText);
textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addText();
});

async function addText() {
    const value = textInput.value.trim();
    if (!value) return;

    // Make sure the chosen font is here before Fabric draws with it.
    await loadFont(currentFont);

    // IText is the editable one — double-clicking on the canvas edits in place.
    const text = new fabric.IText(value, {
        left: TEXTURE_WIDTH / 2,
        top: TEXTURE_HEIGHT / 2,
        originX: 'center',
        originY: 'center',
        fill: textColor.value,
        fontFamily: currentFont,
        fontSize: Number(textSize.value),
        textAlign: 'center'
    });

    artCanvas.add(text);
    artCanvas.setActiveObject(text);
    artCanvas.requestRenderAll();
    textInput.value = '';
}

// Colour and size act on whatever is selected.
textColor.addEventListener('input', () => updateSelected('fill', textColor.value));
textSize.addEventListener('input', () => updateSelected('fontSize', Number(textSize.value)));

function updateSelected(property, value) {
    const active = artCanvas.getActiveObject();
    if (!active) return;

    active.set(property, value);
    artCanvas.requestRenderAll();
}

function deleteSelected() {
    artCanvas.getActiveObjects().forEach((object) => artCanvas.remove(object));
    artCanvas.discardActiveObject();
    artCanvas.requestRenderAll();
}

document.querySelector('#text-delete').addEventListener('click', deleteSelected);
document.querySelector('#image-delete').addEventListener('click', deleteSelected);

/* ===== LAYERING =====
 *
 * Without this the only way to put one thing on top of another is to delete it
 * and add it again, because a new object always lands on top. These act on
 * whatever is selected and live under the canvas rather than inside a tool
 * panel, since stacking is about the design as a whole.
 *
 * preserveObjectStacking is already on for the canvas, so selecting something
 * doesn't quietly raise it — the order you see is the order that prints.
 */

const layerControls = document.querySelector('.art-layers');
const layerForward = document.querySelector('#layer-forward');
const layerBack = document.querySelector('#layer-back');
const layerDelete = document.querySelector('#layer-delete');

function withSelection(action) {
    const active = artCanvas.getActiveObject();
    if (!active) return;

    action(active);
    artCanvas.requestRenderAll();
}

layerForward.addEventListener('click', () => withSelection((o) => artCanvas.bringForward(o)));
layerBack.addEventListener('click', () => withSelection((o) => artCanvas.sendBackwards(o)));
layerDelete.addEventListener('click', deleteSelected);

// Nothing selected means nothing to reorder, so say so by dimming the controls.
function updateLayerControls() {
    const has = Boolean(artCanvas.getActiveObject());
    layerControls.classList.toggle('is-idle', !has);
    [layerForward, layerBack, layerDelete].forEach((button) => { button.disabled = !has; });
}

artCanvas.on('selection:created', updateLayerControls);
artCanvas.on('selection:updated', updateLayerControls);
artCanvas.on('selection:cleared', updateLayerControls);
artCanvas.on('object:added', updateLayerControls);
artCanvas.on('object:removed', updateLayerControls);

updateLayerControls();

/* ===== IMAGE TOOL =====
 *
 * Uploads stay in the browser: the file is read locally and drawn straight onto
 * the same Fabric canvas as the text, so it flows into the 3D texture and the
 * print export with no server round trip.
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024;

/* Phone cameras produce images far larger than our texture. Anything bigger
 * than this gets resampled once on upload — otherwise every repaint would
 * scale a 12-megapixel bitmap down, for pixels nobody can see.
 *
 * Matched to TEXTURE_WIDTH: the artwork is drawn into a canvas that wide, so a
 * source image can never be sampled at more than 1024 across however the
 * customer scales it. Anything beyond this is weight with nothing to show. */
const MAX_SOURCE_EDGE = TEXTURE_WIDTH;

/* JPEG quality for photographs. The design travels to the server inside one
 * JSON body, and a 1024px photo as PNG is several megabytes — enough on its own
 * to blow the request limit. At 0.85 the same photo is a couple of hundred KB
 * and no different to look at on a mouthguard. */
const PHOTO_QUALITY = 0.85;

/* Ceiling for the image once it's embedded in the design. The whole booking —
 * design, print file and thumbnail — has to fit in one request, and the server
 * refuses past 5 MB. Leaving the image about 1.5 MB keeps room for the rest. */
const MAX_EMBEDDED_BYTES = 1.5 * 1024 * 1024;

/* Where a freshly added image lands. Kept clear of the V-notch at the top
   centre, so a logo doesn't arrive already clipped by it. */
const IMAGE_START_WIDTH = TEXTURE_WIDTH * 0.3;
const IMAGE_START_HEIGHT = TEXTURE_HEIGHT * 0.5;
const IMAGE_START_CENTRE_Y = TEXTURE_HEIGHT * 0.62;

const imageInput = document.querySelector('#image-input');
const imageStatus = document.querySelector('#image-status');

function setImageStatus(message, isError) {
    imageStatus.textContent = message || '';
    imageStatus.className = 'art-status' + (isError ? ' is-error' : '');
}

imageInput.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];

    // Clear immediately so picking the same file twice still fires a change.
    imageInput.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        setImageStatus('That file isn\'t an image.', true);
        return;
    }

    if (file.size > MAX_FILE_BYTES) {
        const size = (file.size / 1024 / 1024).toFixed(1);
        setImageStatus('That image is ' + size + ' MB — the limit is 8 MB.', true);
        return;
    }

    setImageStatus('Adding image…');

    const reader = new FileReader();
    reader.onload = () => addImage(reader.result, file.name);
    reader.onerror = () => setImageStatus('Couldn\'t read that file.', true);
    reader.readAsDataURL(file);
});

/* Resamples an oversized bitmap down to MAX_SOURCE_EDGE and re-encodes it,
 * returning a data URL to build the Fabric image from.
 *
 * The re-encoding is the important half. Whatever goes on the canvas is
 * embedded in the saved design as a data URL, and Fabric serialises a canvas
 * element as PNG — so a photograph would travel losslessly at several megabytes
 * and the booking would be rejected before it left the browser. A logo with
 * transparency still has to be PNG; anything opaque becomes a JPEG.
 */
function normalise(element) {
    let edge = MAX_SOURCE_EDGE;

    /* Transparent artwork has to stay PNG — JPEG has no alpha channel, so a
     * logo would come back with a black box behind it. PNG can't be quality-
     * tuned, so the only lever left is size: shrink and try again until it
     * fits. Two extra passes take it to roughly half width, which is still
     * more than the guard can show.
     *
     * Opaque images never loop — the first JPEG pass is already tiny. */
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = encode(element, edge);
        if (result.length <= MAX_EMBEDDED_BYTES || !result.startsWith('data:image/png')) {
            return result;
        }
        edge = Math.round(edge * 0.7);
    }

    return encode(element, edge);
}

// One resample-and-encode pass at the given longest edge.
function encode(element, edge) {
    const longest = Math.max(element.width, element.height);
    const ratio = Math.min(1, edge / longest);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(element.width * ratio));
    canvas.height = Math.max(1, Math.round(element.height * ratio));

    const context = canvas.getContext('2d');
    context.drawImage(element, 0, 0, canvas.width, canvas.height);

    if (hasTransparency(context, canvas)) return canvas.toDataURL('image/png');

    /* JPEG has no alpha channel, so anything transparent would come back black.
     * Only opaque images reach this line. */
    return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
}

/* One pass over the alpha channel. Costs a few milliseconds once, on upload,
 * and decides whether the image can afford to be a JPEG. */
function hasTransparency(context, canvas) {
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true;
    }

    return false;
}

function addImage(dataUrl, name) {
    fabric.Image.fromURL(dataUrl, (image) => {
        if (!image || !image.width || !image.height) {
            setImageStatus('That image couldn\'t be loaded.', true);
            return;
        }

        /* Rebuild the image from the normalised copy rather than swapping the
         * element underneath it. Fabric reads its size from the element it was
         * constructed with, and a data URL is what ends up in the saved design. */
        fabric.Image.fromURL(normalise(image.getElement()), (compact) => {
            placeImage(compact, name);
        });
    });
}

function placeImage(image, name) {
    // Start it at a sensible size: never wider or taller than the space below
    // the notch. The customer can scale it up from there.
    const scale = Math.min(
        IMAGE_START_WIDTH / image.width,
        IMAGE_START_HEIGHT / image.height
    );

    image.set({
        left: TEXTURE_WIDTH / 2,
        top: IMAGE_START_CENTRE_Y,
        originX: 'center',
        originY: 'center',
        scaleX: scale,
        scaleY: scale
    });

    artCanvas.add(image);
    artCanvas.setActiveObject(image);
    artCanvas.requestRenderAll();

    setImageStatus('Added ' + name + '. Drag to move, corners to resize.');
}

/* Web fonts load after this script runs, so text added immediately would render
 * in the fallback font. Once Poppins is ready, redraw with the real one. */
document.fonts.ready.then(() => artCanvas.requestRenderAll());

/* ===== SENDING THE DESIGN ON =====
 *
 * Designing is the first step of ordering, so this button hands the design to
 * the booking form rather than submitting anything. Nothing reaches the server
 * until the customer actually books.
 */

/* Longest we'll wait for the guard to appear before saving a design without
 * its thumbnail. Generous — the model is a few megabytes over a slow link. */
const MODEL_WAIT_LIMIT = 8000;

const continueButton = document.querySelector('#design-continue');
const continueStatus = document.querySelector('#design-continue-status');

function setContinueStatus(message, isError) {
    if (!continueStatus) return;
    continueStatus.textContent = message || '';
    continueStatus.className = 'design-continue-status' + (isError ? ' is-error' : '');
}

if (continueButton) {
    continueButton.addEventListener('click', async () => {
        continueButton.disabled = true;
        setContinueStatus('Saving your design…');

        try {
            /* The thumbnail is a render of the guard, so the model has to exist
             * before it can be taken. Clicking straight through on a slow
             * connection would otherwise save a design with no picture, and the
             * dashboard would list it as a blank tile.
             *
             * Capped, because a model that never loads must not block an order —
             * the design itself is complete without the thumbnail. */
            await Promise.race([
                designer.ready,
                new Promise((resolve) => setTimeout(resolve, MODEL_WAIT_LIMIT))
            ]);

            await window.ClenchDesign.save(collectDesign());
            window.location.href = 'order.html';
        } catch (error) {
            console.error('Could not hand the design over:', error);
            continueButton.disabled = false;
            setContinueStatus(
                'This browser won\'t hold a design that size. Try a smaller image on ' +
                'the guard, or open the designer in a normal (not private) window.',
                true
            );
        }
    });
}

/* ===== VIEW MODE =====
 *
 * The link in the customer's confirmation email. Same page, same 3D guard, but
 * the tools are gone and nothing can be changed — this is a record of what was
 * ordered, not a second chance to edit it.
 *
 * The token in the URL is the whole permission: whoever holds the link sees the
 * design and nothing else about the order. Nothing identifying is shown here.
 */

const viewToken = new URLSearchParams(window.location.search).get('d');

/* Puts a saved design back on the canvas — the guard's colour first, then the
 * artwork. Shared by the two ways a design arrives already made: the customer's
 * view link, and the customer returning from the booking form to change
 * something. Objects stay editable; view mode locks them afterwards. */
async function applyDesign(design) {
    selectColor(design.baseColor || DEFAULT_COLOR);

    // Fabric bakes the font in as it draws, so a face that hasn't arrived yet
    // would be permanently wrong on the guard.
    await allFontsReady();

    await new Promise((resolve) => artCanvas.loadFromJSON(design.canvas, resolve));

    artCanvas.renderAll();
}

async function showSavedDesign(design) {
    await applyDesign(design);

    // Look, don't touch: no selection handles, no dragging.
    artCanvas.selection = false;
    artCanvas.forEachObject((object) => {
        object.selectable = false;
        object.evented = false;
    });

    artCanvas.renderAll();
    designer.lockToViewing();
}

if (viewToken) {
    document.body.classList.add('is-viewing');

    const title = document.querySelector('#view-title');
    const note = document.querySelector('#view-note');

    fetch('/.netlify/functions/design?d=' + encodeURIComponent(viewToken))
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) throw new Error(data.error || 'Could not load that design');

            if (title) title.textContent = 'Your design';
            if (note) {
                note.textContent = data.ref
                    ? 'Order ' + data.ref + '. Drag to turn the guard around.'
                    : 'Drag to turn the guard around.';
            }

            return showSavedDesign(data);
        })
        .catch((error) => {
            console.error('Loading the saved design failed:', error);
            if (title) title.textContent = 'We couldn\'t find that design';
            if (note) {
                note.textContent = 'The link may be incomplete. Reply to your ' +
                    'confirmation email and we\'ll send it again.';
            }
        });
} else {
    /* "Change the design" on the booking form comes back here. The design is
     * still in browser storage — it's only cleared once a booking is actually
     * sent — so put it back rather than making them start over.
     *
     * Silent by design: the work simply being there is what's expected. */
    window.ClenchDesign.load()
        .then((saved) => {
            if (saved && saved.canvas) return applyDesign(saved);
        })
        .catch((error) => console.error('Could not restore the design:', error));
}
