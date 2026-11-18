// make-clip.mjs: makes the caption-clip example's source clip and transcript (plan 23.5, Q12), so the example needs
// no footage and has no person in it. Run from this folder:
//   node make-clip.mjs [--voice ../explainer-beat/take-raw.wav] [--take ../explainer-beat/take.json]
// 1. renders screen.js (a made-up screen recording) to out/screen.mp4, 540x960 at 30 fps, 15 s;
// 2. lays the voice under it, starting 0.5 s in, as one small file: out/source.mp4 (H.264 CRF 30, AAC 96 kb/s mono);
// 3. writes transcript.json: the take's own word timings (Kokoro predicts them; VOICE.md) moved 0.5 s later, in the
//    generic words format, as a transcription tool would give them for this clip.
// Then: node tools/clip.mjs prepare out/source.mp4 --transcript transcript.json --board --title "..." (README.md).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const voice = path.resolve(ROOT, opt('voice', '../explainer-beat/take-raw.wav')), takeFile = path.resolve(ROOT, opt('take', '../explainer-beat/take.json'));
const AT = 0.5, DUR = 15;
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' }); if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed`); };

run(process.execPath, ['render.mjs', 'video', '--scene', 'screen.js', '--out', 'out/screen.mp4']);
run('ffmpeg', ['-v', 'error', '-y', '-i', 'out/screen.mp4', '-i', voice, '-filter_complex', `[1:a]aresample=48000,adelay=${AT * 1000}:all=1,apad,atrim=end=${DUR}[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-ac', '1',
  '-movflags', '+faststart', 'out/source.mp4']);
const take = JSON.parse(fs.readFileSync(takeFile, 'utf8'));
const r4 = (x) => Math.round(x * 1e4) / 1e4;
fs.writeFileSync(path.join(ROOT, 'transcript.json'), JSON.stringify({ source: take.source, words: take.words.map((w) => ({ text: w.text, start: r4(w.start + AT), end: r4(w.end + AT) })) }, null, 1) + '\n');
console.log('wrote out/screen.mp4, out/source.mp4, transcript.json');
