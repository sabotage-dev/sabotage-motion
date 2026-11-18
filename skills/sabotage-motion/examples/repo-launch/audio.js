// The repo-launch example's sound, synthesized from the scene's TL (the template's audio.js has the master chain and
// the building blocks this keeps): a quiet pad under the whole piece; a whoosh into a pop as the logo lands and a tick per
// line of the pitch; key ticks from code.js (keySounds) at the presses the scene thinned to 12 a second, a tone rising
// with the progress bar and a chime when the install lands; a pluck as each TODO lights up; a whoosh as the phone rises
// and a soft swell under the pan; a low hit and a shimmer as the end card lands. A short whoosh marks each cut, and a
// shorter one each cut inside a beat. The timbre is the look's (style.sound). renderBed (plan 23.9) is the bed stem: the
// normal energy's beat on its 116 BPM grid (a kick on every beat, an offbeat hat, a bass note on 1 and 3), the
// picture's full length; render.mjs writes it to out/<name>.bed.wav and tools/mix.mjs mixes it under the effects.
import { mulberry32 } from './lib.js';
import { keySounds } from './code.js';

export async function renderAudio({ TL, CFG, dur = CFG.DUR, sr = 48000, style = null }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const rnd = mulberry32(23);
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
  const revGain = ac.createGain(); revGain.gain.value = SND.verb + 0.15; rev.connect(revGain).connect(master);
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
  const whoosh = (t, len, peak, f0 = 600, f1 = 3000, pan = 0) => {
    const s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(f0 * SND.bright, t); bp.frequency.exponentialRampToValueAtTime(f1 * SND.bright, t + len);
    const g = envGain(t, len * 0.6, peak, len * 0.5);
    s.connect(bp).connect(g); out(g, 0.3, pan); s.start(t, rnd() * 1.5); s.stop(t + len + 0.1);
  };
  const thump = (t, peak = 0.3) => {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.2);
    const g = envGain(t, 0.004, peak, 0.4); o.connect(g); out(g, 0.1); o.start(t); o.stop(t + 0.5);
  };

  // ---- the pad: two detuned triangles a fifth apart, low-passed, breathing slowly; it fades in and out with the piece
  const pad = ac.createGain(); pad.gain.value = 0;
  pad.gain.setValueAtTime(0, 0); pad.gain.linearRampToValueAtTime(0.045, 0.5);
  pad.gain.setValueAtTime(0.045, dur - 0.9); pad.gain.linearRampToValueAtTime(0, dur - 0.05);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850 * SND.bright; lp.Q.value = 0.7;
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.2; const lfoG = ac.createGain(); lfoG.gain.value = 280;
  lfo.connect(lfoG).connect(lp.frequency); lfo.start(0); lfo.stop(dur);
  for (const [f, det] of [[98, -6], [98, 6], [147, -4], [196, 3]]) {
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f * SND.pitch; o.detune.value = det;
    o.connect(lp); o.start(0); o.stop(dur);
  }
  lp.connect(pad); out(pad, 0.4);

  // ---- the hook: a whoosh into a pop as the logo lands, a tick per line
  whoosh(Math.max(0, TL.pop - 0.04), 0.3, 0.07, 900, 2600);
  tone(TL.pop + 0.22, 784, 0.08, 0.3, SND.wave, 0, 0.4); tone(TL.pop + 0.24, 1175, 0.04, 0.4, 'sine', 0, 0.5);
  TL.lines.forEach((t, i) => tone(t + 0.12, [1318.5, 1568][i], 0.035, 0.12, 'triangle', i ? 0.25 : -0.25, 0.25));

  // ---- a short whoosh at each cut, and a shorter, higher one at each cut inside a beat
  TL.cuts.forEach((t, i) => whoosh(t - 0.18, 0.26, 0.05, 1200, 400, i % 2 ? 0.2 : -0.2));
  (TL.shots || []).forEach((t, i) => whoosh(t - 0.08, 0.14, 0.035, 2600, 5200, i % 2 ? -0.3 : 0.3));

  // ---- install: key ticks, the bar's rising tone, a chime when it lands
  const keys = ac.createGain(); keys.gain.value = 1; out(keys, 0.12);
  keySounds(ac, keys, TL.keys, { seed: 9, level: 0.2, style });
  {
    const [a, b] = TL.bar, o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(330 * SND.pitch, a); o.frequency.exponentialRampToValueAtTime(880 * SND.pitch, b);
    const g = ac.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.035, a + 0.12);
    g.gain.setValueAtTime(0.035, b - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, b + 0.05);
    o.connect(g); out(g, 0.2); o.start(a); o.stop(b + 0.1);
    tone(TL.installed, 1046.5, 0.07, 0.7, 'sine', -0.2, 0.5); tone(TL.installed + 0.07, 1568, 0.05, 0.8, 'sine', 0.2, 0.5);
  }

  // ---- find: a pluck as each line lights up, rising
  TL.lights.forEach((t, i) => tone(t, [523.25, 659.25, 784][i], 0.08, 0.35, SND.wave, (i - 1) * 0.3, 0.35));

  // ---- board: a whoosh as the phone rises, a soft swell under the pan
  whoosh(TL.rise - 0.05, 0.45, 0.08, 500, 2400);
  {
    const [a, b] = TL.pan, s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(400 * SND.bright, a); bp.frequency.exponentialRampToValueAtTime(1400 * SND.bright, (a + b) / 2); bp.frequency.exponentialRampToValueAtTime(500 * SND.bright, b);
    const g = ac.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.03, (a + b) / 2); g.gain.linearRampToValueAtTime(0.0001, b);
    s.connect(bp).connect(g); out(g, 0.4); s.start(a, 0.5); s.stop(b + 0.1);
  }

  // ---- end: a low hit and a shimmer as the card lands
  thump(TL.land, 0.3);
  [1568, 2349, 3136].forEach((f, i) => tone(TL.land + 0.05 + i * 0.04, f, 0.02 / (i + 1), 1.1, 'sine', (i - 1) * 0.4, 0.6));
  tone(TL.land + 0.3, 523.25, 0.05, 1.2, SND.wave, 0, 0.5); tone(TL.land + 0.3, 784, 0.035, 1.2, SND.wave, 0, 0.5);

  return ac.startRendering();
}

