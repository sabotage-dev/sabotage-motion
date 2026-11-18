// fixture-energy (plan 23.9, energy_match): the calibration fixtures, each with its ground truth built in. One scene,
// the fixture picked with --param kind=<name>; nothing here is a real piece.
//   cards: two textured cards, A (dark blue) and B (red), so a cut between them changes nearly every pixel
//   hardcut  A for 1 s, then B: one hard cut at 1.0 s; declare=lead declares one at 0.1 s too (no shot before it)
//   wipe     B wipes over A from left to right, 0.9-1.2 s (declared d 0.3)
//   whip     A whips out to the left as B whips in from the right, 0.9-1.15 s (declared d 0.25)
//   shake    A shakes (up to 24 px each way) 0.9-1.25 s; declare=1 declares a cut at 1.0 s
//   flash    A with one full-frame white frame at 1.0 s; declare=1 declares it as a cut, declare=2 as two (in and out)
//   drift    A drifting right at 12 px a second; static: A, still. declare=1 declares a cut at 1.0 s (none happens)
//   abab     A and B alternating every half beat at 136 BPM (60 / 136 / 2 s), 15 shots, 14 hard cuts
//   small    a three-line block of small type, each line's ink 3% of the frame height, one box around the block
//   bigbox   one line whose ink is 5% of the frame height, in a box that claims 30%
//   punch    one line whose ink is 12% of the frame height; the camera punches in to 1.5x at 0.8-1.0 s and holds
//   stroke=1 (with any kind that draws a line) outlines it with strokeText (4 px) instead of filling it
//   badcuts  A, declaring a 0.5 s transition (longer than cuts() allows)
//   cached   the line of `bigbox`, drawn from an image made in init (no fillText while frames draw): no ink
//   layer    A, and from 1.0 s a B panel over its lower `area` of the frame (default 0.25): a swapped layer, declared as a cut
//   dim      A, and from 1.0 s A in a colour `step`/255 lighter (default 24): a low-contrast change, declared as a cut
//   angle    A, and from 1.0 s A at 1.3x (a new angle on the same card), declared as a cut
//   swap     A with a large word (ink 25% of the frame height) that changes at 1.0 s, declared as a cut: copy, not a cut
//   push     A pushed in slowly (1.0x to 1.06x over the piece): the template's kind of push
//   late     A, still until 1.5 s, then the band of `pace` (band 0.3) scrolling; hold=1 exports HOLDS [[0, 1.5]]
//   pace     A and B alternating every `shot` s (hard cuts), a line whose ink is `size` of the frame height, and a band
//            of stripes covering `band` of the frame scrolling 8 px a frame (about half its pixels change each frame)
// Ground truth: the type is sized from measureText's ink bounds, so a line's ink height is what the kind says.
console.log('fixture: fixture-energy energy.js evaluated');

// --param w and h set the size (read here, since the harness sizes the canvas before init); 720x1280 by default
const Q = new URLSearchParams(globalThis.location ? location.search : '');
export const CFG = { W: +(Q.get('p.w') || 720), H: +(Q.get('p.h') || 1280), FPS: 30, DUR: 2.0, FONTS: ['DISPLAY'] };
export const HOLDS = Q.get('p.hold') === '1' ? [[0, 1.5]] : undefined;
export const silent = true;

let ctx, P, K, S = 1, IMG = null;
const BEAT = 60 / 136 / 2;
const num = (k, d) => (P[k] != null && P[k] !== '' ? Number(P[k]) : d);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const TYPE = {};   // per line: { text, fs, asc, desc } sized so the line's ink is its share of the frame height

function fit(text, share) {
  ctx.font = '100px DISPLAY';
  const m = ctx.measureText(text), ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const fs = (100 * share * CFG.H) / ink;
  return { text, fs, asc: (m.actualBoundingBoxAscent * fs) / 100, desc: (m.actualBoundingBoxDescent * fs) / 100, w: (m.width * fs) / 100 };
}

