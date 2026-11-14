// checks.mjs · what stands between a video and money or the public: the brand folder it belongs to, the fact check, the
// two approvals (the map before the voice, the final before the upload), the quality check of the finished file, and
// tidying a finished folder. Taken from the BagelUnit Reel Kit's facts.py, gate.py, qa.py and kit tidy, made for long
// 1920x1080 videos. Everything here reads and writes files in the video folder; nothing goes over the network.
//
//   build/facts_check.json   the fact-check verdicts (scope script and final) with a fingerprint of what was checked
//   build/approvals.json     the approvals (map, final) with fingerprints; approvals.md is the same, for people to read
//   build/qa.json            the quality check of out/video.mp4, tied to the file's SHA-256
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);   // local time, 2026-11-12 19:23

/* ── fingerprints ───────────────────────────────────────────────────────────────────────────────────────────────────── */
export function sha256File(file) {
  if (!fs.existsSync(file)) return null;
  const h = createHash('sha256'), fd = fs.openSync(file, 'r'), buf = Buffer.alloc(8 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
// one fingerprint over several files (a missing file counts as missing, so adding it later changes the print)
export function fingerprint(files) {
  const h = createHash('sha256');
  for (const f of files) h.update(`${path.basename(f)}\0${sha256File(f) || '-'}\n`);
  return h.digest('hex').slice(0, 16);
}

/* ── research ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
// research.md holds what the video may claim and where each fact comes from. `video new` writes the empty page below; the
// voice refuses until the page has its marker removed and at least two sources, or until video.json says why no research
// is needed ("no_research": "a bedtime story, nothing to check").
const RESEARCH_MARK = '<!-- not researched yet -->';
export const RESEARCH_PAGE = `# Research
${RESEARCH_MARK}

## The question
What the video has to answer, in one sentence.

## What was found
- One fact per line, said plainly, with its source: [publisher, title](https://...)

## Not sure or disputed
- Claims the sources disagree on, or that only one weak source makes. These stay out of the video or are said as uncertain.

## Sources
1. [Title](https://...) by who, when published, when read
`;
export function researchState(dir, cfg = {}) {
  if (cfg.no_research) return { ok: true, why: `no research needed: ${cfg.no_research}` };
  const f = path.join(dir, 'research.md');
  if (!fs.existsSync(f)) return { ok: false, why: 'research.md is missing' };
  const text = fs.readFileSync(f, 'utf8');
  if (text.includes(RESEARCH_MARK)) return { ok: false, why: 'research.md is still the empty page (remove the "not researched yet" line once it is done)' };
  const links = new Set(text.match(/https?:\/\/[^\s)>\]]+/g) || []);
  if (links.size < 2) return { ok: false, why: `research.md lists ${links.size} source link(s); at least 2 are needed` };
  return { ok: true, why: `research.md: ${links.size} sources` };
}


/* ── the brand folder ───────────────────────────────────────────────────────────────────────────────────────────────── */
// A video made inside a Reel Kit brand folder (videos/<slug> next to reels/) uses that brand: its voice, its cleared facts,
// its "never say" list and its call to action. Outside one, the video stands alone.
export function findBrand(start) {
  let d = path.resolve(start);
  for (;;) {
    const f = path.join(d, 'brand', 'brand.json');
    if (fs.existsSync(f)) return { dir: d, cfg: readJSON(f, {}) };
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function neverSay(brand) {
  if (!brand) return [];
  const out = [...((brand.cfg.voice && brand.cfg.voice.never_say) || [])];
  const facts = read(path.join(brand.dir, 'brand', 'facts.md'));
  const sec = facts.split(/^##\s+Never say\s*$/im)[1];
  if (sec) for (const line of sec.split(/^##\s/m)[0].split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.+)$/);
    if (m && !/^\(.*\)$/.test(m[1].trim())) out.push(m[1].trim());
  }
  return out.filter(Boolean);
}

/* ── numbers, written or spoken ─────────────────────────────────────────────────────────────────────────────────────── */
// Scripts say numbers the way they are spoken ("sixty four percent", "nineteen sixty nine"); sources write them in digits
// ("64%", "1969", "1.4 million"). Both are turned into values so they can be compared.
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const isNumWord = (w) => w in ONES || w in TENS || w in SCALE || w === 'hundred';

export function numbersIn(text) {
  const tok = String(text).toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?%?|[a-z]+|%|[,;:!?.]/g) || [];
  const out = [];
  const pctAt = (j) => tok[j] === '%' || tok[j] === 'percent' || (tok[j] === 'per' && tok[j + 1] === 'cent');
  for (let i = 0; i < tok.length;) {
    const t = tok[i];
    if (/^\d/.test(t)) {
      let v = parseFloat(t), j = i + 1, pct = t.endsWith('%'), said = t;
      if (tok[j] in SCALE) { v *= SCALE[tok[j]]; said += ` ${tok[j]}`; j++; }
      if (!pct && pctAt(j)) { pct = true; j++; }
      out.push({ value: v, pct, said }); i = j; continue;
    }
    if (isNumWord(t) || (t === 'a' && (tok[i + 1] === 'hundred' || tok[i + 1] in SCALE))) {
      let j = i; const run = [];
      while (j < tok.length && (isNumWord(tok[j]) || (tok[j] === 'a' && j === i) || (tok[j] === 'and' && (run[run.length - 1] === 'hundred' || run[run.length - 1] in SCALE) && isNumWord(tok[j + 1] || '')) || (tok[j] === 'point' && run.length && (tok[j + 1] || '') in ONES))) {
        if (tok[j] === 'point') { run.push('point'); j++; while (j < tok.length && tok[j] in ONES && ONES[tok[j]] < 10) run.push(`d${ONES[tok[j++]]}`); continue; }
        if (tok[j] !== 'and') run.push(tok[j]);
        j++;
      }
      const said = tok.slice(i, j).join(' ');
      let pct = false;
      if (pctAt(j)) { pct = true; j++; }
      const v = spokenValue(run);
      if (v != null) out.push({ value: v, pct, said });
      i = Math.max(j, i + 1); continue;
    }
    i++;
  }
  return out;
}

function spokenValue(run) {
  const words = run.map((w) => (w === 'a' ? 'one' : w));
  // a year said in two halves: "nineteen sixty nine", "twenty twenty four"
  if (!words.some((w) => w === 'hundred' || w in SCALE || w === 'point')) {
    const small = [];
    for (const w of words) {
      const v = ONES[w] ?? TENS[w];
      if (v == null) return null;
      const last = small.length - 1;
      if (last >= 0 && small[last].open && v < 10) { small[last].v += v; small[last].open = false; }
      else small.push({ v, open: w in TENS });
    }
    if (small.length === 2 && small[0].v >= 10) return small[0].v * 100 + small[1].v;
    if (small.length === 1) return small[0].v;
    return null;                                                    // "one two three": not one number
  }
  let total = 0, cur = 0, dec = '', inDec = false;
  for (const w of words) {
    if (w === 'point') { inDec = true; continue; }
    if (inDec && w.startsWith('d')) { dec += w.slice(1); continue; }
    if (w in ONES) cur += ONES[w];
    else if (w in TENS) cur += TENS[w];
    else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w in SCALE) { total += ((cur || 1) + (dec ? Number(`0.${dec}`) : 0)) * SCALE[w]; cur = 0; dec = ''; inDec = false; }
  }
  return total + cur + (dec ? Number(`0.${dec}`) : 0);
}

/* ── the fact check ─────────────────────────────────────────────────────────────────────────────────────────────────── */
// The mechanical half (no network): every number in the words the video says or shows must be in research.md or the
// brand's facts.md; the brand's "never say" list must not appear; absolute words ("only", "never", "biggest") are listed,
// because they need a source that says exactly that. The other half is Claude re-reading each source, then `record`.
const ABSOLUTE = /\b(only|never|always|best|worst|every|largest|biggest|smallest|fastest|slowest|most|least|guaranteed|proven|cures?)\b/i;

function scopeFiles(dir, scope, brand) {
  const f = ['script.txt', 'scenes.json', 'research.md'].map((x) => path.join(dir, x));
  if (brand) f.push(path.join(brand.dir, 'brand', 'facts.md'));
  if (scope === 'final') f.push(path.join(dir, 'out', 'youtube.txt'), path.join(dir, 'out', 'pinned-comment.txt'));
  return f;
}

function shownText(dir) {
  const plan = readJSON(path.join(dir, 'scenes.json'), {});
  const out = [];
  const walk = (x) => { if (typeof x === 'string') out.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  for (const s of plan.scenes || []) walk(s.props);
  return out;
}

export function factCheck(dir, { scope = 'script', cfg = {} } = {}) {
  const brand = findBrand(dir);
  const sourceLines = [...read(path.join(dir, 'research.md')).split('\n'), ...(brand ? read(path.join(brand.dir, 'brand', 'facts.md')).split('\n') : [])];
  const known = [];
  for (const line of sourceLines) for (const n of numbersIn(line)) known.push({ ...n, line: line.trim() });
  const items = [];
  const script = read(path.join(dir, 'script.txt'));
  for (const s of script.split(/(?<=[.!?])\s+|\n{2,}/)) if (s.trim()) items.push({ where: 'script', text: s.trim() });
  for (const s of shownText(dir)) items.push({ where: 'on screen', text: s });
  if (scope === 'final') for (const name of ['youtube.txt', 'pinned-comment.txt']) { const y = read(path.join(dir, 'out', name)); for (const l of y.split('\n')) if (l.trim() && !/^\d+:\d\d/.test(l.trim())) items.push({ where: name, text: l.trim() }); }
  const errors = [], warnings = [], sheet = [];
  const soft = Boolean(cfg.no_research);
  for (const it of items) {
    const found = [];
    for (const n of numbersIn(it.text)) {
      if (n.value < 11 && !n.pct) continue;                          // "one city", "three steps": everyday words, not claims
      const exact = known.find((k) => Math.abs(k.value - n.value) <= 1e-9 * Math.max(1, Math.abs(k.value)));
      const near = exact ? null : known.find((k) => k.value && Math.abs(k.value - n.value) / Math.abs(k.value) <= 0.05);
      if (exact) found.push(`"${n.said}" = ${exact.line.slice(0, 140)}`);
      else if (near) { warnings.push(`${it.where}: "${n.said}" is rounded from a source (${near.line.slice(0, 100)}): say it as "about"`); found.push(`"${n.said}" ~ ${near.line.slice(0, 140)}`); }
      else (soft ? warnings : errors).push(`${it.where}: "${n.said}" is not in research.md${brand ? ' or brand/facts.md' : ''}: "${it.text.slice(0, 120)}"`);
    }
    const abs = it.text.match(ABSOLUTE);
    if (abs) warnings.push(`${it.where}: "${abs[0]}" needs a source that says exactly that: "${it.text.slice(0, 120)}"`);
    for (const ban of neverSay(brand)) if (it.text.toLowerCase().includes(ban.toLowerCase())) errors.push(`${it.where}: "${ban}" is on the brand's never-say list: "${it.text.slice(0, 120)}"`);
    if (found.length || abs) sheet.push(`- (${it.where}) ${it.text}\n${found.map((f) => `  - ${f}`).join('\n')}${abs ? `\n  - absolute word "${abs[0]}": does a source say exactly this?` : ''}`);
  }
  fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'build', 'factcheck.md'), `# Fact check worksheet (${scope})\n\nRe-read each source for these lines, then record the verdict.\n\n${sheet.join('\n') || '(no numbers or absolute words found)'}\n`);
  return { errors, warnings, scope, fp: fingerprint(scopeFiles(dir, scope, brand)) };
}

export function recordFacts(dir, { scope = 'script', result, note = '', cfg = {} } = {}) {
  if (!['script', 'final'].includes(scope)) throw new Error('scope is script or final');
  if (!['PASS', 'FAIL'].includes(result)) throw new Error('give --result PASS or FAIL');
  const r = factCheck(dir, { scope, cfg });
  if (result === 'PASS' && r.errors.length) throw new Error(`PASS is refused while the check has ${r.errors.length} error(s): run  video facts <folder>  and fix them`);
  const f = path.join(dir, 'build', 'facts_check.json'), all = readJSON(f, {});
  all[scope] = { result, note, at: now(), fp: r.fp };
  fs.writeFileSync(f, JSON.stringify(all, null, 2) + '\n');
  logApproval(dir, 'Fact check', `${scope}: ${result}${note ? `, ${note}` : ''}`);
  return all[scope];
}

export function factsCurrent(dir, scope) {
  const rec = readJSON(path.join(dir, 'build', 'facts_check.json'), {})[scope];
  if (!rec) return { ok: false, why: `no fact check recorded for the ${scope} (video facts <folder>${scope === 'final' ? ' --scope final' : ''}, re-read the sources, then record PASS)` };
  if (rec.result !== 'PASS') return { ok: false, why: `the ${scope} fact check was recorded as ${rec.result}` };
  if (rec.fp !== fingerprint(scopeFiles(dir, scope, findBrand(dir)))) return { ok: false, why: `the words or the research changed after the ${scope} fact check: check again` };
  return { ok: true, why: `fact check (${scope}) PASS ${rec.at}` };
}

/* ── approvals ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
// map: the person's go-ahead on the report and the map (outline.md + research.md). The voice needs it.
// final: the person's yes on the finished video. The upload needs it, and only for exactly the files approved.
function logApproval(dir, heading, line) {
  const f = path.join(dir, 'approvals.md');
  let text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# Approvals\n\nAdded by the kit; earlier lines are never rewritten.\n';
  const h = `## ${heading}`;
  if (!text.includes(`\n${h}\n`)) text = `${text.trimEnd()}\n\n${h}\n`;
  const at = text.indexOf(`\n${h}\n`) + h.length + 2, next = text.indexOf('\n## ', at);
  const entry = `- ${now()}  ${line}\n`;
  text = next < 0 ? `${text.trimEnd()}\n${entry}` : `${text.slice(0, next).trimEnd()}\n${entry}${text.slice(next)}`;
  fs.writeFileSync(f, text);
}
const mapFiles = (dir) => ['outline.md', 'research.md'].map((x) => path.join(dir, x));
// out/pinned-comment.txt (the comment the person pins by hand after the upload) is approved with the rest, when there is one
const finalFiles = (dir) => ['video.mp4', 'thumbnail.jpg', 'youtube.txt', 'pinned-comment.txt'].map((x) => path.join(dir, 'out', x));

// final: watched = the person says they watched the whole final cut, start to end (the upload with --yes needs it)
export function approve(dir, which, { note = '', cfg = {}, researchOk = { ok: true }, watched = false } = {}) {
  const f = path.join(dir, 'build', 'approvals.json'), all = readJSON(f, {});
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (which === 'map') {
    if (!read(path.join(dir, 'outline.md')).trim()) throw new Error('outline.md is empty: write the map first (SKILL.md step 4)');
    if (!researchOk.ok) throw new Error(`the research is not done: ${researchOk.why}`);
    all.map = { at: now(), note, fp: fingerprint(mapFiles(dir)) };
    logApproval(dir, 'Map', `approved${note ? `: ${note}` : ''} (map ${all.map.fp.slice(0, 12)})`);
  } else if (which === 'final') {
    const mp4 = path.join(dir, 'out', 'video.mp4');
    if (!fs.existsSync(mp4)) throw new Error('out/video.mp4 is missing: render first');
    const q = qaCurrent(dir); if (!q.ok) throw new Error(q.why);
    const fc = factsCurrent(dir, 'final'); if (!fc.ok) throw new Error(fc.why);
    const files = Object.fromEntries(finalFiles(dir).map((x) => [path.basename(x), sha256File(x)]));
    all.final = { at: now(), note, files, watched: Boolean(watched) };
    logApproval(dir, 'Final', `approved${note ? `: ${note}` : ''}: video.mp4 ${files['video.mp4'].slice(0, 12)}${files['thumbnail.jpg'] ? `, thumbnail ${files['thumbnail.jpg'].slice(0, 12)}` : ''}${files['youtube.txt'] ? `, youtube.txt ${files['youtube.txt'].slice(0, 12)}` : ''}${files['pinned-comment.txt'] ? `, pinned comment ${files['pinned-comment.txt'].slice(0, 12)}` : ''}; QA PASS; fact check PASS; ${watched ? 'watched the whole final cut' : 'NOT marked as watched in full (the upload needs --watched)'}`);
  } else throw new Error('approve map or approve final');
  fs.writeFileSync(f, JSON.stringify(all, null, 2) + '\n');
  return all[which];
}

export function approvalCurrent(dir, which) {
  const rec = readJSON(path.join(dir, 'build', 'approvals.json'), {})[which];
  if (which === 'map') {
    if (!rec) return { ok: false, why: 'the map has not been approved: show the person the report and the map, and on their go-ahead run  video approve <folder> map' };
    if (rec.fp !== fingerprint(mapFiles(dir))) return { ok: false, why: 'the map or the research changed after it was approved: show the person what changed and approve again' };
    return { ok: true, why: `map approved ${rec.at}` };
  }
  if (!rec) return { ok: false, why: 'the final video has not been approved: video qa, video facts --scope final, show the person, then  video approve <folder> final' };
  for (const x of finalFiles(dir)) if ((sha256File(x) || null) !== (rec.files[path.basename(x)] || null)) return { ok: false, why: `out/${path.basename(x)} ${rec.files[path.basename(x)] ? 'changed' : 'was added'} after the final approval: approve again` };
  return { ok: true, watched: rec.watched === true, why: `final approved ${rec.at}${rec.watched ? ', watched in full' : ''}` };
}

/* ── quality check of the finished file ─────────────────────────────────────────────────────────────────────────────── */
// One pass over out/video.mp4: the format, the length against the voice, loudness and true peak, black stretches and
// stretches where the picture stops moving. Writes build/qa.json tied to the file's SHA-256.
export const QA_BARS = { lufs: [-15, -13], lufsWarn: [-16, -12], truePeak: -1, black: 0.5, frozenWarn: 2, frozenFail: 4 };

// video.json "end_card": seconds of picture after the voice (a card for YouTube's end screen). The length check then allows
// the video to run that much longer than the voice, and a still picture that holds to the end, no longer than the end card
// (plus the 4 s a still may last anyway), is the card, not a fault. A "tail" (the hold after the last word, 0.6 s by
// default) longer than the voice's own silence is allowed the same way.
export function endAllowance(cfg = {}, words = [], voLen = 0) {
  const card = Math.max(0, Number(cfg.end_card) || 0);
  const last = Array.isArray(words) && words.length ? words.at(-1).e : 0;
  const tail = Math.max(0, last + Number(cfg.tail ?? 0.6) - voLen);
  return { card, extra: card + (last ? tail : 0) };
}

export function qa(dir, { standIn = false, cfg = null } = {}) {
  cfg = cfg || readJSON(path.join(dir, 'video.json'), {}) || {};
  const mp4 = path.join(dir, 'out', 'video.mp4');
  const checks = [];
  const add = (name, status, text) => checks.push({ name, status, text });
  if (!fs.existsSync(mp4)) throw new Error('out/video.mp4 is missing: render first');
  const p = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4], { encoding: 'utf8' }).stdout || '{}');
  const v = (p.streams || []).find((s) => s.codec_type === 'video'), a = (p.streams || []).find((s) => s.codec_type === 'audio');
  const dur = Number(p.format?.duration || 0), size = Number(p.format?.size || 0);
  const fps = v ? v.r_frame_rate.split('/').reduce((x, y) => Number(x) / Number(y)) : 0;
  const specOk = v && v.codec_name === 'h264' && v.width === 1920 && v.height === 1080 && Math.abs(fps - 30) < 0.01 && a && a.codec_name === 'aac';
  add('spec', specOk ? 'PASS' : 'FAIL', `${v ? `${v.codec_name} ${v.width}x${v.height} ${fps.toFixed(2)} fps` : 'no picture'}, ${a ? a.codec_name : 'no sound'}, ${(size / 1048576).toFixed(1)} MB, ${dur.toFixed(1)} s`);
  const voLen = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(dir, 'audio', 'vo.mp3')], { encoding: 'utf8' }).stdout) || 0;
  const allow = endAllowance(cfg, readJSON(path.join(dir, 'build', 'words.json'), []), voLen);
  if (voLen) add('length', dur >= voLen - 0.1 && dur - voLen <= 2 + allow.extra ? 'PASS' : 'FAIL', `video ${dur.toFixed(2)} s, voice ${voLen.toFixed(2)} s${allow.card ? `, end card ${allow.card.toFixed(2)} s` : ''}${allow.extra > allow.card + 0.01 ? `, tail ${(allow.extra - allow.card).toFixed(2)} s` : ''}`);
  else add('length', 'FAIL', 'audio/vo.mp3 is missing');
  add('voice', standIn ? 'FAIL' : 'PASS', standIn ? 'the stand-in tone, not a voice' : 'a real voice');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', mp4, '-filter_complex',
    `[0:v]scale=480:-2,blackdetect=d=${QA_BARS.black}:pix_th=0.06,freezedetect=n=0.002:d=${QA_BARS.frozenWarn}[v];[0:a]ebur128=peak=true[a]`,
    '-map', '[v]', '-map', '[a]', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const log = r.stderr || '';
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const I = parseFloat((summary.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]), TP = parseFloat((summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/) || [])[1]);
  const lufsStatus = !Number.isFinite(I) ? 'FAIL' : I >= QA_BARS.lufs[0] && I <= QA_BARS.lufs[1] ? 'PASS' : I >= QA_BARS.lufsWarn[0] && I <= QA_BARS.lufsWarn[1] ? 'WARN' : 'FAIL';
  add('loudness', lufsStatus, Number.isFinite(I) ? `${I.toFixed(1)} LUFS (aim -14)` : 'could not measure');
  add('true peak', Number.isFinite(TP) && TP <= QA_BARS.truePeak ? 'PASS' : 'FAIL', Number.isFinite(TP) ? `${TP.toFixed(1)} dBTP (at most ${QA_BARS.truePeak})` : 'could not measure');
  const blacks = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].map((m) => ({ t: +m[1], d: +m[3] }));
  add('black', blacks.length ? 'FAIL' : 'PASS', blacks.length ? blacks.map((b) => `${b.t.toFixed(1)} s for ${b.d.toFixed(1)} s`).join(', ') : `no black stretch over ${QA_BARS.black} s`);
  const starts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]), durs = [...log.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => +m[1]);
  const frozen = starts.map((t, i) => ({ t, d: durs[i] ?? Math.max(0, dur - t) }));
  const isCard = (f) => allow.card > 0 && f.t + f.d >= dur - 0.25 && f.d <= allow.card + QA_BARS.frozenFail;
  const card = frozen.filter(isCard), rest = frozen.filter((f) => !isCard(f));
  const bad = rest.filter((f) => f.d >= QA_BARS.frozenFail), slow = rest.filter((f) => f.d < QA_BARS.frozenFail);
  add('still picture', bad.length ? 'FAIL' : slow.length ? 'WARN' : 'PASS', frozen.length ? frozen.map((f) => `${f.t.toFixed(1)} s for ${f.d.toFixed(1)} s${card.includes(f) ? ' (the end card)' : ''}`).join(', ') : `nothing still for ${QA_BARS.frozenWarn} s or more`);
  const result = checks.some((c) => c.status === 'FAIL') ? 'FAIL' : 'PASS';
  const out = { result, sha: sha256File(mp4), at: now(), checks };
  fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'build', 'qa.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

