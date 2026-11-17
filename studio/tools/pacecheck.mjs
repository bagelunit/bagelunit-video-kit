// pacecheck.mjs · does the picture keep changing? A pace check on the scene plan and its clock (long-form, 1920x1080).
//
//   node pacecheck.mjs <video folder> [--json]     reads scenes.json, build/scene_times.json, video.json (style, end_card)
//   node pacecheck.mjs --selftest                  checks the checks on made-up plans (no ffmpeg, no files)
//
// Prints PASS / WARN / FAIL / INFO lines, writes build/pace.json, exit 1 on any FAIL, 2 when it could not run (no plan or no clock).
//
// The Studio quality rules: a new picture every 4 to 6 seconds in a busy style; a calm style (CALM_STYLES, today deep-zoom, the
// slow 3D science look, where the camera does the moving) keeps its own pace; every chapter varied; no long still stretch.
//   scene length     busy: over 8 s WARN. calm: over 14 s WARN.
//   no change        busy: a scene over 12 s FAIL (nothing changes for over 12 s). calm: over 20 s FAIL (the camera moves, but not forever).
//   same template    the same template three scenes in a row WARN, five in a row FAIL.
//   chapter variety  a chapter with fewer than 3 distinct templates WARN (calm: fewer than 2).
//   average          seconds per scene. busy: 4 to 6 PASS, 2.5 to 4 and 6 to 8 WARN, outside FAIL.
//                    calm (our own band): 6 to 12 PASS, 4 to 6 and 12 to 16 WARN, outside FAIL.
// What does not count against a scene: its "pause" (silence on purpose: a brand intro) and, on the last scene, the video.json
// "end_card" (a still card for YouTube's end screen). A clip scene counts as the template "clip".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CALM_STYLES = ['deep-zoom'];
export const isCalm = (style) => CALM_STYLES.includes(String(style || ''));
export const BARS = {
  busy: { sceneWarn: 8, still: 12, avgPass: [4, 6], avgWarn: [2.5, 8], variety: 3 },
  calm: { sceneWarn: 14, still: 20, avgPass: [6, 12], avgWarn: [4, 16], variety: 2 },
  runWarn: 3, runFail: 5,
};

