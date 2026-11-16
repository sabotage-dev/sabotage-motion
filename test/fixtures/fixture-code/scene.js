// fixture-code: the code helpers in a render. --param outFor=<s> moves the code window out of tiktok-ad's safe area
// (to x 40) from 1.0 s for that long; --param log=t1,t2 prints each helper's layout-call state at those times (one
// "CODESTATE {json}" line each, with the key ticks), measured with the page's own fonts.
import { boardDur } from './lib.js';
import { bgConfig } from './looks.js';
import { codeTheme, drawCode, terminal, drawFrame, typedTimes, keyTicks } from './code.js';
import { blocks } from './blocks.js';

export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY', 'MONO'] };
export const TL = { keys: [] };
let ctx, ST, TH, B, OUT = 0, ALPHA = false;

export async function init({ ctx: c, params, style, alpha }) {
  ctx = c; ST = style; ALPHA = alpha; TH = codeTheme(style);
  OUT = +(params.outFor || 0);
  B = blocks(TH);
  TL.keys = keyTicks([...B.CODE.keys, ...typedTimes(B.TERM)]);
  if (params.log) {
    for (const t of params.log.split(',').map(Number)) {
      const code = drawCode(ctx, B.CODE, t, { draw: false }), term = terminal(ctx, B.TERM, t, { draw: false });
      console.log('CODESTATE ' + JSON.stringify({ t, code: code.state, term: term.state, boxes: [...code, ...term].map((b) => b.id), keys: TL.keys.map((k) => k.t) }));
    }
  }
}
const dx = (t) => (OUT && t >= 1 && t < 1 + OUT ? 40 - B.CW.outer.x : 0);
function all(t, draw) {
  const d = dx(t);
  return [
    ...drawFrame(ctx, 'window', B.CW.outer, { theme: TH, title: 'a.js', dx: d, draw, id: 'cwin' }),
    ...drawCode(ctx, B.CODE, t, { dx: d, draw }),
    ...drawFrame(ctx, 'window', B.TW.outer, { theme: TH, title: 'sh', draw, id: 'twin' }),
    ...terminal(ctx, B.TERM, t, { draw }),
    ...drawFrame(ctx, 'phone', B.PHONE, { theme: TH, time: '12:00', draw, id: 'phone' }),
  ];
}
export function frame(t, jit) {
  all(t, true);
  return { t, jit, use2D: true, ...bgConfig(ST, { alpha: ALPHA }), cam: [1, 0, 0, 0] };
}
export const boxes = (t) => all(t, false);
export function post(t) {
  return { t, bloom: 0.1, thr: 0.8, ca: 0, glitch: 0, grain: 0.02, vig: 0.1, scan: 0, flash: 0, fade: 1, hud: 0 };
}
