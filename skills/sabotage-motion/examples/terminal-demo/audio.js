// The terminal-demo's sound, synthesized from the scene's TL (the template's audio.js has the master chain and the
// building blocks this keeps). Key ticks come from code.js (keySounds) at the times the scene thinned to KEY_MAX a
// second (TL.keys), so they follow the typing and stop when it stops; under them a quiet pad holds the piece together,
// a tone rises with the progress bar, a chime lands the install, the spinner ticks softly, and the diff lands with a
// whoosh, a pluck per line and a low thump. The timbre is the look's (style.sound).
import { mulberry32 } from './lib.js';
import { keySounds } from './code.js';

export async function renderAudio({ TL, CFG, dur = CFG.DUR, sr = 48000, style = null }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const rnd = mulberry32(17);
  const SND = { wave: 'sine', pitch: 1, bright: 1, verb: 0.3, ...(style ? style.sound : {}) };

  // ---- master chain: level -> gentle compressor -> tail fade -> out, with a reverb send
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.12;
  const master = ac.createGain(); master.gain.value = 2.2;
  const endFade = ac.createGain();
  endFade.gain.setValueAtTime(1, Math.max(0, dur - 0.25)); endFade.gain.linearRampToValueAtTime(0, dur);
  master.connect(comp).connect(endFade).connect(ac.destination);
  const ir = ac.createBuffer(2, sr * 2, sr);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  const rev = ac.createConvolver(); rev.buffer = ir;
  const revGain = ac.createGain(); revGain.gain.value = SND.verb; rev.connect(revGain).connect(master);
  const noise = ac.createBuffer(1, sr * 2, sr);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const out = (node, wet = 0.25, pan = 0) => {
    const p = ac.createStereoPanner(); p.pan.value = pan; node.connect(p); p.connect(master);
    const s = ac.createGain(); s.gain.value = wet; p.connect(s).connect(rev); return p;
  };
  // a GainNode starts at 0 so a source that starts before its envelope plays nothing
  const envGain = (t, a, peak, d) => { const g = ac.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; };
  const tone = (t, f, peak, d, type = 'sine', pan = 0, wet = 0.3) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f * SND.pitch;
    const g = envGain(t, 0.004, peak, d); o.connect(g); out(g, wet, pan); o.start(t); o.stop(t + d + 0.1);
  };

  // ---- the pad: two detuned triangles a fifth apart, low-passed, breathing slowly; it fades in and out with the piece
  const pad = ac.createGain(); pad.gain.value = 0;
  pad.gain.setValueAtTime(0, 0); pad.gain.linearRampToValueAtTime(0.05, 0.6);
  pad.gain.setValueAtTime(0.05, dur - 0.9); pad.gain.linearRampToValueAtTime(0, dur - 0.05);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 * SND.bright; lp.Q.value = 0.7;
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.25; const lfoG = ac.createGain(); lfoG.gain.value = 300;
  lfo.connect(lfoG).connect(lp.frequency); lfo.start(0); lfo.stop(dur);
  for (const [f, det] of [[110, -6], [110, 6], [165, -4], [220, 3]]) {
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f * SND.pitch; o.detune.value = det;
    o.connect(lp); o.start(0); o.stop(dur);
  }
  lp.connect(pad); out(pad, 0.4);

  // ---- key ticks: one per kept key press, Enter lower
  const keys = ac.createGain(); keys.gain.value = 1; out(keys, 0.12);
  keySounds(ac, keys, TL.keys, { seed: 5, level: 0.2, style });

  // ---- the progress bar: a sine rising through the bar's length, then a two-note chime when the install lands
  {
    const [a, b] = TL.bar, o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(320 * SND.pitch, a); o.frequency.exponentialRampToValueAtTime(880 * SND.pitch, b);
    const g = ac.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.035, a + 0.15);
    g.gain.setValueAtTime(0.035, b - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, b + 0.05);
    o.connect(g); out(g, 0.2); o.start(a); o.stop(b + 0.1);
    tone(TL.installed, 1046.5, 0.07, 0.7, 'sine', -0.2, 0.5); tone(TL.installed + 0.07, 1568, 0.05, 0.8, 'sine', 0.2, 0.5);
  }
  // ---- the spinner: a soft tick per turn; the find: a two-note blip
  for (const t of TL.spin) tone(t, 1760, 0.018, 0.04, 'triangle', 0.3, 0.1);
  tone(TL.found, 660, 0.06, 0.18, 'square', 0, 0.2); tone(TL.found + 0.08, 494, 0.05, 0.25, 'square', 0, 0.2);

  // ---- the diff: a whoosh as its window opens, a pluck per landed line, a thump and a shimmer on the last
  {
    const t = TL.open - 0.05, len = 0.4;
    const s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.3;
    bp.frequency.setValueAtTime(700 * SND.bright, t); bp.frequency.exponentialRampToValueAtTime(3200 * SND.bright, t + len);
    const g = envGain(t, len * 0.6, 0.09, len * 0.5);
    s.connect(bp).connect(g); out(g, 0.3); s.start(t, 0.3); s.stop(t + len + 0.1);
  }
  TL.lands.forEach((t, i) => tone(t, [392, 523.25][i % 2], 0.08, 0.35, SND.wave, i % 2 ? 0.25 : -0.25, 0.35));
  const last = TL.lands[TL.lands.length - 1];
  {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(130, last); o.frequency.exponentialRampToValueAtTime(46, last + 0.2);
    const g = envGain(last, 0.004, 0.32, 0.4); o.connect(g); out(g, 0.1); o.start(last); o.stop(last + 0.5);
  }
  [1760, 2637, 3520].forEach((f, i) => tone(last + 0.05 + i * 0.03, f, 0.02 / (i + 1), 0.9, 'sine', (i - 1) * 0.4, 0.6));

  return ac.startRendering();
}
