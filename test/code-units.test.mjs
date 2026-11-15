// Code and terminal motion without a browser (plan 23.3): golden token streams per language, the theme taken from a
// style's tokens, the seeded typing, and the layout calls of drawCode, drawDiff and terminal at stated times (the
// visible prefix, the rows shown, the scroll offset, the boxes: cut to the viewport, scrolled lines left out, one group
// per block, the cursor and frames deco), check's text detectors on those boxes, frames, and the key-tick thinning.
// The expected values are worked out by hand from the cadence (jitter 0: one character every 1/cps s, plus the pauses).
// test/code.test.mjs renders the same helpers in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { templateDir, fixturesDir } from './helpers.mjs';
import { C } from './check-helpers.mjs';

const K = await import(pathToFileURL(path.join(templateDir, 'code.js')).href);
const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
const { swift } = await import(pathToFileURL(path.join(templateDir, 'lib.js')).href);

// A 2D context that measures every character 20 px wide (the helpers draw on a monospace grid).
const ADV = 20;
const fake = () => ({ font: '', save() {}, restore() {}, measureText: (s) => ({ width: [...String(s)].length * ADV }) });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
// A 2D context that records every fillText with the fill colour, alpha and clip in effect (save and restore kept), and
// ignores a fill colour that is not a string, as a canvas ignores one it cannot parse.
function recorder() {
  const calls = [], stack = [];
  let st = { fillStyle: '#000000', globalAlpha: 1, font: '', clip: null, path: null };
  const meet = (a, b) => { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y); return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) }; };
  const ctx = {
    save() { stack.push({ ...st }); }, restore() { if (stack.length) st = stack.pop(); },
    measureText: (x) => ({ width: [...String(x)].length * ADV }),
    beginPath() { st.path = null; }, rect(x, y, w, h) { st.path = { x, y, w, h }; },
    clip() { if (st.path) st.clip = st.clip ? meet(st.clip, st.path) : { ...st.path }; },
    fillText(text, x, y) { calls.push({ text: String(text), x, y, fillStyle: st.fillStyle, alpha: st.globalAlpha, clip: st.clip }); },
    fillRect() {}, strokeRect() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, closePath() {},
    getTransform: () => ({ a: 1, b: 0 }),
  };
  for (const k of ['fillStyle', 'globalAlpha', 'font', 'textAlign', 'textBaseline', 'strokeStyle', 'lineWidth', 'lineCap', 'shadowColor', 'shadowBlur', 'shadowOffsetY']) {
    Object.defineProperty(ctx, k, { get: () => st[k], set: (v) => { if (k === 'fillStyle' && typeof v !== 'string') return; st[k] = v; } });
  }
  return { ctx, calls };
}
// Every glyph a helper draws where it can be seen (alpha over 0.05, inside its clip) lies in one of the boxes the same
// call reports, not deco: the middle of each non-space character's cell, at the height of the text.
function glyphsBoxed(draw, size, label) {
  const { ctx, calls } = recorder(), boxes = draw(ctx).filter((b) => !b.deco), missed = [];
  for (const c of calls) {
    if (c.alpha <= 0.05) continue;
    [...c.text].forEach((ch, i) => {
      if (!ch.trim()) return;
      const px = c.x + (i + 0.5) * ADV, py = c.y - size * 0.3;
      if (c.clip && !(px > c.clip.x && px < c.clip.x + c.clip.w && py > c.clip.y && py < c.clip.y + c.clip.h)) return;
      if (!boxes.some((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)) missed.push(`${label}: "${ch}" of "${c.text}" at ${px.toFixed(1)},${py.toFixed(1)}`);
    });
  }
  return missed;
}
const ids = (bs) => bs.map((b) => b.id);
const NOJIT = { jitter: 0, spacePause: 0 };

// ---------------------------------------------------------------- highlighting
const GOLDEN = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'code', 'golden.json'), 'utf8'));
for (const g of GOLDEN) {
  test(`golden tokens: ${g.lang} (${g.file})`, () => {
    const src = fs.readFileSync(path.join(fixturesDir, 'code', g.file), 'utf8');
    assert.deepEqual(K.highlight(src, g.lang).map((l) => l.map((t) => [t.k, t.s])), g.lines);
  });
}
test('golden tokens cover the five languages, and every kind used is a theme kind', () => {
  assert.deepEqual(GOLDEN.map((g) => g.lang), ['js', 'ts', 'python', 'shell', 'json', 'diff']);
  const used = new Set(GOLDEN.flatMap((g) => g.lines.flat().map(([k]) => k)));
  for (const k of used) assert.ok(K.KINDS.includes(k), k);
  for (const k of ['kw', 'lit', 'str', 'num', 'com', 'fn', 'type', 'prop', 'punct', 'op', 'meta', 'var', 'flag', 'cmd', 'prompt', 'add', 'del', 'hunk', 'ctx']) assert.ok(used.has(k), `the goldens never show ${k}`);
});
test('tokenize: the tokens join back into the source, never span a line, and neighbours of one kind merge', () => {
  const srcs = [...GOLDEN.map((g) => [fs.readFileSync(path.join(fixturesDir, 'code', g.file), 'utf8'), g.lang]),
    ['const s = "unterminated\nnext', 'js'], ['/* open\ncomment', 'ts'], ["x = '''a\nb'''", 'python'], ['echo "a\nb"', 'shell'], ['', 'json'], ['plain text\n', null]];
  for (const [src, lang] of srcs) {
    const toks = K.tokenize(src, lang);
    assert.equal(toks.map((t) => t.s).join(''), src, `${lang}: ${JSON.stringify(src.slice(0, 30))}`);
    for (const t of toks) assert.ok(t.k === 'nl' ? t.s === '\n' : !t.s.includes('\n'), JSON.stringify(t));
    toks.forEach((t, i) => { if (i && t.k !== 'nl') assert.notEqual(t.k, toks[i - 1].k, `${lang}: unmerged ${JSON.stringify([toks[i - 1], t])}`); });
  }
  assert.deepEqual(K.tokenize('/* open\ncomment', 'ts').map((t) => t.k), ['com', 'nl', 'com'], 'a block comment over two lines is a comment on both');
  assert.deepEqual(K.tokenize("x = '''a\nb'''", 'python').map((t) => t.k), ['plain', 'op', 'plain', 'str', 'nl', 'str'], 'a triple-quoted string over two lines');
  assert.deepEqual(K.tokenize('`a\n${b}`', 'js').map((t) => t.k), ['str', 'nl', 'str'], 'a template literal over two lines');
  // a template literal inside ${} whose text holds a brace: the brace is text, not the end of the ${}
  assert.deepEqual(K.tokenize('t = `a ${`}`} b`;', 'js').map((t) => [t.k, t.s]), [['plain', 't '], ['op', '='], ['plain', ' '], ['str', '`a ${`}`} b`'], ['punct', ';']]);
  assert.deepEqual(K.tokenize('t = `a ${"}"} b`;', 'js').map((t) => t.k), ['plain', 'op', 'plain', 'str', 'punct'], 'a string with a brace in ${}');
});
test('diff: a hunk ends when its @@ counts are used up, so a second file\'s headers are headers without git\'s diff line', () => {
  const two = '--- a/one.ts\n+++ b/one.ts\n@@ -1,3 +1,2 @@\n keep\n\n-old\n--- a/two.ts\n+++ b/two.ts\n@@ -5 +5 @@\n-x\n+y\n';
  // one.ts: keep and the blank (context) and old (removed) use up 3 old lines; keep and the blank 2 new ones
  assert.deepEqual(K.highlight(two, 'diff').map((l) => l.map((t) => t.k).join(',')),
    ['meta', 'meta', 'hunk', 'ctx', '', 'del', 'meta', 'meta', 'hunk', 'del', 'add', '']);
  const d = K.diffBlock({ src: two, x: 0, y: 0, w: 800, h: 600 });
  assert.deepEqual(d.rows.map((r) => [r.kind, r.text]), [['hunk', '@@ -1,3 +1,2 @@'], ['ctx', 'keep'], ['ctx', ''], ['del', 'old'], ['hunk', '@@ -5 +5 @@'], ['del', 'x'], ['add', 'y']]);
  assert.equal(d.changes, 3, 'the second file\'s --- and +++ are not changes');
  // inside a hunk that still has lines to come, --- and +++ are a removed and an added line
  assert.deepEqual(K.highlight('@@ -1,2 +1,2 @@\n--- x\n+++ y\n keep', 'diff').map((l) => l[0].k), ['hunk', 'del', 'add', 'ctx']);
  // a header without counts counts one line a side: --- x is its removed line and +++ y its added one
  assert.deepEqual(K.highlight('@@ -5 +5 @@\n--- x\n+++ y', 'diff').map((l) => l[0].k), ['hunk', 'del', 'add']);
  // added lines count only on the new side: after +a, +b and c, one old line is still to come, so --- d is it
  assert.deepEqual(K.highlight('@@ -1,2 +1,3 @@\n+a\n+b\n c\n--- d', 'diff').map((l) => l[0].k), ['hunk', 'add', 'add', 'ctx', 'del']);
});
test('diff: with a language, each side of a hunk is coloured as one source, so a comment over lines keeps its state', () => {
  const src = '@@ -1,5 +1,5 @@\n /* start\n  middle\n end */\n-const a = 1; /* old\n+const a = 2;\n const b = 3;\n';
  const d = K.diffBlock({ src, lang: 'js', x: 0, y: 0, w: 800, h: 600 });
  const kinds = (i) => d.rows[i].toks.map((t) => t.k);
  assert.deepEqual(kinds(2), ['com'], 'the middle line of the comment');
  assert.deepEqual(kinds(3), ['com'], 'its last line');
  assert.equal(kinds(4)[0], 'kw', 'the removed line');
  assert.deepEqual(kinds(5)[0], 'kw', 'the added line is not inside the removed line\'s comment');
  assert.deepEqual(kinds(6)[0], 'kw', 'nor is the context after it (context is coloured as the new file)');
  for (const r of d.rows.slice(1)) assert.equal(r.toks.map((t) => t.s).join(''), r.text);
});
test('rules the goldens do not reach: a lower-case Python class, shell\'s in after for and case, a prompt only at a line\'s start', () => {
  assert.deepEqual(K.tokenize('class clock_face:', 'python').map((t) => [t.k, t.s]), [['kw', 'class'], ['plain', ' '], ['type', 'clock_face'], ['punct', ':']]);
  assert.deepEqual(K.tokenize('case x in', 'shell').map((t) => t.k), ['kw', 'plain', 'kw']);
  assert.deepEqual(K.tokenize('grep in f', 'shell').map((t) => t.k), ['cmd', 'plain'], 'in as an argument is a word');
  assert.deepEqual(K.tokenize('echo $ x', 'shell').map((t) => t.k), ['cmd', 'plain'], 'a $ mid-line is not a prompt');
  assert.deepEqual(K.tokenize('case $x in\n  a|b) run;;\n  c) go ;;\nesac', 'shell').filter((t) => t.k === 'cmd').map((t) => t.s), ['run', 'go'], 'patterns are not commands');
  assert.deepEqual(K.tokenize('for x in a in b', 'shell').filter((t) => t.k === 'kw').map((t) => t.s), ['for', 'in'], 'only the first in');
});
test('languages: aliases, and an unknown language says which ones there are', () => {
  for (const [a, l] of [['javascript', 'js'], ['tsx', 'ts'], ['py', 'python'], ['bash', 'shell'], ['zsh', 'shell'], ['patch', 'diff']]) assert.equal(K.langOf(a), l);
  assert.throws(() => K.tokenize('x', 'cobol'), /no highlighter for "cobol" \(languages: js, ts, python, shell, json, diff/);
  assert.equal(K.normCode('\tab\r\n\t\tc', 4), '    ab\n        c');
});

// ---------------------------------------------------------------- the theme
test('codeTheme: kinds take the style\'s tokens (keywords the accent, strings accent2, comments muted, text the ink)', () => {
  const st = LK.resolveStyle({ look: 'neon' }), th = K.codeTheme(st), T = st.tokens;
  assert.equal(th.colors.kw, T.accent); assert.equal(th.colors.cmd, T.accent);
  assert.equal(th.colors.str, T.accent2); assert.equal(th.colors.var, T.accent2); assert.equal(th.colors.prompt, T.accent2);
  assert.equal(th.colors.com, T.muted); assert.equal(th.colors.plain, T.ink);
  assert.equal(th.surface, K.mix(T.bgA, T.ink, 0.06)); assert.equal(th.family, 'MONO'); assert.equal(th.ui, 'BODY');
  assert.equal(K.codeTheme(st, { kw: '#123456' }).colors.kw, K.readable('#123456', th.surface, T.ink), 'an override goes through the contrast floor too');
  const kit = LK.resolveStyle({ brand: { name: 'K', colors: { bgA: '#0A1A2A', accent: '#E0B000' }, fonts: { mono: { family: 'Kit Mono', file: 'fonts/k.woff2' } } } });
  assert.equal(K.codeTheme(kit).colors.kw, '#E0B000'); assert.equal(K.codeTheme(kit).family, 'Kit Mono');
  assert.deepEqual(K.codeTheme(null).colors.kw, LK.TEMPLATE.tokens.accent, 'no style: the template\'s');
});
test('codeTheme: added lines take whichever accent is nearer green, removed lines the other, for every look', () => {
  // hues from green: product blue 102 / green 45; neon magenta 169 / cyan 68; paper rust 105 / sage 15; editorial red 118 /
  // black (no hue); retro-crt green 20 / amber 79; brutalist red 117 / blue 109; gradient violet 138 / peach 86; mono greys tie
  const want = { product: ['accent2', 'accent'], neon: ['accent2', 'accent'], paper: ['accent2', 'accent'], editorial: ['accent', 'accent2'],
    'retro-crt': ['accent', 'accent2'], brutalist: ['accent2', 'accent'], gradient: ['accent2', 'accent'], mono: ['accent2', 'accent'] };
  for (const n of LK.LOOK_NAMES) {
    const st = LK.resolveStyle({ look: n }), th = K.codeTheme(st), [a, d] = want[n];
    assert.equal(th.colors.add, K.readable(st.tokens[a], th.surface, st.tokens.ink), `${n}: add`);
    assert.equal(th.colors.del, K.readable(st.tokens[d], th.surface, st.tokens.ink), `${n}: del`);
  }
});
test('codeTheme: every kind reads at 3:1 or more on the panel, in every look and the template', () => {
  for (const st of [null, ...LK.LOOK_NAMES.map((n) => LK.resolveStyle({ look: n }))]) {
    const th = K.codeTheme(st);
    for (const k of K.KINDS) assert.ok(K.contrast(th.colors[k], th.surface) >= 3 - 1e-9, `${st ? st.look : 'template'} ${k}: ${K.contrast(th.colors[k], th.surface).toFixed(2)}`);
  }
  assert.equal(K.CODE_CONTRAST, 3);
  // a colour too close to the panel moves toward the ink until it reads
  const r = K.readable('#202020', '#1A1A1A', '#FFFFFF');
  assert.ok(K.contrast(r, '#1A1A1A') >= 3 && K.contrast(K.mix('#202020', '#FFFFFF', 0.1), '#1A1A1A') < 3 || r === K.mix('#202020', '#FFFFFF', 0.1));
  near(K.contrast('#000000', '#FFFFFF'), 21, 1e-6);
});

// ---------------------------------------------------------------- typed code at stated times
// abcd / efgh / ijkl / mnop / qrst typed from 1.0 s at 10 characters a second, 0.5 s more after each newline:
// a 1.0 b 1.1 c 1.2 d 1.3 \n 1.4 | e 2.0 ... \n 2.4 | i 3.0 ... \n 3.4 | m 4.0 ... \n 4.4 | q 5.0 r 5.1 s 5.2 t 5.3.
// Three rows fit (171 - 2 x 18 = 135 = 3 x 45); the view keeps one row under the cursor: it moves to top row 1 when the
// cursor reaches line 3 (at 2.4 s, over 0.4 s), to 2 at 3.4 s, and stays (5 lines, 3 rows: 2 is the last top row).
const typed = (o = {}) => K.codeBlock({ src: 'abcd\nefgh\nijkl\nmnop\nqrst', x: 100, y: 200, w: 600, h: 171, size: 30, lineH: 1.5, pad: 18,
  numbers: false, start: 1, type: { cps: 10, linePause: 0.5, ...NOJIT }, scrollDur: 0.4, ...o });
test('drawCode: the visible prefix, the cursor and the scroll offset at stated times, read from the layout call', () => {
  const b = typed(), at = (t) => K.drawCode(fake(), b, t, { draw: false }).state;
  const rows = [
    [0.5, 0, [''], 0, 0, 0], [1, 1, ['a'], 0, 1, 0], [1.25, 3, ['abc'], 0, 3, 0], [1.45, 5, ['abcd', ''], 1, 0, 0], [2.15, 7, ['abcd', 'ef'], 1, 2, 0],
    [2.95, 10, ['abcd', 'efgh', ''], 2, 0, 1], [3.85, 15, ['abcd', 'efgh', 'ijkl', ''], 3, 0, 2],
    [5.25, 23, ['abcd', 'efgh', 'ijkl', 'mnop', 'qrs'], 4, 3, 2], [9, 24, ['abcd', 'efgh', 'ijkl', 'mnop', 'qrst'], 4, 4, 2],
  ];
  for (const [t, n, lines, line, col, scroll] of rows) {
    const s = at(t);
    assert.deepEqual([s.typed, s.lines, s.line, s.col, s.scroll], [n, lines, line, col, scroll], `t=${t}`);
  }
  assert.equal(at(9).done, true); assert.equal(at(5.25).done, false); assert.equal(at(1).rows, 3);
  near(at(2.6).scroll, swift(0.5), 1e-12);   // half way through the first move, eased
  assert.deepEqual(K.codeAt(b, 3.85), at(3.85), 'codeAt is the layout call\'s state');
  // the cursor: solid for 0.5 s after the last key (t at 5.3, so until 5.8), then on for the first half of each 1 s blink
  // from there: on 5.8-6.3, off 6.3-6.8, on 6.8-7.3
  assert.deepEqual([5.25, 5.75, 6.25, 6.35, 6.75, 7.25].map((t) => at(t).cursor), [true, true, true, false, false, true]);
  assert.equal(K.CURSOR_SOLID, 0.5);
  // a block typed from the start blinks from t = 0, on first
  const still = K.codeBlock({ src: 'x', x: 0, y: 0, w: 100, h: 100, type: false, blink: 1 });
  assert.deepEqual([0.1, 0.6, 1.1, 1.6].map((t) => K.codeAt(still, t).cursor), [true, false, true, false]);
  assert.equal(K.codeAt(K.codeBlock({ src: 'x', x: 0, y: 0, w: 100, h: 100, cursor: false }), 2).cursor, false);
});
test('drawCode: boxes at 5.25 s: line 2 cut where the viewport starts, line 1 scrolled out and left out, one group, the cursor deco', () => {
  const bs = K.drawCode(fake(), typed(), 5.25, { draw: false });
  assert.deepEqual(ids(bs), ['code:2', 'code:3', 'code:4', 'code:5', 'code:cursor']);
  // line 2 sits one row above the top: its box (centred in its 45 px slot, 30 px tall) runs 180.5-210.5, cut to 200
  assert.deepEqual([bs[0].y, bs[0].h, bs[0].text], [200, 10.5, 'efgh']);
  assert.deepEqual([bs[1].x, bs[1].y, bs[1].w, bs[1].h], [118, 225.5, 80, 30]);
  assert.deepEqual([bs[3].text, bs[3].w], ['qrs', 60]);
  for (const x of bs.slice(0, 4)) { assert.equal(x.group, 'code'); assert.ok(!x.deco); }
  assert.deepEqual(bs[4], { id: 'code:cursor', text: '', x: 178, y: 315.5, w: 20, h: 30, deco: true });
  for (const x of bs) assert.ok(C.insideRect(x, { x: 100, y: 200, w: 600, h: 171 }), `${x.id} inside the viewport`);
});
test('drawCode: a line wider than the viewport is cut at its edge; alpha, dx and dy; numbers widen the box to the gutter', () => {
  const b = K.codeBlock({ src: 'x'.repeat(40), x: 0, y: 0, w: 300, h: 100, size: 20, pad: 10, numbers: false, type: false, id: 'wide' });
  const [bx] = K.drawCode(fake(), b, 0, { draw: false });
  // the box is cut at the viewport's right edge (300), and its text is the 15 characters that show there (the 15th in part)
  assert.deepEqual([bx.x, bx.w, bx.text], [10, 290, 'x'.repeat(15)]);
  assert.equal(K.drawCode(fake(), b, 0, { draw: false, alpha: 0.05 }).length, 0, 'at alpha 0.05 the text is not reported');
  assert.equal(K.drawCode(fake(), b, 0, { draw: false, alpha: 0.06 }).filter((x) => !x.deco).length, 1);
  const moved = K.drawCode(fake(), b, 0, { draw: false, dx: 50, dy: 7 })[0];
  assert.deepEqual([moved.x, moved.y - bx.y, moved.w], [60, 7, 290]);
  const g = K.codeBlock({ src: 'ab\ncd', x: 0, y: 0, w: 300, h: 200, size: 20, pad: 10, type: false });
  const [g1] = K.drawCode(fake(), g, 0, { draw: false });
  assert.deepEqual([g1.x, g1.w], [10, 2.5 * ADV + 2 * ADV], 'the box starts at the line number (1 digit and 1.5 columns of gutter)');
});
test('drawCode: type: false shows everything at once; shown lines are there before typing starts; indentation arrives with its newline', () => {
  const all = K.codeAt(K.codeBlock({ src: 'a\nb', x: 0, y: 0, w: 100, h: 100, type: false }), -5);
  assert.deepEqual([all.typed, all.lines], [3, ['a', 'b']]);
  const ed = K.codeBlock({ src: 'one\ntwo\nthree', x: 0, y: 0, w: 100, h: 400, shown: 2, start: 1, type: { cps: 10, ...NOJIT } });
  assert.deepEqual(K.codeAt(ed, 0).lines, ['one', 'two', ''], 'two lines shown before typing, the cursor on the third');
  assert.deepEqual(K.codeAt(ed, 1.15).lines, ['one', 'two', 'th']);
  const ind = K.codeBlock({ src: 'f {\n    x\n}', x: 0, y: 0, w: 100, h: 400, start: 0, type: { cps: 10, linePause: 0, ...NOJIT } });
  // f 0 ' ' 0.1 { 0.2 \n 0.3, then the four spaces at 0.3 with it, x 0.4, \n 0.5, } 0.6
  assert.deepEqual(K.codeAt(ind, 0.35).lines, ['f {', '    ']);
  assert.deepEqual(K.codeAt(ind, 0.45).lines, ['f {', '    x']);
  assert.deepEqual(K.typedTimes(ind).map((k) => k.key).join(','), 'char,space,char,enter,char,enter,char');
});
test('code shown whole (type: false) and taller than its view stays at the top: a finite scroll, its first rows drawn and boxed', () => {
  const b = K.codeBlock({ src: 'one\ntwo\nthree\nfour', x: 0, y: 0, w: 400, h: 2 * 45 + 36, size: 30, lineH: 1.5, pad: 18, type: false, numbers: false });
  assert.equal(b.rows, 2);
  for (const t of [0, 1, 5]) {
    assert.equal(K.codeAt(b, t).scroll, 0, `t=${t}`);
    const { ctx, calls } = recorder(), bs = K.drawCode(ctx, b, t);
    assert.deepEqual(bs.filter((x) => !x.deco).map((x) => x.text), ['one', 'two', 'three'], 'two rows and the top of the third');
    for (const x of bs) for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(x[k]), `${x.id}.${k}`);
    assert.deepEqual(calls.filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y)).map((c) => c.text).slice(0, 2), ['one', 'two']);
  }
  // explicit moves still scroll it
  const sc = K.codeBlock({ src: 'one\ntwo\nthree\nfour', x: 0, y: 0, w: 400, h: 126, size: 30, lineH: 1.5, pad: 18, type: false, scroll: [{ at: 1, top: 3, dur: 0.5 }] });
  assert.equal(K.codeAt(sc, 2).scroll, 2);
});
test('shown lines: the first typed line\'s indentation arrives when typing starts, not key by key', () => {
  const b = K.codeBlock({ src: 'f {\n    x\n}', x: 0, y: 0, w: 400, h: 400, shown: 1, start: 1, type: { cps: 10, linePause: 0, ...NOJIT } });
  assert.deepEqual(K.typedTimes(b).map((k) => [+k.t.toFixed(6), k.key]), [[1, 'char'], [1.1, 'enter'], [1.2, 'char']]);
  assert.deepEqual(K.codeAt(b, 0.5).lines, ['f {', '']);
  assert.deepEqual(K.codeAt(b, 1).lines, ['f {', '    x']);
});
test('typing: the cadence is seeded (the same seed gives the same times, another seed others), jittered within its bounds', () => {
  const src = 'const lap = (clock) => clock.read() - clock.start;\n'.repeat(3);
  const mk = (seed) => K.codeBlock({ src, x: 0, y: 0, w: 900, h: 400, start: 2, type: { cps: 20, jitter: 0.35, seed } });
  const a = mk(7).T, b = mk(7).T, c = mk(8).T;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a[0], 2, 'the first character appears at start');
  for (let i = 1; i < a.length; i++) assert.ok(a[i] >= a[i - 1], 'never backwards');
  const gaps = a.slice(1).map((x, i) => x - a[i]).filter((g, i) => src[i] !== '\n' && src[i] !== ' ' && g > 0);
  for (const g of gaps) assert.ok(g >= 0.65 / 20 - 1e-9 && g <= 1.35 / 20 + 1e-9, `gap ${g}`);
  // a space adds spacePause (0.02 s by default) and a newline linePause (0.16 s) on top of the key's own gap
  const after = (ch) => a.slice(1).map((x, i) => [src[i], x - a[i]]).filter(([c]) => c === ch).map(([, g]) => g);
  for (const g of after(' ')) assert.ok(g >= 0.65 / 20 + 0.02 - 1e-9 && g <= 1.35 / 20 + 0.02 + 1e-9, `after a space: ${g}`);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 0.4 / 20, 'the jitter varies the gaps');
});
test('drawCode: every drawn line number has a box, a blank line\'s and the cursor\'s untyped line\'s included', () => {
  const b = K.codeBlock({ src: 'a\n\nb\nc', x: 0, y: 0, w: 400, h: 400, size: 30, pad: 10, start: 0, type: { cps: 10, linePause: 0, ...NOJIT } });
  // a 0, \n 0.1, \n 0.2, b 0.3: at 0.25 the cursor is on line 3, nothing typed on it yet
  const { ctx, calls } = recorder(), bs = K.drawCode(ctx, b, 0.25);
  const nums = calls.filter((c) => /^\s*\d+$/.test(c.text)).map((c) => c.text.trim());
  assert.deepEqual(nums, ['1', '2', '3']);
  assert.deepEqual(bs.filter((x) => !x.deco).map((x) => [x.id, x.text]), [['code:1', 'a'], ['code:2', '2'], ['code:3', '3']]);
  const two = bs.find((x) => x.id === 'code:2');
  assert.deepEqual([two.x, two.w], [10, ADV], 'the number\'s box is the number');
  assert.deepEqual(glyphsBoxed((c) => K.drawCode(c, b, 0.25), 30, 'code'), []);
  // with ten lines or more the numbers are right-aligned: line 2's box starts one column in, at its digit
  const ten = K.codeBlock({ src: 'a\n\n' + 'x\n'.repeat(9) + 'y', x: 0, y: 0, w: 400, h: 900, size: 30, pad: 10, type: false });
  const n2 = K.drawCode(fake(), ten, 0, { draw: false }).find((x) => x.id === 'code:2');
  assert.deepEqual([n2.x, n2.w, n2.text], [10 + ADV, ADV, '2']);
});
test('every glyph the helpers draw where it shows is inside one of their boxes (typing, scrolling, a blank line, a diff opening, a bar)', () => {
  const src = 'const a = 1;\n\n  return a + 2; // a line wider than the view\nb\nc\nd';
  const code = K.codeBlock({ src, lang: 'js', x: 30, y: 40, w: 420, h: 171, size: 30, lineH: 1.5, pad: 18, start: 0.2, type: { cps: 30, ...NOJIT }, focus: [{ lines: [1, 1], from: 2, to: 3 }] });
  const s = session(), d = diff();
  const missed = [];
  for (let t = 0; t <= 4; t += 0.05) {
    missed.push(...glyphsBoxed((c) => K.drawCode(c, code, t), 30, `code t=${t.toFixed(2)}`));
    missed.push(...glyphsBoxed((c) => K.drawCode(c, code, t, { dx: -40, dy: 10 }), 30, `code moved t=${t.toFixed(2)}`));
    missed.push(...glyphsBoxed((c) => K.terminal(c, s, t), 30, `term t=${t.toFixed(2)}`));
    missed.push(...glyphsBoxed((c) => K.drawDiff(c, d, t), 30, `diff t=${t.toFixed(2)}`));
  }
  assert.deepEqual(missed.slice(0, 5), []);
});
test('a box\'s text is what shows: code, diff and terminal rows cut at the viewport keep only the characters there', () => {
  const code = K.codeBlock({ src: 'abcdefghij', x: 0, y: 0, w: 110, h: 100, size: 20, pad: 10, numbers: false, type: false });
  assert.equal(K.drawCode(fake(), code, 0, { draw: false })[0].text, 'abcde', 'columns 0-4 (10 to 110)');
  assert.equal(K.drawCode(fake(), code, 0, { draw: false, dx: -45 })[0].text, 'abcde', 'dx moves the viewport with the text');
  const tight = K.codeBlock({ src: 'abcdefghij', x: 0, y: 0, w: 115, h: 100, size: 20, pad: 10, numbers: false, type: false });
  assert.equal(K.drawCode(fake(), tight, 0, { draw: false })[0].text, 'abcdef', 'f shows in part (110 to 130, cut at 115): it counts');
  const d = K.diffBlock({ src: '@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n', x: 0, y: 0, w: 130, h: 400, size: 20, pad: 10, start: 0 });
  // six columns show (10 to 130): the marker column counts
  assert.deepEqual(K.drawDiff(fake(), d, 5, { draw: false }).map((b) => b.text), ['@@ -1', '- cons', '+ cons']);
  const s = K.termSession({ x: 0, y: 0, w: 130, h: 400, size: 20, pad: 10, prompt: '$ ', end: false, type: { cps: 100, ...NOJIT },
    steps: [{ cmd: 'darnly fix all', pause: 0 }, { bar: 'fetching', dur: 1, width: 4 }] });
  const bs = K.terminal(fake(), s, 5, { draw: false });
  assert.deepEqual(bs.filter((b) => !b.deco).map((b) => b.text), ['$ darn', 'fetchi'], 'six columns; the bar row\'s percentage is past the edge');
  const wide = K.termSession({ x: 0, y: 0, w: 400, h: 400, size: 20, pad: 10, end: false, steps: [{ bar: 'get', dur: 1, width: 4 }] });
  assert.equal(K.terminal(fake(), wide, 5, { draw: false })[0].text, 'get 100%');
});
test('drawCode: highlight bands and focus dimming fade in and out; a dimmed line still reports its box while it shows', () => {
  const b = K.codeBlock({ src: 'a\nb\nc', x: 0, y: 0, w: 200, h: 400, type: false, focus: [{ lines: [2, 2], from: 1, to: 3, dim: 0.02 }] });
  assert.deepEqual(ids(K.drawCode(fake(), b, 0, { draw: false })).filter((x) => x !== 'code:cursor'), ['code:1', 'code:2', 'code:3']);
  // at 2 s lines 1 and 3 are at alpha 0.02: under 0.05, so they are not reported
  assert.deepEqual(ids(K.drawCode(fake(), b, 2, { draw: false })).filter((x) => x !== 'code:cursor'), ['code:2']);
  assert.deepEqual(ids(K.drawCode(fake(), b, 3.5, { draw: false })).filter((x) => x !== 'code:cursor'), ['code:1', 'code:2', 'code:3']);
});
test('drawCode: explicit scroll moves put a line at the top at their times', () => {
  const src = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
  const b = K.codeBlock({ src, x: 0, y: 0, w: 400, h: 171, size: 30, lineH: 1.5, pad: 18, type: false, scroll: [{ at: 1, top: 5, dur: 0.5 }, { at: 3, top: 2, dur: 0.5 }] });
  assert.deepEqual([0.5, 1.6, 3.6].map((t) => K.codeAt(b, t).scroll), [0, 4, 1]);
  assert.deepEqual(ids(K.drawCode(fake(), b, 2, { draw: false })).filter((x) => x !== 'code:cursor'), ['code:4', 'code:5', 'code:6', 'code:7', 'code:8']);
});
test('boxes while a view scrolls: every box reported is inside its viewport and not empty; a line whose slot shows but whose text does not is left out', () => {
  const view = (b) => ({ x: b.x, y: b.y, w: b.w, h: b.h });
  const src = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n');
  const code = K.codeBlock({ src, x: 0, y: 0, w: 400, h: 171, size: 30, lineH: 1.5, pad: 18, type: false, scroll: [{ at: 1, top: 5, dur: 0.5 }] });
  const s = session(), d = diff();
  let edge = 0;
  for (let t = 0; t <= 4; t += 0.005) {
    for (const [b, bs] of [[code, K.drawCode(fake(), code, t, { draw: false })], [s, K.terminal(fake(), s, t, { draw: false })], [d, K.drawDiff(fake(), d, t, { draw: false })]]) {
      for (const x of bs) assert.ok(x.w > 0 && x.h > 0 && C.insideRect(x, view(b)), `${x.id} at ${t.toFixed(3)}: ${JSON.stringify(x)}`);
    }
    // a code line whose slot reaches into the viewport while its box (centred in the slot) does not: 1.2 to 1.4 rows above
    const sc = K.codeAt(code, t).scroll;
    for (let L = 0; L < 12; L++) if (L - sc > -1.4 && L - sc <= -1.24) { edge++; assert.ok(!ids(K.drawCode(fake(), code, t, { draw: false })).includes(`code:${L + 1}`), `line ${L + 1} at ${t}`); }
  }
  assert.ok(edge > 0, 'the scroll passed the edge case');
});

