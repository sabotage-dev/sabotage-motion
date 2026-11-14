// check.mjs: the detectors behind `node render.mjs check` (plan sections 6.5, 11 and 12).
//
// render.mjs gathers the measurements (the page renders probe frames and samples boxes(t); ffprobe and
// ffmpeg read the file) and passes them here. Everything below is a plain function of those measurements,
// so each detector and threshold can be tested without a browser.
//
// A result is { id, scope, level, t?, detail, measured, threshold }:
//   scope  'source' (the piece as it is now, 11.1 and 6.5) or 'file' (the --file artifact, 11.2)
//   level  'FAIL' | 'WARN' | 'OK' | 'SKIP' (SKIP: not checked, and `detail` says why)
//   t      picture time in seconds where the problem starts, when there is one
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------- thresholds
// Starting values from the plan, tuned in P3 (references/check.md records the measurement behind each).
export const T = {
  probeScale: 0.5,                              // renderProbe at 1/2 of the design size, 1 subframe, grain 0
  motion: { delta: 2, pixels: 4, run: 3.0 },    // a pair moves when >= 4 probe pixels change by >= 2/255 luma; flag runs >= 3.0 s
  firstFrame: { std: 4 },                       // luma standard deviation under 4/255: a flat first frame
  textSafe: { fail: 0.25 },                     // more than 0.25 s outside the safe area in one beat: FAIL (measured zones)
  overlap: { ratio: 0.02 },                     // two boxes of different groups overlap by more than 2% of the smaller
  copyUnread: { min: 1.0, perWord: 0.25 },      // a board string on screen for less than max(1.0, 0.25 x words) s
  sfx: { win: 0.050, db: -40, hitWin: 0.010, hitPre: 0.100, hitDb: 12, hop: 0.001 },
  spike: { win: 0.050, db: 18, pct: 0.9, floor: -60 },   // the loudest 50 ms window vs the 90th percentile of the non-silent ones
  loudness: { lu: 1.0, tp: -1.0 },
};
const EPS = 1e-9;

export const SOURCE_IDS = ['fonts', 'board_order', 'hook_long', 'board_copy_missing', 'board_copy_unread', 'board_sfx_missing',
  'motion_dead', 'first_frame_empty', 'text_safe', 'text_overlap', 'audio_spike'];
export const FILE_IDS = ['provenance', 'file_spec', 'faststart', 'loudness', 'vo_delay'];
export const ALL_IDS = [...SOURCE_IDS, ...FILE_IDS];

const r = (id, scope, level, detail, extra = {}) => ({ id, scope, level, detail, ...extra });
const ok = (id, scope, detail, extra) => r(id, scope, 'OK', detail, extra);
const skip = (id, scope, why) => r(id, scope, 'SKIP', `not checked: ${why}`);
const f2 = (x) => Number(x).toFixed(2);
const f3 = (x) => Number(x).toFixed(3);
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const dbStr = (x) => (Number.isFinite(x) && x > -200 ? `${x.toFixed(1)} dBFS` : 'silence');

