// EXPLAINER-BEAT: a made-up 9:16 explainer, "why fast motion stutters", voiced and captioned (examples/README
// in SKILL.md's references; the scene contract is in the template's scene.js header). Everything is timed from
// board.js and the take: beatWindow() gives each beat's window, and the headline copy lands on the spoken word
// it belongs to (CUES.WORDS, seconds into vo.wav, plus the board's VO_OFFSET). Retiming the voice moves it all.
//
//   hook    a ball crosses the frame in hard steps (5 a second); STUTTERS slams in on the word
//   frames  the steps freeze into a row of ghosts, one per frame; then a ball hops ghost to ghost
//   blur    eight faint copies fan out inside one frame; then the ball sweeps across with real motion blur
//           (the harness's subframes, raised by subBoost during the sweep)
//   end     MOTION BLUR lands and holds to the last frame (hold: true on the board)
// Captions run word by word at the bottom of the safe area; boxes(t) reports them with the headline copy.
import { clamp, lerp, prog, snap, swift, whip, spring, E, env, rgba, rgb01, beatWindow, boardDur, boardInfo, CUES, captions, sceneTarget } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY', 'MONO'] };

const VO = boardInfo().voOffset, WORDS = CUES ? CUES.WORDS : [];
const [H0, H1] = beatWindow('hook'), [F0, F1] = beatWindow('frames'), [B0, B1] = beatWindow('blur'), [E0] = beatWindow('end');
// Picture time of the first spoken `word` at or after `from`, or the fallback while there is no take yet.
const said = (word, from, fallback) => {
  const w = WORDS.find((x) => VO + x.start >= from - 1e-6 && x.text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() === word);
  return w ? +(VO + w.start).toFixed(4) : fallback;
};

const STEP_HZ = 5, BALL_Y = 1060, R = 44, NG = 6, HALF = 340;
let XL = 200, XR = 880;   // set in init: the ball's track, centred on the safe area
const ghostX = (i) => lerp(XL, XR, i / (NG - 1));
export const TL = {
  stepsFrom: H0 + 0.15,                                   // the stepping ball starts
  slam: said('stutters', H0, H0 + 1.6),                    // STUTTERS slams in on the word
  ghosts: Array.from({ length: NG }, (_, i) => +(F0 + 0.2 + i * 0.32).toFixed(4)),   // the steps freeze, one by one
  copyFrame: said('frame', F0, F0 + 0.4), copyInstant: said('instant', F0, F0 + 1.6),
  hop: said('jump', F0, F0 + 3.2),                         // a ball hops ghost to ghost on "jump from spot to spot"
  copyEight: said('eight', B0, B0 + 0.3), fan: said('instants', B0, B0 + 0.6), copyPer: said('frame', B0, B0 + 1.3),
  sweep: said('smear', B0, B0 + 2.8),                      // the blurred sweep starts on "smear"
  land: E0 + 0.05,                                         // the end card lands
  steps: [], hops: [],                                     // filled below: every step and hop time, for audio.js
};
for (let t = TL.stepsFrom; t < H1 - 0.12; t += 1 / STEP_HZ) TL.steps.push(+t.toFixed(4));
for (let i = 0; i < NG; i++) TL.hops.push(+(TL.hop + i * 0.17).toFixed(4));
// the blurred sweep: left to right, then back to the centre, where it rests under the end card
const SWEEP = [[TL.sweep, TL.sweep + 0.42, 'L', 'R'], [TL.sweep + 0.62, TL.sweep + 1.05, 'R', 'C']];
const at = (k) => (k === 'L' ? XL : k === 'R' ? XR : (XL + XR) / 2);

let ctx, S = 1, SAFE, EXCL, CX;
const INK = '#F4F1EA', MUTED = '#8F8A9E', ACCENT = '#FFC23A', BG_A = '#0E1220', BG_B = '#1D2546';
const capOpts = () => ({ safe: SAFE, exclude: EXCL, size: 64, family: 'DISPLAY', accent: ACCENT, stroke: 10, strokeColor: '#05060B' });

