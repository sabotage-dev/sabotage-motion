// A CLIP'S CAPTIONS (plan 23.5): word-by-word captions for a clip with speech, rendered with alpha on the clip's own
// clock, then laid over the clip by ffmpeg (tools/clip.mjs composite). The clip is never redrawn here: this scene draws
// the captions alone. The recipe is in references/delivery.md ("Caption a clip"):
//   node tools/clip.mjs prepare <clip> --transcript <file> --board    clip, clip.js, vo.wav, cues.js, cues.json, board.js
//   node render.mjs video --scene caption.js --alpha --out out/<name>.mov
//   node tools/clip.mjs composite <name>                                out/<name>.mp4 and its render record
//   node tools/mix.mjs <name> --no-sfx                                  the clip's sound, levelled and mastered
//   node render.mjs check --file out/<name>-final.mp4
// It reads clip.js (CLIP: size, constant frame rate, length) and cues.js (WORDS at the clip's own times, VO_OFFSET 0).
// The style: --param style=<pop|karaoke|boxed|minimal>, else the board's captionStyle, else the energy's default
// (captionStyleFor: --param energy=subtle|normal|extreme, else CFG.ENERGY, else normal -> pop). Emphasis words:
// --param emphasis=word,word or the board's emphasis list. --param size=<px at 1080 wide> (default 64), pos=bottom|
// center|top, accent=#hex (the spoken word), emph=#hex (emphasis words). The captions keep inside the target's safe area
// (the board's target), scaled to the clip when the clip has the target's shape (scaleTarget in lib.js).
import { CLIP, CUES, BOARD, captions, captionStyle, captionStyleFor, sceneTarget, scaleTarget } from './lib.js';
import { fontStr } from './looks.js';

export const CFG = CLIP
  ? { W: CLIP.w, H: CLIP.h, FPS: CLIP.fps, DUR: CLIP.dur, FONTS: ['DISPLAY'] }
  : { W: 1080, H: 1920, FPS: 30, DUR: 3, FONTS: ['DISPLAY'] };
export const silent = true;
export const TL = {};

let ctx, OPTS = null;
const WORDS = CUES ? CUES.WORDS : [];

export async function init({ ctx: c, scale, params, target, style }) {
  ctx = c;
  if (!CLIP) throw new Error('caption.js captions a clip: run node tools/clip.mjs prepare <clip> --transcript <file> first (it writes clip.js)');
  const name = params.style || (BOARD && BOARD.captionStyle) || captionStyleFor(params.energy || CFG.ENERGY);
  const k = CFG.W / 1080;   // sizes are given at 1080 wide and scale with the clip
  const T = scaleTarget(await sceneTarget(target), CFG.W, CFG.H);
  const safe = T && T.safe ? T.safe : { x: CFG.W * 0.08, y: CFG.H * 0.08, w: CFG.W * 0.84, h: CFG.H * 0.84 };
  const emphasis = params.emphasis ? String(params.emphasis).split(',').map((s) => s.trim()).filter(Boolean) : (BOARD && BOARD.emphasis) || [];
  const o = captionStyle(name, { size: Math.round((+params.size || 64) * k), safe, exclude: (T && T.exclude) || [], pos: params.pos || 'bottom',
    accent: params.accent || style.tokens.accent, emphColor: params.emph || style.tokens.accent2, emphasis, scale });
  o.stroke = Math.round((o.stroke || 0) * k);
  o.font = fontStr(style, 'display', o.size);
  OPTS = o;
}

export function frame(t, jit) {
  captions(ctx, WORDS, t, OPTS);
  // alpha: nothing behind the captions. Without --alpha (a contact sheet, a still) they sit on a flat dark ground.
  return { t, jit, use2D: true, scene: 0, P: [0, 0, 0, 0], Q: [0, 0, 0, 0], R: [0, 0, 0, 0], cam: [1, 0, 0, 0], clear: [0.1, 0.1, 0.12] };
}

export const boxes = (t) => captions(ctx, WORDS, t, { ...OPTS, draw: false });

export function post(t) {
  return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 };
}
