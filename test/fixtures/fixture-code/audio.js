// fixture-code's sound: the key ticks alone (code.js keySounds at TL.keys), so anything else in the stem is a fault.
import { keySounds } from './code.js';

export async function renderAudio({ TL, CFG, dur = CFG.DUR, sr = 48000, style = null }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  keySounds(ac, ac.destination, TL.keys, { level: 0.3, style });
  return ac.startRendering();
}
