// SLATE SCENE: a placeholder card for blocking out timing before anything is animated.
//   node render.mjs video --scene slate.js [--param label="Hook" --param note="one word slams in" --param dur=4]
// It is a complete scene with its own CFG and TL, and it exports `silent = true`, so a slate render
// has a silent soundtrack and never loads scene.js or audio.js. It draws a label, a muted note, a
// timecode and a progress bar, inside the target's safe area when you pass --target.
// (A storyboard-driven version, one card per beat, replaces this file in a later release.)
import { clamp } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 3.0, FONTS: ['DISPLAY', 'BODY', 'MONO'] };
export const TL = {};
export const silent = true;

let ctx, P, L;

export async function init({ ctx: c, params, target }) {
  ctx = c;
  if (params.dur) CFG.DUR = +params.dur;
  P = { label: params.label || 'Placeholder', note: params.note || 'replace with the real scene', ink: '#F4F1EA', muted: '#8A8794', accent: '#FF4A1C' };
  // Safe area in design pixels: the target's when given, otherwise an 8% margin all round.
  const s = target && target.safe;
  const box = s ? { x: s.x, y: s.y, w: s.w, h: s.h } : { x: CFG.W * 0.08, y: CFG.H * 0.08, w: CFG.W * 0.84, h: CFG.H * 0.84 };
  // Auto-fit the label to the safe width (one line).
  let fs = 220;
  for (;;) { ctx.font = `${fs}px DISPLAY`; if (ctx.measureText(P.label).width <= box.w || fs <= 40) break; fs -= 6; }
  L = { box, fs };
}

export function frame(t, jit) {
  const c = ctx, { box, fs } = L;
  c.textBaseline = 'alphabetic'; c.textAlign = 'center';
  const cx = box.x + box.w / 2;
  c.font = '40px MONO'; c.fillStyle = P.muted;
  c.fillText('SLATE', cx, box.y + 60);
  c.font = `${fs}px DISPLAY`; c.fillStyle = P.ink;
  c.fillText(P.label, cx, box.y + box.h * 0.45);
  c.font = '48px BODY'; c.fillStyle = P.muted;
  c.fillText(P.note, cx, box.y + box.h * 0.45 + fs * 0.6);
  c.font = '44px MONO'; c.fillStyle = P.ink;
  const tf = Math.floor(t * CFG.FPS + 1e-6) / CFG.FPS;   // the frame's time, so the digits don't smear across subframes
  c.fillText(`${tf.toFixed(2)}s / ${CFG.DUR.toFixed(2)}s`, cx, box.y + box.h - 90);
  const p = clamp(t / CFG.DUR);
  c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(box.x, box.y + box.h - 40, box.w, 12);
  c.fillStyle = P.accent; c.fillRect(box.x, box.y + box.h - 40, box.w * p, 12);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.07, 0.07, 0.09] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
