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
