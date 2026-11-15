// The looks sheet (plan 23.2): one 5 s card in every look, each a copy of the template with that look's fonts, its
// name as the title and what it is for as the subtitle. Every card must pass `node render.mjs check` with no FAIL
// and no WARN; then one frame of each is tiled into docs/media/looks.png for the README.
//
//   node scripts/looks-sheet.mjs            check every card, then write docs/media/looks.png
//   node scripts/looks-sheet.mjs --check    check every card only
//
// The cards are built under test/.work/looks/<look>/ (ignored), inside the repo so render.mjs finds playwright-core.
// test/looks.test.mjs checks the cards the same way, through cardPiece() and checkCard() below.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const skillDir = path.join(repoRoot, 'skills', 'sabotage-motion');
const templateDir = path.join(skillDir, 'template');
const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
export const LOOK_NAMES = LK.LOOK_NAMES;
export const CARD = { dur: 5, out: 0.55, key: 2.6, scale: 0.25 };

// The card's copy: the look's label and what it is for. The board says the same, so check's copy checks pass.
export const cardCopy = (look) => ({ title: LK.LOOKS[look].label, sub: LK.LOOKS[look].about });
export const cardParams = (look) => { const c = cardCopy(look); return ['--param', `look=${look}`, '--param', `title=${c.title}`, '--param', `sub=${c.sub}`]; };

// A card piece for a look: the template, the look's font files and licences copied in from looks/fonts/ (as the skill
// tells the agent to), and a 5 s board.
export function cardPiece(look, dir = path.join(repoRoot, 'test', '.work', 'looks', look)) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(templateDir, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('node_modules') });
  for (const f of LK.lookFiles(look)) fs.copyFileSync(path.join(skillDir, 'looks', 'fonts', f), path.join(dir, 'fonts', f));
  const c = cardCopy(look);
  fs.writeFileSync(path.join(dir, 'board.js'), `// The looks sheet's card for the ${look} look (scripts/looks-sheet.mjs).
export const BOARD = {
  title: ${JSON.stringify(c.title)},
  target: 'tiktok',
  beats: [
    { id: 'title', dur: ${(CARD.dur - CARD.out).toFixed(2)}, on: [${JSON.stringify(c.title)}, ${JSON.stringify(c.sub)}],
      look: 'the template card in the ${look} look', sfx: 'whooshes and ticks in the look\\'s timbre' },
    { id: 'out', dur: ${CARD.out.toFixed(2)}, on: [], look: 'everything leaves', sfx: 'a falling whoosh' },
  ],
};
`);
  return dir;
}

const node = (dir, args) => spawnSync(process.execPath, ['render.mjs', ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
// `check` on a card, as JSON: { status, results, out }.
export function checkCard(look, dir) {
  const r = node(dir, ['check', '--json', ...cardParams(look)]);
  let results = null;
  try { results = JSON.parse(r.stdout); } catch { /* reported below */ }
  return { status: r.status, results, out: (r.stdout || '') + (r.stderr || '') };
}

async function main() {
  const only = process.argv.includes('--check');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looks-sheet-'));
  let bad = 0;
  const frames = [];
  for (const [i, look] of LOOK_NAMES.entries()) {
    const dir = cardPiece(look);
    const c = checkCard(look, dir);
    const counts = { FAIL: 0, WARN: 0, OK: 0, SKIP: 0 };
    for (const x of c.results || []) counts[x.level]++;
    const ok = c.results && counts.FAIL === 0 && counts.WARN === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${look.padEnd(10)} check: ${counts.FAIL} FAIL, ${counts.WARN} WARN, ${counts.OK} ok, ${counts.SKIP} not checked`);
    if (!ok) for (const x of c.results || []) if (x.level === 'FAIL' || x.level === 'WARN') console.log(`      ${x.level} ${x.id}: ${x.detail}`);
    if (!c.results) console.log(c.out.slice(-2000));
    if (only) continue;
    const s = node(dir, ['stills', String(CARD.key), '--scale', String(CARD.scale), '--dir', 'stills', ...cardParams(look)]);
    if (s.status !== 0) { bad++; console.log(s.stdout + s.stderr); continue; }
    const f = path.join(dir, 'stills', `t${CARD.key.toFixed(3).padStart(6, '0')}.png`);
    const to = path.join(tmp, `f${String(i).padStart(3, '0')}.png`);
    fs.copyFileSync(f, to);
    frames.push(to);
  }
  if (bad) { console.error(`looks sheet: ${bad} card${bad > 1 ? 's' : ''} failed; no sheet written`); process.exit(1); }
  if (only) return;
  // four across, two down, on the template's dark grey; a 64-colour palette keeps the PNG small
  const out = path.join(repoRoot, 'docs', 'media', 'looks.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(tmp, 'f%03d.png'),
    '-filter_complex', 'tile=4x2:padding=12:margin=12:color=0x18181C,split[a][b];[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none',
    '-frames:v', '1', out], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`wrote ${path.relative(repoRoot, out)} (${fs.statSync(out).size} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
