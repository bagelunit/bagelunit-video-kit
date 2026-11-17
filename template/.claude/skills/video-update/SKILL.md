---
name: video-update
description: >
  Updates the BagelUnit Video Kit and this channel folder to the newest build: finds the kit clone, shows what changed, pulls it
  (only when it is safe), installs the engine again, then updates this folder's kit-owned files with a dry run first and a backup
  of every file it replaces. Use on /video-update, or when the user says "update the video kit", "is there a new version",
  "check for updates" or "upgrade the kit".
user-invokable: true
argument-hint: "[check | apply]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: setup
---

# /video-update: the newest kit, nothing of the channel's lost

Run from this channel folder. Trigger: "update the video kit". Inputs: none. Output: the engine and this folder on the kit's newest build. Next: carry on with the video you were making.

The tool is `node ~/.claude/skills/bagelunit-video/tools/video.mjs update`. It never changes the channel's own data (`brand/` values, `brand/licensed/` assets, `videos/`, `CLAUDE.local.md`), and it needs no key.

1. **Check:** `video update`. It is a dry run: the kit folder it found, this version and build against the clone's, how far the clone is behind its git remote (it fetches; `--no-fetch` skips that), what a pull would bring, and what would change in this folder. If it says it cannot find the kit folder, ask where the clone is (AskUserQuestion, "Other" for a path) and use `--kit <folder>`.
2. **Ask once** (AskUserQuestion): "Update now (Recommended)", "Show me the changelog first", "Not now". For the changelog, read the top entry of `CHANGELOG.md` in the kit folder and summarise it in plain words, then ask again.
3. **Apply:** `video update --apply`. In order: it pulls the clone with `git pull --ff-only` (only when it is behind and its tracked files have no uncommitted change; otherwise it stops and says why, and nothing is changed), runs the installer (`bash setup/install.sh`, on Windows `node setup/install.mjs`), then updates this folder: it replaces the kit-owned files (`CLAUDE.md`, `.claude/skills`, `scripts`, `brand/licensed/README.md`) keeping each old one as `<name>.bak-<stamp>`, adds missing starter files and new `brand/brand.json` settings, and adds missing `.gitignore` lines.
4. **Report** in two or three lines: the versions, what was replaced, and what it says this folder now needs. If the owner changed `CLAUDE.md` or a skill for this channel only, say that the change was replaced (the `.bak` copy is kept) and offer to move it into `CLAUDE.local.md`.
5. **Restart:** if it prints "The engine is updated", tell the owner to restart Claude Code so the new engine and skills load.
6. **Other channels** on this computer: offer `video update --apply --all` (the engine is already current, only the folders change), or run it inside each folder.

If the pull is refused (uncommitted changes in the kit folder, or the clone has diverged), show the reason, do not force anything, and say what to do in the kit folder. Never run `git reset`, `git stash` or `git checkout` there for the owner.
