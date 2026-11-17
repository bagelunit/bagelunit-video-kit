// retention.mjs · reads one video's audience retention curve (YouTube Studio's own export) and lays it on that video's scenes and
// chapters. Nothing is fetched and nothing is invented: every number comes from the curve, from the video folder's own files
// (build/scene_times.json, scenes.json, out/chapters.txt) or from the per-video table the person exported. A number that is not
// there is said to be missing, never filled in.
//
//   parseRows(head, rows)   a retention export (rows of cells, as review.mjs parses the CSV) -> { unit, points, ... } or { why }
//   resample(curve, ...)    the curve on an even clock (one point per second by default), by straight lines between its points
//   steepestDrops(...)      the biggest falls: where they start, how many points are lost
//   loadVideo(dir)          scene times, scene plan and chapters of a video folder
//   analyse(...)            first 30 seconds, average view duration against length, the drops, and the scene and chapter of each
//   lines(...)              the plain-words lines about one analysed video (used by the review)
//
// Formats read (Studio writes these, older exports and other tools use the names on the right):
//   position: "Video position (%)", "Video position (seconds)", "Elapsed video time", "Elapsed video time ratio", "Video position (time)"
//   share still watching: "Absolute audience retention (%)", "Audience retention", "Audience watch ratio" (a fraction, 1 = everyone)
// A "relative retention" column is the comparison with other videos of the same length, not a share of viewers: it is never used as one.
import fs from 'node:fs';
import path from 'node:path';

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = (v) => {
  if (v == null) return null;
  const t = String(v).replace(/[,%\s]/g, '');
  if (!t || t === '-' || t === '--') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};
