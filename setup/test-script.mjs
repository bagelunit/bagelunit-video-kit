#!/usr/bin/env node
// Tests for the staged script flow (studio/tools/scriptcheck.mjs, scriptgate.mjs and the three script skills in the channel
// template): the long-form linter, the human score, the script fingerprint, the gate before the voice (a current fact check
// PASS and a recorded "Script review" of 90 or more for exactly these words), the recorder and the owner's override.
// No network, no key, no browser, no ffmpeg. Fixtures are written here into temp folders; each test builds its own.
// Run: node setup/test-script.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(REPO, 'studio', 'tools');
// dynamic import by file URL (Windows: a bare absolute path is not a valid module specifier)
const sc = await import(pathToFileURL(path.join(TOOLS, 'scriptcheck.mjs')).href);
const gate = await import(pathToFileURL(path.join(TOOLS, 'scriptgate.mjs')).href);
const checks = await import(pathToFileURL(path.join(TOOLS, 'checks.mjs')).href);

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'video-script-test-')));
const lines = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/);
const codesOf = (r) => new Set(r.findings.map((f) => f.code));
const sevOf = (r, code) => r.findings.find((f) => f.code === code)?.sev;

const GOOD = sc.SAMPLE_GOOD;
const RESEARCH = `# Research
## What was found
- A lighthouse beam can be seen from about 30 miles away (https://example.org/lighthouse-range)
- Augustin Fresnel built his lens in 1822 (https://example.org/fresnel)
- About 80% of a lamp's light ends up in the beam of a Fresnel lens (https://example.org/lens-efficiency)
## Sources
1. https://example.org/lighthouse-range
2. https://example.org/fresnel
`;

// a channel folder with one video; every part can be replaced
function makeVideo({ script = GOOD, outline = '# Map\n\nEstimated length: 2.3 minutes\n', video = {}, brand = {}, jargon = null, scenes = null, research = RESEARCH } = {}) {
  const root = tmp(), dir = path.join(root, 'videos', 'lens');
  fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
  fs.mkdirSync(path.join(root, 'brand'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brand', 'brand.json'), JSON.stringify({ name: 'Quark Street', slug: 'quark-street', cta: { line: 'Subscribe for the next one.' }, ...brand }));
  fs.writeFileSync(path.join(root, 'brand', 'facts.md'), '# Facts\n\n## Never say\n');
  if (jargon !== null) fs.writeFileSync(path.join(root, 'brand', 'jargon.md'), jargon);
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ style: 'documentary', title: 'How a lighthouse lens works', end_card: 15, ...video }));
  fs.writeFileSync(path.join(dir, 'outline.md'), outline);
  fs.writeFileSync(path.join(dir, 'research.md'), research);
  if (script !== null) fs.writeFileSync(path.join(dir, 'script.txt'), script);
  if (scenes) fs.writeFileSync(path.join(dir, 'scenes.json'), JSON.stringify(scenes));
  return { root, dir };
}
// scenes.json from the script's paragraphs, a chapter title at the given paragraph numbers
function scenesFrom(script, chapterAt) {
  return { scenes: script.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p, i) => ({ ...(chapterAt[i] ? { chapter: chapterAt[i] } : {}), template: 'title', props: {}, narration: p })) };
}
const run = (script, extra = {}) => { const { dir } = makeVideo({ script, ...extra }); return sc.checkVideo(dir, { write: false }); };
const withPara = (text, ...paras) => `${text.trimEnd()}\n\n${paras.join('\n\n')}\n`;
const reviewLinesOf = (dir) => (fs.existsSync(path.join(dir, 'approvals.md')) ? lines(path.join(dir, 'approvals.md')).filter((l) => /Script review:/.test(l)).length : 0);
const factsPass = (dir) => checks.recordFacts(dir, { scope: 'script', result: 'PASS', note: 'test' });
const ready = () => { const v = makeVideo(); factsPass(v.dir); return v; };