// ---------------------------------------------------------------- the terminal at stated times
// Prompt '$ ' from the start; 'ab' typed from 0.5 s at 10 a second (a 0.5, b 0.6), Enter at 0.9; 'one' 0.9, 'two' 1.0;
// (the spinner turns a frame each quarter second: | from 1.1, / from 1.35, - from 1.6, \ from 1.85)
// a spinner 1.1-2.1 at 4 frames a second, then 'ok'; a bar 2.1-3.1; the next prompt at 3.1, 'c' at 3.4, Enter 3.65;
// the closing prompt at 3.65. Three rows fit: the view scrolls a row (0.12 s) as each row from the fourth appears.
const session = () => K.termSession({ x: 0, y: 0, w: 800, h: 171, size: 30, lineH: 1.5, pad: 18, prompt: '$ ', type: { cps: 10, ...NOJIT },
  steps: [{ cmd: 'ab', pause: 0.5, enter: 0.2 }, { out: ['one', 'two'], every: 0.1 }, { spin: 'load', dur: 1, fps: 4, done: 'ok' }, { bar: 'get', dur: 1, width: 4 }, { cmd: 'c', pause: 0.3 }] });
test('terminal: the rows shown, the scroll offset, typing and the cursor at stated times, read from the layout call', () => {
  const s = session(), at = (t) => K.terminal(fake(), s, t, { draw: false }).state;
  const pct = Math.round(100 * swift(0.5));
  const rows = [
    [0, ['$ '], 0, -1, true], [0.45, ['$ '], 0, -1, true], [0.55, ['$ a'], 0, 0, true], [0.95, ['$ ab', 'one'], 0, -1, false],
    [1.4, ['$ ab', 'one', 'two', '/ load'], 1, -1, false], [1.9, ['$ ab', 'one', 'two', '\\ load'], 1, -1, false],
    [2.6, ['$ ab', 'one', 'two', 'ok', `get ${pct}%`], 2, -1, false], [3.3, ['$ ab', 'one', 'two', 'ok', 'get 100%', '$ '], 3, -1, true],
    [3.8, ['$ ab', 'one', 'two', 'ok', 'get 100%', '$ c', '$ '], 4, -1, true],
  ];
  for (const [t, shown, scroll, typing, cursor] of rows) {
    const x = at(t);
    assert.deepEqual([x.rows, x.scroll, x.typing, x.cursor], [shown, scroll, typing, cursor], `t=${t}`);
  }
  near(at(2.6).fill, swift(0.5), 1e-12);
  assert.equal(at(0.7).typing, -1, 'typed, not yet entered: no longer typing');
  assert.equal(at(0.7).cursor, true, 'the cursor waits on the line until Enter');
});
test('terminal: boxes at 3.8 s: rows 1-3 scrolled out and left out, row 4 cut, the bar\'s box covers its label, bar and percent', () => {
  const bs = K.terminal(fake(), session(), 3.8, { draw: false });
  assert.deepEqual(ids(bs), ['term:4', 'term:5', 'term:6', 'term:7', 'term:cursor']);
  assert.deepEqual([bs[0].y, bs[0].h, bs[0].text], [0, 10.5, 'ok']);
  assert.deepEqual([bs[1].text, bs[1].x, bs[1].w], ['get 100%', 18, (3 + 1 + 4 + 1 + 4) * ADV]);
  for (const x of bs.slice(0, 4)) assert.equal(x.group, 'term');
  assert.equal(bs[4].deco, true);
  // the spinner's turn: one frame each quarter second
  assert.deepEqual([1.2, 1.45, 1.7, 1.95, 2.15].map((t) => K.termAt(session(), t).rows[3]), ['| load', '/ load', '- load', '\\ load', 'ok']);
});
test('terminal: a step\'s `at` holds it back; key presses are the typed characters and Enter, never the output', () => {
  const s = K.termSession({ x: 0, y: 0, w: 800, h: 400, prompt: '> ', type: { cps: 10, ...NOJIT },
    steps: [{ cmd: 'go', at: 2 }, { out: 'done', at: 5 }, { wait: 1 }, { cmd: 'x' }] });
  // go: g 2.0, o 2.1, Enter 2.35; done at 5 (its `at`), the next step 0.06 s later (out's default gap); the wait ends at
  // 6.06, where the next prompt shows; x 0.3 s later (6.36), Enter 6.61
  assert.deepEqual(K.typedTimes(s).map((k) => [+k.t.toFixed(3), k.key]), [[2, 'char'], [2.1, 'char'], [2.35, 'enter'], [6.36, 'char'], [6.61, 'enter']]);
  assert.deepEqual(K.termAt(s, 4.9).rows, ['> go']);
  assert.deepEqual(K.termAt(s, 5.05).rows, ['> go', 'done']);
  assert.deepEqual(K.termAt(s, 6.05).rows, ['> go', 'done']);
  assert.deepEqual(K.termAt(s, 6.1).rows, ['> go', 'done', '> ']);
  assert.throws(() => K.termSession({ x: 0, y: 0, w: 1, h: 1, steps: [{ nope: 1 }] }), /a step needs cmd, out, spin, bar or wait/);
});
test('terminal: a command with a newline is an error that says why; output with one makes a row per line; tabs become spaces', () => {
  const box = { x: 0, y: 0, w: 800, h: 400 };
  assert.throws(() => K.termSession({ ...box, steps: [{ cmd: 'make\nmake install' }] }), /the cmd "make\\nmake install" has a newline; a row is one line: give each command its own cmd step/);
  assert.throws(() => K.termSession({ ...box, steps: [{ spin: 'a\nb' }] }), /the spin label .* has a newline/);
  assert.throws(() => K.termSession({ ...box, prompt: '$\n' }), /the prompt .* has a newline/);
  const s = K.termSession({ ...box, prompt: '$ ', end: false, type: { cps: 10, ...NOJIT }, steps: [{ cmd: 'go\tnow', pause: 0 }, { out: ['a\tb', 'one\ntwo'], every: 0.1 }] });
  assert.deepEqual(K.termAt(s, 9).rows, ['$ go  now', 'a b', 'one', 'two']);
});
test('terminal: a kind the theme does not have is drawn in plain\'s colour, not the colour drawn before it', () => {
  const th = K.codeTheme(null);
  const s = K.termSession({ x: 0, y: 0, w: 800, h: 400, theme: th, end: false, steps: [{ out: 'bad', kind: 'del' }, { out: 'odd', kind: 'nope' }, { bar: 'get', dur: 1, kind: 'nope' }] });
  const { ctx, calls } = recorder();
  K.terminal(ctx, s, 9);
  const col = (text) => calls.find((c) => c.text === text).fillStyle;
  assert.equal(col('bad'), th.colors.del);
  assert.equal(col('odd'), th.colors.plain);
  assert.equal(col('get'), th.colors.plain);
  assert.equal(col('100%'), th.colors.plain);
});

