// The flash rule (plan 23.9, Q20, Q24, Q25) on frames built in code, without ffmpeg: every fixture of the plan's
// Acceptance paragraph and of the main loop's numpy simulation of the rule, each against its expected verdict and
// against what the simulation measured (how many frames fail, and the first). The three random fixtures use seeded
// draws of their own, so only their verdicts are compared. test/flash.test.mjs runs the rule on encoded files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C } from './check-helpers.mjs';
import { fixtures, runFixture } from './flash-fixtures.mjs';

const X = fixtures();
test('the fixture list: the simulation\'s 55 and the 8 added in P11a', () => {
  assert.equal(X.length, 63);
  assert.equal(new Set(X.map((x) => x.name)).size, 63, 'names are unique');
  assert.equal(X.filter((x) => x.random).length, 3);
});
for (const fx of X) {
  test(`${fx.expect === 'FAIL' ? 'FAILs' : 'passes'}: ${fx.name}`, () => {
    const r = runFixture(C, fx);
    assert.equal(r.verdict, fx.expect);
    if (!fx.random) assert.deepEqual([r.failing, r.first], fx.sim, 'failing frames and the first one, as the simulation measured them');
    if (r.verdict === 'FAIL') {
      assert.ok(r.result.first.area > C.T.flash.area, 'the first failing window holds more than the limit');
      assert.equal(r.result.first.t, (r.result.first.f * fx.rate.den) / fx.rate.num, 'dated at its frame over the exact rate');
    }
  });
}

