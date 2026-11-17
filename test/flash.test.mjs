// flash on files (plan 23.9): the decode path and the wiring in `render.mjs check`.
//   - Frames built in code, encoded losslessly (FFV1, RGB), run through `check --file --plain --only flash`: the result
//     is what the rule gives on the same frames in memory (so decoding changes nothing), at 30 and at 29.97 fps, for
//     general and red flashes, a pass, and the scaling both ways (a frame scaled up to 1024 px fails where it would
//     pass unscaled, one scaled down passes where it would fail unscaled). A file with alpha is not checked.
//   - fixture-flash rendered by the engine: a strobe lit only between the probe's samples, which the motion-blurred
//     render shows. Source `check` runs flash on the current render of the whole piece (FAIL), while the probe sees a
//     still card; with no render, only a partial one, or one from an older source, flash is not checked and says to
//     render; an alpha check is not checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makePiece, render } from './helpers.mjs';
import { C, runCheck, one } from './check-helpers.mjs';

const dir = makePiece('flash', 'fixture-flash');
fs.rmSync(path.join(dir, 'board.js'));            // the template's board describes the template's scene
const P = (f) => path.join(dir, f);
fs.mkdirSync(P('out'), { recursive: true });

// ---------------------------------------------------------------- lossless files
// Packed 8-bit RGB frames to an FFV1 .mkv (lossless) at `rate`; pixFmt bgra keeps an alpha plane.
function encode(name, frames, w, h, rate, pixFmt = 'gbrp') {
  const f = P(`out/${name}.mkv`);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-r', rate, '-i', '-',
    '-c:v', 'ffv1', '-pix_fmt', pixFmt, f], { input: Buffer.concat(frames), maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, String(r.stderr));
  return f;
}
// The rule on the same frames in memory, as check reports it.
function inMemory(frames, w, h, rate) {
  const t = C.flashTracker({ w, h, rate });
  for (const fr of frames) t.pushRGB8(fr);
  return C.flashResult(t.result(), { scope: 'file', what: 'x' });
}
const fileFlash = (f) => { const r = runCheck(dir, ['--file', path.relative(dir, f), '--plain', '--only', 'flash']); return { ...one(r.results, 'flash'), status: r.status, out: r.out }; };
const same = (a, b) => assert.deepEqual([a.level, a.t, a.measured], [b.level, b.t, b.measured], `decoded ${JSON.stringify(a)}\nin memory ${JSON.stringify(b)}`);

const W = 576, H = 1024;
const grey = (v, w = W, h = H) => Buffer.alloc(w * h * 3, v);           // 89 is relative luminance 0.0999, 188 is 0.503
const solid = ([r, g, b], w = W, h = H) => { const x = Buffer.alloc(w * h * 3); for (let i = 0; i < x.length; i += 3) { x[i] = r; x[i + 1] = g; x[i + 2] = b; } return x; };
function toggles(n, at, lo = 89, hi = 188) { let v = lo; return Array.from({ length: n }, (_, k) => { if (at.includes(k)) v = v === lo ? hi : lo; return grey(v); }); }
// a w x h frame of grey 89 with a grey-188 rectangle (x0, y0, rw, rh) when `on`
function rect(w, h, on, x0, y0, rw, rh) {
  const b = grey(89, w, h);
  if (on) for (let y = y0; y < y0 + rh; y++) b.fill(188, (y * w + x0) * 3, (y * w + x0 + rw) * 3);
  return b;
}

