// The energy presets in a browser (plan 23.9, P11b-1): the template card at each energy, rendered, mastered with its bed
// stem and checked on the source and the master (0 FAIL, 0 WARN, flash included); the bed stem through the mixer
// (generated, on the beat grid, ducked under a voice, refused when missing or changed) and check --file's provenance of
// it; the scene interface check's energy measurements read (sceneCuts, INFO.ENERGY); the energy reaching init, audio.js
// and a clip's caption style; and a CFG.ENERGY that disagrees with the board's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { makePiece, render, countFrames, repoRoot, templateDir, sha256File } from './helpers.mjs';
import { SR, mixTool, runMix, writeCues, monoWav, toneBursts, decode, gainOf, db } from './mix-helpers.mjs';

const P = (dir, f) => path.join(dir, f);
const ok = (r) => assert.equal(r.status, 0, r.out);
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const LEN = { subtle: 5 * 60 / 84, normal: 6 * 60 / 116, extreme: 7 * 60 / 136 };
// the card is rendered small (quarter size, two subframes): the checks measure in design pixels and on the decoded file
const R = ['--scale', '0.25', '--sub', '2'];
const work = path.join(repoRoot, 'test', '.work');

// One piece: the template as it ships, rendered at each energy (out/card-<energy>.mp4 and its stems), mastered alone.
let card = null;
before(() => {
  card = makePiece('energy-card', 'fixture-clean');
  for (const f of ['scene.js', 'audio.js', 'board.js']) fs.copyFileSync(path.join(templateDir, f), P(card, f));   // the template's own card
  for (const e of Object.keys(LEN)) {
    render(card, ['full', '--param', `energy=${e}`, ...R, '--out', `out/card-${e}.mp4`]);
    ok(runMix(card, ['card-' + e, '--master-only']));
  }
});

for (const e of Object.keys(LEN)) {
  test(`P11b the template card at ${e}: its length on the beat grid, a bed stem, and 0 FAIL, 0 WARN in check and check --file, flash included`, () => {
    const rec = json(P(card, `out/card-${e}.mp4.render.json`));
    assert.deepEqual(rec.energy, { name: e, from: '--param', bpm: { subtle: 84, normal: 116, extreme: 136 }[e] });
    assert.equal(countFrames(P(card, `out/card-${e}.mp4`)), Math.round(LEN[e] * 30));
    // the bed stem: recorded with the picture, the picture's length, on the grid
    assert.equal(rec.bed, `out/card-${e}.bed.wav`);
    assert.equal(rec.bedSha256, sha256File(P(card, rec.bed)));
    const bed = decode(P(card, rec.bed));
    assert.ok(Math.abs(bed.length / 2 / SR - LEN[e]) < 1 / SR * 2, `the bed is ${bed.length / 2 / SR} s, not the picture's ${LEN[e]}`);
    const mj = json(P(card, `out/card-${e}.master.json`)), bs = mj.stems.find((x) => x.role === 'bed');
    assert.deepEqual([bs.file, bs.generated, bs.start, bs.fade, bs.gain], [`out/card-${e}.bed.wav`, true, 0, 0, 0.5]);
    for (const args of [['check', ...R], ['check', '--file', `out/card-${e}-final.mp4`]]) {
      const r = render(card, [...args.slice(0, 1), '--param', `energy=${e}`, ...args.slice(1), '--json'], { allowFail: true });
      const res = JSON.parse(r.stdout), bad = res.filter((x) => x.level === 'FAIL' || x.level === 'WARN').map((x) => `${x.level} ${x.id}: ${x.detail}`);
      assert.deepEqual(bad, [], `${args.join(' ')}`);
      assert.equal(res.find((x) => x.id === 'flash').level, 'OK', `${args.join(' ')}: flash ran`);
      const sp = res.find((x) => x.id === 'audio_spike');
      assert.equal(sp.level, 'OK'); assert.match(sp.detail, /the bed stem \(x0\.5\) summed/, 'audio_spike hears the bed at the mixer\'s gain');
      if (args.includes('--file')) assert.match(res.find((x) => x.id === 'provenance').detail, /its bed stem too/);
    }
  });
}

