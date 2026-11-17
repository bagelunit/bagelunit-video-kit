# music-plan.md: the music follows the chapters

A long video that keeps one music loop from start to end feels flat. This channel plans the music with the outline: each chapter gets a mood, and where the mood changes the music changes with it, under the voice. This page is the starter. Copy the table into the video's `outline.md` (under a heading that says "Music plan") at the outline stage, before the script, and fill it in with the map the person approves. Delete the example row.

## Why plan it

- The hook wants energy, a middle chapter that explains wants a calm bed, a twist wants tension, the payoff wants warmth, the last 10 to 20 seconds (the end screen) want the music to settle.
- A change in mood without a change in music is invisible. A change in music without a change in mood is distracting. The plan keeps the two together.
- Nothing is invented here: music is licensed material from a source you have the rights to (Uppbeat is the one we suggest), recorded with `video licensed add` in `brand/licensed/assets.json`. The plan names the asset by its id. A chapter that keeps the track before it says `none`.

## The table (copy this into outline.md)

```
## Music plan

| Chapter | Mood | Tempo | Energy | Asset |
|---|---|---|---|---|
| <chapter title as in scenes.json, or its number> | <mood, in two words> | <slow, medium, fast, or a BPM> | <what changes: start low, builds, drops, resolves> | <asset id or none> |
```

- **Chapter**: the title you will give the scene's `"chapter"` in scenes.json (2 to 6 words), or the chapter's number (1, 2, 3).
- **Mood**: two words, for example `curious, light` or `tense, building`. Moods that differ from one row to the next are a change: the music should crossfade there.
- **Tempo**: `slow`, `medium`, `fast` or a number of beats a minute. Keep it close to the voice: music under narration is usually slow to medium.
- **Energy**: what happens to the intensity at this chapter's start: `start low`, `builds`, `peak`, `drops`, `resolves`.
- **Asset**: the id from `brand/licensed/assets.json` (`video licensed list --type music` shows them), or `none`.

## Turning the plan into video.json

One entry in the `music` list for each chapter that changes the music, starting at the chapter's first scene (`from` is that scene's `"id"`, or a number of seconds):

```
"music": [
  {"asset": "quiet-morning", "from": "hook", "fade": 2, "gain_db": -20},
  {"asset": "slow-pressure", "from": "the-twist", "fade": 3, "gain_db": -20},
  {"asset": "quiet-morning", "from": "payoff", "fade": 4, "gain_db": -20}
]
```

Give each scene that starts a chapter an `"id"` in scenes.json so `from` can name it. Use a `fade` of 1 second or more where the mood changes: that is the crossfade. A track keeps playing until the next entry starts, so a chapter with `none` (no entry of its own) simply carries on with the track before it. To drop the music for a chapter, give it a very quiet bed instead of silence.

## Checking it

`video musicplan <video folder>` reads the table and the `music` list and reports: a chapter with no music entry, an entry that does not start on a chapter, an asset that is not in the register, and a mood change with a crossfade under 1 second. `video mixcheck <video folder>` then measures the finished mix: the voice against the bed, and each chapter's loudness against the whole video.
