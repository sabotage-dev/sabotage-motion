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
import { pathToFileURL } from 'node:url';

const { ENERGY } = await import(pathToFileURL(path.join(templateDir, 'energy.js')).href);
const C = await import(pathToFileURL(path.join(templateDir, 'check.mjs')).href);

const P = (dir, f) => path.join(dir, f);
const ok = (r) => assert.equal(r.status, 0, r.out);
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const LEN = { subtle: 5 * 60 / 84, normal: 7 * 60 / 116, extreme: 7 * 60 / 136 };
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
      if (args.includes('--file')) continue;
      // the acceptance cross-check (23.9): energy_match measures the card and finds it inside its preset's ranges
      const em = res.find((x) => x.id === 'energy_match'), m = em.measured, PR = ENERGY[e], spb = 60 / PR.bpm;
      assert.equal(em.level, 'OK', em.detail);
      const inside = (x, [lo, hi], what) => assert.ok(x >= lo - 1e-3 && x <= hi + 1e-3, `${e}: ${what} ${x} is outside ${lo}-${hi}: ${em.detail}`);
      inside(m.shot, [PR.cutBeats[0] * spb, PR.cutBeats[1] * spb], 'the mean shot (s)');
      inside(m.type, PR.inkHeight, 'the largest line');
      inside(m.motion, [PR.motion.min ?? 0, PR.motion.max ?? 1], 'the motion');
      assert.equal(m.cuts, { subtle: 0, normal: 2, extreme: 11 }[e], `${e}: every declared cut confirmed`);
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

