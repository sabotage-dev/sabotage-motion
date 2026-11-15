// TERMINAL-DEMO: a made-up command-line tool installed and run in a terminal, then its fix landing as a diff (8 s,
// 9:16), built from code.js (the scene contract is in the template's scene.js header). The tool (darnly), the project
// (mossgate) and the code are made up.
//   - a terminal session (termSession, terminal): typed commands, a progress bar, a spinner, output on its own clock
//   - a diff (diffBlock, drawDiff): the wrong line strikes through, the fixed one opens in
//   - window frames (drawFrame), and key ticks thinned to KEY_MAX a second for audio.js (typedTimes, keyTicks)
// The look is neon, picked on purpose: dark, so code reads as code, with its glow kept low enough for small type. Its
// tokens colour the code (codeTheme) and its mono face draws it. boxes(t) returns every helper's layout-only call, so
// check sees the code and terminal text (and leaves the frames and the cursor, which are deco, alone).
import { clamp, prog, snap, swift, whip, beatWindow, boardDur, sceneTarget } from './lib.js';
import { bgConfig, fontStr } from './looks.js';
import { codeTheme, frameLayout, drawFrame, termSession, terminal, diffBlock, drawDiff, typedTimes, keyTicks } from './code.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY', 'MONO'], LOOK: 'neon' };

const [I0] = beatWindow('install'), [R0] = beatWindow('run'), [F0, F1] = beatWindow('fix');
// The timeline audio.js plays from. keys, bar, installed, spin, found and lands are filled in init from the blocks.
export const TL = {
  cuts: [R0, F0],                     // the headline changes; a short glitch (the look allows one)
  lift: [F0 - 0.35, F0 + 0.15],       // the headline and the terminal move up to make room for the diff
  open: F0 + 0.05,                    // the diff window opens
  keys: [], bar: [0, 0], installed: 0, spin: [], found: 0, lands: [], end: F1,
};

const DIFF = `@@ -14,6 +14,6 @@ function lap(clock) {
   const now = clock.read();
-  const ms = now - clock.start + 1;
+  const ms = now - clock.start;
   clock.laps.push(ms);
   clock.start = now;
   return ms;
`;
const HEADS = [['Install it', I0], ['Run it', R0], ['Ship the fix', F0]];
const LIFT = 220;

let ctx, S = 1, ALPHA = false, ST, TH, TERM, DIFFB, TWIN, DWIN, HEAD;

export async function init({ ctx: c, scale, alpha, target, style }) {
  ctx = c; S = scale; ALPHA = alpha; ST = style;
  const T = await sceneTarget(target);
  const safe = T && T.safe ? T.safe : { x: 44, y: 130, w: 896, h: 1306 };
  TH = codeTheme(ST);
  // two windows the width of the safe area less a margin; the terminal starts lower and lifts when the diff arrives
  const x = safe.x + 28, w = safe.w - 56;
  TWIN = frameLayout('window', { x, y: 612, w, h: 480 });
  DWIN = frameLayout('window', { x, y: 908, w, h: 450 });
  TERM = termSession({ ...TWIN.content, theme: TH, size: 32, lineH: 1.5, prompt: 'mossgate $ ', id: 'term', type: { cps: 24, seed: 11 },
    steps: [
      { cmd: './get-darnly.sh', at: I0 + 0.35 },
      { bar: 'fetching darnly 0.4.2', dur: 0.9, width: 14, done: '+ installed darnly 0.4.2', doneKind: 'add' },
      { cmd: 'darnly fix src/clock.ts', at: R0 + 0.12 },
      { spin: 'reading 6 files', dur: 0.6, done: '+ read 6 files', doneKind: 'add' },
      { out: 'found 1 off-by-one in src/clock.ts:16', kind: 'del', after: 0.05 },
      { out: '+ patched src/clock.ts (+1 -1)', kind: 'add', at: F0 + 0.95 },
    ] });
  DIFFB = diffBlock({ src: DIFF, lang: 'ts', ...DWIN.content, theme: TH, size: 32, lineH: 1.5, id: 'diff', start: F0 + 0.55, step: 0.35 });
  // the headline: the largest DISPLAY size at which the longest one fits the window's width
  let fs = 104;
  for (;;) {
    ctx.font = fontStr(ST, 'display', fs);
    if (Math.max(...HEADS.map(([h]) => ctx.measureText(h + '.').width)) <= w - 24 || fs <= 48) break;
    fs -= 4;
  }
  const m = ctx.measureText('Ship the fix.');
  HEAD = { x: x + 4, base: 548, fs, asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent,
    w: HEADS.map(([h]) => ctx.measureText(h).width), dot: ctx.measureText('.').width };
  // the sound's timeline, from the blocks themselves
  TL.keys = keyTicks(typedTimes(TERM));
  const bar = TERM.rows.find((r) => r.type === 'bar'), spin = TERM.rows.find((r) => r.type === 'spin');
  TL.bar = [bar.at, bar.at + bar.dur]; TL.installed = bar.at + bar.dur;
  TL.spin = Array.from({ length: Math.round(spin.dur * spin.fps) }, (_, i) => +(spin.at + i / spin.fps).toFixed(4));
  TL.found = TERM.rows.find((r) => r.type === 'out').at;
  TL.lands = DIFFB.rows.filter((r) => Number.isFinite(r.at)).map((r) => r.at);
}

