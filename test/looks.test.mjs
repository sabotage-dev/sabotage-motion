// Looks and brand kits in a browser (plan 23.2): the precedence in a real render's record, a missing look or kit
// font failing the render (and check's fonts), doctor on a broken kit, fonts_used (drawn, not measured), the colour
// match (render.mjs palette) on a piece in the kit's colours and on pieces in a look's or the template's, the brand
// sheet's pixels, brand.png outside the source hash, and every look's 5 s card passing check with no FAIL and no WARN.
// test/looks-units.test.mjs has the parts that need no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makePiece, render, fixturesDir, repoRoot, templateDir, readWav } from './helpers.mjs';

const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
const SHEET = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'looks-sheet.mjs')).href);
const looksFonts = path.join(repoRoot, 'skills', 'sabotage-motion', 'looks', 'fonts');
const KIT = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'brand-kit', 'brand.json'), 'utf8'));

// A copy of the template alone (its own scene, the title card), as a piece starts.
function templatePiece(name) {
  const dir = makePiece(name, 'brand-kit');
  for (const f of ['brand.json', 'README.md', 'logo', 'fonts/quillfen-display.woff2', 'fonts/quillfen-text.woff2', 'fonts/OFL-Fraunces.txt', 'fonts/OFL-Fredoka.txt']) fs.rmSync(path.join(dir, f), { recursive: true });
  return dir;
}
// A piece with the fixture kit (brand.json, its fonts and logos), optionally with fixture-palette's scenes.
function kitPiece(name, { palette = false } = {}) {
  const dir = makePiece(name, 'brand-kit');
  if (palette) fs.cpSync(path.join(fixturesDir, 'fixture-palette'), dir, { recursive: true });
  return dir;
}
const record = (dir, out) => JSON.parse(fs.readFileSync(path.join(dir, out + '.render.json'), 'utf8'));
const copyLookFonts = (dir, look) => { for (const f of LK.lookFiles(look)) fs.copyFileSync(path.join(looksFonts, f), path.join(dir, 'fonts', f)); };
const quick = ['--scale', '0.25', '--sub', '1'];
const json = (r) => { try { return JSON.parse(r.stdout); } catch { assert.fail(`no JSON (exit ${r.status}):\n${r.out}`); } };

test('precedence in a render: --param over brand.json over the look over the template, as the render record shows it', () => {
  const dir = templatePiece('looks-precedence');
  // a kit that gives only bgA, ink and a display face, over the paper look
  fs.copyFileSync(path.join(fixturesDir, 'brand-kit', 'fonts', 'quillfen-display.woff2'), path.join(dir, 'fonts', 'part-display.woff2'));
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify({ name: 'Part', colors: { bgA: '#7A1030', ink: '#FBEFE4' },
    fonts: { display: { family: 'Part Display', file: 'fonts/part-display.woff2' } } }));
  copyLookFonts(dir, 'paper');
  render(dir, ['video', '--to', '1', ...quick, '--param', 'look=paper', '--param', 'ink=#abcdef', '--out', 'out/p.mp4']);
  const P = LK.LOOKS.paper.tokens, r1 = record(dir, 'out/p.mp4');
  assert.equal(r1.look, 'paper'); assert.equal(r1.brand, 'Part');
  assert.deepEqual(r1.tokens, { bgA: '#7A1030', bgB: P.bgB, ink: '#ABCDEF', muted: P.muted, accent: P.accent, accent2: P.accent2 });
  assert.deepEqual([...r1.fonts_used].sort(), ['HAND', 'Part Display'], 'the kit\'s display face and the look\'s body face were drawn');
  render(dir, ['video', '--to', '0.1', ...quick, '--param', 'look=paper', '--out', 'out/p.mp4']);
  assert.equal(record(dir, 'out/p.mp4').tokens.ink, '#FBEFE4', 'without the param, the kit\'s ink');
  fs.rmSync(path.join(dir, 'brand.json'));
  render(dir, ['video', '--to', '0.1', ...quick, '--param', 'look=paper', '--out', 'out/p.mp4']);
  assert.deepEqual(record(dir, 'out/p.mp4').tokens, P, 'without the kit, the look\'s');
  assert.equal(record(dir, 'out/p.mp4').brand, null);
  render(dir, ['video', '--to', '0.1', ...quick, '--out', 'out/p.mp4']);
  const r4 = record(dir, 'out/p.mp4');
  assert.deepEqual(r4.tokens, LK.TEMPLATE.tokens, 'without either, the template\'s'); assert.equal(r4.look, null);
});

