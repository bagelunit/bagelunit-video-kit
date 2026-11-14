# BagelUnit Video Kit commands

Most of the time you only need three: `/video-setup` (once per channel, in this kit's folder), `/bagelunit-video` with your topic (in a channel folder), and `video dashboard --open`.

`video <command>` below is `node ~/.claude/skills/bagelunit-video/tools/video.mjs <command>`. Claude runs these for you; they are listed so you know what each step does.

## Set up (in this kit's folder)

| Command | What it does |
|---|---|
| `bash setup/install.sh` | Installs the kit on a Mac or Linux computer: checks ffmpeg and the Reel Kit, installs the skill `bagelunit-video`. Run it again after every update. |
| `node setup/install.mjs` | The same installer, for Windows (it works on every system). `--link` links instead of copying, for people who change the kit. |
| `/video-setup` | Makes a new YouTube channel folder and asks the channel questions. Once per channel. |
| `node setup/new-workspace.mjs <folder> [--from-reels <reel brand folder>]` | Makes a channel folder from the command line (it becomes `<channel>-videos`); `--dry-run` shows it first. |

## In a channel folder

| Command | What it does |
|---|---|
| `/bagelunit-video <topic>` | Makes a video: style, research, a report and map for your go-ahead, script, fact check, voice, render, checks, your yes, upload. |
| `/bagelunit-video <video name>` | Carries on with a video from its next step. |
| `/channel-setup` | Sets up or changes the channel: name, topic, YouTube channel, voice, colour, styles, call to action, reels folder. |

## The engine (Claude runs these)

| Command | What it does |
|---|---|
| `video doctor` | What is installed and what is missing, with the fix for each. |
| `video styles [<style>]` | The 20 scene styles, or one style's templates. |
| `video new <name> --style <id> --title "..."` | Starts a video folder (in a channel folder: `videos/<name>`), with an empty research page. |
| `video facts <video> [--scope script\|final]` | The fact check: every number said or shown must be in research.md or the channel's facts.md. Writes a worksheet to re-read the sources. |
| `video facts <video> record --result PASS\|FAIL` | Records the verdict after the sources were re-read (PASS is refused while there are errors). |
| `video approve <video> map\|final [--watched]` | Records your go-ahead: the map (the voice waits for it) or the finished video (the upload waits for it). `--watched` records that you watched the whole final cut; the upload needs it. |
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
| `video tidy <video> [--apply]` | Lists, then removes, the build files a render can make again (most of a video's size), and says how long the next render will take, since it draws every scene again. |
| `video chapters <video>` | Writes the YouTube chapters again from the scenes. |
