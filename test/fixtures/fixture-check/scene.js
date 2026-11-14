// fixture-check: a 19.2 s, 1080x1920 piece with one of each defect `render.mjs check` looks for, and the
// clean cases it must leave alone (plan section 16). Sizes are design pixels; times hang off board.js.
//   planted: a flat first frame; a 4 s freeze outside any hold; two overlapping labels; a beat whose copy
//            never appears; a word on screen for 0.2 s; a text box outside the safe area for 0.5 s; text
//            outside the safe area only at the first and last subframes of each frame; a sound note with no
//            sound; an sfxHit beat with only a sustained sound; with --param stray=1, a label outside the
//            safe area in the open beat
//   clean:   grain on throughout; a slow drift; a single 10 px dot moving 1 px a frame on a held card;
//            word-by-word captions; a slam entrance that leaves the safe area for a moment (a deliberate
//            WARN); an end card inside HOLDS
import { clamp, prog, snap, beatWindow, boardDur, CUES, captions } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY', 'MONO'] };
const W = Object.fromEntries(['open', 'hook', 'drift', 'freeze', 'dot', 'save', 'end'].map((id) => [id, beatWindow(id)]));
export const TL = {
  ticks: [0.2, 0.4, 0.6, 0.8], hit: W.hook[0], whoosh: [W.drift[0] + 0.1, W.drift[1] - 0.2],
  swell: [W.save[0], W.save[1] - 0.05], chime: W.end[0] + 0.1,
};
export const HOLDS = [[W.end[0], W.end[1]]];

const SAFE = { x: 84, y: 160, w: 852, h: 1320 };   // the tiktok zone, so captions sit where the check looks
const CAP = { safe: SAFE, size: 72 };
let ctx, P;
const widths = new Map();
const font = (size, fam = 'DISPLAY') => `${size}px ${fam}`;
function width(text, size, fam) {
  const k = `${fam}|${size}|${text}`;
  if (!widths.has(k)) { ctx.save(); ctx.font = font(size, fam); widths.set(k, ctx.measureText(text).width); ctx.restore(); }
  return widths.get(k);
}

export async function init({ ctx: c, params }) { ctx = c; P = { stray: params.stray === '1' }; }

const inW = (t, w, a = 0, b = Infinity) => t >= w[0] + a && t < Math.min(w[1], w[0] + b);
// Every run of text drawn at t, as { id, text, cx, base, size, fam, group, s (scale) }: frame() draws these and
// boxes() reports them, so the two can never disagree.
function labels(t) {
  const L = [];
  const add = (id, text, cx, base, size, o = {}) => L.push({ id, text, cx, base, size, fam: o.fam || 'DISPLAY', group: o.group || id, s: o.s || 1 });
  const frac = (((t * CFG.FPS) % 1) + 1) % 1;
  if (inW(t, W.open, 1 / CFG.FPS)) add('open', 'OPEN', 540, 640, 140);
  if (P.stray && inW(t, W.open, 0.2, 0.8)) add('stray', 'STRAY', 140, 320, 60);                 // planted with --param stray=1
  if (inW(t, W.hook)) add('stop', 'STOP', 540, 700, 160, { s: 1 + 2 * (1 - snap(prog(t, W.hook[0], W.hook[0] + 0.15))) });
  if (inW(t, W.drift)) add('drift', 'DRIFT', 400 + 9 * (t - W.drift[0]), 760, 140);
  if (inW(t, W.freeze)) {
    add('frozen', 'FROZEN', 540, 640, 140);
    add('over', 'OVER', 330, 1060, 110);                                                          // planted overlap
    add('lap', 'LAP', 380, 1090, 110);
  }
  if (inW(t, W.dot)) add('held', 'HELD CARD', 540, 640, 100);
  if (inW(t, W.save)) {
    add('left', 'LEFT', inW(t, W.save, 0.5, 1.0) ? 110 : 200, 860, 60, { fam: 'BODY' });          // planted: out for 0.5 s
    const edge = inW(t, W.save, 0.2, 1.7) && (frac < 0.07 || frac > 0.43);                        // planted: out at subframes 1 and 8
    add('edge', 'EDGE', edge ? 990 : 760, 420, 60, { fam: 'BODY' });
    if (inW(t, W.save, 1.8, 2.0)) add('flash', 'FLASH', 540, 1120, 90);                           // planted: 0.2 s
  }
  if (inW(t, W.end)) add('end', 'example.com', 540, 900, 90);
  return L;
}

export function frame(t, jit) {
  const c = ctx;
  if (t >= 1 / CFG.FPS) {
    // open: dots stream across
    if (inW(t, W.open)) for (let i = 0; i < 8; i++) { c.fillStyle = '#FF6A3D'; c.fillRect(((i * 140 + 320 * t) % 1000) + 40, 1200 + 30 * (i % 3), 24, 24); }
    if (inW(t, W.drift)) { c.fillStyle = '#2B3A55'; c.fillRect(200 + 9 * (t - W.drift[0]), 560, 600, 260); }
    if (inW(t, W.dot)) { c.fillStyle = '#F4F1EA'; c.fillRect(300 + (t - W.dot[0]) * CFG.FPS, 1100, 10, 10); }
    for (const l of labels(t)) {
      c.save();
      const my = l.base - l.size * 0.35;
      c.translate(l.cx, my); c.scale(l.s, l.s); c.translate(-l.cx, -my);
      c.font = font(l.size, l.fam); c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#F4F1EA';
      c.fillText(l.text, l.cx, l.base);
      c.restore();
    }
    captions(c, CUES ? CUES.WORDS : [], t, CAP);
  }
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.08, 0.09, 0.12] };
}

// One box per run of text, in design pixels before the camera (the scene contract, plan section 5).
export function boxes(t) {
  if (t < 1 / CFG.FPS) return [];
  const out = labels(t).map((l) => {
    const w = width(l.text, l.size, l.fam), my = l.base - l.size * 0.35, x0 = l.cx - w / 2, y0 = l.base - l.size * 0.8;
    return { id: l.id, text: l.text, group: l.group, x: l.cx + (x0 - l.cx) * l.s, y: my + (y0 - my) * l.s, w: w * l.s, h: l.size * l.s };
  });
  return out.concat(captions(ctx, CUES ? CUES.WORDS : [], t, { ...CAP, draw: false }));
}

export function post(t) {
  return { t, bloom: 0.1, thr: 0.8, ca: 0, glitch: 0, grain: 0.05, vig: 0.1, flash: 0, fade: 1, hud: 0 };
}
