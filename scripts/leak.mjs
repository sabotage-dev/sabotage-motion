// Leak check: nothing this repo publishes may contain a private home-directory path or any string from
// the owner's denylist (brand names, private paths, the owner's voice id).
//
// The denylist is never committed and never stored on GitHub. It is a plain file on the owner's machine,
// one string per line, matched case-insensitively: $SM_DENYLIST_FILE, or else
// ~/.config/sabotage-motion/denylist.txt ($XDG_CONFIG_HOME/sabotage-motion/denylist.txt when that is set).
// SM_DENYLIST, the strings themselves (newline-separated), overrides the file; the tests use it.
//
//   node scripts/leak.mjs pre-push <remote> [url]   the git pre-push hook (.githooks/pre-push). Checks
//       everything the push would publish that the destination does not already have: each commit's message,
//       author and committer, the paths that are new in it (merges included) and the lines it adds; every
//       tag object in a pushed tag's chain; a tag's tree or blob; the ref names being created or updated.
//       Removed lines are not checked, so a commit that removes a leak can be pushed. Blocks the push on any
//       hit, and when no denylist is found.
//   node scripts/leak.mjs history                    the same check over every commit, tag and ref name here.
//
// "Already published" means reachable from a ref the destination advertises right now (git ls-remote), not
// from the local remote-tracking refs, which can be stale or describe a different URL.
//
// test/leak.test.mjs checks the files in the working tree: home paths always (that is what CI runs), the
// denylist when one is found. Hits print as where they are plus the entry's number, never the entry's text:
// a path or ref name that contains an entry prints with the entry replaced by [#N]. The home-path patterns
// are assembled from parts so that this file does not match itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const S = '/';
const NAME = '[A-Za-z0-9._-]+';
export const HOME_PATTERNS = [
  ['macOS home', new RegExp(S + 'Us' + 'ers' + S + NAME + S)],
  ['Linux home', new RegExp(S + 'ho' + 'me' + S + NAME + S)],
  ['Windows home', new RegExp('[A-Za-z]:\\\\' + 'Us' + 'ers' + '\\\\', 'i')],
  ['macOS temp dir', new RegExp(S + 'priv' + 'ate' + S + '(tmp|var)' + S)],
  ['macOS temp dir', new RegExp(S + 'var' + S + 'fol' + 'ders' + S)],
];

export function denylistPath(env = process.env) {
  if (env.SM_DENYLIST_FILE) return env.SM_DENYLIST_FILE;
  const config = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(config, 'sabotage-motion', 'denylist.txt');
}

const parseEntries = (text) => text.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean);

// The denylist entries, lower-cased, or null when there is none. `from` says where they came from.
export function loadDenylist(env = process.env) {
  if (env.SM_DENYLIST && env.SM_DENYLIST.trim()) return { entries: parseEntries(env.SM_DENYLIST), from: 'SM_DENYLIST' };
  const file = denylistPath(env);
  if (!fs.existsSync(file)) return null;
  const entries = parseEntries(fs.readFileSync(file, 'utf8'));
  return entries.length ? { entries, from: file } : null;
}

// Every hit in one piece of text: [{ index, what }], where `what` names the pattern or the entry number.
export function findHits(text, entries) {
  const hits = [];
  for (const [kind, re] of HOME_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags + 'g'))) hits.push({ index: m.index, what: kind });
  }
  if (entries) {
    const lower = text.toLowerCase();
    entries.forEach((e, i) => {
      for (let at = lower.indexOf(e); at >= 0; at = lower.indexOf(e, at + e.length)) hits.push({ index: at, what: `denylist entry #${i + 1}` });
    });
  }
  return hits;
}

// A name safe to print: each denylist entry in it replaced by [#N].
export function mask(name, entries) {
  let out = String(name);
  (entries || []).forEach((e, i) => {
    out = out.replace(new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `[#${i + 1}]`);
  });
  return out;
}

const git = (args, cwd, input) => execFileSync('git', ['-c', 'core.quotePath=false', ...args],
  { cwd, encoding: 'utf8', maxBuffer: 256 << 20, ...(input === undefined ? {} : { input }) });

