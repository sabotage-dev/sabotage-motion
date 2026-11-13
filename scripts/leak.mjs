// Leak check: nothing this repo publishes may contain a private home-directory path or any string from
// the owner's denylist (brand names, private paths, the owner's voice id).
//
// The denylist is never committed and never stored on GitHub. It is a plain file on the owner's machine,
// one string per line, matched case-insensitively: $SM_DENYLIST_FILE, or else
// ~/.config/sabotage-motion/denylist.txt ($XDG_CONFIG_HOME/sabotage-motion/denylist.txt when that is set).
// SM_DENYLIST, the strings themselves (newline-separated), overrides the file; the tests use it.
//
//   node scripts/leak.mjs pre-push <remote> [url]   the git pre-push hook (.githooks/pre-push). Checks every
//       commit the push would publish: its message, author and committer, the paths it adds or renames to,
//       and the lines it adds (removed lines are not checked, so a commit that removes a leak can be pushed).
//       Blocks the push on any hit, and when no denylist is found.
//   node scripts/leak.mjs history                    the same check over every commit reachable from any ref.
//
// test/leak.test.mjs checks the files in the working tree: home paths always (that is what CI runs), the
// denylist when one is found. Hits print as where they are plus the entry's number, never the entry's text,
// so the output can be pasted anywhere. The home-path patterns are assembled from parts so that this file
// does not match itself.
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

const git = (args, cwd) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 << 20 });

// The hits in one commit: identity and message, new paths, added lines.
export function checkCommit(sha, entries, cwd) {
  const short = sha.slice(0, 7);
  const out = [];
  const meta = git(['show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%B', sha], cwd);
  for (const h of findHits(meta, entries)) out.push(`commit ${short} (message or author): ${h.what}`);

  for (const line of git(['diff-tree', '--root', '-r', '-M', '--no-commit-id', '--name-status', sha], cwd).split('\n')) {
    const [status, ...paths] = line.split('\t');
    if (!status || !/^[ARC]/.test(status)) continue;
    const added = paths[paths.length - 1];
    for (const h of findHits(added, entries)) out.push(`commit ${short} ${added} (path): ${h.what}`);
  }

  // -U0 keeps only changed lines; a hunk header gives the new file's line number for the lines that follow.
  // A merge shows as a combined diff (git show's default): only what the merge itself changed, with one
  // prefix column per parent and a hunk header of one more '@' than there are parents.
  const patch = git(['show', '--format=', '-M', '-U0', '--no-color', '--no-ext-diff', sha], cwd);
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
      for (const h of findHits(line.slice(cols), entries)) out.push(`commit ${short} ${file}:${lineNo}: ${h.what}`);
    }
    lineNo++;
  }
  return out;
}

// The commits a pre-push would publish, from the lines git writes to the hook's stdin:
// "<local ref> <local oid> <remote ref> <remote oid>". Annotated tags are checked as objects too.
export function commitsToPush(stdin, remote, cwd) {
  const shas = new Set();
  const tags = [];
  for (const line of stdin.split('\n')) {
    const [, localOid, , remoteOid] = line.trim().split(/\s+/);
    if (!localOid || /^0+$/.test(localOid)) continue;   // a delete publishes nothing
    if (git(['cat-file', '-t', localOid], cwd).trim() === 'tag') tags.push(localOid);
    const not = ['--not', `--remotes=${remote}`];
    if (remoteOid && !/^0+$/.test(remoteOid)) {
      try { git(['cat-file', '-e', `${remoteOid}^{commit}`], cwd); not.push(remoteOid); } catch { /* not fetched here */ }
    }
    for (const sha of git(['rev-list', localOid, ...not], cwd).split('\n').filter(Boolean)) shas.add(sha);
  }
  return { shas: [...shas], tags };
}

function run(argv, { stdin = '', env = process.env, cwd = process.cwd() } = {}) {
  const [mode, remote] = argv;
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
  let shas;
  let tags = [];
  if (mode === 'history') shas = git(['rev-list', '--all'], cwd).split('\n').filter(Boolean);
  else ({ shas, tags } = commitsToPush(stdin, remote || 'origin', cwd));

  const hits = shas.flatMap((sha) => checkCommit(sha, list.entries, cwd));
  for (const t of tags) {
    for (const h of findHits(git(['cat-file', 'tag', t], cwd), list.entries)) hits.push(`tag ${t.slice(0, 7)}: ${h.what}`);
  }
  if (hits.length) {
    return { code: 1, lines: [`leak check: ${hits.length} hit(s) in ${shas.length} commit(s); entries are numbered, not printed. Nothing was pushed.`, ...hits] };
  }
  return { code: 0, lines: [`leak check: ${shas.length} commit(s) clean against ${list.entries.length} denylist entries and the home-path patterns`] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stdin = process.argv[2] === 'pre-push' ? fs.readFileSync(0, 'utf8') : '';
  const { code, lines } = run(process.argv.slice(2), { stdin });
  (code ? console.error : console.log)(lines.join('\n'));
  process.exit(code);
}
