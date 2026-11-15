// THE CREATIVE FILE. Replace this example (a 3-second kinetic title card) with your piece. The example lays out
// inside the target's safe area, exports boxes(t), and opens on a frame that is not flat, so `node render.mjs check`
// on a fresh copy of the template reports no FAIL and no WARN; keep those three habits in your own scene.
// Contract with main.js:
//   CFG                      canvas size in design pixels (W, H), FPS, DUR, FONTS to verify. W, H and
//                            FPS may be left out when you render with --target <name> (safezones.json).
//                            DUR comes from the storyboard: CFG.DUR = boardDur() (board.js, lib.js)
//   TL                       the timeline: event times shared with audio.js (it receives this TL),
//                            built from beatWindow(id) so the board stays the one source of timing
//   init({ctx, hud, scale, params, alpha, target, style})   one-time setup (layout, images); params come
//                            from --param k=v; target is the safezones.json entry or null. CFG.DUR
//                            may be set here (the harness reads it after init). style is the piece's
//                            resolved look and brand kit (looks.js): colour tokens (bgA, bgB, ink, muted,
//                            accent, accent2), font roles (fontStr(style, 'display', px)), the background
//                            shader id and its colours (spread bgConfig(style, { alpha }) into frame's
//                            return), post settings, motion vocabulary and sound timbre. CFG.LOOK = '<name>'
//                            picks a look in code; --param look=<name> wins over it, brand.json over both
//                            for colours and fonts, --param bgA=#hex (any token) or bg=<id> over all
//   frame(t, jit) -> cfg     draw the 2D layer for time t; return compositing config (see bottom of frame)
//   post(t) -> {...}         post-processing amounts for time t
//   subBoost(t) (optional)   motion-blur subframe multiplier: raise it where motion is fast
//   drawHud(t) (optional)    draw on the HUD canvas (difference-blended over everything)
//   silent (optional)        export const silent = true: the soundtrack is silence and audio.js is not loaded
//   boxes(t) (optional)      the text on screen at t, so `node render.mjs check` can test it without OCR:
//                            [{ id, text, x, y, w, h, group?, deco? }], one box per drawn run of text, in
//                            design pixels BEFORE the camera (check maps them through frame(t)'s cam),
//                            cut to any clip mask, and only while the text's alpha is above 0.05. Words
//                            of one phrase or caption share a `group`; deco: true marks decorative text
//                            the safe-area and overlap checks leave alone. A pure function of t, like
//                            frame(t). captions(..., { draw: false }) returns its boxes without drawing.
//   HOLDS (optional)         export const HOLDS = [[t0, t1], ...]: deliberate holds (an end card held to the
//                            last frame), which check's motion_dead leaves alone (so does hold: true on a
//                            board beat)
// Other scenes in the same piece render with `node render.mjs <mode> --scene other.js`.
// Rules that keep frames correct: draw everything from t (no state carried between calls), never
// Math.random() (use lib.js mulberry32/hash), and work in design pixels. Before every frame() and
// drawHud() call, main.js clears the canvas and sets ctx.setTransform(scale,0,0,scale,0,0), so
// CFG.W x CFG.H coordinates map to the render size at any --scale. If you reset the transform
// (e.g. to blit an offscreen canvas at device pixels), restore it with that same call. Offscreen
// canvases you create are NOT prepped: size them from ctx.canvas and apply the scale yourself
// (see LAYER below). shadowBlur, shadowOffsetX/Y and ctx.filter blur radii ignore the transform:
// multiply them by `scale` (from init) or they look too big at --scale < 1.
import { clamp, lerp, prog, snap, whip, anticip, spring, env, rgba, beatWindow, boardDur, sceneTarget, freeSpan } from './lib.js';
import { bgConfig, fontStr } from './looks.js';

// LOOK is unset here, so the card keeps the template's own style unless --param look=<name> or brand.json says
// otherwise; set CFG.LOOK = 'paper' (any name in looks.js) to pick one in code.
export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY'] };

// One timeline shared with audio.js, so every sound lands on the visual event it belongs to. Its times
// hang off the board's beat windows (board.js), so retiming a beat there moves everything with it.
const [IN] = beatWindow('title'), [OUT] = beatWindow('out');
export const TL = {
  wordsIn: IN + 0.22, stagger: 0.07,   // title words rise in one after another
  barIn: IN + 0.55,                    // accent bar wipes in
  subIn: IN + 0.75,                    // subtitle tracks in
  sweep: IN + 1.35,                    // light sweep across the title
  out: OUT, outStagger: 0.04,          // everything whips out
  words: 0, hits: [],                  // filled by init(): word count + landing times
};