const typeOf = (oid, cwd) => git(['cat-file', '-t', oid], cwd).trim();
const treePaths = (rev, cwd) => git(['ls-tree', '-r', '-z', '--full-tree', '--name-only', rev], cwd).split('\0').filter(Boolean);

// The hits in one commit: identity and message, paths that are new in it, added lines.
export function checkCommit(sha, entries, cwd) {
  const short = sha.slice(0, 7);
  const out = [];
  const meta = git(['show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%B', sha], cwd);
  for (const h of findHits(meta, entries)) out.push(`commit ${short} (message, author or committer): ${h.what}`);

  // New paths: in this commit's tree and in no parent's. This covers merges, which diff-tree's name-status
  // leaves out, and renames (the new name is new).
  const parents = git(['rev-list', '--parents', '-n', '1', sha], cwd).trim().split(' ').slice(1);
  const before = new Set(parents.flatMap((p) => treePaths(p, cwd)));
  for (const p of treePaths(sha, cwd)) {
    if (before.has(p)) continue;
    for (const h of findHits(p, entries)) out.push(`commit ${short} ${mask(p, entries)} (path): ${h.what}`);
  }

  // -U0 keeps only changed lines; a hunk header gives the new file's line number for the lines that follow.
  // A merge shows as a combined diff (git show's default): only what the merge itself changed, with one
  // prefix column per parent and a hunk header of one more '@' than there are parents. --text and
  // --no-textconv show every file's real bytes, so a .gitattributes rule (binary, -diff, a textconv driver)
  // cannot hide a file's content, and strings inside binary files are checked too.
  const patch = git(['show', '--format=', '-M', '-U0', '--text', '--no-textconv', '--no-color', '--no-ext-diff',
    '--src-prefix=a/', '--dst-prefix=b/', sha], cwd);
  const HUNK = /^(@{2,}) (?:-\d+(?:,\d+)? )+\+(\d+)(?:,\d+)? @{2,}/;
  let file = null;
  let cols = 0;   // 0 = in a file header, not a hunk
  let lineNo = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      cols = 0; file = null; continue;
    }
    const m = HUNK.exec(line);
    if (m) { cols = m[1].length - 1; lineNo = Number(m[2]); continue; }
    if (!cols) {
      if (line.startsWith('+++ ')) file = line === '+++ /dev/null' ? null : line.slice(4).replace(/^b\//, '');
      continue;
    }
    const prefix = line.slice(0, cols);
    if (prefix.includes('-') || prefix.length < cols || prefix.startsWith('\\')) continue;   // removed, or "\ No newline"
    if (prefix.includes('+')) {
      for (const h of findHits(line.slice(cols), entries)) out.push(`commit ${short} ${mask(file, entries)}:${lineNo}: ${h.what}`);
    }
    lineNo++;
  }
  return out;
}

// The hits in a tree or blob that a tag points at directly (no commit around it).
function checkTreeOrBlob(oid, type, entries, cwd) {
  const short = oid.slice(0, 7);
  const out = [];
  const scanBlob = (b, where) => {
    for (const h of findHits(git(['cat-file', 'blob', b], cwd), entries)) out.push(`${where}: ${h.what}`);
  };
  if (type === 'blob') { scanBlob(oid, `blob ${short}`); return out; }
  for (const rec of git(['ls-tree', '-r', '-z', '--full-tree', oid], cwd).split('\0').filter(Boolean)) {
    const [info, p] = [rec.slice(0, rec.indexOf('\t')), rec.slice(rec.indexOf('\t') + 1)];
    const [, kind, b] = info.split(' ');
    for (const h of findHits(p, entries)) out.push(`tree ${short} ${mask(p, entries)} (path): ${h.what}`);
    if (kind === 'blob') scanBlob(b, `tree ${short} ${mask(p, entries)}`);
  }
  return out;
}

// What the destination already has: the commits its advertised refs point at, when they exist here
// (ls-remote also lists each annotated tag's peeled commit as <tag>^{}).
export function publishedTips(dest, cwd) {
  const oids = [...new Set(git(['ls-remote', dest], cwd).split('\n').map((l) => l.split('\t')[0]).filter((o) => /^[0-9a-f]{40,64}$/.test(o)))];
  if (!oids.length) return [];
  return git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], cwd, oids.join('\n') + '\n')
    .split('\n').filter((l) => l.endsWith(' commit')).map((l) => l.split(' ')[0]);
}