// ---------------------------------------------------------------- camera and boxes
// A design-pixel point (y down, before the camera) mapped through cfg.cam = [zoom, rotation, panX, panY]
// the way the composite shader applies it (shaders.js COMP): the shader samples the 2D layer at
// rot(-r) * p / zoom - pan, so a point of the layer lands at zoom * rot(r) * (p + pan). p is GL-centred
// (y up), x scaled by the aspect ratio.
export function camPoint(x, y, cam, W, H) {
  const [zoom = 1, rot = 0, panX = 0, panY = 0] = cam || [];
  if (zoom === 1 && rot === 0 && panX === 0 && panY === 0) return [x, y];   // exact, so a box on the safe edge stays on it
  const asp = W / H;
  const qx = (x / W - 0.5) * asp + panX, qy = 0.5 - y / H + panY;
  const c = Math.cos(rot), s = Math.sin(rot);
  const ox = zoom * (c * qx - s * qy), oy = zoom * (s * qx + c * qy);
  return [(ox / asp + 0.5) * W, (0.5 - oy) * H];
}
const clipRect = (b, W, H) => {
  const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(W, b.x + b.w), y1 = Math.min(H, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};
// The part of a box the viewer can see, after the camera, as an axis-aligned rectangle in design pixels:
// the box is cut to the canvas (the shader never draws the layer outside it), its corners are mapped through
// the camera, and the result is cut to the frame. Null when none of it is on screen.
export function visibleBox(b, cam, W, H) {
  const c = clipRect(b, W, H);
  if (!c) return null;
  const pts = [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].map(([x, y]) => camPoint(x, y, cam, W, H));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = { x: Math.min(...xs), y: Math.min(...ys) };
  m.w = Math.max(...xs) - m.x; m.h = Math.max(...ys) - m.y;
  return clipRect(m, W, H);
}
export const insideRect = (b, s) => b.x >= s.x - 1e-6 && b.y >= s.y - 1e-6 && b.x + b.w <= s.x + s.w + 1e-6 && b.y + b.h <= s.y + s.h + 1e-6;
export function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
// Boxes in reading order: lines from the top (a box whose centre sits within half the smaller height of a
// line's first box joins that line), then left to right.
export function readingOrder(boxes) {
  const s = [...boxes].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
  const lines = [];
  for (const b of s) {
    const L = lines[lines.length - 1], cy = b.y + b.h / 2;
    if (L && Math.abs(cy - (L[0].y + L[0].h / 2)) < 0.5 * Math.min(b.h, L[0].h)) L.push(b); else lines.push([b]);
  }
  return lines.flatMap((L) => L.sort((a, b) => a.x - b.x));
}
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const words = (s) => String(s).split(/\s+/).filter(Boolean).length;

// The beat window that holds picture time t (windows are half-open and contiguous).
export function windowAt(windows, t) {
  for (const w of windows) if (t >= w.start - EPS && t < w.end - EPS) return w;
  return t >= 0 && windows.length ? windows[windows.length - 1] : null;
}

// Samples from the page: [{ t, n, cam, boxes: [{ id, text, x, y, w, h, group?, deco? }] }], one per subframe
// time the render uses (n subframes in that frame). Each gets `vis`: the boxes on screen, with their visible
// rectangle after the camera (`v`).
export function prepareSamples(samples, W, H) {
  return samples.map((s) => ({ ...s, vis: (s.boxes || []).map((b) => ({ ...b, v: visibleBox(b, s.cam, W, H) })).filter((b) => b.v) }));
}

// ---------------------------------------------------------------- 11.1 source checks

// text_safe: a non-deco box whose visible part leaves the safe area accrues 1 / (n x FPS) s per sample, per
// beat. More than 0.25 s in one beat is a FAIL; less is a WARN (a slam entrance, a whip). Every result is a
// WARN while the target's zones are an estimate.
export function textSafe(samples, { fps, safe, windows, estimate = false, target = '' }) {
  const acc = new Map();
  for (const s of samples) {
    const w = windowAt(windows, s.t), wt = 1 / (s.n * fps);
    for (const b of s.vis) {
      if (b.deco || insideRect(b.v, safe)) continue;
      const k = `${b.id}\u0000${w ? w.id : ''}`;
      const a = acc.get(k) || { id: b.id, text: b.text, beat: w ? w.id : null, exp: 0, t: s.t, worst: 0 };
      a.exp += wt;
      const out = Math.max(safe.x - b.v.x, safe.y - b.v.y, b.v.x + b.v.w - safe.x - safe.w, b.v.y + b.v.h - safe.y - safe.h);
      a.worst = Math.max(a.worst, out);
      acc.set(k, a);
    }
  }
  const zone = `${target ? target + ' ' : ''}safe area${estimate ? ' (estimate)' : ''}`;
  if (!acc.size) return [ok('text_safe', 'source', `every text box stays inside the ${zone}`, { threshold: T.textSafe.fail })];
  return [...acc.values()].sort((a, b) => a.t - b.t).map((a) => {
    const long = a.exp > T.textSafe.fail + EPS;
    return r('text_safe', 'source', long && !estimate ? 'FAIL' : 'WARN',
      `box "${a.text}" (${a.id}) is outside the ${zone} for ${f2(a.exp)} s${a.beat ? ` in beat "${a.beat}"` : ''}, up to ${Math.ceil(a.worst)} px out${long ? '' : ' (a brief excursion: a slam or a whip)'}${long && estimate ? '; a FAIL once the zones are measured' : ''}`,
      { t: +f3(a.t), measured: +a.exp.toFixed(4), threshold: T.textSafe.fail, box: a.id, beat: a.beat });
  });
}

// text_overlap: two non-deco boxes from different groups (a box without a group is its own) intersecting by
// more than 2% of the smaller one's area, at any sample. One WARN per pair. Measured before the camera,
// which moves both boxes alike.
export function textOverlap(samples, { fps }) {
  const acc = new Map();
  for (const s of samples) {
    const bs = s.vis.filter((b) => !b.deco), wt = 1 / (s.n * fps);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if ((a.group ?? `#${a.id}`) === (b.group ?? `#${b.id}`)) continue;
      const ratio = overlapArea(a, b) / Math.max(EPS, Math.min(a.w * a.h, b.w * b.h));
      if (!(ratio > T.overlap.ratio + EPS)) continue;
      const [p, q] = a.id < b.id ? [a, b] : [b, a];
      const k = `${p.id}\u0000${q.id}`;
      const x = acc.get(k) || { p, q, t: s.t, exp: 0, ratio: 0 };
      x.exp += wt; x.ratio = Math.max(x.ratio, ratio);
      acc.set(k, x);
    }
  }
  if (!acc.size) return [ok('text_overlap', 'source', 'no two text boxes from different groups overlap', { threshold: T.overlap.ratio })];
  return [...acc.values()].sort((a, b) => a.t - b.t).map((x) => r('text_overlap', 'source', 'WARN',
    `boxes "${x.p.text}" (${x.p.id}) and "${x.q.text}" (${x.q.id}) overlap by up to ${(x.ratio * 100).toFixed(1)}% of the smaller, for ${f2(x.exp)} s`,
    { t: +f3(x.t), measured: +x.ratio.toFixed(4), threshold: T.overlap.ratio }));
}

