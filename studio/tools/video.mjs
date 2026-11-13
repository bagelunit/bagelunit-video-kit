#!/usr/bin/env node
// video.mjs · the BagelUnit Video Kit command line. Long and standard videos at 1920x1080, made scene by scene in one of
// the 19 synced scene styles (studio/styles). Voice, the headless browser and the fonts come from the installed Reel Kit
// engine (~/.claude/skills/bagelunit-reels), the same way the Carousel Kit borrows them.
//
//   node video.mjs styles [<style>]                        the styles and, for one, its templates
//   node video.mjs new <folder> --style <id> [--title t]   a video folder from the style's first three templates
//   node video.mjs plan <folder>                           each scene's time (from the voice's word times)
//   node video.mjs stand-in <folder> [--pace 0.38]         a no-key, no-credit tone as the voice, for previews and tests
//   node video.mjs voice <folder> [--voice id] [--speed 1] [--force]  voice script.txt in chunks (Reel Kit voice.py), one audio file
//   node video.mjs check <folder> [--only n]               every scene: errors, safe area, seeking, stills to look at
//   node video.mjs render <folder> [--scene n] [--force]   render changed scenes, join them, mix the voice: out/video.mp4
//   node video.mjs chapters <folder>                       out/chapters.txt (YouTube chapters) from the scenes' "chapter"
//   node video.mjs thumbnail <folder> [--at s | --scene n] out/thumbnail.jpg (1280x720) from a frame of the video
//   node video.mjs doctor                                  what is installed and what is missing
//   node video.mjs youtube <login|upload> ...              youtube.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as scenes from './scenes.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
export const REEL_ENGINE = process.env.BAGELUNIT_REEL_ENGINE || path.join(os.homedir(), '.claude', 'skills', 'bagelunit-reels');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const die = (m) => { console.error(m); process.exit(1); };

export function parse(argv) {
  const flags = {}, loose = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[k] = true; else { flags[k] = next; i++; }
    } else loose.push(a);
  }
  return { flags, loose };
}

export function openVideo(arg) {
  if (!arg) die('give the video folder (the one that holds video.json)');
  const dir = path.resolve(arg);
  const cfg = readJSON(path.join(dir, 'video.json'), null);
  if (!cfg) die(`${dir} is not a video folder (no video.json). Make one with: node video.mjs new <folder> --style <id>`);
  if (!scenes.isSceneStyle(cfg.style)) die(`video.json style "${cfg.style}" is not one of the styles in this kit: ${scenes.sceneStyleIds().join(', ')}`);
  return { dir, cfg, name: path.basename(dir) };
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const mediaLength = (f) => { const r = sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]); const v = parseFloat(r.stdout); return Number.isFinite(v) ? v : null; };

