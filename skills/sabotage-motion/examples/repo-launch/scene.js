// REPO-LAUNCH: a 15 s, 9:16 launch video for a made-up project, Snagwick (fixture/), made the way references/launch.md
// says (the scene contract is in the template's scene.js header):
//   - the kit is the one tools/repo-scan.mjs drafted from fixture/ (brand.json): its colours, its two faces and its logo
//   - the hook is the pitch the scan found, under the logo
//   - the install is a terminal session (code.js's termSession, terminal) typing the command the scan found
//   - two feature beats: a source file with its TODOs lighting up (codeBlock, drawCode, in a window), and the app's
//     board, a full-page screenshot tools/shots.mjs took of fixture/app/index.html, panned inside a phone
//   - the end card: the logo, the name and the install command, held to the last frame
// The base look is product (quiet post, snap entrances, no glitch); the kit's colours and faces win over it. Windows
// and the phone fade or rise in place, so no text leaves the safe area. boxes(t) returns every text box, with the
// helpers' layout-only calls, so check sees all of it; the logo and the screenshot are pictures, not text.
import { clamp, prog, snap, swift, whip, spring, beatWindow, boardDur, sceneTarget } from './lib.js';
import { bgConfig, fontStr } from './looks.js';
import { codeTheme, frameLayout, drawFrame, termSession, terminal, codeBlock, drawCode, typedTimes, keyTicks, fitSize } from './code.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['MONO'], LOOK: 'product' };

const [H0, H1] = beatWindow('hook'), [I0] = beatWindow('install'), [F0, F1] = beatWindow('find'), [B0, B1] = beatWindow('board'), [E0] = beatWindow('end');
// The timeline audio.js plays from; keys, bar, installed and lights are filled in init from the blocks.
export const TL = {
  pop: H0 + 0.05, lines: [H0 + 0.3, H0 + 0.42],
  cuts: [I0, F0, B0, E0],
  keys: [], bar: [0, 0], installed: 0,
  lights: [F0 + 0.7, F0 + 1.25, F0 + 1.8],
  rise: B0 + 0.05, pan: [B0 + 0.65, B1 - 0.35],
  land: E0 + 0.04, end: CFG.DUR,
};

const INSTALL = 'npm install -g snagwick';
const SRC = `import { open, verify } from './store';

export async function login(user, pass) {
  // TODO(ana): rate-limit failed logins
  const session = await open(user, pass);
  // FIXME: expired tokens still pass
  if (!verify(session)) throw denied();
  // TODO(ana): rotate the signing key
  return session.token;
}`;
const HEADS = [['Install it.', I0], ['It finds every TODO.', F0], ['Sorted on one board.', B0]];
const HOOK = ['Your TODOs,', 'on one board.'];

let ctx, S = 1, ALPHA = false, ST, TH, SAFE, CX, TWIN, TERM, CWIN, CODE, PHONE, LOGO, SHOT, HEAD, HK, END;

async function image(src) { const im = new Image(); im.src = src; await im.decode(); return im; }