export function qaCurrent(dir) {
  const rec = readJSON(path.join(dir, 'build', 'qa.json'), null);
  if (!rec) return { ok: false, why: 'no quality check yet: video qa <folder>' };
  if (rec.sha !== sha256File(path.join(dir, 'out', 'video.mp4'))) return { ok: false, why: 'out/video.mp4 changed after the quality check: video qa <folder> again' };
  if (rec.result !== 'PASS') return { ok: false, why: 'the quality check failed: fix what video qa lists and render again' };
  return { ok: true, why: `QA PASS ${rec.at}` };
}

/* ── tidy ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
// A finished video folder keeps the words, the research, the plan, the voice (paid for, and the chunk records that stop it
// being paid for twice), the approvals and out/. The scene clips and the joined copies in build/ go: a render makes them
// again for free, it only takes time.
const TIDY = ['build/scenes', 'build/video.mp4', 'build/draft.mp4', 'build/scenes-vertical', 'build/vertical.mp4', 'build/draft-vertical.mp4'];
const sizeOf = (p) => { if (!fs.existsSync(p)) return 0; const s = fs.statSync(p); return s.isDirectory() ? fs.readdirSync(p).reduce((n, x) => n + sizeOf(path.join(p, x)), 0) : s.size; };

export function tidy(dir, { apply = false } = {}) {
  const items = TIDY.map((x) => ({ rel: x, bytes: sizeOf(path.join(dir, x)) })).filter((x) => x.bytes > 0);
  const rerender = rerenderEstimate(dir, items);         // counted before anything is removed
  if (apply) for (const x of items) fs.rmSync(path.join(dir, x.rel), { recursive: true, force: true });
  return { items, bytes: items.reduce((n, x) => n + x.bytes, 0), uploaded: fs.existsSync(path.join(dir, 'out', 'youtube-published.json')), rerender };
}

// After tidy the next render of that shape draws every scene again (nothing is left to reuse). For each shape whose scene
// clips go: how many scenes, and about how long, from build/render-times.json (scenes.mjs recordRenderTime): the seconds per
// drawn scene of this shape's past renders, or of the other shape's when this one has none; null when the folder has no
// record yet (a folder rendered before render times were kept).
export function rerenderEstimate(dir, items) {
  const log = readJSON(path.join(dir, 'build', 'render-times.json'), []);
  const runs = (Array.isArray(log) ? log : []).filter((r) => r && r.rendered > 0 && r.seconds > 0);
  const perScene = (list) => { const n = list.reduce((a, r) => a + r.rendered, 0); return n ? list.reduce((a, r) => a + r.seconds, 0) / n : null; };
  return [['wide', 'build/scenes'], ['vertical', 'build/scenes-vertical']].filter(([, rel]) => items.some((x) => x.rel === rel)).map(([shape, rel]) => {
    const scenes = fs.readdirSync(path.join(dir, rel)).filter((f) => /^\d{3}\.mp4$/.test(f)).length;
    const own = perScene(runs.filter((r) => r.shape === shape)), other = perScene(runs.filter((r) => r.shape !== shape));
    const each = own ?? other;
    return { shape, scenes, seconds: each != null ? Math.round(each * scenes) : null, from: own != null ? 'this shape' : other != null ? 'the other shape' : null };
  });
}
