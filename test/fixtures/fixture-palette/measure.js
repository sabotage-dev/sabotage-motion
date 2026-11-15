// fixture-palette, the negative fonts_used case: it sets ctx.font to the display and body roles only to MEASURE (in
// init and in every frame, as a layout pass would), and draws every word with MONO, by fillText and strokeText. Its
// render record's fonts_used must hold MONO alone.
import { bgConfig, fontStr } from './looks.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 1.0, FONTS: ['MONO'] };
export const TL = {};
export const silent = true;

let ctx, ST, W0 = 0;
export async function init({ ctx: c, style }) {
  ctx = c; ST = style;
  ctx.font = fontStr(ST, 'display', 150); W0 = ctx.measureText('Measured, not drawn').width;
  ctx.font = fontStr(ST, 'body', 64); W0 += ctx.measureText('Measured, not drawn').width;
}

export function frame(t, jit) {
  const c = ctx;
  c.save(); c.font = fontStr(ST, 'display', 150); const w = c.measureText('layout only').width; c.restore();
  c.font = '72px MONO'; c.fillStyle = ST.tokens.ink; c.textAlign = 'center';
  c.fillText(`width ${Math.round(w + W0)}`, 540, 800 + 200 * t);
  c.lineWidth = 3; c.strokeStyle = ST.tokens.accent; c.strokeText('mono only', 540, 1100);
  return { t, jit, use2D: true, ...bgConfig(ST), cam: [1, 0, 0, 0] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
