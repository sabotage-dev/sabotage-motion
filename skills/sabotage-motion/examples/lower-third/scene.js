// LOWER-THIRD: a name strap for 16:9 footage, rendered with a transparent background to lay over another video
// (the scene contract is in the template's scene.js header). Timed from board.js: it grows in, holds to be read
// (hold: true on the board, so check's motion_dead leaves the hold alone), and wipes out.
//   node render.mjs video --alpha --out out/lower-third.mov          ProRes 4444 with alpha (for editors, ffmpeg)
//   node render.mjs video --alpha webm --out out/lower-third.webm    VP9 with alpha (small; Chrome plays it)
// Without --alpha it renders over a neutral gradient, for previews and the contact sheet. It is silent: the sound
// belongs to the edit it goes into. The overlay route through `check` is in references/check.md: the source with
// `node render.mjs check --alpha`, the file with `check --file out/lower-third.mov --plain --alpha`.
import { clamp, lerp, prog, snap, swift, whip, spring, rgba, rgb01, beatWindow, boardDur } from './lib.js';

export const CFG = { W: 1920, H: 1080, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY'] };
export const silent = true;

const [IN] = beatWindow('in'), [READ, OUT] = beatWindow('read');
export const TL = {
  bar: IN + 0.05, plate: IN + 0.2, name: IN + 0.35, role: IN + 0.55,   // in
  line: READ + 0.2,                                                    // the hairline draws across the read
  roleOut: OUT, nameOut: OUT + 0.1, plateOut: OUT + 0.35, barOut: OUT + 0.65,   // out
};

let ctx, ALPHA = false, P;
const L = { x: 150, y: 820, h: 140, bar: 12, pad: 44 };

export async function init({ ctx: c, params, alpha }) {
  ctx = c; ALPHA = alpha;
  P = { name: params.name || 'Rowan Vale', role: params.role || 'Sound designer', accent: params.accent || '#FF4A1C',
    plate: params.plate || '#0B0D14', ink: params.ink || '#F4F1EA' };
  ctx.font = '72px DISPLAY'; L.nameW = ctx.measureText(P.name).width;
  const nm = ctx.measureText(P.name); L.nameAsc = nm.actualBoundingBoxAscent; L.nameDesc = nm.actualBoundingBoxDescent;
  ctx.font = '34px BODY'; ctx.letterSpacing = '3px'; L.roleW = ctx.measureText(P.role.toUpperCase()).width; ctx.letterSpacing = '0px';
  const rm = ctx.measureText(P.role.toUpperCase()); L.roleAsc = rm.actualBoundingBoxAscent; L.roleDesc = rm.actualBoundingBoxDescent;
  L.plateW = Math.max(L.nameW, L.roleW) + 2 * L.pad;
  L.textX = L.x + L.bar + L.pad; L.nameBase = L.y + 76; L.roleBase = L.y + 118;
}

// Everything that moves, as a pure function of t: frame() draws it and boxes() reports it.
function state(t) {
  const barH = L.h * clamp(spring(t - TL.bar, 3, 0.6)) * (1 - swift(prog(t, TL.barOut, TL.barOut + 0.3)));
  const plateW = L.plateW * snap(prog(t, TL.plate, TL.plate + 0.45)) * (1 - swift(prog(t, TL.plateOut, TL.plateOut + 0.35)));
  const nameDy = (1 - spring(t - TL.name, 2.4, 0.6)) * 90 + whip(prog(t, TL.nameOut, TL.nameOut + 0.35)) * 110;
  const roleA = prog(t, TL.role, TL.role + 0.4) * (1 - prog(t, TL.roleOut, TL.roleOut + 0.25));
  const track = lerp(16, 3, snap(prog(t, TL.role, TL.role + 0.6)));
  const line = snap(prog(t, TL.line, TL.line + 2.6)) * (1 - prog(t, TL.roleOut, TL.roleOut + 0.25));
  // the name and role show only inside the plate, and the name only above the plate's bottom edge
  const clip = { x: L.x + L.bar, y: L.y, w: Math.max(0, plateW), h: L.h };
  return { barH, plateW, nameDy, roleA, track, line, clip };
}

export function frame(t, jit) {
  const c = ctx, s = state(t);
  if (s.plateW > 0.5) {
    c.fillStyle = rgba(P.plate, 0.78); c.fillRect(s.clip.x, s.clip.y, s.clip.w, s.clip.h);
    c.save();
    c.beginPath(); c.rect(s.clip.x, s.clip.y, s.clip.w, s.clip.h); c.clip();
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.font = '72px DISPLAY'; c.fillStyle = P.ink; c.fillText(P.name, L.textX, L.nameBase + s.nameDy);
    if (s.roleA > 0) {
      c.font = '34px BODY'; c.letterSpacing = `${s.track.toFixed(2)}px`; c.fillStyle = rgba(P.ink, 0.8 * s.roleA);
      c.fillText(P.role.toUpperCase(), L.textX, L.roleBase); c.letterSpacing = '0px';
    }
    if (s.line > 0) { c.fillStyle = rgba(P.accent, 0.9); c.fillRect(L.textX, L.y + L.h - 10, (L.plateW - 2 * L.pad) * s.line, 3); }
    c.restore();
  }
  if (s.barH > 0.5) { c.fillStyle = P.accent; c.fillRect(L.x, L.y + (L.h - s.barH) / 2, L.bar, s.barH); }
  // a neutral backdrop when not rendering alpha (previews, contact sheets); with --alpha, nothing behind the strap
  return { t, jit, use2D: true, scene: ALPHA ? 0 : 1, P: [0.16, 0.18, 0.22, 0.4], Q: [0.34, 0.36, 0.4, 0], cam: [1, 0, 0, 0], clear: [0.12, 0.13, 0.15] };
}

// The name and the role, cut to the plate (and the name to where it shows above the plate's bottom edge).
export function boxes(t) {
  const s = state(t), out = [];
  const cut = (b) => {
    const x0 = Math.max(b.x, s.clip.x), y0 = Math.max(b.y, s.clip.y);
    const x1 = Math.min(b.x + b.w, s.clip.x + s.clip.w), y1 = Math.min(b.y + b.h, s.clip.y + s.clip.h);
    return x1 > x0 && y1 > y0 ? { ...b, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };
  const nb = L.nameBase + s.nameDy;
  const name = cut({ id: 'name', text: P.name, x: L.textX, y: nb - L.nameAsc, w: L.nameW, h: L.nameAsc + L.nameDesc, group: 'name' });
  if (name) out.push(name);
  if (s.roleA * 0.8 > 0.05) {
    ctx.save(); ctx.font = '34px BODY'; ctx.letterSpacing = `${s.track.toFixed(2)}px`;
    const w = ctx.measureText(P.role.toUpperCase()).width; ctx.restore();
    const role = cut({ id: 'role', text: P.role, x: L.textX, y: L.roleBase - L.roleAsc, w, h: L.roleAsc + L.roleDesc, group: 'role' });
    if (role) out.push(role);
  }
  return out;
}

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}

// The name's rise and drop and the plate's wipes are the fast moves.
export function subBoost(t) {
  return (t >= TL.plate && t < TL.name + 0.5) || (t >= TL.nameOut && t < TL.barOut + 0.3) ? 2 : 1;
}
