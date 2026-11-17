// tools/repo-scan.mjs (plan 23.4): what a launch video is built from, read from a project's files. Each test builds a
// small made-up project under test/.work/ (so no fixture repo, decoy node_modules included, is committed) and scans it:
// the colours from each source with their file and line, the fonts and their roles, the README's name, pitch, install
// command and features, the logo ranking, the dependency and build folders it skips, that it never touches the
// network and never runs the project's code, and the draft brand.json (written only with --brand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repoRoot, templateDir } from './helpers.mjs';

const S = await import(pathToFileURL(path.join(templateDir, 'tools', 'repo-scan.mjs')).href);
const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
const work = path.join(repoRoot, 'test', '.work', 'repo-scan');

// A made-up project: { 'path': 'content' }.
function project(name, files) {
  const dir = path.join(work, name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  return dir;
}
const scan = (dir, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [...(env.preload ? ['--import', env.preload] : []), path.join(templateDir, 'tools', 'repo-scan.mjs'), dir, ...args],
    { encoding: 'utf8', cwd: templateDir, env: { ...process.env, ...env.vars } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* none */ }
  return { status: r.status, json, out: r.stdout + r.stderr };
};
const pick = (c) => ({ name: c.name, hex: c.hex, file: c.file, line: c.line });
const listing = (dir) => { const out = []; const walk = (d) => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else out.push(path.relative(dir, p) + ':' + fs.statSync(p).size); } }; walk(dir); return out; };

test('parseColor: hex (3, 4, 6, 8 digits), rgb() and rgba(), hsl() and hsla(), oklch(); anything else is not a colour', () => {
  const t = (v) => { const c = S.parseColor(v); return c && [c.hex, +c.alpha.toFixed(2)]; };
  assert.deepEqual(t('#abc'), ['#AABBCC', 1]);
  assert.deepEqual(t('#abcd'), ['#AABBCC', 0.87]);
  assert.deepEqual(t('#5E2404'), ['#5E2404', 1]);
  assert.deepEqual(t('#5e240480'), ['#5E2404', 0.5]);
  assert.deepEqual(t('rgb(110, 44, 2)'), ['#6E2C02', 1]);
  assert.deepEqual(t('rgb(110 44 2 / 50%)'), ['#6E2C02', 0.5]);
  assert.deepEqual(t('rgba(255,0,0,.25)'), ['#FF0000', 0.25]);
  assert.deepEqual(t('hsl(0, 100%, 50%)'), ['#FF0000', 1]);
  assert.deepEqual(t('hsl(120deg 100% 25%)'), ['#008000', 1]);
  assert.deepEqual(t('hsla(240, 100%, 50%, 0.5)'), ['#0000FF', 0.5]);
  assert.deepEqual(t('oklch(0.628 0.2577 29.23)'), ['#FF0000', 1]);
  assert.deepEqual(t('oklch(100% 0 0)'), ['#FFFFFF', 1]);
  assert.deepEqual(t('#98BC0C !important'), ['#98BC0C', 1]);
  for (const v of ['red', 'var(--x)', '#12345', '12px', 'rgb(1,2)', 'transparent', '"Inter", sans-serif']) assert.equal(S.parseColor(v), null, v);
});

test('tokenFor: the token a colour\'s name suggests (bg, surface, text, muted, accent, accent-2), and none for borders and shades', () => {
  const want = {
    '--bg': 'bgA', '--color-background': 'bgA', '--page': 'bgA', '--surface': 'bgB', '--card': 'bgB', '--bg-2': 'bgB', '--bgAlt': 'bgB',
    '--text': 'ink', '--fg': 'ink', '--foreground': 'ink', '--text-muted': 'muted', '--muted': 'muted', '--subtle': 'muted', '--text-secondary': 'muted',
    '--accent': 'accent', '--primary': 'accent', '--brand': 'accent', '--brand-500': 'accent', '--accent-2': 'accent2', '--accent2': 'accent2',
    '--secondary': 'accent2', '--link': 'accent2', primary: 'accent', 'brand-DEFAULT': 'accent',
    '--border': null, '--ring': null, '--brand-100': null, '--shadow-accent': null, '--on-primary': null, '--radius': null, '--spacing-4': null,
  };
  for (const [n, t] of Object.entries(want)) assert.equal(S.tokenFor(n), t, n);
});

