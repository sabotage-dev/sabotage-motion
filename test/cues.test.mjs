// Cues (plan section 16): tools/cues.mjs on recorded timing fixtures for each adapter, refusals that
// stop before any write, occurrence counts, gaps, the hook gate, and delivery tags on a synthetic take.
// Every take here is synthetic: hand-made timings, and tone or noise bursts for the audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixturesDir, sha256File } from './helpers.mjs';
import { SR, cuesTool, lib, takeFixture, synthAudio, synthTake, voicePiece, runCues, readCues, readMonoWav, zeroRuns, fakeCtx, boardFixture, elevenlabsFrom } from './voice-helpers.mjs';

const { buildCues, fromWords, fromElevenLabs, fromWhisper, CueError } = cuesTool;
const near = (a, b, msg = '', eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const refused = (fn, re) => assert.throws(fn, (e) => e instanceof CueError && re.test(e.message), `expected a refusal matching ${re}`);

// fixture-board's recorded take (test/fixtures/takes): Stop 0.12 ... prompt. ends 1.80; [curious] 2.55-2.60;
// Save 2.60 ... instead. ends 4.30; [chuckles] 4.30-4.72; 5.0 s. The board puts cold (1 s) first and
// mid (1.5 s) between the lines, so VO_OFFSET = 1 + lead and 1.5 s of zeros go in before "save".
const wordsFix = takeFixture('words.json');
const fixtureAudio = () => synthAudio({ duration: wordsFix.duration, words: wordsFix.words, tags: wordsFix.tags.map((t) => ({ ...t, long: t.end - t.start > 0.2 })) });
const copyTake = (dir, name) => fs.copyFileSync(path.join(fixturesDir, 'takes', name), path.join(dir, name));

function expectFixtureCues(c, { saveRaw, lastRaw }) {
  assert.deepEqual(Object.keys(c.CUE), ['hook', 'save'], 'CUE holds the voiced beat ids, in order');
  near(c.VO_OFFSET, 1.1, 'VO_OFFSET = leading silent 1.0 + lead 0.1');
  near(c.CUE.hook, 0.12, 'hook cue');
  near(c.CUE.save, saveRaw + 1.5, 'save cue, after 1.5 s of zeros for "mid"');
  near(c.HOOK_END, 1.80, 'HOOK_END');
  near(c.TAKE.lastWordEnd, lastRaw + 1.5, 'TAKE.lastWordEnd');
  near(c.TAKE.duration, 6.5, 'vo.wav is the take plus the zeros');
  assert.equal(c.GAPS.length, 1);
  assert.equal(c.GAPS[0].kind, 'silent');
  assert.equal(c.GAPS[0].before, 'save');
  assert.deepEqual(c.GAPS[0].beats, ['mid']);
  near(c.GAPS[0].dur, 1.5);
  near(c.GAPS[0].at, Math.max(1.80, saveRaw - 0.1), 'zeros at max(prevWordEnd, cue - lead)', 1 / SR);
}

test('adapters: the elevenlabs fixture gives the expected cues (the opening tag moves "save" to its start)', async () => {
  const dir = voicePiece('cues-el', { audio: fixtureAudio() });
  copyTake(dir, 'elevenlabs.json');
  const r = runCues(dir, ['--from', 'elevenlabs', 'elevenlabs.json']);
  assert.equal(r.status, 0, r.out);
  const c = readCues(dir);
  expectFixtureCues(c, { saveRaw: 2.55, lastRaw: 4.72 });
  // cues.js carries the same values, and take.json is the generic format with no tags left in it
  const mod = await import(pathToFileURL(path.join(dir, 'cues.js')).href);
  assert.deepEqual({ VO_OFFSET: mod.VO_OFFSET, CUE: mod.CUE, TAKE: mod.TAKE, GAPS: mod.GAPS, HOOK_END: mod.HOOK_END, WORDS: mod.WORDS, BOARD_KEY: mod.BOARD_KEY }, c);
  assert.equal(typeof mod.BOARD_KEY, 'string', 'cues.js records the board it was made from');
  const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  assert.equal(take.source, 'elevenlabs');
  assert.equal(take.chars.text, 'Stop pasting the same prompt. Save it as a skill instead.');
  assert.deepEqual(take.tags.map((t) => t.text), ['[curious]', '[chuckles]']);
  assert.ok(fs.existsSync(path.join(dir, 'vo.wav')));
});

test('adapters: the whisper fixture gives the expected cues (a transcript has no tags, so "save" cues on its word)', () => {
  const dir = voicePiece('cues-wh', { audio: fixtureAudio() });
  copyTake(dir, 'whisper.json');
  const r = runCues(dir, ['--from', 'whisper', 'whisper.json']);
  assert.equal(r.status, 0, r.out);
  expectFixtureCues(readCues(dir), { saveRaw: 2.60, lastRaw: 4.30 });
  assert.deepEqual(readCues(dir).WORDS.map((w) => w.text), wordsFix.words.map((w) => w.text), 'whisper\'s leading spaces are trimmed');
});

test('adapters: the generic words fixture gives the expected cues', () => {
  const dir = voicePiece('cues-words', { take: wordsFix, audio: fixtureAudio() });
  const r = runCues(dir);   // defaults: --from words take.json, --audio take-raw.wav
  assert.equal(r.status, 0, r.out);
  expectFixtureCues(readCues(dir), { saveRaw: 2.55, lastRaw: 4.72 });
});

test('a missing anchor stops the tool before it writes anything, and names every missing phrase', async () => {
  const board = await boardFixture();
  // the board was edited after the take: neither default anchor is in it any more
  board.beats[1].vo = 'Stop pasting prompts into chat.';          // the take says "Stop pasting the same prompt."
  board.beats[3].vo = '[curious] Save them as a skill instead.';  // the take says "Save it as a skill instead."
  const dir = voicePiece('cues-missing', { board, audio: null });
  fs.writeFileSync(path.join(dir, 'raw.wav'), cuesTool.wavFloat(fixtureAudio()));
  copyTake(dir, 'words.json');
  // a good cues.js from an earlier run must survive
  fs.writeFileSync(path.join(dir, 'cues.js'), '// an earlier good cues.js\n');
  const before = fs.readdirSync(dir).sort(), hash = sha256File(path.join(dir, 'cues.js'));
  const r = runCues(dir, ['--from', 'words', 'words.json', '--audio', 'raw.wav']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /refused, nothing written/);
  assert.match(r.out, /beat "hook": anchor "Stop pasting prompts into" is not in the take/);
  assert.match(r.out, /beat "save": anchor "Save them as a" is not in the take/);
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'files were added');
  assert.equal(sha256File(path.join(dir, 'cues.js')), hash, 'cues.js was replaced');
});

