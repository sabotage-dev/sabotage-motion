// fixture-palette: a 2 s, 1080x1920 card drawn only in the piece's style (looks.js), for the brand-kit tests
// (test/looks.test.mjs). The background is the style's shader in its bgA and bgB, the title is STROKED in the display
// role, the line under it FILLED in the body role, and an accent disc grows in, so with the fixture kit in the piece
// the colour match passes, and fonts_used holds the display and body families (one from strokeText, one from fillText).
import { prog, snap, rgba } from './lib.js';
import { bgConfig, fontStr } from './looks.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 2.0, FONTS: [] };
export const TL = { words: 0, hits: [], wordsIn: 0.1, stagger: 0.05, barIn: 0.4, sweep: 0.8, out: 1.7, outStagger: 0.04 };
export const silent = true;

let ctx, ST, ALPHA = false, P;
export async function init({ ctx: c, style, params, alpha }) {
  ctx = c; ST = style; ALPHA = alpha;
  P = { title: params.title || 'Fixture', sub: params.sub || 'drawn in the style', grain: params.grain != null ? +params.grain : 0.03 };
}

export function frame(t, jit) {
  const c = ctx, T = ST.tokens;
  // the accent disc grows in and breathes
  const r = 170 * (0.6 + 0.4 * snap(prog(t, 0, 0.3))) * (1 + 0.03 * Math.sin(t * 6));
  c.fillStyle = T.accent; c.beginPath(); c.arc(540, 1250, r, 0, Math.PI * 2); c.fill();
  // accent2 rule, moving
  c.fillStyle = T.accent2; c.fillRect(160 + 300 * prog(t, 0, 2), 900, 220, 14);
  // the title, stroked only, in the display role
  c.textAlign = 'center'; c.lineJoin = 'round';
  c.font = fontStr(ST, 'display', 150); c.lineWidth = 7; c.strokeStyle = T.ink;
  c.strokeText(P.title, 540, 720);
  // the line under it, filled, in the body role
  c.font = fontStr(ST, 'body', 64); c.fillStyle = rgba(T.muted, 1);
  c.fillText(P.sub, 540, 830);
  return { t, jit, use2D: true, ...bgConfig(ST, { alpha: ALPHA }), cam: [1 + 0.02 * prog(t, 0, CFG.DUR), 0, 0, 0] };
}

export function post(t) {
  return { t, bloom: 0.1, thr: 0.8, ca: 0, glitch: 0, grain: P.grain, vig: 0.1, flash: 0, fade: 1, hud: 0 };   // --param grain: the colour probe turns it off
}
