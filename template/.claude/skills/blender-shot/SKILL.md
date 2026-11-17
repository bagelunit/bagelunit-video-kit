---
name: blender-shot
description: >
  Makes a short 3D shot in Blender for a video, of anything: a product, a box or can with a label, a phone showing a screen, a 3D
  title, a prop, a hero object, a model, or a shaded-relief map of a place. Claude writes the shot from a brief, renders one still,
  LOOKS at it, fixes what is wrong, renders a still or a clip into the video's assets/blender/ folder and wires it into a scene as
  your own clip or overlay, then runs the check. Use on /blender-shot, or when the user asks for a 3D object, product shot, phone
  mock-up, 3D title, map or terrain shot for a video.
user-invokable: true
argument-hint: "[what the shot shows] [video name]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: content
---

# Blender shot: any subject, checked by eye before it is placed

Blender renders almost anything. This skill makes one shot per use, from a short brief, and puts it in a video as the owner's own
clip or overlay. A shot is only worth it when it earns its place: say which scene it is for and what it adds.

## Before you start
Inputs: the brief and the video folder (`videos/<name>`; `video new` first if there is none). Outputs: a still or a clip in
`videos/<name>/assets/blender/`, and the scene in `scenes.json` that uses it. Next step: `video check <video>`, then look at the
stills, then carry on with the video (`/bagelunit-video <video name>`).
- Blender is optional and free. Find out with `video doctor` (it prints "Blender 4.2 or newer found", or a note with how to get it).
  If it is missing, say so, give the one command from that note and ask whether to install it; never install it unasked, and the rest
  of the video does not need it.
- The tools are in `brand/library/3d/` (read its `README.md`): `blender_shot.py` (runs a shot on any system; `blender_shot.sh` is the bash
  wrapper), `lib/bb.py` (helpers), `shots/product.py`, `shots/phone.py`, `shots/terrain.py` and `terrain.py` (map data).
- Optional faster path: the official Blender Lab MCP. `claude mcp list` shows a `blender` server when it is installed; it lets Claude
  work in a live Blender and take screenshots. Use it when it is there; the scripts above do not need it and are the reliable path.

## The flow
1. **Brief (three lines).** What the shot shows, what it does in the time of its scene (turn, orbit, push in, float, reveal), and the mood
   (colours from `brand/brand.json`; the helpers read them). Is it a full-frame clip (`"clip"`, an opaque shot with its own background) or an overlay
   over a drawn scene (transparent, `"overlay"`)? Wide 1920x1080 by default; `--vertical` for the vertical version.
2. **Pick or write the shot.** A template if it fits: `shots/product.py` (box or can, optional `--label`), `shots/phone.py` (`--screen`),
   `shots/terrain.py` through `terrain.py` (a place: `--bbox SOUTH,WEST,NORTH,EAST`). Otherwise write `videos/<name>/assets/blender/<shot>.py`
   with `lib/bb.py` (`setup`, `mat`, `mat_image`, `rounded_box`, `cylinder`, `plane`, `text3d`, `import_model`, `blob_shadow`, `studio_lights`,
   `camera`, `orbit`, `push_in`, `smooth`, `render`). Anything an object needs that the library lacks, write inline.
3. **Look before you render the clip.** One frame:
   `python3 brand/library/3d/blender_shot.py brand/library/3d/shots/product.py --video <name> --still 45 [options]` (on Windows `python`; add
   `--size 960x540 --samples 16` for a quick one). Open the `-still.png` it writes and check: subject centred and not cut off, colours match the
   brand (not washed out), nothing floating above its shadow, text readable and spelled right, no intersecting parts, a screen's picture at its
   true colours. A transparent still shows white in some viewers; lay it over the colour it will sit on if in doubt. Fix and render again.
   Up to 3 rounds; then show the owner what blocks it.
4. **Render the clip.** `--clip name.mov` (ProRes 4444 with alpha, for an overlay), `--clip name.webm`, or `--mp4 name.mp4` (opaque, for a full-frame
   clip; the background is `--bg HEX`). `--seconds` sets the length (a scene's length comes from its narration, so match it; a clip shorter
   than its scene holds its last frame). Check the first, middle and last frames.
5. **Wire it in.** A full-frame cutaway: a scene `{"clip": {"file": "assets/blender/name.mp4", "start": 0, "duration": 6}, "narration": "..."}`.
   Over a drawn scene: `"overlay": {"file": "assets/blender/name.mov", "blend": "normal", "at": 1, "duration": 4}`. The path is relative to the video folder
   (or to `brand/library/`) and stays inside the channel folder. It is your own render: no licensed-asset record, no credit line. Then
   `video check <video>` (a missing file is reported there) and look at the stills.
6. **Thumbnail (optional).** A still can be the thumbnail's picture: `video thumbnail <video> --image assets/blender/name-still.png --text "2 TO 5 *WORDS*"`.

## Maps (terrain shots)
`python3 brand/library/3d/terrain.py --bbox SOUTH,WEST,NORTH,EAST --video <name> --still 30 [--label "Name@lat,lon"] [--ramp earth|mono|snow|heat] [--sea-level 0] [--move orbit|push]`.
- It is the only step of the kit that uses the network, and only on this command: it downloads free elevation tiles (no key), a few at a time, into the video's
  `assets/blender/.tiles/` and reuses them next time. Say that to the owner before the first run in a video. `--data-only` fetches without rendering;
  `--from-dir` renders saved data with no network.
- **The attribution is required.** It writes `ATTRIBUTION.txt` next to the render and prints it: add it to `out/youtube.txt` (the description) before the final
  approval, and say it is in. Labels are facts on screen: every name and place must be in `research.md` or `brand/facts.md`.
- Pick the box so the subject fills the frame; a wide box at 2048 px is about 100 m per pixel, a small one is sharper. Raise `--exaggeration` for flat ground.

## Rules
- **Colours:** always through the helpers (`bb.rgba`, `bb.mat`): Blender wants linear colour, and a straight sRGB hex looks washed out.
- **Other people's work:** only your own models, or ones whose licence allows it (CC0 is the safe default); record the source and licence in
  `brand/library/INDEX.md` (make the file if it is missing). Never recreate another company's logo, product or character as an object. A real product
  or screen is first-party evidence: clear each claim on it in `brand/facts.md`.
- **Cost:** a 4-second 1080p clip takes about a minute; physics or smoke much more. Use a small `--size` and few `--samples` for tests and say before a long render.
- **Heavy output** (`assets/blender/`, frames, clips, the tile cache) stays out of git (the channel's `.gitignore` already does).
- No em dashes in anything written.
