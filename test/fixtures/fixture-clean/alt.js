// An alternate scene for the scene-swap and --target tests: its own TL and length (1 s), not
// silent, and no W/H/FPS in CFG, so it renders only with --target. --param dur=<s> sets CFG.DUR in init.
import { prog } from './lib.js';

console.log('fixture: alt.js evaluated');

export const CFG = { DUR: 1.0, FONTS: ['MONO'] };
export const TL = {};   // filled in init, so the test proves audio.js gets the TL as init left it

let ctx;
export async function init({ ctx: c, params }) { ctx = c; if (params.dur) CFG.DUR = +params.dur; TL.hits = [0.25]; }

export function frame(t, jit) {
  ctx.fillStyle = '#9AD1FF';
  ctx.fillRect(80 + 600 * prog(t, 0, CFG.DUR), CFG.H * 0.4, 200, 200);
  ctx.font = '64px MONO'; ctx.fillStyle = '#FFFFFF'; ctx.fillText('alt', 100, 200);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.05, 0.05, 0.08] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
