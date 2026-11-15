// The skill text (plan section 14): SKILL.md's frontmatter and description, the five references it names, and the
// safe-zone table in references/delivery.md, which must equal safezones.json (plan 12: the guide and the check
// never disagree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
