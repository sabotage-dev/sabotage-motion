// Page harness: owns the canvases, the motion-blur loop and the window API that render.mjs drives.
// You normally don't edit this file; the creative work lives in the scene (scene.js by default) and audio.js.
//
// render.mjs sets the URL query: scene=<file> (default scene.js), target=<name> (an entry in
// safezones.json), scale, fps, sub, alpha=1, check=1 (render.mjs check: a missing font is reported, not
// thrown), and p.<key>=<value> for each --param key=value.
//
// The energy (energy.js, plan 23.9): --param energy, else CFG.ENERGY, else the board's energy, else normal, resolved
// once here into the preset (tempo, cut interval, camera, type scale, easing, post, sound) and handed to init({ energy })
// and to audio.js. window.INFO.ENERGY says which, at what tempo, and from where; window.sceneCuts() returns the scene's
// declared cuts (its cuts() export) checked, for check's energy measurements.
//
// The style (looks.js, plan 23.2): before the scene's init, the harness resolves the look (--param look, else
// CFG.LOOK, else brand.json's look) and the brand kit (brand.json beside index.html) into one style, registers
// the look's and the kit's font files with FontFace and adds their families to CFG.FONTS, and hands the style to
// init({ style }) and to audio.js. It also records, at every fillText and strokeText the scene makes, the font
// families in effect (fonts_used in the render record); setting ctx.font only to measure or lay out text is not
// recorded.
import { createPipeline } from './gl.js';
import { encodeWav } from './wav.js';
import * as LK from './looks.js';
import { resolveEnergy } from './energy.js';

const q = new URLSearchParams(location.search);
const params = {};                                    // --param k=v from render.mjs arrive as p.k
for (const [k, v] of q) if (k.startsWith('p.')) params[k.slice(2)] = v;

const SCENE_FILE = q.get('scene') || 'scene.js';
const TARGET = q.get('target') || null;
const SCALE = +(q.get('scale') || 1);
const SUB = +(q.get('sub') || 8);
const ALPHA = q.get('alpha') === '1';
const CHECK = q.get('check') === '1';
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

let scene, CFG, FPS, RW, RH, pipe, canvas, c2, hud, c2ctx, hudctx, STYLE = null, BRAND = null, ENERGY = null;
const FONT_PROBLEMS = [], FACES = [];

// fonts_used: the families of ctx.font at every fillText and strokeText while the scene draws (its init, frame and
// drawHud), on any 2D context, offscreen ones included. Parsed once per font string.
const FONTS_USED = new Set(), famCache = new Map();
let RECORD = 0;
let NOTEXT = 0;   // P11b-2 energy_match: while set, fillText and strokeText draw nothing (the text-off render)
for (const K of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
  if (!K) continue;
  for (const m of ['fillText', 'strokeText']) {
    const orig = K.prototype[m];
    K.prototype[m] = function (...a) {
      if (NOTEXT) return undefined;
      if (RECORD) {
        const f = this.font;
        let fams = famCache.get(f);
        if (!fams) famCache.set(f, (fams = LK.fontFamilies(f)));
        for (const x of fams) FONTS_USED.add(x);
      }
      return orig.apply(this, a);
    };
  }
}
const recording = (fn) => { RECORD++; try { return fn(); } finally { RECORD--; } };
const recordingAsync = async (fn) => { RECORD++; try { return await fn(); } finally { RECORD--; } };

// brand.json beside index.html, parsed, or null when the piece has none. render.mjs answers /__exists, so a piece
// without a kit logs no 404.
async function loadBrand() {
  try { const r = await fetch('./__exists?path=brand.json'); if (r.ok && !(await r.json()).exists) return null; } catch { /* other server: just try it */ }
  const r = await fetch('./brand.json', { cache: 'no-store' });
  if (!r.ok) return null;
  const text = await r.text();
  let kit;
  try { kit = JSON.parse(text); } catch (e) { throw new Error(`brand.json does not parse: ${e.message}`); }
  // null, false, 0, "" or a list parse, but they are a broken kit, not "no kit"
  if (!kit || typeof kit !== 'object' || Array.isArray(kit)) throw new Error('brand.json must hold an object: { name, colors, fonts, logo, look? }');
  return kit;
}

// A target (--target tiktok) supplies size, fps and the safe area from safezones.json. Values the
// scene sets in CFG win; the target fills in what CFG leaves out.
async function loadTarget(name) {
  if (!name) return null;
  const r = await fetch('./safezones.json');
  if (!r.ok) throw new Error('--target needs safezones.json in the piece folder');
  const zones = await r.json();
  const t = zones.targets && zones.targets[name];
  if (!t) throw new Error(`unknown target "${name}" (safezones.json has: ${Object.keys(zones.targets || {}).join(', ')})`);
  return { name, ...t };
}