// "0:03:12", "3:12" or seconds
const secs = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (t.includes(':')) { const p = t.split(':').map(Number); return p.some((x) => !Number.isFinite(x)) ? null : p.reduce((a, b) => a * 60 + b, 0); }
  return num(t);
};
export const mmss = (s) => (s == null || !Number.isFinite(s) ? 'n/a' : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`);
const f1 = (x) => `${Math.round(x * 10) / 10}`;

/* ── reading the export ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const posColumn = (h) => /position|elapsed|\btime\b/.test(h) && !/retention|watch ratio|performance/.test(h);
const keepColumn = (h) => /retention|watch ratio/.test(h) && !/relative|performance/.test(h);
export function looksLikeRetention(head) {
  const h = head.map(norm);
  return h.some(keepColumn) && h.some(posColumn);
}

// rows: every row of the file with the header first -> { unit: 's' | '%', points: [{at, keep}], positionColumn, keepColumn } or { why }
// `at` is seconds when the unit is 's' and a share of the video (0 to 100) when it is '%'; `keep` is a percentage of viewers.
export function parseRows(head, rows) {
  const h = head.map(norm), pi = h.findIndex(posColumn);
  const absolute = h.findIndex((x) => keepColumn(x) && /absolute|audience retention|watch ratio/.test(x)), ri = absolute >= 0 ? absolute : h.findIndex(keepColumn);
  if (pi < 0 || ri < 0) return { why: 'no position column and retention column found' };
  const colonValues = rows.some((r) => String(r[pi] ?? '').includes(':'));
  const raw = rows.map((r) => ({ at: colonValues ? secs(r[pi]) : num(r[pi]), keep: num(r[ri]) })).filter((p) => p.at != null && p.keep != null);
  if (raw.length < 3) return { why: 'a retention file with too few points to read' };
  const posRatio = /ratio/.test(h[pi]), keepRatio = /ratio/.test(h[ri]);
  const maxAt = Math.max(...raw.map((p) => p.at));
  let unit;
  if (colonValues || /second|\(s\)|\bsec\b/.test(h[pi])) unit = 's';
  else if (posRatio || /%|percent/.test(h[pi])) unit = '%';
  else unit = maxAt > 100 ? 's' : '%';             // a bare "time" column: past 100 it can only be seconds
  const byAt = new Map();                          // one value per position: the later row wins
  for (const p of raw) byAt.set(p.at, { at: unit === '%' && posRatio ? p.at * 100 : p.at, keep: keepRatio ? p.keep * 100 : p.keep });
  const points = [...byAt.values()].sort((a, b) => a.at - b.at);
  return { unit, points, positionColumn: head[pi], keepColumn: head[ri], keepIsRatio: keepRatio };
}

/* ── the curve on an even clock ─────────────────────────────────────────────────────────────────────────────────────────── */
// seconds of each point: a time axis is already in seconds; a percentage axis needs the video's length
export function toSeconds(curve, duration) {
  if (curve.unit === 's') return curve.points.map((p) => ({ t: p.at, keep: p.keep }));
  if (!(duration > 0)) return null;
  return curve.points.map((p) => ({ t: (p.at / 100) * duration, keep: p.keep }));
}
// one point per `step` seconds from the first point to the last, by straight lines between the points of the file; never beyond them
export function resample(pts, step = 1) {
  if (!pts || pts.length < 2) return [];
  const out = [], first = pts[0].t, last = pts.at(-1).t;
  let j = 0;
  for (let t = Math.ceil(first / step) * step; t <= last + 1e-9; t += step) {
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j], b = pts[j + 1], span = b.t - a.t;
    out.push({ t: Math.round(t * 1000) / 1000, keep: span <= 0 ? b.keep : a.keep + ((b.keep - a.keep) * (t - a.t)) / span });
  }
  return out;
}
// the biggest falls: for each start, keep at the start minus keep `window` seconds later; the largest first, no two overlapping
export function steepestDrops(series, { window = 5, count = 3, minDrop = 2, step = 1 } = {}) {
  const w = Math.max(1, Math.round(window / step)), cand = [];
  for (let i = 0; i + w < series.length; i++) cand.push({ i, d: series[i].keep - series[i + w].keep });
  cand.sort((a, b) => Math.round(b.d * 10) - Math.round(a.d * 10) || a.i - b.i);   // equal falls (to a tenth of a point): the earlier start, where the fall begins
  const out = [], taken = [];
  for (const c of cand) {
    if (out.length >= count || c.d < minDrop) break;
    if (taken.some((i) => Math.abs(i - c.i) < w)) continue;
    taken.push(c.i);
    out.push({ from: series[c.i].t, to: series[c.i + w].t, lost: c.d, startKeep: series[c.i].keep, endKeep: series[c.i + w].keep });
  }
  return out;
}
export const keepAt = (series, t) => {
  if (!series.length || t < series[0].t - 1e-9 || t > series.at(-1).t + 1e-9) return null;
  return series.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best)).keep;
};

/* ── this video's own files ─────────────────────────────────────────────────────────────────────────────────────────────── */
const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
// "0:00 Intro", "12:34 Title", "1:02:03 Title" -> [{t, title}]
export function parseChapters(text) {
  return String(text || '').split(/\r?\n/).map((l) => /^\s*((?:\d+:)?\d{1,2}:\d{2})\s+(.+?)\s*$/.exec(l)).filter(Boolean).map((m) => ({ t: secs(m[1]), title: m[2] }));
}
export function loadVideo(dir) {
  const times = readJSON(path.join(dir, 'build', 'scene_times.json'), null);
  const plan = readJSON(path.join(dir, 'scenes.json'), null);
  const list = Array.isArray(plan) ? plan : plan && Array.isArray(plan.scenes) ? plan.scenes : [];
  let chapters = [];
  try { chapters = parseChapters(fs.readFileSync(path.join(dir, 'out', 'chapters.txt'), 'utf8')); } catch { /* no chapters yet */ }
  const ok = Array.isArray(times) && times.length > 0 && times.every((t) => Number.isFinite(t.t0) && Number.isFinite(t.t1));
  return { times: ok ? times : [], scenes: list, chapters, duration: ok ? times.at(-1).t1 : null };
}

/* ── laying the curve on the video ──────────────────────────────────────────────────────────────────────────────────────── */
const short = (t, n = 140) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s; };
// curve: parseRows' result. video: { times, scenes, chapters, duration } from loadVideo (any part may be empty).
// table: { duration, avd } in seconds from the per-video table export, when there is one.
export function analyse(curve, video = {}, table = {}) {
  const notes = [];
  const times = video.times || [], chapters = video.chapters || [];
  const fromScenes = video.duration > 0 ? video.duration : null;
  const duration = fromScenes || (table.duration > 0 ? table.duration : null) || (curve.unit === 's' ? curve.points.at(-1).at : null);
  const durationFrom = fromScenes ? 'build/scene_times.json' : table.duration > 0 ? 'the table export' : curve.unit === 's' ? 'the last point of the retention file (the real length is not known)' : null;
  const res = { unit: curve.unit, duration, durationFrom, points: curve.points.length, notes, first30: null, last: curve.points.at(-1), avd: table.avd ?? null, avdShare: null, mean: null, drops: [], mapped: false };
  if (!duration) {
    notes.push('this file measures the video in percent and no length is known (no build/scene_times.json and no Duration in the table export), so seconds, scenes and chapters cannot be worked out');
    // still say where on the percentage axis the falls are
    const pts = curve.points.map((p) => ({ t: p.at, keep: p.keep }));
    const series = resample(pts, 1);
    res.drops = steepestDrops(series, { window: 3, step: 1 }).map((d) => ({ ...d, percent: true }));
    return res;
  }
  const pts = toSeconds(curve, duration), series = resample(pts, 1);
  if (series.length < 4) { notes.push('too few points to read the curve'); return res; }
  // the first 30 seconds
  if (duration < 30) res.first30 = { note: `the video is shorter than 30 seconds (${mmss(duration)})` };
  else { const k = keepAt(series, 30); res.first30 = k == null ? { note: 'the curve does not reach 0:30' } : { keep: k, at: 30 }; }
  res.mean = series.reduce((a, p) => a + p.keep, 0) / series.length;     // the mean of the curve: close to Studio's average percentage viewed, but computed here
  if (table.avd != null && duration) res.avdShare = (table.avd / duration) * 100;
  if (table.avd == null) notes.push('average view duration is not in the table export: not shown');
  const span = series.at(-1).t;
  if (span < duration - Math.max(5, duration * 0.05)) notes.push(`the curve ends at ${mmss(span)} but the video runs ${mmss(duration)}: later falls are not in the file`);
  // the drops, each laid on a scene and a chapter
  const window = Math.max(5, duration * 0.02);
  res.mapped = times.length > 0;
  if (!res.mapped) notes.push('no build/scene_times.json for this video: falls are shown in time only, not on a scene');
  for (const d of steepestDrops(series, { window, count: 3 })) {
    const drop = { ...d, window };
    drop.inFirst30 = d.from < 30;
    if (res.mapped) {
      let best = null, bestOver = 0;
      times.forEach((t, k) => { const over = Math.min(t.t1, d.to) - Math.max(t.t0, d.from); if (over > bestOver) { bestOver = over; best = k; } });
      if (best != null) {
        const t = times[best], sc = (video.scenes || [])[best] || {};
        drop.scene = { n: t.n ?? best + 1, id: sc.id || null, template: sc.template || (sc.clip ? 'clip' : null), t0: t.t0, t1: t.t1, length: t.t1 - t.t0, narration: short(sc.narration), chapterMark: sc.chapter || null };
      }
    }
    if (chapters.length) {
      const k = chapters.map((c) => c.t).reduce((b, t, i) => (t <= d.from + 0.5 ? i : b), -1);
      if (k >= 0) drop.chapter = { title: chapters[k].title, t: chapters[k].t };
      drop.atChapterStart = chapters.some((c) => c.t > 0 && c.t >= d.from - 2 && c.t <= d.to);
    }
    res.drops.push(drop);
  }
  return res;
}

/* ── plain words ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
// the observation lines for one analysed video (numbers only from the curve and the files)
export function lines(a, label) {
  const out = [];
  const at = (s) => (a.unit === '%' && !a.duration ? `${f1(s)}%` : mmss(s));
  const head = [];
  if (a.first30?.keep != null) head.push(`${f1(a.first30.keep)}% still watching at 0:30`);
  else if (a.first30?.note) head.push(`the first 30 seconds are not read (${a.first30.note})`);
  if (a.mean != null) head.push(`the curve's mean is ${f1(a.mean)}% of the video`);
  if (a.avd != null && a.duration) head.push(`average view duration ${mmss(a.avd)} of a ${mmss(a.duration)} video (${f1(a.avdShare)}%)`);
  else if (a.avd != null) head.push(`average view duration ${mmss(a.avd)} (the length is not known)`);
  head.push(`${f1(a.last.keep)}% at the end of the file`);
  out.push(`${label}: ${head.join('; ')}.`);
  a.drops.forEach((d, i) => {
    const where = d.percent ? `from ${f1(d.from)}% to ${f1(d.to)}% of the video` : `from ${mmss(d.from)} to ${mmss(d.to)}`;
    const bits = [];
    if (d.scene) bits.push(`scene ${d.scene.n}${d.scene.id ? ` ("${d.scene.id}")` : ''}${d.scene.template ? `, template ${d.scene.template}` : ''}, ${f1(d.scene.length)} s long${d.scene.narration ? `, narration: "${d.scene.narration}"` : ''}`);
    if (d.chapter) bits.push(`chapter "${d.chapter.title}" (from ${mmss(d.chapter.t)})`);
    out.push(`  Fall ${i + 1}: ${f1(d.lost)} points ${where} (${f1(d.startKeep)}% to ${f1(d.endKeep)}%)${bits.length ? `, in ${bits.join(', in ')}` : ''}.`);
  });
  if (!a.drops.length) out.push('  No fall of 2 points or more inside a window of a few seconds: the curve is gentle.');
  return out;
}
