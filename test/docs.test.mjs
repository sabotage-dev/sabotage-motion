// The skill text (plan section 14): SKILL.md's frontmatter and description, the five references it names, and the
// safe-zone table in references/delivery.md, which must equal safezones.json (plan 12: the guide and the check
// never disagree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, templateDir, examplesDir, EXAMPLES } from './helpers.mjs';

const skillDir = path.join(repoRoot, 'skills', 'sabotage-motion');
const read = (f) => fs.readFileSync(path.join(skillDir, f), 'utf8');

test('SKILL.md: frontmatter names the skill, and the description names no other product (Q7)', () => {
  const md = read('SKILL.md');
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, 'SKILL.md starts with frontmatter');
  assert.match(fm[1], /^name: sabotage-motion$/m);
  const desc = (fm[1].match(/^description: (.+)$/m) || [])[1];
  assert.ok(desc && desc.length > 200, 'a description with the trigger list');
  for (const word of ['Remotion', 'HyperFrames', 'After Effects']) assert.ok(!desc.includes(word), `the description names ${word}`);
  for (const word of ['kinetic typography', 'end cards', 'lower thirds', 'overlays', 'not for']) assert.ok(desc.toLowerCase().includes(word), `the description lacks "${word}"`);
});

test('SKILL.md: the five references exist, and every reference and example it names is there', () => {
  const md = read('SKILL.md');
  for (const r of ['techniques', 'delivery', 'storyboard', 'voice', 'check']) assert.ok(fs.existsSync(path.join(skillDir, 'references', `${r}.md`)), `references/${r}.md`);
  for (const m of md.matchAll(/`references\/([\w-]+\.md)`/g)) assert.ok(fs.existsSync(path.join(skillDir, 'references', m[1])), `SKILL.md names references/${m[1]}`);
  for (const ex of EXAMPLES) assert.ok(md.includes(`\`${ex}/\``), `SKILL.md describes the ${ex} example`);
  for (const ex of EXAMPLES) assert.ok(fs.existsSync(path.join(examplesDir, ex, 'README.md')), `examples/${ex}/README.md`);
});

test('references/delivery.md: its safe-zone table is safezones.json, target by target', () => {
  const md = read('references/delivery.md');
  const zones = JSON.parse(fs.readFileSync(path.join(templateDir, 'safezones.json'), 'utf8')).targets;
  const rows = new Map();
  for (const m of md.matchAll(/^\| `([\w-]+)` \| ([^|]*)\| ([^|]*)\| ([^|]*)\| ([^|]*)\| ([^|]*)\|$/gm)) rows.set(m[1], m.slice(2).map((x) => x.trim()));
  const span = (r) => `x ${r.x}-${r.x + r.w}, y ${r.y}-${r.y + r.h}`;
  const problems = [];
  for (const [name, z] of Object.entries(zones)) {
    const row = rows.get(name);
    if (!row) { problems.push(`${name}: no row`); continue; }
    if (!z.w) continue;
    const want = [`${z.w}x${z.h}`, String(z.fps), z.safe ? span(z.safe) : 'none', (z.exclude || []).map(span).join('; '), z.estimate ? 'estimate' : `measured ${z.measured}`];
    if (JSON.stringify(row) !== JSON.stringify(want)) problems.push(`${name}: the table says ${JSON.stringify(row)}, safezones.json ${JSON.stringify(want)}`);
  }
  for (const name of rows.keys()) if (!zones[name]) problems.push(`${name}: in the table, not in safezones.json`);
  assert.deepEqual(problems, []);
});