async function boot() {
  // The scene is loaded by dynamic import, so `--scene slate.js` never evaluates scene.js at all.
  if (!/^[\w][\w./-]*\.m?js$/.test(SCENE_FILE) || SCENE_FILE.includes('..')) throw new Error(`bad scene file name: ${SCENE_FILE}`);
  scene = await import('./' + SCENE_FILE);
  CFG = scene.CFG;
  // CFG.ENERGY sets the beat grid too (plan 23.9). The scene timed itself from the board (CFG.DUR = boardDur(), its TL
  // from beatWindow) before its CFG existed; when CFG names an energy that re-times the board (lib.js retimeFor), the
  // scene is evaluated again, as a fresh module on the same lib.js, so its length and timeline are the re-timed board's.
  if (CFG && CFG.ENERGY && !params.energy) {
    const lib = await import('./lib.js');
    if (lib.retimeFor(CFG.ENERGY)) { scene = await import('./' + SCENE_FILE + '?energy=' + encodeURIComponent(CFG.ENERGY)); CFG = scene.CFG; }
  }
  if (!CFG) throw new Error(`${SCENE_FILE} does not export CFG`);
  const T = await loadTarget(TARGET);
  if (T) {
    if ((CFG.W && T.w && CFG.W !== T.w) || (CFG.H && T.h && CFG.H !== T.h)) {
      console.warn(`note: ${SCENE_FILE} sets ${CFG.W}x${CFG.H}; target ${T.name} is ${T.w}x${T.h}. CFG wins; the target only supplies what CFG leaves out.`);
    }
    if (CFG.W == null) CFG.W = T.w;
    if (CFG.H == null) CFG.H = T.h;
    if (CFG.FPS == null) CFG.FPS = T.fps;
  }
  if (!CFG.W || !CFG.H) throw new Error(`${SCENE_FILE}: no canvas size. Set CFG.W and CFG.H, or pass --target <name>`);
  FPS = +(q.get('fps') || CFG.FPS || 30);
  RW = Math.round(CFG.W * SCALE); RH = Math.round(CFG.H * SCALE);

  canvas = document.getElementById('c');
  canvas.width = RW; canvas.height = RH;
  c2 = document.createElement('canvas'); c2.width = RW; c2.height = RH;    // main 2D layer
  hud = document.createElement('canvas'); hud.width = RW; hud.height = RH; // difference-blended HUD
  c2ctx = c2.getContext('2d'); hudctx = hud.getContext('2d');

  // The style: the look and the kit, resolved with --param (looks.js). Their font files are registered here, before
  // init, and their families join CFG.FONTS, so the check below fails on a missing one like any other.
  BRAND = await loadBrand();
  STYLE = LK.resolveStyle({ look: params.look || CFG.LOOK || (BRAND && BRAND.look) || null, brand: BRAND, params });
  const failed = new Set();
  for (const f of LK.styleFaces(STYLE)) {
    let problem = null;
    try {
      const ff = new FontFace(f.family, `url("${encodeURI(f.url)}")`);
      document.fonts.add(await ff.load());
    } catch (e) {
      problem = `font missing: ${f.family} (${f.from === 'brand' ? 'brand.json' : `look ${STYLE.look}`}, ${f.roles.join(' and ')}) did not load from ${f.url}` +
        (f.from === 'brand' ? ': copy the kit\'s file into the piece' : ': copy it from the skill\'s looks/fonts/ into the piece\'s fonts/');
    }
    FACES.push({ family: f.family, url: f.url, from: f.from, roles: f.roles, ok: !problem, problem });
    if (problem) {
      if (!CHECK) throw new Error(problem);   // a render stops here; check reports it under fonts and runs the rest
      FONT_PROBLEMS.push(problem); failed.add(f.family);
    }
  }
  const fams = LK.styleFamilies(STYLE);
  if (fams.length) { CFG.FONTS = CFG.FONTS || []; for (const f of fams) if (!CFG.FONTS.includes(f)) CFG.FONTS.push(f); }
  // Fail loudly on missing fonts: Canvas2D silently falls back to Times otherwise. load() resolves
  // to the faces it found, so an undeclared family (an empty list) fails too. Under render.mjs check the
  // problem is collected instead, so the check reports it (fonts) and still runs the others.
  for (const f of CFG.FONTS || []) {
    if (failed.has(f)) continue;
    let faces = [], problem = null;
    try { faces = await document.fonts.load(`64px "${f}"`); } catch (e) { problem = `font failed to load: ${f} (${e.message})`; }
    if (!problem && (!faces.length || !document.fonts.check(`64px "${f}"`))) problem = `font missing: ${f} (declare it in index.html @font-face, file in fonts/)`;
    if (problem && !CHECK) throw new Error(problem);
    if (problem) FONT_PROBLEMS.push(problem);
  }
  // the energy: the board comes from lib.js (the scene has imported it, or it loads here), CFG.ENERGY from the scene
  const lib = await import('./lib.js');
  ENERGY = resolveEnergy({ params, CFG, BOARD: lib.BOARD });
  if (scene.init) await recordingAsync(() => scene.init({ ctx: prep(c2ctx), hud: prep(hudctx), scale: SCALE, params, alpha: ALPHA, target: T, style: STYLE, energy: ENERGY }));
  pipe = createPipeline(canvas, RW, RH, { alpha: ALPHA });
  // DUR is read after init, so a scene may set CFG.DUR there (from a param or a board).
  window.INFO = { RW, RH, W: CFG.W, H: CFG.H, FPS, DUR: CFG.DUR, ALPHA, SCALE, SUB, SCENE: SCENE_FILE,
    TARGET, SILENT: !!scene.silent, FONTS: CFG.FONTS || [], FONT_PROBLEMS, FACES,
    STYLE: { look: STYLE.look, lookFrom: params.look ? '--param look' : CFG.LOOK ? 'CFG.LOOK' : BRAND && BRAND.look ? 'brand.json' : null, brand: STYLE.brand, tokens: STYLE.tokens, bg: STYLE.bg, sources: STYLE.sources,
      fonts: Object.fromEntries(LK.ROLES.map((r) => [r, { family: STYLE.fonts[r].family, file: STYLE.fonts[r].file || null, from: STYLE.fonts[r].from }])) },
    HOLDS: scene.HOLDS === undefined ? null : JSON.parse(JSON.stringify(scene.HOLDS)), BOXES: typeof scene.boxes === 'function',
    ENERGY: { name: ENERGY.name, from: ENERGY.from, bpm: ENERGY.bpm }, CUTS: typeof scene.cuts === 'function' };
  return true;
}

