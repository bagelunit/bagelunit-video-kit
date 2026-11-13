// reels.mjs · turns a long video into reels for the BagelUnit Reel Kit. The 19 scene styles are built for both shapes,
// so a stretch of the video's scenes (same templates, same props, same words) becomes a vertical reel in the same style.
//
//   video reels <video>                      the stretches that would make good reels (20 to 50 s), chapter by chapter
//   video reels <video> --pick 3-5,12-14     what would be made (a dry run); add --apply to make the reel folders
//
// Each reel is a Reel Kit reel folder in the brand's reels/ (made by the Reel Kit's own `kit start`), holding the picked
// scenes, their narration as script.txt, reel.json "from_video" (where it came from), and facts-from-video.md: the lines of
// the video's research.md its numbers rest on, to be cleared into brand/facts.md by the owner (the Reel Kit only lets
// cleared facts out). From there the reel goes through the Reel Kit's own steps: a new first line (its hook), its own
// voice at reel pace, gates A, B and C. Nothing is voiced, rendered or posted here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findBrand, numbersIn } from './checks.mjs';

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const REEL_MIN = 20, REEL_MAX = 50;

// each scene with its time: from the voice's scene clock when there is one, else from its words at 150 a minute
export function sceneClock(dir) {
  const plan = readJSON(path.join(dir, 'scenes.json'), {}).scenes || [];
  const times = readJSON(path.join(dir, 'build', 'scene_times.json'), null);
  let t = 0;
  return plan.map((s, i) => {
    const known = Array.isArray(times) && times[i] && times.length === plan.length;
    const dur = known ? times[i].t1 - times[i].t0 : Math.max(2, String(s.narration || '').split(/\s+/).filter(Boolean).length / 2.5);
    const row = { n: i + 1, scene: s, t0: known ? times[i].t0 : t, dur, estimate: !known };
    t = row.t0 + dur;
    return row;
  });
}

// stretches that could stand alone as a reel: each chapter, or the run of scenes from a chapter start, cut to 20 to 50 s
export function suggest(dir) {
  const clock = sceneClock(dir);
  const out = [];
  const starts = clock.filter((c) => c.scene.chapter || c.n === 1).map((c) => c.n);
  for (const s of starts) {
    let len = 0, end = s - 1;
    for (let i = s - 1; i < clock.length; i++) {
      if (i > s - 1 && clock[i].scene.chapter) break;
      if (len + clock[i].dur > REEL_MAX && len >= REEL_MIN) break;
      len += clock[i].dur; end = i;
    }
    if (len >= REEL_MIN * 0.75) out.push({ from: s, to: end + 1, seconds: len, chapter: clock[s - 1].scene.chapter || null, first: String(clock[s - 1].scene.narration || '').split(/(?<=[.!?])\s/)[0] });
  }
  return { clock, suggestions: out };
}

export function parsePick(text, count) {
  const ranges = [];
  for (const part of String(text).split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`"${part}" is not a scene or a range (like 3-5)`);
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    if (a < 1 || b > count || a > b) throw new Error(`${part}: the video has scenes 1 to ${count}`);
    ranges.push([a, b]);
  }
  if (!ranges.length) throw new Error('give the scenes: --pick 3-5 or --pick 3-5,12-14');
  return ranges;
}

