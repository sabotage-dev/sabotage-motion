// The template card on every look at every energy (plan 23.9; the owner's "fix the card first" before 0.2.0): its
// source check is 0 FAIL and 0 WARN, and energy_match reads it as the energy it states, inside that preset's ranges.
// On a light or flat ground the card's cuts and motion come from contrast (its accent panel, moved on every cut, with
// stripes close to the accent scrolling inside it), not from the ground's own stripes, which keep within a flash-safe
// tone of the ground. The renders, check --file and flash for each cell run on a Mac before a release
// (references/check.md section 6); here, the source check at check's own probe, two cells at a time.
// The cells run in three CI shards, one per energy (test/card-looks-<energy>.test.mjs): on Ubuntu's SwiftShader a cell
// takes about a minute, and the 24 cells and the legibility pages together ran past a job's 30 minutes in one shard.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { repoRoot, templateDir } from './helpers.mjs';

const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
const C = await import(pathToFileURL(path.join(templateDir, 'check.mjs')).href);
const { ENERGY } = await import(pathToFileURL(path.join(templateDir, 'energy.js')).href);
export const LOOKS = Object.keys(LK.LOOKS);

// one piece per shard: the template as it ships, with every look's fonts copied in (as the skill tells the agent to)
let dir = null;
export function piece(name) {
  dir = path.join(repoRoot, 'test', '.work', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(templateDir, dir, { recursive: true, filter: (s) => !s.split(path.sep).includes('node_modules') });
  for (const look of LOOKS) for (const f of LK.lookFiles(look)) fs.copyFileSync(path.join(templateDir, '..', 'looks', 'fonts', f), path.join(dir, 'fonts', f));
  return dir;
}

function check(energy, look) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['render.mjs', 'check', '--param', `energy=${energy}`, '--param', `look=${look}`, '--json'], { cwd: dir });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (status) => { let results = null; try { results = JSON.parse(out); } catch { /* reported */ } resolve({ status, results, err }); });
  });
}
// the cells, two at a time
async function all(cells, n = 2) {
  const out = new Array(cells.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < cells.length) { const i = next++; out[i] = await check(...cells[i]); } }));
  return out;
}

export const matrix = (energy) => test(`the template card on all 8 looks at ${energy}: energy_match reads its energy, inside the preset's ranges, and check has no FAIL or WARN`, async () => {
  const cells = LOOKS.map((l) => [energy, l]);
  const res = await all(cells), bad = [], table = [];
  res.forEach((r, i) => {
    const [e, l] = cells[i], tag = `${e}/${l}`;
    if (!r.results) { bad.push(`${tag}: check did not run (${r.err.trim().split('\n').pop()})`); return; }
    const issues = r.results.filter((x) => x.level === 'FAIL' || x.level === 'WARN').map((x) => `${x.level} ${x.id}: ${x.detail}`);
    const em = r.results.find((x) => x.id === 'energy_match'), m = (em && em.measured) || {}, P = ENERGY[e], spb = 60 / P.bpm;
    if (!em || em.level !== 'OK') issues.push(`energy_match ${em ? em.level : 'missing'}: ${em ? em.detail : ''}`);
    else {
      const inside = (x, [lo, hi], what) => { if (!(x >= lo - 1e-3 && x <= hi + 1e-3)) issues.push(`${what} ${x} outside ${lo}-${hi}`); };
      inside(m.shot, [P.cutBeats[0] * spb, P.cutBeats[1] * spb], 'mean shot (s)');
      inside(m.type, P.inkHeight, 'largest line');
      inside(m.motion, [P.motion.min ?? 0, P.motion.max ?? 1], 'motion');
      // every cut reads with room to spare: it changes at least twice the share of the frame a cut needs (the panel
      // moving does that; a new angle of its stripes alone would scrape past on some looks)
      const low = (m.shares || []).filter((x) => x < 2 * C.T.energy.cut.share);
      if (low.length) issues.push(`cuts that change under ${2 * C.T.energy.cut.share * 100}% of the frame: ${low.join(', ')}`);
    }
    table.push(`${tag} cuts ${m.cuts} shot ${m.shot} type ${m.type} motion ${m.motion}`);
    if (issues.length) bad.push(`${tag}: ${issues.join('; ')}`);
  });
  assert.deepEqual(bad, [], `${bad.length} of ${cells.length} cells:\n${bad.join('\n')}\n(all: ${table.join(' | ')})`);
});