test('P11b check --file: a bed stem from `audio` with the picture\'s settings passes provenance; a master holding one from other settings fails it', () => {
  const dir = path.join(work, 'energy-prov');
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(card, dir, { recursive: true });
  // `audio` writes the effects and the bed stem with their own records
  render(dir, ['audio', '--param', 'energy=normal', '--out', 'out/card-normal.wav']);
  const ar = json(P(dir, 'out/card-normal.bed.wav.render.json'));
  assert.deepEqual([ar.role, ar.mode, ar.audioSha256], ['bed', 'audio', sha256File(P(dir, 'out/card-normal.bed.wav'))]);
  ok(runMix(dir, ['card-normal', '--master-only']));
  let r = render(dir, ['check', '--file', 'out/card-normal-final.mp4', '--only', 'provenance', '--json'], { allowFail: true });
  assert.equal(JSON.parse(r.stdout).find((x) => x.id === 'provenance').level, 'OK');
  // at another energy they are other stems. The mix refuses that bed (round 2, H3, below), so a master holding one was
  // made another way (by hand, or by a mix from before H3): its master.json names the stems now on disk
  render(dir, ['audio', '--param', 'energy=extreme', '--out', 'out/card-normal.wav']);
  const mjF = P(dir, 'out/card-normal.master.json'), mj = json(mjF);
  for (const [role, f] of [['effects', 'out/card-normal.wav'], ['bed', 'out/card-normal.bed.wav']]) mj.stems.find((x) => x.role === role).sha256 = sha256File(P(dir, f));
  fs.writeFileSync(mjF, JSON.stringify(mj, null, 2) + '\n');
  r = render(dir, ['check', '--file', 'out/card-normal-final.mp4', '--only', 'provenance', '--json'], { allowFail: true });
  const p = JSON.parse(r.stdout).find((x) => x.id === 'provenance');
  assert.equal(p.level, 'FAIL'); assert.match(p.detail, /the bed stem out\/card-normal\.bed\.wav was rendered with other settings than the picture/);
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
    // render.mjs's own flags (SM_GPU_ARGS replaces the GPU ones there too), so the page draws as a render's does
    const gpu = process.env.SM_GPU_ARGS != null ? process.env.SM_GPU_ARGS.split(/\s+/).filter(Boolean)
      : process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
    browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true,
      args: [...gpu, '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  }
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${new URLSearchParams({ scale: '0.25', sub: '1', ...query })}`);
  const ready = await page.evaluate(() => window.ready.then(() => null, (e) => e.message));
  return { page, ready, errors };
}
after(async () => { if (browser) await browser.close(); for (const s of servers) s.close(); });

// The extreme card's "IT" slam is the largest text the suite draws: at check's probe scale (1/2) its glyphs are over
// 256 px, where Skia stops using its glyph atlas and draws them as paths. CI on Linux (Chrome on SwiftShader) found no
// ink in its box. This renders that slam at check's probe scale with render.mjs's flags and asks energy_match's own
// ink pass for it; on failure it says whether the word was drawn at all, where, and with what font.
test('P11b the extreme card\'s largest slam ("IT", glyphs over 256 px at the probe scale) is drawn, and energy_match finds its ink', async () => {
  const { page, ready } = await openPage(card, { scene: 'scene.js', 'p.energy': 'extreme', scale: String(C.T.probeScale) });
  assert.equal(ready, null);
  const I = await page.evaluate(() => ({ W: window.INFO.W, H: window.INFO.H, RW: window.INFO.RW, RH: window.INFO.RH, FPS: window.INFO.FPS }));
  const frames = await page.evaluate(() => window.energyBoxes());
  const rects = C.energyRects(frames, I.W, I.H, I.RW, I.RH);
  const fs1 = Object.keys(rects).map(Number).filter((k) => rects[k].some((x) => x.id === 'solo1')).sort((x, y) => x - y);
  assert.ok(fs1.length > 3, `the "IT" slam (solo1) has boxes in ${fs1.length} probe frames`);
  const mine = Object.fromEntries(fs1.map((k) => [k, [rects[k].find((x) => x.id === 'solo1').r]]));
  const scan = await page.evaluate((o) => window.energyScan(o), { pairs: [], rects: mine, inkDelta: C.T.energy.ink.delta, inkRel: C.T.energy.ink.rel });
  // per frame: the tallest run of inked rows in IT's box, as energy_match counts a line
  const run = (rows) => { let best = 0, cur = 0; for (const n of rows) { cur = n >= C.T.energy.ink.px ? cur + 1 : 0; best = Math.max(best, cur); } return best; };
  const per = fs1.map((k) => ({ f: k, rect: mine[k][0], line: run(scan.ink[k][0]) })), tallest = Math.max(...per.map((x) => x.line));
  const mid = fs1[Math.floor(fs1.length / 2)];
  const diag = async () => JSON.stringify({ per, ...(await page.evaluate(({ f, r }) => {
    const p = window.renderProbe(f / window.INFO.FPS, { rgb: true }), { RW, RH } = window.INFO;
    let max = 0, sum = 0, cnt = 0;
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) { const l = p.luma[y * RW + x]; max = Math.max(max, l); sum += l; cnt++; }
    const map = [];
    for (let y = 0; y < RH; y += 16) { let row = ''; for (let x = 0; x < RW; x += 10) { const l = p.luma[y * RW + x], ib = x >= r[0] && x < r[2] && y >= r[1] && y < r[3]; row += l >= 160 ? (ib ? '#' : '@') : l >= 90 ? (ib ? '=' : '-') : ib ? '+' : '.'; } map.push(row); }
    const g = document.createElement('canvas').getContext('webgl2'), dbg = g && g.getExtension('WEBGL_debug_renderer_info');
    return { mid: f, lumaInBox: { max, mean: +(sum / Math.max(1, cnt)).toFixed(1) }, renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      fonts: [...document.fonts].map((x) => `${x.family}:${x.status}`), map };
  }, { f: mid, r: mine[mid][0] })) });
  assert.ok(tallest >= ENERGY.extreme.inkHeight[0] * I.RH, `"IT" (solo1): its tallest inked line is ${tallest} of ${I.RH} probe rows, under extreme's ${ENERGY.extreme.inkHeight[0] * 100}%; ${await diag()}`);
});

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
  // and the clip's board keeps its length: a clip's board never snaps to the grid, whatever energy it names
  const { page } = await openPage(dir, { scene: 'caption.js' });
  assert.equal(await page.evaluate(() => import('./lib.js').then((m) => m.boardInfo().dur)), 1);
  assert.equal(await style({ 'p.energy': 'subtle' }), 'minimal', '--param over the board');
  assert.equal(await style({ 'p.style': 'boxed' }), 'boxed', 'a named style over the energy');
});

