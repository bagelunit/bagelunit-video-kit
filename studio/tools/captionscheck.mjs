// captionscheck.mjs · can people read the captions in time? Reading speed and line limits, per caption, with times.
//
//   node captionscheck.mjs <video folder> [--words] [--lang en]   the folder's out/captions.<lang>.srt (what is uploaded), or, with
//                                                                 --words or when there is none, the captions the kit would make
//                                                                 from build/words.json (the same grouping as  video captions)
//   node captionscheck.mjs <file.srt | file.vtt>                  any caption file
//   node captionscheck.mjs --selftest
//
// Flags: --max-cps 17 (characters per second), --json. Exit 1 on any FAST or too-long caption, 2 when it could not run.
//   FAST     over 17 characters per second (the YouTube / Netflix adult limit; spaces count, line breaks do not)   FAIL
//   LONG     a line over 42 characters, or more than 2 lines                                                      FAIL
//   SHORT    on screen under 1.0 s with 3 or more words (a flash nobody can read)                                  WARN
//   WPM      words per minute is printed for each flagged caption; over 220 is a WARN on its own
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = { cps: 17, chars: 42, lines: 2, shortSeconds: 1.0, shortWords: 3, wpmWarn: 220 };
const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
const readJSON = (f, d) => { try { return JSON.parse(read(f)); } catch { return d; } };
const posix = (p) => String(p).split(path.sep).join('/');
const clock = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

const stamp = (h, m, s, ms) => (Number(h || 0) * 3600) + Number(m) * 60 + Number(s) + Number(String(ms).padEnd(3, '0').slice(0, 3)) / 1000;
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
// SRT or WebVTT text -> [{start, end, lines}]
export function parseCaptions(text) {
  const cues = [];
  for (const block of String(text).replace(/^﻿/, '').split(/\r?\n\s*\r?\n/)) {
    const rows = block.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
    const k = rows.findIndex((l) => TIME.test(l));
    if (k < 0) continue;                                     // WEBVTT header, NOTE, STYLE or junk
    const m = TIME.exec(rows[k]);
    const lines = rows.slice(k + 1).map((l) => l.replace(/<[^>]*>/g, '').trim()).filter(Boolean);
    if (!lines.length) continue;
    cues.push({ start: stamp(m[1], m[2], m[3], m[4]), end: stamp(m[5], m[6], m[7], m[8]), lines });
  }
  return cues;
}

export function captionsCheck(cues, { cps = LIMITS.cps } = {}) {
  const rows = cues.map((c, i) => {
    const text = c.lines.join(' '), words = text.split(/\s+/).filter(Boolean).length, dur = Math.max(0.001, c.end - c.start);
    return { n: i + 1, start: c.start, end: c.end, dur, chars: text.length, words, cps: text.length / dur, wpm: words / dur * 60, lines: c.lines, longest: Math.max(...c.lines.map((l) => l.length)) };
  });
  const found = [];
  for (const r of rows) {
    const sample = `"${r.lines.join(' / ').slice(0, 60)}"`;
    if (r.cps > cps) found.push({ level: 'FAIL', kind: 'FAST', n: r.n, t: r.start, text: `caption ${r.n} at ${clock(r.start)}: ${r.cps.toFixed(1)} characters/s (limit ${cps}), ${r.wpm.toFixed(0)} words/min, ${r.chars} characters in ${r.dur.toFixed(1)} s ${sample}` });
    if (r.longest > LIMITS.chars) found.push({ level: 'FAIL', kind: 'LONG', n: r.n, t: r.start, text: `caption ${r.n} at ${clock(r.start)}: a line of ${r.longest} characters (limit ${LIMITS.chars}) ${sample}` });
    if (r.lines.length > LIMITS.lines) found.push({ level: 'FAIL', kind: 'LONG', n: r.n, t: r.start, text: `caption ${r.n} at ${clock(r.start)}: ${r.lines.length} lines (limit ${LIMITS.lines}) ${sample}` });
    if (r.dur < LIMITS.shortSeconds && r.words >= LIMITS.shortWords) found.push({ level: 'WARN', kind: 'SHORT', n: r.n, t: r.start, text: `caption ${r.n} at ${clock(r.start)}: up only ${r.dur.toFixed(2)} s for ${r.words} words ${sample}` });
    if (r.wpm > LIMITS.wpmWarn && r.cps <= cps && r.words >= LIMITS.shortWords) found.push({ level: 'WARN', kind: 'WPM', n: r.n, t: r.start, text: `caption ${r.n} at ${clock(r.start)}: ${r.wpm.toFixed(0)} words/min (over ${LIMITS.wpmWarn}) ${sample}` });
  }
  const n = rows.length || 1, sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const stats = { captions: rows.length, avgCps: +(sum((r) => r.cps) / n).toFixed(1), maxCps: +Math.max(0, ...rows.map((r) => r.cps)).toFixed(1), avgWpm: +(sum((r) => r.wpm) / n).toFixed(0), maxWpm: +Math.max(0, ...rows.map((r) => r.wpm)).toFixed(0), longestLine: Math.max(0, ...rows.map((r) => r.longest)) };
  const fails = found.filter((f) => f.level === 'FAIL'), warns = found.filter((f) => f.level === 'WARN');
  const results = [
    { level: 'INFO', name: 'captions', text: `${stats.captions} captions, ${stats.avgCps} characters/s on average (fastest ${stats.maxCps}), ${stats.avgWpm} words/min (fastest ${stats.maxWpm}), longest line ${stats.longestLine} characters` },
    ...['FAST', 'LONG', 'SHORT', 'WPM'].map((kind) => {
      const own = found.filter((f) => f.kind === kind);
      const label = { FAST: `reading speed (limit ${cps} characters/s)`, LONG: `line limits (${LIMITS.chars} characters, ${LIMITS.lines} lines)`, SHORT: `on screen at least ${LIMITS.shortSeconds} s`, WPM: `words per minute (under ${LIMITS.wpmWarn})` }[kind];
      return { level: own.length ? own[0].level : 'PASS', name: kind.toLowerCase(), text: own.length ? `${own.length} caption(s) break the rule: ${label}` : `all within ${label}` };
    }),
  ];
  return { results, found, stats, exit: fails.length ? 1 : 0, failCount: fails.length, warnCount: warns.length };
}

