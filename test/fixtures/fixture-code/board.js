// fixture-code (test/code.test.mjs): one 4 s silent beat on tiktok-ad, whose safe area is measured, so text outside it
// FAILs text_safe.
export const BOARD = {
  title: 'fixture-code',
  target: 'tiktok-ad',
  beats: [{ id: 'all', dur: 4.0, on: [], look: 'typed code that scrolls, a terminal, a phone frame over the code' }],
};
