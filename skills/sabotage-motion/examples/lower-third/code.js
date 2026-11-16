// Code and terminal motion (plan 23.3): a built-in highlighter, typed code, diffs that land line by line, a terminal
// session, generic window, browser and phone frames, and key ticks for the typing. Everything is a pure function of
// t: typing follows a seeded cadence (no Math.random, no clock), so any frame renders on its own.
//
//   import { codeTheme, codeBlock, drawCode, diffBlock, drawDiff, termSession, terminal, drawFrame, frameLayout,
//            typedTimes, keyTicks, keySounds } from './code.js';
//   // init: build each block once, from the style (its tokens colour the code, its mono face draws it)
//   const theme = codeTheme(style);
//   const win = frameLayout('window', { x: 72, y: 380, w: 840, h: 560 });
//   CODE = codeBlock({ src, lang: 'ts', ...win.content, size: 30, theme, start: 0.6, type: { cps: 20, seed: 4 } });
//   // frame(t): the frame, then what is in it
//   drawFrame(ctx, 'window', win.outer, { theme, title: 'src/clock.ts' });
//   drawCode(ctx, CODE, t);
//   // boxes(t): the same calls with draw: false return the boxes of the text visible at t, and draw nothing
//   export const boxes = (t) => [...drawFrame(ctx, 'window', win.outer, { theme, title, draw: false }), ...drawCode(ctx, CODE, t, { draw: false })];
//
// Highlighting: tokenize(src, lang) gives [{ k, s }] (a kind and its text; '\n' is its own token, kind 'nl'), and
// highlight(src, lang) the same split into lines. Languages: js, ts (and jsx, tsx, javascript, typescript), python
// (py), shell (sh, bash, zsh, console), json, diff. Kinds: plain, kw (keyword), lit (true, null, None), str, num, com
// (comment), fn (a call or a definition), type, prop (a property or a JSON key), punct, op, meta (decorators, diff
// headers), var ($VAR), flag (--flag), cmd (a shell command), prompt, add, del, hunk, ctx (diff lines).
//
// Colours: codeTheme(style) maps each kind to a colour made from the style's tokens (the look's, or brand.json's):
// keywords and commands take the accent, strings accent2, comments muted, plain text the ink, the rest mixes of
// them; added lines take whichever of accent and accent2 is nearer green, removed lines the other. Every colour is
// raised toward the ink until it reads at 3:1 or more on the panel. codeTheme(style, { kw: '#hex' }) overrides any.
//
// The helpers draw in a monospace grid: one advance per character, measured once from the theme's mono face, so
// keep code to Latin text (a CJK character or an emoji takes two cells and breaks the grid). Glyphs outside the
// bundled faces' Latin subset (box drawing, braille, check marks) fall back to a system font, so the spinner and the
// progress bar here are ASCII and rectangles. No line wraps: size the font so the longest line fits (fitSize).
//
// The layout call. drawCode, drawDiff and terminal take (ctx, block, t, { draw, alpha, dx, dy }) and return the
// boxes of the text visible at t, one per visible line (a line number counts: a row that shows only its number has a
// box for it), in design pixels: cut to the block's rectangle (its viewport), with only the characters that show in
// its text, lines scrolled out left out, every line of one block in one `group` (the block's id), so check's text_overlap
// never reads a block's own lines as overlapping. The cursor's box is `deco`, and so is everything drawFrame
// reports (the frame and its title), so text_safe and text_overlap leave chrome alone. With draw: false nothing is
// drawn: that is the call for boxes(t). The array also carries `.state`, the same as codeAt / diffAt / termAt(block,
// t) (what is typed, which lines show, the scroll offset), which need no canvas. alpha (0 to 1) fades the block; at
// 0.05 or less it reports no boxes. dx, dy move it, viewport included.
//
// Key ticks: typedTimes(block) lists the moments a key is pressed ({ t, key: 'char' | 'space' | 'enter' }); merge the
// lists of every block that types, then keyTicks(list) thins them to at most KEY_MAX a second (fast typing would
// otherwise turn into noise). Put the result in TL; audio.js plays it with keySounds(ac, dest, TL.keys). Nothing
// ticks while nothing types: output, spinners and scrolling are silent.
import { clamp, lerp, prog, snap, swift, rgba, mulberry32 } from './lib.js';

// ================================================================ highlighting
export const KINDS = ['plain', 'kw', 'lit', 'str', 'num', 'com', 'fn', 'type', 'prop', 'punct', 'op', 'meta', 'var', 'flag',
  'cmd', 'prompt', 'add', 'del', 'hunk', 'ctx'];
const ALIAS = { javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', typescript: 'ts', tsx: 'ts', py: 'python', sh: 'shell',
  bash: 'shell', zsh: 'shell', console: 'shell', patch: 'diff' };
export const LANGS = ['js', 'ts', 'python', 'shell', 'json', 'diff'];
export const langOf = (lang) => {
  const l = ALIAS[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
  if (!LANGS.includes(l)) throw new Error(`code.js: no highlighter for "${lang}" (languages: ${LANGS.join(', ')}, or plain)`);
  return l;
};
const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
const JS_KW = words(`break case catch class const continue debugger default delete do else export extends finally for function
  if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static
  get set from as`);
const TS_KW = words('interface type enum implements declare readonly public private protected abstract namespace keyof infer satisfies is unique module');
const TS_TYPES = words('string number boolean any unknown never void object symbol bigint');
const JS_LIT = words('true false null undefined NaN Infinity');
const PY_KW = words(`and as assert async await break class continue def del elif else except finally for from global if import in
  is lambda nonlocal not or pass raise return try while with yield match case`);
const PY_LIT = words('True False None');
const SH_KW = words('if then else elif fi for while until do done case esac in function select return export local readonly declare unset shift exit');

const isPascal = (w) => /^[A-Z][a-z0-9]/.test(w) && /[a-z]/.test(w);
// The next character after position i that is not a space or a tab.
const nextChar = (src, i) => { while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++; return src[i]; };

// A scanner: at each position the first rule that matches makes a token. A rule's kind may be a function of the
// match and the scan so far (the previous significant token, and what follows); it returns false to decline the
// match, and the next rule is tried.
function scan(src, rules) {
  const out = [];
  let i = 0;
  const st = { prev: null, lineStart: true, cmdPos: true, cont: false, awaitIn: false, caseBody: false, casePat: false, hunk: false, counts: null };
  while (i < src.length) {
    let hit = false;
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (!m || !m[0].length) continue;
      const k = typeof kind === 'function' ? kind(m[0], src, i + m[0].length, st, m) : kind;
      if (k === false) continue;
      if (Array.isArray(k)) for (const t of k) out.push(t); else out.push({ k, s: m[0] });
      const last = out[out.length - 1];
      if (last.k !== 'plain' || last.s.trim()) st.prev = last;
      st.lineStart = m[0].endsWith('\n');
      i += m[0].length; hit = true;
      break;
    }
    if (!hit) { out.push({ k: 'plain', s: src[i] }); i++; st.lineStart = false; }
  }
  return out;
}
// A newline; in shell it puts the next word in command position, unless the line ended with a \ continuation.
// In a case body waiting for a pattern, the next line starts with a pattern instead.
const NL = [/\n/y, (s, src, j, st) => { if (!st.cont) st.cmdPos = !(st.caseBody && st.casePat); st.cont = false; return 'nl'; }];
const WS = [/[ \t\r]+/y, 'plain'];
const DQ = /"(?:\\.|[^\\"\n])*"?/y, SQ = /'(?:\\.|[^\\'\n])*'?/y;

