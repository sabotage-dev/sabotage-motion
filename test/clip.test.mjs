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

// In a master on the clip's clock: the white frame, the tone's onset and the first frame (from frame 42) a caption shows
// where the clip's own picture has none. Returns { white, onset (frames), first }.
function syncOf(master, clip, { band = [520, 720], quietAt = 43 } = {}) {
  // the white frame: the one frame whose mean luma is near white
  const small = gray(master, 54, 96), mean = (f) => f.reduce((s, v) => s + v, 0) / f.length;
  const white = small.map((f, i) => [i, mean(f)]).filter(([, m]) => m > 200).map(([i]) => i);
  // the tone: the first sample after 1 s louder than half the tone's peak
  const s = monoSamples(master), sr = 48000;
  let peak = 0;
  for (let i = sr; i < 2 * sr; i++) peak = Math.max(peak, Math.abs(s[i]));
  let onset = -1;
  for (let i = sr; i < 2 * sr; i++) if (Math.abs(s[i]) > 0.5 * peak) { onset = i / sr; break; }
  // the caption: frames where the master's caption band differs from the clip's own picture
  const m = gray(master, W, H), c = gray(clip, W, H);
  assert.equal(m.length, c.length);
  const inked = (i) => { let n = 0; for (let y = band[0]; y < band[1]; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (Math.abs(m[i][k] - c[i][k]) > 60) n++; } return n; };
  let first = -1;
  for (let i = 42; i < 60; i++) if (inked(i) > 300) { first = i; break; }
  return { white, onset: onset * FPS, first, inked };
}
test('sync: in the master, the tone\'s onset, the white frame and the caption\'s first visible frame are each within one frame of frame 45', () => {
  const r = syncOf(path.join(dir, 'out/sync-final.mp4'), path.join(dir, 'clip.mp4'));
  assert.deepEqual(r.white, [FLASH], 'the flash is still on its frame');
  assert.ok(Math.abs(r.onset - FLASH) <= 1, `the tone starts on frame ${r.onset.toFixed(2)}`);
  assert.ok(r.inked(20) > 300, 'the first caption ("Ready, set...") shows at 0.67 s');
  assert.ok(r.inked(43) < 50, `no caption between the phrases (frame 43: ${r.inked(43)} pixels)`);
  assert.ok(Math.abs(r.first - FLASH) <= 1, `"Now" first shows on frame ${r.first}`);
});

