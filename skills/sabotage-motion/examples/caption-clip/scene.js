// THE CREATIVE FILE. Replace this example (a kinetic title card of about 3 s, at the board's energy) with your piece.
// The example lays out inside the target's safe area, exports boxes(t), and opens on a frame that is not flat, so
// `node render.mjs check` on a fresh copy of the template reports no FAIL and no WARN; keep those three habits in your
// own scene. It plays at every energy (--param energy=subtle|normal|extreme): subtle rises gently with no cuts; normal
// is bigger, cuts every two beats inside the title beat and punches each word; extreme slams the words one by one,
// huge, cuts every half beat (grounds close in luminance, so the cuts are never a flash), shakes on impacts and whips
// into the out beat once the copy is gone.
// Contract with main.js:
//   CFG                      canvas size in design pixels (W, H), FPS, DUR, FONTS to verify. W, H and
//                            FPS may be left out when you render with --target <name> (safezones.json).
//                            DUR comes from the storyboard: CFG.DUR = boardDur() (board.js, lib.js)
//   TL                       the timeline: event times shared with audio.js (it receives this TL),
//                            built from beatWindow(id) so the board stays the one source of timing
//   init({ctx, hud, scale, params, alpha, target, style, energy})   one-time setup (layout, images); params come
//                            from --param k=v; target is the safezones.json entry or null. CFG.DUR
//                            may be set here (the harness reads it after init). style is the piece's
//                            resolved look and brand kit (looks.js): colour tokens (bgA, bgB, ink, muted,
//                            accent, accent2), font roles (fontStr(style, 'display', px)), the background
//                            shader id and its colours (spread bgConfig(style, { alpha }) into frame's
//                            return), post settings, motion vocabulary and sound timbre. CFG.LOOK = '<name>'
//                            picks a look in code; --param look=<name> wins over it, brand.json over both
//                            for colours and fonts, --param bgA=#hex (any token) or bg=<id> over all.
//                            energy is the resolved energy preset (energy.js: --param energy, else CFG.ENERGY,
//                            else the board's, else normal): name, bpm and spb (its tempo), cutBeats and
//                            cutSec (the cut interval), camera, transitions, ease, post, sound; the
//                            helpers in moves.js take their amounts from it
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
//   cuts() (optional)        the scene's visual cuts and transitions: [{ t, d }] in picture time, d 0 for a
//                            hard cut, at most 0.3 s for a transition from t to t + d. check confirms each one
//                            on the frames (references/check.md section 8); moves.js cutGrid lays them on the
//                            beat grid, shotAt says which shot t is in
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
import { clamp, lerp, prog, snap, swift, whip, spring, env, rgba, beatWindow, boardDur, sceneTarget, freeSpan } from './lib.js';
import { bgConfig, fontStr } from './looks.js';
import { groundTone } from './energy.js';
import { rig, cutGrid, cutList, shotAt, entrance, slam, slamFrom, inkFont, slamWords, glitchCut, flash as flashTr, mask as maskTr, shotRand } from './moves.js';

// LOOK is unset here, so the card keeps the template's own style unless --param look=<name> or brand.json says
// otherwise; set CFG.LOOK = 'paper' (any name in looks.js) to pick one in code. The energy is the board's (board.js:
// energy), or --param energy=<subtle|normal|extreme>: the same card at each preset (plan 23.9).
export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY'] };

// One timeline shared with audio.js, so every sound lands on the visual event it belongs to. Its times hang off the
// board's beat windows (board.js), so retiming a beat there moves everything with it; init fills in the rest from the
// energy (its tempo places the cuts and the hits on the beat grid).
const [IN, OUT] = beatWindow('title'), [, END] = beatWindow('out');
export const TL = {
  energy: 'normal', bpm: 116, spb: 60 / 116,
  wordsIn: IN + 0.2, stagger: 0.07,    // title words come in one after another
  barIn: IN + 0.5,                     // accent bar
  subIn: IN + 0.6,                     // subtitle
  sweep: IN + 1.35,                    // light sweep across the title (subtle and normal, when the look allows one)
  out: OUT, end: END, outStagger: 0.04, // everything leaves at the cut into the out beat
  words: 0, hits: [],                  // word count + landing times (init)
  cuts: [], slams: [], impacts: [],    // the visual cuts [{ t, d }], extreme's slams and impacts (init)
  whipAt: null, exitAt: OUT,           // extreme: the copy is gone at exitAt, then the camera whips across the cut
};

