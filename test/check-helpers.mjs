// Helpers for the check suites: fixture-check voiced by a synthetic take (tone bursts for words; nothing here
// is a real recording), a measured copy of the tiktok zone for the FAIL paths, and render.mjs check --json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { templateDir } from './helpers.mjs';
import { synthTake, voicePiece, runCues } from './voice-helpers.mjs';

export const C = await import(pathToFileURL(path.join(templateDir, 'check.mjs')).href);

// The take: the hook line from 0.0 s, a 0.8 s pause, the save line. With the board's three silent beats between
// the lines (10.4 s of zeros spliced at 2.3 s) and VO_OFFSET 1.1 it gives the windows in fixture-check/board.js.
export const TAKE = [
  ['Stop', 0.0, 0.25], ['pasting', 0.3, 0.65], ['the', 0.7, 0.8], ['same', 0.85, 1.1], ['prompt.', 1.15, 1.6],
  ['Save', 2.4, 2.65], ['it', 2.7, 2.8], ['as', 2.85, 2.95], ['a', 3.0, 3.05], ['skill', 3.1, 3.5], ['instead.', 3.55, 4.1],
];
export const WINDOWS = { open: [0, 1.0], hook: [1.0, 3.4], drift: [3.4, 6.6], freeze: [6.6, 10.6], dot: [10.6, 13.8], save: [13.8, 16.0], end: [16.0, 19.2] };
export const DUR = 19.2;

// The tiktok rectangle as a measured target, so text_safe can FAIL (every shipped zone is still an estimate).
export function addMeasuredTarget(dir, name = 'fixture') {
  const f = path.join(dir, 'safezones.json'), z = JSON.parse(fs.readFileSync(f, 'utf8'));
  z.targets[name] = { ...z.targets.tiktok, estimate: false, measured: '2026-11-14', source: 'the check suite: the tiktok rectangle, marked measured' };
  if (z.targets[name].edges) for (const e of Object.values(z.targets[name].edges)) Object.assign(e, { estimate: false, measured: '2026-11-14' });
  fs.writeFileSync(f, JSON.stringify(z, null, 2));
}

// fixture-check with the take voiced into cues.js, and the measured target.
export function checkPiece(name) {
  const { json, audio } = synthTake(TAKE, 4.4);
  const dir = voicePiece(name, { take: json, audio, fixture: 'fixture-check' });
  const c = runCues(dir);
  if (c.status !== 0) throw new Error(`cues.mjs failed:\n${c.out}`);
  addMeasuredTarget(dir);
  return dir;
}

// node render.mjs check <args> --json in a piece: { status, results, out }.
export function runCheck(dir, args = [], { json = true } = {}) {
  const r = spawnSync(process.execPath, ['render.mjs', 'check', ...args, ...(json ? ['--json'] : [])], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
  let results = null;
  if (json) { try { results = JSON.parse(r.stdout); } catch { results = null; } }
  return { status: r.status, results, out: (r.stdout || '') + (r.stderr || ''), stderr: r.stderr || '' };
}
export const byId = (results, id) => results.filter((x) => x.id === id);
export const one = (results, id) => { const xs = byId(results, id); if (xs.length !== 1) throw new Error(`expected one ${id} result, got ${xs.length}: ${JSON.stringify(xs)}`); return xs[0]; };
