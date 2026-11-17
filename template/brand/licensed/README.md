# Licensed material

Music, sound effects, stock video, motion graphics and LUTs can come from any source you have the rights to use. **Uppbeat** (uppbeat.io, Business plan) is the one we use and suggest, but it is only a suggestion. Everything else on screen is original. The kit ships no asset files and never downloads any: you download each one by hand from wherever you license it, and the kit records and uses what you downloaded.

## What is here

| Path | What |
|---|---|
| `assets.json` | the register: one record per asset (id, type, title, artist, link, licence, channels, file, sha256, credit, date) |
| `music/` `sfx/` `stock-video/` `motion-graphic/` `lut/` | the downloaded files, one folder per type; they stay on this computer (git ignores them), `assets.json` is kept |

## Downloading and recording an asset

1. On the site you license it from (for example uppbeat.io), open the track, effect, clip, motion graphic or LUT and download it. For music and sound effects choose **WAV** if the site offers it.
2. If your source has a safelist (in Uppbeat: **Account**, then **Safelist**), add this channel's YouTube channel. Do this before the first upload; the safelist is what keeps YouTube from flagging the music. Licensed material is for **YouTube only** here (not Instagram, TikTok or anything else).
3. Record it from this folder (the file stays where you downloaded it unless you add `--move`):

   `video licensed add ~/Downloads/clear-skies.wav --type music --title "Clear Skies" --artist "Some Artist" --url "https://uppbeat.io/track/..." --source uppbeat --plan business --channels <this channel's slug>`

   It copies the file into `brand/licensed/music/`, works out its sha256, and writes the record. It refuses a missing file and an id that is already used. For a LUT it checks the file is a real `.cube`.
4. `video licensed list` shows what is recorded; `video licensed check` checks every file and hash; `video licensed channels <id> a,b` changes which channels are safelisted; `video licensed remove <id>` removes a record and its file.

## Using it in a video

A video refers to an asset by its id; nothing is typed as a file path.

- Music: `video.json` `"music": [{"asset": "clear-skies", "from": "intro", "fade": 2, "gain_db": -18}]` (`from` is a scene's `"id"` or seconds). It sits under the voice (it ducks while the voice speaks).
- Grade: `"look": {"lut": "warm-film", "strength": 0.6}` (strength 0 to 1, default 1).
- Stock video cutaway: a scene `{"clip": {"asset": "city-aerial", "start": 4, "duration": 6}, "narration": "..."}`. It fills the frame, has no sound, and the scene's time comes from its narration.
- Overlay on any scene: `"overlay": {"asset": "dust-leak", "blend": "screen", "opacity": 0.6, "at": 1.5, "duration": 4}` (`screen` lets a black background drop out; `normal` keeps the alpha of a .mov or .webm).

## Rules

- Licensed video and overlays decorate; they never carry the story. The explanation is the original scenes and the voice.
- Every asset used must be recorded, its file and hash must match, and the channel must be in its `channels`. `video approve <video> final` refuses otherwise.
- The credits go in the YouTube description: `video licensed credits <video>` writes a "Music and assets" block at the end of `out/youtube.txt`, and the final approval records the list.

## Your own renders are not licensed assets

A clip or overlay that is your own work (a Blender render, code) needs no entry here: a scene names it with `"file"` instead of `"asset"`, for example `{"clip": {"file": "assets/blender/product.mp4"}, "narration": "..."}`. The path is relative to the video folder (or `brand/library/`) and must stay inside the channel folder. `video licensed check` ignores these files, they are not in the credits, and they may be used in the vertical version too. See `brand/library/3d/README.md`.
