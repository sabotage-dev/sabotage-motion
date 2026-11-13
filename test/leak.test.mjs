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
import { HOME_PATTERNS, findHits, loadDenylist, mask } from '../scripts/leak.mjs';

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
    const shown = mask(f, list.entries);
    for (const h of findHits(f, list.entries)) if (h.what.startsWith('denylist')) hits.push(`${shown} (path): ${h.what}`);
    for (const h of findHits(text, list.entries)) if (h.what.startsWith('denylist')) hits.push(`${shown}:${lineOf(text, h.index)}: ${h.what}`);
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

// A throwaway repo with a real bare repo as `origin`, so "already published" is what the remote has.
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-leak-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-leak-remote-'));
  scratch.push(dir, bare);
  const opts = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'tag.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'core.hooksPath=/dev/null'];
  const g = (...args) => execFileSync('git', [...opts, ...args], { cwd: dir, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '--bare', bare]);
  g('init', '-q');
  g('remote', 'add', 'origin', bare);
  const commit = (file, text, message = 'change') => {
    if (text === null) fs.rmSync(path.join(dir, file));
    else { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); }
    g('add', '-A');
    g('commit', '-q', '-m', message);
    return g('rev-parse', 'HEAD');
  };
  const markPushed = (sha) => g('push', '-q', '--no-verify', 'origin', `${sha}:refs/heads/main`);
  return { dir, bare, g, commit, markPushed };
}

// Runs the hook as git would for `git push origin <ref>` (remoteSha null = a new ref on the remote).
function prePush(repo, { deny = DENY, ref = 'refs/heads/main', remoteRef = ref, localSha, remoteSha = null, url = repo.bare } = {}) {
  const env = { ...process.env, SM_DENYLIST: deny, SM_DENYLIST_FILE: path.join(repo.dir, 'no-such-denylist.txt') };
  if (!deny) delete env.SM_DENYLIST;
  const zero = '0'.repeat(40);
  const stdin = `${ref} ${localSha} ${remoteRef} ${remoteSha || zero}\n`;
  const r = spawnSync(process.execPath, [leakScript, 'pre-push', 'origin', url], { cwd: repo.dir, input: stdin, encoding: 'utf8', env });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('pre-push: a clean push passes', () => {
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'hello\n');
  const r = prePush(repo, { localSha: sha });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 commit\(s\), 0 tag\(s\), 1 ref name\(s\) clean against 2 denylist entries/);
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

test('pre-push: the denylisted string in a commit message, author, committer or new path blocks the push', () => {
  const commitAs = (repo, env) => {
    fs.writeFileSync(path.join(repo.dir, 'a.txt'), 'y\n');
    repo.g('add', '-A');
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'change'], { cwd: repo.dir, env: { ...process.env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid', ...env } });
    return repo.g('rev-parse', 'HEAD');
  };
  for (const [what, make] of [
    ['message', (repo) => repo.commit('a.txt', 'x\n', `docs: notes for ${LEAK}`)],
    ['path', (repo) => repo.commit(`assets/${LEAK}-logo.txt`, 'x\n')],
    ['author', (repo) => commitAs(repo, { GIT_AUTHOR_NAME: `${LEAK} bot` })],
    ['committer', (repo) => commitAs(repo, { GIT_COMMITTER_EMAIL: `ci@${LEAK}.example` })],
  ]) {
    const repo = scratchRepo();
    const sha = make(repo);
    const r = prePush(repo, { localSha: sha });
    assert.equal(r.code, 1, `${what}: ${r.out}`);
    assert.match(r.out, /denylist entry #2/, what);
    assert.ok(!r.out.toLowerCase().includes(LEAK), `${what}: the entry text must not be printed`);
  }
});

test('pre-push: a path hit prints the path with the entry masked', () => {
  const repo = scratchRepo();
  const sha = repo.commit(`assets/${LEAK}-logo.txt`, 'x\n');
  const r = prePush(repo, { localSha: sha });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`commit ${sha.slice(0, 7)} assets/\\[#2\\]-logo\\.txt \\(path\\): denylist entry #2`));
  assert.ok(!r.out.toLowerCase().includes(LEAK), 'the entry text must not be printed');
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
  assert.match(r.out, /1 commit\(s\), 0 tag\(s\), 1 ref name\(s\) clean/);
});

test('pre-push: a local tracking ref the destination does not have does not exclude anything', () => {
  // origin/main claims the leaky commit is published (say the URL changed since), but the remote is empty.
  const repo = scratchRepo();
  const leaked = repo.commit('a.txt', `${LEAK}\n`);
  repo.g('update-ref', 'refs/remotes/origin/main', leaked);
  const tip = repo.commit('a.txt', 'clean\n');
  const r = prePush(repo, { localSha: tip });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`commit ${leaked.slice(0, 7)} a\\.txt:1: denylist entry #2`));
});

