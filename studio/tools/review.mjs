// review.mjs · a review of a channel from YouTube Studio's own CSV exports. Nothing is fetched and nothing is estimated:
// every number in the review comes from a file the person downloaded, and a column that is not in the file is said to be
// missing, never filled in. No YouTube sign-in is used (the kit's sign-in can upload, not read analytics).
//
//   node video.mjs review <channel folder> <export.csv | export folder> [...]
//
// Writes <channel>/reviews/YYYY-MM-DD.md: what the files say (observations, each number with the videos it comes from, matched
// to this channel's video folders by the YouTube id in out/youtube-published.json or by title), kept apart from what might
// explain it (hypotheses), with small samples flagged, and up to 5 tests for the next video.
import fs from 'node:fs';
import path from 'node:path';
import { findBrand } from './checks.mjs';

const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export const HOW_TO_EXPORT = `No YouTube Studio export was given, so there is nothing to review (the kit never guesses numbers).
Download one:
  1. YouTube Studio (studio.youtube.com), switched to this channel: Analytics, then "Advanced mode" (top right).
  2. Content tab, the "Video" view. Pick the dates (for a first review: "Lifetime" or "Since published").
  3. Metrics: add Impressions, Impressions click-through rate, Average view duration, Average percentage viewed,
     Views and Watch time (hours) (and Duration and Video publish time if they are not shown).
  4. Export current view (the down arrow), "Comma-separated values (.csv)". Unzip the download.
  5. Run:  node video.mjs review <channel folder> "<unzipped folder>/Table data.csv"
Optional: a video's audience retention export (Advanced mode, that video, Audience retention, Export) as another file.`;

