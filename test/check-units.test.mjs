// check.mjs's detectors on hand-built measurements (plan sections 6.5, 11 and 12): each rule, each threshold
// on both sides of its edge, the camera mapping against the shader's own formula, and the artifact verdicts.
// No browser and no ffmpeg; check.test.mjs and check-file.test.mjs run the same detectors on real renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C } from './check-helpers.mjs';

const FPS = 30;
const SAFE = { x: 84, y: 160, w: 852, h: 1320 };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const levels = (rs) => rs.map((x) => x.level);
// Samples for frames [f0, f1) with n subframes each, boxes(t) from fn(t, s), cam from camFn.
function samples(f0, f1, n, fn, camFn = () => [1, 0, 0, 0]) {
  const out = [];
  for (let f = f0; f < f1; f++) for (let s = 0; s < n; s++) {
    const t = f / FPS + ((s + 0.5) / n) * (0.5 / FPS);
    out.push({ t, f, n, cam: camFn(t), boxes: fn(t, s) });
  }
  return C.prepareSamples(out, 1080, 1920);
}
const box = (id, text, x, y, w = 200, h = 80, o = {}) => ({ id, text, x, y, w, h, ...o });
const piece = [{ id: '(piece)', start: 0, end: 100, beat: {} }];

// ---------------------------------------------------------------- the camera
// The composite shader (shaders.js COMP) samples the 2D layer at uv = (rot(-r) * p / zoom - pan) / asp + 0.5
// for an output pixel at p = (uv_out - 0.5) * (asp, 1), in GL coordinates (y up). camPoint must invert it.
function shaderSource(X, Y, cam, W, H) {
  const [z, r, px, py] = cam, asp = W / H;
  const p = [(X / W - 0.5) * asp, (1 - Y / H) - 0.5];
  const c = Math.cos(-r), s = Math.sin(-r);
  const q = [(c * p[0] - s * p[1]) / z - px, (s * p[0] + c * p[1]) / z - py];
  return [(q[0] / asp + 0.5) * W, (1 - (q[1] + 0.5)) * H];
}
test('camPoint inverts the composite shader: the shader samples a mapped point back at its source', () => {
  for (const cam of [[1, 0, 0, 0], [1.4, 0.35, 0.08, -0.05], [0.7, -1.2, -0.2, 0.3], [2, Math.PI / 2, 0, 0]]) {
    for (const [x, y] of [[0, 0], [540, 960], [100, 1700], [1000, 200]]) {
      const [X, Y] = C.camPoint(x, y, cam, 1080, 1920);
      const [sx, sy] = shaderSource(X, Y, cam, 1080, 1920);
      near(sx, x, 1e-6); near(sy, y, 1e-6);
    }
  }
  near(C.camPoint(540, 960, [3, 1, 0, 0], 1080, 1920)[0], 540);            // zoom and rotation turn about the centre
  assert.deepEqual(C.camPoint(270, 480, [2, 0, 0, 0], 1080, 1920).map(Math.round), [0, 0]);
  // a positive panY moves the layer up the screen (GL y is up), a positive panX right
  assert.ok(C.camPoint(540, 960, [1, 0, 0, 0.1], 1080, 1920)[1] < 960);
  assert.ok(C.camPoint(540, 960, [1, 0, 0.1, 0], 1080, 1920)[0] > 540);
});
test('visibleBox: cut to the canvas before and after the camera; nothing on screen is null', () => {
  assert.deepEqual(C.visibleBox(box('a', 'A', -100, 100, 200, 80), [1, 0, 0, 0], 1080, 1920), { x: 0, y: 100, w: 100, h: 80 });
  assert.equal(C.visibleBox(box('a', 'A', -300, 100, 200, 80), [1, 0, 0, 0], 1080, 1920), null);
  assert.equal(C.visibleBox(box('a', 'A', 500, 900, 80, 80), [1, 0, 2, 0], 1080, 1920), null);   // panned off screen
  const v = C.visibleBox(box('a', 'A', 440, 920, 200, 80), [2, 0, 0, 0], 1080, 1920);
  near(v.x, 340); near(v.w, 400); near(v.y, 880); near(v.h, 160);
  // zoomed out, the frame shows past the layer's edges, but the shader never draws the layer outside its canvas:
  // text off the canvas stays unseen, and text half off it shows only its on-canvas half
  assert.equal(C.visibleBox(box('a', 'A', -300, 900, 200, 80), [0.5, 0, 0, 0], 1080, 1920), null);
  const half = C.visibleBox(box('a', 'A', -100, 900, 200, 80), [0.5, 0, 0, 0], 1080, 1920);
  near(half.x, 270); near(half.w, 50);
});
test('insideRect: a box on the safe edge is inside; a pixel over is out', () => {
  assert.ok(C.insideRect({ x: 84, y: 160, w: 852, h: 1320 }, SAFE));
  assert.ok(!C.insideRect({ x: 83, y: 160, w: 10, h: 10 }, SAFE));
  assert.ok(!C.insideRect({ x: 900, y: 400, w: 37, h: 10 }, SAFE));
  assert.ok(!C.insideRect({ x: 200, y: 1400, w: 10, h: 81 }, SAFE));
});

