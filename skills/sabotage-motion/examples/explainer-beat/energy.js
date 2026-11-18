// Energy presets (plan 23.9): how much a piece moves. The look decides the KIND of motion it allows (looks.js: a look
// with glitch: false never glitches or flash-frames); the energy decides the AMOUNT: the tempo of the beat grid and the
// bed, how often the picture cuts, how hard the camera moves, how big the type is, the easing, the post and the sound.
// Plain data and pure functions with no imports: the page (main.js, lib.js, moves.js, audio.js), render.mjs and
// check.mjs all import this file.
//
// Which energy: --param energy=<name>, else CFG.ENERGY in the scene, else the board's `energy`, else normal. The board
// is where a piece names it (the agent says which it chose and why); a scene's CFG.ENERGY and the board's may not
// disagree. A board may also set its own tempo, `bpm`, within 10% of its preset's (Q22).
//
// The presets (23.9's table). Shot lengths are cut intervals, in musical beats of the preset's tempo:
//   ENERGY[name] = {
//     bpm          tempo of the beat grid and the bed
//     cutBeats     [min, max] beats between visual cuts (inside beats: the copy stays on screen across them)
//     inkHeight    [min, max] the largest line of type: one line's ink height as a share of the frame height
//     motion       { min?, max? } the share of probe pixels whose luma changes by 8/255 or more, per frame pair
//                  (median): normal and extreme have a floor, subtle a ceiling (Q23, first values)
//     camera       amounts for moves.js's rig: push (zoom gained over a beat), punch (zoom kick on a hit), bounce
//                  (zoom spring on a hit), shake (design px on an impact), whip (whips between beats allowed)
//     transitions  the transitions the preset reaches for, gentlest first
//     ease         the entrance curve: 'spring' (gentle), 'snap' (snap and swift), 'overshoot' (anticipation, whip)
//     post         multipliers on the look's bloom and grain, and hitCa: chromatic aberration added on a hit
//     sound        bed ('pad' | 'beat' | 'drive'), whooshes on cuts, hits ('few' | 'hits' | 'impacts'), risers
//     caption      the caption style a clip's captions take by default (lib.js captionStyleFor)
//     shotStep     at most this much relative luminance between consecutive shots' grounds (shotTones), so fast
//                  cuts never make a flash sequence (null: the preset cuts too slowly for it to matter)
//   }
// The motion floors and ceiling, the cut intervals and the ink ranges are what P11b-2's energy_match check measures
// a piece against; check.md records the contract (section 8).

const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };

export const ENERGY_NAMES = Object.freeze(['subtle', 'normal', 'extreme']);
export const DEFAULT_ENERGY = 'normal';
export const ENERGY = freeze({
  subtle: {
    bpm: 84, cutBeats: [4, 5], inkHeight: [0.04, 0.08], motion: { max: 0.10 },
    camera: { push: 0.012, punch: 0, bounce: 0, shake: 0, whip: false },
    transitions: ['crossfade', 'wipe'],
    ease: 'spring',
    post: { bloom: 0.7, grain: 0.8, hitCa: 0 },
    sound: { bed: 'pad', whoosh: false, hits: 'few', riser: false },
    caption: 'minimal', shotStep: null,
  },
  normal: {
    bpm: 116, cutBeats: [2, 3], inkHeight: [0.09, 0.16], motion: { min: 0.02 },
    camera: { push: 0.03, punch: 0.05, bounce: 0, shake: 0, whip: true },
    transitions: ['mask', 'slide', 'whip'],
    ease: 'snap',
    post: { bloom: 1, grain: 1, hitCa: 0 },
    sound: { bed: 'beat', whoosh: true, hits: 'hits', riser: false },
    caption: 'pop', shotStep: null,
  },
  extreme: {
    bpm: 136, cutBeats: [0.5, 1], inkHeight: [0.18, 0.35], motion: { min: 0.06 },
    camera: { push: 0.05, punch: 0.08, bounce: 0.06, shake: 5, whip: true },
    transitions: ['whip', 'glitchCut', 'flash', 'speedRamp'],
    ease: 'overshoot',
    post: { bloom: 1.15, grain: 1, hitCa: 0.004 },
    sound: { bed: 'drive', whoosh: true, hits: 'impacts', riser: true },
    caption: 'karaoke', shotStep: 0.08,
  },
});
// A board's own tempo may differ from its preset's by this share at most (Q22).
export const TEMPO_SLACK = 0.10;
// board_copy_unread's rule (check.mjs T.copyUnread): a string needs max(1.0 s, 0.25 s a word) on screen. A beat that
// snaps to the grid never gets shorter than that.
export const COPY_READ = Object.freeze({ min: 1.0, perWord: 0.25 });

