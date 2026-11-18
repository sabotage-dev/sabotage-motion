// The caption-clip example (plan 23.5): its committed clip is the one clip.js describes, small, with no person in it
// (a scene of its own, screen.js) and the explainer-beat voice as its sound; its transcript is that take's words 0.5 s
// later; its cues and board are what tools/clip.mjs prepare makes from them. Then the whole recipe, in a copy of the
// example: prepare, the caption overlay, composite, mix, and check --file on the master with 0 FAIL and 0 WARN.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { examplesDir, repoRoot, sha256File, countFrames, render } from './helpers.mjs';
import { runCheck } from './check-helpers.mjs';

const dir = path.join(examplesDir, 'caption-clip');
const work = path.join(repoRoot, 'test', '.work', 'caption-clip');
after(() => fs.rmSync(work, { recursive: true, force: true }));
const node = (cwd, args) => { const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

test('caption-clip: clip.mp4 is the clip clip.js describes, small, 540x960 at 30 fps, with sound; the transcript is the explainer take 0.5 s later', async () => {
  const { CLIP } = await import(pathToFileURL(path.join(dir, 'clip.js')).href);
  assert.equal(sha256File(path.join(dir, 'clip.mp4')), CLIP.sha256);
  assert.deepEqual([CLIP.w, CLIP.h, CLIP.fps, CLIP.frames, CLIP.dur, CLIP.from.vfr], [540, 960, 30, 450, 15, false]);
  assert.ok(CLIP.audio, 'it has sound');
  assert.ok(fs.statSync(path.join(dir, 'clip.mp4')).size < 400 * 1024, 'committed small');
  const take = JSON.parse(fs.readFileSync(path.join(examplesDir, 'explainer-beat', 'take.json'), 'utf8'));
  const tr = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8'));
  assert.deepEqual(tr.words.map((w) => [w.text, w.start]), take.words.map((w) => [w.text, Math.round((w.start + 0.5) * 1e4) / 1e4]));
  // the cues are the transcript's words on the clip's clock, and the one-beat board times them
  const lib = await import(pathToFileURL(path.join(dir, 'lib.js')).href);
  assert.deepEqual(lib.CUES.WORDS.map((w) => w.text), tr.words.map((w) => w.text));
  assert.equal(lib.CUES.VO_OFFSET, 0);
  const t = lib.boardTiming(lib.BOARD, lib.CUES);
  assert.ok(t.ok, t.problems.join('; '));
  assert.deepEqual(t.windows.map((w) => [w.id, w.start, w.end]), [['clip', 0, 15]]);
  // made-up names only: the scene names its app and nothing else
  assert.match(fs.readFileSync(path.join(dir, 'screen.js'), 'utf8'), /made-up/);
});

test('caption-clip: the recipe in a copy (prepare, overlay, composite, mix) gives a master that check --file passes with 0 FAIL and 0 WARN', () => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.cpSync(dir, work, { recursive: true, filter: (s) => !['out', 'stills', 'vo.wav'].includes(path.relative(dir, s).split(path.sep)[0]) });
  const p = node(work, ['tools/clip.mjs', 'prepare', 'clip.mp4', '--transcript', 'transcript.json']);
  assert.equal(p.status, 0, p.out);
  for (const f of ['clip.js', 'cues.js', 'cues.json', 'board.js']) assert.ok(fs.readFileSync(path.join(work, f)).equals(fs.readFileSync(path.join(dir, f))), `prepare leaves the committed ${f} as it is`);
  render(work, ['video', '--scene', 'caption.js', '--alpha', '--sub', '2', '--out', 'out/caption-clip.mov']);
  const c = node(work, ['tools/clip.mjs', 'composite', 'caption-clip']);
  assert.equal(c.status, 0, c.out);
  const m = node(work, ['tools/mix.mjs', 'caption-clip', '--no-sfx']);
  assert.equal(m.status, 0, m.out);
  assert.equal(countFrames(path.join(work, 'out/caption-clip-final.mp4')), 450);
  const r = runCheck(work, ['--file', 'out/caption-clip-final.mp4']);
  const bad = (r.results || []).filter((x) => x.level === 'FAIL' || x.level === 'WARN').map((x) => `${x.level} ${x.id}: ${x.detail}`);
  assert.deepEqual(bad, [], r.out);
  assert.equal(r.status, 0, r.out);
});