// ---------------------------------------------------------------- text_safe
test('text_safe: exposure is 1/(n x FPS) per sample outside; exactly 0.25 s in a beat is a WARN, one sample more a FAIL', () => {
  // 60 samples outside (7.5 frames of 8) = 60/240 s = 0.25 s
  const out = (lim) => samples(0, 10, 8, (t, s) => [box('L', 'LEFT', (Math.round(t * FPS - 0.25) * 8 + s) < lim ? 20 : 200, 600)]);
  const at = C.textSafe(out(60), { fps: FPS, safe: SAFE, windows: piece });
  assert.deepEqual(levels(at), ['WARN']); near(at[0].measured, 0.25, 1e-4);
  assert.match(at[0].detail, /brief excursion/);
  const over = C.textSafe(out(61), { fps: FPS, safe: SAFE, windows: piece });
  assert.deepEqual(levels(over), ['FAIL']); near(over[0].measured, 61 / 240, 1e-4);
  assert.equal(over[0].t, +(1 / FPS * 0 + 0.5 / 8 * 0.5 / FPS).toFixed(3));
});
test('text_safe: while the zones are an estimate every result is a WARN, and says so', () => {
  const s = samples(0, 30, 8, () => [box('L', 'LEFT', 20, 600)]);
  const x = C.textSafe(s, { fps: FPS, safe: SAFE, windows: piece, estimate: true, target: 'tiktok' });
  assert.deepEqual(levels(x), ['WARN']);
  assert.match(x[0].detail, /tiktok safe area \(estimate\) for 1\.00 s/);
  assert.match(x[0].detail, /a FAIL once the zones are measured/);
});
test('text_safe: deco boxes, boxes inside, and boxes off screen are not flagged', () => {
  const s = samples(0, 30, 8, () => [box('d', 'deco', 0, 0, 1080, 100, { deco: true }), box('in', 'IN', 300, 700), box('gone', 'X', -900, 700)]);
  assert.deepEqual(levels(C.textSafe(s, { fps: FPS, safe: SAFE, windows: piece })), ['OK']);
});
test('text_safe: exposure counts per beat, so two beats of 0.2 s each are two WARNs, not a FAIL', () => {
  const s = samples(0, 60, 8, (t) => (t < 0.2 || (t >= 1.0 && t < 1.2) ? [box('L', 'LEFT', 20, 600)] : []));
  const w = [{ id: 'a', start: 0, end: 1, beat: {} }, { id: 'b', start: 1, end: 2, beat: {} }];
  const x = C.textSafe(s, { fps: FPS, safe: SAFE, windows: w });
  assert.deepEqual(x.map((r) => [r.level, r.beat, +r.measured.toFixed(2)]), [['WARN', 'a', 0.2], ['WARN', 'b', 0.2]]);
});
test('text_safe: a box inside the safe area before the camera is out when the camera moves it out', () => {
  const s = samples(0, 30, 8, () => [box('c', 'CAM', 700, 300, 200, 100)], () => [1.4, 0.35, 0.08, -0.05]);
  assert.deepEqual(levels(C.textSafe(s, { fps: FPS, safe: SAFE, windows: piece })), ['FAIL']);
  const still = samples(0, 30, 8, () => [box('c', 'CAM', 700, 300, 200, 100)]);
  assert.deepEqual(levels(C.textSafe(still, { fps: FPS, safe: SAFE, windows: piece })), ['OK']);
});

