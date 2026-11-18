// SHOWREEL: 20 s of what the engine can draw, 16:9 at 60 fps, cut to a 120 BPM grid (the scene contract is in the
// template's scene.js header). Ported from the reel the engine was first built for. It ends on the end card of
// sabotage development, the studio behind this repo; its orrery mark was drawn for this reel. Every frame is a pure function of t; the music in audio.js is scheduled from TL.
//
//   0-2   the dot           a dot pops, squashes, jumps, lands; three shapes burst out and stretch into bands
//   2-4   kinetic type      MOTION rises, an E drops in (EMOTION), the frame inverts; twelve slices whip out
//   4-6   shape systems     8 x 4 tiles morph in three waves; one tile zooms to fill the frame
//   6-8   particles         22,000 particles: a spiral galaxy, the word FLOW, a sphere
//   8-10  3D / SDF          a raymarched blob morphs through four shapes (shaders.js, look 1), with callouts
//   10-12 liquid            metaballs refract the word LIQUID (look 2, the 2D layer read in the shader); it cuts in on the beat
//   12-14 data              bars, a line chart, an odometer, rings
//   14-16 style frames      four half-second style frames, one shader look each, a word landing on every beat
//   16-20 mark + end card   impact, the orrery mark, the wordmark, a glint, and out
// The board (board.js) mirrors these sections; the reel is locked to its grid, so init checks the board against it.
// No boxes(t): check's text checks report "not checked" here (references/check.md says why that is fine for a reel).
import {
  clamp, lerp, prog, E, snap, swift, whip, spring, hash, hash2, noise1, mulberry32, TAU, env, boardDur, boardInfo,
} from './lib.js';

export const CFG = { W: 1920, H: 1080, FPS: 60, DUR: boardDur(), FONTS: ['COND', 'DIDONE', 'GEO', 'DISPLAY', 'MONO'] };
const W = CFG.W, H = CFG.H;
const WORDMARK = 'SABOTAGE';

// The palette.
const C = {
  ink: '#0B0B0D', ink2: '#16161B', paper: '#F2EDE4', ember: '#FF4A1C', cobalt: '#2B3BFF',
  lime: '#D4FF3A', pink: '#FF5FA2', violet: '#7B4DFF', sun: '#FFC21A',
};

// The board's sections, as the grid has them. A board that moves one is refused here, by name.
const GRID_BEATS = { intro: [0, 2], kinetic: [2, 4], shapes: [4, 6], particles: [6, 8], sdf: [8, 10], liquid: [10, 12], data: [12, 14], montage: [14, 16], lockup: [16, 20] };
for (const w of boardInfo().windows) {
  const want = GRID_BEATS[w.id];
  if (!want || Math.abs(w.start - want[0]) > 1e-6 || Math.abs(w.end - want[1]) > 1e-6) {
    throw new Error(`showreel: board beat "${w.id}" is ${w.start}-${w.end} s, but the reel is cut to a 120 BPM grid with it at ${want ? want.join('-') + ' s' : 'no place'}; retime scene.js and audio.js with the board`);
  }
}

// ---------------------------------------------------------------------------
// The musical timeline, shared by the synth (audio.js receives TL) and the visuals, so everything locks to the grid.
// 120 BPM: beat = 0.5 s, bar = 2 s, 10 bars.
const range = (a, b, step) => { const r = []; for (let t = a; t < b - 1e-9; t += step) r.push(+t.toFixed(4)); return r; };

// Geometry and timing shared between the visuals and the synth (so each sound lands on its visual event).
const GRID = { cols: 8, rows: 4, s: 200, gap: 24 };
GRID.x0 = (W - (GRID.cols * GRID.s + (GRID.cols - 1) * GRID.gap)) / 2;
GRID.y0 = (H - (GRID.rows * GRID.s + (GRID.rows - 1) * GRID.gap)) / 2;
const WAVES = [
  { t: 4.0, ox: W / 2, oy: H / 2 },
  { t: 4.5, ox: -150, oy: H / 2 },
  { t: 5.0, ox: W + 150, oy: -150 },
];
const tileCenter = (i, j) => [GRID.x0 + i * (GRID.s + GRID.gap) + GRID.s / 2, GRID.y0 + j * (GRID.s + GRID.gap) + GRID.s / 2];
const waveStart = (w, i, j) => {
  const [cx, cy] = tileCenter(i, j);
  return WAVES[w].t + (Math.hypot(cx - WAVES[w].ox, cy - WAVES[w].oy) / 2200) * 0.34;
};
const counterValue = (t) => 1200 * E.outExpo(prog(t, 12.2, 13.3));
const MARK_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const markStart = (k) => 16.02 + MARK_ORDER.indexOf(k) * 0.024;

export const TL = {
  kicks: [...range(2, 14, 0.5), ...range(14, 15.75, 0.5), 16, 18],
  claps: range(2.5, 14, 1),
  hats: range(2.25, 14, 0.5),
  hats16: range(6, 14, 0.25).filter((t) => (t * 4) % 2 === 1),
  snareRoll: [...range(14, 15, 0.125), ...range(15, 15.5, 0.0625), ...range(15.5, 15.85, 0.03125)],
  cuts: range(14, 16, 0.25),
  // every tile a shape wave reaches, per wave, in the order it reaches them
  waves: WAVES.map((_, w) => {
    const hits = [];
    for (let j = 0; j < GRID.rows; j++) for (let i = 0; i < GRID.cols; i++) hits.push(waveStart(w, i, j));
    return hits.sort((a, b) => a - b);
  }),
  // one tick for every 40 frames the odometer counts
  counterTicks: (() => {
    const out = []; let last = 0;
    for (let t = 12.0; t < 13.4; t += 1 / 480) { const v = Math.floor(counterValue(t) / 40); if (v > last) { out.push([+t.toFixed(5), v]); last = v; } }
    return out;
  })(),
  // the planets of the mark, in the order they pop on: [time, pan]
  marks: MARK_ORDER.map((k) => [+markStart(k).toFixed(4), Math.cos((k / 12) * TAU) * 0.8]),
};

let ctx, hctx, S = 1;

// The reel's type: open-licence faces bundled in fonts/ (licences beside them, listed in ASSETS.md). Family names
// avoid CSS's generic ones (serif, monospace), which a font string would otherwise resolve to.
const F = {
  cond: (s) => `${s}px COND`, didone: (s) => `${s}px DIDONE`, geo: (s) => `${s}px GEO`,
  mono: (s) => `${s}px MONO`, monoR: (s) => `${s}px MONO`, heavy: (s) => `${s}px DISPLAY`,
};
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

// kerned per-letter layout, cached
const mcache = new Map();
function measure(font, str) {
  const key = font + '|' + str;
  let m = mcache.get(key);
  if (m) return m;
  ctx.save();
  ctx.letterSpacing = '0px';
  ctx.font = font;
  const xs = [];
  for (let i = 0; i <= str.length; i++) xs.push(ctx.measureText(str.slice(0, i)).width);
  ctx.restore();
  m = { xs, total: xs[str.length] };
  mcache.set(key, m);
  return m;
}
function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0, r), 0, TAU); }
const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+/<>';
function scramble(str, p, t, seed = 0) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const th = (i / str.length) * 0.8;
    if (str[i] === ' ') out += ' ';
    else if (p > th + 0.2) out += str[i];
    else if (p > th) out += SCRAMBLE[Math.floor(hash(i * 13.7 + Math.floor(t * 40) + seed) * SCRAMBLE.length)];
    else out += ' ';
  }
  return out;
}

