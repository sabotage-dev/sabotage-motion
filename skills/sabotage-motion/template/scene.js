// THE CREATIVE FILE. Replace this example (a 3-second kinetic title card) with your piece.
// Contract with main.js:
//   CFG                      canvas size in design pixels (W, H), FPS, DUR, FONTS to verify. W, H and
//                            FPS may be left out when you render with --target <name> (safezones.json)
//   TL                       the timeline: event times shared with audio.js (it receives this TL)
//   init({ctx, hud, scale, params, alpha, target})   one-time setup (layout, images); params come
//                            from --param k=v; target is the safezones.json entry or null. CFG.DUR
//                            may be set here (the harness reads it after init)
//   frame(t, jit) -> cfg     draw the 2D layer for time t; return compositing config (see bottom of frame)
//   post(t) -> {...}         post-processing amounts for time t
//   subBoost(t) (optional)   motion-blur subframe multiplier: raise it where motion is fast
//   drawHud(t) (optional)    draw on the HUD canvas (difference-blended over everything)
//   silent (optional)        export const silent = true: the soundtrack is silence and audio.js is not loaded
// Other scenes in the same piece render with `node render.mjs <mode> --scene other.js`.
// Rules that keep frames correct: draw everything from t (no state carried between calls), never
// Math.random() (use lib.js mulberry32/hash), and work in design pixels. Before every frame() and
// drawHud() call, main.js clears the canvas and sets ctx.setTransform(scale,0,0,scale,0,0), so
// CFG.W x CFG.H coordinates map to the render size at any --scale. If you reset the transform
// (e.g. to blit an offscreen canvas at device pixels), restore it with that same call. Offscreen
// canvases you create are NOT prepped: size them from ctx.canvas and apply the scale yourself
// (see LAYER below). shadowBlur, shadowOffsetX/Y and ctx.filter blur radii ignore the transform:
// multiply them by `scale` (from init) or they look too big at --scale < 1.
import { clamp, lerp, prog, snap, whip, spring, env, rgba, rgb01 } from './lib.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 3.0, FONTS: ['DISPLAY', 'BODY'] };

// One timeline shared with audio.js, so every sound lands on the visual event it belongs to.
export const TL = {
  wordsIn: 0.22, stagger: 0.07,   // title words rise in one after another
  barIn: 0.55,                    // accent bar wipes in
  subIn: 0.75,                    // subtitle tracks in
  sweep: 1.35,                    // light sweep across the title
  out: 2.45, outStagger: 0.04,    // everything whips out
  words: 0, hits: [],             // filled by init(): word count + landing times
};

let ctx, S = 1, ALPHA = false, P, LAYER, lctx;
const L = {};

export async function init({ ctx: c, scale, params, alpha }) {
  ctx = c; S = scale; ALPHA = alpha;
  P = {
    title: params.title || 'Make it move',
    sub: params.sub || 'rendered from code, frame by frame',
    ink: params.ink || '#F4F1EA',
    accent: params.accent || '#FF4A1C',
    bg: params.bg || 'gradient',          // none | gradient | paper | grid
    bgA: params.bgA || '#101018',
    bgB: params.bgB || '#2A1630',
    paper: params.paper || '#EFE6D2',     // paper colour for bg=paper (pass a dark ink with it)
  };
  LAYER = document.createElement('canvas'); LAYER.width = c.canvas.width; LAYER.height = c.canvas.height;
  lctx = LAYER.getContext('2d');
  layout();
}

