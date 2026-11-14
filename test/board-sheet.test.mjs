// The board in the browser (plan section 16, Board timing): the board sheet renders with slates and with
// a real scene, from the estimate and from cues.js; boardDur() equals CFG.DUR (the rendered frame count
// is round(boardDur x FPS) for the real scene and the slate); the template's own scene and slate take
// their length from its board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { render, countFrames, sha256File, repoRoot, templateDir } from './helpers.mjs';
import { synthAudio, takeFixture, voicePiece, runCues, readCues, lib } from './voice-helpers.mjs';

const wordsFix = takeFixture('words.json');
const audio = synthAudio({ duration: wordsFix.duration, words: wordsFix.words, tags: wordsFix.tags.map((t) => ({ ...t, long: t.end - t.start > 0.2 })) });
const dir = voicePiece('board-sheet', { take: wordsFix, audio });          // fixture-board: cold / hook / mid / save / end
const P = (f) => path.join(dir, f);
const pngSize = (f) => { const b = fs.readFileSync(f); assert.equal(b.toString('ascii', 1, 4), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
// The board.md rows: [id, start, end]
const mdRows = (f) => [...fs.readFileSync(f, 'utf8').matchAll(/^\| \d+ \| (\w+)[^|]* \| ([\d.]+)-([\d.]+) \|/gm)].map((m) => [m[1], +m[2], +m[3]]);
const fixedRows = (t) => t.windows.map((w) => [w.id, +w.start.toFixed(2), +w.end.toFixed(2)]);

test('board sheet with slates, before a take: estimated timing, one panel per beat, board.md beside it', async () => {
  const r = render(dir, ['board', '--slates', '--out', 'est/board.png']);
  assert.match(r.stdout, /scene slate\.js/);
  assert.match(r.stdout, /timing: estimated \(no cues\.js yet\)/);
  const [w, h] = pngSize(P('est/board.png'));
  assert.equal(w, 3 * 360 + 4 * 18, '3 columns of 360 px panels at 9:16');
  assert.ok(h > 2 * 640, `${h} px is too short for two rows of panels`);
  const md = fs.readFileSync(P('est/board.md'), 'utf8');
  assert.match(md, /^# Fixture board$/m);
  assert.match(md, /estimated timing/);
  assert.match(md, /\| 4 \| save \| [\d.-]+ \| \[curious\] Save it as a skill instead\. \[chuckles\] \| SKILL\.md \| a file icon drops in \| a tick per letter \|/, 'the voice line keeps its delivery tags as direction');
  assert.match(md, /\| 1 \| cold \| 0\.00-1\.00 \| \(silent, 1 s\) \| COLD OPEN \| a flat colour card \| silence \(on purpose\) \|/);
  assert.match(md, /\| 2 \| hook \(hook\) .*\| a hit on the first word \(hit\) \|/);
  assert.match(md, /\| 5 \| end \(hold\) \|/);
  const board = (await import(pathToFileURL(path.join(dir, 'board.js')).href)).BOARD;
  assert.deepEqual(mdRows(P('est/board.md')), fixedRows(lib.boardTiming(board)));
});

test('board sheet with the real scene, once cues.js exists: timing from the take, --safe shades the target', async () => {
  const c = runCues(dir);
  assert.equal(c.status, 0, c.out);
  const r = render(dir, ['board', '--safe']);
  assert.match(r.stdout, /scene scene\.js/);
  assert.match(r.stdout, /timing: from cues\.js \(VO_OFFSET 1\.1 s\)/);
  assert.doesNotMatch(r.stdout, /board_order/);
  const md = fs.readFileSync(P('board.md'), 'utf8');
  assert.match(md, /Timing: from cues\.js\. VO_OFFSET 1\.1 s/);
  assert.match(md, /Safe zones: tiktok \(estimate\)/);
  const board = (await import(pathToFileURL(path.join(dir, 'board.js')).href)).BOARD;
  const cues = readCues(dir);
  assert.deepEqual(mdRows(P('board.md')), fixedRows(lib.boardTiming(board, cues)));
  assert.deepEqual(mdRows(P('board.md')), [['cold', 0, 1], ['hook', 1, 3.55], ['mid', 3.55, 5.05], ['save', 5.05, 7.72], ['end', 7.72, 10.22]]);
  // the slates from the same timing look different from the real scene
  render(dir, ['board', '--slates', '--safe', '--out', 'slates.png']);
  assert.deepEqual(pngSize(P('slates.png')), pngSize(P('board.png')));
  assert.notEqual(sha256File(P('slates.png')), sha256File(P('board.png')));
});

test('boardDur() equals CFG.DUR: the real scene and the slate both render round(boardDur x FPS) frames', () => {
  const cues = readCues(dir);
  assert.ok(cues, 'cues.js from the previous test');
  const dur = 1.1 + cues.TAKE.lastWordEnd + 0.4 + 2.5;                      // VO_OFFSET + lastWordEnd + tail + "end"
  assert.ok(Math.abs(dur - 10.22) < 1e-9);
  render(dir, ['video', '--scale', '0.25', '--sub', '1', '--out', 'out/real']);
  assert.equal(countFrames(P('out/real.mp4')), Math.round(10.22 * 30));
  render(dir, ['video', '--scene', 'slate.js', '--scale', '0.25', '--sub', '1', '--out', 'out/animatic']);
  assert.equal(countFrames(P('out/animatic.mp4')), Math.round(10.22 * 30));
  const rec = JSON.parse(fs.readFileSync(P('out/animatic.mp4.render.json'), 'utf8'));
  assert.equal(rec.dur, 10.22);
  assert.equal(rec.silent, true);
});

test('a board that cannot be timed stops the render with the reason', () => {
  fs.writeFileSync(P('cues.js'), fs.readFileSync(P('cues.js'), 'utf8').replace(/"save":[\d.]+/, '"saved":4'));
  const r = render(dir, ['board'], { allowFail: true });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /cues\.js has no cue for beat "save"/);
});

test('the template: its scene and slate take their 3 s from board.js', () => {
  const t = path.join(repoRoot, 'test', '.work', 'board-template');       // the template as it ships, no fixture
  fs.rmSync(t, { recursive: true, force: true });
  fs.cpSync(templateDir, t, { recursive: true, filter: (s) => !s.split(path.sep).includes('node_modules') });
  const r = render(t, ['board']);
  assert.match(r.stdout, /timing: the beats' durations \(no voice\)/);
  assert.match(fs.readFileSync(path.join(t, 'board.md'), 'utf8'), /\| 1 \| title \| 0\.00-2\.45 \|.*\n\| 2 \| out \| 2\.45-3\.00 \|/);
  render(t, ['video', '--scale', '0.25', '--sub', '1', '--out', 'out/t']);
  assert.equal(countFrames(path.join(t, 'out/t.mp4')), 90);
});