// board_copy_missing and board_copy_unread (plan 6.5). For each group (boxes without one share a pool),
// the box texts seen at any sample in the beat's window are joined in order of first appearance (ties in
// reading order), one entry per box id (its longest text, so a word typed on counts whole), and each
// `on` string is searched in that text, case-insensitive, whitespace collapsed. A string that is found is
// on screen while any box it matched is; under max(1.0, 0.25 x words) s of that is unread.
export function boardCopy(samples, { fps, windows }) {
  const missing = [], unread = [];
  let strings = 0;
  for (const w of windows) {
    const on = ((w.beat && w.beat.on) || []).map(String).filter((s) => norm(s));
    if (!on.length) continue;
    const inW = samples.filter((s) => s.t >= w.start - EPS && s.t < w.end - EPS);
    const groups = new Map();       // group -> Map(id -> { text, first, order })
    inW.forEach((s, si) => {
      readingOrder(s.vis).forEach((b, k) => {
        const g = b.group ?? '\u0000';
        if (!groups.has(g)) groups.set(g, new Map());
        const m = groups.get(g), e = m.get(b.id);
        if (!e) m.set(b.id, { id: b.id, text: String(b.text), first: si, order: k });
        else if (String(b.text).length > e.text.length) e.text = String(b.text);
      });
    });
    // id -> exposure-weighted presence per sample index, for the unread measure
    const seen = new Map();
    inW.forEach((s, si) => { for (const b of s.vis) { if (!seen.has(b.id)) seen.set(b.id, new Set()); seen.get(b.id).add(si); } });
    for (const str of on) {
      strings++;
      const want = norm(str);
      let best = null;
      for (const m of groups.values()) {
        const entries = [...m.values()].sort((a, b) => a.first - b.first || a.order - b.order).map((e) => ({ ...e, n: norm(e.text) })).filter((e) => e.n);
        let text = '';
        const spans = entries.map((e) => { const a = text ? text.length + 1 : 0; text = text ? `${text} ${e.n}` : e.n; return { id: e.id, a, b: text.length }; });
        const at = text.indexOf(want);
        if (at < 0) continue;
        const ids = spans.filter((sp) => sp.b > at && sp.a < at + want.length).map((sp) => sp.id);
        let time = 0;
        inW.forEach((s, si) => { if (ids.some((id) => seen.get(id).has(si))) time += 1 / (s.n * fps); });
        if (!best || time > best.time) best = { time, ids };
      }
      const nw = words(str), need = Math.max(T.copyUnread.min, T.copyUnread.perWord * nw);
      if (!best) {
        missing.push(r('board_copy_missing', 'source', 'WARN', `beat "${w.id}": "${str}" never appears on screen in its window ${f2(w.start)}-${f2(w.end)} s`,
          { t: +f3(w.start), beat: w.id, copy: str }));
      } else if (best.time < need - EPS) {
        unread.push(r('board_copy_unread', 'source', 'WARN', `beat "${w.id}": "${str}" is on screen for ${f2(best.time)} s, under the ${f2(need)} s it needs to be read (${nw} word${nw === 1 ? '' : 's'})`,
          { t: +f3(w.start), measured: +best.time.toFixed(4), threshold: need, beat: w.id, copy: str }));
      }
    }
  }
  return [
    ...(missing.length ? missing : [ok('board_copy_missing', 'source', strings ? `every on-screen string in the board appears in its beat (${strings})` : 'no beat lists on-screen copy')]),
    ...(unread.length ? unread : [ok('board_copy_unread', 'source', strings ? 'every on-screen string stays up long enough to read' : 'no beat lists on-screen copy', { threshold: T.copyUnread })]),
  ];
}