// ============================================================ 00 INTRO: the dot (0-2 s)
function sIntro(t) {
  const c = ctx;
  c.fillStyle = C.ink; c.fillRect(0, 0, W, H);
  const cx = W / 2, gy = H / 2 + 70, R = 24;
  // an ember glow where the dot lands, there from the first frame (the thumbnail) and gone as the dot pops
  const glow = 1 - E.inQuad(prog(t, 0, 0.5));
  if (glow > 0) {
    const g = c.createRadialGradient(cx, gy - R, 0, cx, gy - R, 560);
    g.addColorStop(0, rgba(C.ember, 0.38 * glow)); g.addColorStop(1, rgba(C.ember, 0));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }

  // ground line with ticks
  const gl = E.outExpo(prog(t, 0.05, 0.75)) * (1 - E.inExpo(prog(t, 1.4, 1.6)));
  if (gl > 0) {
    const hw = gl * 600;
    c.fillStyle = rgba(C.paper, 0.22);
    c.fillRect(cx - hw, gy, hw * 2, 1.5);
    for (let k = -7; k <= 7; k++) {
      const x = cx + k * 80;
      if (Math.abs(k * 80) < hw) c.fillRect(x - 0.75, gy + 10, 1.5, k % 7 === 0 ? 18 : 8);
    }
  }
  // caption typing
  const cap = 'SABOTAGE  /  MOTION REEL 2026';
  const n = Math.floor(prog(t, 0.3, 0.95) * cap.length);
  const ca = 1 - prog(t, 1.3, 1.5);
  if (n > 0 && ca > 0) {
    c.save();
    c.font = F.monoR(19); c.letterSpacing = '6px';
    const fw = c.measureText(cap).width;
    let s = cap.slice(0, n);
    if (Math.floor(t * 7) % 2 === 0 || n < cap.length) s += '_';
    c.fillStyle = rgba(C.paper, 0.7 * ca);
    c.fillText(s, cx - fw / 2, gy + 90);
    c.restore();
  }

  if (t < 1.0) {
    if (t < 0.25) return;
    const sc = spring(t - 0.25, 3.2, 0.32);
    let sx = 1, sy = 1, y = 0;
    if (t >= 0.5 && t < 0.6) {
      const u = E.outCubic(prog(t, 0.5, 0.6));
      sy = 1 - 0.4 * u; sx = 1 + 0.32 * u;
    } else if (t >= 0.6) {
      const u = prog(t, 0.6, 1.0);
      y = -330 * 4 * u * (1 - u);
      const v = Math.abs(1 - 2 * u);
      sy = 1 + 0.55 * v * v; sx = 1 / Math.sqrt(sy);
    }
    const hN = -y / 330;
    c.fillStyle = rgba(C.paper, 0.14 * (1 - hN * 0.75) * clamp(sc));
    c.beginPath(); c.ellipse(cx, gy + 3, R * 1.4 * (1 - hN * 0.5) * sc, 4, 0, 0, TAU); c.fill();
    c.fillStyle = C.paper;
    c.beginPath(); c.ellipse(cx, gy - R * sy * sc + y, Math.max(0, R * sx * sc), Math.max(0, R * sy * sc), 0, 0, TAU); c.fill();
    // pop ripple
    const pu = prog(t, 0.25, 0.8);
    if (pu > 0 && pu < 1) {
      c.strokeStyle = rgba(C.paper, 0.5 * (1 - pu)); c.lineWidth = 2;
      circle(c, cx, gy - R, R + 120 * E.outExpo(pu)); c.stroke();
    }
    return;
  }

  // impact: perspective ring + dust
  const u = prog(t, 1.0, 1.5);
  if (u < 1) {
    c.strokeStyle = rgba(C.paper, 0.6 * (1 - u)); c.lineWidth = 3 * (1 - u) + 0.5;
    const rr = R + 330 * E.outExpo(u);
    c.beginPath(); c.ellipse(cx, gy, rr, rr * 0.18, 0, 0, TAU); c.stroke();
    c.fillStyle = rgba(C.paper, 0.8 * (1 - u));
    for (let k = 0; k < 14; k++) {
      const dir = k % 2 ? 1 : -1, sp = 60 + 260 * hash(k * 3.1);
      const x = cx + dir * sp * E.outExpo(u);
      const y = gy - 90 * hash(k * 7.7) * Math.sin(Math.PI * Math.min(1, u * 1.4));
      circle(c, x, y, 3.5 * (1 - u)); c.fill();
    }
  }
  const cols = [C.cobalt, C.paper, C.ember];
  const order = [0, 1, 2];
  const eOut = E.outBack(prog(t, 1.0, 1.32), 2.2);
  const eS = swift(prog(t, 1.5, 1.7));
  for (const k of order) {
    const ang = -Math.PI / 2 + k * (TAU / 3) + (t - 1.0) * 3.4;
    const tri = [cx + Math.cos(ang) * 130, gy - 170 + Math.sin(ang) * 130];
    let x = lerp(cx, tri[0], eOut), y = lerp(gy - R, tri[1], eOut);
    const slot = k === 0 ? -1 : k === 1 ? 1 : 0; // cobalt top, paper bottom, ember middle
    x = lerp(x, cx, eS); y = lerp(y, gy - 170 + slot * 130, eS);
    const eW = E.inOutExpo(prog(t, 1.64 + k * 0.03, 1.88 + k * 0.03));
    const hwid = lerp(R * 0.8, W * 0.56, eW);
    let hh;
    if (k === 2) hh = lerp(R * 0.8, H * 0.8, E.inExpo(prog(t, 1.78, 2.0)));
    else hh = lerp(R * 0.8, 150, E.inOutCubic(prog(t, 1.76, 1.97)));
    const rad = Math.min(hh, hwid, R * 0.8);
    c.fillStyle = cols[k];
    c.beginPath(); c.roundRect(x - hwid, y - hh, hwid * 2, hh * 2, rad); c.fill();
  }
}

// ============================================================ 01 KINETIC TYPE (2-4 s)
function sKinetic(t) {
  const c = ctx;
  const inv = t >= 3.0;
  c.fillStyle = inv ? C.ink : C.ember; c.fillRect(0, 0, W, H);
  const size = 410, font = F.cond(size), word = 'EMOTION';
  const m = measure(font, word);
  const capH = size * 0.72, base = H / 2 + capH / 2;
  const wE = m.xs[1];
  const xMOT = (W - (m.total - wE)) / 2 - wE, xEMO = (W - m.total) / 2;
  const x0 = lerp(xMOT, xEMO, spring(t - 2.5, 2.4, 0.5));
  const punch = inv ? 1 + 0.12 * (1 - snap(prog(t, 3.0, 3.45))) : 1 + 0.06 * (1 - snap(prog(t, 2.0, 2.5)));
  c.save();
  c.translate(W / 2, H / 2); c.scale(punch, punch); c.translate(-W / 2, -H / 2);
  c.font = font;
  if (inv) {
    const unit = measure(font, 'EMOTION ').total;
    c.lineWidth = 2.5; c.strokeStyle = C.paper;
    for (let k = -3; k <= 3; k++) {
      if (!k) continue;
      const a = E.outCubic(prog(t, 3.0 + Math.abs(k) * 0.05, 3.25 + Math.abs(k) * 0.05));
      if (a <= 0) continue;
      const yy = base + k * 330 * lerp(0.35, 1, a);
      const dir = k % 2 ? 1 : -1;
      const off = (t - 3.0) * 300 * dir + k * 173;
      c.globalAlpha = a * (Math.abs(k) === 1 ? 0.32 : 0.2);   // faint and slow: a stroke passing a pixel never swings 0.1 (flash)
      let sx = (((x0 + off) % unit) + unit) % unit - unit;
      for (let xx = sx - unit; xx < W + unit; xx += unit) c.strokeText('EMOTION', xx, yy);
    }
    c.globalAlpha = 1;
  }
  c.fillStyle = inv ? C.paper : C.ink;
  for (let i = 1; i < 7; i++) {
    const d = 2.0 + (i - 1) * 0.045;
    const e = snap(prog(t, d, d + 0.5));
    if (e <= 0) continue;
    const yoff = (1 - e) * size * 0.95;
    c.save();
    c.beginPath(); c.rect(0, base - capH - 60, W, capH + 100); c.clip();
    c.fillText(word[i], x0 + m.xs[i], base + yoff);
    c.restore();
  }
  if (t >= 2.5) {
    const e = spring(t - 2.5, 2.9, 0.36);
    c.fillStyle = inv ? C.ember : C.paper;
    c.save();
    const yE = base - (1 - e) * H;
    // stretch on the fall
    const v = clamp(1 - e, 0, 1);
    c.translate(x0 + wE / 2, yE);
    c.scale(1 - 0.15 * v, 1 + 0.4 * v);
    c.fillText('E', -wE / 2, 0);
    c.restore();
  }
  // tiny caption
  if (t > 2.25) {
    c.font = F.monoR(20); c.letterSpacing = '5px';
    c.fillStyle = rgba(inv ? C.paper : C.ink, 0.85);
    const s = inv ? '(MOTION IS EMOTION)' : '(MOTION)';
    const txt = scramble(s, prog(t, inv ? 3.05 : 2.25, inv ? 3.4 : 2.55), t, 3);
    const tw = c.measureText(s).width;
    c.fillText(txt, W / 2 - tw / 2, base + 90);
    c.letterSpacing = '0px';
  }
  c.restore();
}