test('decoded = in memory: a full-frame strobe at 30 fps FAILs from frame 8, with the same area and frames', () => {
  const frames = Array.from({ length: 31 }, (_, k) => grey(k % 2 ? 188 : 89));
  const d = fileFlash(encode('strobe', frames, W, H, '30'));
  assert.equal(d.level, 'FAIL', d.out); assert.equal(d.scope, 'file'); assert.equal(d.status, 1);
  assert.equal(d.t, 0.267);
  assert.match(d.detail, /^out\/strobe\.mkv: from 0\.267 s, 87296 px of a 341x256 window/);
  same(d, inMemory(frames, W, H, '30'));
});
test('decoded = in memory at 29.97 fps: eight transitions in 0.968 s FAIL, dated 30 x 1001/30000 s; in 1.001 s they pass', () => {
  const fail = toggles(60, [1, 5, 9, 13, 17, 21, 25, 30]), pass = toggles(60, [1, 5, 9, 13, 17, 21, 25, 31]);
  const a = fileFlash(encode('ntsc-fail', fail, W, H, '30000/1001'));
  assert.equal(a.level, 'FAIL', a.out);
  assert.equal(a.t, 1.001, 'frame 30 at 30000/1001, not 1.000 s at 30');
  same(a, inMemory(fail, W, H, '30000/1001'));
  const b = fileFlash(encode('ntsc-pass', pass, W, H, '30000/1001'));
  assert.equal(b.level, 'OK', b.out);
  same(b, inMemory(pass, W, H, '30000/1001'));
});
test('decoded = in memory: a red strobe saturated only on linear RGB, (230,60,60) against (0,130,0), FAILs as red', () => {
  const frames = Array.from({ length: 31 }, (_, k) => solid(Math.floor(k / 3) % 2 ? [0, 130, 0] : [230, 60, 60]));
  const d = fileFlash(encode('red', frames, W, H, '30'));
  assert.equal(d.level, 'FAIL', d.out); assert.equal(d.measured.kind, 'red');
  same(d, inMemory(frames, W, H, '30'));
});
test('decoded = in memory: three flashes and then a held rise pass', () => {
  const frames = [89, 89, 89, ...Array.from({ length: 19 }, (_, k) => (Math.floor(k / 3) % 2 === 0 ? 188 : 89)), ...Array(40).fill(188)].map((v) => grey(v));
  const d = fileFlash(encode('three', frames, W, H, '30'));
  assert.equal(d.level, 'OK', d.out);
  same(d, inMemory(frames, W, H, '30'));
});
test('scaled up: a 34x172 px rectangle flashing 4 times a second on a 288x512 frame is 68x344 at 1024 px, and FAILs', () => {
  const frames = Array.from({ length: 61 }, (_, k) => rect(288, 512, Math.floor(k / 4) % 2 === 1, 100, 100, 34, 172));
  const d = fileFlash(encode('up', frames, 288, 512, '30'));
  assert.equal(d.level, 'FAIL', d.out);
  assert.match(d.detail, /measured at 576x1024/);
  assert.equal(inMemory(frames, 288, 512, '30').level, 'OK', 'unscaled, 5,848 px would pass');
});
test('scaled down by area averaging: 2x2 blocks average exactly, so a 1152x2048 file measures as its 576x1024 half (fine stripes too)', () => {
  // a 130x330 px rectangle (65x165 at 1024 px: 10,725 px, a pass) and a 130x682 one (65x341: 22,165 px, a FAIL)
  for (const [rh, level] of [[330, 'OK'], [682, 'FAIL']]) {
    const big = Array.from({ length: 61 }, (_, k) => rect(1152, 2048, Math.floor(k / 4) % 2 === 1, 200, 200, 130, rh));
    const half = Array.from({ length: 61 }, (_, k) => rect(576, 1024, Math.floor(k / 4) % 2 === 1, 100, 100, 65, rh / 2));
    const d = fileFlash(encode(`down-${rh}`, big, 1152, 2048, '30'));
    assert.equal(d.level, level, d.out);
    same(d, inMemory(half, 576, 1024, '30'));
    if (level === 'OK') assert.equal(inMemory(big, 1152, 2048, '30').level, 'FAIL', 'unscaled, 130 x 330 = 42,900 px would fail');
  }
  // 2 px stripes (grey 100 and 140, 0.135 apart in luminance) swapping every frame: averaged by area they are 1 px
  // stripes of the same two greys, and fail; a bilinear filter, wider than 2 px going down, blurs them to 110 and 130
  // (0.067 apart), under the 0.1 swing
  const stripes = (w, h, k, px) => { const b = Buffer.alloc(w * h * 3); for (let i = 0, p = 0; p < w * h; p++, i += 3) b.fill((Math.floor((p % w) / px) % 2 === 1) !== (k % 2 === 1) ? 140 : 100, i, i + 3); return b; };
  const big = Array.from({ length: 31 }, (_, k) => stripes(1152, 2048, k, 2)), half = Array.from({ length: 31 }, (_, k) => stripes(576, 1024, k, 1));
  const d = fileFlash(encode('down-stripes', big, 1152, 2048, '30'));
  assert.equal(d.level, 'FAIL', d.out);
  same(d, inMemory(half, 576, 1024, '30'));
});
test('a file with an alpha plane is an overlay: flash is not checked, and says why', () => {
  const frames = Array.from({ length: 31 }, (_, k) => grey(k % 2 ? 188 : 89));
  const d = fileFlash(encode('alpha', frames, W, H, '30', 'bgra'));
  assert.equal(d.level, 'SKIP', d.out);
  assert.match(d.detail, /not checked: an overlay with alpha/);
});
test('a file ffmpeg cannot decode is a flash FAIL that says so', () => {
  fs.writeFileSync(P('out/broken.mp4'), Buffer.from('not a video at all'));
  const d = fileFlash(P('out/broken.mp4'));
  assert.equal(d.level, 'FAIL', d.out);
  assert.match(d.detail, /out\/broken\.mp4 could not be decoded to look for flashes/);
});

