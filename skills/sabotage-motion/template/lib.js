// Shared math, easing, springs, noise and timeline helpers.
// Everything is a pure function of time, so any frame can be rendered in any order
// (which is what makes stills, contact sheets and motion-blur subframes possible).

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const prog = (t, a, b) => clamp((t - a) / (b - a));   // 0..1 progress of t through [a,b]
export const smooth = (t) => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

export const E = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inBack: (t, s = 1.70158) => (s + 1) * t * t * t - s * t * t,
  outElastic: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * TAU) / 3) + 1,
};

// CSS-style cubic-bezier easing (Newton-Raphson + bisection fallback).
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-6) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
// Signature curves: most of a piece's feel comes from these four
export const snap = bezier(0.16, 1, 0.3, 1);           // fast out, long settle: default for entrances
export const swift = bezier(0.75, 0, 0.15, 1);         // decisive in-out: moves between holds
export const whip = bezier(0.9, 0, 0.1, 1);            // almost a cut, with a smear: exits, transitions
export const anticip = bezier(0.55, -0.45, 0.3, 1.35); // pull back, overshoot: playful pops

// Damped spring step response 0 -> 1 (f = Hz, z = damping ratio; lower z = more bounce).
export function spring(t, f = 3, z = 0.3) {
  if (t <= 0) return 0;
  const w = TAU * f, wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}

// Deterministic randomness: never Math.random() in a frame function, or frames won't repeat.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export const hash2 = (a, b) => hash(a * 57.13 + b * 113.7);
export function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 2 - 1;
}

// Decaying envelope from the most recent event time <= t (sorted list). Use it to make visuals
// pulse on the same hits the audio plays, e.g. scale = 1 + 0.05 * env(t, TL.hits, 12).
export function env(t, times, decay = 10) {
  let best = -1;
  for (let i = 0; i < times.length; i++) { if (times[i] <= t) best = times[i]; else break; }
  return best < 0 ? 0 : Math.exp(-(t - best) * decay);
}

// Evenly spaced event times, e.g. beats(0.5, 4, 120) -> 8 beats from 0.5s at 120 BPM.
export function beats(start, bars, bpm = 120, perBar = 4) {
  const spb = 60 / bpm, r = [];
  for (let i = 0; i < bars * perBar; i++) r.push(+(start + i * spb).toFixed(4));
  return r;
}

export const hexToRgb = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgba = (h, a = 1) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };
export const rgb01 = (h) => hexToRgb(h).map((v) => v / 255);

// ================================================================ storyboard, voice timing, captions
// board.js (the storyboard, plan section 6) and cues.js (written by tools/cues.mjs from a voice take,
// section 7) sit beside this file. Every time a scene sees is PICTURE TIME: seconds from the first
// frame. cues.js holds seconds into vo.wav, plus VO_OFFSET, the picture time where vo.wav starts; the
// helpers below add VO_OFFSET once, so a scene never does.
//
//   const [a, b] = beatWindow('hook');   // the beat's half-open window [a, b) in picture time
//   beatAt(t)                            // { id, index, start, end, beat } for the beat under t, or null
//   boardDur()                           // the board's length: set CFG.DUR = boardDur()
//   CUES                                 // cues.js's exports ({ VO_OFFSET, CUE, TAKE, GAPS, HOOK_END, WORDS }), or null
//   captions(ctx, CUES.WORDS, t, opts)   // word-by-word captions; returns their text boxes
//
// Without cues.js the windows come from an estimate (words / wps + 0.25 s per voiced beat).

// __proto__ is reserved too: as a key of CUE (or of the object literal cues.js writes) it sets the prototype
// instead of holding a cue, so a beat named that could never be cued.
const RESERVED_IDS = new Set(['TAKE', 'VO_OFFSET', 'DUR', '__proto__']);
export const BOARD_DEFAULTS = { lead: 0.10, tail: 0.40, wps: 3.0 };
const EPS = 1e-9;

// ---- delivery tags: a [...] span in a vo line ([curious], [short pause]) goes to the TTS as written
// and shows on the board sheet as direction, but it is never a word (section 7.1).
export const TAG_RE = /\[[^[\]]*\]/g;
export const isTag = (s) => /^\[[^[\]]*\]$/.test(String(s).trim());