// motion_dead (a heuristic): pairs[i] is the luma-difference histogram between probe frames i and i+1
// ({ delta: count } for every delta >= 1). A pair moves when at least T.motion.pixels probe pixels change by
// T.motion.delta or more. A run of k still pairs shows one picture for (k + 1) frames; what is left of it
// outside HOLDS and hold beats is flagged when it lasts T.motion.run seconds or more.
export function movingPair(hist) {
  let n = 0;
  for (const [d, c] of Object.entries(hist || {})) if (+d >= T.motion.delta) n += c;
  return n >= T.motion.pixels;
}
export function subtractIntervals(a, b, holds) {
  let parts = [[a, b]];
  for (const [h0, h1] of holds) {
    parts = parts.flatMap(([x, y]) => (h1 <= x + EPS || h0 >= y - EPS ? [[x, y]] : [[x, Math.max(x, h0)], [Math.min(y, h1), y]].filter(([p, q]) => q - p > EPS)));
  }
  return parts;
}
export function motionDead(pairs, { fps, holds = [] }) {
  const out = [];
  let i = 0;
  while (i < pairs.length) {
    if (movingPair(pairs[i])) { i++; continue; }
    let j = i;
    while (j < pairs.length && !movingPair(pairs[j])) j++;
    const a = i / fps, b = (j + 1) / fps;            // frames i..j show one picture
    for (const [p, q] of subtractIntervals(a, b, holds)) {
      if (q - p >= T.motion.run - 1e-6) {
        out.push(r('motion_dead', 'source', 'WARN', `nothing moves for ${f2(q - p)} s (${f2(p)}-${f2(q)} s), outside HOLDS and hold beats`,
          { t: +f3(p), measured: +(q - p).toFixed(4), threshold: T.motion.run }));
      }
    }
    i = j;
  }
  return out.length ? out : [ok('motion_dead', 'source', `no still stretch of ${T.motion.run} s or more outside HOLDS and hold beats`, { threshold: T.motion.run })];
}
// Hold intervals from the scene's HOLDS and the board's hold: true beats.
export function holdIntervals(HOLDS, windows) {
  const h = [];
  for (const x of HOLDS || []) h.push([+x[0], +x[1]]);
  for (const w of windows || []) if (w.beat && w.beat.hold) h.push([w.start, w.end]);
  return h.sort((a, b) => a[0] - b[0]);
}
export function validHolds(HOLDS) {
  if (HOLDS == null) return null;
  if (!Array.isArray(HOLDS)) return 'HOLDS must be a list of [t0, t1] pairs';
  for (const x of HOLDS) if (!Array.isArray(x) || x.length !== 2 || !Number.isFinite(+x[0]) || !Number.isFinite(+x[1]) || !(+x[1] > +x[0])) return `HOLDS entry ${JSON.stringify(x)} is not a [t0, t1] pair with t1 > t0`;
  return null;
}

// first_frame_empty: the probe of frame 0 has a luma standard deviation under 4/255.
export function firstFrameEmpty(stats) {
  const m = { threshold: T.firstFrame.std, measured: +stats.std.toFixed(3), t: 0 };
  return stats.std < T.firstFrame.std
    ? r('first_frame_empty', 'source', 'WARN', `the first frame is flat (luma standard deviation ${stats.std.toFixed(2)}/255, mean ${stats.mean.toFixed(0)}/255): a blank thumbnail`, m)
    : ok('first_frame_empty', 'source', `the first frame has content (luma standard deviation ${stats.std.toFixed(1)}/255)`, m);
}

// ---- audio: 16-bit or float WAV -> { sr, L, R } and the two audio detectors
export function readWav(buf) {
  let off = 12, ch = 2, sr = 48000, fmt = 1, bits = 16, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { fmt = buf.readUInt16LE(off + 8); ch = buf.readUInt16LE(off + 10); sr = buf.readUInt32LE(off + 12); bits = buf.readUInt16LE(off + 22); }
    if (id === 'data') { data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + sz)); break; }
    off += 8 + sz + (sz & 1);
  }
  if (!data) throw new Error('no data chunk in the WAV');
  const step = (bits / 8) * ch, n = Math.floor(data.length / step), L = new Float32Array(n), R = new Float32Array(n);
  const rd = (i) => (fmt === 3 ? data.readFloatLE(i) : data.readInt16LE(i) / 32768);
  for (let i = 0; i < n; i++) { L[i] = rd(i * step); R[i] = ch > 1 ? rd(i * step + bits / 8) : L[i]; }
  return { sr, L, R, n };
}
// Prefix sums of the mean power of the two channels, so any window's RMS is O(1).
function powerSums({ L, R, n }) {
  const p = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) p[i + 1] = p[i] + (L[i] * L[i] + R[i] * R[i]) / 2;
  return p;
}
const rmsDb = (p, a, b) => (b > a ? 10 * Math.log10(Math.max(1e-24, (p[b] - p[a]) / (b - a))) : -Infinity);

