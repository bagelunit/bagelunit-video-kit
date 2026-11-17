---
name: db
description: >
  Opens this channel's dashboard in the browser. Redraws it first from the files in this folder, so what you see is current.
  Use on /db, or when the user says "open the dashboard", "show the dashboard", "open my dashboard" or "dash".
user-invokable: true
argument-hint: "[credits]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: content
---

# /db: open the dashboard

Run from this channel folder. It reads and shows only: it uploads, approves and spends nothing.

1. **No argument:** run `node ~/.claude/skills/bagelunit-video/tools/video.mjs dashboard --open`. It redraws `videos/video-dashboard.html` from this folder's files (no network, no AI, free) and opens it in the default browser.
2. **`credits`:** run `node ~/.claude/skills/bagelunit-video/tools/video.mjs dashboard --credits --open`, which also reads the ElevenLabs characters left.

If `brand/brand.json` has no name yet, the channel is not set up: say so in one line and point to `/channel-setup`. If the engine is missing, say `bash setup/install.sh` in the kit's folder fixes it. If the page does not open (a remote or headless computer), print the full path of `videos/video-dashboard.html` and say it can be opened from there.

Reply in one or two lines: what was opened, how many videos it shows and how many need the owner now (the command prints both).