const isName = (n) => typeof n === 'string' && Object.prototype.hasOwnProperty.call(ENERGY, n);
const bad = (n, where) => new Error(`${where} energy "${n}": one of ${ENERGY_NAMES.join(', ')}`);

// The energy's name and where it came from: --param energy, CFG.ENERGY, the board, or the default.
export function energyName({ params = {}, CFG = null, BOARD = null } = {}) {
  const pick = [['--param', params && params.energy], ['CFG.ENERGY', CFG && CFG.ENERGY], ['board.js', BOARD && BOARD.energy]]
    .find(([, v]) => v != null && v !== '');
  if (!pick) return { name: DEFAULT_ENERGY, from: 'default' };
  if (!isName(pick[1])) throw bad(pick[1], pick[0]);
  return { name: pick[1], from: pick[0] };
}

// Everything wrong with a board's energy fields, as sentences: energy a preset name, bpm a tempo within 10% of the
// preset's (the board's own energy, else normal), bed: false only at subtle.
export function energyProblems(board) {
  const p = [];
  if (!board || typeof board !== 'object') return p;
  if (board.energy != null && !isName(board.energy)) p.push(`BOARD.energy "${board.energy}" is not a preset (${ENERGY_NAMES.join(', ')})`);
  const name = isName(board.energy) ? board.energy : DEFAULT_ENERGY;
  if (board.bpm != null) {
    const b = ENERGY[name].bpm;
    if (typeof board.bpm !== 'number' || !Number.isFinite(board.bpm) || board.bpm <= 0) p.push('BOARD.bpm must be a tempo in beats per minute');
    else if (Math.abs(board.bpm - b) > TEMPO_SLACK * b + 1e-9) p.push(`BOARD.bpm ${board.bpm} is more than ${TEMPO_SLACK * 100}% from ${name}'s ${b} BPM (${tempoRange(name).join(' to ')})`);
  }
  if (board.bed != null && board.bed !== false) p.push('BOARD.bed may only be false (a silent bed, at subtle)');
  if (board.bed === false && name !== 'subtle') p.push(`BOARD.bed: false makes the bed silent, which only subtle may do (this board is ${name})`);
  return p;
}
export const tempoRange = (name) => { const b = ENERGY[name].bpm; return [+(b * (1 - TEMPO_SLACK)).toFixed(1), +(b * (1 + TEMPO_SLACK)).toFixed(1)]; };

// The tempo a piece runs at: the board's bpm when it sets one (within 10% of the preset's), else the preset's.
export function boardBpm(board, name) {
  const b = ENERGY[name].bpm;
  if (!board || board.bpm == null) return b;
  if (Math.abs(board.bpm - b) > TEMPO_SLACK * b + 1e-9) throw new Error(`board.js bpm ${board.bpm} is more than ${TEMPO_SLACK * 100}% from ${name}'s ${b} BPM: at ${name} the tempo is ${tempoRange(name).join(' to ')} BPM`);
  return board.bpm;
}

// The resolved energy a scene and audio.js receive: the preset's fields, with name, from, bpm (the board's own when
// it sets one), spb (seconds a beat), and the cut interval in seconds at that tempo.
export function resolveEnergy({ params = {}, CFG = null, BOARD = null } = {}) {
  const { name, from } = energyName({ params, CFG, BOARD });
  if (!(params && params.energy) && CFG && CFG.ENERGY && BOARD && BOARD.energy && CFG.ENERGY !== BOARD.energy) {
    throw new Error(`CFG.ENERGY "${CFG.ENERGY}" and board.js's energy "${BOARD.energy}" disagree: name the energy in one place (the board)`);
  }
  const bpm = boardBpm(BOARD, name), spb = 60 / bpm, P = ENERGY[name];
  return { ...P, name, from, bpm, spb, cutSec: [P.cutBeats[0] * spb, P.cutBeats[1] * spb], silentBed: name === 'subtle' && !!BOARD && BOARD.bed === false };
}

