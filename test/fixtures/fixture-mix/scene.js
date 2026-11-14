// fixture-mix: an 8 s, 1080x1920 picture for the mix suite. It draws a block crossing the frame, and its
// effects stem (audio.js) is a tick every 0.1 s, dense enough that an effects-only master can reach -14 LUFS
// under a -2 dBTP ceiling.
import { prog } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 8.0, FONTS: [] };
export const TL = { ticks: Array.from({ length: 79 }, (_, i) => +(0.05 + 0.1 * i).toFixed(2)) };

let ctx;
export async function init({ ctx: c }) { ctx = c; }

export function frame(t, jit) {
  ctx.fillStyle = '#1C2230'; ctx.fillRect(0, 0, CFG.W, CFG.H);
  ctx.fillStyle = '#F4F1EA'; ctx.fillRect(100 + 700 * prog(t, 0, CFG.DUR), 900, 180, 180);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.1, 0.1, 0.15] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