test('P11b bed: false at subtle writes a silent bed stem, recorded as silent; rendered at another energy, that energy\'s bed plays', () => {
  const dir = path.join(work, 'energy-quiet');
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(card, dir, { recursive: true });
  const board = fs.readFileSync(P(dir, 'board.js'), 'utf8').replace("energy: 'normal',", "energy: 'subtle', bed: false,");
  assert.notEqual(board, fs.readFileSync(P(dir, 'board.js'), 'utf8'), 'the template board names its energy');
  fs.writeFileSync(P(dir, 'board.js'), board);
  const r = render(dir, ['audio', '--out', 'out/q.wav']);
  assert.match(r.out, /bed: silent \(subtle, the board's bed: false\)/);
  const rec = json(P(dir, 'out/q.bed.wav.render.json'));
  assert.deepEqual([rec.role, rec.bedSilent, rec.energy.name], ['bed', true, 'subtle']);
  const bed = decode(P(dir, 'out/q.bed.wav'));
  assert.ok(bed.length > SR && bed.every((x) => x === 0), 'the bed stem is silence, the picture\'s length');
  const n = render(dir, ['audio', '--param', 'energy=normal', '--out', 'out/n.wav']);
  assert.match(n.out, /bed: normal at 116 BPM/);
  assert.equal(json(P(dir, 'out/n.bed.wav.render.json')).bedSilent, false);
  assert.ok(decode(P(dir, 'out/n.bed.wav')).some((x) => Math.abs(x) > 0.05), 'the normal bed plays');
});

// ---------------------------------------------------------------- council round 1 (P11b R1)
// G1: audio_spike hears what the master mixes: each stem at the gain master.json records for it, a stem the mix left
// out at zero. fixture-heard's stems judge differently alone and summed: with stems=a the effects spike alone and the
// bed masks them; with stems=b the bed has a click and the effects would mask it.
const spikeOf = (dir, file) => {
  const r = render(dir, ['check', '--file', file, '--only', 'audio_spike', '--json'], { allowFail: true });
  const x = JSON.parse(r.stdout).find((y) => y.id === 'audio_spike');
  assert.ok(x, r.out); return x;
};
const heard = {};
function heardPiece(s) {   // one piece per set of stems, rendered once
  if (heard[s]) return heard[s];
  const d = makePiece(`energy-heard-${s}`, 'fixture-heard');
  fs.writeFileSync(P(d, 'vo.wav'), monoWav(toneBursts(1.0, [[0.1, 0.3]])));   // the voice first: it is part of the source
  writeCues(d, { VO_OFFSET: 0.1, CUE: { a: 0.1 } });
  render(d, ['full', '--param', `stems=${s}`, '--scale', '0.25', '--sub', '1', '--out', 'out/h.mp4']);
  return (heard[s] = d);
}
const mixedSpike = (s, args) => { const d = heardPiece(s); ok(runMix(d, ['h', ...args])); return spikeOf(d, 'out/h-final.mp4'); };
test('P11b R1 G1 --master-only with both stems: the effects at x1 and the bed at x0.5, the bed masking the hit', () => {
  const x = mixedSpike('a', ['--master-only']);
  assert.equal(x.level, 'OK', x.detail); assert.match(x.detail, /the effects \(x1\) and the bed stem \(x0\.5\)/);
});
test('P11b R1 G1 --master-only --no-bed: the bed is not heard, so the hit alone is a spike', () => {
  const x = mixedSpike('a', ['--master-only', '--no-bed']);
  assert.equal(x.level, 'WARN', x.detail); assert.doesNotMatch(x.detail, /bed stem/);
});
test('P11b R1 G1 --sting: the effects alone, so the hit is a spike', () => {
  const x = mixedSpike('a', ['--sting']);
  assert.equal(x.level, 'WARN', x.detail); assert.doesNotMatch(x.detail, /bed stem/);
});
test('P11b R1 G1 a voiced mix with --no-bed: the effects at x0.9 alone, a spike', () => {
  const x = mixedSpike('a', ['--no-bed']);
  assert.equal(x.level, 'WARN', x.detail); assert.match(x.detail, /the effects stem \(x0\.9, as h\.master\.json mixed it\)/); assert.doesNotMatch(x.detail, /bed stem/);
});
test('P11b R1 G1 a voiced mix with its bed: the effects at x0.9 and the bed at x0.22', () => {
  const x = mixedSpike('a', []);
  assert.equal(x.level, 'OK', x.detail); assert.match(x.detail, /the effects \(x0\.9\) and the bed stem \(x0\.22\)/);
});
test('P11b R1 G1 --master-only --no-sfx: the effects are not heard, so the bed\'s click is a spike they no longer mask', () => {
  let x = mixedSpike('b', ['--master-only', '--no-sfx']);
  assert.equal(x.level, 'WARN', x.detail); assert.doesNotMatch(x.detail, /the effects/);
  x = mixedSpike('b', ['--master-only']);
  assert.equal(x.level, 'OK', x.detail);
});
test('P11b R1 G1 a mix of neither stem (voiced, --no-sfx --no-bed): nothing of theirs to hear', () => {
  const x = mixedSpike('b', ['--no-sfx', '--no-bed']);
  assert.equal(x.level, 'OK', x.detail); assert.match(x.detail, /mixes neither the effects nor the bed stem/);
});

// ---------------------------------------------------------------- council round 2 (P11b R2)
// H1: a stem heard alone is heard at its gain, as the two summed are: audio_spike's silence floor (a window counts when
// it peaks above -60 dBFS) is absolute, so a gain moves windows across it. fixture-heard's stems=c and d sit at the edge.
test('P11b R2 H1 the effects alone at x0.9 (voiced, --no-bed): a 0.00105 floor falls under -60 dBFS, so the hit is no spike', () => {
  const x = mixedSpike('c', ['--no-bed']);
  assert.equal(x.level, 'OK', x.detail); assert.match(x.detail, /the effects stem \(x0\.9, as h\.master\.json mixed it\)/);
});
test('P11b R2 H1 the effects alone at x2 (--master-only --no-bed --sfx-gain 2): a 0.0009 floor rises over -60 dBFS, so the hit is a spike', () => {
  const x = mixedSpike('d', ['--master-only', '--no-bed', '--sfx-gain', '2']);
  assert.equal(x.level, 'WARN', x.detail); assert.match(x.detail, /the effects stem \(x2, as h\.master\.json mixed it\)/);
});
test('P11b R2 H1 the bed stem alone at x0.5 (--master-only --no-sfx): a 0.0019 floor falls under -60 dBFS, so its hit is no spike', () => {
  const x = mixedSpike('c', ['--master-only', '--no-sfx']);
  assert.equal(x.level, 'OK', x.detail); assert.match(x.detail, /the bed stem \(x0\.5\) alone/);
});
// H2: the bed is heard with the --mute windows master.json records (the bed stem has no fade: it spans the picture)
test('P11b R2 H2 a bed muted around the hit no longer masks it: audio_spike hears the mutes master.json records', () => {
  const x = mixedSpike('a', ['--master-only', '--mute', '0.1-1.95']);
  assert.deepEqual(json(P(heardPiece('a'), 'out/h.master.json')).stems.find((y) => y.role === 'bed').mutes, [{ a: 0.1, b: 1.95, ramp: 0.05 }]);
  assert.equal(x.level, 'WARN', x.detail); assert.match(x.detail, /the effects \(x1\) and the bed stem \(x0\.5, muted 0\.1-1\.95\) summed/);
  assert.equal(mixedSpike('a', ['--master-only']).level, 'OK', 'unmuted, the bed masks it');
});
// H3, and the bed's own record: a bed stem from `audio` is taken only when it is still what that render wrote, from the
// picture's source, at the picture's params and energy
function sepBed(name) {
  const dir = path.join(work, name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(card, dir, { recursive: true });
  for (const f of fs.readdirSync(P(dir, 'out'))) fs.rmSync(P(dir, `out/${f}`), { force: true });
  render(dir, ['video', ...R, '--out', 'out/s.mp4']);   // the board's energy, normal, and no params
  return dir;
}
test('P11b R2 H3 the mix refuses a bed stem rendered by `audio` at other params or another energy than the picture', () => {
  const dir = sepBed('energy-r2-settings');
  render(dir, ['audio', '--param', 'energy=extreme', '--out', 'out/s.wav']);
  let r = runMix(dir, ['s', '--master-only']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /the bed stem out\/s\.bed\.wav was rendered with other settings than out\/s\.mp4 \(params \{"energy":"extreme"\}, the picture's \{\}; energy extreme at 136 BPM, the picture's normal at 116 BPM\)/);
  render(dir, ['audio', '--out', 'out/s.wav']);           // the picture's own settings
  ok(runMix(dir, ['s', '--master-only']));
  // a `full` render's bed, replaced by one from `audio` at another energy: refused as well
  render(dir, ['full', ...R, '--out', 'out/f.mp4']);
  render(dir, ['audio', '--param', 'energy=subtle', '--out', 'out/f.wav']);
  r = runMix(dir, ['f', '--master-only']);
  assert.equal(r.status, 1, r.out); assert.match(r.out, /the bed stem out\/f\.bed\.wav was rendered with other settings than out\/f\.mp4 \(params \{"energy":"subtle"\}, the picture's \{\}; energy subtle at 84 BPM, the picture's normal at 116 BPM\)/);
});
test('P11b R2 a bed stem from `audio` that changed after that render is refused', () => {
  const dir = sepBed('energy-r2-changed');
  render(dir, ['audio', '--out', 'out/s.wav']);
  const f = P(dir, 'out/s.bed.wav'), b = fs.readFileSync(f);
  b[b.length - 2] ^= 0x40; fs.writeFileSync(f, b);         // one sample, after the render recorded its SHA-256
  const r = runMix(dir, ['s', '--master-only']);
  assert.equal(r.status, 1, r.out); assert.match(r.out, /the bed stem out\/s\.bed\.wav changed after the render \(audio\) that wrote it/);
});

// G2: a bed stem rendered on its own (`audio`, with its own record) and then lost or left stale is refused by the mix,
// not quietly left out or replaced by bed.mp3.
test('P11b R1 G2 a bed stem from `audio` that is missing, or from another source than the picture, is refused; never left out or replaced by bed.mp3', () => {
  const dir = path.join(work, 'energy-sepbed');
  fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(card, dir, { recursive: true });
  for (const f of fs.readdirSync(P(dir, 'out'))) fs.rmSync(P(dir, `out/${f}`), { force: true });
  fs.writeFileSync(P(dir, 'vo.wav'), monoWav(toneBursts(1.0, [[0.1, 0.3]])));   // for the voiced mix below; source, so first
  writeCues(dir, { VO_OFFSET: 0.1, CUE: { a: 0.1 } });
  render(dir, ['video', ...R, '--out', 'out/s.mp4']);
  render(dir, ['audio', '--out', 'out/s.wav']);
  assert.ok(fs.existsSync(P(dir, 'out/s.bed.wav.render.json')), 'audio recorded the bed on its own');
  assert.equal(json(P(dir, 'out/s.mp4.render.json')).bed, undefined, 'the picture\'s record names no bed');
  ok(runMix(dir, ['s', '--master-only']));
  assert.ok(json(P(dir, 'out/s.master.json')).stems.some((x) => x.role === 'bed' && x.generated), 'mixed with its bed');
  const keep = fs.readFileSync(P(dir, 'out/s.bed.wav'));
  fs.rmSync(P(dir, 'out/s.bed.wav'));
  let r = runMix(dir, ['s', '--master-only']);
  assert.equal(r.status, 1, r.out); assert.match(r.out, /the bed stem out\/s\.bed\.wav that render\.mjs audio recorded is missing/);
  // a voiced mix does not fall back to bed.mp3 either
  fs.writeFileSync(P(dir, 'bed.mp3'), keep);   // any audio file under that name
  r = runMix(dir, ['s']);
  assert.equal(r.status, 1, r.out); assert.match(r.out, /that render\.mjs audio recorded is missing/);
  ok(runMix(dir, ['s', '--no-bed']));
  fs.rmSync(P(dir, 'bed.mp3'));
  // stale: the bed rendered from an older source than the picture
  fs.writeFileSync(P(dir, 'out/s.bed.wav'), keep);
  ok(runMix(dir, ['s', '--master-only']));
  fs.appendFileSync(P(dir, 'scene.js'), '\n// a later edit\n');
  render(dir, ['video', ...R, '--out', 'out/s.mp4']);
  r = runMix(dir, ['s', '--master-only']);
  assert.equal(r.status, 1, r.out); assert.match(r.out, /the bed stem out\/s\.bed\.wav was rendered from another source than out\/s\.mp4/);
});

// G3: the energy in effect sets the grid wherever it was chosen (--param, CFG.ENERGY, the board); a silent board with
// no energy anywhere keeps its written lengths.
test('P11b R1 G3 a silent board snaps to the energy chosen by --param or CFG.ENERGY, though it names none; with none anywhere it keeps its lengths', () => {
  const dir = makePiece('energy-snap-any', 'fixture-clean');
  for (const f of ['scene.js', 'audio.js']) fs.copyFileSync(path.join(templateDir, f), P(dir, f));
  const board = fs.readFileSync(path.join(templateDir, 'board.js'), 'utf8').replace(/^  energy: 'normal',.*\n/m, '');
  assert.doesNotMatch(board, /^\s*energy:/m);
  fs.writeFileSync(P(dir, 'board.js'), board);   // title 2.85 s, out 0.55 s: 3.4 s as written
  const frames = (args, out) => { render(dir, ['video', ...args, '--scale', '0.25', '--sub', '1', '--out', out]); return countFrames(P(dir, out)); };
  assert.equal(frames([], 'out/none.mp4'), Math.round(3.4 * 30), 'no energy anywhere: the written lengths');
  assert.equal(frames(['--param', 'energy=subtle'], 'out/p.mp4'), Math.round((5 * 60 / 84) * 30), '--param energy=subtle: five beats at 84 BPM');
  // CFG.ENERGY in a scene: the same scene, naming its energy in CFG
  const cfg = fs.readFileSync(path.join(templateDir, 'scene.js'), 'utf8').replace("export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY'] };",
    "export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY'], ENERGY: 'subtle' };");
  assert.match(cfg, /ENERGY: 'subtle'/);
  fs.writeFileSync(P(dir, 'cfg.js'), cfg);
  assert.equal(frames(['--scene', 'cfg.js'], 'out/c.mp4'), Math.round((5 * 60 / 84) * 30), 'CFG.ENERGY subtle: five beats at 84 BPM');
  // check times the board the way the page does
  const r = render(dir, ['check', '--scene', 'cfg.js', '--only', 'board_order', '--json'], { allowFail: true });
  assert.equal(JSON.parse(r.stdout).find((x) => x.id === 'board_order').level, 'OK', r.out);
});
