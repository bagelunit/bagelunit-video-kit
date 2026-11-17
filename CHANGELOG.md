# Changelog

## 1.1.0

**Optional tools: suggested, never required** (the kit works on pure code rendering)
- `video suggest`: a catalog (`studio/suggestions.json`) of optional outside tools by category: voice (ElevenLabs, another voice service), music and effects (Uppbeat, Epidemic Sound), 3D (Blender with the Blender Lab MCP), generated video (Higgsfield, another tool) and design (Canva, Adobe Firefly or Express, the Adobe connector for Claude). Each has what it adds, a concrete example, the connect steps and its site (no prices). `video suggest <id>` shows one in detail, `--json` is for scripts.
- Status is found from existence checks only: a program on PATH or at a known path, a key file that exists (never read or printed), a connector named in `claude mcp list` (skipped when `claude` is missing), a licensed-register entry, and your own answer. No network, no telemetry.
- Your answers go in the channel's `brand/brand.json` as `tools` (`have`, `none`, `other`, `dismissed`, `asked`, `tips`): `video suggest --have a,b`, `--none`, `--later`, `--other "text"`, `--dismiss <id>`, `--undismiss <id>` (read, merge, atomic write, other keys kept).
- Tips: one short `Tip:` line on stderr at `video new`, `video thumbnail`, `video render` and `video voice` when a tool would help and is not connected, declared or dismissed. At most one per command, the same tool at most once in 7 days (`brand/.tips.json`, ignored by git); off with `BAGELUNIT_NO_TIPS=1`, `--no-tips` or `tools.tips=false`. A tip never changes stdout or the exit code.
- `video doctor` says what works without any outside tool and which optional upgrades you could add.
- `/suggested-tools` (channel skill): shows the catalog, asks one selectable question per category (with "I have none of these" and room to type), confirms, records the answers and walks through connecting what you have; says once what the others would add, never pushes. `/channel-setup` asks once near the end ("Show me optional tools that improve results", "Later", "No, pure code is fine").
- Every plain-text question in the skills and the studio's work order is now an AskUserQuestion block (the map go-ahead, the final approval, the style choice, the voice credits, parts, reels, Blender install, kit updates, the channel folder and reels brand).
- Tests: `setup/test-suggest.mjs` (catalog shape, detection with a fake HOME, PATH and `claude`, recording, dismiss, tip rules, no key content printed, JSON shape, doctor), run in CI.

**Blender, your own clips and maps** (optional: Blender is free and never required)
- Your own renders as clips and overlays: a scene's `"clip"` or `"overlay"` takes `{"file": "<path>"}` (a Blender or code render, relative to the video folder or the channel's `brand/library/`) instead of a recorded licensed `"asset"`; exactly one of the two. The file must exist and stay inside the channel folder (an absolute path, `..` or a link that leads out is refused). Its sha256 goes into the scene's cache hash, so a re-rendered file redraws only its own scene. It is not a licensed asset: no register entry, not in the credits, ignored by `video licensed check`, and allowed in the vertical version. `video check` warns about a missing file before the render stops. Same crop/fill, codec, alpha (`.mov` ProRes 4444, `.webm`) and `screen` blend as the licensed versions.
- The channel folder ships a Blender library, `brand/library/3d/`: `blender_shot.py` (any system) and `blender_shot.sh` run a shot headless and make a still (`--still N`), an alpha clip (`--clip x.mov`, `.webm`) or an opaque `--mp4`, 1920x1080 at 30 fps by default (`--vertical`, `--size WxH`, `--fps`, `--seconds`, `--samples`), into `videos/<name>/assets/blender/` (kept out of git). `lib/bb.py` (colours in linear space, setup, materials, rounded box, cylinder, plane, 3D text, model import, contact shadow, studio lights, camera, orbit, push in) and the shots `product.py` and `phone.py`, framed for wide and vertical. `video update` refreshes it with the other kit-owned files; other files in `brand/library/` are left alone.
- `/blender-shot`: a channel skill that renders a still, looks at it, renders the clip into the video's `assets/blender/`, wires it in as a `"file"` clip or overlay and runs `video check`. It mentions the optional Blender Lab MCP as a faster live path.
- Terrain maps: `brand/library/3d/terrain.py --bbox SOUTH,WEST,NORTH,EAST` turns a latitude/longitude box into a 3D shaded-relief render (free Terrain Tiles, no key: stitched, cropped, displaced under a soft sun, with colour ramps, hillshade, sea level, labels, orbit or push in). It is the only code in the kit that uses the network, only on its own command, with a generic User-Agent, a tile cache in the video folder, zoom, tile and size caps, retries and plain errors. It writes `ATTRIBUTION.txt` next to the render (the Tilezen "Required attribution" wording) and prints it for the video description. `--from-dir` renders saved data with no network.
- `video thumbnail <video> --image <file> [--fit cover|contain] [--bg HEX]`: your own picture (a Blender still, any image inside the channel folder; a path outside is refused) as the thumbnail base instead of a scene frame, cropped to 1280x720, with the same text treatment.
- The installer looks for Blender (`BAGELUNIT_BLENDER`, PATH, the standard places on Mac, Windows and Linux), prints its version, and prints a NOTE with how to get it when it is missing or older than 4.2; it never installs or asks. `video doctor` reports it as a note, not an error. `BAGELUNIT_BLENDER_PATHS` replaces the places searched, for tests.
- Tests: `setup/test-blender.mjs` (own-file planning and path safety, ffmpeg pixel checks of own clips and overlays, an own-file scene render, the thumbnail from an image, terrain decode, stitching and tile maths with a stubbed fetch, the installer step, the launcher, and a real Blender render that skips without Blender), in CI on macOS, Ubuntu and Windows.

