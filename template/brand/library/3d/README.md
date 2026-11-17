# 3D shots (Blender)

Short 3D shots made with Blender (free, optional), rendered headless, that sit in a video as your own clip or overlay. Use `/blender-shot`:
it writes the shot from a brief, renders one still, looks at it, fixes it, renders the clip and wires it into the scene. Blender 4.2 or newer
(`video doctor` says whether it is found; `brew install --cask blender`, `winget install BlenderFoundation.Blender` or blender.org).
Without it, nothing else in the kit changes.

Everything is 1920x1080 at 30 fps by default; `--vertical` is 1080x1920, `--size WxH` any size. Output goes to `videos/<name>/assets/blender/`
(kept out of git). A clip or overlay in `scenes.json` names it with `"file"` (your own render: no register entry, no credit):
`{"clip": {"file": "assets/blender/product.mov", "duration": 6}, "narration": "..."}` or `"overlay": {"file": "assets/blender/title.mov"}`.

| File | What it is | When to use it |
|---|---|---|
| `blender_shot.py` | Runs any shot headless on Mac, Windows or Linux, finds Blender, and makes a still (`--still N`), an alpha clip (`--clip x.mov` ProRes 4444, or `.webm`) or an opaque `--mp4 x.mp4`. `--video <name>`, `--vertical`, `--size`, `--fps`, `--seconds`, `--samples`, `--dry-run`. | Every shot: look at a still first, then render the clip. |
| `blender_shot.sh` | The same, for bash (it runs the .py). | Mac and Linux. |
| `lib/bb.py` | The helper library every shot imports: brand colours in linear space, a transparent render, studio lights, a camera on a target, a soft contact shadow, easing, 3D text, model import, and `terrain_shaded_relief`. | Never run alone; import it in any new shot you write. |
| `shots/product.py` | A box or can (optionally with a label image), turning, orbited or floating. | A product or packaging hero. |
| `shots/phone.py` | A phone showing a screen image, tilting or pushing in. | An app or web page on a phone. |
| `shots/terrain.py` | A shaded-relief map from elevation data, with labels, orbited or pushed in on. | A map, a mountain, a coastline, a region. |
| `terrain.py` | Takes a latitude/longitude box, downloads the free Terrain Tiles, builds the data, writes the attribution and runs `shots/terrain.py`. The only part of the kit that uses the network, and only when you run it. | A map shot (`python3 terrain.py --bbox S,W,N,E --video <name> --still 30`). |

Examples (run in this folder; on Windows use `python`):

```
python3 blender_shot.py shots/product.py --video my-video --shape can --still 45
python3 blender_shot.py shots/product.py --video my-video --shape can --clip can.mov
python3 terrain.py --bbox 27.6,85.9,28.3,87.0 --video my-video --label "Everest@27.988,86.925" --clip everest.mov
```

Terrain: the data are the free "Terrain Tiles" (Terrarium PNGs on the AWS open data bucket, no key); the helper fetches only on your command, one tile at a time,
keeps them in `videos/<name>/assets/blender/.tiles/`, caps the size (zoom 14, 36 tiles, 2048 px unless you raise it), writes `ATTRIBUTION.txt` next to the render
and prints it: put it in the video description. Options of the shot are in the header of `shots/terrain.py` (`--ramp`, `--hillshade`, `--sun-azimuth`, `--exaggeration`, `--sea-level`, `--label "Name@lat,lon"`, `--move orbit|push|still`).

Gotchas: colours go through `bb.rgba` (a straight sRGB hex looks washed out); Blender's Python has no PIL (use numpy); a model you import needs a licence that allows it
(CC0 or your own), recorded in `brand/library/INDEX.md`. This folder is the kit's own code and `video update` refreshes it; keep your own shots in `videos/<name>/assets/blender/`
or elsewhere in `brand/library/`.