// ---------------------------------------------------------------- text_overlap
test('text_overlap: more than 2% of the smaller box is a WARN; exactly 2%, one group, or apart is quiet', () => {
  const run = (bs) => C.textOverlap(samples(0, 3, 1, () => bs), { fps: FPS });
  // b is 100 x 100 = 10000 px; 2% = 200 px = a 2 x 100 strip
  assert.deepEqual(levels(run([box('a', 'A', 0, 1000, 300, 100), box('b', 'B', 298, 1000, 100, 100)])), ['OK']);
  const x = run([box('a', 'A', 0, 1000, 300, 100), box('b', 'B', 297, 1000, 100, 100)]);
  assert.deepEqual(levels(x), ['WARN']); near(x[0].measured, 0.03, 1e-4);
  assert.deepEqual(levels(run([box('a', 'A', 0, 1000, 300, 100, { group: 'g' }), box('b', 'B', 200, 1000, 100, 100, { group: 'g' })])), ['OK']);
  assert.deepEqual(levels(run([box('a', 'A', 0, 1000, 300, 100, { group: 'g' }), box('b', 'B', 200, 1000, 100, 100, { group: 'h' })])), ['WARN']);
  assert.deepEqual(levels(run([box('a', 'A', 0, 1000, 300, 100, { deco: true }), box('b', 'B', 200, 1000, 100, 100)])), ['OK']);
  assert.deepEqual(levels(run([box('a', 'A', 0, 1000, 100, 100), box('b', 'B', 500, 1000, 100, 100)])), ['OK']);
});

// ---------------------------------------------------------------- board copy
const beat = (id, start, end, on, extra = {}) => ({ id, start, end, beat: { id, on, ...extra } });
test('board_copy_missing: words that appear one at a time still match; a string never shown is a WARN', () => {
  // "Stop" from 0.0 s, "pasting" from 0.5 s, in one group
  const s = samples(0, 60, 1, (t) => [box('w0', 'Stop', 100, 600, 150), ...(t >= 0.5 ? [box('w1', 'pasting', 260, 600, 200)] : [])].map((b) => ({ ...b, group: 'line' })));
  const r = C.boardCopy(s, { fps: FPS, windows: [beat('hook', 0, 2, ['STOP  pasting', 'Never shown'])] });
  const miss = r.filter((x) => x.id === 'board_copy_missing');
  assert.deepEqual(miss.map((x) => [x.level, x.copy]), [['WARN', 'Never shown']]);
  assert.deepEqual(levels(r.filter((x) => x.id === 'board_copy_unread')), ['OK']);
});
test('board_copy_missing: one entry per box id, in order of first appearance, ties in reading order; repeats kept', () => {
  const s = samples(0, 30, 1, () => [box('b', 'go', 400, 600, 80), box('a', 'go', 100, 600, 80), box('c', 'now', 100, 800, 80)]);
  const w = (on) => [beat('x', 0, 1, on)];
  const missing = (on) => C.boardCopy(s, { fps: FPS, windows: w(on) }).filter((x) => x.id === 'board_copy_missing' && x.level === 'WARN').map((x) => x.copy);
  assert.deepEqual(missing(['go go now']), []);
  assert.deepEqual(missing(['go now go']), ['go now go']);
  assert.deepEqual(missing(['go go go']), ['go go go']);
});
test('board_copy_missing: a phrase split across two groups does not match; a box typed on counts by its longest text', () => {
  const split = samples(0, 30, 1, () => [box('a', 'Stop', 100, 600, 100, 80, { group: 'g1' }), box('b', 'pasting', 220, 600, 100, 80, { group: 'g2' })]);
  assert.equal(C.boardCopy(split, { fps: FPS, windows: [beat('x', 0, 1, ['Stop pasting'])] })[0].level, 'WARN');
  const typed = samples(0, 60, 1, (t) => [box('a', 'Save'.slice(0, 1 + Math.min(3, Math.floor(t * 4))), 100, 600)]);
  assert.equal(C.boardCopy(typed, { fps: FPS, windows: [beat('x', 0, 2, ['SAVE'])] })[0].level, 'OK');
});
test('board_copy_unread: under max(1.0, 0.25 x words) s on screen is a WARN; exactly enough is quiet', () => {
  const shown = (frames, text) => C.boardCopy(samples(0, 90, 1, (t) => (Math.round(t * FPS - 0.25) < frames ? [box('w', text, 100, 600)] : [])),
    { fps: FPS, windows: [beat('x', 0, 3, [text])] }).find((x) => x.id === 'board_copy_unread');
  assert.equal(shown(30, 'FLASH').level, 'OK');                         // 1.000 s
  const short = shown(29, 'FLASH');
  assert.equal(short.level, 'WARN'); near(short.measured, 29 / 30, 1e-4); assert.equal(short.threshold, 1);
  // five words need 1.25 s
  assert.equal(shown(37, 'one two three four five').level, 'WARN');
  assert.equal(shown(38, 'one two three four five').level, 'OK');
});
test('board copy: matching ignores case and runs of whitespace; boxes off screen are never seen', () => {
  const s = samples(0, 60, 1, () => [box('a', 'Hello   World', 100, 600, 300), box('z', 'hidden', -900, 600)]);
  const r = C.boardCopy(s, { fps: FPS, windows: [beat('x', 0, 2, ['hello world', 'HIDDEN'])] });
  assert.deepEqual(r.filter((x) => x.level === 'WARN').map((x) => [x.id, x.copy]), [['board_copy_missing', 'HIDDEN']]);
});

