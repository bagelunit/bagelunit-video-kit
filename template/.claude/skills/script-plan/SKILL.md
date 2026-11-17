---
name: script-plan
description: >
  Plans a long video's script before a word of it is written: one viewer, one promise, the chapters (each with its own small
  hook, one point and its minutes), the payoff and call to action, the estimated length, and the opening 30 seconds written
  and scored. Use on /script-plan, or while writing the map (step 4 of the work order) and before step 5. Writes
  videos/<name>/script-brief.md and the chapter plan in outline.md. It writes no script.
user-invokable: true
argument-hint: "[video name]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: content
---

# Script plan: decide what the video says before writing it

Trigger: `/script-plan`, or step 4 of the work order (the map). Inputs: the video folder (`videos/<name>`), its `research.md`, the channel's `brand/voice.md`, `brand/facts.md` and `brand/brand.json`, and `playbook/hook-and-packaging.md` in the engine (sections 1 and 2). Outputs: `script-brief.md`, the chapter plan in `outline.md`, and the opening's score. Next step: show the map and ask for the go-ahead (step 4), then write `script.txt` (step 5).

Long scripts drift when the writer starts with sentences. Decide the viewer, the promise and the order of chapters first; a plan is cheap to change, a voiced script is not. `outline.md` is part of the map the owner approves, so run this before the go-ahead; if the map is already approved and this changes `outline.md`, show what changed and approve again (`video approve <folder> map`).

Ask every question with the AskUserQuestion tool (two to four options, the recommended one first, "Other" for typing).

## 1. The brief (`script-brief.md`, one line each, plain words)

- **Viewer:** ONE person by role and situation, never "everyone".
- **Viewer question:** what they are asking at second 0, and the title and thumbnail that made them click.
- **Promise:** one sentence, 20 words or fewer, naming what they will know or be able to do by the end. The title, the thumbnail and the first sentence all point at it.
- **Takeaway:** the last line, as something they can do or decide.
- **Facts to use:** each fact in `research.md` or `brand/facts.md`, and where it goes: the voice (at most about five numbers a minute and eight names), the screen (labels, tables, long lists), or the description. Precision a listener cannot hold goes on screen.
- **Terms the viewer may not know:** each with a plain swap (the channel's own list is `brand/jargon.md`, `## Terms`, one per line as `term | plain swap`).

## 2. The chapters (a table in `outline.md`)

One row per chapter: **title** (what the viewer sees as the chapter), **hook** (the first one or two sentences: context and a lean, never "next, let's talk about"), **point** (one claim and the fact behind it), **so what** (what it means for the viewer), **opens / closes** (any question it opens, any it answers), **minutes**. Rules the plan must meet:

- Every question a chapter opens is closed by a later chapter, and the last chapter answers the promise.
- A chapter whose point is outside the promise is a tangent: cut it.
- Alternate explanation, example, data, story and recap so the picture changes every 30 to 60 seconds; no chapter runs past about 5 minutes without a change of pace.
- The last chapter holds the payoff and the call to action (`cta.line`), then a calm 10 to 20 seconds under YouTube's end screen.
- Write the length as a line the check reads: `Estimated length: N minutes` (the minutes add up; planned words = minutes x 150). Over about 20 minutes, or with two halves that each stand alone, ask with AskUserQuestion: "Split into parts (Recommended)", "One long video".

## 3. The opening, written and scored

Write the first 30 seconds (about 75 words): context at once, the lean, the contrarian snapback, then the road ahead. Score it out of 100:

| Part | Points | Full marks |
|---|---|---|
| Context at once | 25 | the first sentence says what the video is about; no greeting, no "in this video" |
| The lean | 20 | one direction of curiosity: a number from research, a pain, a wish or a surprise |
| The snapback | 25 | pulls the viewer another way; it is true and a later chapter pays it off |
| The road ahead | 15 | one sentence of what they will get |
| Promise match | 15 | the same promise as the title and thumbnail |

Under 90, rewrite and score again; never raise a number to reach 90. Save the opening and its score in `script-brief.md` as `Opening score: NN/100`.

## 4. Check and show

Run `video script <folder> --minutes N` once a draft of the opening exists, or after the script is written; it reads the plan's estimate. Show the owner the brief and the chapter table (promise, chapters with their hooks and minutes, estimated length, the opening) and ask: "Go ahead with this map (Recommended)", "Change the plan", "Stop here". Nothing is voiced until the map is approved.