test('the occurrence count picks the nth time a phrase is said; the default is the next one after the last beat', () => {
  const { json, audio } = synthTake([
    ['Make', 0.1, 0.3], ['it', 0.32, 0.4], ['once.', 0.42, 0.8],
    ['Make', 1.2, 1.4], ['it', 1.42, 1.5], ['twice.', 1.52, 1.9],
    ['Then', 2.3, 2.5], ['make', 2.52, 2.7], ['it', 2.72, 2.8], ['count.', 2.82, 3.2],
  ], 3.6);
  const take = fromWords(json);
  const board = { beats: [{ id: 'a', vo: 'Make it once.' }, { id: 'b', vo: 'Make it twice.' }, { id: 'c', vo: 'Then make it count.', anchor: 'it', occurrence: 3 }] };
  const r = buildCues({ board, take, samples: audio });
  near(r.cues.CUE.a, 0.1); near(r.cues.CUE.b, 1.2, '"b": the default finds the next "Make it twice"');
  near(r.cues.CUE.c, 2.72, '"c": the 3rd "it" in the take');
  board.beats[2].occurrence = 1;                       // the 1st "it" is in line a: out of order
  refused(() => buildCues({ board, take, samples: audio }), /does not come after/);
  board.beats[2].occurrence = 4;                       // there are only three
  refused(() => buildCues({ board, take, samples: audio }), /occurs 3 time\(s\), not 4/);
});

// "Stop pasting prompts." then a 0.7 s pause at the noise floor, then "Save them as a skill."
const gapTake = (pause = 'floor') => synthTake([
  ['Stop', 0.1, 0.35], ['pasting', 0.39, 0.75], ['prompts.', 0.79, 1.2],
  ['Save', 1.9, 2.2], ['them', 2.24, 2.45], ['as', 2.49, 2.6], ['a', 2.64, 2.7], ['skill.', 2.74, 3.2],
], 3.6, { extra: pause === 'hum' ? [{ start: 1.2, end: 1.9, kind: 'noise', amp: 0.03 }] : [] });
const gapBoard = (gap = 0.6) => ({ beats: [{ id: 'hook', vo: 'Stop pasting prompts.' }, { id: 'save', vo: 'Save them as a skill.', gapBefore: gap }] });