// ---------------------------------------------------------------- the diff at stated times
// hunk, a, -b, +c, d, -e, +f: changes land from 1.0 s every 0.5 s (-b 1.0, +c 1.5, -e 2.0, +f 2.5); an added line opens
// over 0.2 s. Four rows fit: -e (row 6) scrolls the view to top row 2 at 2.0 s, +f (row 7) to 3 at 2.5 s (0.35 s each).
const diff = () => K.diffBlock({ src: '@@ -1,4 +1,4 @@\n a\n-b\n+c\n d\n-e\n+f\n', x: 0, y: 0, w: 800, h: 216, size: 30, lineH: 1.5, pad: 18, start: 1, step: 0.5, grow: 0.2 });
test('drawDiff: what has landed, the lines\' opening and marking, and the scroll at stated times', () => {
  const d = diff(), at = (t) => K.drawDiff(fake(), d, t, { draw: false }).state;
  assert.deepEqual(d.rows.map((r) => [r.kind, r.text]), [['hunk', '@@ -1,4 +1,4 @@'], ['ctx', 'a'], ['del', 'b'], ['add', 'c'], ['ctx', 'd'], ['del', 'e'], ['add', 'f']]);
  const pick = (s) => s.rows.map((r) => (r.kind === 'add' ? r.open : r.kind === 'del' ? r.mark : 1));
  assert.deepEqual([at(0.5).landed, pick(at(0.5)), at(0.5).scroll], [0, [1, 1, 0, 0, 1, 0, 0], 0]);
  assert.deepEqual([at(1.3).landed, pick(at(1.3)), at(1.3).scroll], [1, [1, 1, 1, 0, 1, 0, 0], 0]);
  assert.deepEqual([at(1.8).landed, pick(at(1.8)), at(1.8).scroll], [2, [1, 1, 1, 1, 1, 0, 0], 0]);
  assert.deepEqual([at(3).landed, pick(at(3)), at(3).scroll], [4, [1, 1, 1, 1, 1, 1, 1], 3]);
  assert.equal(at(2.4).scroll, 2);
});
test('drawDiff: boxes: closed added lines report nothing, a removed line gains its marker, an opening line is cut to its slot', () => {
  const d = diff(), bx = (t) => K.drawDiff(fake(), d, t, { draw: false });
  const b0 = bx(0.5);
  assert.deepEqual(b0.map((b) => b.text), ['@@ -1,4 +1,4 @@', 'a', 'b', 'd', 'e']);
  assert.deepEqual([b0[4].y, b0[4].h], [205.5, 10.5], 'the fifth row runs into the bottom padding and is cut at the viewport');
  assert.deepEqual(bx(1.3).map((b) => b.text), ['@@ -1,4 +1,4 @@', 'a', '- b', 'd', 'e']);
  const opening = bx(1.51).find((b) => b.text === '+ c');
  assert.ok(opening && opening.h > 0 && opening.h < 30, JSON.stringify(opening));
  for (const b of bx(1.55)) assert.equal(b.group, 'diff');
  // the line under an opening one moves down by how far it has opened, not by a whole row
  const o = K.diffAt(d, 1.55).rows[3].open, under = bx(1.55).find((b) => b.text === 'd');
  assert.ok(o > 0 && o < 1, String(o));
  near(under.y, 18 + (3 + o) * 45 + 22.5 - 15, 1e-9);
  assert.equal(bx(1.3).find((b) => b.text === '- b').x, 18, 'the marker column is the box\'s left edge');
});

