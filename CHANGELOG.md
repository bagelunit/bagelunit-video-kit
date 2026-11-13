# Changelog

## Unreleased

**Connecting YouTube, rewritten from a real setup** (SETUP.md section 5)
- The steps follow a real setup of six Brand Account channels on one Google account: the project, the API, the consent screen, branding, publishing, the client file, the sign-in, the first-upload check and the limits, in that order.
- Publish the app before anyone signs in: a sign-in made in Testing keeps its 7-day end even after publishing.
- External, not Internal, for YouTube Brand Accounts; check that the consent screen saved ("Testing" and "External") before going on.
- Download Google's client file instead of pasting the secret; the kit reads it as it is. One file can serve every channel on the project.
- `video youtube login --client <downloaded.json>` installs Google's client file as this channel's sign-in file, readable by you only, without printing it, deletes the download and signs in. `--all` installs it for every channel made with `/video-setup`. Given another channel's sign-in file, it takes only the client, never that channel's sign-in.
- What the privacy page needs, with an example.
- The right channel, checked after every upload: the upload permission cannot tell which channel a sign-in belongs to, so YouTube's answer is compared with the new `youtube.channel_id` in `brand/brand.json` (asked by `/channel-setup`). A wrong Brand Account ends with a loud WRONG CHANNEL warning and exit code 1, and the thumbnail is not set. With no ID saved yet, the upload prints the channel it went to.
- The daily limit: about 6 uploads a day per project, shared by every channel on it.

**From a studio running six channels on the kit** (field notes, 13 November 2026)
- A 20th scene style, `deep-zoom`: a 3D, cinematic science-documentary look drawn on one canvas, with bold documentary capitals (hero objects, scale dives, crystal lattices, molecules, particle fields, data and timelines).
- Silence in the voice: `"pause": 4` on a scene puts that many seconds of silence at its start when the voice is joined (a brand intro, an end card, a breath), and moves the word clock after it. A word that would run over the splice is cut at it, so it can never take the silence as its own length. Changing a pause later costs nothing: the voice pieces are reused.
- Fixed: the voice came out 0.45 s short at every join between pieces (the breath between them was dropped while the word clock counted it), so captions and scene cuts ran later and later through a long video. The join now keeps the breath.
- After joining, the word clock is checked against the audio, piece by piece: a clock that runs past the audio is a warning with both times.
- Rendering after a voice change re-draws only the scenes whose own words or length changed. A scene that only moved in time keeps its render; only its clip's sound is made again.
- `video captions <video>`: `out/captions.<lang>.srt` from the word clock, 2 lines of at most 42 characters, a new caption at each sentence and pause, names spelled for the voice written their real way. The language comes from video.json `"language"`, else the channel's `youtube.language`, else English.
- Music: `"music_fade": [in, out]` cuts the music to the video's length with a fade in and out. Without it the music now fades out over the last 3 seconds instead of stopping dead. A track shorter than the video still loops.
- `"end_card": 15` in video.json runs the picture on after the voice for YouTube's end screen; QA accepts the extra length and a still card.
- `video thumbnail --plain` (or `"thumbnail": {"plain": true}`): every word white, no accent-coloured word.
- Fixed: a scene's own `"sfx"` cue in scenes.json was ignored by the render.

**YouTube**
- The sign-in now asks to upload and to manage the channel, so captions can be added; `video youtube login --upload-only` asks for uploading only. A sign-in made before needs `video youtube login` again for captions. SETUP.md says what the permission allows and that it stays on your computer.
- Captions go up with the video; `video youtube captions <video>` adds them to a video already up, never the same file twice. The upload refuses captions made before the voice last changed.
- video.json `"tags"`, `"language"` and `"publish_at"` (scheduled publishing: a time with its offset, private until then). Tags are counted the way YouTube counts them; a language that is not a code, a list that is not a list, or a time without its offset is refused in the dry run.
- The description gets the sources listed in research.md, unless it already names them (`"description_sources": false` turns it off).
- `out/pinned-comment.txt`: a comment to pin, approved and fact-checked with the rest. The dry run shows it; the upload never posts it, you pin it yourself.
- The upload needs your final approval to say you watched the whole final cut: `video approve <video> final --watched`. The dry run shows whether it is recorded.
- `BAGELUNIT_NO_BROWSER=1 video youtube login` prints the sign-in address instead of opening the default browser.
- SETUP.md: switching between Brand Account channels in YouTube Studio, and the caption quota.

**Channel review**
- `video review <channel folder> <export.csv ...>` reads YouTube Studio's own CSV exports (Advanced mode) and writes `reviews/<date>.md`: what the numbers say, each with its video and the video folder it matches, kept apart from what might explain them, small samples and young videos flagged, missing columns named, and up to 5 tests for the next video. It never guesses a number: without an export it says which one to download. The dashboard links the newest review.

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
