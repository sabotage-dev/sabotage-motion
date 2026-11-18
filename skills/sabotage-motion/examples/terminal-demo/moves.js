// Moves for the energy presets (plan 23.9): a camera rig driven by a hit list, transitions, visual cuts, and kinetic
// type. Every helper is a pure function of t, like the rest of a scene, so any frame renders on its own. The amounts
// come from the piece's energy (energy.js, handed to init as `energy`); the kinds come from its look (a look with
// glitch: false never glitches or flash-frames: glitchCut and flash return nothing on it).
//
//   const R = rig({ W: CFG.W, H: CFG.H, safe, exclude, hits: [{ t: 1.2, kind: 'punch', amp: energy.camera.punch }, ...] });
//   frame(t):  return { ..., cam: R.at(t, boxes(t)) }      the camera, clamped so every text box stays in the safe area
//   const cs = cuts();                                     the scene's declared cuts and transitions, [{ t, d }]
//   const i = shotAt(cs, t);                               which shot t is in (0 before the first cut)
//   slamWords(ctx, words, t, { group, draw: false })       word-by-word slams: one box per word, one shared group
//
// Hits (rig): { t, kind, amp?, d?, seed?, dir?, f? }, picture time t:
//   push    the zoom gains amp over [t, t + d] (swift), and keeps it
//   punch   the zoom jumps by amp at t and settles back over d
//   bounce  the zoom springs by amp at t (a damped oscillation at f Hz, over d)
//   shake   the picture shakes by amp design pixels at t (seeded noise at f Hz), dying out over d
//   whip    the camera whips sideways across [t, t + d]: out of the shot before t + d/2, into the next one after it.
//           A whip belongs on a cut between two beats, with no copy on screen (23.9): the clamp holds any text in the
//           safe area, so a whip over copy is cut down to nothing.
// For every move the rig computes, at each t, the largest share of it (zoom, turn and offset scaled together from no
// camera at all) that keeps each text box, mapped through the camera the way check maps it, inside the target's safe
// area and out of its exclude rectangles, and clamps to it.
import { clamp, prog, lerp, snap, swift, whip as whipEase, anticip, spring, noise1, hash } from './lib.js';

// A design-pixel point (y down) through cam = [zoom, rotation, panX, panY], as the composite shader applies it
// (shaders.js COMP) and check.mjs camPoint measures it: the same function, so the clamp and the check agree.
export function camPoint(x, y, cam, W, H) {
  const [zoom = 1, rot = 0, panX = 0, panY = 0] = cam || [];
  if (zoom === 1 && rot === 0 && panX === 0 && panY === 0) return [x, y];
  const asp = W / H;
  const qx = (x / W - 0.5) * asp + panX, qy = 0.5 - y / H + panY;
  const c = Math.cos(rot), s = Math.sin(rot);
  const ox = zoom * (c * qx - s * qy), oy = zoom * (s * qx + c * qy);
  return [(ox / asp + 0.5) * W, (0.5 - oy) * H];
}
// Whether a box (design px, before the camera) lands inside the safe rectangle and clear of every exclude rectangle.
function boxFits(b, cam, W, H, safe, exclude) {
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => camPoint(x, y, cam, W, H));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), e = 1e-6;
  if (x0 < safe.x - e || y0 < safe.y - e || x1 > safe.x + safe.w + e || y1 > safe.y + safe.h + e) return false;
  for (const r of exclude || []) if (x0 < r.x + r.w && x1 > r.x && y0 < r.y + r.h && y1 > r.y) return false;
  return true;
}
// The largest share s in [0, 1] of a camera move (zoom - 1, turn and offset scaled together) that keeps every box in.
// No camera (s = 0) is the layout itself; a box that is already out there cannot be helped, so it is left out.
export function clampShare(cam, boxes, { W, H, safe, exclude = [] }) {
  const bs = (boxes || []).filter((b) => !b.deco && b.w > 0 && b.h > 0 && boxFits(b, [1, 0, 0, 0], W, H, safe, exclude));
  if (!bs.length || !safe) return 1;
  const at = (s) => [1 + s * (cam[0] - 1), s * cam[1], s * cam[2], s * cam[3]];
  const fits = (s) => bs.every((b) => boxFits(b, at(s), W, H, safe, exclude));
  if (fits(1)) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  return lo;
}

