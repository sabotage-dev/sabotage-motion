// GRID SCENE: a labelled measuring grid at a target's size, an optional aid for safe zones. The method in
// safezones.json (plan Q3) measures from screenshots of videos already posted; a grid helps read positions off
// such a screenshot, or measure a platform you have not posted to yet:
//   node render.mjs full --scene grid.js --target tiktok --out out/grid-tiktok.mp4
// Lines every 10 px (longer every 50 px, labelled every 100 px) run in from all four edges, the labels repeat
// across the frame so some survive whatever the app covers, and the target's current safe rectangle is drawn
// in yellow for comparison. A frame counter keeps the picture from being still. Silent.
import { clamp } from './lib.js';

export const CFG = { DUR: 6, FPS: 30, FONTS: ['MONO'] };
export const TL = {};
export const silent = true;

let ctx, SAFE = null, NAME = '';
export async function init({ ctx: c, target }) {
  ctx = c;
  if (!target) throw new Error('grid.js needs --target <name>: it draws at that target\'s size');
  SAFE = target.safe; NAME = target.name;
}

export function frame(t, jit) {
  const c = ctx, W = CFG.W, H = CFG.H;
  c.fillStyle = '#101418'; c.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 100) { c.fillStyle = (y / 100) % 2 ? '#141A20' : '#101418'; c.fillRect(0, y, W, 100); }
  // the 100 px grid across the whole frame
  c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 2;
  for (let x = 100; x < W; x += 100) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 100; y < H; y += 100) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  // rulers in from each edge: a tick every 10 px, longer every 50 and 100
  c.fillStyle = '#E8E6E0';
  const tick = (i) => (i % 100 === 0 ? 60 : i % 50 === 0 ? 36 : 18);
  for (let x = 0; x <= W; x += 10) { const L = tick(x); c.fillRect(x - 1, 0, 2, L); c.fillRect(x - 1, H - L, 2, L); }
  for (let y = 0; y <= H; y += 10) { const L = tick(y); c.fillRect(0, y - 1, L, 2); c.fillRect(W - L, y - 1, L, 2); }
  // labels: y values down several columns, x values across several rows
  c.font = '26px MONO'; c.textBaseline = 'middle'; c.fillStyle = '#9AD1FF';
  for (let y = 100; y < H; y += 100) for (const x of [70, Math.round(W * 0.33), Math.round(W * 0.62), W - 150]) { c.textAlign = 'left'; c.fillText(`y${y}`, x, y - 16); }
  c.fillStyle = '#FFB37A';
  const rows = [0.08, 0.3, 0.55, 0.8, 0.95].map((k) => Math.floor((H * k) / 100) * 100 + 50);   // between the y labels
  for (let x = 100; x < W; x += 100) for (const y of rows) { c.textAlign = 'center'; c.fillText(`x${x}`, x, y); }
  // the target's current safe rectangle, for comparison with what the app shows
  if (SAFE) { c.strokeStyle = 'rgba(255,214,0,0.9)'; c.lineWidth = 4; c.strokeRect(SAFE.x, SAFE.y, SAFE.w, SAFE.h); }
  c.font = '34px MONO'; c.textAlign = 'center'; c.fillStyle = '#FFD600';
  const f = Math.floor(t * CFG.FPS + 1e-6);
  c.fillText(`${NAME} ${W}x${H}  frame ${String(f).padStart(3, '0')}`, W / 2, H / 2);
  c.fillRect(W / 2 - 150 + 300 * clamp((t % 2) / 2), H / 2 + 40, 6, 24);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.06, 0.08, 0.09] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
