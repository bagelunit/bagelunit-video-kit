# BagelUnit Video Kit commands

Most of the time you only need these: `/video-setup` (once per channel, in this kit's folder), `/bagelunit-video` with your topic (in a channel folder), `/db` (open the dashboard) and `/video-update` (get the newest kit).

`video <command>` below is `node ~/.claude/skills/bagelunit-video/tools/video.mjs <command>`. Claude runs these for you; they are listed so you know what each step does.

## Set up (in this kit's folder)

| Command | What it does |
|---|---|
| `bash setup/install.sh` | Installs the kit on a Mac or Linux computer: checks ffmpeg and the Reel Kit, installs the skill `bagelunit-video`. Run it again after every update. |
| `node setup/install.mjs` | The same installer, for Windows (it works on every system). `--link` links instead of copying, for people who change the kit. |
| `/video-setup` | Makes a new YouTube channel folder and asks the channel questions. Once per channel. |
| `/video-update` | In a channel folder: updates the kit and this folder to the newest build (dry run first, then `video update --apply`). Same as `video update` below. |
| `node setup/new-workspace.mjs <folder> [--from-reels <reel brand folder>]` | Makes a channel folder from the command line (it becomes `<channel>-videos`); `--dry-run` shows it first. |

## In a channel folder

| Command | What it does |
|---|---|
| `/bagelunit-video <topic>` | Makes a video: style, research, a report and map for your go-ahead, script, fact check, voice, render, checks, your yes, upload. |
| `/bagelunit-video <video name>` | Carries on with a video from its next step. |
| `/channel-setup` | Sets up or changes the channel: name, topic, YouTube channel, voice, colour, styles, call to action, reels folder. |
| `/db` | Redraws and opens the channel's dashboard (`video dashboard --open`) and says what it shows. |
| `/video-update` | Updates the kit and this channel folder to the newest build: a dry run, your yes, then `video update --apply`. |

## The engine (Claude runs these)

| Command | What it does |
|---|---|
| `video doctor` | What is installed and what is missing, with the fix for each. |
| `video styles [<style>]` | The 20 scene styles, or one style's templates. |
| `video new <name> --style <id> --title "..."` | Starts a video folder (in a channel folder: `videos/<name>`), with an empty research page. |
| `video facts <video> [--scope script\|final]` | The fact check: every number said or shown must be in research.md or the channel's facts.md. Writes a worksheet to re-read the sources. |
| `video facts <video> record --result PASS\|FAIL` | Records the verdict after the sources were re-read (PASS is refused while there are errors). |
| `video approve <video> map\|final [--watched]` | Records your go-ahead: the map (the voice waits for it) or the finished video (the upload waits for it). `--watched` records that you watched the whole final cut; the upload needs it. The final approval also refuses while `video licensed check` fails or the credits block is missing, and records the licensed assets with their credits. |
| `video voice <video>` | Voices the script in pieces after checking your credits; a piece already paid for is reused. `"voice_speed"` in video.json sets the pace. A scene's `"pause": 4` puts that much silence in the voice at its start (a brand intro, a breath). Warns if the word clock runs past the audio. |
| `video revoice <video> --line "old words" --to "new words" [--vertical] [--apply] [--use]` | Voices one line again with the sentence before it as a lead-in (so it keeps the episode's pace), then cuts the lead-in off and splices the line into a copy of the voice. A dry run first (what it would send, in characters); `--apply` voices it (once); `--use` makes the copy the voice. `--vertical` changes the vertical (Instagram) voice only. Prints words per second against the episode and warns past 20%. |
| `video stand-in <video>` | A free tone in place of the voice, for previews and tests (never uploaded). |
| `video plan <video>` | Each scene's time, from the voice. |
| `video check <video>` | Draws every scene: errors, anything outside the safe area, stills to look at. |
| `video render <video> [--scene n] [--force]` | Renders the changed scenes (a scene that only moved in time keeps its render), joins them, mixes voice, music and sound effects: `out/video.mp4` and the chapters. `"music_fade": [in, out]` fades the music (default: a 3 s fade-out at the end); `"end_card": 15` runs the picture on after the voice for YouTube's end screen. |
| `video thumbnail <video> [--text "WORDS *ONE*"] [--plain] [--name b \| --use b]` | The thumbnail (1280x720): a frame, with words in heavy capitals (`--plain`: all white, no accent-coloured word); versions for YouTube's thumbnail test. |
| `video captions <video>` | Writes `out/captions.<lang>.srt` from the voice's word clock (2 lines of 42 characters at most). The upload adds it to the video. |
| `video qa <video>` | Checks the finished file: size, frame rate, length, loudness, black or still stretches, a real voice. |
| `video youtube login [--client <downloaded.json> [--all]] [--upload-only]` | Signs in this channel's YouTube account (once per channel; SETUP.md section 5), with permission to upload and to manage the channel (captions). `--upload-only` asks for uploading only (no captions). `--client` first installs Google's downloaded client file for this channel (`--all`: for every channel) and deletes the download. |
| `video youtube upload <video> [--yes] [--privacy private\|unlisted\|public]` | A dry run that lists every problem and shows the pinned comment; `--yes` uploads it (private by default; scheduled with `"publish_at"`), with the tags, language and the research sources in the description, sets the thumbnail, adds the captions, never sends the same video twice, and warns loudly if YouTube put it on a channel other than `youtube.channel_id`. It needs your final approval with `--watched`. The pinned comment is yours to post. |
| `video youtube captions <video>` | Adds `out/captions.<lang>.srt` to a video already uploaded (skips a file already added unchanged). |
| `video reels <video> [--pick 3-5] [--apply]` | Suggests the stretches that would stand alone as reels; makes Reel Kit reel folders from the ones you pick. |
| `video review <channel folder> <export.csv ...>` | A review of the channel from YouTube Studio's CSV exports (Advanced mode, Export current view): `reviews/<date>.md` with observations, hypotheses and up to 5 tests for the next video. Without an export it says which one to download; it never guesses a number. |
| `video dashboard [--credits] [--open]` | Draws the channel's dashboard (with a link to the newest channel review); `--credits` reads your ElevenLabs characters left. |
| `video sources <video> [--no-archive] [--no-doi]` | Looks up every DOI in the research, script and description at Crossref (its real title, first author and year, so a wrong DOI is easy to see; an unknown DOI fails), and saves public source links to the Wayback Machine. Writes `source-safety.md`. |
| `video archive <video> --to <remote:path>` | Copies the finished files, the text and the paid voice to an rclone destination, checks the copy by checksum and records it, so `video tidy` knows the episode is safe. `--dry-run` shows it first. |
| `video tidy <video> [--apply]` | Lists, then removes, the build files a render can make again (most of a video's size), warns when the episode is not archived, and says how long the next render will take, since it draws every scene again. |
| `video chapters <video>` | Writes the YouTube chapters again from the scenes. |
| `video update [--apply] [--kit <dir>] [--channel <dir> \| --all] [--no-fetch] [--no-pull] [--no-install]` | Finds the kit clone (recorded at install, `~/dev/bagelunit-video-kit`, or `--kit`), shows this version and build against the clone's and how far it is behind `origin/main` (it runs `git fetch`), what a pull would bring and what would change in the channel folder. `--apply`: `git pull --ff-only` (only when behind and the clone has no uncommitted tracked change; otherwise it stops and says why), runs `bash setup/install.sh` (Windows `node setup/install.mjs`), then replaces the kit-owned channel files (`CLAUDE.md`, `.claude/skills`, `scripts`, `brand/licensed/README.md`) keeping each old one as `<name>.bak-<stamp>`, adds missing starter files, new `brand.json` settings and `.gitignore` lines. Never touches brand values, licensed assets, videos or `CLAUDE.local.md`. |
| `video licensed add <file> --type music\|sfx\|stock-video\|motion-graphic\|lut --title "..." [--artist ...] [--url ...] [--channels a,b] [--credit "..."] [--id slug] [--notes ...] [--move]` | Records an asset you downloaded by hand from Uppbeat: copies it into `brand/licensed/<type>/`, works out its sha256, adds it to `brand/licensed/assets.json`. Refuses a missing file, a duplicate id, a wrong extension, and a LUT that is not a real `.cube`. |
| `video licensed list [--type T]` | Lists the recorded assets with the channels each is safelisted for. |
| `video licensed check [<video>]` | PASS or FAIL for every asset the video uses (recorded, file present, sha256 matches, the channel in its `channels`); with no video, for the whole register. Exit 1 on a FAIL. |
| `video licensed channels <id> a,b` | Sets which channels are safelisted for an asset in Uppbeat (Account, Safelist). |
| `video licensed credits <video>` | Writes (or refreshes) the "Music and assets" credits block at the end of `out/youtube.txt`. |
| `video licensed remove <id> [--keep-file]` | Removes a record and its file. |