/* ── new ────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/* ── research ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
// research.md holds what the video may claim and where each fact comes from. `video new` writes the empty page below; the
// voice (the first step that costs credits) refuses until the page has its marker removed and at least two sources, or until
// video.json says why no research is needed ("no_research": "a bedtime story, nothing to check").
const RESEARCH_MARK = '<!-- not researched yet -->';
export const RESEARCH_PAGE = `# Research
${RESEARCH_MARK}

## The question
What the video has to answer, in one sentence.

## What was found
- One fact per line, said plainly, with its source: [publisher, title](https://...)

## Not sure or disputed
- Claims the sources disagree on, or that only one weak source makes. These stay out of the video or are said as uncertain.

## Sources
1. [Title](https://...) by who, when published, when read
`;
export function researchState(dir, cfg = {}) {
  if (cfg.no_research) return { ok: true, why: `no research needed: ${cfg.no_research}` };
  const f = path.join(dir, 'research.md');
  if (!fs.existsSync(f)) return { ok: false, why: 'research.md is missing' };
  const text = fs.readFileSync(f, 'utf8');
  if (text.includes(RESEARCH_MARK)) return { ok: false, why: 'research.md is still the empty page (remove the "not researched yet" line once it is done)' };
  const links = new Set(text.match(/https?:\/\/[^\s)>\]]+/g) || []);
  if (links.size < 2) return { ok: false, why: `research.md lists ${links.size} source link(s); at least 2 are needed` };
  return { ok: true, why: `research.md: ${links.size} sources` };
}

function newVideo(folder, flags) {
  const style = flags.style;
  if (!style || style === true) die(`say the style: --style <id>. The styles: ${scenes.sceneStyleIds().join(', ')}`);
  if (!scenes.isSceneStyle(style)) die(`no style "${style}" in this kit. It has: ${scenes.sceneStyleIds().join(', ')}`);
  const dir = path.resolve(folder);
  fs.mkdirSync(dir, { recursive: true });
  const files = scenes.starterFiles(style);
  const kept = [];
  for (const [name, body] of Object.entries(files)) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) { kept.push(name); continue; }
    fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
  }
  if (flags.title && flags.title !== true) {
    const f = path.join(dir, 'video.json'), c = readJSON(f, {}); c.title = String(flags.title); fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
  }
  const rf = path.join(dir, 'research.md');
  if (fs.existsSync(rf)) kept.push('research.md'); else fs.writeFileSync(rf, RESEARCH_PAGE);
  for (const d of ['audio', 'build', 'out']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  console.log(`new ${style} video: ${dir}${kept.length ? `  (kept: ${kept.join(', ')})` : ''}`);
  console.log('next: research (research.md), report and map the video for the person and wait for their go-ahead, then write outline.md and script.txt, plan scenes.json (templates: node video.mjs styles ' + style + '), then  voice  and  render  (SKILL.md)');
}

/* ── voice, in chunks ───────────────────────────────────────────────────────────────────────────────────────────────── */
// voice.py speaks one script in one request. A long video is many minutes, so the script is cut at paragraph ends into chunks
// of at most CHUNK characters, each voiced in its own folder (build/voice/NNN, so voice.py's own "same request: no credits"
// guard works per chunk and a re-run after a failure pays only for the chunks that are missing), then joined with a short breath.
const CHUNK = Number(process.env.VIDEO_CHUNK) || 2400, BREATH = 0.45;
export function chunkScript(text, max = CHUNK) {
  const paras = String(text).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  let cur = '';
  const push = () => { if (cur) out.push(cur); cur = ''; };
  for (const p of paras) {
    const pieces = p.length <= max ? [p] : p.match(new RegExp(`[^.!?]+[.!?]+["')]*\\s*|[^.!?]+$`, 'g')).reduce((acc, s) => {
      const last = acc.at(-1);
      if (last && (last + s).length <= max) acc[acc.length - 1] = last + s; else acc.push(s);
      return acc;
    }, []);
    for (const piece of pieces) { if (cur && (cur + '\n\n' + piece).length > max) push(); cur = cur ? cur + '\n\n' + piece : piece.trim(); }
  }
  push();
  return out;
}

