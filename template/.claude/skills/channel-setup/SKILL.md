---
name: channel-setup
description: Sets up this YouTube channel folder, or changes its settings later - the channel's name, topic and audience, voice, accent colour, usual styles, call to action, upload privacy, YouTube sign-in and reels folder. Use on /channel-setup, on the first session in a channel folder whose brand/brand.json has no name, or when the owner says "set up the channel", "change the channel's voice", "change the colour", "connect YouTube" or "link my reels folder".
---

# Channel setup

Fills in `brand/brand.json`, `brand/voice.md` and `brand/facts.md` for this channel. Ask every question with the AskUserQuestion tool: up to four questions per block, two to four options each, the recommended option first with "(Recommended)" after its label. For typed answers (a name, a colour code, a path) offer the best guesses as options and let the owner type the real answer under Other. Never guess an answer or fill a field the owner did not confirm. Skipped questions leave the field empty; say which ones are empty at the end.

When this folder was started from a Reel Kit brand folder (`reels_folder` is set and fields are already filled), show what was taken from it in one short list and ask only what is still empty or what they want to change.

## The questions

1. **The channel.** Its name (suggest one from the folder name), and a short slug for files (lowercase with dashes; suggest one). The slug also names the channel's YouTube sign-in, so two channels never share one.
2. **Topic and audience.** What the channel is about (a few words), who watches (one sentence), 3 to 5 phrases they would type into YouTube search. Saved in `niche`; topics, titles and descriptions come from it.
3. **YouTube channel.** The channel's name on YouTube and its handle (offer "No channel yet"). Its channel ID if the owner has it (it starts with UC; youtube.com/account_advanced shows it while switched to that channel), saved in `youtube.channel_id`: every upload is checked against it. Offer "Later": the first upload prints it. Default privacy for uploads: "Private (Recommended)", "Unlisted". The language the channel speaks, saved as a code in `youtube.language` ("en" unless it is another; it goes to YouTube with each video and names the captions file). Public is never a default: each video goes public on the owner's say-so.
4. **Voice.** "Use the voice saved in the kit (Recommended)" (the Reel Kit's saved voice), "Pick an ElevenLabs voice together now" (`python3 ~/.claude/skills/bagelunit-reels/tools/voicebank.py search "<description>"`, then `preview <id>` and play the files; `add` only with the owner's yes, it changes their ElevenLabs account), "Decide later". Then words the voice must never say, and how to spell any tricky name by sound (saved in `voice.never_say` and `voice.pronunciation`). Long videos keep a natural pace: `voice.speed` 1 unless the owner wants it faster.
5. **Look.** The accent colour as a hex code (used by thumbnails and the dashboard; offer to read it from a logo if they give a path). The usual styles for this channel (`node ~/.claude/skills/bagelunit-video/tools/video.mjs styles` lists the 19; suggest two or three that fit the topic) and any never to use.
6. **Call to action.** The one line every video ends on (for example "Subscribe for a new explainer every week", or a link in the description). Offer two that fit the channel.
7. **Reels** (optional). "Link a Reel Kit brand folder" (its path; check it holds `brand/brand.json`) so `video reels` can make reels from these videos there, or "No reels".
8. **How it talks.** Offer: "Write voice.md from 2 or 3 scripts or videos I send (Recommended)", "Answer a few questions now", "Later". Then fill `brand/voice.md`.

## Then

- Write the answers into `brand/brand.json` (keep its shape; empty strings for skipped fields).
- Run `node ~/.claude/skills/bagelunit-video/tools/video.mjs dashboard --open`.
- YouTube sign-in: offer it now or at the first upload. It is `SETUP.md` section 5 of the Video Kit (a Google Cloud project with the app published before anyone signs in, and a "Desktop app" client whose downloaded file becomes this channel's sign-in file; done in the owner's browser with Claude in Chrome), then `video youtube login` from this folder. Check the channel's first upload in YouTube Studio: the sign-in cannot tell which channel it belongs to.
- End with the next command: `/bagelunit-video <topic>` to make the first video.
