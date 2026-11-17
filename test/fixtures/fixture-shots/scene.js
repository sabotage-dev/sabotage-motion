// fixture-shots: draws the sequence "tall" (captured by tools/shots.mjs from tall.html in the test) over the whole
// frame, from t = 0, so the test reads back from the landmarks which frame seqAt drew. 24 fps, so the capture's fps
// comes from CFG.FPS and not from the default.
import { loadSeq, seqAt } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 24, DUR: 1.25, FONTS: [] };
export const TL = {};
export const silent = true;

let ctx;
export async function init({ ctx: c }) { ctx = c; await loadSeq('tall'); }

export function frame(t, jit) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(seqAt('tall', t), 0, 0, 1080, 1920);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0, 0, 0] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