function voice(video, flags) {
  const script = path.join(video.dir, 'script.txt');
  if (!fs.existsSync(script)) die('no script.txt to voice');
  const research = researchState(video.dir, video.cfg);
  if (!research.ok) die(`not voicing yet: ${research.why}. Research comes before the voice (SKILL.md steps 3 and 4); for a video with nothing to check, put "no_research": "<why>" in video.json.`);
  const py = path.join(REEL_ENGINE, 'tools', 'voice.py');
  if (!fs.existsSync(py)) die(`the Reel Kit engine is not installed (${py} is missing). Run bash setup/install.sh in the Reel Kit first.`);
  if (scenes.standInIsActive?.(video.dir)) fs.rmSync(path.join(video.dir, 'audio', 'vo.mp3'), { force: true });
  const chunks = chunkScript(fs.readFileSync(script, 'utf8'));
  // natural pace for long videos: the Reel Kit's voice tool speeds reels up (x1.15); a video keeps x1.0 unless video.json "voice_speed" says otherwise
  const speed = Number(flags.speed && flags.speed !== true ? flags.speed : video.cfg.voice_speed ?? 1) || 1;
  if (speed < 0.7 || speed > 1.3) die(`voice_speed ${speed} is out of range (0.7 to 1.3)`);
  const root = path.join(video.dir, 'build', 'voice');
  const parts = [];
  chunks.forEach((text, i) => {
    const d = path.join(root, String(i + 1).padStart(3, '0'));
    fs.mkdirSync(path.join(d, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(d, 'script.txt'), text + '\n');
    fs.writeFileSync(path.join(d, 'reel.json'), JSON.stringify({ voice: video.cfg.voice || undefined }, null, 1) + '\n');
    console.log(`voice: chunk ${i + 1}/${chunks.length} (${text.length} characters)`);
    const args = [py, d, '--speed', String(speed), ...(flags.voice && flags.voice !== true ? ['--voice', flags.voice] : []), ...(flags.force ? ['--force'] : [])];
    const r = spawnSync(process.env.PYTHON || 'python3', args, { stdio: 'inherit' });
    if (r.status !== 0) die(`voice.py stopped on chunk ${i + 1}. Chunks already made are kept and not paid for again; fix the cause and run voice again.`);
    parts.push(d);
  });
  // join: audio with a breath between chunks, word times shifted by each chunk's start
  const words = [], inputs = [], gaps = [];
  let t = 0;
  parts.forEach((d, i) => {
    const mp3 = path.join(d, 'audio', 'vo.mp3'), len = mediaLength(mp3);
    if (!len) die(`chunk ${i + 1} has no audio (${mp3})`);
    for (const w of readJSON(path.join(d, 'build', 'words.json'), [])) words.push({ w: w.w, s: +(w.s + t).toFixed(3), e: +(w.e + t).toFixed(3) });
    inputs.push(mp3); t += len + (i < parts.length - 1 ? BREATH : 0);
  });
  const list = path.join(root, 'join.txt');
  const sil = path.join(root, 'breath.wav');
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(BREATH), sil]);
  fs.writeFileSync(list, inputs.flatMap((f, i) => (i < inputs.length - 1 ? [f, sil] : [f])).map((f) => `file '${f.split(path.sep).join('/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  fs.mkdirSync(path.join(video.dir, 'audio'), { recursive: true });
  const vo = path.join(video.dir, 'audio', 'vo.mp3');
  const j = sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100', '-ac', '1', '-b:a', '192k', vo]);
  if (j.status !== 0) die(`joining the voice chunks failed: ${(j.stderr || '').slice(-300)}`);
  scenes.writeWords(video.dir, words);
  fs.rmSync(path.join(video.dir, 'build', 'voice-stand-in.json'), { force: true });
  console.log(`voice: audio/vo.mp3 ${mediaLength(vo)?.toFixed(1)} s, ${words.length} words → build/words.json`);
}

/* ── chapters ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
// YouTube needs the first chapter at 0:00, at least three, each 10 seconds or longer.
export const stamp = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
export function chapterLines(plan, times) {
  const marks = [];
  plan.forEach((s, k) => { if (s.chapter && times[k]) marks.push({ title: s.chapter, t: times[k].t0 }); });
  if (marks.length && marks[0].t > 0.01) marks[0].t = 0;                       // the first chapter starts at 0:00
  const notes = [];
  if (marks.length < 3) notes.push(`YouTube shows chapters only with at least 3 (this has ${marks.length}): add "chapter" to the first scene of each chapter in scenes.json`);
  marks.forEach((m, i) => { if (i && m.t - marks[i - 1].t < 10) notes.push(`chapter "${m.title}" starts only ${(m.t - marks[i - 1].t).toFixed(1)} s after the one before; YouTube needs 10 s or more`); });
  if (marks.length && plan[0] && !plan[0].chapter) notes.push('the first scene has no "chapter": its title was taken from the first marked scene and moved to 0:00');
  return { lines: marks.map((m) => `${stamp(m.t)} ${m.title}`), notes };
}
function chapters(video) {
  const prep = scenes.prepare(video);
  const { lines, notes } = chapterLines(prep.scenes, prep.times);
  fs.mkdirSync(path.join(video.dir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(video.dir, 'out', 'chapters.txt'), lines.join('\n') + (lines.length ? '\n' : ''));
  console.log(lines.join('\n') || '(no chapters)');
  for (const n of notes) console.log(`note: ${n}`);
}

/* ── thumbnail ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
async function thumbnail(video, flags) {
  const prep = scenes.prepare(video);
  let at;
  if (flags.at && flags.at !== true) at = Number(flags.at);
  else if (flags.scene && flags.scene !== true) { const t = prep.times[Number(flags.scene) - 1]; if (!t) die(`no scene ${flags.scene}`); at = t.t0 + (t.t1 - t.t0) * 0.7; }
  else at = (video.cfg.thumbnail && video.cfg.thumbnail.at) ?? Math.min(prep.length * 0.05 + 3, prep.length - 0.1);
  const view = await scenes.openScenes(video, { scale: 1 });
  let jpg;
  try { jpg = await view.frameAt(at, 0.95); } finally { await view.close(); }
  fs.mkdirSync(path.join(video.dir, 'out'), { recursive: true });
  const tmp = path.join(os.tmpdir(), `bagelunit-thumb-${process.pid}.jpg`), out = path.join(video.dir, 'out', 'thumbnail.jpg');
  fs.writeFileSync(tmp, jpg);
  const r = sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', out]);
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) die(`thumbnail failed: ${(r.stderr || '').slice(-300)}`);
  console.log(`out/thumbnail.jpg (1280x720, ${(fs.statSync(out).size / 1024).toFixed(0)} KB, the frame at ${at.toFixed(1)} s). A title over a still is the creator's call: look at it first.`);
  if (fs.statSync(out).size > 2 * 1024 * 1024) console.log('note: YouTube takes thumbnails up to 2 MB; this is larger');
}

/* ── doctor ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
function doctor() {
  const ok = (b, text, fix) => console.log(`${b ? 'ok     ' : 'MISSING'} ${text}${!b && fix ? `  -> ${fix}` : ''}`);
  const major = Number(process.versions.node.split('.')[0]);
  ok(major >= 22, `Node ${process.versions.node}`, 'Node 22 or newer');
  ok(sh('ffmpeg', ['-version']).status === 0, 'ffmpeg', 'brew install ffmpeg (or your system\'s package)');
  ok(sh('ffprobe', ['-version']).status === 0, 'ffprobe');
  ok(fs.existsSync(path.join(REEL_ENGINE, 'tools', 'voice.py')), `Reel Kit engine at ${REEL_ENGINE}`, 'run bash setup/install.sh in the Reel Kit');
  ok(fs.existsSync(path.join(REEL_ENGINE, 'node_modules', 'playwright')) || fs.existsSync(path.join(scenes.SKILL, 'node_modules', 'playwright')), 'Playwright', 'npm install inside the Reel Kit engine');
  ok(fs.existsSync(path.join(os.homedir(), '.config', 'bagelunit-reels', 'elevenlabs.key')), 'ElevenLabs key file (needed for a real voice; stand-in works without)', 'Reel Kit SETUP.md section 3');
  const reg = scenes.registry();
  ok(Boolean(reg && reg.format === 'wide'), `styles synced for wide: ${reg ? `${scenes.sceneStyleIds().length} (styles repo ${reg.version}, ${reg.synced})` : 'none'}`, 'node sync-to-kit.mjs --kit <this kit> --format wide --apply in bagelunit-styles');
  ok(fs.existsSync(path.join(os.homedir(), '.config', 'bagelunit-video')), 'YouTube folder ~/.config/bagelunit-video (only for upload)');
}

/* ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
async function main() {
  const { flags, loose } = parse(process.argv.slice(2));
  const [cmd, arg] = loose;
  const run = async (job) => { try { return await job(); } catch (e) { die(e.message); } };
  switch (cmd) {
    case 'styles': return run(() => scenes.listStyles(arg));
    case 'new': return run(() => newVideo(arg || die('give the folder: node video.mjs new <folder> --style <id>'), flags));
    case 'plan': return run(() => scenes.printPlan(openVideo(arg)));
    case 'stand-in': return run(() => scenes.standIn(openVideo(arg), { pace: Number(flags.pace) || 0.38, force: Boolean(flags.force) }));
    case 'voice': return run(() => voice(openVideo(arg), flags));
    case 'check': return run(() => scenes.checkScenes(openVideo(arg), { only: flags.only && flags.only !== true ? flags.only : null, times: typeof flags.times === 'string' ? flags.times.split(',') : null }));
    case 'render': return run(async () => {
      const v = openVideo(arg);
      await scenes.renderScenes(v, { only: flags.scene && flags.scene !== true ? flags.scene : null, force: Boolean(flags.force) });
      if (flags.scene) return;
      fs.mkdirSync(path.join(v.dir, 'out'), { recursive: true });
      fs.copyFileSync(path.join(v.dir, 'build', 'video.mp4'), path.join(v.dir, 'out', 'video.mp4'));
      console.log('out/video.mp4 written');
      chapters(v);
    });
    case 'chapters': return run(() => chapters(openVideo(arg)));
    case 'thumbnail': return run(() => thumbnail(openVideo(arg), flags));
    case 'doctor': return doctor();
    case 'youtube': { const m = await import('./youtube.mjs'); return m.cli(process.argv.slice(3)); }
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      if (cmd) process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