test('P11b an unvoiced --master-only mix carries the bed stem on the beat grid: a kick on every beat of normal\'s 116 BPM', () => {
  const pre = decode(P(card, 'out/card-normal.bed.wav')), spb = 60 / 116;
  const rms = (a, b) => { let s = 0, n = 0; for (let j = Math.round(a * SR); j < Math.round(b * SR); j++) { s += pre[2 * j] ** 2; n++; } return Math.sqrt(s / Math.max(1, n)); };
  // an onset: the 25 ms after a time against the 25 ms before it; on every beat, at least 6 dB and twice what the same
  // measure gives a third of a beat later (off the grid)
  const onset = (t) => rms(t, t + 0.025) / rms(t - 0.025, t);
  for (let k = 1; k * spb < LEN.normal - 0.1; k++) {
    const t = k * spb;
    assert.ok(db(onset(t)) > 6 && onset(t) > 2 * onset(t + spb / 3), `no onset on beat ${k} at ${t.toFixed(3)} s (${onset(t).toFixed(2)} vs ${onset(t + spb / 3).toFixed(2)} off the grid)`);
  }
  // and the mix carries it from its first sample, at the --master-only bed gain
  const dir = path.join(work, 'energy-bedmix');
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(card, dir, { recursive: true });
  ok(runMix(dir, ['card-normal', '--master-only', '--no-sfx', '--keep-premix']));
  const m = decode(P(dir, 'out/card-normal.premix.wav')), ref = decode(P(dir, 'out/card-normal.bed.wav'));
  const g = gainOf(m, ref, Math.round(0.5 * SR), Math.round(2.5 * SR));
  assert.ok(Math.abs(g - 0.5) < 0.05, `the bed is in the premix at x${g.toFixed(3)} from its first sample, not x0.5`);
});

test('P11b a voiced mix ducks the bed stem under the voice, at the bed gain for a voice (x0.22)', () => {
  const dir = path.join(work, 'energy-duck');
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(card, dir, { recursive: true });
  fs.writeFileSync(P(dir, 'vo.wav'), monoWav(toneBursts(2.2, [[1.0, 2.0]])));
  writeCues(dir, { VO_OFFSET: 0.2, CUE: { a: 1.0 } });   // the voice plays 1.2-2.2 s
  ok(runMix(dir, ['card-normal', '--no-sfx', '--keep-premix']));
  const mj = json(P(dir, 'out/card-normal.master.json')), bs = mj.stems.find((x) => x.role === 'bed');
  assert.deepEqual([bs.generated, bs.gain, bs.start, bs.fade], [true, 0.22, 0, 0]);
  assert.ok(mj.chain.duck, 'the voice ducks the bed');
  const pre = decode(P(dir, 'out/card-normal.premix.wav')), ref = decode(P(dir, 'out/card-normal.bed.wav'));
  const g = (a, b) => gainOf(pre, ref, Math.round(a * SR), Math.round(b * SR));
  const before = g(0.1, 1.1), inside = g(1.6, 2.1);
  assert.ok(Math.abs(before - 0.22) < 0.03, `the bed before the voice is x${before.toFixed(3)}`);
  assert.ok(db(before / inside) >= 10, `the bed is only ${db(before / inside).toFixed(1)} dB lower under the voice`);
});

