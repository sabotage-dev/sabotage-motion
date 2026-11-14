// Board timing (plan section 16): estimate and cue-based beat windows for boards with leading,
// interleaved and trailing silent beats; the spliced zeros against the silent run's window; the
// refusals (--offset under the leading silent beats, anchors closer than lead, a dur of 0); VO_OFFSET
// applied exactly once; board_order. The browser half (boardDur() = CFG.DUR, the board sheet) is in
// board-sheet.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SR, cuesTool, lib, synthTake, voicePiece, runCues, readCues, readMonoWav, zeroRuns, levelDb, fakeCtx } from './voice-helpers.mjs';

const { buildCues, fromWords, CueError } = cuesTool;
const { boardTiming, boardOrder } = lib;
const near = (a, b, msg = '', eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const refused = (fn, re) => assert.throws(fn, (e) => e instanceof CueError && re.test(e.message), `expected a refusal matching ${re}`);
const FPS = 30;

// Windows are contiguous, half-open, start at 0, end at dur, and every one has a length.
function assertWindows(t, ids) {
  assert.ok(t.ok, t.problems.join('; '));
  assert.deepEqual(t.windows.map((w) => w.id), ids);
  assert.equal(t.windows[0].start, 0, 'the first window does not start at 0');
  t.windows.forEach((w, i) => {
    assert.ok(w.end > w.start, `"${w.id}" is empty`);
    if (i + 1 < t.windows.length) assert.equal(w.end, t.windows[i + 1].start, `"${w.id}" and "${t.windows[i + 1].id}" are not contiguous`);
  });
  assert.equal(t.windows[t.windows.length - 1].end, t.dur);
  assert.deepEqual(boardOrder(t, t.dur, FPS), []);
}
const spans = (t) => t.windows.map((w) => [w.id, +w.start.toFixed(6), +w.end.toFixed(6)]);

const HOOK = 'Stop pasting the same prompt.', SAVE = 'Save it as a skill instead.';   // 5 and 6 words
const est = (words) => words / 3 + 0.25;
const BOARDS = {
  leading: { beats: [{ id: 'cold', dur: 1 }, { id: 'hook', vo: HOOK }] },
  interleaved: { beats: [{ id: 'hook', vo: HOOK }, { id: 'mid', dur: 1.5 }, { id: 'save', vo: SAVE }] },
  trailing: { beats: [{ id: 'hook', vo: HOOK }, { id: 'end', dur: 2.5 }] },
  five: { beats: [{ id: 'cold', dur: 1 }, { id: 'hook', vo: HOOK }, { id: 'mid', dur: 1.5 }, { id: 'save', vo: SAVE }, { id: 'end', dur: 2.5 }] },
  runOfTwo: { beats: [{ id: 'hook', vo: HOOK }, { id: 'm1', dur: 0.5 }, { id: 'm2', dur: 1.0 }, { id: 'save', vo: SAVE }] },
  silent: { beats: [{ id: 'a', dur: 1.2 }, { id: 'b', dur: 0.8 }] },
};

test('estimate: voiced beats last words / wps + 0.25 s, silent beats their dur, back to back from 0', () => {
  for (const [name, b] of Object.entries(BOARDS)) assertWindows(boardTiming(b), b.beats.map((x) => x.id));
  const t = boardTiming(BOARDS.five);
  assert.equal(t.estimated, true);
  const h = 1 + est(5), m = h + 1.5, s = m + est(6), e = s + 2.5;
  assert.deepEqual(spans(t), [['cold', 0, 1], ['hook', 1, +h.toFixed(6)], ['mid', +h.toFixed(6), +m.toFixed(6)], ['save', +m.toFixed(6), +s.toFixed(6)], ['end', +s.toFixed(6), +e.toFixed(6)]]);
  near(t.voOffset, 1.1, 'estimated VO_OFFSET = leading silent + lead');
  near(boardTiming({ ...BOARDS.five, wps: 2 }).windows[1].end, 1 + 5 / 2 + 0.25, 'wps sets the rate');
  const silent = boardTiming(BOARDS.silent);
  assert.equal(silent.estimated, false, 'a board with no voice is not an estimate');
  assert.deepEqual(spans(silent), [['a', 0, 1.2], ['b', 1.2, 2]]);
});

test('cue-based windows for leading, interleaved, trailing and mixed silent beats (hand-made cues)', () => {
  const take = (CUE, lastWordEnd, VO_OFFSET) => ({ VO_OFFSET, CUE, TAKE: { duration: lastWordEnd + 0.3, lastWordEnd }, GAPS: [], HOOK_END: 0, WORDS: [] });
  // leading: cold runs 0-1, hook opens where cold ends, the voice's lead inside it; the end is lastWordEnd + tail
  assert.deepEqual(spans(boardTiming(BOARDS.leading, take({ hook: 0.12 }, 1.8, 1.1))), [['cold', 0, 1], ['hook', 1, 3.3]]);
  // interleaved: save opens lead before its anchor, mid ends there and starts 1.5 s earlier
  assert.deepEqual(spans(boardTiming(BOARDS.interleaved, take({ hook: 0.12, save: 4.05 }, 6.22, 0.1))), [['hook', 0, 2.55], ['mid', 2.55, 4.05], ['save', 4.05, 6.72]]);
  // trailing: end starts at VO_OFFSET + lastWordEnd + tail
  assert.deepEqual(spans(boardTiming(BOARDS.trailing, take({ hook: 0.12 }, 1.8, 0.1))), [['hook', 0, 2.3], ['end', 2.3, 4.8]]);
  // the five-beat board
  assert.deepEqual(spans(boardTiming(BOARDS.five, take({ hook: 0.12, save: 4.05 }, 6.22, 1.1))),
    [['cold', 0, 1], ['hook', 1, 3.55], ['mid', 3.55, 5.05], ['save', 5.05, 7.72], ['end', 7.72, 10.22]]);
  // two silent beats in a row keep their order and lengths
  assert.deepEqual(spans(boardTiming(BOARDS.runOfTwo, take({ hook: 0.12, save: 4.05 }, 6.0, 0.1))), [['hook', 0, 2.55], ['m1', 2.55, 3.05], ['m2', 3.05, 4.05], ['save', 4.05, 6.5]]);
  for (const name of ['leading', 'interleaved', 'trailing', 'five', 'runOfTwo']) {
    const c = take(Object.fromEntries(BOARDS[name].beats.filter((b) => b.vo).map((b, i) => [b.id, 0.12 + i * 4])), 6.3, name === 'leading' || name === 'five' ? 1.1 : 0.1);
    assertWindows(boardTiming(BOARDS[name], c), BOARDS[name].beats.map((b) => b.id));
  }
  // a cues.js that no longer matches the board is reported, not timed
  const stale = boardTiming(BOARDS.five, take({ hook: 0.12 }, 6.22, 1.1));
  assert.equal(stale.ok, false);
  assert.match(stale.problems.join('\n'), /no cue for beat "save"/);
  assert.match(boardTiming(BOARDS.trailing, take({ hook: 0.1, gone: 2 }, 1.8, 0.1)).problems.join('\n'), /cue for "gone", which is not a voiced beat/);
});

test('a single voiced beat whose first cue is later than lead still opens at 0', () => {
  const { json, audio } = synthTake([['Hello', 0.8, 1.1], ['there', 1.14, 1.4], ['friend.', 1.44, 1.9]], 2.4);
  const r = buildCues({ board: { beats: [{ id: 'only', vo: 'Hello there friend.' }] }, take: fromWords(json), samples: audio });
  near(r.cues.CUE.only, 0.8);
  near(r.cues.VO_OFFSET, 0.1);
  assertWindows(r.timing, ['only']);
  assert.deepEqual(spans(r.timing), [['only', 0, 0.1 + 1.9 + 0.4]]);
});

// The five-beat board on a take with a 1.0 s pause between the lines and a breath 0.4 s into it.
const FIVE = { beats: [{ id: 'cold', dur: 1 }, { id: 'hook', vo: HOOK }, { id: 'mid', dur: 1.5 }, { id: 'save', vo: SAVE }, { id: 'end', dur: 2.5 }] };
const fiveTake = (saveAt) => {
  const d = saveAt - 2.70;
  return synthTake([
    ['Stop', 0.10, 0.30], ['pasting', 0.34, 0.70], ['the', 0.74, 0.85], ['same', 0.89, 1.20], ['prompt.', 1.24, 1.70],
    ['Save', 2.70 + d, 3.00 + d], ['it', 3.04 + d, 3.15 + d], ['as', 3.19 + d, 3.30 + d], ['a', 3.34 + d, 3.40 + d], ['skill', 3.44 + d, 3.80 + d], ['instead.', 3.84 + d, 4.40 + d],
  ], 4.8 + d, { extra: saveAt >= 2.4 ? [{ start: 2.10, end: 2.20, kind: 'noise', amp: 0.03 }] : [] });
};
// Where the spliced zeros sit in picture time, against the silent run's window.
function zerosVsWindow(r, id = 'mid') {
  const runs = zeroRuns(r.vo, 1.0);
  assert.equal(runs.length, 1, `expected one run of zeros, found ${JSON.stringify(runs)}`);
  const zeros = runs[0].map((x) => r.cues.VO_OFFSET + x), w = r.timing.windows.find((x) => x.id === id);
  return { zeros, w };
}

test('the five-beat board: a 1.0 s pause, so the zeros land exactly on "mid", and the breath plays in "hook"', () => {
  const { json, audio } = fiveTake(2.70);
  const r = buildCues({ board: FIVE, take: fromWords(json), samples: audio });
  assertWindows(r.timing, ['cold', 'hook', 'mid', 'save', 'end']);
  assert.deepEqual(spans(r.timing), [['cold', 0, 1], ['hook', 1, 3.7], ['mid', 3.7, 5.2], ['save', 5.2, 7.4], ['end', 7.4, 9.9]]);
  const { zeros, w } = zerosVsWindow(r);
  near(zeros[0], w.start, 'zeros start = mid start', 1.5 / SR);
  near(zeros[1], w.end, 'zeros end = mid end', 1.5 / SR);
  // the breath (2.10-2.20 s into the take) is before the splice point (2.60), so it plays at 1.1 + 2.10
  assert.ok(levelDb(r.vo, 2.11, 2.19) > -45, 'the breath is not where it was in vo.wav');
  const breath = r.cues.VO_OFFSET + 2.10;
  const hook = r.timing.windows[1];
  assert.ok(breath >= hook.start && breath + 0.1 <= hook.end, `the breath at ${breath} s is not inside "hook" [${hook.start}, ${hook.end})`);
  assert.ok(breath + 0.1 <= w.start, 'the breath plays in the silent run');
  assert.deepEqual(r.warnings, []);
});

test('a pause shorter than lead: the splice goes at the previous word\'s end, and the zeros open less than lead after "mid"', () => {
  const { json, audio } = fiveTake(1.75);                                   // 0.05 s after "prompt." ends
  const r = buildCues({ board: FIVE, take: fromWords(json), samples: audio });
  assertWindows(r.timing, ['cold', 'hook', 'mid', 'save', 'end']);
  near(r.cues.GAPS[0].atRaw, 1.70, 'the splice is at the end of "prompt."', 1 / SR);
  const { zeros, w } = zerosVsWindow(r);
  const late = zeros[0] - w.start;
  assert.ok(late > 0 && late <= 0.1 + 1e-4, `zeros open ${late} s after the window`);
  near(late, 0.05, '', 1.5 / SR);
  assert.deepEqual(r.warnings, []);
});

test('a take with no pause before the next anchor: the splice goes at the anchor, with a warning', () => {
  const { json, audio } = fiveTake(1.70);                                   // "Save" starts as "prompt." ends
  const r = buildCues({ board: FIVE, take: fromWords(json), samples: audio });
  assertWindows(r.timing, ['cold', 'hook', 'mid', 'save', 'end']);
  near(r.cues.GAPS[0].atRaw, 1.70, 'the splice is at the anchor', 1 / SR);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /runs straight into its anchor/);
  const { zeros, w } = zerosVsWindow(r);
  near(zeros[0] - w.start, 0.1, 'zeros open lead after the window', 1.5 / SR);
});

