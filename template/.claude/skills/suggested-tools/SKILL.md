---
name: suggested-tools
description: >
  Shows the optional outside tools that can improve a video (a voice service, licensed music, Blender, a generated-video tool,
  Canva or Adobe), asks which ones the owner has, records the answers in brand/brand.json and walks through connecting the ones
  they have. None of them is required: the kit renders everything in code. Use on /suggested-tools, when the owner asks "what
  tools can improve my videos", "what can I connect", "do I need ElevenLabs / Canva / Higgsfield / Blender", or from /channel-setup.
user-invokable: true
argument-hint: "[a tool or category]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: setup
---

# /suggested-tools: optional upgrades, never requirements

Trigger: "what tools can improve my videos", `/suggested-tools`, or the last step of `/channel-setup`. Inputs: none. Outputs: `tools` in `brand/brand.json` (`have`, `none`, `other`, `dismissed`, `asked`, `tips`). Next step: the video the owner was about to make (`/bagelunit-video <topic>`).

The kit is complete without any of these: every style, the stand-in voice, thumbnails, captions and QA are drawn in code. Every tool here is only suggested, and the owner can connect whatever else they like. Say plainly, once, that nothing is sent anywhere: the kit only looks at what is on this computer (a program, a key file that exists, a connector Claude already has) and at the owner's own answers; it never reads a key.

Ask every question with the AskUserQuestion tool: up to four questions per block, two to four options each, the recommended option first. Never ask for, print or store a key or a token.

1. **Look.** Run `video suggest --json` (that is `node ~/.claude/skills/bagelunit-video/tools/video.mjs suggest --json`; `video` is written for that command below) and show the catalog in one short list: category, each tool, its status (connected, not connected, dismissed) and what it adds in a few words. Tools shown as connected are already found; do not ask about those again.
2. **Ask, one multiSelect question per category** (in blocks of up to four, the tools that are not already connected as options, plus "I have none of these"; the harness adds "Other" for typing a tool the catalog does not list). The categories and their questions come from the JSON (`question`). If a category has more than three tools, put the first three and let "Other" take the rest.
3. **Confirm.** One AskUserQuestion: "Save these answers (Recommended)" or "Change something". On "Change something", ask again only what they want to change.
4. **Record.** `video suggest --have <ids>` for the tools they have, `video suggest --none` when they picked "I have none of these" everywhere, `video suggest --other "<what they typed>"` for typed tools. This sets `tools.asked` to today.
5. **Tools they HAVE: connect them, one step at a time.** `video suggest <id>` has the steps. Browser steps (an account, an API key page) are done with Claude in Chrome by the rules in this folder's CLAUDE.md: the owner logs in, pastes any secret into the file you made and opened, and clicks the last Delete; you never type a password or a token and ask before anything paid or public. Check each with `video doctor` or `video suggest <id>` afterwards.
6. **Tools they do NOT have: say once, in one line each, what it would add, with its example** (from `video suggest <id>`). Never push, never repeat, never name a price (point to the site). Offer `video suggest --dismiss <id>` for any they never want mentioned; `tools.tips=false` in `brand/brand.json` turns the small "Tip:" lines off for the whole channel (`BAGELUNIT_NO_TIPS=1` or `--no-tips` does it for one run).
7. **End** with the next command: `/bagelunit-video <topic>`.

If the owner only wants one tool ("do I need Canva?"), run `video suggest <id>`, say what it adds and what the kit does without it, and stop unless they want to connect it.