// Everything a push publishes, from the lines git writes to the hook's stdin:
// "<local ref> <local oid> <remote ref> <remote oid>".
export function objectsToPush(stdin, dest, cwd) {
  const have = publishedTips(dest, cwd);
  const commits = new Set();
  const tags = new Set();
  const loose = [];   // [oid, 'tree' | 'blob'] reached through a tag
  const refs = [];
  for (const line of stdin.split('\n')) {
    const [, localOid, remoteRef] = line.trim().split(/\s+/);
    if (!localOid || /^0+$/.test(localOid)) continue;   // a delete publishes nothing
    if (remoteRef) refs.push(remoteRef);
    // Every tag object in the chain is published, not only the outermost one.
    let oid = localOid;
    let type = typeOf(oid, cwd);
    while (type === 'tag') {
      tags.add(oid);
      oid = /^object ([0-9a-f]+)$/m.exec(git(['cat-file', 'tag', oid], cwd))[1];
      type = typeOf(oid, cwd);
    }
    if (type === 'commit') {
      for (const sha of git(['rev-list', oid, '--not', ...have, '--'], cwd).split('\n').filter(Boolean)) commits.add(sha);
    } else {
      loose.push([oid, type]);
    }
  }
  return { commits: [...commits], tags: [...tags], loose, refs };
}

// The same for the whole local repo: every commit, every tag object (and what tags point at), every ref name.
function everything(cwd) {
  const commits = git(['rev-list', '--all'], cwd).split('\n').filter(Boolean);
  const tags = new Set();
  const loose = [];
  const refs = [];
  for (const line of git(['for-each-ref', '--format=%(objectname) %(objecttype) %(refname)'], cwd).split('\n').filter(Boolean)) {
    const [first, firstType, ref] = line.split(' ');
    refs.push(ref);
    let oid = first;
    let type = firstType;
    while (type === 'tag') {
      tags.add(oid);
      oid = /^object ([0-9a-f]+)$/m.exec(git(['cat-file', 'tag', oid], cwd))[1];
      type = typeOf(oid, cwd);
    }
    if (type === 'tree' || type === 'blob') loose.push([oid, type]);
  }
  return { commits, tags: [...tags], loose, refs };
}

function run(argv, { stdin = '', env = process.env, cwd = process.cwd() } = {}) {
  const [mode, remote, url] = argv;
  if (mode !== 'pre-push' && mode !== 'history') {
    return { code: 2, lines: ['usage: node scripts/leak.mjs pre-push <remote> [url] | history'] };
  }
  const list = loadDenylist(env);
  if (!list) {
    return { code: 1, lines: [
      `leak check: no denylist at ${denylistPath(env)}, so nothing is pushed.`,
      'Create it (one string per line), or point SM_DENYLIST_FILE at it.',
    ] };
  }
  const { entries } = list;
  const { commits, tags, loose, refs } = mode === 'history' ? everything(cwd) : objectsToPush(stdin, url || remote || 'origin', cwd);

  const hits = commits.flatMap((sha) => checkCommit(sha, entries, cwd));
  for (const t of tags) {
    for (const h of findHits(git(['cat-file', 'tag', t], cwd), entries)) hits.push(`tag ${t.slice(0, 7)}: ${h.what}`);
  }
  for (const [oid, type] of loose) hits.push(...checkTreeOrBlob(oid, type, entries, cwd));
  for (const ref of refs) {
    for (const h of findHits(ref, entries)) hits.push(`ref ${mask(ref, entries)} (name): ${h.what}`);
  }
  const what = `${commits.length} commit(s), ${tags.length} tag(s), ${refs.length} ref name(s)`;
  if (hits.length) {
    return { code: 1, lines: [`leak check: ${hits.length} hit(s) in ${what}; entries are numbered, not printed. Nothing was pushed.`, ...hits] };
  }
  return { code: 0, lines: [`leak check: ${what} clean against ${entries.length} denylist entries and the home-path patterns`] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stdin = process.argv[2] === 'pre-push' ? fs.readFileSync(0, 'utf8') : '';
  const { code, lines } = run(process.argv.slice(2), { stdin });
  (code ? console.error : console.log)(lines.join('\n'));
  process.exit(code);
}
