// tools/cues.mjs: a voice take's word or character timings -> cues.js (plan section 7).
//
//   node tools/cues.mjs [--from words|elevenlabs|whisper <file>] [--audio <file>] [--offset <s>] [--dry-run]
//
// Reads board.js and a timing file (default: --from words take.json) and the take's audio (default
// take-raw.wav), finds each voiced beat's anchor in the take, opens the silences the board asks for, and
// only when every check passes writes:
//   cues.js, cues.json  VO_OFFSET, CUE (beat ids only), TAKE, GAPS, HOOK_END, WORDS (section 7.3)
//   vo.wav              the take with those silences spliced in (48 kHz mono, 32-bit float)
//   take.json           the timings in the generic format, when they came from another file
//   take-raw.wav        the raw take as a 48 kHz WAV, when --audio names another file
// It checks everything before it writes anything, so a bad take never replaces a good cues.js. It refuses
// when an anchor is not in the take, a gapBefore would split speech, the hook ends after BOARD.hookMax,
// --offset is below the leading silent beats, or a beat window would be empty (two anchors closer than
// `lead`, or out of order). Paths resolve against the piece (this tool's parent folder), like render.mjs.
//
// Timing sources (section 7.2; every adapter moves delivery tags like [curious] out of the words):
//   words       the generic format: { words: [{ text, start, end }], chars?: { text, starts, ends },
//               tags?: [{ text, start, end }], duration?, sampleRate?, source? }
//   elevenlabs  the text-to-speech "with timestamps" response JSON: alignment.characters,
//               alignment.character_start_times_seconds, alignment.character_end_times_seconds
//   whisper     openai-whisper's JSON output written with --word_timestamps True:
//               segments[].words[] with word, start, end
// Anchors match on the characters when the source has them (exact phrase, case-sensitive), else on the
// words (case-sensitive, punctuation stripped at word edges).
//
// Silences (sections 6.3 and 7.4):
//   gapBefore   cut at the quietest 10 ms between the previous word (or closing tag) and the anchor;
//               refused when that point is louder than -50 dBFS or there is no pause at all
//   silent beats between voiced beats: their summed dur of zeros at max(prevWordEnd, cue - lead), or
//               at the anchor (with a warning) when the take runs straight into it
// Every splice has a 5 ms fade out before the zeros and a 5 ms fade in after them; later times shift.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tagCuts, voTokens, normWord, anchorOf, anchorOffset, boardProblems, boardTiming, boardKey, hookBeat, hookLong, BOARD_DEFAULTS } from '../lib.js';

export const SR = 48000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const fmt = (x, d = 3) => (x == null ? '-' : Number(x).toFixed(d));

// A refusal: every reason, so the person can fix them all at once.
export class CueError extends Error {
  constructor(problems) {
    const list = [].concat(problems);
    super(list.join('\n'));
    this.problems = list;
  }
}

// ---------------------------------------------------------------- adapters -> { source, words, chars?, tags }

// Character timings with the tags cut out by the same rule as lib.js's stripTags (the tag plus one
// adjacent space), so the text reads as spoken and matches the board's vo lines.
function splitChars(text, starts, ends) {
  const keep = new Array(text.length).fill(true), tags = [];
  for (const c of tagCuts(text)) {
    tags.push({ text: c.text, start: starts[c.a], end: ends[c.b - 1] });
    for (let i = c.ca; i < c.cb; i++) keep[i] = false;
  }
  let t = '';
  const s = [], e = [];
  for (let i = 0; i < text.length; i++) if (keep[i]) { t += text[i]; s.push(starts[i]); e.push(ends[i]); }
  return { chars: { text: t, starts: s, ends: e }, tags };
}
function wordsFromChars(chars) {
  return [...chars.text.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: chars.starts[m.index], end: chars.ends[m.index + m[0].length - 1] }));
}
// A word list (from an ASR tool or the generic format) as one timed string, so a tag that spans several
// words ("[short", "pause]") or is glued to one ("instead.[laughs]") comes out the same way as from chars.
function splitWordList(list) {
  let text = '';
  const starts = [], ends = [];
  list.forEach((w, i) => {
    if (i) { text += ' '; starts.push(list[i - 1].end); ends.push(w.start); }
    for (let k = 0; k < w.text.length; k++) { text += w.text[k]; starts.push(w.start); ends.push(w.end); }
  });
  const { chars, tags } = splitChars(text, starts, ends);
  return { words: wordsFromChars(chars), tags };
}
function checkWords(list, what) {
  const p = [];
  list.forEach((w, i) => {
    if (!w || typeof w.text !== 'string' || !Number.isFinite(w.start) || !Number.isFinite(w.end)) p.push(`${what} ${i + 1} needs text, start and end`);
    else if (w.end < w.start) p.push(`${what} ${i + 1} ("${w.text}") ends before it starts`);
    else if (i && Number.isFinite(list[i - 1].start) && w.start < list[i - 1].start - 1e-9) p.push(`${what} ${i + 1} ("${w.text}") starts before the one before it`);
  });
  if (p.length) throw new CueError(p.slice(0, 10));
}
const byStart = (a, b) => a.start - b.start;

