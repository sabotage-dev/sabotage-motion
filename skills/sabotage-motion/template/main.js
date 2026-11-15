// Page harness: owns the canvases, the motion-blur loop and the window API that render.mjs drives.
// You normally don't edit this file; the creative work lives in the scene (scene.js by default) and audio.js.
//
// render.mjs sets the URL query: scene=<file> (default scene.js), target=<name> (an entry in
// safezones.json), scale, fps, sub, alpha=1, check=1 (render.mjs check: a missing font is reported, not
// thrown), and p.<key>=<value> for each --param key=value.
import { createPipeline } from './gl.js';
import { encodeWav } from './wav.js';

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

let scene, CFG, FPS, RW, RH, pipe, canvas, c2, hud, c2ctx, hudctx;
const FONT_PROBLEMS = [];

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

  // Fail loudly on missing fonts: Canvas2D silently falls back to Times otherwise. load() resolves
  // to the faces it found, so an undeclared family (an empty list) fails too. Under render.mjs check the
  // problem is collected instead, so the check reports it (fonts) and still runs the others.
  for (const f of CFG.FONTS || []) {
    let faces = [], problem = null;
    try { faces = await document.fonts.load(`64px "${f}"`); } catch (e) { problem = `font failed to load: ${f} (${e.message})`; }
    if (!problem && (!faces.length || !document.fonts.check(`64px "${f}"`))) problem = `font missing: ${f} (declare it in index.html @font-face, file in fonts/)`;
    if (problem && !CHECK) throw new Error(problem);
    if (problem) FONT_PROBLEMS.push(problem);
  }
  if (scene.init) await scene.init({ ctx: prep(c2ctx), hud: prep(hudctx), scale: SCALE, params, alpha: ALPHA, target: T });
  pipe = createPipeline(canvas, RW, RH, { alpha: ALPHA });
  // DUR is read after init, so a scene may set CFG.DUR there (from a param or a board).
  window.INFO = { RW, RH, W: CFG.W, H: CFG.H, FPS, DUR: CFG.DUR, ALPHA, SCALE, SUB, SCENE: SCENE_FILE,
    TARGET, SILENT: !!scene.silent, FONTS: CFG.FONTS || [], FONT_PROBLEMS,
    HOLDS: scene.HOLDS === undefined ? null : JSON.parse(JSON.stringify(scene.HOLDS)), BOXES: typeof scene.boxes === 'function' };
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
    pipe.subframe(scene.frame(subTime(t, s, n), subJit(s)), c2, 1 / n);
  }
  prep(hudctx);
  if (scene.drawHud) scene.drawHud(t, FPS);
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
// row first: { w, h, luma }. opts.scale may ask for a smaller probe than the page's own scale, by a whole
// factor (each probe pixel is the mean of a k x k block). With grain off and one subframe, a frame that does
// not change repeats exactly, so render.mjs check can count changed pixels between frames.
window.renderProbe = (t, opts = {}) => {
  renderAt(t, { n: Math.max(1, Math.round(opts.sub || 1)), post: opts.post || { grain: 0 } });
  const px = readFrame(), luma = new Uint8Array(RW * RH);
  for (let y = 0; y < RH; y++) {
    const src = (RH - 1 - y) * RW * 4, dst = y * RW;      // readPixels starts at the bottom row
    for (let x = 0; x < RW; x++) {
      const i = src + x * 4, a = ALPHA ? px[i + 3] / 255 : 1;
      luma[dst + x] = Math.round((0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * a);
    }
  }
  const k = opts.scale ? SCALE / opts.scale : 1;
  if (Math.abs(k - Math.round(k)) > 1e-6 || k < 1) throw new Error(`renderProbe: scale ${opts.scale} is not the page's scale ${SCALE} divided by a whole number`);
  if (Math.round(k) === 1) return { w: RW, h: RH, luma };
  const K = Math.round(k), w = Math.floor(RW / K), h = Math.floor(RH / K), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) sum += luma[(y * K + j) * RW + x * K + i];
    out[y * w + x] = Math.round(sum / (K * K));
  }
  return { w, h, luma: out };
};
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
// The soundtrack. audio.js gets the SELECTED scene's TL and CFG, after that scene's init, and is
// imported only when needed: a scene that exports `silent = true` renders silence and never loads it.
window.renderSound = async () => {
  const sr = 48000, dur = CFG.DUR;
  let buf;
  if (scene.silent) {
    buf = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(sr * dur), sampleRate: sr });
  } else {
    const { renderAudio } = await import('./audio.js');
    buf = await renderAudio({ TL: scene.TL || {}, CFG, params, dur, sr });
  }
  const wav = encodeWav(buf);
  await fetch('/audio', { method: 'POST', body: wav });
  return wav.length;
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
    : lib.CUES ? `timing from cues.js: VO_OFFSET ${info.voOffset.toFixed(2)} s, take ${lib.CUES.TAKE.duration.toFixed(2)} s` : 'silent board: the beats\' own durations',
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
    estimated: info.estimated, voOffset: info.voOffset, dur: info.dur, take: lib.CUES ? lib.CUES.TAKE : null,
    cfgDur: CFG.DUR, order: lib.boardOrder(info, CFG.DUR, FPS), scene: SCENE_FILE, safe: zone ? { target: zone.name, estimate: zone.estimate } : null };
};
