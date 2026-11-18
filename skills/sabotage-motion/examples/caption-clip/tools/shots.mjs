// tools/shots.mjs: pictures of a running local app or a local HTML file, for a launch video (plan 23.4).
//
//   node tools/shots.mjs page <name> <src> --viewport WxH [--dpr N]
//   node tools/shots.mjs seq <name> <src> --viewport WxH [--dpr N] --dur s --scroll from:to [--ease swift|linear]
//                       [--fps N] [--scene file.js] [--target name]
//
// <src> is a local HTML file (a path) or a running local app (http://localhost:<port>/..., 127.0.0.1 or [::1]);
// anything else is refused. The page is opened in headless Chrome (playwright-core, as render.mjs does) at the
// stated viewport, in CSS pixels, with --dpr device pixels to each (default 1; 2 for a phone viewport the scene draws
// large). Paths resolve against the piece (this tool's parent folder), like render.mjs.
//
// page  A page that does not move: one full-page screenshot, assets/shots/<name>.png, W x dpr wide and the page's
//       full height x dpr tall, its CSS animations finished. The scene draws it and pans it, so scrolling costs one
//       image:
//         const img = new Image(); img.src = 'assets/shots/app.png'; await img.decode();        // in init
//         ctx.drawImage(img, 0, y0, img.width, viewH, x, y, w, h);                            // in frame(t)
// seq   A page that moves: a frame sequence in the layout tools/frames.mjs writes and loadSeq reads,
//       assets/seq/<name>/000.png, 001.png, ... and its entry in assets/seq/manifest.json ({ frames, fps, w, h,
//       ext: 'png', ... }), replacing an older one of the same name. round(dur x fps) frames at the piece's fps
//       (--fps, else the scene's CFG.FPS, else the --target's, else 30: the rule frames.mjs uses). Frame i is the
//       page at i / fps seconds, scrolled to from + (to - from) x ease(i / (frames - 1)) CSS pixels, rounded to a
//       whole pixel (Chrome scrolls by whole pixels). The page's clock is Playwright's (timers, requestAnimationFrame,
//       Date, performance.now), stopped before the page opens and run forward a frame at a time (i / fps at frame i,
//       to the millisecond), and every CSS animation and transition is paused and set to its time since the frame it
//       first appeared in, so the same page gives the same frames on every run: at frame 0, performance.now() reads 0
//       and Date.now() CLOCK0 (1 s past the epoch), on a fast machine or a slow one.
//       In the scene: await loadSeq('<name>') in init, ctx.drawImage(seqAt('<name>', t, t0), x, y, w, h).
//
// loadSeq holds every frame decoded (w x h x 4 bytes), so a sequence over 1 GB decoded (frames x w x h x 4 bytes,
// w and h in device pixels) is refused before anything is captured: lower the size (--viewport, --dpr) or the
// length (--dur). A --scroll past the page's end is refused too, and so is a page that moves its own scroll when its
// clock runs, and a page that goes off this machine (a redirect, or later). There is no live screen recording: every
// frame is set, then taken. The page's own network requests are its own; nothing here fetches anything else.
// Exit 2 on a usage error, 1 when it refuses (nothing is written then; an older sequence of the name stays).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { pieceFps, installSeq, SEQ_DIR, FramesError, UsageError } from './frames.mjs';
import { swift } from '../lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(ROOT, 'assets', 'shots');
export const SEQ_MAX_BYTES = 1024 ** 3;   // 1 GB decoded: what loadSeq would hold in the page
export const EASES = { swift, linear: (x) => x };

// The decoded size of a sequence and, when it is over the limit, why it is refused (else null).
export const seqBytes = ({ frames, w, h }) => frames * w * h * 4;
export function seqTooBig({ frames, w, h }) {
  const bytes = seqBytes({ frames, w, h });
  if (!(bytes > SEQ_MAX_BYTES)) return null;
  return `${frames} frames of ${w}x${h} hold ${(bytes / SEQ_MAX_BYTES).toFixed(2)} GB decoded (frames x width x height x 4 bytes), over loadSeq's 1 GB: lower the size (--viewport, --dpr) or the length (--dur)`;
}
// The scroll position of frame i of n, from `from` to `to` CSS px through `ease`, rounded to a whole pixel.
export const scrollAt = (i, n, from, to, ease = swift) => Math.round(from + (to - from) * ease(n > 1 ? i / (n - 1) : 1));
// The page's clock at frame i, in whole milliseconds since frame 0 (Playwright's clock moves in whole milliseconds); its
// Date reads CLOCK0 ms past the epoch at frame 0.
export const CLOCK0 = 1000;
export const clockAt = (i, fps) => Math.round((i * 1000) / fps);