// ---- the page: a static server for the piece and a page on it, with render.mjs's Chrome flags
let browser = null, server = null;
async function openPage(query) {
  if (!server) {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2' };
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/__exists') { const f = path.join(dir, url.searchParams.get('path') || ''); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ exists: fs.existsSync(f) && fs.statSync(f).isFile() })); }
      const f = path.join(dir, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname));
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const gpu = process.env.SM_GPU_ARGS != null ? process.env.SM_GPU_ARGS.split(/\s+/).filter(Boolean)
      : process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
    browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true,
      args: [...gpu, '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  }
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?${new URLSearchParams({ scale: String(C.T.probeScale), sub: '1', scene: 'scene.js', ...query })}`);
  const ready = await page.evaluate(() => window.ready.then(() => null, (e) => e.message));
  return { page, ready };
}
after(async () => { if (browser) await browser.close(); if (server) server.close(); });

// Type over the panel is drawn in the ground's colour, so it reads there as well as on the ground: on every look at normal
// and extreme, the parts of the text boxes that lie over the panel have ink (energy_match's own ink pass, on those parts
// alone), through normal's iris too, where the panel shows as two masks (the one before outside the circle, the next
// inside it: parts certainly inside, in the circle's inscribed square, and certainly outside, beyond its bounding
// square). On mono, ink and accent are both white: without the recolour, type over the panel would vanish.
// The parts of box b (design px) over mask m that the panel certainly covers: [{ x, y, w, h }]
function overMask(b, m) {
  const cut = (r, s) => { const x0 = Math.max(r.x, s.x), y0 = Math.max(r.y, s.y), x1 = Math.min(r.x + r.w, s.x + s.w), y1 = Math.min(r.y + r.h, s.y + s.h); return x1 - x0 > 8 && y1 - y0 > 8 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null; };
  const base = cut(b, m);
  if (!base) return [];
  if (m.inside) { const c = m.inside, h = c.r / Math.SQRT2; return [cut(base, { x: c.x - h, y: c.y - h, w: 2 * h, h: 2 * h })].filter(Boolean); }
  if (m.outside) {
    const c = m.outside, big = 1e6;
    return [{ x: -big, y: -big, w: 2 * big, h: c.y - c.r + big }, { x: -big, y: c.y + c.r, w: 2 * big, h: big }, { x: -big, y: -big, w: c.x - c.r + big, h: 2 * big }, { x: c.x + c.r, y: -big, w: big, h: 2 * big }]
      .map((s) => cut(base, s)).filter(Boolean);
  }
  return [base];
}
export const legible = (energy) => test(`the template card on all 8 looks at ${energy}: type over the accent panel is legible (it has ink there)${energy === 'normal' ? ', through the iris too' : ''}`, async () => {
  const ink = C.T.energy.ink, bad = [], seen = [];
  for (const look of LOOKS) {
    const { page, ready } = await openPage({ 'p.energy': energy, 'p.look': look });
    if (ready) { bad.push(`${energy}/${look}: the page did not load (${ready})`); await page.close(); continue; }
    const I = await page.evaluate(() => ({ W: window.INFO.W, H: window.INFO.H, RW: window.INFO.RW, RH: window.INFO.RH, FPS: window.INFO.FPS }));
    // every frame's text boxes cut to where the panel certainly shows (design px, before the camera), as boxes
    // energyRects maps; an iris part is reported under its own id
    const raw = await page.evaluate(async () => {
      const m = await import('./scene.js');
      return window.energyBoxes().map((fr) => ({ ...fr, masks: m.panelMasks(fr.f / window.INFO.FPS + 0.25 / window.INFO.FPS) }));
    });
    const frames = raw.map((fr) => ({ ...fr, boxes: fr.boxes.filter((b) => !b.deco).flatMap((b) => fr.masks.flatMap((m) =>
      overMask(b, m).map((r) => ({ id: `${b.id}${m.inside ? ':iris in' : m.outside ? ':iris out' : ''}`, text: b.text, ...r })))) })).filter((fr) => fr.boxes.length);
    if (energy === 'normal' && !frames.some((fr) => fr.boxes.some((b) => b.id.includes(':iris')))) bad.push(`${energy}/${look}: no text over the panel in the iris (the test sees none of it)`);
    const rects = C.energyRects(frames, I.W, I.H, I.RW, I.RH);
    const scan = await page.evaluate((o) => window.energyScan(o), { pairs: [], rects: Object.fromEntries(Object.entries(rects).map(([f, l]) => [f, l.map((b) => b.r)])), inkDelta: ink.delta, inkRel: ink.rel });
    // per box id, the probe frames where its part over the panel has ink
    const parts = new Map();
    for (const [f, list] of Object.entries(rects)) list.forEach((b, i) => {
      const p = parts.get(b.id) || { text: b.text, frames: 0, inked: 0 };
      p.frames++; if (scan.ink[f][i].some((n) => n >= ink.px)) p.inked++;
      parts.set(b.id, p);
    });
    if (!parts.size) bad.push(`${energy}/${look}: no text ever lies over the panel (the test sees nothing)`);
    for (const [id, p] of parts) { seen.push(`${energy}/${look} ${id} ${p.inked}/${p.frames}`); if (p.inked < Math.ceil(p.frames / 2)) bad.push(`${energy}/${look}: "${p.text}" (${id}) over the panel has ink in ${p.inked} of ${p.frames} frames`); }
    await page.close();
  }
  assert.deepEqual(bad, [], `${bad.join('\n')}\n(all: ${seen.join(' | ')})`);
});

// The flash limit holds on the tightest extreme cells, rendered and read as files (check --file): brutalist (the most
// too fast of all, 18,874 px of 21,824, on a Mac) and neon (its bloom; its glitch on every sixth cut: on every third it
// is 23,465 px, over the limit)
export const flashCells = () => test('the template card at extreme on brutalist and neon passes flash as a file', () => {
  const out = [];
  for (const look of ['brutalist', 'neon']) {
    const file = `out/flash-${look}.mp4`;
    const r = spawnSync(process.execPath, ['render.mjs', 'video', '--param', 'energy=extreme', '--param', `look=${look}`, '--scale', '0.25', '--sub', '2', '--out', file], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const c = spawnSync(process.execPath, ['render.mjs', 'check', '--file', file, '--only', 'flash', '--json'], { cwd: dir, encoding: 'utf8' });
    const f = JSON.parse(c.stdout).find((x) => x.id === 'flash');
    out.push(`${look}: ${f.level} ${f.detail}`);
    assert.equal(f.level, 'OK', `${look} at extreme: ${f.detail}`);
  }
});