function kineticExit(t) {
  sGrid(t);
  const n = 12, sh = H / n;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - (n - 1) / 2) * 0.03;
    const e = swift(prog(t, 3.5 + d, 3.5 + d + 0.36));
    if (e >= 1) continue;
    const dir = i % 2 ? 1 : -1;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, i * sh, W, sh + 0.5); ctx.clip();
    // each slice slides a little and fades as it goes: a whip across the whole frame swept every letter over every pixel
    // in the band several times (a strobe, flash)
    ctx.globalAlpha = 1 - clamp(e * 2.2);
    ctx.translate(dir * e * 380, 0);
    sKinetic(t);
    ctx.restore();
  }
}

// ============================================================ 02 SHAPE SYSTEMS (3.5-6 s)
const polyR = (a, n, off) => {
  const seg = TAU / n; const x = (((a - off) % seg) + seg) % seg;
  return Math.cos(Math.PI / n) / Math.cos(x - Math.PI / n);
};
const rectR = (a, hw, hh) => {
  const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
  return Math.min(ca > 1e-6 ? hw / ca : 1e9, sa > 1e-6 ? hh / sa : 1e9);
};
function starR(a, n, ro, ri) {
  const seg = Math.PI / n, y = (a + Math.PI / 2) / seg;
  let idx = Math.floor(y); const x = (y - idx) * seg; idx = ((idx % 2) + 2) % 2;
  const rA = idx === 0 ? ro : ri, rB = idx === 0 ? ri : ro;
  return (rA * rB * Math.sin(seg)) / (rB * Math.sin(seg - x) + rA * Math.sin(x));
}
const SHAPES = [
  () => 1,
  (a) => polyR(a, 4, Math.PI / 4) * 0.9,
  (a) => polyR(a, 3, -Math.PI / 2) * 1.12,
  (a) => Math.max(rectR(a, 1, 0.34), rectR(a, 0.34, 1)),
  (a) => starR(a, 5, 1.1, 0.5),
  (a) => 0.8 + 0.2 * Math.cos(6 * a),
  (a) => polyR(a, 6, 0),
  (a) => polyR(a, 4, 0) * 1.05,
];
const PAIRS = [
  [C.ink, C.ember], [C.ember, C.paper], [C.cobalt, C.lime], [C.paper, C.cobalt], [C.lime, C.ink],
  [C.pink, C.ink], [C.ink, C.paper], [C.cobalt, C.paper], [C.ember, C.ink], [C.ink, C.lime],
];
const TGT = { i: 4, j: 1 };
const isTgt = (i, j) => i === TGT.i && j === TGT.j;
const shapeIdx = (i, j, k) => (isTgt(i, j) && k === 3 ? 0 : Math.floor(hash2(i * 7.1 + k * 13.3, j * 3.7 + k * 5.1) * SHAPES.length));
const pairA = (i, j) => (isTgt(i, j) ? 1 : Math.floor(hash2(i * 1.3, j * 2.9) * PAIRS.length));
const pairB = (i, j) => (isTgt(i, j) ? 8 : Math.floor(hash2(i * 3.1 + 9, j * 1.7 + 4) * PAIRS.length));

function shapePath(c, sA, sB, e, r) {
  c.beginPath();
  const N = 96;
  for (let n = 0; n < N; n++) {
    const a = (n / N) * TAU;
    const rr = lerp(SHAPES[sA](a), SHAPES[sB](a), e) * r;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (n) c.lineTo(x, y); else c.moveTo(x, y);
  }
  c.closePath();
}

function sGrid(t) {
  const c = ctx;
  c.fillStyle = C.paper; c.fillRect(0, 0, W, H);
  const z = swift(prog(t, 5.5, 6.0));
  let tgtDraw = null;
  for (let j = 0; j < GRID.rows; j++) for (let i = 0; i < GRID.cols; i++) {
    let [cx, cy] = tileCenter(i, j);
    let sc = spring(t - (3.55 + (i + j) * 0.028), 2.4, 0.45);
    let sA = shapeIdx(i, j, 0), sB = sA, me = 0, rot = 0;
    for (let w = 0; w < WAVES.length; w++) {
      const st = waveStart(w, i, j);
      if (t < st) break;
      const e = prog(t, st, st + 0.42);
      sA = shapeIdx(i, j, w); sB = shapeIdx(i, j, w + 1);
      me = E.outBack(e, 1.3);
      rot = (w + E.outBack(e, 1.9)) * (Math.PI / 2);
    }
    // wave 1: card flip to the second palette; wave 2: swap fg/bg with a squash pulse
    const s1 = waveStart(1, i, j), s2 = waveStart(2, i, j);
    const fe = prog(t, s1, s1 + 0.3);
    let flip = Math.abs(Math.cos(fe * Math.PI));
    let pair = fe >= 0.5 ? PAIRS[pairB(i, j)] : PAIRS[pairA(i, j)];
    let bg = pair[0], fg = pair[1];
    const se = prog(t, s2, s2 + 0.3);
    if (se >= 0.5) { const tmp = bg; bg = fg; fg = tmp; }
    sc *= 1 - 0.18 * Math.sin(Math.PI * se);
    let size = GRID.s, corner = 18, shapeR = GRID.s * 0.36, trot = 0;
    if (z > 0) {
      if (isTgt(i, j)) {
        cx = lerp(cx, W / 2, z); cy = lerp(cy, H / 2, z);
        size = GRID.s * Math.pow(2600 / GRID.s, z);
        shapeR = GRID.s * 0.36 * Math.pow(250 / (GRID.s * 0.36), z);
        corner = 18 * (1 - z);
        trot = z * Math.PI / 2;
      } else {
        const d = Math.hypot(i - TGT.i, j - TGT.j);
        sc *= 1 - E.inBack(prog(t, 5.5 + d * 0.03, 5.78 + d * 0.03), 2);
      }
    }
    if (sc <= 0.001) continue;
    const draw = () => {
      c.save();
      c.translate(cx, cy); c.rotate(trot); c.scale(sc * flip, sc);
      c.fillStyle = bg; c.beginPath(); c.roundRect(-size / 2, -size / 2, size, size, corner); c.fill();
      c.rotate(rot - trot);
      c.fillStyle = fg; shapePath(c, sA, sB, me, shapeR); c.fill();
      c.restore();
    };
    if (isTgt(i, j)) tgtDraw = draw; else draw();
  }
  if (tgtDraw) tgtDraw();
}

// ============================================================ 03 PARTICLES (6-8 s)
const NP = 22000;
const P = {};
function initParticles() {
  const R = mulberry32(1234);
  const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
  const o = oc.getContext('2d');
  o.font = F.cond(640); o.fillStyle = '#fff'; o.textAlign = 'center';
  o.fillText('FLOW', W / 2, H / 2 + 640 * 0.36);
  const img = o.getImageData(0, 0, W, H).data;
  const pts = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (img[(y * W + x) * 4 + 3] > 128) pts.push(x, y);
  let minx = 1e9, maxx = -1e9;
  for (let i = 0; i < pts.length; i += 2) { minx = Math.min(minx, pts[i]); maxx = Math.max(maxx, pts[i]); }
  const f32 = (n) => new Float32Array(n);
  Object.assign(P, {
    dx: f32(NP), dy: f32(NP), th: f32(NP), rg: f32(NP), om: f32(NP), tx: f32(NP), ty: f32(NP), txn: f32(NP),
    sx: f32(NP), sy: f32(NP), sz: f32(NP), r1: f32(NP), r2: f32(NP), r3: f32(NP), grp: new Uint8Array(NP),
    X: f32(NP), Y: f32(NP), Z: f32(NP),
  });
  for (let i = 0; i < NP; i++) {
    const rr = 250 * Math.sqrt(R()), aa = R() * TAU;
    P.dx[i] = W / 2 + Math.cos(aa) * rr; P.dy[i] = H / 2 + Math.sin(aa) * rr;
    const arm = R() < 0.5 ? 0 : Math.PI;
    const rg = 60 + 760 * Math.pow(R(), 0.8);
    const gs = (R() + R() + R() - 1.5) * 0.5;
    P.rg[i] = rg; P.th[i] = arm + 2.1 * Math.log(rg / 60) + gs;
    P.om[i] = 2.4 / (0.35 + rg / 480);
    const k = Math.floor(R() * (pts.length / 2)) * 2;
    P.tx[i] = pts[k] + (R() - 0.5) * 2; P.ty[i] = pts[k + 1] + (R() - 0.5) * 2;
    P.txn[i] = (P.tx[i] - minx) / (maxx - minx);
    const yy = 1 - (2 * (i + 0.5)) / NP, rad = Math.sqrt(1 - yy * yy), ph = i * 2.399963;
    P.sx[i] = Math.cos(ph) * rad; P.sy[i] = yy; P.sz[i] = Math.sin(ph) * rad;
    P.r1[i] = R(); P.r2[i] = R(); P.r3[i] = R();
    const q = R();
    P.grp[i] = rg < 190 ? (q < 0.5 ? 0 : 1) : rg < 460 ? (q < 0.75 ? 2 : 1) : (q < 0.65 ? 3 : 4);
  }
}
const PCOL = [C.paper, C.sun, C.ember, C.pink, C.violet];

