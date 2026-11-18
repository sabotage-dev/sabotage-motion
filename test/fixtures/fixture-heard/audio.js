// Stems that audio_spike judges differently alone and summed (P11b round 1, G1), as plain sample buffers:
//   stems=a  effects: a quiet tone with one loud hit at 1.0 s (a spike alone); bed: a steady loud tone (it masks the hit)
//   stems=b  effects: a steady loud tone (it masks the click); bed: a quiet tone with one click at 1.5 s (a spike alone)
const fill = (buf, f) => { for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = f(i, i / buf.sampleRate); } return buf; };
const tone = (amp, hz) => (i, t) => amp * Math.sin(2 * Math.PI * hz * t);
const hit = (at, amp, len) => (i, t) => (t >= at && t < at + len ? amp * Math.sin(2 * Math.PI * 90 * t) : 0);
const both = (f, g) => (i, t) => f(i, t) + g(i, t);
export async function renderAudio({ CFG, params = {}, dur = CFG.DUR, sr = 48000 }) {
  const buf = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(sr * dur), sampleRate: sr });
  return fill(buf, params.stems === 'b' ? tone(0.4, 220) : both(tone(0.01, 330), hit(1.0, 0.9, 0.01)));
}
export async function renderBed({ CFG, params = {}, dur = CFG.DUR, sr = 48000 }) {
  const buf = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(sr * dur), sampleRate: sr });
  return fill(buf, params.stems === 'b' ? both(tone(0.004, 330), hit(1.5, 0.9, 0.005)) : tone(0.6, 110));
}