test('colours from CSS custom properties: each with its file and line, var() followed, comments and non-colours left out', () => {
  const dir = project('css', {
    'styles/theme.css': [
      '/* --bg: #FF0000; a comment, not a colour */',
      ':root {',
      '  --bg: #5E2404;',
      '  --surface: rgb(110 44 2);',
      '  --radius: 12px;',
      '  --lime: #98BC0C;',
      '  --accent: var(--lime);',
      '  --veil: rgba(0, 0, 0, 0.4);',
      '}',
      '@media (prefers-color-scheme: light) { :root { --bg: hsl(30, 60%, 95%); } }',
    ].join('\n'),
    'index.html': '<!doctype html>\n<html><head>\n<style>\n  :root { --text: #FAEBDC; }\n</style></head><body style="--muted: #D9A98A"></body></html>\n',
  });
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.colors.map(pick), [
    { name: '--text', hex: '#FAEBDC', file: 'index.html', line: 4 },
    { name: '--muted', hex: '#D9A98A', file: 'index.html', line: 5 },
    { name: '--bg', hex: '#5E2404', file: 'styles/theme.css', line: 3 },
    { name: '--surface', hex: '#6E2C02', file: 'styles/theme.css', line: 4 },
    { name: '--lime', hex: '#98BC0C', file: 'styles/theme.css', line: 6 },
    { name: '--accent', hex: '#98BC0C', file: 'styles/theme.css', line: 7 },
    { name: '--veil', hex: '#000000', file: 'styles/theme.css', line: 8 },
    { name: '--bg', hex: '#FAF2EB', file: 'styles/theme.css', line: 10 },
  ]);
  const accent = r.json.colors.find((c) => c.name === '--accent');
  assert.deepEqual(accent.via, { name: '--lime', file: 'styles/theme.css', line: 6 }, 'an alias says where its colour came from');
  assert.equal(r.json.colors.find((c) => c.name === '--veil').alpha, 0.4);
  assert.ok(r.json.colors.every((c) => c.kind === 'css'));
});

test('colours from a Tailwind config, read as text and never run: nested, extend, DEFAULT and quoted keys, with lines', () => {
  const dir = project('tailwind', {
    'tailwind.config.js': [
      "require('fs').writeFileSync(require('path').join(__dirname, 'RAN'), 'the config was run');",
      'module.exports = {',
      '  theme: {',
      '    colors: {',
      "      background: '#5E2404', // the page",
      "      'brand': { DEFAULT: '#98BC0C', 100: '#F0F7D0', 500: \"#88AA00\" },",
      "      fn: withAlpha('#123456'),",
      '    },',
      '    extend: {',
      "      colors: { secondary: { light: '#F2B8C0', DEFAULT: `#E88090` } },",
      '    },',
      '  },',
      '};',
    ].join('\n'),
  });
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.colors.map(pick), [
    { name: 'background', hex: '#5E2404', file: 'tailwind.config.js', line: 5 },
    { name: 'brand', hex: '#98BC0C', file: 'tailwind.config.js', line: 6 },
    { name: 'brand-100', hex: '#F0F7D0', file: 'tailwind.config.js', line: 6 },
    { name: 'brand-500', hex: '#88AA00', file: 'tailwind.config.js', line: 6 },
    { name: 'secondary-light', hex: '#F2B8C0', file: 'tailwind.config.js', line: 10 },
    { name: 'secondary', hex: '#E88090', file: 'tailwind.config.js', line: 10 },
  ]);
  assert.ok(r.json.colors.every((c) => c.kind === 'tailwind'));
  assert.ok(!fs.existsSync(path.join(dir, 'RAN')), 'the scan ran the config');
  // secondary is an exact name, so it takes accent2 from secondary-light, found first but only by its word
  assert.deepEqual(r.json.brand.kit.colors, { bgA: '#5E2404', bgB: '#5E2404', accent: '#98BC0C', accent2: '#E88090' });
});

test('a web manifest\'s theme_color, with its file and line; it fills the accent only when no colour is named for it', () => {
  const man = '{\n  "name": "Snagwick",\n  "icons": [{ "src": "icon-192.png", "sizes": "192x192" }],\n  "theme_color": "#98BC0C",\n  "background_color": "#5E2404"\n}\n';
  const dir = project('manifest', { 'public/site.webmanifest': man, 'public/icon-192.png': 'x' });
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.colors.map((c) => ({ ...pick(c), kind: c.kind })), [{ name: 'theme_color', hex: '#98BC0C', file: 'public/site.webmanifest', line: 4, kind: 'manifest' }]);
  assert.equal(r.json.brand.kit.colors.accent, '#98BC0C');
  assert.equal(r.json.brand.from['colors.accent'], 'public/site.webmanifest:4 theme_color');
  assert.ok(r.json.logos[0].why.includes('the page\'s or the manifest\'s icon'), 'its icon is a logo candidate');
  const both = project('manifest-css', { 'public/site.webmanifest': man, 'a.css': ':root { --primary: #E88090; }' });
  assert.equal(scan(both).json.brand.kit.colors.accent, '#E88090', 'a colour named accent wins over theme_color');
});