test('a look whose font files were not copied fails the render, and check reports each under fonts', () => {
  const dir = templatePiece('looks-missing-look-font');
  const r = render(dir, ['video', '--to', '0.1', ...quick, '--param', 'look=paper', '--out', 'out/x.mp4'], { allowFail: true });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /font missing: SERIF \(look paper, display\) did not load from fonts\/fraunces-latin-800-normal\.woff2: copy it from the skill's looks\/fonts\//);
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'x.mp4')) && !fs.existsSync(path.join(dir, 'out', 'x.mp4.render.json')), 'no video and no record');
  const c = json(render(dir, ['check', '--json', '--only', 'fonts', '--param', 'look=paper'], { allowFail: true }));
  const fonts = c.filter((x) => x.id === 'fonts');
  assert.deepEqual(fonts.map((x) => x.level), ['FAIL', 'FAIL']);
  assert.ok(fonts.some((x) => /SERIF/.test(x.detail)) && fonts.some((x) => /HAND/.test(x.detail)), JSON.stringify(fonts));
  copyLookFonts(dir, 'paper');
  render(dir, ['video', '--to', '0.1', ...quick, '--param', 'look=paper', '--out', 'out/x.mp4']);
  const ok = json(render(dir, ['check', '--json', '--only', 'fonts', '--param', 'look=paper']));
  assert.deepEqual(ok.map((x) => x.level), ['OK']);
  assert.match(ok[0].detail, /SERIF/); assert.match(ok[0].detail, /HAND/); assert.match(ok[0].detail, /MONO/);
});

test('a kit whose font file is missing fails the render, and check reports it under fonts', () => {
  const dir = kitPiece('looks-missing-kit-font');
  fs.rmSync(path.join(dir, 'fonts', 'quillfen-display.woff2'));
  const r = render(dir, ['video', '--to', '0.1', ...quick, '--out', 'out/x.mp4'], { allowFail: true });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /font missing: Quillfen Display \(brand\.json, display\) did not load from fonts\/quillfen-display\.woff2/);
  const c = json(render(dir, ['check', '--json', '--only', 'fonts'], { allowFail: true }));
  assert.deepEqual(c.map((x) => `${x.level} ${/Quillfen Display/.test(x.detail)}`), ['FAIL true']);
});

