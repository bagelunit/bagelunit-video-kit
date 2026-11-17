// revoice.mjs · voice one line of a finished voice again, without voicing the whole video (video revoice).
//
// A sentence voiced alone comes out at a different pace from the same sentence in a long take (a field report: a last line
// voiced alone ran 7.3 s against 5.1 s in the take). So the new line is voiced WITH the sentence before it as a lead-in,
// through the same Reel Kit voice tool and settings as video voice (so the same request is never paid for twice), the lead-in
// is cut off at the gap before the new line's first word, and the new line is spliced into a COPY of the voice in place of
// the old one. Words per second are reported for the new line, the old line and the whole episode, with a warning when the new
// line is more than RATE_WARN off the episode (or the old line was, which is why a new take can sound different).
//
//   video revoice <folder> --line "old words" --to "new words"             a dry run: what would be sent, and where it goes
//   video revoice <folder> --line ... --to ... --apply                     voice it (a paid call unless voiced before) and splice
//   video revoice <folder> --line ... --to ... --vertical --apply          the vertical (Instagram) voice only:
//                                                                          audio/vo-vertical.mp3 + build/words-vertical.json
//                                                                          (+ build/pauses-vertical.json), the wide voice untouched
//   video revoice <folder> --use                                           put the last wide revoice in place of audio/vo.mp3
//                                                                          (the old voice is kept as audio/vo-before-revoice.mp3)
//
// Files: build/revoice/<id>/ holds each take (script.txt, reel.json, audio/vo.mp3, build/words.json: voice.py's own folder).
// Without --vertical the result is audio/vo-revoiced.mp3 + build/words-revoiced.json + build/pauses-revoiced.json: the
// YouTube voice is never replaced until --use.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as scenes from './scenes.mjs';
import * as checks from './checks.mjs';
import { voiceSetup, creditCheck, chunkDone, relay } from './video.mjs';