// Each call gets a cleared canvas whose transform maps design pixels (CFG.W x CFG.H) to the
// render size, so scenes draw at design size regardless of --scale.
function prep(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none'; ctx.clearRect(0, 0, RW, RH);
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  return ctx;
}
// The subframe times of frame t: n = round(SUB x subBoost(t)) samples across a 180-degree shutter, each
// with its Halton jitter. renderAt draws them; render.mjs check samples boxes(t) at the same times.
const subCount = (t, sub = SUB) => Math.max(1, Math.round(sub * (scene.subBoost ? scene.subBoost(t) : 1)));
const subTime = (t, s, n) => t + ((s + 0.5) / n) * (0.5 / FPS);
const subJit = (s) => [halton(s + 1, 2) - 0.5, halton(s + 1, 3) - 0.5];
// opts.n fixes the subframe count (renderProbe uses 1); opts.post overrides fields of post(t) (grain: 0).
function renderAt(t, opts = {}) {
  pipe.beginFrame();
  const n = opts.n || subCount(t);
  for (let s = 0; s < n; s++) {
    prep(c2ctx);
    pipe.subframe(recording(() => scene.frame(subTime(t, s, n), subJit(s))), c2, 1 / n);
  }
  prep(hudctx);
  if (scene.drawHud) recording(() => scene.drawHud(t, FPS));
  pipe.endFrame(opts.post ? { ...scene.post(t), ...opts.post } : scene.post(t), hud);
}
function readFrame() {
  const gl = pipe.gl, px = new Uint8Array(RW * RH * 4);
  gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

window.ready = boot();
// A still as a PNG data URL; opts.safe ({ name, safe, estimate }) shades what is outside the safe area.
window.renderStill = async (t, opts = {}) => {
  renderAt(t);
  if (!opts.safe) return canvas.toDataURL('image/png');
  const o = document.createElement('canvas'); o.width = RW; o.height = RH;
  const oc = o.getContext('2d');
  oc.drawImage(canvas, 0, 0);
  await drawSafe(oc, 0, 0, RW, RH, opts.safe);
  return o.toDataURL('image/png');
};
// The safe area of a target (safezones.json), for the --safe overlays. Throws when the target has none, or
// is a different size from the piece (its rectangle would not fit the frame).
window.safeZone = async (name) => {
  const T = await loadTarget(name);
  if (!T.safe) throw new Error(`--safe: target ${name} has no safe area`);
  if ((T.w && T.w !== CFG.W) || (T.h && T.h !== CFG.H)) throw new Error(`--safe: target ${name} is ${T.w}x${T.h}, but the piece is ${CFG.W}x${CFG.H}`);
  return { name, safe: T.safe, exclude: T.exclude || [], estimate: !!T.estimate };
};
// Shades a panel at (x, y, pw x ph) outside the zone and over its exclude rectangles (areas the platform
// covers inside it), outlines the zone, and labels it, with "(estimate)" while the target's numbers are not
// measured. Used by contact --safe and board --safe.
async function drawSafe(sc, x, y, pw, ph, zone) {
  const k = pw / CFG.W, s = zone.safe, zx = x + s.x * k, zy = y + s.y * k, zw = s.w * k, zh = s.h * k;
  sc.save();
  sc.fillStyle = 'rgba(0,0,0,0.45)';
  sc.fillRect(x, y, pw, zy - y); sc.fillRect(x, zy + zh, pw, y + ph - zy - zh);
  sc.fillRect(x, zy, zx - x, zh); sc.fillRect(zx + zw, zy, x + pw - zx - zw, zh);
  for (const e of zone.exclude || []) sc.fillRect(x + e.x * k, y + e.y * k, e.w * k, e.h * k);
  sc.strokeStyle = 'rgba(255,214,0,0.8)'; sc.lineWidth = Math.max(1, pw / 360); sc.strokeRect(zx, zy, zw, zh);
  for (const e of zone.exclude || []) sc.strokeRect(x + e.x * k, y + e.y * k, e.w * k, e.h * k);
  const size = Math.max(8, Math.round(pw / 30));
  const faces = await document.fonts.load(`${size}px MONO`);
  sc.font = faces.length ? `${size}px MONO` : `${size}px monospace`;
  sc.fillStyle = 'rgba(255,214,0,0.95)'; sc.textAlign = 'left'; sc.textBaseline = 'alphabetic';
  const label = `${zone.name} safe area${zone.estimate ? ' (estimate)' : ''}`;
  const top = zy - y >= size * 1.6;
  sc.fillText(label, zx + size * 0.3, top ? zy - size * 0.45 : Math.min(y + ph - size * 0.4, zy + zh + size * 1.2));
  sc.restore();
}
window.renderRange = async (from, to) => {
  const n0 = Math.round(from * FPS), n1 = Math.round(to * FPS);
  const t0 = performance.now();
  for (let f = n0; f < n1; f++) {
    renderAt(f / FPS);
    const r = await fetch('/frame', { method: 'POST', body: readFrame() });
    if (!r.ok) throw new Error('frame post failed');
    if (f % FPS === 0) console.log(`frame ${f}/${n1}  ${((performance.now() - t0) / (f - n0 + 1)).toFixed(0)} ms/frame`);
  }
  return true;
};
// renderProbe (plan 5): one frame, rendered with opts.sub subframes (default 1) and post(t) overridden by
// opts.post (default { grain: 0 }), returned as luma bytes (Rec. 709, 0-255, over black in alpha mode), top
// row first: { w, h, luma }. opts.rgb adds the colour of the same pixels (plan 23.2: the colour probe), r, g, b
// bytes per pixel, over black in alpha mode: { w, h, luma, rgb }. opts.scale may ask for a smaller probe than the
// page's own scale, by a whole factor (each probe pixel is the mean of a k x k block). With grain off and one
// subframe, a frame that does not change repeats exactly, so render.mjs check can count changed pixels between frames.
window.renderProbe = (t, opts = {}) => {
  // noText: fillText and strokeText draw nothing (energy_match's text-off render)
  if (opts.noText) NOTEXT++;
  try { renderAt(t, { n: Math.max(1, Math.round(opts.sub || 1)), post: opts.post || { grain: 0 } }); } finally { if (opts.noText) NOTEXT--; }
  const px = readFrame(), luma = new Uint8Array(RW * RH), rgb = opts.rgb ? new Uint8Array(RW * RH * 3) : null;
  for (let y = 0; y < RH; y++) {
    const src = (RH - 1 - y) * RW * 4, dst = y * RW;      // readPixels starts at the bottom row
    for (let x = 0; x < RW; x++) {
      const i = src + x * 4, a = ALPHA ? px[i + 3] / 255 : 1;
      luma[dst + x] = Math.round((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * a);
      if (rgb) { const o = (dst + x) * 3; rgb[o] = Math.round(px[i] * a); rgb[o + 1] = Math.round(px[i + 1] * a); rgb[o + 2] = Math.round(px[i + 2] * a); }
    }
  }
  const k = opts.scale ? SCALE / opts.scale : 1;
  if (Math.abs(k - Math.round(k)) > 1e-6 || k < 1) throw new Error(`renderProbe: scale ${opts.scale} is not the page's scale ${SCALE} divided by a whole number`);
  if (Math.round(k) === 1) return rgb ? { w: RW, h: RH, luma, rgb } : { w: RW, h: RH, luma };
  const K = Math.round(k), w = Math.floor(RW / K), h = Math.floor(RH / K), out = new Uint8Array(w * h), orgb = rgb ? new Uint8Array(w * h * 3) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) sum += luma[(y * K + j) * RW + x * K + i];
    out[y * w + x] = Math.round(sum / (K * K));
    if (orgb) for (let c = 0; c < 3; c++) {
      let s3 = 0;
      for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) s3 += rgb[((y * K + j) * RW + x * K + i) * 3 + c];
      orgb[(y * w + x) * 3 + c] = Math.round(s3 / (K * K));
    }
  }
  return orgb ? { w, h, luma: out, rgb: orgb } : { w, h, luma: out };
};
// The colour probe (render.mjs palette, plan 23.2): renderProbe of every frame with its colour, every pixel counted
// by its exact colour across the whole piece: { frames, w, h, total, colors: [0xRRGGBB], counts }. Render.mjs opens
// the page at check's probe scale (1/2), so these are check's probe frames, grain off, one subframe.
window.colorScan = async () => {
  const N = Math.round(CFG.DUR * FPS), hist = new Uint32Array(1 << 24);
  let total = 0, w = RW, h = RH;
  for (let f = 0; f < N; f++) {
    const p = window.renderProbe(f / FPS, { rgb: true });
    w = p.w; h = p.h;
    const c = p.rgb;
    for (let i = 0; i < c.length; i += 3) hist[(c[i] << 16) | (c[i + 1] << 8) | c[i + 2]]++;
    total += p.w * p.h;
  }
  const colors = [], counts = [];
  for (let i = 0; i < hist.length; i++) if (hist[i]) { colors.push(i); counts.push(hist[i]); }
  return { frames: N, w, h, total, colors, counts };
};
// The font families the scene has drawn text with so far (fillText and strokeText), for the render record.
window.fontsUsed = () => [...FONTS_USED];
// What render.mjs check measures in the page (plan 11.1), for every frame of the piece:
//   probe:   renderProbe(t) of each frame; the histogram of luma differences between consecutive frames
//            ({ delta: count } for delta >= 1) and the first frame's luma mean and standard deviation
//   samples: at every subframe time the render uses (n = round(sub x subBoost(t))), the scene's boxes(t)
//            and the camera that frame(t) returns for that sample, so text can be tested where it lands
// Each box is checked here: it needs a string id, text, and finite x, y, w, h (design pixels).
window.checkScan = async ({ probe = true, samples = true, firstOnly = false } = {}) => {
  const N = Math.round(CFG.DUR * FPS), out = { frames: N, pairs: probe && !firstOnly ? [] : null, first: null, samples: samples ? [] : null };
  let prev = null;
  for (let f = 0; f < N; f++) {
    const t = f / FPS;
    if (samples) {
      const n = subCount(t);
      for (let s = 0; s < n; s++) {
        const ts = subTime(t, s, n);
        prep(c2ctx);
        const cfg = scene.frame(ts, subJit(s)) || {};
        const raw = scene.boxes ? scene.boxes(ts) : [];
        if (!Array.isArray(raw)) throw new Error(`boxes(${ts.toFixed(4)}) did not return a list`);
        const boxes = raw.map((b, i) => {
          const ok = b && (typeof b.id === 'string' || typeof b.id === 'number') && String(b.id) && b.text != null &&
            ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(b[k])) && b.w >= 0 && b.h >= 0;
          if (!ok) throw new Error(`boxes(${ts.toFixed(4)}) item ${i} ${JSON.stringify(b)}: each box needs an id, text, and finite x, y, w, h (w and h 0 or more)`);
          const o = { id: String(b.id), text: String(b.text), x: b.x, y: b.y, w: b.w, h: b.h };
          if (b.group != null) o.group = String(b.group);
          if (b.deco) o.deco = true;
          return o;
        });
        const cam = Array.isArray(cfg.cam) ? cfg.cam.map(Number) : [1, 0, 0, 0];
        out.samples.push({ t: ts, f, n, cam, boxes });
      }
    }
    if (probe && (!firstOnly || f === 0)) {
      const p = window.renderProbe(t);
      if (f === 0) {
        let sum = 0, sq = 0;
        for (const v of p.luma) { sum += v; sq += v * v; }
        const mean = sum / p.luma.length;
        out.first = { mean, std: Math.sqrt(Math.max(0, sq / p.luma.length - mean * mean)), w: p.w, h: p.h };
      }
      if (prev) {
        const hist = {};
        for (let i = 0; i < p.luma.length; i++) { const d = Math.abs(p.luma[i] - prev[i]); if (d) hist[d] = (hist[d] || 0) + 1; }
        out.pairs.push(hist);
      }
      prev = firstOnly ? null : p.luma;
    }
  }
  return out;
};
// SHA-256 of one rendered frame's raw RGBA pixels (render.mjs hash, doctor's probe).
window.frameHash = async (t) => {
  renderAt(t);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', readFrame()));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
};
// The scene's declared visual cuts and transitions (plan 23.9): scene.cuts() as [{ t, d }] in picture time, each with a
// finite t inside the piece and d from 0 to 0.3 s, sorted; null when the scene exports no cuts(). Throws on a bad entry.
window.sceneCuts = () => {
  if (typeof scene.cuts !== 'function') return null;
  const list = scene.cuts();
  if (!Array.isArray(list)) throw new Error(`${SCENE_FILE}: cuts() did not return a list`);
  return list.map((c, i) => {
    const ok = c && Number.isFinite(c.t) && Number.isFinite(c.d ?? 0) && (c.d ?? 0) >= 0 && (c.d ?? 0) <= 0.3 + 1e-9 && c.t >= 0 && c.t <= CFG.DUR;
    if (!ok) throw new Error(`${SCENE_FILE}: cuts() item ${i} ${JSON.stringify(c)}: each cut needs t inside the piece and d from 0 to 0.3 s`);
    return { t: c.t, d: c.d ?? 0 };
  }).sort((a, b) => a.t - b.t);
};
// The soundtrack. audio.js gets the SELECTED scene's TL and CFG, after that scene's init, and is
// imported only when needed: a scene that exports `silent = true` renders silence and never loads it.
window.renderSound = async () => {
  const sr = 48000, dur = CFG.DUR;
  let buf;
  if (scene.silent) {
    buf = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(sr * dur), sampleRate: sr });
  } else {
    const { renderAudio } = await import('./audio.js');
    buf = await renderAudio({ TL: scene.TL || {}, CFG, params, dur, sr, style: STYLE, energy: ENERGY });
  }
  const wav = encodeWav(buf);
  await fetch('/audio', { method: 'POST', body: wav });
  return wav.length;
};
// The bed stem (plan 23.9): audio.js's renderBed, the preset's beat pattern on its grid over the picture's full length,
// posted to /bed. Returns { bytes, silent } (silent: the board asked for no bed at subtle), or null when the scene is
// silent or its audio.js has no renderBed (a piece from before the presets: it has no bed stem).
window.renderBedSound = async () => {
  if (scene.silent) return null;
  const A = await import('./audio.js');
  if (typeof A.renderBed !== 'function') return null;
  const sr = 48000, dur = CFG.DUR;
  const buf = await A.renderBed({ TL: scene.TL || {}, CFG, params, dur, sr, style: STYLE, energy: ENERGY });
  const wav = encodeWav(buf);
  await fetch('/bed', { method: 'POST', body: wav });
  return { bytes: wav.length, silent: !!ENERGY.silentBed };
};