// The camera rig (23.9). opts: W, H (design size), safe and exclude (the target's, in design px), hits (above), and
// base(t), an optional camera the scene adds under the hits (a slow drift). at(t, boxes) is the clamped camera; raw(t)
// the camera before the clamp.
export function rig({ W, H, safe = null, exclude = [], hits = [], base = null }) {
  const list = hits.map((h) => ({ d: 0.3, amp: 0, ...h })).sort((a, b) => a.t - b.t);
  const raw = (t) => {
    let z = 1, r = 0, px = 0, py = 0;
    if (base) { const c = base(t) || [1, 0, 0, 0]; z = c[0]; r = c[1]; px = c[2]; py = c[3]; }
    for (const h of list) {
      const dt = t - h.t;
      if (dt < 0) break;
      switch (h.kind) {
        case 'push': z *= 1 + h.amp * swift(prog(dt, 0, h.d)); break;
        case 'punch': z *= 1 + h.amp * Math.exp((-4 * dt) / h.d); break;
        case 'bounce': { const f = h.f || 5; z *= 1 + h.amp * Math.sin(Math.PI * 2 * f * dt) * Math.exp((-3 * dt) / h.d) * (dt < h.d * 2 ? 1 : 0); break; }
        case 'shake': {
          if (dt > h.d * 2) break;
          const f = h.f || 7, k = Math.exp((-4 * dt) / h.d), s = (h.seed || 1) * 17.31;
          px += (h.amp / H) * k * noise1(s + dt * f); py += (h.amp / H) * k * noise1(s + 91.7 + dt * f);
          r += 0.004 * (h.amp / 8) * k * noise1(s + 41.3 + dt * f);
          break;
        }
        case 'whip': {
          if (dt > h.d) break;
          const k = dt / h.d, far = (W / H) * 1.2 * (h.dir || 1);
          px += k < 0.5 ? -far * whipEase(k * 2) : far * (1 - whipEase((k - 0.5) * 2));
          break;
        }
        default: throw new Error(`rig: unknown hit kind "${h.kind}" (push, punch, bounce, shake, whip)`);
      }
    }
    return [z, r, px, py];
  };
  return {
    hits: list, raw,
    // the share of the move kept at t: 1 when nothing on screen is pushed out of the safe area
    share: (t, boxes) => (safe ? clampShare(raw(t), boxes, { W, H, safe, exclude }) : 1),
    at(t, boxes = []) {
      const c = raw(t);
      if (!safe) return c;
      const s = clampShare(c, boxes, { W, H, safe, exclude });
      return s >= 1 ? c : [1 + s * (c[0] - 1), s * c[1], s * c[2], s * c[3]];
    },
  };
}

