---
name: bagelunit-video
description: BagelUnit Video Kit, a studio for long and standard 1920x1080 videos. Turns a topic into a researched, animated explainer (research with sources, a report and map to approve, script, voice, scenes, mp4, chapters, thumbnail) in one of 19 scene styles and uploads it to YouTube. Reach for it on any request for a long-form video, a YouTube video, a widescreen or 16:9 explainer, a documentary-style animation, or /bagelunit-video. Vertical reels and Shorts belong to the BagelUnit Reel Kit.
---

# BagelUnit Video Kit

Long and standard videos at 1920x1080, made scene by scene. The rule that splits this kit from the Reel Kit is the picture shape, not the length: wide here, vertical there.

All commands are `node <this skill's folder>/tools/video.mjs <command>` (the folder is `~/.claude/skills/bagelunit-video` once installed; below it is written `video`). `video doctor` says what is installed.

## A video folder

```
video.json     {"style": "<id>", "title": "...", "seed": 1, "voice": {...optional}, "voice_speed": 1, "channel": "default", "privacy": "private"}
research.md    what the video may claim, each fact with its source (video new writes the empty page)
outline.md     the map: promise, hook, chapters, one line per scene, payoff
script.txt     the narration, paragraphs between ideas
scenes.json    {"scenes": [{"chapter": "optional title", "template": "<id>", "props": {...}, "narration": "exact words from script.txt"}]}
audio/vo.mp3   the voice (video voice), build/words.json the clock of every word
out/           video.mp4, chapters.txt, thumbnail.jpg, youtube.txt (title on line 1, description after)
```

## The order of work