let ctx, S = 1, ALPHA = false, P, ST, LAYER, lctx, SAFE, EXCL;
const L = {};

export async function init({ ctx: c, scale, params, alpha, target, style }) {
  ctx = c; S = scale; ALPHA = alpha; ST = style;
  // the copy comes from params; colours, fonts, the background, post and motion from the style (looks.js)
  P = {
    title: params.title || 'Make it move',
    sub: params.sub || 'rendered from code, frame by frame',
    ink: ST.tokens.ink, accent: ST.tokens.accent,
  };
  TL.stagger = ST.motion.stagger;
  // Lay out inside the safe area of the --target, else of the board's target (safezones.json), else 8% in.
  const T = await sceneTarget(target);
  SAFE = T && T.safe ? T.safe : { x: CFG.W * 0.08, y: CFG.H * 0.08, w: CFG.W * 0.84, h: CFG.H * 0.84 };
  EXCL = (T && T.exclude) || [];   // areas the platform covers inside the safe area (tiktok-ad's button column)
  LAYER = document.createElement('canvas'); LAYER.width = c.canvas.width; LAYER.height = c.canvas.height;
  lctx = LAYER.getContext('2d');
  // lay out across the safe width, then again beside any exclude rectangle the block's band reaches into
  layout({ left: SAFE.x, right: SAFE.x + SAFE.w });
  const span = freeSpan(SAFE, EXCL, L.lines[0].base - L.asc, L.subY + L.subDesc);
  if (span.left !== SAFE.x || span.right !== SAFE.x + SAFE.w) layout(span);
}

// Word-wrap the title, auto-fitting the font size so it never exceeds 3 lines or 90% of the span's width.
function layout(span) {
  const SW = span.right - span.left;
  const maxW = SW * 0.9, words = P.title.split(/\s+/).filter(Boolean);
  let fs = 170, lines;
  for (;;) {
    ctx.font = fontStr(ST, 'display', fs);
    lines = [[]];
    for (const w of words) {
      const cur = lines[lines.length - 1], test = [...cur, w].join(' ');
      if (cur.length && ctx.measureText(test).width > maxW) lines.push([w]); else cur.push(w);
    }
    const widest = Math.max(...lines.map((l) => ctx.measureText(l.join(' ')).width));
    if ((lines.length <= 3 && widest <= maxW) || fs < 40) break;
    fs -= 6;
  }
  const lh = fs * 1.02, space = ctx.measureText(' ').width;
  const fm = ctx.measureText(P.title);
  L.asc = fm.fontBoundingBoxAscent; L.desc = fm.fontBoundingBoxDescent;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l.join(' ')).width));
  // subtitle: shrink until it fits on one line (measured with its final letter-spacing)
  let subFs = Math.max(28, fs * 0.3), subW;
  for (;;) {
    ctx.font = fontStr(ST, 'body', subFs); ctx.letterSpacing = `${(subFs * 0.04).toFixed(2)}px`;
    subW = ctx.measureText(P.sub).width; ctx.letterSpacing = '0px';
    if (subW <= maxW || subFs <= 20) break;
    subFs -= 2;
  }
  ctx.font = fontStr(ST, 'body', subFs);
  L.subAsc = ctx.measureText(P.sub).fontBoundingBoxAscent; L.subDesc = ctx.measureText(P.sub).fontBoundingBoxDescent;
  ctx.font = fontStr(ST, 'display', fs);
  // left-aligned block (title, bar, subtitle share one left edge), centred as a whole in the safe area
  const blockX = span.left + (SW - Math.max(widest, subW)) / 2;
  // the subtitle tracks in from the widest letter-spacing that still ends inside the span (at most 0.45 em);
  // canvas letter-spacing adds its space after every character
  const room = span.left + SW * 0.95 - blockX;
  L.subTrack0 = clamp(subFs * 0.04 + (room - subW) / Math.max(1, [...P.sub].length), subFs * 0.04, subFs * 0.45);
  const top = CFG.H * 0.44 - (lines.length * lh) / 2;
  L.fs = fs; L.lh = lh; L.words = []; L.lines = [];
  lines.forEach((ln, li) => {
    const lw = ctx.measureText(ln.join(' ')).width, base = top + (li + 0.8) * lh;
    L.lines.push({ x0: blockX, w: lw, base });
    let x = blockX;
    for (const w of ln) { const ww = ctx.measureText(w).width; L.words.push({ text: w, x, w: ww, base, li }); x += ww + space; }
  });
  const last = L.lines[L.lines.length - 1];
  L.barY = last.base + fs * 0.32; L.barH = Math.max(8, fs * 0.09);
  L.barX = blockX; L.barW = widest * 0.32;
  L.subY = L.barY + L.barH + fs * 0.55; L.subFs = subFs;
  TL.words = L.words.length;
  TL.hits = L.words.map((_, i) => +(TL.wordsIn + i * TL.stagger + 0.18).toFixed(3)); // spring first reaches 1
}

