// fixture-clean: a 2 s, 1080x1920 engine fixture. Moving shapes and text in all three bundled
// faces, the gradient background shader, bloom and grain, and a TL that audio.js schedules from.
// The console lines let the tests see which modules a render evaluated.
import { prog, snap, spring, env, rgba, rgb01, noise1 } from './lib.js';

console.log('fixture: scene.js evaluated');

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 2.0, FONTS: ['DISPLAY', 'BODY', 'MONO'] };
export const TL = { inA: 0.2, hits: [0.5, 1.2], out: 1.6 };

let ctx, ALPHA = false;

export async function init({ ctx: c, alpha }) {
  ctx = c; ALPHA = alpha;
}

export function frame(t, jit) {
  const c = ctx;
  // a square travelling on a curve, spinning
  const x = 140 + 800 * snap(prog(t, 0.0, 1.8)), y = 700 + 260 * noise1(t * 1.3);
  c.save(); c.translate(x, y); c.rotate(t * 2.2);
  c.fillStyle = '#FF4A1C'; c.fillRect(-90, -90, 180, 180);
  c.restore();
  // a ring that pulses on each hit
  const r = 120 + 60 * env(t, TL.hits, 8);
  c.strokeStyle = '#F4F1EA'; c.lineWidth = 18; c.beginPath(); c.arc(540, 1250, r, 0, Math.PI * 2); c.stroke();
  // type in each face
  const k = spring(t - TL.inA, 2.4, 0.5), o = prog(t, TL.out, TL.out + 0.3);
  c.globalAlpha = Math.max(0, 1 - o);
  c.fillStyle = '#F4F1EA'; c.textAlign = 'center';
  c.font = '150px DISPLAY'; c.fillText('Fixture', 540, 420 + (1 - k) * 160);
  c.font = '60px BODY'; c.fillStyle = rgba('#F4F1EA', 0.8); c.fillText('clean engine fixture', 540, 520);
  c.globalAlpha = 1;
  c.font = '54px MONO'; c.fillStyle = '#9AD1FF';
  c.fillText(`f ${String(Math.floor(t * CFG.FPS + 1e-6)).padStart(3, '0')}`, 540, 1700);
  return {
    t, jit, use2D: true, scene: ALPHA ? 0 : 1,
    P: [...rgb01('#101018'), 1], Q: [...rgb01('#2A1630'), 0],
    cam: [1 + 0.04 * prog(t, 0, CFG.DUR), 0, 0, 0], clear: rgb01('#101018'),
  };
}

export function post(t) {
  return { t, bloom: 0.2, thr: 0.75, ca: 0.0008, glitch: 0, grain: 0.03, vig: 0.12, flash: 0, fade: 1, hud: 0 };
}

export function subBoost(t) {
  return t < 0.6 ? 2 : 1;
}