// the research lines a reel's numbers rest on
function factLines(videoDir, scenes) {
  const research = (() => { try { return fs.readFileSync(path.join(videoDir, 'research.md'), 'utf8'); } catch { return ''; } })().split('\n');
  const strings = [];
  const walk = (x) => { if (typeof x === 'string') strings.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  for (const s of scenes) { strings.push(String(s.narration || '')); walk(s.props); }
  const said = strings.join(' . ');
  const values = numbersIn(said).filter((n) => n.value >= 11 || n.pct).map((n) => n.value);
  return research.filter((line) => numbersIn(line).some((n) => values.some((v) => Math.abs(v - n.value) <= 0.05 * Math.abs(n.value || 1))) && /https?:\/\//.test(line)).map((l) => l.trim());
}

export function planReels(video, ranges) {
  // the reels go to the Reel Kit brand folder the channel links to (brand.json "reels_folder"), or to the brand folder the
  // video sits in when that is a Reel Kit brand folder itself
  const home = findBrand(video.dir);
  const linked = home?.cfg.reels_folder ? path.resolve(String(home.cfg.reels_folder).replace(/^~(?=$|[\\/])/, os.homedir())) : null;
  const brand = linked ? findBrand(linked) : home && fs.existsSync(path.join(home.dir, 'reels')) ? home : null;
  if (!brand || (linked && brand.dir !== linked)) throw new Error(linked ? `reels_folder in brand/brand.json points at ${linked}, which is not a Reel Kit brand folder (no brand/brand.json there)` : 'reels are made in a BagelUnit Reel Kit brand folder: set "reels_folder" in this channel\'s brand/brand.json to yours (/channel-setup asks for it)');
  const clock = sceneClock(video.dir);
  const published = readJSON(path.join(video.dir, 'out', 'youtube-published.json'), null);
  // the next free number: video-reel-1, -2 ... are never reused, so a second run never lands on an earlier reel
  const base = `${video.name}-reel-`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  let next = 1 + Math.max(0, ...(fs.existsSync(path.join(brand.dir, 'reels')) ? fs.readdirSync(path.join(brand.dir, 'reels'), { withFileTypes: true }) : []).map((d) => (d.name.startsWith(base) ? Number(d.name.slice(base.length)) || 0 : 0)));
  return ranges.map(([a, b]) => {
    const picked = clock.slice(a - 1, b);
    const scenes = picked.map((c) => { const { chapter, ...rest } = c.scene; return rest; });
    const slug = `${base}${next++}`;
    return {
      slug, dir: path.join(brand.dir, 'reels', slug), brand, from: a, to: b,
      seconds: picked.reduce((n, c) => n + c.dur, 0), estimate: picked.some((c) => c.estimate),
      scenes, script: scenes.map((s) => s.narration).join('\n\n') + '\n',
      facts: factLines(video.dir, scenes),
      source: { from_video: (video.dir.startsWith(brand.dir + path.sep) ? path.relative(brand.dir, video.dir) : video.dir).split(path.sep).join('/'), scenes: [a, b], title: video.cfg.title || video.name, url: published?.url || null },
    };
  });
}

export function makeReels(video, plans, { kit }) {
  const made = [];
  for (const p of plans) {
    if (fs.existsSync(p.dir)) throw new Error(`reels/${p.slug} is already there: nothing was changed. Pick other scenes or remove that folder first.`);
    const r = spawnSync(process.execPath, [kit, 'start', p.dir, '--style', video.cfg.style, '--name', `${p.source.title} (reel ${made.length + 1})`], { encoding: 'utf8', cwd: p.brand.dir });
    if (r.status !== 0) throw new Error(`the Reel Kit could not start reels/${p.slug}: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
    fs.writeFileSync(path.join(p.dir, 'script.txt'), p.script);
    fs.writeFileSync(path.join(p.dir, 'scenes.json'), JSON.stringify({ _note: `Scenes ${p.from} to ${p.to} of the video ${p.source.from_video}. Give it its own first line (the hook) and its own ending (the call to action, and where the full video is), and keep "narration" equal to script.txt.`, scenes: p.scenes }, null, 2) + '\n');
    const cfg = readJSON(path.join(p.dir, 'reel.json'), {});
    cfg.from_video = p.source;
    fs.writeFileSync(path.join(p.dir, 'reel.json'), JSON.stringify(cfg, null, 2) + '\n');
    fs.writeFileSync(path.join(p.dir, 'facts-from-video.md'), `# Facts this reel takes from the video\n\nFrom ${p.source.from_video}/research.md. The Reel Kit only lets cleared facts out: the owner confirms each line into brand/facts.md (claim, source, the date it was cleared) before Gate A.\n\n${p.facts.length ? p.facts.map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n') : '- (no numbers in these scenes need a source)'}\n`);
    made.push(p);
  }
  return made;
}
