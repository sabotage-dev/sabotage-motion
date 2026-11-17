// Looks and brand kits (plan 23.2): the named starting points a piece's style comes from, the brand kit
// (brand.json) that overrides them, and how the harness resolves the two into the style a scene draws with.
// Plain data and pure functions: main.js (the browser) and render.mjs (Node) both import this file.
//
// A style has:
//   tokens    bgA, bgB (the background pair), ink (text), muted (secondary text, rules), accent, accent2 (#RRGGBB)
//   fonts     display, body, mono: { family, file? }. A family without a file is declared in index.html (DISPLAY,
//             BODY, MONO). A look's file is a name in the skill's looks/fonts/, copied into the piece's fonts/; a
//             kit's file is a path relative to brand.json. Draw with fontStr(style, 'display', 120).
//   bg        the background shader id: none | gradient | paper | grid | crt | mesh. Never a colour: the shader
//             takes its colours from the tokens (bgConfig below).
//   bgParams  the shader's own numbers: drift (gradient, mesh), glow and line (grid: which token draws the lines),
//             lines and flicker (crt)
//   post      what post(t) starts from: bloom, thr, ca (chromatic aberration), grain, vig, scan (CRT scanlines)
//   motion    enter ('spring' | 'snap' | 'anticip' | 'step'), stagger (seconds between related elements), sweep
//             (a light sweep is allowed), glitch (a glitch at cuts is allowed), exit ('whip' | 'cut')
//   sound     the synthesized effects' timbre: wave (an OscillatorNode type), pitch and bright (multipliers on the
//             tones and the noise bands), verb (the reverb send, 0 to 1)
//
// Which look: --param look=<name>, else CFG.LOOK in the scene, else brand.json's `look`, else none (the template's
// own palette, TEMPLATE). Precedence for every value: --param over brand.json over the look over TEMPLATE. The
// params that reach a style are the six tokens and bg (--param ink=#hex, --param bg=paper).
//
// brand.json (the project root; each piece keeps its own copy and the files it names):
//   { "name": "...", "look": "paper",                                     look is optional
//     "colors": { "bgA": "#hex", "bgB": "#hex", "ink": "#hex", "muted": "#hex", "accent": "#hex", "accent2": "#hex" },
//     "fonts": { "display": { "family": "Name Display", "file": "fonts/name-display.woff2" }, "body": {...}, "mono": {...} },
//     "logo": { "onDark": "logo/name-on-dark.svg", "onLight": "logo/name-on-light.svg" } }
// Any color or font role may be left out (the look or the template fills it); paths are relative to brand.json.

export const TOKENS = ['bgA', 'bgB', 'ink', 'muted', 'accent', 'accent2'];
export const ROLES = ['display', 'body', 'mono'];
// Background shader ids, as shaders.js numbers them (cfg.scene). 0 is a flat clear colour.
export const BG_IDS = { none: 0, gradient: 1, paper: 2, grid: 3, crt: 4, mesh: 5 };
export const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
export const ENTERS = ['spring', 'snap', 'anticip', 'step'];
export const EXITS = ['whip', 'cut'];

// The look fonts: one copy each in the skill's looks/fonts/ (with their OFL texts), copied into a piece's fonts/
// only when its look uses them. Latin subsets from the pinned @fontsource packages (ASSETS.md).
export const LOOK_FONTS = {
  SERIF: { file: 'fraunces-latin-800-normal.woff2', licence: 'OFL-Fraunces.txt', what: 'a serif display (Fraunces 800)' },
  CONDENSED: { file: 'anton-latin-400-normal.woff2', licence: 'OFL-Anton.txt', what: 'a condensed display (Anton 400)' },
  ROUNDED: { file: 'fredoka-latin-600-normal.woff2', licence: 'OFL-Fredoka.txt', what: 'a rounded sans (Fredoka 600)' },
  HAND: { file: 'caveat-latin-700-normal.woff2', licence: 'OFL-Caveat.txt', what: 'a hand face (Caveat 700)' },
};
const face = (family) => (LOOK_FONTS[family] ? { family, file: LOOK_FONTS[family].file } : { family });

