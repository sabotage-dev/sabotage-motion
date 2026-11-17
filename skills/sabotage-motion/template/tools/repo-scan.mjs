// tools/repo-scan.mjs: what a launch video for a code project can be built from (plan 23.4).
//
//   node tools/repo-scan.mjs <project folder> [--brand <file>]
//
// Reads the project's files as text (it never runs them and never touches the network) and prints JSON. Every
// value says where it came from: `file` (relative to the project folder) and `line`.
//   name         the README's title (its first heading, at any level, with only pictures, badges, link-reference
//                definitions and HTML blocks above it, after any YAML front matter), else the package metadata's
//                name (package.json, pyproject.toml, Cargo.toml), else the folder's name
//   pitch        the package metadata's description, else the README's first sentence of prose
//   install      the first install command in a README code block (a line ending in \ joined to the next) that
//                names this package, else the first that sits under an Install-like heading at any level above it
//                (Install, Setup, Getting started, Quick start); else one made from the package metadata (marked
//                derived)
//   features     the list items under a README heading named like Features (Features, Highlights, Why ...,
//                What it does), then the README's other section headings that are not boilerplate (Install,
//                Usage, License ...) and do not sit inside a boilerplate or Install-like section
//   colors       every colour, with the file and line it came from: CSS custom properties (--name: a hex, rgb(),
//                hsl() or oklch() value, or a var() of one, or its fallback when that var is not declared) in
//                stylesheets and pages, a Tailwind config's theme colours (read as text, never run), a web
//                manifest's theme_color
//   fonts        @font-face rules (the family; the best local file of every src, woff2, woff, ttf, otf, then the
//                rest; weight and style) and font links (a <link> or an
//                @import of a font service's CSS: the families it names, never fetched), each with the roles the
//                project gives the family: display (h1 to h3, .title, --font-display or --font-heading), body
//                (body, html, p, --font-body or --font-text), mono (code, pre, --font-mono or --font-code)
//   logos        image files that could be the logo, ranked (score and why): a logo word in the name, the
//                project's name in it, SVG over PNG over the rest, a shallow or a brand folder, shown in the
//                README or linked as the page's icon or the manifest's
//   screenshots  image files that look like screenshots (a screenshot word in the name or folder), and the
//                README's other pictures
//   skipped      the dependency and build folders it did not read (node_modules, dist, build, target, .venv ...)
//   brand        the draft brand.json made from the above (`kit`), where each value came from (`from`) and what
//                it could not decide (`notes`); show it to the person before using it
//
// The draft kit maps colours to tokens by their names (TOKEN_EXACT and TOKEN_WORDS below; references/launch.md lists
// every one): a whole name that is a token's exact name (--bg, --surface, --text, --muted, --accent, --accent-2 ...)
// wins; then a name holding one of its words (--page-bg, --card, --brand-tint ...). Among each, the first one found
// wins (stylesheets before the Tailwind config before the manifest, whose theme_color fills accent when nothing else
// does). A token it finds no name for is left out, for the look or the template to fill; with a bgA but no bgB, bgB
// is bgA. Fonts: the family of each role that has a local file. Logo: the top-ranked
// file, for both grounds.
//
// --brand <file> also writes the draft there (usually brand.json in the project root), with its paths relative to
// that file's folder. It refuses to overwrite a file, and leaves out any file outside that folder (a kit names
// files inside its own folder). Without --brand it writes nothing. Paths resolve against the piece (this tool's
// parent folder), like render.mjs. Exit 2 on a usage error, 1 when it refuses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKENS, ROLES, normHex, brandProblems } from '../looks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class ScanError extends Error {}
class UsageError extends Error {}

// Dependency and build folders, never read. Hidden folders are skipped too, except .github (logos, screenshots).
export const SKIP_DIRS = ['node_modules', 'bower_components', 'jspm_packages', 'vendor', 'venv', '.venv', 'env',
  '__pycache__', 'site-packages', '.tox', 'target', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  '.output', '.vercel', '.netlify', 'coverage', '.git', '.cache', '.turbo', '.parcel-cache', '.gradle', 'Pods',
  'DerivedData'];
const LIMITS = { files: 50000, depth: 16, textBytes: 1 << 20, colors: 500 };
const CSS_EXT = new Set(['.css', '.scss', '.sass', '.less', '.pcss', '.postcss', '.styl']);
const PAGE_EXT = new Set(['.html', '.htm', '.vue', '.svelte', '.astro']);
const IMAGE_EXT = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.avif']);
const TAILWIND_RE = /^tailwind\.config\.(js|cjs|mjs|ts|cts|mts)$/;
const isManifest = (name) => name === 'manifest.json' || name.endsWith('.webmanifest');