test('fonts: @font-face (family, the local file, woff2 first, weight, line), a root-relative url, a remote-only face, font links, and the roles', () => {
  const dir = project('fonts', {
    'src/app.css': [
      '@font-face { font-family: "Snag Display"; src: url("../fonts/d.woff") format("woff"), url(../fonts/d.woff2) format("woff2"); font-weight: 600; }',
      "@font-face { font-family: 'Snag Text'; src: url('/fonts/t.woff2'); font-style: italic; }",
      '@font-face { font-family: Gone; src: url(https://cdn.example.com/gone.woff2); }',
      "@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&family=Inter&display=swap');",
      ':root { --font-display: "Snag Display", system-ui, sans-serif; --font-ui: var(--font-text); --font-text: "Snag Text", sans-serif; }',
      'body { font-family: var(--font-text); }',
      'pre, code { font-family: "Fira Code", ui-monospace, monospace; }',
    ].join('\n'),
    'fonts/d.woff': 'x', 'fonts/d.woff2': 'x', 'public/fonts/t.woff2': 'x',
    'index.html': '<link rel="preconnect" href="https://fonts.gstatic.com">\n<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&amp;display=swap" rel="stylesheet">\n',
  });
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  const f = (fam) => r.json.fonts.find((x) => x.family === fam);
  assert.deepEqual(f('Snag Display'), { family: 'Snag Display', kind: 'font-face', file: 'fonts/d.woff2', weight: '600', style: null, from: { file: 'src/app.css', line: 1 }, roles: ['display'] });
  assert.deepEqual(f('Snag Text'), { family: 'Snag Text', kind: 'font-face', file: 'public/fonts/t.woff2', weight: null, style: 'italic', from: { file: 'src/app.css', line: 2 }, roles: ['body'] });
  assert.deepEqual(f('Gone'), { family: 'Gone', kind: 'font-face', file: null, url: 'https://cdn.example.com/gone.woff2', weight: null, style: null, from: { file: 'src/app.css', line: 3 }, roles: [] });
  assert.deepEqual(r.json.fonts.filter((x) => x.kind === 'link').map((x) => [x.family, x.from.file, x.from.line, x.remote, x.roles]),
    [['Space Grotesk', 'index.html', 2, true, []], ['Fira Code', 'src/app.css', 4, true, ['mono']], ['Inter', 'src/app.css', 4, true, []]]);
  assert.deepEqual(r.json.brand.kit.fonts, { display: { family: 'Snag Display', file: 'fonts/d.woff2' }, body: { family: 'Snag Text', file: 'public/fonts/t.woff2' } });
  assert.ok(r.json.brand.notes.some((n) => /^fonts\.mono: Fira Code has no file in the project \(a font service link\)/.test(n)), r.json.brand.notes.join('\n'));
});