export async function init({ ctx: c, scale, alpha, target, style }) {
  ctx = c; S = scale; ALPHA = alpha; ST = style;
  const T = await sceneTarget(target);
  SAFE = T && T.safe ? T.safe : { x: 44, y: 130, w: 896, h: 1306 };
  CX = SAFE.x + SAFE.w / 2;
  // the kit's logo (brand.json names it) and the app's screenshot (tools/shots.mjs page app fixture/app/index.html)
  const kit = await (await fetch('./brand.json')).json();
  LOGO = await image(kit.logo.onDark);
  SHOT = await image('assets/shots/app.png');
  TH = codeTheme(ST);
  const x = SAFE.x + 28, w = SAFE.w - 56;
  TWIN = frameLayout('window', { x, y: 600, w, h: 300 });
  TERM = termSession({ ...TWIN.content, theme: TH, size: 34, lineH: 1.6, prompt: 'mossgate $ ', id: 'term', type: { cps: 24, seed: 7 },
    steps: [
      { cmd: INSTALL, at: I0 + 0.5 },
      { bar: 'fetching snagwick 1.2.0', dur: 0.75, width: 10, done: '+ added snagwick 1.2.0', doneKind: 'add' },
    ] });
  const size = fitSize(ctx, TH.family, Math.max(...SRC.split('\n').map((l) => l.length)) + 5, w - 40, { max: 32, min: 20 });
  CWIN = frameLayout('window', { x, y: 600, w, h: 56 + Math.ceil(SRC.split('\n').length * size * 1.7 + 2 * size) });
  CODE = codeBlock({ src: SRC, lang: 'ts', ...CWIN.content, theme: TH, size, lineH: 1.7, type: false, cursor: false, id: 'code',
    highlight: [4, 6, 8].map((l, i) => ({ lines: [l, l], from: TL.lights[i], to: F1 + 1 })) });
  PHONE = frameLayout('phone', { x: CX - 265, y: 560, w: 530, h: 870 });
  // the headlines: the largest display size at which the longest fits the safe width
  let fs = 104;
  for (;;) { ctx.font = fontStr(ST, 'display', fs); if (Math.max(...HEADS.map(([h]) => ctx.measureText(h).width)) <= w || fs <= 48) break; fs -= 4; }
  const m = ctx.measureText('Sorted on one board.');
  HEAD = { x: x + 4, base: 500, fs, asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent, w: HEADS.map(([h]) => ctx.measureText(h).width) };
  let hs = 132;
  for (;;) { ctx.font = fontStr(ST, 'display', hs); if (Math.max(...HOOK.map((h) => ctx.measureText(h).width)) <= SAFE.w - 80 || hs <= 60) break; hs -= 4; }
  const hm = ctx.measureText(HOOK[1]);
  HK = { fs: hs, asc: hm.fontBoundingBoxAscent, desc: hm.fontBoundingBoxDescent, w: HOOK.map((h) => ctx.measureText(h).width), base: [960, 960 + hs * 1.12] };
  ctx.font = fontStr(ST, 'display', 150);
  const em = ctx.measureText('Snagwick');
  ctx.font = `40px "${TH.family}"`;
  END = { fs: 150, w: em.width, asc: em.fontBoundingBoxAscent, desc: em.fontBoundingBoxDescent, base: 980, pill: { w: ctx.measureText('$ ' + INSTALL).width + 72, h: 92, y: 1060 } };
  // the sound's timeline, from the blocks themselves
  TL.keys = keyTicks(typedTimes(TERM));
  const bar = TERM.rows.find((r) => r.type === 'bar');
  TL.bar = [bar.at, bar.at + bar.dur]; TL.installed = bar.at + bar.dur;
}

// ---------------------------------------------------------------- each part's state at t
// A beat's content comes in over `inDur` after its start and leaves over the last 0.22 s before the next beat (the end
// card never leaves): { k: 0 to 1 in, o: 0 to 1 out }.
const inOut = (t, a, b, inDur = 0.45, last = false) => ({ k: snap(prog(t, a, a + inDur)), o: last ? 0 : whip(prog(t, b - 0.22, b)) });
const hookLogo = (t) => ({ s: 0.72 + 0.28 * clamp(spring(t - TL.pop, 2.6, 0.5), 0, 1.2), o: whip(prog(t, H1 - 0.22, H1)) });
const lineK = (t, i) => snap(prog(t, TL.lines[i], TL.lines[i] + 0.5));
const termK = (t) => inOut(t, I0 + 0.02, F0, 0.35);
const codeK = (t) => inOut(t, F0 + 0.02, B0, 0.35);
const phoneK = (t) => inOut(t, TL.rise, E0, 0.5);
const endK = (t) => ({ logo: clamp(spring(t - TL.land, 2.4, 0.55), 0, 1.15), name: snap(prog(t, TL.land + 0.2, TL.land + 0.7)), pill: snap(prog(t, TL.land + 0.35, TL.land + 0.85)) });
const panY = (t) => swift(prog(t, TL.pan[0], TL.pan[1])) * 1200;   // image pixels down the screenshot

// The headline in effect at t: how far it has risen (0 to 1) and how far it has left.
function headAt(t, i) {
  const [, from] = HEADS[i], to = i + 1 < HEADS.length ? HEADS[i + 1][1] : E0;
  const k = snap(prog(t, from + 0.04, from + 0.5)), o = whip(prog(t, to - 0.26, to));
  return { k, o, dy: (1 - k) * HEAD.fs * 1.15 - o * HEAD.fs * 1.2 };
}
const headClip = () => ({ x: HEAD.x - 20, y: HEAD.base - HEAD.asc - 6, w: 900, h: HEAD.asc + HEAD.desc + 12 });
// One rising line of the hook: its clip and its baseline offset.
function hookLine(t, i) {
  const k = lineK(t, i), o = whip(prog(t, H1 - 0.26, H1));
  const clip = { x: SAFE.x, y: HK.base[i] - HK.asc - 6, w: SAFE.w, h: HK.asc + HK.desc + 12 };
  return { k, o, dy: (1 - k) * HK.fs * 1.15 - o * HK.fs * 1.2, clip };
}
const cut = (y0, h, clip) => { const a = Math.max(y0, clip.y), b = Math.min(y0 + h, clip.y + clip.h); return b > a ? [a, b - a] : null; };