let ctx, S = 1, ALPHA = false, P, ST, E, LAYER, lctx, SAFE, EXCL, R, TONE, CUTS = [];
const L = {};
const SLAM = { from: 1.75, d: 0.14 };

export async function init({ ctx: c, scale, params, alpha, target, style, energy }) {
  ctx = c; S = scale; ALPHA = alpha; ST = style; E = energy;
  // the copy comes from params; colours, fonts, the background, post and motion from the style (looks.js); amounts
  // from the energy (energy.js)
  P = {
    title: params.title || 'Make it move',
    sub: params.sub || 'rendered from code, frame by frame',
    ink: ST.tokens.ink, accent: ST.tokens.accent,
  };
  Object.assign(TL, { energy: E.name, bpm: E.bpm, spb: E.spb });
  // Lay out inside the safe area of the --target, else of the board's target (safezones.json), else 8% in.
  const T = await sceneTarget(target);
  SAFE = T && T.safe ? T.safe : { x: CFG.W * 0.08, y: CFG.H * 0.08, w: CFG.W * 0.84, h: CFG.H * 0.84 };
  EXCL = (T && T.exclude) || [];   // areas the platform covers inside the safe area (tiktok-ad's button column)
  LAYER = document.createElement('canvas'); LAYER.width = c.canvas.width; LAYER.height = c.canvas.height;
  lctx = LAYER.getContext('2d');
  // lay out across the safe width, then again beside any exclude rectangle the block's band reaches into
  layout({ left: SAFE.x, right: SAFE.x + SAFE.w });
  const span = freeSpan(SAFE, EXCL, L.top, L.bottom);
  if (span.left !== SAFE.x || span.right !== SAFE.x + SAFE.w) layout(span);
  timeline();
  TONE = groundTone([ST.tokens.bgA, ST.tokens.bgB], E.shotStep || 0.045);   // close to every colour the ground runs between
  // the camera: a push across each shot (the base), and the preset's hits; clamped so the text stays in the safe area
  const hits = [];
  if (E.camera.punch) for (const h of E.name === 'extreme' ? TL.slams : TL.hits) hits.push({ t: h, kind: 'punch', amp: E.camera.punch, d: E.name === 'extreme' ? 0.22 : 0.3 });
  if (E.camera.shake) for (const h of TL.impacts) hits.push({ t: h, kind: 'shake', amp: E.camera.shake, d: 0.12, f: 5, seed: Math.round(h * 100) });
  if (E.camera.bounce) hits.push({ t: TL.stackAt, kind: 'bounce', amp: E.camera.bounce, d: 0.25, f: 4 });
  if (TL.whipAt != null) hits.push({ t: TL.whipAt, kind: 'whip', d: 0.24 });
  R = rig({ W: CFG.W, H: CFG.H, safe: SAFE, exclude: EXCL, hits, base: (t) => [baseZoom(t), 0, 0, 0] });
}