export async function init({ ctx: c, scale, params }) {
  ctx = c; P = params; K = params.kind || 'static'; S = scale;
  if (K === 'abab') CFG.DUR = 15 * BEAT;
  if (K === 'pace') CFG.DUR = num('dur', 4);
  if (K === 'small') TYPE.lines = ['Small type set', 'in three lines', 'reads as small'].map((s) => fit(s, 0.03));
  if (K === 'bigbox' || K === 'cached') TYPE.line = fit('Big claim', 0.05);
  if (K === 'punch') TYPE.line = fit('GO', 0.12);
  if (K === 'pace') TYPE.line = fit('PACE', num('size', 0.1));
  if (K === 'swap') { TYPE.a = fit('NOW', 0.25); TYPE.b = fit('WOW', 0.25); }
  if (K === 'cached') {
    IMG = document.createElement('canvas'); IMG.width = c.canvas.width; IMG.height = c.canvas.height;
    const g = IMG.getContext('2d'), L = TYPE.line;
    g.setTransform(S, 0, 0, S, 0, 0); g.fillStyle = '#f4f1de'; g.font = `${L.fs}px DISPLAY`; g.textAlign = 'center';
    g.fillText(L.text, CFG.W / 2, CFG.H / 2 + (L.asc - L.desc) / 2);
  }
}

// A textured card: a flat colour with rings of discs, offset by (dx, dy).
function card(k, dx = 0, dy = 0) {
  const [bg, fg] = k ? ['#c1121f', '#fdf0d5'] : ['#14213d', '#8ecae6'];
  ctx.fillStyle = bg; ctx.fillRect(-60, -60, CFG.W + 120, CFG.H + 120);
  ctx.fillStyle = fg;
  for (let j = -1; j < 12; j++) for (let i = -1; i < 7; i++) {
    ctx.beginPath(); ctx.arc(60 + i * 110 + dx + (j % 2) * 55, 60 + j * 110 + dy, 22 + 10 * hash(i * 13 + j), 0, Math.PI * 2); ctx.fill();
  }
}
function line(L, x = CFG.W / 2, cy = CFG.H / 2) {   // a line centred on (x, cy), its ink centred too
  ctx.font = `${L.fs}px DISPLAY`; ctx.fillStyle = '#f4f1de'; ctx.strokeStyle = '#f4f1de'; ctx.lineWidth = 4; ctx.textAlign = 'center';
  if (P.stroke === '1') ctx.strokeText(L.text, x, cy + (L.asc - L.desc) / 2); else ctx.fillText(L.text, x, cy + (L.asc - L.desc) / 2);
  ctx.textAlign = 'left';
}

export function frame(t, jit) {
  let cam = [1, 0, 0, 0];
  const c = ctx;
  switch (K) {
    case 'hardcut': card(t >= 1 ? 1 : 0); break;
    case 'wipe': {
      card(0);
      const x = CFG.W * smooth(prog(t, 0.9, 1.2));
      c.save(); c.beginPath(); c.rect(0, 0, x, CFG.H); c.clip(); card(1); c.restore();
      break;
    }
    case 'whip': {
      const u = smooth(prog(t, 0.9, 1.15));
      if (u < 1) card(0, -u * CFG.W * 1.2);
      if (u > 0) { c.save(); c.beginPath(); c.rect((1 - u) * CFG.W, 0, CFG.W, CFG.H); c.clip(); card(1, (1 - u) * CFG.W * 1.2); c.restore(); }
      break;
    }
    case 'shake': {
      const on = t >= 0.9 && t < 1.25, k = Math.floor(t * 60);
      card(0, on ? (hash(k) - 0.5) * 48 : 0, on ? (hash(k + 99) - 0.5) * 48 : 0);
      break;
    }
    case 'flash':
      card(0);
      if (t >= 1.0 && t < 1.0 + 1 / CFG.FPS) { c.fillStyle = '#ffffff'; c.fillRect(0, 0, CFG.W, CFG.H); }
      break;
    case 'drift': card(0, 12 * t); break;
    case 'layer':
      card(0);
      if (t >= 1) { c.save(); c.beginPath(); c.rect(0, CFG.H * (1 - num('area', 0.25)), CFG.W, CFG.H); c.clip(); card(1); c.restore(); }
      break;
    case 'dim': {
      const v = t >= 1 ? num('step', 24) : 0;
      c.fillStyle = `rgb(${20 + v},${33 + v},${61 + v})`; c.fillRect(0, 0, CFG.W, CFG.H);
      c.fillStyle = `rgb(${142 + v},${202 + v},${230 + v})`;
      for (let j = -1; j < 12; j++) for (let i = -1; i < 7; i++) { c.beginPath(); c.arc(60 + i * 110 + (j % 2) * 55, 60 + j * 110, 22 + 10 * hash(i * 13 + j), 0, Math.PI * 2); c.fill(); }
      break;
    }
    case 'angle':
      if (t >= 1) { c.save(); c.translate(CFG.W / 2, CFG.H / 2); c.scale(1.3, 1.3); c.translate(-CFG.W / 2, -CFG.H / 2); card(0); c.restore(); } else card(0);
      break;
    case 'swap': card(0); line(t >= 1 ? TYPE.b : TYPE.a); break;
    case 'push': card(0); cam = [1 + 0.06 * t / CFG.DUR, 0, 0, 0]; break;
    case 'abab': card(Math.floor(t / BEAT + 1e-9) % 2); break;
    case 'small': {
      c.fillStyle = '#14213d'; c.fillRect(0, 0, CFG.W, CFG.H);
      TYPE.lines.forEach((L, i) => line(L, CFG.W / 2, CFG.H * 0.42 + i * L.fs * 0.95));
      break;
    }
    case 'bigbox': case 'punch':
      c.fillStyle = '#14213d'; c.fillRect(0, 0, CFG.W, CFG.H);
      line(TYPE.line);
      if (K === 'punch') cam = [1 + 0.5 * smooth(prog(t, 0.8, 1.0)), 0, 0, 0];
      break;
    case 'cached':
      c.fillStyle = '#14213d'; c.fillRect(0, 0, CFG.W, CFG.H);
      c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(IMG, 0, 0); c.setTransform(S, 0, 0, S, 0, 0);
      break;
    case 'late': case 'pace': {
      const late = K === 'late', shot = late ? 99 : num('shot', 1), band = late ? (t >= 1.5 ? 0.3 : 0) : num('band', 0.1);
      card(Math.floor(t / shot + 1e-9) % 2);
      const bh = band * CFG.H, off = (t * CFG.FPS * 8) % 32;
      c.fillStyle = '#000000'; c.fillRect(0, CFG.H * 0.8 - bh / 2, CFG.W, bh);
      c.fillStyle = '#ffffff';
      for (let x = -32 + off; x < CFG.W; x += 32) c.fillRect(x, CFG.H * 0.8 - bh / 2, 16, bh);
      if (!late) line(TYPE.line, CFG.W / 2, CFG.H * 0.35);
      break;
    }
    default: card(0);
  }
  return { t, jit, use2D: true, scene: 0, cam, clear: [0, 0, 0] };
}