const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
const readJSON = (f, d) => { try { return JSON.parse(read(f)); } catch { return d; } };
const posix = (p) => String(p).split(path.sep).join('/');
const clock = (t) => { t = Math.max(0, Math.round(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };

export const templateKey = (s) => s.template || (s.clip ? 'clip' : s.code ? `code:${s.code}` : 'custom');

// scenes: scenes.json's list; times: build/scene_times.json (t0, t1 per scene); opts: { style, endCard }
export function paceCheck(scenes, times, { style = '', endCard = 0 } = {}) {
  const calm = isCalm(style), bar = calm ? BARS.calm : BARS.busy;
  const results = [];
  const add = (level, name, text) => results.push({ level, name, text });
  if (!Array.isArray(scenes) || !scenes.length || !Array.isArray(times) || times.length < scenes.length) {
    throw new Error(`the plan has ${scenes?.length || 0} scenes but the clock has ${times?.length || 0}: render or check the video first so build/scene_times.json is current`);
  }
  const rows = scenes.map((s, k) => {
    const raw = times[k].t1 - times[k].t0;
    const pause = Math.max(0, Number(s.pause) || 0);
    const card = k === scenes.length - 1 ? Math.max(0, Number(endCard) || 0) : 0;
    return { n: k + 1, id: s.id || null, key: templateKey(s), chapter: s.chapter || null, t0: times[k].t0, raw, len: Math.max(0, raw - pause - card), excused: raw - Math.max(0, raw - pause - card) };
  });
  const total = rows.reduce((a, r) => a + r.len, 0);
  const label = (r) => `scene ${r.n} (${r.key}, ${clock(r.t0)}, ${r.len.toFixed(1)} s)`;
  add('INFO', 'style', `${style || 'no style'}: ${calm ? 'a calm style, its own pace (scenes up to ' + bar.sceneWarn + ' s, average ' + bar.avgPass.join(' to ') + ' s)' : 'a busy style (a new picture every ' + bar.avgPass.join(' to ') + ' s)'}`);

  // scene length
  const longs = rows.filter((r) => r.len > bar.sceneWarn);
  add(longs.length ? 'WARN' : 'PASS', 'scene length', longs.length ? `${longs.length} scene(s) over ${bar.sceneWarn} s: ${longs.slice(0, 8).map(label).join('; ')}${longs.length > 8 ? '; ...' : ''}. Split the idea in two scenes` : `no scene over ${bar.sceneWarn} s`);

  // no change for too long
  const still = rows.filter((r) => r.len > bar.still);
  add(still.length ? 'FAIL' : 'PASS', 'no change', still.length ? `nothing changes for over ${bar.still} s in ${still.slice(0, 8).map(label).join('; ')}` : `the picture changes at least every ${bar.still} s (longest ${Math.max(...rows.map((r) => r.len)).toFixed(1)} s)`);

  // the same template in a row
  const runs = [];
  for (let i = 0; i < rows.length;) {
    let j = i; while (j + 1 < rows.length && rows[j + 1].key === rows[i].key) j++;
    if (j - i + 1 >= BARS.runWarn) runs.push({ key: rows[i].key, from: rows[i].n, to: rows[j].n, count: j - i + 1, t0: rows[i].t0 });
    i = j + 1;
  }
  const worst = runs.reduce((a, r) => Math.max(a, r.count), 0);
  add(!runs.length ? 'PASS' : worst >= BARS.runFail ? 'FAIL' : 'WARN', 'same template',
    runs.length ? runs.slice(0, 6).map((r) => `"${r.key}" ${r.count} times in a row (scenes ${r.from} to ${r.to}, from ${clock(r.t0)})`).join('; ') + ': spread the templates' : `no template three times in a row`);

  // chapters
  const marks = rows.filter((r) => r.chapter);
  if (!marks.length) add('WARN', 'chapters', 'no scene has a "chapter": YouTube chapters and the per-chapter checks need them (at least 3)');
  else {
    const chapters = marks.map((m, i) => {
      const from = i === 0 ? 0 : m.n - 1, to = i + 1 < marks.length ? marks[i + 1].n - 1 : rows.length;
      const own = rows.slice(from, to);
      return { title: m.chapter, scenes: own.length, distinct: new Set(own.map((r) => r.key)).size, t0: own[0].t0 };
    });
    const thin = chapters.filter((c) => c.distinct < bar.variety);
    add(thin.length ? 'WARN' : 'PASS', 'chapter variety', thin.length
      ? thin.map((c) => `chapter "${c.title}" (${clock(c.t0)}) has ${c.distinct} distinct template(s) in ${c.scenes} scene(s), want ${bar.variety} or more`).join('; ')
      : `all ${chapters.length} chapters use ${bar.variety} or more distinct templates`);
  }

  // average
  const avg = total / rows.length, inside = (v, [a, b]) => v >= a && v <= b;
  const level = inside(avg, bar.avgPass) ? 'PASS' : inside(avg, bar.avgWarn) ? 'WARN' : 'FAIL';
  add(level, 'average', `${avg.toFixed(1)} s per scene over ${rows.length} scenes and ${clock(total)} of picture (${calm ? 'calm' : 'busy'} band ${bar.avgPass.join(' to ')} s)${level === 'PASS' ? '' : avg > bar.avgPass[1] ? ': too slow, add scenes or cut the long ones' : ': too fast for a long video, merge some scenes'}`);

  const stats = { scenes: rows.length, seconds: +total.toFixed(2), average: +avg.toFixed(2), longest: +Math.max(...rows.map((r) => r.len)).toFixed(2), calm };
  return { results, stats, exit: results.some((r) => r.level === 'FAIL') ? 1 : 0 };
}

export function paceFolder(dir) {
  const plan = readJSON(path.join(dir, 'scenes.json'), null);
  const list = Array.isArray(plan) ? plan : plan?.scenes;
  if (!Array.isArray(list) || !list.length) throw new Error(`no scenes in ${posix(path.join(dir, 'scenes.json'))}: plan the scenes first`);
  const times = readJSON(path.join(dir, 'build', 'scene_times.json'), null);
  if (!Array.isArray(times)) throw new Error('no build/scene_times.json: run  video check <folder>  or  video render <folder>  first (the scene times come from the voice)');
  const cfg = readJSON(path.join(dir, 'video.json'), {}) || {};
  return paceCheck(list, times, { style: cfg.style, endCard: cfg.end_card });
}

export function print(res) {
  for (const r of res.results) console.log(`${r.level.padEnd(5)} ${r.name.padEnd(15)} ${r.text}`);
}

export function cli(loose, flags = {}) {
  const dir = loose[0];
  if (!dir) { console.log('usage: node pacecheck.mjs <video folder> [--json]   |   --selftest'); process.exitCode = 2; return; }
  let res;
  try { res = paceFolder(path.resolve(dir)); } catch (e) { console.log(`pace check could not run: ${e.message}`); process.exitCode = 2; return; }
  if (flags.json) console.log(JSON.stringify(res, null, 1)); else print(res);
  try { fs.mkdirSync(path.join(dir, 'build'), { recursive: true }); fs.writeFileSync(path.join(dir, 'build', 'pace.json'), JSON.stringify({ at: new Date().toISOString(), ...res }, null, 1) + '\n'); } catch { /* read-only folder: the lines above are the answer */ }
  process.exitCode = res.exit;
}

/* ── selftest ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
export function selftest() {
  let bad = 0;
  const expect = (cond, msg) => { if (!cond) { bad++; console.log(`FAIL selftest: ${msg}`); } };
  const plan = (list) => { let t = 0; const times = [], scenes = []; for (const [tpl, len, ch, extra] of list) { scenes.push({ template: tpl, ...(ch ? { chapter: ch } : {}), ...(extra || {}) }); times.push({ t0: t, t1: t + len }); t += len; } return { scenes, times }; };
  const by = (res, name) => res.results.find((r) => r.name === name);
  // a good plan: 5 s scenes, 4 templates per chapter
  const T = ['a', 'b', 'c', 'd'];
  const good = plan(Array.from({ length: 24 }, (_, i) => [T[i % 4], 5, i % 8 === 0 ? `Part ${i / 8 + 1}` : null]));
  let r = paceCheck(good.scenes, good.times, { style: 'comic' });
  expect(r.exit === 0 && r.results.every((x) => x.level === 'PASS' || x.level === 'INFO'), 'a 5 s varied plan should pass: ' + JSON.stringify(r.results.filter((x) => x.level !== 'PASS' && x.level !== 'INFO')));
  // slow scenes
  const slow = plan([['a', 9, 'One'], ['b', 5], ['c', 5], ['d', 13, 'Two'], ['a', 5], ['b', 5]]);
  r = paceCheck(slow.scenes, slow.times, { style: 'comic' });
  expect(by(r, 'scene length').level === 'WARN', 'a 9 s scene in a busy style should WARN');
  expect(by(r, 'no change').level === 'FAIL' && r.exit === 1, 'a 13 s scene should FAIL');
  // the same template in a row
  const rep = plan([['a', 5, 'One'], ['a', 5], ['a', 5], ['b', 5], ['c', 5, 'Two'], ['d', 5], ['a', 5]]);
  r = paceCheck(rep.scenes, rep.times, { style: 'comic' });
  expect(by(r, 'same template').level === 'WARN' && /"a" 3 times/.test(by(r, 'same template').text), 'three of a kind should WARN');
  const five = plan(Array.from({ length: 6 }, () => ['a', 5]));
  expect(paceCheck(five.scenes, five.times, { style: 'comic' }).results.find((x) => x.name === 'same template').level === 'FAIL', 'six in a row should FAIL');
  // a chapter with two templates
  const thin = plan([['a', 5, 'One'], ['b', 5], ['a', 5], ['c', 5, 'Two'], ['d', 5], ['a', 5]]);
  r = paceCheck(thin.scenes, thin.times, { style: 'comic' });
  expect(by(r, 'chapter variety').level === 'WARN' && /"One"/.test(by(r, 'chapter variety').text) && !/"Two"/.test(by(r, 'chapter variety').text), 'chapter One has only 2 templates');
  // the average
  const fast = plan(Array.from({ length: 10 }, (_, i) => [T[i % 4], 2, i === 0 ? 'One' : null]));
  expect(paceCheck(fast.scenes, fast.times, { style: 'comic' }).results.find((x) => x.name === 'average').level === 'FAIL', '2 s per scene is too fast');
  const sevenish = plan(Array.from({ length: 10 }, (_, i) => [T[i % 4], 7, i === 0 ? 'One' : null]));
  expect(paceCheck(sevenish.scenes, sevenish.times, { style: 'comic' }).results.find((x) => x.name === 'average').level === 'WARN', '7 s per scene is a warning');
  // calm styles keep their own pace
  const calmPlan = plan([['x', 10, 'One'], ['y', 9], ['x', 11, 'Two'], ['y', 10]]);
  r = paceCheck(calmPlan.scenes, calmPlan.times, { style: 'deep-zoom' });
  expect(r.exit === 0 && by(r, 'average').level === 'PASS' && by(r, 'no change').level === 'PASS', 'a calm 10 s plan should pass in deep-zoom: ' + JSON.stringify(r.results.filter((x) => x.level !== 'PASS')));
  expect(paceCheck(calmPlan.scenes, calmPlan.times, { style: 'comic' }).exit === 1, 'the same plan fails in a busy style');
  // a pause and the end card do not count
  const card = plan([['a', 5, 'One'], ['b', 5], ['c', 5], ['d', 5, 'Two', { pause: 8 }], ['a', 5], ['b', 20]]);
  card.times[3].t1 += 8; for (let k = 4; k < 6; k++) { card.times[k].t0 += 8; card.times[k].t1 += 8; }
  r = paceCheck(card.scenes, card.times, { style: 'comic', endCard: 15 });
  expect(by(r, 'no change').level === 'PASS', 'a pause and an end card are not stillness: ' + by(r, 'no change').text);
  // a clip scene has the template "clip"
  expect(templateKey({ clip: { asset: 'x' } }) === 'clip', 'clip key');
  // too few clock entries
  let threw = false; try { paceCheck(good.scenes, good.times.slice(0, 3), {}); } catch { threw = true; }
  expect(threw, 'a short clock should throw');
  console.log('pacecheck selftest: ' + (bad ? 'FAIL' : 'OK'));
  return bad ? 1 : 0;
}

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  if (a.includes('--selftest')) process.exitCode = selftest();
  else cli(a.filter((x) => !x.startsWith('--')), { json: a.includes('--json') });
}