test('the README and package metadata: name, pitch, install command and features, each with its file and line', () => {
  const dir = project('readme', {
    'README.md': [
      '<p align="center"><img src="assets/logo.svg" width="96"></p>',          // 1
      '',
      '# Snagwick',                                                              // 3
      '',
      '[![build](https://img.shields.io/badge/build-passing-green.svg)](https://ci.example.com)',
      '',
      'Snagwick finds every **TODO** in your code. Then it sorts them.',          // 7
      '',
      '## Install',
      '',
      '```sh',
      '$ npm install -g snagwick',                                               // 12
      '```',
      '',
      '## Features',                                                             // 15
      '',
      '- Finds every `TODO`, FIXME and HACK',                                    // 17
      '- Groups them by [file](docs/files.md)',                                  // 18
      '  - a nested item is not a feature',
      '1. Opens a board on localhost',                                           // 20
      '',
      '## How it works',                                                         // 22
      '',
      '## License',
    ].join('\n'),
    'package.json': '{\n  "name": "snagwick",\n  "description": "Every TODO in your code, on one board.",\n  "bin": { "snagwick": "bin/cli.js" }\n}\n',
    'assets/logo.svg': '<svg/>',
  });
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.name, { value: 'Snagwick', file: 'README.md', line: 3 });
  assert.deepEqual(r.json.pitch, { value: 'Every TODO in your code, on one board.', file: 'package.json', line: 3 });
  assert.deepEqual(r.json.install, { value: 'npm install -g snagwick', file: 'README.md', line: 12 });
  assert.deepEqual(r.json.features.map((x) => [x.text, x.kind, x.line]), [
    ['Finds every TODO, FIXME and HACK', 'item', 17], ['Groups them by file', 'item', 18], ['Opens a board on localhost', 'item', 20], ['How it works', 'heading', 22]]);
  // without the metadata: the README's first sentence; without the README's command: one made from the metadata
  const bare = project('readme-bare', { 'README.md': '# Snagwick\n\nSnagwick finds every TODO in your code. Then it sorts them.\n', 'package.json': '{ "name": "snagwick", "bin": "cli.js" }' });
  const b = scan(bare).json;
  assert.deepEqual(b.pitch, { value: 'Snagwick finds every TODO in your code.', file: 'README.md', line: 3 });
  assert.deepEqual(b.install, { value: 'npm install -g snagwick', file: 'package.json', line: 1, derived: true });
  const py = scan(project('pyproject', { 'pyproject.toml': '[build-system]\nrequires = ["x"]\n\n[project]\nname = "snagwick"\ndescription = "Every TODO, on one board."\n' })).json;
  assert.deepEqual([py.name, py.pitch, py.install], [{ value: 'snagwick', file: 'pyproject.toml', line: 5 }, { value: 'Every TODO, on one board.', file: 'pyproject.toml', line: 6 },
    { value: 'pip install snagwick', file: 'pyproject.toml', line: 5, derived: true }]);
  const rs = scan(project('cargo', { 'Cargo.toml': '[package]\nname = "snagwick"\nversion = "0.1.0"\n', 'src/main.rs': 'fn main() {}' })).json;
  assert.deepEqual(rs.install, { value: 'cargo install snagwick', file: 'Cargo.toml', line: 2, derived: true });
  assert.deepEqual(scan(project('nameless', { 'a.txt': 'x' })).json.name, { value: 'nameless', file: null, line: null }, 'the folder\'s name');
});

test('logo candidates, ranked: a logo word, the project\'s name, SVG over PNG, a brand folder, the README and the page\'s icon; screenshots apart', () => {
  const dir = project('logos', {
    'README.md': '# Snagwick\n\n![Snagwick](docs/snagwick-mark.png)\n\n![the board](docs/board.png)\n',
    'index.html': '<link rel="icon" href="public/favicon.ico">',
    'assets/logo.svg': '<svg/>', 'assets/logo.png': 'x', 'logo-wide.svg': '<svg/>', 'docs/snagwick-mark.png': 'x', 'docs/board.png': 'x',
    'public/favicon.ico': 'x', 'src/components/icons/menu-icon.svg': '<svg/>', 'docs/screenshots/home.png': 'x', 'assets/hero.jpg': 'x',
  });
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.logos.map((l) => [l.file, l.score]), [
    ['docs/snagwick-mark.png', 83],                // mark 20, named after the project 15, the README's first picture 30, png 10, docs/ 8
    ['logo-wide.svg', 70],                         // logo 40, svg 20, the root 10
    ['assets/logo.svg', 68],                       // logo 40, svg 20, assets/ 8
    ['assets/logo.png', 58],                       // logo 40, png 10, assets/ 8
    ['public/favicon.ico', 23],                    // favicon 10, the page's icon 10, ico -5, public/ 8
    ['src/components/icons/menu-icon.svg', 32],    // icon 15, svg 20, three folders deep -3
  ].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
  assert.deepEqual(r.json.screenshots, [{ file: 'docs/board.png', readme: true }, { file: 'docs/screenshots/home.png' }]);
  assert.deepEqual(r.json.brand.kit.logo, { onDark: 'docs/snagwick-mark.png', onLight: 'docs/snagwick-mark.png' });
});