// ---------------------------------------------------------------- check's detectors on the helpers' boxes
const FPS = 30;
function sampled(fn, f0 = 0, f1 = 30, n = 2) {
  const out = [];
  for (let f = f0; f < f1; f++) for (let s = 0; s < n; s++) { const t = f / FPS + ((s + 0.5) / n) * (0.5 / FPS); out.push({ t, f, n, cam: [1, 0, 0, 0], boxes: fn(t) }); }
  return C.prepareSamples(out, 1080, 1920);
}
const piece = [{ id: '(piece)', start: 0, end: 100, beat: {} }];
test('text_overlap: the lines of one block never overlap each other (one group), even set tighter than their boxes', () => {
  const tight = K.codeBlock({ src: 'aaaa\nbbbb\ncccc', x: 200, y: 400, w: 600, h: 300, size: 40, lineH: 0.8, type: false, numbers: false });
  const bs = K.drawCode(fake(), tight, 0, { draw: false }).filter((b) => !b.deco);
  assert.ok(C.overlapArea(bs[0], bs[1]) > 0, 'the fixture\'s lines do overlap');
  assert.deepEqual(C.textOverlap(sampled(() => K.drawCode(fake(), tight, 0, { draw: false })), { fps: FPS }).map((x) => x.level), ['OK']);
  const other = K.codeBlock({ src: 'zzzz', x: 200, y: 400, w: 600, h: 300, size: 40, type: false, numbers: false, id: 'other' });
  const two = C.textOverlap(sampled(() => [...K.drawCode(fake(), tight, 0, { draw: false }), ...K.drawCode(fake(), other, 0, { draw: false })]), { fps: FPS });
  assert.ok(two.length && two.every((x) => x.level === 'WARN' && /\(other:1\)/.test(x.detail)), 'two blocks over each other are a WARN');
});
test('text_overlap: chrome over code (a frame and its title, deco) is not an overlap', () => {
  const win = K.frameLayout('window', { x: 160, y: 300, w: 760, h: 500 });
  const code = K.codeBlock({ src: 'const lap = 1;', ...win.content, x: win.content.x, y: win.bar.y, h: 300, type: false, numbers: false });
  const all = () => [...K.drawFrame(fake(), 'window', win.outer, { title: 'const lap', draw: false }), ...K.drawCode(fake(), code, 0, { draw: false })];
  const bs = all(), title = bs.find((b) => b.id === 'frame:label'), line = bs.find((b) => b.id === 'code:1');
  assert.ok(title && line && C.overlapArea(title, line) > 0, 'the title sits over the code line');
  assert.deepEqual(C.textOverlap(sampled(all), { fps: FPS }).map((x) => x.level), ['OK']);
});
test('text_safe: a code block outside tiktok-ad\'s measured safe area for more than 0.25 s FAILs; the same block inside passes', () => {
  const z = JSON.parse(fs.readFileSync(path.join(templateDir, 'safezones.json'), 'utf8')).targets['tiktok-ad'];
  const block = (x) => K.codeBlock({ src: 'darnly fix\nsrc/clock.ts', x, y: 400, w: 640, h: 200, size: 30, type: false, numbers: false });
  const run = (x) => C.textSafe(sampled(() => K.drawCode(fake(), block(x), 0, { draw: false })), { fps: FPS, safe: z.safe, exclude: z.exclude, windows: piece, estimate: z.estimate });
  assert.deepEqual(run(z.safe.x).map((x) => x.level), ['OK'], 'inside');
  const out = run(z.safe.x - 60);
  assert.deepEqual(out.map((x) => x.level), ['FAIL', 'FAIL'], 'both lines, a second each');
  near(out[0].measured, 1, 1e-6);
});

