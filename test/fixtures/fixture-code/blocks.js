// The fixture's blocks, built the same way in the page (scene.js) and in Node (test/code.test.mjs). Typing has no
// jitter, so the times are worked out by hand in the test: one character every 1/30 s.
import { codeBlock, termSession, frameLayout } from './code.js';

const NOJIT = { jitter: 0, spacePause: 0 };
export function blocks(theme) {
  const CW = frameLayout('window', { x: 160, y: 300, w: 600, h: 56 + 168 });
  const TW = frameLayout('window', { x: 160, y: 800, w: 600, h: 56 + 206 });
  // two rows fit (168 - 2 x 24 = 120 = 2 x 60): the view scrolls as the cursor moves down
  const CODE = codeBlock({ src: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;', lang: 'js', ...CW.content, size: 40, lineH: 1.5, pad: 24,
    numbers: false, start: 0.3, type: { cps: 30, linePause: 0.1, ...NOJIT }, theme });
  // three rows fit (206 - 2 x 22 = 162 = 3 x 54)
  const TERM = termSession({ ...TW.content, size: 36, lineH: 1.5, pad: 22, prompt: '$ ', type: { cps: 30, ...NOJIT }, theme,
    steps: [{ cmd: 'run it', at: 3.0 }, { out: ['ok', 'done'], every: 0.2 }] });
  // a phone over the right of the code window: chrome over code
  const PHONE = { x: 380, y: 330, w: 200, h: 400 };
  return { CW, TW, CODE, TERM, PHONE };
}
