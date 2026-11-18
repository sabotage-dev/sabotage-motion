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
import { spawn, spawnSync } from 'node:child_process';

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
  // render.mjs palette (plan 23.2): a probe pixel more than `limit` (CIEDE2000) from every colour is no one's; the kit's
  // bgA and bgB together must take at least `bg` of the pixels and its accent at least `accent`
  palette: { limit: 10, bg: 0.15, accent: 0.005 },
  // flash (plan 23.9, Q20): WCAG 2.3.1's three flashes, per pixel, on the decoded picture with its longer side at `side`
  // px. A transition: a move of `swing` relative luminance from the last turning point with the darker end under `dark`
  // (general), or more than `uv` in u'v' back from the far end of the swing, one end a saturated red (linear R/(R+G+B)
  // of `red` or more). More than `count` transitions of one kind in a half-open second is too fast; more than `area` px
  // too fast in a `win` window, either way round, fails.
  flash: { side: 1024, swing: 0.1, dark: 0.8, red: 0.8, uv: 0.2, count: 7, area: 21824, win: [341, 256] },
};
const EPS = 1e-9;

export const SOURCE_IDS = ['fonts', 'board_order', 'hook_long', 'board_copy_missing', 'board_copy_unread', 'board_sfx_missing',
  'motion_dead', 'first_frame_empty', 'text_safe', 'text_overlap', 'audio_spike'];
