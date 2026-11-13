// Leak test. The working tree: no file the repo publishes may contain a private home-directory path (always
// checked; this is what CI runs) or a string from the owner's denylist (checked when a denylist is found:
// SM_DENYLIST, or the file scripts/leak.mjs names; never committed, never on GitHub).
//
// The pre-push check in scripts/leak.mjs, which is where the denylist really runs, is tested here against
// throwaway repos with a made-up denylist, so CI tests it without the real one.
//
// Hits are reported as file:line and the entry's number, never the entry's text. Home paths in this file are
// assembled from parts so that it does not match itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { repoRoot, repoFiles } from './helpers.mjs';
import { HOME_PATTERNS, findHits, loadDenylist } from '../scripts/leak.mjs';

const files = repoFiles();
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

test('the file list is not empty', () => {
  assert.ok(files.length > 10, `only ${files.length} files found`);
});

test('no file contains an absolute home or temp path', () => {
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(repoRoot, f)).toString('utf8');
    for (const h of findHits(text, null)) hits.push(`${f}:${lineOf(text, h.index)} (${h.what})`);
  }
  assert.deepEqual(hits, [], `absolute paths found (the matched text is not printed):\n${hits.join('\n')}`);
});

test('no file contains a denylisted string', (t) => {
  const list = loadDenylist();
  if (!list) {
    t.skip('skipped: no denylist here (it lives only on the owner\'s machine; the pre-push hook checks it)');
    return;
  }
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(repoRoot, f)).toString('utf8');
    for (const h of findHits(f, list.entries)) if (h.what.startsWith('denylist')) hits.push(`${f} (path): ${h.what}`);
    for (const h of findHits(text, list.entries)) if (h.what.startsWith('denylist')) hits.push(`${f}:${lineOf(text, h.index)}: ${h.what}`);
  }
  assert.deepEqual(hits, [], `denylisted strings found (entries are numbered, not printed):\n${hits.join('\n')}`);
  t.diagnostic(`${files.length} files checked against ${list.entries.length} entries`);
});

// ---- the pre-push check, on throwaway repos ----

const LEAK = 'zq-made-up-brand';           // entry #2 of the made-up denylist
const DENY = `zq-unused-entry\n${LEAK}\n`;
const HOME = '/' + 'Us' + 'ers/' + 'someone/project/x.txt';
const leakScript = path.join(repoRoot, 'scripts', 'leak.mjs');

const scratch = [];
after(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });

function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-leak-'));
  scratch.push(dir);
  const g = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q');
  const commit = (file, text, message = 'change') => {
    if (text === null) fs.rmSync(path.join(dir, file));
    else { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); }
    g('add', '-A');
    g('commit', '-q', '-m', message);
    return g('rev-parse', 'HEAD');
  };
  const markPushed = (sha) => g('update-ref', 'refs/remotes/origin/main', sha);
  return { dir, g, commit, markPushed };
}

// Runs the hook as git would for `git push origin main` from `fromSha` (null = a new branch).
function prePush(repo, { deny = DENY, ref = 'refs/heads/main', localSha, remoteSha = null } = {}) {
  const env = { ...process.env, SM_DENYLIST: deny, SM_DENYLIST_FILE: path.join(repo.dir, 'no-such-denylist.txt') };
  if (!deny) delete env.SM_DENYLIST;
  const zero = '0'.repeat(40);
  const stdin = `${ref} ${localSha} ${ref} ${remoteSha || zero}\n`;
  const r = spawnSync(process.execPath, [leakScript, 'pre-push', 'origin', 'https://example.invalid/x.git'], { cwd: repo.dir, input: stdin, encoding: 'utf8', env });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('pre-push: a clean push passes', () => {
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'hello\n');
  const r = prePush(repo, { localSha: sha });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 commit\(s\) clean against 2 denylist entries/);
});

test('pre-push: an added line with a denylisted string blocks the push, named by number, not text', () => {
  const repo = scratchRepo();
  repo.commit('a.txt', 'hello\nworld\n');
  const sha = repo.commit('a.txt', `hello\nmade by ${LEAK.toUpperCase()} studio\n`);   // line 2 replaced
  const r = prePush(repo, { localSha: sha });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`commit ${sha.slice(0, 7)} a\\.txt:2: denylist entry #2`));
  assert.ok(!r.out.toLowerCase().includes(LEAK), 'the entry text must not be printed');
});

test('pre-push: the denylisted string in a commit message, an author name or a new path blocks the push', () => {
  for (const [what, make] of [
    ['message', (repo) => repo.commit('a.txt', 'x\n', `docs: notes for ${LEAK}`)],
    ['path', (repo) => repo.commit(`assets/${LEAK}-logo.txt`, 'x\n')],
    ['author', (repo) => { fs.writeFileSync(path.join(repo.dir, 'a.txt'), 'y\n'); repo.g('add', '-A');
      repo.g('-c', `user.name=${LEAK} bot`, 'commit', '-q', '-m', 'change'); return repo.g('rev-parse', 'HEAD'); }],
  ]) {
    const repo = scratchRepo();
    const sha = make(repo);
    const r = prePush(repo, { localSha: sha });
    assert.equal(r.code, 1, `${what}: ${r.out}`);
    assert.match(r.out, /denylist entry #2/, what);
  }
});

test('pre-push: a file marked binary in .gitattributes is still checked, and so are binary files', () => {
  const repo = scratchRepo();
  repo.commit('.gitattributes', '*.txt binary\n');
  const sha = repo.commit('notes.txt', `hello ${LEAK}\n`);
  const r = prePush(repo, { localSha: sha });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /notes\.txt:1: denylist entry #2/);

  const repo2 = scratchRepo();
  const bin = Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`\nauthor ${LEAK}\n`), Buffer.from([0, 255])]);
  fs.writeFileSync(path.join(repo2.dir, 'img.bin'), bin);
  repo2.g('add', '-A');
  repo2.g('commit', '-q', '-m', 'binary');
  const r2 = prePush(repo2, { localSha: repo2.g('rev-parse', 'HEAD') });
  assert.equal(r2.code, 1, r2.out);
  assert.match(r2.out, /img\.bin:\d+: denylist entry #2/);
});