export function fromWords(json) {
  if (!json || !Array.isArray(json.words)) throw new CueError('words: expected { "words": [{ "text", "start", "end" }] }');
  const list = json.words.map((w) => ({ ...w, text: String(w && w.text != null ? w.text : '').trim(), start: +(w && w.start), end: +(w && w.end) })).filter((w) => w.text);
  checkWords(list, 'word');
  const base = splitWordList(list);
  let chars = null, tags = [...base.tags];
  if (json.chars) {
    const c = json.chars;
    if (typeof c.text !== 'string' || !Array.isArray(c.starts) || !Array.isArray(c.ends) || c.starts.length !== c.text.length || c.ends.length !== c.text.length) {
      throw new CueError('words: chars needs text plus starts and ends with one time per character of text');
    }
    const sc = splitChars(c.text, c.starts.map(Number), c.ends.map(Number));
    chars = sc.chars;
    tags.push(...sc.tags);
  }
  if (json.tags) {
    if (!Array.isArray(json.tags)) throw new CueError('words: tags must be a list of { text, start, end }');
    const t = json.tags.map((x) => ({ text: String(x.text), start: +x.start, end: +x.end }));
    checkWords([...t].sort(byStart), 'tag');
    tags.push(...t);
  }
  // the same tag given twice (in words and in tags, or in chars and in tags) counts once
  const seen = new Set();
  tags = tags.sort(byStart).filter((t) => { const k = `${t.text.toLowerCase()}@${t.start.toFixed(4)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { source: json.source || 'words', words: base.words, ...(chars ? { chars } : {}), tags };
}

export function fromElevenLabs(json) {
  const al = json && (json.alignment || (Array.isArray(json.characters) ? json : null));
  if (!al || !Array.isArray(al.characters)) throw new CueError('elevenlabs: no alignment.characters in this file (save the with-timestamps response JSON)');
  const S = al.character_start_times_seconds, E = al.character_end_times_seconds;
  if (!Array.isArray(S) || !Array.isArray(E) || S.length !== al.characters.length || E.length !== al.characters.length) {
    throw new CueError('elevenlabs: alignment needs character_start_times_seconds and character_end_times_seconds, one per character');
  }
  let text = '';
  const starts = [], ends = [];
  al.characters.forEach((c, i) => { for (let k = 0; k < String(c).length; k++) { text += String(c)[k]; starts.push(+S[i]); ends.push(+E[i]); } });
  const { chars, tags } = splitChars(text, starts, ends);
  return { source: 'elevenlabs', words: wordsFromChars(chars), chars, tags: tags.sort(byStart) };
}

export function fromWhisper(json) {
  if (!json || !Array.isArray(json.segments)) throw new CueError('whisper: no segments[] (expected openai-whisper\'s JSON output)');
  const list = [];
  for (const seg of json.segments) {
    if (!Array.isArray(seg.words)) throw new CueError('whisper: a segment has no words[]; run whisper with --word_timestamps True');
    for (const w of seg.words) { const text = String(w.word == null ? '' : w.word).trim(); if (text) list.push({ text, start: +w.start, end: +w.end }); }
  }
  checkWords(list, 'word');
  const { words, tags } = splitWordList(list);
  return { source: 'whisper', words, tags: tags.sort(byStart) };
}

export function normalizeTake(kind, json) {
  if (kind === 'words') return fromWords(json);
  if (kind === 'elevenlabs') return fromElevenLabs(json);
  if (kind === 'whisper') return fromWhisper(json);
  throw new CueError(`--from ${kind}: unknown timing source (words, elevenlabs or whisper)`);
}

// ---------------------------------------------------------------- audio

// Any audio ffmpeg reads, as 48 kHz mono float samples.
export function readAudio(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.error) throw new CueError(`could not run ffmpeg to read ${path.basename(file)}: ${r.error.message}`);
  if (r.status !== 0) throw new CueError(`ffmpeg could not read ${path.basename(file)}: ${String(r.stderr).trim().split('\n').pop()}`);
  const b = r.stdout, out = new Float32Array(b.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
  return out;
}
// A mono 32-bit float WAV (WAVE_FORMAT_IEEE_FLOAT, with the fact chunk that format asks for).
export function wavFloat(samples, sr = SR) {
  const n = samples.length, b = Buffer.alloc(58 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(50 + n * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(18, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34); b.writeUInt16LE(0, 36);
  b.write('fact', 38); b.writeUInt32LE(4, 42); b.writeUInt32LE(n, 46);
  b.write('data', 50); b.writeUInt32LE(n * 4, 54);
  for (let i = 0; i < n; i++) b.writeFloatLE(samples[i], 58 + i * 4);
  return b;
}

// The quietest 10 ms window inside [t0, t1]: its centre and its RMS level in dBFS.
function quietest(samples, sr, t0, t1) {
  const win = Math.round(0.010 * sr), a = Math.max(0, Math.ceil(t0 * sr)), b = Math.min(samples.length, Math.floor(t1 * sr));
  if (b - a < win) return null;
  const pre = new Float64Array(b - a + 1);
  for (let i = a; i < b; i++) pre[i - a + 1] = pre[i - a] + samples[i] * samples[i];
  let best = Infinity, at = a;
  for (let i = a; i + win <= b; i++) { const e = pre[i - a + win] - pre[i - a]; if (e < best - 1e-15) { best = e; at = i; } }
  const ms = best / win;
  return { at: (at + win / 2) / sr, db: ms > 0 ? 10 * Math.log10(ms) : -Infinity };
}

// ---------------------------------------------------------------- matching

const isWordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
// Whitespace runs collapsed to one space, with a map back to the original indices.
function collapse(text) {
  let s = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) { if (s && s[s.length - 1] !== ' ') { s += ' '; map.push(i); } } else { s += text[i]; map.push(i); }
  }
  return { s, map };
}
// Every place the phrase occurs in the take, in order: { time, pos, end }, pos and end being the char or word
// index of its first and last character or word.
function occurrences(take, phrase) {
  if (take.chars) {
    const { s, map } = collapse(take.chars.text), p = collapse(phrase.trim()).s, out = [];
    if (!p) return out;
    for (let i = s.indexOf(p); i >= 0; i = s.indexOf(p, i + 1)) {
      if (isWordChar(p[0]) && isWordChar(s[i - 1])) continue;
      if (isWordChar(p[p.length - 1]) && isWordChar(s[i + p.length])) continue;
      out.push({ pos: map[i], end: map[i + p.length - 1], time: take.chars.starts[map[i]] });
    }
    return out;
  }
  const want = phrase.split(/\s+/).map(normWord).filter(Boolean), out = [];
  const have = take.words.map((w, i) => ({ w: normWord(w.text), i })).filter((x) => x.w);
  for (let k = 0; k + want.length <= have.length; k++) {
    if (want.every((x, j) => have[k + j].w === x)) out.push({ pos: have[k].i, end: have[k + want.length - 1].i, time: take.words[have[k].i].start });
  }
  return out;
}
// The take word under a time (the anchor's first word).
const wordAt = (words, t) => { const i = words.findIndex((w) => w.end > t + 1e-9 || w.start >= t - 1e-9); return i < 0 ? words.length - 1 : i; };
const sameTag = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The tags written directly before a line's anchor (nothing but spaces between), and after its last word.
function lineTags(vo, anchorAt) {
  const toks = voTokens(vo);
  let wi = -1, before = [];
  for (const tk of toks) {
    if (tk.kind === 'tag') { before.push(tk.text); continue; }
    if (!normWord(tk.text)) { before = []; continue; }
    wi++;
    if (wi === anchorAt) break;
    before = [];
  }
  const closing = [];
  for (let i = toks.length - 1; i >= 0 && toks[i].kind === 'tag'; i--) closing.unshift(toks[i].text);
  return { before, closing };
}

// ---------------------------------------------------------------- the cues

// board: BOARD; take: a normalized take (words, chars?, tags); samples: the raw take, mono at sr.
// Returns { cues, vo (Float32Array), warnings, ops, info } or throws CueError with every reason.
export function buildCues({ board, take, samples, sr = SR, offset = null }) {
  const bp = boardProblems(board);
  if (bp.length) throw new CueError(bp);
  const lead = board.lead != null ? board.lead : BOARD_DEFAULTS.lead;
  const beats = board.beats, voiced = beats.filter((b) => b.vo != null);
  if (!voiced.length) throw new CueError('board.js has no voiced beat (a silent piece needs no cues.js)');
  const words = take.words, tags = [...(take.tags || [])].sort(byStart);
  if (!words.length) throw new CueError('the take has no words');
  const duration = samples.length / sr;
  const lastTime = Math.max(...words.map((w) => w.end), ...tags.map((t) => t.end));
  if (lastTime > duration + 0.05) throw new CueError(`the timings run to ${fmt(lastTime)} s but the audio is ${fmt(duration)} s long: is it the right audio file?`);
  for (const w of words) if (w.text.includes('[') || w.text.includes(']')) throw new CueError(`a delivery tag is still in the take's words ("${w.text}")`);

  // 1. every anchor, before anything else, so one run lists every phrase that is missing
  const missing = [], found = [];
  let after = -1;
  for (const b of voiced) {
    const phrase = anchorOf(b), all = occurrences(take, phrase);
    const hit = b.occurrence ? all[b.occurrence - 1] : all.find((o) => o.pos > after);
    if (!hit) {
      const why = !all.length ? 'is not in the take' : b.occurrence ? `occurs ${all.length} time(s), not ${b.occurrence}` : 'is not in the take after the previous beat\'s anchor';
      missing.push(`beat "${b.id}": anchor "${phrase}" ${why} (matching ${take.chars ? 'characters, case-sensitive' : 'words, case-sensitive, punctuation ignored'})`);
      continue;
    }
    // the next default search starts after this anchor's last word, so the next beat's anchor can never be a
    // phrase that overlaps this one ("the same prompt" inside "Stop pasting the same")
    after = hit.end;
    found.push({ beat: b, phrase, hit, wordIdx: wordAt(words, hit.time), offset: anchorOffset(b.vo, phrase) });
  }
  if (missing.length) throw new CueError(missing);

  // 2. cue times (an opening tag moves its beat's cue to the tag's start), tag-aware prevWordEnd
  for (const f of found) {
    const { before } = lineTags(f.beat.vo, f.offset);
    f.cue = f.hit.time;
    if (before.length) {
      const prevEnd = f.wordIdx > 0 ? words[f.wordIdx - 1].end : 0;
      const cand = tags.filter((t) => t.start >= prevEnd - 1e-6 && t.start <= f.hit.time + 1e-6);
      let m = 0;
      while (m < before.length && m < cand.length && sameTag(cand[cand.length - 1 - m].text, before[before.length - 1 - m])) m++;
      if (m) { f.cue = cand[cand.length - m].start; f.openTags = cand.slice(cand.length - m).map((t) => t.text); }
    }
    f.prevWordEnd = Math.max(0, ...words.filter((w) => w.start < f.cue - 1e-9).map((w) => w.end), ...tags.filter((t) => t.start < f.cue - 1e-9).map((t) => t.end));
  }
  const order = [];
  for (let i = 1; i < found.length; i++) {
    if (found[i].cue <= found[i - 1].cue + 1e-9) order.push(`beats "${found[i - 1].beat.id}" and "${found[i].beat.id}": "${found[i].beat.id}"'s anchor (${fmt(found[i].cue)} s) does not come after "${found[i - 1].beat.id}"'s (${fmt(found[i - 1].cue)} s), so a window would be empty; check the anchors or set occurrence`);
  }
  if (order.length) throw new CueError(order);

  // 3. where the hook ends: its line's last word, or the closing tag after it
  const hb = hookBeat(board), hi = found.findIndex((f) => f.beat === hb);
  let hookLast = hi === found.length - 1 ? words.length - 1 : found[hi + 1].wordIdx - Math.max(0, found[hi + 1].offset) - 1;
  hookLast = Math.min(words.length - 1, Math.max(hookLast, found[hi].wordIdx));
  const hookTags = (() => {
    const { closing } = lineTags(hb.vo, found[hi].offset);
    if (!closing.length) return [];
    const nextStart = hookLast + 1 < words.length ? words[hookLast + 1].start : Infinity;
    const cand = tags.filter((t) => t.start >= words[hookLast].end - 1e-6 && t.start < nextStart + 1e-6);
    let m = 0;
    while (m < closing.length && m < cand.length && sameTag(cand[m].text, closing[m])) m++;
    return cand.slice(0, m);
  })();

  // 4. the silences: gapBefore cuts and room for interleaved silent beats, in raw take seconds
  const ops = [], warnings = [], refusals = [];
  for (let vi = 0; vi < found.length; vi++) {
    const f = found[vi], b = f.beat, c = f.cue, pwe = f.prevWordEnd;
    if (b.gapBefore) {
      if (c - pwe < 0.010) refusals.push(`beat "${b.id}": gapBefore needs a pause before its anchor, and the take has ${fmt(Math.max(0, c - pwe))} s there (from the previous word or tag at ${fmt(pwe)} s to the cue at ${fmt(c)} s)`);
      else {
        const q = quietest(samples, sr, pwe, c);
        if (!q || q.db > -50) refusals.push(`beat "${b.id}": the quietest 10 ms between ${fmt(pwe)} s and ${fmt(c)} s is ${q ? fmt(q.db, 1) : '?'} dBFS, louder than -50 dBFS: a cut there would split speech`);
        else ops.push({ kind: 'gapBefore', before: b.id, at: q.at, dur: b.gapBefore, level: q.db });
      }
    }
    if (vi > 0) {
      const i = beats.indexOf(b), j0 = beats.indexOf(found[vi - 1].beat), run = beats.slice(j0 + 1, i).filter((x) => x.dur != null);
      const D = run.reduce((s, x) => s + x.dur, 0);
      if (D > 0) {
        let at;
        if (pwe >= c - 1e-9) {
          at = c;
          warnings.push(`beat "${b.id}": the take runs straight into its anchor (no pause after the word or tag before it), so the ${fmt(D, 2)} s for ${run.map((x) => `"${x.id}"`).join(', ')} is spliced at the anchor itself`);
        } else at = Math.max(pwe, c - lead);
        ops.push({ kind: 'silent', before: b.id, beats: run.map((x) => x.id), at, dur: D });
      }
    }
  }
  if (refusals.length) throw new CueError(refusals);

  // 5. splice: zeros at each point (to the sample), 5 ms fades either side, later times shifted
  const fade = Math.round(0.005 * sr), half = 0.5 / sr;
  const sOps = ops.map((o) => ({ ...o, k: Math.min(samples.length, Math.max(0, Math.round(o.at * sr))), n: Math.round(o.dur * sr) })).sort((a, b) => a.k - b.k);
  const vo = new Float32Array(samples.length + sOps.reduce((s, o) => s + o.n, 0));
  const segs = [];                      // [from, to) of the raw take, copied to `at` in vo.wav
  let pos = 0, w = 0;
  for (const o of sOps) { segs.push({ from: pos, to: o.k, at: w }); w += o.k - pos + o.n; pos = o.k; }
  segs.push({ from: pos, to: samples.length, at: w });
  for (const s of segs) vo.set(samples.subarray(s.from, s.to), s.at);
  for (let i = 0; i < sOps.length; i++) {
    const a = segs[i], b = segs[i + 1], end = a.at + (a.to - a.from);
    for (let j = 0; j < Math.min(fade, a.to - a.from); j++) vo[end - 1 - j] *= (j + 1) / (fade + 1);   // fade out into the zeros
    for (let j = 0; j < Math.min(fade, b.to - b.from); j++) vo[b.at + j] *= (j + 1) / (fade + 1);       // fade in after them
  }
  const shiftAt = (t) => sOps.reduce((s, o) => s + (o.k / sr <= t + half ? o.n / sr : 0), 0);
  const move = (x) => ({ ...x, start: r6(x.start + shiftAt(x.start)), end: r6(x.end + shiftAt(x.start)) });
  const W = words.map(move), T = tags.map(move);
  const CUE = {};
  for (const f of found) CUE[f.beat.id] = r6(f.cue + shiftAt(f.cue));
  const hookEnd = Math.max(W[hookLast].end, ...hookTags.map((t) => T[tags.indexOf(t)].end));
  const lastWordEnd = Math.max(...W.map((x) => x.end), ...T.map((x) => x.end));
  let before = 0;
  const GAPS = sOps.map((o) => {
    const g = { before: o.before, kind: o.kind, at: r6(o.k / sr + before), atRaw: r6(o.k / sr), dur: r6(o.n / sr), ...(o.beats ? { beats: o.beats } : {}) };
    before += o.n / sr;
    return g;
  });

  // 6. VO_OFFSET: the leading silent beats plus lead, or --offset (never under the leading silent beats)
  let leadSum = 0;
  for (const b of beats) { if (b.vo != null) break; leadSum += b.dur; }
  const VO_OFFSET = offset == null ? r6(leadSum + lead) : r6(offset);
  if (offset != null && offset < leadSum - 1e-9) {
    throw new CueError(`--offset ${offset} is less than the leading silent beats (${fmt(leadSum, 2)} s): the voice would play over them`);
  }
  const cues = { VO_OFFSET, CUE, TAKE: { duration: r6(vo.length / sr), lastWordEnd: r6(lastWordEnd) }, GAPS, HOOK_END: r6(hookEnd),
    WORDS: W.map((x) => ({ text: x.text, start: x.start, end: x.end })), BOARD_KEY: boardKey(board) };

  // 7. the hook gate, then the windows
  const late = hookLong(board, cues);
  if (late && !late.ok) {
    throw new CueError(`the hook ("${late.hook}") ends at ${fmt(late.end)} s picture time (VO_OFFSET ${fmt(VO_OFFSET)} + HOOK_END ${fmt(cues.HOOK_END)}), ${fmt(late.over)} s after BOARD.hookMax ${board.hookMax}: shorten the hook line or take it faster`);
  }
  const timing = boardTiming(board, cues);
  if (!timing.ok) throw new CueError(timing.problems);
  return { cues, vo, warnings, ops: GAPS, timing, tags: T, info: { leadSum, lead, hook: hb.id, found: found.map((f) => ({ id: f.beat.id, phrase: f.phrase, raw: r6(f.cue), openTags: f.openTags || [] })) } };
}

// ---------------------------------------------------------------- files

export function cuesModuleText(cues, note = '') {
  const j = (x) => JSON.stringify(x);
  return [
    `// generated by tools/cues.mjs${note ? ` from ${note}` : ''}; do not edit. Run the tool again after a new take or a board change.`,
    '// Every time here except VO_OFFSET is seconds into vo.wav; VO_OFFSET is the picture time where vo.wav starts.',
    `export const VO_OFFSET = ${j(cues.VO_OFFSET)};`,
    `export const CUE = ${j(cues.CUE)};`,
    `export const TAKE = ${j(cues.TAKE)};`,
    `export const GAPS = ${j(cues.GAPS)};`,
    `export const HOOK_END = ${j(cues.HOOK_END)};`,
    '// the board fields these cues were made from (lib.js boardKey); a render refuses them once board.js changes',
    `export const BOARD_KEY = ${j(cues.BOARD_KEY)};`,
    'export const WORDS = [',
    ...cues.WORDS.map((w) => `  ${j(w)},`),
    '];',
    '',
  ].join('\n');
}
// Written next to the target and renamed over it, so an interrupted run never leaves half a file.
function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

async function main(argv) {
  const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node tools/cues.mjs [--from words|elevenlabs|whisper <file>] [--audio <file>] [--offset <s>] [--dry-run]  (see the header)');
    return 0;
  }
  const fi = argv.indexOf('--from');
  const kind = fi >= 0 ? argv[fi + 1] : 'words', src = fi >= 0 ? argv[fi + 2] : 'take.json';
  if (!kind || !src || src.startsWith('--')) { console.error('usage: --from <words|elevenlabs|whisper> <file>'); return 2; }
  const offset = opt('offset') != null ? Number(opt('offset')) : null;
  if (offset != null && !Number.isFinite(offset)) { console.error('--offset needs a number of seconds'); return 2; }
  const srcFile = path.resolve(ROOT, src), audioFile = path.resolve(ROOT, opt('audio') || 'take-raw.wav');
  const dry = argv.includes('--dry-run');
  try {
    const { BOARD } = await import(pathToFileURL(path.join(ROOT, 'board.js')).href);
    if (!fs.existsSync(srcFile)) throw new CueError(`no timing file ${path.relative(ROOT, srcFile) || srcFile}`);
    if (!fs.existsSync(audioFile)) throw new CueError(`no audio ${path.relative(ROOT, audioFile) || audioFile} (pass --audio <file>)`);
    let json;
    try { json = JSON.parse(fs.readFileSync(srcFile, 'utf8')); } catch (e) { throw new CueError(`${path.basename(srcFile)} is not JSON: ${e.message}`); }
    const take = normalizeTake(kind, json);
    const samples = readAudio(audioFile);
    const r = buildCues({ board: BOARD, take, samples, sr: SR, offset });
    const { cues } = r;
    console.log(`cues: ${Object.keys(cues.CUE).length} voiced beats from ${kind} (${path.relative(ROOT, srcFile)}); take ${fmt(samples.length / SR, 2)} s -> vo.wav ${fmt(cues.TAKE.duration, 2)} s`);
    console.log('  beat         cue in vo.wav   window (picture time)');
    for (const w of r.timing.windows) console.log(`  ${w.id.padEnd(12)} ${(w.voiced ? fmt(cues.CUE[w.id]) : '-').padStart(9)}       ${fmt(w.start)}-${fmt(w.end)}`);
    for (const f of r.info.found) if (f.openTags.length) console.log(`  "${f.id}" cues at its opening tag ${f.openTags.join(' ')}`);
    for (const g of cues.GAPS) console.log(`  ${g.kind === 'silent' ? `${fmt(g.dur, 2)} s of zeros for ${g.beats.join(', ')}` : `gapBefore ${fmt(g.dur, 2)} s`} before "${g.before}", at ${fmt(g.at)} s in vo.wav`);
    console.log(`  VO_OFFSET ${fmt(cues.VO_OFFSET)} s${offset == null ? ` (leading silent beats ${fmt(r.info.leadSum, 2)} + lead ${r.info.lead})` : ' (--offset)'}; boardDur ${fmt(r.timing.dur)} s`);
    const hookPic = cues.VO_OFFSET + cues.HOOK_END;
    console.log(`  hook "${r.info.hook}" ends ${fmt(cues.HOOK_END)} s into vo.wav = ${fmt(hookPic)} s picture time${BOARD.hookMax != null ? ` (hookMax ${BOARD.hookMax}: ${fmt(BOARD.hookMax - hookPic)} s to spare)` : ''}`);
    for (const w of r.warnings) console.log(`  WARN ${w}`);
    if (dry) { console.log('dry run: nothing written'); return 0; }
    const wrote = [];
    if (path.resolve(audioFile) !== path.join(ROOT, 'take-raw.wav')) { writeAtomic(path.join(ROOT, 'take-raw.wav'), wavFloat(samples)); wrote.push('take-raw.wav'); }
    if (path.resolve(srcFile) !== path.join(ROOT, 'take.json')) {
      writeAtomic(path.join(ROOT, 'take.json'), JSON.stringify({ ...take, duration: r6(samples.length / SR), sampleRate: SR }, null, 1) + '\n');
      wrote.push('take.json');
    }
    writeAtomic(path.join(ROOT, 'vo.wav'), wavFloat(r.vo));
    writeAtomic(path.join(ROOT, 'cues.json'), JSON.stringify(cues, null, 1) + '\n');
    writeAtomic(path.join(ROOT, 'cues.js'), cuesModuleText(cues, `${kind} (${path.relative(ROOT, srcFile)})`));
    wrote.push('vo.wav', 'cues.json', 'cues.js');
    console.log(`wrote ${wrote.join(', ')}`);
    return 0;
  } catch (e) {
    if (e instanceof CueError) {
      console.error('cues: refused, nothing written:');
      for (const p of e.problems) console.error(`  - ${p}`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