test('--offset below the leading silent beats is refused (in the tool and on the command line)', () => {
  const { json, audio } = fiveTake(2.70);
  refused(() => buildCues({ board: FIVE, take: fromWords(json), samples: audio, offset: 0.9 }), /--offset 0\.9 is less than the leading silent beats \(1\.00 s\)/);
  const at = buildCues({ board: FIVE, take: fromWords(json), samples: audio, offset: 1.0 });   // equal is allowed
  near(at.cues.VO_OFFSET, 1.0);
  assertWindows(at.timing, ['cold', 'hook', 'mid', 'save', 'end']);
  const dir = voicePiece('timing-offset', { board: FIVE, take: json, audio });
  const r = runCues(dir, ['--offset', '0.5']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /--offset 0\.5 is less than the leading silent beats/);
  assert.ok(!fs.existsSync(path.join(dir, 'cues.js')));
});

test('two anchors closer than lead, and a dur of 0, are refused with the beats named', () => {
  // with VO_OFFSET at 0, "a" opens at 0 and "b" at its anchor (0.05) - lead: before "a" does
  const { json, audio } = synthTake([['Go', 0.0, 0.03], ['now.', 0.05, 0.4], ['Then', 0.8, 1.0], ['stop.', 1.04, 1.4]], 1.8);
  const board = { beats: [{ id: 'a', vo: 'Go' }, { id: 'b', vo: 'now.' }, { id: 'c', vo: 'Then stop.' }] };
  refused(() => buildCues({ board, take: fromWords(json), samples: audio, offset: 0 }), /beat "a" would last -0\.050 s .*"b" starts at or before "a" does \(two anchors closer than lead/);
  // the default VO_OFFSET (0.1) gives "a" a positive window, [0, 0.05), but its anchor plays at 0.10, inside
  // "b"'s: still two anchors closer than lead, so still refused (council round 1)
  refused(() => buildCues({ board, take: fromWords(json), samples: audio }), /beat "a": its anchor plays at 0\.100 s, outside its own window \[0\.000, 0\.050\) and inside "b"'s \(two anchors closer than lead/);
  // anchors more than lead apart are accepted: "b" (0.11 into the take) opens at 0.11 picture time, just after
  // "a"'s anchor plays at 0.10
  const ok = synthTake([['Go', 0.0, 0.03], ['now.', 0.11, 0.4], ['Then', 0.8, 1.0], ['stop.', 1.04, 1.4]], 1.8);
  assertWindows(buildCues({ board, take: fromWords(ok.json), samples: ok.audio }).timing, ['a', 'b', 'c']);
  refused(() => buildCues({ board: { beats: [{ id: 'z', dur: 0 }, ...board.beats] }, take: fromWords(json), samples: audio }), /beat "z": dur 0 would give it a zero or negative length/);
  assert.match(boardTiming({ beats: [{ id: 'x', dur: 0 }] }).problems.join(), /zero or negative length/);
});

test('VO_OFFSET is applied once: at 0.10 s and at 2.10 s, beat starts and captions land on the hand-calculated frames', async () => {
  const board = { target: 'tiktok', beats: [{ id: 'hook', vo: 'Stop pasting the same prompt.' }, { id: 'save', vo: 'Save it as a skill instead.' }] };
  const { json, audio } = synthTake([
    ['Stop', 0.12, 0.38], ['pasting', 0.42, 0.80], ['the', 0.84, 0.95], ['same', 0.99, 1.30], ['prompt.', 1.34, 1.80],
    ['Save', 2.60, 2.90], ['it', 2.94, 3.05], ['as', 3.09, 3.20], ['a', 3.24, 3.30], ['skill', 3.34, 3.70], ['instead.', 3.74, 4.30],
  ], 4.8);
  const frameOf = (t) => Math.ceil(t * FPS - 1e-6);                         // the first frame at or after t
  const seen = {};
  for (const [name, args] of [['vo010', []], ['vo210', ['--offset', '2.1']]]) {
    const dir = voicePiece(`timing-${name}`, { board, take: json, audio });
    const r = runCues(dir, args);
    assert.equal(r.status, 0, r.out);
    const c = readCues(dir), VO = name === 'vo010' ? 0.1 : 2.1;
    near(c.VO_OFFSET, VO);
    // the piece's own lib.js, as a scene sees it: board.js and cues.js loaded from the piece folder
    const L = await import(pathToFileURL(path.join(dir, 'lib.js')).href);
    near(L.CUES.VO_OFFSET, VO);
    near(L.beatWindow('save')[0], VO + 2.60 - 0.1, 'save opens lead before VO_OFFSET + its cue');
    assert.equal(L.beatWindow('hook')[0], 0);
    assert.equal(L.beatAt(L.beatWindow('save')[0]).id, 'save', 'windows are half-open: a boundary belongs to the next beat');
    assert.equal(L.beatAt(L.boardDur()), null);
    near(L.boardDur(), VO + 4.30 + 0.4);
    // captions without a voOffset use the piece's VO_OFFSET: each word turns active on frame ceil((VO + start) x FPS)
    const { ctx } = fakeCtx();
    const active = (f) => (L.captions(ctx, L.CUES.WORDS, f / FPS, { safe: { x: 84, y: 160, w: 852, h: 1320 } }).find((b) => b.active) || {}).text;
    for (const w of c.WORDS) {
      const f = frameOf(VO + w.start);
      assert.equal(active(f), w.text, `"${w.text}" is not active on frame ${f}`);
      assert.notEqual(active(f - 1), w.text, `"${w.text}" is active before frame ${f}`);
    }
    seen[name] = { save: frameOf(L.beatWindow('save')[0]), first: frameOf(VO + c.WORDS[0].start) };
  }
  assert.equal(seen.vo210.save - seen.vo010.save, 60, 'a 2 s larger offset moves "save" by 60 frames');
  assert.equal(seen.vo210.first - seen.vo010.first, 60, 'and the first caption by 60 frames');
});

test('board_order catches a bad board: CFG.DUR off by more than a frame, an out-of-order cues.js, a hole', () => {
  const t = boardTiming(BOARDS.five);
  assert.deepEqual(boardOrder(t, t.dur, FPS), []);
  assert.deepEqual(boardOrder(t, t.dur + 0.9 / FPS, FPS), [], 'within one frame passes');
  assert.match(boardOrder(t, 3.0, FPS).join('\n'), /CFG\.DUR 3 differs from boardDur\(\) .* by more than one frame/);
  // a hand-edited cues.js with "save" before "hook"
  const bad = boardTiming(BOARDS.interleaved, { VO_OFFSET: 0.1, CUE: { hook: 2.0, save: 1.0 }, TAKE: { duration: 3, lastWordEnd: 2.5 }, GAPS: [], HOOK_END: 1, WORDS: [] });
  assert.equal(bad.ok, false);
  assert.match(boardOrder(bad, 3, FPS).join('\n'), /would last/);
  // windows that are not contiguous, or do not start at 0 (a timing built by hand, not by boardTiming)
  const holes = { problems: [], dur: 3, windows: [{ id: 'a', start: 0.1, end: 1 }, { id: 'b', start: 1.2, end: 3 }] };
  const p = boardOrder(holes, 3, FPS).join('\n');
  assert.match(p, /"a" starts at 0\.100 s, not 0/);
  assert.match(p, /"a" and "b" are not contiguous/);
});

test('a cues.js made before board.js changed is refused, so the picture never drifts off the voice (council round 1)', () => {
  const { json, audio } = fiveTake(2.70);
  const r = buildCues({ board: FIVE, take: fromWords(json), samples: audio });
  assertWindows(boardTiming(FIVE, r.cues), ['cold', 'hook', 'mid', 'save', 'end']);
  const withBeat = (id, patch) => ({ ...FIVE, beats: FIVE.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const changed = [
    ['a silent beat\'s dur (the zeros in vo.wav no longer fit)', withBeat('mid', { dur: 2.0 })],
    ['a leading silent beat\'s dur (VO_OFFSET is stale)', withBeat('cold', { dur: 1.5 })],
    ['lead', { ...FIVE, lead: 0.2 }],
    ['hookMax (the gate has to run again)', { ...FIVE, hookMax: 9 }],
    ['a voice line', withBeat('hook', { vo: 'Stop pasting the same prompts.' })],
  ];
  for (const [what, board] of changed) {
    const t = boardTiming(board, r.cues);
    assert.equal(t.ok, false, what);
    assert.match(t.problems.join('\n'), /board\.js changed since cues\.js was made/, what);
  }
  // notes that do not move time keep the cues
  assertWindows(boardTiming(withBeat('mid', { copy: 'New words on screen', look: 'a slow push' }), r.cues), ['cold', 'hook', 'mid', 'save', 'end']);
});