// The style's motion vocabulary (looks.js): how an element enters (dt seconds after its start; 0 -> 1, a spring or
// anticip may overshoot) and how it leaves (whip: a fast smear out; cut: gone at once, a hard cut).
function enterK(dt) {
  switch (ST.motion.enter) {
    case 'snap': return snap(prog(dt, 0, 0.5));
    case 'anticip': return anticip(prog(dt, 0, 0.6));
    case 'step': return Math.floor(prog(dt, 0, 0.36) * 4 + 1e-9) / 4;   // four hard steps, like a terminal redraw
    default: return spring(dt, 2.2, 0.55);
  }
}
const exitK = (t, at, dur) => (ST.motion.exit === 'cut' ? (t >= at ? 1 : 0) : whip(prog(t, at, at + dur)));

// Where each title word is at t: its offset below (rising in) or above (whipping out) its baseline, and the line's
// clip mask it is drawn through. frame() draws from it and boxes() reports it, so the two always agree.
function wordAt(i, t) {
  const w = L.words[i], ln = L.lines[w.li];
  const k = enterK(t - (TL.wordsIn + i * TL.stagger));
  const o = exitK(t, TL.out + i * TL.outStagger, 0.35);
  return { w, dy: (1 - k) * L.fs * 1.1 - o * L.fs * 1.25, clip: { x: ln.x0 - 40, y: ln.base - L.fs * 1.0, w: ln.w + 80, h: L.fs * 1.28 } };
}
const subTrack = (si) => lerp(L.subTrack0, L.subFs * 0.04, si);
const subFade = (t) => {
  const si = snap(prog(t, TL.subIn, TL.subIn + 0.7)), so = ST.motion.exit === 'cut' ? (t >= TL.out ? 1 : 0) : prog(t, TL.out, TL.out + 0.25);
  return { si, a: 0.82 * si * (1 - so) };
};

