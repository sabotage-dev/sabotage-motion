// P10, caption a clip (plan 23.5), the whole path with ffmpeg and Chrome. The sync fixture is a clip made here with
// ffmpeg: a moving test pattern with one white frame (frame 45, 1.5 s) and a tone in its sound starting at that same
// time, and a whisper.cpp transcript whose word "Now" starts there. It goes through tools/clip.mjs prepare, the caption
// overlay (caption.js, alpha), tools/clip.mjs composite, tools/mix.mjs --no-sfx and check --file. In the master, on the
// clip's own clock: the tone's onset, the white frame and the first frame the caption "Now" is visible are each within
// one frame of frame 45 (a voice and captions moved together by a shared offset would fail the tone), and the master
// has the clip's frame count and length. Then: a stale overlay FAILs check --file; a variable-rate clip is converted
// and says so; a clip of another shape than its target has text_safe not checked; doctor reports whisper-cli.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { makePiece, render, ffprobe, videoStream, countFrames } from './helpers.mjs';
import { runCheck, one } from './check-helpers.mjs';

const FPS = 30, FLASH = 45, W = 540, H = 960;
const made = [];
const piece = (name) => { const d = makePiece(name, 'transcripts'); made.push(d); return d; };
const tool = (dir, args) => {
  const r = spawnSync(process.execPath, ['tools/clip.mjs', ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const ok = (r) => { assert.equal(r.status, 0, r.out); return r; };
const mix = (dir, args) => ok((() => { const r = spawnSync(process.execPath, ['tools/mix.mjs', ...args], { cwd: dir, encoding: 'utf8' }); return { status: r.status, out: r.stdout + r.stderr }; })());
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
// a clip: the moving test pattern, one white frame at FLASH, a quiet hum with a loud tone from FLASH / FPS
function syncClip(file, { w = W, h = H, dur = 3 } = {}) {
  const at = FLASH / FPS;
  ff(['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=${FPS}:d=${dur}`, '-f', 'lavfi', '-i', `aevalsrc='if(gte(t,${at})*lt(t,${at + 0.2}),0.5*sin(2*PI*1000*t),0.02*sin(2*PI*220*t))':s=48000:d=${dur}`,
    '-filter_complex', `[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,${FLASH})'[v]`, '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
}
const gray = (file, w, h) => {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  return Array.from({ length: b.length / (w * h) }, (_, i) => b.subarray(i * w * h, (i + 1) * w * h));
};
const monoSamples = (file) => {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};

let dir;
before(() => {
  dir = piece('clip-sync');
  syncClip(path.join(dir, 'src.mp4'));
  const p = ok(tool(dir, ['prepare', 'src.mp4', '--transcript', 'sync.whispercpp.json', '--board']));
  assert.match(p.out, /540x960 at 30 fps \(30\/1\), 90 frames, 3\.000 s/);
  render(dir, ['video', '--scene', 'caption.js', '--alpha', '--sub', '2', '--out', 'out/sync.mov']);
  ok(tool(dir, ['composite', 'sync']));
  mix(dir, ['sync', '--no-sfx']);
});
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

test('prepare: the clip, clip.js on its clock, the cues at the clip\'s own times (VO_OFFSET 0), vo.wav its sound, a one-beat board', async () => {
  const clip = (await import(path.join(dir, 'clip.js') + '?a')).CLIP;
  assert.deepEqual([clip.file, clip.w, clip.h, clip.fps, clip.fpsRational, clip.frames, clip.dur], ['clip.mp4', W, H, 30, '30/1', 90, 3]);
  assert.equal(clip.transcript.kind, 'whispercpp');
  const cues = JSON.parse(fs.readFileSync(path.join(dir, 'cues.json'), 'utf8'));
  assert.equal(cues.VO_OFFSET, 0);
  assert.deepEqual(cues.CUE, {});
  assert.deepEqual(cues.WORDS.map((w) => [w.text, w.start]), [['Ready,', 0.3], ['set...', 0.65], ['Now', 1.5], ['go.', 2.2]]);
  const board = fs.readFileSync(path.join(dir, 'board.js'), 'utf8');
  assert.match(board, /id: "clip",\s+dur: 3,/);
  // vo.wav is the clip's sound from its first frame, the clip's length
  const vo = monoSamples(path.join(dir, 'vo.wav'));
  assert.equal(vo.length, 3 * 48000);
});

test('sync: in the master, the tone\'s onset, the white frame and the caption\'s first visible frame are each within one frame of frame 45', () => {
  const master = path.join(dir, 'out/sync-final.mp4'), clip = path.join(dir, 'clip.mp4');
  // the white frame: the one frame whose mean luma is near white
  const small = gray(master, 54, 96), mean = (f) => f.reduce((s, v) => s + v, 0) / f.length;
  const white = small.map((f, i) => [i, mean(f)]).filter(([, m]) => m > 200).map(([i]) => i);
  assert.deepEqual(white, [FLASH], 'the flash is still on its frame');
  // the tone: the first sample after 1 s louder than half the tone's peak
  const s = monoSamples(master), sr = 48000;
  let peak = 0;
  for (let i = sr; i < 2 * sr; i++) peak = Math.max(peak, Math.abs(s[i]));
  let onset = -1;
  for (let i = sr; i < 2 * sr; i++) if (Math.abs(s[i]) > 0.5 * peak) { onset = i / sr; break; }
  assert.ok(Math.abs(onset * FPS - FLASH) <= 1, `the tone starts at ${onset.toFixed(4)} s = frame ${(onset * FPS).toFixed(2)}`);
  // the caption: frames where the master's caption band differs from the clip's own picture
  const m = gray(master, W, H), c = gray(clip, W, H);
  assert.equal(m.length, c.length);
  const inked = (i) => { let n = 0; for (let y = 520; y < 720; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (Math.abs(m[i][k] - c[i][k]) > 60) n++; } return n; };
  assert.ok(inked(20) > 300, 'the first caption ("Ready, set...") shows at 0.67 s');
  assert.ok(inked(43) < 50, `no caption between the phrases (frame 43: ${inked(43)} pixels)`);
  let first = -1;
  for (let i = 42; i < 60; i++) if (inked(i) > 300) { first = i; break; }
  assert.ok(Math.abs(first - FLASH) <= 1, `"Now" first shows on frame ${first}`);
});

test('the master has the clip\'s frame count and length, and check --file passes it: both provenances bound, zones scaled, picture checks on the composite', () => {
  const master = path.join(dir, 'out/sync-final.mp4');
  assert.equal(countFrames(master), 90);
  const v = videoStream(ffprobe(master));
  assert.equal(v.r_frame_rate, '30/1');
  assert.ok(Math.abs(+v.duration - 3) < 1e-6, `video ${v.duration} s`);
  assert.ok(Math.abs(+ffprobe(master).format.duration - 3) <= 1 / FPS, 'the file lasts the clip\'s length');
  const rec = JSON.parse(fs.readFileSync(path.join(dir, 'out/sync.mp4.render.json'), 'utf8'));
  assert.equal(rec.kind, 'composite');
  assert.equal(rec.alpha, null);
  assert.deepEqual([rec.frames, rec.fps, rec.dur, rec.render], [90, 30, 3, [W, H]]);
  assert.match(rec.sha256, /^[0-9a-f]{64}$/);
  assert.match(rec.video.hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(rec.source.hash, JSON.parse(fs.readFileSync(path.join(dir, 'out/sync.mov.render.json'), 'utf8')).source.hash, 'source copied from the overlay');
  const r = runCheck(dir, ['--file', 'out/sync-final.mp4']);
  const bad = r.results.filter((x) => x.level === 'FAIL' || x.level === 'WARN');
  assert.deepEqual(bad, [], r.out);
  const prov = r.results.filter((x) => x.id === 'provenance');
  assert.equal(prov.length, 2);
  assert.match(prov[1].detail, /overlay out\/sync\.mov\.render\.json \(caption\.js, alpha prores\) is bound/);
  assert.match(one(r.results, 'text_safe').detail, /tiktok scaled x0\.5 to 540x960/);
  assert.match(r.out, /decoded 90 frames of out\/sync-final\.mp4 with ffmpeg/);
  assert.match(r.out, /check: scene caption\.js, 540x960 @ 30 fps, 3 s, sub 2, alpha prores/, 'the overlay\'s settings replayed, alpha included');
  assert.equal(one(r.results, 'first_frame_empty').level, 'OK', 'the composite\'s first frame, not the overlay\'s clear one');
  assert.equal(one(r.results, 'file_spec').level, 'OK');
  assert.equal(one(r.results, 'vo_delay').level, 'OK');
});

test('a stale overlay FAILs check --file: re-rendered after the composite, or rendered from a source that changed since', () => {
  const bak = path.join(dir, 'out', 'keep');
  fs.mkdirSync(bak, { recursive: true });
  for (const f of ['sync.mov', 'sync.mov.render.json']) fs.copyFileSync(path.join(dir, 'out', f), path.join(bak, f));
  // another overlay rendered under the composite's name after it was made
  render(dir, ['video', '--scene', 'caption.js', '--alpha', '--sub', '2', '--param', 'style=karaoke', '--out', 'out/sync.mov']);
  let r = runCheck(dir, ['--file', 'out/sync-final.mp4']);
  assert.equal(r.status, 1);
  const p = r.results.filter((x) => x.id === 'provenance');
  assert.deepEqual(p.map((x) => x.level), ['OK', 'FAIL'], 'the master and the composite still bind; the overlay does not');
  assert.match(p[1].detail, /changed after the composite/);
  assert.equal(one(r.results, 'text_safe').level, 'SKIP', 'the source checks do not stand for this file');
  for (const f of ['sync.mov', 'sync.mov.render.json']) fs.copyFileSync(path.join(bak, f), path.join(dir, 'out', f));
  assert.equal(runCheck(dir, ['--file', 'out/sync-final.mp4']).status, 0, 'the composite\'s own overlay restored');
  // the source changes after the render: the overlay (and the composite, which carries its source) is stale
  const b = path.join(dir, 'board.js'), src = fs.readFileSync(b, 'utf8');
  fs.writeFileSync(b, src.replace('"Captions: src.mp4"', '"Captions, retitled"'));
  try {
    r = runCheck(dir, ['--file', 'out/sync-final.mp4']);
    assert.equal(r.status, 1);
    assert.ok(r.results.filter((x) => x.id === 'provenance').every((x) => x.level === 'FAIL'), r.out);
    assert.match(r.out, /the overlay is stale/);
    const c = tool(dir, ['composite', 'sync']);
    assert.equal(c.status, 1);
    assert.match(c.out, /the overlay is stale, render it again/);
  } finally { fs.writeFileSync(b, src); }
});

test('composite refuses an overlay off the clip\'s clock or size, and a vo.wav that is not the clip\'s sound', () => {
  render(dir, ['video', '--scene', 'caption.js', '--alpha', '--sub', '1', '--scale', '0.5', '--to', '1', '--out', 'out/half.mov']);
  const r = tool(dir, ['composite', 'half']);
  assert.equal(r.status, 1);
  assert.match(r.out, /the overlay has 30 frames, the clip 90/);
  assert.match(r.out, /the overlay is 270x480, the clip 540x960: render it at scale 1/);
  const vo = path.join(dir, 'vo.wav'), keep = fs.readFileSync(vo);
  try {
    fs.writeFileSync(vo, keep.subarray(0, keep.length - 4000));
    // vo.wav is part of the source, so the overlay is stale too; the composite names both
    const r2 = tool(dir, ['composite', 'sync']);
    assert.equal(r2.status, 1);
    assert.match(r2.out, /stale/);
  } finally { fs.writeFileSync(vo, keep); }
  assert.equal(tool(dir, ['composite', 'sync']).status, 0, 'composited again once restored');
});

test('a variable frame rate clip is converted to the nearest standard constant rate, and prepare says so', async () => {
  const d = piece('clip-vfr');
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x568:r=30:d=1', '-f', 'lavfi', '-i', 'testsrc2=s=320x568:r=20:d=1', '-f', 'lavfi', '-i', 'sine=f=440:d=2:sample_rate=48000',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-fps_mode', 'vfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(d, 'vfr.mp4')]);
  const pr = ok(tool(d, ['probe', 'vfr.mp4']));
  assert.match(pr.out, /variable frame rate \(average 25\.\d+ fps\)/);
  assert.match(pr.out, /prepare converts it to a constant 25 fps first/);
  fs.writeFileSync(path.join(d, 't.srt'), '1\n00:00:00,200 --> 00:00:01,600\nhello there clip\n');
  const r = ok(tool(d, ['prepare', 'vfr.mp4', '--transcript', 't.srt', '--board']));
  assert.match(r.out, /variable frame rate: converting to a constant 25 fps/);
  assert.match(r.out, /note: the clip had a variable frame rate and was converted to 25 fps constant \(clip\.mp4\)/);
  assert.match(r.out, /3 words, 3 of them spread over their phrase by length/);
  const clip = (await import(path.join(d, 'clip.js') + '?v')).CLIP;
  assert.equal(clip.fpsRational, '25/1');
  assert.equal(clip.from.vfr, true);
  assert.equal(clip.from.convertedTo, '25/1');
  assert.equal(clip.frames, 50);
  const again = ok(tool(d, ['probe', 'clip.mp4']));
  assert.match(again.out, /25 fps constant \(25\/1\), 50 frames, 2\.000 s/);
  // refusals: no transcript, a clip with no sound
  assert.match(tool(d, ['prepare', 'vfr.mp4']).out, /needs --transcript/);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(d, 'mute.mp4')]);
  assert.match(tool(d, ['prepare', 'mute.mp4', '--transcript', 't.srt', '--board']).out, /has no sound/);
});

test('a clip of another shape than its target: text_safe is not checked, and says why; doctor reports whisper-cli as optional', () => {
  const d = piece('clip-shape');
  syncClip(path.join(d, 'src.mp4'), { w: 640, h: 480, dur: 1 });
  fs.writeFileSync(path.join(d, 't.srt'), '1\n00:00:00,100 --> 00:00:00,800\nwide clip\n');
  ok(tool(d, ['prepare', 'src.mp4', '--transcript', 't.srt', '--board', '--target', 'tiktok']));
  const r = runCheck(d, ['--scene', 'caption.js', '--alpha', '--only', 'text_safe,text_overlap']);
  assert.equal(one(r.results, 'text_safe').level, 'SKIP', r.out);
  assert.match(one(r.results, 'text_safe').detail, /target tiktok is 1080x1920, but the piece is 640x480/);
  assert.equal(one(r.results, 'text_overlap').level, 'OK');
  // a clip piece's scene is caption.js: the template's title card (scene.js) reads beats a clip's board does not have
  const doc = spawnSync(process.execPath, ['render.mjs', 'doctor', '--scene', 'caption.js'], { cwd: d, encoding: 'utf8', timeout: 300000 });
  assert.match(doc.stdout, /^ok\s+whisper-cli: (found|not installed) \(optional/m);
  assert.match(doc.stdout, /^ok\s+probe frame: caption\.js/m, doc.stdout);
});
