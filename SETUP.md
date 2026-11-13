# BagelUnit Video Kit: the guide

From nothing installed to your first video on YouTube. Claude Code does nearly all of it with you: you type a command, answer questions in the boxes it shows, approve twice, and click the buttons that are yours to click (logging in, Allow, publishing).

Below, `video <command>` is short for `node ~/.claude/skills/bagelunit-video/tools/video.mjs <command>`. On Windows, `~` is your home folder and `python` replaces `python3`.

## 1. What you need

| | Why | Cost |
|---|---|---|
| A Mac, Windows or Linux computer with [Claude Code](https://claude.com/claude-code) | Claude runs every step | your Claude plan |
| [Node.js](https://nodejs.org) 22 or newer, and ffmpeg | the commands and the video files | free |
| The [BagelUnit Reel Kit](https://github.com/bagelunit/bagelunit-reel-kit), installed | the voice tool, the headless browser that draws the scenes, the fonts and the sound effects | free |
| An [ElevenLabs](https://elevenlabs.io) account with a key | the voice | about 900 characters per minute of video (section 8) |
| A YouTube channel and its Google account (optional) | uploading from this computer | free |
| Chrome (or Edge, Brave, Arc, Vivaldi, Opera) with Claude in Chrome (optional) | Claude does the web steps in your browser | free |

## 2. Install

1. **The Reel Kit first.** Follow its README: `bash setup/install.sh` in its folder. Its setup walks you through the ElevenLabs key (you paste it into a file Claude opens; nobody else sees it).
2. **This kit.** Download it (Code, Download ZIP, or `git clone https://github.com/bagelunit/bagelunit-video-kit`), open a terminal in its folder and run `bash setup/install.sh` (Windows: `node setup/install.mjs`). It checks ffmpeg and the Reel Kit and installs the skill `bagelunit-video`.
3. **Check.** `video doctor` lists what is installed and what is missing, with the command that fixes each.

## 3. Make a channel folder

Open Claude Code in this kit's folder and type **`/video-setup`**. Claude asks:

- the channel's name and where its folder goes (it becomes `<channel>-videos`);
- whether to start from a Reel Kit brand folder of the same brand (it copies the name, topic, colour, voice and cleared facts, and lets `video reels` make reels there);
- the channel questions: topic and audience, YouTube channel and default privacy (private unless you choose unlisted), voice, accent colour, usual styles, the line every video ends on, and how the channel talks.

**More channels:** run `/video-setup` again. Each channel has its own folder, topic, voice, facts and YouTube sign-in, so nothing leaks from one to another. To change a channel later, type `/channel-setup` in its folder.

By hand: `node setup/new-workspace.mjs ~/Videos/acme` (or `--from-reels <your reels folder>`), then `/channel-setup` in the new folder.

## 4. Your first video

Open Claude Code **in the channel folder** and type **`/bagelunit-video`** with your topic, for example `/bagelunit-video how volcanoes form`. What happens:

1. **Style.** Claude picks one of the 19 styles that fits the topic (your channel's usual ones first) and says why. `video styles` lists them.
2. **Research.** It reads real sources and writes `research.md`: every fact with its link, and what is uncertain or disputed.
3. **Report and map, then it stops.** You get the facts the video rests on, the style, the map from hook to payoff with the estimated length, three title options and thumbnail ideas, what the voice will cost, and parts to split it into if it runs long. **Say go, or what to change.** Nothing costs credits before this.
4. **Script and scenes.** The first 30 seconds follow the triple hook (context, a reason to lean in, then a turn they did not expect), each chapter opens with a small hook, and it ends on the payoff and your call to action.
5. **Fact check.** Every number said or shown is checked against the research ("sixty four percent" matches "64%"), and Claude re-reads the sources before recording a pass.
6. **Voice.** It checks your ElevenLabs characters first and stops if there are not enough. A long script is voiced in pieces; a piece already paid for is never paid for again.
7. **Render.** Scene by scene, at 1920x1080, with sound effects on chapter changes and your music if you added one. Rendering takes about as long as the video.
8. **Checks.** A quality check of the file (size, length, loudness, black or frozen stretches) and a last fact check with the YouTube text.
9. **Your yes.** Claude shows you the video, the thumbnail and the title and description. **Watch it, then say yes** (or what to change).
10. **Upload.** A dry run first, then the upload, **private** unless you say otherwise. Going public is always your call, made in YouTube Studio or by telling Claude.

To carry on with a video later: `/bagelunit-video <video name>`. To see everything at once: `video dashboard --open`.

## 5. Connect YouTube (once per channel)

The upload goes straight from your computer to YouTube through YouTube's own API. It needs a Google Cloud project of yours (free) and a one-time sign-in per channel. With Claude in Chrome turned on, Claude does each page in your browser; you log in, paste the two values into the file Claude opens, and click Allow. Without it, do the same clicks yourself.

1. **A Google Cloud project.** console.cloud.google.com, New project (any name). Then APIs and Services, Library, **YouTube Data API v3**, Enable.
2. **The consent screen** (Google Auth Platform, Get started). An app name and your email, then the audience: **External** (Internal only lets in accounts of the same Google Workspace organization, and the channel is often on another account). Agreeing to Google's terms is your click.
3. **Test user.** Audience, Test users, add the Google account that owns the channel.
4. **The client.** Clients, Create client, application type **Desktop app**. Google shows a client id and a secret.
5. **The file.** In the channel folder run `video youtube login`. The first time, it makes `~/.config/bagelunit-video/youtube-<channel slug>.json` with `PASTE-...` in place of the two values. Paste the client id and secret there (Claude opens the file for you and never reads the secret), save it.
6. **Sign in.** Run `video youtube login` again when you are at the screen (it waits 5 minutes). Choose the channel's Google account, click through "Google hasn't verified this app" (Advanced, continue: it is your own app) and Allow. The sign-in is saved in that file and never printed.

**Every 7 days, or once for good.** While the app is in Testing, Google ends the sign-in after 7 days and step 6 has to be run again. To stop that, publish the app (Audience, Publish app); Google then asks for a homepage and a privacy policy page on a domain you own (your channel's or business's website). Publishing the app is public, so it is your decision.

**Another channel** on another Google account: run `video youtube login` in that channel's folder; it is saved under that channel's slug. Two channels can use the same Google Cloud client: copy the client id and secret into the new channel's file.

**Long videos:** YouTube lets an account that is not verified upload up to 15 minutes. Verify it once at youtube.com/verify (a phone number) to upload up to 12 hours.

## 6. The dashboard

`video dashboard --open` in a channel folder opens `videos/video-dashboard.html`: what needs you now, the numbers (videos in progress, uploaded, minutes, voice characters left, disk free), the work order with how many videos wait at each step, every video with its next command, a calendar (give a video a date with `"publish_on": "2026-12-01"` in its `video.json`) and a card per video that plays it. It redraws itself after every command that changes a video. `video dashboard --credits` reads your ElevenLabs characters left (a free read of your own account, only when you ask).

## 7. Reels from a video (with the Reel Kit)

When the channel is linked to a Reel Kit brand folder (`reels_folder`, asked at setup), `video reels <video>` lists the 20 to 50 second stretches that stand on their own. Pick some and `video reels <video> --pick 3-5,12-14 --apply` makes Reel Kit reel folders from them, in the same style, drawn vertical. In the reels folder, `/bagelunit-reels` gives each one its own hook, voice and approvals. The numbers they use are listed in `facts-from-video.md` for you to clear into that brand's `facts.md`.

## 8. What it costs and how long it takes

| | Per minute of video | One hour |
|---|---|---|
| Voice (ElevenLabs) | about 900 characters | about 55,000 characters; check your plan's monthly allowance first |
| Rendering | about a minute on a recent Mac | about an hour |
| Disk while it is built | about 65 MB | about 4 GB; `video tidy <video> --apply` frees most of it once uploaded |
| Claude | the research, writing and checks | your Claude plan |

Re-voicing after a change costs only the pieces whose words changed; changing the voice's speed is free with an up-to-date Reel Kit.

## 9. Updating

In this kit's folder: `git pull` (or download the new ZIP), then `bash setup/install.sh` again. Channel folders keep everything; your videos, brand files and sign-ins are never touched by an update. `CHANGELOG.md` says what changed.

## 10. When something stops

| It says | What to do |
|---|---|
| `not voicing yet: the map has not been approved` | Read the report and the map and say go; Claude records it with `video approve <video> map`. |
| `not voicing yet: ... fact check` | `video facts <video>` lists each number without a source: add the source to `research.md` or change the words. |
| `not enough ElevenLabs characters` | Top up, wait for the monthly reset, shorten the script or split the video into parts. |
| `QA: FAIL` | `video qa <video>` names the check that failed (for example a still stretch or the stand-in voice); fix it and render again. |
| `not sent: the final video has not been approved` | Watch the video and say yes; Claude records it with `video approve <video> final`. |
| anything else | `video doctor`, then tell Claude what it printed. |