/* ── CSV ────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// Studio's column names, and the names other exports and older versions use for the same thing
export const COLUMNS = {
  id: ['content', 'video id', 'video'],
  title: ['video title', 'title'],
  published: ['video publish time', 'publish time', 'published', 'video published', 'publish date', 'date published'],
  duration: ['duration', 'video length', 'length'],
  views: ['views'],
  impressions: ['impressions'],
  ctr: ['impressions click through rate', 'impressions ctr', 'click through rate', 'ctr'],
  avd: ['average view duration', 'avg view duration', 'average view duration seconds'],
  apv: ['average percentage viewed', 'avg percentage viewed', 'average view percentage', 'average percent viewed'],
  watchHours: ['watch time hours', 'watch time'],
  watchMinutes: ['watch time minutes'],
  subscribers: ['subscribers', 'subscribers gained'],
};
export const NAMES = { title: 'Video title', published: 'Video publish time', duration: 'Duration', views: 'Views', impressions: 'Impressions',
  ctr: 'Impressions click-through rate (%)', avd: 'Average view duration', apv: 'Average percentage viewed (%)', watchHours: 'Watch time (hours)' };
const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function num(v) {
  if (v == null) return null;
  const t = String(v).replace(/[,%\s]/g, '');
  if (!t || t === '-' || t === '--') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}
// "0:03:12", "3:12" or seconds
export function seconds(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (t.includes(':')) { const p = t.split(':').map(Number); return p.some((x) => !Number.isFinite(x)) ? null : p.reduce((a, b) => a * 60 + b, 0); }
  return num(t);
}

export function readExport(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return { file, kind: 'empty', videos: [] };
  const head = rows[0].map(norm);
  if (head.some((h) => h.includes('retention')) && head.some((h) => /position|time/.test(h))) return readRetention(file, head, rows.slice(1));
  const col = {};
  for (const [key, names] of Object.entries(COLUMNS)) { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[key] = i; }
  if (head.includes('date')) return { file, kind: 'chart', videos: [], why: 'a day-by-day chart or totals export; the review needs the table (Table data.csv)' };
  if (col.id == null && col.title == null) return { file, kind: 'unknown', videos: [], why: 'no "Content" (video id) or "Video title" column: not a per-video table' };
  const videos = [];
  for (const r of rows.slice(1)) {
    const get = (k) => (col[k] == null ? null : r[col[k]]);
    const id = String(get('id') ?? '').trim(), title = String(get('title') ?? '').trim();
    if (/^total$/i.test(id) || /^total$/i.test(title) || (!id && !title)) continue;
    const pub = get('published') ? new Date(get('published')) : null;
    videos.push({
      id: /^[\w-]{11}$/.test(id) ? id : null, title: title || id, published: pub && !Number.isNaN(pub.getTime()) ? pub : null,
      duration: seconds(get('duration')), views: num(get('views')), impressions: num(get('impressions')), ctr: num(get('ctr')),
      avd: seconds(get('avd')), apv: num(get('apv')),
      watchHours: col.watchHours != null ? num(get('watchHours')) : col.watchMinutes != null && num(get('watchMinutes')) != null ? num(get('watchMinutes')) / 60 : null,
      subscribers: num(get('subscribers')),
    });
  }
  const want = ['title', 'published', 'duration', 'views', 'impressions', 'ctr', 'avd', 'apv', 'watchHours'];
  const missing = want.filter((k) => col[k] == null && !(k === 'watchHours' && col.watchMinutes != null)).map((k) => NAMES[k]);
  return { file, kind: 'table', videos, missing };
}

// an audience retention export: position in the video (a percentage or a time) and the share still watching
function readRetention(file, head, rows) {
  const pi = head.findIndex((h) => /position|time/.test(h) && !h.includes('retention')), ri = head.findIndex((h) => h.includes('retention') && !h.includes('relative'));
  const pts = rows.map((r) => ({ raw: r[pi], at: String(r[pi]).includes(':') ? seconds(r[pi]) : num(r[pi]), keep: num(r[ri]) })).filter((p) => p.at != null && p.keep != null).sort((a, b) => a.at - b.at);
  if (pts.length < 3) return { file, kind: 'unknown', videos: [], why: 'a retention file with too few points to read' };
  const unit = String(rows[0]?.[pi] ?? '').includes(':') ? 's' : '%';
  let drop = { d: 0 };
  for (let i = 1; i < pts.length; i++) { const d = pts[i - 1].keep - pts[i].keep; if (d > drop.d) drop = { d, from: pts[i - 1], to: pts[i] }; }
  const early = pts.find((p) => (unit === 's' ? p.at >= 30 : p.at >= 10)) || null;
  return { file, kind: 'retention', videos: [], unit, early, drop, last: pts.at(-1), name: path.basename(file, path.extname(file)) };
}

/* ── this channel's video folders ───────────────────────────────────────────────────────────────────────────────────── */
const fold = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export function kitVideos(channelDir) {
  const root = path.join(channelDir, 'videos');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'video.json'))).map((d) => {
    const dir = path.join(root, d.name), cfg = readJSON(path.join(dir, 'video.json'), {}) || {};
    const pub = readJSON(path.join(dir, 'out', 'youtube-published.json'), null);
    const txt = fs.existsSync(path.join(dir, 'out', 'youtube.txt')) ? fs.readFileSync(path.join(dir, 'out', 'youtube.txt'), 'utf8').split('\n').find((l) => l.trim()) || '' : '';
    return { name: d.name, id: pub?.id || null, uploaded: pub?.at ? new Date(pub.at) : null, titles: [txt, cfg.title].map(fold).filter(Boolean) };
  });
}
export function matchVideos(videos, kit) {
  for (const v of videos) {
    const k = kit.find((x) => v.id && x.id === v.id) || kit.find((x) => x.titles.includes(fold(v.title)));
    v.folder = k ? k.name : null;
    if (!v.published && k?.uploaded) v.published = k.uploaded;
  }
  return videos;
}

