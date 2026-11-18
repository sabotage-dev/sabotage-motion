// flash on files (plan 23.9): the decode path and the wiring in `render.mjs check`.
//   - Frames built in code, encoded losslessly (FFV1, RGB), run through `check --file --plain --only flash`: the result
//     is what the rule gives on the same frames in memory (so decoding changes nothing), at 30 and at 29.97 fps, for
//     general and red flashes, a pass, and the scaling both ways (a frame scaled up to 1024 px fails where it would
//     pass unscaled, one scaled down passes where it would fail unscaled). A file with alpha is not checked, a VP9
//     WebM whose alpha only its stream tag shows included (council round 1, A1).
//   - Round 1 (A2, A3): a rotated MP4 is measured as displayed, scaled or with its coded long side already 1024 px;
//     a variable-frame-rate file is dated by its frames' timestamps, so a strobe that a single probed rate would
//     crowd into one second passes, and one whose frames really are that close fails.
//   - Round 1 (M1): a file cut short, which ffmpeg decodes one frame short and still exits 0, is a FAIL that says it
//     could not be decoded, while the intact file still FAILs on its flashes.
//   - Round 2 (C1, C2): a stream that changes size mid-way completes with every frame dated (showinfo's counter restarts
//     there, so frames pair with its lines in the order they come); ffmpeg going quiet is stopped by a watchdog; and a
//     valid variable-rate file whose frames come faster than its declared rate is not refused over the timestamps of
//     the checker's own raw output.
//   - fixture-flash rendered by the engine: a strobe lit only between the probe's samples, which the motion-blurred
//     render shows. Source `check` runs flash on the current render of the whole piece (FAIL), while the probe sees a
//     still card; with no render, only a partial one, or one from an older source, flash is not checked and says to
//     render; an alpha check is not checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
test('round 1, A1: a VP9 WebM with alpha (yuv420p to ffprobe, alpha_mode=1 on the stream) is an overlay: not checked, even --plain', () => {
  const w = 128, h = 128, frames = Array.from({ length: 31 }, (_, k) => {
    const b = Buffer.alloc(w * h * 4);
    for (let i = 0; i < b.length; i += 4) { b.fill(k % 2 ? 255 : 0, i, i + 3); b[i + 3] = i < b.length / 2 ? 255 : 0; }
    return b;
  });
  const f = P('out/overlay.webm');
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', '30', '-i', '-',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '0', '-crf', '40', f], { input: Buffer.concat(frames), maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, String(r.stderr));
  const v = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', f], { encoding: 'utf8' }).stdout).streams[0];
  assert.equal(v.pix_fmt, 'yuv420p', 'ffprobe reads it as plain video');
  assert.equal(String(v.tags.alpha_mode ?? v.tags.ALPHA_MODE), '1', 'the stream tag says it has alpha');
  assert.equal(C.flashProbe(f).alpha, true);
  const d = fileFlash(f);
  assert.equal(d.level, 'SKIP', d.out);
  assert.match(d.detail, /not checked: an overlay with alpha/);
});