// A template literal, from its backtick to the closing one, past every ${...} in it (which may hold strings, comments
// and template literals of its own); the whole literal, ${...} included, is a string. When the ${...} scan cannot read
// the code in it (a regular expression literal, whose quotes and braces are not code) or runs to the end of the source
// without closing, the literal ends at the next unescaped backtick instead (plainEnd), so it never swallows the code
// after it.
function plainEnd(s, i) {
  let j = i + 1;
  while (j < s.length) { if (s[j] === '\\') j += 2; else if (s[j] === '`') return j + 1; else j++; }
  return s.length;
}
// { end, closed }: closed is true only when the literal reached its own closing backtick; it is false when its ${...}
// scan stopped at a regular expression literal, or when the source ended first.
function templateScan(s, i) {
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') j += 2;
    else if (c === '`') return { end: j + 1, closed: true };
    else if (c === '$' && s[j + 1] === '{') { const e = exprScan(s, j + 2); if (e.stop) return { end: e.end, closed: false }; j = e.end; } else j++;
  }
  return { end: s.length, closed: false };
}
// A / where an operand belongs starts a regular expression literal: at the start of the ${...}, after an operator or
// an opening bracket, or after a keyword that takes an operand (return /x/).
const REGEX_PREV = new Set([...'(,=:[!&|?{};+-*%<>~^']), REGEX_AFTER = words('return typeof case do else in of instanceof new delete void throw yield await');
// The end of a ${...} (just past its closing brace, or the end of the source), or { stop: true } where the scan cannot
// go on: at a regular expression literal (its quotes and braces would be misread as code), or after a template literal
// inside that did not close.
function exprScan(s, j) {
  let depth = 1, prev = '', word = '';
  while (j < s.length) {
    const c = s[j];
    if (c === '/' && s[j + 1] !== '/' && s[j + 1] !== '*' && (!prev || REGEX_PREV.has(prev) || REGEX_AFTER.has(word))) return { end: j, stop: true };
    if (c === '{') { depth++; j++; } else if (c === '}') { if (--depth === 0) return { end: j + 1 }; j++; } else if (c === '`') { const e = templateScan(s, j); if (!e.closed) return { end: e.end, stop: true }; j = e.end; }
    else if (c === '"' || c === "'") { j++; while (j < s.length && s[j] !== c && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1; j++; } else if (c === '/' && s[j + 1] === '/') { while (j < s.length && s[j] !== '\n') j++; } else if (c === '/' && s[j + 1] === '*') { const e = s.indexOf('*/', j + 2); j = e < 0 ? s.length : e + 2; } else j++;
    if (/\s/.test(c)) continue;
    word = /[\w$]/.test(c) ? (/[\w$]/.test(prev) ? word + c : c) : '';
    prev = s[j - 1];   // the last character read: an operator, a bracket, a word's last letter, a string's quote
  }
  return { end: s.length };
}
// A rule that matches with a function instead of a regular expression: fn(src, i) gives where the match ends.
const sticky = (fn) => ({ lastIndex: 0, exec(s) { const e = fn(s, this.lastIndex); return e > this.lastIndex ? [s.slice(this.lastIndex, e)] : null; } });
const TEMPLATE = sticky((s, i) => { if (s[i] !== '`') return i; const r = templateScan(s, i); return r.closed ? r.end : plainEnd(s, i); });

function jsIdent(ts) {
  return (w, src, j, st) => {
    const after = nextChar(src, j), prev = st.prev && st.prev.s;
    if (prev === '.' || prev === '?.') return after === '(' ? 'fn' : 'prop';
    if (JS_LIT.has(w)) return 'lit';
    if (JS_KW.has(w) || (ts && TS_KW.has(w))) return 'kw';
    if (ts && TS_TYPES.has(w)) return 'type';
    if (isPascal(w)) return 'type';
    if (after === '(') return 'fn';
    return 'plain';
  };
}
const jsRules = (ts) => [
  NL, WS,
  [/\/\/[^\n]*/y, 'com'],
  [/\/\*[\s\S]*?(?:\*\/|$)/y, 'com'],
  [TEMPLATE, 'str'],
  [DQ, 'str'], [SQ, 'str'],
  [/(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/y, 'num'],
  [/@[A-Za-z_$][\w$]*/y, 'meta'],
  [/[A-Za-z_$][\w$]*/y, jsIdent(ts)],
  [/(?:\.\.\.|=>|===|!==|==|!=|<=|>=|&&=|\|\|=|\?\?=|&&|\|\||\?\?|\?\.|\*\*=|\*\*|<<=|>>>=|>>=|<<|>>>|>>|\+\+|--|[-+*/%&|^]=|[-+*/%&|^~!=<>?:])/y, 'op'],
  [/[()[\]{},;.]/y, 'punct'],
];
const pyRules = [
  NL, WS,
  [/#[^\n]*/y, 'com'],
  [/(?:[rRbBuUfF]{1,2})?(?:"""(?:\\[\s\S]|[^\\])*?(?:"""|$)|'''(?:\\[\s\S]|[^\\])*?(?:'''|$))/y, 'str'],
  [/(?:[rRbBuUfF]{1,2})?(?:"(?:\\.|[^\\"\n])*"?|'(?:\\.|[^\\'\n])*'?)/y, 'str'],
  [/(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)[jJ]?/y, 'num'],
  [/@[A-Za-z_][\w.]*/y, 'meta'],
  [/[A-Za-z_]\w*/y, (w, src, j, st) => {
    const after = nextChar(src, j), prev = st.prev && st.prev.s;
    if (prev === '.') return after === '(' ? 'fn' : 'prop';
    if (PY_LIT.has(w)) return 'lit';
    if (PY_KW.has(w)) return 'kw';
    if (prev === 'class' || isPascal(w)) return 'type';
    if (after === '(') return 'fn';
    return 'plain';
  }],
  [/(?:\*\*=?|\/\/=?|<<=?|>>=?|->|:=|[-+*/%&|^@=<>!]=?|~)/y, 'op'],
  [/[()[\]{},;.:]/y, 'punct'],
];
// A shell word: classified by where it sits (a command at the start of a line or after | && || ; ( $( ).
function shWord(w, src, j, st) {
  // the in of for x in, case x in, select x in: on the same line or a later one. After case's in come patterns, each
  // closed by ) and followed by commands, until an esac where a command or a pattern starts (echo esac is an argument).
  if (w === 'in' && st.awaitIn) { st.caseBody = st.casePat = st.awaitIn === 'case'; st.awaitIn = false; st.cmdPos = false; return 'kw'; }
  if (w === 'esac' && st.caseBody && (st.cmdPos || st.casePat)) { st.caseBody = st.casePat = false; st.cmdPos = false; return 'kw'; }   // not echo esac
  if (st.cmdPos) {
    if (/^[A-Za-z_]\w*=/.test(w)) return 'var';                    // FOO=bar before a command
    if (SH_KW.has(w)) { st.cmdPos = !['for', 'in', 'case', 'function', 'select'].includes(w); st.awaitIn = ['for', 'case', 'select'].includes(w) ? w : false; return 'kw'; }
    st.cmdPos = false;
    return 'cmd';
  }
  const f = w.match(/^(--?[A-Za-z0-9][\w-]*)(=)([\s\S]*)$/);
  if (f) return [{ k: 'flag', s: f[1] }, { k: 'op', s: '=' }, ...(f[3] ? [{ k: 'plain', s: f[3] }] : [])];
  if (/^--?[A-Za-z0-9]/.test(w)) return 'flag';
  if (/^\d+(?:\.\d+)?$/.test(w)) return 'num';
  return 'plain';
}
const shRules = [
  NL, WS,
  [/[$%](?= )/y, (s, src, j, st) => (st.lineStart ? 'prompt' : 'plain')],
  [/#[^\n]*/y, (s, src, j) => { const p = src[j - s.length - 1]; return p === undefined || /[\s;|&()<>]/.test(p) ? 'com' : false; }],   // # starts a word
  [/'[^']*'?/y, 'str'],
  [/"(?:\\[\s\S]|[^\\"])*"?/y, 'str'],
  [/\$\(\(?/y, (s, src, j, st) => { st.cmdPos = s === '$('; return 'op'; }],
  [/\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[0-9#?@*$!-])/y, 'var'],
  [/(?:\|\||&&|;;|\d?>>|\d?>&\d|\d?>|<<-?|<|\||&|;|\(|\))/y, (s, src, j, st) => {
    const pat = st.caseBody && st.casePat;
    if (['||', '&&', ';;', '|', '&', ';', '('].includes(s) && !(pat && s === '|')) { st.cmdPos = true; st.awaitIn = false; }   // | in a pattern is or
    if (pat && s === ')') { st.casePat = false; st.cmdPos = true; }   // a case pattern ends: a command follows
    if (st.caseBody && s === ';;') { st.casePat = true; st.cmdPos = false; }   // a case clause ends: a pattern follows
    return 'op';
  }],
  [/\\(?=\n)/y, (s, src, j, st) => { st.cont = true; return 'op'; }],   // a continuation: the next line goes on with this command
  [/(?:[^\s|&;<>()'"`$\\]|\\.)+/y, shWord],
];
const jsonRules = [
  NL, WS,
  [DQ, (s, src, j) => (nextChar(src, j) === ':' ? 'prop' : 'str')],
  [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, 'num'],
  [/(?:true|false|null)\b/y, 'lit'],
  [/[{}[\],:]/y, 'punct'],
];
// diff: a line at a time. File headers are meta outside a hunk; inside one, --- and +++ lines are a removed and an
// added line. A hunk ends when the line counts in its @@ header are used up (a context line counts on both sides, a
// removed line on the old side, an added line on the new), or at a "diff " line, so the next file's --- and +++ are
// headers again, with or without git's "diff " line. A header without counts (@@ -3 +3 @@) counts one line a side.
const hunkCounts = (line) => {
  const m = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
  return m ? { old: m[1] != null ? +m[1] : 1, new: m[2] != null ? +m[2] : 1 } : null;
};
function useLine(st, o, n) {
  if (!st.counts) return;
  st.counts.old -= o; st.counts.new -= n;
  if (st.counts.old <= 0 && st.counts.new <= 0) { st.hunk = false; st.counts = null; }
}
const diffRules = [
  // a blank line inside a hunk is a context line whose leading space was trimmed
  [/\n/y, (s, src, j, st) => { const a = j - 1; if (st.hunk && a > 0 && src[a - 1] === '\n') useLine(st, 1, 1); return 'nl'; }],
  [/[^\n]+/y, (line, src, j, st) => {
    if (/^diff /.test(line)) { st.hunk = false; st.counts = null; return 'meta'; }
    if (/^@@/.test(line)) {
      st.hunk = true; st.counts = hunkCounts(line);
      const m = line.match(/^(@@[^@]*@@)([\s\S]*)$/);
      return m && m[2] ? [{ k: 'hunk', s: m[1] }, { k: 'ctx', s: m[2] }] : 'hunk';
    }
    if (!st.hunk && /^(?:--- |\+\+\+ |index |new file|deleted file|similarity|rename |old mode|new mode|Binary files)/.test(line)) return 'meta';
    if (line[0] === '\\') return 'meta';
    const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx';
    if (st.hunk) useLine(st, kind === 'add' ? 0 : 1, kind === 'del' ? 0 : 1);
    return kind;
  }],
];
const RULES = { js: jsRules(false), ts: jsRules(true), python: pyRules, shell: shRules, json: jsonRules, diff: diffRules };

// Tabs to spaces (tab stops of `tab`), and \r\n to \n, before anything is scanned or typed.
export function normCode(src, tab = 2) {
  return String(src).replace(/\r\n?/g, '\n').split('\n').map((l) => {
    let o = '';
    for (const c of l) o += c === '\t' ? ' '.repeat(tab - (o.length % tab)) : c;
    return o;
  }).join('\n');
}
// The token stream of src: [{ k, s }], whose texts join back into src exactly. A token never spans a line ('\n' is
// a token of kind nl), and neighbours of one kind are merged. lang 'plain' (or null) gives one plain token per line.
export function tokenize(src, lang) {
  const s = String(src);
  const raw = lang == null || lang === 'plain' || lang === 'text' ? [{ k: 'plain', s }] : scan(s, RULES[langOf(lang)]);
  const out = [];
  for (const t of raw) {
    const parts = t.s.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) out.push({ k: 'nl', s: '\n' });
      if (!p) return;
      const last = out[out.length - 1];
      if (last && last.k === t.k && t.k !== 'nl') last.s += p; else out.push({ k: t.k, s: p });
    });
  }
  return out;
}
// tokenize, split into lines: [[{ k, s }, ...], ...] (an empty line is []).
export function highlight(src, lang) {
  const lines = [[]];
  for (const t of tokenize(src, lang)) { if (t.k === 'nl') lines.push([]); else lines[lines.length - 1].push(t); }
  return lines;
}

// ================================================================ colours
const hx = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
// sRGB mix of two #RRGGBB colours: k 0 is a, 1 is b.
export const mix = (a, b, k) => { const A = hx(a), B = hx(b); return toHex(A.map((v, i) => v + (B[i] - v) * k)); };
const lum = (h) => { const [r, g, b] = hx(h).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// WCAG contrast ratio of two colours (1 to 21).
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// fg moved toward `toward` in tenths until it reads at `min` on bg (or reaches it).
export function readable(fg, bg, toward, min = CODE_CONTRAST) {
  for (let k = 0; k <= 10; k++) { const c = mix(fg, toward, k / 10); if (contrast(c, bg) >= min - 1e-9) return c; }
  return toward;
}
export const CODE_CONTRAST = 3;
const hue = (h) => {
  const [r, g, b] = hx(h).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return null;
  const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
};
// How far a colour's hue is from green (120 degrees); a grey is as far as can be.
const fromGreen = (h) => { const x = hue(h); return x == null ? 360 : Math.min(Math.abs(x - 120), 360 - Math.abs(x - 120)); };
const TEMPLATE_TOKENS = { bgA: '#101018', bgB: '#2A1630', ink: '#F4F1EA', muted: '#9C9AA6', accent: '#FF4A1C', accent2: '#E0A458' };

// The colours and faces code is drawn with, from a style (init's `style`; null gives the template's own tokens).
export function codeTheme(style = null, over = {}) {
  const T = { ...TEMPLATE_TOKENS, ...((style && style.tokens) || {}) };
  const fam = (r, d) => (style && style.fonts && style.fonts[r] && style.fonts[r].family) || d;
  const surface = over.surface || mix(T.bgA, T.ink, 0.06);
  const [add, del] = fromGreen(T.accent2) <= fromGreen(T.accent) ? [T.accent2, T.accent] : [T.accent, T.accent2];
  const k = {
    plain: T.ink, kw: T.accent, lit: mix(T.accent, T.accent2, 0.5), str: T.accent2, num: mix(T.accent2, T.ink, 0.35),
    com: T.muted, fn: mix(T.accent, T.ink, 0.45), type: mix(T.accent2, T.accent, 0.25), prop: mix(T.ink, T.accent2, 0.3),
    punct: mix(T.ink, T.muted, 0.55), op: mix(T.ink, T.accent, 0.35), meta: T.muted, var: T.accent2, flag: mix(T.accent, T.ink, 0.3),
    cmd: T.accent, prompt: T.accent2, add, del, hunk: mix(T.muted, T.accent2, 0.4), ctx: mix(T.ink, T.muted, 0.25),
  };
  const colors = {};
  for (const x of KINDS) colors[x] = readable(over[x] || k[x], surface, T.ink);
  return {
    family: over.family || fam('mono', 'MONO'), ui: over.ui || fam('body', 'BODY'), surface,
    chrome: over.chrome || mix(T.bgA, T.ink, 0.12), border: over.border || mix(T.bgA, T.ink, 0.24),
    ink: T.ink, muted: readable(T.muted, surface, T.ink), gutter: readable(over.gutter || T.muted, surface, T.ink),
    cursor: over.cursor || T.accent, lineHi: over.lineHi || T.accent, addBg: colors.add, delBg: colors.del, bar: over.bar || T.accent,
    colors,
  };
}

// ================================================================ the grid, typing, scrolling
const DEFAULT_TYPE = { cps: 22, jitter: 0.35, seed: 1, linePause: 0.16, spacePause: 0.02 };
export const CURSOR_SOLID = 0.5;   // seconds the cursor stays solid after a key, before it blinks
// The advance of one character in a face (monospace), measured once per context and font.
const _adv = new WeakMap();
export function advance(ctx, font) {
  let m = _adv.get(ctx);
  if (!m) { m = new Map(); _adv.set(ctx, m); }
  if (!m.has(font)) { ctx.save(); ctx.font = font; m.set(font, ctx.measureText('MMMMMMMMMM').width / 10); ctx.restore(); }
  return m.get(font);
}
// The largest size (whole px, from max down to min) at which `cols` characters of a mono face fit `width`.
export function fitSize(ctx, family, cols, width, { max = 40, min = 14 } = {}) {
  const a = advance(ctx, `100px "${family}"`) / 100;
  return Math.max(min, Math.min(max, Math.floor(width / Math.max(1, cols) / a)));
}
// When each character appears: the seeded cadence from `start`. A newline adds linePause; the indentation after it
// arrives with it (an editor indents for you), and so does the indentation of the first line typed after shown lines
// (at `start`); a space adds spacePause. Returns { T, keys }.
function cadence(chars, start, type, from = 0) {
  const ty = { ...DEFAULT_TYPE, ...type }, T = new Array(chars.length).fill(-Infinity), keys = [];
  const rnd = mulberry32((ty.seed >>> 0) || 1);
  let t = start, indent = from > 0 && chars[from - 1] === '\n';   // after shown lines typing starts on a fresh line
  for (let i = from; i < chars.length; i++) {
    const c = chars[i];
    if (indent && c === ' ') { T[i] = i > from ? T[i - 1] : t; continue; }
    indent = false;
    T[i] = t;
    keys.push({ t, key: c === '\n' ? 'enter' : c === ' ' ? 'space' : 'char' });
    t += (1 / ty.cps) * (1 + ty.jitter * (2 * rnd() - 1)) + (c === ' ' ? ty.spacePause : 0);
    if (c === '\n') { t += ty.linePause; indent = true; }
  }
  return { T, keys, end: t };
}
// How many of the times in a sorted list are at or before t.
function countTo(T, t) {
  let lo = 0, hi = T.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}
// A scroll position from a start and a list of moves { at, by, dur }: each eases (swift) from its start over its dur.
const scrollAt = (s0, moves, t) => moves.reduce((s, m) => s + m.by * swift(prog(t, m.at, m.at + m.dur)), s0);
// The cursor: solid for CURSOR_SOLID s after the last key, then on for the first half of every blink period. Before any
// key (a prompt waiting) it blinks from t = 0, on first.
function cursorOn(t, last, period) {
  if (t - last < CURSOR_SOLID) return true;
  const p = (((t - last - CURSOR_SOLID) % period) + period) % period;
  return p < period / 2;
}
const cut = (b, r) => {
  const x0 = Math.max(b.x, r.x), y0 = Math.max(b.y, r.y), x1 = Math.min(b.x + b.w, r.x + r.w), y1 = Math.min(b.y + b.h, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { ...b, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};
// First and last non-space columns of a text (end exclusive), or null when it is blank.
const extent = (s) => { const a = s.search(/\S/); if (a < 0) return null; return [a, s.replace(/\s+$/, '').length]; };
const BOX_ALPHA = 0.05;
// Draws tokens left to right on the grid from column 0, up to `cols` characters.
function drawToks(c, toks, x, base, adv, theme, cols, fallback = 'plain') {
  let col = 0;
  for (const tk of toks) {
    if (col >= cols) break;
    const s = [...tk.s], n = Math.min(s.length, cols - col);
    if (tk.s.trim()) { c.fillStyle = colorOf(theme, tk.k, fallback); c.fillText(s.slice(0, n).join(''), x + col * adv, base); }
    col += s.length;
  }
}
const lineText = (toks) => toks.map((t) => t.s).join('');
// The colour of a kind; a kind the theme does not have takes `fallback`'s, then plain's, never the colour drawn last.
const colorOf = (theme, k, fallback = 'plain') => theme.colors[k] || theme.colors[fallback] || theme.colors.plain;
// The characters of s, drawn from column 0 at x, whose cells show between the view's left and right edges, trimmed:
// a box's text is only what can be seen.
function visible(s, x, adv, view) {
  const cs = [...s], lo = Math.max(0, Math.floor((view.x - x) / adv + 1e-9)), hi = Math.min(cs.length, Math.ceil((view.x + view.w - x) / adv - 1e-9));
  return lo < hi ? cs.slice(lo, hi).join('').trim() : '';
}
// The vertical layout of a monospace block in its viewport: row height, padding, how many whole rows fit.
function grid(b) {
  const lh = b.size * b.lineH;
  return { lh, rows: Math.max(1, Math.floor((b.h - 2 * b.pad) / lh)) };
}
// Where row i sits (in rows from the top of the content, scroll subtracted): its slot's top and its baseline. The
// text box of a row is size tall, centred in the slot.
const rowY = (b, vy, i, lh) => { const top = vy + b.pad + i * lh; return { top, base: top + lh / 2 + b.size * 0.3, boxTop: top + lh / 2 - b.size * 0.5 }; };
function common(o, kind) {
  for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(o[k])) throw new Error(`${kind}: give the viewport as numbers x, y, w and h (a frame's content rect: frameLayout(...).content)`);
  const theme = o.theme || codeTheme(null), size = o.size || 32;
  return { id: o.id || kind, x: o.x, y: o.y, w: o.w, h: o.h, size, lineH: o.lineH || 1.45, pad: o.pad != null ? o.pad : Math.round(size * 0.6),
    theme, family: o.family || theme.family, blink: o.blink || 1.0, cursor: o.cursor === undefined ? 'block' : o.cursor };
}
const fontOf = (b) => `${b.size}px "${b.family}"`;

// ================================================================ typed code
//   codeBlock({ src, lang, x, y, w, h, theme, size: 32, lineH: 1.45, pad, numbers: true, start: 0, shown: 0,
//               type: { cps: 22, jitter: 0.35, seed: 1, linePause: 0.16, spacePause: 0.02 } | false,
//               cursor: 'block' | 'bar' | false, blink: 1.0, highlight: [{ lines: [a, b], from, to }],
//               focus: [{ lines: [a, b], from, to, dim: 0.3 }], follow: true, margin: 1, scrollDur: 0.35,
//               scroll: [{ at, top, dur }], id: 'code' })
// src is typed from `start` with a seeded cadence; type: false shows it all from the start. `shown` lines (from the
// top) are there before typing starts, as in a file being edited. Lines are numbered from 1: highlight puts a band
// of the accent behind lines a to b from `from` to `to`; focus dims every other line to `dim`. The view follows the
// cursor down (keeping `margin` rows under it), or, with `scroll`, moves so line `top` is at the top at each `at`;
// code shown whole (type: false) stays at the top unless `scroll` moves it.
export function codeBlock(o) {
  const b = common(o, 'code');
  const src = normCode(o.src == null ? '' : o.src, o.tab || 2);
  const chars = [...src];
  const lines = highlight(src, o.lang || 'plain');
  const lineOf = new Array(chars.length);   // the line of each character (a newline belongs to the line it ends)
  const lineStart = [0];
  { let L = 0; chars.forEach((c, i) => { lineOf[i] = L; if (c === '\n') { L++; lineStart.push(i + 1); } }); }
  const shown = clamp(Math.floor(o.shown || 0), 0, lines.length);
  const from = shown >= lines.length ? chars.length : lineStart[shown];
  const start = o.start || 0;
  const cad = o.type === false ? { T: new Array(chars.length).fill(-Infinity), keys: [], end: -Infinity } : cadence(chars, start, o.type || {}, from);
  const g = grid(b);
  // scrolling: follow the cursor's line, or the given moves
  const maxTop = Math.max(0, lines.length - g.rows), margin = o.margin != null ? o.margin : 1, dur = o.scrollDur || 0.35;
  const want = (L) => clamp(L - (g.rows - 1 - margin), 0, maxTop);
  let s0 = 0;
  const moves = [];
  if (o.scroll) {
    let prev = 0;
    for (const m of [...o.scroll].sort((a, c) => a.at - c.at)) { const top = clamp((m.top || 1) - 1, 0, maxTop); moves.push({ at: m.at, by: top - prev, dur: m.dur || 0.5 }); prev = top; }
  } else if (o.follow !== false && o.type !== false) {
    // typed code follows its cursor; code shown whole (type: false) stays at the top unless `scroll` moves it
    const L0 = Math.min(shown, lines.length - 1);
    s0 = want(L0);
    let prev = s0;
    chars.forEach((c, i) => { if (c === '\n' && i >= from && Number.isFinite(cad.T[i])) { const w = want(lineOf[i] + 1); if (w !== prev) { moves.push({ at: cad.T[i], by: w - prev, dur }); prev = w; } } });
  }
  return Object.freeze({ ...b, kind: 'code', src, chars, lines, lineOf, lineStart, T: cad.T, keys: cad.keys, end: cad.end, start, shown,
    numbers: o.numbers !== false, rows: g.rows, lh: g.lh, s0, moves, highlight: o.highlight || [], focus: o.focus || [] });
}
// The state of a code block at t: { typed (characters showing), total, done, line and col of the cursor (0-based),
// cursor (whether it shows), scroll (the top row, 0-based, fractional while it moves), rows (that fit), lines (the
// text showing on each line, up to the cursor's) }.
export function codeAt(b, t) {
  const typed = countTo(b.T, t), total = b.chars.length;
  const line = typed ? (b.chars[typed - 1] === '\n' ? b.lineOf[typed - 1] + 1 : b.lineOf[typed - 1]) : 0;
  const col = typed - b.lineStart[line];
  const lines = [];
  for (let L = 0; L <= Math.max(line, b.shown - 1) && L < b.lines.length; L++) {
    const a = b.lineStart[L], e = L + 1 < b.lineStart.length ? b.lineStart[L + 1] - 1 : total;
    lines.push(b.chars.slice(a, Math.max(a, Math.min(e, typed))).join(''));
  }
  const last = typed ? b.T[typed - 1] : -Infinity;
  const on = b.cursor !== false && cursorOn(t, Number.isFinite(last) ? last : -CURSOR_SOLID, b.blink);
  return { typed, total, done: typed >= total, line, col, cursor: on, scroll: scrollAt(b.s0, b.moves, t), rows: b.rows, lines };
}
const band = (spans, t) => {
  let k = 0;
  for (const s of spans) k = Math.max(k, Math.min(snap(prog(t, s.from, s.from + 0.25)), 1 - snap(prog(t, s.to, s.to + 0.25))));
  return k;
};
const inLines = (s, L) => { const [a, b] = Array.isArray(s.lines) ? s.lines : [s.lines, s.lines]; return L + 1 >= a && L + 1 <= (b ?? a); };
export function drawCode(ctx, b, t, { draw = true, alpha = 1, dx = 0, dy = 0 } = {}) {
  const st = codeAt(b, t), out = [];
  out.state = st;
  if (alpha <= 0) return out;
  const vx = b.x + dx, vy = b.y + dy, view = { x: vx, y: vy, w: b.w, h: b.h };
  const font = fontOf(b), adv = advance(ctx, font), lh = b.lh;
  const nd = String(b.lines.length).length, gutterW = b.numbers ? (nd + 1.5) * adv : 0;
  const x0 = vx + b.pad, tx = x0 + gutterW;
  const first = Math.max(0, Math.floor(st.scroll) - 1), lastRow = Math.min(st.lines.length - 1, Math.ceil(st.scroll) + b.rows + 1);
  if (draw) {
    ctx.save();
    ctx.beginPath(); ctx.rect(vx, vy, b.w, b.h); ctx.clip();
    ctx.globalAlpha *= alpha; ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  for (let L = first; L <= lastRow; L++) {
    const y = rowY(b, vy, L - st.scroll, lh);
    if (y.top > vy + b.h || y.top + lh < vy) continue;
    const hi = b.highlight.filter((s) => inLines(s, L)), foc = b.focus.filter((s) => !inLines(s, L));
    const dim = foc.reduce((a, s) => Math.min(a, lerp(1, s.dim != null ? s.dim : 0.3, band([s], t))), 1);
    const text = st.lines[L];
    if (draw) {
      const kh = band(hi, t);
      if (kh > 0) { ctx.fillStyle = rgba(b.theme.lineHi, 0.16 * kh); ctx.fillRect(vx, y.top, b.w, lh); }
      ctx.save(); ctx.globalAlpha *= dim;
      if (b.numbers) { ctx.fillStyle = b.theme.gutter; ctx.fillText(String(L + 1).padStart(nd), x0, y.base); }
      drawToks(ctx, b.lines[L], tx, y.base, adv, b.theme, [...text].length);
      ctx.restore();
    }
    // a box per drawn row: from the line number (when there are numbers) to the end of the text, or the number alone on a
    // row with no text yet; its text is what shows of the code (or of the number, on a row with only a number)
    const e = extent(text), num = String(L + 1), nx = x0 + (nd - num.length) * adv;
    if ((e || b.numbers) && alpha * dim > BOX_ALPHA) {
      const left = b.numbers ? nx : tx + e[0] * adv, right = e ? tx + e[1] * adv : nx + num.length * adv;
      const bb = cut({ id: `${b.id}:${L + 1}`, text: '', x: left, y: y.boxTop, w: right - left, h: b.size, group: b.id, line: L + 1 }, view);
      if (bb) { bb.text = (e && visible(text, tx, adv, view)) || (b.numbers ? visible(num, nx, adv, view) : ''); out.push(bb); }
    }
  }
  if (st.cursor && b.cursor) {
    const y = rowY(b, vy, st.line - st.scroll, lh), cx = tx + st.col * adv;
    const r = b.cursor === 'bar' ? { x: cx, y: y.boxTop, w: Math.max(2, b.size * 0.09), h: b.size } : { x: cx, y: y.boxTop, w: adv, h: b.size };
    if (draw) { ctx.fillStyle = b.theme.cursor; ctx.globalAlpha *= 0.85; ctx.fillRect(r.x, r.y, r.w, r.h); }
    const cb = cut({ id: `${b.id}:cursor`, text: '', ...r, deco: true }, view);
    if (cb && alpha > BOX_ALPHA) out.push(cb);
  }
  if (draw) ctx.restore();
  return out;
}

// ================================================================ diffs
//   diffBlock({ src (a unified diff), lang (to colour the code in it), x, y, w, h, theme, size, lineH, pad, start: 0,
//               step: 0.3, grow: 0.25, hunks: true, follow: true, scrollDur: 0.35, id: 'diff' })
// The context and the removed lines show from the start, as the file was. From `start`, every change lands in order,
// `step` seconds apart: a removed line takes the removed colour, its - marker and a strike-through; an added line
// opens over `grow` seconds, pushing the lines under it down, with its + marker. File headers (diff, ---, +++) are
// left out (put the file's name in the frame's title); hunk headers show unless hunks: false.
export function diffBlock(o) {
  const b = common(o, 'diff');
  const src = normCode(o.src == null ? '' : o.src, o.tab || 2);
  const rows = [], lines = highlight(src, 'diff');
  if (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();   // the newline that ends the last line
  let piece = 0;   // which hunk a row belongs to: each hunk header starts the next, shown or not (hunks: false)
  for (const toks of lines) {
    const kind = toks.length ? toks[0].k : 'ctx', text = lineText(toks);   // a blank line in a hunk is context
    if (kind === 'hunk') piece++;
    if (kind === 'meta') continue;
    if (kind === 'hunk' && o.hunks === false) continue;
    const body = kind === 'hunk' ? text : text.slice(1);
    rows.push({ kind, piece, mark: kind === 'add' ? '+' : kind === 'del' ? '-' : ' ', text: body, toks: kind === 'hunk' ? toks : [{ k: kind, s: body }] });
  }
  // with a language, each hunk is coloured as two sources: the old file's lines (context and removed) and the new
  // file's (context and added), each scanned as one, so a comment or a string over lines keeps its state. Removed lines
  // take the old file's colours, added and context lines the new file's. Each hunk starts afresh, its header shown or not.
  if (o.lang) {
    const pieces = new Map();
    for (const r of rows) if (r.kind !== 'hunk') { if (!pieces.has(r.piece)) pieces.set(r.piece, []); pieces.get(r.piece).push(r); }
    for (const seg of pieces.values()) {
      for (const [mine, kinds] of [['del', ['ctx', 'del']], ['add', ['ctx', 'add']]]) {
        const rs = seg.filter((r) => kinds.includes(r.kind)), hl = highlight(rs.map((r) => r.text).join('\n'), o.lang);
        rs.forEach((r, i) => { if (r.kind === mine || (mine === 'add' && r.kind === 'ctx')) r.toks = hl[i] || []; });
      }
    }
  }
  const start = o.start || 0, step = o.step != null ? o.step : 0.3, grow = o.grow != null ? o.grow : 0.25;
  let k = 0;
  for (const r of rows) r.at = r.kind === 'add' || r.kind === 'del' ? start + step * k++ : -Infinity;
  const g = grid(b);
  // follow: a change that lands below the view scrolls it (in rows) until the change is in view with `margin` rows
  // under it. When change i lands every row above it is there (the changes before it have landed).
  const margin = o.margin != null ? o.margin : 0, dur = o.scrollDur || 0.35, moves = [];
  if (o.follow !== false) {
    let prev = 0;
    rows.forEach((r, i) => {
      if (r.kind !== 'add' && r.kind !== 'del') return;
      const want = Math.max(0, i + 1 + margin - g.rows);
      if (want > prev) { moves.push({ at: r.at, by: want - prev, dur }); prev = want; }
    });
  }
  return Object.freeze({ ...b, kind: 'diff', rows, changes: k, start, step, grow, lhPx: g.lh, fit: g.rows, moves });
}
// The state of a diff at t: { landed (changes landed), changes, scroll (rows, 0-based), rows: [{ kind, text, open
// (0 to 1: how far an added line has opened), mark (0 to 1: a removed line's marking) }] }.
export function diffAt(b, t) {
  const rows = b.rows.map((r) => ({ kind: r.kind, text: r.text,
    open: r.kind === 'add' ? snap(prog(t, r.at, r.at + b.grow)) : 1,
    mark: r.kind === 'del' ? snap(prog(t, r.at, r.at + 0.2)) : r.kind === 'add' ? 1 : 0 }));
  return { landed: b.rows.filter((r) => (r.kind === 'add' || r.kind === 'del') && t >= r.at).length, changes: b.changes, scroll: scrollAt(0, b.moves, t), rows };
}
export function drawDiff(ctx, b, t, { draw = true, alpha = 1, dx = 0, dy = 0 } = {}) {
  const st = diffAt(b, t), out = [];
  out.state = st;
  if (alpha <= 0) return out;
  const vx = b.x + dx, vy = b.y + dy, view = { x: vx, y: vy, w: b.w, h: b.h };
  const font = fontOf(b), adv = advance(ctx, font), lh = b.lhPx, th = b.theme;
  const x0 = vx + b.pad, tx = x0 + 2 * adv;
  if (draw) {
    ctx.save();
    ctx.beginPath(); ctx.rect(vx, vy, b.w, b.h); ctx.clip();
    ctx.globalAlpha *= alpha; ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  let at = -st.scroll;   // rows from the top of the content, fractional while an added line opens
  st.rows.forEach((r, i) => {
    const R = b.rows[i], hgt = r.kind === 'add' ? r.open : 1;
    if (hgt <= 0) return;
    const y = rowY(b, vy, at, lh), slot = { x: vx, y: y.top, w: b.w, h: lh * hgt };
    at += hgt;
    if (slot.y > vy + b.h || slot.y + slot.h < vy) return;
    const yo = -(1 - hgt) * lh / 2;   // an opening line sits centred in the part of its slot that is open
    const base = y.base + yo, boxTop = y.boxTop + yo;
    if (draw) {
      ctx.save();
      ctx.beginPath(); ctx.rect(slot.x, slot.y, slot.w, slot.h); ctx.clip();
      if (r.kind === 'add' || r.kind === 'del') {
        const tint = r.kind === 'add' ? th.addBg : th.delBg;
        ctx.fillStyle = rgba(tint, 0.16 * r.mark); ctx.fillRect(vx, slot.y, b.w, slot.h);
        ctx.fillStyle = rgba(tint, r.mark); ctx.fillRect(vx, slot.y, Math.max(3, b.size * 0.12), slot.h);
      }
      if (r.kind === 'add') ctx.globalAlpha *= r.open;
      if (r.kind === 'hunk') drawToks(ctx, R.toks, x0, base, adv, th, Infinity, 'hunk');
      else {
        if (r.mark > 0 && r.kind !== 'ctx') { ctx.save(); ctx.globalAlpha *= r.mark; ctx.fillStyle = th.colors[r.kind]; ctx.fillText(R.mark, x0, base); ctx.restore(); }
        if (r.kind === 'del') {
          ctx.save(); ctx.globalAlpha *= lerp(1, 0.6, r.mark); drawToks(ctx, R.toks, tx, base, adv, th, Infinity, 'ctx'); ctx.restore();
          const e = extent(R.text);
          if (e && r.mark > 0) { ctx.fillStyle = rgba(th.colors.del, 0.9); ctx.fillRect(tx + e[0] * adv, base - b.size * 0.3, (e[1] - e[0]) * adv * snap(prog(t, R.at + 0.05, R.at + 0.3)), Math.max(2, b.size * 0.07)); }
        } else drawToks(ctx, R.toks, tx, base, adv, th, Infinity, r.kind === 'add' ? 'add' : 'ctx');
      }
      ctx.restore();
    }
    const shows = r.kind === 'hunk' ? R.text : (r.mark > 0 && r.kind !== 'ctx' ? R.mark + ' ' : '  ') + R.text;
    const e = extent(shows), a = alpha * (r.kind === 'add' ? r.open : 1);
    if (e && a > BOX_ALPHA) {
      const inSlot = cut({ id: `${b.id}:${i + 1}`, text: '', x: x0 + e[0] * adv, y: boxTop, w: (e[1] - e[0]) * adv, h: b.size, group: b.id, line: i + 1 }, slot);
      const bb = inSlot && cut(inSlot, view);
      if (bb) { bb.text = visible(shows, x0, adv, view); out.push(bb); }
    }
  });
  if (draw) ctx.restore();
  return out;
}

// ================================================================ a terminal session
//   termSession({ x, y, w, h, theme, size, lineH, pad, prompt: '$ ', lang: 'shell', start: 0, type: { cps, seed, ... },
//                 cursor: 'block', blink: 1.0, end: true, scrollDur: 0.12, id: 'term', steps: [
//     { cmd: 'mycli init', pause: 0.3, enter: 0.15 },          // typed after a pause; Enter; output follows
//     { out: 'one line' | ['line', ...], every: 0.06, after: 0, kind: 'plain' },
//     { spin: 'reading files', dur: 1.2, done: '+ read 6 files', fps: 10, frames: ['|', '/', '-', '\\'], kind, doneKind },
//     { bar: 'fetching', dur: 1.4, width: 16, done: '...', kind, doneKind },
//     { wait: 0.5 } ] })
// One row per command or line of output; rows come one after another, each starting when the one before is done (a
// step's `at`, in picture time, holds it back until then: a command's typing, any other step's start). A command, a
// spin or bar label, a done line and the prompt are one line each (a newline in one is an error); an out text with a
// newline makes a row per line; tabs become spaces. kind colours a row (a codeTheme kind: plain, add, del, com...;
// one the theme does not have takes plain's colour), doneKind the line a spinner or a bar ends on. The session opens
// on a prompt (there from the first frame) and, with end: true, ends on a fresh one. It scrolls when the rows
// outgrow the viewport, so the newest row is the last that shows.
// When a step that is not a command starts: `after` seconds after the step before, or at `at` if that is later.
const begin = (t, s) => Math.max(t + (s.after || 0), s.at != null ? s.at : -Infinity);
export function termSession(o) {
  const b = common(o, 'term');
  const tab = o.tab || 2;
  // a command, a label or the prompt is one row: tabs to spaces, and a newline refused
  const oneLine = (x, what) => {
    const v = normCode(String(x), tab);
    if (v.includes('\n')) throw new Error(`termSession: ${what} ${JSON.stringify(String(x))} has a newline; a row is one line: give each command its own cmd step, and print lines with out`);
    return v;
  };
  const prompt = o.prompt != null ? oneLine(o.prompt, 'the prompt') : '$ ';
  const lang = o.lang === undefined ? 'shell' : o.lang;
  const rows = [], keys = [];
  let t = o.start || 0, seed = (o.type && o.type.seed) || 1;
  const promptToks = prompt ? [{ k: 'prompt', s: prompt }] : [];
  for (const s of o.steps || []) {
    if (s.cmd != null) {
      // its prompt shows once the step before is done (the first from the start); the command is typed after `pause`
      const cmd = oneLine(s.cmd, 'the cmd'), at0 = s.at != null ? Math.max(t, s.at) : t + (s.pause != null ? s.pause : 0.3);
      const cad = cadence([...cmd], at0, { ...(o.type || {}), seed: seed++ });
      const enter = cad.end + (s.enter != null ? s.enter : 0.15);
      keys.push(...cad.keys, { t: enter, key: 'enter' });
      rows.push({ type: 'cmd', at: rows.length ? t : -Infinity, text: prompt + cmd, toks: [...promptToks, ...(lang ? highlight(cmd, lang)[0] : [{ k: 'plain', s: cmd }])],
        pre: [...prompt].length, T: cad.T, enter });
      t = enter;
    } else if (s.out != null) {
      const list = [].concat(s.out).flatMap((x) => normCode(String(x), tab).split('\n')), every = s.every != null ? s.every : 0.06;   // a newline starts a row
      t = begin(t, s);
      list.forEach((line, i) => rows.push({ type: 'out', at: t + i * every, text: line, toks: [{ k: s.kind || 'plain', s: line }] }));
      t += list.length * every;
    } else if (s.spin != null) {
      t = begin(t, s);
      rows.push({ type: 'spin', at: t, dur: s.dur || 1, text: oneLine(s.spin, 'the spin label'), done: s.done != null ? oneLine(s.done, 'the done line') : null, fps: s.fps || 10,
        frames: s.frames || ['|', '/', '-', '\\'], kind: s.kind || 'plain', doneKind: s.doneKind || s.kind || 'plain' });
      t += s.dur || 1;
    } else if (s.bar != null) {
      t = begin(t, s);
      rows.push({ type: 'bar', at: t, dur: s.dur || 1, text: oneLine(s.bar, 'the bar label'), done: s.done != null ? oneLine(s.done, 'the done line') : null, width: s.width || 16,
        kind: s.kind || 'plain', doneKind: s.doneKind || s.kind || 'plain' });
      t += s.dur || 1;
    } else if (s.wait != null) t = begin(t, s) + s.wait;
    else throw new Error(`termSession: a step needs cmd, out, spin, bar or wait (${JSON.stringify(s)})`);
  }
  if (o.end !== false) rows.push({ type: 'cmd', at: rows.length ? t : -Infinity, text: prompt, toks: promptToks, pre: [...prompt].length, T: [], enter: Infinity, idle: true });
  const g = grid(b), dur = o.scrollDur || 0.12, moves = [];
  let prev = 0;
  rows.forEach((r, i) => { const want = Math.max(0, i + 1 - g.rows); if (want > prev) { moves.push({ at: r.at, by: want - prev, dur }); prev = want; } });
  return Object.freeze({ ...b, kind: 'term', rows, keys, end: t, lh: g.lh, fit: g.rows, moves });
}
// The text a row shows at t (and for a bar its fill, 0 to 1), or null before it appears.
function rowNow(r, t) {
  if (t < r.at) return null;
  if (r.type === 'cmd') { const n = countTo(r.T, t); return { text: [...r.text].slice(0, r.pre + n).join(''), cols: r.pre + n }; }
  if (r.type === 'out') return { text: r.text };
  const k = prog(t, r.at, r.at + r.dur);
  if (r.type === 'spin') {
    if (k >= 1 && r.done != null) return { text: r.done, done: true };
    if (k >= 1) return { text: r.text, done: true };
    return { text: `${r.frames[Math.floor((t - r.at) * r.fps + 1e-9) % r.frames.length]} ${r.text}` };
  }
  const fill = k >= 1 ? 1 : swift(k);   // bar
  if (k >= 1 && r.done != null) return { text: r.done, done: true };
  return { text: r.text, fill, pct: Math.round(100 * fill) };
}
// The state of a session at t: { rows: [the text of every row showing], scroll (rows, 0-based), typing (the row a
// command is being typed into, from its first key to its last, or -1), cursor (whether it shows), fill (the newest
// bar's fill, or null) }.
export function termAt(b, t) {
  const rows = [], now = [];
  let fill = null, cursorRow = -1, typing = -1, last = -Infinity;
  b.rows.forEach((r, i) => {
    const n = rowNow(r, t);
    if (!n) return;
    rows.push(r.type === 'bar' && n.pct != null ? `${n.text} ${n.pct}%` : n.text);
    now.push({ i, ...n });
    if (r.type === 'bar') fill = n.fill != null ? n.fill : 1;
    if (r.type === 'cmd') {
      cursorRow = t < r.enter ? i : -1;
      if (t < r.enter) { const k = countTo(r.T, t); typing = k > 0 && k < r.T.length ? i : -1; last = k ? r.T[k - 1] : r.at; }
    } else cursorRow = -1;
  });
  const on = b.cursor !== false && cursorRow >= 0 && cursorOn(t, Number.isFinite(last) ? last : -CURSOR_SOLID, b.blink);
  return { rows, now, scroll: scrollAt(0, b.moves, t), typing, cursor: on, cursorRow, fill };
}
export function terminal(ctx, b, t, { draw = true, alpha = 1, dx = 0, dy = 0 } = {}) {
  const st = termAt(b, t), out = [];
  out.state = { rows: st.rows, scroll: st.scroll, typing: st.typing, cursor: st.cursor, fill: st.fill };
  if (alpha <= 0) return out;
  const vx = b.x + dx, vy = b.y + dy, view = { x: vx, y: vy, w: b.w, h: b.h };
  const font = fontOf(b), adv = advance(ctx, font), lh = b.lh, th = b.theme, x0 = vx + b.pad;
  if (draw) {
    ctx.save();
    ctx.beginPath(); ctx.rect(vx, vy, b.w, b.h); ctx.clip();
    ctx.globalAlpha *= alpha; ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  st.now.forEach((n, j) => {
    const r = b.rows[n.i], y = rowY(b, vy, j - st.scroll, lh);
    if (y.top > vy + b.h || y.top + lh < vy) return;
    let text = n.text, ext = null;
    if (r.type === 'bar' && n.pct != null) {
      const cols = [...r.text].length, bx = x0 + (cols + 1) * adv, bw = r.width * adv, bh = b.size * 0.5, by = y.base - b.size * 0.42;
      if (draw) {
        ctx.fillStyle = colorOf(th, r.kind); ctx.fillText(r.text, x0, y.base);
        ctx.fillStyle = rgba(th.border, 0.9); ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = th.bar; ctx.fillRect(bx, by, bw * n.fill, bh);
        ctx.fillStyle = colorOf(th, r.kind); ctx.fillText(`${n.pct}%`, bx + bw + adv, y.base);
      }
      // what shows of the label and of the percentage (the bar between them is drawn, not text)
      text = [visible(r.text, x0, adv, view), visible(`${n.pct}%`, bx + bw + adv, adv, view)].filter(Boolean).join(' ');
      ext = [0, cols + 1 + r.width + 1 + `${n.pct}%`.length];
    } else if (draw) {
      if (r.type === 'cmd') drawToks(ctx, r.toks, x0, y.base, adv, th, n.cols);
      else { ctx.fillStyle = colorOf(th, (n.done ? r.doneKind : r.kind) || (r.toks && r.toks[0].k)); ctx.fillText(text, x0, y.base); }
    }
    const e = ext || extent(text);
    if (e && alpha > BOX_ALPHA) {
      const bb = cut({ id: `${b.id}:${n.i + 1}`, text: '', x: x0 + e[0] * adv, y: y.boxTop, w: (e[1] - e[0]) * adv, h: b.size, group: b.id, line: n.i + 1 }, view);
      if (bb) { bb.text = ext ? text : visible(text, x0, adv, view); out.push(bb); }
    }
    if (r.type === 'cmd' && n.i === st.cursorRow && st.cursor && b.cursor) {
      const cx = x0 + n.cols * adv, c = b.cursor === 'bar' ? { x: cx, y: y.boxTop, w: Math.max(2, b.size * 0.09), h: b.size } : { x: cx, y: y.boxTop, w: adv, h: b.size };
      if (draw) { ctx.save(); ctx.globalAlpha *= 0.85; ctx.fillStyle = th.cursor; ctx.fillRect(c.x, c.y, c.w, c.h); ctx.restore(); }
      const cb = cut({ id: `${b.id}:cursor`, text: '', ...c, deco: true }, view);
      if (cb && alpha > BOX_ALPHA) out.push(cb);
    }
  });
  if (draw) ctx.restore();
  return out;
}

// ================================================================ frames: a window, a browser, a phone
// Generic shapes with no product's marks: a window has a title bar with three dots in the theme's border colour and
// a centred title; a browser adds back and forward chevrons and an address field; a phone is a rounded body with a
// small round camera and a status row (a time and a battery drawn as shapes). frameLayout gives the rectangles
// without a canvas: { outer, bar, content, radius } (content is where the code, the terminal or a screenshot goes).
export function frameLayout(kind, r, o = {}) {
  const outer = { x: r.x, y: r.y, w: r.w, h: r.h };
  if (kind === 'window' || kind === 'browser') {
    const bar = o.bar != null ? o.bar : kind === 'browser' ? 72 : 56;
    return { kind, outer, bar: { x: r.x, y: r.y, w: r.w, h: bar }, content: { x: r.x, y: r.y + bar, w: r.w, h: r.h - bar }, radius: o.radius != null ? o.radius : 18 };
  }
  if (kind === 'phone') {
    const bezel = o.bezel != null ? o.bezel : Math.round(r.w * 0.035), radius = o.radius != null ? o.radius : Math.round(r.w * 0.13);
    const screen = { x: r.x + bezel, y: r.y + bezel, w: r.w - 2 * bezel, h: r.h - 2 * bezel };
    const status = o.status != null ? o.status : Math.round(screen.w * 0.1);
    return { kind, outer, screen, bar: { x: screen.x, y: screen.y, w: screen.w, h: status },
      content: { x: screen.x, y: screen.y + status, w: screen.w, h: screen.h - status }, radius, inner: Math.max(0, radius - bezel) };
  }
  throw new Error(`frameLayout: no frame "${kind}" (window, browser, phone)`);
}
function rrect(c, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + k, y); c.arcTo(x + w, y, x + w, y + h, k); c.arcTo(x + w, y + h, x, y + h, k); c.arcTo(x, y + h, x, y, k); c.arcTo(x, y, x + w, y, k); c.closePath();
}
//   drawFrame(ctx, 'window' | 'browser' | 'phone', { x, y, w, h }, { theme, title, url, time: '12:00', draw: true,
//             alpha: 1, dx: 0, dy: 0, shadow: true, id: 'frame', bar, radius, bezel, status })
// Draws the frame and its surface (the content area filled with the theme's surface) and returns its boxes, all
// deco: the frame, and the title, the address or the time. The array carries `.layout` (frameLayout, moved by dx, dy).
export function drawFrame(ctx, kind, r, o = {}) {
  const th = o.theme || codeTheme(null), alpha = o.alpha != null ? o.alpha : 1, dx = o.dx || 0, dy = o.dy || 0;
  const L = frameLayout(kind, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }, o), id = o.id || 'frame';
  const out = [];
  out.layout = L;
  if (alpha <= 0) return out;
  const draw = o.draw !== false, O = L.outer, bar = L.bar;
  const label = kind === 'browser' ? (o.url != null ? String(o.url) : '') : kind === 'phone' ? (o.time != null ? String(o.time) : '12:00') : (o.title != null ? String(o.title) : '');
  const fs = kind === 'phone' ? Math.round(bar.h * 0.42) : Math.round(bar.h * 0.36);
  const lfont = `${fs}px "${th.ui}"`;
  let lx = 0, lw = 0, ly = 0;
  if (label) {
    ctx.save(); ctx.font = lfont; lw = ctx.measureText(label).width; ctx.restore();
    if (kind === 'window') lx = bar.x + (bar.w - lw) / 2;
    else if (kind === 'browser') lx = bar.x + bar.h * 1.9 + bar.h * 0.3;
    else lx = bar.x + bar.h * 0.55;
    ly = bar.y + bar.h / 2 + fs * 0.35;
  }
  if (draw) {
    const sc = ctx.getTransform ? Math.hypot(ctx.getTransform().a, ctx.getTransform().b) : 1;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (kind === 'phone') {
      if (o.shadow !== false) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40 * sc; ctx.shadowOffsetY = 16 * sc; }
      rrect(ctx, O.x, O.y, O.w, O.h, L.radius); ctx.fillStyle = th.chrome; ctx.fill();
      if (o.shadow !== false) ctx.restore();
      ctx.strokeStyle = th.border; ctx.lineWidth = 2; ctx.stroke();
      rrect(ctx, L.screen.x, L.screen.y, L.screen.w, L.screen.h, L.inner); ctx.fillStyle = th.surface; ctx.fill();
      const cam = Math.max(4, bar.h * 0.16);
      ctx.fillStyle = th.chrome; ctx.beginPath(); ctx.arc(L.screen.x + L.screen.w / 2, bar.y + bar.h / 2, cam, 0, Math.PI * 2); ctx.fill();
      const bw = bar.h * 0.55, bh = bar.h * 0.26, bx = bar.x + bar.w - bar.h * 0.55 - bw, by = bar.y + bar.h / 2 - bh / 2;
      ctx.strokeStyle = th.muted; ctx.lineWidth = Math.max(1.5, bh * 0.14); ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = th.muted; ctx.fillRect(bx + 2, by + 2, (bw - 4) * 0.7, bh - 4); ctx.fillRect(bx + bw, by + bh * 0.3, bh * 0.16, bh * 0.4);
    } else {
      if (o.shadow !== false) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 36 * sc; ctx.shadowOffsetY = 14 * sc; }
      rrect(ctx, O.x, O.y, O.w, O.h, L.radius); ctx.fillStyle = th.surface; ctx.fill();
      if (o.shadow !== false) ctx.restore();
      ctx.save(); rrect(ctx, O.x, O.y, O.w, O.h, L.radius); ctx.clip();
      ctx.fillStyle = th.chrome; ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
      ctx.fillStyle = th.border; ctx.fillRect(bar.x, bar.y + bar.h - 1.5, bar.w, 1.5);
      ctx.restore();
      rrect(ctx, O.x, O.y, O.w, O.h, L.radius); ctx.strokeStyle = th.border; ctx.lineWidth = 2; ctx.stroke();
      const d = bar.h * 0.13;
      ctx.fillStyle = th.border;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(bar.x + bar.h * 0.5 + i * d * 3.2, bar.y + bar.h / 2, d, 0, Math.PI * 2); ctx.fill(); }
      if (kind === 'browser') {
        const ax = bar.x + bar.h * 1.9, ah = bar.h * 0.56, aw = bar.w - bar.h * 1.9 - bar.h * 0.4, ay = bar.y + (bar.h - ah) / 2;
        rrect(ctx, ax, ay, aw, ah, ah / 2); ctx.fillStyle = th.surface; ctx.fill();
        ctx.strokeStyle = th.muted; ctx.lineWidth = Math.max(2, bar.h * 0.035); ctx.lineCap = 'round';
        const cy = bar.y + bar.h / 2, cs = bar.h * 0.11, c0 = bar.x + bar.h * 1.25;
        for (const [cx, s] of [[c0, 1], [c0 + bar.h * 0.38, -1]]) { ctx.beginPath(); ctx.moveTo(cx + s * cs * 0.6, cy - cs); ctx.lineTo(cx - s * cs * 0.6, cy); ctx.lineTo(cx + s * cs * 0.6, cy + cs); ctx.stroke(); }
      }
    }
    if (label) { ctx.font = lfont; ctx.fillStyle = th.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, lx, ly); }
    ctx.restore();
  }
  if (alpha > BOX_ALPHA) {
    out.push({ id: `${id}:frame`, text: '', x: O.x, y: O.y, w: O.w, h: O.h, deco: true });
    if (label) out.push({ id: `${id}:label`, text: label, x: lx, y: ly - fs * 0.8, w: lw, h: fs, deco: true });
  }
  return out;
}

// ================================================================ key ticks
export const KEY_MAX = 12;   // the ceiling: at most this many key ticks in any one second
// The key presses of a code block or a terminal session, in time order: [{ t, key: 'char' | 'space' | 'enter' }].
// Characters that arrive without a key (an editor's indentation, lines already shown, output) are not in it.
export function typedTimes(b) {
  return [...(b.keys || [])].sort((x, y) => x.t - y.t);
}
// Thins key presses to at most `max` in any one second: in time order, a press is kept when it comes at least 1/max s
// after the last one kept and fewer than `max` kept presses fall in the second before it (half-open, (t - 1, t]).
// Takes the presses of every block merged (sorted here); returns the kept ones.
export function keyTicks(list, { max = KEY_MAX } = {}) {
  const all = [...list].sort((a, b) => a.t - b.t), kept = [];
  let w = 0;
  for (const k of all) {
    if (!Number.isFinite(k.t)) continue;
    while (w < kept.length && kept[w].t <= k.t - 1 + 1e-9) w++;
    if (kept.length && k.t - kept[kept.length - 1].t < 1 / max - 1e-9) continue;
    if (kept.length - w >= max) continue;
    kept.push(k);
  }
  return kept;
}
// Plays key ticks in an OfflineAudioContext (audio.js): each a short band-passed noise click, Enter lower and fuller,
// varied by a seeded generator. dest is the node to play into (audio.js's master, or a send). level is the click's
// peak; style.sound.bright and pitch (the look's timbre) move its band.
export function keySounds(ac, dest, ticks, { seed = 5, level = 0.18, style = null } = {}) {
  const snd = { pitch: 1, bright: 1, ...((style && style.sound) || {}) }, rnd = mulberry32(seed), sr = ac.sampleRate;
  const len = Math.round(sr * 0.05), buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.exp(-i / (sr * 0.006));
  for (const k of ticks) {
    const enter = k.key === 'enter', v = 0.75 + 0.5 * rnd();
    const src = ac.createBufferSource(); src.buffer = buf; src.playbackRate.value = (enter ? 0.62 : 0.9 + 0.25 * rnd()) * snd.pitch;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.value = (enter ? 1500 : k.key === 'space' ? 2200 : 3000 + 900 * rnd()) * snd.bright;
    const g = ac.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(level * v * (enter ? 1.35 : k.key === 'space' ? 0.8 : 1), k.t);
    g.gain.exponentialRampToValueAtTime(0.0001, k.t + (enter ? 0.07 : 0.04));
    src.connect(bp).connect(g).connect(dest);
    src.start(k.t); src.stop(k.t + 0.06);
  }
}