// Plan 23.1: the README's pictures exist, and each GIF is within the budget scripts/readme-media.mjs holds it to
// (the hero at most 640 px wide and 5 MB, every other GIF at most 2 MB), so the page does not load slowly.
test('README: every picture it shows exists, and each GIF is within its size budget', async () => {
  const { mediaProblems } = await import('../scripts/readme-media.mjs');
  const { refs, problems } = mediaProblems(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8'), repoRoot);
  assert.ok(refs.includes('docs/media/hero.gif'), 'the README opens on docs/media/hero.gif');
  assert.deepEqual(problems, []);
});

test('readme-media: a missing picture, a wide or heavy hero and a heavy tile are each reported', async () => {
  const { mediaProblems } = await import('../scripts/readme-media.mjs');
  const MB = 1024 * 1024;   // the plan's budgets (23.1), written out here so a looser budget in the script fails
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-media-'));
  const gif = (name, width, bytes) => {
    const b = Buffer.alloc(bytes);
    b.write('GIF89a', 0, 'latin1'); b.writeUInt16LE(width, 6); b.writeUInt16LE(100, 8);
    fs.writeFileSync(path.join(dir, name), b);
  };
  gif('hero.gif', 640, 5 * MB);          // at the edge: fine
  gif('tile-ok.gif', 270, 2 * MB);       // at the edge: fine
  gif('tile-heavy.gif', 270, 2 * MB + 1);
  const ok = mediaProblems('![h](hero.gif) <img src="tile-ok.gif" width="270">', dir);
  assert.deepEqual(ok.problems, []);
  const bad = mediaProblems('<img src="tile-heavy.gif"> ![m](gone.png)', dir);
  assert.deepEqual(bad.problems.map((p) => p.split(':')[0]).sort(), ['gone.png', 'tile-heavy.gif']);
  gif('hero.gif', 640, 5 * MB + 1);
  assert.equal(mediaProblems('![h](hero.gif)', dir).problems.length, 1, 'a hero over 5 MB');
  gif('hero.gif', 641, 1000);
  assert.equal(mediaProblems('![h](hero.gif)', dir).problems.length, 1, 'a hero over 640 px');
  gif('tile-wide.gif', 361, 1000);
  gif('tile-360.gif', 360, 1000);
  assert.deepEqual(mediaProblems('![t](tile-360.gif)', dir).problems, [], 'a tile at 360 px');
  assert.equal(mediaProblems('![t](tile-wide.gif)', dir).problems.length, 1, 'a tile over 360 px');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readme-media: every form GitHub renders a picture in is found, and code and links are not', async () => {
  const { pictureRefs } = await import('../scripts/readme-media.mjs');
  const md = [
    '![plain](a.gif)',
    '![titled](b.gif "a title")',
    "![titled](c.gif 'single')",
    '![angled](<d.gif>)',
    '![full][e-ref] ![collapsed][] ![shortcut]',
    '<img src="f.gif"> <img alt="x" src=\'g.gif\'> <img src=h.gif>',
    '<img',
    '  width="270"',
    '  src="i.gif">',
    '![query](j.gif?raw=true) ![fragment](k.gif#top)',
    '```html',
    '<img src="in-code.gif"> ![in code](in-code.gif)',
    '```',
    '![web](https://example.com/w.gif) ![proto](//example.com/p.gif) ![data](data:image/gif;base64,R0lG)',
    '',
    '[e-ref]: e.gif',
    '[collapsed]: <l.gif> "t"',
    '[Shortcut]: m.gif',
  ].join('\n');
  assert.deepEqual(pictureRefs(md).sort(), ['a.gif', 'b.gif', 'c.gif', 'd.gif', 'e.gif', 'f.gif', 'g.gif', 'h.gif', 'i.gif', 'j.gif', 'k.gif', 'l.gif', 'm.gif']);
});

// ---------------------------------------------------------------- looks and brand kits (plan 23.2)
const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
test('SKILL.md: looks, the brand kit, brand, palette and the look fonts, and "pick a look on purpose"', () => {
  const md = read('SKILL.md');
  for (const x of ['looks.js', 'brand.json', 'node render.mjs brand', 'node render.mjs palette', '${CLAUDE_SKILL_DIR}/looks/fonts/', '`references/looks.md`', 'lookFiles(name)']) {
    assert.ok(md.includes(x), `SKILL.md names ${x}`);
  }
  assert.match(md, /With a brand kit, use it\./);
  assert.match(md, /pick a look on purpose, say which and why/);
  assert.match(md, /do not fall back to the same palette from\s+piece to piece/);
  for (const n of LK.LOOK_NAMES) assert.ok(md.includes(`\`${n}\``), `SKILL.md names the ${n} look`);
  for (const id of Object.keys(LK.BG_IDS)) assert.ok(md.includes(`\`${id}\``), `SKILL.md names the ${id} shader id`);
});
test('references/looks.md: its table of looks is looks.js, look by look (shader, faces, the font files to copy)', () => {
  const md = read('references/looks.md');
  const rows = new Map([...md.matchAll(/^\| `([\w-]+)` \| [^|]+\| `([\w-]+)` \| (\w+) \/ (\w+) \| [^|]+\| ([^|]+)\|$/gm)].map((m) => [m[1], m.slice(2).map((x) => x.trim())]));
  const problems = [];
  for (const n of LK.LOOK_NAMES) {
    const L = LK.LOOKS[n], row = rows.get(n);
    if (!row) { problems.push(`${n}: no row`); continue; }
    const files = LK.lookFiles(n).filter((f) => f.endsWith('.woff2'));
    const want = [L.bg, L.fonts.display.family, L.fonts.body.family, files.length ? files.map((f) => `\`${f}\``).join(', ') : 'none'];
    if (JSON.stringify(row) !== JSON.stringify(want)) problems.push(`${n}: the table says ${JSON.stringify(row)}, looks.js ${JSON.stringify(want)}`);
  }
  for (const n of rows.keys()) if (!LK.LOOKS[n]) problems.push(`${n}: in the table, not in looks.js`);
  assert.deepEqual(problems, []);
  for (const x of ['--param` over `brand.json` over the look over the template', 'CIEDE2000', 'fonts_used', 'onDark', 'node render.mjs palette']) assert.ok(md.includes(x), `looks.md: ${x}`);
});
test('README: the --param line names the colour tokens and the shader id; "Looks and brand kits" follows "Your first piece" and shows docs/media/looks.png', () => {
  const md = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const at = md.indexOf('The template is a 3 s, 1080x1920 kinetic title card.');
  assert.ok(at > 0, 'the line is there');
  const para = md.slice(at, md.indexOf('\n\n', at));
  for (const k of LK.TOKENS) assert.ok(para.includes(`\`${k}\``), `the --param line names the ${k} token`);
  for (const id of Object.keys(LK.BG_IDS)) assert.ok(para.includes(`\`${id}\``), `the --param line names the ${id} shader id`);
  assert.match(para, /`bg`, the\s+background shader id/);
  assert.match(para, /never a colour/);
  const i1 = md.indexOf('\n## Your first piece'), i2 = md.indexOf('\n## Looks and brand kits'), i3 = md.indexOf('\n## Storyboard and voice');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3, 'Looks and brand kits sits after Your first piece, before Storyboard and voice');
  const section = md.slice(i2, i3);
  assert.match(section, /!\[[^\]]+\]\(docs\/media\/looks\.png\)/);
  const png = path.join(repoRoot, 'docs', 'media', 'looks.png'), buf = fs.readFileSync(png);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  assert.ok(w >= 800 && w <= 1600 && h >= 600 && h <= 1600, `looks.png is ${w}x${h}`);
  assert.ok(buf.length <= 600 * 1024, `looks.png is ${buf.length} bytes (budget 600 KB)`);
  for (const n of LK.LOOK_NAMES) assert.ok(section.includes(`\`${n}\``), `the section names ${n}`);
});