// A local source: a running local app's URL, or an HTML file in or beside the piece.
const LOCAL_HOSTS = (h) => h === 'localhost' || h.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(h) || h === '::1' || h === '0.0.0.0';
// Whether the URL a page is at is still local: a file, or an http(s) page on this machine. It is checked when the page
// opens and again right before every screenshot, so a local app that redirects to another host, or a page that goes
// there later (a timer or a location change its clock runs), is refused with nothing written.
export function isLocalUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'file:') return true;
  return ['http:', 'https:'].includes(u.protocol) && LOCAL_HOSTS(u.hostname.replace(/^\[|\]$/g, ''));
}
const stillLocal = (page, src) => {
  if (!isLocalUrl(page.url())) throw new FramesError(`${src.label} went to ${page.url()}, which is not on this machine: shots.mjs takes pictures of local pages only`);
};
// A refusal about the page checks first that it is still local: a page that went off this machine says so.
const refuse = (page, src, msg) => { stillLocal(page, src); throw new FramesError(msg); };
// Runs steps on the page. A navigation off this machine can land in the middle of a step (the page's context is then
// destroyed, and the step throws, sometimes before Playwright has reported where the page went): the refusal says where
// it went, not what the step was doing.
async function onPage(page, src, fn) {
  try { return await fn(); } catch (e) {
    if (!(e instanceof FramesError)) {
      if (/context was destroyed|navigat/i.test(String(e && e.message)) && isLocalUrl(page.url())) {
        await page.waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame(), timeout: 2000 }).catch(() => {});
      }
      stillLocal(page, src);
    }
    throw e;
  }
}
export function localSource(arg, root = ROOT) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(arg) && !/^file:/i.test(arg)) {
    let u;
    try { u = new URL(arg); } catch { throw new UsageError(`${arg}: not a URL`); }
    if (!['http:', 'https:'].includes(u.protocol) || !LOCAL_HOSTS(u.hostname.replace(/^\[|\]$/g, ''))) {
      throw new UsageError(`${arg}: shots.mjs takes pictures of a local HTML file or an app running on this machine (localhost, 127.0.0.1, [::1]) only`);
    }
    return { url: u.href, label: u.href, http: true };
  }
  const file = /^file:/i.test(arg) ? fileURLToPath(arg) : path.resolve(root, arg);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new UsageError(`${arg}: no such file`);
  if (!/\.html?$/i.test(file)) throw new UsageError(`${arg}: not an HTML file (.html or .htm)`);
  const rel = path.relative(root, file);
  return { url: pathToFileURL(file).href, label: rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(file) : rel, http: false };
}

function parseArgs(argv) {
  const VAL = new Set(['viewport', 'dpr', 'dur', 'scroll', 'ease', 'fps', 'scene', 'target']);
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (!VAL.has(k)) throw new UsageError(`unknown option ${a}`);
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
    if (k in o) throw new UsageError(`${a} given twice`);
    o[k] = v; i++;
  }
  return o;
}
const posNum = (o, k, def) => {
  if (o[k] == null) return def;
  const x = Number(o[k]);
  if (o[k] === '' || !Number.isFinite(x) || x <= 0) throw new UsageError(`--${k} ${o[k]}: needs a number above 0`);
  return x;
};