test('dependency and build folders are skipped: their colours, fonts and logos are not read, and they are listed as skipped', () => {
  const decoy = ':root { --accent: #FF0000; }\n@font-face { font-family: Decoy; src: url(d.woff2); }\n';
  const files = { 'a.css': ':root { --accent: #98BC0C; }', 'logo.svg': '<svg/>' };
  const skip = ['node_modules/pkg', 'packages/web/node_modules/pkg', 'dist', 'build', 'out', 'target', '.venv/lib', 'vendor/x', 'coverage', '.next', '.git', '.cache'];
  for (const d of skip) { files[`${d}/x.css`] = decoy; files[`${d}/d.woff2`] = 'x'; files[`${d}/logo.svg`] = '<svg/>'; files[`${d}/tailwind.config.js`] = "module.exports = { theme: { colors: { primary: '#FF0000' } } };"; }
  files['.github/logo.png'] = 'x';
  files['.idea/x.css'] = decoy;   // a hidden folder that is not on the list
  const dir = project('skip', files);
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.colors.map((c) => [c.file, c.hex]), [['a.css', '#98BC0C']]);
  assert.deepEqual(r.json.fonts, []);
  assert.deepEqual(r.json.logos.map((l) => l.file).sort(), ['.github/logo.png', 'logo.svg']);
  assert.deepEqual([...r.json.skipped].sort(), ['.cache', '.git', '.idea', '.next', '.venv', 'build', 'coverage', 'dist', 'node_modules', 'out', 'packages/web/node_modules', 'target', 'vendor']);
});

