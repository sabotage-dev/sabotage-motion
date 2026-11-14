// fixture-board: a real scene built from the board. Its timeline is beatWindow(), its length is
// boardDur(), and it draws word-by-word captions from cues.js when a take exists. It is silent, so it
// needs no audio.js.
import { clamp, prog, snap, beatAt, boardDur, BOARD, CUES, captions } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY', 'MONO'] };
export const TL = {};
export const silent = true;

const BG = ['#20335A', '#5A2033', '#205A3F', '#5A4A20', '#3F205A'];
let ctx, safe;

export async function init({ ctx: c, target }) {
  ctx = c;
  safe = (target && target.safe) || { x: 84, y: 160, w: 852, h: 1320 };
}

export function frame(t, jit) {
  const c = ctx, w = beatAt(clamp(t, 0, CFG.DUR - 1e-6));
  c.fillStyle = BG[w.index % BG.length]; c.fillRect(0, 0, CFG.W, CFG.H);
  // the beat's on-screen copy slides up into place at the start of its window
  const k = snap(prog(t, w.start, w.start + 0.3));
  c.font = '120px DISPLAY'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#F4F1EA';
  (w.beat.on || []).forEach((line, i) => c.fillText(line, 540, 700 + i * 140 + (1 - k) * 200));
  c.font = '40px MONO'; c.fillStyle = 'rgba(244,241,234,0.7)';
  c.fillText(`${w.id} ${w.start.toFixed(2)}-${w.end.toFixed(2)}`, 540, 260);
  captions(c, CUES ? CUES.WORDS : [], t, { safe, size: 72 });
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.05, 0.05, 0.08] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