export function frame(t, jit) {
  const c = ctx, l = lctx;   // c arrives cleared and pre-scaled; the offscreen layer we prep ourselves
  l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, LAYER.width, LAYER.height);
  l.setTransform(S, 0, 0, S, 0, 0);

  // --- title words: rise from behind each line's baseline (a clip mask), spring-settled; whip out upward
  l.font = fontStr(ST, 'display', L.fs); l.fillStyle = P.ink; l.textBaseline = 'alphabetic';
  L.words.forEach((_, i) => {
    const { w, dy, clip } = wordAt(i, t);
    l.save();
    l.beginPath(); l.rect(clip.x, clip.y, clip.w, clip.h); l.clip();
    l.fillText(w.text, w.x, w.base + dy);
    l.restore();
  });
  // --- light sweep: a skewed gradient painted only where the title already is (source-atop), when the look allows one
  const sp = prog(t, TL.sweep, TL.sweep + 0.55);
  if (ST.motion.sweep && sp > 0 && sp < 1) {
    const x = lerp(-200, CFG.W + 200, snap(sp)), cy = CFG.H * 0.44;
    const g = l.createLinearGradient(x - 90, 0, x + 90, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    l.save(); l.globalCompositeOperation = 'source-atop';
    l.translate(x, cy); l.transform(1, 0, -0.35, 1, 0, 0); l.translate(-x, -cy);
    l.fillStyle = g; l.fillRect(x - 160, 0, 320, CFG.H);
    l.restore();
  }
  c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(LAYER, 0, 0); c.setTransform(S, 0, 0, S, 0, 0);

  // --- frame marks: a corner bracket at each corner of the safe area, there from the first frame (so the
  // thumbnail is never a flat colour) until everything whips out; they also show where the safe area is
  const fo = exitK(t, TL.out, 0.3), arm = 54, inset = 14;
  if (fo < 1) {
    c.strokeStyle = rgba(P.ink, 0.55 * (1 - fo)); c.lineWidth = 5;
    const x0 = SAFE.x + inset, y0 = SAFE.y + inset, x1 = SAFE.x + SAFE.w - inset, y1 = SAFE.y + SAFE.h - inset;
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      c.beginPath(); c.moveTo(x, y + sy * arm * (1 - fo)); c.lineTo(x, y); c.lineTo(x + sx * arm * (1 - fo), y); c.stroke();
    }
  }
  // --- accent bar: snaps in from the left, pulses on each word landing, wipes out to the right
  const bi = snap(prog(t, TL.barIn, TL.barIn + 0.45)), bo = exitK(t, TL.out + 0.08, 0.34);
  if (bi > 0 && bo < 1) {
    const pulse = 1 + 0.5 * env(t, TL.hits, 16);
    const x0 = L.barX + bo * L.barW, x1 = L.barX + bi * L.barW, h = L.barH * pulse;
    c.fillStyle = P.accent; c.fillRect(x0, L.barY - (h - L.barH) / 2, Math.max(0, x1 - x0), h);
  }
  // --- subtitle: tracks in from wide letter-spacing while fading up; fades on exit
  const { si, a } = subFade(t);
  if (a > 0) {
    c.font = fontStr(ST, 'body', L.subFs); c.textAlign = 'left';
    c.letterSpacing = `${subTrack(si).toFixed(2)}px`;
    c.fillStyle = rgba(P.ink, a);
    c.fillText(P.sub, L.barX, L.subY);
    c.letterSpacing = '0px';
  }

  // Compositing config for this subframe:
  //   use2D: composite the 2D canvas   scene: background shader id (0 = flat clear colour)
  //   P/Q/R: vec4 params for the shader   cam: [zoom, rotation, panX, panY]   clear: flat bg rgb 0..1
  // bgConfig(style) gives scene, P, Q, R and clear from the style's shader id (bg) and its colour tokens.
  return {
    t, jit, use2D: true, ...bgConfig(ST, { alpha: ALPHA }),
    cam: [1 + 0.03 * clamp(t / CFG.DUR), 0, 0, 0],   // slow push-in for life during holds
  };
}

// The text on screen at t, for `node render.mjs check` (see the contract above): each title word cut to its line's
// mask, and the subtitle at its current letter-spacing, while its alpha is above 0.05.
export function boxes(t) {
  const out = [];
  L.words.forEach((_, i) => {
    const { w, dy, clip } = wordAt(i, t);
    const y0 = Math.max(w.base + dy - L.asc, clip.y), y1 = Math.min(w.base + dy + L.desc, clip.y + clip.h);
    const x0 = Math.max(w.x, clip.x), x1 = Math.min(w.x + w.w, clip.x + clip.w);
    if (y1 > y0 && x1 > x0) out.push({ id: `title${i}`, text: w.text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, group: 'title' });
  });
  const { si, a } = subFade(t);
  if (a > 0.05) {
    ctx.save();
    ctx.font = fontStr(ST, 'body', L.subFs); ctx.letterSpacing = `${subTrack(si).toFixed(2)}px`;
    const w = ctx.measureText(P.sub).width;
    ctx.restore();
    out.push({ id: 'sub', text: P.sub, x: L.barX, y: L.subY - L.subAsc, w, h: L.subAsc + L.subDesc, group: 'sub' });
  }
  return out;
}

// Post from the style; a look that allows a glitch gets one at the cut out.
export function post(t) {
  const p = ST.post, g = ST.motion.glitch ? 0.6 * Math.exp(-Math.pow((t - TL.out) / 0.06, 2)) : 0;
  return { t, bloom: p.bloom, thr: p.thr, ca: p.ca, glitch: g, grain: p.grain, vig: p.vig, scan: p.scan, flash: 0, fade: 1, hud: 0 };
}

// Fast segments get 2x subframes so motion blur stays smooth instead of stepping.
export function subBoost(t) {
  return (t > TL.wordsIn && t < TL.wordsIn + TL.words * TL.stagger + 0.4) || t > TL.out ? 2 : 1;
}
