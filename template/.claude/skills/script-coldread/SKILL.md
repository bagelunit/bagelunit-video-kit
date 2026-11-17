---
name: script-coldread
description: >
  A cold read of a long video's script: a fresh agent that sees only the spoken words, as a viewer would hear them once, says
  what the video is about, who it is for, what it promised and whether it delivered, where it got confused or would have
  stopped watching, and which lines did not make sense. Use on /script-coldread, after the script check passes and before the
  fact check and the score, and again after any change to the spoken words.
user-invokable: true
argument-hint: "[video name]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: content
---

# Script cold read

Trigger: `/script-coldread`, step 5 of the work order after the script is drafted. Inputs: `script.txt` only (all of it is spoken). Outputs: `build/coldread.md`. Next step: `video facts <folder>`, then `/script-score`.

The writer cannot hear their own gaps: the outline fills them in. So a reader who has no outline hears the script once, the way a viewer does.

## Run it

1. Run `video script <folder>` first (that is `node ~/.claude/skills/bagelunit-video/tools/video.mjs script <folder>`). A cold read of a script with ERRORs wastes a call; fix them first.
2. Start a **fresh agent** with the Agent tool (`subagent_type: "general-purpose"`; a cheaper model alias such as `model: "haiku"` is fine for a read, and it needs no tools). Do not do the read yourself: you have seen the outline and will fill the gaps in without noticing. Give the agent ONLY the text of `script.txt` and the prompt below. Do not give it the outline, the research, the brief, the title, the channel or the topic.

```
You are a viewer watching a YouTube video once, with no way to rewind and no picture, only the voice. Below is exactly what the voice
says, start to end. Answer in this exact format, short and literal, and do not be kind. If something did not make sense, say so.

(a) What is this video about, in one sentence?
(b) Who is it for?
(c) What did the first 30 seconds promise or tease? For each promise, quote the line that answers it, or say "never answered".
(d) Chapter by chapter, in a line each: what the part said, and whether it was clear.
(e) Where did you get lost, or reach for the pause button? Quote the lines.
(f) Where would you have stopped watching, and why? Quote the line.
(g) Words, names or numbers I did not know or could not hold.
(h) Anything that did not connect to what came just before (quote it).
(i) What should I do after the last line?
(j) Retell the whole video in four sentences, as you would to a friend.

THE VIDEO:
<the text of script.txt>
```

3. Save its answer in `videos/<name>/build/coldread.md`. For a script over about 4,000 words, give the agent the whole text anyway; if it truncates, run two fresh agents on the halves, cut at a chapter boundary, and add a third on the join.

## Compare with the plan (you do this, not the reader)

Read `script-brief.md` and `outline.md` and check:

- (a) matches the promise, (b) matches the viewer, (i) matches the takeaway and the call to action;
- (c): every teaser is answered; any "never answered" is a failure;
- (e), (f) and (h) are empty, or each one is fixed; (g) words are explained in the script or cut.

Any miss goes back to the script as the smallest fix, then `video script <folder>` again and this read again on the whole new text (never only the changed line). After two rounds with no gain, stop and show the owner what blocks it, with AskUserQuestion: "Rewrite that chapter (Recommended)", "Change the plan", "Stop here". This read is a model, not the audience: if its retell (j) is not what the owner wants to say, that is a finding too. Show the owner (a) and (j) with the script.