// ---------------------------------------------------------------- the engine's own render: a flash between the probe's samples
const R = ['--scale', '0.25'];
const srcFlash = (args = []) => { const r = runCheck(dir, ['--only', 'flash', ...args]); return { ...one(r.results, 'flash'), out: r.out }; };

test('source check: no render of the whole piece yet, or only part of it, and flash is not checked and says to render', () => {
  const a = srcFlash();
  assert.equal(a.level, 'SKIP', a.out); assert.equal(a.scope, 'source');
  assert.match(a.detail, /not checked: no render of the whole piece with these settings in out\/ .*: render it \(node render\.mjs full\)/);
  render(dir, ['video', ...R, '--to', '0.5', '--out', 'out/part.mp4']);   // before the flashes start
  assert.equal(srcFlash().level, 'SKIP', 'a render of the first 0.5 s does not speak for the piece');
});
test('source check: the render shows a strobe the probe never samples; flash FAILs on it, the probe sees a still card', () => {
  render(dir, ['video', ...R, '--out', 'out/flash.mp4']);
  render(dir, ['video', ...R, '--to', '0.5', '--out', 'out/part.mp4']);   // a newer render of part of the piece is passed over
  const r = runCheck(dir, ['--dump', 'out/dump.json']);
  const x = one(r.results, 'flash');
  assert.equal(x.level, 'FAIL', r.out); assert.equal(x.scope, 'source');
  assert.match(x.detail, /^out\/flash\.mp4: from 1\.300 s/);
  assert.equal(x.t, 1.3, 'lit at frames 18-20, 24-26, ...: the eighth transition is frame 39');
  const pairs = JSON.parse(fs.readFileSync(P('out/dump.json'), 'utf8')).probe.changed.pairs;
  assert.equal(pairs.length, 59);
  assert.ok(pairs.every((p) => p[0] === 0), 'no probe pixel changes in any frame pair');
  // the same render as a file
  const f = fileFlash(P('out/flash.mp4'));
  assert.equal(f.level, 'FAIL'); assert.equal(f.t, 1.3);
});
test('source check: a render from an older source is not checked and says to render again; restored, it is checked again', () => {
  const f = P('scene.js'), orig = fs.readFileSync(f, 'utf8');
  try {
    fs.writeFileSync(f, orig + '// edited after the render\n');
    const x = srcFlash();
    assert.equal(x.level, 'SKIP', x.out);
    assert.match(x.detail, /not checked: out\/flash\.mp4 was rendered from an older source: render it/);
  } finally { fs.writeFileSync(f, orig); }
  assert.equal(srcFlash().level, 'FAIL');
});
test('source check with --alpha: an overlay, not checked', () => {
  const x = srcFlash(['--alpha']);
  assert.equal(x.level, 'SKIP', x.out);
  assert.match(x.detail, /not checked: an alpha render is an overlay/);
});
