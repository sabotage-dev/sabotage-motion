// The examples (plan sections 15 and 23.3), without a browser: each is a full piece whose engine files are the
// template's, byte for byte (only its own scene, board, sound and look differ), it commits its contact.png and
// board.png and no other output, the voiced one's cues still match its board, and its VOICE.md names the engine,
// the voice and a licence that allows redistribution, matching take.json. test/examples-check.test.mjs runs `check`
// on them in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, templateDir, repoFiles, examplesDir, EXAMPLES } from './helpers.mjs';

// The files an example owns, beside the template's: everything else the template ships must be identical.
const OWN = {
  showreel: ['scene.js', 'board.js', 'audio.js', 'shaders.js', 'index.html', '.gitignore'],
  'explainer-beat': ['scene.js', 'board.js', 'audio.js', '.gitignore'],
  'lower-third': ['scene.js', 'board.js', '.gitignore'],
  'terminal-demo': ['scene.js', 'board.js', 'audio.js', '.gitignore'],
  'repo-launch': ['scene.js', 'board.js', 'audio.js', '.gitignore'],
};
// The template's files as the repo publishes them (tracked, or new and not ignored), so render outputs and other
// ignored files in the template folder (CI renders a benchmark there) are not part of the comparison.
const templateFiles = () => {
  const prefix = path.relative(repoRoot, templateDir).split(path.sep).join('/') + '/';
  return repoFiles().filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
};

for (const ex of EXAMPLES) {
  const dir = path.join(examplesDir, ex);
  test(`${ex}: every template file is the template's, byte for byte, except the ones the example owns`, () => {
    const drift = [];
    const files = templateFiles();
    assert.ok(files.includes('render.mjs') && files.includes('scene.js'), 'the template\'s files are listed');
    for (const f of files) {
      if (OWN[ex].includes(f)) continue;
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) drift.push(`${f}: missing`);
      else if (!fs.readFileSync(p).equals(fs.readFileSync(path.join(templateDir, f)))) drift.push(`${f}: differs from the template's (copy the template's, or list it as the example's own in this test)`);
    }
    for (const f of OWN[ex]) if (!fs.existsSync(path.join(dir, f))) drift.push(`${f}: missing`);
    assert.deepEqual(drift, []);
  });

  test(`${ex}: it commits contact.png and board.png and no other output`, () => {
    const prefix = path.relative(repoRoot, dir).split(path.sep).join('/') + '/';
    const files = repoFiles().filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
    for (const f of ['contact.png', 'board.png']) assert.ok(files.includes(f), `${f} is not in the repo (is it ignored?)`);
    const outputs = files.filter((f) => /^(out|stills)\//.test(f) || f === 'board.md' || f === 'vo.wav' || /\.(mp4|mov|webm|mkv)$/i.test(f) || f.endsWith('.render.json') || f.endsWith('.master.json'));
    assert.deepEqual(outputs, [], 'outputs that should not be committed');
    const ign = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    for (const p of ['out/', 'stills/', 'board.md', 'node_modules/', '.env']) assert.match(ign, new RegExp(`^${p.replace('.', '\\.')}$`, 'm'), `.gitignore should keep ignoring ${p}`);
  });
}

test('explainer-beat: its cues.js was made from its board and its take (the windows time, the key matches)', async () => {
  const dir = path.join(examplesDir, 'explainer-beat');
  const lib = await import(pathToFileURL(path.join(dir, 'lib.js')).href);
  assert.ok(lib.BOARD && lib.CUES, 'board.js and cues.js load');
  const timing = lib.boardTiming(lib.BOARD, lib.CUES);
  assert.ok(timing.ok, timing.problems && timing.problems.join('; '));
  assert.equal(timing.estimated, false, 'timed from the take, not the estimate');
  const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  assert.deepEqual(lib.CUES.WORDS.map((w) => w.text), take.words.map((w) => w.text), 'cues.js holds the take\'s words');
  assert.ok(fs.existsSync(path.join(dir, 'take-raw.wav')), 'take-raw.wav, the voice');
  assert.ok(fs.existsSync(path.join(dir, 'bed.mp3')), 'bed.mp3, the bed');
});

test('explainer-beat: VOICE.md names the engine, the voice, a licence that allows redistribution and its URL, matching take.json (Q2)', () => {
  const dir = path.join(examplesDir, 'explainer-beat');
  const md = fs.readFileSync(path.join(dir, 'VOICE.md'), 'utf8');
  const row = (k) => { const m = md.match(new RegExp(`^\\|\\s*${k}\\s*\\|(.*)\\|\\s*$`, 'm')); return m ? m[1].trim() : null; };
  const engine = row('Engine'), voice = row('Voice'), licence = row('Licence'), url = row('Licence URL'), src = row('`take.json` source');
  for (const [k, v] of Object.entries({ engine, voice, licence, url, src })) assert.ok(v, `VOICE.md has no ${k} row`);
  const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  assert.ok(take.source, 'take.json has a source');
  assert.ok(engine.toLowerCase().includes(String(take.source).toLowerCase()), `VOICE.md's engine (${engine}) is not take.json's source (${take.source})`);
  assert.ok(src.includes(take.source), `VOICE.md's take.json source row (${src}) does not name ${take.source}`);
  if (take.voice) assert.ok(voice.includes(take.voice), `VOICE.md's voice (${voice}) is not take.json's (${take.voice})`);
  // a licence that allows redistribution, and the file
  assert.match(licence, /Apache License 2\.0|MIT|CC0|CC BY 4\.0|BSD/, 'a licence that allows redistribution');
  assert.match(url, /^https:\/\/\S+$/, 'the licence URL');
  const lic = fs.readFileSync(path.join(dir, 'LICENSE-voice.txt'), 'utf8');
  if (/Apache License 2\.0/.test(licence)) assert.match(lic, /Apache License\s+Version 2\.0/, 'LICENSE-voice.txt is the licence VOICE.md names');
});
