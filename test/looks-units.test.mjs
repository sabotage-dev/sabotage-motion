// Looks, brand kits and the colour match without a browser (plan 23.2): CIEDE2000 against its published reference
// pairs, the match and its rules on made-up histograms, the precedence of --param over the kit over the look over the
// template, brand.json's problems, the font shorthand parser, the eight looks and their fonts, and the fixture kit's
// distance from every look. test/looks.test.mjs renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, templateDir, fixturesDir } from './helpers.mjs';

const C = await import(pathToFileURL(path.join(templateDir, 'check.mjs')).href);
const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
const looksFonts = path.join(repoRoot, 'skills', 'sabotage-motion', 'looks', 'fonts');

// ---------------------------------------------------------------- CIEDE2000
// The 34 test pairs published with the formula's implementation notes (Color Research and Application 30(1), 2005,
// supplementary data file ciede2000testdata.txt): L1 a1 b1 L2 a2 b2 and the difference, to 4 decimals.
const PAIRS = [
  [50.0000, 2.6772, -79.7751, 50.0000, 0.0000, -82.7485, 2.0425], [50.0000, 3.1571, -77.2803, 50.0000, 0.0000, -82.7485, 2.8615],
  [50.0000, 2.8361, -74.0200, 50.0000, 0.0000, -82.7485, 3.4412], [50.0000, -1.3802, -84.2814, 50.0000, 0.0000, -82.7485, 1.0000],
  [50.0000, -1.1848, -84.8006, 50.0000, 0.0000, -82.7485, 1.0000], [50.0000, -0.9009, -85.5211, 50.0000, 0.0000, -82.7485, 1.0000],
  [50.0000, 0.0000, 0.0000, 50.0000, -1.0000, 2.0000, 2.3669], [50.0000, -1.0000, 2.0000, 50.0000, 0.0000, 0.0000, 2.3669],
  [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0009, 7.1792], [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0010, 7.1792],
  [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0011, 7.2195], [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0012, 7.2195],
  [50.0000, -0.0010, 2.4900, 50.0000, 0.0009, -2.4900, 4.8045], [50.0000, -0.0010, 2.4900, 50.0000, 0.0010, -2.4900, 4.8045],
  [50.0000, -0.0010, 2.4900, 50.0000, 0.0011, -2.4900, 4.7461], [50.0000, 2.5000, 0.0000, 50.0000, 0.0000, -2.5000, 4.3065],
  [50.0000, 2.5000, 0.0000, 73.0000, 25.0000, -18.0000, 27.1492], [50.0000, 2.5000, 0.0000, 61.0000, -5.0000, 29.0000, 22.8977],
  [50.0000, 2.5000, 0.0000, 56.0000, -27.0000, -3.0000, 31.9030], [50.0000, 2.5000, 0.0000, 58.0000, 24.0000, 15.0000, 19.4535],
  [50.0000, 2.5000, 0.0000, 50.0000, 3.1736, 0.5854, 1.0000], [50.0000, 2.5000, 0.0000, 50.0000, 3.2972, 0.0000, 1.0000],
  [50.0000, 2.5000, 0.0000, 50.0000, 1.8634, 0.5757, 1.0000], [50.0000, 2.5000, 0.0000, 50.0000, 3.2592, 0.3350, 1.0000],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644], [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.2630],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.2480, -4.9620, 1.8731], [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.6940, 23.0331, 14.9730, -42.5619, 2.0373], [36.4612, 47.8580, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.4410, 91.1528, -1.6435, 0.0447, 1.4441], [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377], [2.0776, 0.0795, -1.1350, 0.9033, -0.0636, -0.5514, 0.9082],
];
test('CIEDE2000: the 34 published reference pairs, both ways round, to 4 decimals', () => {
  assert.equal(PAIRS.length, 34);
  const bad = [];
  PAIRS.forEach((p, i) => {
    for (const d of [C.ciede2000(p.slice(0, 3), p.slice(3, 6)), C.ciede2000(p.slice(3, 6), p.slice(0, 3))]) {
      if (Math.abs(d - p[6]) > 1e-4) bad.push(`pair ${i + 1}: ${d.toFixed(5)}, published ${p[6]}`);
    }
  });
  assert.deepEqual(bad, []);
  assert.equal(C.ciede2000([50, 10, -10], [50, 10, -10]), 0);
});
test('sRGB to L*a*b* (D65): white, black, the primaries and a mid grey match the standard values', () => {
  const near = (a, b, eps = 0.01) => a.every((x, i) => Math.abs(x - b[i]) <= eps);
  assert.ok(near(C.hexToLab('#FFFFFF'), [100, 0, 0]), String(C.hexToLab('#FFFFFF')));
  assert.ok(near(C.hexToLab('#000000'), [0, 0, 0]));
  assert.ok(near(C.hexToLab('#FF0000'), [53.2408, 80.0925, 67.2032]), String(C.hexToLab('#FF0000')));
  assert.ok(near(C.hexToLab('#00FF00'), [87.7347, -86.1827, 83.1793]), String(C.hexToLab('#00FF00')));
  assert.ok(near(C.hexToLab('#0000FF'), [32.2970, 79.1875, -107.8602]), String(C.hexToLab('#0000FF')));
  assert.ok(near(C.hexToLab('#808080'), [53.5850, 0, 0]), String(C.hexToLab('#808080')));
});

