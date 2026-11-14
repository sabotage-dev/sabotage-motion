// Page harness: owns the canvases, the motion-blur loop and the window API that render.mjs drives.
// You normally don't edit this file; the creative work lives in the scene (scene.js by default) and audio.js.
//
// render.mjs sets the URL query: scene=<file> (default scene.js), target=<name> (an entry in
// safezones.json), scale, fps, sub, alpha=1, and p.<key>=<value> for each --param key=value.
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
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

let scene, CFG, FPS, RW, RH, pipe, canvas, c2, hud, c2ctx, hudctx;

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
  // to the faces it found, so an undeclared family (an empty list) fails too.
  for (const f of CFG.FONTS || []) {
    let faces = [];
    try { faces = await document.fonts.load(`64px "${f}"`); } catch (e) { throw new Error(`font failed to load: ${f} (${e.message})`); }
    if (!faces.length || !document.fonts.check(`64px "${f}"`)) throw new Error(`font missing: ${f} (declare it in index.html @font-face, file in fonts/)`);
  }
  if (scene.init) await scene.init({ ctx: prep(c2ctx), hud: prep(hudctx), scale: SCALE, params, alpha: ALPHA, target: T });
  pipe = createPipeline(canvas, RW, RH, { alpha: ALPHA });
  // DUR is read after init, so a scene may set CFG.DUR there (from a param or a board).
  window.INFO = { RW, RH, W: CFG.W, H: CFG.H, FPS, DUR: CFG.DUR, ALPHA, SCALE, SUB, SCENE: SCENE_FILE,
    TARGET, SILENT: !!scene.silent, FONTS: CFG.FONTS || [] };
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
function renderAt(t) {
  pipe.beginFrame();
  const n = Math.max(1, Math.round(SUB * (scene.subBoost ? scene.subBoost(t) : 1)));
  for (let s = 0; s < n; s++) {
    const ts = t + ((s + 0.5) / n) * (0.5 / FPS);   // 180-degree shutter
    const jit = [halton(s + 1, 2) - 0.5, halton(s + 1, 3) - 0.5];
    prep(c2ctx);
    pipe.subframe(scene.frame(ts, jit), c2, 1 / n);
  }
  prep(hudctx);
  if (scene.drawHud) scene.drawHud(t, FPS);
  pipe.endFrame(scene.post(t), hud);
}
function readFrame() {
  const gl = pipe.gl, px = new Uint8Array(RW * RH * 4);
  gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

window.ready = boot();
window.renderStill = async (t) => { renderAt(t); return canvas.toDataURL('image/png'); };
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
  let zone = null, zoneName = null, zoneEstimate = false;
  if (safe) {
    zoneName = TARGET || B.target || null;
    if (!zoneName) throw new Error('--safe needs a target: pass --target <name> or set BOARD.target');
    const T = await loadTarget(zoneName);
    if (!T.safe) throw new Error(`--safe: target ${zoneName} has no safe area`);
    zone = T.safe; zoneEstimate = !!T.estimate;
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
    `scene ${SCENE_FILE}`, `${n} beats, ${info.dur.toFixed(2)} s`, zone ? `safe zones: ${zoneName}${zoneEstimate ? ' (estimate)' : ''}` : ''].filter(Boolean);
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
      if (zone) {
        const k = pw / CFG.W, zx = x + zone.x * k, zy = y + zone.y * k, zw = zone.w * k, zh = zone.h * k;
        sc.fillStyle = 'rgba(0,0,0,0.45)';
        sc.fillRect(x, y, pw, zy - y); sc.fillRect(x, zy + zh, pw, y + ph - zy - zh);
        sc.fillRect(x, zy, zx - x, zh); sc.fillRect(zx + zw, zy, x + pw - zx - zw, zh);
        sc.strokeStyle = 'rgba(255,214,0,0.8)'; sc.lineWidth = Math.max(1, u); sc.strokeRect(zx, zy, zw, zh);
      }
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
    cfgDur: CFG.DUR, order: lib.boardOrder(info, CFG.DUR, FPS), scene: SCENE_FILE, safe: zone ? { target: zoneName, estimate: zoneEstimate } : null };
};