// A 90-degree display rotation (-display_rotation 90, counter-clockwise) on a lossless MP4 of the coded frames: the
// coded frames are the displayed ones turned clockwise, so the file shows `shown` (w x h) upright.
function encodeRotated(name, shown, w, h) {
  const coded = shown.map((d) => {
    const c = Buffer.alloc(w * h * 3);          // h wide, w tall
    for (let yc = 0; yc < w; yc++) for (let xc = 0; xc < h; xc++) d.copy(c, (yc * h + xc) * 3, ((h - 1 - xc) * w + yc) * 3, ((h - 1 - xc) * w + yc) * 3 + 3);
    return c;
  });
  const tmp = P(`out/${name}-coded.mp4`), f = P(`out/${name}.mp4`);
  let r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${h}x${w}`, '-r', '30', '-i', '-',
    '-c:v', 'libx264rgb', '-crf', '0', '-preset', 'ultrafast', tmp], { input: Buffer.concat(coded), maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, String(r.stderr));
  r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-display_rotation:v:0', '90', '-i', tmp, '-c', 'copy', f], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // decoded the way flash decodes it (autorotated), the first frame is the picture as shown
  const back = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 }).stdout;
  assert.ok(back.equals(shown[0]), 'the rotated file shows the picture upright');
  return f;
}
test('round 1, A2: a rotated MP4 is measured as displayed: a 341x65 strip on a 576x1024 picture coded 1024x576', () => {
  const shown = Array.from({ length: 61 }, (_, k) => rect(576, 1024, Math.floor(k / 4) % 2 === 1, 100, 100, 341, 65));
  const f = encodeRotated('turned-1024', shown, 576, 1024);
  const p = C.flashProbe(f);
  assert.deepEqual([p.width, p.height, p.coded], [576, 1024, [1024, 576]]);
  const d = fileFlash(f);
  assert.equal(d.level, 'FAIL', d.out);
  same(d, inMemory(shown, 576, 1024, '30'));
});
test('round 1, A2: rotated and scaled: a 682x130 strip on a 1152x2048 picture coded 2048x1152 measures as the 341x65 strip', () => {
  const shown = Array.from({ length: 61 }, (_, k) => rect(1152, 2048, Math.floor(k / 4) % 2 === 1, 200, 200, 682, 130));
  const half = Array.from({ length: 61 }, (_, k) => rect(576, 1024, Math.floor(k / 4) % 2 === 1, 100, 100, 341, 65));
  const d = fileFlash(encodeRotated('turned-2048', shown, 1152, 2048));
  assert.equal(d.level, 'FAIL', d.out);
  assert.match(d.detail, /measured at 576x1024/);
  same(d, inMemory(half, 576, 1024, '30'));
});

// Frames shown at the given times (ms): they go in at 1000 fps and setpts puts each at its own time; FFV1 in Matroska
// keeps the millisecond timestamps.
function encodeAt(name, frames, ms) {
  const f = P(`out/${name}.mkv`), expr = ms.map((t, i) => `eq(N,${i})*${t}`).join('+');
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', '1000', '-i', '-',
    '-vf', `setpts='${expr}'`, '-fps_mode', 'passthrough', '-c:v', 'ffv1', '-pix_fmt', 'gbrp', f], { input: Buffer.concat(frames), maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, String(r.stderr));
  const got = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim().split('\n').map(Number);
  assert.deepEqual(got, ms, 'the file shows each frame at its time');
  return f;
}
// The rule on frames dated in ms, in memory.
function atMs(frames, ms) {
  const t = C.flashTracker({ w: W, h: H, timeBase: '1/1000' });
  frames.forEach((fr, k) => t.pushRGB8(fr, ms[k]));
  return C.flashResult(t.result(), { scope: 'file', what: 'x' });
}
test('round 1, A3: variable frame rate, dated by each frame\'s timestamp: frames at 0, 0.2 ... 1.6 and 1.801 s alternating pass', () => {
  const ms = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1801], frames = ms.map((_, k) => grey(k % 2 ? 188 : 89));
  const d = fileFlash(encodeAt('vfr-codex', frames, ms));
  assert.equal(d.level, 'OK', d.out);
  same(d, atMs(frames, ms));
  // after ten frames at 30 fps, ffprobe guesses a rate of 30 or more (60/1 with ffmpeg 9), and dating these frames by
  // it would crowd their ten transitions into a third of a second or less, and fail them
  const lead = Array.from({ length: 10 }, (_, k) => Math.round((k * 1000) / 30)), ms2 = [...lead, ...ms.map((t) => t + 500)];
  const frames2 = [...lead.map(() => grey(89)), ...frames.map((_, k) => grey(k % 2 ? 89 : 188))];
  const f2 = encodeAt('vfr-lead', frames2, ms2);
  const guess = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', f2], { encoding: 'utf8' }).stdout.trim();
  assert.ok(eval(guess) >= 30, `ffprobe's guess ${guess}`);
  assert.equal(inMemory(frames2, W, H, guess).level, 'FAIL', `dated by the probed rate (${guess}), ten transitions sit in a third of a second`);
  const d2 = fileFlash(f2);
  assert.equal(d2.level, 'OK', d2.out);
  same(d2, atMs(frames2, ms2));
});
test('round 1, A3: variable frame rate: a 60 fps burst after a 30 fps lead-in, 5 frames light and 5 dark, FAILs at its real times', () => {
  const lead = Array.from({ length: 10 }, (_, k) => Math.round((k * 1000) / 30)), burst = Array.from({ length: 40 }, (_, m) => 500 + Math.round((m * 1000) / 60));
  const ms = [...lead, ...burst], frames = [...lead.map(() => grey(89)), ...burst.map((_, m) => grey(Math.floor(m / 5) % 2 ? 89 : 188))];
  const d = fileFlash(encodeAt('vfr-burst', frames, ms));
  assert.equal(d.level, 'FAIL', d.out);
  assert.equal(d.t, 1.083, 'the eighth transition, frame 45, shown at 1083 ms');
  same(d, atMs(frames, ms));
});
test('round 1, M1: a strobe cut 40 bytes short, which ffmpeg decodes a frame short and exits 0 on, FAILs as not decodable', () => {
  // nine frames at 8 fps, black and white in turn: eight transitions in 0.875 s
  const f = P('out/strobe8.mkv');
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', "color=c=black:s=320x240:r=8:d=1.125,geq=lum='if(mod(N,2),255,0)':cb=128:cr=128",
    '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', f], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const whole = fileFlash(f);
  assert.equal(whole.level, 'FAIL', whole.out);
  assert.match(whole.detail, /flash more than three times a second \(general\)/, 'the intact file fails on its flashes, and showinfo\'s lines are not errors');
  const buf = fs.readFileSync(f), cut = P('out/strobe8-cut.mkv');
  fs.writeFileSync(cut, buf.subarray(0, buf.length - 40));
  const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', cut, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(dec.status, 0, 'ffmpeg exits 0 on the cut file');
  assert.match(dec.stderr, /\S/, 'and reports an error');
  const d = fileFlash(cut);
  assert.equal(d.level, 'FAIL', d.out);
  assert.match(d.detail, /^out\/strobe8-cut\.mkv could not be decoded to look for flashes: ffmpeg reported "[^"]+".* and went on, so frames may be missing or damaged$/);
});
test('round 2, C1: an MPEG-TS whose picture changes size mid-way (12 frames at 96x64, then a 128x64 strobe) completes, all 24 frames dated', async () => {
  // two streams, the second 1 s later (-output_ts_offset), one after the other: ffmpeg rebuilds its filter graph at the
  // change, and showinfo's frame counter n starts again at 0
  const ts = (name, src, extra = []) => {
    const f = P(`out/${name}.ts`);
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...extra, '-f', 'mpegts', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return fs.readFileSync(f);
  };
  const a = ts('size-a', 'color=c=gray:s=96x64:r=12:d=1');
  const b = ts('size-b', "color=c=black:s=128x64:r=12:d=1,geq=lum='if(mod(N,2),235,16)':cb=128:cr=128", ['-output_ts_offset', '1']);
  const f = P('out/size-change.ts');
  fs.writeFileSync(f, Buffer.concat([a, b]));
  const sizes = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=width', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.split(',')[0]);
  assert.deepEqual([sizes.length, sizes[0], sizes[23]], [24, '96', '128'], 'the stream changes size after 12 frames');
  // through check, with a time limit of its own so a hang shows as a failure here and not as a stuck suite
  const r = spawnSync(process.execPath, ['render.mjs', 'check', '--file', 'out/size-change.ts', '--plain', '--only', 'flash', '--json'],
    { cwd: dir, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL' });
  assert.equal(r.signal, null, 'check finished');
  const x = JSON.parse(r.stdout)[0];
  assert.equal(x.level, 'FAIL', x.detail);
  // the strobe's frames sit at 75000 + 7500 j ticks of 1/90000 s from the first frame (the second stream starts two
  // frames before the first ends); the eighth transition, its frame 7, is at 127500 ticks
  assert.match(x.detail, /^out\/size-change\.ts: from 1\.417 s, .* 5 of 24 frames are over it, the last at 1\.750 s/);
  const m = await C.measureFlash(f);
  assert.deepEqual([m.frames, m.failing, m.first.f, m.last.f], [24, 5, 19, 23]);
});
test('round 2, C1: ffmpeg going quiet (a source that stops sending) is stopped by the watchdog: not decodable, never a hang', async () => {
  // 10 s of a small FFV1 picture over TCP from a server in its own process (ffprobe runs while this process waits on it):
  // every connection gets the first 70% of the file and then nothing, with the socket left open. ffprobe has its 5 s
  // of packets by then; ffmpeg decodes about 7 s and then waits on the socket.
  const src = P('out/quiet.mkv');
  const e = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=10:d=10', '-c:v', 'ffv1', src], { encoding: 'utf8' });
  assert.equal(e.status, 0, e.stderr);
  const server = spawn(process.execPath, ['-e', `
    const net = require('node:net'), fs = require('node:fs'), data = fs.readFileSync(process.argv[1]);
    const part = data.subarray(0, Math.floor(data.length * 0.7));
    const srv = net.createServer((s) => { s.on('error', () => {}); s.write(part); });
    srv.listen(0, '127.0.0.1', () => console.log(srv.address().port));
  `, src], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((res, rej) => { server.stdout.once('data', (d) => res(String(d).trim())); server.once('exit', rej); });
    const t0 = Date.now();
    const m = await Promise.race([C.measureFlash(`tcp://127.0.0.1:${port}`, { stallMs: 1500 }), new Promise((res) => setTimeout(() => res({ hung: true }), 45000))]);
    assert.ok(!m.hung, 'measureFlash returned');
    assert.match(m.error || '', /^ffmpeg went quiet for 1\.5 s \(no frame and no log line\) and was stopped$/);
    assert.ok(Date.now() - t0 < 20000, `stopped in ${Date.now() - t0} ms`);
    assert.match(C.flashResult(m, { scope: 'file', what: 'x' }).detail, /^x could not be decoded to look for flashes: ffmpeg went quiet/);
  } finally { server.kill('SIGKILL'); }
});
test('round 2, C2: a valid VFR file declared 30 fps whose frames then come 16-17 ms apart is checked, not refused', () => {
  // black, H.264 in Matroska: ten frames 33 ms apart (so the stream says 30/1), then 50 frames 16 or 17 ms apart
  const f = P('out/vfr-declared30.mkv');
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=2',
    '-vf', "settb=1/1000,setpts='if(lt(N,10),N*1000/30,1000/3+(N-10)*1000/60)'", '-fps_mode', 'passthrough', '-enc_time_base', '1/1000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const probe = (args) => spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', ...args, '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim();
  assert.equal(probe(['-show_entries', 'stream=r_frame_rate']), '30/1');
  const ms = probe(['-show_entries', 'frame=pts']).split('\n').map((l) => Number(l.split(',')[0]));
  assert.equal(ms.length, 60);
  assert.ok(ms.every((t, i) => !i || t > ms[i - 1]), 'every frame at its own time');
  assert.deepEqual(ms.slice(9, 13), [300, 333, 350, 366]);
  // decoded the way flash decodes it but with ffmpeg's own output timestamps, the raw output's 1/30 s clock puts two of
  // these frames on one tick, and ffmpeg logs it as an error
  const raw = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'level+info', '-i', f, '-map', '0:v:0', '-fps_mode', 'passthrough',
    '-vf', 'scale=1024:768,format=rgb24', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-y', process.platform === 'win32' ? 'NUL' : '/dev/null'], { encoding: 'utf8' });
  assert.match(raw.stderr, /\[error\] Application provided invalid, non monotonically increasing dts/, 'the case is live on this ffmpeg');
  const d = fileFlash(f);
  assert.equal(d.level, 'OK', d.out);
  assert.match(d.detail, /\(60 frames at 1024x768/);
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
