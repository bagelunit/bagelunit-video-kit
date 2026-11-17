#!/usr/bin/env node
// scriptcheck.mjs · does this long-form script work when it is heard once? Deterministic checks, no model, no network,
// no credits. The Video Kit's own version of the staged script flow (the Reel Kit has a short-form one; nothing is shared).
//
//   node scriptcheck.mjs <video folder> [--minutes N] [--json] [--no-write]    check script.txt
//   node scriptcheck.mjs <video folder> --hash                                the script's fingerprint (12 hex characters)
//   node scriptcheck.mjs --selftest
//
// Reads <video>/script.txt (EVERY line of it is voiced: the voice reads the file as it is, so a note line is an error),
// and when they exist outline.md and video.json (the planned length), scenes.json (where the chapters start) and the
// channel's brand/brand.json, brand/jargon.md. Prints one line per finding, "CODE SEVERITY message", then PASS or FAIL
// (FAIL = at least one ERROR; exit code 1). Also writes build/scriptcheck.md for the cold read and the score to read.
//
// Codes:  S structure and notes   F filler openings   H the opening (30 s)   C chapters   E the ending
//         L sentence length   R fragments   N numbers and names   T lists   J jargon   W words a minute
//         O repeated openings   U links and commands   H10 the human score
//
// Module API: checkScript(text, ctx), humanScore(text, opts), spokenHash(text), loadContext(videoDir, opts), SAMPLE_GOOD, SAMPLE_BAD.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WPM = 150;          // spoken words a minute at voice speed 1
export const BAR = 90;           // the owner's rule: anything scored reaches 90 (brand.json "writing.human_score_min" can raise it)
export const LONG = 28;          // words: no one says more in one breath
const read = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; } };
const readJSON = (f, d) => { try { return JSON.parse(read(f)); } catch { return d; } };

/* ── words, sentences, the fingerprint ──────────────────────────────────────────────────────────────────────────────── */
const normWord = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
export const wordsOf = (s) => String(s ?? '').split(/\s+/).filter((t) => normWord(t));
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The script's fingerprint: its words with the case and spacing ignored (punctuation stays, it changes how the voice
// speaks). Every line of script.txt is voiced, so none is left out. A review belongs to one text: change a word and the
// fingerprint changes, and the recorded review no longer fits.
export function spokenHash(text) {
  const t = String(text ?? '').replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return t ? createHash('sha256').update(t).digest('hex').slice(0, 12) : null;
}