/* ── the linter ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('the built-in selftest passes', () => {
  const r = spawnSync(process.execPath, [path.join(TOOLS, 'scriptcheck.mjs'), '--selftest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /scriptcheck selftest: ok/);
});

await test('a good script passes with no error, and the bad script fails with the expected codes', () => {
  const good = run(GOOD);
  assert.equal(good.pass, true, JSON.stringify(good.findings.filter((f) => f.sev === 'ERROR')));
  assert.equal(good.errors, 0);
  assert.ok(good.human.score >= 90, `human ${good.human.score}`);
  const bad = run(sc.SAMPLE_BAD, { outline: 'Estimated length: 10 minutes' });
  assert.equal(bad.pass, false);
  for (const c of ['F01', 'S02', 'L01', 'R01', 'N01', 'T01', 'W01', 'E03', 'E04', 'O01', 'H10']) assert.ok(codesOf(bad).has(c), `${c} missing from ${[...codesOf(bad)].join(' ')}`);
});

await test('the command prints CODE severity message lines and a final PASS or FAIL, with the exit code', () => {
  const g = makeVideo(), b = makeVideo({ script: sc.SAMPLE_BAD });
  const rg = spawnSync(process.execPath, [path.join(TOOLS, 'scriptcheck.mjs'), g.dir], { encoding: 'utf8' });
  const rb = spawnSync(process.execPath, [path.join(TOOLS, 'scriptcheck.mjs'), b.dir], { encoding: 'utf8' });
  assert.equal(rg.status, 0, rg.stdout + rg.stderr);
  assert.equal(rb.status, 1);
  const lg = rg.stdout.trim().split(/\r?\n/), lb = rb.stdout.trim().split(/\r?\n/);
  assert.match(lg.at(-1), /^PASS \(\d+ warnings?\)$/);
  assert.match(lb.at(-1), /^FAIL \(\d+ errors?, \d+ warnings?\)$/);
  for (const l of lb.slice(1, -1)) assert.match(l, /^[A-Z]\d{2} (ERROR|WARN|INFO) \S/, l);
  assert.ok(fs.existsSync(path.join(b.dir, 'build', 'scriptcheck.md')), 'writes build/scriptcheck.md');
  const j = JSON.parse(spawnSync(process.execPath, [path.join(TOOLS, 'scriptcheck.mjs'), g.dir, '--json', '--no-write'], { encoding: 'utf8' }).stdout);
  assert.equal(j.pass, true); assert.ok(Array.isArray(j.findings));
});

await test('a CRLF script behaves the same as an LF one', () => {
  const lf = run(GOOD), crlf = run(GOOD.replace(/\n/g, '\r\n'));
  assert.deepEqual(crlf.findings, lf.findings);
  assert.equal(crlf.words, lf.words);
});

await test('structure: filler openings, notes and placeholders (the voice reads every line)', () => {
  for (const open of ['Welcome back to the channel.', 'Hey everyone!', 'In this video we will look at lenses.', 'Today we are going to talk about glass.', 'Before we start, subscribe.']) {
    const r = run(`${open} ${GOOD}`);
    assert.equal(sevOf(r, 'F01'), 'ERROR', open);
  }
  assert.equal(sevOf(run(GOOD), 'F01'), undefined);
  const note = run(`# Chapter one\n\n${GOOD}`); assert.equal(sevOf(note, 'S02'), 'ERROR');
  assert.equal(sevOf(run(`${GOOD}\n\n[music sting]\n`), 'S02'), 'ERROR');
  assert.equal(sevOf(run(`${GOOD}\n\nTODO add the story here.\n`), 'S02'), 'ERROR');
  assert.equal(sevOf(run(`${GOOD}\n\nThe lens costs {{needs cleared fact}}.\n`), 'S02'), 'ERROR');
  assert.equal(sevOf(run(''), 'S01'), 'ERROR');
});

await test('the first 30 seconds: lean, snapback and the road ahead are looked for', () => {
  const flat = 'A lighthouse is a tall tower by the sea. It holds a large lamp near the top of the tower. The lamp sits inside a ring of glass pieces. People built these towers on many coasts long ago. Some towers are still in use today, though many are gone. Ships use them to find a safe path past the rocks at night. The first ones burned wood on a hill above the water. Later ones burned oil, and then gas. Keepers climbed the stairs each evening to light the lamp. They wrote down the weather in a big book.';
  const r = run(withPara(flat, ...GOOD.split(/\n\s*\n/).slice(2)));
  assert.ok(codesOf(r).has('H05') && codesOf(r).has('H03') && codesOf(r).has('H04'), [...codesOf(r)].join(' '));
  const g = run(GOOD);
  for (const c of ['H03', 'H04', 'H05', 'H02']) assert.ok(!codesOf(g).has(c), c);
  const long1 = run(GOOD.replace('A lighthouse lamp is about as bright as a car headlight.', 'A lighthouse lamp is about as bright as a car headlight when you look at it from very close up on a clear and calm summer afternoon.'));
  assert.ok(codesOf(long1).has('H02'));
});

await test('chapter hooks come from scenes.json and are read only when the plan matches the script', () => {
  const at = { 0: 'The puzzle', 2: 'The problem', 4: 'The rings', 6: 'The turn', 8: 'The answer' };
  assert.ok(!codesOf(run(GOOD, { scenes: scenesFrom(GOOD, at) })).has('C01'));
  const signpost = GOOD.replace('Why rings? A normal lens', 'Next, let us talk about rings. A normal lens');
  const r = run(signpost, { scenes: scenesFrom(signpost, at) });
  assert.equal(sevOf(r, 'C01'), 'WARN');
  assert.match(r.findings.find((f) => f.code === 'C01').msg, /The rings/);
  const dull = GOOD.replace('Why rings? A normal lens that big would be', 'A normal lens that size would be');
  assert.ok(codesOf(run(dull, { scenes: scenesFrom(dull, at) })).has('C02'));
  // no scenes.json, the sample plan `video new` writes, and a plan that does not match the script: not checked, said so
  assert.equal(sevOf(run(GOOD), 'C00'), 'INFO');
  const sample = { _note: 'A sample plan from the first three documentary templates.', scenes: [{ chapter: 'x', template: 't', props: {}, narration: 'one two three' }] };
  assert.equal(sevOf(run(GOOD, { scenes: sample }), 'C00'), 'INFO');
  assert.equal(sevOf(run(GOOD, { scenes: { scenes: [{ chapter: 'x', template: 't', props: {}, narration: 'one two three' }] } }), 'C00'), 'INFO');
  // a chapter that runs five minutes
  const longChap = withPara(GOOD, ...Array(60).fill('The glass bends the light a little more here and a little less there, and that is how the beam gets its shape. It keeps going.'));
  assert.ok(codesOf(run(longChap, { scenes: scenesFrom(longChap, { 0: 'One long chapter' }) })).has('C03'));
});

await test('the ending: call to action, payoff, a calm last 10 to 20 seconds, no long goodbye', () => {
  const noCta = GOOD.replace('Subscribe for the next one.', 'That was the story of the lens.');
  assert.equal(sevOf(run(noCta), 'E01'), 'ERROR');
  assert.equal(sevOf(run(GOOD), 'E01'), undefined);
  assert.equal(sevOf(run(noCta, { brand: { cta: { line: '' } } }), 'E01'), 'WARN');            // no cta.line: the generic words are looked for
  assert.equal(sevOf(run(GOOD, { brand: { cta: { line: '' } } }), 'E01'), undefined);
  const loud = `${GOOD.trimEnd().replace(/Subscribe for the next one\.$/, '')}It costs 4000 dollars and it lasts 150 years! Subscribe for the next one!\n`;
  assert.equal(sevOf(run(loud), 'E03'), 'WARN');
  assert.equal(sevOf(run(`${GOOD.trimEnd()} Thanks for watching, that is all for today.\n`), 'E04'), 'WARN');
  const filler = 'The glass is cut with care by hand. Some towers have more rings than others, and some have fewer. The tower is painted white near the sea and red in the hills. Each ring has a number stamped on its edge.';
  const noPayoff = withPara(GOOD.split(/\n\s*\n/).slice(0, 5).join('\n\n'), filler, filler, filler, filler, 'Subscribe for the next one.');
  assert.ok(codesOf(run(noPayoff)).has('E02'));
  assert.equal(sevOf(run(GOOD, { video: { title: 'Why ships crashed into cliffs' } }), 'E05'), 'WARN');
  assert.ok(codesOf(run(GOOD, { video: { end_card: 0 } })).has('E06'));
});

await test('sentences over 28 words are errors, fragment runs and staccato scripts are warnings', () => {
  const l = run(GOOD.replace('Only a thin slice ever reaches a ship.', 'Only a thin slice of it ever reaches a ship, and that slice is so small that a sailor who is standing on the deck of a ship far out at sea would never notice it.'));
  assert.equal(sevOf(l, 'L01'), 'ERROR');
  assert.match(l.findings.find((f) => f.code === 'L01').msg, /has 3\d words \(over 28\)/);
  assert.ok(!codesOf(run(GOOD)).has('L01'));
  assert.equal(sevOf(run(withPara(GOOD, 'Glass. Light. Rings. Beam.')), 'R01'), 'WARN');
  assert.ok(!codesOf(run(GOOD)).has('R01'));
  const stacc = Array.from({ length: 30 }, (_, i) => (i % 3 === 2 ? 'The light turns slowly past the rocks and the shore tonight.' : 'It turns.')).join(' ');
  assert.ok(codesOf(run(stacc)).has('R02'));
});

await test('spoken numbers and names: more than about five in a minute is a screen job', () => {
  const many = 'The tower is 120 feet tall, has 400 steps, holds 1100 lenses, cost 90000 dollars, took 14 years and used 3000 bricks.';
  assert.equal(sevOf(run(withPara(GOOD, many)), 'N01'), 'WARN');
  assert.ok(!codesOf(run(GOOD)).has('N01'));
  const names = 'Ada met Bela near Cairo with Dov and Edda, then Faye, Gus, Hana, Ivo and Jules reached Kyoto after Lagos and Madrid.';
  assert.equal(sevOf(run(withPara(GOOD, names)), 'N02'), 'WARN');
  assert.ok(!codesOf(run(GOOD)).has('N02'));
});

await test('a list read aloud needs a lead-in', () => {
  assert.equal(sevOf(run(withPara(GOOD, 'Prisms, mirrors, gears, lamps and bolts.')), 'T01'), 'WARN');
  assert.ok(!codesOf(run(withPara(GOOD, 'Five parts matter: prisms, mirrors, gears, lamps and bolts.'))).has('T01'));
  assert.ok(!codesOf(run(withPara(GOOD, 'Here are the parts. Prisms, mirrors, gears, lamps and bolts.'))).has('T01'));
  assert.ok(!codesOf(run(GOOD)).has('T01'));
});

await test('jargon comes from the channel brand/jargon.md (## Terms) and only when it is there', () => {
  const md = '# Jargon\n\nThe words this channel explains.\n\n## Terms\n- refraction | bending\n- catadioptric | glass that bends and reflects\n';
  const withTerm = withPara(GOOD, 'The effect is called refraction in every textbook, and nobody can see it happen.');
  const unexplained = withPara(GOOD, 'Refraction does all the work here.');
  assert.equal(sevOf(run(unexplained, { jargon: md }), 'J01'), 'WARN');
  assert.ok(!codesOf(run(withTerm, { jargon: md })).has('J01'), 'an explained term is fine');
  assert.ok(!codesOf(run(unexplained)).has('J01'), 'no jargon.md, no check');
  assert.ok(!codesOf(run(unexplained, { jargon: '# Jargon\n\n## Terms\n' })).has('J01'));
  assert.deepEqual(sc.parseJargon(md), ['refraction', 'catadioptric']);
  const four = withPara(GOOD, 'Refraction, catadioptric, prism work, collimation and parallax all matter.');
  const md4 = `${md}- prism work\n- collimation\n- parallax\n`;
  assert.equal(sevOf(run(four, { jargon: md4 }), 'J01'), 'ERROR');
});

await test('words a minute against the planned length: over 15 percent is flagged', () => {
  const g = run(GOOD);                                                 // about 2.3 minutes, the outline says 2.3
  assert.equal(sevOf(g, 'W00'), 'INFO');
  const over = run(GOOD, { outline: 'Estimated length: 1.8 minutes' });  // 2.3 against 1.8 is 28 percent over
  assert.equal(sevOf(over, 'W01'), 'WARN');
  assert.match(over.findings.find((f) => f.code === 'W01').msg, /over/);
  assert.equal(sevOf(run(GOOD, { outline: 'Estimated length: 1.2 minutes' }), 'W01'), 'ERROR');
  assert.equal(sevOf(run(GOOD, { outline: 'The plan is about 1,000 words.' }), 'W01'), 'ERROR');
  assert.equal(sevOf(run(GOOD, { video: { minutes: 4 } }), 'W01'), 'ERROR');
  assert.equal(sevOf(run(GOOD, { video: { minutes: 2.5 } }), 'W01'), undefined);
  assert.match(run(GOOD, { outline: '# nothing' }).findings.find((f) => f.code === 'W00').msg, /no planned length/);
  const r = sc.checkScript(GOOD, { planned: { minutes: 2.3, from: 'x' }, speed: 1.2 });         // a faster voice shortens the video
  assert.equal(Math.round(r.wpm), 180);
  assert.equal(sc.plannedMinutes('Estimated length: 8 to 10 minutes', {}).minutes, 9);
  assert.equal(sc.plannedMinutes('', {}, '12').minutes, 12);
});

await test('repeated sentence openings are flagged', () => {
  const r = run(withPara(GOOD, 'Then the lens turns. Then the light moves. Then the ship sees it. Then it is gone.'));
  assert.equal(sevOf(r, 'O01'), 'WARN');
  assert.ok(!codesOf(run(GOOD)).has('O01'));
  const links = run(withPara(GOOD, 'Read more at https://example.org/lens/page now.'));
  assert.equal(sevOf(links, 'U01'), 'WARN');
});

/* ── the human score ────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('the human score is a number out of 100: varied text clears 90, even or stock-phrase text does not', () => {
  const g = sc.humanScore(GOOD);
  assert.ok(Number.isInteger(g.score) && g.score >= 90 && g.score <= 100, `score ${g.score}`);
  const even = Array.from({ length: 24 }, () => 'The glass bends the light toward the sea in one steady beam.').join(' ');
  assert.ok(sc.humanScore(even).score < 70, `even ${sc.humanScore(even).score}`);
  const stock = GOOD.replace('The lamp was never the clever part.', 'Moreover, it is important to note that this robust, seamless, cutting-edge lens is a game changer that will unlock and leverage the power of light.');
  assert.ok(sc.humanScore(stock).score < g.score, 'stock phrases lower it');
  assert.match(sc.humanScore(stock).notes.join(' '), /stock phrases/);
  assert.equal(sc.humanScore('Too short.').score, null);
  const em = GOOD.replace('The secret is glass, cut in rings.', 'The secret is glass \u2014 cut in rings \u2014 and \u2026 more.');
  assert.ok(sc.humanScore(em).parts.typography < 100);
});

await test('the human bar and the banned phrases come from brand.json "writing"', () => {
  const brandBan = { writing: { banned_phrases: ['hard beam', 'tiny lighthouse lens', 'the clever part'] } };
  const plain = run(GOOD), banned = run(GOOD, { brand: brandBan });
  assert.ok(banned.human.score < plain.human.score, `${banned.human.score} < ${plain.human.score}`);
  assert.match(banned.human.notes.join(' '), /stock phrases/);
  const high = run(GOOD, { brand: { writing: { human_score_min: 99 } } });
  assert.equal(high.human.bar, 99);
  assert.equal(sevOf(high, 'H10'), 'ERROR'); assert.equal(high.pass, false);
  assert.equal(sevOf(run(GOOD, { brand: { writing: { human_score_min: 50 } } }), 'H10'), 'INFO');
  assert.equal(plain.human.bar, 90);                                   // default
  const bad = run(sc.SAMPLE_BAD);
  assert.equal(sevOf(bad, 'H10'), 'ERROR'); assert.match(bad.findings.find((f) => f.code === 'H10').msg, /under the bar of 90/);
});

/* ── the fingerprint ────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('the script hash is 12 hex characters, stable for spacing and case, and changes with any word', () => {
  const { dir } = makeVideo();
  const h = gate.scriptHash(dir);
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(gate.scriptHash(dir), h, 'stable');
  fs.writeFileSync(path.join(dir, 'script.txt'), GOOD.replace(/\n/g, '\r\n').toUpperCase().replace(/ /g, '  '));
  assert.equal(gate.scriptHash(dir), h, 'CRLF, case and extra spaces do not change it');
  fs.writeFileSync(path.join(dir, 'script.txt'), `\uFEFF${GOOD}`);
  assert.equal(gate.scriptHash(dir), h, 'a byte-order mark does not change it');
  fs.writeFileSync(path.join(dir, 'script.txt'), GOOD.replace('thirty miles', 'forty miles'));
  assert.notEqual(gate.scriptHash(dir), h, 'one word changes it');
  fs.writeFileSync(path.join(dir, 'script.txt'), GOOD.replace('away. How?', 'away! How?'));
  assert.notEqual(gate.scriptHash(dir), h, 'punctuation changes how it is spoken, so it changes it');
  fs.rmSync(path.join(dir, 'script.txt'));
  assert.equal(gate.scriptHash(dir), null);
  const r = spawnSync(process.execPath, [path.join(TOOLS, 'scriptcheck.mjs'), makeVideo().dir, '--hash'], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), h);
});

/* ── the gate ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('the gate refuses with no script, then with no fact check, then with no review; passes after both', () => {
  const none = makeVideo({ script: null });
  assert.match(gate.scriptProblem(none.dir), /fact check is not a current PASS/);
  const v = makeVideo();
  assert.match(gate.scriptProblem(v.dir), /no fact check recorded/);
  factsPass(v.dir);
  assert.equal(gate.factsProblem(v.dir), null);
  assert.match(gate.scriptProblem(v.dir), /no "Script review" line/);
  const rec = gate.recordScriptReview(v.dir, { score: 92, notes: 'weakest: pace', by: 'test' });
  assert.equal(gate.scriptProblem(v.dir), null);
  assert.equal(rec.hash, gate.scriptHash(v.dir));
});

await test('the recorded line has the exact format and sits in approvals.md without changing earlier lines', () => {
  const v = ready();
  const before = fs.readFileSync(path.join(v.dir, 'approvals.md'), 'utf8');
  const rec = gate.recordScriptReview(v.dir, { score: 93, notes: 'weakest: hook \u2014 fine', by: 'script-score' });
  assert.match(rec.line, /^Script review: meets the bar \(93\/100; weakest: hook - fine; by script-score\) \[script [0-9a-f]{12}\]$/);
  assert.ok(!rec.line.includes('\u2014'), 'no em dash is written');
  const after = fs.readFileSync(path.join(v.dir, 'approvals.md'), 'utf8');
  assert.ok(after.includes('## Fact check'), 'the fact check section is still there');
  const beforeLines = before.split(/\r?\n/).filter(Boolean);
  for (const l of beforeLines) assert.ok(after.includes(l), `earlier line kept: ${l}`);
  assert.equal(lines(path.join(v.dir, 'approvals.md')).filter((l) => /Script review:/.test(l)).length, 1);
  assert.match(after, /## Script review\n- \d{4}-\d\d-\d\d \d\d:\d\d  Script review: meets the bar/);
  const st = gate.reviewState(v.dir);
  assert.deepEqual([st.kind, st.score, st.hash], ['meets', 93, gate.scriptHash(v.dir)]);
  // a second record adds a line, the first stays
  gate.recordScriptReview(v.dir, { score: 95 });
  const all = lines(path.join(v.dir, 'approvals.md')).filter((l) => /Script review:/.test(l));
  assert.equal(all.length, 2); assert.match(all[0], /93\/100/); assert.match(all[1], /95\/100; no notes/);
  // later headings keep their place: a fact check recorded afterwards lands in its own section
  checks.recordFacts(v.dir, { scope: 'script', result: 'PASS', note: 'again' });
  assert.equal(lines(path.join(v.dir, 'approvals.md')).filter((l) => /Script review:/.test(l)).length, 2);
});

await test('the recorder refuses below 90, a bad score, no script, a stale fact check and a script with errors', () => {
  const v = ready();
  for (const s of [89.9, 80, 0, -5, 101, 'high', undefined, NaN]) assert.throws(() => gate.recordScriptReview(v.dir, { score: s }), /bar is 90|0 to 100/, String(s));
  assert.equal(reviewLinesOf(v.dir), 0, 'nothing was written');
  assert.throws(() => gate.recordScriptReview(makeVideo({ script: null }).dir, { score: 95 }), /no script\.txt/);
  const stale = makeVideo(); assert.throws(() => gate.recordScriptReview(stale.dir, { score: 95 }), /not recorded: .*fact check/);
  // the script changes after the fact check: the fact check is stale, so no review can be recorded
  fs.writeFileSync(path.join(v.dir, 'script.txt'), GOOD.replace('A bare lamp', 'A naked lamp'));
  assert.throws(() => gate.recordScriptReview(v.dir, { score: 95 }), /words or the research changed/);
  // a script that fails its own check cannot be recorded even with a high score and a fact check
  const e = makeVideo({ script: sc.SAMPLE_GOOD.replace('A lighthouse lamp', 'Welcome back. A lighthouse lamp') });
  factsPass(e.dir);
  assert.throws(() => gate.recordScriptReview(e.dir, { score: 95 }), /script check has \d error/);
  assert.equal(reviewLinesOf(e.dir), 0);
});

await test('a changed script cancels the review: the gate closes and names why', () => {
  const v = ready();
  gate.recordScriptReview(v.dir, { score: 91, notes: 'ok' });
  assert.equal(gate.scriptProblem(v.dir), null);
  fs.writeFileSync(path.join(v.dir, 'script.txt'), GOOD.replace('about eighty percent', 'about eighty percent, give or take'));
  assert.match(gate.scriptProblem(v.dir), /words or the research changed/, 'the fact check goes stale first');
  checks.recordFacts(v.dir, { scope: 'script', result: 'PASS', note: 'again' });
  assert.equal(gate.factsProblem(v.dir), null);
  const p = gate.scriptProblem(v.dir);
  assert.match(p, /changed after it was reviewed/); assert.match(p, /\[script [0-9a-f]{12}\]/);
  gate.recordScriptReview(v.dir, { score: 91 });
  assert.equal(gate.scriptProblem(v.dir), null, 'a fresh review for the new words opens it again');
});

await test('the latest line wins, a weak or hand-written line does not open the gate', () => {
  const v = ready(), f = path.join(v.dir, 'approvals.md'), h = gate.scriptHash(v.dir);
  const addLine = (t) => fs.appendFileSync(f, `\n## Script review\n- 2026-11-17 10:00  ${t}\n`);
  addLine(`Script review: meets the bar (88/100; weakest: hook) [script ${h}]`);
  assert.match(gate.scriptProblem(v.dir), /scores 88\/100, under the bar of 90/);
  addLine(`Script review: meets the bar (95/100; weakest: hook)`);
  assert.match(gate.scriptProblem(v.dir), /names no script/);
  addLine(`Script review: looks fine (95/100) [script ${h}]`);
  assert.match(gate.scriptProblem(v.dir), /does not say "meets the bar"/);
  addLine(`Script review: meets the bar [script ${h}]`);
  assert.match(gate.scriptProblem(v.dir), /no score/);
  addLine(`Script review: meets the bar (4.5/5; weakest: hook) [script ${h}]`);
  assert.equal(gate.scriptProblem(v.dir), null, '4.5 out of 5 is 90');
  addLine(`Script review: meets the bar (90/100; weakest: hook) [script ${'0'.repeat(12)}]`);
  assert.match(gate.scriptProblem(v.dir), /changed after it was reviewed/);
  assert.equal(gate.lineScore('(92/100; x'), 92);
});

await test('the owner override needs a reason, is recorded as its own line, is tied to the script and never skips the fact check', () => {
  const v = ready();
  assert.match(gate.scriptGate(v.dir, {}), /Only the owner overrides this, with  --skip-script-review "reason"/);
  assert.match(gate.scriptGate(v.dir, { 'skip-script-review': true }), /needs a reason in quotes/);
  assert.match(gate.scriptGate(v.dir, { 'skip-script-review': '' }), /needs a reason in quotes/);
  assert.throws(() => gate.recordScriptSkip(v.dir, ' '), /needs a reason/);
  assert.equal(reviewLinesOf(v.dir), 0, 'nothing written yet');
  const out = []; const log = console.log; console.log = (s) => out.push(s);
  let res; try { res = gate.scriptGate(v.dir, { 'skip-script-review': 'the owner read it aloud twice and signed it off' }); } finally { console.log = log; }
  assert.equal(res, null);
  assert.ok(out.some((l) => /skipped by the owner/.test(l)));
  const l = lines(path.join(v.dir, 'approvals.md')).filter((x) => /Script review:/.test(x));
  assert.equal(l.length, 1);
  assert.match(l[0], /Script review: SKIPPED by the owner \(--skip-script-review\): the owner read it aloud twice and signed it off \[script [0-9a-f]{12}\]/);
  assert.equal(gate.scriptProblem(v.dir), null, 'the skip opens the gate for these words');
  assert.equal(gate.reviewState(v.dir).kind, 'skipped');
  // another word: the skip no longer fits
  fs.writeFileSync(path.join(v.dir, 'script.txt'), GOOD.replace('car headlight', 'torch'));
  assert.match(gate.scriptGate(v.dir, { 'skip-script-review': 'again' }), /fact check/, 'the fact check is not skippable');
  checks.recordFacts(v.dir, { scope: 'script', result: 'PASS' });
  assert.match(gate.reviewProblem(v.dir), /changed after the owner skipped its review/);
  assert.equal(gate.scriptGate(v.dir, { 'skip-script-review': 'new words, same reason' }), null);
  assert.equal(reviewLinesOf(v.dir), 2);
  // a real review recorded afterwards is the latest line and counts as itself
  gate.recordScriptReview(v.dir, { score: 94 });
  assert.equal(gate.reviewState(v.dir).kind, 'meets');
});

await test('the command line: status, hash, record and skip, with exit codes', () => {
  const v = ready(), gateJs = path.join(TOOLS, 'scriptgate.mjs');
  const go = (...a) => spawnSync(process.execPath, [gateJs, v.dir, ...a], { encoding: 'utf8' });
  let r = go('--status'); assert.equal(r.status, 1); assert.match(r.stdout, /script gate: CLOSED/);
  r = go('--hash'); assert.equal(r.status, 0); assert.match(r.stdout.trim(), /^[0-9a-f]{12}$/);
  r = go('--record', '--score', '85'); assert.equal(r.status, 1); assert.match(r.stderr, /bar is 90/);
  r = go('--record', '--score', '92', '--notes', 'weakest: pace'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /recorded in approvals\.md: Script review: meets the bar \(92\/100; weakest: pace/);
  r = go('--status'); assert.equal(r.status, 0); assert.match(r.stdout, /OPEN.*92/);
  r = go(); assert.equal(r.status, 0); assert.match(r.stdout, /PASS/); assert.match(r.stdout, /fingerprint \[script [0-9a-f]{12}\]/);
  r = go('--human'); assert.equal(r.status, 0); assert.match(r.stdout, /human score: \d+\/100 \(bar 90: met\)/);
  const w = makeVideo(), r2 = spawnSync(process.execPath, [gateJs, w.dir, '--skip-script-review'], { encoding: 'utf8' });
  assert.equal(r2.status, 1); assert.match(r2.stderr, /needs a reason/);
  const r3 = spawnSync(process.execPath, [gateJs, w.dir, '--skip-script-review', 'owner says go'], { encoding: 'utf8' });
  assert.equal(r3.status, 0, r3.stderr); assert.match(r3.stdout, /SKIPPED by the owner/);
});

/* ── the skills ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
await test('the three script skills ship in the channel template, with the same frontmatter and tone as the others', () => {
  const dir = path.join(REPO, 'template', '.claude', 'skills');
  const text = {};
  for (const name of ['script-plan', 'script-coldread', 'script-score']) {
    const f = path.join(dir, name, 'SKILL.md');
    assert.ok(fs.existsSync(f), `${name}/SKILL.md`);
    const t = text[name] = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    assert.match(t, new RegExp(`^---\\nname: ${name}\\ndescription: >\\n`), `${name} frontmatter`);
    for (const k of ['user-invokable: true', 'argument-hint:', 'metadata:', '  author: BagelUnit', '  version: "1.0.0"', '  category:']) assert.ok(t.includes(k), `${name}: ${k}`);
    assert.match(t, /Trigger:/); assert.match(t, /Inputs:/); assert.match(t, /Outputs:/); assert.match(t, /Next step:/);
    assert.ok(!t.includes('\u2014'), `${name}: no em dash`);
    assert.match(t, /AskUserQuestion/, `${name} asks with AskUserQuestion`);
    assert.ok(!/ig-human|reel-|Instagram|\bkit gate\b|Gate A/.test(t), `${name} is long-form, not the Reel Kit's`);
  }
  assert.match(text['script-coldread'], /Agent tool/); assert.match(text['script-coldread'], /fresh agent/i); assert.match(text['script-coldread'], /ONLY/);
  assert.match(text['script-score'], /--record/); assert.match(text['script-score'], /\b90\b/); assert.match(text['script-score'], /\[script <hash>\]|\[script /);
  assert.match(text['script-score'], /skip-script-review/); assert.match(text['script-plan'], /chapter/i);
  assert.match(text['script-plan'], /minutes/);
});

await test('the engine files carry no em dash and no personal path', () => {
  for (const f of [path.join(TOOLS, 'scriptcheck.mjs'), path.join(TOOLS, 'scriptgate.mjs'), fileURLToPath(import.meta.url)]) {
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!t.includes(String.fromCharCode(0x2014)), `${f}: em dash`);
    assert.ok(!/\/Users\/[a-z]/i.test(t), `${f}: personal path`);
  }
});

console.log(`\n${n} test${n === 1 ? '' : 's'} run${process.exitCode ? ', some FAILED' : ', all passed'}`);
