// fixture-palette, the sound case: the template's audio.js on a FIXED timeline (this TL does not follow the style's
// stagger, as the template's scene does), so two looks with the same motion flags (sweep, glitch) give different
// effects only through the style's sound: its wave, pitch, brightness and reverb (test/looks.test.mjs).
import { bgConfig } from './looks.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 3.0, FONTS: [] };
export const TL = { words: 3, wordsIn: 0.22, stagger: 0.07, hits: [0.4, 0.47, 0.54], barIn: 0.55, sweep: 1.35, out: 2.45, outStagger: 0.04 };

let ctx, ST;
export async function init({ ctx: c, style }) { ctx = c; ST = style; }

export function frame(t, jit) {
  ctx.fillStyle = ST.tokens.accent; ctx.fillRect(100 + 200 * t, 900, 200, 200);
  return { t, jit, use2D: true, ...bgConfig(ST), cam: [1, 0, 0, 0] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
