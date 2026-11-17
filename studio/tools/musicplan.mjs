// musicplan.mjs · does the music follow the chapters? Checks the music plan table in outline.md against scenes.json's chapters,
// the "music" list in video.json and the channel's licensed register (brand/licensed/assets.json).
//
//   node musicplan.mjs <video folder> [--json]     exit 1 on any FAIL, 2 when it could not run (no scenes.json)
//   node musicplan.mjs --selftest
//
// The table (the starter is the channel's brand/music-plan.md) sits under a heading with "music plan" in it, in outline.md:
//
//   ## Music plan
//   | Chapter | Mood | Tempo | Energy | Asset |
//   |---|---|---|---|---|
//   | Why ice floats | calm, curious | 80 BPM | starts low | quiet-morning |
//
// Chapter is the chapter's title in scenes.json (or its number: 1, 2, 3). Asset is an id from brand/licensed/assets.json or none.
// What is reported:
//   FAIL  an asset in the plan or in video.json "music" that is not in the register (or is not a music asset)
//   FAIL  the plan names an asset for a chapter, but video.json "music" has no entry starting that chapter (the plan is not built)
//   WARN  a chapter with no row in the plan, or a chapter with no music entry of its own (the track before it keeps playing)
//   WARN  a "music" entry whose "from" is not the first scene of a chapter (music that changes mid-chapter, usually by accident)
//   WARN  the mood changes from one chapter to the next but the entry that starts the new chapter fades under 1 s (an abrupt switch)
//   WARN  the mood changes but no entry starts that chapter at all (the mood changes, the music does not)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_CROSSFADE = 1;
const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
const readJSON = (f, d) => { try { return JSON.parse(read(f)); } catch { return d; } };
const clock = (t) => { t = Math.max(0, Math.round(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// the first markdown table under a heading that mentions "music plan" -> [{chapter, mood, tempo, energy, asset}] or null
export function parsePlan(markdown) {
  const lines = String(markdown).replace(/^﻿/, '').split(/\r?\n/);
  let k = lines.findIndex((l) => /^\s{0,3}#{1,6}\s.*music\s*plan/i.test(l));
  if (k < 0) return null;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  for (k++; k < lines.length && !/^\s{0,3}#{1,6}\s/.test(lines[k]); k++) {
    if (!/^\s*\|/.test(lines[k])) continue;
    const head = cells(lines[k]).map((h) => norm(h));
    const col = (name) => head.findIndex((h) => h.startsWith(name));
    const idx = { chapter: col('chapter'), mood: col('mood'), tempo: col('tempo'), energy: col('energy'), asset: col('asset') };
    if (idx.chapter < 0) continue;
    const rows = [];
    for (let r = k + 1; r < lines.length && /^\s*\|/.test(lines[r]); r++) {
      const c = cells(lines[r]);
      if (c.every((x) => /^:?-{2,}:?$/.test(x) || x === '')) continue;
      const get = (i) => (i >= 0 ? c[i] || '' : '');
      const row = { chapter: get(idx.chapter), mood: get(idx.mood), tempo: get(idx.tempo), energy: get(idx.energy), asset: get(idx.asset).replace(/^`|`$/g, '') };
      if (row.chapter && !/^(chapter|<.*>)$/i.test(row.chapter) && !/^<.*>$/.test(row.asset)) rows.push(row);
    }
    return { rows, hasAsset: idx.asset >= 0, hasMood: idx.mood >= 0 };
  }
  return { rows: [], hasAsset: false, hasMood: false };
}

// chapters from scenes.json: [{n, title, first (scene index), t0}]. The first marked chapter starts at scene 0 (as chapters.txt does).
export function chaptersOf(scenes, times = []) {
  const marks = [];
  scenes.forEach((s, i) => { if (s && s.chapter) marks.push({ title: s.chapter, first: i }); });
  if (marks.length) marks[0].first = 0;
  return marks.map((m, i) => ({ n: i + 1, title: m.title, first: m.first, t0: times[m.first]?.t0 ?? null }));
}

export function musicPlanCheck({ plan, scenes, times = [], music, register, outlineExists = true }) {
  const results = [];
  const add = (level, name, text) => results.push({ level, name, text });
  const chapters = chaptersOf(scenes, times);
  if (!chapters.length) { add('WARN', 'chapters', 'no scene has a "chapter" in scenes.json: nothing to plan the music against'); return { results, exit: 0 }; }
  const assets = new Map((register?.assets || []).map((a) => [a.id, a]));
  const known = register != null;

  // the video.json entries, with where each one starts
  let entries = [];
  if (Array.isArray(music)) {
    entries = music.map((e, i) => {
      let at = typeof e?.from === 'number' ? { seconds: e.from } : e?.from != null ? { scene: String(e.from) } : { seconds: 0 };
      let sceneIndex = null, seconds = null;
      if (at.scene != null) { sceneIndex = scenes.findIndex((s) => s.id === at.scene); if (sceneIndex >= 0) seconds = times[sceneIndex]?.t0 ?? null; }
      else { seconds = at.seconds; if (times.length) sceneIndex = times.findIndex((t) => Math.abs(t.t0 - seconds) < 0.25); }
      return { i, asset: e?.asset, fade: e?.fade == null ? 2 : Number(e.fade), from: e?.from ?? 0, sceneIndex: sceneIndex != null && sceneIndex >= 0 ? sceneIndex : null, seconds };
    }).sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0));
  }
  const startingAt = (ch) => entries.find((e) => e.sceneIndex === ch.first || (ch.first === 0 && (e.seconds ?? 0) === 0));

  // assets in the register
  const used = new Set([...entries.map((e) => e.asset), ...(plan?.rows || []).map((r) => r.asset)].filter((a) => a && !/^none$/i.test(a)));
  const missing = [...used].filter((id) => known && !assets.has(id));
  const wrongType = [...used].filter((id) => assets.has(id) && assets.get(id).type !== 'music');
  add(missing.length || wrongType.length ? 'FAIL' : 'PASS', 'register', missing.length
    ? `not in brand/licensed/assets.json: ${missing.join(', ')} (video licensed add <file> --type music ...)`
    : wrongType.length ? `not a music asset: ${wrongType.join(', ')}` : known ? (used.size ? `all ${used.size} asset(s) are in the register` : 'no asset named yet') : 'no channel register to check against (a video outside a channel folder)');

  if (!Array.isArray(music)) {
    add('INFO', 'music', music ? 'video.json "music" is one file for the whole video: the music cannot change with the chapters (use the list form with licensed assets for that)' : 'video.json has no "music": a voice-only video');
    const moods = new Set((plan?.rows || []).map((r) => norm(r.mood)).filter(Boolean));
    if (moods.size > 1 && music) add('WARN', 'mood', `the plan has ${moods.size} different moods but one music file plays throughout`);
    return { results, exit: results.some((r) => r.level === 'FAIL') ? 1 : 0 };
  }

  // each entry starts at a chapter
  const starts = new Set(chapters.map((c) => c.first));
  const stray = entries.filter((e) => !(e.sceneIndex != null && starts.has(e.sceneIndex)) && !(e.sceneIndex == null && (e.seconds ?? 0) === 0) && !(e.sceneIndex != null && e.sceneIndex === 0));
  const unresolved = entries.filter((e) => e.sceneIndex == null && (e.seconds ?? 0) !== 0 && !times.length);
  add(stray.length ? 'WARN' : 'PASS', 'entry starts', stray.length
    ? stray.map((e) => `music[${e.i}] "${e.asset}" from ${JSON.stringify(e.from)}${e.seconds != null ? ` (${clock(e.seconds)})` : ''} is not the first scene of a chapter`).join('; ') + ': the music changes mid-chapter'
    : unresolved.length ? 'could not place the entries on the clock (no build/scene_times.json): run video check first' : `all ${entries.length} entries start on a chapter`);

  // the plan against the chapters
  const rowFor = (ch) => (plan?.rows || []).find((r) => norm(r.chapter) === norm(ch.title) || String(r.chapter).trim() === String(ch.n) || norm(r.chapter) === `chapter ${ch.n}`);
  if (!plan) add('WARN', 'plan', outlineExists ? 'outline.md has no "Music plan" table (the starter is brand/music-plan.md): plan the mood per chapter before choosing tracks' : 'there is no outline.md');
  else if (!plan.rows.length) add('WARN', 'plan', 'the Music plan table in outline.md has no rows');
  const noRow = plan?.rows.length ? chapters.filter((c) => !rowFor(c)) : [];
  if (noRow.length) add('WARN', 'plan rows', `no row in the music plan for chapter ${noRow.map((c) => `${c.n} "${c.title}"`).join(', ')}`);
  const strayRows = plan?.rows.filter((r) => !chapters.some((c) => rowFor(c) === r)) || [];
  if (strayRows.length) add('WARN', 'plan rows', `plan row(s) with no such chapter in scenes.json: ${strayRows.map((r) => `"${r.chapter}"`).join(', ')}`);

  // chapter by chapter
  const noEntry = [], notBuilt = [], abrupt = [], silentChange = [];
  chapters.forEach((ch, k) => {
    const row = rowFor(ch), e = startingAt(ch);
    const wants = row && row.asset && !/^none$/i.test(row.asset) ? row.asset : null;
    if (!e) {
      if (wants) notBuilt.push(`chapter ${ch.n} "${ch.title}" is planned with "${wants}" but video.json "music" has no entry starting it`);
      else if (!row || !/^none$/i.test(row.asset || '')) noEntry.push(`${ch.n} "${ch.title}"`);
    } else if (wants && e.asset !== wants) notBuilt.push(`chapter ${ch.n} "${ch.title}" is planned with "${wants}" but its entry plays "${e.asset}"`);
    if (k > 0) {
      const prev = rowFor(chapters[k - 1]);
      if (row && prev && norm(row.mood) && norm(prev.mood) && norm(row.mood) !== norm(prev.mood)) {
        if (!e) silentChange.push(`chapter ${ch.n} "${ch.title}" (${prev.mood} to ${row.mood})`);
        else if (e.fade < MIN_CROSSFADE) abrupt.push(`chapter ${ch.n} "${ch.title}" (${prev.mood} to ${row.mood}) fades ${e.fade} s`);
      }
    }
  });
  add(notBuilt.length ? 'FAIL' : 'PASS', 'plan built', notBuilt.length ? notBuilt.join('; ') : plan?.rows.length ? 'every planned asset is where the plan says' : 'nothing planned to compare');
  add(noEntry.length ? 'WARN' : 'PASS', 'chapter music', noEntry.length
    ? `no music entry starts chapter ${noEntry.join(', ')}: the track before it keeps playing (put "none" in the plan if that is meant)`
    : `every chapter has its own entry, or says none`);
  add(abrupt.length ? 'WARN' : 'PASS', 'crossfade', abrupt.length ? `a mood change with a fade under ${MIN_CROSSFADE} s: ${abrupt.join('; ')}. Use "fade": 2 or more` : `mood changes crossfade ${MIN_CROSSFADE} s or more`);
  if (silentChange.length) add('WARN', 'mood', `the mood changes but no entry starts the chapter: ${silentChange.join('; ')}`);
  return { results, exit: results.some((r) => r.level === 'FAIL') ? 1 : 0, chapters: chapters.length, entries: entries.length };
}

function licensedRegister(dir) {
  // the channel folder is the nearest parent with brand/brand.json (a video lives in <channel>/videos/<name>)
  let d = path.resolve(dir);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'brand', 'brand.json'))) {
      const reg = readJSON(path.join(d, 'brand', 'licensed', 'assets.json'), { assets: [] });
      return Array.isArray(reg?.assets) ? reg : { assets: [] };
    }
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return null;
}