// Word-wrap the title, auto-fitting the font size so it never exceeds 3 lines or 82% width.
function layout() {
  const maxW = CFG.W * 0.82, words = P.title.split(/\s+/).filter(Boolean);
  let fs = 170, lines;
  for (;;) {
    ctx.font = `${fs}px DISPLAY`;
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
  const widest = Math.max(...lines.map((l) => ctx.measureText(l.join(' ')).width));
  // subtitle: shrink until it fits on one line (measured with its final letter-spacing)
  let subFs = Math.max(28, fs * 0.3), subW;
  for (;;) {
    ctx.font = `${subFs}px BODY`; ctx.letterSpacing = `${(subFs * 0.04).toFixed(2)}px`;
    subW = ctx.measureText(P.sub).width; ctx.letterSpacing = '0px';
    if (subW <= maxW || subFs <= 20) break;
    subFs -= 2;
  }
  ctx.font = `${fs}px DISPLAY`;
  // left-aligned block (title, bar, subtitle share one left edge), centred as a whole
  const blockX = (CFG.W - Math.max(widest, subW)) / 2;
  const top = CFG.H * 0.44 - (lines.length * lh) / 2;
  L.fs = fs; L.lh = lh; L.words = []; L.lines = [];
  lines.forEach((ln, li) => {
    const lw = ctx.measureText(ln.join(' ')).width, base = top + (li + 0.8) * lh;
    L.lines.push({ x0: blockX, w: lw, base });
    let x = blockX;
    for (const w of ln) { const ww = ctx.measureText(w).width; L.words.push({ text: w, x, base, li }); x += ww + space; }
  });
  const last = L.lines[L.lines.length - 1];
  L.barY = last.base + fs * 0.32; L.barH = Math.max(8, fs * 0.09);
  L.barX = blockX; L.barW = widest * 0.32;
  L.subY = L.barY + L.barH + fs * 0.55; L.subFs = subFs;
  TL.words = L.words.length;
  TL.hits = L.words.map((_, i) => +(TL.wordsIn + i * TL.stagger + 0.18).toFixed(3)); // spring first reaches 1
}

export function frame(t, jit) {
  const c = ctx, l = lctx;   // c arrives cleared and pre-scaled; the offscreen layer we prep ourselves
  l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, LAYER.width, LAYER.height);
  l.setTransform(S, 0, 0, S, 0, 0);

  // --- title words: rise from behind each line's baseline (a clip mask), spring-settled; whip out upward
  l.font = `${L.fs}px DISPLAY`; l.fillStyle = P.ink; l.textBaseline = 'alphabetic';
  L.words.forEach((w, i) => {
    const ln = L.lines[w.li];
    const k = spring(t - (TL.wordsIn + i * TL.stagger), 2.2, 0.55);
    const o = whip(prog(t, TL.out + i * TL.outStagger, TL.out + i * TL.outStagger + 0.35));
    const dy = (1 - k) * L.fs * 1.1 - o * L.fs * 1.25;
    l.save();
    l.beginPath(); l.rect(ln.x0 - 40, ln.base - L.fs * 1.0, ln.w + 80, L.fs * 1.28); l.clip();
    l.fillText(w.text, w.x, w.base + dy);
    l.restore();
  });
  // --- light sweep: a skewed gradient painted only where the title already is (source-atop)
  const sp = prog(t, TL.sweep, TL.sweep + 0.55);
  if (sp > 0 && sp < 1) {
    const x = lerp(-200, CFG.W + 200, snap(sp)), cy = CFG.H * 0.44;
    const g = l.createLinearGradient(x - 90, 0, x + 90, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    l.save(); l.globalCompositeOperation = 'source-atop';
    l.translate(x, cy); l.transform(1, 0, -0.35, 1, 0, 0); l.translate(-x, -cy);
    l.fillStyle = g; l.fillRect(x - 160, 0, 320, CFG.H);
    l.restore();
  }
  c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(LAYER, 0, 0); c.setTransform(S, 0, 0, S, 0, 0);

  // --- accent bar: snaps in from the left, pulses on each word landing, wipes out to the right
  const bi = snap(prog(t, TL.barIn, TL.barIn + 0.45)), bo = whip(prog(t, TL.out + 0.08, TL.out + 0.42));
  if (bi > 0 && bo < 1) {
    const pulse = 1 + 0.5 * env(t, TL.hits, 16);
    const x0 = L.barX + bo * L.barW, x1 = L.barX + bi * L.barW, h = L.barH * pulse;
    c.fillStyle = P.accent; c.fillRect(x0, L.barY - (h - L.barH) / 2, Math.max(0, x1 - x0), h);
  }
  // --- subtitle: tracks in from wide letter-spacing while fading up; fades on exit
  const si = snap(prog(t, TL.subIn, TL.subIn + 0.7)), so = prog(t, TL.out, TL.out + 0.25);
  if (si > 0 && so < 1) {
    c.font = `${L.subFs}px BODY`; c.textAlign = 'left';
    c.letterSpacing = `${lerp(L.subFs * 0.45, L.subFs * 0.04, si).toFixed(2)}px`;
    c.fillStyle = rgba(P.ink, 0.82 * si * (1 - so));
    c.fillText(P.sub, L.barX, L.subY);
    c.letterSpacing = '0px';
  }

  // Compositing config for this subframe:
  //   use2D: composite the 2D canvas   scene: background shader id (0 = flat clear colour)
  //   P/Q/R: vec4 params for the shader   cam: [zoom, rotation, panX, panY]   clear: flat bg rgb 0..1
  const bgId = ALPHA ? 0 : { none: 0, gradient: 1, paper: 2, grid: 3 }[P.bg] ?? 1;
  return {
    t, jit, use2D: true, scene: bgId,
    P: P.bg === 'paper' ? [...rgb01(P.paper), 0] : [...rgb01(P.bgA), 1],
    Q: P.bg === 'grid' ? [...rgb01(P.accent), 1] : [...rgb01(P.bgB), 0],
    cam: [1 + 0.03 * clamp(t / CFG.DUR), 0, 0, 0],   // slow push-in for life during holds
    clear: rgb01(P.bgA),
  };
}

export function post(t) {
  return { t, bloom: 0.18, thr: 0.78, ca: 0.0008, glitch: 0, grain: 0.025, vig: 0.12, flash: 0, fade: 1, hud: 0 };
}

// Fast segments get 2x subframes so motion blur stays smooth instead of stepping.
export function subBoost(t) {
  return (t > TL.wordsIn && t < TL.wordsIn + TL.words * TL.stagger + 0.4) || t > TL.out ? 2 : 1;
}
