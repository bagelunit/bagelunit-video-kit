#!/usr/bin/env node
// Tests for the quality tools: the pace check, the captions reading speed check, the mix check, the thumbnail check, the A/B
// winner rule and the chapter music plan (studio/tools/pacecheck.mjs, captionscheck.mjs, mixcheck.py, thumbcheck.py, abtest.py,
// musicplan.mjs) and the music-plan starter. Each tool gets a good and a bad fixture, run the way a person runs it (the command line:
// exit code and printed lines). Fixtures are made here; nothing is downloaded. Parts that need ffmpeg, Python or numpy say SKIPPED
// and pass without them. Run: node setup/test-quality.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const DASH = String.fromCharCode(0x2014);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(REPO, 'studio', 'tools');
let n = 0, skipped = 0;
const test = async (name, fn) => { try { const r = await fn(); if (r === 'SKIP') { skipped++; console.log(`SKIPPED ${name}`); } else { n++; console.log(`ok   ${name}`); } } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'video-quality-test-'));
const write = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const json = (f, v) => write(f, JSON.stringify(v));

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const python = ['python3', 'python', 'py'].map((c) => [c, c === 'py' ? ['-3'] : []]).find(([c, pre]) => { const r = spawnSync(c, [...pre, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' }); return r.status === 0 && r.stdout.trim() === '3'; });
const hasNumpy = python ? spawnSync(python[0], [...python[1], '-c', 'import numpy'], { encoding: 'utf8' }).status === 0 : false;
const py = (script, args) => spawnSync(python[0], [...python[1], path.join(TOOLS, script), ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
const node = (script, args) => spawnSync(process.execPath, [path.join(TOOLS, script), ...args], { encoding: 'utf8' });
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };

// a video folder: scenes (template, seconds, chapter) with the clock written the way the kit writes build/scene_times.json
const videoFolder = (list, cfg = { style: 'comic' }) => {
  const d = tmp(); let t = 0; const times = [];
  json(path.join(d, 'video.json'), cfg);
  json(path.join(d, 'scenes.json'), { scenes: list.map(([template, , chapter, extra], i) => ({ id: `s${i + 1}`, template, ...(chapter ? { chapter } : {}), props: {}, narration: 'x', ...(extra || {}) })) });
  for (const [, len] of list) { times.push({ n: times.length + 1, t0: t, t1: t + len }); t += len; }
  json(path.join(d, 'build', 'scene_times.json'), times);
  return d;
};
const T = ['quote', 'chart', 'map', 'list'];
const varied = (count, len) => Array.from({ length: count }, (_, i) => [T[i % 4], len, i % 8 === 0 ? `Part ${i / 8 + 1}` : null]);

/* ── pacecheck.mjs ─────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('pacecheck: selftest', () => { const r = node('pacecheck.mjs', ['--selftest']); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /selftest: OK/); });
await test('pacecheck: a varied 5 s plan passes (exit 0) and writes build/pace.json', () => {
  const d = videoFolder(varied(24, 5)); const r = node('pacecheck.mjs', [d]);
  assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /PASS\s+average/); assert.ok(fs.existsSync(path.join(d, 'build', 'pace.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'build', 'pace.json'), 'utf8')).stats.scenes, 24);
});
await test('pacecheck: a 13 s scene, a template five times in a row and a thin chapter fail or warn (exit 1)', () => {
  const d = videoFolder([['quote', 5, 'One'], ['quote', 5], ['quote', 5], ['quote', 5], ['quote', 5], ['chart', 13, 'Two'], ['map', 5]]);
  const r = node('pacecheck.mjs', [d]); assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+no change/); assert.match(r.stdout, /FAIL\s+same template/); assert.match(r.stdout, /WARN\s+chapter variety/);
});
await test('pacecheck: a calm style (deep-zoom) keeps its own pace; CRLF in the JSON is fine', () => {
  const d = videoFolder([['a', 10, 'One'], ['b', 9], ['a', 11, 'Two'], ['b', 10]], { style: 'deep-zoom' });
  for (const f of ['scenes.json', 'video.json', path.join('build', 'scene_times.json')]) { const p = path.join(d, f); fs.writeFileSync(p, '﻿' + fs.readFileSync(p, 'utf8').replace(/,/g, ',\r\n')); }
  const r = node('pacecheck.mjs', [d]); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /calm style/);
});
await test('pacecheck: no clock yet exits 2 and says what to run', () => {
  const d = videoFolder(varied(4, 5)); fs.rmSync(path.join(d, 'build'), { recursive: true });
  const r = node('pacecheck.mjs', [d]); assert.equal(r.status, 2); assert.match(r.stdout, /video check|video render/);
});

/* ── captionscheck.mjs ─────────────────────────────────────────────────────────────────────────────────────────────── */
await test('captionscheck: selftest', () => { const r = node('captionscheck.mjs', ['--selftest']); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /selftest: OK/); });
await test('captionscheck: a calm SRT passes; a fast, a long-line and a three-line caption fail (exit 1) with times', () => {
  const d = tmp();
  write(path.join(d, 'good.srt'), '1\r\n00:00:00,000 --> 00:00:03,000\r\nThe city drank a billion\r\nliters a day.\r\n\r\n2\r\n00:00:03,500 --> 00:00:06,500\r\nThen the pumps failed.\r\n');
  let r = node('captionscheck.mjs', [path.join(d, 'good.srt')]); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /PASS\s+fast/);
  write(path.join(d, 'bad.srt'), '1\n00:00:00,000 --> 00:00:02,000\nThis caption has far too many letters for the time\nit stays up.\n\n2\n00:00:05,000 --> 00:00:15,000\n' + 'x'.repeat(50) + '\n\n3\n00:00:20,000 --> 00:00:30,000\na b\nc d\ne f\n');
  r = node('captionscheck.mjs', [path.join(d, 'bad.srt')]); assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAST.*caption 1 at 0:00\.0/); assert.match(r.stdout, /LONG.*caption 2 at 0:05\.0.*50 characters/); assert.match(r.stdout, /LONG.*caption 3 at 0:20\.0.*3 lines/);
});
await test('captionscheck: a short flash of 3 words is a WARN, not a failure; a VTT file is read', () => {
  const d = tmp();
  write(path.join(d, 'short.vtt'), 'WEBVTT\r\n\r\n00:00.000 --> 00:00.800\r\nOne two three\r\n');
  const r = node('captionscheck.mjs', [path.join(d, 'short.vtt')]); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /WARN\s+SHORT/);
});
await test('captionscheck: from build/words.json (the kit\'s own grouping): calm speech passes, rushed speech fails; --words beats an existing srt', () => {
  const d = tmp(); const sentence = 'Water covers most of the planet but almost none of it is safe to drink. Only a tiny share is fresh.'.split(' ');
  const words = (step) => sentence.map((w, i) => ({ w, s: +(i * step).toFixed(3), e: +(i * step + step * 0.85).toFixed(3) }));
  json(path.join(d, 'build', 'words.json'), words(0.35));
  let r = node('captionscheck.mjs', [d]); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /build\/words\.json/);
  json(path.join(d, 'build', 'words.json'), words(0.12));
  r = node('captionscheck.mjs', [d]); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /FAST/);
  write(path.join(d, 'out', 'captions.en.srt'), '1\n00:00:00,000 --> 00:00:04,000\nA slow caption.\n');
  r = node('captionscheck.mjs', [d]); assert.equal(r.status, 0); assert.match(r.stdout, /out\/captions\.en\.srt/);
  r = node('captionscheck.mjs', [d, '--words']); assert.equal(r.status, 1);
});
await test('captionscheck: a missing file exits 2', () => { const r = node('captionscheck.mjs', [path.join(tmp(), 'nope.srt')]); assert.equal(r.status, 2); });