test('P10 R1 B1 one clock: a clip whose sound starts 0.5 s after its picture, transcribed from its raw track and moved with --raw-track: tone, flash and highlight within one frame', () => {
  const d = piece('clip-offset');
  const at = FLASH / FPS;
  ff(['-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=${FPS}:d=3`, '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,${FLASH})'`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(d, 'v.mp4')]);
  // the sound's own clock: the tone at 1.0 s; muxed to start 0.5 s into the picture, so it plays at 1.5 s, frame 45
  ff(['-f', 'lavfi', '-i', `aevalsrc='if(gte(t,${at - 0.5})*lt(t,${at - 0.3}),0.5*sin(2*PI*1000*t),0.02*sin(2*PI*220*t))':s=48000:d=2.5`, path.join(d, 'a.wav')]);
  ff(['-i', path.join(d, 'v.mp4'), '-itsoffset', '0.5', '-i', path.join(d, 'a.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', path.join(d, 'src.mp4')]);
  // a transcript of the raw audio track: "Now" with the tone, at 1.0 s of the sound's own clock
  fs.writeFileSync(path.join(d, 'raw.json'), JSON.stringify({ words: [{ text: 'Now', start: 1.0, end: 1.4 }, { text: 'go.', start: 1.7, end: 2.0 }] }));
  const pr = ok(tool(d, ['probe', 'src.mp4']));
  assert.match(pr.out, /starting 0\.4\d+ s after the picture/);
  const p = ok(tool(d, ['prepare', 'src.mp4', '--board']));
  assert.match(p.out, /note: the clip's sound starts 0\.4\d+ s after its first frame\. vo\.wav \(and the mix\) is aligned to the picture/);
  assert.match(p.out, /must be moved \+0\.4\d+ s: --raw-track/);
  assert.match(p.out, /wrote clip\.mp4, clip\.js, vo\.wav, out\/vo16k\.wav, board\.js/);
  assert.ok(!fs.existsSync(path.join(d, 'cues.js')), 'no transcript yet, so no cues');
  // vo.wav and its 16 kHz copy for whisper-cli are on the picture's clock: the tone at 1.5 s
  for (const [f, sr] of [['vo.wav', 48000], ['out/vo16k.wav', 16000]]) {
    const b = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(d, f), '-ac', '1', '-f', 'f32le', '-']), x = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
    const i = x.findIndex((v) => Math.abs(v) > 0.25);
    assert.ok(Math.abs((i / sr) * FPS - FLASH) <= 1, `${f}: the tone at ${(i / sr).toFixed(4)} s`);
  }
  const c = ok(tool(d, ['cues', '--transcript', 'raw.json', '--raw-track']));
  assert.match(c.out, /moved \+0\.4\d+ s onto the clip's clock \(--raw-track/);
  const cues = JSON.parse(fs.readFileSync(path.join(d, 'cues.json'), 'utf8'));
  assert.ok(Math.abs(cues.WORDS[0].start - 1.5) < 0.03, `"Now" at ${cues.WORDS[0].start} s on the clip's clock`);
  assert.match(tool(d, ['cues', '--transcript', 'raw.json', '--raw-track', '--transcript-offset', '1']).out, /give one/);
  render(d, ['video', '--scene', 'caption.js', '--alpha', '--sub', '2', '--out', 'out/off.mov']);
  ok(tool(d, ['composite', 'off']));
  mix(d, ['off', '--no-sfx']);
  const r = syncOf(path.join(d, 'out/off-final.mp4'), path.join(d, 'clip.mp4'));
  assert.deepEqual(r.white, [FLASH], 'the flash on its frame');
  assert.ok(Math.abs(r.onset - FLASH) <= 1, `the tone starts on frame ${r.onset.toFixed(2)}`);
  assert.ok(r.inked(40) < 50, 'nothing captioned before "Now"');
  assert.ok(Math.abs(r.first - FLASH) <= 1, `"Now" first shows on frame ${r.first}`);
  assert.equal(runCheck(d, ['--file', 'out/off-final.mp4']).status, 0);
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

test('composite refuses an overlay off the clip\'s clock or size', () => {
  render(dir, ['video', '--scene', 'caption.js', '--alpha', '--sub', '1', '--scale', '0.5', '--to', '1', '--out', 'out/half.mov']);
  const r = tool(dir, ['composite', 'half']);
  assert.equal(r.status, 1);
  assert.match(r.out, /the overlay has 30 frames, the clip 90/);
  assert.match(r.out, /the overlay is 270x480, the clip 540x960: render it at scale 1/);
});

test('P10 R1 B1 a clip whose sound starts 0.3 s before its picture: vo.wav is cut to the first frame, the tone on its frame', () => {
  const d = piece('clip-early');
  ff(['-f', 'lavfi', '-i', `testsrc2=s=320x568:r=${FPS}:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(d, 'v.mp4')]);
  // the sound's own clock: the tone at 1.3 s; the picture muxed to start 0.3 s after the sound, so the tone plays at 1.0 s
  ff(['-f', 'lavfi', '-i', "aevalsrc='if(gte(t,1.3)*lt(t,1.5),0.5*sin(2*PI*1000*t),0.02*sin(2*PI*220*t))':s=48000:d=2.3", path.join(d, 'a.wav')]);
  ff(['-itsoffset', '0.3', '-i', path.join(d, 'v.mp4'), '-i', path.join(d, 'a.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', path.join(d, 'src.mp4')]);
  const p = ok(tool(d, ['prepare', 'src.mp4', '--board']));
  assert.match(p.out, /starts 0\.\d+ s before its first frame/);
  const vo = monoSamples(path.join(d, 'vo.wav')), i = vo.findIndex((v) => Math.abs(v) > 0.25);
  assert.ok(Math.abs((i / 48000) * FPS - 30) <= 1, `the tone at ${(i / 48000).toFixed(4)} s in vo.wav, frame 30 of the picture`);  // P10 R2 D2: a transcript of the raw track, with words in the 0.3 s lead the picture does not show: the one that ends in
  // it is dropped, the one that straddles the first frame starts at 0, the tone's word lands on frame 30; nothing refused
  fs.writeFileSync(path.join(d, 'raw.json'), JSON.stringify({ words: [{ text: 'so', start: 0.05, end: 0.2 }, { text: 'right', start: 0.2, end: 0.6 }, { text: 'now.', start: 1.3, end: 1.6 }] }));
  const c = ok(tool(d, ['cues', '--transcript', 'raw.json', '--raw-track']));
  assert.match(c.out, /before the first frame \(sound the picture does not show\): 1 word dropped, 1 clipped to start at 0/);
  const W = JSON.parse(fs.readFileSync(path.join(d, 'cues.json'), 'utf8')).WORDS;
  assert.deepEqual(W.map((w) => w.text), ['right', 'now.']);
  assert.equal(W[0].start, 0);
  assert.ok(Math.abs(W[1].start * FPS - 30) <= 1, `"now." at ${W[1].start} s`);
});

test('P10 R2 D1 prepare run again on the prepared clip with another --audio: --raw-track moves by the new track\'s offset', async () => {
  const d = piece('clip-retrack');
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x568:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(d, 'v.mp4')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=220:d=3:sample_rate=48000', path.join(d, 'a0.wav')]);
  ff(['-f', 'lavfi', '-i', 'sine=f=440:d=2.5:sample_rate=48000', path.join(d, 'a1.wav')]);
  // track 0 starts with the picture, track 1 0.5 s after it
  ff(['-i', path.join(d, 'v.mp4'), '-i', path.join(d, 'a0.wav'), '-itsoffset', '0.5', '-i', path.join(d, 'a1.wav'), '-map', '0:v', '-map', '1:a', '-map', '2:a',
    '-c:v', 'copy', '-c:a', 'aac', path.join(d, 'original.mp4')]);
  ok(tool(d, ['prepare', 'original.mp4', '--audio', '0', '--board']));
  const p = ok(tool(d, ['prepare', 'clip.mp4', '--audio', '1', '--board']));
  assert.match(p.out, /starts 0\.4\d+ s after its first frame/);
  const clip = (await import(path.join(d, 'clip.js') + '?d1')).CLIP;
  assert.equal(clip.from.file, 'original.mp4', 'where the clip came from is kept');
  assert.equal(clip.from.audio, 1);
  assert.ok(Math.abs(clip.from.audioOffset - 0.48) < 0.03, `the offset is track 1's (${clip.from.audioOffset})`);
  fs.writeFileSync(path.join(d, 'track1.json'), JSON.stringify({ words: [{ text: 'hello', start: 1.0, end: 1.4 }] }));
  const c = ok(tool(d, ['cues', '--transcript', 'track1.json', '--raw-track']));
  assert.match(c.out, /moved \+0\.4\d+ s/);
  const W = JSON.parse(fs.readFileSync(path.join(d, 'cues.json'), 'utf8')).WORDS;
  assert.ok(Math.abs(W[0].start - 1.48) < 0.03, `"hello" at ${W[0].start} s on the clip's clock`);
});

test('P10 R2 D3 a clip with an odd size (321x569) is cropped by one pixel to an even size, says so, and composites', async () => {
  const d = piece('clip-odd');
  // (testsrc2 rounds its size to even; a colour source keeps 321x569, with a moving box on it)
  ff(['-f', 'lavfi', '-i', "color=c=gray:s=321x569:r=30:d=1,drawbox=x='mod(t*270,280)':y=200:w=30:h=30:color=white:t=fill", '-f', 'lavfi', '-i', 'sine=f=440:d=1:sample_rate=48000', '-c:v', 'libx264', '-pix_fmt', 'yuv444p',
    '-c:a', 'aac', '-shortest', path.join(d, 'odd.mp4')]);
  assert.match(ok(tool(d, ['probe', 'odd.mp4'])).out, /prepare crops it by one pixel to an even size first \(320x568\)/);
  fs.writeFileSync(path.join(d, 't.srt'), '1\n00:00:00,100 --> 00:00:00,800\nodd clip\n');
  const p = ok(tool(d, ['prepare', 'odd.mp4', '--transcript', 't.srt', '--board']));
  assert.match(p.out, /odd size 321x569: cropping one pixel off the right edge and one pixel off the bottom edge to 320x568/);
  assert.match(p.out, /note: the clip was 321x569, an odd size; clip\.mp4 is 320x568, cropped by one pixel/);
  const v = videoStream(ffprobe(path.join(d, 'clip.mp4')));
  assert.deepEqual([v.width, v.height, v.pix_fmt], [320, 568, 'yuv420p']);
  const clip = (await import(path.join(d, 'clip.js') + '?d3')).CLIP;
  assert.deepEqual([clip.w, clip.h, clip.frames, clip.from.croppedTo], [320, 568, 30, [320, 568]]);
  render(d, ['video', '--scene', 'caption.js', '--alpha', '--sub', '1', '--out', 'out/odd.mov']);
  ok(tool(d, ['composite', 'odd']));
  assert.equal(countFrames(path.join(d, 'out/odd.mp4')), 30);
});

test('P10 R1 B4 composite refuses a vo.wav that is not the clip\'s sound, with a current overlay (so the comparison itself is reached)', () => {
  const vo = path.join(dir, 'vo.wav'), keep = fs.readFileSync(vo), mov = path.join(dir, 'out/sync.mov'), rec = mov + '.render.json';
  const keepMov = fs.readFileSync(mov), keepRec = fs.readFileSync(rec);
  try {
    // another sound under the same name: the clip's sound with its last 1000 samples silenced
    const b = Buffer.from(keep);
    b.fill(0, b.length - 4000);
    fs.writeFileSync(vo, b);
    // the overlay rendered again from this source, so it is current and only vo.wav is wrong
    render(dir, ['video', '--scene', 'caption.js', '--alpha', '--sub', '1', '--out', 'out/sync.mov']);
    const r = tool(dir, ['composite', 'sync']);
    assert.equal(r.status, 1);
    assert.match(r.out, /vo\.wav is not the clip's sound: run prepare again/);
    assert.doesNotMatch(r.out, /stale/);
  } finally { fs.writeFileSync(vo, keep); fs.writeFileSync(mov, keepMov); fs.writeFileSync(rec, keepRec); }
  assert.equal(tool(dir, ['composite', 'sync']).status, 0, 'composited again once restored');
});

test('P10 R1 B2 a clip with two audio tracks: probe lists both, prepare --audio picks one and says so, vo.wav is that track', async () => {
  const d = piece('clip-tracks');
  // track 0: a quiet hum; track 1: a loud tone from 1.0 s
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x568:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=220:d=2:sample_rate=48000', '-f', 'lavfi', '-i', "aevalsrc='if(gte(t,1),0.5*sin(2*PI*1000*t),0)':s=48000:d=2",
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-filter:a:0', 'volume=0.05', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=fra',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(d, 'two.mp4')]);
  const pr = ok(tool(d, ['probe', 'two.mp4']));
  assert.match(pr.out, /2 audio streams \(prepare --audio <n> picks one; 0 by default\)/);
  assert.match(pr.out, /audio 0: aac 48000 Hz, 1 channel, eng/);
  assert.match(pr.out, /audio 1: aac 48000 Hz, 1 channel, fra/);
  assert.match(tool(d, ['prepare', 'two.mp4', '--audio', '2', '--board']).out, /--audio 2 is not one of them/);
  const p = ok(tool(d, ['prepare', 'two.mp4', '--audio', '1', '--board']));
  assert.match(p.out, /sound: audio stream 1 of 2 \(--audio 1\)/);
  const clip = (await import(path.join(d, 'clip.js') + '?b2')).CLIP;
  assert.equal(clip.audio.index, 1);
  assert.equal(clip.from.audio, 1);
  const vo = monoSamples(path.join(d, 'vo.wav'));
  const peak = (a, b) => { let m = 0; for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) m = Math.max(m, Math.abs(vo[i])); return m; };
  assert.ok(peak(1.1, 1.9) > 0.3, 'vo.wav is track 1 (the tone)');
  assert.ok(peak(0.1, 0.9) < 0.01, 'and not track 0 (the hum)');
});

test('P10 R1 B3 a clip with non-square pixels (720x576, 64:45) is converted to square pixels at its display size, and prepare says so', async () => {
  const d = piece('clip-sar');
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=720x576:r=25:d=1', '-f', 'lavfi', '-i', 'sine=f=440:d=1:sample_rate=48000', '-vf', 'setsar=64/45',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(d, 'pal.mp4')]);
  const pr = ok(tool(d, ['probe', 'pal.mp4']));
  assert.match(pr.out, /1024x576 \(stored 720x576, pixels 64:45, not square\)/);
  assert.match(pr.out, /prepare converts it to square pixels at its display size first \(1024x576\)/);
  const p = ok(tool(d, ['prepare', 'pal.mp4', '--board']));
  assert.match(p.out, /non-square pixels \(64:45\): converting to square pixels at the display size, 1024x576/);
  assert.match(p.out, /note: the clip's pixels were not square \(64:45\); clip\.mp4 is 1024x576 with square pixels/);
  const v = videoStream(ffprobe(path.join(d, 'clip.mp4')));
  assert.deepEqual([v.width, v.height], [1024, 576]);
  assert.ok(!v.sample_aspect_ratio || v.sample_aspect_ratio === '1:1', `square pixels (${v.sample_aspect_ratio})`);
  const clip = (await import(path.join(d, 'clip.js') + '?b3')).CLIP;
  assert.deepEqual([clip.w, clip.h, clip.frames, clip.from.sar], [1024, 576, 25, '64:45']);
  assert.match(fs.readFileSync(path.join(d, 'board.js'), 'utf8'), /target: "youtube"/, '16:9 as displayed');
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
  assert.match(again.out, /25 fps constant \(25\/1\), 50 frames, 2\.0\d\d s/);   // the container's length: 2.005 s on Linux's ffmpeg (AAC padding)
  // refusals: a bad --audio, a clip with no sound
  assert.match(tool(d, ['prepare', 'vfr.mp4', '--audio', 'x']).out, /--audio x: an audio stream's number/);
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
