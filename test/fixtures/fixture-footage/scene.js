// fixture-footage: draws the sequence "clip" (cut by tools/frames.mjs in the test) twice, from t0 = 0.3 s:
// held on its last frame in the top half, looped in the bottom half. Each source frame carries its own
// number as two bars (the low and high hex digits), so the test reads back which frame seqAt picked.
import { loadSeq, seqAt } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 1.6, FONTS: [] };
export const TL = {};
export const silent = true;
export const T0 = 0.3;

let ctx;
export async function init({ ctx: c }) { ctx = c; await loadSeq('clip'); }

export function frame(t, jit) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(seqAt('clip', t, T0), 0, 0, 1080, 960);
  ctx.drawImage(seqAt('clip', t, T0, { loop: true }), 0, 960, 1080, 960);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0, 0, 0] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