const ABBR = /(?<!\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|Jr|Sr|No|Inc|Ltd)\.)(?<!\b[A-HJ-Z]\.)/;
const SPLIT = new RegExp(`(?<=[.!?]["')\\u201d]*)${ABBR.source}\\s+(?=["'(\\u201c]?[\\p{Lu}0-9])`, 'u');
// -> [{ text, n (words), start (index of its first word in the script), para }]
export function sentencesOf(text) {
  const out = []; let at = 0, para = 0;
  for (const p of String(text ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const flat = p.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    for (const s of flat.split(SPLIT)) {
      const t = s.trim(), n = wordsOf(t).length;
      if (!n) continue;
      out.push({ text: t, n, start: at, para });
      at += n;
    }
    para++;
  }
  return out;
}

/* ── the human score ────────────────────────────────────────────────────────────────────────────────────────────────── */
// A small, local stand-in for the Reel Kit's "ig-human" idea, made for narration: machine-written text is even (every
// sentence about the same length), runs on, leans on stock phrases and carries typographic marks a keyboard does not make.
// Four signals, each 0 to 100 (higher is more human); the score weights their mean at 60% and the weakest at 40%, because
// one tell is enough. It is a heuristic of ours, not a commercial detector, and says so.
export const STOCK = ['delve', 'dive into', 'deep dive', 'unlock', 'unleash', 'game changer', 'game-changer', 'game changing', 'game-changing',
  'revolutionize', 'revolutionise', 'in today\'s fast-paced', 'ever-evolving', 'ever evolving', 'tapestry', 'testament to', 'navigate the',
  'it\'s important to note', 'it is important to note', 'it\'s worth noting', 'it is worth noting', 'at the end of the day', 'seamless', 'seamlessly', 'robust',
  'leverage', 'cutting-edge', 'cutting edge', 'state-of-the-art', 'crucial', 'pivotal', 'moreover', 'furthermore', 'in conclusion', 'let\'s dive in',
  'buckle up', 'harness the power', 'embark on a journey', 'whether you\'re a', 'look no further', 'without further ado', 'take it to the next level',
  'in a nutshell', 'the power of', 'plays a crucial role', 'plays a vital role', 'shed light on', 'unravel the', 'the world of', 'rich history',
  'fascinating world', 'little did', 'stay tuned', 'grab a coffee'];
const clamp = (n) => Math.max(0, Math.min(100, n));
const scale = (v, human, machine) => (human === machine ? 50 : clamp(((v - machine) / (human - machine)) * 100));
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

export function humanScore(text, { banned = [], bar = BAR } = {}) {
  const sents = sentencesOf(text), flat = sents.map((s) => s.text).join(' '), total = wordsOf(flat).length;
  const notes = [];
  if (sents.length < 8 || total < 80) return { score: null, bar, notes: ['too short to score (needs 8 sentences and 80 words)'], parts: {} };
  const lens = sents.map((s) => s.n), m = mean(lens), cv = Math.sqrt(mean(lens.map((x) => (x - m) ** 2))) / m;
  const frags = sents.filter((s) => s.n <= 3 && !/\d/.test(s.text)).length, fragShare = frags / sents.length;
  let rhythm = scale(cv, 0.62, 0.25);
  if (fragShare > 0.08) { rhythm = clamp(rhythm - (fragShare - 0.08) * 400); notes.push(`${frags} fragments of 3 words or fewer`); }
  notes.push(`sentence length varies ${cv.toFixed(2)} (want 0.55 or more)`);
  const longN = sents.filter((s) => s.n > LONG).length;
  const longShare = scale(longN / sents.length, 0, 0.1);
  if (longN) notes.push(`${longN} sentence(s) over ${LONG} words`);
  const low = ` ${flat.toLowerCase().replace(/[\u2018\u2019]/g, '\'')} `, hits = [];
  for (const p of [...STOCK, ...banned.map((b) => String(b).toLowerCase())]) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'gu');
    const n = (low.match(re) || []).length;
    if (n) hits.push(...Array(n).fill(p));
  }
  const stock = scale((hits.length * 100) / total, 0, 2);
  if (hits.length) notes.push(`stock phrases: ${[...new Set(hits)].slice(0, 5).join(', ')}${new Set(hits).size > 5 ? ', ...' : ''}`);
  const raw = String(text), marks = [...raw].filter((c) => /\p{Cf}/u.test(c)).length * 4 + (raw.match(/\u2014/g) || []).length * 2 + (raw.match(/\u2026/g) || []).length;
  const fingerprint = scale((marks * 1000) / Math.max(raw.length, 1), 0, 6);
  if (marks) notes.push('invisible characters, em dashes or ellipsis marks in the text');
  const parts = { rhythm: Math.round(rhythm), 'long sentences': Math.round(longShare), 'stock phrases': Math.round(stock), 'typography': Math.round(fingerprint) };
  const vals = [[rhythm, 0.35], [longShare, 0.2], [stock, 0.3], [fingerprint, 0.15]];
  const avg = vals.reduce((a, [v, w]) => a + v * w, 0), weakest = Math.min(...vals.map(([v]) => v));
  const score = Math.floor(avg * 0.6 + weakest * 0.4);
  const worst = Object.entries(parts).sort((a, b) => a[1] - b[1])[0][0];
  return { score, bar, parts, weakest: worst, notes, met: score >= bar };
}