// ---------------------------------------------------------------- the match
const rgbInt = (hex) => parseInt(hex.slice(1), 16);
const hist = (pairs) => ({ colors: pairs.map(([h]) => rgbInt(h)), counts: pairs.map(([, n]) => n) });
const KIT = { bgA: '#7A1030', bgB: '#680E34', ink: '#FBEFE4', muted: '#D9A9B5', accent: '#10A8F8', accent2: '#F87088' };
const pals = () => [{ id: 'kit', tokens: KIT }, { id: 'template', tokens: LK.TEMPLATE.tokens }, ...LK.LOOK_NAMES.map((n) => ({ id: `look ${n}`, tokens: LK.LOOKS[n].tokens }))];
// the nearest token of any palette, and how far (for building colours at a known distance)
const nearest = (hex, { withKit = true } = {}) => {
  const lab = C.hexToLab(hex);
  let best = { d: Infinity };
  for (const p of pals().slice(withKit ? 0 : 1)) for (const [k, h] of Object.entries(p.tokens)) { const d = C.ciede2000(lab, C.hexToLab(h)); if (d < best.d) best = { d, id: p.id, k }; }
  return best;
};

test('the match: each colour goes to its nearest token, counts add up, and the kit\'s own colours go to the kit', () => {
  const m = C.paletteMatch(hist([['#7A1030', 300], ['#680E34', 200], ['#10A8F8', 40], ['#FF2BD6', 7], ['#FFD400', 3]]), pals());
  assert.equal(m.total, 550);
  assert.equal(m.palettes[0].tokens.bgA, 300); assert.equal(m.palettes[0].tokens.bgB, 200); assert.equal(m.palettes[0].tokens.accent, 40);
  assert.equal(m.palettes.find((p) => p.id === 'look neon').tokens.accent, 7);
  assert.equal(m.palettes.find((p) => p.id === 'look brutalist').tokens.bgA, 3);
  assert.equal(m.none, 0);
  assert.equal(m.palettes.reduce((s, p) => s + p.total, 0) + m.none, m.total);
});
test('the match: a colour more than 10 from every token is no one\'s; one at 10 or less is someone\'s', () => {
  // made-up colours on either side of the limit, found by walking from a token (the test proves their distances)
  const far = '#4A7A2C', farD = nearest(far).d;
  assert.ok(farD > 10.5, `${far} is ${farD} from its nearest token`);
  const m = C.paletteMatch(hist([[far, 5]]), pals());
  assert.equal(m.none, 5);
  // a colour between 10 and 11 from its nearest token: none at the limit of 10, someone's at 11
  let mid = null;
  for (let g = 0x10; g < 0xA8 && !mid; g++) { const h = `#10${g.toString(16).padStart(2, '0').toUpperCase()}F8`; const d = nearest(h).d; if (d > 10.05 && d < 10.95) mid = h; }
  assert.ok(mid, 'a colour between 10 and 11 from its nearest token exists on that walk');
  assert.equal(C.T.palette.limit, 10);
  assert.equal(C.paletteMatch(hist([[mid, 9]]), pals()).none, 9, `${mid} (${nearest(mid).d.toFixed(2)}) is over 10 from every token`);
  assert.equal(C.paletteMatch(hist([[mid, 9]]), pals(), 11).none, 0);
  assert.equal(C.paletteMatch(hist([[mid, 9]]), pals(), nearest(mid).d).none, 0, 'a colour exactly at the limit is someone\'s');
});
test('the match: a tie goes to the earlier palette (the kit before the looks), so it never changes from run to run', () => {
  const m = C.paletteMatch(hist([['#123456', 4]]), [{ id: 'kit', tokens: { bgA: '#123456' } }, { id: 'look x', tokens: { bgA: '#123456' } }]);
  assert.equal(m.palettes[0].total, 4); assert.equal(m.palettes[1].total, 0);
  const m2 = C.paletteMatch(hist([['#123456', 4]]), [{ id: 'look x', tokens: { bgA: '#123456' } }, { id: 'kit', tokens: { bgA: '#123456' } }]);
  assert.equal(m2.palettes[0].total, 4);
});