export function musicPlanFolder(dir) {
  const plan = readJSON(path.join(dir, 'scenes.json'), null);
  const scenes = Array.isArray(plan) ? plan : plan?.scenes;
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('no scenes in scenes.json: plan the scenes first');
  const times = readJSON(path.join(dir, 'build', 'scene_times.json'), []);
  const cfg = readJSON(path.join(dir, 'video.json'), {}) || {};
  const outline = path.join(dir, 'outline.md');
  const table = fs.existsSync(outline) ? parsePlan(read(outline)) : null;
  return musicPlanCheck({ plan: table, scenes, times: Array.isArray(times) ? times : [], music: cfg.music, register: licensedRegister(dir), outlineExists: fs.existsSync(outline) });
}

export function cli(loose, flags = {}) {
  const dir = loose[0];
  if (!dir) { console.log('usage: node musicplan.mjs <video folder> [--json]   |   --selftest'); process.exitCode = 2; return; }
  let res;
  try { res = musicPlanFolder(path.resolve(dir)); } catch (e) { console.log(`music plan check could not run: ${e.message}`); process.exitCode = 2; return; }
  if (flags.json) console.log(JSON.stringify(res, null, 1));
  else for (const r of res.results) console.log(`${r.level.padEnd(5)} ${r.name.padEnd(13)} ${r.text}`);
  process.exitCode = res.exit;
}