// board_sfx_missing (plan 6.5): a beat with an sfx note needs a 50 ms window above -40 dBFS RMS in the effects
// stem inside its window; with sfxHit, a 10 ms window more than 12 dB above the RMS of the 100 ms before it and
// above -40 dBFS. sfx: null (silence on purpose) and beats without a note are not checked.
export function boardSfx(wav, { windows }) {
  const out = [];
  const p = powerSums(wav), sr = wav.sr, hop = Math.max(1, Math.round(T.sfx.hop * sr));
  let checked = 0;
  for (const w of windows) {
    const b = w.beat || {};
    if (typeof b.sfx !== 'string' || !b.sfx.trim()) continue;
    checked++;
    const a0 = Math.max(0, Math.round(w.start * sr)), a1 = Math.min(wav.n, Math.round(w.end * sr));
    if (b.sfxHit) {
      const W = Math.round(T.sfx.hitWin * sr), pre = Math.round(T.sfx.hitPre * sr);
      let best = -Infinity, bestAt = null, loudest = -Infinity;
      for (let j = a0; j + W <= a1; j += hop) {
        const L = rmsDb(p, j, j + W);
        loudest = Math.max(loudest, L);
        if (!(L > T.sfx.db)) continue;
        const P = j > 0 ? rmsDb(p, Math.max(0, j - pre), j) : -Infinity, jump = L - P;
        if (jump > best) { best = jump; bestAt = j / sr; }
      }
      if (best > T.sfx.hitDb + EPS) continue;
      out.push(r('board_sfx_missing', 'source', 'WARN', bestAt == null
        ? `beat "${w.id}" asks for a hit (sfxHit, "${b.sfx}") but the effects stem has nothing above ${T.sfx.db} dBFS in ${f2(w.start)}-${f2(w.end)} s (loudest 10 ms: ${dbStr(loudest)})`
        : `beat "${w.id}" asks for a hit (sfxHit, "${b.sfx}") but its sound has no transient: the sharpest 10 ms rise is ${best.toFixed(1)} dB over the 100 ms before it (needs more than ${T.sfx.hitDb} dB)`,
      { t: +f3(w.start), measured: Number.isFinite(best) ? +best.toFixed(2) : null, threshold: T.sfx.hitDb, beat: w.id }));
    } else {
      const W = Math.min(Math.round(T.sfx.win * sr), Math.max(1, a1 - a0));
      let best = -Infinity;
      for (let j = a0; j + W <= a1; j += hop) best = Math.max(best, rmsDb(p, j, j + W));
      if (best > T.sfx.db + EPS) continue;
      out.push(r('board_sfx_missing', 'source', 'WARN', `beat "${w.id}" has a sound note ("${b.sfx}") but the effects stem is silent in its window ${f2(w.start)}-${f2(w.end)} s (loudest 50 ms: ${dbStr(best)}, needs more than ${T.sfx.db} dBFS)`,
        { t: +f3(w.start), measured: Number.isFinite(best) && best > -200 ? +best.toFixed(2) : null, threshold: T.sfx.db, beat: w.id }));
    }
  }
  return out.length ? out : [ok('board_sfx_missing', 'source', checked ? `every beat with a sound note has sound in its window (${checked})` : 'no beat has a sound note')];
}

// audio_spike, the analysis render.mjs prints after every audio render: the loudest 50 ms window's peak more
// than 18 dB above the 90th percentile of the windows that are not silent (peak above -60 dBFS). Silence is
// left out (tuned in P3): a stem of a few sparse effects would otherwise compare every sound with silence.
export function spikeStats(wav) {
  const W = Math.round(T.spike.win * wav.sr), peaks = [];
  let sum = 0;
  for (let i = 0; i < wav.n; i += W) {
    let p = 0;
    for (let j = i; j < Math.min(wav.n, i + W); j++) {
      const a = Math.abs(wav.L[j]), b = Math.abs(wav.R[j]);
      if (a > p) p = a; if (b > p) p = b;
      sum += (wav.L[j] * wav.L[j] + wav.R[j] * wav.R[j]) / 2;
    }
    peaks.push(p);
  }
  const loud = peaks.filter((p) => db(p) > T.spike.floor).sort((a, b) => a - b);
  const peak = Math.max(0, ...peaks), at = peaks.indexOf(peak) * T.spike.win;
  const p90 = loud.length ? loud[Math.floor(T.spike.pct * (loud.length - 1))] : 0;
  return { peak, at, p90, over: loud.length ? db(peak) - db(p90) : 0, rms: Math.sqrt(sum / Math.max(1, wav.n)), loud: loud.length };
}
export function audioSpike(wav) {
  const s = spikeStats(wav);
  if (!s.loud) return ok('audio_spike', 'source', 'the effects stem is silent', { threshold: T.spike.db });
  return s.over > T.spike.db + EPS
    ? r('audio_spike', 'source', 'WARN', `the peak at ${f2(s.at)} s is ${s.over.toFixed(1)} dB above the 90th-percentile window: likely a click, or a gain envelope that starts after its source`,
      { t: +f2(s.at), measured: +s.over.toFixed(2), threshold: T.spike.db })
    : ok('audio_spike', 'source', `no spike: the loudest 50 ms window is ${s.over.toFixed(1)} dB above the 90th percentile`, { measured: +s.over.toFixed(2), threshold: T.spike.db });
}

