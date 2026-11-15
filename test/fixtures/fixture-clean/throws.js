// A scene that throws partway through a render (from 0.5 s), for the test that render.mjs then exits with an
// error and leaves no ffmpeg process behind.
export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 2.0, FONTS: [] };
export const TL = {};
export const silent = true;
let ctx;
export async function init({ ctx: c }) { ctx = c; }
export function frame(t, jit) {
  if (t >= 0.5) throw new Error(`planted: the scene throws at t=${t.toFixed(3)}`);
  ctx.fillStyle = '#FF4A1C'; ctx.fillRect(100 + 400 * t, 800, 200, 200);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.05, 0.05, 0.08] };
}
export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
