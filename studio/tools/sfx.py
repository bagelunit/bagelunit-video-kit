#!/usr/bin/env python3
"""The video's sound effects as one track, built a minute at a time so an hour-long video needs little memory.

  python3 sfx.py <cues.json> <seconds> <out.wav> [gain dB]

cues.json is [{"t": seconds, "name": "whoosh", "gain": -4}, ...] (written by `video render` from the scenes and chapters).
The effects themselves come from the BagelUnit Reel Kit engine's sound bank (tools/sound.py): every effect is made in
code there, so there is nothing to license, and the same house taste applies (effects about 18 dB under the voice,
crowded cues thinned out); the optional gain lifts them all (video.json "sfx_gain"). Out: a 48 kHz mono float WAV of the effects alone; `video render` mixes it under the voice.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ENGINE = Path(os.environ.get('BAGELUNIT_REEL_ENGINE') or Path.home() / '.claude' / 'skills' / 'bagelunit-reels') / 'tools'
sys.path.insert(0, str(ENGINE))
try:
    import numpy as np
    import sound
except Exception as e:  # the engine or numpy is missing: say so, the render goes on without effects
    print(f'sfx: the Reel Kit sound bank is not available ({e}); rendering without effects', file=sys.stderr)
    raise SystemExit(2)

BLOCK = 60  # seconds per block


def main():
    if len(sys.argv) not in (4, 5):
        print(__doc__)
        raise SystemExit(1)
    cues = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    seconds, out = float(sys.argv[2]), sys.argv[3]
    lift = float(sys.argv[4]) if len(sys.argv) == 5 else 0.0
    rate = sound.RATE
    total = int(rate * seconds)
    kept = sound.thin_out(cues)
    clip_len = len(sound._clock())
    proc = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(rate), '-ac', '1', '-i', '-', '-c:a', 'pcm_f32le', out], stdin=subprocess.PIPE)
    for b0 in range(0, total, rate * BLOCK):
        b1 = min(total, b0 + rate * BLOCK)
        block = np.zeros(b1 - b0, dtype=np.float64)
        for t, effect, gain in kept:
            s = int(t * rate)
            if s >= b1 or s + clip_len <= b0:
                continue
            clip = sound.render_effect(effect) * 10 ** ((min(gain, 0) + lift + sound.BASE_DB) / 20)
            lo, hi = max(s, b0), min(s + clip_len, b1)
            block[lo - b0:hi - b0] += clip[lo - s:hi - s]
        proc.stdin.write(np.clip(block, -1, 1).astype(np.float32).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit('sfx: ffmpeg could not write the effects track')
    print(f'sfx: {len(kept)} effects ({len(cues) - len(kept)} of {len(cues)} cues left out: too close to another)')


if __name__ == '__main__':
    main()