test('P11b a missing or changed bed stem is refused, never left out; --no-bed mixes without it; it is never moved', () => {
  const dir = path.join(work, 'energy-stale');
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(card, dir, { recursive: true });
  const bed = P(dir, 'out/card-normal.bed.wav'), keep = fs.readFileSync(bed);
  fs.rmSync(bed);
  let r = runMix(dir, ['card-normal', '--master-only']);
  assert.equal(r.status, 1); assert.match(r.out, /the bed stem out\/card-normal\.bed\.wav that out\/card-normal\.mp4's render wrote is missing/);
  fs.writeFileSync(bed, Buffer.concat([keep, Buffer.from([0, 0, 0, 0])]));
  r = runMix(dir, ['card-normal', '--master-only']);
  assert.equal(r.status, 1); assert.match(r.out, /changed after the render that wrote it/);
  ok(runMix(dir, ['card-normal', '--master-only', '--no-bed']));
  assert.equal(json(P(dir, 'out/card-normal.master.json')).stems.some((x) => x.role === 'bed'), false);
  fs.writeFileSync(bed, keep);
  for (const o of [['--bed-at', '0.5'], ['--bed-skip', '0.2']]) {
    r = runMix(dir, ['card-normal', '--master-only', ...o]);
    assert.equal(r.status, 1, r.out); assert.match(r.out, /on the picture's beat grid from 0, so it is never moved/);
  }
  // a bed stem with no record at all (not from this render, not from `audio`) is refused too
  fs.rmSync(P(dir, 'out/card-normal.mp4.render.json'));
  render(dir, ['video', '--param', 'energy=normal', ...R, '--out', 'out/card-normal.mp4']);
  r = runMix(dir, ['card-normal', '--master-only', '--no-sfx']);
  assert.equal(r.status, 1); assert.match(r.out, /has no render record that describes it/);
});

test('P11b check --file: a bed stem from a render with other settings fails provenance; one from `audio` with the picture\'s settings passes', () => {
  const dir = path.join(work, 'energy-prov');
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(card, dir, { recursive: true });
  // `audio` writes the effects and the bed stem with their own records; at another energy they are other stems
  render(dir, ['audio', '--param', 'energy=extreme', '--out', 'out/card-normal.wav']);
  const ar = json(P(dir, 'out/card-normal.bed.wav.render.json'));
  assert.deepEqual([ar.role, ar.mode, ar.audioSha256], ['bed', 'audio', sha256File(P(dir, 'out/card-normal.bed.wav'))]);
  ok(runMix(dir, ['card-normal', '--master-only']));
  let r = render(dir, ['check', '--file', 'out/card-normal-final.mp4', '--only', 'provenance', '--json'], { allowFail: true });
  const p = JSON.parse(r.stdout).find((x) => x.id === 'provenance');
  assert.equal(p.level, 'FAIL'); assert.match(p.detail, /the bed stem out\/card-normal\.bed\.wav was rendered with other settings than the picture/);
  render(dir, ['audio', '--param', 'energy=normal', '--out', 'out/card-normal.wav']);
  ok(runMix(dir, ['card-normal', '--master-only']));
  r = render(dir, ['check', '--file', 'out/card-normal-final.mp4', '--only', 'provenance', '--json'], { allowFail: true });
  assert.equal(JSON.parse(r.stdout).find((x) => x.id === 'provenance').level, 'OK');
});

// ---- the page itself: a static server for one piece and a page on it, for what render.mjs does not print
let browser = null;
const servers = [];
async function openPage(dir, query) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__exists') { const f = P(dir, url.searchParams.get('path') || ''); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ exists: fs.existsSync(f) && fs.statSync(f).isFile() })); }
    const f = P(dir, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  if (!browser) {
    const gpu = process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
    browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true, args: gpu });
  }
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${new URLSearchParams({ scale: '0.25', sub: '1', ...query })}`);
  const ready = await page.evaluate(() => window.ready.then(() => null, (e) => e.message));
  return { page, ready, errors };
}
after(async () => { if (browser) await browser.close(); for (const s of servers) s.close(); });

test('P11b the interface check measures: INFO.ENERGY names the energy and where it came from, sceneCuts() returns the scene\'s cuts checked', async () => {
  const { page, ready } = await openPage(card, { scene: 'scene.js', 'p.energy': 'extreme' });
  assert.equal(ready, null);
  assert.deepEqual(await page.evaluate(() => window.INFO.ENERGY), { name: 'extreme', from: '--param', bpm: 136 });
  assert.equal(await page.evaluate(() => window.INFO.CUTS), true);
  const cuts = await page.evaluate(() => window.sceneCuts());
  assert.ok(cuts.length >= 6, `extreme cuts every half beat (${cuts.length} cuts)`);
  for (const c of cuts) assert.ok(c.d >= 0 && c.d <= 0.3 && c.t > 0 && c.t < LEN.extreme, JSON.stringify(c));
  assert.deepEqual(cuts, [...cuts].sort((a, b) => a.t - b.t));
  const n = await openPage(card, { scene: 'scene.js' });
  assert.deepEqual(await n.page.evaluate(() => window.INFO.ENERGY), { name: 'normal', from: 'board.js', bpm: 116 });
  assert.ok((await n.page.evaluate(() => window.sceneCuts())).length >= 2);
  // a scene without cuts(), and one whose cut is longer than 0.3 s
  const dir = makePiece('energy-cuts', 'fixture-clean');
  fs.writeFileSync(P(dir, 'cut.js'), `export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 2, FONTS: [] };