function sParticles(t) {
  const c = ctx;
  c.fillStyle = C.ink; c.fillRect(0, 0, W, H);
  const u = t - 6;
  const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 950);
  g.addColorStop(0, 'rgba(123,77,255,0.16)'); g.addColorStop(0.5, 'rgba(43,59,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const da = 1 - prog(u, 0, 0.07);
  if (da > 0) { c.globalAlpha = da; c.fillStyle = C.ember; circle(c, W / 2, H / 2, 250 * (1 + 0.15 * (1 - da))); c.fill(); c.globalAlpha = 1; }

  const cx = W / 2, cy = H / 2, gr = -0.32, cg = Math.cos(gr), sg = Math.sin(gr);
  const eA = E.outExpo(prog(u, 0, 0.8));
  const ry = u * 0.6, cry = Math.cos(ry), sry = Math.sin(ry), tl = 0.42, ctl = Math.cos(tl), stl = Math.sin(tl);
  const { X, Y, Z } = P;
  for (let i = 0; i < NP; i++) {
    const th = P.th[i] + P.om[i] * u;
    const rr = P.rg[i] * (1 + 0.06 * Math.sin(u * 4 + i));
    const gx = Math.cos(th) * rr, gy = Math.sin(th) * rr * 0.48;
    let x = lerp(P.dx[i], cx + gx * cg - gy * sg, eA);
    let y = lerp(P.dy[i], cy + gx * sg + gy * cg, eA);
    const kick = Math.sin(Math.PI * clamp(eA * 1.15)) * P.r1[i] * 110;
    const ddx = P.dx[i] - cx, ddy = P.dy[i] - cy, dl = Math.hypot(ddx, ddy) + 1e-3;
    x += (ddx / dl) * kick; y += (ddy / dl) * kick;
    const dB = 0.8 + 0.24 * P.txn[i] + 0.06 * P.r2[i];
    const eB = E.inOutCubic(prog(u, dB, dB + 0.36));
    if (eB > 0) {
      x = lerp(x, P.tx[i], eB);   // the word holds still (a shimmer here strobes its every pixel: flash)
      y = lerp(y, P.ty[i], eB);
    }
    const dC = 1.5 + 0.12 * P.r3[i];
    const eC = E.inOutExpo(prog(u, dC, dC + 0.4));
    let z = 0;
    if (eC > 0) {
      const x1 = P.sx[i] * cry + P.sz[i] * sry, z1 = -P.sx[i] * sry + P.sz[i] * cry;
      const y2 = P.sy[i] * ctl - z1 * stl, z2 = P.sy[i] * stl + z1 * ctl;
      const pr = (H * 1.37) / (5 - z2);
      x = lerp(x, cx + x1 * pr, eC); y = lerp(y, cy - y2 * pr, eC);
      z = z2 * eC;
    }
    X[i] = x; Y[i] = y; Z[i] = z;
  }
  c.globalCompositeOperation = 'lighter';
  const tf = 1 + 0.45 * E.inOutCubic(prog(u, 0.9, 1.2)) * (1 - 0.5 * prog(u, 1.5, 1.8));
  const sph = 1 - 0.5 * E.inOutExpo(prog(u, 1.5, 1.9));   // the turning sphere is dimmer: each dot crossing a pixel stays faint
  for (let b = 0; b < 3; b++) {
    const zl = b === 0 ? -2 : b === 1 ? -0.33 : 0.33, zh = b === 0 ? -0.33 : b === 1 ? 0.33 : 2;
    const sz = (b === 0 ? 1.9 : b === 1 ? 2.7 : 3.3) * tf;
    c.globalAlpha = (b === 0 ? 0.25 : b === 1 ? 0.45 : 0.55) * sph;   // lighter blending builds the bright core; one dot passing stays faint
    for (let gi = 0; gi < 5; gi++) {
      c.fillStyle = PCOL[gi];
      c.beginPath();
      for (let i = 0; i < NP; i++) {
        if (P.grp[i] !== gi || Z[i] < zl || Z[i] >= zh) continue;
        c.rect(X[i] - sz / 2, Y[i] - sz / 2, sz, sz);
      }
      c.fill();
    }
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}

// ============================================================ 04 3D SDF (8-10 s)
function blobParams(t) {
  const m = snap(prog(t, 8.5, 8.85)) + snap(prog(t, 9.0, 9.35)) + snap(prog(t, 9.5, 9.85));
  const pulse = 0.35 + env(t, TL.kicks, 6) * 0.3;   // a gentle pulse on the kick: a strong one strobed the film's colours
  const orb = 1.75 * snap(prog(t, 8.05, 8.8));
  const dist = lerp(5.0, 4.35, E.inOutCubic(prog(t, 8.0, 10.0)));
  return [m, pulse, orb, dist];
}
function callout(c, t, t0, t1, ax, ay, bx, by, ex, title, sub) {
  const a = 1 - prog(t, t1 - 0.12, t1);
  if (t < t0 || a <= 0) return;
  const e1 = E.outExpo(prog(t, t0, t0 + 0.28)), e2 = E.outExpo(prog(t, t0 + 0.12, t0 + 0.45));
  c.save();
  c.globalAlpha = a;
  c.strokeStyle = rgba(C.paper, 0.9); c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(ax, ay); c.lineTo(lerp(ax, bx, e1), lerp(ay, by, e1));
  if (e2 > 0) { c.moveTo(bx, by); c.lineTo(lerp(bx, ex, e2), by); }
  c.stroke();
  c.fillStyle = C.paper; circle(c, ax, ay, 4.5 * spring(t - t0, 4, 0.4)); c.fill();
  const pu = ((t - t0) * 1.6) % 1;
  c.strokeStyle = rgba(C.paper, 0.6 * (1 - pu)); circle(c, ax, ay, 5 + 18 * pu); c.stroke();
  const right = ex > bx;
  c.font = F.mono(19); c.letterSpacing = '3px';
  c.textAlign = right ? 'left' : 'right';
  const p = prog(t, t0 + 0.2, t0 + 0.55);
  c.fillText(scramble(title, p, t, 7), right ? bx + 6 : bx - 6, by - 14);
  c.font = F.monoR(15); c.fillStyle = rgba(C.paper, 0.55);
  c.fillText(scramble(sub, prog(t, t0 + 0.3, t0 + 0.7), t, 11), right ? bx + 6 : bx - 6, by + 28);
  c.restore();
}
function s3D(t) {
  const c = ctx;
  callout(c, t, 8.2, 9.75, W / 2 + 190, H / 2 - 150, W / 2 + 420, H / 2 - 300, W / 2 + 760, 'SDF · SMOOTH UNION', 'smin(a, b, k = 0.50)');
  callout(c, t, 8.55, 9.75, W / 2 - 210, H / 2 + 160, W / 2 - 440, H / 2 + 310, W / 2 - 800, 'IRIDESCENT THIN FILM', '120 RAY STEPS / PIXEL');
  // shape name ticker bottom center
  const names = ['SPHERE', 'TORUS', 'TWISTED BOX', 'OCTAHEDRON'];
  const idx = t < 8.5 ? 0 : t < 9.0 ? 1 : t < 9.5 ? 2 : 3;
  const st = [8.0, 8.5, 9.0, 9.5][idx];
  const a = 1 - prog(t, 9.62, 9.72);
  c.save();
  c.globalAlpha = a;
  c.font = F.monoR(17); c.letterSpacing = '6px'; c.textAlign = 'center'; c.fillStyle = rgba(C.paper, 0.8);
  c.fillText(scramble(`[ ${names[idx]} ]`, prog(t, st, st + 0.2), t, idx), W / 2, H - 150);
  c.restore();
}

// ============================================================ 05 LIQUID (9.65-12 s)
function liquidBlobs(t) {
  const arr = new Float32Array(48);
  const kE = env(t, TL.kicks, 7);
  for (let k = 0; k < 11; k++) {
    const ph = hash(k * 1.9) * TAU, sp = 0.6 + 0.5 * hash(k * 2.3);
    let x = 0.66 * Math.sin(t * sp * 0.9 + ph) * (0.55 + 0.45 * hash(k * 4.1));
    let y = 0.26 * Math.sin(t * sp * 1.3 + ph * 1.7) + 0.04;
    let r = (0.05 + 0.085 * hash(k * 5.7)) * (1 + 0.03 * kE);
    // mitosis at 10.5: blob 0 and 1 share a start point and separate
    if (k < 2) {
      const sep = E.outBack(prog(t, 10.5, 10.9), 2.2);
      const bx = 0.05 * Math.sin(t * 1.3), by = 0.02;
      x = lerp(bx, x, sep); y = lerp(by, y, sep);
      r = lerp(0.14, r, sep);
    }
    const em = snap(prog(t, 10.0 + k * 0.025, 10.5 + k * 0.025));
    y = lerp(-0.6, y, em);
    const dr = prog(t, 11.42 + hash(k * 3) * 0.14, 11.82 + hash(k * 3) * 0.14);
    y = lerp(y, -0.3, E.inQuad(dr));
    r *= 1 - 0.85 * E.inQuad(dr);
    arr.set([x, y, r, 0], k * 4);
  }
  return arr;
}
// The liquid's surface rises from below the frame into place on the cut at 10 s. (It used to flood over the 3D blob and
// drain away, with drops falling first: five changes on every pixel within a second, a flash.)
function liquidFlood(t) {
  let top = lerp(-0.75, -0.43, snap(prog(t, 10.0, 10.42)));
  top = lerp(top, -0.25, E.inOutCubic(prog(t, 11.5, 11.9)));
  const bottom = lerp(-3, -0.2535, E.inOutCubic(prog(t, 11.66, 12.0)));
  const waves = 1 - E.inOutCubic(prog(t, 11.7, 12.0));
  return [top, bottom, waves, 1];
}
function sLiquidText(t) {
  const c = ctx;
  const size = 470, font = F.cond(size), word = 'LIQUID';
  const m = measure(font, word);
  const x0 = (W - m.total) / 2, base = H / 2 + size * 0.36;
  c.font = font; c.fillStyle = C.paper;
  for (let i = 0; i < word.length; i++) {
    const bob = 16 * Math.sin(t * 3.2 + i * 0.9);
    const sink = 900 * E.inQuad(prog(t, 11.35 + i * 0.03, 11.75 + i * 0.03));
    // each letter fades up where it floats (a letter sliding in swept every pixel under it: flash)
    const k = snap(prog(t, 10.0 + i * 0.04, 10.55 + i * 0.04));
    c.globalAlpha = k;
    c.fillText(word[i], x0 + m.xs[i], base + bob + sink + (1 - k) * 60);
  }
  c.globalAlpha = 1;
}

// ============================================================ 06 DATA (12-14 s)
function catmull(pts, samples) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < samples; s++) {
      const u = s / samples, u2 = u * u, u3 = u2 * u;
      const f = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const DATA = (() => {
  const by = 810, x0 = 160, x1 = 1200, NL = 13;
  const pts = [];
  for (let i = 0; i < NL; i++) pts.push([x0 + (i * (x1 - x0)) / (NL - 1), by - (90 + 250 * (0.5 + 0.5 * Math.sin(i * 0.95 + 0.4)) * (0.55 + 0.45 * hash(i * 5.1)))]);
  return { by, x0, x1, pts, curve: catmull(pts, 24) };
})();
function odometer(c, value, x, y, size) {
  c.font = F.cond(size);
  const dw = c.measureText('0').width, lh = size * 0.8;
  const places = [1000, 100, 10, 1];
  let xx = x;
  places.forEach((pl, idx) => {
    const v = value / pl;
    const d = Math.floor(v) % 10, f = pl === 1 ? v - Math.floor(v) : clamp((value % pl) - (pl - 1), 0, 1);
    const lead = value < pl && pl > 1;
    c.save();
    c.beginPath(); c.rect(xx - 4, y - size * 0.76, dw + 8, size * 0.84); c.clip();
    c.fillStyle = lead ? rgba(C.paper, 0.18) : C.paper;
    c.fillText(String(d), xx, y - f * lh);
    c.fillText(String((d + 1) % 10), xx, y - f * lh + lh);
    c.restore();
    xx += dw;
    if (idx === 0) { c.fillStyle = value >= 1000 ? C.paper : rgba(C.paper, 0.18); c.fillText(',', xx, y); xx += c.measureText(',').width; }
  });
}
function sData(t) {
  const c = ctx;
  c.fillStyle = C.ink; c.fillRect(0, 0, W, H);
  const { by, x0, x1, pts, curve } = DATA;
  const col = 1 - E.inExpo(prog(t, 13.55, 13.97));
  c.save();
  c.translate(W / 2, H / 2); c.rotate((1 - col) * 0.35); c.scale(col, col); c.translate(-W / 2, -H / 2);
  // baseline (continues the liquid line)
  const bl = snap(prog(t, 12.0, 12.4));
  const lx0 = lerp(0, x0, bl), lx1 = lerp(W, 1760, bl);
  c.fillStyle = C.paper; c.fillRect(lx0, by - 2, lx1 - lx0, 4);
  // grid
  c.font = F.monoR(16); c.textAlign = 'right';
  for (let k = 1; k <= 4; k++) {
    const e = E.outExpo(prog(t, 12.05 + k * 0.05, 12.5 + k * 0.05));
    const y = by - k * 95;
    c.fillStyle = rgba(C.paper, 0.13); c.fillRect(x0, y, (x1 - x0) * e, 1.5);
    c.fillStyle = rgba(C.paper, 0.45 * e); c.fillText(String(k * 25), x0 - 16, y + 5);
  }
  c.textAlign = 'left';
  // bars
  const NB = 24, bw = 26, step = (x1 - x0) / NB;
  const grad = c.createLinearGradient(0, by - 400, 0, by);
  grad.addColorStop(0, C.lime); grad.addColorStop(1, 'rgba(43,59,255,0.85)');
  const kE = env(t, TL.kicks, 8), hE = env(t, TL.hats, 14);
  c.fillStyle = grad;
  for (let i = 0; i < NB; i++) {
    const target = 40 + 290 * (0.5 + 0.5 * Math.sin(i * 0.42 + 0.3)) * (0.5 + 0.5 * hash(i * 3.3));
    const sp = spring(t - (12.1 + i * 0.02), 2.8, 0.4);
    const react = t > 12.8 ? 1 + 0.3 * kE * (0.5 + 0.5 * Math.sin(i * 1.9)) + 0.14 * hE * hash(i * 7.7) : 1;
    const h = Math.max(0, target * sp * react);
    c.fillRect(x0 + i * step + (step - bw) / 2, by - 2 - h, bw, h);
  }
  // line chart
  const hp = E.inOutCubic(prog(t, 12.45, 13.25));
  const headX = lerp(x0, x1, hp);
  if (hp > 0) {
    c.save();
    c.beginPath(); c.rect(0, 0, headX, H); c.clip();
    const ag = c.createLinearGradient(0, by - 360, 0, by);
    ag.addColorStop(0, rgba(C.ember, 0.4)); ag.addColorStop(1, rgba(C.ember, 0));
    c.beginPath(); c.moveTo(curve[0][0], curve[0][1]);
    for (const p of curve) c.lineTo(p[0], p[1]);
    c.lineTo(x1, by); c.lineTo(x0, by); c.closePath();
    c.fillStyle = ag; c.fill();
    c.beginPath(); c.moveTo(curve[0][0], curve[0][1]);
    for (const p of curve) c.lineTo(p[0], p[1]);
    c.strokeStyle = C.ember; c.lineWidth = 5; c.lineJoin = 'round'; c.stroke();
    c.restore();
    pts.forEach((p, i) => {
      const tp = 12.45 + 0.8 * (i / (pts.length - 1));
      if (p[0] > headX + 0.5) return;
      const s = spring(t - tp, 4, 0.4);
      c.fillStyle = C.ink; c.strokeStyle = C.ember; c.lineWidth = 3;
      circle(c, p[0], p[1], 7 * s); c.fill(); c.stroke();
    });
    let hy = curve[0][1];
    for (let i = 1; i < curve.length; i++) if (curve[i][0] >= headX) {
      const a = curve[i - 1], b = curve[i];
      hy = lerp(a[1], b[1], (headX - a[0]) / (b[0] - a[0] || 1));
      break;
    }
    c.fillStyle = C.paper; circle(c, headX, hy, 9); c.fill();
    const pu = (t * 3) % 1;
    c.strokeStyle = rgba(C.paper, 0.7 * (1 - pu)); c.lineWidth = 2; circle(c, headX, hy, 10 + 22 * pu); c.stroke();
    c.font = F.mono(18); c.fillStyle = C.paper;
    c.fillText(((by - hy) / 3.8).toFixed(1), headX + 18, hy - 16);
  }
  // counter
  c.save();
  c.font = F.mono(18); c.letterSpacing = '5px'; c.fillStyle = C.ember;
  c.fillText(scramble('FRAMES RENDERED', prog(t, 12.1, 12.45), t, 5), x0, 170);
  c.restore();
  odometer(c, counterValue(t), x0, 360, 210);
  c.save();
  c.font = F.monoR(16); c.letterSpacing = '3px'; c.fillStyle = rgba(C.paper, 0.55);
  c.fillText(scramble('60 FPS  ·  8X SUBFRAME MOTION BLUR', prog(t, 12.4, 12.9), t, 9), x0, 400);
  c.restore();
  // donut
  const dx = 1530, dy = 490;
  [[195, C.ember, 12.3, 13.2], [155, C.cobalt, 12.42, 13.32], [115, C.lime, 12.54, 13.44]].forEach(([r, colr, a0, a1]) => {
    const ap = snap(prog(t, 12.1, 12.5));
    c.lineWidth = 26;
    c.strokeStyle = rgba(C.paper, 0.07);
    c.beginPath(); c.arc(dx, dy, r * ap, 0, TAU); c.stroke();
    const p = E.inOutCubic(prog(t, a0, a1));
    if (p > 0) {
      c.strokeStyle = colr; c.lineCap = 'round';
      c.beginPath(); c.arc(dx, dy, r, -Math.PI / 2, -Math.PI / 2 + TAU * p * 0.9999); c.stroke();
      c.lineCap = 'butt';
    }
  });
  c.font = F.cond(62); c.textAlign = 'center'; c.fillStyle = rgba(C.paper, snap(prog(t, 12.15, 12.45)));
  c.fillText(Math.round(100 * E.inOutCubic(prog(t, 12.3, 13.2))) + '%', dx, dy + 22);
  c.save();
  c.font = F.mono(16); c.letterSpacing = '5px'; c.fillStyle = rgba(C.paper, 0.75);
  c.fillText(scramble('MADE WITH CODE', prog(t, 12.6, 13.0), t, 13), dx, dy + 262);
  c.restore();
  c.textAlign = 'left';
  c.restore();
}

// ============================================================ 07 STYLE FRAMES (14-16 s)
const CODE_LINES = [
  ['float d = smin(shapeSD(i0,q), shapeSD(i1,q), 0.5);', 0],
  ['const e = spring(t - 2.5, 2.9, 0.36);', 1],
  ['for (let s = 0; s < SUB; s++) accumulate(t + s/SUB/FPS);', 1],
  ['vec3 irid = 0.5 + 0.5*cos(TAU*(vec3(0,.33,.67) + nv));', 0],
  ['col += texture(uB1, uv).rgb * uBloom;', 0],
  ['ctx.fillText(word[i], x0 + m.xs[i], base + yoff);', 1],
  ['duck.gain.setTargetAtTime(1, k + 0.02, 0.07);', 1],
  ['float ring = exp(-pow((r - uP.y) * 30., 2.));', 0],
  ['P.th[i] = arm + 2.1 * Math.log(rg / 60) + gs;', 1],
  ['o = vec4(clamp(col, 0., 1.), 1.);', 0],
];
function codeScroll(c, t) {
  c.font = F.monoR(24);
  const lh = 40, scroll = t * 220;
  for (let k = -1; k < 30; k++) {
    const idx = ((k + Math.floor(scroll / lh)) % CODE_LINES.length + CODE_LINES.length) % CODE_LINES.length;
    const y = k * lh - (scroll % lh) + 40;
    const [line] = CODE_LINES[idx];
    const parts = line.split(/(\b(?:float|const|let|for|vec3|vec4)\b|\d+\.?\d*)/);
    let x = 90 + (idx % 3) * 40;
    for (const part of parts) {
      if (!part) continue;
      c.fillStyle = /^(float|const|let|for|vec3|vec4)$/.test(part) ? rgba(C.ember, 0.55) : /^\d/.test(part) ? rgba(C.lime, 0.5) : rgba(C.paper, 0.22);
      c.fillText(part, x, y);
      x += c.measureText(part).width;
    }
  }
}
function bigWord(c, word, font, color, lt, opts = {}) {
  const sc = 1 + (opts.zoom ?? 0.22) * (1 - snap(prog(lt, 0, 0.2)));
  c.save();
  if (lt < 0) return;
  c.translate(W / 2 + (opts.ox || 0) + (opts.dx || 0) * (1 - snap(prog(lt, 0, 0.18))), H / 2 + (opts.oy || 0));
  c.scale(sc, sc);
  if (opts.skew) c.transform(1, 0, -opts.skew * (1 - snap(prog(lt, 0, 0.2))), 1, 0, 0);
  c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
  if (opts.track) c.letterSpacing = `${opts.track(lt)}px`;
  if (opts.box) {
    const w = c.measureText(word).width;
    c.fillStyle = opts.box; c.fillRect(-w / 2 - 40, -opts.boxH / 2, w + 80, opts.boxH);
  }
  c.fillStyle = color;
  c.fillText(word, 0, opts.dy || 0);
  c.restore();
}
function montage(t, cfg) {
  const c = ctx;
  // Four style frames of half a second, two words each: the first lands on the frame's cut, the second joins it on the
  // next beat (TL.cuts still marks every quarter second for the music). A cut a quarter second apart over every shader
  // look flipped most of the picture four times a second, and anything moving inside a frame then made it a strobe
  // (flash); half-second frames that hold still under their words keep the pace on the grid without one.
  const k = Math.min(3, Math.floor((t - 14) / 0.5)), lt = t - 14 - k * 0.5, lt2 = lt - 0.25;
  switch (k) {
    case 0:
      cfg.scene = 5;
      bigWord(c, 'I', F.didone(620), C.ink, lt, { ox: -430, dy: 30, zoom: 0 });
      bigWord(c, 'MAKE', F.cond(430), C.ink, lt2, { ox: 150, dy: 18, zoom: 0 });
      break;
    case 1:
      cfg.scene = 4; cfg.P = [4, 0.3, 1.6, 3.9];
      bigWord(c, 'PIXELS', F.mono(170), C.ink, lt, { oy: -170, box: C.lime, boxH: 180, dy: 8, zoom: 0 });
      bigWord(c, 'MOVE', F.cond(330), C.paper, lt2, { oy: 170, dy: 18, zoom: 0 });
      break;
    case 2: {
      cfg.scene = 7;
      const band = 1;
      c.fillStyle = C.ink; c.fillRect(0, H / 2 - 330 * band, W, 660 * band);
      bigWord(c, 'with', F.didone(260), C.paper, lt, { oy: -150, dy: 20, zoom: 0 });
      bigWord(c, 'NOTHING', F.geo(220), C.paper, lt2, { oy: 140, track: () => 30, dy: 10, zoom: 0 });
      break;
    }
    case 3:
      c.fillStyle = C.ink; c.fillRect(0, 0, W, H);
      codeScroll(c, t);
      bigWord(c, 'BUT', F.heavy(280), C.paper, lt, { oy: -170, dy: 20, zoom: 0 });
      if (lt2 >= 0) {
        bigWord(c, 'CODE', F.mono(300), C.lime, lt2, { oy: 150, dy: 10, zoom: 0 });
        c.font = F.mono(300); const w = c.measureText('CODE').width;
        if (Math.floor(t * 4) % 2 === 0) { c.fillStyle = C.lime; c.fillRect(W / 2 + w / 2 + 20, H / 2 + 150 - 115, 36, 230); }
      }
      break;
  }
  cfg.cam = [1, 0, 0, 0];
}

// ============================================================ 08 MARK + END CARD (16-20 s)
// The studio's mark, drawn for this reel: an orrery. A core, two tilted orbits that draw themselves on, and
// twelve planets that pop onto them one by one, on the times audio.js plucks (TL.marks), and keep orbiting.
const ORBITS = [{ r: 178, tilt: -0.42, sq: 0.42, dir: 1, speed: 0.55 }, { r: 112, tilt: 0.55, sq: 0.5, dir: -1, speed: 0.9 }];
const PLANETS = Array.from({ length: 12 }, (_, k) => ({ orbit: k % 2, phase: (k / 12) * TAU + (hash(k * 5.3) - 0.5) * 0.3, size: 11 + 8 * hash(k * 3.1 + 2) }));
function orbitPoint(o, a) {
  const x = Math.cos(a) * o.r, y = Math.sin(a) * o.r * o.sq;
  return [x * Math.cos(o.tilt) - y * Math.sin(o.tilt), x * Math.sin(o.tilt) + y * Math.cos(o.tilt)];
}
const LOCK = {};
function lockup() {
  if (LOCK.lx) return LOCK;
  const m = measure(F.cond(290), WORDMARK), textW = m.total + 5 * 8, logoR = 180 * 0.78, gap = 70;
  const total = logoR * 2 + gap + textW, left = W / 2 - total / 2;
  LOCK.lx = left + logoR; LOCK.tx0 = left + logoR * 2 + gap;
  return LOCK;
}
function logoLayout(t) {
  lockup();
  const lock = swift(prog(t, 16.55, 17.1));
  const out = E.inOutCubic(prog(t, 19.25, 19.6));
  const scale = lerp(1, 0.78, lock);
  const lx = lerp(lerp(W / 2, LOCK.lx, lock), W / 2, out), ly = lerp(lerp(H / 2, H / 2 - 40, lock), H / 2, out);
  return { lx, ly, scale, lock, out };
}
function sClimax(t, cfg) {
  const c = ctx;
  const { lx, ly, scale, lock, out } = logoLayout(t);
  const u = t - 16;
  // speed streaks from impact
  if (u < 0.6) {
    const e = E.outExpo(prog(u, 0, 0.6));
    c.strokeStyle = rgba(C.paper, 0.9 * (1 - prog(u, 0.1, 0.6))); c.lineCap = 'round';
    for (let k = 0; k < 90; k++) {
      const a = hash(k * 1.7) * TAU, sp = 300 + 1500 * hash(k * 2.9);
      const r1 = sp * e, r0 = Math.max(0, r1 - 40 - 220 * (1 - e));
      c.lineWidth = 1 + 3 * hash(k * 4.1);
      c.beginPath(); c.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); c.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); c.stroke();
    }
    c.lineCap = 'butt';
  }
  // the mark: an orrery that draws its orbits, pops its planets on, turns slowly, and pops out with the wordmark
  const spin = -0.3 * (1 - spring(u, 1.3, 0.45)) + 0.02 * Math.sin(t * 1.5) + (t > 18 ? (t - 18) * 0.04 : 0);
  const retract = E.inBack(prog(t, 19.25, 19.6), 1.6);
  const coreS = t < 19.6 ? spring(u, 3, 0.4) : 1;
  const popT = prog(t, 19.62, 19.8);
  const popS = popT <= 0 ? 1 : popT < 0.35 ? 1 + 0.5 * E.outCubic(popT / 0.35) : Math.max(0, 1.5 * (1 - E.inExpo((popT - 0.35) / 0.65)));
  c.save();
  c.translate(lx, ly); c.scale(scale, scale); c.rotate(spin);
  c.strokeStyle = C.ember; c.lineCap = 'round'; c.lineWidth = 9;
  ORBITS.forEach((o, i) => {
    const on = snap(prog(t, 16.04 + i * 0.1, 16.6 + i * 0.1)) * (1 - retract);
    if (on <= 0.001) return;
    const a0 = (-Math.PI / 2) * o.dir, N = 96;
    c.beginPath();
    for (let n = 0; n <= N; n++) { const [x, y] = orbitPoint(o, a0 + (o.dir * TAU * on * n) / N); if (n) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke();
  });
  PLANETS.forEach((p, k) => {
    const s = clamp(spring(t - markStart(k), 4, 0.42), 0, 1.4) * (1 - retract);
    if (s <= 0.01) return;
    const o = ORBITS[p.orbit], [x, y] = orbitPoint(o, p.phase + o.dir * (t - 16) * o.speed);
    c.fillStyle = k % 3 === 0 ? C.paper : C.ember;
    circle(c, x, y, p.size * s); c.fill();
  });
  c.fillStyle = t < 19.3 ? C.ember : C.paper;
  circle(c, 0, 0, 34 * coreS * popS); c.fill();
  c.restore();
  c.lineCap = 'butt';
  // wordmark
  const wm = WORDMARK, size = 290, font = F.cond(size);
  const m = measure(font, wm);
  const tx0 = LOCK.tx0, base = H / 2 - 40 + size * 0.36;
  if (t > 16.6 && out < 1) {
    const trackA = lerp(46, 8, snap(prog(t, 16.7, 17.5)));
    c.save();
    c.beginPath(); c.rect(tx0 - 40, base - size * 0.8, 1300, size * 0.95); c.clip();
    c.font = font; c.fillStyle = C.paper;
    for (let i = 0; i < wm.length; i++) {
      const d = 16.7 + i * 0.05;
      const e = snap(prog(t, d, d + 0.55));
      const drop = E.inCubic(prog(t, 19.15 + i * 0.02, 19.4 + i * 0.02));
      const y = base + (1 - e) * size * 0.9 + drop * size;
      c.fillText(wm[i], tx0 + m.xs[i] + i * trackA, y);
    }
    // glint
    const gp = prog(t, 18.35, 18.85);
    if (gp > 0 && gp < 1) {
      c.globalCompositeOperation = 'source-atop';
      const gx = lerp(tx0 - 300, tx0 + m.total + 300, E.inOutCubic(gp));
      const g = c.createLinearGradient(gx - 140, 0, gx + 140, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,190,150,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.setTransform(S, 0, -0.35 * S, S, 0.35 * S * base, 0);
      c.fillRect(tx0 - 400, base - size, m.total + 900, size * 1.2);
      c.globalCompositeOperation = 'source-over';
    }
    c.restore();
    const endW = m.total + 5 * 8;
    // rule
    const re = E.inOutExpo(prog(t, 17.2, 17.7)) * (1 - E.inExpo(prog(t, 19.1, 19.35)));
    c.fillStyle = rgba(C.paper, 0.5);
    c.fillRect(tx0, base + 44, endW * re, 2);
    // subtitle
    const se = snap(prog(t, 17.3, 17.9)), sOut = prog(t, 19.05, 19.25);
    c.save();
    c.beginPath(); c.rect(tx0 - 10, base + 50, 1000, 110); c.clip();
    c.font = F.didone(74); c.fillStyle = C.paper; c.globalAlpha = 1 - sOut;
    c.fillText('development', tx0, base + 128 + (1 - se) * 90);
    c.restore();
    c.save();
    c.font = F.monoR(18); c.letterSpacing = '4px'; c.fillStyle = rgba(C.paper, 0.6 * (1 - sOut)); c.textAlign = 'right';
    c.fillText(scramble('REEL 2026', prog(t, 17.5, 17.9), t, 1), tx0 + endW, base + 115);
    c.fillText(scramble('100% CODE', prog(t, 17.6, 18.0), t, 2), tx0 + endW, base + 145);
    c.restore();
  }
  // footer credit line
  const fa = prog(t, 17.8, 18.1) * (1 - prog(t, 19.0, 19.2));
  if (fa > 0) {
    c.save();
    c.font = F.monoR(16); c.letterSpacing = '5px'; c.textAlign = 'center'; c.fillStyle = rgba(C.paper, 0.45 * fa);
    c.fillText(scramble('WEBGL2 · CANVAS2D · WEBAUDIO  /  NO TEMPLATES, NO PLUGINS, NO KEYFRAMES', prog(t, 17.8, 18.5), t, 4), W / 2, H - 90);
    c.restore();
  }
  // shader background params
  const lp = [(lx - W / 2) / H, -(ly - H / 2) / H];
  const ring = u < 1.2 ? E.outExpo(prog(u, 0, 1.2)) * 1.6 : 0;
  const ring2 = t >= 17 && t < 18 ? E.outExpo(prog(t, 17.0, 18.0)) * 1.2 : 0;
  const rays = (0.32 + 0.9 * Math.exp(-u * 3)) * (1 - prog(t, 19.2, 19.6));
  const neb = 1 - prog(t, 19.2, 19.7);
  cfg.scene = 8;
  cfg.P = [rays, t < 17 ? ring : ring2, t < 17 ? 1 - prog(u, 0.3, 1.2) : 0.7 * (1 - prog(t, 17.2, 18.0)), neb];
  cfg.Q = [lp[0], lp[1], 0, 0];
}

// ============================================================ HUD (composited in the final pass, difference-blended)
const SECTIONS = [[2, '01', 'KINETIC TYPE'], [4, '02', 'SHAPE SYSTEMS'], [6, '03', 'PARTICLES'], [8, '04', '3D / SDF'],
  [10, '05', 'LIQUID'], [12, '06', 'DATA VIZ'], [14, '07', 'STYLE FRAMES']];
export function drawHud(t, fps) {
  const c = hctx;
  c.setTransform(S, 0, 0, S, 0, 0);
  c.clearRect(0, 0, W, H);
  if (t < 1.85 || t >= 15.9) return;
  const a = prog(t, 1.9, 2.15);
  c.globalAlpha = a;
  c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineWidth = 2;
  const m = 44, L = 26;
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    c.beginPath(); c.moveTo(x, y + sy * L); c.lineTo(x, y); c.lineTo(x + sx * L, y); c.stroke();
  }
  c.font = F.mono(16); c.letterSpacing = '4px';
  c.fillText('SABOTAGE', m + 40, m + 26);
  c.font = F.monoR(16);
  c.fillText('MOTION REEL 2026', m + 190, m + 26);
  // rolling section label
  let si = 0;
  for (let i = 0; i < SECTIONS.length; i++) if (t >= SECTIONS[i][0]) si = i;
  const st = SECTIONS[si][0];
  const roll = snap(prog(t, st, st + 0.3));
  c.textAlign = 'right';
  c.save();
  c.beginPath(); c.rect(W - 700, m + 2, 700 - m - 38, 34); c.clip();
  const lab = (s) => `${s[1]} / ${s[2]}`;
  c.fillText(lab(SECTIONS[si]), W - m - 40, m + 26 + (1 - roll) * 34);
  if (si > 0 && roll < 1) c.fillText(lab(SECTIONS[si - 1]), W - m - 40, m + 26 - roll * 34);
  c.restore();
  // timecode
  c.textAlign = 'left';
  const fr = Math.floor(t * fps + 1e-6), ff = fr % fps, ss = Math.floor(fr / fps);
  c.fillText(`00:00:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`, m + 40, H - m - 12);
  c.textAlign = 'right';
  c.fillText('120 BPM', W - m - 64, H - m - 12);
  const kE = env(t, TL.kicks, 10);
  circle(c, W - m - 46, H - m - 18, 5 + 4 * kE); c.fill();
  // progress bar with section ticks
  const bx = W / 2 - 220, bw = 440, byy = H - m - 18;
  c.globalAlpha = a * 0.3; c.fillRect(bx, byy, bw, 2);
  c.globalAlpha = a;
  c.fillRect(bx, byy - 1, bw * (t / 20), 4);
  for (let s = 0; s <= 10; s++) c.fillRect(bx + (bw * s) / 10 - 1, byy - 6, 2, s % 5 === 0 ? 14 : 8);
  c.globalAlpha = 1;
  c.letterSpacing = '0px';
  c.textAlign = 'left';
}