/* ── selftest ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
export function selftest() {
  let bad = 0;
  const expect = (cond, msg) => { if (!cond) { bad++; console.log(`FAIL selftest: ${msg}`); } };
  const scenes = Array.from({ length: 9 }, (_, i) => ({ id: `s${i + 1}`, template: 'a', ...(i % 3 === 0 ? { chapter: ['Hook', 'Middle', 'Payoff'][i / 3] } : {}) }));
  const times = scenes.map((_, i) => ({ t0: i * 10, t1: i * 10 + 10 }));
  const register = { assets: [{ id: 'calm-bed', type: 'music' }, { id: 'drive', type: 'music' }, { id: 'whoosh', type: 'sfx' }] };
  const md = '# Outline\r\n\r\n## Music plan\r\n\r\n| Chapter | Mood | Tempo | Energy change | Asset |\r\n|---|---|---|---|---|\r\n| Hook | curious | 90 | start low | calm-bed |\r\n| 2 | tense | 120 | builds | drive |\r\n| Payoff | warm | 80 | resolves | calm-bed |\r\n\r\n## Chapters\r\n';
  const plan = parsePlan(md);
  expect(plan && plan.rows.length === 3 && plan.rows[1].asset === 'drive' && plan.hasAsset, 'parse the table (CRLF): ' + JSON.stringify(plan));
  expect(parsePlan('# no plan here') === null, 'no heading, no plan');
  expect(parsePlan('## Music plan\n\n| Chapter | Mood | Tempo | Energy | Asset |\n|---|---|---|---|---|\n| <chapter title> | <mood> | | | <asset id or none> |\n').rows.length === 0, 'the starter placeholder row is not a row');
  const good = [{ asset: 'calm-bed', from: 's1' }, { asset: 'drive', from: 's4', fade: 2 }, { asset: 'calm-bed', from: 's7', fade: 3 }];
  let r = musicPlanCheck({ plan, scenes, times, music: good, register });
  expect(r.exit === 0 && r.results.every((x) => x.level === 'PASS'), 'a matching plan passes: ' + JSON.stringify(r.results.filter((x) => x.level !== 'PASS')));
  // a chapter with no entry
  r = musicPlanCheck({ plan, scenes, times, music: [good[0], good[1]], register });
  expect(r.exit === 1 && r.results.find((x) => x.name === 'plan built').level === 'FAIL', 'the Payoff chapter is planned with calm-bed but has no entry');
  const noPlan = parsePlan('## Music plan\n| Chapter | Mood | Asset |\n|---|---|---|\n| Hook | curious | none |\n| 2 | tense | none |\n| Payoff | warm | none |\n');
  r = musicPlanCheck({ plan: noPlan, scenes, times, music: [good[0], good[1]], register });
  expect(r.exit === 0 && r.results.find((x) => x.name === 'chapter music').level === 'PASS', 'none in the plan means no entry is needed... for the chapters that say none');
  r = musicPlanCheck({ plan: null, scenes, times, music: [good[0], good[1]], register });
  expect(r.results.find((x) => x.name === 'chapter music').level === 'WARN' && r.results.find((x) => x.name === 'plan').level === 'WARN', 'no plan: warn, and the chapter without an entry is named');
  // from not a chapter start
  r = musicPlanCheck({ plan, scenes, times, music: [good[0], { asset: 'drive', from: 's5' }, good[2]], register });
  expect(r.results.find((x) => x.name === 'entry starts').level === 'WARN', 's5 is not a chapter start');
  r = musicPlanCheck({ plan, scenes, times, music: [good[0], { asset: 'drive', from: 33 }, good[2]], register });
  expect(r.results.find((x) => x.name === 'entry starts').level === 'WARN', '33 s is not a chapter start');
  r = musicPlanCheck({ plan, scenes, times, music: [good[0], { asset: 'drive', from: 30 }, good[2]], register });
  expect(r.results.find((x) => x.name === 'entry starts').level === 'PASS', '30 s is the start of chapter 2');
  // asset not in the register, and a wrong type
  r = musicPlanCheck({ plan, scenes, times, music: [good[0], { asset: 'ghost', from: 's4' }, good[2]], register });
  expect(r.exit === 1 && /ghost/.test(r.results.find((x) => x.name === 'register').text), 'unregistered asset fails');
  r = musicPlanCheck({ plan, scenes, times, music: [good[0], { asset: 'whoosh', from: 's4' }, good[2]], register });
  expect(r.exit === 1 && /not a music asset/.test(r.results.find((x) => x.name === 'register').text), 'an sfx asset is not music');
  // a mood change with a short fade
  r = musicPlanCheck({ plan, scenes, times, music: [good[0], { asset: 'drive', from: 's4', fade: 0.3 }, good[2]], register });
  expect(r.results.find((x) => x.name === 'crossfade').level === 'WARN' && /fades 0.3 s/.test(r.results.find((x) => x.name === 'crossfade').text), 'a 0.3 s fade at a mood change');
  // one music file for the whole video, with several moods planned
  r = musicPlanCheck({ plan, scenes, times, music: 'assets/bed.mp3', register });
  expect(r.results.some((x) => x.name === 'mood' && x.level === 'WARN'), 'one file cannot follow three moods');
  // no register (not in a channel)
  r = musicPlanCheck({ plan: null, scenes, times, music: [good[0]], register: null });
  expect(r.results.find((x) => x.name === 'register').level === 'PASS', 'no register: nothing to check against, not a failure');
  // no chapters
  r = musicPlanCheck({ plan, scenes: [{ template: 'a' }], times: [], music: good, register });
  expect(r.results[0].name === 'chapters', 'no chapters in scenes.json');
  console.log('musicplan selftest: ' + (bad ? 'FAIL' : 'OK'));
  return bad ? 1 : 0;
}

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2);
  if (a.includes('--selftest')) process.exitCode = selftest();
  else cli(a.filter((x) => !x.startsWith('--')), { json: a.includes('--json') });
}