// ---------------------------------------------------------------- files
// Every file under root, sorted, without the skipped folders (recorded in `skipped`) and without following links.
export function listFiles(root) {
  const files = [], skipped = [];
  const walk = (dir, rel, depth) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name), r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (SKIP_DIRS.includes(name) || (name.startsWith('.') && name !== '.github')) { skipped.push(r); continue; }
        if (depth < LIMITS.depth) walk(abs, r, depth + 1);
      } else if (st.isFile() && files.length < LIMITS.files) files.push({ rel: r, abs, size: st.size });
    }
  };
  walk(root, '', 0);
  return { files, skipped };
}
const readText = (f) => (f.size <= LIMITS.textBytes ? fs.readFileSync(f.abs, 'utf8') : '');
// The 1-based line of index i in text (the line starts of the last text are kept, so many lookups stay cheap).
let _lt = null, _ls = null;
export function lineAt(text, i) {
  if (text !== _lt) { _lt = text; _ls = [0]; for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) _ls.push(k + 1); }
  let lo = 0, hi = _ls.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (_ls[m] <= i) lo = m; else hi = m - 1; }
  return lo + 1;
}
// Comments blanked out, keeping every newline, so indexes and lines stay where they were.
const blank = (m) => m.replace(/[^\n]/g, ' ');
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank);
const words = (s) => String(s).replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// ---------------------------------------------------------------- colours
const clamp255 = (x) => Math.max(0, Math.min(255, Math.round(x)));
const hex3 = (r, g, b) => '#' + [r, g, b].map((x) => clamp255(x).toString(16).padStart(2, '0')).join('').toUpperCase();
const chan = (s) => (s.endsWith('%') ? (parseFloat(s) * 255) / 100 : parseFloat(s));
const alphaOf = (s) => (s == null ? 1 : s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s));
// A CSS colour value -> { hex: '#RRGGBB', alpha }, or null: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(),
// oklch(). Named colours and anything else are not colours here.
export function parseColor(value) {
  const v = String(value).trim().replace(/\s*!important$/i, '').replace(/["'>]+$/, '').trim();
  let m = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return { hex: normHex('#' + h.slice(0, 6)), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const num = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)';
  m = v.match(new RegExp(`^rgba?\\(\\s*(${num}%?)[\\s,]+(${num}%?)[\\s,]+(${num}%?)(?:\\s*[,/]\\s*(${num}%?))?\\s*\\)$`, 'i'));
  if (m) return { hex: hex3(chan(m[1]), chan(m[2]), chan(m[3])), alpha: alphaOf(m[4]) };
  m = v.match(new RegExp(`^hsla?\\(\\s*(${num})(?:deg)?[\\s,]+(${num})%[\\s,]+(${num})%(?:\\s*[,/]\\s*(${num}%?))?\\s*\\)$`, 'i'));
  if (m) {
    const h = ((+m[1] % 360) + 360) % 360, s = +m[2] / 100, l = +m[3] / 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { hex: hex3(f(0) * 255, f(8) * 255, f(4) * 255), alpha: alphaOf(m[4]) };
  }
  m = v.match(new RegExp(`^oklch\\(\\s*(${num}%?)\\s+(${num}%?)\\s+(${num})(?:deg)?(?:\\s*/\\s*(${num}%?))?\\s*\\)$`, 'i'));
  if (m) {
    const L = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : +m[1], C = m[2].endsWith('%') ? (parseFloat(m[2]) / 100) * 0.4 : +m[2];
    const hr = (+m[3] * Math.PI) / 180, A = C * Math.cos(hr), B = C * Math.sin(hr);
    const l_ = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m_ = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s_ = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
    const g = (x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);
    return { hex: hex3(g(lin[0]), g(lin[1]), g(lin[2])), alpha: alphaOf(m[4]) };
  }
  return null;
}

// Custom property declarations (--name: value) in a stylesheet or page: [{ name, value, file, line }].
export function customProps(text, file) {
  const s = stripCss(text), out = [];
  for (const m of s.matchAll(/(^|[\s{;"'])(--[A-Za-z0-9_-]+)\s*:\s*([^;{}\n]+)/g)) {
    let v = m[3];
    for (const q of ['"', "'"]) if ((v.split(q).length - 1) % 2) v = v.slice(0, v.lastIndexOf(q));   // a style="..." attribute's closing quote
    out.push({ name: m[2], value: v.trim(), file, line: lineAt(s, m.index + m[1].length) });
  }
  return out;
}
// The colours among custom properties, with var() aliases followed (up to five steps) to the property they name, or
// to their fallback (var(--x, #hex)) when --x is not declared.
export function cssColors(props) {
  const first = new Map();
  for (const p of props) if (!first.has(p.name)) first.set(p.name, p);
  const out = [];
  for (const p of props) {
    let c = parseColor(p.value), via = null, cur = p;
    for (let k = 0; !c && k < 5; k++) {
      const m = cur.value.match(/^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]+))?\)$/);
      if (!m) break;
      const next = first.get(m[1]);
      if (next) { cur = next; c = parseColor(cur.value); via = { name: cur.name, file: cur.file, line: cur.line }; continue; }
      if (m[2] == null) break;
      // --x is not declared anywhere: var(--x, <fallback>) is its fallback
      cur = { ...cur, value: m[2].trim() }; c = parseColor(cur.value); via = { name: m[1], fallback: cur.value };
    }
    if (c) out.push({ name: p.name, value: p.value, hex: c.hex, ...(c.alpha < 1 ? { alpha: +c.alpha.toFixed(3) } : {}), kind: 'css', file: p.file, line: p.line, ...(via ? { via } : {}) });
  }
  return out;
}

// A Tailwind config's colours, read as text (the config is never run): every string value under a `colors` key
// (theme.colors or theme.extend.colors), named by its path (brand.500 -> brand-500; DEFAULT is dropped).
export function tailwindColors(text, file) {
  const s = text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, a) => a + blank(m.slice(a.length)));
  const out = [];
  for (const start of s.matchAll(/\bcolors\s*:\s*\{/g)) {
    const toks = [];
    const re = /\s+|(["'`])((?:\\.|(?!\1)[^\\\n])*)\1|([A-Za-z_$][\w$]*|\d+(?:\.\d+)?)|([{}():,[\]])|(\.\.\.)|./gy;
    re.lastIndex = start.index + start[0].length - 1;
    let depth = 0, m;
    while ((m = re.exec(s))) {
      if (m[0].trim() === '') continue;
      const t = m[1] ? { k: 'str', v: m[2], i: m.index } : m[3] ? { k: 'id', v: m[3], i: m.index } : { k: m[0], i: m.index };
      toks.push(t);
      if (t.k === '{') depth++;
      if (t.k === '}' && --depth === 0) break;
    }
    const pathStack = [];
    let key = null, wantKey = true;
    for (let i = 1; i < toks.length; i++) {
      const t = toks[i];
      if (t.k === '{') { pathStack.push(key); key = null; wantKey = true; continue; }
      if (t.k === '}') { pathStack.pop(); key = null; wantKey = true; continue; }
      if (t.k === ',') { key = null; wantKey = true; continue; }
      if (t.k === ':') { wantKey = false; continue; }
      if (t.k === '(' || t.k === '[') {   // a call or a list as a value: skip it
        let d = 0;
        for (; i < toks.length; i++) { if (toks[i].k === '(' || toks[i].k === '[') d++; if (toks[i].k === ')' || toks[i].k === ']') d--; if (d === 0) break; }
        continue;
      }
      if (wantKey && (t.k === 'id' || t.k === 'str')) { key = t.v; continue; }
      if (!wantKey && t.k === 'str' && key != null && [',', '}'].includes((toks[i + 1] || {}).k)) {
        const c = parseColor(t.v);
        if (c) {
          const name = [...pathStack.filter((x) => x != null), key].filter((x) => x !== 'DEFAULT').join('-');
          out.push({ name, value: t.v, hex: c.hex, ...(c.alpha < 1 ? { alpha: +c.alpha.toFixed(3) } : {}), kind: 'tailwind', file, line: lineAt(s, t.i) });
        }
      }
    }
  }
  return out;
}

// A web manifest's theme_color: [{ name: 'theme_color', ... }] or [].
export function manifestColors(text, file) {
  let j;
  try { j = JSON.parse(text); } catch { return []; }
  if (!j || typeof j !== 'object' || typeof j.theme_color !== 'string') return [];
  const c = parseColor(j.theme_color), at = text.search(/"theme_color"\s*:/);
  return c ? [{ name: 'theme_color', value: j.theme_color, hex: c.hex, kind: 'manifest', file, line: at >= 0 ? lineAt(text, at) : 1 }] : [];
}

// The names a colour's token is read from (references/launch.md lists every one). A colour whose whole name (after a
// leading -- and color-) is one of a token's exact names wins over one that only holds one of its words, so an earlier
// --highlight never takes the accent from a real --accent; among each kind, the first found.
export const TOKEN_EXACT = {
  bgA: ['bg', 'background'], bgB: ['surface', 'bg-2', 'bg-alt'], ink: ['text', 'fg', 'foreground'],
  muted: ['muted', 'text-muted'], accent: ['accent', 'primary', 'brand'], accent2: ['accent-2', 'secondary'],
};
export const TOKEN_WORDS = {
  bgA: ['bg', 'background', 'canvas', 'page', 'backdrop'], bgB: ['surface', 'panel', 'card', 'elevated', 'raised'],
  ink: ['text', 'fg', 'foreground', 'ink', 'copy'], muted: ['muted', 'subtle', 'dim', 'faint'],
  accent: ['accent', 'primary', 'brand', 'highlight', 'tint'], accent2: ['secondary', 'tertiary', 'link'],
  second: ['alt', '2', 'secondary', 'soft'],   // with a background word: bgB
  never: ['border', 'ring', 'shadow', 'outline', 'divider', 'overlay', 'scrim', 'hover', 'active', 'focus', 'disabled', 'selection', 'on'],
};
export const exactToken = (name) => {
  const n = String(name).toLowerCase().replace(/^--/, '').replace(/^colou?r-/, '');
  return Object.keys(TOKEN_EXACT).find((k) => TOKEN_EXACT[k].includes(n)) || null;
};
// The token a colour's name suggests by its words, or null (see the header).
export function tokenFor(name) {
  const w = words(String(name).replace(/^--/, '')), T = TOKEN_WORDS;
  const has = (...xs) => xs.some((x) => w.includes(x));
  if (has(...T.never)) return null;
  if (w.some((x) => /^\d+$/.test(x) && !['2', '500'].includes(x))) return null;   // a shade of a scale (brand-100), not the colour
  if (has(...T.muted)) return has('bg', 'background', 'surface') ? 'bgB' : 'muted';
  if (has(...T.ink)) return has('secondary') ? 'muted' : 'ink';
  if (has(...T.bgA, ...T.bgB)) return has(...T.bgB, ...T.second) ? 'bgB' : 'bgA';
  if (has(...T.accent)) return has('2', 'alt', 'secondary', 'tertiary') ? 'accent2' : 'accent';
  if (has(...T.accent2)) return 'accent2';
  return null;
}

// ---------------------------------------------------------------- fonts
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|inherit|initial|unset|-apple-system|BlinkMacSystemFont)$/i;
const firstFamily = (v) => {
  for (const part of String(v).split(',')) { const f = part.trim().replace(/^["']|["']$/g, '').trim(); if (f && !GENERIC.test(f) && !/^var\(/.test(f)) return f; }
  return null;
};
const FONT_EXT_RANK = ['.woff2', '.woff', '.ttf', '.otf'];
const isRemote = (u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
// @font-face rules: [{ family, kind: 'font-face', file (local, relative to the project), url (when only remote),
// weight, style, from }]. resolveLocal(fileOfCss, url) finds a local path, or null.
export function fontFaces(text, file, resolveLocal) {
  const s = stripCss(text), out = [];
  for (const m of s.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1], get = (k) => { const x = body.match(new RegExp(`(?:^|[;\\s{])${k}\\s*:\\s*([^;]+)`, 'i')); return x ? x[1].trim() : null; };
    const family = firstFamily(get('font-family') || '');
    if (!family) continue;
    // every src descriptor (a rule often has an .eot one first, for old browsers), then the best local file
    const srcs = [...body.matchAll(/(?:^|[;\s{])src\s*:\s*([^;]+)/gi)].map((x) => x[1]);
    const urls = srcs.flatMap((v) => [...v.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((u) => u[2]));
    const rank = (f) => { const i = FONT_EXT_RANK.indexOf(path.extname(f).toLowerCase()); return i < 0 ? FONT_EXT_RANK.length : i; };
    const local = urls.filter((u) => !isRemote(u)).map((u) => resolveLocal(file, u)).filter(Boolean).sort((a, b) => rank(a) - rank(b));
    out.push({ family, kind: 'font-face', file: local[0] || null, ...(local[0] ? {} : { url: urls[0] || null }),
      weight: get('font-weight') || null, style: get('font-style') || null, from: { file, line: lineAt(s, m.index) } });
  }
  return out;
}
const FONT_HOSTS = /^(?:https?:)?\/\/(fonts\.googleapis\.com|fonts\.bunny\.net|api\.fontshare\.com|use\.typekit\.net)\//i;
// Font links: a <link href> or an @import of a font service's stylesheet. The families come from its URL; it is
// never fetched. [{ family (or null), kind: 'link', url, remote: true, from }].
export function fontLinks(text, file) {
  const s = stripCss(text), out = [];
  const urls = [...s.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi), ...s.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s]+)/gi)];
  for (const m of urls) {
    const url = m[1].replace(/&amp;/g, '&');
    if (!FONT_HOSTS.test(url)) continue;
    const fams = [...url.matchAll(/[?&]family=([^&]+)/g)].flatMap((f) => decodeURIComponent(f[1].replace(/\+/g, ' ')).split('|')).map((f) => f.split(':')[0].trim()).filter(Boolean);
    for (const family of fams.length ? fams : [null]) out.push({ family, kind: 'link', url, remote: true, from: { file, line: lineAt(s, m.index) } });
  }
  return out;
}
const ROLE_WORDS = { display: ['display', 'heading', 'headings', 'head', 'title', 'hero'], body: ['body', 'text', 'base', 'copy', 'sans'], mono: ['mono', 'monospace', 'code'] };
const roleOfWords = (w) => ROLES.find((r) => ROLE_WORDS[r].some((x) => w.includes(x))) || null;
function roleOfSelector(sel) {
  for (const part of sel.split(',')) {
    const last = part.trim().split(/[\s>+~]+/).pop() || '';
    if (/^h[1-3](?![\w-])|\.(title|heading|headline|display|hero)(?![\w-])/i.test(last)) return 'display';
    if (/^(code|pre|kbd|samp)(?![\w-])|\.(mono|code)(?![\w-])/i.test(last)) return 'mono';
    if (/^(html|body|:root|p)(?![\w-])/i.test(last)) return 'body';
  }
  return null;
}
// Where the project gives a family a role: [{ role, family, file, line, why }], in file order.
export function fontRoles(text, file, props) {
  const s = stripCss(text), out = [], vars = new Map();
  for (const p of props) if (!vars.has(p.name)) vars.set(p.name, p.value);
  const resolve = (v) => { for (let k = 0; k < 5; k++) { const m = String(v).trim().match(/^var\(\s*(--[\w-]+)/); if (!m || !vars.has(m[1])) break; v = vars.get(m[1]); } return v; };
  for (const p of props.filter((x) => x.file === file)) {
    const w = words(p.name.replace(/^--/, ''));
    if (!w.includes('font') && !w.includes('family') && !w.includes('ff')) continue;
    const role = roleOfWords(w.filter((x) => x !== 'font' && x !== 'family')), family = firstFamily(resolve(p.value));
    if (role && family) out.push({ role, family, file, line: p.line, why: p.name });
  }
  for (const m of s.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const role = roleOfSelector(m[1].trim()), fam = m[2].match(/(?:^|[;\s])font-family\s*:\s*([^;]+)/i);
    if (!role || !fam) continue;
    const family = firstFamily(resolve(fam[1]));
    if (family) out.push({ role, family, file, line: lineAt(s, m.index + m[0].indexOf(fam[0].trim())), why: m[1].trim().replace(/\s+/g, ' ') });
  }
  return out;
}

// ---------------------------------------------------------------- README and package metadata
const mdText = (s) => String(s).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2').replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
const FEATURE_HEAD = /^(features?|key features|highlights?|why\b.*|what (it|you) .*|what's (in|inside)\b.*)$/i;
const BOILER_HEAD = /^(install(ation|ing)?|getting started|quick ?start|usage|how to use|requirements|prerequisites|licen[cs]e|contributing|contributors?|development|build(ing)?|tests?|testing|changelog|faq|support|credits|acknowledg(e)?ments?|authors?|(table of )?contents|documentation|docs|api|configuration|config|setup|roadmap|security|code of conduct|sponsors?|community|links?|related|see also|examples?|status|badges)$/i;
// Lines inside an HTML block, among the first n: a tag's own lines (one spanning lines too), and every line between an
// element's opening tag and its closing tag; an element left open runs to the next blank line, where Markdown ends an
// HTML block.
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
export function htmlLines(lines, n) {
  const mark = new Array(n).fill(false), text = lines.slice(0, n).join('\n'), open = [];
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) starts.push(k + 1);
  const lineOf = (i) => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= i) k++; return k; };
  const span = (a, b) => { for (let k = lineOf(a); k <= lineOf(b); k++) mark[k] = true; };
  for (const m of text.matchAll(/<(\/?)([A-Za-z][\w-]*)\b[^>]*?(\/?)>/g)) {
    const end = m.index + m[0].length - 1, name = m[2].toLowerCase();
    span(m.index, end);
    if (m[1]) { const k = open.map((o) => o.name).lastIndexOf(name); if (k >= 0) { span(open[k].at, end); open.splice(k); } }
    else if (!m[3] && !VOID_TAGS.has(name)) open.push({ name, at: m.index });
  }
  for (const o of open) for (let k = lineOf(o.at); k < n && lines[k].trim() !== ''; k++) mark[k] = true;
  return mark;
}
const LINK_DEF = /^ {0,3}\[[^\]]+\]:\s*\S/;
// An install command for this package: it names one of the package's names (a version, a range or extras cut off),
// under any heading, or (INSTALL_HEAD) it sits under an Install-like heading; one that names the package wins over one
// that only sits under such a heading. Anything else (a bare npm install in a Development section, another tool's
// npm i -g pnpm, pip install -r requirements.txt) is not, and the command is made from the metadata instead.
export const INSTALL_HEAD = /^(install(ation|ing)?|set ?up|get(ting)? started|quick ?start)\b/i;
export function installsPackage(cmd, names) {
  const want = names.map((n) => String(n).toLowerCase());
  return String(cmd).toLowerCase().split(/\s+/).some((t) => want.includes(t.replace(/^["']|["']$/g, '').replace(/[=<>~!].*$/, '').replace(/\[.*\]$/, '').replace(/(?<=.)@[^/@]*$/, '')));
}
export const INSTALL_RE = /^(?:npm (?:i|install|add)|pnpm (?:add|i|install)|yarn (?:global )?add|bun (?:add|install|i)|npx|pipx? install|pip3 install|uv (?:tool )?(?:add|install)|cargo install|brew install|go install|gem install|composer (?:global )?require|deno install)\b.*|^curl\b.*\|\s*(?:ba)?sh\b.*/;

// The README: its title, first sentence, install command, features and pictures. names are the package's names from its
// metadata, for telling this package's install command from any other.
export function readme(text, file, { names = [] } = {}) {
  const lines = text.replace(/<!--[\s\S]*?-->/g, blank).split('\n'), r = { file };
  // YAML front matter at the very top (--- to --- or ...) is not the README's text: blanked, so lines keep their numbers
  if (/^---\s*$/.test(lines[0] || '')) {
    const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) for (let i = 0; i <= end; i++) lines[i] = '';
  }
  const s = lines.join('\n');
  // fenced code blocks are not prose, headings or lists; their lines are read for an install command
  const inCode = new Array(lines.length).fill(false), blocks = [];
  for (let i = 0, open = null; i < lines.length; i++) {
    const f = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (f && !open) { open = f[1][0]; inCode[i] = true; blocks.push([]); continue; }
    if (open) { inCode[i] = true; if (f && f[1][0] === open) open = null; else blocks[blocks.length - 1].push(i); }
  }
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    if (inCode[i]) continue;
    let m = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/), level = m && m[1].length, text = m && m[2];
    if (!m && i + 1 < lines.length && lines[i].trim() && /^(=+|-+)\s*$/.test(lines[i + 1]) && !inCode[i + 1]) { level = lines[i + 1][0] === '=' ? 1 : 2; text = lines[i]; m = true; }
    if (!m) { const h = lines[i].match(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/i); if (h) { level = +h[1]; text = h[2]; m = true; } }
    if (m && mdText(text)) heads.push({ level, text: mdText(text), line: i + 1 });
  }
  // the title: the first heading, at any level, when only pictures, badges, link-reference definitions ([label]: url) and
  // HTML blocks come before it
  const above = heads[0] ? heads[0].line - 1 : 0, html = htmlLines(lines, above);
  const title = heads[0] && lines.slice(0, above).every((l, i) => !inCode[i] && (html[i] || /^\s*($|<|!\[|\[!\[)/.test(l) || LINK_DEF.test(l))) ? heads[0] : null;
  if (title) r.name = { value: title.text, file, line: title.line };
  // the install command: the first one in a code block (a line ending in \ goes on to the next) that names this package,
  // else the first that sits under an Install-like heading (any heading it is under: ## Installation > ### npm counts)
  const want = [...names, title && title.text].filter(Boolean).map((n) => String(n).toLowerCase());
  // the headings line i sits under: the nearest above it with a level under `level` (any, for a line; a heading's own
  // level, for a heading), then each one above that with a smaller level. The title is the project's name, not a
  // section, so it is never one of them (# Setup Wizard does not make every command an install command)
  const enclosing = (i, level = Infinity) => {
    const out = [];
    for (let k = heads.length - 1, lvl = level; k >= 0; k--) if (heads[k] !== title && heads[k].line - 1 < i && heads[k].level < lvl) { out.push(heads[k]); lvl = heads[k].level; }
    return out;
  };
  let underHeading = null;
  find: for (const b of blocks) {
    for (let k = 0; k < b.length; k++) {
      const at = b[k];
      let cmd = lines[at].trim().replace(/^[$>%]\s+/, '');
      while (cmd.endsWith('\\') && k + 1 < b.length) cmd = cmd.slice(0, -1).trim() + ' ' + lines[b[++k]].trim();
      if (!INSTALL_RE.test(cmd)) continue;
      if (installsPackage(cmd, want)) { r.install = { value: cmd, file, line: at + 1 }; break find; }
      if (!underHeading && enclosing(at).some((h) => INSTALL_HEAD.test(h.text))) underHeading = { value: cmd, file, line: at + 1 };
    }
  }
  if (!r.install && underHeading) r.install = underHeading;
  // the first paragraph of prose after the title: its first sentence
  for (let i = title ? title.line : 0, para = [], at = 0; i <= lines.length; i++) {
    const l = i < lines.length && !inCode[i] ? lines[i].trim() : '';
    const prose = l && !/^(#|!\[|\[!\[|<|\||[-*+] |\d+[.)] |>|=+$|-+$)/.test(l);
    if (prose) { if (!para.length) at = i + 1; para.push(l); continue; }
    if (para.length) {
      const text = mdText(para.join(' ')), first = (text.match(/^.+?[.!?](?=\s|$)/) || [text])[0];
      if (first.length >= 8) { r.sentence = { value: first, file, line: at }; break; }
      para = [];
    }
    if (i < lines.length && /^#{2,}\s/.test(lines[i])) break;   // no prose before the first section
  }
  // features: the list items under feature-like headings, then the other section headings that are not boilerplate
  const feats = [];
  heads.forEach((h, k) => {
    if (h === title || !FEATURE_HEAD.test(h.text)) return;
    const end = k + 1 < heads.length ? heads.slice(k + 1).find((x) => x.level <= h.level)?.line ?? lines.length + 1 : lines.length + 1;
    for (let i = h.line; i < end - 1; i++) {
      const li = !inCode[i] && lines[i].match(/^\s?(?:[-*+]|\d+[.)])\s+(.+)$/);
      if (li && mdText(li[1])) feats.push({ text: mdText(li[1]), kind: 'item', file, line: i + 1 });
    }
  });
  for (const h of heads) {
    if (h === title || h.level < 2 || h.level > 3 || FEATURE_HEAD.test(h.text) || BOILER_HEAD.test(h.text)) continue;
    // a heading inside a boilerplate or Install-like section (## Installation > ### npm) is not a feature either
    if (enclosing(h.line - 1, h.level).some((x) => BOILER_HEAD.test(x.text) || INSTALL_HEAD.test(x.text))) continue;
    feats.push({ text: h.text, kind: 'heading', file, line: h.line });
  }
  r.features = feats;
  r.images = [...s.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)|<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => ({ src: m[1] || m[2], line: lineAt(s, m.index) }));
  return r;
}
// package.json, pyproject.toml, Cargo.toml in the project root: { name, description, install } with lines.
export function packageMeta(root, has) {
  const out = {};
  const at = (text, re) => { const m = text.match(re); return m ? { value: m[1], line: lineAt(text, m.index) } : null; };
  if (has('package.json')) {
    const text = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    let j = null;
    try { j = JSON.parse(text); } catch { /* not JSON: skip it */ }
    if (j && typeof j === 'object') {
      const name = typeof j.name === 'string' && at(text, /"name"\s*:\s*"([^"]+)"/), desc = typeof j.description === 'string' && at(text, /"description"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (name) { out.name = { value: j.name, file: 'package.json', line: name.line }; out.install = { value: `npm install ${j.bin ? '-g ' : ''}${j.name}`, file: 'package.json', line: name.line, derived: true }; }
      if (desc && j.description.trim()) out.description = { value: j.description.trim(), file: 'package.json', line: desc.line };
    }
  }
  for (const [file, sections, cmd] of [['pyproject.toml', ['project', 'tool.poetry'], (n) => `pip install ${n}`], ['Cargo.toml', ['package'], (n) => (has('src/main.rs') ? `cargo install ${n}` : `cargo add ${n}`)]]) {
    if (!has(file) || out.name) continue;
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const sec of sections) {
      const head = text.match(new RegExp(`^\\[${sec.replace('.', '\\.')}\\]\\s*$`, 'm'));
      if (!head) continue;
      const start = head.index + head[0].length, rest = text.slice(start), stop = rest.search(/^\[/m), body = stop >= 0 ? rest.slice(0, stop) : rest;
      const field = (k) => { const m = body.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm')); return m ? { value: m[1], file, line: lineAt(text, start + m.index) } : null; };
      const name = field('name'), desc = field('description');
      if (name) { out.name = name; out.install = { value: cmd(name.value), file, line: name.line, derived: true }; }
      if (desc && desc.value.trim() && !out.description) out.description = desc;
      if (name) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- logos and screenshots
const LOGO_WORDS = { logo: 40, logotype: 40, wordmark: 35, emblem: 20, brand: 20, mark: 20, icon: 15, favicon: 10, symbol: 10 };
const SHOT_WORDS = ['screenshot', 'screenshots', 'screen', 'screens', 'demo', 'preview', 'capture', 'shot', 'shots'];
const BRAND_DIRS = ['assets', 'public', 'static', 'img', 'images', 'media', 'brand', 'branding', 'logo', 'logos', 'docs', '.github', 'art', 'design', 'resources'];
const FORMAT_SCORE = { '.svg': 20, '.png': 10, '.webp': 8, '.avif': 6, '.jpg': 2, '.jpeg': 2, '.gif': 0, '.ico': -5 };
// Ranks image files as logo candidates: name (the project's), readmeFirst (the README's first local picture), icons
// (files a page links as its icon, or a manifest lists).
export function rankLogos(images, { name = null, readmeFirst = null, icons = new Set() } = {}) {
  const nameWords = name ? words(name) : [];
  const out = [];
  for (const f of images) {
    const ext = path.extname(f).toLowerCase(), parts = f.split('/'), w = words(path.basename(f, ext)), why = [];
    let score = 0, signal = false;
    const lw = Math.max(0, ...w.map((x) => LOGO_WORDS[x] || 0));
    if (lw) { score += lw; signal = true; why.push(`named ${w.find((x) => LOGO_WORDS[x] === lw)}`); }
    if (nameWords.length && nameWords.every((x) => w.includes(x))) { score += 15; signal = true; why.push('named after the project'); }
    if (f === readmeFirst) { score += 30; signal = true; why.push('the README\'s first picture'); }
    if (icons.has(f)) { score += 10; signal = true; why.push('the page\'s or the manifest\'s icon'); }
    if (!signal) continue;
    score += FORMAT_SCORE[ext] ?? 0; why.push(ext.slice(1));
    if (parts.length === 1) { score += 10; why.push('in the root'); } else if (BRAND_DIRS.includes(parts[0].toLowerCase())) { score += 8; why.push(`in ${parts[0]}/`); }
    if (parts.length > 3) { score -= 3 * (parts.length - 3); why.push(`${parts.length - 1} folders deep`); }
    if (!lw && SHOT_WORDS.some((x) => w.includes(x) || parts.slice(0, -1).map((p) => p.toLowerCase()).includes(x))) { score -= 40; why.push('looks like a screenshot'); }
    out.push({ file: f, score, why });
  }
  return out.sort((a, b) => b.score - a.score || (a.file < b.file ? -1 : 1)).slice(0, 10);
}

// ---------------------------------------------------------------- the scan
export function scanRepo(rootArg, { cwd = ROOT, kitDir = null } = {}) {
  const root = path.resolve(cwd, rootArg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`${rootArg}: not a folder`);
  const { files, skipped } = listFiles(root);
  const byRel = new Map(files.map((f) => [f.rel, f])), has = (r) => byRel.has(r);
  const resolveLocal = (fromFile, url) => {
    const u = decodeURIComponent(url.split(/[?#]/)[0]);
    const tries = u.startsWith('/') ? [u.slice(1), `public${u}`, `static${u}`] : [path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), u))];
    return tries.find((t) => !t.startsWith('..') && has(t)) || null;
  };

  const props = [], colors = { css: [], tailwind: [], manifest: [] }, fonts = [], roles = [], icons = new Set();
  const styleFiles = files.filter((f) => CSS_EXT.has(path.extname(f.rel).toLowerCase()) || PAGE_EXT.has(path.extname(f.rel).toLowerCase()));
  const texts = new Map(styleFiles.map((f) => [f.rel, readText(f)]));
  for (const f of styleFiles) props.push(...customProps(texts.get(f.rel), f.rel));
  colors.css = cssColors(props);
  for (const f of styleFiles) {
    const t = texts.get(f.rel);
    fonts.push(...fontFaces(t, f.rel, resolveLocal), ...fontLinks(t, f.rel));
    roles.push(...fontRoles(t, f.rel, props));
    if (PAGE_EXT.has(path.extname(f.rel).toLowerCase())) {
      for (const m of t.matchAll(/<link\b[^>]*>/gi)) {
        const rel = m[0].match(/\brel\s*=\s*["']([^"']+)["']/i), href = m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
        if (rel && href && /\bicon\b/i.test(rel[1]) && !isRemote(href[1])) { const l = resolveLocal(f.rel, href[1]); if (l) icons.add(l); }
      }
    }
  }
  for (const f of files) {
    const base = path.basename(f.rel);
    if (TAILWIND_RE.test(base)) colors.tailwind.push(...tailwindColors(readText(f), f.rel));
    if (isManifest(base)) {
      const t = readText(f);
      colors.manifest.push(...manifestColors(t, f.rel));
      try { for (const ic of JSON.parse(t).icons || []) { const l = ic && typeof ic.src === 'string' && !isRemote(ic.src) && resolveLocal(f.rel, ic.src); if (l) icons.add(l); } } catch { /* not JSON */ }
    }
  }
  const allColors = [...colors.css, ...colors.tailwind, ...colors.manifest].slice(0, LIMITS.colors);
  // every family's roles, from the first evidence of each role
  for (const f of fonts) f.roles = [...new Set(roles.filter((r) => r.family.toLowerCase() === String(f.family).toLowerCase()).map((r) => r.role))];

  const rd = ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README.rst', 'README.txt', 'README'].find(has);
  const meta = packageMeta(root, has);
  const R = rd ? readme(readText(byRel.get(rd)), rd, { names: meta.name ? [meta.name.value] : [] }) : { features: [], images: [] };
  const name = R.name || meta.name || { value: path.basename(root), file: null, line: null };
  const readmeRefs = R.images.filter((im) => !isRemote(im.src)).map((im) => resolveLocal(rd, im.src)).filter(Boolean);
  const images = files.map((f) => f.rel).filter((r) => IMAGE_EXT.has(path.extname(r).toLowerCase()));
  const logos = rankLogos(images, { name: name.value, readmeFirst: readmeRefs[0] || null, icons });
  const top = logos[0] && logos[0].file;
  const screenshots = images.filter((r) => {
    const w = words(path.basename(r, path.extname(r))), dirs = r.split('/').slice(0, -1).map((p) => p.toLowerCase());
    return r !== top && (SHOT_WORDS.some((x) => w.includes(x) || dirs.includes(x)) || (readmeRefs.includes(r) && !w.some((x) => LOGO_WORDS[x])));
  }).map((r) => ({ file: r, ...(readmeRefs.includes(r) ? { readme: true } : {}) }));

  const scan = {
    root: rootArg,
    name,
    pitch: meta.description || R.sentence || null,
    install: R.install || meta.install || null,
    features: R.features.slice(0, 20),
    colors: allColors,
    fonts,
    logos,
    screenshots,
    skipped,
  };
  scan.brand = draftBrand(scan, path.resolve(cwd, kitDir || rootArg), root);
  return scan;
}

// The draft brand.json from a scan, its paths relative to kitDir: { kit, from, notes }.
export function draftBrand(scan, kitDir, root) {
  const kit = { name: scan.name.value }, from = { name: scan.name.file ? `${scan.name.file}:${scan.name.line}` : 'the folder\'s name' }, notes = [];
  const colors = {};
  // exact names first, then the names that only hold a token's word
  for (const read of [exactToken, tokenFor]) {
    for (const c of scan.colors) {
      if (c.alpha != null && c.alpha < 1) continue;
      const tok = c.kind === 'manifest' ? null : read(c.name);
      if (tok && !colors[tok]) { colors[tok] = c.hex; from[`colors.${tok}`] = `${c.file}:${c.line} ${c.name}`; }
    }
  }
  const theme = scan.colors.find((c) => c.kind === 'manifest');
  if (!colors.accent && theme) { colors.accent = theme.hex; from['colors.accent'] = `${theme.file}:${theme.line} theme_color`; }
  if (colors.bgA && !colors.bgB) { colors.bgB = colors.bgA; from['colors.bgB'] = `${from['colors.bgA']} (no second background found: the same as bgA)`; }
  const missing = TOKENS.filter((k) => !colors[k]);
  if (missing.length) notes.push(`no colour named for ${missing.join(', ')}: the look or the template fills ${missing.length > 1 ? 'them' : 'it'}`);
  if (Object.keys(colors).length) kit.colors = Object.fromEntries(TOKENS.filter((k) => colors[k]).map((k) => [k, colors[k]]));
  const rel = (f) => {
    const r = path.relative(kitDir, path.join(root, f)).split(path.sep).join('/');
    return r.startsWith('..') || path.isAbsolute(r) ? null : r;
  };
  const fonts = {};
  for (const role of ROLES) {
    const f = scan.fonts.find((x) => x.roles && x.roles.includes(role) && x.file) || null;
    const any = scan.fonts.find((x) => x.roles && x.roles.includes(role));
    if (!f) { if (any) notes.push(`fonts.${role}: ${any.family} has no file in the project (${any.kind === 'link' ? 'a font service link' : 'no local src'}): add a file its licence allows, or leave the role to the look`); continue; }
    const p = rel(f.file);
    if (!p) { notes.push(`fonts.${role}: ${f.file} is outside the kit's folder: write the kit in the project root`); continue; }
    const one = { family: f.family, file: p };
    if (brandProblems({ name: 'x', fonts: { [role]: one } }).length) { notes.push(`fonts.${role}: "${f.family}" cannot be a kit family (${brandProblems({ name: 'x', fonts: { [role]: one } })[0]})`); continue; }
    fonts[role] = one; from[`fonts.${role}`] = `${f.from.file}:${f.from.line} @font-face`;
  }
  if (Object.keys(fonts).length) kit.fonts = fonts;
  if (scan.logos.length) {
    const p = rel(scan.logos[0].file);
    if (p) {
      kit.logo = { onDark: p, onLight: p }; from.logo = `${scan.logos[0].file} (the top-ranked candidate)`;
      notes.push('logo: the top-ranked file for both grounds; if the project has a version for dark or for light grounds, set onDark and onLight by hand');
    } else notes.push(`logo: ${scan.logos[0].file} is outside the kit's folder: write the kit in the project root`);
  } else notes.push('logo: no image looks like a logo');
  const probs = brandProblems(kit);
  if (probs.length) throw new ScanError(`the draft kit does not pass brand.json's rules: ${probs.join('; ')}`);
  return { kit, from, notes };
}

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!a.startsWith('--')) { o._.push(a); continue; }
    if (a !== '--brand') throw new UsageError(`unknown option ${a}`);
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new UsageError('--brand needs a file');
    if (o.brand) throw new UsageError('--brand given twice');
    o.brand = argv[++i];
  }
  return o;
}
export function runScan(argv, { cwd = ROOT, log = console.log, err = console.error } = {}) {
  const o = parseArgs(argv);
  if (o.help) { log('usage: node tools/repo-scan.mjs <project folder> [--brand <file>]  (see the header)'); return null; }
  if (o._.length !== 1) throw new UsageError('give the project folder: node tools/repo-scan.mjs <folder> [--brand brand.json]');
  const kitFile = o.brand ? path.resolve(cwd, o.brand) : null;
  if (kitFile && fs.existsSync(kitFile)) throw new ScanError(`${o.brand} exists: the scan never overwrites a kit (move it, or name another file)`);
  const scan = scanRepo(o._[0], { cwd, kitDir: kitFile ? path.dirname(kitFile) : null });
  log(JSON.stringify(scan, null, 2));
  if (kitFile) {
    fs.mkdirSync(path.dirname(kitFile), { recursive: true });
    fs.writeFileSync(kitFile, JSON.stringify(scan.brand.kit, null, 2) + '\n', { flag: 'wx' });
    err(`repo-scan: wrote the draft kit ${o.brand}: show it to the person before using it`);
    for (const n of scan.brand.notes) err(`  note: ${n}`);
  }
  return scan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runScan(process.argv.slice(2), { cwd: ROOT });
  } catch (e) {
    if (e instanceof UsageError) { console.error(`repo-scan: ${e.message}`); process.exitCode = 2; }
    else if (e instanceof ScanError) { console.error(`repo-scan: refused: ${e.message}`); process.exitCode = 1; }
    else throw e;
  }
}