test('doctor reads the kit and the look: a clean kit passes; bad colours, missing and broken files, and missing look fonts FAIL', () => {
  const clean = kitPiece('looks-doctor-clean');
  const d0 = render(clean, ['doctor']);
  assert.match(d0.out, /ok {4}brand kit: brand\.json "Quillfen": 6 colours parse, every file it names exists/);
  assert.match(d0.out, /ok {4}font: Quillfen Display \(brand\.json, display\) loads/);
  assert.match(d0.out, /ok {4}font: Quillfen Text \(brand\.json, body\) loads/);
  assert.match(d0.out, /ok {4}look: none/);
  // a colour that does not parse and a logo that is not there
  const bad = kitPiece('looks-doctor-bad');
  fs.writeFileSync(path.join(bad, 'brand.json'), JSON.stringify({ ...KIT, colors: { ...KIT.colors, accent: '#10A8F' }, logo: { ...KIT.logo, onLight: 'logo/missing.svg' } }));
  const d1 = render(bad, ['doctor'], { allowFail: true });
  assert.equal(d1.status, 1);
  assert.match(d1.out, /FAIL {2}brand kit: brand\.json: colors\.accent "#10A8F" does not parse/);
  assert.match(d1.out, /FAIL {2}brand kit: brand\.json: logo\.onLight logo\/missing\.svg does not exist/);
  assert.match(d1.out, /FAIL {2}look and kit: the piece did not open/);
  // every file there, but the body face is not a font, and the kit's look (paper) has no font files in the piece
  const broken = kitPiece('looks-doctor-broken');
  fs.writeFileSync(path.join(broken, 'fonts', 'quillfen-text.woff2'), 'not a font');
  fs.writeFileSync(path.join(broken, 'brand.json'), JSON.stringify({ ...KIT, look: 'paper' }));
  const d2 = render(broken, ['doctor'], { allowFail: true });
  assert.equal(d2.status, 1);
  assert.match(d2.out, /ok {4}brand kit: brand\.json "Quillfen"/);
  assert.match(d2.out, /ok {4}look: paper \(.*\), from brand\.json/);
  assert.match(d2.out, /FAIL {2}font: Quillfen Text \(brand\.json, body\) did not load from fonts\/quillfen-text\.woff2/);
  assert.match(d2.out, /ok {4}font: Quillfen Display \(brand\.json, display\) loads/, 'the kit\'s display face wins over paper\'s serif');
  // paper's body face is the kit's, so the look needs no file of its own here; its serif display is replaced too
  assert.doesNotMatch(d2.out, /SERIF/);
  // a look named on the command line whose fonts are not in the piece
  const d3 = render(clean, ['doctor', '--param', 'look=brutalist'], { allowFail: true });
  assert.equal(d3.status, 0, 'brutalist\'s condensed display is replaced by the kit\'s, its body is MONO');
  const plain = templatePiece('looks-doctor-look');
  const d4 = render(plain, ['doctor', '--param', 'look=brutalist'], { allowFail: true });
  assert.equal(d4.status, 1);
  assert.match(d4.out, /FAIL {2}font: CONDENSED \(look brutalist, display\) did not load from fonts\/anton-latin-400-normal\.woff2/);
  assert.match(d4.out, /ok {4}look: brutalist .*from --param look/);
});

test('fonts_used: the families drawn by fillText and strokeText, and not the ones only measured', () => {
  const dir = kitPiece('looks-fonts-used', { palette: true });
  render(dir, ['video', ...quick, '--out', 'out/drawn.mp4']);
  assert.deepEqual([...record(dir, 'out/drawn.mp4').fonts_used].sort(), ['Quillfen Display', 'Quillfen Text'],
    'the display face is only ever stroked, the body face filled');
  render(dir, ['video', ...quick, '--scene', 'measure.js', '--out', 'out/measured.mp4']);
  const r = record(dir, 'out/measured.mp4');
  assert.deepEqual(r.fonts_used, ['MONO'], 'measured with the kit\'s faces, drawn with MONO');
  assert.equal(r.brand, 'Quillfen');
  assert.deepEqual(r.tokens, KIT.colors);
  // full records it too
  render(dir, ['full', ...quick, '--scene', 'measure.js', '--out', 'out/full.mp4']);
  assert.deepEqual(record(dir, 'out/full.mp4').fonts_used, ['MONO']);
});

test('a brand.json that parses but is not an object is a broken kit; palette keeps check\'s probe scale', () => {
  const dir = kitPiece('looks-kit-not-object');
  for (const v of ['null', 'false', '[]']) {
    fs.writeFileSync(path.join(dir, 'brand.json'), v);
    const d = render(dir, ['doctor'], { allowFail: true });
    assert.equal(d.status, 1, `${v}: ${d.out}`);
    assert.match(d.out, /FAIL {2}brand kit: brand\.json must hold an object/, v);
    assert.match(d.out, /FAIL {2}look and kit: the piece did not open/, `${v}: the render refuses it too`);
  }
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(KIT));
  const sc = render(dir, ['palette', '--scale', '0.25'], { allowFail: true });
  assert.equal(sc.status, 2, sc.out); assert.match(sc.out, /--scale is fixed for the colour match/);
});