// ---------------------------------------------------------------- motion_dead and first_frame_empty
const moving = { 2: 4 }, still = {};
test('a frame pair moves when at least 4 probe pixels change by at least 2/255', () => {
  assert.ok(C.movingPair({ 2: 4 }));
  assert.ok(C.movingPair({ 2: 1, 9: 3 }));
  assert.ok(!C.movingPair({ 2: 3 }));
  assert.ok(!C.movingPair({ 1: 5000 }));
  assert.ok(!C.movingPair({}));
});
test('motion_dead: 90 identical frames (3.0 s) are flagged, 89 are not', () => {
  const run = (k) => [moving, ...Array(k).fill(still), moving, moving];
  const x = C.motionDead(run(89), { fps: FPS });                   // 89 still pairs = 90 frames of one picture
  assert.deepEqual(levels(x), ['WARN']); near(x[0].measured, 3.0, 1e-4); near(x[0].t, 1 / FPS, 1e-3);
  assert.deepEqual(levels(C.motionDead(run(88), { fps: FPS })), ['OK']);
});
test('motion_dead: holds take their time out of a still run, and what is left is flagged only if it is 3 s or more', () => {
  const pairs = [moving, ...Array(149).fill(still), moving];       // one picture from 1/30 s for 150 frames: 5.0 s
  assert.deepEqual(levels(C.motionDead(pairs, { fps: FPS, holds: [[0, 6]] })), ['OK']);
  assert.deepEqual(levels(C.motionDead(pairs, { fps: FPS, holds: [[2.0, 3.0]] })), ['OK']);          // 1.97 s and 2.03 s
  const x = C.motionDead(pairs, { fps: FPS, holds: [[0, 1.5]] });
  assert.deepEqual(levels(x), ['WARN']); near(x[0].t, 1.5, 1e-3); near(x[0].measured, 5.0333 - 1.5, 1e-3);
});
test('hold intervals come from HOLDS and hold: true beats; malformed HOLDS are named', () => {
  assert.deepEqual(C.holdIntervals([[10, 12]], [{ start: 1, end: 2, beat: { hold: true } }, { start: 2, end: 3, beat: {} }]), [[1, 2], [10, 12]]);
  assert.equal(C.validHolds(null), null);
  assert.equal(C.validHolds([[1, 2]]), null);
  assert.match(C.validHolds([[2, 1]]), /not a \[t0, t1\] pair/);
  assert.match(C.validHolds('x'), /must be a list/);
});
test('first_frame_empty: a luma standard deviation under 4/255 is a WARN; 4 is enough', () => {
  assert.equal(C.firstFrameEmpty({ mean: 20, std: 3.99 }).level, 'WARN');
  assert.equal(C.firstFrameEmpty({ mean: 20, std: 4 }).level, 'OK');
});