export const RATE_WARN = 0.2;                 // a line more than 20% faster or slower than the episode is worth a listen
const LEVEL = 'loudnorm=I=-14:TP=-1.5:LRA=11';  // the level video voice joins the voice at
const FMT = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono';
const END_TAIL = 0.25;                         // s kept after the old line when it is the last thing said

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
const mediaLength = (f) => { const v = parseFloat(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout); return Number.isFinite(v) ? v : null; };
const r3 = (x) => Math.round(x * 1000) / 1000;
const toks = (text) => String(text ?? '').split(/\s+/).map(scenes.normWord).filter(Boolean);
const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
const ENDS = /[.!?]["')\]]*$/;

/* ── finding the line ───────────────────────────────────────────────────────────────────────────────────────────────── */
// [a, b]: the first and last index in words of the line's words, in a row. More than one place is an error (give more words).
export function findLine(words, text) {
  const want = toks(text);
  if (!want.length) throw new Error('--line has no words');
  const have = words.map((w) => scenes.normWord(w.w));
  const hits = [];
  for (let i = 0; i + want.length <= have.length; i++) if (want.every((t, k) => same(t, have[i + k]))) hits.push(i);
  if (!hits.length) throw new Error(`"${text}" is not in the voice's words (build/word_index.txt lists them): give the words exactly as they are said`);
  if (hits.length > 1) throw new Error(`"${text}" is said ${hits.length} times (at ${hits.map((i) => words[i].s.toFixed(1) + ' s').join(', ')}): give more of the line so it is said once`);
  return { a: hits[0], b: hits[0] + want.length - 1 };
}

// The sentence before the line (up to 40 words; one more when that is under 6 words), the lead-in that sets the pace. Sentences end at . ! ? when the words carry
// punctuation; without it, at the longest gap in the 12 words before the line.
export function leadIn(words, a) {
  if (a <= 0) return { from: a, text: '' };
  const punctuated = words.some((w) => ENDS.test(w.w));
  let from;
  if (punctuated) {
    const back = (j) => { while (j > 0 && a - j < 40 && !ENDS.test(words[j - 1].w)) j--; return j; };
    from = back(a - 1);
    if (a - from < 6 && from > 0) from = back(from - 1);      // a line that starts mid-sentence: the sentence before it too
  } else {
    const lo = Math.max(0, a - 12);
    from = lo;
    let gap = -1;
    for (let j = lo + 1; j < a; j++) { const g = words[j].s - words[j - 1].e; if (g > gap) { gap = g; from = j; } }
    if (a - lo < 3) from = lo;
  }
  let text = words.slice(from, a).map((w) => w.w).join(' ');
  if (!/[.!?,;:]["')\]]*$/.test(text)) text += '.';
  return { from, text };
}

/* ── pace ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
export const rate = (ws) => (ws.length > 1 && ws.at(-1).e > ws[0].s ? ws.length / (ws.at(-1).e - ws[0].s) : null);
// the episode's pace: all words over the time spent inside sentences (pauses between sentences do not count)
export function episodeRate(words) {
  const punctuated = words.some((w) => ENDS.test(w.w));
  let n = 0, t = 0, start = 0;
  for (let i = 0; i < words.length; i++) {
    const end = i === words.length - 1 || (punctuated ? ENDS.test(words[i].w) : words[i + 1].s - words[i].e > 0.5);
    if (!end) continue;
    const s = words.slice(start, i + 1);
    if (s.length > 1) { n += s.length; t += s.at(-1).e - s[0].s; }
    start = i + 1;
  }
  return t > 0 ? n / t : null;
}
export function paceReport({ fresh, old, episode }) {
  const f = (x) => (x == null ? 'n/a' : `${x.toFixed(2)} words/s`);
  const lines = [`pace: new line ${f(fresh)}, old line ${f(old)}, episode ${f(episode)}`];
  const off = (x) => (x != null && episode ? x / episode - 1 : null);
  const dn = off(fresh), dold = off(old);
  if (dn != null && Math.abs(dn) > RATE_WARN) lines.push(`WARNING: the new line reads ${Math.round(Math.abs(dn) * 100)}% ${dn < 0 ? 'slower' : 'faster'} than the episode. Listen to it; try a longer lead-in or different words.`);
  if (dold != null && Math.abs(dold) > RATE_WARN) lines.push(`note: the old line itself read ${Math.round(Math.abs(dold) * 100)}% ${dold < 0 ? 'slower' : 'faster'} than the episode, so a new take that matches the episode will sound ${dold > 0 ? 'slower' : 'faster'} than the old line did.`);
  return lines;
}

/* ── the splice ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
// Where to cut the base voice around [a, b] and the take around its new words, and the new word clock and pauses.
// base: {words, length, pauses}; take: {words, length}; newCount: how many words the new line has (the take ends with them).
export function planSplice(base, { a, b }, take, newCount) {
  const W = base.words, T = take.words;
  const k = T.length - newCount;
  if (k < 0 || !T.length) throw new Error('the new take has fewer words than the new line: it did not come out as asked. Listen to build/revoice/<id>/audio/vo.mp3');
  const baseIn = a > 0 ? (W[a - 1].e + W[a].s) / 2 : Math.max(0, W[a].s - 0.05);
  const nextPause = (base.pauses || []).map((p) => p.at).filter((x) => x >= W[b].e - 1e-6).sort((x, y) => x - y)[0];
  const baseOut = b < W.length - 1 ? (W[b].e + W[b + 1].s) / 2 : Math.min(W[b].e + END_TAIL, nextPause ?? base.length ?? W[b].e + END_TAIL, base.length ?? Infinity);
  const takeIn = k > 0 ? (T[k - 1].e + T[k].s) / 2 : Math.max(0, T[0].s - 0.05);
  const tail = Math.max(0, baseOut - W[b].e);                 // the same breath after the line as before
  const segLen = T.at(-1).e + tail - takeIn;
  const delta = segLen - (baseOut - baseIn);
  const shiftIn = baseIn - takeIn;
  const words = [
    ...W.slice(0, a),
    ...T.slice(k).map((w) => ({ w: w.w, s: r3(w.s + shiftIn), e: r3(w.e + shiftIn) })),
    ...W.slice(b + 1).map((w) => ({ w: w.w, s: r3(w.s + delta), e: r3(w.e + delta) })),
  ];
  const pauses = (base.pauses || []).map((p) => (p.at >= baseOut - 1e-6 ? { ...p, at: r3(p.at + delta) } : p));
  return { baseIn: r3(baseIn), baseOut: r3(baseOut), takeIn: r3(takeIn), segLen: r3(segLen), delta: r3(delta), words, pauses, newWords: T.slice(k) };
}

export function spliceAudio(baseMp3, takeMp3, plan, out) {
  const graph = [
    `[0:a]aresample=44100,${FMT},asplit=2[x][y]`,
    `[x]atrim=end=${plan.baseIn.toFixed(6)},asetpts=PTS-STARTPTS[p0]`,
    `[1:a]aresample=44100,${LEVEL},aresample=44100,${FMT},atrim=start=${plan.takeIn.toFixed(6)},asetpts=PTS-STARTPTS,apad,atrim=end=${plan.segLen.toFixed(6)}[p1]`,
    `[y]atrim=start=${plan.baseOut.toFixed(6)},asetpts=PTS-STARTPTS[p2]`,
    '[p0][p1][p2]concat=n=3:v=0:a=1[a]',
  ].join(';');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', baseMp3, '-i', takeMp3, '-filter_complex', graph, '-map', '[a]', '-ac', '1', '-b:a', '192k', out]);
  if (r.status !== 0) throw new Error(`splicing the new line in failed: ${(r.stderr || '').slice(-300)}`);
}

/* ── files ──────────────────────────────────────────────────────────────────────────────────────────────────────────── */
// the voice the line is changed in: for --vertical the vertical voice when there is one (so several lines can change), else
// the wide voice; the result goes to the vertical files, or to the *-revoiced files for the wide voice
function filesFor(dir, vertical) {
  const p = (...x) => path.join(dir, ...x);
  const wide = { vo: p('audio', 'vo.mp3'), words: p('build', 'words.json'), pauses: p('build', 'pauses.json') };
  const vert = { vo: p('audio', 'vo-vertical.mp3'), words: p('build', 'words-vertical.json'), pauses: p('build', 'pauses-vertical.json') };
  const revoiced = { vo: p('audio', 'vo-revoiced.mp3'), words: p('build', 'words-revoiced.json'), pauses: p('build', 'pauses-revoiced.json') };
  if (!vertical) return { base: wide, out: revoiced };
  const own = fs.existsSync(vert.vo) && fs.existsSync(vert.words);
  return { base: own ? { ...vert, pauses: fs.existsSync(vert.pauses) ? vert.pauses : wide.pauses } : wide, out: vert };
}
const rel = (dir, f) => path.relative(dir, f).split(path.sep).join('/');

function writeResult(out, plan) {
  fs.writeFileSync(out.words, '[\n' + plan.words.map((w) => JSON.stringify({ w: w.w, s: w.s, e: w.e })).join(',\n') + '\n]');
  if (plan.pauses.length) fs.writeFileSync(out.pauses, JSON.stringify(plan.pauses, null, 1) + '\n'); else fs.rmSync(out.pauses, { force: true });
}

// --use: the last wide revoice becomes the voice; the voice before it is kept next to it
export function useRevoiced(dir, log = console.log) {
  const { base, out } = filesFor(dir, false);
  if (!fs.existsSync(out.vo) || !fs.existsSync(out.words)) throw new Error('no revoiced voice to use: run video revoice <folder> --line ... --to ... --apply first');
  const keep = { vo: path.join(dir, 'audio', 'vo-before-revoice.mp3'), words: path.join(dir, 'build', 'words-before-revoice.json'), pauses: path.join(dir, 'build', 'pauses-before-revoice.json') };
  for (const x of ['vo', 'words', 'pauses']) {
    if (fs.existsSync(base[x])) fs.copyFileSync(base[x], keep[x]); else fs.rmSync(keep[x], { force: true });
    if (fs.existsSync(out[x])) fs.renameSync(out[x], base[x]); else fs.rmSync(base[x], { force: true });
  }
  scenes.writeWords(dir, readJSON(base.words, []));          // word_index.txt to match
  const srcNew = path.join(dir, 'build', 'voice_source-revoiced.json');
  if (fs.existsSync(srcNew)) {                               // who spoke the voice now (a mix of two voices says so)
    const rec = { ...readJSON(srcNew, {}), at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), vo_sha256: checks.sha256File(base.vo) };
    fs.writeFileSync(path.join(dir, 'build', 'voice_source.json'), JSON.stringify(rec, null, 1) + '\n');
    fs.rmSync(srcNew, { force: true });
    checks.logVoice(dir, `a line was voiced again: ${checks.voiceLabel(rec)}, word times ${rec.timings}, audio/vo.mp3 ${String(rec.vo_sha256).slice(0, 12)}`);
  }
  log(`audio/vo.mp3 is now the revoiced voice (the one before it: ${rel(dir, keep.vo)}, ${rel(dir, keep.words)}).`);
  log('Note: video voice joins the voice from its chunks again, which would undo this. Change script.txt to the new words too, so the script, captions and fact check agree.');
}

/* ── the command ────────────────────────────────────────────────────────────────────────────────────────────────────── */
export async function cli(video, flags, log = console.log) {
  const dir = video.dir;
  if (flags.use) return useRevoiced(dir, log);
  if (typeof flags.line !== 'string' || typeof flags.to !== 'string') throw new Error('give the line to change and the new words: video revoice <folder> --line "old words" --to "new words" [--vertical] [--apply]');
  if (scenes.standInIsActive(dir)) throw new Error('audio/vo.mp3 is the stand-in tone, not a voice: voice the script first (video voice)');
  const vertical = Boolean(flags.vertical);
  const { base, out } = filesFor(dir, vertical);
  const words = readJSON(base.words, null);
  if (!Array.isArray(words) || !words.length || !fs.existsSync(base.vo)) throw new Error(`no voice to change (${rel(dir, base.vo)} and ${rel(dir, base.words)}): voice the script first (video voice)`);
  const span = findLine(words, flags.line);
  const lead = leadIn(words, span.a);
  const newText = flags.to.replace(/\s+/g, ' ').trim();
  if (!toks(newText).length) throw new Error('--to has no words');
  const request = lead.text ? `${lead.text} ${newText}` : newText;

  const set = voiceSetup(video, flags, { verb: 'revoicing' });
  // the provider joins the take's id only when it is not ElevenLabs, so takes already paid for keep their id (and stay free)
  const id = createHash('sha256').update(JSON.stringify([request, set.voiceCfg ?? null, set.speed, set.extra, ...(set.provider && set.provider !== 'elevenlabs' ? [set.provider] : [])])).digest('hex').slice(0, 12);
  const take = path.join(dir, 'build', 'revoice', id);
  const done = chunkDone(take, request, set.provider);
  log(`line: "${words.slice(span.a, span.b + 1).map((w) => w.w).join(' ')}" (${words[span.a].s.toFixed(2)} to ${words[span.b].e.toFixed(2)} s in ${rel(dir, base.vo)})`);
  log(`lead-in: ${lead.text ? `"${lead.text}" (${span.a - lead.from} word${span.a - lead.from === 1 ? '' : 's'}, voiced for the pace, then cut off)` : 'none (the line is the first thing said)'}`);
  log(`will send: ${request.length} characters (${lead.text.length ? `${lead.text.length + 1} lead-in + ` : ''}${newText.length} new line) at speed ${set.speed}${done ? ': already voiced, free (reused)' : set.provider === 'elevenlabs' ? ': a paid voice call' : set.provider === 'local' ? ': the free built-in voice, no credits' : ''}`);
  log(`result: ${rel(dir, out.vo)} + ${rel(dir, out.words)}${vertical ? ' (the vertical voice only; the YouTube voice is not touched)' : ' (the YouTube voice is not touched until --use)'}`);
  if (/\d/.test(newText)) log('note: the new line has a number in it. Check it is in research.md before it is said.');
  if (!flags.apply) { log('a dry run: nothing sent. Add --apply to voice it.'); return { dry: true, request, id }; }

  if (!done) creditCheck([request], path.join(dir, 'build', 'revoice'), flags, set.provider);
  fs.mkdirSync(path.join(take, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(take, 'script.txt'), request + '\n');
  fs.writeFileSync(path.join(take, 'reel.json'), JSON.stringify({ voice: set.voiceCfg }, null, 1) + '\n');
  const r = spawnSync(process.env.PYTHON || 'python3', [set.py, take, '--speed', String(set.speed), ...set.extra, ...set.providerArgs], { stdio: ['inherit', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 26 });
  relay(r.stderr, new Set());
  if (r.status !== 0) throw new Error('voice.py stopped. Nothing was changed; fix the cause and run revoice again (an ElevenLabs take already made is not paid for twice).');
  const takeSource = readJSON(path.join(take, 'build', 'voice_source.json'), null);
  const takeWords = readJSON(path.join(take, 'build', 'words.json'), []);
  const takeLen = mediaLength(path.join(take, 'audio', 'vo.mp3'));
  const plan = planSplice({ words, length: mediaLength(base.vo), pauses: readJSON(base.pauses, []) || [] }, span, { words: takeWords, length: takeLen }, toks(newText).length);
  const got = plan.newWords.map((w) => scenes.normWord(w.w)), want = toks(newText);
  if (!want.every((t, i) => same(t, got[i] || ''))) log(`WARNING: the take's last words ("${plan.newWords.map((w) => w.w).join(' ')}") are not quite the new line ("${newText}"). Listen before using it.`);

  // write to a temporary file first: the base and the result are the same file for a second vertical revoice
  const tmpOut = out.vo.replace(/\.mp3$/, '.tmp.mp3');
  spliceAudio(base.vo, path.join(take, 'audio', 'vo.mp3'), plan, tmpOut);
  fs.renameSync(tmpOut, out.vo);
  writeResult(out, plan);
  const length = mediaLength(out.vo);
  const late = scenes.clockCheck(plan.words, length, rel(dir, out.vo));
  if (takeSource?.timings === 'estimated') log(`WARNING: the new line's word times are estimated (not measured), so the cut between the lead-in and the line may clip a word and captions may drift. Listen to it. ${checks.WHISPER_ADVICE} then run revoice again.`);
  if (!vertical) {    // who spoke the revoiced voice: --use makes it the record of audio/vo.mp3
    const was = checks.voiceSource(dir) || {};
    const timings = [was.timings, takeSource?.timings].includes('estimated') ? 'estimated' : takeSource?.timings || was.timings || 'provider';
    fs.writeFileSync(path.join(dir, 'build', 'voice_source-revoiced.json'), JSON.stringify({ ...was, provider: was.provider && was.provider !== takeSource?.provider && takeSource?.provider ? 'mixed' : takeSource?.provider || was.provider || set.provider, timings, revoiced: true }, null, 1) + '\n');
  }
  log(`spliced: ${rel(dir, out.vo)} ${length?.toFixed(2)} s (${plan.delta >= 0 ? '+' : ''}${plan.delta.toFixed(2)} s), ${plan.words.length} words → ${rel(dir, out.words)}`);
  if (late) log(`WARNING: ${late}`);
  for (const l of paceReport({ fresh: rate(plan.newWords), old: rate(words.slice(span.a, span.b + 1)), episode: episodeRate(words) })) log(l);
  log(vertical ? 'next: video render <folder> --vertical (only the scenes around the line are drawn again)' : 'next: listen to audio/vo-revoiced.mp3, then  video revoice <folder> --use  to make it the voice');
  return { request, id, plan, length };
}
