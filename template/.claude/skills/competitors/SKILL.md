---
name: competitors
description: >
  Tracks other YouTube channels in this channel folder: which videos beat each channel's own median views (an outlier is 3x
  or more, counted only with at least 10 videos), what their titles have in common, and which topics repeat across several
  channels, then offers testable ideas for the next outline. Channels are read with Apify (paid by the owner, never without
  their yes and a cost shown first) or from an export file; Apify is only one way. Use on /competitors, or when the owner says
  "track my competitors", "what is working for other channels", "find outlier videos", "what are rivals posting" or
  "ideas from other channels".
user-invokable: true
argument-hint: "[channel names or links]"
metadata:
  author: BagelUnit
  version: "1.0.0"
  category: research
---

# /competitors: what is working for other channels

Trigger: `/competitors`, "track my competitors". Inputs: the channels to track (names or links, up to 30), and either an Apify token or an export file. Outputs: `brand/competitors.json`, `brand/research/youtube/` (one CSV per channel, `history.csv`, `outliers.md`, `outliers.json`) and a short card on the dashboard. Next step: pick an idea for the next outline (`/bagelunit-video <topic>`).

Say plainly, once, before anything is read:
- **Apify bills the owner.** Reading a channel's public video list with Apify costs money on the owner's own Apify account. The kit only estimates the price (videos x a per-video estimate in `brand/brand.json` `research.youtube.cost_per_video`; check the plan on apify.com), shows it first, and **nothing runs without the owner's yes**.
- **Apify is only one way.** An export file works too (`video competitors import <handle> <file>`: a scraper export or a CSV from anywhere with title, views and a date). The Video Kit works without any of this. `video suggest apify` explains Apify and how to connect it (a token saved in `~/.config/bagelunit-reels/apify.key` by the owner, never pasted into the chat).
- A real read needs all of: the token file, `autopilot.scrape` set to true in `brand/brand.json` by the owner, `--yes`, and an estimate under `--max-cost` (default 1.00). It never runs on a schedule.

Ask every question with the AskUserQuestion tool (the block with options and "Other"), the recommended option first. Never ask for, print or store a token.

1. **Which channels.** Ask which channels to track. Options: the channels already in `video competitors list`, "Use the channels in brand.json niche research" (only when `brand/brand.json` `niche` has search terms or channels to start from; look through them with the owner first), and "Other" for typing channel names or links (`@handle`, `youtube.com/@name`, `/channel/UC...`). Add each with `video competitors add <channel> [--tag niche|adjacent|big]` (`niche` is the owner's own field, `adjacent` is next door, `big` is a giant to learn from). Up to 30.
2. **Where the videos come from.** Ask: "Read them with Apify (costs money)" or "I have an export file" or "Not now". For a file: `video competitors import <handle> <file>` per channel, then go to step 5.
3. **A dry run first, always.** Run `video competitors sync --dry-run [--max N] [--shorts]` and show the owner the channels, the estimated number of videos and the estimated cost ("estimated, check your plan on apify.com"), and what would be sent (channel links and counts only). Then ask: "Run it (Recommended: only after you checked the cost)", "Change the number of videos" (back to the dry run with another `--max`), or "Cancel". Between 20 and 40 videos a channel is enough for the median; fewer than 10 long videos means no outlier is claimed.
4. **Run it, only on their yes.** If `video competitors sync --dry-run` says `autopilot.scrape` is OFF, tell the owner what it means and let them turn it on themselves in `brand/brand.json` (`"autopilot": {"scrape": true}`); do not edit it for them without a clear yes. Then `video competitors sync --yes [--max N] [--max-cost USD]`. A channel that fails is reported and the others continue; an out-of-credit or bad-token message stops the run. Say what each one said, in plain words.
5. **Read it to them.** `video competitors report`. Lead with the ranking, then the outliers (always the channel and the video), then the title shapes and repeated topics. Say plainly: dates are approximate (the scraper gives text like "10 months ago"), a small sample means no conclusion, and a repeated topic is a pattern, not proof. Never state a number the report does not hold.
6. **The ideas.** Offer the report's ideas as a choice with AskUserQuestion (each idea with its evidence), plus "None of these". Carry the chosen one into the next outline: `/bagelunit-video <topic>`.

`video dashboard --open` shows a small Competitors card (channels tracked, last pull, the top 3 outliers, a link to `outliers.md`).
