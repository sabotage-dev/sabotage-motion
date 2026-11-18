// P10, caption a clip (plan 23.5), without a browser: the transcript adapters (whisper.cpp JSON, SRT, WebVTT: the word
// spread and the estimate flag) on committed fixtures, the frame-rate probe's arithmetic, the clip's cues and board,
// the caption styles and the energy mapping, the target zones scaled to a clip, the composite's provenance and the
// decoded-picture probe. test/clip.test.mjs runs the whole path with ffmpeg and Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { templateDir, fixturesDir } from './helpers.mjs';

const T = await import(pathToFileURL(path.join(templateDir, 'tools', 'cues.mjs')).href);
const K = await import(pathToFileURL(path.join(templateDir, 'tools', 'clip.mjs')).href);
const L = await import(pathToFileURL(path.join(templateDir, 'lib.js')).href);
const C = await import(pathToFileURL(path.join(templateDir, 'check.mjs')).href);
const FX = path.join(fixturesDir, 'transcripts');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const plain = (take) => take.words.map((w) => [w.text, w.start, w.end, !!w.est]);

test('whisper.cpp JSON with tokens (-ojf): words from tokens, special tokens left out, punctuation joined, none estimated', () => {
  const t = T.normalizeTake('whispercpp', JSON.parse(read('sync.whispercpp.json')));
  assert.equal(t.source, 'whispercpp');
  assert.deepEqual(plain(t), [['Ready,', 0.3, 0.65, false], ['set...', 0.65, 0.9, false], ['Now', 1.5, 1.9, false], ['go.', 2.2, 2.6, false]]);
  assert.equal(t.estimated, undefined);
});

test('whisper.cpp JSON without tokens: a one-word segment (-ml 1) is exact, a longer one is spread by length and estimated', () => {
  const t = T.fromWhisperCpp(JSON.parse(read('words.whispercpp.json')));
  assert.deepEqual(plain(t).slice(0, 2), [['Ready,', 0.3, 0.65, false], ['set...', 0.65, 0.9, false]]);
  // "now go." over 1.5-2.6 s: 3 letters and 2, so 0.66 s and 0.44 s
  assert.deepEqual(plain(t).slice(2), [['now', 1.5, 2.16, true], ['go.', 2.16, 2.6, true]]);
  assert.equal(t.estimated, 2);
  assert.throws(() => T.fromWhisperCpp({ segments: [] }), /transcription\[\]/);
});

test('SRT: phrases spread over their times by length, every word estimated, markup and tags out of the words', () => {
  const t = T.normalizeTake('srt', read('clip.srt'));
  assert.equal(t.source, 'srt');
  assert.deepEqual(t.words.map((w) => w.text), ['Ready,', 'set...', 'Now', 'wonderful', 'go.']);
  assert.ok(t.words.every((w) => w.est === true), 'every SRT word is estimated');
  assert.equal(t.estimated, 5);
  // "Ready, set..." over 0.3-0.9 s: 5 letters and 3
  assert.deepEqual(plain(t).slice(0, 2), [['Ready,', 0.3, 0.675, true], ['set...', 0.675, 0.9, true]]);
  // the phrase's words cover it end to end, in order, longer words longer
  const p2 = t.words.slice(2);
  assert.equal(p2[p2.length - 1].end, 2.6);
  assert.ok(p2[1].end - p2[1].start > p2[0].end - p2[0].start, 'wonderful lasts longer than Now');
  assert.deepEqual(t.tags.map((x) => x.text), ['[music]'], 'a [music] note is a tag, never a caption');
  assert.ok(Math.abs(t.tags[0].start - 1.5) < 1e-9);
});

