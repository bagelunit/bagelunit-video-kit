# BagelUnit Video Kit: the guide

From nothing installed to your first video on YouTube. Claude Code does nearly all of it with you: you type a command, answer questions in the boxes it shows, approve twice, and click the buttons that are yours to click (logging in, Allow, publishing).

Below, `video <command>` is short for `node ~/.claude/skills/bagelunit-video/tools/video.mjs <command>`. On Windows, `~` is your home folder and `python` replaces `python3`.

## 1. What you need

| | Why | Cost |
|---|---|---|
| A Mac, Windows or Linux computer with [Claude Code](https://claude.com/claude-code) | Claude runs every step | your Claude plan |
| [Node.js](https://nodejs.org) 22 or newer, and ffmpeg | the commands and the video files | free |
| The [BagelUnit Reel Kit](https://github.com/bagelunit/bagelunit-reel-kit), installed | the voice tool, the headless browser that draws the scenes, the fonts and the sound effects | free |
| An [ElevenLabs](https://elevenlabs.io) account with a key (optional: our suggested voice service for a natural voice; other providers can be connected) | the voice. With no key the free built-in voice speaks (needs the Reel Kit 1.3.0 or newer) | about 900 characters per minute of video (section 8); the built-in voice costs nothing |
| [Blender](https://www.blender.org) 4.2 or newer (optional) | 3D shots and terrain maps (`/blender-shot`); never needed for the rest | free |
| A YouTube channel and its Google account (optional) | uploading from this computer | free |
| Chrome (or Edge, Brave, Arc, Vivaldi, Opera) with Claude in Chrome (optional) | Claude does the web steps in your browser | free |

## 2. Install

1. **The Reel Kit first.** Follow its README: `bash setup/install.sh` in its folder. Its setup can walk you through an ElevenLabs key (optional: you paste it into a file Claude opens; nobody else sees it). With no key the free built-in voice speaks.
2. **This kit.** Download it (Code, Download ZIP, or `git clone https://github.com/bagelunit/bagelunit-video-kit`), open a terminal in its folder and run `bash setup/install.sh` (Windows: `node setup/install.mjs`). It checks ffmpeg and the Reel Kit and installs the skill `bagelunit-video`.
3. **Check.** `video doctor` lists what is installed and what is missing, with the command that fixes each. Its "voice" line says which voice will speak: ElevenLabs (a key is saved), the free built-in voice (basic quality; this computer's own speech engine, which needs the Reel Kit 1.3.0 or newer) or none yet (then it says what fixes it).
4. **Optional tools.** Blender (free 3D) is looked for but never installed for you: `bash setup/install.sh` prints its version, or a NOTE with how to get it (`brew install --cask blender` on a Mac, `winget install BlenderFoundation.Blender` on Windows, `sudo snap install blender --classic` or blender.org on Linux). `video doctor` says whether it is found. If it is installed somewhere unusual, set `BAGELUNIT_BLENDER` to its program. Only the 3D shots in a channel's `brand/library/3d/` need it.

## 3. Make a channel folder

Open Claude Code in this kit's folder and type **`/video-setup`**. Claude asks:

- the channel's name and where its folder goes (it becomes `<channel>-videos`);
- whether to start from a Reel Kit brand folder of the same brand (it copies the name, topic, colour, voice and cleared facts, and lets `video reels` make reels there);
- the channel questions: topic and audience, YouTube channel and default privacy (private unless you choose unlisted), voice, accent colour, usual styles, the line every video ends on, and how the channel talks.

**More channels:** run `/video-setup` again. Each channel has its own folder, topic, voice, facts and YouTube sign-in, so nothing leaks from one to another. To change a channel later, type `/channel-setup` in its folder.

By hand: `node setup/new-workspace.mjs ~/Videos/acme` (or `--from-reels <your reels folder>`), then `/channel-setup` in the new folder.

## 4. Your first video

Open Claude Code **in the channel folder** and type **`/bagelunit-video`** with your topic, for example `/bagelunit-video how volcanoes form`. What happens:

1. **Style.** Claude picks one of the 20 styles that fits the topic (your channel's usual ones first) and says why. `video styles` lists them.
2. **Research.** It reads real sources and writes `research.md`: every fact with its link, and what is uncertain or disputed.
3. **Report and map, then it stops.** You get the facts the video rests on, the style, the map from hook to payoff with the estimated length, three title options and thumbnail ideas, what the voice will cost, and parts to split it into if it runs long. **Say go, or what to change.** Nothing costs credits before this.
4. **Script and scenes.** The first 30 seconds follow the triple hook (context, a reason to lean in, then a turn they did not expect), each chapter opens with a small hook, and it ends on the payoff and your call to action. The script is checked (`video script`), read cold by a fresh agent (`/script-coldread`) and scored out of 100 (`/script-score`); it needs 90 or more before it can be voiced.
5. **Fact check.** Every number said or shown is checked against the research ("sixty four percent" matches "64%"), and Claude re-reads the sources before recording a pass.
6. **Voice.** It says which voice will speak. With an ElevenLabs key it checks your characters first and stops if there are not enough; with no key the free built-in voice speaks and needs no credits. A long script is voiced in pieces; a piece already paid for is never paid for again. If Whisper is not installed the word times are estimated and it warns that captions may drift. The voice refuses a script with no recorded review (only the owner can skip that, with a reason).
7. **Render.** Scene by scene, at 1920x1080, with sound effects on chapter changes and your music if you added one. Rendering takes about as long as the video.
8. **Checks.** A quality check of the file (size, length, loudness, black or frozen stretches), the pace of the picture (`video pace`), the music plan (`video musicplan`), the captions (`video captionscheck`), the mix (`video mixcheck`), the thumbnail (`video thumbcheck`) and a last fact check with the YouTube text. The last three need Python 3.
9. **Your yes.** Claude shows you the video, the thumbnail, the title and description, and a comment to pin. **Watch the whole video, start to end, then say yes** (or what to change). The upload waits until you have said you watched all of it.
10. **Upload.** A dry run first, then the upload, **private** unless you say otherwise, with captions made from the voice. Going public is always your call, made in YouTube Studio or by telling Claude. Afterwards, post the pinned comment yourself (the kit never posts comments): paste it under the video as the channel, then Pin.

To carry on with a video later: `/bagelunit-video <video name>`. To see everything at once: `video dashboard --open`.

## 5. Connect YouTube (once per channel)

The upload goes straight from your computer to YouTube through YouTube's own API. It needs a Google Cloud project of yours (free), a client file from it, and a one-time sign-in per channel. Publishing the app (recommended, step 4) also needs a website of yours for a home page and a privacy page. With Claude in Chrome turned on, Claude does each page in your browser; you log in, tick Google's agreements, click Publish, download the client file and choose the channel. Without it, do the same clicks yourself.

Do the steps in this order. Publishing (step 4) before anyone signs in (step 7) means each channel signs in once, not twice.

1. **A Google Cloud project.** console.cloud.google.com/projectcreate, any name. The project ID is made from the name and cannot be changed later. Google may first ask you to type your password again ("Verify it's you"). One project can serve several channels and several Google accounts; keep separate brands in separate projects (each project has its own consent screen and its own daily limit, step 9).
2. **The YouTube Data API v3.** console.cloud.google.com/apis/library/youtube.googleapis.com?project=<project ID>, Enable. Enabling it means agreeing to the YouTube API Services terms, so that click is yours. The page then says Enabled.
3. **The consent screen.** Google Auth Platform (console.cloud.google.com/auth/overview?project=<project ID>), Get started:
   - **App name:** anything, for example "<your brand> Uploader".
   - **User support email:** the list offers only the signed-in account and the Google Groups it manages.
   - **Audience: External** (recommended). It works with YouTube Brand Accounts: the sign-in lists the owner's account and every Brand Account channel. Internal works only for accounts in the same Google Workspace organization; it needs no privacy page and never signs you out after 7 days, but it cannot be published and may refuse Brand Accounts.
   - **Contact information:** type the developer email, then press Enter so it becomes a chip, then Next.
   - **Finish:** tick "I agree to the Google API Services: User Data Policy" (your click), Continue, then the blue **Create** button at the bottom.
   - **Check that it saved.** Open Audience: it must say **Testing** and **External**. On our first try it did not save (Overview still said "not configured yet"). If that happens, fill it in again, and turn off any content blocker for the page (ours had blocked www.gstatic.com).
4. **Branding, then publish, before anyone signs in.**
   - **Branding** (console.cloud.google.com/auth/branding?project=<project ID>): the application home page (your channel's or business's website) and the privacy policy link (a page on that site, see "The privacy page" below). "Missing domain: <domain>" appears: Add domain, type the domain, then Save, and wait for "Branding changes saved!". Do not upload a logo: a logo makes Google review the app before it works.
   - **Publish:** Audience, **Publish app** (it can be clicked only once Branding is saved), then Confirm on "Push to production?". The status becomes "In production".
   - The app works without Google's review: the sign-in shows an "unverified app" warning, and up to 100 accounts can use it. The kit asks for two permissions: uploading (the youtube.upload scope) and managing the channel (youtube.force-ssl, which captions need). Both are sensitive scopes, not restricted ones, so no review is needed to use them on your own channels; the warning is the same.
   - Publishing is public, so it is your decision. If you keep the app in Testing, add a test user (step 5) and sign in again every 7 days.
   - **Why before sign-in:** a sign-in made while the app is in Testing keeps its 7-day end even after you publish. Every channel then has to sign in again.
5. **Test users (only if the app stays in Testing).** Audience, Test users, Add users: the Google account that owns the channel or channels, then Save. The first Save click may not register: check that the account appears in the list.
6. **The client file.** Clients, Create client, application type **Desktop app**, any name. Leave "Use this client for an AI-powered agent" unticked. Create. In the dialog click **Download JSON** (do not copy the secret out of the dialog), then OK. Claude never opens or screenshots that dialog or that file. Then, in the channel's folder:

   ```
   video youtube login --client ~/Downloads/client_secret_<...>.json
   ```

   It checks the file without printing it, saves it as this channel's sign-in file (`~/.config/bagelunit-video/youtube-<channel slug>.json`, readable by you only), deletes the copy in Downloads and goes straight on to step 7. Add `--all` to install the same file for every channel made with `/video-setup` (several channels on one project; each still signs in on its own). If several `client_secret_` files are in Downloads, use the newest: an older one may be from another project. Without the downloaded file, `video youtube login` makes the sign-in file with `PASTE-...` in place of the client id and secret, for you to paste them in.
7. **Sign in, one channel at a time.** In that channel's folder run `video youtube login` (after `--client`, it has already started). It opens the sign-in page and waits 5 minutes.
   - Choose the Google account that owns the channel.
   - In "Choose your account or a brand account", choose this channel. If two start with the same letter, tell them apart by the colour or picture of their icon.
   - On "Google hasn't verified this app": Advanced, "Go to <app name> (unsafe)" (it is your own app), then Continue.
   - Google lists what the app asks for: to upload videos, and to see, edit and delete your YouTube videos and their captions (that second one is what adds captions). Tick both. **Know what you are saving:** this sign-in stays on this computer, in the channel's file, readable by your user only and never printed, and it can manage the channel, so treat the computer's user account as you would the channel's password. For uploads only, run `video youtube login --upload-only`: then captions are skipped and you add them in YouTube Studio.
   - The terminal says "Signed in". Then the next channel, from its own folder.
   - **Signed in before captions existed?** That sign-in can only upload: captions are skipped with a note. Run `video youtube login` again in that channel's folder to add the second permission.
   - **Several channels on one Google login (Brand Accounts):** to look at a channel in YouTube Studio, switching at youtube.com/channel_switcher may not change the channel Studio uses. What worked: the "Switch account" link on Studio's "you don't have permission" page.
   - **Claude doing the sign-in in your browser:** `BAGELUNIT_NO_BROWSER=1 video youtube login` prints the address instead of opening your default browser, so it can be opened in the Chrome profile signed in to the channel's account.
   - **"nobody signed in within 5 minutes":** nothing was saved. Close the old sign-in tab (the address it answers to is gone) and run `video youtube login` again.
8. **Check each channel's first upload.** The upload permission cannot read which channel a sign-in belongs to, so the right Brand Account is checked after the upload, against `youtube.channel_id` in the channel's `brand/brand.json` (asked by `/channel-setup`; it starts with UC, and youtube.com/account_advanced shows it while you are switched to that channel). If YouTube puts the video on another channel, the upload ends with a loud WRONG CHANNEL warning: delete the video in YouTube Studio on that channel, sign in again (step 7) and upload again with `--again`. If the ID is not saved yet, the upload prints the channel it went to: keep that first upload private (the default), find it in the right channel's YouTube Studio, then save the ID.
9. **Limits.** A project gets about 10,000 API units a day and an upload costs about 1,600 (the thumbnail 50 more, each caption track 400), so about 5 uploads with captions a day per project, shared by every channel on it. When it is used up, the upload says so; try again the next day. An account that is not phone-verified can upload up to 15 minutes: verify it once at youtube.com/verify to upload up to 12 hours.

**The privacy page.** YouTube's API policies want the privacy page to say that the app uses YouTube API Services, link the Google Privacy Policy (policies.google.com/privacy), say what data the app accesses, stores and shares, give the link where access can be taken back (security.google.com/settings/security/permissions), and give a way to ask for deletion. A deletion request must be acted on within 7 days. Give the part its own heading so the branding link can point straight at it (for example `/privacy#youtube`). An example, to change to your own words and address:

> **YouTube uploads.** Our upload tool uses YouTube API Services to upload videos to our own YouTube channels and to add their captions. It asks Google for permission to upload videos and to manage our channels' videos and captions. It does not read, store or share any other YouTube or Google account data. The sign-in Google gives it is stored on our own computer, readable only by us, and is never shared. Google's Privacy Policy: https://policies.google.com/privacy. You can take back the tool's access at any time at https://security.google.com/settings/security/permissions. To ask us to delete any data the tool holds, write to <your email address>; we act on it within 7 days.

**Another channel later.** Same brand: Google shows the client file only once, so take the client from a channel that has it. In the new channel's folder, `video youtube login --client ~/.config/bagelunit-video/youtube-<existing slug>.json`: it copies only the client (never that channel's sign-in) and leaves that file as it is, then step 7. Another brand: its own project, steps 1 to 8.

## 6. The dashboard

`video dashboard --open` (or `/db`) in a channel folder opens `videos/video-dashboard.html`: what needs you now, the numbers (videos in progress, uploaded, minutes, voice characters left, disk free), the work order with how many videos wait at each step, every video with its next command, a calendar (give a video a date with `"publish_on": "2026-12-01"` in its `video.json`) and a card per video that plays it. It redraws itself after every command that changes a video, and links the newest channel review (below). `video dashboard --credits` reads your ElevenLabs characters left (a free read of your own account, only when you ask).

**Channel review.** Once a few videos are up, ask Claude how the channel is doing. It needs YouTube Studio's own numbers, as a file: Studio, Analytics, Advanced mode, Content, add the metrics Impressions, Impressions click-through rate, Average view duration, Average percentage viewed, Views and Watch time, then Export current view, Comma-separated values, and unzip it. `video review <channel folder> "<unzipped folder>/Table data.csv"` writes `reviews/<date>.md`: what the numbers say, what might explain it, and up to 5 tests for the next video. It never guesses a number; without a file it says which one to download.

## 6b. Source check and backup

`video sources <video>` checks every DOI in a video's research, script and description at Crossref (free, no key) and lists the real title, first author and year of each, so a wrong DOI is caught; a DOI that does not exist fails with exit code 1. It also saves public source links in the Wayback Machine (`--no-archive` skips that). It sends only public links and a polite User-Agent with no personal details (`BAGELUNIT_CONTACT` adds an address if you want one). Result: `source-safety.md` in the video's folder.

`video archive <video> --to gdrive:Videos` copies the finished files, the text and the voice you paid for with [rclone](https://rclone.org/install/) (install it and run `rclone config` once, yourself; the kit never asks for or stores a key), then compares checksums and writes `archive.json`. `video tidy` warns when an episode has no such record. To back everything up every night, `scripts/nightly-backup.sh` in the channel folder runs it for every video; it is a template that is not scheduled: set `BAGELUNIT_BACKUP_TO`, try it once by hand, then schedule it with cron, launchd or Task Scheduler if you want.

## 6c. Licensed assets

Music, sound effects, stock video, motion graphics and LUTs may come from any source you have the rights to use. **Uppbeat** (uppbeat.io, Business plan) is the one we use and suggest, but it is only a suggestion. The kit ships none of them and has no way to download them (Uppbeat has no API): you download by hand, the kit records and uses what you downloaded. **YouTube only:** the vertical Instagram version carries none of it.

1. On the site you license it from (for example uppbeat.io) open the track, effect, clip or LUT and download it. For music and sound effects choose **WAV** if the site offers it.
2. If your source has a safelist (Uppbeat: **Account**, then **Safelist**), add this channel's YouTube channel (do it before the first upload, or YouTube may flag the music).
3. In the channel folder: `video licensed add ~/Downloads/clear-skies.wav --type music --title "Clear Skies" --artist "..." --url "https://uppbeat.io/track/..." --source uppbeat --plan business --channels <channel slug>`. It copies the file into `brand/licensed/music/`, records its sha256 in `brand/licensed/assets.json` and refuses a missing file or an id already used. A LUT must be a real `.cube`. `video licensed list` and `video licensed check [<video>]` show and check them; `video licensed channels <id> a,b` changes the safelisted channels; `video licensed remove <id>` takes one out.
4. Use it by id in a video (`brand/licensed/README.md` has the exact settings): `"music": [{"asset": "clear-skies", "from": "intro", "fade": 2, "gain_db": -18}]`, `"look": {"lut": "warm-film", "strength": 0.6}`, a scene `{"clip": {"asset": "city-aerial", "start": 4, "duration": 6}, "narration": "..."}` for a stock cutaway, or an `"overlay": {"asset": "dust", "blend": "screen", "opacity": 0.6, "at": 1.5}` on any scene.
5. Before the final approval write the credits: `video licensed credits <video>` adds a "Music and assets" block to `out/youtube.txt`. `video approve <video> final` refuses while `video licensed check` fails (an asset not recorded, a file or hash that changed, the channel not in its `channels`, or the credits missing) and records the list with the credits.

Licensed video and overlays decorate; they never carry the story. `assets.json` is kept in git, the media files are not.

## 6d. 3D shots and maps (optional)

With Blender installed, `/blender-shot` in a channel folder makes a product, phone, title or map shot, renders a still to look at, then a clip into `videos/<name>/assets/blender/` (not kept in git), and wires it into `scenes.json` as your own render: `{"clip": {"file": "assets/blender/product.mp4"}, "narration": "..."}` or `"overlay": {"file": "assets/blender/title.mov"}`. Your own renders need no licensed-asset record and no credit, may be used in the vertical version, and must stay inside the channel folder. `video thumbnail <video> --image assets/blender/product-still.png --text "..."` uses a still as the thumbnail's picture. The optional Blender Lab MCP (`claude mcp list` shows `blender`) is a faster live path; nothing needs it.

`brand/library/3d/terrain.py --bbox SOUTH,WEST,NORTH,EAST --video <name>` makes a shaded-relief map. It downloads the free Terrain Tiles (no key; the one place the kit uses the network, only when you run it, a few tiles at a time, cached in the video folder), writes `ATTRIBUTION.txt` next to the render and prints it: put it in the video description.

## 6e. Optional tools that improve results (all suggested, none required)

The kit renders every video in code, with no outside tool. Some tools make a result better: a natural voice (ElevenLabs), licensed music (Uppbeat, Epidemic Sound), 3D (Blender with the Blender Lab MCP), generated shots (Higgsfield or another tool; `/generated-shots` records them with their label), and thumbnails and graphics (Canva, Adobe Firefly or Express, the Adobe connector). `/channel-setup` asks once near the end whether to show them; `/suggested-tools` (or `video suggest`) any time. It lists each tool with what it adds and a concrete example, asks with selectable questions which ones you have (or none, or something else you type), records your answers in `brand/brand.json`, and walks through connecting the ones you have. Detection looks only at what is on this computer (a program, a key file that exists, a connector Claude already has); nothing is sent anywhere and a key is never read. At the matching step (`video new`, `video thumbnail`, `video render`, `video voice`) one short `Tip:` line may appear when a tool would help; `video suggest --dismiss <id>`, `--no-tips`, `BAGELUNIT_NO_TIPS=1` or `"tools": {"tips": false}` silences it.

**Research and competitors (Apify, optional).** `video suggest apify` explains it: a pay-as-you-go scraping platform whose token, saved alone on one line in `~/.config/bagelunit-reels/apify.key` (the file the Reel Kit uses; Claude makes it empty and opens it, you paste the token, never into the chat), lets `video competitors` (the `/competitors` skill) read other channels' public video lists to track competitors. Check Apify's site for plans and terms: Apify bills you, the kit only estimates. A read needs your yes: `video competitors sync` is a dry run that shows the estimated cost and what would be sent; a real read also needs the token file, `"autopilot": {"scrape": true}` in `brand/brand.json` (your switch, false by default), `--yes` and an estimate under `--max-cost` (1.00 unless you say otherwise), and it is never scheduled. Apify is only one way: `video competitors import <handle> <file>` takes an export file or a CSV from anywhere and needs no account at all.

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

In a channel folder, type `/video-update` (or run `video update`). It is a dry run first: it finds the kit folder you installed from (recorded at install time, or `~/dev/bagelunit-video-kit`, or `--kit <folder>`), shows this version and build against the kit's, runs `git fetch` and says how far behind `origin/main` it is, lists what a pull would bring and what would change in this channel folder. Then `video update --apply` does it, in order: `git pull --ff-only` in the kit folder (only when it is behind and its tracked files have no uncommitted change, otherwise it stops and says why), `bash setup/install.sh` (Windows `node setup/install.mjs`) to install the engine again, then the channel folder: it replaces the files the kit owns (`CLAUDE.md`, `.claude/skills`, `scripts`, `brand/licensed/README.md`) after saving each old one next to it as `<name>.bak-<stamp>`, adds missing starter files, new `brand/brand.json` settings and `.gitignore` lines. Your videos, brand values, licensed assets, sign-ins and `CLAUDE.local.md` are never touched. `--all` updates every channel folder on this computer; `--no-fetch`, `--no-pull` and `--no-install` skip those steps. Restart Claude Code afterwards so the new engine and skills load. Without the skill: in the kit's folder `git pull`, then `bash setup/install.sh` again. `CHANGELOG.md` says what changed.

## 10. When something stops

| It says | What to do |
|---|---|
| `not voicing yet: the map has not been approved` | Read the report and the map and say go; Claude records it with `video approve <video> map`. |
| `not voicing yet: ... Script review` | The script has no recorded review for its exact words. Run `/script-coldread` then `/script-score` (it records the line, `video script <video> --record --score NN`), or, only if you are the owner, `video voice <video> --skip-script-review "why"`. |
| `not voicing yet: ... fact check` | `video facts <video>` lists each number without a source: add the source to `research.md` or change the words. |
| `not enough ElevenLabs characters` | Top up, wait for the monthly reset, shorten the script or split the video into parts, or remove the key to use the free built-in voice. |
| `Python 3 is needed for ...` | `video mixcheck`, `video thumbcheck` and `video abtest` are Python 3 scripts: install Python 3 (python.org) and run again. |
| `QA: FAIL` | `video qa <video>` names the check that failed (for example a still stretch or the stand-in voice); fix it and render again. |
| `not sent: the final video has not been approved` | Watch the video and say yes; Claude records it with `video approve <video> final --watched`. |
| `not sent: ... does not say the person watched the whole final cut` | Watch all of it, start to end, and say so; Claude records it with `video approve <video> final --watched`. |
| `captions not sent: this sign-in only allows uploads` | `video youtube login` again in the channel's folder (tick both boxes), then `video youtube captions <video>`. |
| anything else | `video doctor`, then tell Claude what it printed. |