// ---------------------------------------------------------------- code and terminal motion (plan 23.3)
const CODE = await import(pathToFileURL(path.join(templateDir, 'code.js')).href);
test('SKILL.md: code.js in the files table, its craft line, references/code.md and the terminal-demo example', () => {
  const md = read('SKILL.md');
  for (const x of ['| `code.js` |', '`references/code.md`', 'codeTheme(style)', 'keyTicks', '`terminal-demo/`']) assert.ok(md.includes(x), `SKILL.md names ${x}`);
  assert.ok(fs.existsSync(path.join(skillDir, 'references', 'code.md')));
  assert.match(read('references/techniques.md'), /`references\/code\.md`/);
});
test('references/code.md: every helper code.js exports is documented, and its languages, kinds and numbers are code.js\'s', () => {
  const md = read('references/code.md');
  const internal = new Set(['mix', 'contrast', 'readable', 'advance', 'langOf', 'normCode', 'KINDS', 'LANGS']);
  const undocumented = Object.keys(CODE).filter((k) => !internal.has(k) && !md.includes(`\`${k}`)).sort();
  assert.deepEqual(undocumented, [], 'exports of code.js that references/code.md never names');
  const langs = md.match(/Languages: (.+?); `plain`/s)[1];
  for (const l of CODE.LANGS) assert.ok(langs.includes(`\`${l}\``), `the language list names ${l}`);
  const kinds = [...md.match(/Kinds: ([^.]+)\./s)[1].matchAll(/`(\w+)`/g)].map((m) => m[1]);
  assert.deepEqual(kinds, CODE.KINDS, 'the kinds, in code.js\'s order');
  assert.match(md, new RegExp(`at most \`KEY_MAX\` \\(${CODE.KEY_MAX}\\) a second`));
  assert.match(md, new RegExp(`reads at ${CODE.CODE_CONTRAST}:1 or more`));
  assert.match(md, new RegExp(`for ${CODE.CURSOR_SOLID} s after the last one \\(\`CURSOR_SOLID\`\\)`));
  for (const x of ['draw: false', 'deco', 'group', 'examples/terminal-demo/']) assert.ok(md.includes(x), `code.md: ${x}`);
  // the limits and rules a user meets (council round 1)
  assert.match(md, /one with a newline is an error that says so/, 'a command is one row');
  assert.match(md, /a template literal is one string, `\$\{\.\.\.\}` included, and nests/);
  assert.match(md, /A regular\s+expression literal reads as operators outside `\$\{\}`/);
  assert.match(md, /Inside `\$\{\}`, a `\/` where an operand belongs/, 'R3: a regex inside ${} is read');
  assert.match(md, /postfix `\+\+` or `--` it divides/);
  assert.match(md, /A heredoc reads as plain words/);
  assert.match(md, /its text is only the\s+characters that show there/);
  assert.match(md, /a drawn line number counts/);
  // R2-4: one account of a diff's colours: context lines take the new file's from the start
  assert.match(md, /context lines take the new file's\s+colours from the start/);
  assert.doesNotMatch(md, /as the file was/);
  assert.match(md, /Each hunk starts afresh, whether its header shows or not/);
});
test('README: the terminal-demo row and the code suite', () => {
  const md = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  for (const ex of EXAMPLES) assert.match(md, new RegExp(`^\\| \`${ex}/\` \\|`, 'm'), `the examples table has ${ex}`);
  assert.match(md, /^npm run test:code /m);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:code'], /code-units\.test\.mjs.*code\.test\.mjs.*code-example\.test\.mjs/);
  assert.match(fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'), /npm run test:code/);
});

// ---------------------------------------------------------------- a launch video for a repo (plan 23.4)
const SHOTS = await import(pathToFileURL(path.join(templateDir, 'tools', 'shots.mjs')).href);
const SCAN = await import(pathToFileURL(path.join(templateDir, 'tools', 'repo-scan.mjs')).href);
test('SKILL.md: the launch branch, in its order (scan, the kit shown, the board, the board shown, render and check), and its tools', () => {
  const md = read('SKILL.md');
  const at = md.indexOf('**A launch video for a repo**');
  assert.ok(at > md.indexOf('## Workflow') && at < md.indexOf('1. **Pin the brief.**'), 'the branch opens the workflow');
  const branch = md.slice(at, md.indexOf('1. **Pin the brief.**'));
  const steps = ['**Scan**', '**Write `brand.json` from what the scan found**', '**show it**', '**Write the board**', '**Show the board**', '**Render, mix, `palette` and `check`**'];
  const pos = steps.map((x) => branch.indexOf(x));
  assert.ok(pos.every((p) => p >= 0), `the branch names ${steps.filter((_, i) => pos[i] < 0).join(', ')}`);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, 'in that order');
  for (const x of ['node tools/repo-scan.mjs', '`references/launch.md`', 'node tools/shots.mjs', 'a hook, the install in a terminal', 'an end card with the logo and the\n   install command']) assert.ok(branch.includes(x), `the branch: ${x}`);
  for (const x of ['`repo-scan.mjs`', '`shots.mjs`', '`repo-launch/`', 'launch videos for a code repo']) assert.ok(md.includes(x), `SKILL.md names ${x}`);
});
test('references/launch.md: its numbers and lists are the tools\' (1 GB, the bytes a frame, the skipped folders, the token names)', () => {
  const md = read('references/launch.md');
  assert.equal(SHOTS.SEQ_MAX_BYTES, 1024 ** 3);
  assert.match(md, /a sequence over 1 GB decoded \(frames x width x height x\s+4 bytes, in device pixels\) is refused before anything is captured/);
  // the worked numbers: a 390x844 viewport at dpr 2, 3 s and 8 s at 30 fps, and 8 s at dpr 1
  const gb = (frames, dpr) => SHOTS.seqBytes({ frames, w: 390 * dpr, h: 844 * dpr }) / SHOTS.SEQ_MAX_BYTES;
  assert.ok(md.includes(`is ${(SHOTS.seqBytes({ frames: 1, w: 780, h: 1688 }) / (1 << 20)).toFixed(1)} MB a frame decoded`));
  assert.ok(md.includes(`3 s at 30 fps holds ${gb(90, 2).toFixed(2)} GB`) && md.includes(`(${gb(240, 2).toFixed(2)} GB) is refused`) && md.includes(`8 s holds ${gb(240, 1).toFixed(2)} GB`));
  assert.ok(SHOTS.seqTooBig({ frames: 240, w: 780, h: 1688 }) && !SHOTS.seqTooBig({ frames: 90, w: 780, h: 1688 }), 'the refused one is refused');
  for (const d of ['node_modules', 'vendor', '.venv', 'dist', 'build', 'out', 'target', '.next', 'coverage', '.git']) {
    assert.ok(SCAN.SKIP_DIRS.includes(d), `${d} is skipped`); assert.ok(md.includes(`\`${d}\``), `launch.md names ${d}`);
  }
  const names = { bg: 'bgA', background: 'bgA', page: 'bgA', surface: 'bgB', card: 'bgB', panel: 'bgB', 'bg-2': 'bgB', 'bg-alt': 'bgB', text: 'ink', fg: 'ink', foreground: 'ink',
    muted: 'muted', subtle: 'muted', accent: 'accent', primary: 'accent', brand: 'accent', secondary: 'accent2', 'accent-2': 'accent2', link: 'accent2' };
  for (const [n, tok] of Object.entries(names)) { assert.equal(SCAN.tokenFor(n), tok, n); assert.ok(md.includes(`\`${n}\``), `launch.md names ${n}`); }
  for (const x of ['never touches the network', 'never runs the project\'s code', 'never\noverwrites one', 'show it', 'examples/repo-launch/']) assert.ok(md.includes(x) || md.replace(/\n/g, ' ').includes(x.replace(/\n/g, ' ')), `launch.md: ${x}`);
  assert.match(read('references/techniques.md'), /`tools\/shots\.mjs`/);
});
test('README: the launch section, the repo-launch row and the launch suite; CI runs it', () => {
  const md = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.match(md, /^## A launch video for a repo$/m);
  assert.match(md, /^\| `repo-launch\/` \|.*`palette` passes; 0 FAIL, 0 WARN on the source and the master \|$/m);
  assert.match(md, /^npm run test:launch /m);
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['test:launch'], /repo-scan\.test\.mjs.*shots\.test\.mjs.*launch-example\.test\.mjs/);
  assert.match(fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'), /npm run test:launch/);
});

// ---------------------------------------------------------------- council round 1 on P9 (items 8, 10, 11, the example's commands)
test('R1-8 references/launch.md: its token table is repo-scan\'s exact names and words, every alias, and the names that are never tokens', () => {
  const md = read('references/launch.md');
  const rows = new Map([...md.matchAll(/^\| `(\w+)` \| ([^|]+)\| ([^|]+)\|$/gm)].map((m) => [m[1], [m[2], m[3]]]));
  const ticks = (x) => [...x.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const W = SCAN.TOKEN_WORDS;
  for (const tok of ['bgA', 'bgB', 'ink', 'muted', 'accent', 'accent2']) {
    assert.ok(rows.has(tok), `no row for ${tok}`);
    const [exact, also] = rows.get(tok);
    assert.deepEqual(ticks(exact), SCAN.TOKEN_EXACT[tok], `${tok}: the exact names`);
    for (const w of W[tok]) assert.ok(ticks(also).includes(w), `${tok}: the word ${w} is not in the table`);
  }
  for (const w of W.second) assert.ok(ticks(rows.get('bgB')[1]).includes(w), `bgB: the second-background word ${w}`);
  const never = md.slice(md.indexOf('A name holding `border`'), md.indexOf('is never a token'));
  assert.deepEqual(ticks(never), W.never, 'the names that are never tokens');
  assert.match(md, /A colour whose whole name \(after a leading `--` and `color-`\) is one of\s+a token's exact names wins/);
});
test('R1-10 the kit sheet and the board sheet are always rendered before the full render, and named in the reply', () => {
  const md = read('references/launch.md'), sk = read('SKILL.md');
  const order = md.slice(md.indexOf('## 1. The order'), md.indexOf('## 2.'));
  const at = (x) => order.indexOf(x);
  assert.ok(at('**render the kit sheet** (`node render.mjs brand`)') > 0, 'the order renders the kit sheet');
  assert.ok(at('**Render the board sheet before rendering** (`node render.mjs board --slates`)') > at('`node render.mjs brand`'), 'then the board sheet');
  assert.ok(at('**Render, mix, then `palette` and `check`**') > at('`node render.mjs board --slates`'), 'then the render');
  assert.match(order, /\*\*The two sheets always come before the full render\*\*: `brand\.png` \(`node render\.mjs brand`\) and `board\.png`\s+\(`node render\.mjs board --slates`\), even when nobody can approve them now/);
  assert.match(order, /name both sheets in your reply/);
  const branch = sk.slice(sk.indexOf('**A launch video for a repo**'), sk.indexOf('1. **Pin the brief.**'));
  assert.match(branch, /render the kit\s+sheet \(`node render\.mjs brand`\)/);
  assert.match(branch, /render the board sheet \(`node render\.mjs board --slates`\) before rendering/);
  assert.match(branch, /Both sheets, `brand\.png` and `board\.png`, are always rendered before the full render, even when nobody can approve them\s+now/);
  assert.match(branch, /name both in your reply/);
});
test('R1-11 a launch piece starts from the template, the example is a reference only, and every file stays inside the piece', () => {
  const md = read('references/launch.md'), sk = read('SKILL.md');
  const order = md.slice(md.indexOf('## 1. The order'), md.indexOf('## 2.'));
  assert.match(order, /^0\. \*\*Start the piece from the template\*\*, in the project: `cp -R "\$\{CLAUDE_SKILL_DIR\}\/template" <project>\/motion\/<piece>`/m);
  assert.match(order, /Not from the example: it is a reference only/);
  assert.match(order, /Every file\s+the work makes stays inside the piece, temporary ones included/);
  assert.match(order, /never move or write a file outside the project, to `\/tmp` or anywhere else/);
  assert.match(md, /read it as a\s+reference, never copy it as a starting point/);
  const branch = sk.slice(sk.indexOf('**A launch video for a repo**'), sk.indexOf('1. **Scan**'));
  assert.match(branch, /Start the piece from the template, inside the project; the `repo-launch` example\s+is a reference only, never a starting point\. Every file the work makes stays inside the piece \(temporary ones too\)\./);
});
test('R1 examples/repo-launch/README.md: its commands are the ones run, in their order (doctor, the kit sheet, the board as slates)', () => {
  const md = fs.readFileSync(path.join(examplesDir, 'repo-launch', 'README.md'), 'utf8');
  const block = md.slice(md.indexOf('```sh'), md.indexOf('```', md.indexOf('```sh') + 5));
  const cmds = [...block.matchAll(/^(node \S+ \S+(?: --slates)?)/gm)].map((m) => m[1]);
  assert.deepEqual(cmds, ['node tools/repo-scan.mjs fixture', 'node render.mjs doctor', 'node render.mjs brand', 'node tools/shots.mjs page', 'node render.mjs board --slates',
    'node render.mjs board', 'node render.mjs contact', 'node render.mjs check', 'node render.mjs palette', 'node render.mjs full', 'node tools/mix.mjs repo-launch', 'node render.mjs check']);
});

test('R2-M3 SKILL.md: the examples are starting points except repo-launch, a reference only (start a launch piece from the template)', () => {
  const md = read('SKILL.md');
  const ex = md.slice(md.indexOf('## Examples'), md.indexOf('- `showreel/`'));
  assert.match(ex, /Copy one as a starting point the same way as the template \(`cp -R`, then `chmod -R u\+w`\), except\s+`repo-launch\/`: it is a reference only, and a launch piece starts from the template \(`references\/launch\.md`\)\./);
});
test('R2-M1 references/launch.md and repo-scan.mjs: a global flag alone is not an install command for this package', () => {
  const md = read('references/launch.md'), src = fs.readFileSync(path.join(templateDir, 'tools', 'repo-scan.mjs'), 'utf8');
  const row = md.match(/^\| `install` \|(.+)\|$/m)[1];
  assert.match(row, /that names this package; else the first that sits under an Install-like heading at any level above it/);
  assert.match(row, /another tool's `npm i -g pnpm` from a Development section is never taken/);
  assert.doesNotMatch(row, /installs globally/);
  assert.doesNotMatch(src.slice(0, src.indexOf('import ')), /installs globally|--global/, 'the header no longer names a global flag');
  assert.match(md, /do not sit inside an Install-like section or one that never holds features, such as License, Contributing, Development or Changelog \(`## Installation` > `### npm` is not a feature; `## Usage` > `### Incremental scanning` is\)/);
});