// The board sheet (render.mjs board, plan 6.2): one panel per board beat, the frame at the beat's key time
// (beat.key seconds in, default 60% of the way through), composed here on the page's own canvas with the
// piece's fonts, with the beat's id, window, voice line, on-screen copy, visual note and sound note under
// each panel. Returns the PNG and what render.mjs needs for board.md.
window.renderBoard = async ({ cols, safe }) => {
  const lib = await import('./lib.js');
  const info = lib.boardInfo(), B = lib.BOARD;
  for (const f of ['DISPLAY', 'BODY', 'MONO']) {
    const faces = await document.fonts.load(`32px "${f}"`);
    if (!faces.length || !document.fonts.check(`32px "${f}"`)) throw new Error(`board sheet: font missing: ${f} (declare it in index.html @font-face)`);
  }
  let zone = null;
  if (safe) {
    const zoneName = TARGET || B.target || null;
    if (!zoneName) throw new Error('--safe needs a target: pass --target <name> or set BOARD.target');
    zone = await window.safeZone(zoneName);
  }
  const pw = RW, ph = RH, u = pw / 360, gap = Math.round(18 * u), pad = Math.round(6 * u);
  const C = { bg: '#18181C', ink: '#ECEAE4', muted: '#9C9AA6', tag: '#E0A458', id: '#FF6A3D' };
  const F = { title: `${Math.round(30 * u)}px DISPLAY`, meta: `${Math.round(14 * u)}px BODY`, id: `${Math.round(20 * u)}px DISPLAY`,
    mono: `${Math.round(13 * u)}px MONO`, body: `${Math.round(14 * u)}px BODY` };
  const LH = { id: 26 * u, mono: 17 * u, body: 19 * u };
  const sheet = document.createElement('canvas'), sc = sheet.getContext('2d');
  // Wrap a list of { text, color } tokens to maxW at a font; returns lines of { text, color, x }.
  const wrapTokens = (tokens, font, maxW) => {
    sc.font = font;
    const sp = sc.measureText(' ').width, lines = [];
    let line = [], x = 0;
    for (const tk of tokens) {
      const w = sc.measureText(tk.text).width;
      if (line.length && x + sp + w > maxW) { lines.push(line); line = []; x = 0; }
      if (line.length) x += sp;
      line.push({ ...tk, x }); x += w;
    }
    if (line.length) lines.push(line);
    return lines;
  };
  const words = (text, color) => String(text).split(/\s+/).filter(Boolean).map((t) => ({ text: t, color }));
  const capW = pw - 2 * pad;
  const caption = (w) => {
    const b = w.beat, blocks = [];
    const flags = [b.hook ? 'hook' : '', b.hold ? 'hold' : '', b.vo == null ? 'silent' : ''].filter(Boolean).join(', ');
    blocks.push({ font: F.id, lh: LH.id, lines: wrapTokens([{ text: `${w.index + 1}. ${w.id}`, color: C.id }], F.id, capW) });
    blocks.push({ font: F.mono, lh: LH.mono, lines: wrapTokens(words(`${w.start.toFixed(2)}-${w.end.toFixed(2)} s${flags ? '  ' + flags : ''}`, C.muted), F.mono, capW) });
    if (b.vo != null) {
      const toks = [{ text: 'VO', color: C.muted }, ...lib.voTokens(b.vo).flatMap((t) => (t.kind === 'tag' ? words(t.text, C.tag) : [{ text: t.text, color: C.ink }]))];
      blocks.push({ font: F.body, lh: LH.body, lines: wrapTokens(toks, F.body, capW) });
    }
    const on = (b.on || []).map(String).filter(Boolean);
    blocks.push({ font: F.body, lh: LH.body, lines: wrapTokens([{ text: 'ON', color: C.muted }, ...(on.length ? words(on.join(' / '), C.ink) : [{ text: '-', color: C.muted }])], F.body, capW) });
    if (b.look) blocks.push({ font: F.body, lh: LH.body, lines: wrapTokens([{ text: 'LOOK', color: C.muted }, ...words(b.look, C.muted)], F.body, capW) });
    const sfx = b.sfx === null ? 'silence (on purpose)' : b.sfx ? `${b.sfx}${b.sfxHit ? ' (hit)' : ''}` : '-';
    blocks.push({ font: F.mono, lh: LH.mono, lines: wrapTokens([{ text: 'SFX', color: C.muted }, ...words(sfx, C.muted)], F.mono, capW) });
    return { blocks, h: blocks.reduce((s, bl) => s + bl.lines.length * bl.lh, 0) + 3 * pad };
  };
  const caps = info.windows.map(caption);
  const n = info.windows.length, rows = Math.ceil(n / cols);
  const rowCap = Array.from({ length: rows }, (_, r) => Math.max(...caps.slice(r * cols, r * cols + cols).map((c) => c.h)));
  const metaBits = [info.estimated ? 'estimated timing (no cues.js yet)'
    : lib.CUES ? `timing from cues.js: VO_OFFSET ${info.voOffset.toFixed(2)} s, take ${lib.CUES.TAKE.duration.toFixed(2)} s`
    : info.snapped ? `silent board: the beats on ${ENERGY.name}'s beat grid, ${info.bpm} BPM` : 'silent board: the beats\' own durations',
    `scene ${SCENE_FILE}`, `${n} beats, ${info.dur.toFixed(2)} s`, zone ? `safe zones: ${zone.name}${zone.estimate ? ' (estimate)' : ''}` : ''].filter(Boolean);
  const metaLines = wrapTokens(words(metaBits.join('  |  '), C.muted), F.meta, cols * pw + (cols - 1) * gap);
  const headH = gap + 34 * u + metaLines.length * LH.body + gap * 0.5;
  sheet.width = Math.round(cols * pw + (cols + 1) * gap);
  sheet.height = Math.round(headH + rowCap.reduce((s, h) => s + ph + h + gap, 0) + gap * 0.5);
  sc.fillStyle = C.bg; sc.fillRect(0, 0, sheet.width, sheet.height);
  sc.textBaseline = 'alphabetic'; sc.textAlign = 'left';
  sc.font = F.title; sc.fillStyle = C.ink;
  sc.fillText(B.title || 'Board', gap, gap + 28 * u);
  metaLines.forEach((l, i) => { sc.font = F.meta; for (const tk of l) { sc.fillStyle = tk.color; sc.fillText(tk.text, gap + tk.x, gap + 34 * u + (i + 0.8) * LH.body); } });
  const rowsOut = [];
  let y = headH;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= n) break;
      const w = info.windows[i], x = gap + c * (pw + gap);
      const key = Math.min(w.end - 1e-4, Math.max(w.start, w.start + (w.beat.key != null ? w.beat.key : 0.6 * (w.end - w.start))));
      renderAt(key);
      sc.drawImage(canvas, x, y, pw, ph);   // the WebGL canvas keeps its buffer (preserveDrawingBuffer)
      if (zone) await drawSafe(sc, x, y, pw, ph, zone);
      let cy = y + ph + pad;
      for (const bl of caps[i].blocks) {
        sc.font = bl.font;
        for (const l of bl.lines) { cy += bl.lh; for (const tk of l) { sc.fillStyle = tk.color; sc.fillText(tk.text, x + pad + tk.x, cy - bl.lh * 0.25); } }
        cy += pad * 0.5;
      }
      const b = w.beat;
      rowsOut.push({ id: w.id, start: w.start, end: w.end, key, vo: b.vo != null ? String(b.vo) : null, dur: b.dur != null ? b.dur : null,
        on: (b.on || []).map(String), look: b.look || '', sfx: b.sfx === undefined ? undefined : b.sfx, sfxHit: !!b.sfxHit, hook: !!b.hook, hold: !!b.hold });
    }
    y += ph + rowCap[r] + gap;
  }
  return { png: sheet.toDataURL('image/png'), width: sheet.width, height: sheet.height, rows: rowsOut, title: B.title || null,
    estimated: info.estimated, voOffset: info.voOffset, dur: info.dur, take: lib.CUES ? lib.CUES.TAKE : null, grid: info.snapped ? { bpm: info.bpm, energy: ENERGY.name } : null,
    cfgDur: CFG.DUR, order: lib.boardOrder(info, CFG.DUR, FPS), scene: SCENE_FILE, safe: zone ? { target: zone.name, estimate: zone.estimate } : null };
};