export const FILE_IDS = ['provenance', 'file_spec', 'faststart', 'loudness', 'vo_delay'];
// flash runs on the picture: the current render in a source check, the file itself with --file
export const PICTURE_IDS = ['flash'];
export const ALL_IDS = [...SOURCE_IDS, ...PICTURE_IDS, ...FILE_IDS];

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
// The same visible part as a polygon: the canvas-cut box's four corners through the camera, cut to the frame
// (Sutherland-Hodgman against its four edges). Exact where a turned camera makes the bounding box too big.
export function visibleQuad(b, cam, W, H) {
  const c = clipRect(b, W, H);
  if (!c) return null;
  let poly = [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]].map(([x, y]) => camPoint(x, y, cam, W, H));
  const clip = (inside, cut) => {
    const out = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length], pin = inside(p), qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) out.push(cut(p, q));
    });
    poly = out;
  };
  const at = (p, q, k, v) => { const u = (v - p[k]) / (q[k] - p[k]); return [p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1])]; };
  clip((p) => p[0] >= 0, (p, q) => at(p, q, 0, 0)); clip((p) => p[0] <= W, (p, q) => at(p, q, 0, W));
  clip((p) => p[1] >= 0, (p, q) => at(p, q, 1, 0)); clip((p) => p[1] <= H, (p, q) => at(p, q, 1, H));
  return poly.length >= 3 ? poly : null;
}
// How far a convex polygon reaches into an axis-aligned rectangle, by the separating-axis test: the smallest
// overlap of their projections on the rectangle's axes and the polygon's edge normals. 0 when an axis separates
// them, or they only touch.
export function polyRectDepth(poly, r) {
  const rect = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  const axes = [[1, 0], [0, 1]];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    if (len > 1e-9) axes.push([-dy / len, dx / len]);
  });
  let depth = Infinity;
  for (const [ax, ay] of axes) {
    const pr = (pts) => { let lo = Infinity, hi = -Infinity; for (const [x, y] of pts) { const v = x * ax + y * ay; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
    const [a0, a1] = pr(poly), [b0, b1] = pr(rect), o = Math.min(a1, b1) - Math.max(a0, b0);
    if (!(o > 1e-6)) return 0;
    depth = Math.min(depth, o);
  }
  return depth;
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
  return samples.map((s) => ({ ...s, vis: (s.boxes || []).map((b) => ({ ...b, v: visibleBox(b, s.cam, W, H), q: visibleQuad(b, s.cam, W, H) })).filter((b) => b.v) }));
}

// ---------------------------------------------------------------- 11.1 source checks

// text_safe: a non-deco box whose visible part leaves the safe area, or overlaps one of the target's exclude
// rectangles (an area the platform covers inside it, such as a column of buttons), accrues 1 / (n x FPS) s per
// sample, per beat. More than 0.25 s in one beat is a FAIL; less is a WARN (a slam entrance, a whip). Every
// result is a WARN while the target's zones are an estimate.
export function textSafe(samples, { fps, safe, exclude = [], windows, estimate = false, target = '' }) {
  const acc = new Map();
  for (const s of samples) {
    const w = windowAt(windows, s.t), wt = 1 / (s.n * fps);
    for (const b of s.vis) {
      if (b.deco) continue;
      const out = Math.max(safe.x - b.v.x, safe.y - b.v.y, b.v.x + b.v.w - safe.x - safe.w, b.v.y + b.v.h - safe.y - safe.h);
      // how far the box reaches into an excluded rectangle, tested on its visible quad, not its bounding box (which a
      // turned camera makes bigger than the box); against the axis-aligned safe edges the bounding box is exact
      const quad = b.q || [[b.v.x, b.v.y], [b.v.x + b.v.w, b.v.y], [b.v.x + b.v.w, b.v.y + b.v.h], [b.v.x, b.v.y + b.v.h]];
      const into = Math.max(0, ...exclude.map((x) => polyRectDepth(quad, x)));
      if (insideRect(b.v, safe) && !(into > 0)) continue;
      const k = `${b.id}\u0000${w ? w.id : ''}`;
      const a = acc.get(k) || { id: b.id, text: b.text, beat: w ? w.id : null, exp: 0, t: s.t, worst: 0, excluded: false };
      a.exp += wt;
      a.worst = Math.max(a.worst, out, into);
      if (into > 0) a.excluded = true;
      acc.set(k, a);
    }
  }
  const zone = `${target ? target + ' ' : ''}safe area${estimate ? ' (estimate)' : ''}`;
  if (!acc.size) return [ok('text_safe', 'source', `every text box stays inside the ${zone}`, { threshold: T.textSafe.fail })];
  return [...acc.values()].sort((a, b) => a.t - b.t).map((a) => {
    const long = a.exp > T.textSafe.fail + EPS;
    return r('text_safe', 'source', long && !estimate ? 'FAIL' : 'WARN',
      `box "${a.text}" (${a.id}) is outside the ${zone}${a.excluded ? ' (in an area it excludes)' : ''} for ${f2(a.exp)} s${a.beat ? ` in beat "${a.beat}"` : ''}, up to ${Math.ceil(a.worst)} px out${long ? '' : ' (a brief excursion: a slam or a whip)'}${long && estimate ? '; a FAIL once the zones are measured' : ''}`,
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
      // every occurrence, in every group: the string is on screen while any box of any match is ("in total", 6.5)
      const ids = new Set();
      let found = false;
      for (const m of groups.values()) {
        const entries = [...m.values()].sort((a, b) => a.first - b.first || a.order - b.order).map((e) => ({ ...e, n: norm(e.text) })).filter((e) => e.n);
        let text = '';
        const spans = entries.map((e) => { const a = text ? text.length + 1 : 0; text = text ? `${text} ${e.n}` : e.n; return { id: e.id, a, b: text.length }; });
        for (let at = text.indexOf(want); at >= 0; at = text.indexOf(want, at + 1)) {
          found = true;
          for (const sp of spans) if (sp.b > at && sp.a < at + want.length) ids.add(sp.id);
        }
      }
      let best = null;
      if (found) {
        let time = 0;
        inW.forEach((s, si) => { if ([...ids].some((id) => seen.get(id).has(si))) time += 1 / (s.n * fps); });
        best = { time };
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
// what: what was measured, for the line (default: the effects stem; with a bed stem, the two summed at the mixer's
// gains, plan 23.9, so a preset's hits are judged against the beat under them).
export function audioSpike(wav, { what = 'the effects stem' } = {}) {
  const s = spikeStats(wav);
  if (!s.loud) return ok('audio_spike', 'source', `${what} is silent`, { threshold: T.spike.db });
  return s.over > T.spike.db + EPS
    ? r('audio_spike', 'source', 'WARN', `${what}: the peak at ${f2(s.at)} s is ${s.over.toFixed(1)} dB above the 90th-percentile window: likely a click, or a gain envelope that starts after its source`,
      { t: +f2(s.at), measured: +s.over.toFixed(2), threshold: T.spike.db })
    : ok('audio_spike', 'source', `no spike in ${what}: the loudest 50 ms window is ${s.over.toFixed(1)} dB above the 90th percentile`, { measured: +s.over.toFixed(2), threshold: T.spike.db });
}
// Stems summed at gains, as the mixer sums them before its limiter: parts [{ wav, gain }] (readWav's { sr, L, R, n }),
// all at one sample rate, from sample 0; the sum is as long as the longest.
export function mixWavs(parts) {
  const sr = parts[0].wav.sr;
  if (parts.some((p) => p.wav.sr !== sr)) throw new Error('mixWavs: the stems have different sample rates');
  const n = Math.max(...parts.map((p) => p.wav.n)), L = new Float32Array(n), R = new Float32Array(n);
  for (const { wav, gain } of parts) for (let i = 0; i < wav.n; i++) { L[i] += wav.L[i] * gain; R[i] += wav.R[i] * gain; }
  return { sr, L, R, n };
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
    if (f.effectsProblem) probs.push(f.effectsProblem);
    if (f.bedProblem) probs.push(f.bedProblem);
  }
  if (probs.length) return { result: P('FAIL', probs.join('; ')), rec: f.recExists && !f.recError ? f.rec : null, mj, bound: false };
  return { result: P('OK', `${f.fileRel} is the master ${f.mjRel} records, mixed from ${mj.render.file} (${rec.scene}${Object.keys(rec.params || {}).length ? ', params ' + JSON.stringify(rec.params) : ''}), and the source is unchanged since the render${(mj.stems || []).some((x) => x.role === 'effects') ? '; its effects stem came from a render of this source' : ''}${(mj.stems || []).some((x) => x.role === 'bed' && x.generated) ? '; its bed stem too' : ''}`), rec, mj, bound: true };
}

// The effects stem a master was mixed with must be one a render made from this source (P2 round 1, folded in P3):
// a record whose audioSha256 is the stem's SHA-256 (the picture's own record from `full`, or the stem's
// <wav>.render.json from `audio`), with that record's source hash equal to the current source. The source hash does
// not cover --scene or --param, which both change the effects, so the record must also have been made with the
// picture's scene, params, fps and length (council round 2). candidates: [{ file, rec, sourceNow }]; pic: the
// picture's render record. Returns a problem sentence, or null when the stem is bound or the master has none.
const paramKey = (p) => JSON.stringify(Object.entries(p || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
export function soundDiff(a, b) {
  const d = [];
  if (a.scene !== b.scene) d.push(`scene ${a.scene} vs ${b.scene}`);
  if (paramKey(a.params) !== paramKey(b.params)) d.push(`params ${JSON.stringify(a.params || {})} vs ${JSON.stringify(b.params || {})}`);
  if (a.fps !== b.fps) d.push(`fps ${a.fps} vs ${b.fps}`);
  if (!(Math.abs(a.dur - b.dur) < 1e-9)) d.push(`length ${a.dur} vs ${b.dur} s`);
  return d;
}
export function effectsLink(stem, candidates, pic = null) {
  if (!stem) return null;
  const hits = candidates.filter((c) => c.rec && c.rec.audioSha256 === stem.sha256);
  if (!hits.length) return `the effects stem ${stem.file} is not one a render recorded (no render record has its SHA-256): render it again (full, or audio --out ${stem.file}) and mix again`;
  const match = pic ? hits.find((c) => c.rec === pic || !soundDiff(c.rec, pic).length) : hits[0];
  if (!match) {
    return `the effects stem ${stem.file} was rendered with other settings than the picture (${soundDiff(hits[0].rec, pic).join(', ')}): render it again with the picture's scene and params (audio --out ${stem.file}) and mix again`;
  }
  if (!match.rec.source || !match.sourceNow || match.rec.source.hash !== match.sourceNow.hash) {
    return `the effects stem ${stem.file} was rendered from another source than the piece's now (${match.file}): render it again and mix again`;
  }
  return null;
}

// The generated bed stem a master was mixed with (plan 23.9: master.json's stem with role 'bed' and generated: true)
// must be one a render of this source made, like the effects stem: a record whose bedSha256 is the stem's (the
// picture's own record from `full`) or whose audioSha256 is (out/<name>.bed.wav.render.json from `audio`), made with the
// picture's scene, params, fps and length, from the source as it is now. Returns a problem sentence, or null.
export function bedLink(stem, candidates, pic = null) {
  if (!stem) return null;
  const hits = candidates.filter((c) => c.rec && (c.rec.bedSha256 === stem.sha256 || (c.rec.role === 'bed' && c.rec.audioSha256 === stem.sha256)));
  if (!hits.length) return `the bed stem ${stem.file} is not one a render recorded (no render record has its SHA-256): render it again (full, or audio) and mix again`;
  const match = pic ? hits.find((c) => c.rec === pic || !soundDiff(c.rec, pic).length) : hits[0];
  if (!match) return `the bed stem ${stem.file} was rendered with other settings than the picture (${soundDiff(hits[0].rec, pic).join(', ')}): render it again and mix again`;
  if (!match.rec.source || !match.sourceNow || match.rec.source.hash !== match.sourceNow.hash) {
    return `the bed stem ${stem.file} was rendered from another source than the piece's now (${match.file}): render it again and mix again`;
  }
  return null;
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
// ProRes 4444 is encoded from yuva444p10le; what ffprobe reports for it depends on the ffmpeg version (9.0 reads it
// back as yuva444p12le, since 4444 carries up to 12 bits), so both are the right format (found in P4, on the
// lower-third example).
export const PIX_FMTS = { none: ['yuv420p'], prores: ['yuva444p10le', 'yuva444p12le'], webm: ['yuva420p', 'yuv420p'] };
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

// ---------------------------------------------------------------- flash (plan 23.9, Q20, Q24, Q25)
// A safety net modelled on WCAG 2.3.1 (three flashes), not a certified photosensitivity test. It reads the delivered
// picture: every frame of the file, decoded to RGB with its longer side scaled to 1024 px. Each pixel is followed on
// its own, never through an average (an average hides a pattern whose halves swap and softens a real flash):
//   general  relative luminance (linearised sRGB, as WCAG defines it) through a threshold zig-zag: a transition is
//            confirmed when the pixel has moved 0.1 or more from its last turning point, the opposite way to its last
//            transition, with the darker of the two under 0.80; smaller wobbles (grain, a stepped ramp) never end one,
//            so a ramp counts as fully as a cut.
//   red      chromaticity (CIE 1976 u'v') through the same kind of zig-zag: the far end of the current swing is the
//            colour farthest from the end the swing left, and a transition is confirmed when the colour is more than
//            0.2 back from that far end, one of the two a saturated red (R/(R+G+B) of 0.8 or more on linear RGB), into
//            red or out of it, opposite to the last; before the first one it is measured from either end of the swing.
// A transition is dated by the frame that confirms it. A pixel is flashing too fast at frame f when it has more than
// seven transitions of one kind (four complete flashes) at frames i with (f - i) x den < num: the half-open second
// (t - 1 s, t] in exact integer arithmetic on the rational rate num/den. A frame fails when one kind's too-fast pixels
// cover more than 21,824 px of some 341x256 window, either way round (a summed-area table; a frame smaller than the
// window clips it). Fine patterns are not excepted (Q25), and a small shape that repeats its path counts its path (Q24).

// sRGB (0-1) to linear, the curve WCAG's relative luminance uses
const linear01 = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const LIN8 = Float64Array.from({ length: 256 }, (_, i) => linear01(i / 255));

// The size the picture is measured at: its longer side T.flash.side px, the shorter in proportion.
export function flashSize(w, h) {
  const k = T.flash.side / Math.max(w, h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}
// A frame rate as an exact fraction { num, den }: "30000/1001" (ffprobe's form), a whole number of frames a second,
// or { num, den }. Anything else throws: a rounded rate would move the one-second window.
export function flashRate(x) {
  let num, den;
  if (x && typeof x === 'object') ({ num, den } = x);
  else if (typeof x === 'string' && x.includes('/')) [num, den] = x.split('/').map(Number);
  else { num = Number(x); den = 1; }
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) throw new Error(`not an exact frame rate: ${JSON.stringify(x)}`);
  return { num, den };
}
// The largest gap g, in frames, with g x den < num: a transition at frame i still counts at frame f when f - i <= g.
export const flashGap = ({ num, den }) => Number((BigInt(num) - 1n) / BigInt(den));

// The rule as a stream: push frames in order, then read result(). w x h is the measured size (already scaled). Frames
// are pushRGB8 (packed 8-bit sRGB, w x h x 3), pushRGB (sRGB 0-1 floats, w x h x 3) or pushLum (relative luminance,
// w x h; only with red: false, which follows the general kind alone). Each frame is dated in ticks of a time base:
// with `rate` (frames a second), a frame's tick is its index; with `timeBase` (seconds a tick, as ffprobe writes it,
// "1/15360"), each push passes the frame's presentation timestamp in it (`ts`), so a variable-rate file is dated by
// when its frames are shown. A transition at tick i counts at tick f when (f - i) x num < den, in exact integers.
// result(): { frames, w, h, timeBase, failing (frames over the limit), first and last ({ f (index), t (s from the first
// frame), kind, area, x, y, w, h }: the window over it), peak (the largest area seen) }.
export function flashTracker({ w, h, rate, timeBase, red = true }) {
  const F = T.flash, n = w * h, K = F.count + 1;
  const byPts = timeBase != null, TB = byPts ? flashRate(timeBase) : (({ num, den }) => ({ num: den, den: num }))(flashRate(rate));
  const gap = flashGap({ num: TB.den, den: TB.num });   // the largest tick gap g with g x TB.num < TB.den
  const L = new Float64Array(n), U = new Float64Array(red ? n : 0), V = new Float64Array(red ? n : 0), RD = new Uint8Array(red ? n : 0);
  // general: the last turning points (lo, hi) and the direction of the last transition (1 up, -1 down, 0 none yet)
  const lo = new Float64Array(n), hi = new Float64Array(n), gd = new Int8Array(n);
  // red: P, the end the current swing left; T, its far end; whether each is a saturated red; the direction of the
  // last red transition (1 into red, -1 out of it, 0 none yet)
  const pu = new Float64Array(red ? n : 0), pv = new Float64Array(red ? n : 0), tu = new Float64Array(red ? n : 0), tv = new Float64Array(red ? n : 0);
  const pr = new Uint8Array(red ? n : 0), tr = new Uint8Array(red ? n : 0), rd = new Int8Array(red ? n : 0);
  // the ticks of each pixel's last K transitions of each kind (a ring; the slot at the pointer is the oldest). Float64:
  // a timestamp can pass 2^31 ticks, and every tick count stays an exact integer far beyond any clip's length.
  const NONE = -Infinity;
  const ringG = new Float64Array(n * K).fill(NONE), ptrG = new Uint8Array(n), maskG = new Uint8Array(n);
  const ringR = new Float64Array(red ? n * K : 0).fill(NONE), ptrR = new Uint8Array(red ? n : 0), maskR = new Uint8Array(red ? n : 0);
  const sat = new Int32Array((w + 1) * (h + 1));
  let f = -1, ts = 0, ts0 = 0, failing = 0, first = null, last = null, peak = { area: 0, kind: null, f: null, t: null };
  const time = (x) => ((x - ts0) * TB.num) / TB.den;
  // the frame's tick: its presentation timestamp when dated by pts (an integer), else its index
  function clock(x) {
    if (!byPts) return f + 1;
    if (!Number.isSafeInteger(x)) throw new Error(`a frame needs an integer timestamp in ${TB.num}/${TB.den} s, not ${x}`);
    return x;
  }

  // One pixel's colour: its stored sRGB (r, g, b, 0-1) and the same linearised (Rl, Gl, Bl).
  function put(p, r, g, b, Rl, Gl, Bl) {
    const X = 0.4124564 * Rl + 0.3575761 * Gl + 0.1804375 * Bl;
    const Y = 0.2126729 * Rl + 0.7151522 * Gl + 0.0721750 * Bl;
    const Z = 0.0193339 * Rl + 0.1191920 * Gl + 0.9503041 * Bl;
    L[p] = Y;
    if (!red) return;
    const den = X + 15 * Y + 3 * Z + 1e-12;
    U[p] = (4 * X) / den; V[p] = (9 * Y) / den;
    RD[p] = Rl / (Rl + Gl + Bl + 1e-12) >= F.red ? 1 : 0;
  }
  // The largest count of marked pixels in any window (T.flash.win, either way round), by a summed-area table.
  function windowMax(mask) {
    const W1 = w + 1;
    for (let y = 0; y < h; y++) {
      const o = (y + 1) * W1, q = y * W1, m = y * w;
      let row = 0;
      for (let x = 0; x < w; x++) { row += mask[m + x]; sat[o + x + 1] = sat[q + x + 1] + row; }
    }
    let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
    for (const [a, b] of [[F.win[0], F.win[1]], [F.win[1], F.win[0]]]) {
      const ww = Math.min(a, w), wh = Math.min(b, h);   // a frame smaller than the window clips it to the frame
      for (let y = 0; y + wh <= h; y++) {
        const o0 = y * W1, o1 = (y + wh) * W1;
        for (let x = 0; x + ww <= w; x++) {
          const s = sat[o1 + x + ww] - sat[o0 + x + ww] - sat[o1 + x] + sat[o0 + x];
          if (s > best.area) best = { area: s, x, y, w: ww, h: wh };
        }
      }
    }
    return best;
  }
  function step(t) {
    ts = t;
    f++;
    if (f === 0) {   // every pixel's zig-zags start at its first frame
      ts0 = ts;
      lo.set(L); hi.set(L);
      if (red) { pu.set(U); tu.set(U); pv.set(V); tv.set(V); pr.set(RD); tr.set(RD); }
      return;
    }
    const SW = F.swing, DK = F.dark, UV = F.uv, since = ts - gap;
    let cg = 0, cr = 0;
    for (let p = 0; p < n; p++) {
      // general: the threshold zig-zag on relative luminance
      const x = L[p];
      let a = lo[p], b = hi[p], d = gd[p];
      if (d !== -1 && x < a) a = x;
      if (d !== 1 && x > b) b = x;
      const up = d !== 1 && x - a >= SW && a < DK;
      const dn = d !== -1 && b - x >= SW && x < DK;
      if (up || dn) {
        if (up) b = x;
        if (dn) a = x;
        d = up ? 1 : -1;
        const k = ptrG[p];
        ringG[p * K + k] = ts; ptrG[p] = k + 1 === K ? 0 : k + 1;
      }
      if (d === 1) { if (x > b) b = x; } else if (d === -1 && x < a) a = x;
      lo[p] = a; hi[p] = b; gd[p] = d;
      if (ringG[p * K + ptrG[p]] >= since) { maskG[p] = 1; cg++; } else maskG[p] = 0;
      if (!red) continue;
      // red: the zig-zag on u'v' from the far end of the swing. A pixel still at its far end changes nothing.
      const cu = U[p], cv = V[p];
      const Tu = tu[p], Tv = tv[p];
      if (cu !== Tu || cv !== Tv) {
        const c = RD[p], q = rd[p], Pu = pu[p], Pv = pv[p];
        const dT = Math.sqrt((cu - Tu) * (cu - Tu) + (cv - Tv) * (cv - Tv));
        const dP = Math.sqrt((cu - Pu) * (cu - Pu) + (cv - Pv) * (cv - Pv));
        const fromT = dT > UV && (c || tr[p]) && (q === 0 || (q === 1 && !c) || (q === -1 && c));
        const fromP = !fromT && q === 0 && dP > UV && (c || pr[p]);
        if (fromT || fromP) {
          if (fromT) { pu[p] = Tu; pv[p] = Tv; pr[p] = tr[p]; }   // the swing now leaves its old far end
          tu[p] = cu; tv[p] = cv; tr[p] = c; rd[p] = c ? 1 : -1;
          const k = ptrR[p];
          ringR[p * K + k] = ts; ptrR[p] = k + 1 === K ? 0 : k + 1;
        } else if (dP > Math.sqrt((Tu - Pu) * (Tu - Pu) + (Tv - Pv) * (Tv - Pv))) {
          tu[p] = cu; tv[p] = cv; tr[p] = c;   // still moving away from the end it left: the far end follows
        }
      }
      if (ringR[p * K + ptrR[p]] >= since) { maskR[p] = 1; cr++; } else maskR[p] = 0;
    }
    // the area, general and red counted separately
    let over = null;
    for (const [kind, cnt, mask] of [['general', cg, maskG], ['red', cr, maskR]]) {
      if (!cnt) continue;
      const m = windowMax(mask);
      if (m.area > peak.area) peak = { area: m.area, kind, f, t: time(ts) };
      if (m.area > F.area && (!over || m.area > over.area)) over = { f, t: time(ts), kind, ...m };
    }
    if (over) { failing++; last = over; if (!first) first = over; }
  }
  return {
    pushRGB8(buf, x) {
      const t = clock(x);
      let r0 = -1, g0 = -1, b0 = -1, s = 0;
      for (let p = 0, i = 0; p < n; p++, i += 3) {
        const r = buf[i], g = buf[i + 1], b = buf[i + 2];
        if (r === r0 && g === g0 && b === b0) {   // the same colour as the last pixel: copy it
          L[p] = L[s];
          if (red) { U[p] = U[s]; V[p] = V[s]; RD[p] = RD[s]; }
          continue;
        }
        put(p, r / 255, g / 255, b / 255, LIN8[r], LIN8[g], LIN8[b]);
        r0 = r; g0 = g; b0 = b; s = p;
      }
      step(t);
    },
    pushRGB(arr, x) {
      const t = clock(x);
      for (let p = 0, i = 0; p < n; p++, i += 3) put(p, arr[i], arr[i + 1], arr[i + 2], linear01(arr[i]), linear01(arr[i + 1]), linear01(arr[i + 2]));
      step(t);
    },
    pushLum(arr, x) {
      if (red) throw new Error('pushLum follows luminance alone: make the tracker with red: false');
      const t = clock(x);
      L.set(arr);
      step(t);
    },
    result: () => ({ frames: f + 1, w, h, timeBase: TB, failing, first, last, peak }),
  };
}

// ffprobe facts for flash, from the first video stream:
//   width, height   the size as displayed: a display rotation of 90 or 270 degrees (the display matrix's side data,
//                   or an older file's `rotate` tag) swaps the coded width and height, as ffmpeg's autorotate does when
//                   it decodes, so the picture is measured the way a viewer sees it
//   alpha           an alpha pixel format, or a VP9 stream tagged alpha_mode=1: ffprobe reads VP9 alpha with its own
//                   decoder, which reports the plain yuv420p (PIX_FMTS above)
//   timeBase        the stream's time base (ffmpeg's own filter link names the one its timestamps are in)
export function flashProbe(file) {
  const a = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: FLASH_STALL_MS, killSignal: 'SIGKILL' });
  if (a.error && a.error.code === 'ETIMEDOUT') return { error: `ffprobe did not finish reading the file in ${FLASH_STALL_MS / 1000} s` };
  if (a.error || a.status !== 0) return { error: String(a.stderr || a.error).trim().split('\n').pop() };
  const v = (JSON.parse(a.stdout || '{}').streams || [])[0];
  if (!v) return { error: 'no video stream' };
  const tags = v.tags || {}, side = (v.side_data_list || []).find((x) => x.rotation != null);
  const rotation = side ? +side.rotation : tags.rotate != null ? -tags.rotate : 0;
  const turned = Math.abs(Math.round(rotation)) % 180 === 90;
  const alphaTag = String(tags.alpha_mode ?? tags.ALPHA_MODE ?? '') === '1';
  let timeBase = null;
  try { timeBase = flashRate(v.time_base); } catch { /* ffmpeg names it while decoding */ }
  return { width: turned ? v.height : v.width, height: turned ? v.width : v.height, coded: [v.width, v.height], rotation,
    pixFmt: v.pix_fmt, alpha: hasAlpha(v.pix_fmt) || alphaTag, timeBase };
}
// Pixel formats with an alpha plane: an overlay, whose flashes depend on the picture under it.
export const hasAlpha = (pixFmt) => /^(yuva|gbrap|ya\d|rgba|bgra|argb|abgr)/.test(String(pixFmt || ''));

// showinfo prints each frame's timestamp; without its checksums when this ffmpeg has the option (5.1 and later)
let showinfoArg = null;
const showinfo = () => showinfoArg ?? (showinfoArg = /^\s*checksum\s/m.test(spawnSync('ffmpeg', ['-hide_banner', '-h', 'filter=showinfo'], { encoding: 'utf8' }).stdout || '') ? 'showinfo=checksum=0' : 'showinfo');

// How long ffmpeg may go without a frame or a log line before it is taken to be stuck (council round 2, C1).
export const FLASH_STALL_MS = 60000;

// The rule on a file: ffmpeg decodes every frame (one out per frame in; autorotated, so as displayed), scales it to
// flashSize (area averaging down, bilinear up; every frame to that size, so a stream that changes size mid-way still
// arrives in whole frames) and hands it over as RGB; frames stream through flashTracker, never all held.
// Each frame is dated by its presentation timestamp, which ffmpeg's showinfo filter prints for it on the same filter
// link, with the link's time base, so a variable-rate file is dated by when its frames are shown. Frames and showinfo
// lines are paired in the order they arrive: showinfo's own counter `n` restarts when the filter graph is rebuilt (a
// change of size mid-stream), so it is never the key (council round 2, C1). The raw output's packets are numbered
// 0, 1, 2 ... (setts), so the timestamps ffmpeg writes to the pipe can never collide, whatever the input's are; a
// collision there was ffmpeg's own error about its output, never about the file (C2). If ffmpeg goes quiet for
// `stallMs`, it is killed and the file counts as not decodable.
// Returns flashTracker's result plus { src: [w, h] (as displayed), ms }, or { error }.
export async function measureFlash(file, { stallMs = FLASH_STALL_MS } = {}) {
  const p = flashProbe(file);
  if (p.error) return p;
  const [sw, sh] = flashSize(p.width, p.height);
  const scale = sw === p.width && sh === p.height ? `scale=${sw}:${sh}` : `scale=${sw}:${sh}:flags=${sw < p.width ? 'area' : 'bilinear'}`;
  const t0 = Date.now();
  const proc = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'level+info', '-i', file, '-map', '0:v:0',
    '-fps_mode', 'passthrough', '-vf', `${scale},format=rgb24,${showinfo()}`, '-bsf:v', 'setts=pts=N:dts=N',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  // stderr, every line tagged with its level (-loglevel level+info): showinfo's [info] lines give the link's time base and
  // each frame's pts, in the order the frames come; an [error], [fatal] or [panic] line is ffmpeg reporting a damaged or
  // cut-short input, a frame it could not decode or a packet it truncated, and it may still exit 0 (council round 1, M1)
  const pts = [], errors = [];
  let tb = null, tbMoved = null, rest = '', closed = false, wake = null, quiet = Date.now(), stalled = false;
  const nudge = () => { quiet = Date.now(); if (wake) { const w = wake; wake = null; w(); } };
  proc.stderr.setEncoding('utf8');
  const line = (l) => {
    let m;
    if ((m = /showinfo.*\] (?:\[info\] )?config in time_base: (\d+)\/(\d+)/.exec(l))) {
      const x = { num: +m[1], den: +m[2] };
      if (!tb) tb = x;
      else if (x.num * tb.den !== tb.num * x.den) tbMoved = tbMoved || `${x.num}/${x.den} after ${tb.num}/${tb.den}`;
    } else if ((m = /showinfo.*\] (?:\[info\] )?n:\s*\d+\s+pts:\s*(\S+)/.exec(l))) pts.push(m[1] === 'NOPTS' ? null : Number(m[1]));
    else if ((m = /^(?:\[[^\]]+\] )*\[(?:error|fatal|panic)\] (.*)$/.exec(l))) errors.push(m[1].trim());
  };
  let tail = '';
  proc.stderr.on('data', (d) => {
    const lines = (rest + d).split('\n');
    rest = lines.pop();
    lines.forEach(line);
    nudge();
  });
  proc.stderr.on('end', () => { tail = rest.trim(); if (rest) line(rest); rest = ''; });
  const done = new Promise((res) => {
    proc.on('error', (e) => { closed = true; nudge(); res({ error: e.message }); });
    proc.on('close', (code) => { closed = true; nudge(); res({ code }); });
  });
  // the watchdog: no frame and no log line for stallMs, and ffmpeg is stopped
  const dog = setInterval(() => {
    if (closed || Date.now() - quiet <= stallMs) return;
    stalled = true;
    proc.kill('SIGKILL');
  }, Math.max(50, Math.min(1000, stallMs / 4)));
  const ptsOf = async (k) => { while (pts.length <= k && !closed) await new Promise((r) => { wake = r; }); return pts[k]; };
  const size = sw * sh * 3, frame = Buffer.allocUnsafe(size);
  let tr = null, have = 0, k = 0, bad = null;
  try {
    for await (const chunk of proc.stdout) {
      quiet = Date.now();
      for (let off = 0; off < chunk.length;) {
        const n = Math.min(size - have, chunk.length - off);
        chunk.copy(frame, have, off, off + n); have += n; off += n;
        if (have < size) continue;
        have = 0;
        const x = await ptsOf(k);
        if (x === undefined) { bad = stalled ? null : `frame ${k} came with no showinfo line to date it`; break; }
        if (x === null) { bad = `frame ${k} has no presentation timestamp`; break; }
        if (!tr) tr = flashTracker({ w: sw, h: sh, timeBase: tb || p.timeBase });
        tr.pushRGB8(frame, x);
        k++;
      }
      if (bad || stalled) break;
    }
  } catch (e) { bad = e.message; }
  if (bad || stalled) proc.kill('SIGKILL');
  const end = await done;
  clearInterval(dog);
  if (stalled) return { error: `ffmpeg went quiet for ${(stallMs / 1000).toFixed(stallMs % 1000 ? 1 : 0)} s (no frame and no log line) and was stopped` };
  if (bad) return { error: bad };
  if (end.error || end.code !== 0) return { error: end.error || errors.pop() || tail || `ffmpeg exited ${end.code}` };
  // ffmpeg exited 0 but reported errors: a frame may be missing or damaged, so what was measured is not the picture
  if (errors.length) {
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more error${errors.length > 2 ? 's' : ''})` : '';
    return { error: `ffmpeg reported "${errors[0]}"${more} and went on, so frames may be missing or damaged` };
  }
  if (!tr) return { error: 'no frames decoded' };
  if (have) return { error: `the last frame was cut short (${have} of ${size} bytes)` };
  // every frame paired with its own showinfo line, in order, and the clock never changed under them (C1)
  if (pts.length !== k) return { error: `ffmpeg dated ${pts.length} frames but sent ${k}, so frames and timestamps no longer pair` };
  if (tbMoved) return { error: `the time base changed mid-stream (${tbMoved})` };
  return { ...tr.result(), src: [p.width, p.height], ms: Date.now() - t0 };
}

// The flash result for a measurement (measureFlash's), on `what` (the file, as the line names it).
export function flashResult(m, { scope, what }) {
  const F = T.flash;
  const threshold = { flashes: 3, transitions: F.count, area: F.area, window: F.win, side: F.side, swing: F.swing, dark: F.dark, red: F.red, uv: F.uv };
  if (m.error) return r('flash', scope, 'FAIL', `${what} could not be decoded to look for flashes: ${m.error}`, { threshold });
  const win = (x) => `${x.w}x${x.h} window at ${x.x},${x.y}`;
  if (m.first) {
    const x = m.first;
    return r('flash', scope, 'FAIL', `${what}: from ${f3(x.t)} s, ${x.area} px of a ${win(x)} flash more than three times a second ` +
      `(${x.kind}), over the ${F.area} px limit (measured at ${m.w}x${m.h}); ${m.failing} of ${m.frames} frames are over it, the last at ` +
      `${f3(m.last.t)} s. Keep it to three flashes a second or fewer, make it smaller, or lower its contrast`,
    { t: +f3(x.t), measured: { area: x.area, kind: x.kind, frames: m.failing, last: +f3(m.last.t) }, threshold });
  }
  const pk = m.peak;
  return ok('flash', scope, `${what}: nothing flashes more than three times a second over ${F.area} px of a window ` +
    `(${m.frames} frames at ${m.w}x${m.h}${pk.area ? `; the most was ${pk.area} px, ${pk.kind}, at ${f3(pk.t)} s` : ''})`,
  { measured: { area: pk.area, kind: pk.kind }, threshold });
}

// ---------------------------------------------------------------- colour match (render.mjs palette, plan 23.2)
// sRGB 0-255 to CIE L*a*b* under D65 (the sRGB white), the space CIEDE2000 is defined in.
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
export function rgbToLab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function hexToLab(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
// CIEDE2000 colour difference between two L*a*b* colours (kL = kC = kH = 1), following the formula's published
// implementation notes; test/looks-units.test.mjs checks it against their 34 reference pairs.
const DEG = Math.PI / 180, P25 = Math.pow(25, 7);
export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb7 = Math.pow((C1 + C2) / 2, 7);
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + P25)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => { if (a === 0 && b === 0) return 0; const h = Math.atan2(b, a) / DEG; return h < 0 ? h + 360 : h; };
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p, CC = C1p * C2p;
  let dhp = 0;
  if (CC !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(CC) * Math.sin((dhp / 2) * DEG);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (CC !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? hbp / 2 : hbp < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
  const Tt = 1 - 0.17 * Math.cos((hbp - 30) * DEG) + 0.24 * Math.cos(2 * hbp * DEG) + 0.32 * Math.cos((3 * hbp + 6) * DEG) - 0.20 * Math.cos((4 * hbp - 63) * DEG);
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Cbp7 = Math.pow(Cbp, 7), Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + P25));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * Tt, Rt = -Math.sin(2 * dTh * DEG) * Rc;
  const l = dLp / Sl, c = dCp / Sc, h = dHp / Sh;
  return Math.sqrt(l * l + c * c + h * h + Rt * c * h);
}
// The colour match. hist: { colors: [0xRRGGBB, ...], counts: [n, ...] } (every probe pixel of every frame, counted by
// exact colour); palettes: [{ id, tokens: { name: '#RRGGBB' } }], the kit's first. Each colour goes to the nearest token
// (CIEDE2000) of any palette, the earlier one on a tie, or to none when it is more than `limit` from all of them. No
// clustering and no sampling, so the same frames always give the same result. Returns pixel counts:
// { total, none, palettes: [{ id, total, tokens: { name: n } }] }.
export function paletteMatch(hist, palettes, limit = T.palette.limit) {
  // The first palette is the kit. Two of its tokens with the same colour (an accent that is also the ink) are one
  // entry crediting both, so neither role can be starved by a tie with itself; every other palette keeps the
  // earlier-token rule. `roles` counts each pixel once per role: bg (bgA or bgB) and accent.
  const entries = [];
  palettes.forEach((p, pi) => {
    const seen = new Map();
    for (const [k, hex] of Object.entries(p.tokens)) {
      const key = String(hex).toUpperCase();
      if (pi === 0 && seen.has(key)) { seen.get(key).keys.push(k); continue; }
      const e = { pi, k, keys: [k], lab: hexToLab(hex) };
      seen.set(key, e); entries.push(e);
    }
  });
  const out = palettes.map((p) => ({ id: p.id, total: 0, tokens: Object.fromEntries(Object.keys(p.tokens).map((k) => [k, 0])), roles: { bg: 0, accent: 0 } }));
  let total = 0, none = 0;
  for (let i = 0; i < hist.colors.length; i++) {
    const c = hist.colors[i], n = hist.counts[i];
    total += n;
    const lab = rgbToLab((c >> 16) & 255, (c >> 8) & 255, c & 255);
    let best = -1, bd = Infinity;
    for (let e = 0; e < entries.length; e++) { const d = ciede2000(lab, entries[e].lab); if (d < bd) { bd = d; best = e; } }
    if (!(bd <= limit)) { none += n; continue; }
    const E = entries[best], o = out[E.pi];
    for (const k of E.keys) o.tokens[k] += n;
    o.total += n;
    if (E.keys.includes('bgA') || E.keys.includes('bgB')) o.roles.bg += n;
    if (E.keys.includes('accent')) o.roles.accent += n;
  }
  return { total, none, palettes: out };
}
// The rules on a match whose first palette is the kit's: its bgA and bgB together take at least T.palette.bg of the
// pixels and its accent at least T.palette.accent, and no other palette (a look's defaults, or the template's) takes
// more than either, role by role: no other bgA and bgB together more than the kit's, no other accent more than the
// kit's. (Whole palettes are not compared: white and near-black ink tokens sit within a few units of each other
// across palettes, so a piece drawn only in the kit's colours can give a look's ink more pixels than the kit's accent.)
// Returns { ok, bg, accent, rules: [{ ok, rule, measured, threshold }] }.
export function paletteResult(match) {
  const share = (n) => (match.total ? n / match.total : 0);
  const bgOf = (p) => share(p.roles ? p.roles.bg : (p.tokens.bgA || 0) + (p.tokens.bgB || 0));
  const accentOf = (p) => share(p.roles ? p.roles.accent : p.tokens.accent || 0);
  const kit = match.palettes[0], others = match.palettes.slice(1);
  const bg = bgOf(kit), accent = accentOf(kit);
  const most = (f) => others.map((p) => ({ id: p.id, v: f(p) })).sort((a, b) => b.v - a.v)[0] || { id: '(none)', v: 0 };
  const obg = most(bgOf), oac = most(accentOf);
  const pc = (x) => `${(x * 100).toFixed(2)}%`;
  const rules = [
    { ok: bg >= T.palette.bg, rule: `the kit's bgA and bgB take at least ${T.palette.bg * 100}% of the pixels`, measured: bg, threshold: T.palette.bg },
    { ok: accent >= T.palette.accent, rule: `the kit's accent takes at least ${T.palette.accent * 100}% of the pixels`, measured: accent, threshold: T.palette.accent },
    { ok: obg.v <= bg, rule: `no look's bgA and bgB take more than the kit's (${pc(bg)}); the most is ${obg.id}`, measured: obg.v, threshold: bg },
    { ok: oac.v <= accent, rule: `no look's accent takes more than the kit's (${pc(accent)}); the most is ${oac.id}`, measured: oac.v, threshold: accent },
  ];
  return { ok: rules.every((x) => x.ok), bg, accent, rules };
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

// ---------------------------------------------------------------- P10: a captioned clip (plan 23.5)
// A clip's captions are an alpha overlay, rendered on the clip's clock and laid over the clip by tools/clip.mjs
// composite into an opaque out/<name>.mp4, whose render record has kind: "composite", `overlay` (the SHA-256 of the
// overlay's render record, at `overlayFile`) and `clip` (the clip's SHA-256, at `clipFile`). check --file on its
// master binds the master to that record as for any render (provenance above), then here to the overlay: the overlay
// record must exist, match its hash and bind to the current source, and the clip must be the one composited.
// facts: { overlayFile, overlaySha, overlayExists, overlayShaNow, overlayRec, overlayRecError, sourceNow, clipFile, clipSha,
// clipExists, clipShaNow }. Returns { result, overlayRec, bound }.
export function compositeProvenance(f) {
  const P = (level, detail) => r('provenance', 'file', level, detail);
  const probs = [];
  let rec = null;
  if (!f.overlayFile || !f.overlaySha) probs.push('the composite\'s render record names no overlay record (overlay, overlayFile): composite it again with tools/clip.mjs');
  else if (!f.overlayExists) probs.push(`the overlay record ${f.overlayFile} that the composite names is missing: render the captions and composite again`);
  else if (f.overlayShaNow !== f.overlaySha) probs.push(`the overlay record ${f.overlayFile} changed after the composite (another render since): composite and mix again`);
  else if (f.overlayRecError) probs.push(`${f.overlayFile} is not readable: ${f.overlayRecError}`);
  else {
    rec = f.overlayRec;
    if (!rec.alpha) probs.push(`${f.overlayFile} is not an alpha render: render the captions with --alpha`);
    if (!rec.source || !f.sourceNow || rec.source.hash !== f.sourceNow.hash) probs.push(`the piece's source changed since the overlay was rendered (${f.overlayFile}): the overlay is stale, render it, composite and mix again`);
  }
  if (!f.clipFile || !f.clipSha) probs.push('the composite\'s render record names no clip (clip, clipFile)');
  else if (!f.clipExists) probs.push(`the clip ${f.clipFile} is missing`);
  else if (f.clipShaNow !== f.clipSha) probs.push(`the clip ${f.clipFile} is not the one composited (its SHA-256 differs): prepare, render, composite and mix again`);
  if (probs.length) return { result: P('FAIL', probs.join('; ')), overlayRec: rec, bound: false };
  return { result: P('OK', `the composite's overlay ${f.overlayFile} (${rec.scene}, alpha ${rec.alpha}) is bound to the current source, over the clip ${f.clipFile}`), overlayRec: rec, bound: true };
}
// The decoded picture's probe (P10: a composite is never replayed in the page, its frames are decoded with ffmpeg):
// frames at the probe size as RGB bytes -> the same measurements the page's checkScan gives for its probe: the luma
// (Rec. 709, 0-255) difference histogram of each consecutive pair and the first frame's luma mean and standard
// deviation. add(rgb) takes one frame; done() returns { frames, pairs, first }.
export function lumaScan({ firstOnly = false } = {}) {
  let prev = null, n = 0, first = null;
  const pairs = firstOnly ? null : [];
  return {
    add(rgb, w, h) {
      const luma = new Uint8Array(w * h);
      for (let i = 0, j = 0; j < luma.length; i += 3, j++) luma[j] = Math.round(0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]);
      if (!n) {
        let sum = 0, sq = 0;
        for (const v of luma) { sum += v; sq += v * v; }
        const mean = sum / luma.length;
        first = { mean, std: Math.sqrt(Math.max(0, sq / luma.length - mean * mean)), w, h };
      } else if (pairs) {
        const hist = {};
        for (let i = 0; i < luma.length; i++) { const d = Math.abs(luma[i] - prev[i]); if (d) hist[d] = (hist[d] || 0) + 1; }
        pairs.push(hist);
      }
      prev = firstOnly ? null : luma;
      n++;
    },
    done: () => ({ frames: n, pairs, first }),
  };
}
