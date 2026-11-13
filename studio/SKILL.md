---
name: bagelunit-video
description: BagelUnit Video Kit, a studio for long and standard 1920x1080 videos. Turns a topic into an animated explainer (outline, script, voice, scenes, mp4, chapters, thumbnail) in one of 19 scene styles and uploads it to YouTube. Reach for it on any request for a long-form video, a YouTube video, a widescreen or 16:9 explainer, a documentary-style animation, or /bagelunit-video. Vertical reels and Shorts belong to the BagelUnit Reel Kit.
---

# BagelUnit Video Kit

Long and standard videos at 1920x1080, made scene by scene. The rule that splits this kit from the Reel Kit is the picture shape, not the length: wide here, vertical there.

All commands are `node <this skill's folder>/tools/video.mjs <command>` (the folder is `~/.claude/skills/bagelunit-video` once installed; below it is written `video`). `video doctor` says what is installed.

## A video folder

```
video.json     {"style": "<id>", "title": "...", "seed": 1, "voice": {...optional}, "voice_speed": 1, "channel": "default", "privacy": "private"}
outline.md     the plan: promise, chapters, one line per scene
script.txt     the narration, paragraphs between ideas
scenes.json    {"scenes": [{"chapter": "optional title", "template": "<id>", "props": {...}, "narration": "exact words from script.txt"}]}
audio/vo.mp3   the voice (video voice), build/words.json the clock of every word
out/           video.mp4, chapters.txt, thumbnail.jpg, youtube.txt (title on line 1, description after)
```

## The order of work

1. **Choose the style.** `video styles` lists 19; `video styles <id>` lists its templates. Read that style's `styles/<id>/SKILL.md` (art direction), `templates.json` (every template's props) and, for custom scenes, `docs.md`. One style per video. Ask the person when the topic does not decide it.
2. **Start the folder.** `video new <folder> --style <id> --title "..."` writes a sample plan from the style's first three templates. Replace it.
3. **Outline (outline.md).** State the promise of the video in one sentence, then the chapters (3 to 8 for 5 to 15 minutes), then a line per scene: the one point it makes, with the concrete fact, number or example. Open on the hook, never a greeting or "in this video". Put the payoff in the last chapter. Alternate explanation, example, data, story and recap so the picture keeps changing. Only plan claims you are sure are true; no invented statistics, quotes or dates. No real people, other companies' characters or logos: invent names.
4. **Script (script.txt).** Write for the ear: short sentences, one idea per sentence, numbers said the way they are spoken. About 150 words a minute. A blank line between ideas. No filler openings or closings.
5. **Scenes (scenes.json).** One scene per idea, 5 to 15 seconds of narration (the planner flags under 2 s and over 16 s). `narration` is the exact words of script.txt the scene covers, in order, and every word of the script belongs to exactly one scene: times come from the voice's word clock, never from typed numbers. Spread templates; never the same one many times in a row. Mark the first scene of each chapter with `"chapter": "Short title"` (2 to 6 words, specific): these become YouTube chapters (at least 3, the first at 0:00, 10 s apart or more).
6. **Voice.** `video voice <folder>` speaks script.txt in chunks with the Reel Kit's voice tool (a chunk is only paid for once; a re-run after a failure pays only for chunks still missing) and joins them, at natural pace (`"voice_speed"` in video.json changes it, 0.7 to 1.3; reels are sped up, videos are not; set it before the first voice, because a new speed is voiced and paid for again). No key or no credits: `video stand-in <folder>` makes a tone and fake word times so everything else can be built and checked; the render warns loudly while the stand-in is in use, and `youtube upload` refuses it.
7. **Plan and check.** `video plan <folder>` shows each scene's time and what was found in the word clock. `video check <folder>` draws every scene, reports errors, anything outside the title-safe area (5% margin), and whether each scene seeks to the same picture every time, with stills in `build/scenes/check/`. Look at the stills. Fix, then check again.
8. **Render.** `video render <folder>` renders only changed scenes, joins them without re-encoding the picture, mixes the voice (and `music` from video.json, ducked under speech) at -14 LUFS, and writes `out/video.mp4` and `out/chapters.txt`. `--scene n` renders one scene; `--force` renders all.
9. **Thumbnail.** `video thumbnail <folder> [--at seconds | --scene n]` makes `out/thumbnail.jpg` (1280x720). Look at it.
10. **YouTube text.** Write `out/youtube.txt`: the title (100 characters at most, no < or >) on line 1, then the description (the promise, what the viewer learns, no invented claims). Chapters are appended from `out/chapters.txt`.
11. **Upload.** `video youtube login` once (Google Cloud "Desktop app" client; the Reel Kit's docs/connect.md step 6B). Then `video youtube upload <folder>` is a dry run that lists every problem; `--yes` sends it, private by default. Never make a video public without the person saying so. Never upload twice (the kit refuses without `--again`).

## Rules

- Never type scene times; they come from the voice. Never edit `styles/` (copies: edit in the bagelunit-styles repo and sync again).
- The voice key is the person's: never ask for it, print it or store it.
- Everything on screen is original: no real people, no other companies' logos or characters, no outside footage or music. Only music the person owns the rights to goes in `music`.
- Anything scored must reach 90 or more; below that, redo and rescore.
- Report what actually happened: a render with errors is not done; a stand-in voice is not a voice.
- No em dashes in anything written.
