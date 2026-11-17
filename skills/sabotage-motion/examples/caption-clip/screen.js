// The SOURCE CLIP of the caption-clip example: a made-up screen recording of a made-up phone app ("Smearly", a
// motion-blur tool), drawn by the engine so the example needs no footage and has no person in it (plan 23.5, Q12).
// make-clip.mjs renders it and lays the explainer-beat example's openly licensed voice under it (VOICE.md); the
// result is clip.mp4, the clip the captions go on. It is a scene like any other, timed to that voice:
//   0-4 s     the preview ball jumps in steps; the playhead runs ("Fast motion in a video stutters ...")
//   4.4-9.6 s the cursor walks the frame strip, one frozen frame at a time ("Every frame freezes ...")
//   9.8 s     the cursor switches motion blur on; samples count up to 8 ("Blend eight instants ...")
//   10.5 s on the ball moves smoothly, smeared ("... those jumps smear into motion.")
import { clamp, lerp, prog, snap, swift, rgba } from './lib.js';
import { fontStr } from './looks.js';

export const CFG = { W: 540, H: 960, FPS: 30, DUR: 15, FONTS: ['DISPLAY', 'BODY', 'MONO'] };
export const silent = true;
export const TL = { strip: 4.4, stripEnd: 9.6, toggle: 9.8, samples: 10.15, smooth: 10.5 };

let ctx, ST;
const C = { bg: '#0E1116', panel: '#171B22', line: '#262C36', ink: '#E8ECF2', muted: '#8691A3', accent: '#FF7A45', on: '#3DDC97' };
export async function init({ ctx: c, style }) { ctx = c; ST = style; }

const PERIOD = 2.4;
// where the ball is: steps of 1/8 s without blur, smooth with it
const ballX = (t, x0, x1) => { const u = (t % PERIOD) / PERIOD, s = u < 0.5 ? u * 2 : 2 - u * 2; return lerp(x0, x1, swift(s)); };
const blurOn = (t) => t >= TL.toggle;
const samples = (t) => (t < TL.samples ? 1 : Math.min(8, 1 + Math.floor((t - TL.samples) / 0.07)));

// the cursor's path: [t, x, y] keys, eased between them; clicks at the toggle and at the samples stepper
const KEYS = [[0, 420, 300], [3.6, 400, 330], [4.4, 74, 450], [5.4, 152, 450], [6.4, 230, 450], [7.4, 308, 450], [8.4, 386, 450], [9.0, 420, 470],
  [9.6, 452, 527], [10.6, 452, 527], [11.3, 300, 340], [15, 280, 360]];
function cursorAt(t) {
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1][0]) i++;
  const [a, ax, ay] = KEYS[i], [b, bx, by] = KEYS[i + 1], k = snap(prog(t, a, Math.min(b, a + 0.7)));
  return [lerp(ax, bx, k), lerp(ay, by, k)];
}
const CLICKS = [TL.toggle, TL.samples];

function rr(x, y, w, h, r, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
function text(s, x, y, font, color, align = 'left') { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); }

export function frame(t, jit) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, CFG.W, CFG.H);
  // top bar
  text('Smearly', 24, 44, fontStr(ST, 'display', 24), C.ink);
  text('demo.reel', 516, 44, fontStr(ST, 'mono', 15), C.muted, 'right');
  // preview: the ball, stepped or smeared
  rr(20, 70, 500, 330, 14, C.panel);
  ctx.save(); ctx.beginPath(); ctx.roundRect(20, 70, 500, 330, 14); ctx.clip();
  for (let gx = 40; gx < 520; gx += 40) { ctx.fillStyle = C.line; ctx.fillRect(gx, 70, 1, 330); }
  const x0 = 80, x1 = 460, y = 235;
  if (blurOn(t)) {
    const n = samples(t);
    for (let k = 0; k < n; k++) {
      ctx.globalAlpha = 1 / n + 0.12;
      ctx.beginPath(); ctx.arc(ballX(t - k * (1 / 30 / n) * 3, x0, x1), y, 34, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    const ts = Math.floor(t * 8) / 8;
    ctx.beginPath(); ctx.arc(ballX(ts, x0, x1), y, 34, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
  }
  ctx.restore();
  text(blurOn(t) ? `motion blur  x${samples(t)}` : 'motion blur  off', 36, 386, fontStr(ST, 'mono', 14), blurOn(t) ? C.on : C.muted);
  // the frame strip: six frozen frames; the one under the cursor lights up while it walks them
  for (let i = 0; i < 6; i++) {
    const fx = 36 + i * 78, hot = t >= TL.strip && t < TL.stripEnd && Math.abs(cursorAt(t)[0] - (fx + 38)) < 39;
    rr(fx, 418, 72, 62, 8, hot ? '#2A3240' : C.panel);
    ctx.beginPath(); ctx.arc(fx + 14 + i * 9, 449, 9, 0, Math.PI * 2); ctx.fillStyle = rgba(C.accent, hot ? 1 : 0.55); ctx.fill();
    text(`f${String(i + 1).padStart(2, '0')}`, fx + 36, 474, fontStr(ST, 'mono', 11), C.muted, 'center');
  }
  // controls: the motion blur switch and the samples stepper
  rr(20, 500, 500, 54, 12, C.panel);
  text('Motion blur', 36, 534, fontStr(ST, 'body', 18), C.ink);
  const sw = clamp((t - TL.toggle) / 0.18);
  rr(420, 512, 64, 30, 15, sw > 0.5 ? C.on : C.line);
  ctx.beginPath(); ctx.arc(lerp(436, 468, snap(sw)), 527, 11, 0, Math.PI * 2); ctx.fillStyle = C.ink; ctx.fill();
  text(`samples ${samples(t)}`, 404, 534, fontStr(ST, 'mono', 15), C.muted, 'right');
  // the timeline: two clips and a playhead that never stops
  rr(20, 790, 500, 120, 12, C.panel);
  rr(36, 812, 250, 34, 6, '#2B3A55'); rr(292, 812, 210, 34, 6, '#3A2B55');
  rr(36, 856, 466, 34, 6, '#25402F');
  const ph = 36 + ((t / CFG.DUR) * 466);
  ctx.fillStyle = C.accent; ctx.fillRect(ph - 1.5, 800, 3, 100);
  text(`00:${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 30)).padStart(2, '0')}`, 516, 778, fontStr(ST, 'mono', 14), C.muted, 'right');
  // the cursor, with a ring on each click
  const [cx, cy] = cursorAt(t);
  for (const c of CLICKS) {
    const k = prog(t, c, c + 0.4);
    if (k > 0 && k < 1) { ctx.beginPath(); ctx.arc(cx, cy, 8 + 26 * k, 0, Math.PI * 2); ctx.strokeStyle = rgba(C.ink, 0.7 * (1 - k)); ctx.lineWidth = 3; ctx.stroke(); }
  }
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 26); ctx.lineTo(cx + 7, cy + 20); ctx.lineTo(cx + 12, cy + 30); ctx.lineTo(cx + 16, cy + 28);
  ctx.lineTo(cx + 11, cy + 18); ctx.lineTo(cx + 19, cy + 18); ctx.closePath();
  ctx.fillStyle = C.ink; ctx.fill(); ctx.strokeStyle = '#000000'; ctx.lineWidth = 1.5; ctx.stroke();
  return { t, jit, use2D: true, scene: 0, P: [0, 0, 0, 0], Q: [0, 0, 0, 0], R: [0, 0, 0, 0], cam: [1, 0, 0, 0], clear: [0.055, 0.067, 0.086] };
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
