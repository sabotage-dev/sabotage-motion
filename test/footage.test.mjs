// Footage (plan section 16): tools/frames.mjs cuts round(dur x fps) frames at the piece's fps, and lib.js's
// seqAt indexes, loops and holds correctly, both as a pure function and in a real render. The sources are
// generated here with ffmpeg: every source frame carries its own number as two bars (its low and high hex
// digits), so the frame a render drew can be read back from the pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makePiece, render, templateDir, ffprobe, videoStream } from './helpers.mjs';

const lib = await import(pathToFileURL(path.join(templateDir, 'lib.js')).href);
const P = (dir, f) => path.join(dir, f);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// 64x32: the top 16 rows light the 4 px slot (frame mod 16), the bottom 16 rows the slot floor(frame / 16).
function source(dir, name, fps, sec = 3) {
  const geq = "geq=lum='if(lt(Y,16),if(eq(floor(X/4),mod(N,16)),235,16),if(eq(floor(X/4),floor(N/16)),235,16))':cb=128:cr=128";
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=64x32:r=${fps}:d=${sec}`, '-vf', geq,
    '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', P(dir, name)]);
}
function frames(dir, args) {
  const r = spawnSync(process.execPath, ['tools/frames.mjs', ...args], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const seqFiles = (dir, name) => fs.readdirSync(P(dir, `assets/seq/${name}`)).sort();
const piece = (name) => { const dir = makePiece(name, 'fixture-footage'); source(dir, 'src30.mp4', 30); source(dir, 'src25.mp4', 25); return dir; };

test('frames.mjs cuts round(dur x fps) frames at the piece\'s fps and records them in the manifest', () => {
  const dir = piece('footage-cut');
  const r = frames(dir, ['clip', 'src30.mp4', '--from', '0.2', '--dur', '1.37']);
  assert.equal(r.status, 0, r.out);
  const files = seqFiles(dir, 'clip');
  assert.equal(files.length, Math.round(1.37 * 30));
  assert.deepEqual([files[0], files[files.length - 1]], ['000.jpg', '040.jpg']);
  const m = readJson(P(dir, 'assets/seq/manifest.json')).clip;
  assert.deepEqual({ frames: m.frames, fps: m.fps, w: m.w, h: m.h, ext: m.ext, from: m.from, dur: m.dur, src: m.src },
    { frames: 41, fps: 30, w: 64, h: 32, ext: 'jpg', from: 0.2, dur: 1.37, src: 'src30.mp4' });
  // a second sequence joins the manifest without touching the first
  assert.equal(frames(dir, ['other', 'src25.mp4', '--dur', '0.5']).status, 0);
  assert.deepEqual(Object.keys(readJson(P(dir, 'assets/seq/manifest.json'))), ['clip', 'other']);
  assert.equal(readJson(P(dir, 'assets/seq/manifest.json')).clip.frames, 41);
});

test('the fps: --fps, else the scene\'s CFG.FPS, else the --target\'s fps, else 30 (a 25 fps source is converted)', () => {
  const dir = piece('footage-fps');
  fs.writeFileSync(P(dir, 's24.js'), "export const CFG = { W: 1080, H: 1920, FPS: 24, DUR: 1, FONTS: [] };\n");
  fs.writeFileSync(P(dir, 'nofps.js'), "export const CFG = { W: 1080, H: 1920, DUR: 1, FONTS: [] };\n");
  const zones = readJson(P(dir, 'safezones.json'));
  zones.targets.test25 = { ...zones.targets.tiktok, fps: 25 };
  fs.writeFileSync(P(dir, 'safezones.json'), JSON.stringify(zones));
  const count = (args) => {
    const r = frames(dir, ['clip', 'src25.mp4', '--from', '0.1', '--dur', '1.37', ...args]);
    assert.equal(r.status, 0, r.out);
    return [seqFiles(dir, 'clip').length, readJson(P(dir, 'assets/seq/manifest.json')).clip.fps];
  };
  assert.deepEqual(count([]), [41, 30], 'scene.js: CFG.FPS 30');
  assert.deepEqual(count(['--scene', 's24.js']), [33, 24], 'CFG.FPS 24');
  assert.deepEqual(count(['--scene', 's24.js', '--fps', '60']), [82, 60], '--fps wins');
  assert.deepEqual(count(['--scene', 'nofps.js', '--target', 'test25']), [34, 25], 'the target\'s fps');
  assert.deepEqual(count(['--scene', 'nofps.js']), [41, 30], 'the default');
});

test('a re-cut replaces the old frames; --vf and --q apply', () => {
  const dir = piece('footage-recut');
  assert.equal(frames(dir, ['clip', 'src30.mp4', '--dur', '1.37']).status, 0);
  const big = seqFiles(dir, 'clip').reduce((s, f) => s + fs.statSync(P(dir, `assets/seq/clip/${f}`)).size, 0);
  const r = frames(dir, ['clip', 'src30.mp4', '--dur', '0.5', '--vf', 'scale=32:16', '--q', '31']);
  assert.equal(r.status, 0, r.out);
  const files = seqFiles(dir, 'clip');
  assert.equal(files.length, 15);
  assert.ok(!files.includes('015.jpg'), 'no stale frames from the longer cut');
  const v = videoStream(ffprobe(P(dir, 'assets/seq/clip/000.jpg')));
  assert.deepEqual([v.width, v.height], [32, 16]);
  const m = readJson(P(dir, 'assets/seq/manifest.json')).clip;
  assert.deepEqual([m.frames, m.w, m.h, m.vf, m.q], [15, 32, 16, 'scale=32:16', 31]);
  assert.equal(frames(dir, ['q2', 'src30.mp4', '--dur', '0.5', '--q', '2']).status, 0);
  assert.equal(frames(dir, ['q31', 'src30.mp4', '--dur', '0.5', '--q', '31']).status, 0);
  const size = (n) => seqFiles(dir, n).reduce((s, f) => s + fs.statSync(P(dir, `assets/seq/${n}/${f}`)).size, 0);
  assert.ok(size('q2') > size('q31'), `--q 2 (${size('q2')} bytes) is not bigger than --q 31 (${size('q31')})`);
  assert.ok(big > 0);
});

test('a source too short is refused, and the old sequence stays as it was', () => {
  const dir = piece('footage-short');
  assert.equal(frames(dir, ['clip', 'src30.mp4', '--dur', '0.5']).status, 0);
  const before = seqFiles(dir, 'clip');
  const r = frames(dir, ['clip', 'src30.mp4', '--from', '2.5', '--dur', '1.0']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /gave \d+ of the 30 frames/);
  assert.deepEqual(seqFiles(dir, 'clip'), before);
  assert.equal(readJson(P(dir, 'assets/seq/manifest.json')).clip.frames, 15);
  assert.ok(!fs.readdirSync(P(dir, 'assets/seq')).some((f) => f.includes('.tmp-')), 'no temporary folder left behind');
  assert.equal(frames(dir, ['../x', 'src30.mp4', '--dur', '1']).status, 2);
  assert.equal(frames(dir, ['clip', 'src30.mp4']).status, 2, '--dur is required');
});

test('seqIndex: frame floor((t - t0) x fps), the first frame before t0, the last one held, or looped', () => {
  const { seqIndex } = lib;
  // every render frame time f / FPS lands on its own sequence frame, including the ones float math puts a hair low
  for (const fps of [24, 25, 30, 60]) {
    for (let f = 0; f < 200; f++) assert.equal(seqIndex(1000, fps, f / fps), f, `frame ${f} at ${fps} fps`);
    for (let f = 0; f < 200; f++) assert.equal(seqIndex(1000, fps, 0.7 + f / fps, 0.7), f, `frame ${f} at ${fps} fps from t0 0.7`);
  }
  const n = 15, fps = 30, t0 = 0.3;
  assert.equal(seqIndex(n, fps, 0, t0), 0, 'before t0: the first frame');
  assert.equal(seqIndex(n, fps, 0, t0, true), 0, 'before t0, looping: the first frame too');
  assert.equal(seqIndex(n, fps, t0 + 14 / 30, t0), 14);
  assert.equal(seqIndex(n, fps, t0 + 15 / 30, t0), 14, 'held on the last frame');
  assert.equal(seqIndex(n, fps, t0 + 100, t0), 14);
  assert.equal(seqIndex(n, fps, t0 + 15 / 30, t0, true), 0, 'looped back to the first');
  assert.equal(seqIndex(n, fps, t0 + 37 / 30, t0, true), 7);
  // motion-blur subframes (up to half a frame into the shutter) stay on their frame
  for (let f = 0; f < 15; f++) assert.equal(seqIndex(n, fps, t0 + f / 30 + 0.49 / 30, t0), f);
  // a 30 fps sequence in a 60 fps render shows each frame twice
  assert.deepEqual(Array.from({ length: 6 }, (_, f) => seqIndex(n, 30, f / 60)), [0, 0, 1, 1, 2, 2]);
  assert.throws(() => seqIndex(0, 30, 1), /at least one frame/);
});

// Which source frame each quarter of the 270x480 render shows: argmax over the 16 bar slots of one row.
function readBack(file) {
  const W = 270, H = 480, raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 });
  const digit = (f, y) => {
    let best = -1, at = 0;
    for (let s = 0; s < 16; s++) {
      let sum = 0, c = 0;
      for (let x = Math.round((s + 0.25) * W / 16); x < Math.round((s + 0.75) * W / 16); x++) { sum += raw[f * W * H + y * W + x]; c++; }
      if (sum / c > best) { best = sum / c; at = s; }
    }
    return at;
  };
  return Array.from({ length: raw.length / (W * H) }, (_, f) => ({ hold: digit(f, 60) + 16 * digit(f, 180), loop: digit(f, 300) + 16 * digit(f, 420) }));
}

test('seqAt in a render: the held and the looped copy show the right source frame on every frame', () => {
  const dir = piece('footage-render');
  // 15 frames starting at source frame 6 (0.2 s at 30 fps); the scene starts the clip at t0 = 0.3 s
  const c = frames(dir, ['clip', 'src30.mp4', '--from', '0.2', '--dur', '0.5']);
  assert.equal(c.status, 0, c.out);
  // bounded: a scene that throws mid-video leaves render.mjs waiting on its ffmpeg, so a broken seqAt would
  // otherwise hang this test instead of failing it
  const v = spawnSync(process.execPath, ['render.mjs', 'video', '--scale', '0.25', '--sub', '2', '--out', 'out/seq.mp4'],
    { cwd: dir, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL' });
  assert.equal(v.status, 0, `render.mjs video ${v.signal ? 'was stopped after 180 s' : `exited ${v.status}`}\n${v.stdout}${v.stderr}`);
  const got = readBack(P(dir, 'out/seq.mp4'));
  assert.equal(got.length, 48);
  const want = got.map((_, f) => {
    const i = f - 9;                                   // floor((f / 30 - 0.3) x 30)
    return { hold: 6 + (i <= 0 ? 0 : Math.min(i, 14)), loop: 6 + (i <= 0 ? 0 : i % 15) };
  });
  assert.deepEqual(got, want);
});

test('loadSeq names a sequence the manifest does not have', () => {
  const dir = piece('footage-missing');
  assert.equal(frames(dir, ['clip', 'src30.mp4', '--dur', '0.5']).status, 0);
  fs.writeFileSync(P(dir, 'nope.js'), fs.readFileSync(P(dir, 'scene.js'), 'utf8').replace("loadSeq('clip')", "loadSeq('nope')"));
  const r = render(dir, ['stills', '0.5', '--scene', 'nope.js', '--scale', '0.25'], { allowFail: true });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /has no sequence "nope" \(it has: clip\)/);
});