// Word-wrap the title at a font size that gives its ink the energy's share of the frame height (energy.inkHeight),
// shrinking until it fits in `maxLines` lines and 90% of the span's width. Extreme also sizes each word on its own for
// its slam (one word at a time, as big as the ink range allows and the span fits).
function layout(span) {
  const SW = span.right - span.left, maxW = SW * 0.9;
  const extreme = E.name === 'extreme', upper = (s) => (extreme ? s.toUpperCase() : s);
  const words = P.title.split(/\s+/).filter(Boolean).map(upper);
  const disp = (px) => fontStr(ST, 'display', px);
  // the share aimed at: subtle and normal in the middle of their range, extreme's stacked block at its floor (its
  // slams go bigger)
  const share = E.name === 'subtle' ? 0.06 : E.name === 'normal' ? 0.115 : 0.12;
  let fs = inkFont(ctx, words.join(' '), disp, share, CFG.H), lines;
  const maxLines = extreme ? words.length : 3;
  for (;;) {
    ctx.font = disp(fs);
    lines = [[]];
    for (const w of words) {
      const cur = lines[lines.length - 1], test = [...cur, w].join(' ');
      if (cur.length && (ctx.measureText(test).width > maxW || extreme)) lines.push([w]); else cur.push(w);
    }
    const widest = Math.max(...lines.map((l) => ctx.measureText(l.join(' ')).width));
    if ((lines.length <= maxLines && widest <= maxW) || fs < 40) break;
    fs *= 0.96;
  }
  ctx.font = disp(fs);
  const lh = fs * 1.0, space = ctx.measureText(' ').width;
  const fm = ctx.measureText(words.join(' '));
  L.asc = fm.fontBoundingBoxAscent; L.desc = fm.fontBoundingBoxDescent;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l.join(' ')).width));
  // subtitle: shrink until it fits on one line (measured with its final letter-spacing)
  let subFs = clamp(fs * (extreme ? 0.2 : 0.3), 28, 64), subW;
  for (;;) {
    ctx.font = fontStr(ST, 'body', subFs); ctx.letterSpacing = `${(subFs * 0.04).toFixed(2)}px`;
    subW = ctx.measureText(P.sub).width; ctx.letterSpacing = '0px';
    if (subW <= maxW || subFs <= 20) break;
    subFs -= 2;
  }
  ctx.font = fontStr(ST, 'body', subFs);
  L.subAsc = ctx.measureText(P.sub).fontBoundingBoxAscent; L.subDesc = ctx.measureText(P.sub).fontBoundingBoxDescent;
  ctx.font = disp(fs);
  // left-aligned block (title, bar, subtitle share one left edge), centred as a whole in the safe area
  const blockW = Math.max(widest, subW), blockX = span.left + (SW - blockW) / 2;
  const room = span.left + SW * 0.95 - blockX;
  L.subTrack0 = clamp(subFs * 0.04 + (room - subW) / Math.max(1, [...P.sub].length), subFs * 0.04, subFs * 0.45);
  const barGap = fs * 0.32, barH = Math.max(8, fs * 0.09), subGap = fs * 0.4 + subFs * 0.9;
  const blockH = lines.length * lh + barGap + barH + subGap + L.subDesc;
  const top = SAFE.y + (SAFE.h - blockH) * 0.46;
  L.fs = fs; L.lh = lh; L.words = []; L.lines = []; L.upper = extreme;
  lines.forEach((ln, li) => {
    const lw = ctx.measureText(ln.join(' ')).width, base = top + li * lh + L.asc * 0.92;
    L.lines.push({ x0: blockX, w: lw, base });
    let x = blockX;
    for (const w of ln) { const ww = ctx.measureText(w).width; L.words.push({ text: w, x, w: ww, base, li }); x += ww + space; }
  });
  const last = L.lines[L.lines.length - 1];
  L.barY = last.base + barGap; L.barH = barH;
  L.barX = blockX; L.barW = widest * 0.32;
  L.subY = L.barY + barH + subGap; L.subFs = subFs;
  L.top = L.lines[0].base - L.asc; L.bottom = L.subY + L.subDesc;
  // extreme: each word alone, centred where the block is, as big as the ink range and the span allow (its slam)
  L.solo = [];
  if (extreme) {
    const cy = L.lines[0].base - L.asc + (last.base - L.lines[0].base + L.asc) / 2;
    for (const w of words) {
      let wfs = inkFont(ctx, w, disp, 0.27, CFG.H);
      ctx.font = disp(wfs);
      const ww = ctx.measureText(w).width;
      if (ww > maxW) wfs *= maxW / ww;
      ctx.font = disp(wfs);
      const m = ctx.measureText(w), mw = m.width, ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      // its ink centred on the block's centre, and kept clear of the subtitle below
      const base = Math.min(cy + ink / 2 - m.actualBoundingBoxDescent, L.subY - L.subAsc - fs * 0.5 - m.actualBoundingBoxDescent);
      const x = span.left + (SW - mw) / 2, fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent;
      // it slams down from as big as the safe area lets its box grow (slamFrom), so it never leaves it
      L.solo.push({ text: w, x, base, font: disp(wfs), from: slamFrom({ x, y: base - fa, w: mw, h: fa + fd }, SAFE, SLAM.from) });
    }
    const bw = Math.max(...L.lines.map((x) => x.w));
    L.stackFrom = slamFrom({ x: L.lines[0].x0, y: L.top, w: bw, h: last.base + L.desc - L.top }, SAFE, SLAM.from);
  }
  TL.words = L.words.length;
}