// ---------------------------------------------------------------- 6.5 board checks with a verdict from lib.js
export function boardOrderResult(problems) {
  return problems.length
    ? problems.map((p) => r('board_order', 'source', 'FAIL', p))
    : [ok('board_order', 'source', 'beat windows are contiguous, in order, and CFG.DUR equals boardDur() within one frame')];
}
// hook_long: VO_OFFSET + HOOK_END (lib.hookLong) at or before hookMax. On a master mixed with a voice, the
// voice starts where master.json says, so its delay must also be VO_OFFSET.
export function hookLongResult(h, { voiceDelay = null, voOffset = null, hookEnd = null, hookMax = null } = {}) {
  if (!h) return null;
  const probs = [];
  let end = h.end;
  if (voiceDelay != null) {
    end = voiceDelay + hookEnd;
    if (Math.abs(voiceDelay - voOffset) > 1e-6) probs.push(`the master's voice starts at ${f3(voiceDelay)} s, not at VO_OFFSET ${f3(voOffset)} s`);
  }
  if (end > hookMax + 1e-9) probs.push(`the hook "${h.hook}" ends at ${f3(end)} s, ${f3(end - hookMax)} s after hookMax ${hookMax}`);
  return probs.length
    ? r('hook_long', 'source', 'FAIL', probs.join('; '), { t: +f3(end), measured: +end.toFixed(4), threshold: hookMax })
    : ok('hook_long', 'source', `the hook "${h.hook}" ends at ${f3(end)} s, ${f3(hookMax - end)} s before hookMax ${hookMax}`, { measured: +end.toFixed(4), threshold: hookMax });
}

// ---------------------------------------------------------------- 11.2 artifact checks
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const sha256File = (f) => sha256(fs.readFileSync(f));

// Where the master.json for a --file lives: out/<name>.master.json beside out/<name>-final.mp4, else any
// *.master.json in the same folder whose master.file is this file.
export function findMasterJson(file, root) {
  const dir = path.dirname(file), base = path.basename(file);
  const m = base.match(/^(.*)-final\.mp4$/i);
  if (m && fs.existsSync(path.join(dir, `${m[1]}.master.json`))) return path.join(dir, `${m[1]}.master.json`);
  if (!fs.existsSync(dir)) return null;
  for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.master.json')).sort()) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      if (j && j.master && j.master.file && path.resolve(root, j.master.file) === path.resolve(file)) return path.join(dir, n);
    } catch { /* not a record */ }
  }
  return null;
}
// provenance (plan 11.2), from facts render.mjs gathers: the master record binds this exact file, the render
// record it names is the one it read, the piece's source is still the one rendered, and the mixer copied the
// picture untouched. Returns { result, rec, mj, bound } (bound: the source checks stand for this file).
export function provenance(f) {
  const P = (level, detail) => r('provenance', 'file', level, detail);
  if (!f.mjPath) return { result: P('FAIL', `no master.json for ${f.fileRel}: mix it with tools/mix.mjs (which records the master), or check a file from elsewhere with --plain`), bound: false };
  if (f.mjError) return { result: P('FAIL', `${f.mjRel} is not readable: ${f.mjError}`), bound: false };
  const mj = f.mj, probs = [];
  if (!mj.master || mj.master.sha256 !== f.fileSha) probs.push(`${f.fileRel} is not the file ${f.mjRel} describes (its SHA-256 differs): another mix, or the file changed after the mix`);
  let rec = null;
  if (!mj.render || !mj.render.file) probs.push(`${f.mjRel} names no render record`);
  else if (!f.recExists) probs.push(`the render record ${mj.render.file} that ${f.mjRel} names is missing`);
  else if (f.recSha !== mj.render.sha256) probs.push(`the render record ${mj.render.file} changed after the mix (another render since): render and mix again`);
  else if (f.recError) probs.push(`${mj.render.file} is not readable: ${f.recError}`);
  else {
    rec = f.rec;
    if (!rec.source || rec.source.hash !== f.sourceNow.hash) probs.push(`the piece's source changed since the render (${mj.render.file}): the master is stale, render and mix again`);
    if (!rec.video || !mj.master || !mj.master.video || rec.video.hash !== mj.master.video.hash) probs.push('the master\'s decoded picture does not hash the same as its render\'s: the mixer did not copy the picture untouched');
  }
  if (probs.length) return { result: P('FAIL', probs.join('; ')), rec: f.recExists && !f.recError ? f.rec : null, mj, bound: false };
  return { result: P('OK', `${f.fileRel} is the master ${f.mjRel} records, mixed from ${mj.render.file} (${rec.scene}${Object.keys(rec.params || {}).length ? ', params ' + JSON.stringify(rec.params) : ''}), and the source is unchanged since the render`), rec, mj, bound: true };
}

