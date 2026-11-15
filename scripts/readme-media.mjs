#!/usr/bin/env node
// The README's moving pictures (plan 23.1), made with ffmpeg from rendered pieces so they can be remade after any
// change to a piece. GitHub plays video in a README only when it is uploaded through its web editor, so these are
// GIFs (Q11): they play everywhere the README is shown.
//
//   node scripts/readme-media.mjs hero <reel.mp4> [--from <s>] [--dur <s>] [--fps 12] [--colors 128] [--no-denoise] [--out docs/media/hero.gif]
//       a looping cut of the showreel: at most 640 px wide and 5 MB
//   node scripts/readme-media.mjs tile <piece.mp4> --out docs/media/<name>.gif [--width 270] [--dur <s>] [--fps 12] [--colors 64] [--denoise]
//       one 9:16 piece for the "one prompt, three results" row: at most 2 MB
//
// Each GIF goes through a palette pass (palettegen, then paletteuse) at 12 fps: the hero with 128 colours and a
// grain denoise (`--no-denoise` drops it), a tile with 64 colours (`--denoise` adds it); `--fps` and `--colors`
// override. The script measures the file it
// wrote and exits 1 when it is over its budget, so a GIF that would load slowly never lands in the README.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const BUDGET = {
  hero: { bytes: 5 * 1024 * 1024, width: 640 },
  tile: { bytes: 2 * 1024 * 1024, width: 360 },
};

// A GIF's logical screen size sits in bytes 6-9, little-endian.
export function gifSize(file) {
  const b = fs.readFileSync(file);
  if (b.subarray(0, 6).toString('latin1') !== 'GIF89a' && b.subarray(0, 6).toString('latin1') !== 'GIF87a') {
    throw new Error(`${file} is not a GIF`);
  }
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), bytes: b.length };
}

// Every local picture a README shows (Markdown images and <img> tags), and what is wrong with each: missing, or a
// GIF over its budget (`hero.gif` the hero's, any other GIF a tile's). The docs test runs it on the README.
export function mediaProblems(md, root) {
  const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img [^>]*src="([^"]+)"/g)].map((m) => m[1] || m[2])
    .filter((r) => !/^https?:/.test(r));
  const problems = [];
  for (const r of refs) {
    const f = path.join(root, r);
    if (!fs.existsSync(f)) { problems.push(`${r}: missing`); continue; }
    if (!r.endsWith('.gif')) continue;
    const s = gifSize(f);
    const b = path.basename(r) === 'hero.gif' ? BUDGET.hero : BUDGET.tile;
    if (s.bytes > b.bytes || s.width > b.width) problems.push(`${r}: ${s.width} px, ${s.bytes} bytes; the budget is ${b.width} px, ${b.bytes} bytes`);
  }
  return { refs, problems };
}

function opt(argv, name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
}

// Film grain changes every pixel of every frame, which a GIF stores at full cost: a light temporal denoise before
// the palette pass halves the hero's size and leaves the shapes and type as they were.
const DENOISE = 'hqdn3d=6:4:8:6';

// A stated frame rate, Lanczos scaling, an optional denoise, a palette built from the frames' differences, Bayer dither (smaller than error
// diffusion and steadier between frames), and only the changed rectangle re-encoded per frame.
function gif(src, out, { from, dur, width, colors, fps, denoise }) {
  const vf = `fps=${fps},scale=${width}:-2:flags=lanczos,${denoise ? `${DENOISE},` : ''}split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const seek = from !== undefined ? ['-ss', String(from)] : [];
  const len = dur !== undefined ? ['-t', String(dur)] : [];
  ffmpeg([...seek, ...len, '-i', src, '-an', '-filter_complex', vf, '-loop', '0', out]);
}

function report(out, budget) {
  const s = gifSize(out);
  const mb = (s.bytes / 1048576).toFixed(2);
  const over = s.bytes > budget.bytes || s.width > budget.width;
  console.log(`${out}: ${s.width}x${s.height}, ${mb} MB${over ? `  OVER BUDGET (${budget.width} px, ${budget.bytes / 1048576} MB)` : ''}`);
  return over ? 1 : 0;
}

export function main(argv) {
  const [mode, src] = argv;
  if (!['hero', 'tile'].includes(mode) || !src || src.startsWith('--')) {
    console.log('usage: node scripts/readme-media.mjs hero <reel.mp4> [--from <s>] [--dur <s>] [--fps 12] [--colors 128] [--no-denoise] [--out <gif>]\n' +
      '       node scripts/readme-media.mjs tile <piece.mp4> --out <gif> [--width 270] [--dur <s>] [--fps 12] [--colors 64] [--denoise]');
    return 2;
  }
  if (!fs.existsSync(src)) { console.error(`no such file: ${src}`); return 2; }
  if (mode === 'hero') {
    const out = opt(argv, 'out', 'docs/media/hero.gif');
    gif(src, out, { from: Number(opt(argv, 'from', 0)), dur: Number(opt(argv, 'dur', 7)), width: 640,
      colors: Number(opt(argv, 'colors', 128)), fps: Number(opt(argv, 'fps', 12)), denoise: !argv.includes('--no-denoise') });
    return report(out, BUDGET.hero);
  }
  const out = opt(argv, 'out');
  if (!out) { console.error('tile needs --out <gif>'); return 2; }
  const dur = opt(argv, 'dur');
  gif(src, out, { dur: dur === undefined ? undefined : Number(dur), width: Number(opt(argv, 'width', 270)),
    colors: Number(opt(argv, 'colors', 64)), fps: Number(opt(argv, 'fps', 12)), denoise: argv.includes('--denoise') });
  return report(out, BUDGET.tile);
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
