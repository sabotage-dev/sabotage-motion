// How flash dates frames (council round 1 on P11a, A3): by each frame's presentation timestamp in its stream's time
// base, so a variable-frame-rate file is judged by when its frames are shown. A constant-rate file dated by timestamps
// gives exactly what dating by frame index gives: every deterministic fixture is run again with its frames at
// f x den x 512 ticks of 1/(num x 512) s (an MP4-like time base), from a start that is not 0, and must match the
// simulation's failing frames and first failing frame (test/flash-units.test.mjs checks the same by frame), at the
// times frame f / rate gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C } from './check-helpers.mjs';
import { fixtures } from './flash-fixtures.mjs';

const M = 512, START = 123457;
function byPts(fx, start = START) {
  const tb = { num: 1, den: fx.rate.num * M }, step = fx.rate.den * M;
  const tr = C.flashTracker({ w: fx.w, h: fx.h, timeBase: tb, red: fx.kind === 'rgb' });
  for (let k = 0; k < fx.n; k++) (fx.kind === 'rgb' ? tr.pushRGB : tr.pushLum)(fx.frame(k), start + k * step);
  return { ...tr.result(), lastTs: start + (fx.n - 1) * step };
}
test('every deterministic fixture dated by timestamps gives what dating by frame gives (verdict, failing frames, first, times)', () => {
  const bad = [];
  for (const fx of fixtures().filter((x) => !x.random)) {
    const b = byPts(fx), at = (x) => !x || Math.abs(x.t - (x.f * fx.rate.den) / fx.rate.num) < 1e-9;
    if (b.failing !== fx.sim[0] || (b.first ? b.first.f : null) !== fx.sim[1] || !at(b.first) || !at(b.last) || !at(b.peak.area ? b.peak : null)) {
      bad.push(`${fx.name}: by timestamp ${b.failing}/${b.first && b.first.f} at ${b.first && b.first.t}, the simulation ${fx.sim}`);
    }
  }
  assert.deepEqual(bad, []);
});
test('timestamps past 2^31 ticks stay exact (eight transitions at 3000001/100000 fps, 51,200,000 ticks a frame, from 2^31 + 123457)', () => {
  // every timestamp is past 2^31, the last past 4.1e9: a 32-bit ring would wrap them (council round 2, C3)
  const fx = fixtures().find((x) => x.name.startsWith('8 transitions at 3000001/100000'));
  const r = byPts(fx, 2 ** 31 + START);
  assert.ok(r.lastTs > 2 ** 31 + 1.9e9, `the last frame is at ${r.lastTs} ticks`);
  assert.deepEqual([r.failing, r.first.f, r.first.t], [1, 31, (31 * 100000) / 3000001]);
});
test('variable frame rate in memory: frames at 0, 0.2 ... 1.6 and 1.801 s alternating pass; dated as 30 fps they would fail', () => {
  const ms = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1801];
  const run = (opts, ts) => {
    const t = C.flashTracker({ w: 341, h: 256, red: false, ...opts });
    ms.forEach((_, k) => t.pushLum(new Float32Array(341 * 256).fill(k % 2 ? 0.5 : 0.1), ts ? ts[k] : undefined));
    return t.result();
  };
  const real = run({ timeBase: '1/1000' }, ms);
  assert.equal(real.failing, 0, 'at most five transitions in any half-open second');
  assert.ok(run({ rate: 30 }).failing > 0, 'ten frames in a row at 30 fps hold nine transitions in 0.3 s');
  // and one more transition 0.999 s after the second: (t - 1 s, t] holds eight, and it fails
  const t = C.flashTracker({ w: 341, h: 256, red: false, timeBase: '1/1000' });
  const more = [0, 100, 200, 300, 400, 500, 600, 700, 1099];
  more.forEach((x, k) => t.pushLum(new Float32Array(341 * 256).fill(k % 2 ? 0.5 : 0.1), x));
  assert.equal(t.result().first.f, 8);
  assert.equal(t.result().first.t, 1.099);
});
test('a tracker dated by timestamps needs an integer timestamp for every frame', () => {
  const t = C.flashTracker({ w: 2, h: 2, red: false, timeBase: '1/1000' });
  assert.throws(() => t.pushLum(new Float32Array(4)), /needs an integer timestamp/);
  assert.throws(() => t.pushLum(new Float32Array(4), 1.5), /needs an integer timestamp/);
});
