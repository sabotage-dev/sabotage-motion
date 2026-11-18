// energy_match (plan 23.9, Q21-Q23; P11b-2), the rule as plain functions of the measurements: the energy and tempo a
// piece states, its declared cuts as shots and transitions, a cut confirmed by the frames, motion outside holds and
// transitions, ink split into lines, boxes mapped through the camera, and the verdict at each preset's edges. No browser
// here: test/energy-match.test.mjs runs the calibration fixtures through `render.mjs check`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C } from './check-helpers.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { templateDir } from './helpers.mjs';

const { ENERGY } = await import(pathToFileURL(path.join(templateDir, 'energy.js')).href);

const E = C.T.energy;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
// a histogram (256 counts) with `n` pixels at difference d and the rest at 0
const hist = (npx, d, n) => { const h = new Array(256).fill(0); h[d] += n; h[0] += npx - n; return h; };

test('the thresholds as tuned on the calibration fixtures, and the presets as plan 23.9 and Q23 give them', () => {
  assert.deepEqual(E, { cut: { share: 0.20, delta: 16, shot: 0.15, d: 0.3 }, motion: { delta: 16 }, ink: { delta: 32, rel: 0.5, px: 1 }, tempo: 0.10 });
  // the ranges are energy.js's ENERGY (P11b-1), which check.mjs imports rather than copies
  assert.equal(C.ENERGY_RANGES, undefined, 'check.mjs keeps no copy of the ranges');
  const only = ({ bpm, cutBeats, inkHeight, motion }) => ({ bpm, cutBeats, inkHeight, motion });
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(ENERGY).map(([k, v]) => [k, only(v)])))), {
    subtle: { bpm: 84, cutBeats: [4, 5], inkHeight: [0.04, 0.08], motion: { max: 0.10 } },
    normal: { bpm: 116, cutBeats: [2, 3], inkHeight: [0.09, 0.16], motion: { min: 0.02 } },
    extreme: { bpm: 136, cutBeats: [0.5, 1], inkHeight: [0.18, 0.35], motion: { min: 0.06 } },
  });
  assert.ok(C.SOURCE_IDS.includes('energy_match') && C.ALL_IDS.includes('energy_match'));
});

test('the energy (council R1 I2, as P11b-1\'s energyName()): --param energy, else CFG.ENERGY, else the board, else normal; a name that is not a preset is an error', () => {
  assert.deepEqual(C.energySetting({}), { energy: 'normal', from: 'the default' });
  assert.deepEqual(C.energySetting({ cfg: 'subtle' }), { energy: 'subtle', from: 'CFG.ENERGY' });
  assert.deepEqual(C.energySetting({ board: 'extreme' }), { energy: 'extreme', from: 'the board' });
  assert.deepEqual(C.energySetting({ board: 'extreme', cfg: 'subtle' }), { energy: 'subtle', from: 'CFG.ENERGY' }, 'CFG.ENERGY before the board');
  assert.deepEqual(C.energySetting({ param: 'subtle', board: 'extreme', cfg: 'normal' }), { energy: 'subtle', from: '--param energy' });
  assert.deepEqual(C.energySetting({ param: '', board: 'extreme' }), { energy: 'extreme', from: 'the board' });
  assert.match(C.energySetting({ board: 'wild' }).error, /^board\.js energy "wild": one of subtle, normal, extreme$/, 'energyName()\'s own words');
  assert.ok(C.energySetting({ param: 'toString' }).error, 'an inherited property is not a preset');
});

