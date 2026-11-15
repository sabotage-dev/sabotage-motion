// The skill text (plan section 14): SKILL.md's frontmatter and description, the five references it names, and the
// safe-zone table in references/delivery.md, which must equal safezones.json (plan 12: the guide and the check
// never disagree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
