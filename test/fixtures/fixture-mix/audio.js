// fixture-mix's effects: a 1 kHz tick at every TL.ticks time (a 3 ms attack, held 30 ms, a 50 ms decay),
// nothing else. Ticks this dense keep the stem's peak-to-loudness ratio near 8 dB, so loudnorm can bring it to
// -14 LUFS under -2 dBTP with plain gain.
export async function renderAudio({ TL, CFG, dur = CFG.DUR, sr = 48000 }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  for (const t of TL.ticks) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 1000;
    const g = ac.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.003);
    g.gain.setValueAtTime(0.3, t + 0.033); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.083);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.09);
  }
  return ac.startRendering();
}