// ---------------------------------------------------------------- frames
test('frames: the rectangles of a window, a browser and a phone; every box drawFrame reports is deco', () => {
  const r = { x: 100, y: 200, w: 800, h: 600 };
  assert.deepEqual(K.frameLayout('window', r).content, { x: 100, y: 256, w: 800, h: 544 });
  assert.deepEqual(K.frameLayout('browser', r).content, { x: 100, y: 272, w: 800, h: 528 });
  assert.deepEqual(K.frameLayout('window', r, { bar: 40 }).content, { x: 100, y: 240, w: 800, h: 560 });
  const p = K.frameLayout('phone', { x: 0, y: 0, w: 400, h: 820 });
  assert.deepEqual([p.screen, p.content, p.radius], [{ x: 14, y: 14, w: 372, h: 792 }, { x: 14, y: 51, w: 372, h: 755 }, 52]);
  assert.throws(() => K.frameLayout('watch', r), /no frame "watch"/);
  for (const [kind, o] of [['window', { title: 'notes.md' }], ['browser', { url: 'mossgate.test' }], ['phone', {}]]) {
    const bs = K.drawFrame(fake(), kind, r, { ...o, draw: false, dy: 10 });
    assert.equal(bs.length, 2, kind); for (const b of bs) assert.equal(b.deco, true);
    assert.equal(bs[0].y, 210); assert.deepEqual(bs.layout.outer, { ...r, y: 210 });
    assert.equal(K.drawFrame(fake(), kind, r, { ...o, draw: false, alpha: 0.05 }).length, 0, `${kind}: nothing at alpha 0.05`);
  }
  // fitSize: a face 0.6 em wide; 40 columns in 960 px fit at 40 px, 50 at 32, 500 not even at the 14 px floor
  const em = { font: '', save() {}, restore() {}, measureText(s) { return { width: [...String(s)].length * 0.6 * parseFloat(this.font) }; } };
  assert.deepEqual([K.fitSize(em, 'MONO', 40, 960), K.fitSize(em, 'MONO', 50, 960, { max: 99 }), K.fitSize(em, 'MONO', 500, 960), K.fitSize(em, 'MONO', 10, 960)], [40, 32, 14, 40]);
});