// The timeline from the energy: when the words land, where the cuts fall on the beat grid, when the copy leaves.
function timeline() {
  const spb = E.spb, name = E.name;
  TL.stagger = name === 'extreme' ? spb : name === 'normal' ? Math.min(ST.motion.stagger, 0.06) : Math.max(ST.motion.stagger, 0.09);
  if (name === 'extreme') {
    // a slam on each beat, word by word, then the whole title stacked on the next beat; the copy is gone a little
    // before the cut into the out beat, so the whip there carries no text
    TL.wordsIn = IN + 0.06;
    TL.slams = L.solo.map((_, i) => +(TL.wordsIn + i * spb).toFixed(4));
    TL.stackAt = +(TL.wordsIn + L.solo.length * spb).toFixed(4);
    TL.subIn = TL.slams[Math.min(1, TL.slams.length - 1)];
    TL.barIn = TL.stackAt;
    TL.hits = [...TL.slams, TL.stackAt];
    TL.impacts = [...TL.slams, TL.stackAt];
    TL.whipAt = +(OUT - 0.12).toFixed(4);
    TL.exitAt = +(TL.whipAt - 0.12).toFixed(4);
  } else {
    TL.wordsIn = IN + (name === 'subtle' ? 0.2 : 0.15);
    TL.barIn = IN + (name === 'subtle' ? 0.5 : 0.42);
    TL.subIn = IN + (name === 'subtle' ? 0.55 : 0.5);
    TL.sweep = IN + (name === 'subtle' ? 1.35 : 1.25);
    TL.hits = L.words.map((_, i) => +(TL.wordsIn + i * TL.stagger + (name === 'subtle' ? 0.3 : 0.12)).toFixed(4));
    TL.slams = []; TL.impacts = []; TL.whipAt = null; TL.exitAt = OUT;
  }
  // the visual cuts (23.9: inside beats, the copy staying on screen across them), on the energy's beat grid
  const every = E.cutBeats[0];
  let list = [];
  if (name === 'normal') {
    list = cutGrid(IN, OUT, spb, every).map((t) => ({ t, d: 0.2 }));      // mask wipes inside the title beat; the
    // out beat stays on the last shot's ground, so its one beat lengthens that shot instead of being a shot of its own
  } else if (name === 'extreme') {
    const away = (t) => t < TL.whipAt - 0.16 || t > TL.whipAt + 0.24 + 0.16; // no shot shorter than 0.15 s next to the whip
    list = [...cutGrid(IN, END, spb, every).filter(away).map((t) => ({ t, d: 0 })), { t: TL.whipAt, d: 0.24 }];
  }
  CUTS = cutList(list);
  TL.cuts = CUTS.map((c) => c.t);
  TL.glitches = name === 'extreme' ? CUTS.filter((c) => c.d === 0).filter((_, i) => i % 3 === 1).map((c) => ({ t: c.t - 0.03, d: 0.08 })) : [];
  TL.flashes = name === 'extreme' ? [{ t: TL.whipAt + 0.08, d: 0.1 }] : [];
}

// The scene's visual cuts and transitions, [{ t, d }] (plan 23.9; check confirms each one on the frames).
export const cuts = () => CUTS.map((c) => ({ ...c }));

// The camera's base: a push across each shot, a new framing on every cut (alternating), never more than the preset's.
function baseZoom(t) {
  if (E.name === 'subtle') return 1 + E.camera.push * (t / E.spb) * 0.5;
  const i = shotAt(CUTS, t), from = i ? CUTS[i - 1].t : 0, to = i < CUTS.length ? CUTS[i].t : CFG.DUR;
  return 1 + (i % 2) * E.camera.push + E.camera.push * swift(prog(t, from, to));
}

