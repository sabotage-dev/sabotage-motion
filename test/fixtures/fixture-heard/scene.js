// A 2 s scene for audio_spike over what a master mixes (P11b round 1, G1): a square moving across the frame, and a
// sound from audio.js whose stems are built to judge differently alone and summed (--param stems=a or b).
import { prog } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 2.0, FONTS: [] };
export const TL = {};
let ctx;
export function init({ ctx: c }) { ctx = c; }
export function frame(t, jit) {
  ctx.fillStyle = '#F4F1EA'; ctx.fillRect(100 + 700 * prog(t, 0, CFG.DUR), 900, 180, 180);
  return { t, jit, use2D: true, scene: 0, P: [0, 0, 0, 0], Q: [0, 0, 0, 0], R: [0, 0, 0, 0], cam: [1, 0, 0, 0], clear: [0.06, 0.06, 0.09] };
}
export const post = (t) => ({ t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 });
