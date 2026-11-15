// fixture-check's alternate scene: clean by every check, so `check --file` on a master rendered from it proves
// the check replayed the render's own scene (scene.js would report its planted defects). It draws each beat's
// on-screen copy for the whole beat, keeps a bar moving, and holds the end card (HOLDS). Silent.
import { prog, beatAt, beatWindow, boardDur } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY'] };
export const TL = {};
export const silent = true;
const END = beatWindow('end');
export const HOLDS = [[END[0], END[1]]];

let ctx;
const widths = new Map();
export async function init({ ctx: c }) { ctx = c; }
function lines(t) {
  const w = beatAt(Math.min(t, CFG.DUR - 1e-6));
  return (w.beat.on || []).map((text, i) => ({ id: `${w.id}-${i}`, text, cx: 540, base: 620 + i * 140, size: 80 }));
}
export function frame(t, jit) {
  const c = ctx;
  c.fillStyle = '#1C2230'; c.fillRect(0, 0, CFG.W, CFG.H);
  c.fillStyle = '#FF6A3D'; c.fillRect(100 + 760 * prog(t, 0, CFG.DUR), 1300, 120, 40);
  c.font = '80px DISPLAY'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#F4F1EA';
  for (const l of lines(t)) c.fillText(l.text, l.cx, l.base);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.1, 0.1, 0.15] };
}
export function boxes(t) {
  return lines(t).map((l) => {
    if (!widths.has(l.text)) { ctx.save(); ctx.font = '80px DISPLAY'; widths.set(l.text, ctx.measureText(l.text).width); ctx.restore(); }
    const w = widths.get(l.text);
    return { id: l.id, text: l.text, x: l.cx - w / 2, y: l.base - l.size * 0.8, w, h: l.size };
  });
}
export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0.04, vig: 0, flash: 0, fade: 1, hud: 0 };
}