// ---- transitions: each (t, at, d, opts) -> { k, active, ... }, k the progress through [at, at + d] (0 before, 1 after)
const tr = (t, at, d) => ({ k: d > 0 ? prog(t, at, at + d) : t >= at ? 1 : 0, active: t >= at && t < at + d });
// crossfade: the incoming shot's alpha
export const crossfade = (t, at, d) => { const x = tr(t, at, d); return { ...x, a: x.k }; };
// wipe: the incoming shot shows left of x (a share of the width; dir -1 wipes from the right), with a soft edge
export const wipe = (t, at, d, { dir = 1 } = {}) => { const x = tr(t, at, d), e = swift(x.k); return { ...x, edge: dir > 0 ? e : 1 - e, dir }; };
// slide: the outgoing shot moves out by `out` widths and the incoming one in from `inn` widths (dir -1: the other way)
export const slide = (t, at, d, { dir = 1 } = {}) => { const x = tr(t, at, d), e = swift(x.k); return { ...x, out: -dir * e, inn: dir * (1 - e) }; };
// mask: an iris; r is the incoming shot's radius as a share of the frame's diagonal
export const mask = (t, at, d) => { const x = tr(t, at, d); return { ...x, r: snap(x.k) }; };
// whip: the camera's sideways offset in widths across the cut at at + d/2 (rig's whip hit does the same for a camera)
export const whip = (t, at, d, { dir = 1 } = {}) => {
  const x = tr(t, at, d), k = x.k;
  return { ...x, pan: !x.active ? 0 : k < 0.5 ? -dir * whipEase(k * 2) : dir * (1 - whipEase((k - 0.5) * 2)), cut: at + d / 2 };
};
// zoomPunch: a zoom kick peaking at the cut (at + d/2), amp at most
export const zoomPunch = (t, at, d, { amp = 0.12 } = {}) => {
  const x = tr(t, at, d), m = at + d / 2;
  return { ...x, zoom: x.active ? 1 + amp * Math.exp(-Math.pow((t - m) / (d / 4), 2)) : 1, cut: m };
};
// glitchCut: post's glitch amount around the cut, and nothing on a look without glitches
export const glitchCut = (t, at, d, { style = null, amp = 0.55 } = {}) => {
  const x = tr(t, at, d), ok = !!(style && style.motion && style.motion.glitch);
  return { ...x, glitch: ok && x.active ? amp * Math.sin(Math.PI * x.k) : 0, allowed: ok };
};
// flash: post's flash amount (a mix toward white) around the cut, and nothing on a look without glitches. Each flash
// is two transitions for the flash check: keep to three in any second (flashBudget), and keep amp modest.
export const flash = (t, at, d, { style = null, amp = 0.3 } = {}) => {
  const x = tr(t, at, d), ok = !!(style && style.motion && style.motion.glitch);
  return { ...x, flash: ok && x.active ? amp * Math.pow(1 - x.k, 2) : 0, allowed: ok };
};
// speedRamp: a time warp across [at, at + d]: content time runs up to `rate` times faster into the middle, then slower,
// and lands back on picture time at both ends with the same speed (returns the time to draw the content at; rate <= 2
// keeps it moving forward)
export const speedRamp = (t, at, d, { rate = 1.8 } = {}) => {
  if (t <= at || t >= at + d) return t;
  const k = (t - at) / d, r = clamp(rate, 0, 2);
  return at + d * (k + ((r - 1) * (1 - Math.cos(Math.PI * 2 * k))) / (Math.PI * 2));
};
// Flash transitions at these times (seconds): throws when more than three fall in any one second (WCAG's three flashes).
export function flashBudget(times) {
  const s = [...times].sort((a, b) => a - b);
  for (let i = 0; i + 3 < s.length; i++) if (s[i + 3] - s[i] < 1) throw new Error(`flash: four flash frames within one second (${s.slice(i, i + 4).map((x) => x.toFixed(2)).join(', ')} s): keep to three`);
  return true;
}

// ---- cuts (23.9): a scene's visual cuts and transitions, [{ t, d }] in picture time (d 0 for a hard cut, at most 0.3 s
// for a transition from t to t + d). A scene exports cuts() returning its list; energy_match confirms each one on the
// frames. cutGrid lays cuts on the beat grid inside beat windows; shotAt says which shot t is in.
export const CUT_MAX_D = 0.3;
// Cut times every `every` beats (spb seconds a beat), from picture time 0, strictly inside [from, to): never on the
// window's own edges (the beat change is the scene's own cut, if it has one).
export function cutGrid(from, to, spb, every) {
  const step = every * spb, out = [];
  for (let k = Math.floor(from / step + 1e-9) + 1; k * step < to - 1e-6; k++) out.push(+(k * step).toFixed(6));
  return out;
}
// A cut list checked and sorted: each { t, d } with t finite and d from 0 to 0.3 s. Throws on a bad entry.
export function cutList(list) {
  const out = (list || []).map((c, i) => {
    const t = typeof c === 'number' ? c : c && c.t, d = typeof c === 'number' ? 0 : (c && c.d) || 0;
    if (!Number.isFinite(t) || !Number.isFinite(d) || d < 0 || d > CUT_MAX_D + 1e-9) throw new Error(`cuts(): entry ${i} ${JSON.stringify(c)} needs a time t and a length d from 0 to ${CUT_MAX_D} s`);
    return { t: +t.toFixed(6), d: +d.toFixed(6) };
  });
  return out.sort((a, b) => a.t - b.t);
}
// The shot t is in: how many cuts have happened by t (a transition counts once it reaches its middle).
export function shotAt(cuts, t) {
  let i = 0;
  for (const c of cuts) if (t >= c.t + c.d / 2) i++; else break;
  return i;
}