/* ── the review ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const median = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const mmss = (s) => (s == null ? 'n/a' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const f1 = (x, unit = '') => (x == null ? 'n/a' : `${Math.round(x * 10) / 10}${unit}`);
const int = (x) => (x == null ? 'n/a' : Math.round(x).toLocaleString('en'));
const cell = (t) => String(t).replace(/\|/g, '/').replace(/\n/g, ' ');
const q = (v) => `"${v.title}"${v.folder ? ` (videos/${v.folder})` : ''}`;
export const SMALL = { videos: 5, days: 7 };

export function buildReview({ channel, files, exports, today = new Date() }) {
  const tables = exports.filter((x) => x.kind === 'table'), retention = exports.filter((x) => x.kind === 'retention'), skipped = exports.filter((x) => !['table', 'retention'].includes(x.kind));
  // one row per video: a later file replaces an earlier one for the same video
  const byKey = new Map();
  for (const t of tables) for (const v of t.videos) byKey.set(v.id || fold(v.title), v);
  const videos = [...byKey.values()];
  for (const v of videos) v.age = v.published ? Math.floor((today - v.published) / 86400e3) : null;
  const missing = [...new Set(tables.flatMap((t) => t.missing))];
  const med = Object.fromEntries(['views', 'impressions', 'ctr', 'avd', 'apv', 'duration', 'watchHours'].map((k) => [k, median(videos.map((v) => v[k]))]));
  const has = (k) => videos.filter((v) => v[k] != null);
  const young = videos.filter((v) => v.age != null && v.age < SMALL.days);
  const small = videos.length < SMALL.videos;

  const obs = [], hyp = [], tests = [], flags = [];
  if (small) flags.push(`Small sample: ${videos.length} video${videos.length === 1 ? '' : 's'}. With fewer than ${SMALL.videos}, read every comparison below as a lead to test, not a finding.`);
  if (young.length) flags.push(`Young videos (under ${SMALL.days} days, their numbers are still moving): ${young.map((v) => `${q(v)}, ${v.age} day${v.age === 1 ? '' : 's'}`).join('; ')}.`);
  if (videos.some((v) => v.age == null)) flags.push('Some videos have no publish time in the file and no upload record here, so their age is unknown.');
  if (missing.length) flags.push(`Missing from the export: ${missing.join(', ')}. Anything that needs them is left out (add them in Advanced mode and export again).`);
  for (const x of skipped) flags.push(`Not used: ${path.basename(x.file)} (${x.why || 'empty'}).`);

  // observations: only what the files say
  obs.push(`${videos.length} video${videos.length === 1 ? '' : 's'} in ${tables.length} table export${tables.length === 1 ? '' : 's'}; ${videos.filter((v) => v.folder).length} matched to a video folder of this channel.`);
  const medLine = [['views', 'views', int], ['impressions', 'impressions', int], ['ctr', 'impressions CTR', (x) => f1(x, '%')], ['avd', 'average view duration', mmss], ['apv', 'average percentage viewed', (x) => f1(x, '%')], ['duration', 'length', mmss]]
    .filter(([k]) => med[k] != null).map(([k, label, fmt]) => `${label} ${fmt(med[k])} (${has(k).length} videos)`);
  if (medLine.length) obs.push(`Channel medians: ${medLine.join('; ')}.`);
  const totalViews = has('views').reduce((n, v) => n + v.views, 0);
  const top = [...has('views')].sort((a, b) => b.views - a.views)[0];
  if (top && totalViews) obs.push(`Most viewed: ${q(top)} with ${int(top.views)} views, ${Math.round((top.views / totalViews) * 100)}% of all ${int(totalViews)} views in the file.`);
  const stand = (k, label, fmt) => {
    if (has(k).length < 3 || !med[k]) return { hi: [], lo: [] };
    const hi = has(k).filter((v) => v[k] >= med[k] * 1.25).sort((a, b) => b[k] - a[k]), lo = has(k).filter((v) => v[k] <= med[k] * 0.75).sort((a, b) => a[k] - b[k]);
    if (hi.length) obs.push(`${label} well above the median (${fmt(med[k])}): ${hi.map((v) => `${q(v)} ${fmt(v[k])}`).join('; ')}.`);
    if (lo.length) obs.push(`${label} well below the median: ${lo.map((v) => `${q(v)} ${fmt(v[k])}`).join('; ')}.`);
    return { hi, lo };
  };
  const ctr = stand('ctr', 'Impressions CTR', (x) => f1(x, '%'));
  const apv = stand('apv', 'Average percentage viewed', (x) => f1(x, '%'));
  for (const r of retention) {
    const at = (p) => (r.unit === 's' ? mmss(p.at) : `${f1(p.at)}%`);
    obs.push(`Retention file "${r.name}": ${r.early ? `${f1(r.early.keep, '%')} still watching at ${at(r.early)}; ` : ''}the largest fall is ${f1(r.drop.d)} points, from ${at(r.drop.from)} to ${at(r.drop.to)}; ${f1(r.last.keep, '%')} at the end.`);
  }

  // hypotheses: what might explain it, each tied to the observation it comes from
  const sure = small ? 'weak: a small sample' : 'worth testing, not proven';
  const thin = (v) => v.impressions != null && v.impressions < 1000;
  const bestCtr = ctr.hi[0];
  if (bestCtr) hyp.push(`The title and thumbnail of ${q(bestCtr)} may be what makes people click (CTR ${f1(bestCtr.ctr, '%')} against a median of ${f1(med.ctr, '%')})${thin(bestCtr) ? `, though ${int(bestCtr.impressions)} impressions is thin` : ''}. (${sure})`);
  if (ctr.lo[0]) hyp.push(`The packaging of ${q(ctr.lo[0])} may not say what the video gives (CTR ${f1(ctr.lo[0].ctr, '%')}). (${sure})`);
  const both = videos.filter((v) => v.apv != null && v.duration != null);
  let lengthTest = null;
  if (both.length >= 4) {
    const cut = median(both.map((v) => v.duration));
    const short = both.filter((v) => v.duration <= cut), long = both.filter((v) => v.duration > cut);
    const a = median(short.map((v) => v.apv)), b = median(long.map((v) => v.apv));
    if (long.length && short.length && Math.abs(a - b) >= 5) {
      const better = a > b ? short : long;
      hyp.push(`${a > b ? 'Shorter' : 'Longer'} videos keep a larger share of their viewers here: ${short.length} up to ${mmss(cut)} keep a median ${f1(a, '%')}, ${long.length} over it keep ${f1(b, '%')}. Length, topic and age are mixed in these groups. (${sure})`);
      lengthTest = { minutes: Math.round(median(better.map((v) => v.duration)) / 60), a, b };
    }
  }
  if (apv.lo[0]) hyp.push(`${q(apv.lo[0])} lost viewers early or often (${f1(apv.lo[0].apv, '%')} viewed on average against ${f1(med.apv, '%')}): its opening or its middle may not hold. Its retention export would show where. (${sure})`);
  const earlyFall = retention.find((r) => r.drop.from && (r.unit === 's' ? r.drop.from.at < 30 : r.drop.from.at < 10));
  if (earlyFall) hyp.push(`In "${earlyFall.name}" the largest fall comes in the opening: the first 30 seconds may promise less than the title, or take too long to get going. (one video)`);
  if (top && totalViews && top.views / totalViews > 0.5 && videos.length >= 3) hyp.push(`One video carries the channel (${Math.round((top.views / totalViews) * 100)}% of views): its topic may be what this audience came for. (${sure})`);

  // tests for the next video: one change each, the number to read, and when
  if (bestCtr) tests.push(`**Title.** Write the next title in the pattern of "${bestCtr.title}" (its CTR ${f1(bestCtr.ctr, '%')}, the median ${f1(med.ctr, '%')}), on a new topic, and keep the thumbnail style as usual. Read: impressions CTR after ${SMALL.days} days, against ${f1(med.ctr, '%')}.`);
  if (med.ctr != null) tests.push(`**Thumbnail.** Make two thumbnails that differ in one thing only (the words, or the frame): \`video thumbnail <video> --name a\` and \`--name b\`, then YouTube Studio's Test & Compare on that video. Read: which one Studio picks, and the CTR, after ${SMALL.days} days or more.`);
  if (apv.lo[0] || earlyFall || (med.apv != null && !tests.length)) tests.push(`**Hook.** Keep the topic and length, and rewrite only the first 30 seconds: say the payoff's question in the first sentence and cut anything before it (\`playbook/hook-and-packaging.md\` section 2). Read: average percentage viewed against ${f1(med.apv, '%')}, and the retention at 0:30 in that video's retention export.`);
  if (lengthTest) tests.push(`**Length.** Plan the next video at about ${lengthTest.minutes} minutes (the median length of the group that kept more of its viewers). Read: average percentage viewed and average view duration (median ${mmss(med.avd)}).`);
  if (top && videos.length >= 2) tests.push(`**Topic.** Make a follow-up to ${q(top)}, the most viewed (${int(top.views)} views): the question its viewers would ask next. Read: views and impressions after ${SMALL.days} days against the median ${int(med.views)} views.`);
  if (!tests.length) tests.push('No test can be drawn from these columns. Export the table with impressions CTR and average percentage viewed, then review again.');

  const date = today.toISOString().slice(0, 10);
  const headline = videos.length
    ? `${videos.length} video${videos.length === 1 ? '' : 's'}${med.ctr != null ? `, median CTR ${f1(med.ctr, '%')}` : ''}${med.apv != null ? `, median ${f1(med.apv, '%')} viewed` : ''}${top ? `; most viewed: "${top.title}" (${int(top.views)})` : ''}${small ? ' (small sample)' : ''}`
    : 'no video rows in the files given';
  const table = videos.length ? [
    '| Video | Folder | Age (days) | Views | Impressions | CTR | Avg view duration | Avg % viewed | Watch hours |',
    '|---|---|---|---|---|---|---|---|---|',
    ...[...videos].sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).map((v) => `| ${cell(v.title)} | ${v.folder ? `videos/${cell(v.folder)}` : '(not found)'} | ${v.age ?? 'n/a'} | ${int(v.views)} | ${int(v.impressions)} | ${f1(v.ctr, '%')} | ${mmss(v.avd)} | ${f1(v.apv, '%')} | ${f1(v.watchHours)} |`),
  ].join('\n') : '';
  const md = `# Channel review: ${channel}, ${date}

**Headline:** ${headline}

Read from: ${files.map((f) => `\`${path.basename(f)}\``).join(', ')}. Every number below comes from these files; none is estimated.

## Before reading
${flags.length ? flags.map((x) => `- ${x}`).join('\n') : '- Nothing to flag.'}

## Observations (what the numbers say)
${obs.map((x) => `- ${x}`).join('\n')}

${table}

## Hypotheses (what might explain it; not proven)
${hyp.length ? hyp.map((x) => `- ${x}`).join('\n') : '- None this time: the differences between videos are small, or the columns needed are missing.'}

## Tests for the next video (one change each)
${tests.slice(0, 5).map((x, i) => `${i + 1}. ${x}`).join('\n')}
`;
  return { md, headline, date, videos, missing, flags, hypotheses: hyp, tests: tests.slice(0, 5) };
}

export function review(dir, inputs, { today = new Date(), log = console.log } = {}) {
  const brand = findBrand(dir);
  if (!brand) throw new Error(`${dir} is not in a channel folder (no brand/brand.json): give the channel's folder`);
  const files = inputs.flatMap((p) => (fs.existsSync(p) && fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => /\.csv$/i.test(f)).map((f) => path.join(p, f)) : [p]));
  if (!files.length) { const e = new Error(HOW_TO_EXPORT); e.howTo = true; throw e; }
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`${f} does not exist`);
  for (const f of files) if (/\.zip$/i.test(f)) throw new Error(`${f} is the zip Studio downloads: unzip it first and give the CSV (Table data.csv) or the unzipped folder`);
  const exports = files.map(readExport);
  if (!exports.some((x) => x.kind === 'table' || x.kind === 'retention')) { const e = new Error(`none of these files is a per-video table export:\n  ${exports.map((x) => `${path.basename(x.file)}: ${x.why || x.kind}`).join('\n  ')}\n\n${HOW_TO_EXPORT}`); e.howTo = true; throw e; }
  for (const x of exports) if (x.kind === 'table') matchVideos(x.videos, kitVideos(brand.dir));
  const r = buildReview({ channel: brand.cfg.name || path.basename(brand.dir), files, exports, today });
  const outDir = path.join(brand.dir, 'reviews');
  fs.mkdirSync(outDir, { recursive: true });
  let file = path.join(outDir, `${r.date}.md`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(outDir, `${r.date}-${i}.md`);
  fs.writeFileSync(file, r.md);
  log(`review: ${path.relative(brand.dir, file)}\n${r.headline}`);
  for (const x of r.flags) log(`note: ${x}`);
  return { ...r, file };
}

// the newest review of a channel, for the dashboard: {file, date, headline}
export function latestReview(channelDir) {
  const d = path.join(channelDir, 'reviews');
  if (!fs.existsSync(d)) return null;
  const f = fs.readdirSync(d).filter((x) => /^\d{4}-\d{2}-\d{2}(-\d+)?\.md$/.test(x)).sort((a, b) => {
    const k = (x) => { const m = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?/.exec(x); return [m[1], Number(m[2] || 1)]; };
    const [da, na] = k(a), [db, nb] = k(b); return da === db ? na - nb : da < db ? -1 : 1;
  }).at(-1);
  if (!f) return null;
  const text = fs.readFileSync(path.join(d, f), 'utf8');
  return { file: path.join(d, f), date: f.slice(0, 10), headline: (/^\*\*Headline:\*\*\s*(.+)$/m.exec(text) || [])[1] || '' };
}