// The style's motion vocabulary (looks.js) with the energy's ease: how an element enters (dt seconds after its start;
// 0 -> 1, may overshoot) and how it leaves (whip: a fast smear out; cut: gone at once, a hard cut). A look whose
// entrance is 'step' keeps its four hard steps at any energy.
function enterK(dt) {
  if (ST.motion.enter === 'step') return Math.floor(prog(dt, 0, E.name === 'subtle' ? 0.48 : 0.36) * 4 + 1e-9) / 4;
  return entrance(E.ease)(dt);
}
const exitK = (t, at, dur) => (ST.motion.exit === 'cut' ? (t >= at ? 1 : 0) : E.name === 'subtle' ? swift(prog(t, at, at + dur * 1.6)) : whip(prog(t, at, at + dur)));

// Where each title word is at t: its offset below (rising in) or above (leaving) its baseline, and the line's clip
// mask it is drawn through. frame() draws from it and boxes() reports it, so the two always agree.
function wordAt(i, t) {
  const w = L.words[i], ln = L.lines[w.li];
  const k = enterK(t - (TL.wordsIn + i * TL.stagger));
  const o = exitK(t, TL.out + i * TL.outStagger, 0.35);
  return { w, dy: (1 - k) * L.fs * 1.1 - o * L.fs * 1.25, clip: { x: ln.x0 - 40, y: ln.base - L.fs * 1.0, w: ln.w + 80, h: L.fs * 1.32 } };
}
// extreme: the stacked title slams in on its beat and leaves (scaled up, fading) just before the whip
function stackK(t) {
  const { s, a } = slam(t - TL.stackAt, { ...SLAM, from: L.stackFrom });
  const x = prog(t, TL.exitAt, TL.exitAt + 0.1);
  return { s: s * (1 - 0.15 * x), a: a * (1 - x) };
}
const subTrack = (si) => lerp(L.subTrack0, L.subFs * 0.04, si);
const subFade = (t) => {
  const si = E.name === 'extreme' ? 1 : snap(prog(t, TL.subIn, TL.subIn + (E.name === 'subtle' ? 0.8 : 0.45)));
  const into = E.name === 'extreme' ? prog(t, TL.subIn, TL.subIn + 0.08) : si;
  const so = E.name === 'extreme' ? prog(t, TL.exitAt, TL.exitAt + 0.1) : ST.motion.exit === 'cut' ? (t >= TL.out ? 1 : 0) : prog(t, TL.out, TL.out + 0.25);
  return { si, a: 0.82 * into * (1 - so) };
};
// The words of the title on screen at t, as slamWords takes them (extreme): one word alone on each slam, then the stack.
function soloWords(t) {
  if (t >= TL.stackAt) return [];
  return L.solo.map((w, i) => ({ ...w, at: TL.slams[i], until: i + 1 < L.solo.length ? TL.slams[i + 1] : TL.stackAt }));
}

// The ground (normal and extreme): stripes in a tone close to the background's (energy.js groundTone: never a flash
// between shots), at a new angle on every cut, scrolling; normal reveals each new shot through an iris (mask).
const ANG = [-0.42, 0.33, -1.05, 0.62, -0.18, 1.2, -0.75, 0.05];
function stripes(c, t, i, alpha = 1) {
  const period = E.name === 'extreme' ? 150 : 170, speed = E.name === 'extreme' ? 420 : 110;
  const a = ANG[i % ANG.length], diag = Math.hypot(CFG.W, CFG.H), off = (shotRand(i, 3) * period + speed * t) % period;
  c.save();
  c.globalAlpha = alpha;
  c.translate(CFG.W / 2, CFG.H / 2); c.rotate(a);
  c.fillStyle = TONE;
  for (let x = -diag / 2 - period + off; x < diag / 2; x += period) c.fillRect(x, -diag / 2, period * 0.5, diag);
  c.restore();
}
function ground(c, t) {
  if (E.name === 'subtle' || ALPHA) return;
  const i = shotAt(CUTS, t), cur = CUTS.find((x) => x.d > 0 && t >= x.t && t < x.t + x.d);
  if (E.name === 'normal' && cur) {
    // the iris: the old shot's ground, the new shot's inside a circle growing from the centre
    const j = CUTS.indexOf(cur), m = maskTr(t, cur.t, cur.d);
    stripes(c, t, j);
    c.save(); c.beginPath(); c.arc(CFG.W / 2, CFG.H / 2, m.r * Math.hypot(CFG.W, CFG.H) * 0.5 + 1, 0, Math.PI * 2); c.clip();
    c.fillStyle = ST.tokens.bgA; c.fillRect(0, 0, CFG.W, CFG.H);
    stripes(c, t, j + 1);
    c.restore();
    return;
  }
  stripes(c, t, i);
}