test('it never touches the network: no network module, no fetch, and a scan under a guard that fails every connection passes', () => {
  const src = fs.readFileSync(path.join(templateDir, 'tools', 'repo-scan.mjs'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['../looks.js', 'node:fs', 'node:path', 'node:url']);
  assert.doesNotMatch(src, /\bfetch\s*\(|\bimport\s*\(|\brequire\s*\(|child_process|WebSocket/);
  // a project full of remote links, scanned with every way out of the process made to throw (and record it)
  const log = path.join(work, 'net.log');
  fs.mkdirSync(work, { recursive: true }); fs.rmSync(log, { force: true });
  const guard = path.join(work, 'no-network.mjs');
  fs.writeFileSync(guard, [
    "import fs from 'node:fs'; import net from 'node:net'; import dns from 'node:dns'; import http from 'node:http'; import https from 'node:https'; import tls from 'node:tls';",
    `const hit = (what) => { fs.appendFileSync(${JSON.stringify(log)}, what + '\\n'); throw new Error('network: ' + what); };`,
    "globalThis.fetch = () => hit('fetch');",
    "for (const [m, ks] of [[net, ['connect', 'createConnection']], [tls, ['connect']], [http, ['request', 'get']], [https, ['request', 'get']], [dns, ['lookup', 'resolve', 'resolve4']]]) for (const k of ks) m[k] = () => hit(k);",
    "net.Socket.prototype.connect = function () { hit('socket'); };",
  ].join('\n'));
  const dir = project('remote', {
    'README.md': '# Remote\n\n![logo](https://cdn.example.com/logo.svg)\n\n[![ci](https://img.shields.io/x.svg)](https://ci.example.com)\n',
    'index.html': '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">\n<link rel="icon" href="https://cdn.example.com/favicon.ico">\n<img src="https://cdn.example.com/shot.png">',
    'a.css': "@import url('https://fonts.bunny.net/css?family=ibm-plex-mono');\n@font-face { font-family: Remote; src: url(https://cdn.example.com/r.woff2); }\n:root { --accent: #98BC0C; }",
  });
  const r = scan(dir, [], { preload: pathToFileURL(guard).href });
  assert.equal(r.status, 0, r.out);
  assert.ok(!fs.existsSync(log), `the scan reached for the network: ${fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''}`);
  assert.deepEqual(r.json.fonts.map((f) => [f.family, f.kind]), [['Remote', 'font-face'], ['ibm-plex-mono', 'link'], ['Inter', 'link']]);
  assert.deepEqual(r.json.logos, []);
  // the guard works: a fetch under it is recorded
  const g = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, '-e', "fetch('http://127.0.0.1:9').catch(() => {})"], { encoding: 'utf8' });
  assert.ok(fs.existsSync(log) && /fetch/.test(fs.readFileSync(log, 'utf8')), `the guard did not see a fetch: ${g.stderr}`);
});

test('it writes nothing without --brand; --brand writes the draft kit (relative paths, the kit\'s rules), never over a file', () => {
  const files = {
    'README.md': '# Snagwick\n',
    'app/styles.css': '@font-face { font-family: "Snag Display"; src: url(../fonts/d.woff2); }\n:root { --bg: #5E2404; --text: #FAEBDC; --accent: #98BC0C; --font-display: "Snag Display"; }\n',
    'fonts/d.woff2': 'x', 'assets/logo.svg': '<svg/>',
  };
  const dir = project('kit', files);
  const before = listing(dir);
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(listing(dir), before, 'a scan without --brand wrote something');
  assert.deepEqual(r.json.brand.kit, { name: 'Snagwick', colors: { bgA: '#5E2404', bgB: '#5E2404', ink: '#FAEBDC', accent: '#98BC0C' },
    fonts: { display: { family: 'Snag Display', file: 'fonts/d.woff2' } }, logo: { onDark: 'assets/logo.svg', onLight: 'assets/logo.svg' } });
  assert.match(r.json.brand.from['colors.bgB'], /^app\/styles\.css:2 --bg \(no second background found: the same as bgA\)$/);
  assert.ok(r.json.brand.notes.includes('no colour named for muted, accent2: the look or the template fills them'), r.json.brand.notes.join('\n'));

  // into the project root: paths relative to it, and the kit passes doctor's rules with its files where it says
  const w = scan(dir, ['--brand', path.join(dir, 'brand.json')]);
  assert.equal(w.status, 0, w.out);
  const kit = JSON.parse(fs.readFileSync(path.join(dir, 'brand.json'), 'utf8'));
  assert.deepEqual(kit, w.json.brand.kit);
  assert.deepEqual(LK.brandProblems(kit, (f) => fs.existsSync(path.join(dir, f))), []);
  assert.match(w.out, /wrote the draft kit .*brand\.json: show it to the person before using it/);
  // never over a file
  fs.writeFileSync(path.join(dir, 'brand.json'), '{"name":"Mine"}\n');
  const again = scan(dir, ['--brand', path.join(dir, 'brand.json')]);
  assert.equal(again.status, 1, again.out);
  assert.match(again.out, /exists: the scan never overwrites a kit/);
  assert.equal(fs.readFileSync(path.join(dir, 'brand.json'), 'utf8'), '{"name":"Mine"}\n');
  // in a folder above the project (a piece holding its project): paths into it; in a folder inside it: files outside are left out
  const up = scan(dir, ['--brand', path.join(work, 'kit-above.json')]);
  assert.equal(up.status, 0, up.out);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, 'kit-above.json'), 'utf8')).logo, { onDark: 'kit/assets/logo.svg', onLight: 'kit/assets/logo.svg' });
  fs.rmSync(path.join(work, 'kit-above.json'));
  const inside = scan(dir, ['--brand', path.join(dir, 'app', 'brand.json')]);
  assert.equal(inside.status, 0, inside.out);
  const k2 = JSON.parse(fs.readFileSync(path.join(dir, 'app', 'brand.json'), 'utf8'));
  assert.equal(k2.logo, undefined); assert.equal(k2.fonts, undefined);
  assert.ok(inside.json.brand.notes.some((n) => /^logo: assets\/logo\.svg is outside the kit's folder/.test(n)));
  assert.ok(inside.json.brand.notes.some((n) => /^fonts\.display: fonts\/d\.woff2 is outside the kit's folder/.test(n)));
  // usage errors
  assert.equal(scan(path.join(dir, 'nope')).status, 2);
  assert.equal(scan(dir, ['--brnad', 'x.json']).status, 2);
});

// ---------------------------------------------------------------- council round 1 (items 4 to 8)
test('R1-4 the install command: continuations joined; only one that installs this package or sits under an Install heading', () => {
  const pkg = '{\n  "name": "snagwick",\n  "bin": { "snagwick": "cli.js" }\n}\n';
  // a bare npm install and a requirements install in Development are not this package's install command
  const dev = scan(project('install-dev', { 'package.json': pkg, 'README.md': '# Snagwick\n\nIt finds TODOs.\n\n## Development\n\n```sh\nnpm install\npip install -r requirements.txt\nnpm test\n```\n' })).json;
  assert.deepEqual(dev.install, { value: 'npm install -g snagwick', file: 'package.json', line: 2, derived: true });
  // a command split over lines with \ is one command
  const cont = scan(project('install-cont', { 'package.json': pkg, 'README.md': '# Snagwick\n\n## Usage\n\n```sh\n$ npm install --save-dev \\\n    snagwick\n```\n' })).json;
  assert.deepEqual(cont.install, { value: 'npm install --save-dev snagwick', file: 'README.md', line: 6 });
  // a global install, or any install under an Install-like heading, is taken; a versioned name is still the name
  const glob = scan(project('install-global', { 'README.md': '# Tool\n\n## Usage\n\n```sh\nnpm i -g some-cli\n```\n' })).json;
  assert.equal(glob.install.value, 'npm i -g some-cli');
  const head = scan(project('install-head', { 'README.md': '# Tool\n\n## Getting started\n\n```sh\nnpm install\n```\n' })).json;
  assert.deepEqual(head.install, { value: 'npm install', file: 'README.md', line: 6 });
  const ver = scan(project('install-ver', { 'package.json': pkg, 'README.md': '# Snagwick\n\n## Usage\n\n```sh\nnpm install lodash\npnpm add snagwick@1.2.0\n```\n' })).json;
  assert.equal(ver.install.value, 'pnpm add snagwick@1.2.0', 'lodash is not this package');
  assert.equal(S.installsPackage('pip install "snagwick[cli]>=1.0"', ['snagwick']), true);
  assert.equal(S.installsPackage('npm install snagwick-plugin', ['snagwick']), false);
});

test('R1-5 @font-face: every src is read, woff2 first, then woff, ttf, otf, and other formats last', () => {
  const dir = project('fonts-src', {
    'a.css': [
      "@font-face { font-family: 'Two Src'; src: url('f/two.eot'); src: url('f/two.eot?#iefix') format('embedded-opentype'), url('f/two.woff') format('woff'), url('f/two.woff2') format('woff2'); }",
      "@font-face { font-family: 'Eot First'; src: url(f/one.eot) format('embedded-opentype'), url(f/one.ttf) format('truetype'); }",
    ].join('\n'),
    'f/two.eot': 'x', 'f/two.woff': 'x', 'f/two.woff2': 'x', 'f/one.eot': 'x', 'f/one.ttf': 'x',
  });
  const r = scan(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.fonts.map((f) => [f.family, f.file]), [['Two Src', 'f/two.woff2'], ['Eot First', 'f/one.ttf']]);
});

test('R1-6 var(--x, <colour>) is its fallback when --x is not declared', () => {
  const r = scan(project('var-fallback', { 'a.css': ':root {\n  --accent: var(--brand-accent, #98BC0C);\n  --bg: var(--page-bg, rgb(94, 36, 4));\n  --text: var(--ink, var(--fg, #FAEBDC));\n  --fg: #FFFFFF;\n}\n' }));
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.colors.map((c) => [c.name, c.hex, c.line]), [['--accent', '#98BC0C', 2], ['--bg', '#5E2404', 3], ['--text', '#FFFFFF', 4], ['--fg', '#FFFFFF', 5]]);
  assert.deepEqual(r.json.colors[0].via, { name: '--brand-accent', fallback: '#98BC0C' });
  assert.equal(r.json.colors[2].via.name, '--fg', 'a declared var in the fallback is followed');
});

test('R1-7 the name is the README\'s title at any level, and the title is not a feature', () => {
  const pkg = '{ "name": "snagwick-cli", "description": "Every TODO, on one board." }';
  const h2 = scan(project('title-h2', { 'package.json': pkg, 'README.md': '<p align="center"><img src="logo.svg" width="80"></p>\n\n## Snagwick\n\nSnagwick finds every TODO.\n\n## Features\n\n- Finds TODOs\n\n## How it works\n' })).json;
  assert.deepEqual(h2.name, { value: 'Snagwick', file: 'README.md', line: 3 });
  assert.deepEqual(h2.features.map((f) => f.text), ['Finds TODOs', 'How it works']);
  const h3 = scan(project('title-h3', { 'README.md': '### Snagwick\nSnagwick finds every TODO.\n' })).json;
  assert.deepEqual(h3.name, { value: 'Snagwick', file: 'README.md', line: 1 });
  // a README that opens on prose has no title: its first section heading is not the name
  const prose = scan(project('title-none', { 'package.json': pkg, 'README.md': 'Snagwick finds every TODO in your code.\n\n## Install\n\n```sh\nnpm i -g snagwick-cli\n```\n' })).json;
  assert.deepEqual(prose.name, { value: 'snagwick-cli', file: 'package.json', line: 1 });
});

test('R1-8 a token\'s exact name wins over a name that only holds one of its words, whichever comes first', () => {
  const r = scan(project('exact-names', { 'a.css': ':root {\n  --highlight: #FF0000;\n  --backdrop: #111111;\n  --copy: #000000;\n  --card: #222222;\n  --text: #FAEBDC;\n  --bg: #5E2404;\n  --accent: #98BC0C;\n  --surface: #6E2C02;\n}\n' }));
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.json.brand.kit.colors, { bgA: '#5E2404', bgB: '#6E2C02', ink: '#FAEBDC', accent: '#98BC0C' });
  assert.equal(r.json.brand.from['colors.accent'], 'a.css:8 --accent');
  // the exact names, each its token's; and still read by its words
  for (const [tok, names] of Object.entries(S.TOKEN_EXACT)) for (const n of names) {
    assert.equal(S.exactToken(`--${n}`), tok, n); assert.equal(S.exactToken(`--color-${n}`), tok, `color-${n}`); assert.equal(S.tokenFor(`--${n}`), tok, `words of ${n}`);
  }
  for (const n of ['--highlight', '--page', '--brand-tint', '--copy', '--card']) assert.equal(S.exactToken(n), null, n);
  // with no exact name, the first name holding a word still wins
  const words = scan(project('word-names', { 'a.css': ':root { --highlight: #FF0000; --brand-tint: #00FF00; }' })).json;
  assert.equal(words.brand.kit.colors.accent, '#FF0000');
});

