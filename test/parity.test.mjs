// Parity (plan section 17, P2): scripts/parity.mjs on synthetic premixes and masters. Identical inputs pass, a
// 2 dB gain change fails, and each threshold is pinned from both sides: the share of windows (95%), the window
// tolerance (0.5 dB), integrated loudness (0.5 LU) and true peak (0.5 dB). Nothing here is a real recording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from './helpers.mjs';
import { SR, frameOf, mixTool } from './mix-helpers.mjs';

const work = path.join(repoRoot, 'test', '.work', 'parity');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const W = frameOf(0.1);                             // one 100 ms window, in frames

// 10 s (100 windows) of seeded noise whose level swells and falls, with exact silence over 8.0-9.0 s.
function premixA() {
  const n = frameOf(10), out = new Float32Array(n * 2);
  let s = 5;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
  for (let j = 0; j < n; j++) {
    const g = (8.0 * SR <= j && j < 9.0 * SR) ? 0 : 0.1 * (1 + 0.5 * Math.sin((2 * Math.PI * j) / (3 * SR)));
    out[2 * j] = g * rnd(); out[2 * j + 1] = g * rnd();
  }
  return out;
}
// A master: quieter noise with one isolated spike at 5 s that sets its true peak.
function masterA() {
  const m = premixA().map((x) => x * 0.5);
  m[2 * frameOf(5)] = 0.9; m[2 * frameOf(5) + 1] = 0.9;
  return m;
}
const gain = (x, dB) => x.map((v) => v * Math.pow(10, dB / 20));
const write = (name, data) => { const f = path.join(work, name + '.wav'); fs.writeFileSync(f, mixTool.wavStereo(data)); return f; };
const A = write('premixA', premixA()), MA = write('masterA', masterA());
function parity(premixB, masterB, extra = []) {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'parity.mjs'), A, premixB, MA, masterB, ...extra], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('identical premixes and masters pass, with every window within the tolerance', () => {
  const r = parity(write('same-premix', premixA()), write('same-master', masterA()));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /100\.0% of windows within 0\.5 dB/);
  assert.match(r.out, /\+0\.00 LU/);
  assert.match(r.out, /parity: PASS/);
});

test('a 2 dB gain change on both fails on all three checks', () => {
  const r = parity(write('g2-premix', gain(premixA(), 2)), write('g2-master', gain(masterA(), 2)));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /parity: MISS \(envelope, loudness, truePeak\)/);
  assert.match(r.out, /\+2\.00 LU/);
});

// +1 dB on k whole windows of premix B, starting at window 10.
function windowsUp(k, dB = 1) {
  const b = premixA(), f = Math.pow(10, dB / 20);
  for (let i = 10 * W * 2; i < (10 + k) * W * 2; i++) b[i] *= f;
  return b;
}
test('the share of windows: 94% within the tolerance misses, 96% passes (needs 95%)', () => {
  const miss = parity(write('w6', windowsUp(6)), MA);
  assert.equal(miss.status, 1, miss.out);
  assert.match(miss.out, /94\.0% of windows/);
  assert.match(miss.out, /parity: MISS \(envelope\)/);
  const pass = parity(write('w4', windowsUp(4)), MA);
  assert.equal(pass.status, 0, pass.out);
  assert.match(pass.out, /96\.0% of windows/);
});

test('the window tolerance: every window 0.4 dB louder passes, 0.6 dB misses (needs 0.5 dB)', () => {
  assert.equal(parity(write('all04', gain(premixA(), 0.4)), MA).status, 0);
  const r = parity(write('all06', gain(premixA(), 0.6)), MA);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /10\.0% of windows/, 'only the ten silent windows (8.0-9.0 s, both at the floor) still match');
  assert.match(r.out, /parity: MISS \(envelope\)/);
});

test('two silences match, and a shift far beyond the 20 ms lag search names no lag and misses', () => {
  const b = premixA();
  for (let i = frameOf(8.0) * 2; i < frameOf(9.0) * 2; i++) b[i] = 1e-5 * ((i % 7) - 3);   // about -94 dBFS where A is exact zeros: 10 windows
  assert.equal(parity(write('floor', b), MA).status, 0);
  const late = new Float32Array(frameOf(10.3) * 2);
  late.set(premixA(), frameOf(0.3) * 2);
  const r = parity(write('late', late), MA);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /no clear lag within 20 ms/);
  assert.match(r.out, /parity: MISS \(length, envelope\)/);
});

test('the lengths: B a whole second short misses even where every window it has matches; 50 ms longer passes', () => {
  const short = parity(write('short', premixA().subarray(0, frameOf(9) * 2)), MA);
  assert.equal(short.status, 1, short.out);
  assert.match(short.out, /length {5}1\.000 s apart \(needs at most 0\.1 s\) {2}MISS/);
  assert.match(short.out, /100\.0% of windows within 0\.5 dB/);
  assert.match(short.out, /parity: MISS \(length\)/);
  const long = new Float32Array(frameOf(10.05) * 2);
  long.set(premixA());
  const r = parity(write('long50', long), MA);
  assert.equal(r.status, 0, r.out);
});