// the captions the kit would make from build/words.json: the grouping of  video captions  (captionCues in video.mjs)
export async function cuesFromWords(dir) {
  const words = readJSON(path.join(dir, 'build', 'words.json'), null);
  if (!Array.isArray(words) || !words.length) throw new Error('no build/words.json: voice the script first (video voice <folder>)');
  const { captionCues } = await import('./video.mjs');
  const brand = readJSON(path.join(dir, '..', '..', 'brand', 'brand.json'), null);
  return captionCues(words, { pronunciation: brand?.voice?.pronunciation });
}

export async function checkTarget(target, { words = false, lang = null, cps = LIMITS.cps } = {}) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`${posix(target)} does not exist`);
  let cues, source;
  if (fs.statSync(abs).isFile()) { cues = parseCaptions(read(abs)); source = posix(path.basename(abs)); }
  else {
    const out = path.join(abs, 'out');
    const srts = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => /^captions\..+\.srt$/.test(f)).sort() : [];
    const pick = lang ? `captions.${lang}.srt` : srts.includes('captions.en.srt') ? 'captions.en.srt' : srts[0];
    if (!words && pick && fs.existsSync(path.join(out, pick))) { cues = parseCaptions(read(path.join(out, pick))); source = `out/${pick}`; }
    else { cues = await cuesFromWords(abs); source = 'build/words.json (the grouping of video captions)'; }
  }
  if (!cues.length) throw new Error(`no captions found in ${source}`);
  return { source, ...captionsCheck(cues, { cps }) };
}

export async function cli(loose, flags = {}) {
  const target = loose[0];
  if (!target) { console.log('usage: node captionscheck.mjs <video folder | file.srt | file.vtt> [--words] [--lang en] [--max-cps 17] [--json]   |   --selftest'); process.exitCode = 2; return; }
  let res;
  try { res = await checkTarget(target, { words: Boolean(flags.words), lang: typeof flags.lang === 'string' ? flags.lang : null, cps: Number(flags['max-cps']) || LIMITS.cps }); }
  catch (e) { console.log(`captions check could not run: ${e.message}`); process.exitCode = 2; return; }
  if (flags.json) console.log(JSON.stringify(res, null, 1));
  else {
    console.log(`captions: ${res.source}`);
    for (const r of res.results) console.log(`${r.level.padEnd(5)} ${r.name.padEnd(8)} ${r.text}`);
    for (const f of res.found.slice(0, 40)) console.log(`${f.level.padEnd(5)} ${f.kind.padEnd(8)} ${f.text}`);
    if (res.found.length > 40) console.log(`...and ${res.found.length - 40} more (use --json for all)`);
  }
  process.exitCode = res.exit;
}