export async function init({ ctx: c, scale, target }) {
  ctx = c; S = scale;
  const T = await sceneTarget(target);
  SAFE = T && T.safe ? T.safe : { x: 86, y: 154, w: 908, h: 1612 };
  EXCL = (T && T.exclude) || [];
  CX = SAFE.x + SAFE.w / 2; XL = CX - HALF; XR = CX + HALF;
}

// The largest size (up to max) at which `text` fits `maxW` in DISPLAY.
function fit(text, maxW, max) {
  let fs = max;
  ctx.save();
  for (; fs > 24; fs -= 4) { ctx.font = `${fs}px DISPLAY`; if (ctx.measureText(text).width <= maxW) break; }
  ctx.restore();
  return fs;
}
// The headline copy at t: lines of { text, fs, y, a, s, group }, laid out centred on the safe area. One source for
// frame() and boxes(), so what is drawn is what check reads.
function headline(t) {
  const out = [], maxW = SAFE.w * 0.86;
  const line = (text, max, y, t0, t1, group) => {
    if (t < t0 || t >= t1) return;
    const a = prog(t, t0, t0 + 0.08) * (1 - prog(t, t1 - 0.18, t1));
    if (a <= 0) return;
    out.push({ text, fs: fit(text, maxW / 1.25, max), y, a, s: 1 + 0.25 * (1 - snap(prog(t, t0, t0 + 0.35))), group });
  };
  line('STUTTERS', 190, 640, TL.slam, H1, 'copy-hook');
  line('1 frame', 150, 560, TL.copyFrame, F1, 'copy-frames');
  line('= 1 instant', 110, 700, TL.copyInstant, F1, 'copy-frames');
  line('8 instants', 150, 560, TL.copyEight, B1, 'copy-blur');
  line('per frame', 110, 700, TL.copyPer, B1, 'copy-blur');
  line('MOTION', 170, 600, TL.land, CFG.DUR + 1, 'copy-end');
  line('BLUR', 170, 780, TL.land + 0.12, CFG.DUR + 1, 'copy-end');
  return out;
}

// The ball's position at t (a pure function of t), or null while it is hidden.
function ballX(t) {
  if (t < F0) {   // hook: ping-pong across in steps of 1/STEP_HZ seconds
    const q = Math.floor((t - TL.stepsFrom) * STEP_HZ + 1e-6) / STEP_HZ, k = Math.max(0, q) / 1.6;
    const u = k % 2, p = u < 1 ? u : 2 - u;
    return lerp(XL, XR, p);
  }
  if (t < B0) {   // frames: hidden until it hops from ghost to ghost, then rests on the last
    if (t < TL.hop) return null;
    return ghostX(Math.min(NG - 1, Math.floor((t - TL.hop) / 0.17)));
  }
  for (const [a, b, k0, k1] of SWEEP) if (t >= a && t < b) return lerp(at(k0), at(k1), swift(prog(t, a, b)));
  if (t < TL.sweep) return lerp(XR, XL, swift(prog(t, B0, B0 + 0.45)));   // glides back left, then waits for the sweep
  if (t < SWEEP[1][0]) return XR;
  return at('C');
}

