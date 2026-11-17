#!/usr/bin/env node
// Tests for the YouTube competitor tracker (studio/tools/competitors.mjs, the verb `video competitors`, the dashboard card).
// No network and no real token: every read uses a stubbed fetch and a fake token file in a fake HOME. The fake token text
// is searched for in every output, file and message. Run: node setup/test-competitors.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(REPO, 'studio', 'tools', 'video.mjs');
const C = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'competitors.mjs')).href);
const U = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'update.mjs')).href);
const TOKEN = 'TESTTOKEN-q7Zk92LmNp41xWvB';
const NOW = new Date('2026-11-17T12:00:00Z');
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'video-competitors-test-')));
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };

// a channel folder, with the scrape switch on or off, and a fake HOME with (or without) a token file
function world({ scrape = true, key = true, brand = {} } = {}) {
  const dir = tmp(), home = tmp();
  const cfg = { name: 'Quark Street', slug: 'quark-street', autopilot: { scrape }, ...brand };
  write(path.join(dir, 'brand', 'brand.json'), JSON.stringify(cfg, null, 2));
  const keyFile = path.join(home, '.config', 'bagelunit-reels', 'apify.key');
  if (key === true) write(keyFile, `${TOKEN}\n`); else if (key === 'empty') write(keyFile, '');
  return { dir, home, cfg, keyFile, log: [], io(extra = {}) { return { keyFile, log: (l) => this.log.push(l), now: NOW, pauseMs: 0, sleep: async () => {}, ...extra }; } };
}
// the actor's documented output shape: one item per video, the channel's numbers repeated on each
const item = (h, i, views, over = {}) => ({ id: `${h}${String(i).padStart(3, '0')}xxxxx`.slice(0, 11), title: `Video ${i} of ${h}`, url: `https://www.youtube.com/watch?v=${h}${i}`, duration: '10:05', viewCount: views, date: `${i + 1} months ago`, channelName: `${h} Channel`, channelUrl: `https://www.youtube.com/@${h}`, numberOfSubscribers: 12500, channelTotalVideos: 120, channelTotalViews: '1,710,167,563', fromYTUrl: `https://www.youtube.com/@${h}/videos`, inputChannelUrl: `https://www.youtube.com/@${h}/about`, ...over });
const items = (h, views, over = {}) => views.map((v, i) => item(h, i, v, over));
const ok = (body) => ({ ok: true, status: 201, json: async () => body });
const bad = (status) => ({ ok: false, status, json: async () => ({ error: { message: `secret ${TOKEN}` } }) });
// a stub fetch that records every call (url, headers, body) and answers by the channel link in the body
const stub = (answer) => { const calls = []; const f = async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, init, body }); return answer(body.startUrls[0].url, calls.length); }; f.calls = calls; return f; };
const VIEWS12 = [100, 110, 90, 105, 95, 100, 120, 80, 100, 100, 400, 350];   // median 100, two videos at 3x or more
const every = (dir) => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p); } }; walk(dir); return out; };
const noToken = (w, extra = []) => {
  const text = [...w.log, ...extra].join('\n');
  assert.ok(!text.includes(TOKEN), 'the token text is in an output or message');
  for (const f of every(w.dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes(TOKEN), `the token text is in ${f}`);
};
const sendFails = async (w, opts, io, re) => { try { await C.sync(w.dir, w.cfg, opts, io); } catch (e) { assert.ok(!e.message.includes(TOKEN)); assert.match(e.message, re); return e.message; } assert.fail('sync should have refused'); };
const addAll = (w, ...hs) => { let s = C.loadState(w.dir); for (const h of hs) ({ state: s } = C.addChannel(s, h, { now: NOW })); C.saveState(w.dir, s); };

/* ── parsing ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('handles and links: @handle, youtube.com/@x, /channel/UC..., /c/x; bad input says why', () => {
  assert.deepEqual(C.parseChannel('@Quark_Street'), { handle: 'Quark_Street', url: 'https://www.youtube.com/@Quark_Street/videos', kind: 'handle' });
  assert.equal(C.parseChannel('https://www.youtube.com/@Quark_Street/videos').handle, 'Quark_Street');
  assert.equal(C.parseChannel('youtube.com/@abc.def?si=x').handle, 'abc.def');
  assert.equal(C.parseChannel('https://m.youtube.com/@abc').handle, 'abc');
  const id = 'UCSJ4gkVC6NrvII8umztf0Ow';
  assert.deepEqual(C.parseChannel(`https://www.youtube.com/channel/${id}`), { handle: id, url: `https://www.youtube.com/channel/${id}/videos`, kind: 'channel' });
  assert.equal(C.parseChannel(id).kind, 'channel');
  assert.deepEqual(C.parseChannel('https://www.youtube.com/c/SomeName'), { handle: 'SomeName', url: 'https://www.youtube.com/c/SomeName/videos', kind: 'custom' });
  assert.equal(C.parseChannel('plainname').handle, 'plainname');
  for (const bad of ['', '@a', '@bad handle', 'https://example.com/@abc', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/channel/short', '../../etc', '@a/../b']) assert.throws(() => C.parseChannel(bad), /./, bad);
});
await test('the relative date parser: days, weeks, months, years, streamed, premiered, ISO, always approximate when relative', () => {
  const d = (t) => C.parseDate(t, NOW);
  assert.deepEqual([d('3 days ago').iso, d('3 days ago').approx], ['2026-11-14', true]);
  assert.equal(d('2 weeks ago').iso, '2026-11-03');
  assert.equal(d('10 months ago').iso, '2026-01-17');
  assert.equal(d('1 year ago').iso, '2025-11-17');
  assert.equal(d('2 years ago').iso, '2024-11-17');
  assert.equal(d('1 hour ago').iso, '2026-11-17');
  assert.equal(d('yesterday').iso, '2026-11-16');
  const s = d('Streamed 2 weeks ago');
  assert.deepEqual([s.iso, s.kind], ['2026-11-03', 'stream']);
  assert.equal(d('Streamed live 3 days ago').kind, 'stream');
  const p = d('Premiered 5 days ago');
  assert.deepEqual([p.iso, p.kind], ['2026-11-12', 'premiere']);
  assert.deepEqual([d('2021-12-21').iso, d('2021-12-21').approx], ['2021-12-21', false]);
  assert.equal(d('Nov 3, 2025').iso, '2025-11-03');
  assert.equal(d('Nov 3, 2025').approx, false);
  assert.equal(d('whenever'), null);
  assert.equal(d(''), null);
  assert.equal(d('10 months ago').raw, '10 months ago');
});
await test('the duration parser: 29:54, 1:02:03, 00:03:17, ISO, seconds, junk', () => {
  assert.equal(C.parseDuration('29:54'), 1794);
  assert.equal(C.parseDuration('1:02:03'), 3723);
  assert.equal(C.parseDuration('00:03:17'), 197);
  assert.equal(C.parseDuration('0:45'), 45);
  assert.equal(C.parseDuration('PT1H2M3S'), 3723);
  assert.equal(C.parseDuration('95'), 95);
  assert.equal(C.parseDuration(61), 61);
  assert.equal(C.parseDuration('LIVE'), null);
  assert.equal(C.parseDuration(''), null);
  assert.equal(C.parseCount('1,710,167,563'), 1710167563);
  assert.equal(C.parseCount('13.1M'), 13100000);
  assert.equal(C.parseCount('12K views'), 12000);
  assert.equal(C.parseCount('No views'), 0);
  assert.equal(C.parseCount(null), null);
});
await test('a row from an item: short = 60 s or less or the flag, kind, approximate date kept beside the raw text', () => {
  const r = C.rowFromItem(item('a', 1, 500, { duration: '0:58' }), NOW);
  assert.deepEqual([r.is_short, r.kind, r.duration_s, r.views, r.published_text, r.published_approx], [true, 'short', 58, 500, '2 months ago', '2026-09-17']);
  assert.equal(C.rowFromItem(item('a', 1, 5, { duration: '10:00', isShort: true }), NOW).is_short, true);
  assert.equal(C.rowFromItem(item('a', 1, 5, { duration: '10:00', url: 'https://www.youtube.com/shorts/abcdefghijk' }), NOW).is_short, true);
  assert.equal(C.rowFromItem(item('a', 1, 5, { duration: '1:01' }), NOW).is_short, false);
  assert.equal(C.rowFromItem(item('a', 1, 5, { date: 'Streamed 2 weeks ago' }), NOW).kind, 'stream');
  assert.equal(C.rowFromItem(item('a', 1, null), NOW).views, null);
  assert.equal(C.rowFromItem({ foo: 1 }, NOW), null);
});

/* ── add / remove / list ────────────────────────────────────────────────────────────────────────────────────────────── */
await test('add, remove and list: tags, duplicates, the 30 channel limit, atomic file', async () => {
  const w = world();
  const run = (...a) => C.cli(a, { cwd: w.dir, log: (l) => w.log.push(l), now: NOW });
  await run('add', '@alpha_ch', '--tag', 'big');
  await run('add', 'https://www.youtube.com/@Beta_Ch/videos');
  const s = JSON.parse(read(path.join(w.dir, 'brand', 'competitors.json')));
  assert.deepEqual(s.channels.map((c) => [c.handle, c.tag, c.added]), [['alpha_ch', 'big', '2026-11-17'], ['Beta_Ch', 'niche', '2026-11-17']]);
  assert.deepEqual(Object.keys(s.channels[0]), ['handle', 'url', 'name', 'tag', 'added', 'subscribers', 'videos_read', 'pulled_at', 'source']);
  await assert.rejects(() => run('add', '@ALPHA_CH'), /already tracked/);
  await assert.rejects(() => run('add', '@gamma_ch', '--tag', 'huge'), /--tag must be/);
  await run('list');
  assert.ok(w.log.some((l) => l.startsWith('@alpha_ch') && l.includes('big')));
  await run('remove', 'beta_ch');
  assert.deepEqual(C.loadState(w.dir).channels.map((c) => c.handle), ['alpha_ch']);
  await assert.rejects(() => run('remove', 'nobody'), /not tracked/);
  assert.deepEqual(every(path.join(w.dir, 'brand')).filter((f) => f.includes('.tmp-')), []);
  let st = C.loadState(w.dir);
  for (let i = 0; i < 29; i++) ({ state: st } = C.addChannel(st, `chan_${String(i).padStart(2, '0')}`, { now: NOW }));
  assert.equal(st.channels.length, 30);
  assert.throws(() => C.addChannel(st, '@one_more'), /most/);
  const outside = tmp();
  await assert.rejects(() => C.cli(['list'], { cwd: outside, log() {} }), /not a channel folder/);
});

/* ── import ──────────────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('import: a CSV with common column names (and a UTF-8 BOM, CRLF), a JSON list, kept offline', async () => {
  const w = world({ key: false });
  addAll(w, '@alpha_ch');
  const csv = write(path.join(w.dir, 'export.csv'), '﻿Video title,Video ID,Views,Video publish time,Duration\r\n"Why, really?",abc123abc12,"1,200","Nov 3, 2025",10:00\r\nSecond,,300,3 months ago,0:45\r\nNo views,zzz,,2 weeks ago,5:00\r\n');
  const log = [];
  C.importFile(w.dir, 'alpha_ch', csv, { now: NOW, log: (l) => log.push(l) });
  const rows = C.readRows(C.paths(w.dir).rows('alpha_ch'));
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0].title, rows[0].id, rows[0].views, rows[0].published_approx, rows[0].duration_s], ['Why, really?', 'abc123abc12', 1200, '2025-11-03', 600]);
  assert.deepEqual([rows[1].is_short, rows[1].published_approx, rows[1].id], [true, '2026-08-18', 'Second']);
  assert.equal(rows[2].views, null);
  assert.match(log.join('\n'), /1 without a views number/);
  const header = read(C.paths(w.dir).rows('alpha_ch')).split('\n')[0];
  assert.equal(header, 'id,title,url,views,published_text,published_approx,duration_s,is_short,kind,pulled_at');
  const entry = C.loadState(w.dir).channels[0];
  assert.deepEqual([entry.videos_read, entry.source, entry.pulled_at.slice(0, 10)], [3, 'import', '2026-11-17']);
  // a JSON export in the scraper's own shape, and a re-import of the kit's own CSV
  const json = write(path.join(w.dir, 'export.json'), JSON.stringify(items('alpha_ch', [10, 20, 30])));
  C.importFile(w.dir, 'alpha_ch', json, { now: NOW, log() {} });
  assert.equal(C.readRows(C.paths(w.dir).rows('alpha_ch')).length, 6);
  assert.equal(C.loadState(w.dir).channels[0].subscribers, 12500);
  C.importFile(w.dir, 'alpha_ch', C.paths(w.dir).rows('alpha_ch'), { now: NOW, log() {} });
  assert.equal(C.readRows(C.paths(w.dir).rows('alpha_ch')).length, 6);
  // an unknown channel is added; a file with no usable columns says what it found
  C.importFile(w.dir, '@newone', json, { now: NOW, log() {} });
  assert.deepEqual(C.loadState(w.dir).channels.map((c) => c.handle), ['alpha_ch', 'newone']);
  const wrong = write(path.join(w.dir, 'wrong.csv'), 'a,b\n1,2\n');
  assert.throws(() => C.importFile(w.dir, 'alpha_ch', wrong, { now: NOW, log() {} }), /no title or id column.*a, b/);
  assert.throws(() => C.importFile(w.dir, 'alpha_ch', path.join(w.dir, 'missing.csv'), { now: NOW, log() {} }), /cannot find/);
  assert.equal(read(C.paths(w.dir).history).split('\n')[0], C.HISTORY_HEADER);
});

/* ── analysis ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('median and outliers: 3x the channel\'s own median, sample of at least 10, shorts counted apart', () => {
  assert.equal(C.median([3, 1, 2]), 2);
  assert.equal(C.median([1, 2, 3, 4]), 2.5);
  assert.equal(C.median([]), null);
  const rows = items('a', VIEWS12).map((i) => C.rowFromItem(i, NOW));
  const g = C.groupStats(rows, { now: NOW });
  assert.deepEqual([g.n, g.median, g.enough], [12, 100, true]);
  assert.deepEqual(g.outliers.map((o) => o.views), [400, 350]);
  assert.ok(Math.abs(g.outliers[0].multiple - 4) < 1e-9);
  assert.ok(g.outliers[0].views_per_day > 0);
  // exactly 3x counts ("at or above")
  const exact = [100, 100, 100, 100, 100, 100, 100, 100, 100, 300].map((v, i) => C.rowFromItem(item('b', i, v), NOW));
  assert.deepEqual(C.groupStats(exact, { now: NOW }).outliers.map((o) => o.views), [300]);
  // a sample of 9 is too small: no outliers, however big the gap
  const nine = [100, 100, 100, 100, 100, 100, 100, 100, 5000].map((v, i) => C.rowFromItem(item('c', i, v), NOW));
  const g9 = C.groupStats(nine, { now: NOW });
  assert.deepEqual([g9.enough, g9.outliers.length], [false, 0]);
  // shorts apart from long videos
  const mixed = [...rows, ...items('a', [9000], { duration: '0:30' }).map((i) => C.rowFromItem({ ...i, id: 'shortone' }, NOW))];
  const a = C.analyseChannel({ handle: 'a', tag: 'niche' }, mixed, { now: NOW });
  assert.deepEqual([a.long.n, a.shorts.n, a.long.outliers.length, a.shorts.enough], [12, 1, 2, false]);
});
await test('title patterns: length, number, question, how/why, split, topic words and pairs across channels', () => {
  assert.deepEqual(C.titleFeatures('Why the Moon is leaving us: 5 facts?'), { length: 36, number: true, question: true, howwhy: true, split: true });
  assert.equal(C.titleFeatures('How black holes work').howwhy, true);
  assert.equal(C.titleFeatures('Is it real').question, true);
  assert.equal(C.titleFeatures('Black holes - explained').split, true);
  assert.equal(C.titleFeatures('Black holes explained').split, false);
  assert.deepEqual(C.tokens("The Moon's secret!"), ["the", "moon's", 'secret']);
  const sh = C.featureShares(['Why one', 'How two', 'Plain three 3', 'Plain four']);
  assert.deepEqual([sh.n, sh.howwhy, sh.number], [4, 0.5, 0.25]);
  const topics = C.crossChannelTopics([
    { handle: 'a', outliers: [{ title: 'The black hole paradox', url: 'u1' }] },
    { handle: 'b', outliers: [{ title: 'Inside a black hole', url: 'u2' }, { title: 'Unrelated thing', url: 'u3' }] },
    { handle: 'c', outliers: [{ title: 'Cooking pasta', url: 'u4' }] },
  ]);
  assert.equal(topics[0].term, 'black hole');
  assert.deepEqual(topics[0].channels, ['a', 'b']);
  assert.ok(!topics.some((t) => t.term === 'pasta'));
  assert.ok(!topics.some((t) => t.term === 'black'), 'a word already inside a listed pair is not listed again');
});
await test('the report: ranking, per-channel outliers with channel and video, small samples named, ideas from the numbers, files written', async () => {
  const w = world({ key: false });
  addAll(w, '@alpha_ch', '@beta_ch', '@tiny_ch');
  const mk = (h, views, titles) => items(h, views).map((it, i) => C.rowFromItem({ ...it, title: titles?.[i] || it.title }, NOW));
  const T = ['Why the black hole paradox breaks physics', 'Why time is slower: the proof', 'How 7 rockets fly'];
  C.saveRows(w.dir, 'alpha_ch', mk('alpha_ch', [...VIEWS12.slice(0, 9), 900, 800, 700], [...Array(9).fill('Plain video title here'), ...T]));
  C.saveRows(w.dir, 'beta_ch', mk('beta_ch', [50, 55, 45, 50, 52, 48, 50, 51, 49, 500, 480, 47], [...Array(9).fill('Another plain one'), 'Inside a black hole: what we know', 'Why black holes evaporate', 'Another plain one']));
  C.saveRows(w.dir, 'tiny_ch', mk('tiny_ch', [10, 20, 9000]));
  const rep = C.makeReport(w.dir, NOW);
  assert.deepEqual(rep.ranking.map((r) => r.handle), ['alpha_ch', 'beta_ch', 'tiny_ch']);
  const alpha = rep.channels[0];
  assert.deepEqual(alpha.long.outliers.map((o) => o.views), [900, 800, 700]);
  assert.equal(rep.channels[2].long.outliers.length, 0);
  assert.ok(rep.caveats.some((c) => /@tiny_ch: only 3 long videos saved, too few/.test(c)));
  assert.equal(rep.patterns.enough, true);
  assert.ok(rep.patterns.outliers.howwhy > rep.patterns.others.howwhy);
  assert.ok(rep.topics.some((t) => t.term === 'black hole' && t.channels.length === 2));
  assert.ok(rep.suggestions.length >= 3 && rep.suggestions.length <= 5, `suggestions: ${rep.suggestions.length}`);
  assert.ok(rep.suggestions.some((s) => /"How" or "Why"/.test(s.idea) && /vs/.test(s.evidence)));
  assert.ok(rep.suggestions.every((s) => s.evidence.length > 10));
  const out = [];
  await C.cli(['report'], { cwd: w.dir, log: (l) => out.push(l), now: NOW });
  const md = read(C.paths(w.dir).md);
  assert.match(md, /Video \d+ of alpha_ch|Why the black hole paradox breaks physics/);
  assert.match(md, /\[Why the black hole paradox breaks physics\]\(https:\/\/www\.youtube\.com\/watch\?v=alpha_ch\d+\)/);
  assert.match(md, /approximate/i);
  assert.match(md, /a pattern, not proof/);
  assert.match(md, /Ideas to test in the next outline/);
  assert.ok(!md.includes(String.fromCharCode(0x2014)), 'no em dash');
  const j = JSON.parse(read(C.paths(w.dir).json));
  assert.equal(j.channels.length, 3);
  assert.ok(out.join('\n').includes('Written: brand/research/youtube/outliers.md'));
  const o2 = [];
  await C.cli(['outliers'], { cwd: w.dir, log: (l) => o2.push(l), now: NOW });
  assert.match(o2.join('\n'), /@alpha_ch .*Why the black hole paradox/);
  const none = world({ key: false });
  addAll(none, '@lonely');
  const r0 = C.makeReport(none.dir, NOW);
  assert.deepEqual([r0.suggestions.length, r0.ranking.length], [0, 0]);
  assert.match(C.renderMarkdown(r0), /No videos are saved yet/);
});

/* ── sync: the dry run and the refusals ─────────────────────────────────────────────────────────────────────────────── */
await test('sync dry run prints the cost and what would be sent, and sends nothing (no fetch call, no token read)', async () => {
  const w = world();
  addAll(w, '@alpha_ch', '@beta_ch');
  const f = stub(() => ok([]));
  const r = await C.sync(w.dir, w.cfg, { max: 25, shorts: true, maxCost: 1 }, w.io({ fetch: f }));
  assert.equal(f.calls.length, 0);
  assert.equal(r.dry, true);
  const t = w.log.join('\n');
  assert.match(t, /DRY RUN/);
  assert.match(t, /Estimated videos: 100/);
  assert.match(t, /about \$0\.40 \(100 videos x \$0\.004 a video; estimated, check your plan on apify\.com\)/);
  assert.match(t, /https:\/\/www\.youtube\.com\/@alpha_ch\/videos/);
  assert.match(t, /maxResults 25, maxResultsShorts 25, maxResultStreams 0/);
  assert.match(t, /streamers~youtube-scraper/);
  assert.match(t, /Nothing was sent, because --yes was not given/);
  assert.equal(fs.existsSync(C.paths(w.dir).spend), false);
  await C.sync(w.dir, w.cfg, { dryRun: true, yes: true }, w.io({ fetch: f }));
  assert.equal(f.calls.length, 0, '--dry-run wins over --yes');
  noToken(w);
  // the price and the actor come from brand.json
  const w2 = world({ brand: { research: { youtube: { actor: 'someone/other-actor', cost_per_video: 0.01 } } } });
  addAll(w2, '@alpha_ch');
  await C.sync(w2.dir, w2.cfg, { max: 10 }, w2.io({ fetch: f }));
  assert.match(w2.log.join('\n'), /about \$0\.10 \(10 videos x \$0\.010 a video/);
  assert.match(w2.log.join('\n'), /someone~other-actor/);
});
await test('sync refuses (and sends nothing) without the token, without autopilot.scrape, without --yes and over --max-cost', async () => {
  const f = stub(() => ok(items('alpha_ch', VIEWS12)));
  let w = world({ key: false });
  addAll(w, '@alpha_ch');
  let m = await sendFails(w, { yes: true, max: 20 }, w.io({ fetch: f }), /no token in ~\/\.config\/bagelunit-reels\/apify\.key \(the file is missing\)/i);
  assert.match(m, /video suggest apify/);
  w = world({ key: 'empty' });
  addAll(w, '@alpha_ch');
  await sendFails(w, { yes: true }, w.io({ fetch: f }), /file is empty/);
  w = world({ scrape: false });
  addAll(w, '@alpha_ch');
  await sendFails(w, { yes: true }, w.io({ fetch: f }), /autopilot\.scrape is not true/);
  w = world();
  addAll(w, '@alpha_ch', '@beta_ch');
  await sendFails(w, { yes: true, max: 150, maxCost: 1 }, w.io({ fetch: f }), /over --max-cost \$1\.00/);
  await sendFails(w, { yes: true, max: 20, maxCost: 0.05 }, w.io({ fetch: f }), /over --max-cost \$0\.05/);
  const none = world();
  await assert.rejects(() => C.sync(none.dir, none.cfg, { yes: true }, none.io({ fetch: f })), /No channels are tracked/);
  await assert.rejects(() => C.sync(w.dir, w.cfg, { yes: true, handle: 'ghost' }, w.io({ fetch: f })), /not tracked/);
  assert.equal(f.calls.length, 0);
  // no --yes: a dry run, still nothing sent, and it says what is missing
  w = world({ scrape: false, key: false });
  addAll(w, '@alpha_ch');
  const r = await C.sync(w.dir, w.cfg, {}, w.io({ fetch: f }));
  assert.equal(r.dry, true);
  assert.match(w.log.join('\n'), /MISSING/);
  assert.match(w.log.join('\n'), /OFF/);
  assert.equal(f.calls.length, 0);
  noToken(w);
});

/* ── sync: a stubbed read ────────────────────────────────────────────────────────────────────────────────────────────── */
await test('sync with a stubbed fetch: the documented output shape, an error item, a partial failure, data files, history, spend line', async () => {
  const w = world();
  addAll(w, '@alpha_ch', '@gone_ch', '@beta_ch', '@down_ch');
  const f = stub((url) => {
    if (url.includes('@alpha_ch')) return ok([...items('alpha_ch', VIEWS12), { url: 'https://www.youtube.com/@alpha_ch/videos', error: 'x', errorCode: 'NO_RESULTS' }]);
    if (url.includes('@gone_ch')) return ok([{ error: 'no such channel', errorCode: 'CHANNEL_DOES_NOT_EXIST', url: 'https://www.youtube.com/@gone_ch/videos' }]);
    if (url.includes('@down_ch')) return bad(500);
    return ok(items('beta_ch', VIEWS12.slice(0, 5)));
  });
  const r = await C.sync(w.dir, w.cfg, { yes: true, max: 12, maxCost: 1, saveRaw: true }, w.io({ fetch: f }));
  assert.equal(f.calls.length, 4);
  const c = f.calls[0];
  assert.equal(c.init.method, 'POST');
  assert.ok(c.url.startsWith('https://api.apify.com/v2/acts/streamers~youtube-scraper/run-sync-get-dataset-items?'));
  assert.ok(!c.url.includes(TOKEN) && !/token=/i.test(c.url), 'the token is never in the URL');
  assert.equal(c.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(c.body, { startUrls: [{ url: 'https://www.youtube.com/@alpha_ch/videos' }], maxResults: 12, maxResultsShorts: 0, maxResultStreams: 0, sortVideosBy: 'NEWEST' });
  assert.deepEqual(r.results.map((x) => [x.handle, x.ok]), [['alpha_ch', true], ['gone_ch', false], ['beta_ch', true], ['down_ch', false]]);
  const t = w.log.join('\n');
  assert.match(t, /@gone_ch: FAILED: that channel does not exist/);
  assert.match(t, /@down_ch: FAILED: Apify answered with an error \(HTTP 500\)/);
  assert.match(t, /@alpha_ch: 12 videos saved \(the scraper also said: the scraper found nothing/);
  assert.match(t, /Done: 17 videos read, about \$0\.068 \(estimated, check your plan on apify\.com\)/);
  const p = C.paths(w.dir);
  assert.equal(C.readRows(p.rows('alpha_ch')).length, 12);
  assert.equal(C.readRows(p.rows('beta_ch')).length, 5);
  assert.equal(fs.existsSync(p.rows('gone_ch')), false);
  const st = C.loadState(w.dir);
  const a = st.channels.find((x) => x.handle === 'alpha_ch');
  assert.deepEqual([a.name, a.subscribers, a.videos_read, a.source, a.pulled_at], ['alpha_ch Channel', 12500, 12, 'apify', NOW.toISOString()]);
  assert.equal(st.channels.find((x) => x.handle === 'gone_ch').pulled_at, null);
  const ch = JSON.parse(read(p.channels)).channels.alpha_ch;
  assert.deepEqual([ch.subscribers, ch.total_videos, ch.total_views], [12500, 120, 1710167563]);
  assert.deepEqual(read(p.history).trim().split('\n'), [C.HISTORY_HEADER, '2026-11-17,alpha_ch,12500,120,1710167563,apify', '2026-11-17,beta_ch,12500,120,1710167563,apify']);
  assert.ok(fs.existsSync(path.join(p.raw, 'alpha_ch-2026-11-17.json')));
  // the spend line, with its header, one row for the run
  const spend = read(p.spend).trim().split('\n');
  assert.equal(spend[0], 'date,service,channels,videos,estimated_usd,actor');
  assert.equal(spend.length, 2);
  assert.equal(spend[1], '2026-11-17,apify,alpha_ch+gone_ch+beta_ch+down_ch,17,0.068,streamers~youtube-scraper');
  assert.deepEqual(every(path.join(w.dir, 'brand')).filter((x) => x.includes('.tmp-')), []);
  for (const file of every(path.join(w.dir, 'brand', 'research'))) assert.ok(fs.statSync(file).size > 0, `${file} is empty`);
  noToken(w);
  // a second run the same day replaces that day's history line, appends a second spend line and keeps the rows
  w.log.length = 0;
  await C.sync(w.dir, w.cfg, { yes: true, max: 12, handle: 'alpha_ch' }, w.io({ fetch: f }));
  assert.equal(read(p.history).trim().split('\n').length, 3);
  assert.equal(read(p.spend).trim().split('\n').length, 3);
  assert.match(w.log.join('\n'), /Already logged in brand\/spend\.csv: about \$0\.068/);
  assert.equal(C.readRows(p.rows('alpha_ch')).length, 12);
  // shorts ask for shorts too
  await C.sync(w.dir, w.cfg, { yes: true, max: 5, shorts: true, handle: 'beta_ch' }, w.io({ fetch: f }));
  assert.deepEqual([f.calls.at(-1).body.maxResults, f.calls.at(-1).body.maxResultsShorts], [5, 5]);
  noToken(w);
});
await test('sync: 401, 402, 403, 429 and a timeout and a network error give plain messages, stop only when every channel would fail, and never show the token', async () => {
  const cases = [[401, /did not accept the token/, true], [402, /out of credit/, true], [403, /not allowed to run that actor/, false], [429, /too many requests/, true], [404, /does not know that actor/, false]];
  for (const [status, re, stops] of cases) {
    const w = world();
    addAll(w, '@alpha_ch', '@beta_ch');
    const f = stub(() => bad(status));
    const r = await C.sync(w.dir, w.cfg, { yes: true, max: 10 }, w.io({ fetch: f }));
    assert.match(r.results[0].why, re, String(status));
    assert.equal(f.calls.length, stops ? 1 : 2, `${status}: calls`);
    if (stops) assert.match(r.results[1].why, /not tried/);
    assert.equal(r.videos, 0);
    assert.ok(!/body|secret|bearer/i.test(w.log.join('\n')), 'the response body is never printed');
    noToken(w, [JSON.stringify(r)]);
  }
  let w = world();
  addAll(w, '@alpha_ch');
  let r = await C.sync(w.dir, w.cfg, { yes: true }, w.io({ fetch: async () => { throw Object.assign(new Error(`boom ${TOKEN} boom`), { name: 'FetchError' }); } }));
  assert.match(r.results[0].why, /could not reach Apify \(boom \[token hidden\] boom\)/);
  noToken(w, [JSON.stringify(r)]);
  w = world();
  addAll(w, '@alpha_ch');
  r = await C.sync(w.dir, w.cfg, { yes: true }, w.io({ fetch: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }, timeoutMs: 1234 }));
  assert.match(r.results[0].why, /did not answer within 1 seconds/);
  r = await C.sync(w.dir, w.cfg, { yes: true }, w.io({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ not: 'a list' }) }) }));
  assert.match(r.results[0].why, /not a list of videos/);
  // a real AbortSignal timeout: a fetch that never answers is given up on
  w = world();
  addAll(w, '@alpha_ch');
  const keep = setInterval(() => {}, 50);   // AbortSignal.timeout does not keep the process alive by itself; a real fetch does
  r = await C.sync(w.dir, w.cfg, { yes: true }, w.io({ timeoutMs: 30, fetch: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))) }));
  clearInterval(keep);
  assert.match(r.results[0].why, /did not answer within/);
  // a token file with other text in it is refused, without showing the file
  w = world();
  write(w.keyFile, 'two words here\n');
  addAll(w, '@alpha_ch');
  await sendFails(w, { yes: true }, w.io({ fetch: stub(() => ok([])) }), /have something other than the token|has something other than the token/);
});
await test('the token never appears in any output, file or message of a whole add, sync, report run through the command line', async () => {
  const w = world();
  const out = [];
  const run = async (...a) => { try { await C.cli(a, { cwd: w.dir, log: (l) => out.push(l), now: NOW, keyFile: w.keyFile, pauseMs: 0, fetch: stub((url) => (url.includes('@a_chan') ? ok(items('a_chan', VIEWS12)) : bad(401))) }); } catch (e) { out.push(`ERR ${e.message}`); } };
  await run('add', '@a_chan'); await run('add', '@b_chan');
  await run('sync', '--yes', '--max', '12');
  await run('sync', '--dry-run');
  await run('report'); await run('list'); await run('outliers');
  assert.ok(out.length > 10);
  w.log.push(...out);
  noToken(w);
  // the engine's own subprocess output (a dry run only: a test never reads for real)
  const r = spawnSync(process.execPath, [VIDEO, 'competitors', 'sync', '--dry-run'], { cwd: w.dir, encoding: 'utf8', env: { ...process.env, HOME: w.home, USERPROFILE: w.home, BAGELUNIT_NO_TIPS: '1' } });
  assert.equal(r.status, 0);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
});

