# BagelUnit Video Kit (repo)

This folder is the kit's source, not a place to make videos. It is separate from the BagelUnit Reel Kit: the Reel Kit makes vertical 1080x1920 reels, this kit makes long and standard 1920x1080 videos. It borrows the voice tool, the headless browser and the fonts from the installed Reel Kit engine (`~/.claude/skills/bagelunit-reels`).

- **Set up:** `bash setup/install.sh` (Windows `node setup/install.mjs`) installs `studio/` as the skill `bagelunit-video`. Install the Reel Kit first.
- **Making a video:** in any folder, `/bagelunit-video`; the work order is `studio/SKILL.md`. The commands are `node studio/tools/video.mjs <command>` (`doctor`, `styles`, `new`, `voice`, `stand-in`, `plan`, `check`, `render`, `chapters`, `thumbnail`, `youtube`).
- **Styles are copies.** `studio/styles/` is written by `sync-to-kit.mjs` in the bagelunit-styles repo (`node sync-to-kit.mjs --kit <this folder> --format wide`, dry run first, then `--apply`). Never edit it here; edit the style there and sync again.
- **Everything is our own code.** Do not copy or keep outside material in the repo. Invent names in samples; no real people, other companies' characters or logos.
- **Never commit** keys, `.env` files, photos of people, renders (`*.mp4`), audio, thumbnails or `node_modules`. Run `node setup/scan-repo.mjs` before any commit; `node setup/test-video.mjs` must pass.
- **Commit, push and release only on the owner's say-so.** One release per batch of work. Version is in `VERSION` and `CHANGELOG.md`. YouTube uploads are public actions: dry run first, private by default, public only when the owner says so.
- No em dashes in anything written here.
