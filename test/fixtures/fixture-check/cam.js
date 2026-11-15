// A still white rectangle seen through a zoomed, turned and panned camera, for the test that check maps
// boxes(t) through cfg.cam the way the composite shader does: the box is inside the safe area before the
// camera and outside after it. 1 s long, so it is checked with --only (its length is not the board's).
export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 1.0, FONTS: [] };
export const TL = {};
export const silent = true;
export const CAM = [1.4, 0.35, 0.08, -0.05];
export const RECT = { x: 700, y: 300, w: 200, h: 100 };
let ctx;
export async function init({ ctx: c }) { ctx = c; }
export function frame(t, jit) {
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(RECT.x, RECT.y, RECT.w, RECT.h);
  return { t, jit, use2D: true, scene: 0, cam: CAM, clear: [0, 0, 0] };
}
export const boxes = () => [{ id: 'cam', text: 'CAM', ...RECT }];
export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