/* ── the context a check reads ──────────────────────────────────────────────────────────────────────────────────────── */
function findBrand(start) {
  let d = path.resolve(start);
  for (;;) {
    const f = path.join(d, 'brand', 'brand.json');
    if (fs.existsSync(f)) return { dir: d, cfg: readJSON(f, {}) };
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

// brand/jargon.md: one term per line under "## Terms", optionally "term | plain swap"
export function parseJargon(md) {
  let t = String(md ?? '');
  t = t.includes('## Terms') ? t.split('## Terms')[1].split(/^##\s/m)[0] : '';
  return t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(#|`|<!--|\()/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').split('|')[0].trim().replace(/`/g, '').toLowerCase()).filter((x) => x.length > 1 && x.length < 40);
}

// the planned length in minutes: --minutes, video.json "minutes", then outline.md ("Estimated length: 12 minutes" or "1800 words")
export function plannedMinutes(outline, cfg = {}, flag) {
  const f = Number(flag); if (f > 0) return { minutes: f, from: '--minutes' };
  const c = Number(cfg.minutes ?? cfg.target_minutes); if (c > 0) return { minutes: c, from: 'video.json' };
  for (const line of String(outline ?? '').split(/\r?\n/)) {
    if (!/length|estimated|runtime|planned|plan|minutes/i.test(line)) continue;
    const mm = line.match(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(?:minutes?|mins?)\b/i);
    if (mm) return { minutes: mm[2] ? (Number(mm[1]) + Number(mm[2])) / 2 : Number(mm[1]), from: 'outline.md' };
    const mw = line.match(/(\d[\d,]*)\s*words\b/i);
    if (mw) return { minutes: Number(mw[1].replace(/,/g, '')) / WPM, from: 'outline.md (words / 150)' };
  }
  return null;
}

export function loadContext(dir, { minutes } = {}) {
  const cfg = readJSON(path.join(dir, 'video.json'), {}) || {};
  const outline = read(path.join(dir, 'outline.md'));
  const brand = findBrand(dir);
  const scenesPlan = readJSON(path.join(dir, 'scenes.json'), null);
  return {
    dir, cfg, outline, brandCfg: brand?.cfg || {},
    jargon: brand ? parseJargon(read(path.join(brand.dir, 'brand', 'jargon.md'))) : [],
    scenes: scenesPlan,
    planned: plannedMinutes(outline, cfg, minutes),
    speed: Number(cfg.voice_speed ?? brand?.cfg?.voice?.speed ?? 1) || 1,
  };
}

/* ── the checks ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const FILLER_OPEN = /^(?:["'(\u201c]?)(?:hey|hi|hello|hiya|welcome|greetings|good (?:morning|afternoon|evening)|what'?s up|what is up|so,? (?:today|in this)|today,? (?:we|i|let)|in (?:this|today'?s) (?:video|episode)|before we (?:start|begin|get started)|thanks? (?:for|so much)|thank you|don'?t forget to|if you'?re new|(?:like|smash) (?:and|the)|in this)\b/i;
const CHAPTER_FILLER = /^(?:next|now|moving on|let'?s (?:move|talk|look|turn|get|dive|jump)|so,? (?:let'?s|now|next)|the next (?:topic|part|section|thing)|chapter|section|part (?:\d|one|two|three|four|five)|on to)\b/i;
const TURN = /\b(?:but|yet|except|actually|turns out|the truth|the real|myth|wrong|not what|not|nobody|no one|most people|everyone|instead|however|isn'?t|aren'?t|wasn'?t|didn'?t|doesn'?t|not because|not the|never)\b/i;
const ROAD = /\b(?:by the end|by the time|you(?:'ll| will)|we(?:'ll| will)|i(?:'ll| will)|let'?s|here'?s (?:how|what|why)|in the next|step by step|you'?re going to|we'?re going to|find out|see (?:how|why|what)|learn)\b/i;
const LEAN = /\?|\d|\b(?:you|your|you're)\b|\b(?:thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|percent)\b/i;
const PAYOFF = /\b(?:that'?s why|that is why|the answer|in short|in the end|to sum up|to recap|remember|now you know|which is why|what we learned|the whole|the secret|the trick|so (?:here|that|the|what|if))\b/i;
const CTA_GENERIC = /\b(?:subscribe|watch (?:next|this|the)|comment|link|description|download|join|follow|try|share|next video|see you)\b/i;
const GOODBYE = /\b(?:that'?s all for today|that is all for today|thanks for watching|thank you for watching|see you (?:next|in the next)|until next time|goodbye|bye for now|that'?s it for (?:this|today))\b/i;
const EXPLAIN = /\b(?:means|is a|is the|are the|that is|that'?s|which is|i\.e\.|basically|in other words|like a|think of|it lets|lets you|called)\b|,\s*(?:a|an|the)\s/i;
const LEADIN = /:|\b(?:these|those|following|here (?:are|is|come)|here'?s|there (?:are|were)|includes?|including|such as|namely|for example|for instance|the (?:list|names|numbers)|(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\w+)\b/i;
const NUMW = new Set(['eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion', 'trillion', 'percent']);
const NAME_SKIP = new Set(['I', 'The', 'This', 'That', 'It', 'And', 'But', 'So', 'If', 'You', 'Your', 'We', 'They', 'He', 'She', 'In', 'On', 'At', 'Is', 'Are', 'What', 'Why', 'How', 'When', 'Where', 'Who', 'Now', 'Then', 'Here', 'There', 'One', 'Two', 'Three', 'Four', 'Five',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const STOP = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'you', 'are', 'was', 'were', 'what', 'how', 'why', 'next', 'more', 'about', 'into', 'have', 'has', 'will', 'can']);
const sig = (s) => wordsOf(s).map(normWord).filter((w) => w.length >= 4 && !STOP.has(w));
const q = (s, n = 70) => `"${s.length > n ? `${s.slice(0, n).trimEnd()}...` : s}"`;

// where each chapter starts, in words, from scenes.json (every word of the script belongs to one scene, in order); null when
// the plan is only the sample `video new` writes, or does not match the script
function chapterStarts(plan, total) {
  const scenes = plan && Array.isArray(plan.scenes) ? plan.scenes : null;
  if (!scenes || !scenes.length || /^A sample plan/.test(String(plan._note || ''))) return null;
  let at = 0; const out = [];
  for (const s of scenes) { if (s.chapter) out.push({ title: String(s.chapter), at }); at += wordsOf(s.narration).length; }
  if (!out.length || Math.abs(at - total) > Math.max(10, total * 0.05)) return null;
  return out;
}

export function checkScript(text, ctx = {}) {
  const out = [];
  const add = (code, sev, msg) => out.push({ code, sev, msg });
  const cfg = ctx.cfg || {}, brandCfg = ctx.brandCfg || {}, speed = ctx.speed || 1;
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const sents = sentencesOf(raw), total = sents.reduce((a, s) => a + s.n, 0);
  const wpm = WPM * speed, wps = wpm / 60;
  if (!total) { add('S01', 'ERROR', 'script.txt is empty or missing'); return finish(out, { words: 0, minutes: 0, wpm, human: null }); }

  // S: structure. The voice reads every line, so a note, a heading or a placeholder would be spoken.
  raw.split('\n').forEach((l, i) => {
    const t = l.trim();
    if (/^(#|\/\/|\[)/.test(t)) add('S02', 'ERROR', `line ${i + 1} is a note or heading (${q(t, 50)}); the voice would read it aloud. Take it out of script.txt`);
    if (/\{\{|\bTODO\b|\bTBD\b|\bXXX\b/.test(t)) add('S02', 'ERROR', `line ${i + 1} still has a placeholder (${q(t, 50)})`);
  });
  if (total < 150) add('S03', 'WARN', `only ${total} words (about ${(total / wpm).toFixed(1)} min): is this a long-form script?`);

  // F: filler openings
  const first = sents[0];
  if (FILLER_OPEN.test(first.text)) add('F01', 'ERROR', `the video opens on filler (${q(first.text, 60)}): open on the subject, never a greeting or "in this video" (playbook/hook-and-packaging.md section 2)`);
  const earlyFiller = sents.slice(1).find((s) => s.start < wps * 60 && /\bin this video\b|\bwelcome (?:back|to)\b|\bsmash\b|\blike and subscribe\b/i.test(s.text));
  if (earlyFiller) add('F02', 'WARN', `filler in the first minute (${q(earlyFiller.text, 60)}): cut it, the viewer came for the subject`);

  // H: the first 30 seconds (the triple hook): context at once, a lean, a contrarian snapback, then the road ahead
  const open30 = sents.filter((s) => s.start < wps * 30), openText = open30.map((s) => s.text).join(' ');
  const open40 = sents.filter((s) => s.start < wps * 40).map((s) => s.text).join(' ');
  if (first.n > 22) add('H02', 'WARN', `the first sentence has ${first.n} words: say what the video is about at once, in a short sentence`);
  if (!LEAN.test(sents.filter((s) => s.start < wps * 20).map((s) => s.text).join(' '))) add('H05', 'WARN', 'no lean in the first 20 s (a number, a question, or the viewer\'s own pain or wish)');
  if (!TURN.test(openText)) add('H03', 'WARN', 'no snapback in the first 30 s: pull the viewer another way ("most people think ... but ..."), and pay it off later');
  if (!ROAD.test(open40)) add('H04', 'WARN', 'the first 30 to 40 s do not say what the viewer will get ("by the end you will know ...")');

  // C: chapters
  const chapters = chapterStarts(ctx.scenes, total);
  if (chapters) {
    chapters.forEach((c, k) => {
      const end = k + 1 < chapters.length ? chapters[k + 1].at : total, len = end - c.at;
      if (len > wps * 60 * 5) add('C03', 'WARN', `chapter "${c.title}" runs about ${(len / wpm).toFixed(1)} min with no new chapter: split it or add a change of pace`);
      if (c.at === 0) return;
      const head = sents.filter((s) => s.start >= c.at - 1).slice(0, 2);
      if (!head.length) return;
      if (CHAPTER_FILLER.test(head[0].text)) add('C01', 'WARN', `chapter "${c.title}" opens with a signpost (${q(head[0].text, 50)}): open with a small hook, context and a lean in one or two sentences`);
      else if (!head.some((s) => /\?|\d/.test(s.text) || TURN.test(s.text) || /\b(?:you|your|imagine|picture|suppose)\b/i.test(s.text))) add('C02', 'WARN', `chapter "${c.title}" has no hook in its first two sentences (${q(head[0].text, 50)}): a question, a number, a turn or the viewer`);
    });
  } else add('C00', 'INFO', 'chapter hooks not checked: scenes.json has no chapters for this script yet (they are checked again once the scenes exist)');

  // E: the ending: payoff, call to action, a calm last 10 to 20 seconds
  const tail = sents.filter((s) => s.start >= total - Math.round(wps * 18)), tailText = tail.map((s) => s.text).join(' ');
  const last90 = sents.filter((s) => s.start >= total - Math.round(wps * 36)).map((s) => s.text).join(' ');
  const last150 = sents.filter((s) => s.start >= total - Math.round(wps * 60)).map((s) => s.text).join(' ');
  const cta = String(brandCfg.cta?.line || '').trim();
  if (cta) {
    const need = [...new Set(sig(cta))], have = new Set(sig(last90));
    const share = need.length ? need.filter((w) => have.has(w)).length / need.length : 1;
    if (share === 0) add('E01', 'ERROR', `the call to action (brand cta.line: ${q(cta, 60)}) is not said in the last 35 s`);
    else if (share < 0.6) add('E01', 'WARN', `the call to action is only partly there (brand cta.line: ${q(cta, 60)}): say it in its own words`);
  } else if (!CTA_GENERIC.test(last90)) add('E01', 'WARN', 'no call to action in the last 35 s (the channel has no cta.line yet: /channel-setup)');
  if (!PAYOFF.test(last150)) add('E02', 'WARN', 'no payoff in the last minute: close the question the opening opened, in words the viewer can use');
  const title = String(cfg.title || '');
  if (title) {
    const tw = [...new Set(sig(title))], later = new Set(sig(sents.filter((s) => s.start >= total * 0.85).map((s) => s.text).join(' ')));
    if (tw.length >= 2 && !tw.some((w) => later.has(w))) add('E05', 'WARN', `none of the title's words (${tw.slice(0, 4).join(', ')}) come back in the last 15% of the script: does the ending pay off the title's promise?`);
  }
  const calm = [];
  if (/!/.test(tailText)) calm.push('an exclamation mark');
  if (wordsOf(tailText).some((w) => /\d/.test(w) || NUMW.has(normWord(w)))) calm.push('a number');
  if (tail.some((s) => s.n > 20)) calm.push('a sentence over 20 words');
  if (calm.length) add('E03', 'WARN', `the last 10 to 20 s are not calm (${calm.join(', ')}): they sit under YouTube's end screen, so keep them short, plain and free of new facts`);
  if (GOODBYE.test(tailText)) add('E04', 'WARN', 'a goodbye at the end ("that is all for today", "thanks for watching"): end on the payoff and the call to action, no long goodbye');
  if (!Number(cfg.end_card)) add('E06', 'INFO', 'video.json has no "end_card": the last scene must stay calm for 10 to 20 s, or add "end_card": 15');

  // L: sentence length (over 28 words is not one breath); also the average
  sents.forEach((s, i) => { if (s.n > LONG) add('L01', 'ERROR', `sentence ${i + 1} has ${s.n} words (over ${LONG}): too long for one breath. Split it: ${q(s.text)}`); });
  const avg = total / sents.length;
  if (avg > 22) add('L02', 'WARN', `sentences average ${avg.toFixed(1)} words: aim for about 12 to 18 with a few short ones`);

  // R: runs of tiny fragments
  let run = [];
  const flushRun = () => { if (run.length >= 3) add('R01', 'WARN', `${run.length} very short fragments in a row (${run.slice(0, 4).map((s) => q(s.text, 20)).join(' ')}): a fragment must be a clear thought, not a punch`); run = []; };
  for (const s of sents) { if (s.n <= 3 && !/\d/.test(s.text)) run.push(s); else flushRun(); }
  flushRun();
  const fragN = sents.filter((s) => s.n <= 3 && !/\d/.test(s.text)).length;
  if (sents.length >= 20 && fragN / sents.length > 0.1) add('R02', 'WARN', `${fragN} of ${sents.length} sentences are 3 words or fewer: too staccato for a long video`);

  // N: spoken numbers and names (a number or name list is a screen job; the ear holds a handful)
  const toks = [];
  sents.forEach((s) => s.text.split(/\s+/).filter((t) => normWord(t)).forEach((t, k) => toks.push({ raw: t, first: k === 0 })));
  const runs = []; let inRun = false;
  toks.forEach((t, i) => {
    const parts = t.raw.toLowerCase().replace(/[^a-z0-9%.,-]/g, '').split('-').filter(Boolean);
    const isNum = parts.some((p) => (/^\d/.test(p) && (/\d{2}|%/.test(p) || Number(p.replace(/,/g, '')) > 10)) || NUMW.has(p));
    if (isNum && !inRun) runs.push(i);
    inRun = isNum;
  });
  for (let a = 0; a < runs.length;) {
    const inWin = runs.filter((p) => p >= runs[a] && p < runs[a] + 150);
    if (inWin.length > 5) { add('N01', 'WARN', `${inWin.length} numbers in about a minute (around word ${runs[a] + 1}): the ear holds about four. Keep the ones that decide something and put the rest on screen`); a += inWin.length; } else a++;
  }
  const names = [];
  toks.forEach((t, i) => { const w = t.raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''); if (!t.first && /^\p{Lu}\p{Ll}{2,}/u.test(w) && !NAME_SKIP.has(w)) names.push({ i, w }); });
  for (let a = 0; a < names.length;) {
    const inWin = names.filter((n) => n.i >= names[a].i && n.i < names[a].i + 150), set = new Set(inWin.map((n) => n.w));
    if (set.size > 8) { add('N02', 'WARN', `${set.size} different names in about a minute (around word ${names[a].i + 1}: ${[...set].slice(0, 5).join(', ')}): a name list is a screen job`); a += inWin.length; } else a++;
  }

  // T: a list read aloud with no lead-in
  sents.forEach((s, i) => {
    const items = s.text.replace(/[.!?]+$/, '').split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+(?=\S+,)/).map((x) => x.trim()).filter(Boolean);
    if (items.length < 4 || mean(items.map((x) => wordsOf(x).length)) > 3.2) return;
    const lead = `${sents[i - 1]?.text || ''} ${s.text.split(',')[0]}`;
    if (!LEADIN.test(lead)) add('T01', 'WARN', `a list of ${items.length} is read aloud with no lead-in (${q(s.text, 60)}): say what is coming first ("Four names matter here:") or put the list on screen`);
  });

  // J: the channel's own jargon (brand/jargon.md): each term needs a plain explanation next to its first use
  const flat = sents.map((s) => s.text).join(' '), low = flat.toLowerCase(), bad = [];
  for (const t of [...new Set(ctx.jargon || [])].sort((a, b) => b.length - a.length)) {
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'u').exec(low);
    if (!m) continue;
    const after = low.slice(m.index + t.length).split(/\s+/).slice(0, 12).join(' '), before = low.slice(0, m.index).split(/\s+/).slice(-8).join(' ');
    if (!(EXPLAIN.test(after) || EXPLAIN.test(before))) bad.push(t);
  }
  for (const t of bad) add('J01', bad.length >= 4 ? 'ERROR' : 'WARN', `jargon "${t}" is used with no plain explanation beside it: say what it means in plain words, or keep it on screen only`);

  // U: links, menu paths and commands are said by the voice, so they are a screen job
  sents.forEach((s, i) => { if (/https?:\/\/|\b\w+\.(?:com|ai|io|co|app|org)\/\S|`| > /.test(s.text)) add('U01', 'WARN', `sentence ${i + 1} speaks a link, menu path or command (${q(s.text, 60)}): put it on screen and say what it does`); });

  // O: repeated openings
  const word0 = (s) => normWord(s.text.split(/\s+/)[0]);
  for (let i = 0; i + 2 < sents.length; i++) {
    const w = word0(sents[i]);
    if (w && w === word0(sents[i + 1]) && w === word0(sents[i + 2])) {
      let j = i + 3; while (j < sents.length && word0(sents[j]) === w) j++;
      add('O01', 'WARN', `${j - i} sentences in a row start with "${w}" (from sentence ${i + 1})`); i = j - 1;
    }
  }
  const two = new Map();
  for (const s of sents) { const k = wordsOf(s.text).slice(0, 2).map(normWord).join(' '); if (k.includes(' ')) two.set(k, (two.get(k) || 0) + 1); }
  for (const [k, n] of two) if (n >= 5 && !/^(?:and|but|so) /.test(k) && n / sents.length > 0.04) add('O02', 'WARN', `${n} sentences open with "${k}": vary the way sentences start`);

  // W: words a minute against the planned length
  const minutes = total / wpm;
  if (ctx.planned) {
    const dev = (minutes - ctx.planned.minutes) / ctx.planned.minutes;
    if (Math.abs(dev) > 0.15) add('W01', Math.abs(dev) > 0.35 ? 'ERROR' : 'WARN', `${total} words is about ${minutes.toFixed(1)} min at ${Math.round(wpm)} words a minute; the plan says ${ctx.planned.minutes.toFixed(1)} min (${ctx.planned.from}): ${Math.abs(Math.round(dev * 100))}% ${dev > 0 ? 'over' : 'under'}. ${dev > 0 ? 'Cut to about' : 'Add up to about'} ${Math.round(ctx.planned.minutes * wpm)} words, or change the plan`);
    else add('W00', 'INFO', `${total} words is about ${minutes.toFixed(1)} min at ${Math.round(wpm)} words a minute, within 15% of the plan (${ctx.planned.minutes.toFixed(1)} min)`);
  } else add('W00', 'INFO', `${total} words is about ${minutes.toFixed(1)} min at ${Math.round(wpm)} words a minute; no planned length found (outline.md "Estimated length", video.json "minutes" or --minutes)`);

  // H10: the human score against the bar
  const bar = Number(brandCfg.writing?.human_score_min ?? BAR) || BAR;
  const human = humanScore(raw, { banned: brandCfg.writing?.banned_phrases || [], bar });
  if (human.score == null) add('H10', 'INFO', `human score not given: ${human.notes[0]}`);
  else if (human.score < bar) add('H10', 'ERROR', `human score ${human.score}/100 is under the bar of ${bar} (weakest: ${human.weakest}; ${human.notes.join('; ')})`);
  else add('H10', 'INFO', `human score ${human.score}/100, bar ${bar} met (${human.notes[0]})`);

  return finish(out, { words: total, minutes, wpm, human });
}

function finish(findings, info) {
  const rank = { ERROR: 0, WARN: 1, INFO: 2 };
  const sorted = findings.map((f, i) => ({ ...f, i })).sort((a, b) => rank[a.sev] - rank[b.sev] || a.i - b.i).map(({ i, ...f }) => f);
  const errors = sorted.filter((f) => f.sev === 'ERROR').length, warnings = sorted.filter((f) => f.sev === 'WARN').length;
  return { ...info, findings: sorted, errors, warnings, pass: errors === 0 };
}

export function render(r, name = '') {
  const head = `${name ? `${name}: ` : ''}${r.words} words, about ${r.minutes.toFixed(1)} min at ${Math.round(r.wpm)} words a minute${r.human?.score != null ? `, human score ${r.human.score}/100 (bar ${r.human.bar})` : ''}`;
  return [head, ...r.findings.map((f) => `${f.code} ${f.sev} ${f.msg}`), r.pass ? `PASS (${r.warnings} warning${r.warnings === 1 ? '' : 's'})` : `FAIL (${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'})`].join('\n');
}

// the check of a video folder, written to build/scriptcheck.md (unless write is false)
export function checkVideo(dir, { minutes, write = true } = {}) {
  const f = path.join(dir, 'script.txt');
  if (!fs.existsSync(f)) throw new Error(`no script.txt in ${dir.replace(/\\/g, '/')}`);
  const ctx = loadContext(dir, { minutes }), r = checkScript(read(f), ctx);
  r.hash = spokenHash(read(f));
  if (write) {
    fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'build', 'scriptcheck.md'), `# Script check: ${path.basename(path.resolve(dir))}\n\n\`\`\`\n${render(r)}\n\`\`\`\n\nERROR must be fixed before the script is shown. Answer each WARN in one line (fix it, or why it is fine). Then run the cold read (/script-coldread).\n`);
  }
  return r;
}

/* ── samples (used by the selftest and the tests): invented, no real people or companies ────────────────────────────── */
export const SAMPLE_GOOD = `A lighthouse lamp is about as bright as a car headlight. Yet sailors can see it from thirty miles away. How?

Most people think the secret is a giant bulb. It is not. The secret is glass, cut in rings. By the end of this video you will know exactly how those rings turn a weak glow into one hard beam.

Start with the problem. A bare lamp throws its light in every direction, so most of it leaves over the waves and the sky, where nobody needs it. Only a thin slice ever reaches a ship.

Now picture a fix that sounds too simple. Take the wasted light and bend it back. That is the whole job of the lens. In 1822 a French physicist named Augustin Fresnel built one, and ships stopped hitting rocks they could not see.

Why rings? A normal lens that big would be a block of glass as thick as a bed, far too heavy to turn. Fresnel kept only the curved surface of each slice and threw away the thick middle. Same bending, a fraction of the weight.

The lens does two jobs. Prisms near the top and bottom catch light heading up and down, and fold it sideways. A bullseye in the middle squeezes the rest into a tight band. Add them up and about eighty percent of the lamp's light ends up in the beam.

But a beam is not a flash. So the whole lens turns, slowly, on a bath of liquid metal. A sailor sees one bright pulse every few seconds. Each lighthouse has its own count, like a name written in light.

Why does that matter to you? Because the same idea lives in your pocket. Your phone flash uses the ring trick. So does a car headlight. You have been carrying a tiny lighthouse lens this whole time.

So here is the answer. The lamp was never the clever part. The clever part is catching the light that would have been lost, and sending every bit of it one way.

Subscribe for the next one.
`;

export const SAMPLE_BAD = `Hey guys, welcome back to the channel and in this video we are going to talk about something that I think is really important for all of us to understand, which is how a lighthouse lens works and why it matters so much to sailors and ships and everyone near the sea in every kind of weather.
Lighthouses. Bright. Old. Big. Tall.
Then the lens collects the light from the lamp and it bends the light with glass prisms that were cut in rings by a physicist who worked in France many years before the invention of the electric bulb or the modern harbour.
The lamp costs 4500 dollars, weighs 900 kilos, was built in 1822, turns 12 times a minute, lasts 40 years, sits 60 metres up and shines 30 miles.
{{needs a source}}
Then the lens turns. Then the lens bends light. Then the lens saves ships. Then the lens is old.
Lenses, prisms, mirrors, lamps, bulbs, rings, gears.
Thanks for watching, that's all for today, see you next time!
`;

/* ── selftest ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
export function selftest() {
  const must = (c, m) => { if (!c) throw new Error(`scriptcheck selftest: ${m}`); };
  const good = checkScript(SAMPLE_GOOD, { cfg: { title: 'How a lighthouse lens works', end_card: 15 }, brandCfg: { cta: { line: 'Subscribe for the next one.' } }, jargon: ['prism'] });
  must(good.pass, `the good sample should pass: ${good.findings.filter((f) => f.sev === 'ERROR').map((f) => `${f.code} ${f.msg}`).join(' | ')}`);
  must(!good.findings.some((f) => f.code === 'F01'), 'good sample has no filler opening');
  const bad = checkScript(SAMPLE_BAD, { cfg: {}, brandCfg: { cta: { line: 'Join the channel today.' } }, planned: { minutes: 10, from: 'test' } });
  must(!bad.pass, 'the bad sample should fail');
  const codes = new Set(bad.findings.map((f) => f.code));
  for (const c of ['F01', 'S02', 'L01', 'R01', 'N01', 'T01', 'W01', 'E03', 'E04', 'O01']) must(codes.has(c), `the bad sample should raise ${c} (got ${[...codes].join(' ')})`);
  must(spokenHash('Hello  there.') === spokenHash('hello there.\n') && spokenHash('hello there.') !== spokenHash('hello there!'), 'hash ignores case and spacing, not words');
  console.log('scriptcheck selftest: ok');
}

/* ── command line ───────────────────────────────────────────────────────────────────────────────────────────────────── */
export function cli(argv) {
  if (argv.includes('--selftest')) return selftest();
  const loose = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--minutes'));
  const dir = loose[0];
  if (!dir) { console.error('usage: node scriptcheck.mjs <video folder> [--minutes N] [--json] [--no-write] | --hash | --selftest'); process.exitCode = 2; return; }
  try {
    if (argv.includes('--hash')) {
      const h = spokenHash(read(path.join(dir, 'script.txt')));
      if (!h) throw new Error(`no script.txt in ${path.resolve(dir).replace(/\\/g, '/')}`);
      console.log(h); return;
    }
    const mi = argv.indexOf('--minutes');
    const r = checkVideo(dir, { minutes: mi >= 0 ? argv[mi + 1] : undefined, write: !argv.includes('--no-write') });
    console.log(argv.includes('--json') ? JSON.stringify(r, null, 1) : render(r, path.basename(path.resolve(dir))));
    if (!r.pass) process.exitCode = 1;
  } catch (e) { console.error(`scriptcheck: ${e.message}`); process.exitCode = 1; }
}

const here = (() => { try { return fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return ''; } })();
const called = (() => { try { return process.argv[1] ? fs.realpathSync.native(path.resolve(process.argv[1])) : ''; } catch { return ''; } })();
if (here && here === called) cli(process.argv.slice(2));