test('gapBefore at a silent point shifts every later timing by exactly the gap, and only those', () => {
  const { json, audio } = gapTake();
  const raw = fromWords(json);
  const r = buildCues({ board: gapBoard(0.6), take: raw, samples: audio });
  const g = r.cues.GAPS[0];
  assert.equal(g.kind, 'gapBefore');
  assert.ok(g.at > 1.2 && g.at < 1.9, `the cut ${g.at} is not in the pause`);
  near(g.dur, 0.6);
  near(r.cues.CUE.save, 1.9 + 0.6, 'the anchor moved by the gap');
  near(r.cues.CUE.hook, 0.1, 'the hook did not move');
  r.cues.WORDS.forEach((w, i) => {
    const d = w.start > g.at ? 0.6 : 0;
    near(w.start, raw.words[i].start + d, `word ${i} start`); near(w.end, raw.words[i].end + d, `word ${i} end`);
  });
  near(r.cues.TAKE.duration, audio.length / SR + 0.6);
  near(r.cues.TAKE.lastWordEnd, 3.2 + 0.6);
  // the audio: unchanged up to the fade before the cut, exactly 0.6 s of zeros, then the take again, unchanged
  // after the 5 ms fade in
  const k = Math.round(g.at * SR), n = Math.round(0.6 * SR), fade = Math.round(0.005 * SR);
  for (let i = 0; i < k - fade; i += 7) assert.equal(r.vo[i], audio[i]);
  for (let i = k; i < k + n; i++) assert.equal(r.vo[i], 0, `sample ${i} in the gap is not zero`);
  for (let i = k + fade; i < audio.length; i += 7) assert.equal(r.vo[i + n], audio[i]);
  // the 5 ms fades themselves (plan 6.3): a linear ramp down into the zeros and up out of them. The pause
  // holds the noise floor, not silence, so a missing or wrong fade changes these samples (council round 1).
  assert.ok(audio.subarray(k - fade, k + fade).some((x) => x !== 0), 'the cut must sit on non-zero samples for this to test anything');
  for (let j = 0; j < fade; j++) {
    const gain = (j + 1) / (fade + 1);
    assert.equal(r.vo[k - 1 - j], Math.fround(audio[k - 1 - j] * gain), `fade out, sample ${j} before the cut`);
    assert.equal(r.vo[k + n + j], Math.fround(audio[k + j] * gain), `fade in, sample ${j} after the zeros`);
  }
  assert.deepEqual(zeroRuns(r.vo, 0.1).map(([a, b]) => [+a.toFixed(4), +(b - a).toFixed(4)]), [[+(k / SR).toFixed(4), 0.6]]);
});

test('gapBefore is refused where the cut would split speech: a pause louder than -50 dBFS, or no pause at all', () => {
  const { json, audio } = gapTake('hum');
  refused(() => buildCues({ board: gapBoard(), take: fromWords(json), samples: audio }), /louder than -50 dBFS: a cut there would split speech/);
  const tight = synthTake([['Stop', 0.1, 0.35], ['pasting', 0.39, 0.75], ['prompts.', 0.79, 1.2], ['Save', 1.2, 1.5], ['them', 1.54, 1.7], ['as', 1.74, 1.8], ['a', 1.84, 1.9], ['skill.', 1.94, 2.3]], 2.6);
  refused(() => buildCues({ board: gapBoard(), take: fromWords(tight.json), samples: tight.audio }), /gapBefore needs a pause before its anchor/);
});

test('the hook gate refuses a take whose hook ends after hookMax, says by how much, and writes nothing', async () => {
  const board = await boardFixture();
  board.hookMax = 2.5;                                 // the hook ends at 1.1 + 1.80 = 2.90 s picture time
  const dir = voicePiece('cues-hook', { board, take: wordsFix, audio: fixtureAudio() });
  const before = fs.readdirSync(dir).sort();
  const r = runCues(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /the hook \("hook"\) ends at 2\.900 s picture time \(VO_OFFSET 1\.100 \+ HOOK_END 1\.800\), 0\.400 s after BOARD\.hookMax 2\.5/);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
  board.hookMax = 2.9;                                 // exactly on the limit passes
  const ok = buildCues({ board, take: fromWords(wordsFix), samples: fixtureAudio() });
  near(ok.cues.VO_OFFSET + ok.cues.HOOK_END, 2.9);
  // the same rule as `check` will run it (hook_long, section 6.5)
  assert.deepEqual({ ...lib.hookLong(board, ok.cues), end: +lib.hookLong(board, ok.cues).end.toFixed(6), over: +lib.hookLong(board, ok.cues).over.toFixed(6) },
    { ok: true, hook: 'hook', end: 2.9, over: 0 });
  const late = lib.hookLong({ ...board, hookMax: 2.5 }, ok.cues);
  assert.equal(late.ok, false);
  near(late.over, 0.4);
  assert.equal(lib.hookLong({ ...board, hookMax: undefined }, ok.cues), null, 'no hookMax, no check');
  assert.equal(lib.hookLong(board, null), null, 'no take yet, no check');
});

test('CUE holds only beat ids; take facts live in TAKE, so a beat named like a take field cannot collide', () => {
  const { json, audio } = gapTake();
  const board = { beats: [{ id: 'duration', vo: 'Stop pasting prompts.' }, { id: 'lastWordEnd', vo: 'Save them as a skill.' }] };
  const r = buildCues({ board, take: fromWords(json), samples: audio });
  assert.deepEqual(Object.keys(r.cues.CUE), ['duration', 'lastWordEnd']);
  near(r.cues.CUE.duration, 0.1); near(r.cues.CUE.lastWordEnd, 1.9);
  near(r.cues.TAKE.duration, 3.6); near(r.cues.TAKE.lastWordEnd, 3.2);
  assert.deepEqual(Object.keys(r.cues).sort(), ['BOARD_KEY', 'CUE', 'GAPS', 'HOOK_END', 'TAKE', 'VO_OFFSET', 'WORDS']);
  for (const id of ['TAKE', 'VO_OFFSET', 'DUR', '__proto__']) {
    refused(() => buildCues({ board: { beats: [{ id, vo: 'Stop pasting prompts.' }] }, take: fromWords(json), samples: audio }), /reserved/);
  }
});

