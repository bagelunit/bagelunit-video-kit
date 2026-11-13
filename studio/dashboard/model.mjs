// model.mjs · reads every video folder under a root and works out, for each, how far it has come and what it needs.
// It only reads: the page is drawn from this model by page.mjs. Nothing here changes a video's step; steps come from the
// files the commands write (research.md, approvals, the fact check, the voice, the render, QA, the YouTube record).
//
// To stay fast with many long videos, "is this record still current" is judged by file times here (a record newer than
// the files it covers); the commands themselves (voice, approve, upload) check the real fingerprints before acting.
import fs from 'node:fs';
import path from 'node:path';
import { findBrand, researchState } from '../tools/checks.mjs';

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const exists = (f) => fs.existsSync(f);
const sizeOf = (p) => { try { const s = fs.lstatSync(p); return s.isDirectory() ? fs.readdirSync(p).reduce((n, x) => n + sizeOf(path.join(p, x)), 0) : s.size; } catch { return 0; } };

// the steps every video goes through, in order; `who` is whose move it is when a video waits at that step
export const STEPS = [
  { key: 'research', name: 'Research', who: 'claude', what: 'Research the topic into research.md, every fact with its source' },
  { key: 'map', name: 'Map', who: 'you', what: 'Read the report and the map, then say go (or what to change)' },
  { key: 'script', name: 'Script', who: 'claude', what: 'Write script.txt and scenes.json from the approved map' },
  { key: 'facts', name: 'Fact check', who: 'claude', what: 'Check every number said or shown, re-read the sources, record the verdict' },
  { key: 'voice', name: 'Voice', who: 'claude', what: 'Voice the script (the credits are checked first)' },
  { key: 'render', name: 'Render', who: 'claude', what: 'Check the scenes, render, thumbnail and YouTube text' },
  { key: 'final', name: 'Final', who: 'you', what: 'Watch the video, the thumbnail and the YouTube text, then say yes' },
  { key: 'upload', name: 'Upload', who: 'you', what: 'Say when to upload it (private unless you say otherwise)' },
  { key: 'done', name: 'Uploaded', who: null, what: 'Uploaded' },
];
export const stepIndex = (k) => STEPS.findIndex((s) => s.key === k);

// where the video folders are: a brand folder's videos/, or every folder under the root that holds a video.json
export function findVideos(root) {
  const out = [];
  const walk = (d, depth) => {
    let names; try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (names.some((n) => n.isFile() && n.name === 'video.json')) { out.push(d); return; }
    if (depth <= 0) return;
    for (const n of names) if (n.isDirectory() && !n.name.startsWith('.') && !['node_modules', 'build', 'out', 'audio', 'reels', 'brand'].includes(n.name)) walk(path.join(d, n.name), depth - 1);
  };
  walk(root, 4);
  return out.sort();
}