// ---------------------------------------------------------------- audio
const SR = 48000;
// A stereo WAV-like object from a mono function of the sample index.
function wav(seconds, fn) {
  const n = Math.round(seconds * SR), L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = fn(i);
  return { sr: SR, n, L, R: L };
}
const sine = (amp, f = 440) => (i) => amp * Math.sin((2 * Math.PI * f * i) / SR);
const ampForRms = (dbfs) => Math.SQRT2 * Math.pow(10, dbfs / 20);
const sfxBeat = (sfx, extra = {}) => [{ id: 'b', start: 0.5, end: 1.5, beat: { sfx, ...extra } }];
test('board_sfx_missing: a sound note needs a 50 ms window above -40 dBFS RMS in the beat; just above passes, just below warns', () => {
  const inBeat = (dbfs) => wav(2, (i) => (i >= 0.7 * SR && i < 0.8 * SR ? sine(ampForRms(dbfs))(i) : 0));
  assert.equal(C.boardSfx(inBeat(-39.5), { windows: sfxBeat('a whoosh') })[0].level, 'OK');
  const x = C.boardSfx(inBeat(-40.5), { windows: sfxBeat('a whoosh') })[0];
  assert.equal(x.level, 'WARN'); assert.ok(x.measured < -40 && x.measured > -41, String(x.measured));
  // sound outside the window does not count
  const outside = wav(2, (i) => (i < 0.4 * SR ? sine(0.5)(i) : 0));
  assert.equal(C.boardSfx(outside, { windows: sfxBeat('a whoosh') })[0].level, 'WARN');
});
test('board_sfx_missing: sfx: null and beats without a note are never checked', () => {
  const silence = wav(2, () => 0);
  const r = C.boardSfx(silence, { windows: [{ id: 'a', start: 0, end: 1, beat: { sfx: null } }, { id: 'b', start: 1, end: 2, beat: {} }] });
  assert.deepEqual(r.map((x) => [x.level, x.detail]), [['OK', 'no beat has a sound note']]);
});
test('board_sfx_missing with sfxHit: a 10 ms window more than 12 dB over the 100 ms before it; 13 dB passes, 11 dB warns, a slow rise warns', () => {
  // a steady tone at A until 1.0 s, then (A + jump) from 1.0 s
  const step = (jump) => wav(2, (i) => (i < 0.6 * SR ? 0 : sine(ampForRms(i < 1.0 * SR ? -35 : -35 + jump))(i)));
  // the beat window starts after the tone is up, so only the step can be the transient
  const win = [{ id: 'b', start: 0.8, end: 1.5, beat: { sfx: 'a hit', sfxHit: true } }];
  assert.equal(C.boardSfx(step(13), { windows: win })[0].level, 'OK');
  const soft = C.boardSfx(step(11), { windows: win })[0];
  assert.equal(soft.level, 'WARN'); assert.match(soft.detail, /no transient/); assert.ok(soft.measured > 10 && soft.measured < 12, String(soft.measured));
  // a rise of 100 dB a second from -100 dBFS, the fixture's swell
  const swell = wav(2, (i) => { const t = i / SR; const g = t < 0.5 ? 0 : Math.min(0.12, 1e-5 * Math.pow(10, ((t - 0.5) * 100) / 20)); return sine(g)(i); });
  assert.equal(C.boardSfx(swell, { windows: sfxBeat('a swell', { sfxHit: true }) })[0].level, 'WARN');
  // and a click from silence is a hit
  const click = wav(2, (i) => (i >= 0.9 * SR && i < 0.92 * SR ? sine(0.5)(i) : 0));
  assert.equal(C.boardSfx(click, { windows: sfxBeat('a hit', { sfxHit: true }) })[0].level, 'OK');
});
test('audio_spike: the loudest 50 ms more than 18 dB over the 90th-percentile window is a WARN; silence is left out of the percentile', () => {
  // 40 windows of a tone at 0.05, then one window at 0.05 x 10^(dB/20)
  const spike = (db) => wav(2.05, (i) => (i >= 2.0 * SR ? sine(0.05 * Math.pow(10, db / 20))(i) : sine(0.05)(i)));
  assert.equal(C.audioSpike(spike(17)).level, 'OK');
  const x = C.audioSpike(spike(19));
  assert.equal(x.level, 'WARN'); near(x.t, 2.0, 0.051);
  // sparse effects: one short whoosh and long silence. Compared with silence (the analysis before P3) every
  // sound would be a spike; among the windows that are not silent it is not.
  const sparse = wav(6, (i) => (i >= 1 * SR && i < 1.6 * SR ? sine(0.2)(i) : 0));
  assert.equal(C.audioSpike(sparse).level, 'OK');
  assert.equal(C.audioSpike(wav(1, () => 0)).level, 'OK');
});
test('readWav reads 16-bit PCM and 32-bit float, mono and stereo', () => {
  const pcm = Buffer.alloc(44 + 8); pcm.write('RIFF', 0); pcm.write('WAVE', 8); pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(48000, 24); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(8, 40);
  pcm.writeInt16LE(16384, 44); pcm.writeInt16LE(-16384, 46); pcm.writeInt16LE(0, 48); pcm.writeInt16LE(32767, 50);
  const a = C.readWav(pcm);
  assert.equal(a.n, 2); near(a.L[0], 0.5); near(a.R[0], -0.5); near(a.R[1], 32767 / 32768);
  const fl = Buffer.alloc(44 + 8); fl.write('RIFF', 0); fl.write('WAVE', 8); fl.write('fmt ', 12); fl.writeUInt32LE(16, 16);
  fl.writeUInt16LE(3, 20); fl.writeUInt16LE(1, 22); fl.writeUInt32LE(48000, 24); fl.writeUInt16LE(32, 34); fl.write('data', 36); fl.writeUInt32LE(8, 40);
  fl.writeFloatLE(0.25, 44); fl.writeFloatLE(-0.75, 48);
  const b = C.readWav(fl);
  assert.equal(b.n, 2); near(b.L[1], -0.75); near(b.R[1], -0.75);
});