// ---------------------------------------------------------------- frame
function drawLogo(c, cx, cy, size, s, alpha) {
  if (alpha <= 0.001 || s <= 0) return;
  c.save(); c.globalAlpha = alpha;
  c.translate(cx, cy); c.scale(s, s);
  c.drawImage(LOGO, -size / 2, -size / 2, size, size);
  c.restore();
}
function drawPhoneShot(c, t, L, alpha) {
  const sc = L.content.w / SHOT.width, srcH = L.content.h / sc, y0 = Math.min(panY(t), SHOT.height - srcH);
  c.save(); c.globalAlpha = alpha;
  c.beginPath(); c.roundRect(L.screen.x, L.screen.y, L.screen.w, L.screen.h, L.inner); c.clip();
  c.beginPath(); c.rect(L.content.x, L.content.y, L.content.w, L.content.h); c.clip();
  c.imageSmoothingQuality = 'high';
  c.drawImage(SHOT, 0, y0, SHOT.width, srcH, L.content.x, L.content.y, L.content.w, L.content.h);
  c.restore();
}

export function frame(t, jit) {
  const c = ctx, tk = ST.tokens;
  // hook: the logo and the pitch
  if (t < H1) {
    const g = hookLogo(t);
    drawLogo(c, CX, 640, 260, g.s, 1 - g.o);
    c.font = fontStr(ST, 'display', HK.fs); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    HOOK.forEach((line, i) => {
      const h = hookLine(t, i);
      if (h.k <= 0 || h.o >= 1) return;
      c.save(); c.beginPath(); c.rect(h.clip.x, h.clip.y, h.clip.w, h.clip.h); c.clip();
      c.fillStyle = i ? tk.accent : tk.ink; c.fillText(line, CX - HK.w[i] / 2, HK.base[i] + h.dy);
      c.restore();
    });
  }
  // the headlines of the three middle beats
  const hc = headClip();
  c.save(); c.beginPath(); c.rect(hc.x, hc.y, hc.w, hc.h); c.clip();
  c.font = fontStr(ST, 'display', HEAD.fs); c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillStyle = tk.ink;
  HEADS.forEach(([text], i) => { const h = headAt(t, i); if (h.k > 0 && h.o < 1) c.fillText(text, HEAD.x, HEAD.base + h.dy); });
  c.restore();
  // install: the terminal
  const tm = termK(t), ta = tm.k * (1 - tm.o);
  if (ta > 0) {
    drawFrame(c, 'window', TWIN.outer, { theme: TH, title: '~/mossgate', alpha: ta, dy: (1 - tm.k) * 30 });
    terminal(c, TERM, t, { alpha: ta, dy: (1 - tm.k) * 30 });
  }
  // find: the source file, its TODOs lighting up
  const cm = codeK(t), ca = cm.k * (1 - cm.o);
  if (ca > 0) {
    drawFrame(c, 'window', CWIN.outer, { theme: TH, title: 'src/auth/session.ts', alpha: ca, dy: (1 - cm.k) * 30 });
    drawCode(c, CODE, t, { alpha: ca, dy: (1 - cm.k) * 30 });
  }
  // board: the app in a phone, panned
  const pm = phoneK(t), pa = pm.k * (1 - pm.o);
  if (pa > 0) {
    const dy = (1 - pm.k) * 60, fr = drawFrame(c, 'phone', PHONE.outer, { theme: TH, alpha: pa, dy });
    drawPhoneShot(c, t, fr.layout, pa);
  }
  // end: the logo, the name and the install command
  if (t >= E0) {
    const e = endK(t);
    drawLogo(c, CX, 640, 240, 0.6 + 0.4 * e.logo, clamp(e.logo * 3));
    if (e.name > 0) {
      c.save(); c.globalAlpha = e.name; c.font = fontStr(ST, 'display', END.fs); c.fillStyle = tk.ink; c.textAlign = 'left';
      c.fillText('Snagwick', CX - END.w / 2, END.base + (1 - e.name) * 40); c.restore();
    }
    if (e.pill > 0) {
      const p = END.pill, px = CX - p.w / 2, py = p.y + (1 - e.pill) * 30;
      c.save(); c.globalAlpha = e.pill;
      c.fillStyle = TH.surface; c.beginPath(); c.roundRect(px, py, p.w, p.h, p.h / 2); c.fill();
      c.strokeStyle = tk.accent; c.lineWidth = 3; c.stroke();
      c.font = `40px "${TH.family}"`; c.textBaseline = 'middle'; c.textAlign = 'left';
      c.fillStyle = tk.accent; c.fillText('$', px + 36, py + p.h / 2);
      c.fillStyle = tk.ink; c.fillText(' ' + INSTALL, px + 36 + c.measureText('$').width, py + p.h / 2);
      c.restore();
    }
  }
  return {
    t, jit, use2D: true, ...bgConfig(ST, { alpha: ALPHA }),
    cam: [1 + 0.02 * clamp(t / CFG.DUR), 0, 0, 0],   // a slow push, for life on the holds
  };
}