// The template's own style: what the template's scene drew before looks existed, and what fills anything a look
// or a kit leaves out.
export const TEMPLATE = {
  tokens: { bgA: '#101018', bgB: '#2A1630', ink: '#F4F1EA', muted: '#9C9AA6', accent: '#FF4A1C', accent2: '#E0A458' },
  fonts: { display: face('DISPLAY'), body: face('BODY'), mono: face('MONO') },
  bg: 'gradient', bgParams: { drift: 1, glow: 1, line: 'accent', lines: 320, flicker: 1 },
  post: { bloom: 0.18, thr: 0.78, ca: 0.0008, grain: 0.025, vig: 0.12, scan: 0 },
  motion: { enter: 'spring', stagger: 0.07, sweep: true, glitch: false, exit: 'whip' },
  sound: { wave: 'sine', pitch: 1, bright: 1, verb: 0.35 },
};

// The eight looks. Each is a starting point the agent then makes its own; `about` says what it is for.
export const LOOKS = {
  product: {
    label: 'Product', about: 'clean light UI, crisp and quiet',
    tokens: { bgA: '#F6F7F9', bgB: '#E3E8F0', ink: '#141821', muted: '#5F6B7A', accent: '#2F6BFF', accent2: '#13B38B' },
    fonts: { display: face('BODY'), body: face('BODY'), mono: face('MONO') },
    bg: 'gradient', bgParams: { drift: 0.6 },
    post: { bloom: 0.04, thr: 0.9, ca: 0, grain: 0.012, vig: 0.04, scan: 0 },
    motion: { enter: 'snap', stagger: 0.05, sweep: false, glitch: false, exit: 'whip' },
    sound: { wave: 'sine', pitch: 1.25, bright: 1.2, verb: 0.15 },
  },
  neon: {
    label: 'Neon', about: 'dark, glow, a glitch at cuts',
    tokens: { bgA: '#07060F', bgB: '#1B0B3D', ink: '#F2F6FF', muted: '#8C90B8', accent: '#FF2BD6', accent2: '#22E4FF' },
    fonts: { display: face('DISPLAY'), body: face('BODY'), mono: face('MONO') },
    bg: 'grid', bgParams: { glow: 1.4, line: 'accent2' },
    post: { bloom: 0.45, thr: 0.6, ca: 0.0014, grain: 0.03, vig: 0.22, scan: 0 },
    motion: { enter: 'snap', stagger: 0.05, sweep: true, glitch: true, exit: 'whip' },
    sound: { wave: 'sawtooth', pitch: 1, bright: 1.3, verb: 0.4 },
  },
  paper: {
    label: 'Paper', about: 'warm texture, serif, gentle springs',
    tokens: { bgA: '#EFE6D2', bgB: '#E0CFAE', ink: '#2B2118', muted: '#7A6A55', accent: '#C2532D', accent2: '#4F7A5A' },
    fonts: { display: face('SERIF'), body: face('HAND'), mono: face('MONO') },
    bg: 'paper', bgParams: {},
    post: { bloom: 0.03, thr: 0.95, ca: 0, grain: 0.03, vig: 0.16, scan: 0 },
    motion: { enter: 'spring', stagger: 0.09, sweep: false, glitch: false, exit: 'whip' },
    sound: { wave: 'triangle', pitch: 0.8, bright: 0.7, verb: 0.25 },
  },
  editorial: {
    label: 'Editorial', about: 'bold serif, black and white, one accent',
    tokens: { bgA: '#F4F3EF', bgB: '#E4E2DB', ink: '#0E0E0E', muted: '#5A5A5A', accent: '#E3120B', accent2: '#0E0E0E' },
    fonts: { display: face('SERIF'), body: face('BODY'), mono: face('MONO') },
    bg: 'gradient', bgParams: { drift: 0.4 },
    post: { bloom: 0, thr: 1, ca: 0, grain: 0.015, vig: 0.06, scan: 0 },
    motion: { enter: 'snap', stagger: 0.04, sweep: false, glitch: false, exit: 'cut' },
    sound: { wave: 'sine', pitch: 1.4, bright: 1, verb: 0.1 },
  },
  'retro-crt': {
    label: 'Retro CRT', about: 'scanlines and phosphor glow',
    tokens: { bgA: '#03100A', bgB: '#0B3220', ink: '#B8FFD0', muted: '#4E9E6C', accent: '#39FF7A', accent2: '#FFB000' },
    fonts: { display: face('MONO'), body: face('MONO'), mono: face('MONO') },
    bg: 'crt', bgParams: { lines: 320, flicker: 1 },
    post: { bloom: 0.5, thr: 0.5, ca: 0.0012, grain: 0.035, vig: 0.32, scan: 0.35 },
    motion: { enter: 'step', stagger: 0.06, sweep: false, glitch: true, exit: 'cut' },
    sound: { wave: 'square', pitch: 0.9, bright: 0.8, verb: 0.15 },
  },
  brutalist: {
    label: 'Brutalist', about: 'condensed type, primaries, snaps',
    tokens: { bgA: '#FFD400', bgB: '#FFC20E', ink: '#0A0A0A', muted: '#3B3B3B', accent: '#E8251B', accent2: '#1D3FD8' },
    fonts: { display: face('CONDENSED'), body: face('MONO'), mono: face('MONO') },
    bg: 'none', bgParams: {},
    post: { bloom: 0, thr: 1, ca: 0, grain: 0.02, vig: 0, scan: 0 },
    motion: { enter: 'snap', stagger: 0.03, sweep: false, glitch: false, exit: 'cut' },
    sound: { wave: 'square', pitch: 0.7, bright: 0.9, verb: 0.05 },
  },
  gradient: {
    label: 'Gradient', about: 'soft mesh colour, rounded sans',
    tokens: { bgA: '#F9D3E0', bgB: '#B5C8F2', ink: '#1E1B3A', muted: '#6B678F', accent: '#7C4DFF', accent2: '#FFD9A8' },
    fonts: { display: face('ROUNDED'), body: face('ROUNDED'), mono: face('MONO') },
    bg: 'mesh', bgParams: { drift: 1 },
    post: { bloom: 0.1, thr: 0.85, ca: 0, grain: 0.02, vig: 0.05, scan: 0 },
    motion: { enter: 'anticip', stagger: 0.08, sweep: true, glitch: false, exit: 'whip' },
    sound: { wave: 'sine', pitch: 1.1, bright: 1.1, verb: 0.5 },
  },
  mono: {
    label: 'Mono', about: 'high-contrast black and white',
    tokens: { bgA: '#000000', bgB: '#1C1C1C', ink: '#FFFFFF', muted: '#8C8C8C', accent: '#FFFFFF', accent2: '#BDBDBD' },
    fonts: { display: face('DISPLAY'), body: face('MONO'), mono: face('MONO') },
    bg: 'gradient', bgParams: { drift: 0.5 },
    post: { bloom: 0.12, thr: 0.8, ca: 0, grain: 0.03, vig: 0.18, scan: 0 },
    motion: { enter: 'snap', stagger: 0.06, sweep: true, glitch: false, exit: 'whip' },
    sound: { wave: 'triangle', pitch: 1, bright: 1, verb: 0.2 },
  },
};
export const LOOK_NAMES = Object.keys(LOOKS);
const isLook = (n) => typeof n === 'string' && Object.hasOwn(LOOKS, n);