test('palette: a piece in the kit\'s colours passes; the same piece in a look\'s or the template\'s colours fails', () => {
  const dir = kitPiece('looks-palette', { palette: true });
  const pass = render(dir, ['palette', '--json']);
  const p = json(pass);
  assert.equal(pass.status, 0, pass.out);
  assert.equal(p.ok, true);
  assert.deepEqual([p.w, p.h, p.frames], [540, 960, 60], 'check\'s probe: 1/2 size, every frame');
  assert.equal(p.total, 60 * 540 * 960, 'every pixel of every frame is counted');
  assert.equal(p.kit.name, 'Quillfen');
  const kit = p.palettes[0];
  assert.equal(kit.id, 'kit');
  assert.ok(kit.tokens.bgA + kit.tokens.bgB >= 0.15, JSON.stringify(kit));
  assert.ok(kit.tokens.accent >= 0.005, JSON.stringify(kit));
  assert.equal(p.palettes.length, 2 + LK.LOOK_NAMES.length, 'the kit, the template and every look');
  assert.deepEqual([...p.fonts_used].sort(), ['Quillfen Display', 'Quillfen Text']);
  assert.deepEqual(p.rules.map((x) => x.ok), [true, true, true, true]);
  // the probe turns the grain off: the same piece with heavy grain measures the same
  const grain = json(render(dir, ['palette', '--json', '--param', 'grain=0.6']));
  assert.deepEqual(grain.palettes, p.palettes); assert.equal(grain.none, p.none);
  // run to run, the same numbers (no clustering, no sampling)
  assert.deepEqual(json(render(dir, ['palette', '--json'])).palettes, p.palettes);
  // the kit moves out of the piece (only read with --brand), so the scene draws in a look's colours, then the template's
  fs.mkdirSync(path.join(dir, 'kit'));
  fs.renameSync(path.join(dir, 'brand.json'), path.join(dir, 'kit', 'brand.json'));
  for (const args of [['--param', 'look=neon'], ['--param', 'look=paper'], []]) {
    if (args.length) copyLookFonts(dir, args[1].slice(5));
    const r = render(dir, ['palette', '--json', '--brand', 'kit/brand.json', ...args], { allowFail: true });
    const f = json(r);
    assert.equal(r.status, 1, `${args.join(' ') || 'the template'}: ${r.out}`);
    assert.equal(f.ok, false);
    assert.equal(f.rules[0].ok, false, 'the kit\'s background is not on screen');
  }
  // a usage error: no kit, or a kit without an accent
  const none = render(dir, ['palette'], { allowFail: true });
  assert.equal(none.status, 2); assert.match(none.out, /no kit: brand\.json does not exist/);
  fs.writeFileSync(path.join(dir, 'kit', 'part.json'), JSON.stringify({ name: 'Part', colors: { bgA: '#7A1030', bgB: '#680E34' } }));
  const part = render(dir, ['palette', '--brand', 'kit/part.json'], { allowFail: true });
  assert.equal(part.status, 2); assert.match(part.out, /gives no accent/);
});

