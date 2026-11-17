// The flash rule's fixtures (plan 23.9, the flash part of the Acceptance paragraph), built as frames in code, each
// with its expected verdict and what the main loop's numpy simulation of the rule measured on it: how many frames
// fail and the first one (`sim: [failing, first]`). The first 55 are the simulation's own fixtures, in its order and
// built the same way (576x1024 frames, values cast to float32 as numpy casts them); the rest were added for P11a and
// run through the simulation's rule too. Nothing here is a real recording.
//
// A fixture: { name, kind: 'lum' | 'rgb', w, h, rate: { num, den }, n, frame(k), expect: 'FAIL' | 'pass', sim, random? }.
// frame(k) returns a Float32Array: relative luminance per pixel ('lum', followed by the general kind alone, as the
// simulation does for its grey fixtures) or sRGB 0-1 per channel ('rgb', both kinds). Three fixtures are random; their
// draws come from `draws` (default: a seeded generator here, so their failing counts may differ from the simulation's,
// whose numpy draws can be passed in to compare them exactly).

export const W = 576, H = 1024;
const f32 = Math.fround;

// mulberry32, seeded: the default draws for the random fixtures
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rate = (num, den = 1) => ({ num, den });
// A fixture whose frames are one value (lum) or one colour (rgb) each, cached per value.
function uniform(kind, w, h, vals) {
  const cache = new Map(), n = w * h;
  return (k) => {
    const v = vals[k], key = kind === 'lum' ? f32(v) : v.map(f32).join(',');
    if (!cache.has(key)) {
      const a = new Float32Array(kind === 'lum' ? n : n * 3);
      if (kind === 'lum') a.fill(v);
      else for (let i = 0; i < n * 3; i += 3) { a[i] = v[0]; a[i + 1] = v[1]; a[i + 2] = v[2]; }
      cache.set(key, a);
    }
    return cache.get(key);
  };
}
const lum = (name, vals, r, expect, sim, o = {}) => ({ name, kind: 'lum', w: o.w || W, h: o.h || H, rate: r, n: vals.length, frame: uniform('lum', o.w || W, o.h || H, vals), expect, sim, ...o });
const rgb = (name, cols, r, expect, sim) => ({ name, kind: 'rgb', w: W, h: H, rate: r, n: cols.length, frame: uniform('rgb', W, H, cols), expect, sim });
// A lum fixture drawn per pixel: v(k, x, y), cached per distinct key(k) when given.
function drawn(kind, name, n, r, expect, sim, v, key = null) {
  const cache = new Map();
  const make = (k) => {
    const a = new Float32Array(W * H * (kind === 'lum' ? 1 : 3));
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = v(k, x, y);
      if (kind === 'lum') a[i++] = c;
      else if (typeof c === 'number') { a[i++] = c; a[i++] = c; a[i++] = c; }
      else { a[i++] = c[0]; a[i++] = c[1]; a[i++] = c[2]; }
    }
    return a;
  };
  const frame = key ? (k) => { const kk = key(k); if (!cache.has(kk)) cache.set(kk, make(k)); return cache.get(kk); } : make;
  return { name, kind, w: W, h: H, rate: r, n, frame, expect, sim };
}
const rep = (arr, k) => Array.from({ length: k }, () => arr).flat();
const fill = (k, v) => new Array(k).fill(v);
const range = (n, fn) => Array.from({ length: n }, (_, k) => fn(k));
const pymod = (a, m) => ((a % m) + m) % m;   // Python's %, never negative
// numpy's lerp in float32: a * f32(1 - t) and b * f32(t), each rounded to float32, summed in float32
const lerp = (a, b, t) => a.map((x, i) => f32(f32(x * f32(1 - t)) + f32(b[i] * f32(t))));
// toggles a level at the listed frames, from 0.1
function marks(n, at) {
  let level = 0.1;
  return range(n, (k) => { if (at.includes(k)) level = level === 0.1 ? 0.5 : 0.1; return level; });
}

