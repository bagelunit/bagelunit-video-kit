---
name: video-setup
description: The first step after installing the BagelUnit Video Kit, run from the kit's own folder. Makes a new YouTube channel folder (a copy of template/) where the person chooses, then asks the channel questions and fills it in, so it is ready to make videos. Use on /video-setup in the kit folder, or when the person says "set up a channel", "new YouTube channel", "make a channel folder", "set up the video kit" or "what do I do next" after the kit is installed.
---

# Video setup: a new channel folder

Each YouTube channel gets its own folder (`<channel>-videos`): its own name, topic, voice, colours, cleared facts, YouTube sign-in and videos. Ask every question with the AskUserQuestion tool, the recommended option first with "(Recommended)".

1. **Check the kit.** `node ~/.claude/skills/bagelunit-video/tools/video.mjs doctor`. If the skill or the Reel Kit engine is missing, say which command fixes it (`bash setup/install.sh` here, or in the Reel Kit) and stop.
2. **The channel's name**, and **where its folder goes** (AskUserQuestion, the best guess first, Other for typing). Offer: a project folder the person already uses (if a `.nosync` project folder exists for heavy files, suggest `<project>/<project>.nosync/Videos/`), `~/Videos/`, or Other. The folder is named `<channel>-videos`. Say once that renders are large (about 65 MB a minute while a video is built) and that a folder ending in `.nosync` is not backed up by iCloud.
3. **Start from a reels brand?** If the person has a BagelUnit Reel Kit brand folder for the same brand, ask with AskUserQuestion ("Start from it (Recommended)", "Start fresh") whether to start from it (its name, niche, colour, voice, voice.md and facts.md are copied, and `video reels` can then make reels there). A different channel or topic starts fresh.
4. **Make it.** Show the dry run first, then make it:
   - `node setup/new-workspace.mjs <folder> [--from-reels <reel brand folder>] --dry-run`
   - `node setup/new-workspace.mjs <folder> [--from-reels <reel brand folder>]`
5. **The channel questions.** Read `<new folder>/.claude/skills/channel-setup/SKILL.md` and ask its questions now, writing the answers into the new folder's `brand/` files.
6. **Then** draw its dashboard (`node ~/.claude/skills/bagelunit-video/tools/video.mjs dashboard <new folder> --open`) and end with the next step, command first: open Claude Code in the new folder and type `/bagelunit-video <topic>` for the first video. YouTube sign-in can wait until the first upload (`SETUP.md` section 5).