// ---- delivery tags (section 7.1, D9) on one synthetic take: a closing tag on the hook line (a 0.45 s
// noise burst with a dead-quiet 20 ms dip inside it), an opening tag (a 50 ms burst with a dip of its own),
// a closing tag right before an interleaved silent beat, a mid-line tag right before an anchor, and a
// closing tag on the last line. The dips make a cut that ignored the tags land inside them.
const TAG_TOKENS = [
  ['Stop', 0.10, 0.35], ['pasting', 0.39, 0.75], ['prompts.', 0.79, 1.30],
  ['[sighs]', 1.30, 1.75],
  ['[curious]', 2.40, 2.45],
  ['Save', 2.45, 2.75], ['them', 2.79, 3.00], ['as', 3.04, 3.15], ['a', 3.19, 3.25], ['skill.', 3.29, 3.70],
  ['[laughs]', 3.70, 4.10],
  ['Then', 4.15, 4.40], ['call', 4.44, 4.70], ['it', 4.74, 4.85], ['by', 4.89, 5.00], ['name.', 5.04, 5.50],
  ['Name', 6.00, 6.25], ['it', 6.29, 6.40],
  ['[short pause]', 6.40, 6.45],
  ['once,', 6.45, 6.80], ['and', 6.84, 6.95], ['it', 6.99, 7.10], ['sticks.', 7.14, 7.60],
  ['[chuckles]', 7.60, 8.00],
];
const TAG_BOARD = { target: 'tiktok', beats: [
  { id: 'hook', vo: 'Stop pasting prompts. [sighs]', hook: true },
  { id: 'save', vo: '[curious] Save them as a skill. [laughs]', gapBefore: 0.3 },
  { id: 'mid', dur: 1.0 },
  { id: 'tip', vo: 'Then call it by name.' },
  { id: 'last', vo: 'Name it [short pause] once, and it sticks. [chuckles]', anchor: 'once, and it' },
] };
const tagTake = () => synthTake(TAG_TOKENS, 8.5, { extra: [{ start: 1.50, end: 1.52, kind: 'zero' }, { start: 2.42, end: 2.432, kind: 'zero' }] });
const RAW_TAGS = TAG_TOKENS.filter(([t]) => t.startsWith('['));
const inside = (t, [, a, b]) => t > a + 1e-6 && t < b - 1e-6;

for (const source of ['words', 'elevenlabs']) {
  test(`delivery tags (${source} timings): opening, mid-line and closing tags move cues and count as the line's sound`, () => {
    const { json, audio } = tagTake();
    const take = source === 'words' ? fromWords(json) : fromElevenLabs(elevenlabsFrom(TAG_TOKENS));
    // no tag reaches the words or the characters
    assert.ok(take.words.every((w) => !/[[\]]/.test(w.text)), 'a tag is in the words');
    if (take.chars) {
      assert.equal(take.chars.text, 'Stop pasting prompts. Save them as a skill. Then call it by name. Name it once, and it sticks.');
      assert.equal(take.chars.starts.length, take.chars.text.length);
    }
    assert.deepEqual(take.tags.map((t) => t.text), RAW_TAGS.map((t) => t[0]));
    const r = buildCues({ board: TAG_BOARD, take, samples: audio });
    const c = r.cues;
    assert.ok(c.WORDS.every((w) => !/[[\]]/.test(w.text)), 'a tag reached WORDS');
    assert.equal(c.WORDS.length, take.words.length);
    // the default anchor skips the opening tag, and the opening tag moves the cue to its own start
    assert.equal(lib.defaultAnchor(TAG_BOARD.beats[1].vo), 'Save them as a');
    const raw = Object.fromEntries(r.info.found.map((f) => [f.id, f.raw]));
    near(raw.save, 2.40, '"save" cues at [curious], not at "Save" (2.45)');
    assert.deepEqual(r.info.found.find((f) => f.id === 'save').openTags, ['[curious]']);
    // an anchor right after a mid-line tag matches, and that tag (directly before it) moves the cue too
    near(raw.last, 6.40, '"last" cues at [short pause]');
    // a closing tag counts in HOOK_END ...
    near(c.HOOK_END, 1.75, 'HOOK_END is the end of [sighs], not of "prompts." (1.30)');
    // ... in prevWordEnd: the gapBefore cut lies between [sighs] and [curious] (not in either's quiet dip),
    // and the interleaved splice for "mid" goes at the end of [laughs] (4.10), not at cue - lead (4.05)
    const gap = c.GAPS.find((g) => g.kind === 'gapBefore'), sil = c.GAPS.find((g) => g.kind === 'silent');
    assert.ok(gap.atRaw >= 1.75 && gap.atRaw <= 2.40, `gapBefore cut at ${gap.atRaw}`);
    near(sil.atRaw, 4.10, 'the splice for "mid"', 1 / SR);
    // ... and in TAKE.lastWordEnd: [chuckles] closes the last line
    near(c.TAKE.lastWordEnd, 8.00 + 0.3 + 1.0, 'TAKE.lastWordEnd is the end of [chuckles]');
    // no splice or gapBefore cut lands inside any tag's span
    for (const g of c.GAPS) for (const t of RAW_TAGS) assert.ok(!inside(g.atRaw, t), `${g.kind} at ${g.atRaw} is inside ${t[0]}`);
    for (const [a, b] of zeroRuns(r.vo, 0.1)) {
      for (const t of r.tags) assert.ok(b <= t.start + 1e-6 || a >= t.end - 1e-6, `zeros ${a}-${b} overlap ${t.text} ${t.start}-${t.end}`);
    }
    // later cues moved by both silences; windows are contiguous from 0
    near(c.CUE.save, 2.40 + 0.3); near(c.CUE.tip, 4.15 + 1.3); near(c.CUE.last, 6.40 + 1.3);
    assert.ok(r.timing.ok && r.timing.windows[0].start === 0);
  });
}