// ---------------------------------------------------------------- the text on screen at t
export function boxes(t) {
  const out = [];
  if (t < H1) {
    HOOK.forEach((line, i) => {
      const h = hookLine(t, i);
      if (h.k <= 0 || h.o >= 1) return;
      const y = HK.base[i] + h.dy, v = cut(y - HK.asc, HK.asc + HK.desc, h.clip);
      if (v) out.push({ id: `hook${i}`, text: line, x: CX - HK.w[i] / 2, y: v[0], w: HK.w[i], h: v[1], group: 'hook' });
    });
  }
  const hc = headClip();
  HEADS.forEach(([text], i) => {
    const h = headAt(t, i);
    if (h.k <= 0 || h.o >= 1) return;
    const v = cut(HEAD.base + h.dy - HEAD.asc, HEAD.asc + HEAD.desc, hc);
    if (v) out.push({ id: `head${i}`, text, x: HEAD.x, y: v[0], w: HEAD.w[i], h: v[1], group: `head${i}` });
  });
  const tm = termK(t), ta = tm.k * (1 - tm.o);
  if (ta > 0) {
    out.push(...drawFrame(ctx, 'window', TWIN.outer, { theme: TH, title: '~/mossgate', alpha: ta, dy: (1 - tm.k) * 30, draw: false, id: 'twin' }));
    out.push(...terminal(ctx, TERM, t, { alpha: ta, dy: (1 - tm.k) * 30, draw: false }));
  }
  const cm = codeK(t), ca = cm.k * (1 - cm.o);
  if (ca > 0) {
    out.push(...drawFrame(ctx, 'window', CWIN.outer, { theme: TH, title: 'src/auth/session.ts', alpha: ca, dy: (1 - cm.k) * 30, draw: false, id: 'cwin' }));
    out.push(...drawCode(ctx, CODE, t, { alpha: ca, dy: (1 - cm.k) * 30, draw: false }));
  }
  const pm = phoneK(t), pa = pm.k * (1 - pm.o);
  if (pa > 0) out.push(...drawFrame(ctx, 'phone', PHONE.outer, { theme: TH, alpha: pa, dy: (1 - pm.k) * 60, draw: false, id: 'phone' }));
  if (t >= E0) {
    const e = endK(t);
    if (e.name > 0.05) out.push({ id: 'name', text: 'Snagwick', x: CX - END.w / 2, y: END.base + (1 - e.name) * 40 - END.asc, w: END.w, h: END.asc + END.desc, group: 'name' });
    if (e.pill > 0.05) {
      const p = END.pill;
      out.push({ id: 'pill', text: '$ ' + INSTALL, x: CX - p.w / 2 + 36, y: p.y + (1 - e.pill) * 30 + p.h / 2 - 24, w: p.w - 72, h: 48, group: 'pill' });
    }
  }
  return out;
}

// The look's post (product: quiet), with a soft flash as the end card lands.
export function post(t) {
  const p = ST.post;
  return { t, bloom: p.bloom, thr: p.thr, ca: p.ca, glitch: 0, grain: p.grain, vig: Math.max(p.vig, 0.12), scan: p.scan,
    flash: 0.12 * Math.exp(-Math.max(0, t - TL.land) * 14) * (t >= TL.land ? 1 : 0), fade: 1, hud: 0 };
}

// More subframes while the headlines whip out and the end card springs in.
export function subBoost(t) {
  const near = (x, a = 0.3) => Math.abs(t - x) < a;
  return TL.cuts.some((x) => near(x)) || near(TL.land, 0.4) ? 2 : 1;
}
