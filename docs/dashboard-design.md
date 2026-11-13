# Video dashboard: design notes

For anyone changing `studio/dashboard/`. The video dashboard is modelled on the BagelUnit Reel Kit's content dashboard and keeps its look and its rules, so a brand owner who knows one knows the other.

## Who it is for

A brand owner checking in once or twice a day. In five seconds it must answer: how am I doing, what needs me, what is next. Everything on it is real data from the video folders (and the ElevenLabs characters left, read only when asked); nothing is invented to fill space.

## Where it lives

`video dashboard` writes `video-dashboard.html` next to the videos: `<brand>/videos/video-dashboard.html` in a Reel Kit brand folder, else in the folder given. After any command that changes a video (`new`, `voice`, `render`, `facts`, `approve`, `qa`, `tidy`, `youtube` and the rest), `video.mjs` redraws a dashboard that already exists above that video. It never fails the command.

## Look

- Light paper world: off-white paper (#EFEFEE) with a faint 48 px grid and a soft glow of the brand's colour at the top. Raised surfaces are #FBFBFD, ink #16121F.
- One navy band (#14142B): the work order, the nine steps from research to uploaded, each with how many videos wait there. The three steps that need the owner's yes say so in words.
- The brand's accent (`brand.json` -> `colors.accent`, default #E4572E) drives every accent; `palette()` keeps it readable (3:1 for lines, 4.5:1 for text on the paper and the tint, 4.5:1 on navy).
- Poppins (bundled, OFL, `studio/dashboard/fonts`): 800 capitals for the name, titles and big numbers; 600 spaced capitals for labels; 400 and 500 for text.
- Sharp corners, hairlines, square icon chips, corner brackets on the step boxes, numbered rows.
- Status is never colour alone: a word, an icon or a dashed outline goes with it.
- Not allowed: coloured side stripes, gradient text, glass blur, identical icon-card grids, modals (the card is a side panel).

## Motion

- Sections rise 14 px and fade in over 480 ms, 70 ms apart; numbers count up.
- Always moving: the dots on the work order's path travel and the step boxes breathe.
- With reduced motion asked for, everything shows its final state and stands still. Without scripting, nothing is hidden.

## Interaction

- `client.js`: find, "Needs you" and step filters (one state, kept in the tab's session storage), the video card, copy buttons.
- The card is a native `<dialog>` side panel: Escape, the close button or a click outside closes it; the arrow keys step through the list; the address gets `#video=<id>`.
- The card plays `out/video.mp4` from its folder (a relative path; the page holds no video), then shows the next step and its command, what needs attention, the steps with their dates, the sources, the chapters, the quality check and the approvals log.
- Nothing on the page changes a video. Steps come from the files the commands write; the card offers the command for the next one.

## Honesty

- A video's step comes from `model.mjs`: research done, map approved, script written, fact check, voice, render with QA and the YouTube text, final approval, upload. "Is this record current" is judged by file times there to stay fast; the commands check the real fingerprints before they act.
- Lengths are the render's, else the voice's, else the script's words at 150 a minute, marked "estimate".
- Voice characters come from `video dashboard --credits` (a free read of the owner's own ElevenLabs account) and show when they were read.

## Build rules

- One self-contained HTML file: fonts as data, no network requests, no libraries.
- Icons are drawn in `page.mjs` (24 px grid, 1.6 stroke).
- No literal U+2028 or U+2029 in the source (write `\u2028` in a regex); the files are plain ASCII outside comments.
- Check every change at 1280, 980 and 390 px wide, with and without reduced motion.
