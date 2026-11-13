# Changelog

## 0.1.0 (not released)

The first working draft of the BagelUnit Video Kit: long and standard 1920x1080 videos.

- The 19 scene styles, synced from the styles repo for the wide format.
- `video` commands: styles, new, plan, stand-in, voice (in chunks, so a long script works), check, render, chapters, thumbnail, doctor.
- YouTube long-form upload from this computer: one-time sign-in, dry run first, private by default, never twice.
- The voice is at natural pace (the Reel Kit speeds reels up); `"voice_speed"` in video.json changes it.
- Research before anything is written: `research.md` with every fact and its source, then a report and a map of the video from start to end, and nothing more until the person says go. The voice refuses to start before research is done (or video.json says why none is needed).
- Long videos: no length limit; parts are suggested past about 20 minutes, with what a long video costs in time, disk and voice characters, and YouTube's 15-minute limit for unverified accounts.
- Videos in a brand folder: `videos/<name>` next to `reels/`, with the brand's voice, cleared facts, never-say lists and call to action.
- Checks taken from the Reel Kit: `video facts` (every number said or shown must be in the research, spoken numbers included, then a recorded verdict), `video approve map|final` (the voice waits for the map approval, the upload for the final one, tied to the exact files), a credit check before the voice, `video qa` (format, length, loudness, black and still stretches, a real voice) and `video tidy` (frees the disk once a video is up).
- Installer, repo scan and tests.
- Tried for real: a 4.6-minute, 24-scene video with music under a stand-in voice, and a real ElevenLabs voice in three chunks (reused, not paid again, on a second run). Not yet tried: a real YouTube upload.