// ---------------------------------------------------------------- board order and hook
test('board_order and hook_long verdicts', () => {
  assert.deepEqual(levels(C.boardOrderResult([])), ['OK']);
  assert.deepEqual(levels(C.boardOrderResult(['a', 'b'])), ['FAIL', 'FAIL']);
  const h = (end) => ({ ok: end <= 4, hook: 'hook', end, over: end - 4 });
  assert.equal(C.hookLongResult(null), null);
  assert.equal(C.hookLongResult(h(4.0), { hookMax: 4 }).level, 'OK');
  assert.equal(C.hookLongResult(h(4.001), { hookMax: 4 }).level, 'FAIL');
  // a voiced master: the hook ends at the recorded voice delay + HOOK_END, and the delay must be VO_OFFSET
  assert.equal(C.hookLongResult(h(2.7), { voiceDelay: 1.1, voOffset: 1.1, hookEnd: 1.6, hookMax: 4 }).level, 'OK');
  const late = C.hookLongResult(h(2.7), { voiceDelay: 2.5, voOffset: 1.1, hookEnd: 1.6, hookMax: 4 });
  assert.equal(late.level, 'FAIL'); assert.match(late.detail, /voice starts at 2\.500 s, not at VO_OFFSET 1\.100 s/); assert.match(late.detail, /ends at 4\.100 s/);
});

