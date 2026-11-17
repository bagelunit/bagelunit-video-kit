---
name: script-score
description: >
  Scores a long video's script out of 100 against a written rubric, in a fresh context that did not write it, and records the
  "Script review" line the voice step reads (the bar is 90). Use on /script-score, as the last step of step 5 of the work
  order, after the script check, the cold read and the fact check pass. Below 90 it fixes the weakest part and scores again.
user-invokable: true
argument-hint: "[video name]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: content
---

# Script score (the bar is 90)

Trigger: `/script-score`. Inputs: `script.txt`, `script-brief.md`, `outline.md`, `build/scriptcheck.md`, `build/coldread.md` and the script-scope fact check. Outputs: a line in `approvals.md` under "Script review". Next step: `video voice <folder>` (it refuses without this line).

The same rule as every score in the kit: anything scored reaches 90 or it is redone and scored again. Never raise a number to reach 90.

## Must-pass first (any fail means not ready, and no score)

1. `video script <folder>` prints PASS: no ERROR (sentence length, filler opening, a note or placeholder in the script, a call to action missing, length more than 35% off the plan).
2. Words a minute: the script is within 15% of the planned minutes (the check says so).
3. The cold read (`build/coldread.md`): every teaser answered, and (a), (b) and (i) match the brief.
4. The script-scope fact check is a current PASS (`video facts <folder>`, the sources re-read, then recorded). A change to a word makes it stale.
5. The human score is at the bar: `video script <folder> --human` (the bar is `writing.human_score_min` in `brand/brand.json`, 90 by default).

## Scored (1 to 5 each, weighted)

| Criterion | Weight | A 5 | A 2 |
|---|---|---|---|
| Promise and payoff match | 20 | the last chapter answers the opening's promise in words the viewer can act on; the cold retell has the same payoff | it ends on observations or about something else |
| Hook, first 30 seconds | 15 | context at once, a lean, a true contrarian snapback that is paid off, then the road ahead | greeting, slow context, a snapback aimed at a different viewer |
| Chapters and flow | 15 | each chapter opens with its own small hook, follows from the one before, closes what it opened; no tangent | "next, let's talk about", a question with an unrelated answer |
| Keeps them | 10 | the picture can change every 30 to 60 seconds: example, data, story, recap alternate; no padding | one long stretch of explanation, repeated points |
| Clear aloud | 15 | no unexplained term; sentences mostly 8 to 22 words, none over 28; every "it/this/they" has a clear referent; numbers and names the ear can hold | jargon, run-ons, lists read out |
| Ending | 10 | payoff, then the call to action in the channel's words, then a calm 10 to 20 seconds with no new fact | long goodbye, new claims in the last seconds |
| One viewer, one idea | 10 | every chapter serves the promise for the same person | a second audience or topic appears |
| Sounds human | 5 | the human score is well over the bar; the channel's voice.md is audible | stock phrases, even rhythm |

Score = sum(weight x score / 5), rounded down.

## Run it

1. Start a **fresh agent** (the Agent tool, `subagent_type: "general-purpose"`) that did not write the script. Give it the brief, `script.txt`, `build/scriptcheck.md`, `build/coldread.md` and this rubric. It returns the must-pass results, each criterion's score with the quote that earned it, the weakest criterion, and the smallest fix.
2. If a must-pass fails or the score is under 90: apply the smallest fix, then run `video script <folder>`, `/script-coldread`, `video facts <folder>` and this score again on the new text. After two passes with no gain, stop and show the owner what blocks it, with AskUserQuestion: "Rewrite the weakest chapter (Recommended)", "Change the plan", "Stop here".
3. When it passes, record it: `video script <folder> --record --score NN --notes "weakest: <criterion>"`. It writes, under "Script review" in `approvals.md`:
   `Script review: meets the bar (NN/100; weakest: <criterion>; by script-score) [script <hash>]`
   and refuses a score under 90, a script with errors, or a stale fact check. `video voice <folder>` refuses without a line of 90 or more that carries the fingerprint of the script as it is now.

A score belongs to one text: any change to the spoken words afterwards, a fact-check fix included, cancels it and sends the script back through the check, the cold read, the fact check and this score.

## The owner's override

Only the owner can skip the review, with a reason they give: `video voice <folder> --skip-script-review "reason"` (or `video script <folder> --skip-script-review "reason"`), which writes its own line. It never skips the fact check. Never use it to avoid a rescore, never suggest it first and never fill in the reason yourself; if the score will not reach 90, show what blocks it and ask the owner what to do with AskUserQuestion.
