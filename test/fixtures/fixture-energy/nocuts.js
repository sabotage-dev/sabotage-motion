// fixture-energy: a scene with no cuts(), so energy_match is not checked.
export const CFG = { W: 720, H: 1280, FPS: 30, DUR: 1.0, FONTS: [] };
export const silent = true;
let ctx;
export async function init({ ctx: c }) { ctx = c; }
export function frame(t, jit) {
  ctx.fillStyle = '#14213d'; ctx.fillRect(0, 0, CFG.W, CFG.H);
  ctx.fillStyle = '#8ecae6'; ctx.fillRect(100 + 200 * t, 500, 200, 200);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0, 0, 0] };
}
export function post(t) { return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 }; }
