# Licensed material

Music, sound effects, stock video, motion graphics, LUTs and generated shots can come from any source you have the rights to use. **Uppbeat** (uppbeat.io, Business plan) is the one we use and suggest, but it is only a suggestion. Everything else on screen is original. The kit ships no asset files and never downloads any: you download each one by hand from wherever you license it, and the kit records and uses what you downloaded.

## What is here

| Path | What |
|---|---|
| `assets.json` | the register: one record per asset (id, type, title, artist, link, licence, channels, file, sha256, credit, date) |
| `music/` `sfx/` `stock-video/` `motion-graphic/` `lut/` `generated-video/` `generated-image/` | the downloaded files, one folder per type; they stay on this computer (git ignores them), `assets.json` is kept |

## Downloading and recording an asset

1. On the site you license it from (for example uppbeat.io), open the track, effect, clip, motion graphic or LUT and download it. For music and sound effects choose **WAV** if the site offers it.
2. If your source has a safelist (in Uppbeat: **Account**, then **Safelist**), add this channel's YouTube channel. Do this before the first upload; the safelist is what keeps YouTube from flagging the music. Licensed material is for **YouTube only** here (not Instagram, TikTok or anything else).
3. Record it from this folder (the file stays where you downloaded it unless you add `--move`):

   `video licensed add ~/Downloads/clear-skies.wav --type music --title "Clear Skies" --artist "Some Artist" --url "https://uppbeat.io/track/..." --source uppbeat --plan business --channels <this channel's slug>`

   It copies the file into `brand/licensed/music/`, works out its sha256, and writes the record. It refuses a missing file and an id that is already used. For a LUT it checks the file is a real `.cube`.
4. `video licensed list` shows what is recorded; `video licensed check` checks every file and hash; `video licensed channels <id> a,b` changes which channels are safelisted; `video licensed remove <id>` removes a record and its file.

## Generated shots (optional)

A clip or a still made by an AI generator is recorded here too, as `generated-video` or `generated-image`. Any generator works (Higgsfield is the one we suggest, Canva, Adobe Firefly or anything else is fine) and none is required: a video is complete without one. `/generated-shots` walks through it. Record the file you downloaded:

`video licensed add ~/Downloads/lighthouse.mp4 --type generated-video --tool "Higgsfield" --prompt "a lighthouse at dusk, slow push in" --title "Lighthouse"`

- `--tool` is required (what made it). `--prompt` is optional. `--title` may be left out (the file name is used).
- **The on-screen label.** The record carries `onscreen_label`: `Re-creation` for a generated video, `AI-generated` for an image. Change it with `--onscreen-label "AI-generated re-creation"`. The video must show that text on screen (in a drawn scene's text), or `video approve <video> final` refuses, and nothing overrides that. An empty label is only allowed with `--no-label "why none is needed"` (for example an abstract texture that looks like nothing real); the reason is recorded as `no_label_reason` and shown in the credits and the approval.
- **YouTube only by default**, like the rest of this folder. `--vertical-ok` records that a generated asset may also be used in the vertical (Instagram) version; a licensed asset never can.
- A generated asset has no safelist: the `channels` rule is only for licensed music and clips.
- The credits block and the approval say `[generated with TOOL; on-screen label "X"]`.
- Rules: label every re-creation on screen; a generated shot never carries the story (the voice and the drawn scenes do); no real people, no lookalikes and no other brand's logos; check the provider's terms for commercial use on your plan.

## Using it in a video

A video refers to an asset by its id; nothing is typed as a file path.

- Music: `video.json` `"music": [{"asset": "clear-skies", "from": "intro", "fade": 2, "gain_db": -18}]` (`from` is a scene's `"id"` or seconds). It sits under the voice (it ducks while the voice speaks).
- Grade: `"look": {"lut": "warm-film", "strength": 0.6}` (strength 0 to 1, default 1).
- Stock video cutaway (a `generated-video` asset works the same way): a scene `{"clip": {"asset": "city-aerial", "start": 4, "duration": 6}, "narration": "..."}`. It fills the frame, has no sound, and the scene's time comes from its narration.
- Overlay on any scene (a `motion-graphic`, `generated-video` or `generated-image` asset): `"overlay": {"asset": "dust-leak", "blend": "screen", "opacity": 0.6, "at": 1.5, "duration": 4}` (`screen` lets a black background drop out; `normal` keeps the alpha of a .mov or .webm).

## Rules

- Licensed video and overlays decorate; they never carry the story. The explanation is the original scenes and the voice.
- Every asset used must be recorded, its file and hash must match, and the channel must be in its `channels` (generated assets need no safelist, but their on-screen label must be on screen). `video approve <video> final` refuses otherwise.
- The credits go in the YouTube description: `video licensed credits <video>` writes a "Music and assets" block at the end of `out/youtube.txt`, and the final approval records the list.

## Your own renders are not licensed assets

A clip or overlay that is your own work (a Blender render, code) needs no entry here: a scene names it with `"file"` instead of `"asset"`, for example `{"clip": {"file": "assets/blender/product.mp4"}, "narration": "..."}`. The path is relative to the video folder (or `brand/library/`) and must stay inside the channel folder. `video licensed check` ignores these files, they are not in the credits, and they may be used in the vertical version too. See `brand/library/3d/README.md`.