const launch = () => chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true });
// Runs work(browser) on a Chrome launched inside the try, so whatever throws after the launch (a folder that cannot be
// made, the page, a frame) closes it; Chrome closes first, then cleanup() removes the temporary files, so a cleanup that
// throws cannot leave Chrome running either.
async function withChrome(work, cleanup) {
  let browser = null;
  try {
    browser = await launch();
    return await work(browser);
  } finally {
    try { if (browser) await browser.close(); } finally { cleanup(); }
  }
}
// Opens the page: a context at the viewport (and, for a sequence, a stopped clock), the source, its fonts. Exported, with
// pageSteps and frameSteps below, so a test can drive each refusal with a stand-in for Playwright's browser and page.
export async function open(browser, src, vp, dpr, { clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: dpr });
  // the page's clock: paused on the context before the page exists, so the page opens on a stopped clock whose ticks
  // (performance.now(), and the 16 ms grid requestAnimationFrame fires on) start at 0. pauseAt alone installs it. The
  // page replays the clock calls logged with the real time each was made, and an install() before the pause would
  // advance the ticks by the real milliseconds between the two calls (more on a busy machine), so a frame near a 16 ms
  // boundary would catch one requestAnimationFrame more on one run than on another
  if (clock) await context.clock.pauseAt(CLOCK0);
  const page = await context.newPage();
  await page.goto(src.url, { waitUntil: src.http ? 'networkidle' : 'load' });
  stillLocal(page, src);
  await onPage(page, src, () => page.evaluate(() => document.fonts.ready));
  return page;
}
const pngSize = (file) => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

export async function shots(argv, log = console.log) {
  const o = parseArgs(argv);
  if (o.help) { log('usage: node tools/shots.mjs page|seq <name> <src> --viewport WxH [--dpr N] [seq: --dur s --scroll from:to]  (see the header)'); return null; }
  const [mode, name, srcArg] = o._;
  if (!['page', 'seq'].includes(mode) || o._.length !== 3) throw new UsageError('give a mode, a name and a source: node tools/shots.mjs page|seq <name> <src> --viewport WxH');
  if (!/^[\w][\w.-]*$/.test(name) || name === 'manifest.json') throw new UsageError(`${name}: a name, not a path (letters, digits, _ . -)`);
  const vm = String(o.viewport || '').match(/^(\d+)x(\d+)$/);
  if (!vm || +vm[1] < 1 || +vm[2] < 1) throw new UsageError('--viewport WxH: the viewport in CSS pixels, stated (e.g. --viewport 430x932)');
  const vp = { w: +vm[1], h: +vm[2] }, dpr = posNum(o, 'dpr', 1);
  const src = localSource(srcArg);
  if (mode === 'page') {
    for (const k of ['dur', 'scroll', 'ease', 'fps', 'scene', 'target']) if (o[k] != null) throw new UsageError(`--${k} is for seq; a page is one full-page screenshot`);
    return pageShot(name, src, vp, dpr, log);
  }
  const dur = posNum(o, 'dur');
  if (dur == null) throw new UsageError('--dur: how many seconds the sequence lasts');
  const sm = String(o.scroll || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!sm) throw new UsageError('--scroll from:to: where the page is scrolled at the first and the last frame, in CSS pixels (e.g. --scroll 0:1200)');
  const ease = o.ease || 'swift';
  if (!Object.hasOwn(EASES, ease)) throw new UsageError(`--ease ${ease}: one of ${Object.keys(EASES).join(', ')}`);
  const { fps, from: fpsFrom } = await pieceFps(o);
  const frames = Math.round(dur * fps);
  if (frames < 1) throw new UsageError(`--dur ${dur} at ${fps} fps is less than one frame`);
  const w = Math.round(vp.w * dpr), h = Math.round(vp.h * dpr);
  const big = seqTooBig({ frames, w, h });
  if (big) throw new FramesError(big);
  return seqShots(name, src, { vp, dpr, fps, fpsFrom, frames, w, h, dur, from: +sm[1], to: +sm[2], ease }, log);
}

// The page mode's steps on an open page: its full height, then (still local) the full-page screenshot to tmp.
export function pageSteps(page, src, tmp) {
  return onPage(page, src, async () => {
    const css = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    stillLocal(page, src);   // the page may have moved on since it opened
    await page.screenshot({ path: tmp, type: 'png', fullPage: true, animations: 'disabled', caret: 'hide' });
    return css;
  });
}
async function pageShot(name, src, vp, dpr, log) {
  const out = path.join(SHOTS_DIR, `${name}.png`), tmp = path.join(SHOTS_DIR, `.${name}.tmp-${process.pid}.png`);
  return withChrome(async (browser) => {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const page = await open(browser, src, vp, dpr);
    const full = await pageSteps(page, src, tmp);
    fs.renameSync(tmp, out);
    const { w, h } = pngSize(out);
    log(`shots: ${name}: ${src.label} at ${vp.w}x${vp.h} (dpr ${dpr}), the full page: ${w}x${h} px (${full} CSS px tall)`);
    log(`wrote assets/shots/${name}.png`);
    return { file: path.relative(ROOT, out), w, h, cssHeight: full };
  }, () => fs.rmSync(tmp, { force: true }));
}