// ---------------------------------------------------------------- council round 2 (F2, F3)
test('R2-2 a command under an Install-like heading at any level above it is taken (## Installation > ### npm)', () => {
  const npm = scan(project('install-nested-npm', { 'README.md': '# Tool\n\n## Installation\n\n### npm\n\n```sh\nnpm install\n```\n\n## Development\n\n### Tests\n\n```sh\nnpm install --save-dev mocha\n```\n' })).json;
  assert.deepEqual(npm.install, { value: 'npm install', file: 'README.md', line: 8 });
  const pip = scan(project('install-nested-pip', { 'README.md': '# Tool\n\n## Installation\n\n### macOS\n\nSee the app.\n\n### Linux\n\n```sh\npip install -r requirements.txt\n```\n' })).json;
  assert.deepEqual(pip.install, { value: 'pip install -r requirements.txt', file: 'README.md', line: 12 });
  // a sub-heading under a section that is not Install-like still does not qualify
  const dev = scan(project('install-nested-dev', { 'package.json': '{ "name": "tool" }', 'README.md': '# Tool\n\n## Development\n\n### Tests\n\n```sh\nnpm install\n```\n' })).json;
  assert.deepEqual(dev.install, { value: 'npm install tool', file: 'package.json', line: 1, derived: true });
});