// ---------------------------------------------------------------- 11.2
const facts = (o = {}) => ({
  fileRel: 'out/p-final.mp4', fileSha: 'F', mjPath: '/p/out/p.master.json', mjRel: 'out/p.master.json',
  mj: { mode: 'default', master: { sha256: 'F', video: { hash: 'V' } }, render: { file: 'out/p.mp4.render.json', sha256: 'R' } },
  recExists: true, recSha: 'R', rec: { scene: 'scene.js', params: {}, source: { hash: 'S' }, video: { hash: 'V' } }, sourceNow: { hash: 'S' }, ...o,
});
test('provenance: bound only when the master, its render record and the source all match', () => {
  const okp = C.provenance(facts());
  assert.equal(okp.result.level, 'OK'); assert.equal(okp.bound, true);
  const cases = [
    [{ mjPath: null }, /no master\.json/],
    [{ mjError: 'Unexpected token' }, /not readable/],
    [{ fileSha: 'G' }, /SHA-256 differs/],
    [{ recExists: false }, /is missing/],
    [{ recSha: 'Q' }, /changed after the mix/],
    [{ sourceNow: { hash: 'T' } }, /stale/],
    [{ rec: { scene: 'scene.js', source: { hash: 'S' }, video: { hash: 'W' } } }, /did not copy the picture untouched/],
  ];
  for (const [o, re] of cases) {
    const p = C.provenance(facts(o));
    assert.equal(p.result.level, 'FAIL', JSON.stringify(o)); assert.equal(p.bound, false); assert.match(p.result.detail, re);
  }
});
test('file_spec: size, fps, pixel format, frame count, duration within one frame, and audio unless silent', () => {
  const want = { w: 270, h: 480, fps: 30, dur: 19.2, alpha: null, silent: false };
  const probe = { width: 270, height: 480, fps: 30, pixFmt: 'yuv420p', frames: 576, duration: 19.2, audio: true };
  assert.equal(C.fileSpec(probe, want, 'x').level, 'OK');
  for (const [o, re] of [[{ frames: 575 }, /575 frames, expected/], [{ frames: 577 }, /577 frames/], [{ width: 272 }, /size 272x480/], [{ fps: 25 }, /25 fps/],
    [{ pixFmt: 'yuv444p' }, /pixel format yuv444p/], [{ duration: 19.2 + 1 / 30 + 0.001 }, /duration/], [{ audio: false }, /no audio stream/]]) {
    const x = C.fileSpec({ ...probe, ...o }, want, 'x');
    assert.equal(x.level, 'FAIL', JSON.stringify(o)); assert.match(x.detail, re);
  }
  assert.equal(C.fileSpec({ ...probe, duration: 19.2 + 1 / 30 }, want, 'x').level, 'OK');
  assert.equal(C.fileSpec({ ...probe, audio: false }, { ...want, silent: true }, 'x').level, 'OK');
  assert.equal(C.fileSpec({ ...probe, pixFmt: 'yuva444p10le' }, { ...want, alpha: 'prores' }, 'x').level, 'OK');
  assert.equal(C.fileSpec({ error: 'bad' }, want, 'x').level, 'FAIL');
});
test('faststart: moov before mdat is fine, after is a WARN, and only an .mp4 is checked', () => {
  const atoms = (...types) => Buffer.concat(types.map((t) => { const b = Buffer.alloc(16); b.writeUInt32BE(16, 0); b.write(t, 4, 'latin1'); return b; }));
  assert.deepEqual(C.atomOrder(atoms('ftyp', 'moov', 'mdat')), ['ftyp', 'moov', 'mdat']);
  assert.equal(C.faststartResult('x.mp4', C.atomOrder(atoms('ftyp', 'moov', 'mdat'))).level, 'OK');
  assert.equal(C.faststartResult('x.mp4', C.atomOrder(atoms('ftyp', 'mdat', 'moov'))).level, 'WARN');
  assert.equal(C.faststartResult('x.mov', ['ftyp', 'mdat', 'moov']).level, 'SKIP');
  // a 64-bit size box
  const big = Buffer.alloc(32); big.writeUInt32BE(1, 0); big.write('mdat', 4); big.writeBigUInt64BE(16n, 8); big.writeUInt32BE(16, 16); big.write('moov', 20);
  assert.deepEqual(C.atomOrder(big), ['mdat', 'moov']);
});
test('loudness: within 1 LU of the target and at or under the true-peak ceiling', () => {
  const L = (lufs, tp, o = {}) => C.loudnessResult({ lufs, tp }, { target: -14, from: 'master.json', ...o }).level;
  assert.equal(L(-14, -2), 'OK'); assert.equal(L(-15, -2), 'OK'); assert.equal(L(-13, -1.0), 'OK');
  assert.equal(L(-15.01, -2), 'FAIL'); assert.equal(L(-12.99, -2), 'FAIL'); assert.equal(L(-14, -0.99), 'FAIL');
  assert.equal(L(-14, -2.5, { tp: -3 }), 'FAIL');
  assert.equal(C.loudnessResult({ error: 'no audio' }, { target: -14, from: 'x' }).level, 'FAIL');
});
test('vo_delay: a voiced master must have applied VO_OFFSET; effects-only masters are not checked', () => {
  assert.equal(C.voDelayResult({ mode: 'default', voiceDelay: 1.1 }, 1.1).level, 'OK');
  assert.equal(C.voDelayResult({ mode: 'default', voiceDelay: 1.6 }, 1.1).level, 'FAIL');
  assert.equal(C.voDelayResult({ mode: 'default', voiceDelay: 1.1 }, NaN).level, 'FAIL');
  assert.equal(C.voDelayResult({ mode: 'master-only', voiceDelay: null }, 1.1).level, 'SKIP');
  assert.equal(C.voDelayResult({ mode: 'sting', voiceDelay: null }, 1.1).level, 'SKIP');
});
test('the exit code: 1 on any FAIL, and with --strict on any WARN', () => {
  const rs = (...ls) => ls.map((level) => ({ id: 'x', level }));
  assert.equal(C.summarize(rs('OK', 'SKIP', 'WARN')).exit, 0);
  assert.equal(C.summarize(rs('OK', 'WARN'), { strict: true }).exit, 1);
  assert.equal(C.summarize(rs('OK', 'FAIL')).exit, 1);
  assert.deepEqual(Object.keys(C.toJson([{ id: 'a', scope: 'source', level: 'OK', detail: 'd' }])[0]), ['id', 'scope', 'level', 'detail', 'measured', 'threshold']);
});