// 20 ms noise bursts every 200 ms, each starting 3 ms before a window boundary, so every window holds 3 ms or 17 ms
// of one burst: a few milliseconds of lag moves energy across the boundary, and every window changes level.
function bursts() {
  const n = frameOf(10), out = new Float32Array(n * 2);
  let s = 11;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
  for (let w = 2; w < 100; w += 2) for (let j = frameOf(w * 0.1 - 0.003); j < frameOf(w * 0.1 + 0.017); j++) { out[2 * j] = 0.2 * rnd(); out[2 * j + 1] = 0.2 * rnd(); }
  return out;
}
const lagged = (x, frames) => { const n = x.length >> 1, out = new Float32Array(x.length); for (let j = 0; j < n; j++) { const k = j - frames; if (k >= 0 && k < n) { out[2 * j] = x[2 * k]; out[2 * j + 1] = x[2 * k + 1]; } } return out; };
const runOn = (a, b, extra = []) => {
  const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'parity.mjs'), a, b, MA, MA, ...extra], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
test('a lag is measured and must be the one --lag states: then B is shifted by it; unstated, it misses', () => {
  const A2 = write('bursts', bursts()), run = (b, extra) => runOn(A2, b, extra);
  const ahead = write('bursts-ahead', lagged(bursts(), -240)), behind = write('bursts-behind', lagged(bursts(), 240));
  const r1 = run(ahead, ['--lag', '-5']);
  assert.equal(r1.status, 0, r1.out);
  assert.match(r1.out, /B runs ahead of A by 240 frames \(5\.00 ms\) \(correlation 1\.00\), the latency --lag -5\.00 states; B is shifted by it before comparing {2}ok/);
  assert.match(r1.out, /100\.0% of windows within 0\.5 dB \(needs at least 95%\), [0-4]\.\d% without that shift/, 'only the silent windows at the ends match unshifted');
  const r2 = run(behind, ['--lag', '5', '--json']);
  assert.equal(r2.status, 0, r2.out);
  const j = JSON.parse(r2.out);
  assert.deepEqual([j.premix.align.measured, j.premix.align.applied, j.checks.lag], [240, 240, true]);
  assert.ok(j.premix.align.corr > 0.99, String(j.premix.align.corr));
  // the same lag, unstated: measured and reported, never taken out
  const r3 = run(ahead);
  assert.equal(r3.status, 1, r3.out);
  assert.match(r3.out, /B runs ahead of A by 240 frames \(5\.00 ms\) \(correlation 1\.00\), but no lag was stated: a timing fault, or a known latency \(a limiter lookahead\) to state with --lag -5\.00 {2}MISS/);
  assert.match(r3.out, /parity: MISS \(lag, envelope\)/);
  // a stated lag that is not there, or the wrong way round
  assert.match(run(write('bursts-same', bursts()), ['--lag', '-5']).out, /no lag between them \(correlation 1\.00\), not the 240 frames \(5\.00 ms\) ahead --lag -5\.00 states {2}MISS/);
  assert.match(run(behind, ['--lag', '-5']).out, /parity: MISS \(lag, envelope\)/);
  // 1 frame from the stated lag is inside the 0.1 ms tolerance (the private mixer measured 239 frames for its 240);
  // the tolerance rounds to 5 frames, so 5 off passes and 6 off misses on the lag alone
  assert.equal(run(write('bursts-239', lagged(bursts(), -239)), ['--lag', '-5']).status, 0);
  assert.equal(run(write('bursts-245', lagged(bursts(), -245)), ['--lag', '-5']).status, 0);
  assert.match(run(write('bursts-246', lagged(bursts(), -246)), ['--lag', '-5']).out, /parity: MISS \(lag\)/);
  const far = write('bursts-30ms', lagged(bursts(), frameOf(0.03))), r4 = run(far);
  assert.equal(r4.status, 1, r4.out);
  assert.match(r4.out, /no clear lag within 20 ms.*, and none was stated {2}ok/);
  // no clear lag cannot confirm a stated one
  assert.match(run(far, ['--lag', '5']).out, /no clear lag within 20 ms.*, not the 240 frames \(5\.00 ms\) behind --lag \+5\.00 states {2}MISS/);
  // exactly 20 ms: the best fit sits on the search limit, where the true lag may lie beyond it, so it names no lag
  const r5 = run(write('bursts-20ms', lagged(bursts(), -frameOf(0.02))));
  assert.equal(r5.status, 1, r5.out);
  assert.match(r5.out, /no clear lag within 20 ms \(best -960 frames \(20\.00 ms\), at the search limit/);
  for (const bad of [['--lag', '20'], ['--lag', '-25'], ['--lag', 'x'], ['--lag'], ['--no-align']]) assert.equal(run(ahead, bad).status, 2, bad.join(' '));
});

// The council's case (round 2, F5): a held 375 Hz tone repeats every 128 frames, so every multiple of 128 inside the
// search fits as well as the true lag. Identical tones must pass, and a tone moved by the stated lag must pass.
test('a signal that repeats fits equally at every period: the fit nearest the stated lag is taken, and reported', () => {
  const tone = (shift = 0) => { const n = frameOf(5), out = new Float32Array(n * 2); for (let j = 0; j < n; j++) { const v = 0.3 * Math.cos((2 * Math.PI * 375 * (j - shift)) / SR); out[2 * j] = v; out[2 * j + 1] = v; } return out; };
  const T = write('tone', tone());
  const same = runOn(T, write('tone-same', tone()));
  assert.equal(same.status, 0, same.out);
  assert.match(same.out, /no lag between them \(correlation 1\.00; the signal repeats, so 15 lags fit equally well and the one nearest the stated lag is taken\), and none was stated {2}ok/);
  const late = runOn(T, write('tone-late', tone(240)), ['--lag', '5', '--json']);
  assert.equal(late.status, 0, late.out);
  const j = JSON.parse(late.out);
  assert.deepEqual([j.premix.align.measured, j.premix.align.fits > 1, j.checks.lag], [240, true, true]);
  // B's gain drifts up by 5e-10 a frame (0.001 dB over the 5 s), so a later period fits a hair better than lag 0:
  // the furthest one, 896 frames on, by under one part in a million. That is still an equal fit, not a lag.
  const drift = tone().map((v, i) => v * (1 + 5e-10 * (i >> 1)));
  const d = runOn(T, write('tone-drift', drift), ['--json']);
  assert.equal(d.status, 0, d.out);
  assert.equal(JSON.parse(d.out).premix.align.measured, 0);
});

// The council's case (round 1, F1): only B's voice runs 5 ms late, over a steady bed that does not move. The voice
// dominates A's loudest 4 s, so the measured lag is the voice's; lining it up would have shifted the bed instead, and
// a steady bed's 100 ms levels barely move, so the envelope alone would pass. The lag check catches it.
test('a timing fault in one part of the mix (the voice alone 5 ms late) is a lag nobody stated, and misses', () => {
  const bed = (() => { const n = frameOf(10), out = new Float32Array(n * 2); let s = 23; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; for (let i = 0; i < out.length; i++) out[i] = 0.03 * rnd(); return out; })();
  const sum = (x, y) => x.map((v, i) => v + y[i]);
  const A3 = write('voice-bed', sum(bed, bursts())), B3 = write('voice-late-bed', sum(bed, lagged(bursts(), 240)));
  const r = runOn(A3, B3, ['--json']);
  assert.equal(r.status, 1, r.out);
  const j = JSON.parse(r.out);
  assert.ok(Math.abs(j.premix.align.measured - 240) <= 2 && j.premix.align.found, JSON.stringify(j.premix.align));
  assert.deepEqual([j.checks.length, j.checks.lag], [true, false]);
  assert.ok(j.premix.align.corr < 0.99, 'the bed did not move, so the fit is not perfect');
});

// Master B: the noise louder by dB, the spike (and so the true peak) left where it was; or the spike moved
// by dB, the noise (and so the loudness) left where it was.
function masterLouder(dB) { const m = gain(masterA(), dB); m[2 * frameOf(5)] = 0.9; m[2 * frameOf(5) + 1] = 0.9; return m; }
function masterPeak(dB) { const m = masterA(), p = 0.9 * Math.pow(10, dB / 20); m[2 * frameOf(5)] = p; m[2 * frameOf(5) + 1] = p; return m; }
test('integrated loudness: 0.4 LU apart passes, 0.6 LU misses (needs 0.5)', () => {
  const pass = parity(A, write('l04', masterLouder(0.4)));
  assert.equal(pass.status, 0, pass.out);
  const miss = parity(A, write('l06', masterLouder(0.6)));
  assert.equal(miss.status, 1, miss.out);
  assert.match(miss.out, /parity: MISS \(loudness\)/);
});

test('true peak: 0.4 dB apart passes, 0.6 dB misses (needs 0.5)', () => {
  const pass = parity(A, write('p04', masterPeak(0.4)));
  assert.equal(pass.status, 0, pass.out);
  const miss = parity(A, write('p06', masterPeak(0.6)));
  assert.equal(miss.status, 1, miss.out);
  assert.match(miss.out, /parity: MISS \(truePeak\)/);
});

test('--json prints the measurements; a missing argument or an unreadable file exits 2', () => {
  const r = parity(A, MA, ['--json']);
  assert.equal(r.status, 0, r.out);
  const j = JSON.parse(r.out);
  assert.equal(j.pass, true);
  assert.equal(j.premix.windows, 100);
  assert.deepEqual(j.thresholds, { windowSec: 0.1, withinDb: 0.5, share: 0.95, lufs: 0.5, tp: 0.5, floorDb: -70, maxLagMs: 20, lagTolMs: 0.1 });
  const few = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'parity.mjs'), A, A, MA], { encoding: 'utf8' });
  assert.equal(few.status, 2);
  assert.equal(parity(path.join(work, 'nope.wav'), MA).status, 2);
});