// paletteResult on hand-made matches: { total, none, palettes: [kit, ...others] }
const mk = (kit, other = {}) => ({ total: 10000, none: 0, palettes: [{ id: 'kit', total: 0, tokens: { bgA: 0, bgB: 0, accent: 0, ...kit } },
  { id: 'look x', total: 0, tokens: { bgA: 0, bgB: 0, accent: 0, ...other } }] });
test('the rules: the kit\'s bgA and bgB together take at least 15%, at the edge too', () => {
  assert.equal(C.T.palette.bg, 0.15);
  const at = C.paletteResult(mk({ bgA: 1000, bgB: 500, accent: 100 }));
  assert.equal(at.rules[0].ok, true, 'exactly 15% passes'); assert.equal(at.ok, true);
  const under = C.paletteResult(mk({ bgA: 1000, bgB: 499, accent: 100 }));
  assert.equal(under.rules[0].ok, false, '14.99% fails'); assert.equal(under.ok, false);
  assert.equal(C.paletteResult(mk({ bgA: 0, bgB: 1500, accent: 100 })).rules[0].ok, true, 'bgB counts with bgA');
});
test('the rules: the kit\'s accent takes at least 0.5%, at the edge too', () => {
  assert.equal(C.T.palette.accent, 0.005);
  assert.equal(C.paletteResult(mk({ bgA: 5000, accent: 50 })).ok, true, 'exactly 0.5% passes');
  const under = C.paletteResult(mk({ bgA: 5000, accent: 49 }));
  assert.equal(under.rules[1].ok, false); assert.equal(under.ok, false);
});
test('the rules: no look\'s bgA and bgB take more than the kit\'s, and no look\'s accent more than the kit\'s', () => {
  assert.equal(C.paletteResult(mk({ bgA: 3000, accent: 100 }, { bgA: 2000, bgB: 1000 })).ok, true, 'a look\'s background equal to the kit\'s passes');
  const bg = C.paletteResult(mk({ bgA: 3000, accent: 100 }, { bgA: 2000, bgB: 1001 }));
  assert.equal(bg.rules[2].ok, false, 'a look\'s background over the kit\'s fails'); assert.equal(bg.ok, false);
  assert.match(bg.rules[2].rule, /look x/);
  const ac = C.paletteResult(mk({ bgA: 3000, accent: 100 }, { accent: 101 }));
  assert.equal(ac.rules[3].ok, false, 'a look\'s accent over the kit\'s fails'); assert.equal(ac.ok, false);
  assert.equal(C.paletteResult(mk({ bgA: 3000, accent: 100 }, { accent: 100, bgA: 40 })).ok, true);
  // a look's ink or muted does not count against the kit (whole palettes are not compared)
  const ink = mk({ bgA: 3000, accent: 60 }, {}); ink.palettes[1].tokens.ink = 500; ink.palettes[1].total = 500;
  assert.equal(C.paletteResult(ink).ok, true);
});