// The brand sheet (render.mjs brand, plan 23.2): the colour tokens as swatches, a type specimen in each font role,
// and the kit's logo on a dark and on a light ground, to approve before anything is animated. Without brand.json
// it shows the style in effect (the look's, or the template's own). Drawn with the piece's own fonts; returns the
// PNG and where each swatch and ground sits, so a test can read the colours back.
window.renderBrandSheet = async () => {
  const S = STYLE, B = BRAND, W = 1600, pad = 56;
  const sheet = document.createElement('canvas'), sc = sheet.getContext('2d');
  const label = (await document.fonts.load('24px MONO')).length ? 'MONO' : 'monospace';
  for (const r of LK.ROLES) {
    const fam = S.fonts[r].family, faces = await document.fonts.load(`48px "${fam}"`);
    if (!faces.length || !document.fonts.check(`48px "${fam}"`)) throw new Error(`brand sheet: font missing: ${fam} (${r}); run node render.mjs doctor`);
  }
  const lum = (h) => { const [r, g, b] = LK.hexRgb01(h).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const onColor = (h) => (lum(h) > 0.4 ? '#111111' : '#F5F5F5');
  const grounds = ['bgA', 'bgB', 'ink'].map((k) => S.tokens[k]).sort((a, b) => lum(a) - lum(b));
  const dark = grounds[0], light = grounds[grounds.length - 1];
  const logos = {};
  for (const k of ['onDark', 'onLight']) {
    const f = B && B.logo && B.logo[k];
    if (!f) continue;
    const img = new Image();
    img.src = f;
    try { await img.decode(); } catch { throw new Error(`brand sheet: logo.${k} (${f}) did not load`); }
    logos[k] = img;
  }
  const sw = (W - 2 * pad - 5 * 24) / 6, swH = 200, logoH = 380, specs = [
    { role: 'display', px: 110, text: B ? B.name : (S.look ? LK.LOOKS[S.look].label : 'Make it move') },
    { role: 'body', px: 52, text: 'The quick brown fox jumps over the lazy dog. 0123456789' },
    { role: 'mono', px: 40, text: 'const t = 0.25; // 0O 1lI {}[]' },
  ];
  const H = pad + 90 + 50 + swH + 110 + specs.reduce((s, x) => s + x.px * 1.25 + 56, 0) + 40 + logoH + pad;
  sheet.width = W; sheet.height = Math.round(H);
  const bgSheet = '#ECEAE4', inkSheet = '#18181C', mutedSheet = '#6A6872';
  sc.fillStyle = bgSheet; sc.fillRect(0, 0, W, sheet.height);
  sc.textBaseline = 'alphabetic'; sc.textAlign = 'left';
  let y = pad + 64;
  sc.fillStyle = inkSheet; sc.font = `64px "${S.fonts.display.family}"`;
  sc.fillText(B ? B.name : S.look ? `Look: ${LK.LOOKS[S.look].label}` : 'The template\'s style', pad, y);
  y += 44;
  sc.font = `22px ${label}`; sc.fillStyle = mutedSheet;
  sc.fillText(`${B ? 'brand.json' : 'no brand.json'}${S.look ? `, look ${S.look}` : ', no look'}, background shader ${S.bg}`, pad, y);
  y += 46;
  const swatches = [];
  LK.TOKENS.forEach((k, i) => {
    const x = pad + i * (sw + 24), hex = S.tokens[k];
    sc.fillStyle = hex; sc.fillRect(x, y, sw, swH);
    sc.strokeStyle = 'rgba(0,0,0,0.25)'; sc.lineWidth = 2; sc.strokeRect(x + 1, y + 1, sw - 2, swH - 2);
    sc.fillStyle = onColor(hex); sc.font = `26px ${label}`; sc.fillText(k, x + 16, y + swH - 20);
    sc.fillStyle = inkSheet; sc.font = `22px ${label}`; sc.fillText(hex, x, y + swH + 34);
    sc.fillStyle = mutedSheet; sc.fillText(S.sources[k], x, y + swH + 62);
    swatches.push({ name: k, hex, x, y, w: sw, h: swH });
  });
  y += swH + 110;
  for (const sp of specs) {
    const f = S.fonts[sp.role];
    sc.fillStyle = mutedSheet; sc.font = `22px ${label}`;
    sc.fillText(`${sp.role}: ${f.family}${f.file ? ` (${f.file})` : ''}, from ${f.from}`, pad, y);
    let px = sp.px;
    sc.font = `${px}px "${f.family}"`;
    while (px > 16 && sc.measureText(sp.text).width > W - 2 * pad) { px -= 2; sc.font = `${px}px "${f.family}"`; }
    y += px * 1.05 + 14;
    sc.fillStyle = inkSheet; sc.fillText(sp.text, pad, y);
    y += px * 0.2 + 42;
  }
  y += 10;
  const gw = (W - 2 * pad - 24) / 2, out = [];
  [['onDark', dark], ['onLight', light]].forEach(([k, g], i) => {
    const x = pad + i * (gw + 24);
    sc.fillStyle = g; sc.fillRect(x, y, gw, logoH);
    out.push({ logo: k, hex: g, x, y, w: gw, h: logoH });
    const img = logos[k];
    if (img) {
      const s = Math.min((gw * 0.7) / img.naturalWidth, (logoH * 0.7) / img.naturalHeight);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      sc.drawImage(img, x + (gw - iw) / 2, y + (logoH - ih) / 2 - 12, iw, ih);
    }
    sc.fillStyle = onColor(g); sc.font = `20px ${label}`;
    sc.fillText(img ? `logo.${k} (${B.logo[k]}) on ${g}` : `no logo.${k} in ${B ? 'brand.json' : 'a piece without brand.json'}`, x + 16, y + logoH - 18);
  });
  return { png: sheet.toDataURL('image/png'), width: sheet.width, height: sheet.height, swatches, grounds: out,
    brand: B ? B.name : null, look: S.look, logos: Object.keys(logos) };
};

// ---------------------------------------------------------------- energy_match (plan 23.9, P11b-2)
// What render.mjs check measures for energy_match (check.mjs has the rule). The probe is check's: renderProbe(t) of
// every frame at the page's scale (1/2), one subframe, grain off, sampled at t + 0.25 / FPS.
// energyInfo: whether the scene exports cuts(), its list, and CFG.ENERGY after init.
window.energyInfo = () => {
  const has = typeof scene.cuts === 'function';
  return { has, cuts: has ? JSON.parse(JSON.stringify(scene.cuts() ?? null)) : null, energy: CFG.ENERGY ?? null };
};
// energyBoxes: for every probe frame, the scene's boxes at the probe's sample time and the camera frame() returns
// there: [{ f, cam, boxes: [{ id, text, x, y, w, h, deco? }] }], frames with no box left out.
window.energyBoxes = () => {
  const N = Math.round(CFG.DUR * FPS), out = [];
  for (let f = 0; f < N; f++) {
    const ts = subTime(f / FPS, 0, 1);
    prep(c2ctx);
    const cfg = scene.frame(ts, subJit(0)) || {};
    const raw = scene.boxes(ts);
    if (!Array.isArray(raw)) throw new Error(`boxes(${ts.toFixed(4)}) did not return a list`);
    const boxes = raw.filter((b) => b && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(b[k])))
      .map((b) => ({ id: String(b.id), text: String(b.text), x: b.x, y: b.y, w: b.w, h: b.h, ...(b.deco ? { deco: true } : {}) }));
    if (boxes.length) out.push({ f, cam: Array.isArray(cfg.cam) ? cfg.cam.map(Number) : [1, 0, 0, 0], boxes });
  }
  return out;
};
// energyScan: the probe frames in two passes, so the render with text and the one without are never interleaved.
//   pass 1, text on, every frame in order, as a render runs them:
//     motion  per consecutive pair, the histogram of luma differences (256 counts)
//     pairs   per [a, b] asked for, the histogram of the largest difference of R, G and B between frames a and b
//     and the pixels of each rectangle in rects ({ f: [[x0, y0, x1, y1]] }, probe pixels), kept
//   pass 2, text off (fillText and strokeText draw nothing), the frames in rects, in order:
//     ink     for each rectangle, per row, the pixels where the two renders differ (the largest difference of R, G
//             and B) by inkDelta or more, and by inkRel of the largest difference in the rectangle or more
// Rendering each frame without its text right after rendering it with its text, frame after frame, lost the ink of
// the extreme card's largest slam on Chrome on SwiftShader (Linux CI, P11b): deep into such a run, the two renders of
// a frame came out the same inside its box, while a render or a short run drew it. interleave: true keeps that old
// order, for the test that documents it; debug: true adds lumaMax, per frame and rectangle, the brightest luma of each
// render ([on, off]).
// Memory: the pixels kept for pass 2 are held in runs of at most `budget` bytes (default 256 MB; RGB, since ink is the
// largest difference of R, G and B). A piece of a few seconds is one run; a long one (three minutes with text over a
// quarter of a 540x960 probe would hold about 2 GB) is several, each still every text-on render first, then that run's
// text-off ones. out.retained is the most held at once.
const maxDiff = (a, b, x) => Math.max(Math.abs(a[x] - b[x]), Math.abs(a[x + 1] - b[x + 1]), Math.abs(a[x + 2] - b[x + 2]));
window.energyScan = async ({ pairs = [], rects = {}, inkDelta, inkRel, interleave = false, debug = false, budget = 256 * 1024 * 1024 }) => {
  const N = Math.round(CFG.DUR * FPS), out = { frames: N, w: RW, h: RH, motion: [], pairs: pairs.map(() => null), ink: {}, retained: 0, ...(debug ? { lumaMax: {} } : {}) };
  const last = new Map(), ends = new Map(), kept = new Map();   // a -> its last partner; b -> pair indices; a -> its rgb
  pairs.forEach(([a, b], i) => { last.set(a, Math.max(last.get(a) ?? -1, b)); if (!ends.has(b)) ends.set(b, []); ends.get(b).push(i); });
  // a rectangle's pixels (RGB), row by row
  const crop = (rgb, [x0, y0, x1, y1]) => {
    const w = (x1 - x0) * 3, c = new Uint8Array(w * (y1 - y0));
    for (let y = y0, o = 0; y < y1; y++, o += w) c.set(rgb.subarray((y * RW + x0) * 3, (y * RW + x1) * 3), o);
    return c;
  };
  const lumaMax = (c) => { let m = 0; for (let i = 0; i < c.length; i += 3) m = Math.max(m, 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2]); return Math.round(m); };
  // per rectangle of frame f, the rows of ink between its pixels with text (on) and without (off)
  const inkOf = (f, on, off) => {
    if (debug) out.lumaMax[f] = on.map((c, k) => [lumaMax(c), lumaMax(off[k])]);
    out.ink[f] = rects[f].map(([x0, y0, x1, y1], k) => {
      const a = on[k], b = off[k], w = x1 - x0, d = new Uint8Array(w * (y1 - y0));
      let top = 0;
      for (let i = 0; i < d.length; i++) { d[i] = maxDiff(a, b, i * 3); if (d[i] > top) top = d[i]; }
      const cut = Math.max(inkDelta, inkRel * top), rows = [];
      for (let y = 0, i = 0; y < y1 - y0; y++) {
        let c = 0;
        for (let x = 0; x < w; x++, i++) if (d[i] >= cut) c++;
        rows.push(c);
      }
      return rows;
    });
  };
  const withText = new Map();   // f -> the pixels of its rectangles, text on (one run)
  let held = 0;                  // bytes in withText
  // the run's frames without their text, in order, then the run is let go
  const flush = () => {
    for (const [f, on] of withText) {
      const q = window.renderProbe(f / FPS, { rgb: true, noText: true });
      inkOf(f, on, rects[f].map((r) => crop(q.rgb, r)));
    }
    withText.clear(); held = 0;
  };
  let prev = null;
  for (let f = 0; f < N; f++) {
    const t = f / FPS, p = window.renderProbe(t, { rgb: true });
    if (prev) {
      const h = new Array(256).fill(0);
      for (let i = 0; i < p.luma.length; i++) h[Math.abs(p.luma[i] - prev[i])]++;
      out.motion.push(h);
    }
    prev = p.luma;
    if (last.has(f)) kept.set(f, p.rgb);
    for (const i of ends.get(f) || []) {
      const a = kept.get(pairs[i][0]) || p.rgb, h = new Array(256).fill(0);
      for (let x = 0; x < a.length; x += 3) h[maxDiff(a, p.rgb, x)]++;
      out.pairs[i] = h;
    }
    for (const [a, b] of last) if (b <= f) { kept.delete(a); last.delete(a); }
    const R = rects[f];
    if (!R || !R.length) continue;
    const on = R.map((r) => crop(p.rgb, r)), bytes = on.reduce((n, c) => n + c.length, 0);
    if (interleave) { inkOf(f, on, R.map((r) => crop(window.renderProbe(t, { rgb: true, noText: true }).rgb, r))); continue; }
    if (held && held + bytes > budget) flush();
    withText.set(f, on); held += bytes;
    out.retained = Math.max(out.retained, held);
  }
  flush();
  return out;
};