// ffprobe facts for file_spec
export function probeFile(file) {
  const run = (args) => spawnSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const a = run(['-show_streams', '-show_format']);
  if (a.error || a.status !== 0) return { error: String(a.stderr || a.error).trim().split('\n').pop() };
  const j = JSON.parse(a.stdout || '{}'), v = (j.streams || []).find((s) => s.codec_type === 'video');
  const audio = (j.streams || []).some((s) => s.codec_type === 'audio');
  if (!v) return { error: 'no video stream', audio };
  const c = run(['-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames']);
  const frames = +(((JSON.parse(c.stdout || '{}').streams || [])[0] || {}).nb_read_frames);
  const [p, q] = String(v.r_frame_rate).split('/').map(Number);
  return { width: v.width, height: v.height, fps: q ? p / q : p, pixFmt: v.pix_fmt, codec: v.codec_name, frames, duration: +((j.format || {}).duration ?? v.duration), audio };
}
// The pixel formats a render of each alpha mode writes (render.mjs videoArgs). ffprobe reads VP9 alpha with
// its own decoder, which reports the plain format.
export const PIX_FMTS = { none: ['yuv420p'], prores: ['yuva444p10le'], webm: ['yuva420p', 'yuv420p'] };
// file_spec: size, fps, pixel format, frame count round(DUR x FPS), duration within one frame, and an audio
// stream unless the scene is silent.
export function fileSpec(p, x, how) {
  if (p.error) return r('file_spec', 'file', 'FAIL', `ffprobe could not read the file: ${p.error}`);
  const probs = [], want = Math.round(x.dur * x.fps);
  if (p.width !== x.w || p.height !== x.h) probs.push(`size ${p.width}x${p.height}, expected ${x.w}x${x.h}`);
  if (!(Math.abs(p.fps - x.fps) < 1e-3)) probs.push(`${+p.fps.toFixed(3)} fps, expected ${x.fps}`);
  const fmts = PIX_FMTS[x.alpha || 'none'] || PIX_FMTS.none;
  if (!fmts.includes(p.pixFmt)) probs.push(`pixel format ${p.pixFmt}, expected ${fmts[0]}`);
  if (p.frames !== want) probs.push(`${p.frames} frames, expected round(${x.dur} s x ${x.fps}) = ${want}`);
  if (!(Math.abs(p.duration - x.dur) <= 1 / x.fps + 1e-6)) probs.push(`duration ${f3(p.duration)} s, expected ${x.dur} s within one frame`);
  if (!p.audio && !x.silent) probs.push('no audio stream');
  return probs.length
    ? r('file_spec', 'file', 'FAIL', `${probs.join('; ')} (compared with ${how})`, { measured: { w: p.width, h: p.height, fps: p.fps, pixFmt: p.pixFmt, frames: p.frames, duration: p.duration, audio: p.audio }, threshold: { ...x, frames: want } })
    : ok('file_spec', 'file', `${p.width}x${p.height}, ${+p.fps.toFixed(3)} fps, ${p.pixFmt}, ${p.frames} frames, ${f3(p.duration)} s${p.audio ? ', with audio' : ''} (matches ${how})`);
}

// faststart: in an .mp4, the moov atom comes before mdat (top-level boxes, in file order).
export function atomOrder(buf) {
  const order = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (size === 1) { if (off + 16 > buf.length) break; size = Number(buf.readBigUInt64BE(off + 8)); }
    else if (size === 0) size = buf.length - off;
    order.push(type);
    if (size < 8) break;
    off += size;
  }
  return order;
}
// The same walk on a file, reading only each top-level box's header, so a large mdat is never read.
export function atomOrderFile(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, order = [], h = Buffer.alloc(16);
  try {
    let off = 0;
    while (off + 8 <= size) {
      fs.readSync(fd, h, 0, 16, off);
      let s = h.readUInt32BE(0);
      if (s === 1) s = Number(h.readBigUInt64BE(8)); else if (s === 0) s = size - off;
      order.push(h.toString('latin1', 4, 8));
      if (s < 8) break;
      off += s;
    }
  } finally { fs.closeSync(fd); }
  return order;
}
export function faststartResult(file, order) {
  if (!/\.mp4$/i.test(file)) return skip('faststart', 'file', 'only an .mp4 needs moov before mdat');
  const m = order.indexOf('moov'), d = order.indexOf('mdat');
  if (m < 0 || d < 0) return r('faststart', 'file', 'WARN', `could not find both moov and mdat (top-level boxes: ${order.join(', ') || 'none'})`);
  return m < d ? ok('faststart', 'file', 'moov comes before mdat: the file starts playing before it has downloaded')
    : r('faststart', 'file', 'WARN', 'mdat comes before moov: the file cannot start playing until it has downloaded (remux with -movflags +faststart)');
}