export function frame(t, jit) {
  const c = ctx;
  // the track: a hairline the ball runs along, with a tick at every frame position
  c.fillStyle = rgba(INK, 0.16); c.fillRect(XL - 60, BALL_Y + R + 26, XR - XL + 120, 3);
  for (let i = 0; i < NG; i++) c.fillRect(ghostX(i) - 1.5, BALL_Y + R + 18, 3, 18);

  // ghosts: the frozen frames, landing one by one in "frames", fading out as "blur" begins
  const gOut = 1 - prog(t, B0, B0 + 0.4);
  if (t >= TL.ghosts[0] && gOut > 0) {
    for (let i = 0; i < NG; i++) {
      const k = spring(t - TL.ghosts[i], 3.2, 0.5);
      if (k <= 0) continue;
      const lit = t >= TL.hops[i] && t < TL.hops[i] + 0.17;
      c.strokeStyle = rgba(lit ? ACCENT : INK, 0.55 * gOut); c.lineWidth = 4;
      c.beginPath(); c.arc(ghostX(i), BALL_Y, R * clamp(k, 0, 1.2), 0, Math.PI * 2); c.stroke();
      c.font = '30px MONO'; c.textAlign = 'center'; c.fillStyle = rgba(MUTED, gOut * clamp(k));
      c.fillText(`f${i + 1}`, ghostX(i), BALL_Y + R + 84);
    }
  }
  // the fan: eight faint copies spread inside one frame's step, each an eighth of the ball
  const fanA = prog(t, TL.fan, TL.fan + 0.3) * (1 - prog(t, TL.sweep - 0.25, TL.sweep));
  if (fanA > 0) {
    const spread = snap(prog(t, TL.fan, TL.fan + 0.6));
    for (let k = 0; k < 8; k++) {
      c.fillStyle = rgba(INK, 0.28 * fanA);
      c.beginPath(); c.arc(lerp(XL, XL + 136 * spread, k / 7), BALL_Y, R, 0, Math.PI * 2); c.fill();
    }
  }
  // the ball
  const x = ballX(t);
  if (x != null && !(t >= TL.fan - 0.01 && t < TL.sweep)) {
    const pulse = 1 + 0.12 * env(t, TL.steps, 18) * (t < F0 ? 1 : 0);
    c.fillStyle = INK; c.beginPath(); c.arc(x, BALL_Y, R * pulse, 0, Math.PI * 2); c.fill();
    c.fillStyle = ACCENT; c.beginPath(); c.arc(x, BALL_Y, R * 0.34, 0, Math.PI * 2); c.fill();
  }

  // headline copy
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  for (const l of headline(t)) {
    c.save();
    c.globalAlpha = l.a; c.font = `${l.fs}px DISPLAY`; c.fillStyle = l.group === 'copy-end' ? ACCENT : INK;
    c.translate(CX, l.y); c.scale(l.s, l.s); c.fillText(l.text, 0, 0);
    c.restore();
  }
  // captions from the take
  captions(c, WORDS, t, capOpts());

  return { t, jit, use2D: true, scene: 1, P: [...rgb01(BG_A), 0.6], Q: [...rgb01(BG_B), 0], cam: [1, 0, 0, 0], clear: rgb01(BG_A) };
}

// The text on screen at t, for `node render.mjs check`: the headline lines (scaled about their centre, as drawn),
// the frame labels (decorative), and the captions.
export function boxes(t) {
  const out = [];
  for (const l of headline(t)) {
    if (l.a <= 0.05) continue;
    ctx.save(); ctx.font = `${l.fs}px DISPLAY`;
    const m = ctx.measureText(l.text);
    ctx.restore();
    const w = m.width * l.s, asc = m.actualBoundingBoxAscent * l.s, desc = m.actualBoundingBoxDescent * l.s;
    out.push({ id: `${l.group}:${l.text}`, text: l.text, x: CX - w / 2, y: l.y - asc, w, h: asc + desc, group: l.group });
  }
  const gOut = 1 - prog(t, B0, B0 + 0.4);
  for (let i = 0; i < NG; i++) {
    const a = gOut * clamp(spring(t - TL.ghosts[i], 3.2, 0.5));
    if (t >= TL.ghosts[i] && a > 0.05) out.push({ id: `f${i + 1}`, text: `f${i + 1}`, x: ghostX(i) - 30, y: BALL_Y + R + 60, w: 60, h: 32, deco: true });
  }
  return out.concat(captions(ctx, WORDS, t, { ...capOpts(), draw: false }));
}

export function post(t) {
  return { t, bloom: 0.22, thr: 0.8, ca: 0.0006, glitch: 0, grain: 0.02, vig: 0.18, flash: 0.12 * Math.exp(-Math.max(0, t - TL.land) * 14) * (t >= TL.land ? 1 : 0), fade: 1, hud: 0 };
}

// The sweep is the whole point of the piece: 4x subframes (32 at the default --sub 8) give it a true smear.
export function subBoost(t) {
  for (const [a, b] of SWEEP) if (t >= a - 0.02 && t < b + 0.02) return 4;
  return t >= TL.slam && t < TL.slam + 0.3 ? 2 : 1;
}
