/* ===== THE GUARD PALETTE =====
 *
 * Every colour a guard can be made in, in the order they appear in the designer.
 *
 * One list, used by the designer to draw its swatches and by the dashboard to
 * list what can be switched on and off. It used to be eighteen <div>s written
 * into designer.html, which meant the dashboard would have had to repeat them
 * and the two would have drifted the first time a colour changed.
 *
 * Adding a colour is an edit here and nothing else. Removing one permanently is
 * an edit here too — marking it unavailable in the dashboard is the temporary
 * version, for when a material is simply out of stock.
 */
export const PALETTE = [
  { hex: '#ff7f00', name: 'orange' },
  { hex: '#0047ab', name: 'blue' },
  { hex: '#c8102e', name: 'red' },
  { hex: '#2e8b57', name: 'green' },
  { hex: '#c0c0c0', name: 'silver' },
  { hex: '#ff2a2a', name: 'neon red' },
  { hex: '#39ff14', name: 'neon green' },
  { hex: '#ccff00', name: 'neon yellow' },
  { hex: '#ffd700', name: 'yellow' },
  { hex: '#000000', name: 'black' },
  { hex: '#ffffff', name: 'white' },
  { hex: '#ff69b4', name: 'pink' },
  { hex: '#40e0d0', name: 'turquoise' },
  { hex: '#d4af37', name: 'gold' },
  { hex: '#1560bd', name: 'blue opaque' },
  { hex: '#6a0dad', name: 'purple' },
  { hex: '#add8e6', name: 'light blue' },
  { hex: '#5c0a1e', name: 'bordeaux' }
];

// Where the designer and the dashboard both ask what is currently in stock.
export const AVAILABILITY_ENDPOINT = '/.netlify/functions/colours';

export function nameFor(hex) {
  const found = PALETTE.find(colour => colour.hex === String(hex).toLowerCase());
  return found ? found.name : hex;
}
