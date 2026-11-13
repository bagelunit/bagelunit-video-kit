# BagelUnit Video Kit

Turns a topic into a long or standard 1920x1080 video: outline, script, voice, animated scenes in one of 19 styles, chapters, thumbnail, and a YouTube upload. The BagelUnit Reel Kit makes the vertical videos; this kit makes the wide ones.

## Set up

1. Install the BagelUnit Reel Kit first (it provides the voice tool, the headless browser and the fonts).
2. `bash setup/install.sh` (Windows: `node setup/install.mjs`). It checks ffmpeg and the Reel Kit engine and installs the skill `bagelunit-video`.
3. `node ~/.claude/skills/bagelunit-video/tools/video.mjs doctor` shows anything missing.

A real voice needs the ElevenLabs key file from the Reel Kit setup. Without it, `video stand-in` makes a tone so everything else can be built and checked.

## Make a video

Open Claude Code in the folder where the video should live and type `/bagelunit-video`. It follows `studio/SKILL.md`: pick a style, research the topic (every fact with its source, in `research.md`), then a report and a map of the video from start to end for you to approve, with a suggestion to split it into parts if it runs long. Only after your go-ahead: script, scenes, voice, check, render, thumbnail, YouTube text, upload. There is no length limit. The upload is a dry run until you add `--yes`, and it is private by default.

## Parts

| Folder | What |
|---|---|
| `studio/SKILL.md` | the work order Claude follows |
| `studio/tools/` | `video.mjs` (commands), `scenes.mjs` (planner and renderer), `youtube.mjs` (sign-in and upload) |
| `studio/styles/` | the 19 scene styles (wide), copied from the bagelunit-styles repo by its sync script |
| `setup/` | installer, repo scan, tests |
