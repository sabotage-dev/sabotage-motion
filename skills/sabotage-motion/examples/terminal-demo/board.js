// THE STORYBOARD of the terminal-demo example: 8 s, 9:16. A made-up command-line tool (darnly) is installed and run
// in a made-up project (mossgate), and the fix it makes lands as a diff. Silent of voice: the sound is the typing, the
// tool's progress and the diff landing. The tool, the project and every name in it are made up. The field reference
// is in the template's board.js.
export const BOARD = {
  title: 'Terminal demo: install, run, fix',
  target: 'tiktok',
  beats: [
    { id: 'install', dur: 2.6, on: ['Install it.', './get-darnly.sh'],
      look: 'the terminal is open from the first frame, its cursor blinking; the install script is typed, a progress bar fills, the install lands',
      sfx: 'a key tick per typed character (at most 12 a second), Enter lower, a rising tone under the bar, a chime when it lands' },
    { id: 'run', dur: 2.6, on: ['Run it.', 'darnly fix src/clock.ts'],
      look: 'the command is typed, a spinner turns while it reads the project, then it reports what it found',
      sfx: 'key ticks, a soft tick per spinner turn, a blip when it finds the bug' },
    { id: 'fix', dur: 2.8, on: ['Ship the fix.', 'found 1 off-by-one', 'const ms = now - clock.start;'],
      look: 'a window opens under the terminal and the diff lands line by line: the wrong line strikes through, the fixed one opens in; holds on the result',
      sfx: 'a whoosh as the window opens, a pluck per line that lands, a low thump on the last', key: 2.2 },
  ],
};