/* ── musicplan.mjs ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const channelVideo = ({ outline, music, assets = [{ id: 'calm-bed', type: 'music' }, { id: 'drive', type: 'music' }] }) => {
  const c = tmp(); const v = path.join(c, 'videos', 'ice');
  json(path.join(c, 'brand', 'brand.json'), { name: 'Quark Street', slug: 'quark-street' });
  json(path.join(c, 'brand', 'licensed', 'assets.json'), { assets });
  const list = Array.from({ length: 9 }, (_, i) => ({ id: `s${i + 1}`, template: 'quote', ...(i % 3 === 0 ? { chapter: ['Hook', 'Middle', 'Payoff'][i / 3] } : {}) }));
  json(path.join(v, 'scenes.json'), { scenes: list });
  json(path.join(v, 'build', 'scene_times.json'), list.map((_, i) => ({ t0: i * 10, t1: i * 10 + 10 })));
  json(path.join(v, 'video.json'), { style: 'comic', music });
  write(path.join(v, 'outline.md'), outline);
  return v;
};
const PLAN = '# Outline\n\n## Music plan\n\n| Chapter | Mood | Tempo | Energy | Asset |\n|---|---|---|---|---|\n| Hook | curious | slow | start low | calm-bed |\n| Middle | tense | medium | builds | drive |\n| Payoff | warm | slow | resolves | calm-bed |\n';
await test('musicplan: selftest', () => { const r = node('musicplan.mjs', ['--selftest']); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /selftest: OK/); });
await test('musicplan: a plan that matches video.json passes (exit 0)', () => {
  const v = channelVideo({ outline: PLAN, music: [{ asset: 'calm-bed', from: 's1' }, { asset: 'drive', from: 's4', fade: 2 }, { asset: 'calm-bed', from: 's7', fade: 3 }] });
  const r = node('musicplan.mjs', [v]); assert.equal(r.status, 0, r.stdout); assert.ok(!/FAIL|WARN/.test(r.stdout), r.stdout);
});
await test('musicplan: a missing chapter entry, an unregistered asset, a mid-chapter entry and a hard mood cut are all reported', () => {
  const v = channelVideo({ outline: PLAN, music: [{ asset: 'calm-bed', from: 's1' }, { asset: 'ghost', from: 's5', fade: 0.2 }] });
  const r = node('musicplan.mjs', [v]); assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+register.*ghost/); assert.match(r.stdout, /FAIL\s+plan built.*Payoff/); assert.match(r.stdout, /WARN\s+entry starts.*s5/); assert.match(r.stdout, /WARN\s+mood.*Middle/);
  const w = channelVideo({ outline: PLAN, music: [{ asset: 'calm-bed', from: 's1' }, { asset: 'drive', from: 's4', fade: 0.3 }, { asset: 'calm-bed', from: 's7' }] });
  const r2 = node('musicplan.mjs', [w]); assert.equal(r2.status, 0, r2.stdout); assert.match(r2.stdout, /WARN\s+crossfade.*0\.3 s/);
});
await test('musicplan: no outline table is a WARN naming the starter; no scenes exits 2', () => {
  const v = channelVideo({ outline: '# Outline\n', music: [{ asset: 'calm-bed', from: 's1' }] });
  const r = node('musicplan.mjs', [v]); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /WARN\s+plan.*brand\/music-plan\.md/);
  fs.rmSync(path.join(v, 'scenes.json')); assert.equal(node('musicplan.mjs', [v]).status, 2);
});
await test('the music-plan starter ships in template/brand, its table parses to no rows, and it has no em dash', async () => {
  const f = path.join(REPO, 'template', 'brand', 'music-plan.md'); const text = fs.readFileSync(f, 'utf8');
  assert.ok(!text.includes(DASH), 'no em dash'); assert.match(text, /Music plan/); assert.match(text, /\| Chapter \| Mood \| Tempo \| Energy \| Asset \|/);
  const { parsePlan } = await import(pathToFileURL(path.join(TOOLS, 'musicplan.mjs')).href);
  const block = text.split('```')[1]; const plan = parsePlan(block);
  assert.ok(plan && plan.hasAsset && plan.rows.length === 0, 'the placeholder row is not counted');
});

/* ── abtest.py ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const noPython = !python;
await test('abtest: selftest', () => { if (noPython) return 'SKIP'; const r = py('abtest.py', ['--selftest']); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /selftest: OK/); });
await test('abtest: a clear winner is called, a near-tie is not, too few impressions never is', () => {
  if (noPython) return 'SKIP';
  let r = py('abtest.py', ['--a', '900', '10000', '--b', '600', '10000', '--json']); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).verdict, 'A wins');
  r = py('abtest.py', ['--a', '550', '10000', '--b', '500', '10000', '--json']); let o = JSON.parse(r.stdout); assert.equal(o.verdict, 'keep testing'); assert.ok(o.more_impressions_each > 0);
  r = py('abtest.py', ['--a', '300', '800', '--b', '50', '800', '--json']); o = JSON.parse(r.stdout); assert.equal(o.verdict, 'keep testing'); assert.equal(o.more_impressions_each, 200);
  r = py('abtest.py', ['--a', '500', '10000', '--b', '500', '10000', '--json']); assert.equal(JSON.parse(r.stdout).verdict, 'no real difference');
});
await test('abtest: three variants are compared pairwise against the best; bad numbers exit 2', () => {
  if (noPython) return 'SKIP';
  let r = py('abtest.py', ['--a', '900', '10000', '--b', '600', '10000', '--c', '610', '10000', '--json']); let o = JSON.parse(r.stdout); assert.equal(o.verdict, 'A wins'); assert.equal(o.pairs.length, 2);
  r = py('abtest.py', ['--a', '900', '10000', '--b', '600', '10000', '--c', '880', '10000', '--json']); o = JSON.parse(r.stdout); assert.equal(o.verdict, 'keep testing');
  r = py('abtest.py', ['--a', '11', '10', '--b', '1', '10']); assert.equal(r.status, 2);
});

/* ── mixcheck.py ───────────────────────────────────────────────────────────────────────────────────────────────────── */
const skipMedia = () => (!python || !hasFfmpeg ? 'SKIP' : null);
await test('mixcheck: selftest', () => { if (skipMedia()) return 'SKIP'; const r = py('mixcheck.py', ['--selftest']); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /selftest: OK/); });
await test('mixcheck: a well-leveled file passes; a hot, clipped file fails (exit 1); mix.json is written', () => {
  if (skipMedia()) return 'SKIP';
  const d = tmp(), good = path.join(d, 'out', 'video.mp4'); fs.mkdirSync(path.dirname(good), { recursive: true });
  ff(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=10', '-af', 'loudnorm=I=-14:TP=-2:LRA=7', '-c:a', 'aac', good]);
  let r = py('mixcheck.py', [d]); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /(PASS|WARN)\s+loudness/);
  const mix = JSON.parse(fs.readFileSync(path.join(d, 'build', 'mix.json'), 'utf8')); assert.ok(mix.checks.find((c) => c.check === 'loudness'));
  const hot = path.join(d, 'hot.mp4');
  ff(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=6', '-af', 'volume=30dB,alimiter=limit=1:level=disabled', '-c:a', 'aac', hot]);
  r = py('mixcheck.py', [hot]); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /FAIL\s+loudness/);
  assert.ok(fs.existsSync(path.join(d, 'hot.mix.json')));
});
await test('mixcheck: a long silent gap warns; a chapter far from the average is flagged; a bed under the voice is checked', () => {
  if (skipMedia()) return 'SKIP';
  const d = tmp(); fs.mkdirSync(path.join(d, 'out'), { recursive: true }); fs.mkdirSync(path.join(d, 'build'));
  write(path.join(d, 'out', 'chapters.txt'), '0:00 One\r\n0:08 Two\r\n0:16 Three\r\n');
  ff(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=350:sample_rate=48000:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=48000:duration=8',
    '-filter_complex', '[0:a]volume=-10dB[a1];[1:a]volume=-10dB[a2];[2:a]volume=-24dB[a3];[a1][a2][a3]concat=n=3:v=0:a=1[a]', '-map', '[a]', '-c:a', 'aac', path.join(d, 'out', 'video.mp4')]);
  let r = py('mixcheck.py', [d]); assert.match(r.stdout, /(WARN|FAIL)\s+chapters.*Three/, r.stdout);
  const g = tmp(); fs.mkdirSync(path.join(g, 'out'), { recursive: true });
  ff(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-filter_complex', '[0:a]volume=-8dB[x];[1:a]atrim=0:4,asetpts=N/SR/TB[s];[0:a]volume=-8dB[y];[x][s][y]concat=n=3:v=0:a=1[a]', '-map', '[a]', '-c:a', 'aac', path.join(g, 'out', 'video.mp4')]);
  r = py('mixcheck.py', [g]); assert.match(r.stdout, /WARN\s+silence.*gap/, r.stdout);
  // ducking: voice words 0-3 s at -10 dB, then a bed at -40 dB, with "music" in video.json
  const k = tmp(); fs.mkdirSync(path.join(k, 'out'), { recursive: true }); json(path.join(k, 'video.json'), { music: [{ asset: 'x' }] }); json(path.join(k, 'build', 'words.json'), [{ w: 'a', s: 0, e: 3 }]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=3', '-filter_complex', '[0:a]volume=-10dB[v];[1:a]volume=-40dB[b];[v][b]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'aac', path.join(k, 'out', 'video.mp4')]);
  r = py('mixcheck.py', [k]); assert.match(r.stdout, /PASS\s+ducking/, r.stdout);
  write(path.join(k, 'video.json'), '{"music": "bed.mp3"}'); fs.rmSync(path.join(k, 'build', 'words.json'));
  r = py('mixcheck.py', [k]); assert.match(r.stdout, /SKIPPED\s+ducking/);
});
await test('mixcheck: no video exits 2', () => { if (!python) return 'SKIP'; const r = py('mixcheck.py', [tmp()]); assert.equal(r.status, 2); });

