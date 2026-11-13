// Alpha (plan section 16): ProRes 4444 with a non-constant alpha plane; the WebM, decoded with
// libvpx-vp9, has one too. render.mjs encodes ProRes from yuva444p10le; what ffprobe reports for the
// decoded file depends on the ffmpeg version (9.0 reports yuva444p12le, since 4444 carries up to
// 12 bits). Both are accepted; the profile (4444) and the ap4h tag are what identify the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makePiece, render, ffprobe, videoStream, countFrames, alphaBytes } from './helpers.mjs';

const dir = makePiece('alpha');
const P = (f) => path.join(dir, f);
const range = (buf) => { let lo = 255, hi = 0; for (const v of buf) { if (v < lo) lo = v; if (v > hi) hi = v; } return { lo, hi }; };

test('--alpha prores writes ProRes 4444 (ap4h) .mov with a non-constant alpha plane', () => {
  const r = render(dir, ['video', '--alpha', 'prores', '--scale', '0.25', '--out', 'out/a.mp4']);
  assert.match(r.stdout, /writing \.mov instead/);
  const file = P('out/a.mov');
  assert.ok(fs.existsSync(file));
  const v = videoStream(ffprobe(file));
  assert.equal(v.codec_name, 'prores');
  assert.equal(v.profile, '4444');
  assert.equal(v.codec_tag_string, 'ap4h');
  assert.match(v.pix_fmt, /^yuva444p1[02]le$/);
  assert.equal(countFrames(file), 60);
  const { lo, hi } = range(alphaBytes(file));
  assert.ok(lo <= 8, `alpha never reaches transparent (min ${lo})`);
  assert.ok(hi >= 247, `alpha never reaches opaque (max ${hi})`);
  assert.equal(JSON.parse(fs.readFileSync(P('out/a.mov.render.json'), 'utf8')).alpha, 'prores');
});

test('--alpha webm writes VP9 .webm whose alpha (decoded with libvpx-vp9) is non-constant', () => {
  render(dir, ['video', '--alpha', 'webm', '--scale', '0.25', '--out', 'out/w']);
  const file = P('out/w.webm');
  assert.ok(fs.existsSync(file));
  const v = videoStream(ffprobe(file));
  assert.equal(v.codec_name, 'vp9');
  assert.equal(String(v.tags?.alpha_mode ?? v.tags?.ALPHA_MODE), '1', 'no alpha_mode=1 tag on the VP9 stream');
  const { lo, hi } = range(alphaBytes(file));
  assert.ok(lo <= 8, `alpha never reaches transparent (min ${lo})`);
  assert.ok(hi >= 247, `alpha never reaches opaque (max ${hi})`);
  const r = JSON.parse(fs.readFileSync(P('out/w.webm.render.json'), 'utf8'));
  assert.equal(r.alpha, 'webm');
  assert.equal(r.frames, 60);
});