// EBU R128 integrated loudness and true peak of the file's first audio stream (ffmpeg ebur128=peak=true).
export function measureLoudness(file) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (p.error || p.status !== 0) return { error: String(p.stderr || p.error).trim().split('\n').pop() };
  const s = p.stderr.slice(p.stderr.lastIndexOf('Summary:'));
  const val = (re) => { const m = s.match(re); return !m ? NaN : m[1] === '-inf' ? -Infinity : +m[1]; };
  return { lufs: val(/I:\s+(-?[\d.]+|-inf)\s+LUFS/), tp: val(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS/) };
}
// loudness: integrated within 1 LU of the target, true peak at or under the ceiling.
export function loudnessResult(m, { target, tp = T.loudness.tp, from }) {
  if (m.error) return r('loudness', 'file', 'FAIL', `could not measure the loudness: ${m.error}`);
  const probs = [];
  if (!(Math.abs(m.lufs - target) <= T.loudness.lu + EPS)) probs.push(`integrated ${Number.isFinite(m.lufs) ? m.lufs.toFixed(1) : m.lufs} LUFS, more than ${T.loudness.lu} LU from the ${target} LUFS target (${from})`);
  if (!(m.tp <= tp + EPS)) probs.push(`true peak ${Number.isFinite(m.tp) ? m.tp.toFixed(1) : m.tp} dBTP, over the ${tp} dBTP ceiling`);
  const measured = { lufs: m.lufs, tp: m.tp }, threshold = { lufs: target, lu: T.loudness.lu, tp };
  return probs.length ? r('loudness', 'file', 'FAIL', probs.join('; '), { measured, threshold })
    : ok('loudness', 'file', `${m.lufs.toFixed(1)} LUFS (target ${target}, ${from}), true peak ${m.tp.toFixed(1)} dBTP (ceiling ${tp})`, { measured, threshold });
}
// vo_delay: a master mixed with a voice applied cues.js's VO_OFFSET.
export function voDelayResult(mj, voOffset) {
  if (!mj || mj.mode !== 'default') return skip('vo_delay', 'file', `a --${mj ? mj.mode : '?'} master has no voice`);
  if (!Number.isFinite(voOffset)) return r('vo_delay', 'file', 'FAIL', 'the master was mixed with a voice, but the piece has no cues.js VO_OFFSET (run tools/cues.mjs)');
  return Math.abs(mj.voiceDelay - voOffset) <= 1e-6
    ? ok('vo_delay', 'file', `the voice starts at VO_OFFSET ${voOffset} s`, { measured: mj.voiceDelay, threshold: voOffset })
    : r('vo_delay', 'file', 'FAIL', `the master's voice starts at ${mj.voiceDelay} s (master.json), but cues.js puts VO_OFFSET at ${voOffset} s: cues.json and cues.js disagree, or the mix is older than the cues`,
      { measured: mj.voiceDelay, threshold: voOffset });
}

// ---------------------------------------------------------------- output
export const LEVEL_ORDER = { FAIL: 0, WARN: 1, OK: 2, SKIP: 3 };
export function summarize(results, { strict = false } = {}) {
  const n = { FAIL: 0, WARN: 0, OK: 0, SKIP: 0 };
  for (const x of results) n[x.level]++;
  return { n, exit: n.FAIL || (strict && n.WARN) ? 1 : 0 };
}
export function formatLine(x) {
  const lvl = { FAIL: 'FAIL', WARN: 'WARN', OK: 'ok  ', SKIP: 'skip' }[x.level];
  const t = x.t != null ? `${f2(x.t)}s`.padStart(7) : ''.padStart(7);
  return `${lvl}  ${x.id.padEnd(18)} ${t}  ${x.detail}`;
}
// The JSON form (plan 11): { id, scope, level, t?, detail, measured, threshold }.
export const toJson = (results) => results.map((x) => ({ id: x.id, scope: x.scope, level: x.level, ...(x.t != null ? { t: x.t } : {}),
  detail: x.detail, measured: x.measured ?? null, threshold: x.threshold ?? null }));