function sources(text) {
  const out = [], seen = new Set();
  for (const m of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) if (!seen.has(m[2])) { seen.add(m[2]); out.push({ title: m[1], url: m[2] }); }
  for (const m of text.matchAll(/(?<!\()(https?:\/\/[^\s)>\]]+)/g)) if (!seen.has(m[1])) { seen.add(m[1]); out.push({ title: m[1].replace(/^https?:\/\//, '').slice(0, 60), url: m[1] }); }
  return out;
}

function approvalLog(text) {
  const out = [];
  let head = '';
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+)/); if (h) { head = h[1].trim(); continue; }
    const m = line.match(/^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d)\s+(.+)/); if (m) out.push({ at: m[1], kind: head, text: m[2] });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function readVideo(dir, pageDir) {
  const cfg = readJSON(path.join(dir, 'video.json'), {});
  const rel = (f) => path.relative(pageDir, f).split(path.sep).join('/');
  const J = (...p) => path.join(dir, ...p);
  const research = researchState(dir, cfg);
  const researchText = read(J('research.md'));
  const appr = readJSON(J('build', 'approvals.json'), {});
  const facts = readJSON(J('build', 'facts_check.json'), {});
  const qa = readJSON(J('build', 'qa.json'), null);
  const published = readJSON(J('out', 'youtube-published.json'), null);
  const words = readJSON(J('build', 'words.json'), []);
  const standIn = exists(J('build', 'voice-stand-in.json'));
  const script = read(J('script.txt')).trim();
  const scenes = readJSON(J('scenes.json'), {});
  const scriptWords = script ? script.split(/\s+/).length : 0;
  const sampleScenes = /A sample plan/.test(scenes._note || '');
  const mp4 = J('out', 'video.mp4');
  const times = readJSON(J('build', 'scene_times.json'), null);
  const length = exists(mp4) && Array.isArray(times) && times.length ? times[times.length - 1].t1 : null;
  const voiceLen = words.length && !standIn ? words[words.length - 1].e : null;

  // is a record newer than what it covers? (see the note at the top)
  const mapCurrent = Boolean(appr.map) && mtime(J('build', 'approvals.json')) >= Math.max(mtime(J('outline.md')), mtime(J('research.md'))) - 1;
  const factsTime = mtime(J('build', 'facts_check.json'));
  const scriptCurrent = facts.script?.result === 'PASS' && factsTime >= Math.max(mtime(J('script.txt')), mtime(J('scenes.json')), mtime(J('research.md'))) - 1;
  const finalFactsCurrent = facts.final?.result === 'PASS' && factsTime >= Math.max(mtime(J('script.txt')), mtime(J('scenes.json')), mtime(J('out', 'youtube.txt'))) - 1;
  const qaCurrent = qa && mtime(J('build', 'qa.json')) >= mtime(mp4) - 1;
  const finalCurrent = Boolean(appr.final) && mtime(J('build', 'approvals.json')) >= Math.max(mtime(mp4), mtime(J('out', 'thumbnail.jpg')), mtime(J('out', 'youtube.txt'))) - 1;
  const voiced = exists(J('audio', 'vo.mp3')) && !standIn && words.length > 0;
  const rendered = exists(mp4);
  const ytText = exists(J('out', 'youtube.txt'));

  let step;
  if (published) step = 'done';
  else if (!research.ok) step = 'research';
  else if (!mapCurrent) step = 'map';
  else if (!script || sampleScenes) step = 'script';
  else if (!scriptCurrent && !voiced) step = 'facts';
  else if (!voiced) step = 'voice';
  else if (!rendered || !qaCurrent || qa.result !== 'PASS' || !ytText || !finalFactsCurrent) step = 'render';
  else if (!finalCurrent) step = 'final';
  else step = 'upload';

  // what is wrong, in the person's words; "now" items need the person, "soon" items need attention
  const issues = [];
  const name = cfg.title || path.basename(dir);
  if (step === 'map' && research.ok && appr.map) issues.push({ prio: 'now', text: 'The map or the research changed after you approved it: look again and say go' });
  else if (step === 'map' && exists(J('outline.md')) && read(J('outline.md')).trim()) issues.push({ prio: 'now', text: 'The report and the map are ready for your go-ahead' });
  if (step === 'final') issues.push({ prio: 'now', text: appr.final ? 'The video changed after you approved it: watch it again and say yes' : 'Ready for you to watch and approve' });
  if (step === 'upload') issues.push({ prio: 'now', text: 'Approved: say when to upload it' });
  if (qa && qaCurrent && qa.result === 'FAIL') issues.push({ prio: 'soon', text: `The quality check failed: ${qa.checks.filter((c) => c.status === 'FAIL').map((c) => c.name).join(', ')}` });
  if (facts.script?.result === 'FAIL') issues.push({ prio: 'soon', text: 'The fact check was recorded as FAIL' });
  if (voiced && facts.script && !scriptCurrent) issues.push({ prio: 'soon', text: 'The script changed after its fact check: check it again before the next voice' });
  if (standIn && rendered) issues.push({ prio: 'soon', text: 'Rendered with the stand-in tone, not a voice' });
  const tidyBytes = ['build/scenes', 'build/video.mp4', 'build/draft.mp4'].reduce((n, x) => n + sizeOf(J(x)), 0);
  if (published && tidyBytes > 50 * 1048576) issues.push({ prio: 'later', text: `Uploaded: ${(tidyBytes / 1048576).toFixed(0)} MB of build files can go (video tidy)` });

  const chapters = read(J('out', 'chapters.txt')).split('\n').map((l) => l.match(/^(\d+:\d\d(?::\d\d)?)\s+(.+)/)).filter(Boolean).map((m) => ({ at: m[1], title: m[2] }));
  return {
    id: path.basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
    dir, rel: rel(dir), name, slug: path.basename(dir), style: cfg.style || '', step,
    publishOn: /^\d{4}-\d\d-\d\d$/.test(cfg.publish_on || '') ? cfg.publish_on : null,
    uploadedAt: published?.at ? published.at.slice(0, 10) : null,
    url: published?.url || null, privacy: published?.privacy || cfg.privacy || 'private',
    minutes: length ? length / 60 : voiceLen ? voiceLen / 60 : scriptWords ? scriptWords / 150 : null,
    lengthKind: length ? 'video' : voiceLen ? 'voice' : scriptWords ? 'estimate' : null,
    scriptWords, sceneCount: sampleScenes ? 0 : (scenes.scenes || []).length,
    sources: sources(researchText), noResearch: cfg.no_research || null, researchWhy: research.why,
    chapters, qa: qa ? { result: qa.result, current: Boolean(qaCurrent), checks: qa.checks } : null,
    facts: { script: facts.script ? { ...facts.script, current: scriptCurrent } : null, final: facts.final ? { ...facts.final, current: finalFactsCurrent } : null },
    approvals: { map: appr.map ? { at: appr.map.at, current: mapCurrent } : null, final: appr.final ? { at: appr.final.at, current: finalCurrent } : null },
    log: approvalLog(read(J('approvals.md'))),
    standIn, voiced, rendered,
    video: rendered ? rel(mp4) : null, thumb: exists(J('out', 'thumbnail.jpg')) ? rel(J('out', 'thumbnail.jpg')) : null,
    bytes: sizeOf(dir), tidyBytes, issues,
    changed: Math.max(mtime(J('video.json')), mtime(J('approvals.md')), mtime(mp4), mtime(J('script.txt')), mtime(J('research.md'))),
  };
}

export function credits(root) {
  return readJSON(path.join(root, '.cache', 'video-credits.json'), null);
}

export function load(root, { pageDir = root } = {}) {
  const brand = findBrand(root);
  const videos = findVideos(root).map((d) => readVideo(d, pageDir));
  let free = null;
  try { const s = fs.statfsSync(root); free = s.bavail * s.bsize; } catch {}
  const cr = credits(root);
  const needs = [];
  for (const v of videos) for (const i of v.issues) needs.push({ ...i, id: v.id, video: v.name, step: v.step });
  // the next voice: the characters still to voice for videos that wait at the voice step
  const toVoice = videos.filter((v) => ['facts', 'voice'].includes(v.step)).reduce((n, v) => n + Math.round(v.scriptWords * 6), 0);
  if (cr && Number.isFinite(cr.left) && toVoice > cr.left) needs.push({ prio: 'soon', text: `About ${toVoice.toLocaleString('en')} voice characters are waiting to be voiced; ${cr.left.toLocaleString('en')} are left on ElevenLabs`, id: null, video: 'Credits', step: 'voice' });
  if (free != null && free < 30 * 2 ** 30) needs.push({ prio: free < 10 * 2 ** 30 ? 'now' : 'soon', text: `${(free / 2 ** 30).toFixed(0)} GB free on this disk; a one-hour video needs about 4 GB while it is built`, id: null, video: 'Disk', step: null });
  const rank = { now: 0, soon: 1, later: 2 };
  needs.sort((a, b) => rank[a.prio] - rank[b.prio]);
  const uploaded = videos.filter((v) => v.step === 'done');
  return {
    root, brand: brand ? { name: brand.cfg.name || path.basename(brand.dir), accent: brand.cfg.colors?.accent || null } : null,
    name: brand ? brand.cfg.name || path.basename(brand.dir) : path.basename(root),
    accent: (brand?.cfg.colors?.accent && /^#[0-9a-f]{3,8}$/i.test(brand.cfg.colors.accent)) ? brand.cfg.colors.accent : '#E4572E',
    videos, needs, steps: STEPS.map((s) => ({ ...s, count: videos.filter((v) => v.step === s.key).length })),
    stats: {
      inProgress: videos.length - uploaded.length, uploaded: uploaded.length,
      minutes: uploaded.reduce((n, v) => n + (v.minutes || 0), 0),
      credits: cr, free, tidyBytes: videos.filter((v) => v.step === 'done').reduce((n, v) => n + v.tidyBytes, 0),
    },
    at: new Date(),
  };
}