export function frame(t, jit) {
  const c = ctx, l = lctx;   // c arrives cleared and pre-scaled; the offscreen layer we prep ourselves
  ground(c, t);
  l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, LAYER.width, LAYER.height);
  l.setTransform(S, 0, 0, S, 0, 0);

  if (E.name === 'extreme') {
    // --- slams: one word at a time on the beat, then the whole title stacked
    slamWords(l, soloWords(t), t, { group: P.title, color: P.ink, slam: SLAM, id: 'solo' });
    const st = stackK(t);
    if (st.a > 0.001) {
      const cx = L.lines[0].x0 + Math.max(...L.lines.map((x) => x.w)) / 2, cy = (L.top + L.lines[L.lines.length - 1].base) / 2;
      l.save(); l.globalAlpha = st.a; l.translate(cx, cy); l.scale(st.s, st.s); l.translate(-cx, -cy);
      l.font = fontStr(ST, 'display', L.fs); l.fillStyle = P.ink; l.textBaseline = 'alphabetic';
      for (const w of L.words) l.fillText(w.text, w.x, w.base);
      l.restore();
    }
  } else {
    // --- title words: rise from behind each line's baseline (a clip mask), with the energy's ease; leave upward
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
      const x = lerp(-200, CFG.W + 200, snap(sp)), cy = L.top + (L.lines[L.lines.length - 1].base - L.top) / 2;
      const g = l.createLinearGradient(x - 90, 0, x + 90, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      l.save(); l.globalCompositeOperation = 'source-atop';
      l.translate(x, cy); l.transform(1, 0, -0.35, 1, 0, 0); l.translate(-x, -cy);
      l.fillStyle = g; l.fillRect(x - 160, 0, 320, CFG.H);
      l.restore();
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(LAYER, 0, 0); c.setTransform(S, 0, 0, S, 0, 0);

  // --- frame marks: a corner bracket at each corner of the safe area, there from the first frame (so the
  // thumbnail is never a flat colour) until everything leaves; they also show where the safe area is
  const fo = exitK(t, TL.out, 0.3), arm = 54, inset = 14;
  if (fo < 1) {
    c.strokeStyle = rgba(P.ink, 0.55 * (1 - fo)); c.lineWidth = 5;
    const x0 = SAFE.x + inset, y0 = SAFE.y + inset, x1 = SAFE.x + SAFE.w - inset, y1 = SAFE.y + SAFE.h - inset;
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      c.beginPath(); c.moveTo(x, y + sy * arm * (1 - fo)); c.lineTo(x, y); c.lineTo(x + sx * arm * (1 - fo), y); c.stroke();
    }
  }
  // --- accent bar: snaps in from the left, pulses on each landing, leaves to the right
  const bi = E.name === 'extreme' ? (t >= TL.barIn ? 1 : 0) : snap(prog(t, TL.barIn, TL.barIn + 0.45));
  const bo = E.name === 'extreme' ? prog(t, TL.exitAt, TL.exitAt + 0.1) : exitK(t, TL.out + 0.08, 0.34);
  if (bi > 0 && bo < 1) {
    const pulse = 1 + 0.5 * env(t, TL.hits, 16);
    const x0 = L.barX + bo * L.barW, x1 = L.barX + bi * L.barW, h = L.barH * pulse;
    c.fillStyle = P.accent; c.fillRect(x0, L.barY - (h - L.barH) / 2, Math.max(0, x1 - x0), h);
  }
  // --- subtitle: tracks in from wide letter-spacing while fading up (extreme: on at once); fades on exit
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
  // bgConfig(style) gives scene, P, Q, R and clear from the style's shader id (bg) and its colour tokens. The camera
  // is the rig's (moves.js): pushes, punches, shake, a whip, clamped so every text box stays in the safe area.
  return { t, jit, use2D: true, ...bgConfig(ST, { alpha: ALPHA }), cam: R.at(t, boxes(t)) };
}