test('the measured size: the longer side 1024 px, the shorter in proportion (down and up)', () => {
  assert.deepEqual(C.flashSize(1080, 1920), [576, 1024]);
  assert.deepEqual(C.flashSize(1920, 1080), [1024, 576]);
  assert.deepEqual(C.flashSize(270, 480), [576, 1024]);
  assert.deepEqual(C.flashSize(1080, 1350), [819, 1024]);
  assert.deepEqual(C.flashSize(1024, 200), [1024, 200]);
});
test('the rate is exact: ffprobe\'s fraction, a whole number, or { num, den }; a rounded rate is refused', () => {
  assert.deepEqual(C.flashRate('30000/1001'), { num: 30000, den: 1001 });
  assert.deepEqual(C.flashRate(60), { num: 60, den: 1 });
  assert.deepEqual(C.flashRate({ num: 3000001, den: 100000 }), { num: 3000001, den: 100000 });
  for (const bad of [29.97, '0/0', '30/0', 'n/a', -30]) assert.throws(() => C.flashRate(bad), /not an exact frame rate/);
});
test('the half-open second in frames: the largest gap g with g x den < num', () => {
  assert.equal(C.flashGap({ num: 30, den: 1 }), 29, 'at 30 fps a transition 30 frames back is exactly 1 s back: out');
  assert.equal(C.flashGap({ num: 60, den: 1 }), 59);
  assert.equal(C.flashGap({ num: 30000, den: 1001 }), 29, '30 frames at 29.97 fps are 1.001 s');
  assert.equal(C.flashGap({ num: 3000001, den: 100000 }), 30, '30 frames at 30.00001 fps are 0.9999997 s');
  assert.equal(C.flashGap({ num: 24000, den: 1001 }), 23);
});
test('8-bit frames give what their float values give (the decoder\'s path and the fixtures\' agree)', () => {
  const w = 80, h = 400, n = w * h;
  const cols = [[230, 60, 60], [0, 130, 0]];
  const a = C.flashTracker({ w, h, rate: 30 }), b = C.flashTracker({ w, h, rate: 30 });
  for (let k = 0; k < 31; k++) {
    const c = cols[Math.floor(k / 3) % 2], b8 = Buffer.alloc(n * 3), f = new Float32Array(n * 3);
    for (let p = 0; p < n; p++) for (let j = 0; j < 3; j++) { b8[3 * p + j] = c[j]; f[3 * p + j] = c[j] / 255; }
    a.pushRGB8(b8); b.pushRGB(f);
  }
  const ra = a.result(), rb = b.result();
  assert.ok(ra.failing > 0, 'an 80x400 red strobe is over the limit (80 x 341 = 27,280 px)');
  assert.deepEqual([ra.failing, ra.first, ra.peak], [rb.failing, rb.first, rb.peak]);
  assert.equal(ra.first.kind, 'red');
});
test('the window is clipped to a frame smaller than it, and a strip under 22 px tall can never fail', () => {
  const run = (w, h) => {
    const t = C.flashTracker({ w, h, rate: 30, red: false });
    for (let k = 0; k < 31; k++) t.pushLum(new Float32Array(w * h).fill(k % 2 ? 0.5 : 0.1));
    return t.result();
  };
  const r = run(1024, 100);
  assert.equal(r.first.area, 341 * 100, 'a 341x100 window on a 1024x100 frame');
  assert.deepEqual([r.first.w, r.first.h], [341, 100]);
  assert.equal(run(1024, 21).failing, 0, '341 x 21 = 7,161 px at most');
  assert.equal(run(100, 1024).first.area, 100 * 341, 'and the other way round');
});
test('pushLum is only for the general kind', () => {
  assert.throws(() => C.flashTracker({ w: 2, h: 2, rate: 30 }).pushLum(new Float32Array(4)), /red: false/);
});
test('flashResult: a FAIL dates the first failing frame and names the window; an OK names the most it saw; a decode error FAILs', () => {
  const fail = C.flashResult({ frames: 61, w: 576, h: 1024, failing: 53, first: { f: 8, t: 8 / 30, kind: 'general', area: 87296, x: 0, y: 0, w: 341, h: 256 },
    last: { f: 60, t: 2 }, peak: { area: 87296, kind: 'general', f: 8, t: 8 / 30 } }, { scope: 'file', what: 'out/x-final.mp4' });
  assert.equal(fail.level, 'FAIL'); assert.equal(fail.t, 0.267); assert.equal(fail.scope, 'file');
  assert.match(fail.detail, /from 0\.267 s, 87296 px of a 341x256 window at 0,0 flash more than three times a second \(general\), over the 21824 px limit/);
  assert.match(fail.detail, /53 of 61 frames are over it, the last at 2\.000 s/);
  assert.deepEqual(fail.measured, { area: 87296, kind: 'general', frames: 53, last: 2 });
  assert.equal(fail.threshold.area, 21824);
  const okr = C.flashResult({ frames: 450, w: 576, h: 1024, failing: 0, first: null, last: null, peak: { area: 13155, kind: 'general', f: 322, t: 322 / 30 } }, { scope: 'source', what: 'out/x.mp4' });
  assert.equal(okr.level, 'OK'); assert.match(okr.detail, /the most was 13155 px, general, at 10\.733 s/);
  const none = C.flashResult({ frames: 10, w: 576, h: 1024, failing: 0, first: null, last: null, peak: { area: 0, kind: null } }, { scope: 'source', what: 'out/x.mp4' });
  assert.doesNotMatch(none.detail, /the most/);
  const err = C.flashResult({ error: 'Invalid data found when processing input' }, { scope: 'file', what: 'clip.mp4' });
  assert.equal(err.level, 'FAIL'); assert.match(err.detail, /clip\.mp4 could not be decoded to look for flashes: Invalid data/);
});
test('the ids: flash is a picture check, run with --only in either mode', () => {
  assert.deepEqual(C.PICTURE_IDS, ['flash']);
  assert.ok(C.ALL_IDS.includes('flash') && !C.SOURCE_IDS.includes('flash') && !C.FILE_IDS.includes('flash'));
  assert.ok(C.hasAlpha('yuva444p12le') && C.hasAlpha('gbrap') && C.hasAlpha('rgba') && !C.hasAlpha('yuv420p') && !C.hasAlpha('gbrp'));
});