/* ── selftest ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
export async function selftest() {
  let bad = 0;
  const expect = (cond, msg) => { if (!cond) { bad++; console.log(`FAIL selftest: ${msg}`); } };
  const good = '1\r\n00:00:00,000 --> 00:00:03,000\r\nThe city drank a billion\r\nliters a day.\r\n\r\n2\r\n00:00:03,500 --> 00:00:06,500\r\nThen the pumps failed.\r\n';
  let cues = parseCaptions(good);
  expect(cues.length === 2 && cues[0].lines.length === 2 && cues[1].start === 3.5, 'CRLF SRT parse: ' + JSON.stringify(cues));
  let r = captionsCheck(cues);
  expect(r.exit === 0 && r.stats.captions === 2, 'a good file should pass: ' + JSON.stringify(r.found));
  // FAST: 60 characters in 2 s = 30 cps
  const fast = '1\n00:00:00,000 --> 00:00:02,000\nThis caption has far too many letters for the time\nit stays up.\n';
  r = captionsCheck(parseCaptions(fast));
  expect(r.exit === 1 && r.found.some((f) => f.kind === 'FAST'), 'a 30 cps caption should be FAST');
  // LONG: a 50 character line, and three lines
  r = captionsCheck(parseCaptions('1\n00:00:00,000 --> 00:00:10,000\n' + 'x'.repeat(50) + '\n'));
  expect(r.exit === 1 && r.found.some((f) => f.kind === 'LONG'), 'a 50 character line is too long');
  r = captionsCheck(parseCaptions('1\n00:00:00,000 --> 00:00:10,000\na b\nc d\ne f\n'));
  expect(r.exit === 1 && r.found.some((f) => f.kind === 'LONG' && /3 lines/.test(f.text)), 'three lines is too many');
  // SHORT: 3 words in 0.8 s is a warning, not a failure
  r = captionsCheck(parseCaptions('1\n00:00:00,000 --> 00:00:00,800\nOne two three\n'));
  expect(r.exit === 0 && r.found.some((f) => f.kind === 'SHORT'), 'a short 3 word caption is a WARN');
  r = captionsCheck(parseCaptions('1\n00:00:00,000 --> 00:00:00,500\nOk\n'));
  expect(!r.found.some((f) => f.kind === 'SHORT'), 'a 1 word caption may be short');
  // VTT
  cues = parseCaptions('WEBVTT\n\nNOTE a comment\n\n00:01.000 --> 00:03.000 align:start\n<c.yellow>Hello there</c>\n\n01:00:00.500 --> 01:00:02.000\nLate one\n');
  expect(cues.length === 2 && cues[0].lines[0] === 'Hello there' && cues[1].start === 3600.5, 'VTT parse: ' + JSON.stringify(cues));
  // words.json grouping (the kit's own captionCues)
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(process.env.TMPDIR || process.env.TEMP || '/tmp'), 'capcheck-'));
  try {
    fs.mkdirSync(path.join(dir, 'build'));
    const ws = []; let t = 0;
    for (const w of 'Water covers most of the planet but almost none of it is safe to drink. Only a tiny share is fresh.'.split(' ')) { ws.push({ w, s: t, e: t + 0.3 }); t += 0.35; }
    fs.writeFileSync(path.join(dir, 'build', 'words.json'), JSON.stringify(ws));
    const res = await checkTarget(dir, { words: true });
    expect(res.stats.captions >= 2 && res.exit === 0, 'words.json at a calm pace should pass: ' + JSON.stringify(res.found));
    const quick = ws.map((w, i) => ({ w: w.w, s: i * 0.12, e: i * 0.12 + 0.1 }));
    fs.writeFileSync(path.join(dir, 'build', 'words.json'), JSON.stringify(quick));
    const res2 = await checkTarget(dir, { words: true });
    expect(res2.exit === 1 && res2.found.some((f) => f.kind === 'FAST'), 'words spoken at 8 words/s should be FAST');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('captionscheck selftest: ' + (bad ? 'FAIL' : 'OK'));
  return bad ? 1 : 0;
}

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const a = process.argv.slice(2), flags = {}, loose = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); if (['lang', 'max-cps'].includes(k)) flags[k] = a[++i]; else flags[k] = true; } else loose.push(a[i]);
  }
  if (flags.selftest) process.exitCode = await selftest();
  else await cli(loose, flags);
}
