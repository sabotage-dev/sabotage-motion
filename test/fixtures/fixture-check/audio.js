// fixture-check's effects (plan section 16): ticks in the open beat, a hit on the hook, a slow whoosh across the
// drift, nothing in the freeze (planted: its sound note has no sound), a swell that fades in with no transient
// across the save beat (planted: it asks for a hit), and a chime on the end card.
export async function renderAudio({ TL, CFG, dur = CFG.DUR, sr = 48000 }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const tone = (t, f, peak, attack, decay) => {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = ac.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + attack + decay + 0.02);
  };
  for (const t of TL.ticks) tone(t, 1000, 0.3, 0.002, 0.06);
  tone(TL.hit, 140, 0.4, 0.002, 0.2);
  // the whoosh: a seeded noise buffer through a band-pass, faded in and out over 0.3 s
  const [w0, w1] = TL.whoosh, n = Math.ceil((w1 - w0) * sr), buf = ac.createBuffer(1, n, sr), d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  const src = ac.createBufferSource(); src.buffer = buf;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8;
  const wg = ac.createGain(); wg.gain.value = 0;
  wg.gain.setValueAtTime(0, w0); wg.gain.linearRampToValueAtTime(0.25, w0 + 0.3); wg.gain.setValueAtTime(0.25, w1 - 0.3); wg.gain.linearRampToValueAtTime(0, w1);
  src.connect(bp).connect(wg).connect(ac.destination); src.start(w0);
  // the swell: rises 100 dB a second from -100 dBFS, so no 10 ms is ever 12 dB over the 100 ms before it
  const [s0, s1] = TL.swell, o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 220;
  const sg = ac.createGain(); sg.gain.value = 0;
  sg.gain.setValueAtTime(0.00001, s0); sg.gain.exponentialRampToValueAtTime(0.12, s0 + 0.8);
  sg.gain.setValueAtTime(0.12, s1 - 0.25); sg.gain.exponentialRampToValueAtTime(0.00001, s1);
  o.connect(sg).connect(ac.destination); o.start(s0); o.stop(s1 + 0.01);
  tone(TL.chime, 880, 0.2, 0.005, 1.5);
  return ac.startRendering();
}