export function cuts() {
  const d = P.declare;
  switch (K) {
    case 'hardcut': return d === 'lead' ? [{ t: 0.1, d: 0 }, { t: 1, d: 0 }] : [{ t: 1, d: 0 }];
    case 'wipe': return [{ t: 0.9, d: 0.3 }];
    case 'whip': return [{ t: 0.9, d: 0.25 }];
    case 'shake': case 'drift': case 'static': return d === '1' ? [{ t: 1, d: 0 }] : [];
    case 'layer': case 'dim': case 'angle': case 'swap': return [{ t: 1, d: 0 }];
    case 'badcuts': return [{ t: 1, d: 0.5 }];
    case 'flash': return d === '1' ? [{ t: 1, d: 0 }] : d === '2' ? [{ t: 1, d: 0 }, { t: 1 + 1 / CFG.FPS, d: 0 }] : [];
    case 'abab': return Array.from({ length: 14 }, (_, i) => ({ t: (i + 1) * BEAT, d: 0 }));
    case 'pace': { const s = num('shot', 1), out = []; for (let k = 1; k * s < CFG.DUR - 1e-9; k++) out.push({ t: k * s, d: 0 }); return out; }
    default: return [];
  }
}

export function boxes(t) {
  const box = (id, L, x, cy, h = L.asc + L.desc) => ({ id, text: L.text, x: x - L.w / 2, y: cy - h / 2, w: L.w, h });
  switch (K) {
    case 'small': {
      const L = TYPE.lines, top = CFG.H * 0.42 - L[0].fs * 0.5, bottom = CFG.H * 0.42 + 2 * L[0].fs * 0.95 + L[0].fs * 0.5;
      return [{ id: 'block', text: L.map((l) => l.text).join(' '), x: CFG.W / 2 - Math.max(...L.map((l) => l.w)) / 2, y: top, w: Math.max(...L.map((l) => l.w)), h: bottom - top }];
    }
    case 'bigbox': case 'cached': return [box('claim', TYPE.line, CFG.W / 2, CFG.H / 2, 0.30 * CFG.H)];
    case 'punch': return [box('go', TYPE.line, CFG.W / 2, CFG.H / 2)];
    case 'pace': return [box('pace', TYPE.line, CFG.W / 2, CFG.H * 0.35)];
    default: return [];
  }
}

export function post(t) {
  return { t, bloom: num('bloom', 0.18), thr: num('thr', 0.78), ca: 0.0008, glitch: 0, grain: 0.025, vig: 0.12, flash: 0, fade: 1, hud: 0 };
}