export const TL = {};
export const silent = true;
export function init() {}
export const cuts = () => [{ t: 1, d: 0.5 }];
export function frame(t, jit) { return { t, jit, use2D: false, scene: 0, P: [0, 0, 0, 0], Q: [0, 0, 0, 0], R: [0, 0, 0, 0], cam: [1, 0, 0, 0], clear: [0, 0, 0] }; }
export const post = (t) => ({ t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 });
`);
  const a = await openPage(dir, { scene: 'scene.js' });
  assert.equal(await a.page.evaluate(() => window.sceneCuts()), null, 'no cuts() is null, not an empty list');
  const b = await openPage(dir, { scene: 'cut.js' });
  assert.match(await b.page.evaluate(() => { try { window.sceneCuts(); return 'no error'; } catch (e) { return e.message; } }), /cut\.js: cuts\(\) item 0 .*d from 0 to 0\.3 s/);
});

test('P11b the energy reaches init and audio.js, and a CFG.ENERGY that disagrees with the board\'s stops the render', () => {
  const dir = makePiece('energy-cfg', 'fixture-clean');
  fs.copyFileSync(path.join(templateDir, 'board.js'), P(dir, 'board.js'));   // energy: 'normal'
  const scene = (energy) => `import { boardDur } from './lib.js';
export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: [], ENERGY: ${JSON.stringify(energy)} };
export const TL = {};
export function init({ energy }) { console.log('init energy', energy.name, energy.bpm, energy.from, energy.cutBeats.join('-')); }
export function frame(t, jit) { return { t, jit, use2D: false, scene: 0, P: [0, 0, 0, 0], Q: [0, 0, 0, 0], R: [0, 0, 0, 0], cam: [1, 0, 0, 0], clear: [0.2, 0.2, 0.2] }; }
export const post = (t) => ({ t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 });
`;
  fs.writeFileSync(P(dir, 'e.js'), scene('extreme'));
  fs.writeFileSync(P(dir, 'audio.js'), `export async function renderAudio({ CFG, dur = CFG.DUR, sr = 48000, energy }) { console.log('audio energy', energy.name); return new OfflineAudioContext(2, Math.ceil(sr * dur), sr).startRendering(); }\n`);
  let r = render(dir, ['audio', '--scene', 'e.js', '--out', 'out/e.wav'], { allowFail: true });
  assert.equal(r.status, 1); assert.match(r.out, /CFG\.ENERGY "extreme" and board\.js's energy "normal" disagree: name the energy in one place/);
  r = render(dir, ['audio', '--scene', 'e.js', '--param', 'energy=subtle', '--out', 'out/e.wav']);   // a param settles it
  assert.match(r.out, /init energy subtle 84 --param 4-5/); assert.match(r.out, /audio energy subtle/);
  fs.writeFileSync(P(dir, 'e.js'), scene('normal'));
  r = render(dir, ['audio', '--scene', 'e.js', '--out', 'out/e.wav']);
  assert.match(r.out, /init energy normal 116 CFG\.ENERGY 2-3/);
  assert.ok(!fs.existsSync(P(dir, 'out/e.bed.wav')), 'an audio.js with no renderBed writes no bed stem');
});

test('P11b a clip\'s captions take their style from the energy every scene gets: --param, else the board\'s, else normal', async () => {
  const dir = makePiece('energy-caption', 'fixture-clean');
  fs.writeFileSync(P(dir, 'clip.js'), 'export const CLIP = { file: "clip.mp4", w: 540, h: 960, fps: 30, fpsRational: "30/1", frames: 30, dur: 1 };\n');
  const board = (extra) => fs.writeFileSync(P(dir, 'board.js'), `export const BOARD = { title: 'c', target: 'tiktok', ${extra} beats: [{ id: 'clip', dur: 1, on: [] }] };\n`);
  const style = async (q) => { const { page, ready } = await openPage(dir, { scene: 'caption.js', ...q }); assert.equal(ready, null); return page.evaluate(() => import('./caption.js').then((m) => m.TL.style)); };
  board('');
  assert.equal(await style({}), 'pop', 'no energy anywhere: normal');
  assert.equal(await style({ 'p.energy': 'subtle' }), 'minimal');
  board(`energy: 'extreme',`);
  assert.equal(await style({}), 'karaoke', 'the board\'s energy');
  assert.equal(await style({ 'p.energy': 'subtle' }), 'minimal', '--param over the board');
  assert.equal(await style({ 'p.style': 'boxed' }), 'boxed', 'a named style over the energy');
});
