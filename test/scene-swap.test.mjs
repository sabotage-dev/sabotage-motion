// Scene swap (plan section 16): a `--scene slate.js` render of a piece whose real scene has a
// different TL and duration renders the slate's length with silent effects, and never evaluates
// the real scene's cues. A non-silent alternate scene gets its own TL in audio.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makePiece, render, ffprobe, countFrames, readWav, peakIn, templateDir } from './helpers.mjs';

const dir = makePiece('scene-swap');
const P = (f) => path.join(dir, f);

test('control: the real scene evaluates scene.js and audio.js, and its cues land in the WAV', () => {
  const r = render(dir, ['audio']);
  assert.match(r.stdout, /fixture: scene\.js evaluated/);
  assert.match(r.stdout, /fixture: cues \[0\.5,1\.2\]/);
  const w = readWav(P('out/scene.wav'));
  assert.ok(Math.abs(w.dur - 2.0) < 1e-3, `duration ${w.dur}`);
  assert.ok(peakIn(w, 0.5, 0.6) > 0.1 && peakIn(w, 1.2, 1.3) > 0.1, 'cue ticks missing');
});

test('--scene slate.js renders the slate\'s length, silent, without loading scene.js or audio.js', () => {
  const r = render(dir, ['full', '--scene', 'slate.js', '--scale', '0.25']);
  for (const s of ['fixture: scene.js evaluated', 'fixture: audio.js evaluated', 'fixture: renderAudio called']) {
    assert.ok(!r.stdout.includes(s), `the slate render printed "${s}"`);
  }
  assert.match(r.stdout, /exports silent = true/);
  const file = P('out/slate.mp4');
  assert.equal(countFrames(file), 90, 'slate.js is 3 s at 30 fps');
  assert.ok(Math.abs(+ffprobe(file).format.duration - 3.0) <= 1 / 30 + 1e-3);
  const w = readWav(P('out/slate.wav'));
  assert.ok(Math.abs(w.dur - 3.0) < 1e-3, `soundtrack ${w.dur} s`);
  assert.equal(peakIn(w, 0, w.dur), 0, 'the slate soundtrack is not silent');
  const rec = JSON.parse(fs.readFileSync(P('out/slate.mp4.render.json'), 'utf8'));
  assert.equal(rec.scene, 'slate.js');
  assert.equal(rec.silent, true);
  assert.equal(rec.frames, 90);
});

test('a scene may set CFG.DUR in init: the slate with --param dur=1.5 is 45 frames', () => {
  render(dir, ['video', '--scene', 'slate.js', '--param', 'dur=1.5', '--scale', '0.25', '--out', 'out/slate15']);
  assert.equal(countFrames(P('out/slate15.mp4')), 45);
});

test('a non-silent alternate scene passes its own TL and length to audio.js', () => {
  const r = render(dir, ['audio', '--scene', 'alt.js', '--target', 'tiktok']);
  assert.ok(!r.stdout.includes('fixture: scene.js evaluated'), 'alt render evaluated scene.js');
  assert.match(r.stdout, /fixture: cues \[0\.25\]/);
  const w = readWav(P('out/alt.wav'));
  assert.ok(Math.abs(w.dur - 1.0) < 1e-3, `duration ${w.dur}`);
  assert.ok(peakIn(w, 0.25, 0.35) > 0.1, 'alt cue at 0.25 s missing');
  assert.ok(peakIn(w, 0.45, 0.75) < 0.001, 'a cue from the real scene (0.5 s) is in the alt soundtrack');
});

// makePiece copies the fixture's audio.js over the template's, so the renders above never run the
// shipped audio.js. This pins the shipped file itself: it must take TL and CFG from renderAudio's
// arguments and never import the scene (a static import would evaluate scene.js on a slate render).
test('the template\'s own audio.js does not import scene.js', () => {
  const code = fs.readFileSync(path.join(templateDir, 'audio.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bimport\b[^;]*['"]\.\/scene\.js['"]/.test(code), 'audio.js imports ./scene.js');
  assert.ok(!/import\s*\(\s*['"]\.\/scene\.js['"]\s*\)/.test(code), 'audio.js imports ./scene.js dynamically');
  assert.match(code, /export\s+async\s+function\s+renderAudio\s*\(\s*\{\s*TL\s*,\s*CFG/);
});