test('pre-push: a branch or tag name with the string blocks the push, masked', () => {
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'x\n');
  repo.markPushed(sha);
  for (const remoteRef of [`refs/heads/${LEAK}-wip`, `refs/tags/${LEAK}`]) {
    const r = prePush(repo, { localSha: sha, remoteRef });
    assert.equal(r.code, 1, `${remoteRef}: ${r.out}`);
    assert.match(r.out, /ref refs\/(heads|tags)\/\[#2\]\S* \(name\): denylist entry #2/);
    assert.ok(!r.out.toLowerCase().includes(LEAK), 'the entry text must not be printed');
  }
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

test('pre-push: a path that first appears in a merge commit blocks the push', () => {
  const repo = scratchRepo();
  const base = repo.commit('a.txt', 'one\n');
  repo.markPushed(base);
  repo.g('checkout', '-q', '-b', 'side');
  repo.commit('s.txt', 'side\n');
  repo.g('checkout', '-q', 'main');
  repo.commit('m.txt', 'main\n');
  repo.g('merge', '-q', '--no-ff', '--no-commit', 'side');
  fs.mkdirSync(path.join(repo.dir, 'assets'));
  fs.writeFileSync(path.join(repo.dir, 'assets', `${LEAK}-logo.txt`), 'x\n');   // clean content, private name
  repo.g('add', '-A');
  repo.g('commit', '-q', '-m', 'merge side');
  const merge = repo.g('rev-parse', 'HEAD');
  const r = prePush(repo, { localSha: merge, remoteSha: base });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`commit ${merge.slice(0, 7)} assets/\\[#2\\]-logo\\.txt \\(path\\): denylist entry #2`));
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

test('pre-push: every tag object in a pushed tag\'s chain is checked, not only the outermost', () => {
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'x\n');
  repo.markPushed(sha);
  repo.g('tag', '-a', 'v1', '-m', `release for ${LEAK}`);
  const inner = repo.g('rev-parse', 'v1');
  repo.g('tag', '-a', 'latest', '-m', 'clean', 'v1');
  const r = prePush(repo, { ref: 'refs/tags/latest', localSha: repo.g('rev-parse', 'latest') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`tag ${inner.slice(0, 7)}: denylist entry #2`));
});

test('pre-push: a tag that points at a blob or a tree has that content checked', () => {
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'x\n');
  repo.markPushed(sha);
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo.dir, input: `notes ${LEAK}\n`, encoding: 'utf8' }).trim();
  repo.g('tag', '-a', 'blobtag', '-m', 'clean', blob);
  let r = prePush(repo, { ref: 'refs/tags/blobtag', localSha: repo.g('rev-parse', 'blobtag') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`blob ${blob.slice(0, 7)}: denylist entry #2`));

  const tree = execFileSync('git', ['mktree'], { cwd: repo.dir, input: `100644 blob ${blob}\tnotes.txt\n`, encoding: 'utf8' }).trim();
  repo.g('tag', '-a', 'treetag', '-m', 'clean', tree);
  r = prePush(repo, { ref: 'refs/tags/treetag', localSha: repo.g('rev-parse', 'treetag') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`tree ${tree.slice(0, 7)} notes\\.txt: denylist entry #2`));
});

test('history: checks tag objects and ref names as well as commits', () => {
  const runHistory = (repo) => {
    const r = spawnSync(process.execPath, [leakScript, 'history'], { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, SM_DENYLIST: DENY } });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const repo = scratchRepo();
  repo.commit('a.txt', 'x\n');
  assert.equal(runHistory(repo).code, 0);
  repo.g('tag', '-a', 'v1', '-m', `release for ${LEAK}`);
  let r = runHistory(repo);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /tag [0-9a-f]{7}: denylist entry #2/);
  repo.g('tag', '-d', 'v1');
  repo.g('branch', `${LEAK}-wip`);
  r = runHistory(repo);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ref refs\/heads\/\[#2\]-wip \(name\): denylist entry #2/);
});

test('pre-push: with no denylist the push is blocked, not waved through', () => {
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'hello\n');
  const r = prePush(repo, { deny: null, localSha: sha });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no denylist at .*no-such-denylist\.txt, so nothing is pushed/);
});

test('pre-push: a git failure blocks the push and prints its error with the entries masked', () => {
  // The remote cannot be reached and its URL holds an entry: git's error names the URL.
  const repo = scratchRepo();
  const sha = repo.commit('a.txt', 'x\n');
  const r = prePush(repo, { localSha: sha, url: path.join(repo.dir, `no-such-${LEAK}-remote.git`) });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /leak check: failed, so nothing is pushed/);
  assert.match(r.out, /no-such-\[#2\]-remote/);
  assert.ok(!r.out.toLowerCase().includes(LEAK), 'the entry text must not be printed');
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
  const samples = [['macOS home', HOME], ['Linux home', '/' + 'ho' + 'me/' + 'someone/x'],
    ['Windows home', 'C:\\' + 'Us' + 'ers\\someone'], ['macOS temp dir', '/' + 'priv' + 'ate/tmp/x'],
    ['macOS temp dir', '/' + 'priv' + 'ate/var/x'], ['macOS temp dir', '/var/' + 'fol' + 'ders/ab/x']];
  for (const [kind, sample] of samples) {
    assert.ok(findHits(sample, null).some((h) => h.what === kind), `${kind}: ${sample}`);
  }
  assert.equal(HOME_PATTERNS.length, 5);
});