// Punctuation that sticks to the word across the space from it: closing marks after a span of tags, opening
// marks before one. A quote counts by where it sits: it opens only at the start, after a space, or after another
// opening mark ('say "hi'), and closes only before the end, a space, or a closing mark ('hi" now', 'hi",'). So an
// apostrophe inside or at the end of a word ("it's", "players'") never opens, and neither does the quote that
// closes after it ('"players'"').
const CLOSE_P = /[,.;:!?…)}]/, OPEN_P = /[({¿¡]/, QUOTE = /["'“”‘’«»]/;
function opensAt(s, i) {
  if (OPEN_P.test(s[i] || '')) return true;
  if (!QUOTE.test(s[i] || '')) return false;
  const p = s[i - 1];
  return p === undefined || /\s/.test(p) || OPEN_P.test(p) || (QUOTE.test(p) && opensAt(s, i - 1));
}
function closesAt(s, i) {
  if (CLOSE_P.test(s[i] || '')) return true;
  if (!QUOTE.test(s[i] || '')) return false;
  const n = s[i + 1];
  return n === undefined || /\s/.test(n) || CLOSE_P.test(n) || (QUOTE.test(n) && closesAt(s, i + 1));
}
// The spans of tags in `text`, each cut as a unit: tags with nothing or only spaces between them ("[sighs][whispers]",
// "[laughs] [sighs]") form one span, and the spaces inside it go with it. A side of a span is open at the text's
// edge, at a space, at a cut just made, or at punctuation that belongs to the word beyond it (a closing mark after
// it, an opening mark before it). With both sides open the span goes with one adjacent space: the one after it when
// there is one ("a [x] b" reads "a b", "([x] hi)" reads "(hi)"), else the one before ("Hello [sighs], world" reads
// "Hello, world"; "Stop now [laughs] [sighs]." reads "Stop now."). A span with one side open goes alone, keeping the
// space on its other side ("prompt.[sighs][whispers] Save" reads "prompt. Save"). A span closed on both sides keeps
// one space if it had one inside, so the words around it stay apart ("now.[x] [y]Hello" reads "now. Hello"); with no
// space anywhere it would join two words, so the board refuses it. tools/cues.mjs cuts a take's character timings
// by the same rule, so a vo line and the take's text stay comparable.
export function tagSpans(text) {
  const s = String(text), spans = [];
  for (const m of s.matchAll(TAG_RE)) {
    const t = { text: m[0], a: m.index, b: m.index + m[0].length }, last = spans[spans.length - 1];
    if (last && /^\s*$/.test(s.slice(last.b, t.a))) { last.tags.push(t); last.b = t.b; } else spans.push({ a: t.a, b: t.b, tags: [t] });
  }
  let prevEnd = 0;
  for (const sp of spans) {
    const { a, b, tags } = sp, L = s[a - 1], R = s[b];
    sp.leftOpen = a === 0 || a <= prevEnd || /\s/.test(L) || opensAt(s, a - 1);
    sp.rightOpen = b === s.length || /\s/.test(R) || closesAt(s, b);
    sp.innerSpace = tags.some((t, k) => k > 0 && t.a > tags[k - 1].b);
    let ca = a, cb = b;
    if (sp.leftOpen && sp.rightOpen) {
      if (/\s/.test(R || '')) cb = b + 1;
      else if (a - 1 >= prevEnd && /\s/.test(L || '')) ca = a - 1;
    }
    // each tag's cut takes the gap before it; a span closed on both sides keeps the first space of its first gap
    const keepOne = !sp.leftOpen && !sp.rightOpen && sp.innerSpace;
    let kept = false;
    sp.cuts = tags.map((t, k) => {
      let from = k === 0 ? ca : tags[k - 1].b;
      if (k > 0 && keepOne && !kept && t.a > tags[k - 1].b) { from += 1; kept = true; }
      return { text: t.text, a: t.a, b: t.b, ca: from, cb: k === tags.length - 1 ? cb : t.b };
    });
    prevEnd = cb;
  }
  return spans;
}
export function tagCuts(text) {
  return tagSpans(text).flatMap((sp) => sp.cuts);
}
export function stripTags(text) {
  let out = '', i = 0;
  for (const c of tagCuts(text)) { out += text.slice(i, c.ca); i = c.cb; }
  return out + String(text).slice(i);
}
// A vo line in order, as { kind: 'word' | 'tag', text } tokens.
export const voTokens = (vo) => [...String(vo).matchAll(/\[[^[\]]*\]|[^\s[]+/g)]
  .map((m) => ({ kind: m[0][0] === '[' ? 'tag' : 'word', text: m[0] }));
// The words of a vo line (tags removed). The estimate counts these; the default anchor is the first four.
export const voWords = (vo) => stripTags(String(vo)).split(/\s+/).filter(Boolean);
export const defaultAnchor = (vo) => voWords(vo).slice(0, 4).join(' ');
export const anchorOf = (beat) => (beat.anchor != null ? String(beat.anchor) : defaultAnchor(beat.vo));
// A word as matching sees it: punctuation stripped at its edges, case kept.
export const normWord = (w) => String(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const normWords = (text) => String(text).split(/\s+/).map(normWord).filter(Boolean);
// Where an anchor phrase starts among its line's words (-1 when it is not in the line).
export function anchorOffset(vo, anchor) {
  const line = normWords(stripTags(vo)), a = normWords(anchor);
  if (!a.length) return -1;
  for (let i = 0; i + a.length <= line.length; i++) if (a.every((w, k) => line[i + k] === w)) return i;
  return -1;
}
// The voice script: the voiced beats' vo lines in board order, delivery tags included, one space apart.
export const boardScript = (board) => board.beats.filter((b) => b.vo != null).map((b) => String(b.vo).trim()).join(' ');
// Estimated length of a voiced beat before a take exists.
export const estimateVoiced = (vo, wps = BOARD_DEFAULTS.wps) => voWords(vo).length / wps + 0.25;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Everything wrong with a board's shape, as sentences (an empty list means it is usable).
export function boardProblems(board) {
  const p = [];
  if (!board || typeof board !== 'object') return ['board.js must export BOARD = { beats: [...] }'];
  if (!Array.isArray(board.beats) || !board.beats.length) return ['BOARD.beats must be a non-empty list of beats'];
  for (const k of ['lead', 'tail']) if (board[k] != null && !(isNum(board[k]) && board[k] >= 0)) p.push(`BOARD.${k} must be a number of seconds, 0 or more`);
  if (board.wps != null && !(isNum(board.wps) && board.wps > 0)) p.push('BOARD.wps must be a positive number (words per second)');
  if (board.hookMax != null && !(isNum(board.hookMax) && board.hookMax > 0)) p.push('BOARD.hookMax must be a positive number of seconds');
  const seen = new Set();
  let hooks = 0, voiced = 0;
  board.beats.forEach((b, i) => {
    const name = b && typeof b.id === 'string' && b.id ? `beat "${b.id}"` : `beat ${i + 1}`;
    if (!b || typeof b !== 'object') { p.push(`${name} is not an object`); return; }
    if (typeof b.id !== 'string' || !b.id) p.push(`${name} needs an id (a non-empty string)`);
    else if (RESERVED_IDS.has(b.id)) p.push(`${name}: the ids TAKE, VO_OFFSET, DUR and __proto__ are reserved`);
    else if (seen.has(b.id)) p.push(`${name}: the id is used twice`);
    seen.add(b.id);
    const hasVo = b.vo != null, hasDur = b.dur != null;
    if (hasVo === hasDur) { p.push(`${name} needs exactly one of vo (a voice line) or dur (seconds)`); return; }
    if (hasDur) {
      if (!isNum(b.dur) || b.dur <= 0) p.push(`${name}: dur ${b.dur} would give it a zero or negative length`);
      for (const k of ['anchor', 'gapBefore', 'occurrence', 'hook']) if (b[k] != null && b[k] !== false) p.push(`${name}: ${k} only applies to a beat with vo`);
    } else {
      voiced++;
      const vo = String(b.vo);
      if (typeof b.vo !== 'string' || !voWords(vo).length) p.push(`${name}: vo must be a line with at least one word`);
      if (/[[\]]/.test(vo.replace(TAG_RE, ''))) p.push(`${name}: an unmatched [ or ] in vo (a delivery tag is one [...] span)`);
      for (const sp of tagSpans(vo)) {   // a span glued to words on both sides, with no space in it, would join them
        if (!sp.leftOpen && !sp.rightOpen && !sp.innerSpace) p.push(`${name}: put a space before or after the tag ${vo.slice(sp.a, sp.b)}`);
      }
      if (b.anchor != null) {
        if (typeof b.anchor !== 'string' || !normWords(b.anchor).length) p.push(`${name}: anchor must be a phrase from its vo line`);
        else if (b.anchor.includes('[')) p.push(`${name}: anchor "${b.anchor}" contains [: delivery tags are never anchors (the default anchor skips them)`);
        else if (anchorOffset(vo, b.anchor) < 0) p.push(`${name}: anchor "${b.anchor}" is not in its own vo line`);
      }
      if (b.occurrence != null && !(Number.isInteger(b.occurrence) && b.occurrence >= 1)) p.push(`${name}: occurrence must be a whole number, 1 or more`);
      if (b.gapBefore != null && !(isNum(b.gapBefore) && b.gapBefore > 0)) p.push(`${name}: gapBefore must be a positive number of seconds`);
      if (b.hook) hooks++;
    }
    if (b.key != null && !(isNum(b.key) && b.key >= 0)) p.push(`${name}: key must be seconds into the beat, 0 or more`);
  });
  if (hooks > 1) p.push('only one beat can be the hook (hook: true)');
  // A gapBefore on a beat that follows interleaved silent beats would open a second silence on top of
  // the one the silent run already opens; lengthen the silent beat's dur instead.
  let sawVoiced = false;
  board.beats.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    if (b.vo != null && b.gapBefore != null && sawVoiced && board.beats[i - 1] && board.beats[i - 1].dur != null) {
      p.push(`beat "${b.id}": gapBefore after silent beats would stack two silences; lengthen "${board.beats[i - 1].id}".dur instead`);
    }
    if (b.vo != null) sawVoiced = true;
  });
  if (board.hookMax != null && !voiced) p.push('BOARD.hookMax is set but no beat has a voice line');
  return p;
}

// The hook beat for the hook gate: the one marked hook: true, else the first voiced beat.
export function hookBeat(board) {
  const voiced = board.beats.filter((b) => b && b.vo != null);
  return voiced.find((b) => b.hook) || voiced[0] || null;
}

// The hook_long rule (section 6.5), shared by tools/cues.mjs's hook gate and `check` (P3): the hook's last word
// or closing tag, in picture time (VO_OFFSET + HOOK_END), must not be later than BOARD.hookMax. Returns null
// when the board sets no hookMax or there is no take yet, else { ok, hook, end, over }.
export function hookLong(board, cues) {
  if (!board || board.hookMax == null || !cues || cues.HOOK_END == null) return null;
  const hb = hookBeat(board), end = cues.VO_OFFSET + cues.HOOK_END;
  return { ok: end <= board.hookMax + 1e-9, hook: hb ? hb.id : null, end, over: end - board.hookMax };
}

// The board fields a take's cues depend on, as one string. tools/cues.mjs writes it into cues.js as
// BOARD_KEY, and boardTiming refuses a cues.js whose key no longer matches: a line, a leading or interleaved
// silent beat's dur, an anchor, an occurrence, a gap, which beat is the hook, lead or hookMax changed since the
// cues were made, so the zeros in vo.wav or VO_OFFSET may not fit the board any more. The key is taken from
// what those fields mean, not how they are written: the default anchor written out, hook: false, or a trailing
// space on a line keep the cues. So do the silent beats after the last voiced one (they are timed from the
// take's end at render) and notes that move no time (copy, look, sfx).
export function boardKey(board) {
  const lead = board.lead != null ? board.lead : BOARD_DEFAULTS.lead;
  const v = (x) => (x == null ? null : x);
  const lastV = board.beats.reduce((k, b, i) => (b && b.vo != null ? i : k), -1);
  const hb = hookBeat(board);
  return JSON.stringify({ lead, hookMax: v(board.hookMax), hook: hb ? hb.id : null,
    beats: board.beats.slice(0, lastV + 1).map((b) => (b.vo != null
      ? [b.id, String(b.vo).trim(), anchorOf(b).trim().replace(/\s+/g, ' '), v(b.occurrence), v(b.gapBefore)]
      : [b.id, b.dur])) });
}

// Beat windows in picture time, half-open, contiguous, covering [0, dur) (plan section 6.3). With `cues`
// (cues.js's exports) the take places the voiced beats; without, the estimate does. Never throws: a
// board or cues.js that cannot be timed comes back with ok: false and the reasons in `problems`.
export function boardTiming(board, cues = null) {
  const problems = boardProblems(board);
  const lead = board && board.lead != null ? board.lead : BOARD_DEFAULTS.lead;
  const tail = board && board.tail != null ? board.tail : BOARD_DEFAULTS.tail;
  const wps = board && board.wps != null ? board.wps : BOARD_DEFAULTS.wps;
  const fail = (more = []) => ({ ok: false, problems: [...problems, ...more], estimated: !cues, lead, tail, voOffset: 0, dur: 0, windows: [] });
  if (problems.length) return fail();
  const beats = board.beats, n = beats.length;
  const voicedIdx = beats.map((b, i) => (b.vo != null ? i : -1)).filter((i) => i >= 0);
  const firstV = voicedIdx.length ? voicedIdx[0] : n, lastV = voicedIdx.length ? voicedIdx[voicedIdx.length - 1] : -1;
  let leadSum = 0;
  for (let i = 0; i < firstV; i++) leadSum += beats[i].dur;
  const starts = new Array(n);
  let voOffset, dur;
  if (cues) {
    const CUE = cues.CUE || {}, more = [];
    if (!isNum(cues.VO_OFFSET)) more.push('cues.js has no VO_OFFSET');
    if (!cues.TAKE || !isNum(cues.TAKE.lastWordEnd)) more.push('cues.js has no TAKE.lastWordEnd');
    const ids = new Set(voicedIdx.map((i) => beats[i].id));
    for (const id of ids) if (!isNum(CUE[id])) more.push(`cues.js has no cue for beat "${id}"`);
    for (const id of Object.keys(CUE)) if (!ids.has(id)) more.push(`cues.js has a cue for "${id}", which is not a voiced beat in board.js`);
    // every cues.js that tools/cues.mjs writes carries BOARD_KEY; one without it cannot be checked, so it is refused
    if (cues.BOARD_KEY == null) more.push('cues.js has no BOARD_KEY (an older tools/cues.mjs made it)');
    else if (cues.BOARD_KEY !== boardKey(board)) {
      more.push('board.js changed since cues.js was made (a line, a silent beat\'s dur, an anchor, a gap, the hook, lead or hookMax)');
    }
    if (more.length) return fail([...more, 'cues.js does not match board.js: run node tools/cues.mjs again']);
  }
  if (!cues || !voicedIdx.length) {
    // the estimate, or a board with no voice: beats back to back in board order
    let t = 0;
    beats.forEach((b, i) => { starts[i] = t; t += b.vo != null ? estimateVoiced(b.vo, wps) : b.dur; });
    voOffset = cues ? cues.VO_OFFSET : leadSum + lead;
    dur = t;
  } else {
    voOffset = cues.VO_OFFSET;
    const A = (i) => voOffset + cues.CUE[beats[i].id];
    let t = 0;
    for (let i = 0; i < firstV; i++) { starts[i] = t; t += beats[i].dur; }
    starts[firstV] = leadSum;                       // the first voiced beat opens where the leading silent beats end
    let prevV = firstV;
    for (const i of voicedIdx.slice(1)) {
      starts[i] = A(i) - lead;                      // a later voiced beat opens `lead` before its anchor
      let D = 0;                                    // an interleaved silent run ends where that beat opens
      for (let j = prevV + 1; j < i; j++) D += beats[j].dur;
      let s = starts[i] - D;
      for (let j = prevV + 1; j < i; j++) { starts[j] = s; s += beats[j].dur; }
      prevV = i;
    }
    const voEnd = voOffset + cues.TAKE.lastWordEnd + tail;
    t = voEnd;                                      // trailing silent beats follow the last word (or closing tag)
    for (let i = lastV + 1; i < n; i++) { starts[i] = t; t += beats[i].dur; }
    dur = t;
  }
  // rounded to the microsecond, so 2.45 + 0.55 is 3, not 3.0000000000000004 (contiguity is kept: each
  // end is the next start, rounded the same way)
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  dur = r6(dur);
  const windows = beats.map((b, i) => ({ id: b.id, index: i, start: r6(starts[i]), end: i + 1 < n ? r6(starts[i + 1]) : dur, voiced: b.vo != null, beat: b }));
  const bad = [];
  for (const w of windows) {
    if (w.end - w.start <= EPS) {
      const next = windows[w.index + 1];
      bad.push(`beat "${w.id}" would last ${(w.end - w.start).toFixed(3)} s ([${w.start.toFixed(3)}, ${w.end.toFixed(3)}))` +
        (next ? `: "${next.id}" starts at or before "${w.id}" does (two anchors closer than lead ${lead} s, or a dur of 0)` : ''));
    }
  }
  // Every voiced beat's anchor must play inside its own window. A positive window is not enough: two anchors
  // closer than lead (plus any silent beats between them) give the second beat a window that opens before
  // the first beat's anchor, so the first line would play under the wrong beat.
  if (cues && voicedIdx.length) {
    for (const i of voicedIdx) {
      const w = windows[i], at = r6(voOffset + cues.CUE[beats[i].id]);
      if (at >= w.start - EPS && at < w.end - EPS) continue;
      const inside = windows.find((x) => at >= x.start - EPS && at < x.end - EPS);
      bad.push(`beat "${w.id}": its anchor plays at ${at.toFixed(3)} s, outside its own window [${w.start.toFixed(3)}, ${w.end.toFixed(3)})` +
        (inside ? ` and inside "${inside.id}"'s` : '') + ` (two anchors closer than lead ${lead} s, plus any silent beats between them)`);
    }
  }
  if (bad.length) return { ...fail(bad), voOffset, dur, windows };
  return { ok: true, problems: [], estimated: !cues && voicedIdx.length > 0, lead, tail, voOffset, dur, windows };
}

// The board_order check (section 6.5): windows contiguous, in order, starting at 0, and CFG.DUR equal
// to boardDur() within one frame. Returns the failures (an empty list passes). `check` (P3) reports it.
export function boardOrder(timing, cfgDur, fps) {
  const p = [...(timing.problems || [])];
  const w = timing.windows || [];
  if (!w.length && !p.length) p.push('the board has no beat windows');
  if (w.length && Math.abs(w[0].start) > 1e-6) p.push(`the first beat "${w[0].id}" starts at ${w[0].start.toFixed(3)} s, not 0`);
  for (let i = 0; i < w.length; i++) {
    if (!(w[i].end > w[i].start)) p.push(`beat "${w[i].id}" window [${w[i].start.toFixed(3)}, ${w[i].end.toFixed(3)}) is empty or backwards`);
    if (i + 1 < w.length && Math.abs(w[i].end - w[i + 1].start) > 1e-6) p.push(`beats "${w[i].id}" and "${w[i + 1].id}" are not contiguous (${w[i].end.toFixed(3)} vs ${w[i + 1].start.toFixed(3)})`);
  }
  if (w.length && Math.abs(w[w.length - 1].end - timing.dur) > 1e-6) p.push(`the last window ends at ${w[w.length - 1].end.toFixed(3)} s, not at boardDur() ${timing.dur.toFixed(3)} s`);
  if (cfgDur != null && fps && Math.abs(cfgDur - timing.dur) > 1 / fps + 1e-9) {
    p.push(`CFG.DUR ${cfgDur} differs from boardDur() ${timing.dur.toFixed(3)} by more than one frame (set CFG.DUR = boardDur())`);
  }
  return [...new Set(p)];
}

// ---- this piece's own board.js and cues.js, loaded once. A missing file is fine (a piece without a take
// uses the estimate); a file that fails to load is reported when a helper first needs it.
async function pieceModule(name) {
  const url = new URL(name, import.meta.url);
  if (url.protocol !== 'file:') {
    // render.mjs answers /__exists, so a missing optional file does not log a 404 on every render
    try { const r = await fetch(new URL('__exists?path=' + encodeURIComponent(name), import.meta.url)); if (r.ok && !(await r.json()).exists) return { mod: null }; } catch { /* other server: just try it */ }
  }
  try { return { mod: await import(url.href) }; } catch (e) {
    const missing = url.protocol === 'file:' && e && e.code === 'ERR_MODULE_NOT_FOUND' &&
      (e.url === url.href || String(e.message).includes(decodeURIComponent(url.pathname)));
    return missing ? { mod: null } : { mod: null, error: `${name} failed to load: ${e && e.message}` };
  }
}
const _board = await pieceModule('./board.js');
const _cues = await pieceModule('./cues.js');
export const BOARD = _board.mod && _board.mod.BOARD ? _board.mod.BOARD : null;
export const CUES = _cues.mod ? Object.freeze({
  VO_OFFSET: _cues.mod.VO_OFFSET, CUE: _cues.mod.CUE, TAKE: _cues.mod.TAKE, GAPS: _cues.mod.GAPS || [],
  HOOK_END: _cues.mod.HOOK_END, WORDS: _cues.mod.WORDS || [], BOARD_KEY: _cues.mod.BOARD_KEY,
}) : null;
let _timing = null;
// The piece's board timing: { estimated, voOffset, dur, lead, tail, windows: [{ id, index, start, end, voiced, beat }] }.
// `estimated` is true while voiced beats are timed by the estimate (no cues.js yet).
export function boardInfo() {
  if (_board.error) throw new Error(_board.error);
  if (_cues.error) throw new Error(_cues.error);
  if (!BOARD) throw new Error('this piece has no board.js exporting BOARD (copy one from the template)');
  if (!_timing) _timing = boardTiming(BOARD, CUES);
  if (!_timing.ok) throw new Error('board.js: ' + _timing.problems.join('; '));
  return _timing;
}
export function beatWindow(id) {
  const w = boardInfo().windows.find((x) => x.id === id);
  if (!w) throw new Error(`beatWindow: board.js has no beat "${id}"`);
  return [w.start, w.end];
}
export function beatAt(t) {
  const w = boardInfo().windows.find((x) => t >= x.start && t < x.end);
  return w ? { id: w.id, index: w.index, start: w.start, end: w.end, beat: w.beat } : null;
}
export const boardDur = () => boardInfo().dur;
// through boardInfo() whenever there is a board, so a stale cues.js is refused here too, not read past
const pieceVoOffset = () => (BOARD ? boardInfo().voOffset : CUES ? CUES.VO_OFFSET : 0);

// ---- captions (plan section 8): word-by-word captions from WORDS (seconds into vo.wav).
//   const boxes = captions(ctx, CUES ? CUES.WORDS : [], t, { safe: target.safe, size: 72 });
// Lines are filled to opts.maxW (default: the safe width) with measureText; a group of up to opts.lines
// lines shows at a time, and a new group starts after a sentence end or a pause longer than
// opts.breakGap. The active word pops (anticip, or a spring with pop: 'spring') from 1.15 to 1 and takes
// the accent colour. The block sits inside opts.safe (bottom by default; pos: 'center' | 'top'), or at
// opts.x / opts.y (its centre and its last baseline). Returns one text box per drawn word, in design
// pixels, for a scene's boxes(t). VO_OFFSET is added here (opts.voOffset overrides it); tags never show.
const _capCache = new WeakMap();
function captionLayout(ctx, WORDS, o) {
  const key = JSON.stringify([o.font, o.maxW, o.lines, o.breakGap, o.sentence, o.upper, o.hold]);
  let byKey = _capCache.get(WORDS);
  if (!byKey) { byKey = new Map(); _capCache.set(WORDS, byKey); }
  if (byKey.has(key)) return byKey.get(key);
  ctx.save(); ctx.font = o.font;
  const words = [];
  WORDS.forEach((w, i) => {
    const raw = String(w.text || '').trim();
    if (!raw || isTag(raw)) return;
    const text = o.upper ? raw.toUpperCase() : raw;
    words.push({ i, text, start: w.start, end: w.end, w: ctx.measureText(text).width });
  });
  const space = ctx.measureText(' ').width;
  ctx.restore();
  const groups = [];
  let g = null, line = null;
  words.forEach((w, k) => {
    const prev = words[k - 1];
    const brk = !g || (prev && (w.start - prev.end > o.breakGap || (o.sentence && /[.!?]["')\]]*$/.test(prev.text))));
    if (brk) { g = { lines: [] }; groups.push(g); line = null; }
    if (line && line.w + space + w.w > o.maxW) {
      if (g.lines.length >= o.lines) { g = { lines: [] }; groups.push(g); }
      line = null;
    }
    if (!line) { line = { words: [], w: 0 }; g.lines.push(line); }
    line.w += (line.words.length ? space : 0) + w.w;
    line.words.push(w);
  });
  groups.forEach((gr, k) => {
    const all = gr.lines.flatMap((l) => l.words);
    gr.t0 = all[0].start;
    const last = all[all.length - 1].end, next = groups[k + 1];
    gr.t1 = next ? Math.min(next.lines[0].words[0].start, last + o.hold) : last + o.hold;
    gr.byHold = !next || last + o.hold < next.lines[0].words[0].start;
  });
  const out = { groups, space };
  byKey.set(key, out);
  return out;
}
export function captions(ctx, WORDS, t, opts = {}) {
  if (!WORDS || !WORDS.length) return [];
  const safe = opts.safe || null;
  if (!safe && (opts.x == null || opts.y == null)) throw new Error('captions: pass opts.safe (target.safe from init) or opts.x and opts.y');
  const size = opts.size || 64;
  const o = {
    font: opts.font || `${size}px ${opts.family || 'DISPLAY'}`, maxW: opts.maxW || (safe ? safe.w : 900),
    lines: opts.lines || 2, breakGap: opts.breakGap != null ? opts.breakGap : 0.6, sentence: opts.sentence !== false,
    upper: !!opts.upper, hold: opts.hold != null ? opts.hold : 0.5,
  };
  const lineH = opts.lineH || size * 1.15, fadeOut = opts.fade != null ? opts.fade : 0.08, popDur = opts.popDur || 0.22;
  const tv = t - (opts.voOffset != null ? opts.voOffset : pieceVoOffset());
  const { groups, space } = captionLayout(ctx, WORDS, o);
  const g = groups.find((x) => tv >= x.t0 && tv < x.t1);
  if (!g) return [];
  const alpha = g.byHold ? clamp((g.t1 - tv) / Math.max(1e-6, fadeOut)) : 1;
  if (alpha <= 0.05) return [];
  const all = g.lines.flatMap((l) => l.words);
  let active = null;
  for (const w of all) if (w.start <= tv) active = w;
  const n = g.lines.length, blockH = (n - 1) * lineH;
  const pos = opts.pos || 'bottom', margin = opts.margin != null ? opts.margin : size * 0.4;
  const cx = opts.x != null ? opts.x : safe.x + safe.w / 2;
  const lastBase = opts.y != null ? opts.y
    : pos === 'top' ? safe.y + margin + size * 0.8 + blockH
    : pos === 'center' ? safe.y + safe.h / 2 + blockH / 2 + size * 0.3
    : safe.y + safe.h - margin - size * 0.2;
  const ink = opts.color || '#FFFFFF', accent = opts.accent || '#FFD23F';
  const boxes = [];
  ctx.save();
  ctx.font = o.font; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = (ctx.globalAlpha == null ? 1 : ctx.globalAlpha) * alpha;
  g.lines.forEach((l, li) => {
    const base = lastBase - (n - 1 - li) * lineH;
    let x = cx - l.w / 2;
    for (const w of l.words) {
      const on = w === active;
      const k = on ? prog(tv, w.start, w.start + popDur) : 1;
      const s = on ? (opts.pop === 'spring' ? 1.15 - 0.15 * spring(tv - w.start, 4, 0.45) : 1.15 - 0.15 * anticip(k)) : 1;
      const mx = x + w.w / 2, my = base - size * 0.35;
      ctx.save();
      ctx.translate(mx, my); ctx.scale(s, s); ctx.translate(-mx, -my);
      if (opts.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = opts.stroke; ctx.strokeStyle = opts.strokeColor || '#000000'; ctx.strokeText(w.text, x, base); }
      ctx.fillStyle = on ? accent : ink;
      ctx.fillText(w.text, x, base);
      ctx.restore();
      const top = base - size * 0.8, h = size;
      boxes.push({ id: `cap${w.i}`, text: w.text, x: mx + (x - mx) * s, y: my + (top - my) * s, w: w.w * s, h: h * s,
        group: `cap-${groups.indexOf(g)}-${li}`, active: on });
      x += w.w + space;
    }
  });
  ctx.restore();
  return boxes;
}

// ================================================================ footage (plan section 10)
// tools/frames.mjs cuts a clip into assets/seq/<name>/000.jpg ... at the piece's fps and records it in
// assets/seq/manifest.json. In the scene:
//   export async function init() { await loadSeq('clip'); }        // every frame decoded and held in memory
//   ctx.drawImage(seqAt('clip', t, 2.0), 0, 0, 1080, 608);          // the frame for t, the clip starting at 2.0 s
//   seqAt('clip', t, 2.0, { loop: true })                           // loop it instead of holding the last frame
// seqAt shows frame floor((t - t0) x fps) at the sequence's own fps: the first frame before t0, then the last
// frame held once the clip runs out, or with loop the clip again from its first frame. Motion-blur subframes
// stay inside one frame of the sequence. Each frame is held decoded (w x h x 4 bytes), so cut clips to the
// size the scene draws them (frames.mjs --vf). loadSeq runs in the page only (it decodes with createImageBitmap).
const _seqs = new Map();
// The frame index for t: a pure function, so it can be checked without a browser. The 1e-6 keeps exact
// frame times (f / FPS, which float arithmetic can land a hair under the boundary) on their own frame.
export function seqIndex(frames, fps, t, t0 = 0, loop = false) {
  if (!(frames > 0) || !(fps > 0)) throw new Error('seqIndex: a sequence needs at least one frame and an fps');
  const i = Math.floor((t - t0) * fps + 1e-6);
  if (i <= 0) return 0;
  return loop ? i % frames : Math.min(i, frames - 1);
}
export async function loadSeq(name) {
  if (_seqs.has(name)) return _seqs.get(name);
  const base = new URL('./assets/seq/', import.meta.url);
  const r = await fetch(new URL('manifest.json', base));
  if (!r.ok) throw new Error(`loadSeq("${name}"): no assets/seq/manifest.json in this piece (cut the clip with tools/frames.mjs first)`);
  const all = await r.json(), m = all[name];
  if (!m) throw new Error(`loadSeq("${name}"): assets/seq/manifest.json has no sequence "${name}" (it has: ${Object.keys(all).join(', ') || 'none'})`);
  const frames = new Array(m.frames);
  for (let i = 0; i < m.frames; i += 16) {                      // a few at a time, to keep the encoded files in flight few
    await Promise.all(Array.from({ length: Math.min(16, m.frames - i) }, async (_, k) => {
      const file = `${name}/${String(i + k).padStart(3, '0')}.${m.ext || 'jpg'}`;
      const res = await fetch(new URL(file, base));
      if (!res.ok) throw new Error(`loadSeq("${name}"): assets/seq/${file} is missing (cut the clip again with tools/frames.mjs)`);
      frames[i + k] = await createImageBitmap(await res.blob());
    }));
  }
  const seq = { name, fps: m.fps, w: m.w, h: m.h, count: m.frames, frames };
  _seqs.set(name, seq);
  return seq;
}
export function seqAt(name, t, t0 = 0, { loop = false } = {}) {
  const s = _seqs.get(name);
  if (!s) throw new Error(`seqAt("${name}"): the sequence is not loaded (await loadSeq('${name}') in init)`);
  return s.frames[seqIndex(s.count, s.fps, t, t0, loop)];
}
