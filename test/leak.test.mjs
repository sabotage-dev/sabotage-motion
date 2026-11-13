// Leak test: no file the repo publishes may contain a private home-directory path or any string
// from the owner's denylist.
//
// SM_DENYLIST holds the denylist: newline-separated strings, matched case-insensitively against the
// contents and the path of every tracked file. It is never committed. In CI it comes from the
// SM_DENYLIST Actions secret: when the secret is missing the test FAILS, except on a pull request
// from a fork (secrets are not available there), where it writes "skipped: no denylist" to the job
// summary. Run locally without it, the denylist part is skipped with a note.
//
// Hits are reported as file:line and the entry's number, never the entry's text, so a CI log does
// not republish the denylist. The home-path patterns are assembled from parts so this file does not
// match itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, repoFiles } from './helpers.mjs';

const S = '/';
const NAME = '[A-Za-z0-9._-]+';
const HOME_PATTERNS = [
  ['macOS home', new RegExp(S + 'Us' + 'ers' + S + NAME + S)],
  ['Linux home', new RegExp(S + 'ho' + 'me' + S + NAME + S)],
  ['Windows home', new RegExp('[A-Za-z]:\\\\' + 'Us' + 'ers' + '\\\\', 'i')],
  ['macOS temp dir', new RegExp(S + 'priv' + 'ate' + S + '(tmp|var)' + S)],
  ['macOS temp dir', new RegExp(S + 'var' + S + 'fol' + 'ders' + S)],
];

const files = repoFiles();
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

test('the file list is not empty', () => {
  assert.ok(files.length > 10, `only ${files.length} files found`);
});

test('no file contains an absolute home or temp path', () => {
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(repoRoot, f)).toString('utf8');
    for (const [kind, re] of HOME_PATTERNS) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of text.matchAll(g)) hits.push(`${f}:${lineOf(text, m.index)} (${kind})`);
    }
  }
  assert.deepEqual(hits, [], `absolute paths found (the matched text is not printed):\n${hits.join('\n')}`);
});

test('no file contains a denylisted string', (t) => {
  const entries = (process.env.SM_DENYLIST || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const inCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
  if (!entries.length) {
    if (inCI && process.env.SM_FORK_PR === 'true') {
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Leak test\n\nskipped: no denylist (pull request from a fork; the SM_DENYLIST secret is not available)\n');
      t.skip('skipped: no denylist (pull request from a fork)');
      return;
    }
    if (inCI) assert.fail('SM_DENYLIST is empty: add the SM_DENYLIST Actions secret (newline-separated strings) to run the leak test');
    t.skip('skipped: no denylist (set SM_DENYLIST to run it locally)');
    return;
  }
  const lower = entries.map((e) => e.toLowerCase());
  const hits = [];
  for (const f of files) {
    const name = f.toLowerCase();
    const text = fs.readFileSync(path.join(repoRoot, f)).toString('utf8').toLowerCase();
    lower.forEach((e, i) => {
      if (name.includes(e)) hits.push(`${f} (path): denylist entry #${i + 1}`);
      let at = text.indexOf(e);
      while (at >= 0) { hits.push(`${f}:${lineOf(text, at)}: denylist entry #${i + 1}`); at = text.indexOf(e, at + e.length); }
    });
  }
  assert.deepEqual(hits, [], `denylisted strings found (entries are numbered, not printed):\n${hits.join('\n')}`);
  t.diagnostic(`${files.length} files checked against ${entries.length} entries`);
});