// ---------------------------------------------------------------- the style and its precedence
test('precedence: --param over brand.json over the look over the template, token by token', () => {
  const t = LK.resolveStyle({});
  assert.deepEqual(t.tokens, LK.TEMPLATE.tokens); assert.equal(t.look, null); assert.equal(t.bg, 'gradient');
  assert.ok(Object.values(t.sources).every((s) => s === 'template'));
  const l = LK.resolveStyle({ look: 'paper' });
  assert.deepEqual(l.tokens, LK.LOOKS.paper.tokens); assert.equal(l.bg, 'paper'); assert.equal(l.sources.ink, 'look');
  const brand = { name: 'Kit', colors: { bgA: '#7a1030', ink: '#FBEFE4' } };
  const k = LK.resolveStyle({ look: 'paper', brand });
  assert.equal(k.tokens.bgA, '#7A1030'); assert.equal(k.sources.bgA, 'brand');
  assert.equal(k.tokens.ink, '#FBEFE4'); assert.equal(k.tokens.bgB, LK.LOOKS.paper.tokens.bgB); assert.equal(k.sources.bgB, 'look');
  const p = LK.resolveStyle({ look: 'paper', brand, params: { ink: '#123', accent: '#00ff00', bg: 'grid' } });
  assert.equal(p.tokens.ink, '#112233'); assert.equal(p.sources.ink, 'param');
  assert.equal(p.tokens.accent, '#00FF00'); assert.equal(p.tokens.bgA, '#7A1030', 'a param that names another token leaves the kit\'s');
  assert.equal(p.bg, 'grid'); assert.equal(p.sources.bg, 'param');
  const nb = LK.resolveStyle({ brand, params: { muted: '#010203' } });
  assert.equal(nb.tokens.bgB, LK.TEMPLATE.tokens.bgB, 'without a look the template fills what the kit leaves out');
  assert.equal(nb.tokens.muted, '#010203');
});
test('precedence for fonts: the kit\'s role over the look\'s over the template\'s; look and kit files have their urls', () => {
  const brand = { name: 'Kit', fonts: { display: { family: 'Kit Display', file: 'fonts/kit-display.woff2' } } };
  const s = LK.resolveStyle({ look: 'paper', brand });
  assert.deepEqual([s.fonts.display.family, s.fonts.display.from, s.fonts.display.url], ['Kit Display', 'brand', 'fonts/kit-display.woff2']);
  assert.deepEqual([s.fonts.body.family, s.fonts.body.from, s.fonts.body.url], ['HAND', 'look', 'fonts/caveat-latin-700-normal.woff2']);
  assert.deepEqual([s.fonts.mono.family, s.fonts.mono.url], ['MONO', null]);
  assert.deepEqual(LK.styleFaces(s).map((f) => f.family), ['Kit Display', 'HAND']);
  assert.deepEqual(LK.styleFamilies(s), ['Kit Display', 'HAND', 'MONO']);
  assert.deepEqual(LK.styleFamilies(LK.resolveStyle({})), [], 'the template\'s own style adds nothing to CFG.FONTS');
  assert.equal(LK.fontStr(s, 'display', 120), '120px "Kit Display"');
  assert.equal(LK.fontStr(s, 'body', 40, 'italic'), 'italic 40px "HAND"');
});
test('the style refuses an unknown look, a param colour that does not parse, a colour given as bg, and a broken kit', () => {
  assert.throws(() => LK.resolveStyle({ look: 'vaporwave' }), /unknown look "vaporwave"/);
  assert.throws(() => LK.resolveStyle({ look: 'constructor' }), /unknown look "constructor"/, 'an inherited key is not a look');
  assert.throws(() => LK.resolveStyle({ params: { bg: 'toString' } }), /bg is the background shader id/);
  assert.throws(() => LK.resolveStyle({ params: { ink: 'red' } }), /--param ink=red/);
  assert.throws(() => LK.resolveStyle({ params: { bg: '#101018' } }), /bg is the background shader id/);
  assert.throws(() => LK.resolveStyle({ brand: { name: 'K', colors: { ink: '#12' } } }), /colors\.ink/);
});
test('bgConfig: the shader id and its colours from the tokens; alpha clears; bg never carries a colour', () => {
  const s = LK.resolveStyle({ look: 'neon' });
  const g = LK.bgConfig(s);
  assert.equal(g.scene, LK.BG_IDS.grid);
  assert.deepEqual(g.P.slice(0, 3), LK.hexRgb01(s.tokens.bgA));
  assert.deepEqual(g.Q.slice(0, 3), LK.hexRgb01(s.tokens.accent2), 'neon draws its grid lines in accent2');
  assert.equal(LK.bgConfig(s, { alpha: true }).scene, 0);
  assert.equal(LK.bgConfig(LK.resolveStyle({ look: 'gradient' })).scene, LK.BG_IDS.mesh);
  assert.deepEqual(LK.bgConfig(LK.resolveStyle({ look: 'gradient' })).R.slice(0, 3), LK.hexRgb01(LK.LOOKS.gradient.tokens.accent2));
  assert.equal(LK.bgConfig(LK.resolveStyle({ look: 'retro-crt' })).scene, LK.BG_IDS.crt);
  assert.equal(LK.bgConfig(LK.resolveStyle({ params: { bg: 'none' } })).scene, 0);
  assert.deepEqual(Object.keys(LK.BG_IDS), ['none', 'gradient', 'paper', 'grid', 'crt', 'mesh']);
});

