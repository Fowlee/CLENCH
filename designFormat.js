/* The shape of a design, shared by everything that draws one.
 *
 * The designer, the customer's view link and the dashboard all rebuild the same
 * artwork, so the canvas size and the font list have to agree exactly. Kept in
 * one place because a mismatch is silent: text would simply render in the wrong
 * face, or the artwork would land stretched on the guard.
 */

/* Matches the model's front face once it's squared up to the camera
 * (0.97 wide x 0.34 tall = 2.87:1) so nothing stretches when it maps on.
 * Bigger numbers = crisper text, more GPU upload. */
export const TEXTURE_WIDTH = 1024;
export const TEXTURE_HEIGHT = 357;

/* Fonts offered in the text tool. `family` must match what the CSS actually
 * loads — Poppins comes from base.css, the rest from the Google Fonts link in
 * the page. Add a font here and in every page's <link> or it silently falls
 * back to the browser default. */
export const FONTS = [
    { label: 'Poppins',       family: 'PoppinsBold' },
    { label: 'Anton',         family: 'Anton' },
    { label: 'Bebas Neue',    family: 'Bebas Neue' },
    { label: 'Oswald',        family: 'Oswald' },
    { label: 'Montserrat',    family: 'Montserrat' },
    { label: 'Bangers',       family: 'Bangers' },
    { label: 'Marker',        family: 'Permanent Marker' }
];

/* Fabric rasterises text the instant it draws it, so if the font hasn't
 * downloaded yet the fallback gets baked into the texture and stays there until
 * something forces a redraw. Waiting here avoids that. */
export function loadFont(family) {
    if (!document.fonts) return Promise.resolve();
    return document.fonts.load('64px "' + family + '"').catch(() => {});
}

// Everything the text tool can produce, ready before a saved design is drawn.
export function allFontsReady() {
    return Promise.all(FONTS.map((font) => loadFont(font.family)));
}