// The bed stem: the energy's beat on its grid (beat 0 on the first frame), at full level like a music track (the mixer
// brings it down), with a compressor holding its peaks, and the look's pitch.
export async function renderBed({ CFG, dur = CFG.DUR, sr = 48000, style = null, energy = null }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const SND = { pitch: 1, bright: 1, ...(style ? style.sound : {}) };
  const spb = energy ? energy.spb : 60 / 116, rnd = mulberry32(31);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 12; comp.knee.value = 4; comp.attack.value = 0.002; comp.release.value = 0.1;
  const master = ac.createGain(); master.gain.value = 4.0;
  const endFade = ac.createGain();
  endFade.gain.setValueAtTime(1, Math.max(0, dur - 0.03)); endFade.gain.linearRampToValueAtTime(0, dur);
  master.connect(comp).connect(endFade).connect(ac.destination);
  const noise = ac.createBuffer(1, sr, sr);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const env = (t, a, peak, d) => { const g = ac.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; };
  const kick = (t) => { const o = ac.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); const g = env(t, 0.004, 0.34, 0.28); o.connect(g).connect(master); o.start(t); o.stop(t + 0.4); };
  const hat = (t) => { const s = ac.createBufferSource(); s.buffer = noise; const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500 * SND.bright; const g = env(t, 0.001, 0.05, 0.035); s.connect(f).connect(g).connect(master); s.start(t, rnd() * 0.5); s.stop(t + 0.08); };
  const bass = (t, f) => { const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = f * SND.pitch; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; const g = env(t, 0.01, 0.12, spb * 0.8); o.connect(lp).connect(g).connect(master); o.start(t); o.stop(t + spb); };
  const roots = [49, 49, 43.65, 55];   // G1, G1, F1, A1: one a bar
  for (let b = 0; b * spb < dur; b++) {
    const t = b * spb;
    kick(t); hat(t + spb / 2);
    if (b % 2 === 0) bass(t, roots[Math.floor(b / 4) % roots.length]);
  }
  return ac.startRendering();
}