// ---------------------------------------------------------------- brand.json
test('brand.json problems: shape, tokens, colours that do not parse, roles, families, paths and files', () => {
  assert.deepEqual(LK.brandProblems({ name: 'Kit', colors: { bgA: '#7A1030' }, fonts: { body: { family: 'Kit Text', file: 'fonts/a.woff2' } }, logo: { onDark: 'l.svg' } }), []);
  const p = LK.brandProblems({
    name: '', look: 'vapor', extra: 1,
    colors: { bgA: '#7A103', ink: 'white', paper: '#FFFFFF' },
    fonts: { display: { family: 'DISPLAY', file: 'f.woff2' }, body: { family: 'Kit "Text"', file: '../x.woff2' }, title: { family: 'X', file: 'x' } },
    logo: { onDark: '/abs/logo.svg', dark: 'x.svg' },
  });
  for (const re of [/unknown key "extra"/, /name must be/, /look "vapor"/, /colors\.bgA "#7A103" does not parse/, /colors\.ink "white" does not parse/,
    /colors\.paper is not a token/, /fonts\.display\.family "DISPLAY" is taken/, /fonts\.body\.family/, /fonts\.body\.file must be a path relative/,
    /fonts\.title is not a role/, /logo\.onDark must be a path relative/, /logo\.dark is not onDark or onLight/]) {
    assert.ok(p.some((x) => re.test(x)), `${re} not in:\n${p.join('\n')}`);
  }
  const missing = LK.brandProblems({ name: 'Kit', fonts: { body: { family: 'Kit Text', file: 'fonts/a.woff2' } }, logo: { onLight: 'logo/l.svg' } }, (f) => f !== 'logo/l.svg');
  assert.deepEqual(missing, ['brand.json: logo.onLight logo/l.svg does not exist']);
});
test('the font shorthand parser: the families in order, quotes removed, sizes, line heights and keywords skipped', () => {
  assert.deepEqual(LK.fontFamilies('150px DISPLAY'), ['DISPLAY']);
  assert.deepEqual(LK.fontFamilies('120px "Quill Display"'), ['Quill Display']);
  assert.deepEqual(LK.fontFamilies('italic small-caps 700 64px/1.2 "Kit Display", serif'), ['Kit Display', 'serif']);
  assert.deepEqual(LK.fontFamilies("bold 12.5px 'A, B', C"), ['A, B', 'C']);
  assert.deepEqual(LK.fontFamilies('large Some  Face'), ['Some Face']);
  assert.deepEqual(LK.fontFamilies('10px sans-serif'), ['sans-serif']);
  assert.deepEqual(LK.fontFamilies(''), []);
});