// One frame of a sequence on an open page: scroll to its position, run the page's clock to its time, set its CSS
// animations, check the scroll and that the page is still local, then the screenshot, tmp/<NNN>.png.
export function frameSteps(page, src, s, i, tmp) {
  return onPage(page, src, async () => {
    const y = scrollAt(i, s.frames, s.from, s.to, EASES[s.ease]), t = i / s.fps;
    const got = await page.evaluate((y) => { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); return window.scrollY; }, y);
    if (Math.abs(got - y) > 0.01) refuse(page, src, `frame ${i}: the page scrolled to ${got} px, not ${y} (does it move its own scroll?)`);
    if (i > 0) await page.clock.runFor(clockAt(i, s.fps) - clockAt(i - 1, s.fps));
    // CSS animations and transitions run on Chrome's own clock: pause each one and set it to its time since the frame
    // it first showed up in, so a frame is the same on every run
    await page.evaluate((t) => {
      const seen = (window.__smShots ||= new WeakMap());
      for (const a of document.getAnimations()) {
        if (a.timeline !== document.timeline) continue;   // scroll-driven: it follows the scroll already
        if (!seen.has(a)) seen.set(a, t);
        a.pause();
        a.currentTime = (t - seen.get(a)) * 1000;
      }
    }, t);
    // the clock step may have run page code that moved the scroll: check it again right before the picture
    const now = await page.evaluate(() => window.scrollY);
    if (Math.abs(now - y) > 0.01) refuse(page, src, `frame ${i}: the page moved its own scroll to ${now} px when its clock ran, not ${y}: shots.mjs cannot set the scroll of a page that sets it`);
    stillLocal(page, src);   // a timer or a location change the clock ran may have taken it off this machine
    await page.screenshot({ path: path.join(tmp, `${String(i).padStart(3, '0')}.png`), type: 'png', animations: 'allow', caret: 'hide' });
  });
}
async function seqShots(name, src, s, log) {
  const tmp = path.join(SEQ_DIR, `.${name}.tmp-${process.pid}`);
  return withChrome(async (browser) => {
    fs.mkdirSync(SEQ_DIR, { recursive: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp);
    const page = await open(browser, src, s.vp, s.dpr, { clock: true });
    const max = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
    if (Math.max(s.from, s.to) > max) throw new FramesError(`--scroll ${s.from}:${s.to}: ${src.label} scrolls to at most ${max} px at a ${s.vp.w}x${s.vp.h} viewport`);
    for (let i = 0; i < s.frames; i++) await frameSteps(page, src, s, i, tmp);
    const { w, h } = pngSize(path.join(tmp, '000.png'));
    const entry = installSeq(name, tmp, { frames: s.frames, fps: s.fps, w, h, ext: 'png', src: src.label, dur: s.dur,
      viewport: [s.vp.w, s.vp.h], dpr: s.dpr, scroll: [s.from, s.to], ease: s.ease });
    log(`shots: ${name}: ${s.frames} frames at ${s.fps} fps (${s.fpsFrom}), ${w}x${h}, ${src.label} scrolled ${s.from} to ${s.to} px (${s.ease})`);
    log(`  held decoded in memory by loadSeq: about ${(seqBytes({ frames: s.frames, w, h }) / (1 << 20)).toFixed(0)} MB`);
    log(`wrote assets/seq/${name}/000.png ... ${String(s.frames - 1).padStart(3, '0')}.png and assets/seq/manifest.json`);
    return entry;
  }, () => fs.rmSync(tmp, { recursive: true, force: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await shots(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) { console.error(`shots: ${e.message}`); process.exitCode = 2; }
    else if (e instanceof FramesError) { console.error(`shots: refused: ${e.message}`); process.exitCode = 1; }
    else throw e;
  }
}