test('delivery tags never reach captions or the estimate', () => {
  const { json, audio } = tagTake();
  const r = buildCues({ board: TAG_BOARD, take: fromWords(json), samples: audio });
  const { ctx, calls } = fakeCtx();
  const safe = { x: 84, y: 160, w: 852, h: 1320 };
  for (let f = 0; f < r.timing.dur * 30; f++) lib.captions(ctx, r.cues.WORDS, f / 30, { safe, voOffset: r.cues.VO_OFFSET });
  const shown = new Set(calls.map((x) => x.text));
  assert.ok([...shown].every((t) => !t.includes('[')), 'a tag was drawn as a caption');
  for (const w of r.cues.WORDS) assert.ok(shown.has(w.text), `"${w.text}" was never captioned`);
  // a WORDS list that somehow still holds a tag does not show it either
  calls.length = 0;
  lib.captions(ctx, [{ text: 'Hello', start: 0, end: 0.3 }, { text: '[curious]', start: 0.3, end: 0.35 }, { text: 'there', start: 0.35, end: 0.6 }], 0.5, { safe, voOffset: 0 });
  assert.deepEqual(calls.map((x) => x.text), ['Hello', 'there']);
  // the estimate counts words only: "[curious] Save them as a skill. [laughs]" is 5 words
  near(lib.estimateVoiced(TAG_BOARD.beats[1].vo, 3), 5 / 3 + 0.25);
  const est = lib.boardTiming(TAG_BOARD);
  near(est.windows[1].end - est.windows[1].start, 5 / 3 + 0.25);
  near(est.windows[4].end - est.windows[4].start, 6 / 3 + 0.25, '"Name it [short pause] once, and it sticks. [chuckles]" is 6 words');
});