// The pixels of a rectangle of a PNG as #RRGGBB strings, through ffmpeg.
function pixels(png, x, y, w = 1, h = 1) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const out = [];
  for (let i = 0; i < raw.length; i += 3) out.push('#' + [...raw.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase());
  return out;
}
const pixel = (png, x, y) => pixels(png, x, y)[0];
test('the brand sheet: every token as a swatch in its exact colour, the type in each role, the logo on a dark and a light ground', () => {
  const dir = kitPiece('looks-brand-sheet');
  const r = render(dir, ['brand']);
  const png = path.join(dir, 'brand.png');
  assert.ok(fs.existsSync(png));
  assert.match(r.out, /wrote .*brand\.png \(1600x\d+\): brand\.json "Quillfen"/);
  const sw = [...r.out.matchAll(/^swatch (\w+) (#[0-9A-F]{6}) at (\d+),(\d+) (\d+)x(\d+)$/gm)];
  assert.deepEqual(sw.map((m) => m[1]), LK.TOKENS);
  for (const m of sw) {
    assert.equal(m[2], KIT.colors[m[1]]);
    const [x, y, w] = [+m[3], +m[4], +m[5]];
    assert.equal(pixel(png, x + w - 14, y + 14), KIT.colors[m[1]], `the ${m[1]} swatch`);
  }
  const gr = Object.fromEntries([...r.out.matchAll(/^ground (onDark|onLight) (#[0-9A-F]{6}) at (\d+),(\d+) (\d+)x(\d+)/gm)].map((m) => [m[1], m.slice(2).map((v, i) => (i ? +v : v))]));
  assert.equal(gr.onDark[0], KIT.colors.bgB, 'the dark ground is the kit\'s darkest of bgA, bgB and ink');
  assert.equal(gr.onLight[0], KIT.colors.ink, 'the light ground is its lightest');
  for (const k of ['onDark', 'onLight']) {
    const [hex, x, y, w, h] = gr[k];
    assert.equal(pixel(png, x + 8, y + 8), hex, `${k}: the ground`);
    const mid = pixels(png, Math.round(x + w / 2 - 100), Math.round(y + h / 2 - 112), 200, 200);
    assert.ok(mid.filter((c) => c !== hex).length > 4000, `${k}: the logo is drawn in the middle of its ground`);
    assert.ok(mid.includes(KIT.colors.accent), `${k}: the logo's ring, in the kit's accent`);
  }
  // without a kit, the sheet shows the look's style, with no logos
  const plain = templatePiece('looks-brand-sheet-look');
  copyLookFonts(plain, 'editorial');
  const r2 = render(plain, ['brand', '--param', 'look=editorial', '--out', 'out/sheet.png']);
  assert.match(r2.out, /no brand\.json, look editorial/);
  assert.match(r2.out, /^swatch accent #E3120B/m);
  assert.match(r2.out, /^ground onDark .*\(no logo\)$/m);
});

test('brand.png is a review sheet: writing it leaves the source hash a render records unchanged; brand.json is source', () => {
  const dir = kitPiece('looks-brand-hash');
  const src = () => { render(dir, ['video', '--to', '0.1', ...quick, '--out', 'out/h.mp4']); return record(dir, 'out/h.mp4').source.hash; };
  const a = src();
  render(dir, ['brand']);
  assert.equal(src(), a);
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify({ ...KIT, colors: { ...KIT.colors, muted: '#D9A9B6' } }));
  assert.notEqual(src(), a);
});

// brutalist's tokens (a saturated yellow ground, near-black ink, red accent) are far from the template's and from the
// other looks', so the palette match attributes its pixels without ambiguity (looks with near-black grounds share them)
test('the template\'s card draws in the style: on brutalist, its background, ink and accent bar are the look\'s tokens, and no other palette\'s', () => {
  const dir = templatePiece('looks-template-style');
  copyLookFonts(dir, 'brutalist');
  fs.mkdirSync(path.join(dir, 'kit'));
  fs.writeFileSync(path.join(dir, 'kit', 'brutalist.json'), JSON.stringify({ name: 'Brutalist tokens', colors: LK.LOOKS.brutalist.tokens }));
  const pal = (energy) => json(render(dir, ['palette', '--json', '--brand', 'kit/brutalist.json', '--param', 'look=brutalist', '--param', `energy=${energy}`], { allowFail: true }));
  // at subtle the card is its layout alone (no accent block, no stripes): nearly every pixel is one of the look's tokens
  const s = pal('subtle'), k = s.palettes[0].tokens, show = (p) => JSON.stringify({ kit: p.palettes[0].share, none: p.none, ...p.palettes[0].tokens });
  assert.ok(s.palettes[0].share >= 0.95 && s.none <= 0.02, `at subtle the look's tokens are nearly every pixel: ${show(s)}`);
  assert.ok(k.bgA + k.bgB > 0.8, `the background is the look's bgA and bgB: ${show(s)}`);
  assert.ok(k.ink > 0.003, `the title and the frame marks are the look's ink: ${show(s)}`);
  assert.ok(k.accent > 0.0003, `the bar is the look's accent: ${show(s)}`);
  // at the board's energy (normal) the card cuts with a block of the accent and scrolls stripes in tints of its colours,
  // however much of the frame the block covers, no other palette's colours (the template's, the other looks') come in
  const n = pal('normal'), kn = n.palettes[0], other = n.palettes.slice(1).reduce((x, y) => (y.share > x.share ? y : x));
  assert.ok(other.share < 0.02 && kn.share >= 20 * other.share, `no other palette at normal: the most is ${other.id}, ${other.share}, against the look's ${kn.share}`);
  assert.ok(kn.tokens.bgA + kn.tokens.bgB >= 0.15 && kn.tokens.ink > 0.003 && kn.tokens.accent >= 0.005, `the look's ground, ink and accent all drawn at normal: ${show(n)}`);
  assert.deepEqual([...n.fonts_used].sort(), ['CONDENSED', 'MONO'], 'brutalist\'s display and body faces');
});

test('the template\'s sound follows the style: on one fixed timeline, mono\'s effects are not the template\'s, and each repeats', () => {
  // template and mono share their motion flags (a sweep, no glitch), and sound.js keeps one timeline whatever the
  // look's stagger, so the two differ only if the style's sound (wave, pitch, bright, verb) reaches audio.js
  assert.deepEqual([LK.LOOKS.mono.motion.sweep, LK.LOOKS.mono.motion.glitch], [LK.TEMPLATE.motion.sweep, LK.TEMPLATE.motion.glitch]);
  assert.notDeepEqual(LK.LOOKS.mono.sound, LK.TEMPLATE.sound);
  const dir = templatePiece('looks-template-sound');
  fs.copyFileSync(path.join(fixturesDir, 'fixture-palette', 'sound.js'), path.join(dir, 'sound.js'));
  const wav = (args, out) => { render(dir, ['audio', '--scene', 'sound.js', ...args, '--out', out]); return readWav(path.join(dir, out)); };
  const a = wav([], 'out/a1.wav'), a2 = wav([], 'out/a2.wav'), m = wav(['--param', 'look=mono'], 'out/m.wav');
  const diff = (x, y) => { let s = 0; for (let i = 0; i < x.samples.length; i++) s += (x.samples[i] - y.samples[i]) ** 2; return Math.sqrt(s / x.samples.length); };
  assert.equal(a.samples.length, m.samples.length);
  const same = diff(a, a2), other = diff(a, m);
  assert.ok(other > 0.001, `mono's effects differ from the template's (RMS difference ${other})`);
  assert.ok(other > 20 * same, `by far more than two renders of the template differ (${other} against ${same})`);
});

for (const look of SHEET.LOOK_NAMES) {
  test(`the looks sheet: the ${look} card passes check with no FAIL and no WARN, drawn in its own fonts`, () => {
    const dir = SHEET.cardPiece(look, path.join(repoRoot, 'test', '.work', `looks-card-${look}`));
    const c = SHEET.checkCard(look, dir);
    assert.ok(c.results, c.out);
    assert.deepEqual(c.results.filter((x) => x.level === 'FAIL' || x.level === 'WARN').map((x) => `${x.level} ${x.id}: ${x.detail}`), []);
    assert.equal(c.status, 0);
    const fonts = c.results.find((x) => x.id === 'fonts');
    for (const r of LK.ROLES) assert.ok(fonts.detail.includes(LK.LOOKS[look].fonts[r].family), `${fonts.detail} names ${LK.LOOKS[look].fonts[r].family}`);
    // only hook_long (the card has no voice) and flash (it reads a render, and the card is checked before any) are not
    // checked; energy_match measures the card at the subtle energy its board names (P11b: the template declares cuts())
    assert.deepEqual(c.results.filter((x) => x.level === 'SKIP').map((x) => x.id).sort(), ['flash', 'hook_long']);
    assert.match(c.results.find((x) => x.id === 'energy_match').detail, /^energy subtle \(the board\) moves like it/);
    assert.match(c.results.find((x) => x.id === 'flash').detail, /not checked: no render of the whole piece/);
  });
}
