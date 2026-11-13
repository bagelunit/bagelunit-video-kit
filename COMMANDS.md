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
| `video styles [<style>]` | The 19 scene styles, or one style's templates. |
| `video new <name> --style <id> --title "..."` | Starts a video folder (in a channel folder: `videos/<name>`), with an empty research page. |
| `video facts <video> [--scope script\|final]` | The fact check: every number said or shown must be in research.md or the channel's facts.md. Writes a worksheet to re-read the sources. |
| `video facts <video> record --result PASS\|FAIL` | Records the verdict after the sources were re-read (PASS is refused while there are errors). |
| `video approve <video> map\|final` | Records your go-ahead: the map (the voice waits for it) or the finished video (the upload waits for it). |
| `video voice <video>` | Voices the script in pieces after checking your credits; a piece already paid for is reused. `"voice_speed"` in video.json sets the pace. |
| `video stand-in <video>` | A free tone in place of the voice, for previews and tests (never uploaded). |
| `video plan <video>` | Each scene's time, from the voice. |
| `video check <video>` | Draws every scene: errors, anything outside the safe area, stills to look at. |
| `video render <video> [--scene n] [--force]` | Renders the changed scenes, joins them, mixes voice, music and sound effects: `out/video.mp4` and the chapters. |
| `video thumbnail <video> [--text "WORDS *ONE*"] [--name b \| --use b]` | The thumbnail (1280x720): a frame, with words in heavy capitals; versions for YouTube's thumbnail test. |
| `video qa <video>` | Checks the finished file: size, frame rate, length, loudness, black or still stretches, a real voice. |
| `video youtube login [--client <downloaded.json> [--all]]` | Signs in this channel's YouTube account (once per channel; SETUP.md section 5). `--client` first installs Google's downloaded client file for this channel (`--all`: for every channel) and deletes the download. |
| `video youtube upload <video> [--yes] [--privacy private\|unlisted\|public]` | A dry run that lists every problem; `--yes` uploads it (private by default), sets the thumbnail, never sends the same video twice, and warns loudly if YouTube put it on a channel other than `youtube.channel_id`. |
| `video reels <video> [--pick 3-5] [--apply]` | Suggests the stretches that would stand alone as reels; makes Reel Kit reel folders from the ones you pick. |
| `video dashboard [--credits] [--open]` | Draws the channel's dashboard; `--credits` reads your ElevenLabs characters left. |
| `video tidy <video> [--apply]` | Lists, then removes, the build files a render can make again (most of a video's size). |
| `video chapters <video>` | Writes the YouTube chapters again from the scenes. |