test('an anchor containing [ is refused', () => {
  const { json, audio } = tagTake();
  const board = structuredClone(TAG_BOARD);
  board.beats[1].anchor = '[curious] Save';
  refused(() => buildCues({ board, take: fromWords(json), samples: audio }), /anchor "\[curious\] Save" contains \[: delivery tags are never anchors/);
});

test('whisper words: a tag split over two words, or glued to one, still comes out as one tag', () => {
  const t = fromWhisper({ segments: [{ words: [{ word: ' Hi', start: 0, end: 0.2 }, { word: ' [short', start: 0.3, end: 0.35 }, { word: ' pause]', start: 0.35, end: 0.4 },
    { word: ' there.[laughs]', start: 0.5, end: 1.0 }] }] });
  assert.deepEqual(t.words.map((w) => w.text), ['Hi', 'there.']);
  assert.deepEqual(t.tags.map((x) => [x.text, x.start, x.end]), [['[short pause]', 0.3, 0.4], ['[laughs]', 0.5, 1.0]]);
  assert.throws(() => fromWhisper({ segments: [{ text: 'no words' }] }), /--word_timestamps True/);
});

// ---- council round 1 (PR #2): a tag glued to a word on one side, and an anchor that overlaps the previous one

// "Stop pasting the same prompt.[sighs] Save it as a skill." as ElevenLabs characters, built one character at a
// time so the take's text is exactly what was sent: the tag is glued to "prompt." with a space after it.
function gluedTake() {
  const parts = [['Stop pasting the same prompt.', 0.12, 1.80], ['[sighs]', 1.80, 2.20], [' ', 2.20, 2.90], ['Save it as a skill.', 2.90, 4.10]];
  const characters = [], s = [], e = [];
  for (const [text, a, b] of parts) {
    for (let k = 0; k < text.length; k++) { characters.push(text[k]); s.push(a + ((b - a) * k) / text.length); e.push(a + ((b - a) * (k + 1)) / text.length); }
  }
  const audio = synthAudio({ duration: 4.6, words: [{ start: 0.12, end: 1.80 }, { start: 2.90, end: 4.10 }], tags: [{ start: 1.80, end: 2.20, long: true }] });
  return { json: { alignment: { characters, character_start_times_seconds: s, character_end_times_seconds: e } }, audio };
}

test('a delivery tag glued to a word on one side is cut alone, so the words around it never run together', () => {
  assert.equal(lib.stripTags('Stop pasting the same prompt.[sighs] Save it'), 'Stop pasting the same prompt. Save it');
  assert.equal(lib.stripTags('Say it[short pause] once'), 'Say it once');
  assert.equal(lib.stripTags('a skill. [curious]Save it'), 'a skill. Save it');
  assert.equal(lib.stripTags('a [x] b'), 'a b');
  const { json, audio } = gluedTake();
  const take = fromElevenLabs(json);
  assert.equal(take.chars.text, 'Stop pasting the same prompt. Save it as a skill.');
  assert.deepEqual(take.words.map((w) => w.text), ['Stop', 'pasting', 'the', 'same', 'prompt.', 'Save', 'it', 'as', 'a', 'skill.']);
  const board = { hookMax: 3, beats: [{ id: 'hook', vo: 'Stop pasting the same prompt.[sighs]' }, { id: 'save', vo: 'Save it as a skill.', gapBefore: 0.6 }] };
  const r = buildCues({ board, take, samples: audio });
  near(r.cues.HOOK_END, 2.20, 'the hook ends with its closing tag', 1e-3);
  near(r.cues.CUE.save, 2.90 + 0.6, '"save" cues on its own word, after the gap (the pause is not refused)', 1e-3);
  assert.ok(!r.cues.WORDS.some((w) => w.text.includes('prompt.Save')), 'no merged word in WORDS');
  // the hook gate sees the real end of the hook (0.1 + 2.20 = 2.30), not "same"
  refused(() => buildCues({ board: { ...board, hookMax: 2.2 }, take, samples: audio }), /the hook \("hook"\) ends at 2\.3/);
});

test('the default search for the next anchor starts after the previous anchor\'s last word, not its first', () => {
  const { json, audio } = synthTake([
    ['Stop', 0.12, 0.38], ['pasting', 0.42, 0.80], ['the', 0.84, 0.95], ['same', 0.99, 1.30], ['prompt', 1.34, 1.70], ['into', 1.74, 1.90], ['chat.', 1.94, 2.30],
    ['Paste', 3.00, 3.30], ['the', 3.34, 3.45], ['same', 3.49, 3.80], ['prompt', 3.84, 4.20], ['into', 4.24, 4.40], ['a', 4.44, 4.50], ['skill.', 4.54, 5.00],
  ], 5.5);
  // "the same prompt" also occurs inside the hook's default anchor "Stop pasting the same"
  const board = { beats: [{ id: 'hook', vo: 'Stop pasting the same prompt into chat.' }, { id: 'save', vo: 'Paste the same prompt into a skill.', anchor: 'the same prompt' }] };
  const r = buildCues({ board, take: fromWords(json), samples: audio });
  near(r.cues.CUE.hook, 0.12);
  near(r.cues.CUE.save, 3.34, '"save" cues on "the same prompt" in its own line');
});

test('the generic words format with character timings cuts delivery tags from its chars too (council round 1)', () => {
  const text = '[curious] Stop pasting.[sighs] Save it. [chuckles]';
  const starts = [...text].map((_, i) => 0.1 + i * 0.05), ends = starts.map((s) => s + 0.05);
  const json = { words: [{ text: 'Stop', start: 0.6, end: 0.8 }, { text: 'pasting.', start: 0.85, end: 1.3 }, { text: 'Save', start: 1.8, end: 2.0 }, { text: 'it.', start: 2.05, end: 2.3 }],
    chars: { text, starts, ends } };
  const take = fromWords(json);
  assert.equal(take.chars.text, 'Stop pasting. Save it.');
  assert.equal(take.chars.starts.length, take.chars.text.length);
  assert.deepEqual(take.tags.map((t) => t.text), ['[curious]', '[sighs]', '[chuckles]']);
  const at = (i) => starts[i];
  near(take.tags[0].start, at(0)); near(take.tags[1].start, at(text.indexOf('[sighs]')));
});

test('captions: two calls on the same WORDS with a different hold each keep their own hold (council round 1)', () => {
  const { ctx, calls } = fakeCtx();
  const safe = { x: 84, y: 160, w: 852, h: 1320 };
  const WORDS = [{ text: 'Hello', start: 0, end: 0.3 }, { text: 'there.', start: 0.35, end: 0.6 }];
  const at = (t, hold) => { calls.length = 0; lib.captions(ctx, WORDS, t, { safe, voOffset: 0, hold }); return calls.map((x) => x.text); };
  assert.deepEqual(at(0.8, 0.1), [], 'with hold 0.1 the caption is gone 0.2 s after the last word');
  assert.deepEqual(at(0.8, 2), ['Hello', 'there.'], 'with hold 2 it is still up');
});

// ---- council round 2: runs of tags, tags against punctuation, and the anchor search on character timings

test('runs of tags and tags against punctuation are cut so the text still reads as spoken, alone or joined', () => {
  const cases = [
    ['Hello [sighs], world.', 'Hello, world.'], ['Stop now [sighs].', 'Stop now.'],
    ['See [a][b] this now', 'See this now'], ['See [a][b]this now', 'See this now'],
    ['prompt.[sighs][whispers] Save it', 'prompt. Save it'], ['word [a][b]next', 'word next'],
    ['([sighs] hello)', '(hello)'], ['[a][b] word', 'word'], ['[a] [b] word', 'word'], ['prompt. [x]', 'prompt.'],
  ];
  for (const [vo, want] of cases) assert.equal(lib.stripTags(vo), want, vo);
  // a line stripped alone and the same line inside the joined board script give the same words
  const lines = ['See [a][b]', 'this now please friend', 'Stop pasting the same prompt.[sighs]', 'Save it [sighs], please.', 'Hello [x]', '[y] there'];
  for (let i = 0; i + 1 < lines.length; i++) {
    assert.equal(lib.stripTags(`${lines[i]} ${lines[i + 1]}`), `${lib.stripTags(lines[i])} ${lib.stripTags(lines[i + 1])}`, `${lines[i]} | ${lines[i + 1]}`);
  }
  // a run glued to words on both sides would join them, so the board refuses it
  assert.match(lib.boardProblems({ beats: [{ id: 'a', vo: 'x[a][b]y' }] }).join(), /put a space before or after the tag \[a\]\[b\]/);
});

test('an ElevenLabs take with a stacked run and a tag before a comma keeps its words apart, and an anchor across the comma is found', () => {
  const parts = [['See', 0.1, 0.4], [' ', 0.4, 0.45], ['[a][b]', 0.45, 0.55], [' ', 0.55, 0.6], ['this.', 0.6, 1.0], [' ', 1.0, 1.8],
    ['Save it', 1.8, 2.3], [' ', 2.3, 2.35], ['[sighs]', 2.35, 2.75], [', please now.', 2.75, 3.6]];
  const characters = [], s = [], e = [];
  for (const [text, a, b] of parts) {
    for (let k = 0; k < text.length; k++) { characters.push(text[k]); s.push(a + ((b - a) * k) / text.length); e.push(a + ((b - a) * (k + 1)) / text.length); }
  }
  const audio = synthAudio({ duration: 4.0, words: [{ start: 0.1, end: 0.4 }, { start: 0.6, end: 1.0 }, { start: 1.8, end: 2.3 }, { start: 2.75, end: 3.6 }],
    tags: [{ start: 0.45, end: 0.55, long: false }, { start: 2.35, end: 2.75, long: true }] });
  const take = fromElevenLabs({ alignment: { characters, character_start_times_seconds: s, character_end_times_seconds: e } });
  assert.equal(take.chars.text, 'See this. Save it, please now.');
  assert.deepEqual(take.words.map((w) => w.text), ['See', 'this.', 'Save', 'it,', 'please', 'now.']);
  const board = { beats: [{ id: 'a', vo: 'See [a][b] this.' }, { id: 'b', vo: 'Save it [sighs], please now.', anchor: 'it, please' }] };
  const r = buildCues({ board, take, samples: audio });
  near(r.cues.CUE.b, take.chars.starts[take.chars.text.indexOf('it, please')], '"b" cues on "it, please"');
});

test('on character timings too, the next anchor is searched for after the previous anchor\'s last character', () => {
  const tokens = [
    ['Stop', 0.12, 0.38], ['pasting', 0.42, 0.80], ['the', 0.84, 0.95], ['same', 0.99, 1.30], ['prompt', 1.34, 1.70], ['into', 1.74, 1.90], ['chat.', 1.94, 2.30],
    ['Paste', 3.00, 3.30], ['the', 3.34, 3.45], ['same', 3.49, 3.80], ['prompt', 3.84, 4.20], ['into', 4.24, 4.40], ['a', 4.44, 4.50], ['skill.', 4.54, 5.00],
  ];
  const audio = synthAudio({ duration: 5.5, words: tokens.map(([, start, end]) => ({ start, end })) });
  const take = fromElevenLabs(elevenlabsFrom(tokens));
  assert.ok(take.chars, 'this take is matched on characters');
  const board = { beats: [{ id: 'hook', vo: 'Stop pasting the same prompt into chat.' }, { id: 'save', vo: 'Paste the same prompt into a skill.', anchor: 'the same prompt' }] };
  const r = buildCues({ board, take, samples: audio });
  near(r.cues.CUE.save, 3.34, '"save" cues on "the same prompt" in its own line');
});

// ---- council round 3: spans of tags separated by spaces, quotes, and one invariant over thousands of lines

test('spans of tags with spaces between them, quotes and brackets are cut so the text reads as spoken', () => {
  const cases = [
    ['Stop now [laughs] [sighs].', 'Stop now.'], ['Save it [sighs] [breath], please now.', 'Save it, please now.'],
    ['Hello [sighs] [whispers], world', 'Hello, world'], ['He said "stop [sighs]" and left now.', 'He said "stop" and left now.'],
    ['Say "[whispers]hello" now.', 'Say "hello" now.'], ['Say “hello [sighs]” now please.', 'Say “hello” now please.'],
    ["the players' [sighs] turn now.", "the players' turn now."], ["players'[sighs] turn now please.", "players' turn now please."],
    ['Say ([whispers]hello) now.', 'Say (hello) now.'], ['now.[x] [y]Hello', 'now. Hello'], ['Well [sighs]... okay', 'Well... okay'],
  ];
  for (const [vo, want] of cases) assert.equal(lib.stripTags(vo), want, vo);
  for (const vo of ['Say ([whispers]hello) now.', 'Say "[whispers]hello" now.', 'x[a] [b]y']) {
    assert.deepEqual(lib.boardProblems({ beats: [{ id: 'a', vo }] }), [], `${vo} is a valid line`);
  }
  // a custom anchor right before a closing mark is found on a take with two spans before it
  const take = fromElevenLabs(elevenlabsFrom([['Stop', 0.1, 0.4], ['now', 0.45, 0.8], ['[laughs]', 0.8, 1.2], ['[sighs].', 1.2, 1.6]]));
  assert.equal(take.chars.text, 'Stop now.');
});

test('invariant: tags put anywhere a writer would put them never merge words, double spaces or strand punctuation', () => {
  let seed = 20261113;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const WORDS = ['Stop', 'pasting', 'the', 'same', 'prompt', 'save', 'it', 'as', 'a', 'skill', 'now', 'please', 'hello', "players'", "it's", 'Claude'];
  const word = () => {
    let w = pick(WORDS);
    const r = rnd();
    if (r < 0.12) w = `"${w}"`; else if (r < 0.18) w = `“${w}”`; else if (r < 0.24) w = `(${w})`; else if (r < 0.28) w = `‘${w}’`;
    if (rnd() < 0.3) w += pick([',', '.', '!', '?', '…', ':', ';', '...']);
    return w;
  };
  const group = () => pick(['[x]', '[sighs][whispers]', '[laughs] [sighs]', '[a] [b] [c]']);
  const isWord = (ch) => /[\p{L}\p{N}]/u.test(ch || '');
  // where a writer would put a tag: before a closing mark or quote, after an opening one (a quote opens after a
  // space or the start, and closes before a space, a closing mark or the end)
  const Q = /["'“”‘’]/, CL = /[,.;:!?…)]/;
  const closing = (s, i) => CL.test(s[i]) || (Q.test(s[i]) && (i + 1 >= s.length || s[i + 1] === ' ' || CL.test(s[i + 1]) || (Q.test(s[i + 1]) && closing(s, i + 1))));
  const opening = (s, i) => s[i] === '(' || (Q.test(s[i]) && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '(' || (Q.test(s[i - 1]) && opening(s, i - 1))));
  // Every way a tag group can go into `base` at a natural spot: at the ends, at a space (with a space on both
  // sides, glued left or glued right), before a closing mark (glued, or after a space) and after an opening one.
  function insertions(base) {
    const out = [], g = group, at = (i, ins) => base.slice(0, i) + ins + base.slice(i);
    out.push(`${g()} ${base}`, `${g()}${base}`, `${base} ${g()}`, `${base}${g()}`);
    for (let i = 1; i < base.length; i++) {
      if (base[i] === ' ') out.push(at(i, ` ${g()}`), at(i, g()), at(i + 1, g()));
      else if (closing(base, i) && base[i - 1] !== ' ') out.push(at(i, g()), at(i, ` ${g()}`));
      else if (opening(base, i - 1) && isWord(base[i])) out.push(at(i, g()), at(i, `${g()} `));
    }
    return out;
  }
  let checked = 0;
  const bad = [];
  for (let n = 0; n < 400; n++) {
    const base = Array.from({ length: 3 + Math.floor(rnd() * 5) }, word).join(' ');
    const lines = insertions(base);
    for (const line of lines) {
      checked++;
      if (lib.stripTags(line) !== base) bad.push(`strip ${JSON.stringify(line)} -> ${JSON.stringify(lib.stripTags(line))}`);
      if (lib.boardProblems({ beats: [{ id: 'a', vo: line }] }).length) bad.push(`board refuses ${JSON.stringify(line)}`);
    }
    // the take's character path cuts the same way, and two lines joined into one script read as the two lines do
    const line = pick(lines), next = insertions(Array.from({ length: 3 }, word).join(' '));
    const other = pick(next), otherBase = lib.stripTags(other);
    const chars = fromElevenLabs(elevenlabsFrom([[line, 0, 1]])).chars.text;
    if (chars !== base) bad.push(`chars ${JSON.stringify(line)} -> ${JSON.stringify(chars)}`);
    const joined = lib.stripTags(`${line} ${other}`);
    if (joined !== `${base} ${otherBase}`) bad.push(`join ${JSON.stringify(line)} + ${JSON.stringify(other)} -> ${JSON.stringify(joined)}`);
    if (bad.length > 12) break;
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} of ${checked} lines read wrong`);
  assert.ok(checked > 5000, `only ${checked} lines checked`);
});
