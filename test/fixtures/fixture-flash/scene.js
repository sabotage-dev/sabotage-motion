// fixture-flash (plan 23.9, flash): a 2 s black card that, from 0.5 s, flashes white five times a second, each flash
// lit only through the first 24% of its frames' intervals. The render's motion blur (8 subframes across a 180-degree
// shutter, at 3%, 9%, 16%, 22%, ... of the interval) shows each lit frame half white, so the master strobes; the
// check probe's single sample at 25% never lands on a flash, so it sees a still black card throughout.
console.log('fixture: fixture-flash scene.js evaluated');

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 2.0, FONTS: [] };
export const silent = true;

let ctx;
export async function init({ ctx: c }) { ctx = c; }

export function frame(t, jit) {
  const u = t * CFG.FPS, i = Math.floor(u + 1e-9), ph = u - i;
  if (t >= 0.5 && i % 6 < 3 && ph < 0.24) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, CFG.W, CFG.H); }
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0, 0, 0] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