test('pre-push: a path with a tab or quote in it is still checked', () => {
  const repo = scratchRepo();
  const sha = repo.commit(`odd\t"${LEAK}".txt`, 'x\n');
  const r = prePush(repo, { localSha: sha });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\(path\): denylist entry #2/);
});

test('pre-push: an absolute home path blocks the push without any denylist entry for it', () => {
  const repo = scratchRepo();
  const sha = repo.commit('notes.md', `see ${HOME}\n`);
  const r = prePush(repo, { localSha: sha });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /notes\.md:1: macOS home/);
});

test('pre-push: commits already on the remote are not checked again, and a commit that removes a leak can be pushed', () => {
  const repo = scratchRepo();
  const leaked = repo.commit('a.txt', `${LEAK}\n`);
  repo.markPushed(leaked);
  const fix = repo.commit('a.txt', 'fixed\n');
  const r = prePush(repo, { localSha: fix, remoteSha: leaked });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 commit\(s\) clean/);
});

test('pre-push: a leak hidden in an earlier commit of the same push still blocks it', () => {
  const repo = scratchRepo();
  const base = repo.commit('a.txt', 'base\n');
  repo.markPushed(base);
  repo.commit('a.txt', `base\n${LEAK}\n`);
  const tip = repo.commit('a.txt', 'base\n');
  const r = prePush(repo, { localSha: tip, remoteSha: base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /2 commit\(s\)/);
});

test('pre-push: a leak introduced by a merge itself blocks the push', () => {
  const repo = scratchRepo();
  repo.commit('a.txt', 'one\ntwo\n');
  const base = repo.commit('b.txt', 'one\ntwo\n');
  repo.markPushed(base);
  repo.g('checkout', '-q', '-b', 'side');
  repo.commit('a.txt', 'one\nTWO\n');
  repo.commit('b.txt', 'one\nTWO\n');
  repo.g('checkout', '-q', 'main');
  repo.commit('a.txt', 'ONE\ntwo\n');
  repo.commit('b.txt', 'ONE\ntwo\n');
  // Merge with hand-edited results that match neither parent: the combined diff shows them. The leak is in
  // the second file, so the report must name that file.
  try { repo.g('merge', '-q', '--no-ff', '--no-commit', 'side'); } catch { /* conflict is fine */ }
  fs.writeFileSync(path.join(repo.dir, 'a.txt'), 'ONE\nTWO\n');
  fs.writeFileSync(path.join(repo.dir, 'b.txt'), `ONE\nTWO\n${LEAK}\n`);
  repo.g('add', '-A');
  repo.g('commit', '-q', '-m', 'merge side');
  const merge = repo.g('rev-parse', 'HEAD');
  const r = prePush(repo, { localSha: merge, remoteSha: base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`commit ${merge.slice(0, 7)} b\\.txt:3: denylist entry #2`));
});

test('pre-push: an annotated tag whose message has the string blocks the push', () => {
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'x\n');
  repo.markPushed(sha);
  repo.g('tag', '-a', 'v1', '-m', `release for ${LEAK}`);
  const tag = repo.g('rev-parse', 'v1');
  const r = prePush(repo, { ref: 'refs/tags/v1', localSha: tag });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /tag [0-9a-f]{7}: denylist entry #2/);
});

test('pre-push: with no denylist the push is blocked, not waved through', () => {
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'hello\n');
  const r = prePush(repo, { deny: null, localSha: sha });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no denylist at .*no-such-denylist\.txt, so nothing is pushed/);
});

test('pre-push: a branch delete publishes nothing and passes', () => {
  const repo = scratchRepo();
  repo.commit('a.txt', `${LEAK}\n`);
  const r = prePush(repo, { localSha: '0'.repeat(40) });
  assert.equal(r.code, 0, r.out);
});

test('the hook in .githooks runs this check and is executable', () => {
  const hook = path.join(repoRoot, '.githooks', 'pre-push');
  assert.ok(fs.statSync(hook).mode & 0o111, 'pre-push is not executable');
  assert.match(fs.readFileSync(hook, 'utf8'), /scripts\/leak\.mjs" pre-push "\$@"/);
});

test('the home-path patterns cover each kind', () => {
  const samples = { 'macOS home': HOME, 'Linux home': '/' + 'ho' + 'me/' + 'someone/x', 'Windows home': 'C:\\' + 'Us' + 'ers\\someone' };
  for (const [kind, sample] of Object.entries(samples)) {
    assert.ok(findHits(sample, null).some((h) => h.what === kind), kind);
  }
  assert.equal(HOME_PATTERNS.length, 5);
});