// The text on screen at t, for `node render.mjs check` (see the contract above): each title word (cut to its line's
// mask, or as it slams), all in one group, the whole title (so check reads them as one phrase), and the subtitle at its
// current letter-spacing, while its alpha is above 0.05.
export function boxes(t) {
  const out = [];
  if (E.name === 'extreme') {
    out.push(...slamWords(ctx, soloWords(t), t, { group: P.title, slam: SLAM, id: 'solo', draw: false }));
    const st = stackK(t);
    if (st.a > 0.05) {
      const cx = L.lines[0].x0 + Math.max(...L.lines.map((x) => x.w)) / 2, cy = (L.top + L.lines[L.lines.length - 1].base) / 2;
      L.words.forEach((w, i) => {
        const x0 = cx + (w.x - cx) * st.s, y0 = cy + (w.base - L.asc - cy) * st.s;
        out.push({ id: `title${i}`, text: w.text, x: x0, y: y0, w: w.w * st.s, h: (L.asc + L.desc) * st.s, group: P.title });
      });
    }
  } else {
    L.words.forEach((_, i) => {
      const { w, dy, clip } = wordAt(i, t);
      const y0 = Math.max(w.base + dy - L.asc, clip.y), y1 = Math.min(w.base + dy + L.desc, clip.y + clip.h);
      const x0 = Math.max(w.x, clip.x), x1 = Math.min(w.x + w.w, clip.x + clip.w);
      if (y1 > y0 && x1 > x0) out.push({ id: `title${i}`, text: w.text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, group: P.title });
    });
  }
  const { si, a } = subFade(t);
  if (a > 0.05) {
    ctx.save();
    ctx.font = fontStr(ST, 'body', L.subFs); ctx.letterSpacing = `${subTrack(si).toFixed(2)}px`;
    const w = ctx.measureText(P.sub).width;
    ctx.restore();
    out.push({ id: 'sub', text: P.sub, x: L.barX, y: L.subY - L.subAsc, w, h: L.subAsc + L.subDesc, group: P.sub });
  }
  return out;
}

// Post from the style, scaled by the energy: bloom and grain, chromatic aberration on the hits (extreme), and, where the
// look allows them, a glitch on some of extreme's cuts and a flash frame on its whip (the flash check holds it).
export function post(t) {
  const p = ST.post, e = E.post;
  let g = ST.motion.glitch && E.name !== 'extreme' ? 0.6 * Math.exp(-Math.pow((t - TL.out) / 0.06, 2)) : 0, fl = 0;
  for (const x of TL.glitches) g = Math.max(g, glitchCut(t, x.t, x.d, { style: ST }).glitch);
  for (const x of TL.flashes) fl = Math.max(fl, flashTr(t, x.t, x.d, { style: ST }).flash);
  const ca = p.ca + (e.hitCa ? e.hitCa * env(t, TL.hits, 14) : 0);
  return { t, bloom: p.bloom * e.bloom, thr: p.thr, ca, glitch: g, grain: p.grain * e.grain, vig: p.vig, scan: p.scan, flash: fl, fade: 1, hud: 0 };
}

// Fast segments get 2x subframes (3x at extreme) so motion blur stays smooth instead of stepping.
export function subBoost(t) {
  if (E.name === 'extreme') return 3;
  return (t > TL.wordsIn && t < TL.wordsIn + TL.words * TL.stagger + 0.4) || t > TL.out ? 2 : 1;
}