// ---------------------------------------------------------------- key ticks
const maxPerSecond = (ts) => Math.max(0, ...ts.map((t) => ts.filter((u) => u > t - 1 + 1e-6 && u <= t).length));
test('keyTicks: thinned to KEY_MAX (12) a second, in any second, keeping only real key presses', () => {
  assert.equal(K.KEY_MAX, 12);
  const fast = Array.from({ length: 200 }, (_, i) => ({ t: 0.5 + i / 40, key: 'char' }));   // 40 a second for 5 s
  const kept = K.keyTicks(fast);
  assert.ok(maxPerSecond(kept.map((k) => k.t)) <= 12, String(maxPerSecond(kept.map((k) => k.t))));
  assert.ok(kept.length >= 5 * 9, `thinned, not silenced: ${kept.length}`);
  for (const k of kept) assert.ok(fast.includes(k));
  for (let i = 1; i < kept.length; i++) assert.ok(kept[i].t - kept[i - 1].t >= 1 / 12 - 1e-9, 'spread out, not bunched');
  // exactly at the ceiling nothing is dropped; over it, something is
  const at12 = Array.from({ length: 36 }, (_, i) => ({ t: i / 12, key: 'char' }));
  assert.equal(K.keyTicks(at12).length, 36);
  assert.ok(K.keyTicks(Array.from({ length: 39 }, (_, i) => ({ t: i / 13, key: 'char' }))).length < 39);
  assert.equal(K.keyTicks(fast, { max: 4 }).filter((k) => k.t < 1.5).length, 4, 'the ceiling is an option');
  // presses a hair closer than 1/12 s pass the gap rule (it forgives 1e-9 s of rounding), so only the window rule keeps
  // a second from holding 13 of them: counted exactly here, (t - 1, t]
  const hair = Array.from({ length: 30 }, (_, i) => ({ t: i * (1 / 12 - 5e-10), key: 'char' })).map((k) => k.t);
  const keptHair = K.keyTicks(hair.map((t) => ({ t, key: 'char' }))).map((k) => k.t);
  assert.ok(Math.max(...keptHair.map((t) => keptHair.filter((u) => u > t - 1 && u <= t).length)) <= 12, 'the window rule');
  assert.ok(keptHair.length >= 27, `only the 13th of each second goes: ${keptHair.length}`);
});
test('keyTicks: silent when nothing types, merged blocks share one ceiling', () => {
  const code = K.codeBlock({ src: 'abcdefghij\nklmnopqrst', x: 0, y: 0, w: 800, h: 400, start: 1, type: { cps: 30, linePause: 2, ...NOJIT } });
  const term = K.termSession({ x: 0, y: 0, w: 800, h: 400, type: { cps: 30, ...NOJIT }, steps: [{ cmd: 'abcdefghijklmnop', at: 1 }] });
  const kept = K.keyTicks([...K.typedTimes(code), ...K.typedTimes(term)]);
  assert.ok(maxPerSecond(kept.map((k) => k.t)) <= 12);
  // the code's first line ends with its newline at 1.33 s and its second starts at 3.37 s (1/30 s and 2 s later); the
  // command's last key is at 1.5 s and its Enter at 1.68 s
  assert.deepEqual(kept.filter((k) => k.t > 1.7 && k.t < 3.36), [], 'no tick while nothing types');
  assert.ok(kept.some((k) => k.t >= 3.36), 'typing again ticks again');
  assert.deepEqual(K.keyTicks([{ t: Infinity, key: 'char' }, { t: NaN, key: 'char' }]), []);
});
