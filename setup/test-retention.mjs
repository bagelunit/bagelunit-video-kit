#!/usr/bin/env node
// Tests for the retention review (studio/tools/retention.mjs and its section in studio/tools/review.mjs) with synthetic CSVs: the
// formats YouTube writes (percent or time position, a share or a watch ratio), resampling, the steepest falls, the first 30 seconds,
// average view duration against length, the scene and chapter of each fall, hypotheses labelled as not proven, 1 to 3 tests, and the
// plain statements when data is missing or the sample is under 5 videos. No network, no ffmpeg, no browser.
// Run: node setup/test-retention.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ret from '../studio/tools/retention.mjs';
import * as R from '../studio/tools/review.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'video-retention-test-'));
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const write = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const near = (a, b, tol = 0.01, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not near ${b}`);

// a synthetic 120 s curve on a percent axis: 100 to 70 at 0:30 (25%), a slow slide to 60 at 1:00, a steep fall of 10 points just after, then gentle
const keepAtP = (p) => (p <= 25 ? 100 - 1.2 * p : p <= 50 ? 70 - 0.4 * (p - 25) : p <= 58 ? 60 - 2.5 * (p - 50) : 40 - 0.25 * (p - 58));
const percentCsv = (header = 'Video position (%),Absolute audience retention (%),Relative retention performance') => `${header}\n${Array.from({ length: 101 }, (_, p) => `${p},${keepAtP(p).toFixed(2)},0.5`).join('\n')}\n`;
const rowsOf = (csv) => R.parseCsv(csv);

// a channel folder with one video that has scenes, times and chapters
const channel = (names = ['moon']) => {
  const ch = tmp();
  write(path.join(ch, 'brand', 'brand.json'), JSON.stringify({ name: 'Space Facts', slug: 'space' }));
  names.forEach((name, i) => {
    const d = path.join(ch, 'videos', name);
    write(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes', title: name }));
    write(path.join(d, 'out', 'youtube-published.json'), JSON.stringify({ id: `AAAAAAAAAA${i}`, at: '2026-10-01T10:00:00Z' }));
    write(path.join(d, 'scenes.json'), JSON.stringify({ scenes: [
      { id: 'hook', template: 'big-statement', narration: 'The Moon is not what you think.', chapter: 'Intro' },
      { template: 'bars', narration: 'Here is the size.' }, { template: 'bars', narration: 'Here is the distance.' },
      { id: 'claim', template: 'quote', narration: 'The claim itself, in full, with the part nobody expected.', chapter: 'The big claim' },
      { template: 'bars', narration: 'The proof.' }, { template: 'big-statement', narration: 'So that is the Moon.' }] }));
    write(path.join(d, 'build', 'scene_times.json'), JSON.stringify([0, 1, 2, 3, 4, 5].map((k) => ({ n: k + 1, t0: k * 20, t1: (k + 1) * 20, source: 'words' }))));
    write(path.join(d, 'out', 'chapters.txt'), '0:00 Intro\n1:00 The big claim\n');
  });
  return ch;
};
const TABLE = (id = 'AAAAAAAAAA0') => `Content,Video title,Video publish time,Duration,Views,Average view duration,Average percentage viewed (%)\n${id},The Moon,"Oct 1, 2026",120,5000,0:00:54,45.0\n`;

await test('formats: percent position, time position (seconds and m:ss), a watch ratio, and the relative column is never used as the share', () => {
  const head = (csv) => rowsOf(csv)[0], body = (csv) => rowsOf(csv).slice(1);
  let c = ret.parseRows(head(percentCsv()), body(percentCsv()));
  assert.equal(c.unit, '%'); assert.equal(c.points.length, 101); assert.equal(c.keepColumn, 'Absolute audience retention (%)'); near(c.points[25].keep, 70);
  const secCsv = 'Video position (seconds),Absolute audience retention (%)\n0,100\n30,70\n60,60\n120,30\n';
  c = ret.parseRows(head(secCsv), body(secCsv)); assert.equal(c.unit, 's'); assert.equal(c.points[1].at, 30);
  const clock = 'Elapsed video time,Audience retention\n0:00,100%\n0:30,70%\n1:00,60%\n2:00,30%\n';
  c = ret.parseRows(head(clock), body(clock)); assert.equal(c.unit, 's'); assert.equal(c.points[3].at, 120); assert.equal(c.points[1].keep, 70);
  const ratio = 'Elapsed video time ratio,Audience watch ratio,Relative retention performance\n0,1,0.5\n0.25,0.7,0.5\n0.5,0.6,0.5\n1,0.3,0.5\n';
  c = ret.parseRows(head(ratio), body(ratio)); assert.equal(c.unit, '%'); assert.equal(c.points[1].at, 25); near(c.points[1].keep, 70); assert.equal(c.keepIsRatio, true);
  const crlf = 'Video position (%),Absolute audience retention (%)\r\n0,100\r\n50,60\r\n100,20\r\n';
  c = ret.parseRows(head(crlf), body(crlf)); assert.equal(c.points.length, 3);
  const relOnly = 'Video position (%),Relative retention performance\n0,1\n50,0.5\n100,0.2\n';
  assert.equal(ret.looksLikeRetention(head(relOnly)), false, 'relative performance alone is not a share of viewers');
  const few = 'Video position (%),Absolute audience retention (%)\n0,100\n100,20\n';
  assert.match(ret.parseRows(head(few), body(few)).why, /too few points/);
  assert.equal(ret.looksLikeRetention(['Content', 'Views']), false);
});

await test('resample is straight lines between the file\'s points and never goes beyond them; the steepest falls do not overlap', () => {
  const s = ret.resample([{ t: 0, keep: 100 }, { t: 10, keep: 80 }, { t: 20, keep: 80 }, { t: 30, keep: 40 }], 1);
  assert.equal(s.length, 31); near(s[5].keep, 90); near(s[15].keep, 80); near(s[25].keep, 60); assert.equal(s.at(-1).t, 30);
  assert.deepEqual(ret.resample([{ t: 5, keep: 50 }], 1), []);
  const drops = ret.steepestDrops(s, { window: 5, count: 3, minDrop: 2 });
  assert.equal(drops[0].from, 20); near(drops[0].lost, 20, 0.02);
  for (let i = 1; i < drops.length; i++) assert.ok(drops.slice(0, i).every((d) => Math.abs(d.from - drops[i].from) >= 5), 'no overlap');
  assert.deepEqual(ret.steepestDrops(ret.resample([{ t: 0, keep: 100 }, { t: 60, keep: 99 }]), { window: 5 }), [], 'a gentle curve has no fall');
  assert.deepEqual(ret.parseChapters('0:00 Intro\n1:02:03 A long one\nnot a chapter\n2:30 Mid\r\n').map((c) => [c.t, c.title]), [[0, 'Intro'], [3723, 'A long one'], [150, 'Mid']]);
});

await test('analyse: the first 30 seconds, average view duration against length, the steepest fall on its scene, chapter and narration line', () => {
  const ch = channel(), video = ret.loadVideo(path.join(ch, 'videos', 'moon'));
  assert.equal(video.duration, 120); assert.equal(video.chapters.length, 2);
  const rows = rowsOf(percentCsv()), curve = ret.parseRows(rows[0], rows.slice(1));
  const a = ret.analyse(curve, video, { duration: 999, avd: 54 });
  assert.equal(a.duration, 120, 'the video\'s own scene times win over the table'); assert.equal(a.durationFrom, 'build/scene_times.json');
  near(a.first30.keep, 70, 0.01); near(a.avdShare, 45, 0.01); assert.ok(a.mean > 40 && a.mean < 70); assert.ok(a.mapped);
  const d = a.drops[0];
  assert.equal(d.from, 60); near(d.lost, 10.4, 0.2); assert.ok(!d.inFirst30);
  assert.equal(d.scene.n, 4); assert.equal(d.scene.id, 'claim'); assert.equal(d.scene.template, 'quote'); assert.equal(d.scene.length, 20); assert.match(d.scene.narration, /^The claim itself/);
  assert.equal(d.chapter.title, 'The big claim'); assert.equal(d.atChapterStart, true);
  assert.ok(a.drops.length >= 1 && a.drops.length <= 3);
  const txt = ret.lines(a, '"The Moon"').join('\n');
  assert.match(txt, /70% still watching at 0:30/); assert.match(txt, /average view duration 0:54 of a 2:00 video \(45%\)/);
  assert.match(txt, /Fall 1: 10\.\d points from 1:00 to 1:05 .* in scene 4 \("claim"\), template quote, 20 s long, narration: "The claim itself/); assert.match(txt, /chapter "The big claim" \(from 1:00\)/);
});

await test('analyse without scene times, without a length, with a short video and with a curve that stops early says so and invents nothing', () => {
  const rows = rowsOf(percentCsv()), curve = ret.parseRows(rows[0], rows.slice(1));
  let a = ret.analyse(curve, {}, {});
  assert.equal(a.duration, null); assert.match(a.notes[0], /no length is known/); assert.equal(a.first30, null); assert.ok(a.drops[0].percent); assert.equal(a.drops[0].scene, undefined);
  assert.match(ret.lines(a, 'x').join('\n'), /of the video/);
  a = ret.analyse(curve, {}, { duration: 120 });
  assert.equal(a.durationFrom, 'the table export'); assert.equal(a.mapped, false); assert.ok(a.notes.some((x) => /no build\/scene_times\.json/.test(x))); assert.ok(a.notes.some((x) => /average view duration is not in the table/.test(x)));
  assert.equal(a.drops[0].scene, undefined); assert.ok(a.drops[0].from >= 59);
  a = ret.analyse(curve, {}, { duration: 20 });
  assert.match(a.first30.note, /shorter than 30 seconds/);
  const sec = 'Video position (seconds),Absolute audience retention (%)\n0,100\n20,80\n40,70\n60,50\n';
  const sr = rowsOf(sec), sc = ret.parseRows(sr[0], sr.slice(1));
  a = ret.analyse(sc, {}, { duration: 300 });
  assert.ok(a.notes.some((x) => /the curve ends at 1:00 but the video runs 5:00/.test(x)));
  a = ret.analyse(sc, {}, {});
  assert.match(a.durationFrom, /last point of the retention file/);
});

await test('the review: a Retention section with observations on the scene, hypotheses not proven, at most 3 tests, and the small sample said', () => {
  const ch = channel(), dir = tmp();
  const csv = write(path.join(dir, 'moon.csv'), percentCsv()), table = write(path.join(dir, 'Table data.csv'), TABLE());
  const r = R.review(ch, [table, csv], { today: new Date('2026-11-17T12:00:00Z'), log: () => {} });
  const md = read(r.file);
  assert.ok(md.indexOf('## Tests for the next video') < md.indexOf('## Retention'));
  const sec = md.slice(md.indexOf('## Retention'));
  assert.match(sec, /Sample: 1 video with a retention curve\. With fewer than 5, every line below is about one video/);
  assert.match(sec, /"The Moon" \(videos\/moon\): 70% still watching at 0:30/);
  assert.match(sec, /average view duration 0:54 of a 2:00 video \(45%\)/);
  assert.match(sec, /Fall 1: .* in scene 4 \("claim"\)/);
  const hyp = sec.slice(sec.indexOf('**Hypotheses**'), sec.indexOf('**Tests for the next video**'));
  assert.ok(/hypothesis, not proven/.test(hyp) && /a chapter begins here \("The big claim"\)/.test(hyp));
  const tests = sec.slice(sec.indexOf('**Tests for the next video**')).split('\n').filter((l) => /^\d\. /.test(l));
  assert.ok(tests.length >= 1 && tests.length <= 3, tests.join('\n'));
  assert.ok(tests.some((t) => /\*\*Hook\.\*\*/.test(t)) && tests.some((t) => /\*\*Chapter order\.\*\*/.test(t)), tests.join('\n'));
  assert.ok(tests.every((t) => /Read:/.test(t)), 'every test names the number to read');
  assert.equal(r.retentionTests.length, tests.length);
  // every number in the section comes from the curve, the files or arithmetic on them: spot-check the two the person will quote
  assert.ok(sec.includes('70%') && sec.includes('0:54'));
});

await test('no retention export: the section says there is nothing, how to download one, and never guesses', () => {
  const ch = channel(), dir = tmp(), table = write(path.join(dir, 'Table data.csv'), TABLE());
  const r = R.review(ch, [table], { today: new Date('2026-11-17T12:00:00Z'), log: () => {} });
  const sec = read(r.file).slice(read(r.file).indexOf('## Retention'));
  assert.match(sec, /No audience retention export was given, so nothing can be said about where viewers leave/); assert.match(sec, /moon\.csv/);
  assert.ok(!/still watching|Fall 1/.test(sec));
});

await test('a retention file that matches no video is used in percent only, and says so; a file with no position column is refused by name', () => {
  const ch = channel(), dir = tmp();
  const csv = write(path.join(dir, 'Audience retention.csv'), percentCsv()), table = write(path.join(dir, 'Table data.csv'), TABLE());
  const r = R.review(ch, [table, csv], { today: new Date('2026-11-17T12:00:00Z'), log: () => {} });
  const sec = read(r.file).slice(read(r.file).indexOf('## Retention'));
  assert.match(sec, /"Audience retention" \(not matched to a video folder of this channel/); assert.match(sec, /no length is known/); assert.match(sec, /of the video/);
  assert.match(sec, /cannot be tied to a scene/); assert.match(sec, /No test can be drawn|\*\*Hook\.\*\*/);
  const bad = write(path.join(dir, 'bad.csv'), 'Day,Retention,Views\n1,2,3\n');
  const r2 = R.readExport(bad); assert.notEqual(r2.kind, 'retention');
});

await test('the file name decides the match: the folder name, the YouTube id, the title, or the export folder\'s name', () => {
  const ch = channel(['moon', 'mars']), kit = R.kitVideos(ch);
  const m = (file) => R.matchRetention({ file, name: path.basename(file, '.csv') }, kit, []);
  assert.equal(m('/x/moon.csv').folder, 'moon'); assert.equal(m('/x/Retention mars 2026.csv').folder, 'mars');
  assert.equal(m('/x/AAAAAAAAAA1 audience.csv').folder, 'mars', 'by YouTube id');
  assert.equal(m('/x/mars-export/Chart data.csv').folder, 'mars', 'by the export folder\'s name');
  assert.equal(m('/x/other.csv'), null);
  const row = { id: 'ZZZZZZZZZZ9', title: 'Why Saturn has rings', folder: null };
  assert.equal(R.matchRetention({ file: '/x/why-saturn-has-rings.csv', name: 'why-saturn-has-rings' }, kit, [row]).row, row);
});

await test('five or more curves: a pattern across videos is allowed; under five it is not drawn', () => {
  const names = ['vid-one', 'vid-two', 'vid-three', 'vid-four', 'vid-five'], ch = channel(names), dir = tmp();
  const files = names.map((nm) => write(path.join(dir, `${nm}.csv`), percentCsv()));
  const r = R.review(ch, files, { today: new Date('2026-11-17T12:00:00Z'), log: () => {} });
  const sec = read(r.file).slice(read(r.file).indexOf('## Retention'));
  assert.match(sec, /Sample: 5 videos with a retention curve\./); assert.match(sec, /Across 5 videos: median 70% still watching at 0:30; in 0 of 5 the steepest fall is inside the first 30 seconds/);
  const few = R.review(channel(['vid-one']), [write(path.join(dir, 'vid-one.csv'), percentCsv())], { today: new Date('2026-11-18T12:00:00Z'), log: () => {} });
  assert.ok(!/Across \d+ videos/.test(read(few.file)));
});

await test('an early fall is a hook hypothesis; a gentle curve gives no test', () => {
  const ch = channel(), dir = tmp();
  const early = (p) => (p <= 5 ? 100 - 6 * p : 70 - 0.3 * (p - 5));   // 30 points lost in the first 6 seconds
  const csv = write(path.join(dir, 'moon.csv'), `Video position (%),Absolute audience retention (%)\n${Array.from({ length: 101 }, (_, p) => `${p},${early(p).toFixed(2)}`).join('\n')}\n`);
  let r = R.review(ch, [csv], { today: new Date('2026-11-17T12:00:00Z'), log: () => {} });
  let sec = read(r.file).slice(read(r.file).indexOf('## Retention'));
  assert.match(sec, /the opening may promise less than the title does/); assert.match(sec, /\*\*Hook\.\*\*/);
  const gentle = write(path.join(dir, 'moon2.csv'), 'Video position (%),Absolute audience retention (%)\n0,100\n25,98\n50,96\n75,94\n100,92\n');
  r = R.review(ch, [gentle], { today: new Date('2026-11-17T12:00:00Z'), log: () => {} });
  sec = read(r.file).slice(read(r.file).indexOf('## Retention'));
  assert.match(sec, /No fall of 2 points or more/); assert.match(sec, /None: no fall of 2 points or more/);
  assert.match(sec, /No test can be drawn from these curves|\*\*Hook\.\*\*/);
});

await test('video review through the command line writes the section and never touches the network', async () => {
  const { spawnSync } = await import('node:child_process');
  const ch = channel(), dir = tmp(), csv = write(path.join(dir, 'moon.csv'), percentCsv());
  const VIDEO = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'studio', 'tools', 'video.mjs');
  const r = spawnSync(process.execPath, [VIDEO, 'review', ch, csv], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const f = fs.readdirSync(path.join(ch, 'reviews')).find((x) => x.endsWith('.md'));
  assert.match(read(path.join(ch, 'reviews', f)), /## Retention \(where viewers leave\)/);
  const src = fs.readFileSync(new URL('../studio/tools/retention.mjs', import.meta.url), 'utf8');
  assert.ok(!/node:(https?|net|dns)|fetch\(/.test(src));
});

console.log(`\n${n} test(s) passed`);