test('the tempo (Q22): the preset\'s, or the piece\'s own within 10% of it; beyond that, the nearer end of the band', () => {
  assert.deepEqual(C.energyTempo('normal'), { bpm: 116, note: 'the preset\'s 116 BPM' });
  assert.deepEqual(C.energyTempo('extreme', 140), { bpm: 140, note: '140 BPM' });
  assert.equal(C.energyTempo('extreme', 136 * 1.1).bpm, 136 * 1.1, 'exactly 10% over is inside');
  assert.equal(C.energyTempo('extreme', 122.4).bpm, 122.4, 'exactly 10% under is inside');
  const hi = C.energyTempo('extreme', 160);
  assert.equal(hi.bpm, 149.6); assert.match(hi.note, /tempo 160 BPM is more than 10% from the preset's 136 \(Q22\), so 149\.6 BPM/);
  assert.equal(C.energyTempo('subtle', 60).bpm, 75.6);
  assert.equal(C.energyTempo('normal', 'fast').bpm, 116);
});

test('cuts(): a list of { t, d }, t inside the piece, d 0 to 0.3 s', () => {
  assert.equal(C.validCuts([], 2), null);
  assert.equal(C.validCuts([{ t: 1 }, { t: 0.5, d: 0.3 }, { t: 2, d: 0 }], 2), null);
  assert.match(C.validCuts(null, 2), /must return a list/);
  assert.match(C.validCuts([{ t: 'x' }], 2), /item 0 .* is not \{ t, d \}/);
  assert.match(C.validCuts([{ t: 1, d: null }, { t: 1, d: 'a' }], 2), /item 1/);
  assert.match(C.validCuts([{ t: 2.5 }], 2), /outside the piece/);
  assert.match(C.validCuts([{ t: -0.1 }], 2), /outside the piece/);
  assert.match(C.validCuts([{ t: 1, d: 0.31 }], 2), /d 0\.31 s is not 0-0\.3 s/);
  assert.match(C.validCuts([{ t: 1, d: -0.1 }], 2), /d -0\.1 s/);
});

test('shots and transitions: a hard cut, a transition, overlapping ones as one', () => {
  assert.deepEqual(C.energyRegions([], 2), { shots: [[0, 2]], regions: [] });
  assert.deepEqual(C.energyRegions([{ t: 1, d: 0 }], 2), { shots: [[0, 1], [1, 2]], regions: [{ a: 1, b: 1, cuts: [{ t: 1, d: 0 }], before: 0, after: 1 }] });
  const w = C.energyRegions([{ t: 0.9, d: 0.3 }], 2);
  near(w.shots[1][0], 1.2); assert.equal(w.regions[0].a, 0.9);
  const o = C.energyRegions([{ t: 1.0, d: 0.3 }, { t: 1.2, d: 0.3 }], 3);
  assert.equal(o.regions.length, 1); near(o.regions[0].b, 1.5); assert.equal(o.regions[0].cuts.length, 2);
  // a transition inside another: the region keeps the outer one's end
  const n = C.energyRegions([{ t: 1.0, d: 0.3 }, { t: 1.1, d: 0.05 }], 3);
  assert.equal(n.regions.length, 1); near(n.regions[0].b, 1.3); near(n.shots[1][0], 1.3);
  // unsorted input is sorted
  assert.deepEqual(C.energyRegions([{ t: 2, d: 0 }, { t: 1, d: 0 }], 3).shots, [[0, 1], [1, 2], [2, 3]]);
});

test('a "shot" shorter than 0.15 s is part of the transition: a flash declared as two cuts is one region; 0.15 s is a shot', () => {
  const f = C.energyRegions([{ t: 1, d: 0 }, { t: 1 + 1 / 30, d: 0 }], 2);
  assert.equal(f.regions.length, 1); assert.equal(f.shots.length, 2);
  assert.deepEqual([f.regions[0].before, f.regions[0].after], [0, 1]); near(f.shots[1][0], 1 + 1 / 30);
  const s = C.energyRegions([{ t: 1, d: 0 }, { t: 1.14, d: 0 }], 2);
  assert.equal(s.regions.length, 1, '0.14 s is not a shot');
  const k = C.energyRegions([{ t: 1, d: 0 }, { t: 1.15, d: 0 }], 2);
  assert.equal(k.regions.length, 2, '0.15 s is a shot'); assert.deepEqual(k.shots[1], [1, 1.15]);
  // a lead-in or a tail too short to be a shot: that side has none
  const lead = C.energyRegions([{ t: 0.1, d: 0 }], 2);
  assert.equal(lead.regions[0].before, null); assert.equal(lead.regions[0].a, 0); assert.deepEqual(lead.shots, [[0.1, 2]]);
  const tail = C.energyRegions([{ t: 1.9, d: 0 }], 2);
  assert.equal(tail.regions[0].after, null); assert.equal(tail.regions[0].b, 2); assert.deepEqual(tail.shots, [[0, 1.9]]);
});

test('an A-B-A-B run of half-beat shots at 136 BPM is fourteen regions, each with a shot on both sides', () => {
  const b = 60 / 136 / 2, cuts = Array.from({ length: 14 }, (_, i) => ({ t: (i + 1) * b, d: 0 }));
  const g = C.energyRegions(cuts, 15 * b);
  assert.equal(g.shots.length, 15); assert.equal(g.regions.length, 14);
  assert.ok(g.regions.every((x) => x.before != null && x.after != null));
  const p = C.energyPairs(g, 30, Math.round(15 * b * 30));
  assert.equal(new Set(p.flat()).size, 15, 'one probe frame inside each shot');
  p.forEach(([a, c], i) => { assert.ok(a / 30 + 0.25 / 30 < g.regions[i].a && c / 30 + 0.25 / 30 > g.regions[i].b); });
});

test('the probe frame of a shot is the one sampled nearest its middle (frame f is sampled at (f + 0.25) / fps)', () => {
  assert.equal(C.shotFrame([0, 1], 30, 60), 15);       // 0.5 s: frame 15 at 0.508, frame 14 at 0.475
  assert.equal(C.shotFrame([1, 2], 30, 60), 45);
  assert.equal(C.shotFrame([0, 0.02], 30, 60), 0);
  assert.equal(C.shotFrame([0, 0.1], 30, 60), 1, '0.05 s: frame 1 at 0.042 s, not frame 2 at 0.075 s');
  assert.equal(C.shotFrame([1.9, 2.5], 30, 60), 59, 'clamped to the last frame');
  assert.deepEqual(C.energyPairs(C.energyRegions([{ t: 0.1, d: 0 }, { t: 1, d: 0 }], 2), 30, 60), [null, [16, 45]]);
});

test('a share counts the pixels at the delta or more', () => {
  const h = hist(100, 16, 20);
  assert.equal(C.shareAtLeast(h, 100, 16), 0.2);
  assert.equal(C.shareAtLeast(h, 100, 17), 0);
  assert.equal(C.shareAtLeast(hist(100, 15, 20), 100, 16), 0);
  assert.equal(C.shareAtLeast([], 0, 16), 0);
});

test('motion: the median share over the pairs, holds left out, and only the pairs at a confirmed cut or in a transition', () => {
  const npx = 1000, fps = 10;
  const H = (vals) => vals.map((v) => hist(npx, 16, Math.round(v * npx)));
  // five pairs: 0.1 0.2 0.3 0.4 0.5 -> 0.3; even counts average the middle two
  assert.deepEqual(C.energyMotion(H([0.5, 0.1, 0.4, 0.2, 0.3]), npx, { fps }), { motion: 0.3, pairs: 5 });
  near(C.energyMotion(H([0.1, 0.2, 0.3, 0.4]), npx, { fps }).motion, 0.25);
  // a change under 16/255 is not motion
  assert.equal(C.energyMotion([hist(npx, 15, npx)], npx, { fps }).motion, 0);
  // pair k samples (k + 0.25) / fps and (k + 1.25) / fps; its middle (k + 0.75) / fps inside a hold leaves it out
  assert.deepEqual(C.energyMotion(H([0.9, 0.1, 0.1]), npx, { fps, holds: [[0, 0.1]] }), { motion: 0.1, pairs: 2 });
  assert.deepEqual(C.energyMotion(H([0.9, 0.1]), npx, { fps, holds: [[0, 0.075]] }), { motion: 0.5, pairs: 2 }, 'a hold ending at the middle leaves it in');
  // a confirmed hard cut at 0.15 s: pair 0 (0.025, 0.125) is before it, pair 1 (0.125, 0.225) straddles it
  const cut = { a: 0.15, b: 0.15 };
  assert.deepEqual(C.energyMotion(H([0.1, 0.9, 0.1]), npx, { fps, confirmed: [cut] }), { motion: 0.1, pairs: 2 });
  assert.deepEqual(C.energyMotion(H([0.1, 0.9, 0.1]), npx, { fps, cuts: [{ t: 0.15, d: 0 }] }), { motion: 0.1, pairs: 3 }, 'an unconfirmed hard cut leaves its pair in');
  // a cut exactly at a sample: the pair whose first sample is on it is after the cut
  assert.equal(C.energyMotion(H([0.1, 0.9]), npx, { fps, confirmed: [{ a: 0.125, b: 0.125 }] }).pairs, 1);
  // a declared transition 0.2-0.4 s, confirmed or not, leaves out the pairs that overlap it: pairs 1, 2, 3
  for (const o of [{ cuts: [{ t: 0.2, d: 0.2 }] }, { confirmed: [{ a: 0.2, b: 0.4 }] }]) {
    const m = C.energyMotion(H([0.1, 0.9, 0.9, 0.9, 0.2]), npx, { fps, ...o });
    near(m.motion, 0.15); assert.equal(m.pairs, 2);
  }
  assert.deepEqual(C.energyMotion(H([0.5]), npx, { fps, holds: [[0, 1]] }), { motion: null, pairs: 0 });
});

test('ink: rows split into lines at empty rows; a line\'s height is its run', () => {
  assert.deepEqual(C.inkLines([0, 3, 4, 0, 0, 5, 1, 1, 0]), [2, 3]);
  assert.deepEqual(C.inkLines([2, 2, 2]), [3]);
  assert.deepEqual(C.inkLines([0, 0]), []);
  assert.deepEqual(C.inkLines([1, 0, 1]), [1, 1], 'one pixel is ink');
});

test('boxes to probe rectangles: through the camera as text_safe maps them, deco and off-screen boxes left out', () => {
  const W = 1000, H = 2000, frames = [
    { f: 0, cam: [1, 0, 0, 0], boxes: [{ id: 'a', text: 'A', x: 100, y: 200, w: 300, h: 100 }, { id: 'd', text: 'D', x: 0, y: 0, w: 50, h: 50, deco: true }] },
    { f: 1, cam: [2, 0, 0, 0], boxes: [{ id: 'a', text: 'A', x: 400, y: 950, w: 200, h: 100 }] },
    { f: 2, cam: [1, 0, 0, 0], boxes: [{ id: 'gone', text: 'G', x: -500, y: 0, w: 100, h: 100 }] },
  ];
  const R = C.energyRects(frames, W, H, 500, 1000);
  assert.deepEqual(Object.keys(R), ['0', '1']);
  assert.deepEqual(R[0], [{ id: 'a', text: 'A', r: [50, 100, 200, 150] }]);
  assert.deepEqual(R[1][0].r, [150, 450, 350, 550], 'zoom 2 about the centre doubles the box (400-600 x 950-1050 to 300-700 x 900-1100)');
});

test('type: the tallest line over the piece; a three-line block reads as one line; a box with no ink is reported', () => {
  const rects = { 3: [{ id: 'block', text: 'B', r: [0, 0, 1, 11] }, { id: 'none', text: 'N', r: [0, 0, 1, 2] }], 5: [{ id: 'big', text: 'G', r: [0, 0, 1, 4] }] };
  const ink = { 3: [[1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1], [0, 0]], 5: [[2, 2, 2, 2]] };
  const ty = C.energyType(rects, ink, 100);
  assert.equal(ty.type, 0.04); assert.deepEqual(ty.best, { rows: 4, f: 5, id: 'big', text: 'G' });
  assert.deepEqual(ty.inkless, [{ id: 'none', text: 'N', f: 3, inked: false }]);
  assert.equal(C.energyType({ 3: rects[3].slice(0, 1) }, { 3: [ink[3][0]] }, 100).type, 0.03, 'three lines of 3, not 11');
  assert.deepEqual(C.energyType({}, {}, 100), { type: null, best: null, inkless: [] });
  // a box inked at one frame and not at another is not reported
  assert.deepEqual(C.energyType({ 1: [{ id: 'x', text: 'X', r: [0, 0, 1, 1] }], 2: [{ id: 'x', text: 'X', r: [0, 0, 1, 1] }] }, { 1: [[0]], 2: [[1]] }, 10).inkless, []);
});

// ---------------------------------------------------------------- the verdict
// A piece of `dur` s at 30 fps with confirmed cuts at `cuts` (each pair differing in `share` of the pixels), every
// probe pair moving `motion` of its pixels, and one box whose tallest line is `rows` of 1000.
function piece({ energy = 'normal', bpm, dur = 10, cuts = [], share = 1, motion = 0.05, rows = 120, boxes = true, from = 'the board' } = {}) {
  const fps = 30, npx = 1000, N = Math.round(dur * fps), list = cuts.map((t) => ({ t, d: 0 })), reg = C.energyRegions(list, dur);
  return C.energyMatch({ energy, from, tempo: C.energyTempo(energy, bpm), dur, fps, cuts: list, reg,
    pairHists: C.energyPairs(reg, fps, N).map((p) => (p ? hist(npx, 16, Math.round(share * npx)) : null)),
    motionHists: Array.from({ length: N - 1 }, () => hist(npx, 16, Math.round(motion * npx))), npx, holds: [],
    rects: boxes ? { 0: [{ id: 'b', text: 'B', r: [0, 0, 1, rows] }] } : null, ink: boxes ? { 0: [new Array(rows).fill(1)] } : {}, RH: 1000, why: 'x has no boxes(t)' });
}
const every = (n, s, from = s) => Array.from({ length: n }, (_, i) => from + i * s);

test('normal: OK at the edges of its range (3 beats at 116 BPM, 9% type, 2% motion), WARN just past each', () => {
  const beat = 60 / 116;
  const okR = piece({ dur: 4 * 3 * beat, cuts: every(3, 3 * beat), rows: 90, motion: 0.02 });
  assert.deepEqual(okR.map((x) => x.level), ['OK'], JSON.stringify(okR));
  assert.match(okR[0].detail, /^energy normal \(the board\) moves like it: mean shot 1\.55 s \(3 confirmed cuts in 6\.21 s; range 1\.03-1\.55 s, 2-3 beats at the preset's 116 BPM\); largest line 9\.0% of the frame height \("B" at 0\.00 s; range 9-16%\); motion 2\.0% of pixels a frame \(median of 182 pairs; floor 2%\)$/);
  assert.deepEqual(okR[0].measured, { shot: +(3 * beat).toFixed(4), cuts: 3, type: 0.09, motion: 0.02, shares: [1, 1, 1] });
  assert.deepEqual(okR[0].threshold, { shot: [+(2 * beat).toFixed(4), +(3 * beat).toFixed(4)], type: [0.09, 0.16], motion: { min: 0.02 }, bpm: 116 });
  const longer = piece({ dur: 4 * 3.1 * beat, cuts: every(3, 3.1 * beat), rows: 90, motion: 0.02 });
  assert.equal(longer[0].level, 'WARN'); assert.match(longer[0].detail, /is calmer than its floor: the shots are longer than normal allows\./);
  const smaller = piece({ dur: 4 * 3 * beat, cuts: every(3, 3 * beat), rows: 89, motion: 0.02 });
  assert.match(smaller[0].detail, /calmer than its floor: the type is smaller than normal allows/);
  const still = piece({ dur: 4 * 3 * beat, cuts: every(3, 3 * beat), rows: 90, motion: 0.019 });
  assert.match(still[0].detail, /calmer than its floor: it moves less than normal allows/);
  const all = piece({ dur: 10, rows: 50, motion: 0 });
  assert.match(all[0].detail, /the shots are longer, the type is smaller, it moves less than normal allows/);
  // a busier piece than normal is never a WARN at normal: there is no ceiling
  assert.equal(piece({ dur: 4, cuts: every(15, 0.25, 0.25), rows: 400, motion: 0.5 })[0].level, 'OK');
});

test('extreme: one beat at 136 BPM, 18% type, 6% motion; a piece cut at normal pace WARNs', () => {
  const beat = 60 / 136;
  assert.equal(piece({ energy: 'extreme', dur: 8 * beat, cuts: every(7, beat), rows: 180, motion: 0.06 })[0].level, 'OK');
  const n = piece({ energy: 'extreme', dur: 8 * 2.5 * (60 / 116), cuts: every(7, 2.5 * (60 / 116)), rows: 120, motion: 0.03 });
  assert.equal(n[0].level, 'WARN'); assert.match(n[0].detail, /^energy extreme \(the board\) is calmer than its floor: the shots are longer, the type is smaller, it moves less than extreme allows\./);
  assert.match(piece({ energy: 'extreme', dur: 8 * beat, cuts: every(7, beat), rows: 179, motion: 0.06 })[0].detail, /the type is smaller/);
  assert.match(piece({ energy: 'extreme', dur: 8 * beat, cuts: every(7, beat), rows: 180, motion: 0.059 })[0].detail, /it moves less/);
});

test('subtle: busier than its ceiling WARNs (shorter shots, larger type, more motion); calmer is fine; no cut is never busy on cuts', () => {
  const beat = 60 / 84;
  assert.equal(piece({ energy: 'subtle', dur: 3 * 4 * beat, cuts: every(2, 4 * beat), rows: 80, motion: 0.10 })[0].level, 'OK');
  assert.equal(piece({ energy: 'subtle', dur: 30, rows: 10, motion: 0 })[0].level, 'OK', 'calm is never a WARN at subtle');
  const busy = piece({ energy: 'subtle', dur: 3 * 3.9 * beat, cuts: every(2, 3.9 * beat), rows: 81, motion: 0.101 });
  assert.match(busy[0].detail, /^energy subtle \(the board\) is busier than its ceiling: the shots are shorter, the type is larger, it moves more than subtle allows\./);
  assert.match(busy[0].detail, /ceiling 10%/);
  assert.equal(piece({ energy: 'subtle', dur: 2, rows: 80, motion: 0 })[0].level, 'OK', 'a 2 s piece with no cut is not cut too fast');
});

test('the shot range is in beats of the piece\'s own tempo (Q22)', () => {
  // two beats at 116 BPM is 1.03 s; at 127.6 BPM (10% over) three beats is 1.41 s, so a 1.5 s mean shot is calm only there
  assert.equal(piece({ dur: 3, cuts: [1.5], rows: 120 })[0].level, 'OK');
  const fast = piece({ dur: 3, cuts: [1.5], rows: 120, bpm: 127.6 });
  assert.equal(fast[0].level, 'WARN'); assert.match(fast[0].detail, /range 0\.94-1\.41 s, 2-3 beats at 127\.6 BPM/);
});

test('a declared cut the frames do not show is reported, and does not count; one at exactly 20% counts', () => {
  const x = piece({ dur: 2, cuts: [1], share: 0.199 });
  assert.equal(x[0].measured.cuts, 0); assert.equal(x[0].measured.shot, 2);
  assert.equal(x[1].level, 'WARN'); assert.equal(x[1].id, 'energy_match'); assert.equal(x[1].t, 1);
  assert.match(x[1].detail, /^the declared cut at 1\.00 s is not in the frames: the middles of the shots either side \(0\.50 and 1\.50 s\) differ in 19\.9% of their pixels, under the 20% a cut needs$/);
  assert.equal(piece({ dur: 2, cuts: [1], share: 0.2 })[0].measured.cuts, 1);
  const lead = piece({ dur: 2, cuts: [0.1] });
  assert.match(lead[1].detail, /^the declared cut at 0\.10 s cannot be confirmed: it has no shot before it \(a shot lasts 0\.15 s or more\)$/);
  assert.equal(lead[0].measured.cuts, 0);
});

test('council R1 E1: hard cuts merged into a transition (closer than 0.15 s) leave motion, confirmed or not; an unconfirmed lone hard cut does not', () => {
  // codex's case: a 3 s static card with 26 one-frame flashes at 0.2 + i x 0.1 s, both edges declared as hard cuts. Each
  // flash lights one probe frame; the pairs touching a lit frame change every pixel, the rest none.
  const fps = 30, npx = 1000, dur = 3, N = dur * fps, cuts = [];
  for (let i = 0; i < 26; i++) { const t = +(0.2 + i * 0.1).toFixed(6); cuts.push({ t, d: 0 }, { t: t + 1 / fps, d: 0 }); }
  const lit = (f) => cuts.some((c, j) => j % 2 === 0 && (f + 0.25) / fps >= c.t && (f + 0.25) / fps < c.t + 1 / fps);
  const reg = C.energyRegions(cuts, dur);
  const x = C.energyMatch({ energy: 'subtle', from: 'the board', tempo: C.energyTempo('subtle'), dur, fps, cuts, reg,
    pairHists: C.energyPairs(reg, fps, N).map((p) => (p ? hist(npx, 16, 0) : null)),
    motionHists: Array.from({ length: N - 1 }, (_, k) => hist(npx, 16, lit(k) || lit(k + 1) ? npx : 0)), npx, holds: [], rects: null, ink: {}, RH: 1000, why: 'x' });
  assert.equal(x[0].measured.cuts, 0);
  assert.equal(x[0].measured.motion, 0, x[0].detail);
  assert.match(x[0].detail, /median of 12 pairs/);
  assert.equal(x[0].level, 'OK', 'a static card with flashes nobody counts is not busy at subtle');
  // an ordinary hard cut the frames do not confirm keeps the pairs across it
  const npx2 = 1000, one = C.energyRegions([{ t: 0.15, d: 0 }], 1);
  const m = C.energyMotion([0.1, 0.9, 0.1].map((v) => hist(npx2, 16, v * npx2)), npx2, { fps: 10, regions: one.regions });
  assert.equal(m.pairs, 3);
});
test('type and motion that cannot be measured are said so, and not judged', () => {
  const x = piece({ dur: 10, boxes: false, motion: 0 });
  assert.match(x[0].detail, /type not measured \(x has no boxes\(t\)\)/);
  assert.equal(x[0].measured.type, null);
  assert.doesNotMatch(x[0].detail, /type is smaller/);
});