/* ── the command line, update and the dashboard ─────────────────────────────────────────────────────────────────────── */
await test('video competitors through the engine: usage, add, list and sync dry run in a subprocess (no network)', () => {
  const w = world({ scrape: false, key: false });
  const env = { ...process.env, HOME: w.home, USERPROFILE: w.home, BAGELUNIT_NO_TIPS: '1' };
  const v = (...a) => spawnSync(process.execPath, [VIDEO, 'competitors', ...a], { cwd: w.dir, encoding: 'utf8', env });
  assert.match(v().stdout, /video competitors: track other YouTube channels/);
  assert.equal(v('add', '@alpha_ch', '--tag', 'adjacent').status, 0);
  assert.match(v('list').stdout, /@alpha_ch\s+adjacent/);
  const d = v('sync', '--yes', '--max', '10');
  assert.equal(d.status, 1);
  assert.match(d.stderr, /autopilot\.scrape is not true/);
  const dry = v('sync', '--dry-run', '--max', '10');
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /about \$0\.040 \(10 videos x \$0\.004/);
  assert.equal(v('add', 'nonsense link here').status, 1);
});
await test('the channel template has autopilot.scrape false with a note, and `video update` adds it to an older channel folder', () => {
  const tpl = JSON.parse(read(path.join(REPO, 'template', 'brand', 'brand.json')));
  assert.equal(tpl.autopilot.scrape, false);
  assert.ok(tpl.autopilot._note.length > 20);
  assert.equal(tpl.research.youtube.actor, 'streamers~youtube-scraper');
  assert.equal(tpl.research.youtube.cost_per_video, 0.004);
  assert.match(read(path.join(REPO, 'template', '.gitignore')), /^brand\/research\/youtube\/raw\/$/m);
  const old = tmp();
  write(path.join(old, 'brand', 'brand.json'), JSON.stringify({ name: 'Old Channel', slug: 'old', niche: { topic: 'x' }, autopilot: undefined }));
  fs.copyFileSync(path.join(REPO, 'template', '.gitignore'), path.join(old, '.gitignore'));
  const plan = U.planTemplate(REPO, old);
  assert.ok(plan.settings.includes('autopilot') || plan.settings.includes('autopilot.scrape'), `settings: ${plan.settings}`);
  U.applyTemplate(REPO, old, plan, '20261117-000000');
  const after = JSON.parse(read(path.join(old, 'brand', 'brand.json')));
  assert.equal(after.autopilot.scrape, false);
  assert.equal(after.name, 'Old Channel');
  assert.ok(fs.existsSync(path.join(old, '.claude', 'skills', 'competitors', 'SKILL.md')));
  // an owner who already turned it on keeps it on
  const on = tmp();
  write(path.join(on, 'brand', 'brand.json'), JSON.stringify({ name: 'On', slug: 'on', autopilot: { scrape: true } }));
  U.applyTemplate(REPO, on, U.planTemplate(REPO, on), '20261117-000001');
  assert.equal(JSON.parse(read(path.join(on, 'brand', 'brand.json'))).autopilot.scrape, true);
});
await test('the dashboard card: shown only when competitors.json exists, top 3 outliers, last pull, a link, no network', async () => {
  const { load } = await import(pathToFileURL(path.join(REPO, 'studio', 'dashboard', 'model.mjs')).href);
  const { html } = await import(pathToFileURL(path.join(REPO, 'studio', 'dashboard', 'page.mjs')).href);
  const w = world({ key: false });
  const videos = path.join(w.dir, 'videos');
  fs.mkdirSync(videos, { recursive: true });
  const before = html(load(videos, { pageDir: videos }));
  assert.ok(!before.includes('id="competitors"'));
  addAll(w, '@alpha_ch');
  const views = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 500, 450, 400, 350];
  C.saveRows(w.dir, 'alpha_ch', items('alpha_ch', views).map((i, k) => C.rowFromItem({ ...i, title: k === 10 ? 'The <b>big</b> one' : i.title, url: k === 11 ? 'javascript:alert(1)' : i.url }, NOW)));
  C.saveState(w.dir, { ...C.loadState(w.dir), channels: C.loadState(w.dir).channels.map((c) => ({ ...c, pulled_at: NOW.toISOString(), source: 'import' })) });
  let page = html(load(videos, { pageDir: videos }));
  assert.ok(page.includes('id="competitors"'));
  assert.match(page, /1 channel tracked · last pull 2026-11-17/);
  assert.match(page, /5\.0x median/);
  assert.ok(page.includes('The &lt;b&gt;big&lt;/b&gt; one'), 'titles are escaped');
  assert.ok(!page.includes('javascript:alert'), 'only web links are linked');
  assert.equal((page.match(/x median<\/span>/g) || []).length, 3, 'the top three');
  assert.match(page, /Run <code>video competitors report<\/code>/);
  await C.cli(['report'], { cwd: w.dir, log() {}, now: NOW });
  page = html(load(videos, { pageDir: videos }));
  assert.match(page, /href="\.\.\/brand\/research\/youtube\/outliers\.md"/);
  assert.ok(!/https?:\/\/[^"' )]*apify/i.test(page));
});
await test('the repo documents it: the skill, the table row, COMMANDS.md, SKILL.md, the suggestion, no em dashes in the new files', () => {
  const skill = read(path.join(REPO, 'template', '.claude', 'skills', 'competitors', 'SKILL.md'));
  assert.match(skill, /^name: competitors$/m);
  assert.match(skill, /Trigger:/);
  assert.match(skill, /AskUserQuestion/);
  assert.match(skill, /Apify bills you|Apify bills the owner/);
  assert.match(skill, /video suggest apify/);
  assert.match(read(path.join(REPO, 'template', 'CLAUDE.md')), /`\/competitors/);
  const cmds = read(path.join(REPO, 'COMMANDS.md'));
  for (const verb of ['competitors add', 'competitors remove', 'competitors list', 'competitors sync', 'competitors import', 'competitors report', 'competitors outliers', '/competitors']) assert.ok(cmds.includes(verb), `COMMANDS.md lacks ${verb}`);
  assert.match(read(path.join(REPO, 'studio', 'SKILL.md')), /## Competitors/);
  const sug = JSON.parse(read(path.join(REPO, 'studio', 'suggestions.json')));
  const apify = sug.categories.flatMap((c) => c.tools).find((t) => t.id === 'apify');
  assert.match(apify.what_you_get, /video competitors/);
  assert.ok(!/will build on|builds on it/.test(apify.what_you_get));
  const EM = String.fromCharCode(0x2014);
  for (const f of ['template/.claude/skills/competitors/SKILL.md', 'studio/tools/competitors.mjs', 'setup/test-competitors.mjs']) assert.ok(!read(path.join(REPO, f)).includes(EM), `${f} has an em dash`);
});

console.log(`\n${n} passed`);