const lift = (t) => -LIFT * swift(prog(t, TL.lift[0], TL.lift[1]));
const diffK = (t) => snap(prog(t, TL.open, TL.open + 0.4));
// The headline in effect at t: which one, how far it has risen (0 to 1) and how far it has left (0 to 1).
function headAt(t, i) {
  const [, from] = HEADS[i], to = i + 1 < HEADS.length ? HEADS[i + 1][1] : Infinity;
  const k = ST.motion.enter === 'snap' ? snap(prog(t, from + 0.04, from + 0.5)) : snap(prog(t, from + 0.04, from + 0.6));
  const o = Number.isFinite(to) ? whip(prog(t, to - 0.28, to)) : 0;
  return { k, o, dy: (1 - k) * HEAD.fs * 1.15 - o * HEAD.fs * 1.2 };
}
// the clip each headline rises through: its line, from a little above the ascent to the baseline plus the descent
const headClip = (t) => ({ x: HEAD.x - 20, y: HEAD.base + lift(t) - HEAD.asc - 6, w: 900, h: HEAD.asc + HEAD.desc + 12 });

function drawHead(c, t) {
  const clip = headClip(t);
  c.save();
  c.beginPath(); c.rect(clip.x, clip.y, clip.w, clip.h); c.clip();
  c.font = fontStr(ST, 'display', HEAD.fs); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  HEADS.forEach(([text], i) => {
    const h = headAt(t, i);
    if (h.k <= 0 || h.o >= 1) return;
    const y = HEAD.base + lift(t) + h.dy;
    c.fillStyle = ST.tokens.ink; c.fillText(text, HEAD.x, y);
    c.fillStyle = ST.tokens.accent; c.fillText('.', HEAD.x + HEAD.w[i], y);
  });
  c.restore();
}

export function frame(t, jit) {
  const c = ctx, ly = lift(t), dk = diffK(t);
  drawHead(c, t);
  drawFrame(c, 'window', TWIN.outer, { theme: TH, title: '~/mossgate', dy: ly });
  terminal(c, TERM, t, { dy: ly });
  if (dk > 0) {
    drawFrame(c, 'window', DWIN.outer, { theme: TH, title: 'src/clock.ts', alpha: dk, dy: (1 - dk) * 40 });
    drawDiff(c, DIFFB, t, { alpha: dk, dy: (1 - dk) * 40 });
  }
  return {
    t, jit, use2D: true, ...bgConfig(ST, { alpha: ALPHA }),
    cam: [1 + 0.02 * clamp(t / CFG.DUR), 0, 0, 0],   // a slow push, for life on the hold
  };
}

// The text on screen at t: the headline cut to its clip, then each helper's layout-only call (draw: false).
export function boxes(t) {
  const out = [], clip = headClip(t), ly = lift(t), dk = diffK(t);
  HEADS.forEach(([text], i) => {
    const h = headAt(t, i);
    if (h.k <= 0 || h.o >= 1) return;
    const y = HEAD.base + ly + h.dy;
    const y0 = Math.max(y - HEAD.asc, clip.y), y1 = Math.min(y + HEAD.desc, clip.y + clip.h);
    if (y1 > y0) out.push({ id: `head${i}`, text: text + '.', x: HEAD.x, y: y0, w: HEAD.w[i] + HEAD.dot, h: y1 - y0, group: `head${i}` });
  });
  out.push(...drawFrame(ctx, 'window', TWIN.outer, { theme: TH, title: '~/mossgate', dy: ly, draw: false, id: 'twin' }));
  out.push(...terminal(ctx, TERM, t, { dy: ly, draw: false }));
  if (dk > 0) {
    out.push(...drawFrame(ctx, 'window', DWIN.outer, { theme: TH, title: 'src/clock.ts', alpha: dk, dy: (1 - dk) * 40, draw: false, id: 'dwin' }));
    out.push(...drawDiff(ctx, DIFFB, t, { alpha: dk, dy: (1 - dk) * 40, draw: false }));
  }
  return out;
}

// The look's post, with its bloom kept low so small type stays sharp, and its glitch at the two cuts.
export function post(t) {
  const p = ST.post, g = ST.motion.glitch ? TL.cuts.reduce((a, x) => a + 0.35 * Math.exp(-Math.pow((t - x) / 0.05, 2)), 0) : 0;
  return { t, bloom: Math.min(p.bloom, 0.22), thr: Math.max(p.thr, 0.72), ca: Math.min(p.ca, 0.0008), glitch: g, grain: p.grain, vig: p.vig, scan: p.scan, flash: 0, fade: 1, hud: 0 };
}

// More subframes while the headlines whip and the windows move.
export function subBoost(t) {
  const near = (x, a = 0.3) => Math.abs(t - x) < a;
  return near(R0) || near(F0, 0.45) ? 2 : 1;
}