test('WebVTT: the header, NOTE and STYLE blocks, cue ids and settings, voice and timestamp tags and entities are handled', () => {
  const t = T.fromVtt(read('clip.vtt'));
  assert.equal(t.source, 'vtt');
  assert.deepEqual(t.words.map((w) => w.text), ['Ready,', 'set...', 'Now', 'go', '&', 'win.']);
  assert.ok(t.words.every((w) => w.est));
  assert.equal(t.words[0].start, 0.3);
  assert.equal(t.words[t.words.length - 1].end, 2.6);
  assert.throws(() => T.fromVtt(read('clip.srt')), /starts with WEBVTT/);
  assert.throws(() => T.fromSrt('1\nno times here\n'), /no cues/);
  assert.throws(() => T.fromSrt('1\n00:00:01,000 --> soon\nhi\n'), /cannot read the times/);
});

test('spreadPhrase: by letters and digits, at least one each, end to end', () => {
  const w = T.spreadPhrase('a bb, 1234!', 0, 7);
  assert.deepEqual(w.map((x) => [x.text, x.start, x.end]), [['a', 0, 1], ['bb,', 1, 3], ['1234!', 3, 7]]);
  assert.deepEqual(T.spreadPhrase('-- hi', 0, 3).map((x) => x.end), [1, 3], 'a word of no letters weighs 1');
});

test('tools/cues.mjs reads the new kinds too, and names them in its refusal', () => {
  assert.equal(T.normalizeTake('vtt', read('clip.vtt')).words.length, 6);
  assert.deepEqual(T.TEXT_KINDS, ['srt', 'vtt']);
  assert.throws(() => T.normalizeTake('ass', ''), /words, elevenlabs, whisper, whispercpp, srt or vtt/);
});

test('the transcript kind comes from the extension or the JSON\'s shape', () => {
  assert.equal(K.transcriptKind('a.SRT', ''), 'srt');
  assert.equal(K.transcriptKind('a.vtt', ''), 'vtt');
  assert.equal(K.transcriptKind('a.json', read('sync.whispercpp.json')), 'whispercpp');
  assert.equal(K.transcriptKind('a.json', '{"segments":[]}'), 'whisper');
  assert.equal(K.transcriptKind('a.json', '{"words":[]}'), 'words');
  assert.throws(() => K.transcriptKind('a.json', '{"x":1}'), /name it with --from/);
  assert.throws(() => K.transcriptKind('a.txt', 'hello'), /not \.srt, \.vtt or JSON/);
});

test('frame rate: constant packets are constant; one interval 25% off the median is variable; the average rounds to the nearest standard rate', () => {
  const cfr = Array.from({ length: 60 }, (_, i) => i / 30);
  assert.equal(K.rateOf(cfr).vfr, false);
  assert.ok(Math.abs(K.rateOf(cfr).avg - 30) < 1e-9);
  const vfr = [...Array.from({ length: 30 }, (_, i) => i / 30), ...Array.from({ length: 20 }, (_, i) => 1 + i / 20)];
  assert.equal(K.rateOf(vfr).vfr, true);
  // 24% off is still constant (rounding in a container's timebase)
  const jitter = cfr.map((t, i) => (i === 10 ? t + (0.24 / 30) : t));
  assert.equal(K.rateOf(jitter).vfr, false);
  assert.equal(K.rateOf([0, 0, 1 / 30]).vfr, true, 'two frames at one time');
  assert.deepEqual(K.nearestRate(25.13), [25, '25/1']);
  assert.deepEqual(K.nearestRate(29.6), [30000 / 1001, '30000/1001']);
  assert.deepEqual(K.nearestRate(23.99), [24, '24/1']);
  assert.deepEqual(K.nearestRate(23.97), [24000 / 1001, '24000/1001']);
  assert.deepEqual(K.nearestRate(58), [60000 / 1001, '60000/1001']);
  assert.deepEqual(K.RATES.map((r) => +r[0].toFixed(3)), [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]);
});