// ---------------------------------------------------------------- captions as check sees them (lib.js, tuned in P3)
test('captions: the words shown together share one group, draw: false draws nothing, and a popped word on a full line stays inside the safe area', async () => {
  const { lib, fakeCtx } = await import('./voice-helpers.mjs');
  // 30 px a character (fakeCtx): 13 + 1 + 14 characters = 840 px fits the safe width (852) but not the default line width
  const WORDS = [['aaaaaaaaaaaaa', 0.0, 0.4], ['bbbbbbbbbbbbbb', 0.45, 0.9], ['ccccccccccccc', 0.95, 1.3], ['dddddddddddddd', 1.35, 1.8]]
    .map(([text, start, end]) => ({ text, start, end }));
  const { ctx, calls } = fakeCtx();
  const opts = { safe: SAFE, size: 72, voOffset: 0 };
  let twoLines = 0;
  for (let t = 0; t < 2.2; t += 1 / 240) {
    const bs = lib.captions(ctx, WORDS, t, { ...opts, draw: false });
    for (const b of bs) assert.ok(C.insideRect(b, SAFE), `t=${t.toFixed(3)} ${b.text} at x ${b.x.toFixed(1)}-${(b.x + b.w).toFixed(1)}`);
    // the lines on screen together are one block, so one group
    assert.ok(new Set(bs.map((b) => b.group)).size <= 1, `t=${t.toFixed(3)}: ${bs.map((b) => b.group)}`);
    if (new Set(bs.map((b) => b.line)).size > 1) twoLines++;
  }
  assert.equal(calls.length, 0, 'draw: false drew text');
  assert.ok(twoLines > 0, 'the test needs a block of more than one line');
  assert.ok(lib.captions(ctx, WORDS, 0.5, opts).length > 0 && calls.length > 0, 'and without it, captions draw');
  assert.ok(Math.abs(lib.CAPTION_POP_MAX - 1.165) < 1e-9);
});