// ============================================================ config per subframe
export async function init({ ctx: c, hud, scale }) {
  S = scale; ctx = c; hctx = hud;
  initParticles();
}

export function frame(t, jit) {
  const c = ctx;
  c.setTransform(S, 0, 0, S, 0, 0);
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.letterSpacing = '0px';
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.clearRect(0, 0, W, H);
  const cfg = { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0] };
  const kE = env(t, TL.kicks, 9);
  let zoom = 1, ox = 0, oy = 0;
  if (t < 2) sIntro(t);
  else if (t < 3.5) sKinetic(t);
  else if (t < 4) kineticExit(t);
  else if (t < 6) sGrid(t);
  else if (t < 8) sParticles(t);
  else if (t < 10) {
    cfg.scene = 1; cfg.P = blobParams(t);
    s3D(t);
  } else if (t < 12) {
    cfg.scene = 2; cfg.Q = liquidFlood(t); cfg.blobs = liquidBlobs(t);
    sLiquidText(t); cfg.consume2D = true;
  } else if (t < 14) sData(t);
  else if (t < 16) montage(t, cfg);
  else sClimax(t, cfg);

  if (t >= 2 && t < 14) zoom += 0.012 * kE;
  // impact shakes
  const shake = (t0, amp, dec) => {
    if (t < t0) return;
    const d = Math.exp(-(t - t0) * dec) * amp;
    ox += noise1(t * 40 + t0 * 3) * d; oy += noise1(t * 43 + 17 + t0) * d;
  };
  shake(2.0, 0.012, 9); shake(2.62, 0.02, 10); shake(6.0, 0.012, 8); shake(16.0, 0.03, 6);
  if (ox || oy) zoom += Math.hypot(ox, oy) * 2.2;
  if (t < 14 || t >= 16) cfg.cam = [zoom, 0, ox, oy];
  return cfg;
}