1. **Choose the style.** `video styles` lists 19; `video styles <id>` lists its templates. Pick the one that fits the kind of video (a history story, a science explainer, a data breakdown, a children's story) and be ready to say why in the report. Read that style's `styles/<id>/SKILL.md` (art direction), `templates.json` (every template's props) and, for custom scenes, `docs.md`. One style per video. Ask the person when the topic does not decide it.
2. **Start the folder.** `video new <folder> --style <id> --title "..."` writes a sample plan from the style's first three templates (replace it) and an empty `research.md`.
3. **Research (research.md).** Search the web and read the pages themselves, not the search snippets. Prefer the people who know first hand: official bodies, the studies, the organisation's own figures. Every number, date and named claim needs a source, two that agree for anything surprising; note when each was published. Fill in `research.md`: the question, what was found (one fact per line with its link), what is not sure or disputed, and the sources. Never list a source you did not read. When it is done, delete the "not researched yet" line: `video voice` refuses until the page has at least two sources. A video with nothing to check (a made-up story) says why in video.json: `"no_research": "a bedtime story, nothing to check"`.
4. **Report and map, then stop.** Write `outline.md` as the map from start to end: the promise in one sentence, the hook, the chapters, a line per scene (its one point and the fact behind it), the payoff in the last chapter. Open on the hook, never a greeting or "in this video". Alternate explanation, example, data, story and recap so the picture keeps changing. Only claims that are in research.md; nothing invented. No real people, other companies' characters or logos: invent names. Then give the person a report in the chat:
   - **What the research found:** the 5 to 10 facts the video rests on, each with its source, and what was not sure or disputed and how the video treats it (left out, or said as uncertain).
   - **The style** and why it fits.
   - **The map:** hook, chapters with their scenes in one line each, payoff, and the estimated length (planned words / 150 = minutes).
   - **Parts, if it runs long** (see "Long videos" below).
   - **What the voice will cost:** about the script's length in characters (roughly 900 a minute).
   Then wait. Nothing past this step (script, voice, render) happens until the person says go, or asks for changes to the map.
5. **Script (script.txt).** Follow the approved map. Write for the ear: short sentences, one idea per sentence, numbers said the way they are spoken. About 150 words a minute. A blank line between ideas. No filler openings or closings.
6. **Scenes (scenes.json).** One scene per idea, 5 to 15 seconds of narration (the planner flags under 2 s and over 16 s). `narration` is the exact words of script.txt the scene covers, in order, and every word of the script belongs to exactly one scene: times come from the voice's word clock, never from typed numbers. Spread templates; never the same one many times in a row. Mark the first scene of each chapter with `"chapter": "Short title"` (2 to 6 words, specific): these become YouTube chapters (at least 3, the first at 0:00, 10 s apart or more).
7. **Voice.** `video voice <folder>` speaks script.txt in chunks with the Reel Kit's voice tool (a chunk is only paid for once; a re-run after a failure pays only for chunks still missing) and joins them, at natural pace (`"voice_speed"` in video.json changes it, 0.7 to 1.3; reels are sped up, videos are not; set it before the first voice, because a new speed is voiced and paid for again). No key or no credits: `video stand-in <folder>` makes a tone and fake word times so everything else can be built and checked; the render warns loudly while the stand-in is in use, and `youtube upload` refuses it.
8. **Plan and check.** `video plan <folder>` shows each scene's time and what was found in the word clock. `video check <folder>` draws every scene, reports errors, anything outside the title-safe area (5% margin), and whether each scene seeks to the same picture every time, with stills in `build/scenes/check/`. Look at the stills. Fix, then check again.
9. **Render.** `video render <folder>` renders only changed scenes, joins them without re-encoding the picture, mixes the voice (and `music` from video.json, ducked under speech) at -14 LUFS, and writes `out/video.mp4` and `out/chapters.txt`. `--scene n` renders one scene; `--force` renders all.
10. **Thumbnail.** `video thumbnail <folder> [--at seconds | --scene n]` makes `out/thumbnail.jpg` (1280x720). Look at it.
11. **YouTube text.** Write `out/youtube.txt`: the title (100 characters at most, no < or >) on line 1, then the description (the promise, what the viewer learns, no invented claims). Chapters are appended from `out/chapters.txt`.
12. **Upload.** `video youtube login` once (Google Cloud "Desktop app" client; the Reel Kit's docs/connect.md step 6B). Then `video youtube upload <folder>` is a dry run that lists every problem; `--yes` sends it, private by default. Never make a video public without the person saying so. Never upload twice (the kit refuses without `--again`).

## Long videos

There is no length limit: the kit has planned an 80-minute video in under a second and renders scene by scene, so a long video only takes longer. Splitting into parts is a suggestion, never a rule; the person decides.

- **When to suggest parts:** when the map runs over about 20 minutes, or has two or more halves that each stand on their own. Say why: more viewers finish a shorter video, each part is its own upload that can point to the next, and a fix re-renders one part instead of the whole thing. Propose the split: "Part 1: <title>" and so on, 10 to 20 minutes each, each with its own hook, promise and payoff, and one line at the start of Part 2 onward saying what came before. If the person wants one long video, make one long video.
- **Each part is its own folder** (`video new` per part, the same style, a copy of the same research.md), so each has its own voice, chapters, thumbnail and upload.
- **What a long video costs** (measured on a recent Mac): rendering takes about as long as the video itself (4.6 minutes rendered in 4.3); the folder needs about 65 MB of disk for each minute while it is built (an hour is about 4 GB, so check the free space first); the voice is about 900 characters a minute (an hour is about 55,000 characters, so check the person's ElevenLabs allowance before voicing).
- **YouTube:** an account that is not verified can only upload up to 15 minutes. Verifying it once (youtube.com/verify, with a phone number) allows up to 12 hours. Say so before a long upload.

## Rules

- Never type scene times; they come from the voice. Never edit `styles/` (copies: edit in the bagelunit-styles repo and sync again).
- The voice key is the person's: never ask for it, print it or store it.
- Everything on screen is original: no real people, no other companies' logos or characters, no outside footage or music. Only music the person owns the rights to goes in `music`.
- Anything scored must reach 90 or more; below that, redo and rescore.
- Report what actually happened: a render with errors is not done; a stand-in voice is not a voice.
- No em dashes in anything written.