// The font files a look needs in the piece's fonts/ (to copy from the skill's looks/fonts/), with their licences.
export function lookFiles(name) {
  const L = isLook(name) ? LOOKS[name] : null;
  if (!L) throw new Error(`unknown look "${name}" (looks: ${LOOK_NAMES.join(', ')})`);
  const fams = [...new Set(ROLES.map((r) => L.fonts[r].family))].filter((f) => LOOK_FONTS[f]);
  return fams.flatMap((f) => [LOOK_FONTS[f].file, LOOK_FONTS[f].licence]);
}

// ---------------------------------------------------------------- colours
// '#rgb' or '#rrggbb' (any case) -> '#RRGGBB', or null when it does not parse.
export function normHex(x) {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + [...s.slice(1)].map((c) => c + c).join('')).toUpperCase();
  return null;
}
export const hexRgb01 = (h) => { const n = parseInt(normHex(h).slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// ---------------------------------------------------------------- the brand kit
const BRAND_KEYS = ['name', 'look', 'colors', 'fonts', 'logo'];
const FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
const safePath = (p) => typeof p === 'string' && p.trim() !== '' && !p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p) && !p.split(/[\\/]/).includes('..');
// Everything wrong with a parsed brand.json, as sentences. exists(path) answers whether a file named by the kit is
// there (relative to brand.json); without it, files are not looked for.
export function brandProblems(b, exists = null) {
  const p = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ['brand.json must hold an object: { name, colors, fonts, logo, look? }'];
  for (const k of Object.keys(b)) if (!BRAND_KEYS.includes(k)) p.push(`brand.json: unknown key "${k}" (keys: ${BRAND_KEYS.join(', ')})`);
  if (typeof b.name !== 'string' || !b.name.trim()) p.push('brand.json: name must be a non-empty string');
  if (b.look != null && !isLook(b.look)) p.push(`brand.json: look "${b.look}" is not a look (looks: ${LOOK_NAMES.join(', ')})`);
  if (b.colors != null) {
    if (typeof b.colors !== 'object' || Array.isArray(b.colors)) p.push('brand.json: colors must be an object of tokens');
    else for (const [k, v] of Object.entries(b.colors)) {
      if (!TOKENS.includes(k)) p.push(`brand.json: colors.${k} is not a token (tokens: ${TOKENS.join(', ')})`);
      else if (!normHex(v)) p.push(`brand.json: colors.${k} "${v}" does not parse (write #RRGGBB or #RGB)`);
    }
  }
  const file = (where, f) => {
    if (!safePath(f)) { p.push(`brand.json: ${where} must be a path relative to brand.json, inside its folder ("${f}")`); return; }
    if (exists && !exists(f)) p.push(`brand.json: ${where} ${f} does not exist`);
  };
  if (b.fonts != null) {
    if (typeof b.fonts !== 'object' || Array.isArray(b.fonts)) p.push('brand.json: fonts must be an object of roles');
    else for (const [role, f] of Object.entries(b.fonts)) {
      if (!ROLES.includes(role)) { p.push(`brand.json: fonts.${role} is not a role (roles: ${ROLES.join(', ')})`); continue; }
      if (!f || typeof f !== 'object') { p.push(`brand.json: fonts.${role} must be { family, file }`); continue; }
      if (typeof f.family !== 'string' || !FAMILY_RE.test(f.family)) p.push(`brand.json: fonts.${role}.family "${f.family}" must be a plain name (letters, digits, spaces, - and _)`);
      else if (['DISPLAY', 'BODY', 'MONO', ...Object.keys(LOOK_FONTS)].includes(f.family) || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(f.family)) {
        p.push(`brand.json: fonts.${role}.family "${f.family}" is taken (by the template, a look font or a CSS generic); give the kit's own name`);
      }
      file(`fonts.${role}.file`, f.file);
    }
  }
  if (b.logo != null) {
    if (typeof b.logo !== 'object' || Array.isArray(b.logo)) p.push('brand.json: logo must be { onDark, onLight }');
    else for (const [k, f] of Object.entries(b.logo)) {
      if (!['onDark', 'onLight'].includes(k)) { p.push(`brand.json: logo.${k} is not onDark or onLight`); continue; }
      file(`logo.${k}`, f);
    }
  }
  return p;
}

// ---------------------------------------------------------------- resolving a style
// The style a piece draws with: TEMPLATE, then the look, then the kit, then --param (see the header). Throws on an
// unknown look, a kit with problems, or a param that does not parse. `sources` says where each token, font role
// and bg came from: 'template' | 'look' | 'brand' | 'param'.
export function resolveStyle({ look = null, brand = null, params = {} } = {}) {
  if (look != null && look !== '' && !isLook(look)) throw new Error(`unknown look "${look}" (looks: ${LOOK_NAMES.join(', ')})`);
  if (brand) { const bp = brandProblems(brand); if (bp.length) throw new Error(bp.join('; ')); }
  const L = look ? LOOKS[look] : null;
  const tokens = {}, sources = {}, fonts = {};
  for (const k of TOKENS) {
    let v = TEMPLATE.tokens[k], from = 'template';
    if (L && L.tokens[k]) { v = L.tokens[k]; from = 'look'; }
    if (brand && brand.colors && brand.colors[k] != null) { v = brand.colors[k]; from = 'brand'; }
    if (params[k] != null && params[k] !== '') {
      if (!normHex(params[k])) throw new Error(`--param ${k}=${params[k]}: a colour token takes #RRGGBB or #RGB`);
      v = params[k]; from = 'param';
    }
    tokens[k] = normHex(v); sources[k] = from;
  }
  for (const r of ROLES) {
    let f = { ...TEMPLATE.fonts[r], from: 'template' };
    if (L) f = { ...L.fonts[r], from: 'look' };
    if (brand && brand.fonts && brand.fonts[r]) f = { family: brand.fonts[r].family, file: brand.fonts[r].file, from: 'brand' };
    // where the page fetches the face: look fonts from fonts/, kit fonts from their path; template faces are declared in index.html
    f.url = f.file ? (f.from === 'brand' ? f.file : `fonts/${f.file}`) : null;
    fonts[r] = f; sources[r] = f.from;
  }
  let bg = L ? L.bg : TEMPLATE.bg; sources.bg = L ? 'look' : 'template';
  if (params.bg != null && params.bg !== '') {
    if (!Object.hasOwn(BG_IDS, params.bg)) throw new Error(`--param bg=${params.bg}: bg is the background shader id (${Object.keys(BG_IDS).join(', ')}), never a colour; colours are the tokens (--param bgA=#hex)`);
    bg = params.bg; sources.bg = 'param';
  }
  const pick = (k) => ({ ...TEMPLATE[k], ...(L ? L[k] : {}) });
  return { look: look || null, brand: brand ? brand.name : null, tokens, fonts, bg, bgParams: pick('bgParams'), post: pick('post'),
    motion: pick('motion'), sound: pick('sound'), sources };
}

// The faces a style needs registered with FontFace (those with a file), one per family. A family named twice with
// two different files is an error.
export function styleFaces(style) {
  const out = new Map();
  for (const r of ROLES) {
    const f = style.fonts[r];
    if (!f.url) continue;
    const had = out.get(f.family);
    if (had && had.url !== f.url) throw new Error(`font family ${f.family} names two files: ${had.url} and ${f.url}`);
    if (!had) out.set(f.family, { family: f.family, url: f.url, from: f.from, roles: [r] }); else had.roles.push(r);
  }
  return [...out.values()];
}
// Every family a look or a kit names (the harness adds them to CFG.FONTS). Empty for the template's own style.
export const styleFamilies = (style) => (style.look || style.brand ? [...new Set(ROLES.map((r) => style.fonts[r].family))] : []);

// A Canvas2D font string for a role: fontStr(style, 'display', 120) -> '120px "SERIF"'. extra goes before the size
// ('italic', '700').
export const fontStr = (style, role, px, extra = '') => `${extra ? extra + ' ' : ''}${px}px "${style.fonts[role].family}"`;

// The background part of frame(t)'s return for a style: { scene, P, Q, R, clear }. Spread it into the config:
//   return { t, jit, use2D: true, ...bgConfig(style, { alpha }), cam: [...] };
export function bgConfig(style, { alpha = false } = {}) {
  const T = style.tokens, bp = style.bgParams || {}, c = (k) => hexRgb01(T[k]);
  const clear = c('bgA');
  if (alpha) return { scene: 0, P: [0, 0, 0, 0], Q: [0, 0, 0, 0], R: [0, 0, 0, 0], clear };
  switch (style.bg) {
    case 'gradient': return { scene: 1, P: [...c('bgA'), bp.drift ?? 1], Q: [...c('bgB'), 0], R: [0, 0, 0, 0], clear };
    case 'paper': return { scene: 2, P: [...c('bgA'), 0], Q: [...c('bgB'), 0], R: [0, 0, 0, 0], clear };
    case 'grid': return { scene: 3, P: [...c('bgA'), 1], Q: [...c(TOKENS.includes(bp.line) ? bp.line : 'accent'), bp.glow ?? 1], R: [...c('bgB'), 0], clear };
    case 'crt': return { scene: 4, P: [...c('bgA'), bp.flicker ?? 1], Q: [...c('bgB'), bp.lines ?? 320], R: [...c('accent'), 0], clear };
    case 'mesh': return { scene: 5, P: [...c('bgA'), bp.drift ?? 1], Q: [...c('bgB'), 0], R: [...c('accent2'), 0], clear };
    default: return { scene: 0, P: [0, 0, 0, 0], Q: [0, 0, 0, 0], R: [0, 0, 0, 0], clear };
  }
}

// ---------------------------------------------------------------- what was drawn
// The families in a CSS font shorthand, in order, quotes removed: fontFamilies('italic 700 64px/1.2 "Quill Display",
// serif') -> ['Quill Display', 'serif']. main.js records them at every fillText and strokeText (fonts_used).
const SIZE_RE = /(?:^|\s)(?:\d*\.?\d+(?:e[+-]?\d+)?(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)(?:\s*\/\s*\S+)?\s+/i;
export function fontFamilies(font) {
  const s = String(font || '');
  const m = s.match(SIZE_RE);
  if (!m) return [];
  const rest = s.slice(m.index + m[0].length);
  const out = [];
  let cur = '', q = null;
  for (const ch of rest) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
}
