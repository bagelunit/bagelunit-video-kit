# BagelUnit Video Kit (repo)

This folder is the kit's source, not a place to make videos. Videos are made in a channel folder (a copy of `template/`, one per YouTube channel). The Video Kit is separate from the BagelUnit Reel Kit (vertical reels) and needs it installed: it borrows the Reel Kit engine's voice tool, headless browser, fonts and sound bank (`~/.claude/skills/bagelunit-reels`).

- **"Set up the video kit" / first time on this computer:** check the Reel Kit is installed (`video doctor`), then run `bash setup/install.sh` (Mac, Linux) or `node setup/install.mjs` (any system) and walk the person through anything marked NOTE, using `SETUP.md`. Ask every question with the AskUserQuestion tool (options and "Other"), never as plain text. Never ask for, print or store a key or token.
- **After install, the next step is always `/video-setup`.** That skill (`.claude/skills/video-setup/`) asks the channel's name and where its folder goes, runs `node setup/new-workspace.mjs <folder>` to copy `template/` there, then asks the channel questions (`template/.claude/skills/channel-setup/SKILL.md`).
- **Point to the command.** Every next step names its command first: `bash setup/install.sh`, `/video-setup`, `node setup/new-workspace.mjs <folder>`, then in a channel folder `/bagelunit-video <topic>`, `/channel-setup`, `video dashboard --open`.
- **Someone opens a session here without a clear task:** if `~/.claude/skills/bagelunit-video/SKILL.md` is missing, offer to set up the kit; if it exists, say in one or two lines that the next step is `/video-setup` (a folder for a new channel), unless they already have a channel folder, in which case they open Claude Code there.
- **Making a video:** in a channel folder, never here and never in `template/`. If the person asks for a video here, run `/video-setup` first (or tell them to open Claude Code in their channel folder).
- **Web steps go through the browser tool** (Claude in Chrome): Google Cloud and the YouTube sign-in (`SETUP.md` section 5). The person logs in and pastes each secret into the file Claude made and opened; Claude asks before anything paid or public and never types a password or a secret.

## Changing the kit

- **The engine** is `studio/`, installed as `~/.claude/skills/bagelunit-video` (the work order is `studio/SKILL.md`; commands in `studio/tools/`: `video.mjs`, `scenes.mjs`, `checks.mjs`, `reels.mjs`, `youtube.mjs`, `sfx.py`). After a change, re-run `node setup/install.mjs` (or install with `--link`).
- **The dashboard** is `studio/dashboard/` (model, page, client, bundled Poppins). Read `docs/dashboard-design.md` before changing its look; it follows the Reel Kit dashboard's rules. Check changes at 1280, 980 and 390 px.
- **The channel folder** is `template/` (CLAUDE.md, brand/, the `/channel-setup` skill). `setup/new-workspace.mjs` copies it; existing channel folders are not updated by it.
- **Styles are copies.** `studio/styles/` is written by `sync-to-kit.mjs` in the bagelunit-styles repo (`node sync-to-kit.mjs --kit <this folder> --format wide`, dry run first, then `--apply`). Never edit it here.
- **Commands reference:** when a command or skill is added or changed, update `COMMANDS.md` and `SETUP.md`.
- **Everything is our own code.** Do not copy or keep outside material in the repo. Invent names in samples; no real people, other companies' characters or logos.
- **Never commit** keys, `.env` files, photos of people, renders (`*.mp4`), audio, thumbnails or `node_modules`. Run `node setup/scan-repo.mjs` before any commit; `node setup/test-video.mjs` must pass.
- No em dashes in anything written here.

## Releasing

Only when the owner asks. One release per batch of work. `VERSION` and the top entry of `CHANGELOG.md` (plain words, newest first) carry the version. Pushing, tagging and GitHub releases are public: only on the owner's say-so (`git push`, `git tag -a vX.Y.Z`, `git push --tags`, `gh release create vX.Y.Z --notes-file <the entry>`). YouTube uploads are public actions too: dry run first, private by default, public only when the owner says so.