export function post(t) {
  const kE = env(t, TL.kicks, 9);
  const p = { t, bloom: 0.55, thr: 0.62, ca: 0.0012 + 0.003 * kE, glitch: 0, grain: 0.032, vig: 0.32, flash: 0, fade: 1, hud: 1 };
  const sec = (a, b) => t >= a && t < b;
  if (sec(0, 2)) { p.bloom = 0.45; p.thr = 0.55; }
  else if (sec(2, 6)) { p.bloom = 0.3; p.thr = 1.05; p.grain = 0.026; }
  else if (sec(6, 8)) { p.bloom = 0.95; p.thr = 0.5; }
  else if (sec(8, 10)) { p.bloom = 0.6; p.thr = 0.7; }
  else if (sec(10, 12)) { p.bloom = 0.45; p.thr = 0.85; }
  else if (sec(12, 14)) { p.bloom = 0.5; p.thr = 0.8; }
  else if (sec(14, 16)) { p.bloom = 0.3; p.thr = 0.95; p.ca += 0.002; }
  else { p.bloom = 0.8; p.thr = 0.96; if (t < 16.6) { p.bloom = 1.0; p.thr = 0.6; } }
  const flash = (t0, a, d) => { if (t >= t0) p.flash = Math.max(p.flash, a * Math.exp(-(t - t0) * d)); };
  flash(2.0, 0.3, 12); flash(6.0, 0.35, 10); flash(8.0, 0.25, 10); flash(16.0, 0.35, 6);
  for (const tc of TL.cuts) if (t >= tc && !(tc > 14 && tc < 16)) p.glitch = Math.max(p.glitch, 0.75 * Math.exp(-(t - tc) * 40));
  p.glitch = Math.max(p.glitch, 0.6 * prog(t, 13.7, 14.0) * (t < 14 ? 1 : 0));
  p.fade = 1 - prog(t, 19.82, 19.97);   // it opens on the dot (the first frame is the thumbnail) and fades out at the end
  return p;
}

// Extra motion-blur subframes for the few ultra-fast moves (avoids stepped ghosting on whip transitions).
export function subBoost(t) {
  if (t >= 3.5 && t < 3.95) return 4;
  if (t >= 13.55 && t < 14.0) return 3;
  if ((t >= 1.6 && t < 2.0) || (t >= 5.5 && t < 6.0) || (t >= 16.0 && t < 16.35) || (t >= 6.0 && t < 6.3)) return 2;
  return 1;
}