test('R2-3 the title after YAML front matter, link-reference definitions or a multi-line HTML block still names the project', () => {
  const front = scan(project('title-front', { 'README.md': '---\ntitle: Snagwick docs\nlayout: default\n---\n\n# Snagwick\n\nSnagwick finds every TODO.\n\n## Features\n\n- Finds TODOs\n' })).json;
  assert.deepEqual(front.name, { value: 'Snagwick', file: 'README.md', line: 6 });
  assert.deepEqual(front.features.map((f) => f.text), ['Finds TODOs'], 'the front matter\'s last field is not a feature');
  assert.deepEqual(front.pitch, { value: 'Snagwick finds every TODO.', file: 'README.md', line: 8 });
  const defs = scan(project('title-defs', { 'README.md': '[ci]: https://ci.example.com/badge.svg\n[docs]: <https://docs.example.com> "Docs"\n\n## Snagwick\n\nIt finds TODOs.\n' })).json;
  assert.deepEqual(defs.name, { value: 'Snagwick', file: 'README.md', line: 4 });
  const block = scan(project('title-html', { 'README.md': [
    '<p align="center">',
    '  <img src="logo.svg"',
    '       width="96" alt="">',
    '  <br>',
    '  Every TODO, on one board',
    '</p>',
    '',
    '<div align="center">',
    '',
    '  [![ci](https://ci.example.com/b.svg)](https://ci.example.com)',
    '',
    '</div>',
    '',
    '# Snagwick',
    '',
  ].join('\n') })).json;
  assert.deepEqual(block.name, { value: 'Snagwick', file: 'README.md', line: 14 });
  // an element left open runs to the next blank line, as Markdown ends an HTML block there
  const open = scan(project('title-html-open', { 'README.md': '<p align="center">\n  <img src="logo.svg" width="96">\n  Every TODO, on one board\n\n# Snagwick\n' })).json;
  assert.deepEqual(open.name, { value: 'Snagwick', file: 'README.md', line: 5 });
  // text outside any HTML block, above the first heading, still means there is no title
  const prose = scan(project('title-html-prose', { 'README.md': '<p align="center"><img src="logo.svg"></p>\n\nSnagwick finds TODOs.\n\n## Install\n' })).json;
  assert.deepEqual(prose.name, { value: 'title-html-prose', file: null, line: null });
});