export function fixtures({ draws = null } = {}) {
  const R = rng(1), R2 = rng(7);
  const noisy = draws ? draws.noisy : null, grain = draws ? draws.grain : null;
  const tri = range(121, (k) => 0.10 + 0.28 * (1 - Math.abs(2 * ((k % 15) / 15.0) - 1)));
  const X = [];

  // ---- the simulation's 55, in its order
  X.push(lum('strobe every frame 30 fps', range(61, (i) => (i % 2 === 0 ? 0.1 : 0.5)), rate(30), 'FAIL', [53, 8]));
  X.push(lum('strobe every frame 60 fps', range(121, (i) => (i % 2 === 0 ? 0.1 : 0.5)), rate(60), 'FAIL', [113, 8]));
  const pat = fill(15, 0.1); pat[0] = 0.9; pat[1] = 0.1; pat[2] = 0.9; pat[3] = 0.9; pat[4] = 0.1;
  X.push(lum('uneven strobe (grok r4)', [0.1, ...rep(pat, 4)], rate(30), 'FAIL', [41, 20]));
  X.push(lum('4 Hz triangular ramp 0.10-0.38 at 60 fps', tri, rate(60), 'FAIL', [65, 56]));
  X.push(lum('ramp with small reversals (codex r3)', [...rep([0.10, 0.18, 0.17, 0.25, 0.24, 0.32, 0.31, 0.39, 0.31, 0.32, 0.24, 0.25, 0.17, 0.18, 0.10], 8), 0.10], rate(60), 'FAIL', [66, 55]));
  X.push({ ...lum('noisy 4 Hz ramp', tri.map((v, k) => (noisy ? noisy[k] : v + R() * 0.04 - 0.02)), rate(60), 'FAIL', [65, 55]), random: true });
  X.push(lum('up-down 4 times in a second', [...rep([0.1, 0.1, 0.1, 0.5, 0.5, 0.5, 0.1], 8), 0.1, 0.1, 0.1], rate(30), 'FAIL', [32, 27]));
  X.push(lum('three flashes then a held rise (codex/grok r6)', [0.1, 0.1, 0.1, ...range(19, (k) => (Math.floor(k / 3) % 2 === 0 ? 0.5 : 0.1)), ...fill(40, 0.5)], rate(30), 'pass', [0, null]));
  X.push(lum('up-down 3 times in a second, then hold', [0.1, 0.1, ...rep([0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.1, 0.1], 3), ...fill(40, 0.1)], rate(30), 'pass', [0, null]));
  const halves = (name, n, fps, perS, expect, sim) => drawn('lum', name, n, rate(fps), expect, sim,
    (k, x) => (Math.floor(x / 8) % 2 === Math.trunc((k / fps) * perS) % 2 ? 0.1 : 0.5), (k) => Math.trunc((k / fps) * perS) % 2);
  X.push(halves('8 px halves swapping 8 times a second (8 transitions/px)', 61, 30, 8, 'FAIL', [31, 30]));
  X.push(halves('8 px halves swapping 4 times a second (4 transitions/px)', 61, 30, 4, 'pass', [0, null]));
  X.push(drawn('lum', '6x6 spot per 16x16 cell, 4 Hz', 61, rate(30), 'pass', [0, null],
    (k, x, y) => (x % 16 < 6 && y % 16 < 6 && Math.trunc((k / 30) * 8) % 2 === 1 ? 0.9 : 0.0), (k) => Math.trunc((k / 30) * 8) % 2));
  const bar = (name, repeat, expect, sim) => drawn('lum', name, 61, rate(30), expect, sim, (k, x, y) => {
    const p = repeat ? k % 7 : k;
    return p < 4 && y < 256 && x >= p * 32 && x < p * 32 + 32 ? 0.9 : 0.1;
  }, (k) => { const p = repeat ? k % 7 : k; return p < 4 ? p : -1; });
  X.push(bar('32x256 bar stepping across once', false, 'pass', [0, null]));
  X.push(bar('32x256 bar repeating its path 4.3 times a second (Q24)', true, 'FAIL', [36, 25]));
  const band = (name, n, fps, sim) => {
    const bw = Math.floor(W / 4), x0 = (k) => Math.trunc((((k / fps) * 4) % 1.0) * (W + bw)) - bw;
    return drawn('lum', name, n, rate(fps), 'FAIL', sim, (k, x) => {
      const a = Math.max(0, x0(k)), b = Math.max(0, Math.min(W, x0(k) + bw));
      return x >= a && x < b ? 0.9 : 0.1;
    }, x0);
  };
  X.push(band('band 25% wide crossing 4 times a second, 30 fps', 61, 30, [36, 25]));
  X.push(band('band 25% wide crossing 4 times a second, 60 fps (codex r5)', 121, 60, [71, 50]));
  const seqp = [0.5, ...fill(39, 0.1), ...fill(31, 0.1)];
  for (const st of [40, 46, 52, 58]) { seqp[st] = 0.5; seqp[st + 1] = 0.5; }
  X.push(lum('lone transition then four flashes (codex r5)', seqp, rate(30), 'FAIL', [10, 60]));
  const sa = [...fill(30, 0.1), ...fill(30, 0.5), ...fill(30, 0.1)];
  [60, 63, 66, 69, 72, 75, 78, 81].forEach((t, i) => { for (let k = t; k < t + 3; k++) sa[k] = i % 2 === 0 ? 0.1 : 0.5; });
  X.push(lum('lone up, then down/up every 3 frames (sonnet r5)', sa, rate(30), 'FAIL', [9, 81]));
  // np.array_split(range(576), 7): two columns of 83, five of 82
  const colOf = (x) => (x < 166 ? Math.floor(x / 83) : 2 + Math.floor((x - 166) / 82));
  X.push(drawn('lum', 'staggered column strobe 60 fps (sonnet r5)', 121, rate(60), 'FAIL', [68, 53],
    (k, x) => (pymod(k - colOf(x), 15) < 7 ? 0.5 : 0.1), (k) => k % 15));
  const pulses = (starts, len) => { const g = fill(45, 0.1); for (const st of starts) for (let k = st; k < st + len; k++) g[k] = 0.5; return g; };
  X.push(lum('four 7-frame pulses spanning 1.03 s (grok r5)', pulses([1, 9, 17, 25], 7), rate(30), 'pass', [0, null]));
  X.push(lum('four 6-frame pulses within 0.9 s', pulses([1, 8, 15, 22], 6), rate(30), 'FAIL', [3, 28]));
  const box = (name, y0, y1, x0, x1, sim) => drawn('lum', name, 61, rate(30), 'FAIL', sim,
    (k, x, y) => (Math.floor(k / 4) % 2 === 1 && y >= y0 && y < y1 && x >= x0 && x < x1 ? 0.9 : 0.1), (k) => Math.floor(k / 4) % 2);
  X.push(box('65x341 rectangle, 4 flashes a second (either orientation)', 100, 441, 100, 165, [15, 32]));
  X.push(box('341x65 strip, 4 flashes a second (landscape window)', 100, 165, 100, 441, [15, 32]));
  X.push(lum('bright flicker between 0.85 and 1.0 (darker above 0.8)', range(61, (k) => (k % 2 ? 0.85 : 1.0)), rate(30), 'pass', [0, null]));
  X.push(lum('0.08 swings every frame (under the threshold)', range(61, (k) => (k % 2 ? 0.30 : 0.38)), rate(30), 'pass', [0, null]));
  X.push(lum('slow fade up and down over 2 s', range(61, (k) => 0.1 + 0.8 * (1 - Math.abs(2 * (k / 60) - 1))), rate(30), 'pass', [0, null]));
  X.push({ ...lum('grain only', range(31, (k) => (grain ? grain[k] : 0.3 + R() * 0.04 - 0.02)), rate(30), 'pass', [0, null]), random: true });
  // red, with little luminance between the states, so the general kind cannot stand in for it
  const RA = [0.9, 0, 0].map(f32), RB = [0.575, 0, 0.525].map(f32);
  const redflash = (transitions, n = 61, period = 3) => {
    const out = [RA, RA, RA];
    let cur = RA, ch = 0;
    for (let k = 3; k < n; k++) { if (ch < transitions && (k - 3) % period === 0 && k > 3) { cur = cur === RA ? RB : RA; ch++; } out.push(cur); }
    return out;
  };
  X.push(rgb('red <-> purple, 8 transitions in a second (4 red flashes)', redflash(8), rate(30), 'FAIL', [9, 27]));
  X.push(rgb('red <-> purple, 6 transitions in a second (3 red flashes)', redflash(6), rate(30), 'pass', [0, null]));
  {
    const A = [0.08, 0.019, 0], B = [0.6, 0, 0], C = [0.288654, 0.288654, 0.288654], seq = [A, B, B, B];
    let cur = B;
    for (let k = 4; k < 61; k++) { if (k <= 25 && (k - 4) % 3 === 0) cur = cur === B ? C : B; seq.push(cur); }
    X.push(rgb('earlier colour, then 4 red flashes (codex r6)', seq, rate(30), 'FAIL', [9, 25]));
  }
  X.push(drawn('rgb', 'one general and one red strip, each under the area (separate kinds)', 61, rate(30), 'pass', [0, null], (k, x, y) => {
    const on = Math.floor((k - 2) / 2) % 2 !== 0 && k >= 2 && k <= 17;
    if (x < 341 && y < 33) return on ? 0.7354 : 0.3492;
    if (x < 341 && y < 66) return on ? RB : RA;
    return 0.3492;
  }, (k) => (Math.floor((k - 2) / 2) % 2 !== 0 && k >= 2 && k <= 17 ? 1 : 0)));
  const MID = lerp(RA, RB, 0.5);
  X.push(rgb('red fade via a bridge colour, 4 flashes (codex/grok r7)', [RA, ...rep([MID, RB, MID, RA], 4), ...fill(30, RA)], rate(30), 'FAIL', [16, 16]));
  X.push(rgb('red fade via a bridge colour, 3 flashes', [RA, ...rep([MID, RB, MID, RA], 3), ...fill(40, RA)], rate(30), 'pass', [0, null]));
  const ramp = (p) => range(61, (k) => lerp(RA, RB, 1 - Math.abs(2 * ((k % p) / p) - 1)));
  X.push(rgb('red triangular ramp reaching both ends, 6-frame period', ramp(6), rate(30), 'FAIL', [37, 24]));
  X.push(rgb('red ramp peaking 86% of the way (under 0.2 apart)', ramp(7), rate(30), 'pass', [0, null]));
  X.push(rgb('red ramp, 8-frame period (four flashes within 0.93 s)', ramp(8), rate(30), 'FAIL', [16, 31]));
  X.push(rgb('red ramp, 10-frame period (3 a second)', ramp(10), rate(30), 'pass', [0, null]));
  X.push(lum('8 transitions in 0.968 s at 29.97 fps (codex r7)', marks(60, [1, 5, 9, 13, 17, 21, 25, 30]), rate(30000, 1001), 'FAIL', [1, 30]));
  X.push(lum('8 transitions in 1.001 s at 29.97 fps', marks(60, [1, 5, 9, 13, 17, 21, 25, 31]), rate(30000, 1001), 'pass', [0, null]));
  // fine patterns (Q25: not excepted)
  const check = (k, x, y, sq) => (Math.floor(y / sq) + Math.floor(x / sq)) % 2 === 1;
  const checker = (name, n, sq, sim) => drawn('lum', name, n, rate(30), 'FAIL', sim, (k, x, y) => (check(k, x, y, sq) !== (k % 2 === 1) ? 0.5 : 0.1), (k) => k % 2);
  X.push(checker('2x2 px checkerboard inverting every frame (grok r7; Q25)', 61, 2, [53, 8]));
  X.push(checker('4x4 px checkerboard inverting every frame', 61, 4, [53, 8]));
  {
    const lo = 0.4731206227, hi = 0.5838314901, mid = (lo + hi) / 2;
    X.push(drawn('rgb', '4x4 checks 0.19/0.30 in a 256 px patch (codex r8)', 31, rate(30), 'FAIL', [23, 8], (k, x, y) => {
      if (x < 100 || x >= 356 || y < 100 || y >= 356) return mid;
      const inv = k >= 1 && k <= 8 && k % 2 === 1;
      return check(k, x - 100, y - 100, 4) !== inv ? hi : lo;
    }, (k) => (k >= 1 && k <= 8 && k % 2 === 1 ? 1 : 0)));
  }
  X.push(drawn('rgb', '6 px bars in phase, 0.125 swing (grok r8)', 31, rate(30), 'FAIL', [23, 8],
    (k, x) => (k % 2 && x % 20 < 6 ? 137 / 255 : 99 / 255), (k) => k % 2));
  const checkrgb = (name, sq) => drawn('rgb', name, 31, rate(30), 'FAIL', [23, 8], (k, x, y) => (check(k, x, y, sq) !== (k % 2 === 1) ? 1.0 : 0.0), (k) => k % 2);
  X.push(checkrgb('2x2 checkerboard black/white inverting (sonnet r8)', 2));
  X.push(checkrgb('1x1 checkerboard black/white inverting', 1));
  X.push(checker('3x3 checkerboard 0.1/0.5 inverting (grok r8)', 31, 3, [23, 8]));
  X.push({
    name: 'full-range white noise every frame (Q25)', kind: 'rgb', w: W, h: H, rate: rate(30), n: 31, expect: 'FAIL', sim: [20, 11], random: true,
    frame: (k) => {
      const a = new Float32Array(W * H * 3), src = draws ? draws.noise(k) : null;
      for (let p = 0; p < W * H; p++) { const v = src ? src[p] : f32(R2()); a[3 * p] = v; a[3 * p + 1] = v; a[3 * p + 2] = v; }
      return a;
    },
  });
  X.push(lum('8 transitions, first exactly 1 s before the last (codex r8)', marks(40, [2, 6, 10, 14, 18, 22, 26, 32]), rate(30), 'pass', [0, null]));
  // round 9: a lattice of opposite pixels must not excuse a strobe
  const lattice = (name, aOn, aOff, bOn, bOff) => drawn('lum', name, 31, rate(30), 'FAIL', [23, 8],
    (k, x, y) => (x % 4 === 0 && y % 4 === 0 ? (k % 2 === 0 ? aOn : aOff) : (k % 2 === 0 ? bOn : bOff)), (k) => k % 2);
  X.push(lattice('strobe with a counter-moving pixel in every 4x4 (round 9)', 0.5, 0.1, 0.1, 0.5));
  X.push(lattice('0.1/0.7 strobe with 0.11 counter-moving dots (sonnet r9)', 0.60, 0.49, 0.1, 0.7));
  // round 10: the red ratio on linear RGB; a short frame; the exact rate
  const alt = (a, b, n = 31, period = 1) => range(n, (k) => (Math.floor(k / period) % 2 === 0 ? a : b));
  X.push(rgb('red by linear ratio: (0.8,0.15,0.15) <-> (0.2,0,1) (grok r10)', alt([0.8, 0.15, 0.15], [0.2, 0.0, 1.0]), rate(30), 'FAIL', [23, 8]));
  X.push(rgb('red by linear ratio: (230,60,60) <-> (0,130,0), every 3 frames (sonnet r10)', alt([230 / 255, 60 / 255, 60 / 255], [0, 130 / 255, 0], 31, 3), rate(30), 'FAIL', [7, 24]));
  X.push(rgb('red by linear ratio: (0.6,0.16,0) <-> grey 0.3 (codex r10)', [...range(9, (k) => (k % 2 === 0 ? [0.6, 0.16, 0] : [0.3, 0.3, 0.3])), ...fill(20, [0.6, 0.16, 0])], rate(30), 'FAIL', [21, 8]));
  X.push(lum('full strobe on a 1024x200 frame (grok r10)', range(31, (k) => (k % 2 === 0 ? 0.1 : 0.5)), rate(30), 'FAIL', [23, 8], { w: 1024, h: 200 }));
  X.push(lum('8 transitions at 3000001/100000 fps (codex r10)', marks(40, [1, 5, 9, 13, 17, 21, 25, 31]), rate(3000001, 100000), 'FAIL', [1, 31]));

  // ---- added in P11a, run through the simulation's rule as well
  X.push(lum('general fade via a middle level, 3 flashes', [0.1, ...rep([0.3, 0.5, 0.3, 0.1], 3), ...fill(40, 0.1)], rate(30), 'pass', [0, null]));
  X.push(lum('general fade via a middle level, 4 flashes', [0.1, ...rep([0.3, 0.5, 0.3, 0.1], 4), ...fill(30, 0.1)], rate(30), 'FAIL', [16, 15]));
  X.push(lum('general ramp, 10-frame period (3 a second)', range(61, (k) => 0.1 + 0.4 * (1 - Math.abs(2 * ((k % 10) / 10.0) - 1))), rate(30), 'pass', [0, null]));
  X.push(lum('general ramp, 8-frame period', range(61, (k) => 0.1 + 0.4 * (1 - Math.abs(2 * ((k % 8) / 8.0) - 1))), rate(30), 'FAIL', [16, 30]));
  // the red ratio's edge on linear RGB (0.82 is red, 0.78 is not), each against a blue about 0.25 away in u'v' at a
  // luminance within 0.05 of it
  const BLUE = [0.24780052799263164, 0.42358287124447963, 0.7977377330312598];
  X.push(rgb('red ratio 0.82 on linear RGB <-> blue, every 3 frames', alt([0.7353569830524495, 0.3651758301031114, 0], BLUE, 31, 3), rate(30), 'FAIL', [7, 24]));
  X.push(rgb('red ratio 0.78 on linear RGB <-> blue, every 3 frames', alt([0.7353569830524495, 0.41143735862151776, 0], BLUE, 31, 3), rate(30), 'pass', [0, null]));
  // the far end of the swing: from a red out to a green 0.30 away at a constant luminance of 0.2, then back only to 0.06
  // from the red. Only a far end that follows the colour to 0.30 sees the way back (0.24) as a flash.
  const FAR = { 0: [0.9733356546824062, 0, 0], 0.06: [0.8849398831488305, 0.25830344855785364, 0], 0.12: [0.7860103640247061, 0.36085154116153717, 0],
    0.18: [0.6708234846591951, 0.4346509867299272, 0], 0.24: [0.526369243860245, 0.49397611575539696, 0], 0.3: [0.3041958063840866, 0.5442013409168255, 0] };
  const pos = [0, 0.06, 0.12, 0.18, 0.24, 0.3, ...rep([0.24, 0.18, 0.12, 0.06, 0.12, 0.18, 0.24, 0.3], 6), ...fill(10, 0.3)];
  X.push(rgb('red far end: out to 0.30, back to 0.06 from the red, 4 a second', pos.map((d) => FAR[d]), rate(30), 'FAIL', [11, 33]));
  // one pixel, four general transitions and then four red ones within a second: each kind under the limit on its own
  const G1 = [0.3492, 0.3492, 0.3492], G2 = [0.7354, 0.7354, 0.7354];
  X.push(rgb('four general then four red transitions on one pixel in a second', [G1, G1, G2, G2, G1, G1, G2, G2, G1, G1, RB, RB, RA, RA, RB, RB, RA, RA, RB, RB, ...fill(40, RB)], rate(30), 'pass', [0, null]));
  return X;
}

// Runs a fixture through the tracker: { verdict, failing, first, result }.
export function runFixture(C, fx) {
  const tr = C.flashTracker({ w: fx.w, h: fx.h, rate: fx.rate, red: fx.kind === 'rgb' });
  for (let k = 0; k < fx.n; k++) (fx.kind === 'rgb' ? tr.pushRGB : tr.pushLum)(fx.frame(k));
  const res = tr.result();
  return { verdict: res.failing ? 'FAIL' : 'pass', failing: res.failing, first: res.first ? res.first.f : null, result: res };
}
