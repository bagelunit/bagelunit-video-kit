---
name: thumbnail-design
description: >
  Takes a thumbnail brief into an outside design tool (Canva, Adobe Firefly or Express, or any editor) or a Blender still, saves the
  finished image inside the channel folder, puts it on the video with video thumbnail --image, checks it with thumbcheck and sets up
  YouTube's three-thumbnail test with the A/B rule. Use on /thumbnail-design, or when the owner says "design the thumbnail in Canva",
  "make the thumbnail in Firefly", "use my own thumbnail image", or wants a designed picture rather than a frame of the video.
user-invokable: true
argument-hint: "[video name] [the brief, or leave empty to write it first]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: content
---

# Thumbnail design: the brief, made in the tool you like, checked here

Trigger: "design the thumbnail", "thumbnail in Canva or Firefly", `/thumbnail-design`. Inputs: the video folder and a brief (what the picture shows, 2 to 5 words of text, the one idea; if there is no brief, write it with the owner first, from `playbook/hook-and-packaging.md` if the channel has one). Outputs: one image inside the channel folder, `out/thumbnail.jpg`, and, for a test, up to two more versions in `out/thumbnails/`. Next step: `video qa <video>` and the final approval, then the upload.

Canva and Adobe Firefly or Express are what we suggest; any design tool, a Blender still (`/blender-shot`) or the kit's own thumbnail (a frame of the video with words over it: `video thumbnail <video> --at 12 --text "WORDS *ONE*"`) works, and none is required. If the owner has the Canva or Adobe connector in Claude, Claude can make the design through it. Otherwise the owner designs by hand and exports. Never ask for a password or key in the chat, and ask before anything paid or public.

## Rules
1. **1280x720, 16:9, a JPG or PNG under 2 MB.** Text: 2 to 5 words, the biggest line large enough to read at phone size (thumbcheck's bar is 60 px tall on 720), clear of the bottom-right corner where YouTube draws the duration.
2. **Your own image only.** Elements you made or have the rights to (a licensed element is recorded with `video licensed add`). No real people's faces or lookalikes without permission, no other brand's logos, nothing copied from another creator's thumbnail.
3. **A generated picture is labelled where it needs it** (`/generated-shots`: it never carries the story). It must not promise something the video does not show.
4. **Facts.** Any number or claim on the thumbnail must be in the research of that video.

## Steps
1. **Brief.** Three text options (2 to 5 words, not the title again) and the visual idea. Pick one with the owner (AskUserQuestion with the options).
2. **Design it** in the owner's tool, by hand or through the connector, or as a Blender still. Export at 1280x720.
3. **Save the export inside the channel folder**, for example `videos/<name>/assets/thumbnail-source.png` (not in Downloads: the kit only reads images inside the channel folder).
4. **Put it on the video:**

   ```
   video thumbnail <video> --image videos/<name>/assets/thumbnail-source.png [--text "WORDS *ONE*"] [--fit cover|contain]
   ```

   It writes `out/thumbnail.jpg` (1280x720). Leave `--text` out when the design already has its words.
5. **Check the picture:**

   ```
   python3 ~/.claude/skills/bagelunit-video/tools/thumbcheck.py out/thumbnail.jpg
   ```

   (run it from the video folder, or give the folder). Fix every FAIL and make the picture again from step 2; say plainly what a WARN or a SKIPPED check means. Look at it at 150 px wide: if it cannot be read, simplify the words.
6. **A second and third version, if the owner wants to test** (YouTube's Test and compare takes up to three): make each differ in one thing (the words, or the picture), `video thumbnail <video> --image ... --name b`, `--name c`, upload them in Studio's test. When Studio has shown each version enough impressions, read the clicks and impressions it reports and run the rule:

   ```
   python3 ~/.claude/skills/bagelunit-video/tools/abtest.py --a <clicks> <impressions> --b <clicks> <impressions> [--c <clicks> <impressions>]
   ```

   It calls a winner only when one version beats each of the others with 95 percent or more, and each has at least 1000 impressions; otherwise it says to keep testing. Then `video thumbnail <video> --use <name>` makes the winner the thumbnail.

**Honesty:** a pretty thumbnail nobody can read at phone size does not exist. Put the thumbcheck result in what you tell the owner before the final approval, and never call a SKIPPED check passed.

**Next:** `video qa <video>`, then `video approve <video> final`.