/* ── thumbcheck.py ─────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('thumbcheck: selftest', () => { if (skipMedia()) return 'SKIP'; const r = py('thumbcheck.py', ['--selftest']); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /selftest: (OK|SKIPPED)/); });
await test('thumbcheck: a good thumbnail passes, text under the duration badge, near-black, wrong shape and no text fail (exit 1)', () => {
  if (skipMedia() || !hasNumpy) return 'SKIP';
  const d = tmp(); const good = path.join(d, 'out', 'thumbnail.jpg'); fs.mkdirSync(path.dirname(good), { recursive: true });
  ff(['-f', 'lavfi', '-i', 'color=c=0x1e3c82:s=1280x720', '-vf', 'drawbox=x=120:y=250:w=780:h=120:color=white:t=fill', '-frames:v', '1', good]);
  const L = (o) => { const f = path.join(d, 'lines.json'); json(f, [{ text: 'WHY ICE FLOATS', x: 120, y: 250, w: 780, h: 120, conf: 0.9, ...o }]); return f; };
  let r = py('thumbcheck.py', [d, '--lines', L({})]); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /PASS\s+SIZE 1280x720/); assert.match(r.stdout, /THUMBNAIL OK/);
  r = py('thumbcheck.py', [d, '--lines', L({ x: 900, y: 600, w: 330, h: 100 })]); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /FAIL\s+SAFE.*duration badge/);
  r = py('thumbcheck.py', [d, '--lines', L({ x: 10 })]); assert.equal(r.status, 1); assert.match(r.stdout, /FAIL\s+SAFE.*margin/);
  r = py('thumbcheck.py', [d, '--lines', L({ h: 40 })]); assert.equal(r.status, 1); assert.match(r.stdout, /FAIL\s+TEXT.*40 px/);
  const noText = path.join(d, 'none.json'); json(noText, []); r = py('thumbcheck.py', [good, '--lines', noText]); assert.equal(r.status, 1); assert.match(r.stdout, /FAIL\s+TEXT no text/);
  const dark = path.join(d, 'dark.jpg'); ff(['-f', 'lavfi', '-i', 'color=c=0x080808:s=1280x720', '-frames:v', '1', dark]);
  r = py('thumbcheck.py', [dark, '--lines', L({})]); assert.equal(r.status, 1); assert.match(r.stdout, /FAIL\s+LIGHT near-black/);
  const tall = path.join(d, 'tall.jpg'); ff(['-f', 'lavfi', '-i', 'color=c=0x1e3c82:s=1080x1920', '-frames:v', '1', tall]);
  r = py('thumbcheck.py', [tall, '--lines', L({})]); assert.equal(r.status, 1); assert.match(r.stdout, /FAIL\s+SIZE 1080x1920/);
});
await test('thumbcheck: a text-like block of low contrast fails the shrunk-size check; with no reader the estimate never FAILs on text; a missing file exits 2', () => {
  if (skipMedia() || !hasNumpy) return 'SKIP';
  const d = tmp(); const f = path.join(d, 'flat.jpg'); ff(['-f', 'lavfi', '-i', 'color=c=0x808080:s=1280x720', '-frames:v', '1', f]);
  const lines = path.join(d, 'l.json'); json(lines, [{ text: 'WHY ICE FLOATS', x: 120, y: 250, w: 780, h: 120, conf: 0.9 }]);
  let r = py('thumbcheck.py', [f, '--lines', lines]); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /FAIL\s+SMALL.*1\.0:1/);
  r = py('thumbcheck.py', [f, '--no-ocr']); assert.ok(!/FAIL\s+(TEXT|SAFE|SMALL)/.test(r.stdout), r.stdout); assert.match(r.stdout, /estimated/);
  assert.equal(py('thumbcheck.py', [path.join(d, 'nope.jpg')]).status, 2);
});

/* ── the kit's own rules ───────────────────────────────────────────────────────────────────────────────────────────── */
await test('the quality tools hold no em dash and no key or token', () => {
  for (const f of ['pacecheck.mjs', 'captionscheck.mjs', 'mixcheck.py', 'thumbcheck.py', 'abtest.py', 'musicplan.mjs', path.join('..', '..', 'setup', 'test-quality.mjs')]) {
    const text = fs.readFileSync(path.join(TOOLS, f), 'utf8'); assert.ok(!text.includes(DASH), `${f} has an em dash`);
    assert.ok(!/(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})/.test(text), `${f} looks like it holds a key`);
  }
});

console.log(`\n${n} passed${skipped ? `, ${skipped} skipped (needs ffmpeg, Python or numpy)` : ''}`);
if (process.exitCode) console.error('some tests failed');
