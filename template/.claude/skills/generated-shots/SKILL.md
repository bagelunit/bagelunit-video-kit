---
name: generated-shots
description: >
  Makes and records an AI-generated shot (a short clip or a still) for a video, with any provider (Higgsfield is the one we suggest;
  any other generator works, and none is required), then uses it by id in a scene with its label on screen. Use on /generated-shots,
  or when the owner asks for a generated shot, AI b-roll, a re-creation of something that cannot be filmed, or says they made
  something in Higgsfield or another generator.
user-invokable: true
argument-hint: "[what the shot shows, or the file already made] [video name]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: content
---

# Generated shots: make it anywhere, record it, label it, never let it carry the story

Trigger: "a generated shot", "AI b-roll", "re-create this", `/generated-shots`. Inputs: what the shot shows (or a file already made) and the video folder (`videos/<name>`; `video new` first if there is none). Outputs: an entry in `brand/licensed/assets.json`, the file in `brand/licensed/generated-video/` or `generated-image/`, a scene that uses it by id, and its label drawn on screen. Next step: `video check <video>`, then the usual gates and the final approval (`video approve <video> final`).

A generated shot is optional. A video is complete without one, and no tool is needed: Higgsfield is what we suggest, but any generator works, and if the owner has a provider's connector in Claude it can make the shot for them. Never spend credits or start a paid generation without the owner saying yes to that exact job, and never ask for a password or a key in the chat.

## The four rules (the video does not pass without these)

1. **Label every re-creation on screen.** A shot that re-creates something (a place, an event, a product in use, anything that did not happen on camera) shows a short label while it is up. The label text is recorded with the asset (default `Re-creation` for a clip, `AI-generated` for a still) and the final approval refuses, with no override, a video whose on-screen text does not contain it. An empty label is only possible with a recorded reason (`--no-label "why"`), for something like an abstract texture that looks like nothing real.
2. **A generated shot never carries the story.** The claim, the proof and the payoff are told by the voice, the research and the drawn scenes. A generated shot is atmosphere or illustration, never the evidence for a claim.
3. **No real people, no lookalikes, no other brand's logos or products.** Not a real person's face or voice, not a lookalike of one, nothing that copies another creator's work.
4. **Check the provider's terms** for commercial use and for YouTube on the owner's plan (read the provider's page; do not assume). Record the tool, and the prompt if you have it. When the shot could pass for real footage, answer YouTube's altered or synthetic content question in Studio honestly at upload.

## Steps

1. **Brief.** One shot, one sentence: subject, motion, length (3 to 6 seconds is plenty), 16:9 for the wide video. Say which scene it serves and why it earns its place. If the story works without it, leave it out.
2. **Make it** in the provider (or through the owner's connector, after their yes to that job). Look at the result. Reject anything with garbled text, wrong hands, a face that resembles a real person, or a logo.
3. **Download it** by hand (or through the connector) into a scratch folder, not into the repo.
4. **Record it** from the channel folder:

   ```
   video licensed add <file> --type generated-video --tool "Higgsfield" --prompt "..." [--title "..."] [--onscreen-label "AI-generated re-creation"] [--source "..." --plan "..."]
   ```

   Use `--type generated-image` for a still. `--tool` is required. A generated asset is YouTube only; add `--vertical-ok` only if the owner wants it in the vertical version and the rules above hold there too. For something with no need of a label: `--no-label "reason"` (the reason is kept and shown in the approval). `video licensed list` shows what is recorded.
5. **Use it by id** in `scenes.json`: a clip `{"clip": {"asset": "<id>", "start": 0, "duration": 4}, "narration": "..."}`, or an overlay `{"overlay": {"asset": "<id>", "blend": "normal", "opacity": 1}}` on a scene of your own (a generated image can only be an overlay). Put the label text in a drawn scene's on-screen text (its `props`) so it is on screen while the shot is up; a clip scene draws no text of its own.
6. **Check.** `video check <video>` and `video licensed check <video>` (the label must be found in the on-screen text; a PASS line says where it was read from, and a SKIPPED line means it could not be looked for, which is not a pass). Then `video licensed credits <video>` so the description carries `[generated with TOOL; on-screen label "X"]`, the facts check, and the final approval. A hand-edited generated file is a new file: record it again.

## Honesty
Say plainly what is generated. If you are unsure whether a shot could be taken for real footage, label it or cut it.

**Next:** `video check <video>`, then `/bagelunit-video <video name>` to carry on.
