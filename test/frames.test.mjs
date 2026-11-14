// Frame count and container (plan section 16): `video` writes exactly round(DUR x FPS) frames, the
// extension follows the codec, and render.json is written with the source and decoded-video hashes.
// Also --target, which supplies size and fps when the scene's CFG leaves them out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makePiece, render, ffprobe, videoStream, audioStream, countFrames, decodedVideoHash, sha256File } from './helpers.mjs';

const dir = makePiece('frames');
const P = (f) => path.join(dir, f);
const readJson = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'));

test('video writes round(DUR x FPS) frames at the scaled size, H.264 in .mp4', () => {
  render(dir, ['video', '--scale', '0.25', '--out', 'out/fc']);
  const file = P('out/fc.mp4');
  assert.ok(fs.existsSync(file), 'out/fc.mp4 not written');
  const v = videoStream(ffprobe(file));
  assert.equal(v.codec_name, 'h264');
  assert.equal(v.pix_fmt, 'yuv420p');
  assert.equal(v.width, 270);
  assert.equal(v.height, 480);
  assert.equal(v.r_frame_rate, '30/1');
  assert.equal(countFrames(file), Math.round(2.0 * 30));
});

test('render.json sits beside the video with the scene, settings, source hash and decoded-video hash', () => {
  const r = readJson('out/fc.mp4.render.json');
  assert.equal(r.file, 'out/fc.mp4');
  assert.equal(r.scene, 'scene.js');
  assert.equal(r.mode, 'video');
  assert.deepEqual(r.size, [1080, 1920]);
  assert.deepEqual(r.render, [270, 480]);
  assert.equal(r.fps, 30);
  assert.equal(r.dur, 2);
  assert.equal(r.frames, 60);
  assert.equal(r.sub, 8);
  assert.equal(r.alpha, null);
  assert.equal(r.silent, false);
  assert.match(r.source.hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(r.source.files >= 10);
  assert.equal(r.video.hash, decodedVideoHash(P('out/fc.mp4')));
  assert.equal(r.sha256, sha256File(P('out/fc.mp4')));
});

test('full muxes video and audio, frame count unchanged, and writes render.json', () => {
  render(dir, ['full', '--scale', '0.25', '--out', 'out/full.mp4']);
  const file = P('out/full.mp4');
  const pr = ffprobe(file);
  assert.equal(audioStream(pr).codec_name, 'aac');
  assert.equal(+audioStream(pr).sample_rate, 48000);
  assert.ok(Math.abs(+pr.format.duration - 2.0) <= 1 / 30 + 1e-3, `duration ${pr.format.duration}`);
  assert.equal(countFrames(file), 60);
  assert.ok(fs.existsSync(P('out/full.wav')), 'the soundtrack WAV is kept beside the master');
  assert.ok(!fs.existsSync(P('out/full.video.mp4')), 'the temporary video was not removed');
  const r = readJson('out/full.mp4.render.json');
  assert.equal(r.mode, 'full');
  assert.equal(r.frames, 60);
  assert.equal(r.audio, 'out/full.wav');
  assert.equal(r.video.hash, decodedVideoHash(file));
});

test('the extension follows the codec: a mismatched --out extension is replaced, with a note', () => {
  const r = render(dir, ['video', '--scale', '0.25', '--to', '0.2', '--out', 'out/ext.webm']);
  assert.match(r.stdout, /note: \.webm doesn't fit this codec; writing \.mp4 instead/);
  assert.ok(fs.existsSync(P('out/ext.mp4')));
  assert.ok(!fs.existsSync(P('out/ext.webm')));
  assert.equal(countFrames(P('out/ext.mp4')), 6);
  assert.equal(readJson('out/ext.mp4.render.json').frames, 6);
});

test('an .mp4 and an alpha .mov of the same name keep separate records, each bound to its own file', () => {
  render(dir, ['video', '--scale', '0.25', '--to', '0.2', '--out', 'out/pair']);
  render(dir, ['video', '--alpha', 'prores', '--scale', '0.25', '--to', '0.2', '--out', 'out/pair']);
  for (const ext of ['mp4', 'mov']) {
    const r = readJson(`out/pair.${ext}.render.json`);
    assert.equal(r.file, `out/pair.${ext}`);
    assert.equal(r.sha256, sha256File(P(`out/pair.${ext}`)), `the .${ext} record does not describe out/pair.${ext}`);
  }
});

test('a failed re-render removes the old record instead of leaving it beside the output', () => {
  render(dir, ['video', '--scale', '0.25', '--to', '0.1', '--out', 'out/redo']);
  assert.ok(fs.existsSync(P('out/redo.mp4.render.json')));
  const r = render(dir, ['video', '--scale', '0.25', '--to', '0.1', '--out', 'out/redo', '--crf', 'not-a-number'], { allowFail: true });
  assert.notEqual(r.status, 0, 'the broken encode did not fail');
  assert.ok(!fs.existsSync(P('out/redo.mp4.render.json')), 'a stale record survived a failed render');
});

test('a failed full re-render removes the old record too', () => {
  render(dir, ['full', '--scale', '0.25', '--out', 'out/redofull']);
  assert.ok(fs.existsSync(P('out/redofull.mp4.render.json')));
  const r = render(dir, ['full', '--scale', '0.25', '--out', 'out/redofull', '--crf', 'not-a-number'], { allowFail: true });
  assert.notEqual(r.status, 0, 'the broken encode did not fail');
  assert.ok(!fs.existsSync(P('out/redofull.mp4.render.json')), 'a stale record survived a failed full render');
});

test('the source hash ignores outputs and review sheets, and changes when the source does', () => {
  const short = (name) => { render(dir, ['video', '--scale', '0.25', '--to', '0.1', '--out', `out/${name}`]); return readJson(`out/${name}.mp4.render.json`).source.hash; };
  const h1 = short('s1');
  fs.mkdirSync(P('stills'), { recursive: true });
  fs.writeFileSync(P('stills/x.png'), 'not a source file');
  fs.writeFileSync(P('contact.png'), 'not a source file');
  fs.writeFileSync(P('out/junk.txt'), 'not a source file');
  const h2 = short('s2');
  assert.equal(h2, h1, 'outputs changed the source hash');
  fs.appendFileSync(P('scene.js'), '\n// edited\n');
  const h3 = short('s3');
  assert.notEqual(h3, h1, 'editing scene.js did not change the source hash');
});

test('--target supplies size and fps when CFG leaves them out', () => {
  render(dir, ['video', '--scene', 'alt.js', '--target', 'youtube', '--scale', '0.25', '--out', 'out/yt']);
  const v = videoStream(ffprobe(P('out/yt.mp4')));
  assert.equal(v.width, 480);
  assert.equal(v.height, 270);
  assert.equal(v.r_frame_rate, '30/1');
  assert.equal(countFrames(P('out/yt.mp4')), 30);
  const r = readJson('out/yt.mp4.render.json');
  assert.equal(r.target, 'youtube');
  assert.deepEqual(r.size, [1920, 1080]);
});

test('--target errors: a scene with no size and no target, and an unknown target name', () => {
  const a = render(dir, ['stills', '0.5', '--scene', 'alt.js', '--scale', '0.25'], { allowFail: true });
  assert.notEqual(a.status, 0);
  assert.match(a.out, /no canvas size/);
  const b = render(dir, ['video', '--target', 'nope', '--scale', '0.25'], { allowFail: true });
  assert.equal(b.status, 2);
  assert.match(b.out, /unknown target/);
});
