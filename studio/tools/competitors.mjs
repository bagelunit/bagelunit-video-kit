// competitors.mjs · a YouTube competitor tracker for a channel folder. The Video Kit works without it; Apify is only one way to
// fill it (an export file from anywhere works too), and Apify is only SUGGESTED (`video suggest apify`).
//
//   video competitors add <@handle | channel link> [--tag niche|adjacent|big]
//   video competitors remove <handle>
//   video competitors list [--json]
//   video competitors sync [<handle>] [--max N] [--shorts] [--dry-run] [--yes] [--max-cost USD] [--save-raw]
//   video competitors import <handle> <file.csv | file.json>        a scraper export or a CSV from anywhere; works offline
//   video competitors report [--json]                               summary + brand/research/youtube/outliers.md and outliers.json
//   video competitors outliers                                      only the outliers, nothing written
//
// State: brand/competitors.json (the channels), brand/research/youtube/<handle>.csv (their videos), channels.json, history.csv
// (one line a day per channel), outliers.md / outliers.json (the report), raw/ (only with --save-raw; kept out of git).
//
// MONEY AND SAFETY (owner rules): `sync` is a dry run unless every one of these holds: the token file ~/.config/bagelunit-reels/
// apify.key exists and is not empty, brand.json autopilot.scrape is true, --yes was given, and the estimate is under --max-cost
// (default 1.00). The estimate is videos x brand.json research.youtube.cost_per_video (default 0.004): an ESTIMATE, the owner's
// plan decides the real price. The token is read in exactly one place (authFor), goes only in the Authorization header, and is
// hidden from every message. Nothing here runs from a schedule. Tests use a stubbed fetch: no network.
//
// Numbers are only ever what a file or the scraper returned. Dates from the scraper are RELATIVE text ("10 months ago"): the kit
// keeps the raw text and works out an APPROXIMATE date, and says "approximate" wherever it uses one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCsv } from './review.mjs';
import { findBrand } from './checks.mjs';

export const MAX_CHANNELS = 30;
export const TAGS = ['niche', 'adjacent', 'big'];
export const OUTLIER_X = 3;
export const MIN_SAMPLE = 10;
export const DEFAULT_ACTOR = 'streamers~youtube-scraper';
export const DEFAULT_COST_PER_VIDEO = 0.004;
export const DEFAULT_MAX = 20;
export const KEY_TEXT = '~/.config/bagelunit-reels/apify.key';
export const ROW_COLUMNS = ['id', 'title', 'url', 'views', 'published_text', 'published_approx', 'duration_s', 'is_short', 'kind', 'pulled_at'];
export const HISTORY_HEADER = 'date,handle,subscribers,videos,total_views,source';
export const SPEND_HEADER = 'date,service,channels,videos,estimated_usd,actor';
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
const DAY = 86400000;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const iso = (d) => d.toISOString().slice(0, 10);
const money = (n) => `$${n.toFixed(n > 0 && n < 0.1 ? 3 : 2)}`;

/* ── files: always written to a temp file next to the target, then renamed; then read back to be sure it is not empty ───── */
export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  if (fs.statSync(file).size === 0) throw new Error(`${file} was written empty`);
}

/* ── channels: handles and links ──────────────────────────────────────────────────────────────────────────────────────── */
const HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
// accepts @handle, a bare handle, youtube.com/@x (with or without /videos and so on), /channel/UC..., /c/x
export function parseChannel(input) {
  let s = String(input ?? '').trim();
  if (!s) throw new Error('give a channel: an @handle or a link such as https://www.youtube.com/@name');
  if (/^https?:\/\//i.test(s) || /^(www\.|m\.)?youtube\.com\//i.test(s)) {
    let u;
    try { u = new URL(/^https?:/i.test(s) ? s : `https://${s}`); } catch { throw new Error(`"${s}" is not a link I can read. Use https://www.youtube.com/@name`); }
    const host = u.hostname.toLowerCase();
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) throw new Error(`"${s}" is not a youtube.com link. Use https://www.youtube.com/@name`);
    const parts = u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    const first = parts[0] || '';
    if (first.startsWith('@')) return fromHandle(first.slice(1));
    if (first === 'channel' && CHANNEL_ID.test(parts[1] || '')) return { handle: parts[1], url: `https://www.youtube.com/channel/${parts[1]}/videos`, kind: 'channel' };
    if (first === 'c' && HANDLE.test(parts[1] || '')) return { handle: parts[1], url: `https://www.youtube.com/c/${parts[1]}/videos`, kind: 'custom' };
    throw new Error(`"${s}" is not a channel link. Use https://www.youtube.com/@name, /channel/UC... or /c/name (a video link is not a channel)`);
  }
  if (s.startsWith('@')) return fromHandle(s.slice(1));
  if (CHANNEL_ID.test(s)) return { handle: s, url: `https://www.youtube.com/channel/${s}/videos`, kind: 'channel' };
  return fromHandle(s);
}
function fromHandle(h) {
  if (!HANDLE.test(h)) throw new Error(`"@${h}" is not a handle I can use (3 to 30 letters, numbers, dots, dashes or underscores). Paste the channel's /channel/UC... link instead.`);
  return { handle: h, url: `https://www.youtube.com/@${h}/videos`, kind: 'handle' };
}
export const keyOf = (h) => String(h).replace(/^@/, '').toLowerCase();

/* ── state: brand/competitors.json ────────────────────────────────────────────────────────────────────────────────────── */
export const paths = (dir) => {
  const r = path.join(dir, 'brand', 'research', 'youtube');
  return { state: path.join(dir, 'brand', 'competitors.json'), research: r, channels: path.join(r, 'channels.json'), history: path.join(r, 'history.csv'), md: path.join(r, 'outliers.md'), json: path.join(r, 'outliers.json'), raw: path.join(r, 'raw'), spend: path.join(dir, 'brand', 'spend.csv'), rows: (h) => path.join(r, `${keyOf(h)}.csv`) };
};
export function loadState(dir) {
  const s = readJSON(paths(dir).state, null);
  const channels = Array.isArray(s?.channels) ? s.channels.filter((c) => c && typeof c.handle === 'string') : [];
  return { channels, settings: s && typeof s.settings === 'object' && s.settings ? s.settings : {} };
}
export const saveState = (dir, state) => atomicWrite(paths(dir).state, JSON.stringify({ channels: state.channels, settings: state.settings || {} }, null, 2) + '\n');
export function addChannel(state, input, { tag = 'niche', now = new Date() } = {}) {
  if (!TAGS.includes(tag)) throw new Error(`--tag must be one of ${TAGS.join(', ')}`);
  const c = parseChannel(input);
  if (state.channels.some((x) => keyOf(x.handle) === keyOf(c.handle))) throw new Error(`@${c.handle} is already tracked`);
  if (state.channels.length >= MAX_CHANNELS) throw new Error(`already tracking ${MAX_CHANNELS} channels, which is the most. Remove one first.`);
  const entry = { handle: c.handle, url: c.url, name: '', tag, added: iso(now), subscribers: null, videos_read: 0, pulled_at: null, source: '' };
  return { state: { ...state, channels: [...state.channels, entry] }, entry };
}
export function removeChannel(state, handle) {
  const k = keyOf(handle);
  const entry = state.channels.find((x) => keyOf(x.handle) === k);
  if (!entry) throw new Error(`@${k} is not tracked. \`video competitors list\` shows the channels.`);
  return { state: { ...state, channels: state.channels.filter((x) => x !== entry) }, entry };
}