**Sources, archive and the vertical safe zone** (from the studio's own tools, made general)
- `video sources <video>`: looks up every DOI in the research, script, outline and description at Crossref (DataCite when Crossref does not know it) and lists each one's real title, first author and year, so a wrong DOI on the right claim is easy to see. A DOI that does not exist fails the command. Public source links go to the Wayback Machine (Save Page Now when there is no recent snapshot; `--no-archive` skips it). Writes `source-safety.md` and `source-safety.json`.
- `video archive <video> --to <rclone remote:path>`: copies the finished files, the text and the paid voice with rclone, checks the copy by checksum and records it in `archive.json`. The place can also be `"archive": {"to": ...}` in brand.json or `BAGELUNIT_ARCHIVE_TO`.
- `video tidy` now warns (it does not block) when the episode has no verified archive, and says how to make one.
- `scripts/nightly-backup.sh` in the channel folder: a backup template that archives every video of every channel. It is not scheduled; SETUP.md says how to try it and schedule it yourself.
- The vertical safe zone is the Reel Kit's one zone: top 250, bottom 300, left 60, right 120 pixels (it was bottom 450 with no right margin).

**Update, dashboard and licensed assets**
- `video update` and the channel skill `/video-update`: finds the kit folder (recorded by the installer in the engine's `.install.json`, the folder a linked engine points into, `~/dev/bagelunit-video-kit`, or `--kit`), shows this version and build against the kit's, runs `git fetch` and says how far behind `origin/main` it is, and lists what a pull would bring and what would change in the channel folder. It changes nothing without `--apply`. With `--apply`: `git pull --ff-only` (only when behind and the kit's tracked files have no uncommitted change; otherwise it stops and says why), the installer again (`bash setup/install.sh`, Windows `node setup/install.mjs`, `--link` again for a linked engine), then the channel folder: kit-owned files (`CLAUDE.md`, `.claude/skills`, `scripts`, `brand/licensed/README.md`) are replaced after a `<name>.bak-<stamp>` copy, missing starter files, new `brand.json` settings and `.gitignore` lines are added, and it prints what the folder now needs. Brand values, licensed assets, videos and `CLAUDE.local.md` are never touched. `--all`, `--channel`, `--no-fetch`, `--no-pull`, `--no-install`. New channel folders record the build they came from in `.kit-build`.
- `/db` in a channel folder redraws and opens the dashboard (`video dashboard --open`).
- Licensed material from any source you have the rights to (music, sound effects, stock video, motion graphics, LUTs; YouTube only). Uppbeat (Business plan) is what we use and suggest, not the only source: `--source` and `--plan` on `video licensed add` record where it came from and default to empty. The credits line leaves out parts that are empty. The kit ships no asset file: the channel folder has `brand/licensed/assets.json` (empty), a README, a folder per type, and a `.gitignore` that keeps media out of git. `video licensed add|list|check|channels|credits|remove` records files you download by hand (sha256, safelisted channels, credit text), refuses a missing file, a duplicate id, a path outside `brand/licensed/` and a LUT that is not a real `.cube`.
- A video uses assets by id: `"look": {"lut", "strength"}` (the joined picture through `lut3d`, mixed back by strength), `"music": [{"asset", "from", "fade", "gain_db"}]` (a list of tracks that start at a scene or a time, cross-fade, loop when short and duck under the voice; a plain file path in `"music"` still works), a stock-video scene `{"clip": {"asset", "start", "duration"}, "narration"}` (fills the frame, silent, same codec, timed from its narration), and an `"overlay": {"asset", "blend": "normal|screen", "opacity", "at", "duration"}` on any scene (keeps the alpha of .mov and .webm; `screen` drops black). Changing a clip, an overlay or the recorded file redraws only that scene. `video check` notes a missing LUT or clip file. The vertical (Instagram) version carries none of it.
- `video approve <video> final` refuses while `video licensed check` fails (not recorded, file or hash changed, the channel not safelisted) or the credits block is missing, and records the assets with their credits in `approvals.md` and `build/approvals.json`. `video licensed credits <video>` writes the "Music and assets" block at the end of `out/youtube.txt`.
- Tests: `setup/test-licensed.mjs` (including a real ffmpeg composite of a generated clip, overlays, a LUT and a music bed, and a full render of stock-video scenes) and `setup/test-update.mjs` (temporary git repositories and a stub installer), both in CI.

**Carried from before 1.1.0**

**Vertical full episodes and Instagram-only changes** (from a studio's first episode, 13 November 2026)
- `video check --vertical` and `video render --vertical` draw the whole episode at 1080x1920 in the Reel Kit's safe area, in their own `build/scenes-vertical/`, writing `out/vertical.mp4` without touching the widescreen version, its scene times or its caches.
- A scene's `"vertical": {"props": {...}, "narration": "..."}` changes it for the vertical version only (for example "Like, follow, share" on Instagram), and `audio/vo-vertical.mp3` with `build/words-vertical.json` gives the vertical version its own voice.
- `video revoice <folder> --line "old words" --to "new words"`: re-voices one line with the sentence before it as a lead-in (so it reads at the episode's pace), splices it in, and prints words per second for the new line, the old line and the episode, warning past 20%. Without `--apply` it only shows what it would send and whether it costs anything. The YouTube voice is never overwritten (`--vertical` changes the vertical voice; `--use` makes a revoiced copy the voice and keeps the old one).
- The vertical version's first scene opens built, so frame 0 shows the subject and the title (scene option `"enter"`, styles 1475aae). Deep Zoom keeps big hero objects inside the portrait safe area.
- `video tidy` clears the vertical scratch too (about 5 GB an episode) and says how long the next render will take to draw every scene again, from this folder's past render times.

**Connecting YouTube, rewritten from a real setup** (SETUP.md section 5)
- The steps follow a real setup of six Brand Account channels on one Google account: the project, the API, the consent screen, branding, publishing, the client file, the sign-in, the first-upload check and the limits, in that order.
- Publish the app before anyone signs in: a sign-in made in Testing keeps its 7-day end even after publishing.
- External, not Internal, for YouTube Brand Accounts; check that the consent screen saved ("Testing" and "External") before going on.
- Download Google's client file instead of pasting the secret; the kit reads it as it is. One file can serve every channel on the project.
- `video youtube login --client <downloaded.json>` installs Google's client file as this channel's sign-in file, readable by you only, without printing it, deletes the download and signs in. `--all` installs it for every channel made with `/video-setup`. Given another channel's sign-in file, it takes only the client, never that channel's sign-in.
- What the privacy page needs, with an example.
- The right channel, checked after every upload: the upload permission cannot tell which channel a sign-in belongs to, so YouTube's answer is compared with the new `youtube.channel_id` in `brand/brand.json` (asked by `/channel-setup`). A wrong Brand Account ends with a loud WRONG CHANNEL warning and exit code 1, and the thumbnail is not set. With no ID saved yet, the upload prints the channel it went to.
- The daily limit: about 6 uploads a day per project, shared by every channel on it.

**From a studio running six channels on the kit** (field notes, 13 November 2026)
- A 20th scene style, `deep-zoom`: a 3D, cinematic science-documentary look drawn on one canvas, with bold documentary capitals (hero objects, scale dives, crystal lattices, molecules, particle fields, data and timelines).
- Silence in the voice: `"pause": 4` on a scene puts that many seconds of silence at its start when the voice is joined (a brand intro, an end card, a breath), and moves the word clock after it. A word that would run over the splice is cut at it, so it can never take the silence as its own length. Changing a pause later costs nothing: the voice pieces are reused.
- Fixed: the voice came out 0.45 s short at every join between pieces (the breath between them was dropped while the word clock counted it), so captions and scene cuts ran later and later through a long video. The join now keeps the breath.
- After joining, the word clock is checked against the audio, piece by piece: a clock that runs past the audio is a warning with both times.
- Rendering after a voice change re-draws only the scenes whose own words or length changed. A scene that only moved in time keeps its render; only its clip's sound is made again.
- `video captions <video>`: `out/captions.<lang>.srt` from the word clock, 2 lines of at most 42 characters, a new caption at each sentence and pause, names spelled for the voice written their real way. The language comes from video.json `"language"`, else the channel's `youtube.language`, else English.
- Music: `"music_fade": [in, out]` cuts the music to the video's length with a fade in and out. Without it the music now fades out over the last 3 seconds instead of stopping dead. A track shorter than the video still loops.
- `"end_card": 15` in video.json runs the picture on after the voice for YouTube's end screen; QA accepts the extra length and a still card.
- `video thumbnail --plain` (or `"thumbnail": {"plain": true}`): every word white, no accent-coloured word.
- Fixed: a scene's own `"sfx"` cue in scenes.json was ignored by the render.

**YouTube**
- The sign-in now asks to upload and to manage the channel, so captions can be added; `video youtube login --upload-only` asks for uploading only. A sign-in made before needs `video youtube login` again for captions. SETUP.md says what the permission allows and that it stays on your computer.
- Captions go up with the video; `video youtube captions <video>` adds them to a video already up, never the same file twice. The upload refuses captions made before the voice last changed.
- video.json `"tags"`, `"language"` and `"publish_at"` (scheduled publishing: a time with its offset, private until then). Tags are counted the way YouTube counts them; a language that is not a code, a list that is not a list, or a time without its offset is refused in the dry run.
- The description gets the sources listed in research.md, unless it already names them (`"description_sources": false` turns it off).
- `out/pinned-comment.txt`: a comment to pin, approved and fact-checked with the rest. The dry run shows it; the upload never posts it, you pin it yourself.
- The upload needs your final approval to say you watched the whole final cut: `video approve <video> final --watched`. The dry run shows whether it is recorded.
- `BAGELUNIT_NO_BROWSER=1 video youtube login` prints the sign-in address instead of opening the default browser.
- SETUP.md: switching between Brand Account channels in YouTube Studio, and the caption quota.

**Channel review**
- `video review <channel folder> <export.csv ...>` reads YouTube Studio's own CSV exports (Advanced mode) and writes `reviews/<date>.md`: what the numbers say, each with its video and the video folder it matches, kept apart from what might explain them, small samples and young videos flagged, missing columns named, and up to 5 tests for the next video. It never guesses a number: without an export it says which one to download. The dashboard links the newest review.

## 1.0.0 (12 November 2026): the first public release

Make YouTube videos with Claude Code, long or standard, at 1920x1080. It needs the BagelUnit Reel Kit installed first.

**Channels**
- One folder per YouTube channel, made with `/video-setup`: its own name, topic, voice, colours, cleared facts, YouTube sign-in and videos. Run as many channels as you like; a channel can start from a Reel Kit brand folder.
- `/channel-setup` in a channel folder sets it up or changes it later.

**Making a video** (`/bagelunit-video` with a topic)
- 19 animated scene styles, picked to fit the topic.
- Research first: every fact with its source in `research.md`. Then a report and a map of the video from start to end, title and thumbnail options, the estimated length and what the voice will cost, and nothing more until you say go. Past about 20 minutes it suggests parts; there is no length limit.
- The first 30 seconds follow the triple hook (context, a reason to lean in, a turn they did not expect); chapters open with their own hooks; the video ends on the payoff and your call to action.
- A fact check of every number said or shown (spoken numbers too), before the voice and again before upload.
- The voice at a natural pace, in pieces for long scripts, after a check of your ElevenLabs characters; a piece already paid for is never paid for again.
- Rendering scene by scene, with sound effects made in code on chapter changes and your own music ducked under the voice, at -14 LUFS.
- A quality check of the finished file, YouTube chapters, and thumbnails with words in your accent colour (versions for YouTube's thumbnail test).
- Your yes on the finished video, recorded with a fingerprint of the exact files; the upload refuses anything changed after it.

**YouTube**
- Upload from your computer through YouTube's own API: a dry run first, private by default, the thumbnail set, never the same video twice, resumes if the connection drops. One sign-in per channel.

**Also**
- A dashboard for each channel: what needs you, the numbers (voice characters left, disk free), the work order, every video with its next command, a calendar and a card that plays each video.
- Reels from a video: the stretches that stand alone become Reel Kit reels in the same style, drawn vertical.
- `video tidy` frees the disk once a video is up.

**Tried for real before release:** a 4.6-minute, 24-scene render with music; an 80-minute plan; a real ElevenLabs voice in three pieces, reused without charge on a second run; the quality check, the fact check and both approvals end to end; reels drawn by the Reel Kit. **Not yet tried with a real account:** the YouTube sign-in and upload (tested against a stand-in for YouTube's API).