// ---- beats on the grid (23.9: only a board with no voice snaps its beat lengths to whole musical beats)
// A string's reading time, as board_copy_unread counts it.
export const readTime = (s) => Math.max(COPY_READ.min, COPY_READ.perWord * String(s).split(/\s+/).filter(Boolean).length);
// The longest reading time among a beat's on-screen strings (0 without copy).
export const copyNeed = (on) => Math.max(0, ...(on || []).map(String).filter((s) => s.trim()).map(readTime));
// A silent beat's length snapped to the grid: the nearest whole number of beats, at least one, and never shorter than
// its copy needs to be read. dur and the result in seconds; spb the seconds a beat.
export function snapDur(dur, spb, need = 0) {
  const n = Math.max(1, Math.round(dur / spb - 1e-9), Math.ceil(need / spb - 1e-9));
  return n * spb;
}
// Whether a board's beats snap: it has no voiced beat, and it names its energy or its tempo (a board from before the
// presets keeps its lengths as written; lib.js boardTiming never snaps a clip's board, whose clip sets its length).
export const boardSnaps = (board) => !!board && Array.isArray(board.beats) && board.beats.length > 0 &&
  board.beats.every((b) => b && b.vo == null) && (board.energy != null || board.bpm != null);

// ---- the beat grid
// Musical beat times from `from` up to (not including) `to`, every `every` beats at `spb` seconds a beat, counted
// from picture time 0 (the bed's first beat), so a grid started anywhere lands on the bed's beats.
export function gridTimes(from, to, spb, every = 1) {
  const step = every * spb, out = [];
  for (let k = Math.ceil(from / step - 1e-9); k * step < to - 1e-9; k++) out.push(+(k * step).toFixed(6));
  return out;
}

// ---- grounds that keep their luminance close: fast cuts without a flash sequence (23.9, the flash rule)
// WCAG relative luminance of a #RRGGBB colour (linearised sRGB).
export function relLum(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const hexRgb = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// The flash rule's two thresholds (check.mjs T.flash): a general transition is a swing of 0.1 relative luminance or more
// with the darker end under 0.8. A pair of tones closer than that, or both at 0.8 or brighter, never makes one.
export const FLASH_SWING = 0.1, FLASH_DARK = 0.8;
// A tone that reads as a different ground from `hex` (as far from it as the rule allows) while every swing between the
// two stays under the flash rule: on a ground at 0.8 or brighter, toward white (both ends bright, so no transition at
// any size); on a darker one, toward white until the two are `step` apart in relative luminance (default 0.08).
export function groundTone(hex, step = 0.08) {
  const A = hexRgb(hex), l0 = relLum(hex), mix = (k) => toHex(A.map((v) => v + (255 - v) * k));
  if (l0 >= FLASH_DARK) {
    if (1 - l0 > 0.05) return mix(1);
    // a ground at white already: darken it, staying at 0.8 or brighter
    const dark = (k) => toHex(A.map((v) => v * (1 - k)));
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (relLum(dark(m)) >= FLASH_DARK + 0.005) lo = m; else hi = m; }
    return dark(lo);
  }
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (relLum(mix(m)) - l0 < step) lo = m; else hi = m; }
  return mix(lo);
}
// n shot grounds alternating between `ground` and its groundTone: consecutive shots differ (their pixels change, so the
// cut reads) without a flash between them (23.9: at extreme's cut rate, shots alternating dark and light would be one).
export function shotTones(ground, n, step = 0.08) {
  const b = groundTone(ground, step);
  return Array.from({ length: n }, (_, i) => (i % 2 ? b : String(ground).toUpperCase()));
}
