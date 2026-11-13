// Shared helpers for the node:test suites: build a throwaway piece from the template plus a fixture,
// run render.mjs in it, and read results back with ffprobe/ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const templateDir = path.join(repoRoot, 'skills', 'sabotage-motion', 'template');
export const fixturesDir = path.join(repoRoot, 'test', 'fixtures');
const workRoot = path.join(repoRoot, 'test', '.work');   // inside the repo so render.mjs finds node_modules

// A fresh piece: the current template with the fixture's files copied over it.
export function makePiece(name, fixture = 'fixture-clean') {
  const dir = path.join(workRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(templateDir, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('node_modules') });
  fs.cpSync(path.join(fixturesDir, fixture), dir, { recursive: true });
  return dir;
}

// Runs `node render.mjs <args>` in a piece. Throws with the output when it fails, unless allowFail.
export function render(dir, args, { allowFail = false } = {}) {
  const r = spawnSync(process.execPath, ['render.mjs', ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (!allowFail && r.status !== 0) throw new Error(`render.mjs ${args.join(' ')} exited ${r.status}\n${out}`);
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out };
}

export function ffprobe(file, extra = []) {
  const json = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', ...extra, file], { encoding: 'utf8' });
  return JSON.parse(json);
}
export const videoStream = (probe) => probe.streams.find((s) => s.codec_type === 'video');
export const audioStream = (probe) => probe.streams.find((s) => s.codec_type === 'audio');

export function countFrames(file) {
  const p = ffprobe(file, ['-count_frames', '-select_streams', 'v:0']);
  return +videoStream(p).nb_read_frames;
}

// Decoded-video SHA-256, computed the way render.mjs documents it.
export function decodedVideoHash(file) {
  const pre = file.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : [];
  const out = execFileSync('ffmpeg', ['-v', 'error', ...pre, '-i', file, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' });
  return 'sha256:' + out.match(/SHA256=([0-9a-f]{64})/)[1];
}

// The alpha plane of every frame as 8-bit grey bytes. VP9 needs libvpx-vp9 to keep its alpha.
export function alphaBytes(file) {
  const pre = file.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : [];
  return execFileSync('ffmpeg', ['-v', 'error', ...pre, '-i', file, '-vf', 'alphaextract', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 256 << 20 });
}

// 16-bit PCM WAV from wav.js -> { sr, ch, samples: Float32Array (interleaved) }
export function readWav(file) {
  const b = fs.readFileSync(file);
  let off = 12, ch = 2, sr = 48000, data = null;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); }
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + sz); break; }
    off += 8 + sz + (sz & 1);
  }
  const samples = new Float32Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { sr, ch, samples, dur: samples.length / ch / sr };
}
// Peak absolute sample in [t0, t1) seconds.
export function peakIn(wav, t0, t1) {
  const a = Math.max(0, Math.floor(t0 * wav.sr) * wav.ch), b = Math.min(wav.samples.length, Math.floor(t1 * wav.sr) * wav.ch);
  let p = 0;
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(wav.samples[i]));
  return p;
}

export const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Files the repo would publish: tracked, plus new files not yet added (so a check runs before the
// first commit too). Ignored files are left out.
export function repoFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot })
    .toString().split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(repoRoot, f)) && fs.statSync(path.join(repoRoot, f)).isFile());
}