test('the clip\'s cues: VO_OFFSET 0, no CUE, no gaps, the words at their own times with the estimate kept; a board of one silent beat times without lead or tail', () => {
  const board = K.clipBoard({ dur: 3, target: 'tiktok', title: 'x' });
  const cues = K.clipCues(T.fromSrt(read('clip.srt')), { dur: 3, board });
  assert.equal(cues.VO_OFFSET, 0);
  assert.deepEqual(cues.CUE, {});
  assert.deepEqual(cues.GAPS, []);
  assert.deepEqual(cues.TAKE, { duration: 3, lastWordEnd: 2.6 });
  assert.equal(cues.WORDS[0].start, 0.3);
  assert.ok(cues.WORDS.every((w) => w.est === true));
  const timing = L.boardTiming(board, cues);
  assert.ok(timing.ok, timing.problems.join('; '));
  assert.deepEqual(timing.windows.map((w) => [w.id, w.start, w.end]), [['clip', 0, 3]]);
  assert.equal(timing.voOffset, 0);
  assert.equal(timing.dur, 3, 'no lead, no tail');
  assert.equal(L.boardOrder(timing, 3, 30).length, 0);
  assert.throws(() => K.clipCues(T.fromSrt(read('clip.srt')), { dur: 2, board }), /at or after the clip's end/);
});

test('a clip\'s board: one silent beat of the clip\'s length, else refused with the length to use', () => {
  assert.deepEqual(K.boardFits(K.clipBoard({ dur: 3, target: 'tiktok', title: 'x' }), 3), []);
  assert.match(K.boardFits(K.clipBoard({ dur: 3, target: 'tiktok', title: 'x' }), 3.5).join(), /dur: 3\.5/);
  assert.match(K.boardFits({ beats: [{ id: 'a', dur: 1 }, { id: 'b', dur: 2 }] }, 3).join(), /single silent beat/);
  assert.match(K.boardFits({ beats: [{ id: 'a', vo: 'hello there' }] }, 3).join(), /single silent beat/);
  // the board text loads as a module that exports it
  const src = K.boardText(K.clipBoard({ dur: 2.5, target: 'reels', title: 'A "quoted" title' }));
  assert.match(src, /^export const BOARD = \{/m);
  assert.match(src, /dur: 2\.5/);
  assert.match(src, /sfx: null/);
});

test('captionStyleFor: subtle -> minimal, normal -> pop, extreme -> karaoke, normal by default; captionStyle merges a style', () => {
  assert.equal(L.captionStyleFor('subtle'), 'minimal');
  assert.equal(L.captionStyleFor('normal'), 'pop');
  assert.equal(L.captionStyleFor('extreme'), 'karaoke');
  assert.equal(L.captionStyleFor(undefined), 'pop');
  assert.equal(L.captionStyleFor(''), 'pop');
  assert.throws(() => L.captionStyleFor('wild'), /subtle, normal, extreme/);
  assert.deepEqual(Object.keys(L.CAPTION_STYLES), ['pop', 'karaoke', 'boxed', 'minimal']);
  const k = L.captionStyle('karaoke', { size: 64, accent: '#00FF00' });
  assert.equal(k.pop, 'none'); assert.equal(k.fill, 'spoken'); assert.equal(k.accent, '#00FF00'); assert.equal(k.style, 'karaoke');
  assert.equal(L.captionStyle('minimal', { size: 100 }).size, 80, 'minimal sets smaller type');
  assert.ok(L.captionStyle('boxed').plate, 'boxed draws a plate');
  assert.equal(L.captionStyle('pop').pop, 'anticip');
  assert.throws(() => L.captionStyle('neon'), /pop, karaoke, boxed, minimal/);
});

test('a target\'s zones on a clip: its own size as is, the same shape scaled, another shape unknown', () => {
  const z = { name: 'tiktok-ad', w: 1080, h: 1920, safe: { x: 120, y: 240, w: 840, h: 1020 }, exclude: [{ x: 780, y: 840, w: 180, h: 420 }] };
  assert.equal(L.scaleTarget(z, 1080, 1920), z);
  const s = L.scaleTarget(z, 720, 1280);
  assert.equal(s.scaled, 2 / 3);
  assert.deepEqual(s.safe, { x: 80, y: 160, w: 560, h: 680 });
  assert.deepEqual(s.exclude, [{ x: 520, y: 560, w: 120, h: 280 }]);
  assert.equal(L.scaleTarget(z, 1080, 1080), null, 'a square clip has no tiktok zones');
  assert.equal(L.scaleTarget(z, 1920, 1080), null, 'nor a landscape one');
  assert.equal(L.scaleTarget(null, 720, 1280), null);
});

const COMP = { overlayFile: 'out/x.mov.render.json', overlaySha: 'a'.repeat(64), overlayExists: true, overlayShaNow: 'a'.repeat(64),
  overlayRec: { scene: 'caption.js', alpha: 'prores', source: { hash: 'sha256:s1' } }, sourceNow: { hash: 'sha256:s1' },
  clipFile: 'clip.mp4', clipSha: 'c'.repeat(64), clipExists: true, clipShaNow: 'c'.repeat(64) };
test('composite provenance: bound when the overlay record is there, matches its hash, is alpha and binds to the source, over the same clip', () => {
  const ok = C.compositeProvenance(COMP);
  assert.equal(ok.result.level, 'OK');
  assert.equal(ok.bound, true);
  assert.equal(ok.overlayRec, COMP.overlayRec);
  const fail = (f, re) => { const x = C.compositeProvenance({ ...COMP, ...f }); assert.equal(x.result.level, 'FAIL'); assert.equal(x.bound, false); assert.match(x.result.detail, re); };
  fail({ sourceNow: { hash: 'sha256:s2' } }, /the overlay is stale/);
  fail({ overlayExists: false }, /is missing/);
  fail({ overlayShaNow: 'b'.repeat(64) }, /changed after the composite/);
  fail({ overlayRec: { ...COMP.overlayRec, alpha: null } }, /not an alpha render/);
  fail({ overlayFile: null }, /names no overlay record/);
  fail({ clipShaNow: 'd'.repeat(64) }, /not the one composited/);
  fail({ clipExists: false }, /clip clip\.mp4 is missing/);
  fail({ overlayRecError: 'bad json', overlayRec: undefined }, /not readable/);
});

test('the decoded-picture probe measures what the page\'s probe does: Rec. 709 luma, pair histograms and the first frame', () => {
  const s = C.lumaScan();
  const frame = (r, g, b) => Buffer.from(Array.from({ length: 4 }, () => [r, g, b]).flat());
  s.add(frame(255, 0, 0), 2, 2);   // luma 54
  s.add(frame(0, 255, 0), 2, 2);   // luma 182
  s.add(frame(0, 255, 0), 2, 2);
  const d = s.done();
  assert.equal(d.frames, 3);
  assert.deepEqual(d.first, { mean: 54, std: 0, w: 2, h: 2 });
  assert.deepEqual(d.pairs, [{ 128: 4 }, {}]);
  assert.equal(C.motionDead(d.pairs, { fps: 1 })[0].level, 'OK');
  const f = C.lumaScan({ firstOnly: true });
  f.add(frame(10, 10, 10), 2, 2); f.add(frame(200, 200, 200), 2, 2);
  assert.equal(f.done().pairs, null);
  assert.equal(f.done().first.mean, 10);
});

test('P10 R1 B3 display geometry: pixels\' aspect and rotation give the display size; a clip needs converting for a variable rate or non-square pixels', () => {
  assert.deepEqual(K.displaySize(720, 576, [64, 45], 0), [1024, 576]);
  assert.deepEqual(K.displaySize(720, 576, [16, 15], 0), [768, 576]);
  assert.deepEqual(K.displaySize(1920, 1080, null, 90), [1080, 1920]);
  assert.deepEqual(K.displaySize(720, 576, [64, 45], 270), [576, 1024]);
  assert.deepEqual(K.sarOf({ sample_aspect_ratio: '64:45' }), [64, 45]);
  for (const x of ['1:1', '0:1', 'N/A', undefined]) assert.equal(K.sarOf({ sample_aspect_ratio: x }), null, String(x));
  assert.equal(K.normalizePlan({ vfr: false, sar: null }), null);
  assert.deepEqual(K.normalizePlan({ vfr: false, sar: [64, 45], w: 1024, h: 576 }), { rate: null, size: [1024, 576], crop: null });
  assert.deepEqual(K.normalizePlan({ vfr: false, sar: [10, 11], w: 655, h: 480 }).size, [656, 480], 'made even for yuv420p');
  assert.deepEqual(K.normalizePlan({ vfr: true, avgFps: 29.6, sar: null }), { rate: [30000 / 1001, '30000/1001'], size: null, crop: null });
});

test('P10 R1 B1 a transcript moved onto the clip\'s clock: every word by the shift; a word moved before the first frame is refused', () => {
  const board = K.clipBoard({ dur: 3, target: 'tiktok', title: 'x' });
  const take = { words: [{ text: 'Now', start: 1.0, end: 1.4 }, { text: 'go.', start: 1.7, end: 2.0 }] };
  const c = K.clipCues(take, { dur: 3, board, shift: 0.5 });
  assert.deepEqual(c.WORDS.map((w) => [w.start, w.end]), [[1.5, 1.9], [2.2, 2.5]]);
  assert.equal(c.VO_OFFSET, 0, 'the shift is in the words, never in VO_OFFSET');
  assert.equal(c.TAKE.lastWordEnd, 2.5);
  assert.deepEqual(K.clipCues(take, { dur: 3, board }).WORDS[0].start, 1.0, 'no shift by default');
  // P10 R2 D2: words the shift puts before the first frame are dropped (ending at or before 0) or start at 0 (straddling it)
  const lead = K.clipCues({ words: [{ text: 'um', start: 0.1, end: 0.25 }, ...take.words] }, { dur: 3, board, shift: -1.2 });
  assert.deepEqual(lead.WORDS.map((w) => [w.text, w.start, w.end]), [['Now', 0, 0.2], ['go.', 0.5, 0.8]]);
  assert.deepEqual(lead.lead, { dropped: 1, clipped: 1 });
  assert.ok(!Object.keys(lead).includes('lead'), 'never written into the cues');
  assert.throws(() => K.clipCues(take, { dur: 3, board, shift: -2.5 }), /every word ends before the clip's first frame after the -2\.500 s shift/);
  assert.throws(() => K.clipCues(take, { dur: 3, board, shift: 1.5 }), /at or after the clip's end/);
});

test('P10 R2 D3 an odd width or height is cropped by one pixel to an even size; D1 a re-prepared clip records the track it extracts', () => {
  assert.deepEqual(K.normalizePlan({ vfr: false, sar: null, w: 321, h: 569 }), { rate: null, size: null, crop: [320, 568] });
  assert.deepEqual(K.normalizePlan({ vfr: false, sar: null, w: 320, h: 569 }).crop, [320, 568]);
  assert.equal(K.normalizePlan({ vfr: false, sar: null, w: 320, h: 568 }), null);
  assert.equal(K.normalizePlan({ vfr: false, sar: [64, 45], w: 1024, h: 577 }).crop, null, 'the square-pixel scale makes it even already');
  const prev = { file: 'two.mp4', vfr: false, avgFps: 30, audio: 0, audioOffset: 0 };
  assert.deepEqual(K.fromAgain(prev, 1, 0.5), { ...prev, audio: 1, audioOffset: 0.5 });
  const conv = { ...prev, convertedTo: '25/1' };
  assert.deepEqual(K.fromAgain(conv, 0, 0.02), conv, 'a converted clip keeps the source track it was made from');
});
