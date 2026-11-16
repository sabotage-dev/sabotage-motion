// The repo-launch example's wires (plan 23.4): its brand.json is the kit tools/repo-scan.mjs drafts from its fixture,
// unchanged; that kit is far from every look's colours, so the colour match means something; its screenshot is the
// page tools/shots.mjs takes of the fixture's app; the scene draws with the kit (its faces, its logo) and passes the
// colour match. examples-check.test.mjs runs `check` on it with the other examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { examplesDir, repoRoot, templateDir } from './helpers.mjs';

const dir = path.join(examplesDir, 'repo-launch');
const S = await import(pathToFileURL(path.join(dir, 'tools', 'repo-scan.mjs')).href);
const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
const C = await import(pathToFileURL(path.join(templateDir, 'check.mjs')).href);
const kit = JSON.parse(fs.readFileSync(path.join(dir, 'brand.json'), 'utf8'));

test('repo-launch: brand.json is the draft the scan writes for fixture/, unchanged, and it passes doctor\'s rules', () => {
  const scan = S.scanRepo('fixture', { cwd: dir, kitDir: dir });
  assert.deepEqual(kit, scan.brand.kit);
  assert.deepEqual(LK.brandProblems(kit, (f) => fs.existsSync(path.join(dir, f))), []);
  assert.deepEqual(Object.keys(kit.colors), LK.TOKENS, 'the scan named all six tokens');
  assert.deepEqual([kit.fonts.display.family, kit.fonts.body.family], ['Snagwick Display', 'Snagwick Text']);
  assert.equal(scan.install.value, 'npm install -g snagwick');
  // the copy on the board is the scan's
  const board = fs.readFileSync(path.join(dir, 'board.js'), 'utf8');
  assert.ok(board.includes(`'${scan.install.value}'`), 'the board names the install command the scan found');
  assert.equal(scan.features.length, 3);
});

test('repo-launch: the kit\'s bgA, bgB and accent are each more than 15 (CIEDE2000) from every look\'s and the template\'s tokens', () => {
  const others = [LK.TEMPLATE, ...Object.values(LK.LOOKS)].flatMap((L) => Object.values(L.tokens));
  for (const k of ['bgA', 'bgB', 'accent']) {
    const L = C.hexToLab(kit.colors[k]), d = Math.min(...others.map((h) => C.ciede2000(L, C.hexToLab(h))));
    assert.ok(d > 15, `${k} ${kit.colors[k]} is ${d.toFixed(1)} from a look's token`);
  }
});

test('repo-launch: assets/shots/app.png is the page tools/shots.mjs takes of fixture/app/index.html, in the kit\'s colours', () => {
  const work = path.join(repoRoot, 'test', '.work', 'repo-launch-shot');
  fs.rmSync(work, { recursive: true, force: true });
  fs.cpSync(dir, work, { recursive: true, filter: (s) => !['out', 'stills', 'assets'].includes(path.relative(dir, s).split(path.sep)[0]) });
  const r = spawnSync(process.execPath, ['tools/shots.mjs', 'page', 'app', 'fixture/app/index.html', '--viewport', '390x844', '--dpr', '2'], { cwd: work, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const size = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const [w, h] = size(path.join(dir, 'assets', 'shots', 'app.png')), [w2, h2] = size(path.join(work, 'assets', 'shots', 'app.png'));
  assert.equal(w, 780, 'a 390 px viewport at dpr 2');
  assert.equal(w2, w);
  assert.ok(Math.abs(h2 - h) <= h * 0.01, `the committed shot is ${h} px tall, a fresh one ${h2}`);
  // most of the shot is the kit's background pair
  const px = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, 'assets', 'shots', 'app.png'), '-vf', 'scale=195:-1:flags=neighbor', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
  const bg = [kit.colors.bgA, kit.colors.bgB].map((x) => C.hexToLab(x));
  let n = 0;
  for (let i = 0; i < px.length; i += 3) if (bg.some((L) => C.ciede2000(C.rgbToLab(px[i], px[i + 1], px[i + 2]), L) <= 3)) n++;
  assert.ok(n / (px.length / 3) > 0.6, `${((100 * n) / (px.length / 3)).toFixed(1)}% of the shot is the kit's bgA or bgB`);
});

test('repo-launch: the scene reads the kit (its logo from brand.json, codeTheme of the style, the kit\'s faces), the shot and the scan\'s copy', () => {
  const src = fs.readFileSync(path.join(dir, 'scene.js'), 'utf8');
  assert.match(src, /await fetch\('\.\/brand\.json'\)/);
  assert.match(src, /LOGO = await image\(kit\.logo\.onDark\)/);
  assert.match(src, /SHOT = await image\('assets\/shots\/app\.png'\)/);
  assert.match(src, /TH = codeTheme\(ST\);/);
  assert.doesNotMatch(src, /#[0-9a-f]{6}\b/i, 'no colour written into the scene: they come from the kit');
  assert.ok(src.includes(`const INSTALL = '${S.scanRepo('fixture', { cwd: dir }).install.value}';`), 'the scene types the install command the scan found');
});

// The probe renders every frame through WebGL: seconds on a Mac, minutes under SwiftShader on Linux (references/check.md
// section 6), so the colour match on the example runs where there is a GPU.
const linux = process.platform === 'linux' && !process.env.SM_PROBE_ON_LINUX;
test('repo-launch: palette passes against its kit, the kit\'s faces drawn', { skip: linux && 'the probe needs a GPU to be quick (SM_PROBE_ON_LINUX=1 runs it)' }, () => {
  const r = spawnSync(process.execPath, ['render.mjs', 'palette', '--json'], { cwd: dir, encoding: 'utf8', timeout: 600000, maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(p.rules.every((x) => x.ok), JSON.stringify(p.rules));
  const fonts = p.fonts_used;
  assert.deepEqual([p.kit.file, p.kit.name], ['brand.json', 'Snagwick']);
  assert.ok(fonts.includes('Snagwick Display') && fonts.includes('Snagwick Text'), `fonts drawn: ${fonts}`);
});