// ---- kinetic type
// The entrance curve for a preset's ease (energy.ease): dt seconds after the element starts, 0 -> 1 (may overshoot).
export function entrance(ease) {
  switch (ease) {
    case 'spring': return (dt) => spring(dt, 1.6, 0.8);              // gentle springs
    case 'overshoot': return (dt) => (dt <= 0 ? 0 : anticip(prog(dt, 0, 0.34)));   // anticipation and overshoot
    default: return (dt) => snap(prog(dt, 0, 0.32));                  // snap and swift
  }
}
// A slam: scale from `from` down to 1 over d with an overshoot, alpha up at once. dt < 0: not on screen yet.
export function slam(dt, { from = 1.7, d = 0.16 } = {}) {
  if (dt < 0) return { s: from, a: 0 };
  const k = prog(dt, 0, d);
  return { s: lerp(from, 1, k) - 0.06 * Math.sin(Math.PI * prog(dt, d, d + 0.16)), a: clamp(dt / 0.03) };
}
// The largest scale (at most `max`) a box can grow to about its own centre and stay inside the safe rectangle.
export function slamFrom(b, safe, max = 1.75) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const k = Math.min((cx - safe.x) / (b.w / 2), (safe.x + safe.w - cx) / (b.w / 2), (cy - safe.y) / (b.h / 2), (safe.y + safe.h - cy) / (b.h / 2));
  return clamp(k * 0.98, 1, max);
}
// Scale in: 0 -> 1 with the preset's curve; rotate in: from `deg` degrees to 0.
export const scaleIn = (dt, ease = 'snap') => Math.max(0, entrance(ease)(dt));
export const rotateIn = (dt, deg = 8, ease = 'snap') => ((1 - clamp(entrance(ease)(dt), 0, 1.2)) * deg * Math.PI) / 180;

// The font size (px) at which `text`'s ink (its glyphs' actual ascent plus descent) is share x H tall. fontAt(px) is the
// CSS font string at a size (fontStr from looks.js, bound to a role). Ink scales with the size, so one measure fits it.
export function inkFont(ctx, text, fontAt, share, H) {
  ctx.save(); ctx.font = fontAt(100);
  const m = ctx.measureText(text), ink = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  ctx.restore();
  return ink > 0 ? (100 * share * H) / ink : 100;
}
// Words slammed in one at a time (or together), drawn and boxed from one layout, so boxes(t) always matches the
// drawing (P8's habit). words: [{ text, x, base, font, at, until?, color?, from? }]: x the left edge and base the
// baseline in design px, at the slam time, until when it leaves (default: stays), from the scale it slams down from
// (default opts.slam.from: keep it small enough that the word stays in the safe area, slamFrom). Each word scales about
// its own centre. Returns
// one box per word on screen, all in opts.group (the whole board copy string, so check reads them as one phrase).
// opts: draw (false: boxes only), slam ({ from, d }), color, alphaMin (a box is reported while alpha > 0.05).
export function slamWords(ctx, words, t, opts = {}) {
  const out = [], draw = opts.draw !== false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (t < w.at || (w.until != null && t >= w.until)) continue;
    const { s, a } = slam(t - w.at, w.from ? { ...opts.slam, from: w.from } : opts.slam);
    if (a <= 0.05) continue;
    ctx.save(); ctx.font = w.font;
    const m = ctx.measureText(w.text), asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent, ww = m.width;
    const cx = w.x + ww / 2, cy = w.base - (asc - desc) / 2;
    if (draw) {
      ctx.globalAlpha *= a; ctx.fillStyle = w.color || opts.color || '#FFFFFF'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
      ctx.fillText(w.text, w.x, w.base);
    }
    ctx.restore();
    const bw = ww * s, bh = (asc + desc) * s;
    out.push({ id: `${opts.id || 'slam'}${i}`, text: w.text, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh, group: opts.group || 'slam' });
  }
  return out;
}
// A seeded value in [0, 1) for shot i (a shot's angle, its ground, its offset), the same at every t.
export const shotRand = (i, seed = 1) => hash(i * 13.17 + seed * 101.3);
