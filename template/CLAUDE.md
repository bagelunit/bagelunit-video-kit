# A YouTube channel folder (BagelUnit Video Kit)

This folder is ONE YouTube channel: its own name, topic, voice, colours, cleared facts and YouTube sign-in, and every video made for it. It was made from the BagelUnit Video Kit's `template/` (by `/video-setup` in the kit's folder, or `node setup/new-workspace.mjs`). Another channel gets its own folder; never mix two channels in one.

The engine is the skill `bagelunit-video`, installed once per computer at `~/.claude/skills/bagelunit-video`. Below, `video <command>` means `node ~/.claude/skills/bagelunit-video/tools/video.mjs <command>` (on Windows `python` where a step says `python3`, and `~` is your home folder).

**Point to the command.** Every next step you give the owner names its command first: `/bagelunit-video <topic>`, `/channel-setup`, `video dashboard --open`, `video youtube login`. Ask every question with the AskUserQuestion tool (the block with options and "Other"), the recommended option first.

## 0. First run

At the start of a session, read `brand/brand.json`. If `"name"` is empty, the channel is not set up yet: before any video, run `/channel-setup` (its questions are in `.claude/skills/channel-setup/SKILL.md`). If the owner asks for a video first, say in one line that the channel comes first and start the questions.

## 1. What is where

| Path | What |
|---|---|
| `brand/brand.json` | the channel: name, slug, niche, YouTube channel, accent colour, voice, the usual and never styles, call to action, `reels_folder` |
| `brand/voice.md` | how the channel talks; read before every outline and script |
| `brand/facts.md` | facts the owner cleared for this channel, and the "Never say" list (the fact check reads both) |
| `videos/<name>/` | one folder per video: research, map, script, scenes, voice, renders, approvals (the work order is the skill's `SKILL.md`) |
| `brand/licensed/` | licensed material from any source you have rights to (Uppbeat is what we use and suggest): `assets.json` (the register), `README.md` (how to download by hand and record), the files by type |
| `brand/library/3d/` | the kit's Blender library (`blender_shot.py`, `lib/bb.py`, `shots/`, `terrain.py`; read its `README.md`); `video update` refreshes it. Renders go to `videos/<name>/assets/blender/` (not in git) |
| `brand/brand.json` `tools` | which optional outside tools the owner has, said no to or dismissed (`/suggested-tools`, `video suggest`); `brand/.tips.json` remembers when a tip was last shown (not in git) |
| `scripts/nightly-backup.sh` | a backup template (not scheduled): `video archive` on every video to an rclone destination; read its top lines, set `BAGELUNIT_BACKUP_TO` |
| `videos/video-dashboard.html` | the dashboard (`video dashboard --open`); it redraws itself after every command that changes a video |

Skills in this folder (type the command):

| Command | What it does |
|---|---|
| `/bagelunit-video <topic>` | makes a video, or carries one on (section 2) |
| `/channel-setup` | sets up or changes this channel |
| `/blender-shot <what>` | makes a 3D shot (a product, a map, a prop, a title) in Blender, looks at a still, renders it into the video's `assets/blender/` and wires it in as `"clip": {"file": ...}` or an `overlay`, then `video check` (Blender is optional; `video doctor` says if it is found) |
| `/suggested-tools` | shows the optional outside tools and what each adds, asks which the owner has (selectable questions), records the answers in `brand/brand.json`, walks through connecting them; none is required (`video suggest`) |
| `/db` | redraws and opens the dashboard (`video dashboard --open`) |
| `/video-update` | updates the kit and this folder to the newest build (`video update`, a dry run first, then `--apply`) |

## 2. Making a video

- **New video:** `/bagelunit-video <topic>`. Claude picks a style from the channel's usual ones, researches, then stops with a report and a map for the owner's go-ahead. Nothing is voiced before the map is approved, and nothing is uploaded before the final video is approved.
- **Carry on with one:** `/bagelunit-video <video name>`; the dashboard's card shows each video's next step and command.
- **Ideas:** the channel's niche and search terms in `brand/brand.json` are where topics come from. Never invent a statistic, a quote or a date; every number on screen or in the voice comes from the video's `research.md` or `brand/facts.md`.
- **Reels from a video:** only when `reels_folder` in `brand/brand.json` points at a BagelUnit Reel Kit brand folder: `video reels <video>` suggests the stretches, `--pick` and `--apply` make the reels there.
- **3D shots and maps (optional):** `/blender-shot` makes a Blender shot (a product, a prop, a title, a map) as the owner's own clip or overlay. Blender is free and optional; never required and never installed without asking. A map (`brand/library/3d/terrain.py`) downloads free elevation tiles: the one place the kit uses the network, only on that command; tell the owner first, and put the attribution it writes in the video description.
- **Thumbnail from a still:** `video thumbnail <video> --image assets/blender/<name>-still.png --text "..."` uses your own picture instead of a scene frame.

## 3. YouTube

- **One sign-in per channel.** From this folder, `video youtube login` signs in the Google account that owns this channel and saves it under this channel's slug (`~/.config/bagelunit-video/youtube-<slug>.json`, never printed). The steps for the Google Cloud client are in the kit's `SETUP.md` section 5. Web steps are done in the owner's browser with Claude in Chrome: the owner logs in, makes the clicks that are theirs and downloads Google's client file, which Claude moves into place without opening it; Claude never types a password or a secret.
- **Uploads are private by default** (`youtube.privacy` in brand.json, or `"privacy"` in a video's video.json). Making a video public, unlisted or scheduled is always the owner's say-so. The upload is a dry run until `--yes`, needs the final approval of the exact files, and never sends the same video twice.

## 4. Rules that always stay on

1. Never ask for, print or store a key or a token. **Outside tools are only suggestions, never requirements** (ElevenLabs, Uppbeat, Epidemic Sound, Blender, Higgsfield, Canva, Adobe and others): the kit works on pure code rendering, the owner can connect whatever they like, and you never push one. Offer them with `/suggested-tools` (`video suggest`), once, with selectable questions. The ElevenLabs key is the owner's, in the file the Reel Kit setup made (ElevenLabs is a suggested voice service; other providers can be connected).
2. Everything on screen is original: no real people, no other companies' logos or characters, no outside footage or music. The one exception is licensed material (music, sound effects, stock video, motion graphics, LUTs) from any source you have the rights to; Uppbeat is the one we use and suggest, not the only one. It goes in only through `brand/licensed/`: the owner downloads it by hand, every asset is recorded (`video licensed add`, with `--source` and `--plan`), the channel is safelisted with the source before a YouTube upload if the source has a safelist (Uppbeat: Account, Safelist), and it is used by id (`brand/licensed/README.md`). Licensed video and overlays decorate; they never carry the story. `video approve ... final` refuses while `video licensed check` fails. Licensed material is for YouTube only. Your own Blender or code renders are different: they are yours, so a scene names them with `"file"` (no record, no credit) and they may carry the story; they stay inside the channel folder.
3. Report what actually happened: a render with errors is not done, a stand-in voice is not a voice, a fact check that was not re-read is not a PASS.
4. Anything scored must reach 90 or more; below that, redo and rescore.
5. No em dashes in anything written.

Rules for this channel only (for example "always use the comic style") go in `CLAUDE.local.md` in this folder (create it if missing); kit updates never touch it.
