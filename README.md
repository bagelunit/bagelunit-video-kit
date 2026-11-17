# BagelUnit Video Kit

Make YouTube videos with Claude Code: give it a topic and it researches it, maps the video from start to end for your approval, writes the script, voices it, animates every scene in one of 20 styles, checks the facts and the file, and uploads it to your channel, privately, once you say yes.

- **Long or standard, 1920x1080.** A two-minute explainer or an hour-long deep dive: there is no length limit; past about 20 minutes it suggests splitting into parts.
- **Researched, with sources.** Every number said or shown must come from the video's research or your cleared facts. A fact check runs before the voice and again before upload.
- **You approve twice.** Nothing is voiced before you approve the map, and nothing is uploaded before you approve the finished video. Uploads are private until you say otherwise.
- **One folder per channel.** Run several YouTube channels from one kit, each with its own topic, voice, colours, facts and sign-in.
- **A dashboard** for each channel: what needs you, every video's step, a calendar, voice credits left, and a card that plays each video.
- **A script that reads like a person wrote it.** A script check, a cold read, a human score and a score out of 100 come before the voice; the voice refuses a script whose exact words were not reviewed at 90 or more.
- **Quality checks you can run.** Pace of the picture, the music plan, caption reading speed, the finished mix, the thumbnail, and a fair A/B test for thumbnails, each with its own command.
- **The voice needs no outside tool.** With no ElevenLabs key the free built-in voice speaks; ElevenLabs is a suggestion for a natural voice.
- **Licensed material, recorded.** Music, sound effects, stock video, motion graphics and LUTs come from any source you have the rights to (Uppbeat is what we use and suggest), downloaded by you; the kit ships none, records each one, checks its file and its channel safelist, and refuses the final approval if the check fails.
- **3D shots and maps, optional.** With free Blender installed, `/blender-shot` makes a product, prop, title or map shot (a shaded-relief map of any latitude/longitude box from free elevation tiles) as your own clip or overlay, and a Blender still can be the thumbnail. Without Blender nothing else changes.
- **Easy to update.** `video update` (or `/video-update` in a channel folder) pulls the kit, installs the engine again and updates the channel folder, with a dry run first and a backup of every file it replaces.
- **Reels too.** With the BagelUnit Reel Kit, the best stretches of a video become vertical reels in the same style.

The vertical reels are made by its sister kit, the [BagelUnit Reel Kit](https://github.com/bagelunit/bagelunit-reel-kit), which this kit needs installed first (it provides the voice, the headless browser, the fonts and the sound effects).

## Start here

1. **Install the BagelUnit Reel Kit** (its README, `bash setup/install.sh`). It sets up the voice and everything the videos are drawn with. An ElevenLabs key is optional: with none, the free built-in voice speaks (it needs the Reel Kit 1.3.0 or newer); ElevenLabs is our suggested service for a natural voice, and other providers can be connected.
2. **Install this kit:** in this folder, `bash setup/install.sh` (Windows: `node setup/install.mjs`).
3. **Make your first channel:** open Claude Code in this folder and type `/video-setup`.
4. **Make a video:** open Claude Code in the new channel folder and type `/bagelunit-video` with your topic.

**Nothing outside is required.** The kit draws everything in code. Tools such as ElevenLabs, Uppbeat, Epidemic Sound, Blender, Higgsfield, Canva or Adobe only improve results, and are only suggested: `/suggested-tools` (or `video suggest`) shows what each adds with an example, asks which ones you have, and never sends anything anywhere.

The full guide, with every step, what it costs and how to connect YouTube, is **[SETUP.md](SETUP.md)**. Every command is in **[COMMANDS.md](COMMANDS.md)**.

## What a video goes through

```
topic -> style -> research (sources) -> report and map -> YOUR GO-AHEAD
      -> script (check, cold read, score) -> scenes -> fact check -> voice -> render -> quality checks -> thumbnail and YouTube text
      -> YOUR YES -> upload (private) -> reels (optional) -> archive -> tidy
```

## What is in this folder

| Folder | What |
|---|---|
| `studio/` | the engine, installed as the Claude Code skill `bagelunit-video`: the work order (`SKILL.md`), the commands (`tools/`), the 20 scene styles, the dashboard and the playbook |
| `template/` | a channel folder, copied by `/video-setup` for each channel (with `brand/licensed/`, the register and README for licensed material, and `brand/library/3d/`, the optional Blender shots) |
| `setup/` | the installer, the channel folder maker, the repo scan and the tests |
| `docs/` | notes for people changing the kit |

## Licence

Free to use for your own videos and your clients' (see [LICENSE](LICENSE)). The videos you make are yours.
