// Asset inventory: ASSETS.md lists every binary file in the repo (fonts, audio, images, video,
// frame sequences) with its source and licence. Fails on a binary that is not listed, and on a
// listed file that is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, repoFiles } from './helpers.mjs';

const BINARY_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.mp4', '.mov', '.webm', '.mkv', '.pdf', '.zip', '.gz', '.tgz']);
const isBinary = (f) => {
  if (BINARY_EXT.has(path.extname(f).toLowerCase())) return true;
  const fd = fs.openSync(path.join(repoRoot, f), 'r');
  const buf = Buffer.alloc(8000);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return buf.subarray(0, n).includes(0);
};

// Rows of the form | `path` | source | licence |
function inventory() {
  const md = fs.readFileSync(path.join(repoRoot, 'ASSETS.md'), 'utf8');
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    rows.push({ file: m[1], source: cells[0] || '', licence: cells[1] || '' });
  }
  return rows;
}

test('ASSETS.md exists and lists at least one file', () => {
  assert.ok(fs.existsSync(path.join(repoRoot, 'ASSETS.md')), 'ASSETS.md is missing');
  assert.ok(inventory().length > 0, 'ASSETS.md has no rows of the form | `path` | source | licence |');
});

test('every binary file is listed in ASSETS.md', () => {
  const listed = new Set(inventory().map((r) => r.file));
  const missing = repoFiles().filter(isBinary).filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `binary files not listed in ASSETS.md:\n${missing.join('\n')}`);
});

test('every file listed in ASSETS.md exists, with a source and a licence', () => {
  const problems = [];
  for (const r of inventory()) {
    if (!fs.existsSync(path.join(repoRoot, r.file))) problems.push(`${r.file}: listed but missing`);
    if (!r.source) problems.push(`${r.file}: no source`);
    if (!r.licence) problems.push(`${r.file}: no licence`);
  }
  assert.deepEqual(problems, []);
});
