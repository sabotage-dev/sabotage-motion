# The voice in this example

The voice in `clip.mp4` (its sound) is synthetic: it is the take from the `explainer-beat` example, copied here so its
licence travels with it, and laid under the clip 0.5 s in (`make-clip.mjs`). It comes from an openly licensed text-to-speech model, run locally and free, with no account
and no API. It is not a recording of any person.

| | |
|---|---|
| Engine | Kokoro-82M v1.0, through the `kokoro` Python package 0.9.4 (github.com/hexgrad/kokoro), run on a laptop CPU |
| Voice | `af_heart` (American English), one of the voices that ship with the model |
| Licence | Apache License 2.0, for the model weights and the voices; it allows redistribution. A copy is in `LICENSE-voice.txt` |
| Licence URL | https://www.apache.org/licenses/LICENSE-2.0 |
| Model card | https://huggingface.co/hexgrad/Kokoro-82M (states `license: apache-2.0`) |
| `take.json` source | `kokoro` (the `explainer-beat` example's `take.json`; here its words, 0.5 s later, are `transcript.json`) |

The take is shipped under the same Apache License 2.0 (`LICENSE-voice.txt`). Its text is the `explainer-beat` board's three `vo`
lines (`board.js`), joined in order, as `tools/cues.mjs` joins them.

## How the take and its timings were made

Kokoro predicts how long each sound lasts before it renders any audio, and the `kokoro` package reports those
predictions as a start and an end time for every word it speaks (`start_ts`, `end_ts`). Those are the timings in
`take.json`: no transcription or alignment pass was needed. Punctuation joins the word before it, as
`tools/cues.mjs` expects. The file is in the generic `words` format (`references/voice.md`), with `source` set to
`kokoro`, so `node tools/cues.mjs` reads it with no adapter.

To make it again, in the `explainer-beat` example's folder (the timings come out the same; the audio differs very slightly from run to run, because the
model's decoder adds a little random noise):

```sh
uv venv /tmp/tts --python 3.12          # any Python 3.10-3.12 environment outside the piece
uv pip install --python /tmp/tts/bin/python kokoro==0.9.4 soundfile \
  "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"
node -e "import('./lib.js').then((l) => process.stdout.write(l.boardScript(l.BOARD)))" > script.txt
/tmp/tts/bin/python kokoro_take.py af_heart script.txt .
node tools/cues.mjs                     # cues.js, cues.json and vo.wav from take.json and take-raw.wav
```

`kokoro_take.py` (not shipped; it is short):

```python
import json, sys
import numpy as np, soundfile as sf
from kokoro import KPipeline

voice, script, out = sys.argv[1], open(sys.argv[2]).read().strip(), sys.argv[3]
SR, audio, words, t0 = 24000, [], [], 0.0
for r in KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M')(script, voice=voice, speed=1.0, split_pattern=None):
    for tk in r.tokens:
        if tk.start_ts is None or tk.end_ts is None:
            continue
        if not any(ch.isalnum() for ch in tk.text):          # punctuation joins the word before it
            if words: words[-1]['text'] += tk.text
            continue
        words.append({'text': tk.text, 'start': round(t0 + tk.start_ts, 4), 'end': round(t0 + tk.end_ts, 4)})
    a = np.asarray(r.audio); audio.append(a); t0 += len(a) / SR
pcm = np.concatenate(audio)
sf.write(f'{out}/take-raw.wav', pcm, SR, subtype='PCM_16')
json.dump({'source': 'kokoro', 'voice': voice, 'duration': round(len(pcm) / SR, 4), 'sampleRate': SR, 'words': words},
          open(f'{out}/take.json', 'w'), indent=1)
```

The first run downloads the model and the voice (about 330 MB) from the model card's repository.

## How well the timings fit the audio

Measured on this take, in the `explainer-beat` example (`node tools/cues.mjs` refuses a `gapBefore` that would cut speech, and it accepted the
0.35 s gap before "Blend": the quietest 10 ms in that pause is below -50 dBFS). The hook line ends 3.75 s into the
take; with `VO_OFFSET` 0.10 s that is 3.85 s of picture time, inside the board's `hookMax` of 4.0 s.