/* ── parsers ──────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const UNIT_DAYS = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.4375, year: 365.25 };
// "10 months ago", "3 days ago", "1 year ago", "Streamed 2 weeks ago", "Premiered 5 days ago", an ISO date or "Nov 3, 2025".
// Returns { iso, approx, kind, raw } or null. Relative text is always approximate (a month is 30.4 days, a year 365.25).
export function parseDate(text, now = new Date()) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const m0 = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(raw);
  if (m0) { const d = new Date(`${m0[1]}-${m0[2]}-${m0[3]}T00:00:00Z`); return Number.isNaN(d.getTime()) ? null : { iso: iso(d), approx: false, kind: 'published', raw }; }
  let s = raw.toLowerCase().replace(/\s+/g, ' ');
  let kind = 'published';
  const pre = /^(?:last )?(streamed|premiered)(?: live)?\s+/.exec(s);
  if (pre) { kind = pre[1] === 'streamed' ? 'stream' : 'premiere'; s = s.slice(pre[0].length); }
  if (/^(today|just now)$/.test(s)) return { iso: iso(now), approx: true, kind, raw };
  if (s === 'yesterday') return { iso: iso(new Date(now.getTime() - DAY)), approx: true, kind, raw };
  const m = /^(?:about |over |almost )?(an?|\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/.exec(s);
  if (m) {
    const n = /^an?$/.test(m[1]) ? 1 : Number(m[1]);
    return { iso: iso(new Date(now.getTime() - n * UNIT_DAYS[m[2]] * DAY)), approx: true, kind, raw };
  }
  const d = new Date(/^\d{4}\/\d{2}\/\d{2}$/.test(raw) ? raw.replace(/\//g, '-') : raw);
  if (!Number.isNaN(d.getTime()) && /[a-z]{3}|\//i.test(raw) && d.getFullYear() >= 2005 && d.getTime() <= now.getTime() + DAY) {
    return { iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, approx: false, kind: 'published', raw };
  }
  return null;
}
// "29:54", "1:02:03", "00:03:17", "PT1H2M3S", 95, "95" -> seconds (null when it is not a length)
export function parseDuration(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const p = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(s);
  if (p && (p[1] || p[2] || p[3])) return Number(p[1] || 0) * 3600 + Number(p[2] || 0) * 60 + Number(p[3] || 0);
  const c = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!c) return null;
  return c[3] === undefined ? Number(c[1]) * 60 + Number(c[2]) : Number(c[1]) * 3600 + Number(c[2]) * 60 + Number(c[3]);
}
// 410458, "1,710,167,563", "13.1M", "12K views", "No views" -> number (null when unknown)
export function parseCount(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  const s = String(v ?? '').trim().toLowerCase().replace(/,/g, '');
  if (!s) return null;
  if (/^no views?/.test(s)) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*([kmb])?\b/.exec(s);
  if (!m) return null;
  return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1));
}

/* ── video rows ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
const COLS = {
  id: ['id', 'video id', 'videoid', 'content', 'video'],
  title: ['title', 'video title', 'name'],
  url: ['url', 'video url', 'link', 'videourl'],
  viewCount: ['views', 'viewcount', 'view count', 'views count', 'view'],
  date: ['date', 'published', 'published text', 'publish time', 'video publish time', 'video published', 'publish date', 'upload date', 'published at', 'publishedat', 'uploaded', 'date published'],
  _approx: ['published approx'],
  duration: ['duration', 'duration s', 'length', 'video length', 'duration seconds'],
  isShort: ['is short', 'isshort', 'short'],
  type: ['kind', 'type'],
  numberOfSubscribers: ['numberofsubscribers', 'number of subscribers', 'subscribers'],
  channelName: ['channelname', 'channel name', 'channel'],
  channelTotalVideos: ['channeltotalvideos', 'channel total videos'],
  channelTotalViews: ['channeltotalviews', 'channel total views'],
};
const norm = (h) => String(h).replace(/^﻿/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const idFromUrl = (u) => (/(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(String(u || '')) || [])[1] || '';
const truthy = (v) => v === true || /^(true|yes|1|short)$/i.test(String(v ?? '').trim());

// an Apify item, or a CSV row mapped to the same names, -> a row (or null when it is not a video)
export function rowFromItem(it, now = new Date(), pulledAt = now.toISOString()) {
  if (!it || typeof it !== 'object') return null;
  const url = String(it.url || it.videoUrl || '');
  const id = String(it.id || idFromUrl(url) || '').trim();
  const title = String(it.title ?? '').replace(/\s+/g, ' ').trim();
  if (!id && !title) return null;
  const d = parseDate(it.date ?? it.publishedAt ?? it.publishedText, now) || (/^\d{4}-\d{2}-\d{2}$/.test(String(it._approx || '')) ? { iso: it._approx, approx: true, kind: 'published', raw: '' } : null);
  const dur = parseDuration(it.duration);
  const t = String(it.type ?? '').toLowerCase();
  const short = truthy(it.isShort) || t === 'short' || t === 'shorts' || /\/shorts\//.test(url) || (dur != null && dur <= 60);
  const kind = short ? 'short' : d?.kind === 'stream' || t === 'stream' ? 'stream' : d?.kind === 'premiere' || t === 'premiere' ? 'premiere' : 'video';
  return {
    id: id || url || title, title, url: url || (id ? `https://www.youtube.com/watch?v=${id}` : ''), views: parseCount(it.viewCount ?? it.views),
    published_text: String(it.date ?? it.publishedAt ?? it.publishedText ?? '').trim(), published_approx: d ? d.iso : '', duration_s: dur, is_short: short, kind, pulled_at: pulledAt,
  };
}
export function channelMeta(items) {
  const f = items.find((i) => i && typeof i === 'object' && (i.numberOfSubscribers != null || i.channelTotalVideos != null || i.channelTotalViews != null || i.channelName));
  if (!f) return {};
  return { name: String(f.channelName || ''), subscribers: parseCount(f.numberOfSubscribers), total_videos: parseCount(f.channelTotalVideos), total_views: parseCount(f.channelTotalViews) };
}
const ERROR_WORDS = {
  CHANNEL_DOES_NOT_EXIST: 'that channel does not exist (check the handle or link)',
  CHANNEL_HAS_NO_VIDEOS: 'that channel has no public videos',
  NO_RESULTS: 'the scraper found nothing for that link',
};
// the scraper puts errors in the list as items such as {"error": "...", "errorCode": "CHANNEL_DOES_NOT_EXIST"}
export function splitItems(items, now = new Date(), pulledAt = now.toISOString()) {
  const rows = [], errors = [];
  let skipped = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') { skipped++; continue; }
    const code = it.errorCode || it.code || (typeof it.error === 'object' ? it.error?.code : '') || (typeof it.error === 'string' && /^[A-Z_]{6,}$/.test(it.error) ? it.error : '');
    if ((it.error || it.errorCode || it.noResults) && !it.id && !it.title) { errors.push({ code: String(code || 'ERROR'), text: ERROR_WORDS[code] || 'the scraper reported a problem for that link' }); continue; }
    const r = rowFromItem(it, now, pulledAt);
    if (r) rows.push(r); else skipped++;
  }
  return { rows, errors, skipped, meta: channelMeta(Array.isArray(items) ? items : []) };
}
// a scraper export or a CSV from anywhere: a JSON list (or {items|videos|data: [...]}) or a CSV with common column names
export function parseImport(text, now = new Date()) {
  const s = String(text).replace(/^﻿/, '').trim();
  if (!s) throw new Error('the file is empty');
  let items;
  if (s[0] === '[' || s[0] === '{') {
    let j; try { j = JSON.parse(s); } catch { throw new Error('the file looks like JSON but cannot be read as JSON'); }
    items = Array.isArray(j) ? j : j.items || j.videos || j.data || j.results;
    if (!Array.isArray(items)) throw new Error('the JSON has no list of videos (expected a list, or items / videos / data)');
  } else {
    const t = parseCsv(s);
    if (t.length < 2) throw new Error('the CSV has no rows under its header');
    const head = t[0].map(norm);
    const col = {};
    for (const [k, names] of Object.entries(COLS)) { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) col[k] = i; }
    if (col.title === undefined && col.id === undefined) throw new Error(`no title or id column found (the columns are: ${t[0].join(', ')}). Rename one to "title".`);
    if (col.viewCount === undefined) throw new Error(`no views column found (the columns are: ${t[0].join(', ')}). Rename one to "views".`);
    items = t.slice(1).map((r) => Object.fromEntries(Object.entries(col).map(([k, i]) => [k, r[i]])));
  }
  if (items.length > MAX_IMPORT_ROWS) throw new Error(`the file has ${items.length} rows; ${MAX_IMPORT_ROWS} is the most`);
  return splitItems(items, now);
}

/* ── the saved CSV of a channel's videos ──────────────────────────────────────────────────────────────────────────────── */
const cell = (v) => { const s = v == null ? '' : String(v).replace(/\r?\n/g, ' '); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const rowsToCsv = (rows) => [ROW_COLUMNS.join(','), ...rows.map((r) => ROW_COLUMNS.map((c) => cell(c === 'is_short' ? (r.is_short ? 'true' : 'false') : r[c])).join(','))].join('\n') + '\n';
export function readRows(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const t = parseCsv(text);
  if (t.length < 2) return [];
  const h = t[0].map((x) => x.trim());
  return t.slice(1).map((r) => {
    const o = Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']));
    return { ...o, views: o.views === '' ? null : Number(o.views), duration_s: o.duration_s === '' ? null : Number(o.duration_s), is_short: o.is_short === 'true' };
  }).filter((r) => r.id || r.title);
}
export function mergeRows(old, fresh) {
  const m = new Map(old.map((r) => [r.id, r]));
  for (const r of fresh) m.set(r.id, r);
  return [...m.values()];
}
export const saveRows = (dir, handle, rows) => atomicWrite(paths(dir).rows(handle), rowsToCsv(rows));

// channels.json (what each channel looked like when pulled) and history.csv (one line a day per channel)
export function recordPull(dir, handle, { meta = {}, rowCount, source, now }) {
  const p = paths(dir), k = keyOf(handle), day = iso(now);
  const all = readJSON(p.channels, { channels: {} });
  all.channels = all.channels || {};
  all.channels[k] = { name: meta.name || all.channels[k]?.name || '', subscribers: meta.subscribers ?? null, total_videos: meta.total_videos ?? null, total_views: meta.total_views ?? null, videos_read: rowCount, pulled_at: now.toISOString(), source };
  atomicWrite(p.channels, JSON.stringify(all, null, 2) + '\n');
  let lines = []; try { lines = fs.readFileSync(p.history, 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
  lines = lines.filter((l) => l !== HISTORY_HEADER && !l.startsWith(`${day},${k},`));
  lines.push([day, k, meta.subscribers ?? '', meta.total_videos ?? '', meta.total_views ?? '', source].join(','));
  atomicWrite(p.history, [HISTORY_HEADER, ...lines.sort()].join('\n') + '\n');
}
function updateEntry(state, handle, patch) {
  return { ...state, channels: state.channels.map((c) => (keyOf(c.handle) === keyOf(handle) ? { ...c, ...patch } : c)) };
}

/* ── analysis (pure) ──────────────────────────────────────────────────────────────────────────────────────────────────── */
export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const ageDays = (r, now) => (r.published_approx ? Math.max(1, (now.getTime() - new Date(`${r.published_approx}T00:00:00Z`).getTime()) / DAY) : null);
// outliers: views at or above x times the channel's OWN median, only with a sample of at least minSample videos
export function groupStats(rows, { now = new Date(), x = OUTLIER_X, minSample = MIN_SAMPLE } = {}) {
  const have = rows.filter((r) => Number.isFinite(r.views));
  const med = median(have.map((r) => r.views));
  const enough = have.length >= minSample;
  const withRate = have.map((r) => { const a = ageDays(r, now); return { ...r, views_per_day: a ? r.views / a : null }; });
  const outliers = enough && med > 0 ? withRate.filter((r) => r.views >= x * med).map((r) => ({ ...r, multiple: r.views / med })).sort((a, b) => b.multiple - a.multiple) : [];
  return { n: have.length, median: med, enough, median_views_per_day: median(withRate.map((r) => r.views_per_day)), outliers, others: withRate.filter((r) => !outliers.includes(r) && !outliers.some((o) => o.id === r.id)) };
}
export function analyseChannel(entry, rows, opts = {}) {
  return { handle: entry.handle, name: entry.name || '', tag: entry.tag || '', subscribers: entry.subscribers ?? null, pulled_at: entry.pulled_at || null, videos: rows.length, long: groupStats(rows.filter((r) => !r.is_short), opts), shorts: groupStats(rows.filter((r) => r.is_short), opts) };
}

const STOP = new Set('a an the and or but of to in on at for with from by as is are was were be been being it its this that these those you your yours we our they their he she his her i me my do does did not no yes so if then than too very can will just into out up down over about after before what when where who whom which why how all any each more most some such only own same also have has had having there here get got make made one two three new vs via per'.split(' '));
const QUESTION = /^(why|how|what|when|where|who|which|is|are|do|does|did|can|could|should|will|would)\b/i;
export function titleFeatures(title) {
  const t = String(title || '');
  return { length: t.length, number: /\d/.test(t), question: /\?\s*$/.test(t) || QUESTION.test(t), howwhy: /^(how|why)\b/i.test(t), split: /:|\s[-–|]\s/.test(t) };
}
export function tokens(title) {
  return String(title || '').toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ').split(' ').filter(Boolean).map((w) => w.replace(/^'+|'+$/g, ''));
}
const termList = (title) => {
  const t = tokens(title), words = t.filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const grams = [];
  for (let i = 0; i + 1 < t.length; i++) if (![t[i], t[i + 1]].some((w) => w.length < 3 || STOP.has(w) || /^\d+$/.test(w))) grams.push(`${t[i]} ${t[i + 1]}`);
  return { words: [...new Set(words)], grams: [...new Set(grams)] };
};
export function featureShares(titles) {
  const n = titles.length, f = titles.map(titleFeatures);
  const share = (k) => (n ? f.filter((x) => x[k]).length / n : null);
  return { n, median_length: median(f.map((x) => x.length)), number: share('number'), question: share('question'), howwhy: share('howwhy'), split: share('split') };
}
// words and word pairs that appear in the outlier titles of two or more different channels
export function crossChannelTopics(perChannel) {
  const idx = new Map();
  for (const ch of perChannel) for (const v of ch.outliers) {
    const { words, grams } = termList(v.title);
    for (const term of [...grams, ...words]) {
      if (!idx.has(term)) idx.set(term, new Map());
      const m = idx.get(term);
      if (!m.has(ch.handle)) m.set(ch.handle, []);
      m.get(ch.handle).push({ title: v.title, url: v.url });
    }
  }
  const hits = [...idx.entries()].filter(([, m]) => m.size >= 2).map(([term, m]) => ({ term, channels: [...m.keys()], videos: [...m.entries()].flatMap(([handle, vs]) => vs.map((v) => ({ ...v, handle }))), bigram: term.includes(' ') }));
  const kept = hits.filter((h) => h.bigram || !hits.some((g) => g.bigram && g.term.split(' ').includes(h.term) && g.channels.length >= h.channels.length));
  return kept.sort((a, b) => b.channels.length - a.channels.length || Number(b.bigram) - Number(a.bigram) || b.videos.length - a.videos.length || a.term.localeCompare(b.term)).slice(0, 8);
}
const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
export function buildReport(entries, rowsByHandle, { now = new Date(), x = OUTLIER_X, minSample = MIN_SAMPLE } = {}) {
  const channels = entries.map((e) => analyseChannel(e, rowsByHandle.get(keyOf(e.handle)) || [], { now, x, minSample }));
  const withData = channels.filter((c) => c.long.n + c.shorts.n > 0);
  const ranking = withData.filter((c) => c.long.n > 0).map((c) => ({ handle: c.handle, name: c.name, median_views: c.long.median, median_views_per_day: c.long.median_views_per_day, sample: c.long.n, enough: c.long.enough, outliers: c.long.outliers.length })).sort((a, b) => b.median_views - a.median_views);
  const big = channels.filter((c) => c.long.enough);
  const outliers = big.flatMap((c) => c.long.outliers.map((o) => ({ ...o, handle: c.handle })));
  const others = big.flatMap((c) => c.long.others);
  const patterns = { outliers: featureShares(outliers.map((o) => o.title)), others: featureShares(others.map((o) => o.title)), enough: outliers.length >= 3 };
  const topics = crossChannelTopics(big.map((c) => ({ handle: c.handle, outliers: c.long.outliers })));
  const suggestions = suggest({ patterns, topics, outliers, big, withData });
  const caveats = [];
  if (!entries.length) caveats.push('No channels are tracked yet: `video competitors add @handle`.');
  else if (!withData.length) caveats.push('No videos are saved yet: `video competitors sync` (Apify) or `video competitors import <handle> <file>`.');
  for (const c of withData) {
    if (!c.long.enough && c.long.n > 0) caveats.push(`@${c.handle}: only ${c.long.n} long video${c.long.n === 1 ? '' : 's'} saved, too few to say what an outlier is (it needs at least ${minSample}); no conclusions drawn for this channel.`);
    if (c.shorts.n > 0 && !c.shorts.enough) caveats.push(`@${c.handle}: only ${c.shorts.n} short${c.shorts.n === 1 ? '' : 's'} saved, too few for shorts outliers (it needs at least ${minSample}).`);
  }
  if (big.length && outliers.length < 3) caveats.push(`Only ${outliers.length} outlier${outliers.length === 1 ? '' : 's'} found in all, too few to compare title shapes.`);
  return { generated_at: now.toISOString(), rule: `An outlier is a video with at least ${x} times its own channel's median views, and only counted when the channel has at least ${minSample} videos saved (long videos and shorts are counted separately). Dates are approximate: the scraper gives text such as "10 months ago".`, channels, ranking, patterns, topics, suggestions, caveats };
}
// 3 to 5 ideas, each one built from the numbers above (never invented); fewer when the data supports fewer
function suggest({ patterns, topics, outliers, big }) {
  const out = [], o = patterns.outliers, r = patterns.others;
  const n = outliers.length;
  if (patterns.enough) {
    const gap = (k) => (o[k] ?? 0) - (r[k] ?? 0);
    if (o.howwhy >= 0.3 && gap('howwhy') >= 0.15) out.push({ idea: `Rivals' outliers often open with "How" or "Why": test one title in that shape.`, evidence: `${pct(o.howwhy)} of ${n} outlier titles vs ${pct(r.howwhy)} of ${r.n} other videos (the same channels).` });
    else if (o.question >= 0.3 && gap('question') >= 0.15) out.push({ idea: 'Rivals\' outliers are often questions: test a title phrased as a question.', evidence: `${pct(o.question)} of ${n} outlier titles vs ${pct(r.question)} of ${r.n} other videos.` });
    if (o.number >= 0.3 && gap('number') >= 0.15) out.push({ idea: 'Rivals\' outliers often carry a number: test one title with a real number from your research.', evidence: `${pct(o.number)} of ${n} outlier titles vs ${pct(r.number)} of ${r.n} other videos.` });
    if (o.split >= 0.3 && gap('split') >= 0.15) out.push({ idea: 'Rivals\' outliers often split the title with a colon or a dash: test one title as "big claim: the specific thing".', evidence: `${pct(o.split)} of ${n} outlier titles vs ${pct(r.split)} of ${r.n} other videos.` });
    if (o.median_length != null && r.median_length && Math.abs(o.median_length - r.median_length) / r.median_length >= 0.2) out.push({ idea: `Outlier titles are ${o.median_length < r.median_length ? 'shorter' : 'longer'}: test a title of about ${Math.round(o.median_length)} characters.`, evidence: `median ${Math.round(o.median_length)} characters in ${n} outliers vs ${Math.round(r.median_length)} in ${r.n} other videos.` });
  }
  if (topics.length) {
    const t = topics[0];
    out.push({ idea: `${t.channels.length} rival channels each have an outlier about "${t.term}": consider one outline on it, from your own angle. A pattern, not proof.`, evidence: t.videos.slice(0, 3).map((v) => `@${v.handle}: "${v.title}"`).join('; ') });
  }
  const fast = outliers.filter((v) => v.views_per_day != null).sort((a, b) => b.views_per_day - a.views_per_day)[0];
  if (fast) out.push({ idea: `Watch the first minute of the fastest outlier before the next outline and write down how it opens.`, evidence: `@${fast.handle}: "${fast.title}", ${Math.round(fast.views).toLocaleString('en')} views, about ${Math.round(fast.views_per_day).toLocaleString('en')} a day (approximate, from "${fast.published_text}"), ${fast.url}` });
  if (!out.length && big.length) out.push({ idea: 'No clear shape stands out yet: save more videos per channel (`video competitors sync --max 40`) before changing a title.', evidence: `${n} outlier${n === 1 ? '' : 's'} found in ${big.length} channel${big.length === 1 ? '' : 's'} with enough videos.` });
  return out.slice(0, 5);
}

/* ── the report as text ───────────────────────────────────────────────────────────────────────────────────────────────── */
const num = (n) => (n == null ? '-' : Math.round(n).toLocaleString('en'));
const vid = (v) => `[${v.title.replace(/[[\]]/g, '')}](${v.url})`;
export function renderMarkdown(rep) {
  const L = ['# Competitor outliers (YouTube)', '', `Generated ${rep.generated_at.slice(0, 10)}. ${rep.rule}`, ''];
  if (rep.caveats.length) L.push('## What to keep in mind', ...rep.caveats.map((c) => `- ${c}`), '');
  if (rep.ranking.length) {
    L.push('## Ranking (median views of long videos; views a day are approximate)', '', '| # | Channel | Median views | Median views a day (approx.) | Videos | Outliers |', '|---|---|---|---|---|---|');
    rep.ranking.forEach((r, i) => L.push(`| ${i + 1} | @${r.handle}${r.name ? ` (${r.name})` : ''} | ${num(r.median_views)} | ${num(r.median_views_per_day)} | ${r.sample}${r.enough ? '' : ' (sample too small)'} | ${r.enough ? r.outliers : '-'} |`));
    L.push('');
  }
  for (const c of rep.channels) {
    if (c.long.n + c.shorts.n === 0) continue;
    L.push(`## @${c.handle}${c.name ? ` (${c.name})` : ''}${c.tag ? `, ${c.tag}` : ''}`, `${c.subscribers != null ? `${num(c.subscribers)} subscribers. ` : ''}Long videos: ${c.long.n}, median ${num(c.long.median)} views. Shorts: ${c.shorts.n}${c.shorts.n ? `, median ${num(c.shorts.median)} views` : ''}.`);
    for (const [name, g] of [['Long videos', c.long], ['Shorts', c.shorts]]) {
      if (!g.n) continue;
      if (!g.enough) { L.push(`- ${name}: ${g.n} saved, too few to find outliers (needs ${MIN_SAMPLE}).`); continue; }
      if (!g.outliers.length) { L.push(`- ${name}: no video is at ${OUTLIER_X}x the median of ${num(g.median)} views.`); continue; }
      for (const v of g.outliers) L.push(`- ${name}: ${vid(v)}: ${num(v.views)} views, ${v.multiple.toFixed(1)}x the channel median, ${v.views_per_day != null ? `about ${num(v.views_per_day)} a day` : 'no date'} (approximate; published "${v.published_text || 'unknown'}").`);
    }
    L.push('');
  }
  L.push('## Title shapes (outliers vs the same channels\' other long videos)');
  const o = rep.patterns.outliers, r = rep.patterns.others;
  if (!rep.patterns.enough) L.push(`Too few outliers (${o.n}; at least 3 are needed) to compare. No pattern is claimed.`);
  else L.push('', '| Shape | Outliers | Other videos |', '|---|---|---|', `| Videos | ${o.n} | ${r.n} |`, `| Median title length | ${num(o.median_length)} | ${num(r.median_length)} |`, `| Has a number | ${pct(o.number)} | ${pct(r.number)} |`, `| A question | ${pct(o.question)} | ${pct(r.question)} |`, `| Starts with How or Why | ${pct(o.howwhy)} | ${pct(r.howwhy)} |`, `| A colon or dash split | ${pct(o.split)} | ${pct(r.split)} |`);
  L.push('', '## Topics repeated across channels (a pattern, not proof)');
  if (!rep.topics.length) L.push('None: no word or word pair shows up in the outliers of two or more channels.');
  for (const t of rep.topics) L.push(`- "${t.term}" in ${t.channels.length} channels: ${t.videos.slice(0, 4).map((v) => `@${v.handle} ${vid(v)}`).join('; ')}`);
  L.push('', '## Ideas to test in the next outline');
  if (!rep.suggestions.length) L.push('None yet: the numbers do not support one.');
  rep.suggestions.forEach((s, i) => L.push(`${i + 1}. ${s.idea} Evidence: ${s.evidence}`));
  return L.join('\n') + '\n';
}
export function renderOutliers(rep) {
  const rows = rep.channels.flatMap((c) => [['long', c.long], ['short', c.shorts]].flatMap(([k, g]) => g.outliers.map((v) => ({ ...v, handle: c.handle, k })))).sort((a, b) => b.multiple - a.multiple);
  if (!rows.length) return `No outliers: ${rep.caveats.length ? rep.caveats.join(' ') : `no video is at ${OUTLIER_X}x its channel's median.`}\n`;
  return rows.map((v) => `${v.multiple.toFixed(1)}x  @${v.handle}  ${v.title}  (${num(v.views)} views, ${v.k}, published "${v.published_text}", approximate)  ${v.url}`).join('\n') + '\n';
}

/* ── loading everything for a channel folder ──────────────────────────────────────────────────────────────────────────── */
export function loadAll(dir) {
  const state = loadState(dir), p = paths(dir);
  const rows = new Map(state.channels.map((c) => [keyOf(c.handle), readRows(p.rows(c.handle))]));
  return { state, rows };
}
export function makeReport(dir, now = new Date()) {
  const { state, rows } = loadAll(dir);
  return buildReport(state.channels, rows, { now });
}
export function writeReport(dir, rep) {
  const p = paths(dir);
  atomicWrite(p.md, renderMarkdown(rep));
  atomicWrite(p.json, JSON.stringify(rep, null, 2) + '\n');
}
// for the dashboard: nothing is fetched, everything comes from the saved files
export function dashboardSummary(dir, now = new Date()) {
  const p = paths(dir);
  if (!fs.existsSync(p.state)) return null;
  const state = loadState(dir);
  const rep = makeReport(dir, now);
  const pulled = state.channels.map((c) => c.pulled_at).filter(Boolean).sort().at(-1) || '';
  const top = rep.channels.flatMap((c) => c.long.outliers.map((v) => ({ title: v.title, url: v.url, handle: c.handle, multiple: v.multiple, views: v.views }))).sort((a, b) => b.multiple - a.multiple).slice(0, 3);
  return { channels: state.channels.length, pulled: pulled.slice(0, 10), top, report: fs.existsSync(p.md) ? p.md : null, caveat: rep.caveats[0] || '' };
}

/* ── settings, the cost estimate, the spend log ───────────────────────────────────────────────────────────────────────── */
export function settingsFor(cfg = {}) {
  const y = cfg.research?.youtube || {};
  const c = Number(y.cost_per_video);
  let actor = String(y.actor || DEFAULT_ACTOR).trim().replace('/', '~');
  if (!/^[A-Za-z0-9_.-]+~[A-Za-z0-9_.-]+$/.test(actor)) throw new Error(`brand.json research.youtube.actor "${actor}" is not an actor id like ${DEFAULT_ACTOR}`);
  return { actor, cost_per_video: Number.isFinite(c) && c > 0 ? c : DEFAULT_COST_PER_VIDEO };
}
export function spendSoFar(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const col = (lines[0] || '').split(',').indexOf('estimated_usd');
  if (col < 0) return 0;
  return lines.slice(1).reduce((s, l) => { const v = Number(l.split(',')[col]); return s + (Number.isFinite(v) ? v : 0); }, 0);
}
export function logSpend(file, { now, handles, videos, cost, actor }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let cur = ''; try { cur = fs.readFileSync(file, 'utf8'); } catch {}
  const line = [iso(now), 'apify', handles.map(keyOf).join('+'), videos, cost.toFixed(3), actor].join(',');
  atomicWrite(file, `${cur ? cur.replace(/\r?\n?$/, '\n') : `${SPEND_HEADER}\n`}${line}\n`);
}

/* ── Apify: the only code that touches the token or the network ───────────────────────────────────────────────────────── */
export const defaultKeyFile = () => path.join(os.homedir(), '.config', 'bagelunit-reels', 'apify.key');
// existence and size only; the contents are not read here
export function keyState(file) {
  try { const s = fs.statSync(file); return s.isFile() && s.size > 0 ? 'ready' : 'empty'; } catch { return 'missing'; }
}
// THE one place the token is read. It stays inside this closure: out come the Authorization header and a function that hides it.
export function authFor(file) {
  const token = String(fs.readFileSync(file, 'utf8')).split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  if (!token) throw new Error(`the token file ${KEY_TEXT} is empty`);
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error(`the token file ${KEY_TEXT} has something other than the token in it (the token alone on one line)`);
  return { headers: { Authorization: `Bearer ${token}` }, redact: (text) => String(text).split(token).join('[token hidden]') };
}
const HTTP_WORDS = {
  401: 'Apify did not accept the token (wrong, expired or removed). Make a new one at console.apify.com/settings/integrations and save it in the token file.',
  402: 'Apify says the account is out of credit (or at its plan limit). Add credit on apify.com, then run it again.',
  403: 'Apify says this token is not allowed to run that actor. Check the token\'s permissions and brand.json research.youtube.actor.',
  404: 'Apify does not know that actor id. Check brand.json research.youtube.actor.',
  408: 'Apify stopped waiting (a synchronous call can run about 5 minutes). Try a smaller --max.',
  429: 'Apify says there were too many requests (rate limit). Wait a few minutes and run it again.',
  504: 'Apify stopped waiting (a synchronous call can run about 5 minutes). Try a smaller --max.',
};
const STOP_ALL = new Set([401, 402, 429]);   // account-level: the other channels would fail the same way, so the run stops
export const apifyInput = (c, max, shorts) => ({ startUrls: [{ url: c.url }], maxResults: max, maxResultsShorts: shorts ? max : 0, maxResultStreams: 0, sortVideosBy: 'NEWEST' });
const endpointFor = (actor, cap, items) => `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?maxTotalChargeUsd=${cap.toFixed(2)}&maxItems=${items}`;

async function readChannel({ fetchImpl, actor, auth, c, max, shorts, cap, timeoutMs }) {
  let res;
  try {
    res = await fetchImpl(endpointFor(actor, cap, max + (shorts ? max : 0) + 2), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...auth.headers }, body: JSON.stringify(apifyInput(c, max, shorts)), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return { ok: false, why: `Apify did not answer within ${Math.round(timeoutMs / 1000)} seconds, so nothing was saved for this channel (Apify may still bill for work it started: check apify.com).` };
    return { ok: false, why: `could not reach Apify (${auth.redact(e?.message || 'network error')}). Check the internet connection.` };
  }
  const status = Number(res.status) || 0;
  if (!(res.ok ?? (status >= 200 && status < 300))) return { ok: false, status, why: HTTP_WORDS[status] || `Apify answered with an error (HTTP ${status}); nothing was saved for this channel.` };
  let items;
  try { items = await res.json(); } catch { return { ok: false, why: 'Apify sent an answer that is not a list of videos; nothing was saved for this channel.' }; }
  if (!Array.isArray(items)) return { ok: false, why: 'Apify sent an answer that is not a list of videos; nothing was saved for this channel.' };
  return { ok: true, items };
}

// the plan: what a sync would read, send and cost (nothing here touches the network)
export function planSync(dir, cfg, { handle = null, max = DEFAULT_MAX, shorts = false, maxCost = 1, keyFile = defaultKeyFile() } = {}) {
  const state = loadState(dir), st = settingsFor(cfg);
  const channels = handle ? state.channels.filter((c) => keyOf(c.handle) === keyOf(handle)) : state.channels;
  if (handle && !channels.length) throw new Error(`@${keyOf(handle)} is not tracked. \`video competitors list\` shows the channels.`);
  const per = max + (shorts ? max : 0), videos = per * channels.length;
  const cost = videos * st.cost_per_video;
  return { state, channels, max, shorts, perChannel: per, videos, cost, maxCost, ...st, key: keyState(keyFile), scrapeOn: cfg.autopilot?.scrape === true, spent: spendSoFar(paths(dir).spend) };
}
export function printPlan(plan, log, dry) {
  log(dry ? 'Competitor sync: DRY RUN (nothing is sent, nothing is spent)' : 'Competitor sync: checking before a real run');
  log(`Channels: ${plan.channels.length}`);
  for (const c of plan.channels) log(`  @${c.handle}  ${c.url}  up to ${plan.max} videos${plan.shorts ? ` and ${plan.max} shorts` : ''}`);
  log(`Estimated videos: ${plan.videos}`);
  log(`Estimated cost: about ${money(plan.cost)} (${plan.videos} videos x ${money(plan.cost_per_video)} a video; estimated, check your plan on apify.com)`);
  log(`Your limit (--max-cost): ${money(plan.maxCost)}. Already logged in brand/spend.csv: about ${money(plan.spent)}.`);
  log(`What would be sent to Apify (actor ${plan.actor}), one request per channel: the channel link above, maxResults ${plan.max}, maxResultsShorts ${plan.shorts ? plan.max : 0}, maxResultStreams 0. Nothing else is sent: no key text, nothing about you.`);
}
const readyLines = (plan) => [
  `  token file ${KEY_TEXT}: ${plan.key === 'ready' ? 'found' : plan.key === 'empty' ? 'EMPTY' : 'MISSING'}`,
  `  brand.json autopilot.scrape: ${plan.scrapeOn ? 'on' : 'OFF (the owner turns it on)'}`,
  `  estimate under --max-cost: ${plan.cost <= plan.maxCost ? 'yes' : 'NO'}`,
];

export async function sync(dir, cfg, o = {}, io = {}) {
  const log = io.log || ((l) => console.log(l)), now = io.now || new Date();
  const fetchImpl = io.fetch || globalThis.fetch, keyFile = io.keyFile || defaultKeyFile();
  const plan = planSync(dir, cfg, { ...o, keyFile });
  if (!plan.channels.length) throw new Error('No channels are tracked yet: `video competitors add @handle` first.');
  const dry = o.dryRun || !o.yes;
  printPlan(plan, log, dry);
  if (dry) {
    log('Ready for a real run?');
    readyLines(plan).forEach((l) => log(l));
    log(`${o.dryRun ? 'Dry run only.' : 'Nothing was sent, because --yes was not given.'} Only the owner can say yes: to read for real, run the same command with --yes after checking the cost above.`);
    return { dry: true, plan };
  }
  const refuse = [];
  if (!plan.scrapeOn) refuse.push('brand.json autopilot.scrape is not true. It is the owner\'s switch for paid reads: set "autopilot": {"scrape": true} only when they agree.');
  if (plan.key !== 'ready') refuse.push(`There is no token in ${KEY_TEXT} (${plan.key === 'empty' ? 'the file is empty' : 'the file is missing'}). \`video suggest apify\` shows how to connect Apify, or use \`video competitors import\` with an export file.`);
  if (plan.cost > plan.maxCost) refuse.push(`The estimate ${money(plan.cost)} is over --max-cost ${money(plan.maxCost)}. Lower --max, track fewer channels, or raise --max-cost if the owner agrees.`);
  if (refuse.length) throw new Error(`Nothing was sent. ${refuse.join(' ')}`);
  log('All checks passed: reading for real.');
  const auth = authFor(keyFile);
  const sleep = io.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pause = io.pauseMs ?? 2500, timeoutMs = io.timeoutMs ?? 300000;
  const results = [];
  let state = plan.state, attempted = [], got = 0, stopped = false;
  for (const [i, c] of plan.channels.entries()) {
    if (stopped) { results.push({ handle: c.handle, ok: false, why: 'not tried (the run stopped above)' }); continue; }
    if (i > 0 && pause) await sleep(pause);
    const cap = Math.min(plan.maxCost, Math.max(0.01, Math.ceil(plan.perChannel * plan.cost_per_video * 1.25 * 100) / 100));
    attempted.push(c.handle);
    const r = await readChannel({ fetchImpl, actor: plan.actor, auth, c, max: plan.max, shorts: plan.shorts, cap, timeoutMs });
    if (!r.ok) {
      results.push({ handle: c.handle, ok: false, why: r.why });
      if (STOP_ALL.has(r.status)) stopped = true;
      continue;
    }
    const pulledAt = now.toISOString();
    const part = splitItems(r.items, now, pulledAt);
    if (o.saveRaw) atomicWrite(path.join(paths(dir).raw, `${keyOf(c.handle)}-${iso(now)}.json`), JSON.stringify(r.items, null, 1) + '\n');
    got += part.rows.length;
    if (!part.rows.length) { results.push({ handle: c.handle, ok: false, why: part.errors.length ? part.errors.map((e) => e.text).join('; ') : 'the scraper returned no videos for this channel' }); continue; }
    const merged = mergeRows(readRows(paths(dir).rows(c.handle)), part.rows);
    saveRows(dir, c.handle, merged);
    recordPull(dir, c.handle, { meta: part.meta, rowCount: part.rows.length, source: 'apify', now });
    state = updateEntry(state, c.handle, { name: part.meta.name || c.name || '', subscribers: part.meta.subscribers ?? c.subscribers ?? null, videos_read: part.rows.length, pulled_at: pulledAt, source: 'apify' });
    saveState(dir, state);
    results.push({ handle: c.handle, ok: true, videos: part.rows.length, errors: part.errors, skipped: part.skipped });
  }
  const cost = got * plan.cost_per_video;
  if (attempted.length) logSpend(paths(dir).spend, { now, handles: attempted, videos: got, cost, actor: plan.actor });
  for (const r of results) log(r.ok ? `@${r.handle}: ${r.videos} videos saved${r.errors.length ? ` (the scraper also said: ${r.errors.map((e) => e.text).join('; ')})` : ''}` : `@${r.handle}: FAILED: ${r.why}`);
  log(`Done: ${got} videos read, about ${money(cost)} (estimated, check your plan on apify.com), logged in brand/spend.csv.`);
  if (got) log('Next: `video competitors report`.');
  return { dry: false, results, videos: got, cost };
}

/* ── import ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
export function importFile(dir, handleArg, file, { now = new Date(), log = (l) => console.log(l) } = {}) {
  const full = path.resolve(String(file).replace(/^~(?=$|[\\/])/, os.homedir()));
  let st; try { st = fs.statSync(full); } catch { throw new Error(`cannot find ${full}`); }
  if (!st.isFile()) throw new Error(`${full} is not a file`);
  if (st.size > MAX_IMPORT_BYTES) throw new Error(`${full} is larger than ${MAX_IMPORT_BYTES / 1048576} MB`);
  let state = loadState(dir);
  const c = parseChannel(handleArg);
  if (!state.channels.some((x) => keyOf(x.handle) === keyOf(c.handle))) { ({ state } = addChannel(state, handleArg, { now })); log(`@${c.handle} was not tracked yet: added.`); }
  const part = parseImport(fs.readFileSync(full, 'utf8'), now);
  if (!part.rows.length) throw new Error(`no videos found in ${path.basename(full)}${part.errors.length ? ` (${part.errors.map((e) => e.text).join('; ')})` : ''}`);
  const entry = state.channels.find((x) => keyOf(x.handle) === keyOf(c.handle));
  saveRows(dir, entry.handle, mergeRows(readRows(paths(dir).rows(entry.handle)), part.rows));
  recordPull(dir, entry.handle, { meta: part.meta, rowCount: part.rows.length, source: 'import', now });
  state = updateEntry(state, entry.handle, { name: part.meta.name || entry.name || '', subscribers: part.meta.subscribers ?? entry.subscribers ?? null, videos_read: part.rows.length, pulled_at: now.toISOString(), source: 'import' });
  saveState(dir, state);
  const noViews = part.rows.filter((r) => r.views == null).length;
  log(`@${entry.handle}: ${part.rows.length} videos imported from ${path.basename(full)}${part.skipped ? `, ${part.skipped} rows skipped` : ''}${noViews ? `, ${noViews} without a views number (left out of the maths)` : ''}. Next: \`video competitors report\`.`);
  return { rows: part.rows.length, skipped: part.skipped };
}

/* ── the command ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
const SWITCHES = new Set(['shorts', 'dry-run', 'yes', 'json', 'save-raw']);
export function parseArgs(argv) {
  const flags = {}, loose = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (SWITCHES.has(k) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) flags[k] = true; else { flags[k] = argv[i + 1]; i++; }
    } else loose.push(a);
  }
  return { flags, loose };
}
const USAGE = `video competitors: track other YouTube channels (optional; Apify is only one way, an export file works too)
  add <@handle | channel link> [--tag niche|adjacent|big]   remove <handle>   list [--json]
  sync [<handle>] [--max N] [--shorts] [--dry-run] [--yes] [--max-cost USD]   (a dry run showing the cost unless every safety check passes and --yes is given)
  import <handle> <file.csv | file.json>   report [--json]   outliers`;
const intFlag = (v, name, lo, hi, d) => { if (v === undefined) return d; const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`--${name} must be a whole number from ${lo} to ${hi}`); return n; };

// io: { cwd, log, now, fetch, keyFile, sleep, pauseMs, timeoutMs } (all optional; the tests pass their own)
export async function cli(argv, io = {}) {
  const { flags, loose } = parseArgs(argv);
  const log = io.log || ((l) => console.log(l)), now = io.now || new Date();
  const [sub, a, b] = loose;
  if (!sub) { log(USAGE); return 0; }
  const brand = findBrand(io.cwd || process.cwd());
  if (!brand) throw new Error('This is not a channel folder (no brand/brand.json). Open Claude Code in your channel folder.');
  const dir = brand.dir;
  switch (sub) {
    case 'add': {
      const r = addChannel(loadState(dir), a, { tag: flags.tag === undefined ? 'niche' : flags.tag, now });
      saveState(dir, r.state);
      log(`Tracking @${r.entry.handle} (${r.entry.tag}), ${r.state.channels.length} of ${MAX_CHANNELS}. Next: \`video competitors sync --dry-run\` (the cost first) or \`video competitors import ${r.entry.handle} <file>\`.`);
      return 0;
    }
    case 'remove': {
      const r = removeChannel(loadState(dir), a);
      saveState(dir, r.state);
      log(`Stopped tracking @${r.entry.handle}. Its saved videos stay in brand/research/youtube/${keyOf(r.entry.handle)}.csv.`);
      return 0;
    }
    case 'list': {
      const s = loadState(dir);
      if (flags.json) { log(JSON.stringify(s, null, 2)); return 0; }
      if (!s.channels.length) { log('No channels tracked yet: `video competitors add @handle`.'); return 0; }
      for (const c of s.channels) log(`@${c.handle}  ${c.tag}  ${c.name || '-'}  ${c.subscribers != null ? `${num(c.subscribers)} subscribers` : 'subscribers unknown'}  ${c.videos_read} videos read  ${c.pulled_at ? `pulled ${c.pulled_at.slice(0, 10)} (${c.source})` : 'not pulled yet'}`);
      log(`${s.channels.length} of ${MAX_CHANNELS} channels.`);
      return 0;
    }
    case 'sync': return (await sync(dir, brand.cfg, { handle: a || null, max: intFlag(flags.max, 'max', 1, 200, DEFAULT_MAX), shorts: Boolean(flags.shorts), dryRun: Boolean(flags['dry-run']), yes: Boolean(flags.yes), maxCost: flags['max-cost'] === undefined ? 1 : Number(flags['max-cost']), saveRaw: Boolean(flags['save-raw']) }, { ...io, log, now }), 0);
    case 'import': {
      if (!a || !b) throw new Error('usage: video competitors import <handle> <file.csv | file.json>');
      importFile(dir, a, b, { now, log });
      return 0;
    }
    case 'report': case 'outliers': {
      const rep = makeReport(dir, now);
      if (sub === 'outliers') { log(flags.json ? JSON.stringify(rep.channels.flatMap((c) => [...c.long.outliers, ...c.shorts.outliers].map((v) => ({ handle: c.handle, title: v.title, url: v.url, views: v.views, multiple: v.multiple }))), null, 2) : renderOutliers(rep).trimEnd()); return 0; }
      if (loadState(dir).channels.length) writeReport(dir, rep);
      log(flags.json ? JSON.stringify(rep, null, 2) : renderMarkdown(rep).trimEnd());
      if (loadState(dir).channels.length) log(`\nWritten: brand/research/youtube/outliers.md and outliers.json`);
      return 0;
    }
    default: log(USAGE); return 1;
  }
}
