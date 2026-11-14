// SLATE SCENE: one placeholder card per board beat, for the board sheet and the animatic (plan 6.4).
//   node render.mjs board --slates                                  the board sheet, all slates
//   node render.mjs video --scene slate.js --out out/animatic.mp4   the animatic's picture
// For the beat under t it draws the beat's number, id and window at the top, its on-screen copy large and
// fitted inside the safe area, the visual note and the sound note in muted lines, and a progress bar with
// a tick at every beat. The timing is the board's (board.js, and cues.js once a take exists), so
// CFG.DUR = boardDur(). The size and safe area come from the board's target (a --target on the command
// line wins for the safe area). It exports `silent = true`, so a slate render never loads scene.js or
// audio.js. Replace it beat by beat with the real scene; it is not meant to ship.
import { clamp, BOARD, boardInfo, beatAt, boardDur } from './lib.js';

async function boardTarget() {
  if (!BOARD || !BOARD.target) return null;
  try {
    const r = await fetch(new URL('./safezones.json', import.meta.url));
    return r.ok ? ((await r.json()).targets || {})[BOARD.target] || null : null;
  } catch { return null; }
}
const BT = await boardTarget();

export const CFG = { W: (BT && BT.w) || 1080, H: (BT && BT.h) || 1920, FPS: (BT && BT.fps) || 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY', 'MONO'] };
export const TL = {};
export const silent = true;

const INK = '#F4F1EA', MUTED = '#8A8794', ACCENT = '#FF4A1C';
let ctx, L;

// At most n lines, the last one ending in an ellipsis when something was cut.
const upTo = (lines, n) => (lines.length <= n ? lines : [...lines.slice(0, n - 1), lines[n - 1] + ' ...']);
// Greedy word wrap at the current ctx.font.
function wrap(text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + w : w;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}

export async function init({ ctx: c, target }) {
  ctx = c;
  const s = (target && target.safe) || (BT && BT.safe);
  const box = s ? { x: s.x, y: s.y, w: s.w, h: s.h } : { x: CFG.W * 0.08, y: CFG.H * 0.08, w: CFG.W * 0.84, h: CFG.H * 0.84 };
  const info = boardInfo();
  const beats = info.windows.map((w) => {
    const b = w.beat, on = (b.on || []).map(String).filter(Boolean);
    // the on-screen copy: the largest size at which it wraps into 90% of the box's width and fills at most
    // 40% of its height
    let fs = 200, lines = [];
    const maxW = box.w * 0.9;
    for (;;) {
      ctx.font = `${fs}px DISPLAY`;
      lines = on.flatMap((x) => wrap(x, maxW));
      const widest = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
      if ((widest <= maxW && lines.length * fs * 1.08 <= box.h * 0.4) || fs <= 28) break;
      fs -= 4;
    }
    ctx.font = '44px BODY';
    const look = b.look ? upTo(wrap(b.look, box.w), 4) : [];
    ctx.font = '34px MONO';
    const sfxText = b.sfx === null ? 'sfx: silence' : b.sfx ? `sfx${b.sfxHit ? ' (hit)' : ''}: ${b.sfx}` : '';
    const sfx = sfxText ? upTo(wrap(sfxText, box.w), 3) : [];
    return { fs, lines, look, sfx };
  });
  L = { box, info, beats };
}

export function frame(t, jit) {
  const c = ctx, { box, info } = L;
  const w = beatAt(clamp(t, 0, info.dur - 1e-6)) || info.windows[0];
  const B = L.beats[w.index], cx = box.x + box.w / 2;
  c.textBaseline = 'alphabetic'; c.textAlign = 'center';
  // header: number, id, window
  c.font = '40px MONO'; c.fillStyle = MUTED;
  c.fillText(`SLATE ${w.index + 1}/${info.windows.length}  ${w.id}`, cx, box.y + 50);
  c.font = '30px MONO';
  c.fillText(`${w.start.toFixed(2)}-${w.end.toFixed(2)} s${info.estimated ? '  (estimated timing)' : ''}${w.beat.hold ? '  hold' : ''}`, cx, box.y + 96);
  // the on-screen copy, centred a little above the middle of the safe area
  const lh = B.fs * 1.08, top = box.y + box.h * 0.42 - (B.lines.length * lh) / 2;
  c.font = `${B.fs}px DISPLAY`; c.fillStyle = INK;
  B.lines.forEach((l, i) => c.fillText(l, cx, top + (i + 0.8) * lh));
  if (!B.lines.length) { c.font = '48px BODY'; c.fillStyle = MUTED; c.fillText('(no on-screen copy)', cx, box.y + box.h * 0.42); }
  // the visual note and the sound note
  let y = Math.max(top + B.lines.length * lh, box.y + box.h * 0.42) + 90;
  c.font = '44px BODY'; c.fillStyle = MUTED;
  for (const l of B.look) { c.fillText(l, cx, y); y += 56; }
  c.font = '34px MONO';
  for (const l of B.sfx) { y += 8; c.fillText(l, cx, y); y += 40; }
  // timecode and a progress bar with a tick at every beat; the current beat's stretch is brighter
  c.font = '44px MONO'; c.fillStyle = INK;
  const tf = Math.floor(t * CFG.FPS + 1e-6) / CFG.FPS;   // the frame's time, so the digits don't smear across subframes
  c.fillText(`${tf.toFixed(2)}s / ${info.dur.toFixed(2)}s`, cx, box.y + box.h - 90);
  const by = box.y + box.h - 40, X = (s) => box.x + box.w * clamp(s / info.dur);
  c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(box.x, by, box.w, 12);
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(X(w.start), by, X(w.end) - X(w.start), 12);
  c.fillStyle = ACCENT; c.fillRect(box.x, by, X(t) - box.x, 12);
  c.fillStyle = INK;
  for (const x of info.windows) c.fillRect(X(x.start) - 2, by - 10, 4, 32);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.07, 0.07, 0.09] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