// ---------------------------------------------------------------- the looks, their fonts, the fixture kit
test('the eight looks: names, every token parses, font roles, a shader id, post, motion and sound in range', () => {
  assert.deepEqual(LK.LOOK_NAMES, ['product', 'neon', 'paper', 'editorial', 'retro-crt', 'brutalist', 'gradient', 'mono']);
  for (const [n, L] of [['template', LK.TEMPLATE], ...Object.entries(LK.LOOKS)]) {
    assert.deepEqual(Object.keys(L.tokens), LK.TOKENS, n);
    for (const k of LK.TOKENS) assert.equal(LK.normHex(L.tokens[k]), L.tokens[k], `${n}.${k}`);
    for (const r of LK.ROLES) assert.ok(L.fonts[r] && L.fonts[r].family, `${n}.${r}`);
    assert.ok(L.bg in LK.BG_IDS, `${n}.bg ${L.bg}`);
    for (const k of ['bloom', 'thr', 'ca', 'grain', 'vig', 'scan']) assert.ok(Number.isFinite(L.post[k]), `${n}.post.${k}`);
    assert.ok(L.post.grain <= 0.04 && L.post.ca <= 0.0015 && L.post.bloom <= 0.5, `${n}: post stays subtle (SKILL.md's craft defaults)`);
    assert.ok(LK.ENTERS.includes(L.motion.enter) && LK.EXITS.includes(L.motion.exit) && L.motion.stagger >= 0.03 && L.motion.stagger <= 0.09, `${n}.motion`);
    assert.ok(typeof L.motion.sweep === 'boolean' && typeof L.motion.glitch === 'boolean', `${n}.motion flags`);
    assert.ok(LK.WAVES.includes(L.sound.wave) && L.sound.pitch > 0 && L.sound.verb >= 0 && L.sound.verb <= 1, `${n}.sound`);
  }
  assert.equal(LK.LOOKS.paper.motion.glitch, false, 'paper: no glitch');
  assert.equal(LK.LOOKS.neon.motion.glitch, true, 'neon: a glitch at cuts');
  assert.equal(LK.LOOKS.editorial.motion.exit, 'cut', 'editorial: hard cuts');
});
test('the look fonts: four OFL families in looks/fonts/ with their licence texts, at most 400 KB together, not in the template', () => {
  const files = fs.readdirSync(looksFonts);
  const woff = files.filter((f) => f.endsWith('.woff2'));
  assert.equal(Object.keys(LK.LOOK_FONTS).length, 4);
  let total = 0;
  for (const f of Object.values(LK.LOOK_FONTS)) {
    assert.ok(woff.includes(f.file), `${f.file} in looks/fonts/`);
    assert.match(fs.readFileSync(path.join(looksFonts, f.licence), 'utf8'), /SIL Open Font License, Version 1\.1/, f.licence);
    total += fs.statSync(path.join(looksFonts, f.file)).size;
    assert.ok(!fs.existsSync(path.join(templateDir, 'fonts', f.file)), `${f.file} is not in the template`);
  }
  assert.equal(woff.length, 4, 'no other font files in looks/fonts/');
  assert.ok(total <= 400 * 1024, `the look fonts total ${total} bytes`);
  for (const n of LK.LOOK_NAMES) for (const f of LK.lookFiles(n)) assert.ok(files.includes(f), `${n} needs ${f}`);
  assert.deepEqual(LK.lookFiles('paper').sort(), ['OFL-Caveat.txt', 'OFL-Fraunces.txt', 'caveat-latin-700-normal.woff2', 'fraunces-latin-800-normal.woff2']);
  assert.deepEqual(LK.lookFiles('neon'), [], 'a look in the template\'s faces needs no files');
});
test('the fixture kit: brand.json is whole, and its bgA, bgB and accent are each more than 15 from every look\'s and the template\'s tokens', () => {
  const dir = path.join(fixturesDir, 'brand-kit');
  const kit = JSON.parse(fs.readFileSync(path.join(dir, 'brand.json'), 'utf8'));
  assert.deepEqual(LK.brandProblems(kit, (f) => fs.existsSync(path.join(dir, f))), []);
  assert.deepEqual(Object.keys(kit.colors), LK.TOKENS);
  assert.ok(kit.fonts.display && kit.fonts.body && kit.logo.onDark && kit.logo.onLight);
  const close = [];
  for (const k of ['bgA', 'bgB', 'accent']) {
    const d = nearest(kit.colors[k], { withKit: false });
    if (!(d.d > 15)) close.push(`${k} ${kit.colors[k]} is ${d.d.toFixed(2)} from ${d.id}.${d.k}`);
  }
  assert.deepEqual(close, []);
});
