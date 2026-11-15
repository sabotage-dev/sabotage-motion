// fixture-check: the board for the check suite (plan section 16). Every planted defect sits between moving
// content, and the clean cases each run long enough (over 3 s) that a detector that missed them would fire.
// With the suite's synthetic take (test/check-helpers.mjs) the windows are, in picture time:
//   open 0-1.0, hook 1.0-3.4, drift 3.4-6.6, freeze 6.6-10.6, dot 10.6-13.8, save 13.8-16.0, end 16.0-19.2
export const BOARD = {
  title: 'Fixture check',
  target: 'tiktok',
  hookMax: 4.0,
  beats: [
    { id: 'open', dur: 1.0, on: [], look: 'a flat first frame (planted), then dots stream across', sfx: 'a tick per dot' },
    { id: 'hook', vo: 'Stop pasting the same prompt.', on: ['Stop pasting'], look: 'STOP slams in from 3x, briefly past the safe area; captions',
      sfx: 'a hit on the first word', sfxHit: true, hook: true },
    { id: 'drift', dur: 3.2, on: ['DRIFT'], look: 'a card drifts right at 9 px a second; nothing else moves', sfx: 'a slow whoosh' },
    { id: 'freeze', dur: 4.0, on: ['FROZEN'], look: 'everything stops for 4 s (planted), two labels overlap (planted)', sfx: 'a low drone (planted: no sound)' },
    { id: 'dot', dur: 3.2, on: ['HELD CARD', 'NEVER SHOWN'], look: 'a held card; one 10 px dot moves 1 px a frame; NEVER SHOWN never appears (planted)' },
    { id: 'save', vo: 'Save it as a skill instead.', on: ['skill', 'FLASH'],
      look: 'captions; LEFT leaves the safe area for 0.5 s, EDGE only at the first and last subframes, FLASH shows for 0.2 s (planted)',
      sfx: 'a swell (planted: sfxHit with no transient)', sfxHit: true },
    { id: 'end', dur: 3.2, on: ['example.com'], look: 'end card, held to the last frame (HOLDS)', sfx: 'a soft chime' },
  ],
};
