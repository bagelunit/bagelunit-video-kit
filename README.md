# BagelUnit Video Kit

Make YouTube videos with Claude Code: give it a topic and it researches it, maps the video from start to end for your approval, writes the script, voices it, animates every scene in one of 20 styles, checks the facts and the file, and uploads it to your channel, privately, once you say yes.

- **Long or standard, 1920x1080.** A two-minute explainer or an hour-long deep dive: there is no length limit; past about 20 minutes it suggests splitting into parts.
- **Researched, with sources.** Every number said or shown must come from the video's research or your cleared facts. A fact check runs before the voice and again before upload.
- **You approve twice.** Nothing is voiced before you approve the map, and nothing is uploaded before you approve the finished video. Uploads are private until you say otherwise.
- **One folder per channel.** Run several YouTube channels from one kit, each with its own topic, voice, colours, facts and sign-in.
- **A dashboard** for each channel: what needs you, every video's step, a calendar, voice credits left, and a card that plays each video.
- **Licensed material, recorded.** Music, sound effects, stock video, motion graphics and LUTs come from any source you have the rights to (Uppbeat is what we use and suggest), downloaded by you; the kit ships none, records each one, checks its file and its channel safelist, and refuses the final approval if the check fails.
- **Easy to update.** `video update` (or `/video-update` in a channel folder) pulls the kit, installs the engine again and updates the channel folder, with a dry run first and a backup of every file it replaces.
- **Reels too.** With the BagelUnit Reel Kit, the best stretches of a video become vertical reels in the same style.

The vertical reels are made by its sister kit, the [BagelUnit Reel Kit](https://github.com/bagelunit/bagelunit-reel-kit), which this kit needs installed first (it provides the voice, the headless browser, the fonts and the sound effects).

## Start here

1. **Install the BagelUnit Reel Kit** (its README, `bash setup/install.sh`). It sets up the voice (an ElevenLabs key) and everything the videos are drawn with. ElevenLabs is our suggested voice service, not a requirement: other voice providers can be connected.
2. **Install this kit:** in this folder, `bash setup/install.sh` (Windows: `node setup/install.mjs`).
3. **Make your first channel:** open Claude Code in this folder and type `/video-setup`.
4. **Make a video:** open Claude Code in the new channel folder and type `/bagelunit-video` with your topic.

The full guide, with every step, what it costs and how to connect YouTube, is **[SETUP.md](SETUP.md)**. Every command is in **[COMMANDS.md](COMMANDS.md)**.

## What a video goes through

```
topic -> style -> research (sources) -> report and map -> YOUR GO-AHEAD
      -> script -> scenes -> fact check -> voice -> render -> quality check -> thumbnail and YouTube text
      -> YOUR YES -> upload (private) -> reels (optional) -> archive -> tidy
```

## What is in this folder

| Folder | What |
|---|---|
| `studio/` | the engine, installed as the Claude Code skill `bagelunit-video`: the work order (`SKILL.md`), the commands (`tools/`), the 20 scene styles, the dashboard and the playbook |
| `template/` | a channel folder, copied by `/video-setup` for each channel (with `brand/licensed/`, the register and README for licensed material) |
| `setup/` | the installer, the channel folder maker, the repo scan and the tests |
| `docs/` | notes for people changing the kit |

## Licence

Free to use for your own videos and your clients' (see [LICENSE](LICENSE)). The videos you make are yours.
