# Changelog

## 1.0.0 (12 November 2026): the first public release

Make YouTube videos with Claude Code, long or standard, at 1920x1080. It needs the BagelUnit Reel Kit installed first.

**Channels**
- One folder per YouTube channel, made with `/video-setup`: its own name, topic, voice, colours, cleared facts, YouTube sign-in and videos. Run as many channels as you like; a channel can start from a Reel Kit brand folder.
- `/channel-setup` in a channel folder sets it up or changes it later.

**Making a video** (`/bagelunit-video` with a topic)
- 19 animated scene styles, picked to fit the topic.
- Research first: every fact with its source in `research.md`. Then a report and a map of the video from start to end, title and thumbnail options, the estimated length and what the voice will cost, and nothing more until you say go. Past about 20 minutes it suggests parts; there is no length limit.
- The first 30 seconds follow the triple hook (context, a reason to lean in, a turn they did not expect); chapters open with their own hooks; the video ends on the payoff and your call to action.
- A fact check of every number said or shown (spoken numbers too), before the voice and again before upload.
- The voice at a natural pace, in pieces for long scripts, after a check of your ElevenLabs characters; a piece already paid for is never paid for again.
- Rendering scene by scene, with sound effects made in code on chapter changes and your own music ducked under the voice, at -14 LUFS.
- A quality check of the finished file, YouTube chapters, and thumbnails with words in your accent colour (versions for YouTube's thumbnail test).
- Your yes on the finished video, recorded with a fingerprint of the exact files; the upload refuses anything changed after it.

**YouTube**
- Upload from your computer through YouTube's own API: a dry run first, private by default, the thumbnail set, never the same video twice, resumes if the connection drops. One sign-in per channel.

**Also**
- A dashboard for each channel: what needs you, the numbers (voice characters left, disk free), the work order, every video with its next command, a calendar and a card that plays each video.
- Reels from a video: the stretches that stand alone become Reel Kit reels in the same style, drawn vertical.
- `video tidy` frees the disk once a video is up.

**Tried for real before release:** a 4.6-minute, 24-scene render with music; an 80-minute plan; a real ElevenLabs voice in three pieces, reused without charge on a second run; the quality check, the fact check and both approvals end to end; reels drawn by the Reel Kit. **Not yet tried with a real account:** the YouTube sign-in and upload (tested against a stand-in for YouTube's API).
