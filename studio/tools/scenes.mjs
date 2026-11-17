// scenes.mjs · scene styles in the Video Kit (adapted from the Reel Kit's, 1920x1080). A scene style is not a mode: a video in a scene style is an
// ordered list of scenes (scenes.json), each one a self-contained page that styles/_core/build-scene.mjs makes from the
// shared runtime, the style's engine and one template with props. Each scene is rendered to its own mp4 (seeking the
// page's window.__scene frame by frame), the scenes are joined without encoding the picture again, and the video's own
// voice goes under the whole thing. SKILL.md is the agreement.
//
// Everything here reads only this kit: styles/STYLES.json (the registry the styles repo's sync writes) and styles/<id>/.
// The browser is the kit's own (tools/chromium.mjs), so no new dependency.
//
// What a scene-style reel folder holds and what this writes:
//   video.json, script.txt, scenes.json        the plan (see planOf below for the format)
//   audio/vo.mp3, build/words.json            from tools/voice.py (or `video stand-in <dir>` for a no-key preview)
//   build/scene_times.json                    each scene's start and end on the video's clock, and how it was found
//   build/scenes/NNN.html|.props.json|.words.json   the built scene pages
//   build/scenes/NNN.mp4 + NNN.json           each rendered scene and its manifest (content hash, errors, S.inspect boxes)
//   build/video.mp4, build/draft.mp4          the video at 1920x1080 and half size, where `video render` writes them
//   build/scene_boxes.json                    resting S.inspect boxes on the video's clock (tools/qa.py checks the safe zone)
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './chromium.mjs';
import * as licensed from './licensed.mjs';

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // the studio/ folder
export const STYLES_DIR = path.join(SKILL, 'styles');
const CORE = path.join(STYLES_DIR, '_core');
let W = 1920, H = 1080;
const FPS = 30;
let SAFE = { top: 54, bottom: 54, left: 96, right: 96 };           // title-safe: 5% of the picture on every side (long-form video has no app buttons over it)
let SAFE_BOX = [SAFE.left, SAFE.top, W - SAFE.right, H - SAFE.bottom];
// The shape. "wide" (default) is the YouTube video. "vertical" (owner, 2026-11-13: Instagram always gets a vertical
// full episode) draws the same scenes, voice and words at 1080x1920 with the Reel Kit's safe area (app buttons and
// captions cover the top and bottom), in build/scenes-vertical/, and joins them as build/vertical.mp4, so the wide
// video's scenes and caches are never touched.
let SHAPE = { name: 'wide', scenes: 'scenes', video: 'video.mp4', draft: 'draft.mp4', boxes: 'scene_boxes.json', errors: 'render_errors.txt' };
export const safeBox = () => [...SAFE_BOX];
export const VERTICAL_SAFE = { top: 250, bottom: 300, left: 60, right: 120 };
export function setShape(shape) {
  if (shape !== 'vertical') return SHAPE;
  W = 1080; H = 1920;
  SAFE = { top: 250, bottom: 300, left: 60, right: 120 }; // the Reel Kit's one safe zone: app buttons sit on the right
  SAFE_BOX = [SAFE.left, SAFE.top, W - SAFE.right, H - SAFE.bottom];
  SHAPE = { name: 'vertical', scenes: 'scenes-vertical', video: 'vertical.mp4', draft: 'draft-vertical.mp4', boxes: 'scene_boxes-vertical.json', errors: 'render_errors-vertical.txt' };
  return SHAPE;
}
const TOL = 6;                                          // px of slack on the safe area, as in the styles repo's tester
const RENDER_VERSION = 'scenes-2';                      // change it when the frame loop or the codec settings change
const MIN_SCENE = 0.5;                                  // s; a scene shorter than this is squeezed out of its neighbours

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const sha = (...parts) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest('hex'); };
const pad = (n) => String(n).padStart(3, '0');
const r3 = (x) => Math.round(x * 1000) / 1000;

/* ── the registry ───────────────────────────────────────────────────────────────────────────────────────────────────── */
export function registry() { return readJSON(path.join(STYLES_DIR, 'STYLES.json'), null); }

// the scene styles this kit can make: in the registry, made for wide video, and with an engine on disk
export function sceneStyleIds() {
  const reg = registry();
  if (!reg || !Array.isArray(reg.styles)) return [];
  return reg.styles.filter((s) => (s.formats || []).includes('wide') && fs.existsSync(path.join(STYLES_DIR, s.id, 'engine.js'))).map((s) => s.id);
}
export const isSceneStyle = (id) => typeof id === 'string' && sceneStyleIds().includes(id);

export function styleInfo(id) {
  const entry = (registry()?.styles || []).find((s) => s.id === id);
  if (!entry) return null;
  return { ...entry, dir: path.join(STYLES_DIR, id), templateDefs: readJSON(path.join(STYLES_DIR, id, 'templates.json'), []) };
}

/* ── words ──────────────────────────────────────────────────────────────────────────────────────────────────────────── */
// the same folding as the runtime's V.find: lower case, accents dropped, only letters and digits
export const normWord = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const tokens = (text) => String(text ?? '').split(/\s+/).map(normWord).filter(Boolean);
const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

// build/words.json and build/word_index.txt in the format tools/voice.py and tools/take.py write (kitcore.write_words)
export function writeWords(dir, words) {
  const build = path.join(dir, 'build');
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(build, 'words.json'), '[\n' + words.map((w) => JSON.stringify({ w: w.w, s: w.s, e: w.e })).join(',\n') + '\n]');
  const f = (x) => x.toFixed(2).padStart(7);
  fs.writeFileSync(path.join(build, 'word_index.txt'), words.map((w, n) => `${String(n).padStart(4)} ${f(w.s)} ${f(w.e)}  ${w.w}`).join('\n'));
}

// speech-like fake word times (longer words take longer, pauses after commas and full stops): the styles repo's
// make-examples rule, so a stand-in voice paces like the examples the engines were tested with
export function fakeWords(text, pace = 0.38, start = 0.35) {
  let t = start;
  return String(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).map((w) => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, '').length;
    const len = pace * (0.55 + 0.12 * Math.min(letters, 9));
    const s = r3(t), e = r3(s + len * 0.8);
    t += len + (/[.!?]["')]*$/.test(w) ? 0.55 : /[,;:]["')]*$/.test(w) ? 0.28 : 0);
    return { w, s, e };
  });
}

// A cutaway scene: {"clip": {"asset": id, "start": s, "duration": s, "mute": true}} for a recorded licensed stock video, or
// {"clip": {"file": "<path>", ...}} for the owner's own render (Blender, code). The picture fills the frame (scaled and cropped),
// the clip's own sound is never used (it is always muted), and the scene's time comes from its narration like any scene.
// Exactly one of "asset" and "file". A file is the owner's own work: no register entry, no credit (licensed.mjs, ownFile).
function sourceOf(x, kind, n, what) {
  const has = (k) => x[k] !== undefined && x[k] !== null;
  if (has('asset') && has('file')) throw new Error(`scene ${n}: "${kind}" takes either "asset" (a recorded licensed ${what}) or "file" (your own render), not both`);
  if (has('file')) {
    if (typeof x.file !== 'string' || !x.file.trim()) throw new Error(`scene ${n}: ${kind} "file" must be a path (text) inside the channel folder, for example "assets/blender/shot.mov"`);
    try { return { file: licensed.checkOwnPath(x.file) }; } catch (e) { throw new Error(`scene ${n}: ${kind} ${e.message}`); }
  }
  if (typeof x.asset !== 'string' || !x.asset) throw new Error(`scene ${n}: "${kind}" needs exactly one of "asset" (a recorded licensed ${what} id) or "file" (your own render, a path inside the channel folder)`);
  return { asset: x.asset };
}
export function normalizeClip(c, n) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(`scene ${n}: "clip" must be {"asset": "<stock-video id>", "start": seconds, "duration": seconds} or {"file": "<path>", "start": seconds, "duration": seconds}`);
  const src = sourceOf(c, 'clip', n, 'stock-video');
  const start = c.start == null ? 0 : Number(c.start), duration = c.duration == null ? null : Number(c.duration);
  if (!Number.isFinite(start) || start < 0) throw new Error(`scene ${n}: clip "start" must be 0 or more seconds`);
  if (duration != null && !(Number.isFinite(duration) && duration > 0)) throw new Error(`scene ${n}: clip "duration" must be more than 0 seconds`);
  if (c.mute === false) throw new Error(`scene ${n}: a clip is always muted ("mute": true); the voice and the music are the sound`);
  return { ...src, start, duration, mute: true };
}
// An overlay on any scene: {"overlay": {"asset": id | "file": path, "blend": "normal"|"screen", "opacity": 0..1, "at": s, "duration": s}}
export function normalizeOverlay(o, n) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`scene ${n}: "overlay" must be {"asset": "<motion-graphic id>" or "file": "<path>", "blend": "normal|screen", "opacity": 0-1, "at": seconds, "duration": seconds}`);
  const src = sourceOf(o, 'overlay', n, 'motion-graphic');
  const blend = o.blend == null ? 'normal' : String(o.blend), opacity = o.opacity == null ? 1 : Number(o.opacity), at = o.at == null ? 0 : Number(o.at), duration = o.duration == null ? null : Number(o.duration);
  if (!['normal', 'screen'].includes(blend)) throw new Error(`scene ${n}: overlay "blend" must be normal or screen (it is "${o.blend}")`);
  if (!(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)) throw new Error(`scene ${n}: overlay "opacity" must be from 0 to 1`);
  if (!Number.isFinite(at) || at < 0) throw new Error(`scene ${n}: overlay "at" must be 0 or more seconds into the scene`);
  if (duration != null && !(Number.isFinite(duration) && duration > 0)) throw new Error(`scene ${n}: overlay "duration" must be more than 0 seconds`);
  return { ...src, blend, opacity, at, duration };
}
// where a clip's or overlay's picture file is: a recorded licensed asset (by id) or the owner's own file (by path)
export function sourceFile(x, type, root, videoDir) {
  if (x.file != null) return licensed.ownFile(root, videoDir || root, x.file);
  if (!root) throw new Error(`the asset "${x.asset}" is a licensed asset, but this video is not inside a channel folder (one with brand/brand.json)`);
  return licensed.resolveAsset(root, x.asset, type).abs;
}

/* ── the plan ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
// scenes.json: {"scenes": [{"template": "<id>", "props": {...}, "narration": "the words this scene covers"}, ...]}
// (a bare list works too). Optional per scene: "id", "seed", or "code": "scenes/02.js" (the body of scene(V, S, root),
// the style's docs.md API) instead of "template". Times are never typed: they come from build/words.json.
export function planOf(dir, style) {
  const file = path.join(dir, 'scenes.json');
  if (!fs.existsSync(file)) throw new Error(`no scenes.json in ${dir}: write the scene plan first (SKILL.md, "The plan")`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`scenes.json is not valid JSON: ${e.message}`); }
  const list = Array.isArray(raw) ? raw : raw?.scenes;
  if (!Array.isArray(list) || !list.length) throw new Error('scenes.json has no scenes (want {"scenes": [{"template", "props", "narration"}, ...]})');
  const info = styleInfo(style);
  const known = new Set(info?.templates || []);
  const notes = [];
  const scenes = list.map((s, k) => {
    if (!s || typeof s !== 'object') throw new Error(`scene ${k + 1} in scenes.json is not an object`);
    // "vertical": {...} on a scene changes it for the vertical (Instagram) version only, e.g. {"props": {"title": "Like, follow, share"}, "narration": "..."}
    if (SHAPE.name === 'vertical' && s.vertical && typeof s.vertical === 'object') s = { ...s, ...s.vertical, props: { ...(s.props || {}), ...(s.vertical.props || {}) } };
    if (!s.template && !s.code && !s.clip) throw new Error(`scene ${k + 1} has no "template" (or "code", or "clip")`);
    if (s.clip && (s.template || s.code)) throw new Error(`scene ${k + 1}: a "clip" scene has no template or code (the clip is the picture)`);
    const clip = s.clip ? normalizeClip(s.clip, k + 1) : null;
    const overlays = s.overlay != null ? [].concat(s.overlay).map((o) => normalizeOverlay(o, k + 1)) : [];
    if (s.template && !known.has(s.template)) throw new Error(`scene ${k + 1}: ${style} has no template "${s.template}". It has: ${[...known].join(', ')}`);
    if (s.code && !fs.existsSync(path.join(dir, s.code))) throw new Error(`scene ${k + 1}: its code file ${s.code} does not exist`);
    if (s.props != null && (typeof s.props !== 'object' || Array.isArray(s.props))) throw new Error(`scene ${k + 1}: "props" must be an object`);
    const def = info?.templateDefs?.find((t) => t.id === s.template);
    const allowed = Object.keys(def?.propsSchema?.properties || {});
    const extra = allowed.length ? Object.keys(s.props || {}).filter((p) => !allowed.includes(p)) : [];
    if (extra.length) notes.push(`scene ${k + 1} (${s.template}): props the template does not know, ignored by the engine: ${extra.join(', ')}`);
    let pause = 0;
    if (s.pause != null && s.pause !== 0) {
      pause = Number(s.pause);
      if (!Number.isFinite(pause) || pause < 0 || pause > 60) throw new Error(`scene ${k + 1}: "pause" must be a number of seconds from 0 to 60 (it is ${JSON.stringify(s.pause)})`);
      pause = Math.round(pause * FPS) / FPS;                    // on a frame, so the scenes after it move by whole frames
    }
    if (!String(s.narration || '').trim() && !pause) notes.push(`scene ${k + 1}: no "narration", so its time can only be guessed (even split)`);
    return { n: k + 1, file: pad(k + 1), id: String(s.id || `${String(k + 1).padStart(2, '0')}-${s.template || (clip ? 'clip' : 'custom')}`),
      chapter: s.chapter ? String(s.chapter).trim() : null, template: s.template || null, code: s.code || null, props: s.props || {}, narration: String(s.narration || ''), seed: s.seed,
      ...(clip ? { clip } : {}), ...(overlays.length ? { overlays } : {}),
      ...(pause ? { pause } : {}), ...(s.sfx != null ? { sfx: s.sfx } : {}), ...(s.enter != null ? { enter: s.enter } : {}) };
  });
  return { scenes, notes };
}

// The narration of every scene lined up with build/words.json (longest common subsequence of the folded words): each scene's
// first and last word found, how many were found, and whether that is enough (half its words) to anchor it.
export function alignScenes(scenes, words) {
  const A = [];                                                  // [token, scene index]
  scenes.forEach((s, k) => tokens(s.narration).forEach((t) => A.push([t, k])));
  const B = (words || []).map((w) => normWord(w.w));
  const n = A.length, m = B.length;
  const span = scenes.map(() => ({ a: null, b: null, hits: 0 }));
  if (n && m) {
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = B[j] && same(A[i][0], B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (B[j] && same(A[i][0], B[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) {
        const sp = span[A[i][1]];
        sp.a = sp.a ?? j; sp.b = j; sp.hits++; i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
  }
  const counts = scenes.map((s) => tokens(s.narration).length);
  const anchored = span.map((sp, k) => counts[k] > 0 && sp.hits >= Math.max(1, Math.ceil(counts[k] * 0.5)));
  return { span, counts, anchored };
}

// Each scene's [t0, t1] on the video's clock. A scene anchored to its words (alignScenes) starts and ends at them, and the
// cut between two scenes falls in the middle of the gap between the last word of one and the first word of the next. Scenes
// that cannot be anchored (no words.json yet, or narration that is not in the voice) share the time between their neighbours
// evenly. A scene with a "pause" starts where its silence starts (pauses: build/pauses.json), so the silence is its own.
// endCard: seconds the video runs on after the voice (video.json "end_card"). Every cut is put on a frame, so the scene
// lengths add up to the video exactly.
export function timeScenes(scenes, words, { voLength = null, tail = 0.6, fallbackLength = null, pauses = [], endCard = 0 } = {}) {
  const N = scenes.length;
  const m = (words || []).length;
  const { span, counts, anchored } = alignScenes(scenes, words);
  const n = counts.reduce((x, y) => x + y, 0);
  const lastEnd = m ? words[m - 1].e : 0;
  const end = (m ? Math.max(voLength || 0, lastEnd + tail) : (voLength || fallbackLength || Math.max(3, n * 0.42 + 1))) + Math.max(0, Number(endCard) || 0);

  const bnd = new Array(N + 1).fill(null);
  bnd[0] = 0; bnd[N] = end;
  for (let k = 1; k < N; k++) {
    const prev = anchored[k - 1] ? words[span[k - 1].b].e : null, next = anchored[k] ? words[span[k].a].s : null;
    if (prev != null && next != null) bnd[k] = next >= prev ? (prev + next) / 2 : next;
    else if (next != null) bnd[k] = Math.max(0, next - 0.15);
    else if (prev != null) bnd[k] = prev + 0.15;
  }
  for (const p of pauses || []) if (p.n - 1 >= 1 && p.n - 1 < N && Number.isFinite(p.at)) bnd[p.n - 1] = Math.min(Math.max(0, p.at), end);
  // unknown cuts: even split between the known ones around them
  for (let k = 1; k < N; k++) {
    if (bnd[k] != null) continue;
    let j = k; while (bnd[j] == null) j++;
    const a = bnd[k - 1], b = bnd[j], steps = j - (k - 1);
    for (let x = k; x < j; x++) bnd[x] = a + ((b - a) * (x - (k - 1))) / steps;
  }
  // on frames, in order, no scene under MIN_SCENE where room allows
  const minF = Math.round(MIN_SCENE * FPS);
  const f = bnd.map((t) => Math.round(t * FPS));
  for (let k = 1; k <= N; k++) if (f[k] < f[k - 1] + minF) f[k] = f[k - 1] + minF;
  for (let k = N - 1; k >= 1; k--) if (f[k] > f[k + 1] - minF) f[k] = Math.max(f[k - 1] + 1, f[k + 1] - minF);
  return scenes.map((s, k) => ({
    n: s.n, id: s.id, template: s.template, t0: f[k] / FPS, t1: f[k + 1] / FPS, frames: f[k + 1] - f[k],
    source: anchored[k] ? 'words' : 'even', found: span[k].hits, of: counts[k],
    first: anchored[k] ? words[span[k].a].w : null, last: anchored[k] ? words[span[k].b].w : null,
  }));
}

/* ── pauses: a silent stretch in the voice for a scene ("pause": seconds in scenes.json) ─────────────────────────────── */
// A brand intro or an end card needs time with no voice. When the voice is joined (video voice, video stand-in), each scene
// with a "pause" gets that much silence spliced into audio/vo.mp3 at its place, and the word clock after it moves on by the
// same amount. The place is just before the scene's first word (for a scene with no narration, before the first word of the
// next scene that has words; at the very start for an intro, at the very end for an end card): the middle of the gap between
// that word and the one before it, so the splice falls between words.
// placePauses: [{n, id, seconds, at}] with "at" on the clock of the voice before any silence goes in.
export function placePauses(scenes, words, audioLength) {
  const want = (scenes || []).filter((s) => s.pause > 0);
  if (!want.length) return [];
  const W = words || [];
  const { span, anchored } = alignScenes(scenes, W);
  return want.map((s) => {
    const k = s.n - 1;
    let ni = null;
    for (let j = k; j < scenes.length; j++) if (anchored[j]) { ni = span[j].a; break; }
    let at;
    if (ni == null) at = audioLength;                           // nothing said after it: the end
    else if (ni === 0) at = 0;                                  // nothing said before it: the start
    else { const a = W[ni - 1].e, b = W[ni].s; at = b >= a ? (a + b) / 2 : b; }
    return { n: s.n, id: s.id, seconds: s.pause, at: r3(Math.max(0, Math.min(at, audioLength ?? at))) };
  });
}

// The word clock with the silences in. A word that starts at or after a splice moves on by the silence before it; a word
// that starts before a splice and would end after it (a straddling word) is cut to end at the splice, so it can never take
// the whole silence as its own length. Returns the words, the splices on the new clock ({n, id, seconds, at, from}: at is
// where the silence starts in the new voice, from where it went in the old one) and how many words were cut.
export function applyPauses(words, placed) {
  const order = [...(placed || [])].sort((x, y) => x.at - y.at || x.n - y.n);
  let clamped = 0;
  const out = (words || []).map((w) => {
    let shift = 0, e = w.e;
    for (const p of order) {
      if (w.s >= p.at - 1e-9) shift += p.seconds;
      else if (e > p.at + 1e-9) { e = p.at; clamped++; break; }
    }
    return { w: w.w, s: r3(w.s + shift), e: r3(Math.max(w.s, e) + shift) };
  });
  let before = 0;
  const splices = order.map((p) => { const x = { n: p.n, id: p.id, seconds: p.seconds, at: r3(p.at + before), from: p.at }; before += p.seconds; return x; });
  return { words: out, splices, clamped, added: before };
}

export function writePauses(dir, splices) {
  const f = path.join(dir, 'build', 'pauses.json');
  if (splices && splices.length) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(splices, null, 1) + '\n'); }
  else fs.rmSync(f, { force: true });
}

// The last word must end before the audio does: a word clock that runs past it makes captions and cuts late (a re-voiced
// piece once ran 1.35 s past). Returns a warning, or null.
export function clockCheck(words, audioLength, where = 'the voice') {
  const last = (words || []).at(-1);
  if (!last || !Number.isFinite(audioLength)) return null;
  const over = last.e - audioLength;
  return over > 0.05 ? `${where}: the word clock runs ${over.toFixed(2)} s past the audio (the last word ends at ${last.e.toFixed(2)} s, the audio at ${audioLength.toFixed(2)} s), so captions and scene cuts there will be late` : null;
}

function mediaLength(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const v = parseFloat(r.stdout);
  return Number.isFinite(v) ? v : null;
}

// plan + times + words, without building anything
export function prepare(reel) {
  const { scenes, notes } = planOf(reel.dir, reel.cfg.style);
  // vertical: its own voice when there is one (audio/vo-vertical.mp3 + build/words-vertical.json, e.g. "follow" for "subscribe")
  const own = SHAPE.name === 'vertical' && fs.existsSync(path.join(reel.dir, 'audio', 'vo-vertical.mp3')) && fs.existsSync(path.join(reel.dir, 'build', 'words-vertical.json'));
  const words = readJSON(path.join(reel.dir, 'build', own ? 'words-vertical.json' : 'words.json'), []) || [];
  const vo = path.join(reel.dir, 'audio', own ? 'vo-vertical.mp3' : 'vo.mp3');
  const voLength = fs.existsSync(vo) ? mediaLength(vo) : null;
  // the pauses the voice was joined with; one that scenes.json no longer asks for (or asks for differently) is not used
  // (a vertical voice changed by video revoice keeps its own, build/pauses-vertical.json: a longer line moves the end card)
  const ownPauses = own && fs.existsSync(path.join(reel.dir, 'build', 'pauses-vertical.json'));
  const joined = words.length ? readJSON(path.join(reel.dir, 'build', ownPauses ? 'pauses-vertical.json' : 'pauses.json'), []) || [] : [];
  const pauses = joined.filter((p) => scenes[p.n - 1] && Math.abs((scenes[p.n - 1].pause || 0) - p.seconds) < 1e-6);
  if (words.length) {
    for (const s of scenes) if (s.pause && !pauses.some((p) => p.n === s.n)) notes.push(`scene ${s.n}: its "pause" (${s.pause.toFixed(2)} s) is not in the voice yet: run  video voice <folder>  again (free: no piece is voiced again) or video stand-in`);
    for (const p of joined) if (!pauses.includes(p)) notes.push(`the voice has a ${p.seconds.toFixed(2)} s pause for scene ${p.n} that scenes.json no longer asks for: run  video voice <folder>  again (free)`);
    const late = clockCheck(words, voLength);
    if (late) notes.push(late);
  }
  const endCard = Math.max(0, Number(reel.cfg.end_card) || 0);
  const times = timeScenes(scenes, words, { voLength, tail: Number(reel.cfg.tail ?? 0.6), fallbackLength: Number(reel.cfg.duration) || null, pauses, endCard });
  if (!words.length) notes.push('no build/words.json yet: scene times are an even split (voice the script first, or video stand-in <dir>)');
  for (const t of times) {
    if (t.source === 'even' && words.length) notes.push(`scene ${t.n}: only ${t.found} of ${t.of} narration words were found in build/words.json, so its time is shared evenly with its neighbours`);
    const d = t.t1 - t.t0;
    if (d < 2) notes.push(`scene ${t.n} lasts only ${d.toFixed(2)} s: the engine needs time to draw; give it more narration or merge it`);
    if (d > 16) notes.push(`scene ${t.n} lasts ${d.toFixed(1)} s: split it, a scene this long sits still`);
  }
  return { scenes, times, words, notes, pauses, endCard, vo: voLength ? vo : null, voLength, length: times.length ? times.at(-1).t1 : 0 };
}

/* ── building scene pages ───────────────────────────────────────────────────────────────────────────────────────────── */
// Two fingerprints per scene. "hash" is the picture: the built page holds everything the frames depend on (runtime, engine,
// props, the scene's own words on its own clock, its length, size and seed), and nothing about where the scene sits in the
// video. So when the voice changes in one place (a pause spliced in, one piece voiced again), the scenes whose words and
// length did not change keep their render, even if they moved. "audio" is the slice of the voice in the scene's own clip
// (for --scene previews; the finished video takes the whole voice): when only it changed, the sound is put in again
// without drawing a frame.
export function buildPages(reel, prep) {
  const out = path.join(reel.dir, 'build', SHAPE.scenes);
  fs.mkdirSync(out, { recursive: true });
  const seed = Number(reel.cfg.seed ?? 1);
  const voHash = prep.vo ? sha(fs.readFileSync(prep.vo)) : 'silent';
  return prep.scenes.map((s, k) => {
    const t = prep.times[k], dur = t.frames / FPS;
    const base = path.join(out, s.file);
    const words = prep.words.filter((w) => w.s >= t.t0 - 1e-6 && w.s < t.t1 - 1e-6).map((w) => ({ word: w.w, start: r3(w.s - t.t0), end: r3(Math.min(w.e, t.t1) - t.t0) }));
    fs.writeFileSync(`${base}.words.json`, JSON.stringify(words));
    const extra = licensedHash(reel, s);                      // the stock clip and overlays change the picture, so they change its fingerprint
    if (s.clip) {
      const hash = sha(RENDER_VERSION, 'clip', `${W}x${H}`, `${t.frames}`, extra);
      return { scene: s, time: t, dur, base, html: '', hash, audio: sha(RENDER_VERSION, voHash, `${t.t0}|${t.frames}`) };
    }
    const args = [path.join(CORE, 'build-scene.mjs'), '--style', path.join(STYLES_DIR, reel.cfg.style), '--out', `${base}.html`,
      '--duration', dur.toFixed(6), '--width', String(W), '--height', String(H), '--seed', String(s.seed ?? seed),
      '--narration', s.narration, '--words', `${base}.words.json`];
    // "enter": a scene opens on its finished picture; the vertical version's first scene does by default (frame 0 on Instagram)
    const enter = s.enter ?? (s.n === 1 && SHAPE.name === 'vertical' ? 'none' : null);
    if (enter != null && enter !== 0 && enter !== '0') args.push('--enter', String(enter));
    if (s.template) { fs.writeFileSync(`${base}.props.json`, JSON.stringify(s.props)); args.push('--template', s.template, '--props', `${base}.props.json`); }
    else args.push('--code', path.join(reel.dir, s.code));
    const b = spawnSync(process.execPath, args, { encoding: 'utf8' });
    if (b.status !== 0) throw new Error(`building scene ${s.n} failed: ${(b.stderr || b.stdout).trim().slice(0, 600)}`);
    const html = fs.readFileSync(`${base}.html`);
    const hash = extra ? sha(RENDER_VERSION, html, `${t.frames}`, extra) : sha(RENDER_VERSION, html, `${t.frames}`);
    const audio = sha(RENDER_VERSION, voHash, `${t.t0}|${t.frames}`);
    return { scene: s, time: t, dur, base, html: html.toString('utf8'), hash, audio };
  });
}

/* ── one browser page per scene ─────────────────────────────────────────────────────────────────────────────────────── */
async function openScene(browser, html, scale = 1) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  const blocked = [], pageErrors = [];
  await ctx.route('**/*', (r) => { blocked.push(r.request().url().slice(0, 120)); return r.abort('blockedbyclient'); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => window.__scene.ready);
  return {
    ctx, page, blocked, pageErrors,
    seek: (t) => page.evaluate((tt) => window.__scene.seek(tt), t),
    inspect: (t) => page.evaluate((tt) => (window.SceneStyle && typeof window.SceneStyle.inspect === 'function' ? window.SceneStyle.inspect(tt) : null), t),
    errors: () => page.evaluate(() => (window.__scene.errors || []).slice()),
  };
}

// resting boxes only: entrances, exits and camera moves are marked moving; boxes fully off camera are there on purpose
const resting = (boxes) => (boxes || []).filter((b) => b && !b.moving && b.w > 0 && b.h > 0 && !(b.x > W || b.y > H || b.x + b.w < 0 || b.y + b.h < 0));
const outside = (b) => b.x < SAFE_BOX[0] - TOL || b.y < SAFE_BOX[1] - TOL || b.x + b.w > SAFE_BOX[2] + TOL || b.y + b.h > SAFE_BOX[3] + TOL;

// samples [{t, boxes}] → [{t0, t1, kind, label, x, y, w, h}]: a box that stays put (within a few px: line boil, breathing)
// is one entry over all its samples, grown to cover every sample
function mergeBoxes(samples) {
  const open = [], out = [];
  const near = (a, b) => Math.abs(a.x - b.x) <= 8 && Math.abs(a.y - b.y) <= 8 && Math.abs(a.x + a.w - b.x - b.w) <= 8 && Math.abs(a.y + a.h - b.y - b.h) <= 8;
  for (const { t, boxes } of samples) {
    const still = new Set();
    for (const raw of resting(boxes)) {
      const b = { kind: String(raw.kind ?? ''), label: String(raw.label ?? '').slice(0, 60), x: raw.x, y: raw.y, w: raw.w, h: raw.h };
      const hit = open.find((o) => !still.has(o) && o.kind === b.kind && o.label === b.label && near(o, b));
      if (hit) {
        const x1 = Math.max(hit.x + hit.w, b.x + b.w), y1 = Math.max(hit.y + hit.h, b.y + b.h);
        hit.x = Math.min(hit.x, b.x); hit.y = Math.min(hit.y, b.y); hit.w = x1 - hit.x; hit.h = y1 - hit.y; hit.t1 = t;
        still.add(hit);
      } else { const o = { t0: t, t1: t, ...b }; open.push(o); still.add(o); }
    }
    for (let i = open.length - 1; i >= 0; i--) if (!still.has(open[i])) out.push(...open.splice(i, 1));
  }
  return [...out, ...open].sort((a, b) => a.t0 - b.t0)
    .map((b) => ({ ...b, t0: r3(b.t0), t1: r3(b.t1), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
}

// the scene's slice of the voice (or silence), exactly as long as its frames
function sliceAudio(audio, t0, dur, frames) {
  const samples = Math.round((frames / FPS) * 48000);
  const audioIn = audio ? ['-ss', t0.toFixed(6), '-t', dur.toFixed(6), '-i', audio] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
  const filter = audio
    ? `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_len=${samples},atrim=end_sample=${samples},asetpts=N/SR/TB[a]`
    : `[1:a]atrim=end_sample=${samples},asetpts=N/SR/TB[a]`;
  return { audioIn, filter };
}

// the same codec settings for every scene (the styles repo's render-scene.mjs), so the scenes join without encoding again
const VIDEO_CODEC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-video_track_timescale', '90000'];
const AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];

function encoder(out, audio, t0, dur, frames) {
  const { audioIn, filter } = sliceAudio(audio, t0, dur, frames);
  // the same settings for every scene (the styles repo's render-scene.mjs), so the scenes join without encoding again
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
    ...audioIn, '-filter_complex', filter, '-map', '0:v', '-map', '[a]',
    ...VIDEO_CODEC, ...AUDIO_CODEC, '-t', (frames / FPS).toFixed(6), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => { ff.on('error', reject); ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${c}`)))); });
  return { ff, done };
}

async function renderOne(browser, item, vo) {
  const { scene, time, base, html, hash } = item, frames = time.frames;
  const mp4 = `${base}.mp4`, tmp = `${base}.part.mp4`;
  const view = await openScene(browser, html, 1);
  const cdp = await view.ctx.newCDPSession(view.page);
  const { ff, done } = encoder(tmp, vo, time.t0, item.dur, frames);
  const samples = [];
  try {
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      const r = await cdp.send('Runtime.evaluate', { expression: `window.__scene.seek(${t})` });
      if (r.exceptionDetails) throw new Error(`scene ${scene.n}: seek(${t}) failed: ${r.exceptionDetails.text}`);
      if (i % 15 === 0 || i === frames - 1) samples.push({ t, boxes: await view.inspect(t) });
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, fromSurface: true, optimizeForSpeed: true });
      if (!ff.stdin.write(Buffer.from(shot.data, 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
    }
  } finally { ff.stdin.end(); }
  await done;
  const errors = [...(await view.errors()), ...view.pageErrors, ...view.blocked.map((u) => `network blocked: ${u}`)];
  await view.ctx.close();
  fs.renameSync(tmp, mp4);
  const inspected = samples.some((s) => Array.isArray(s.boxes));
  const manifest = { hash, audio: item.audio, n: scene.n, id: scene.id, template: scene.template, t0: time.t0, t1: time.t1, frames, errors, inspect: inspected, boxes: inspected ? mergeBoxes(samples) : [] };
  fs.writeFileSync(`${base}.json`, JSON.stringify(manifest, null, 1));
  return manifest;
}

// a render of the same picture; its manifest says where it sat and which slice of the voice its clip holds
const freshManifest = (item) => {
  const m = readJSON(`${item.base}.json`, null);
  return m && m.hash === item.hash && m.frames === item.time.frames && fs.existsSync(`${item.base}.mp4`) ? m : null;
};

// the same picture with the scene's new slice of the voice: the frames are copied, only the sound is made again
function reslice(item, vo, m) {
  const { scene, time, base } = item, tmp = `${base}.part.mp4`;
  const { audioIn, filter } = sliceAudio(vo, time.t0, item.dur, time.frames);
  ffmpeg(['-i', `${base}.mp4`, ...audioIn, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', (time.frames / FPS).toFixed(6), '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, `${base}.mp4`);
  const manifest = { ...m, audio: item.audio, n: scene.n, id: scene.id, t0: time.t0, t1: time.t1 };
  fs.writeFileSync(`${base}.json`, JSON.stringify(manifest, null, 1));
  return manifest;
}

function ffmpeg(args, opts = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').trim().slice(-600)}`);
}

// the stand-in voice leaves a note with the fingerprint of the vo.mp3 it made; a real voice take replaces the file
function standInActive(dir) {
  const note = readJSON(path.join(dir, 'build', 'voice-stand-in.json'), null), vo = path.join(dir, 'audio', 'vo.mp3');
  return Boolean(note && fs.existsSync(vo) && note.sha === sha(fs.readFileSync(vo)));
}

/* ── licensed material: stock-video scenes, overlays, the LUT and licensed music (studio/tools/licensed.mjs) ───────── */
// the clip and overlays of a scene, as text that changes when either the setting or the file changes: a licensed asset by its
// recorded sha256, the owner's own file by the sha256 of the file itself (so a re-rendered file redraws only its own scene)
function licensedHash(reel, s) {
  if (!s.clip && !s.overlays?.length) return '';
  const root = licensed.channelRoot(reel.dir), parts = [];
  const one = (x, type) => {
    if (x.file != null) { parts.push(JSON.stringify(x), licensed.ownSha(licensed.ownFile(root, reel.dir, x.file))); return; }
    if (!root) throw new Error(`scene ${s.n} uses a licensed asset, but ${reel.dir} is not inside a channel folder (one with brand/brand.json)`);
    parts.push(JSON.stringify(x), licensed.resolveAsset(root, x.asset, type).rec.sha256);
  };
  if (s.clip) one(s.clip, 'stock-video');
  for (const o of s.overlays || []) one(o, 'motion-graphic');
  return parts.join('|');
}

// A clip scene (stock video or the owner's own render): the clip scaled and cropped to fill the frame, held on its last frame if it is shorter than the scene,
// no sound of its own; the scene's slice of the voice goes under it exactly as for a drawn scene.
export function renderClip(item, vo, root, videoDir = root) {
  const { scene, time, base, hash } = item, frames = time.frames, dur = frames / FPS, tmp = `${base}.part.mp4`;
  const abs = sourceFile(scene.clip, 'stock-video', root, videoDir), label = scene.clip.asset ?? scene.clip.file;
  const len = mediaLength(abs), use = Math.min(scene.clip.duration || dur, dur), notes = [];
  if (len != null && len - scene.clip.start < use - 0.05) notes.push(`its clip "${label}" has only ${Math.max(0, len - scene.clip.start).toFixed(1)} s after ${scene.clip.start} s: the last frame is held`);
  const { audioIn, filter } = sliceAudio(vo, time.t0, dur, frames);
  const picture = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)},trim=duration=${dur.toFixed(6)},setpts=PTS-STARTPTS,format=yuv420p[v]`;
  ffmpeg(['-ss', String(scene.clip.start), '-t', String(use), '-i', abs, ...audioIn, '-filter_complex', `${picture};${filter}`, '-map', '[v]', '-map', '[a]',
    ...VIDEO_CODEC, ...AUDIO_CODEC, '-t', dur.toFixed(6), '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, `${base}.mp4`);
  const manifest = { hash, audio: item.audio, n: scene.n, id: scene.id, template: null, clip: label, t0: time.t0, t1: time.t1, frames, errors: [], notes, inspect: false, boxes: [] };
  fs.writeFileSync(`${base}.json`, JSON.stringify(manifest, null, 1));
  return manifest;
}

// The overlays of a scene composited onto its rendered clip (in place), keeping the scene's sound. "normal" uses the overlay's own
// alpha (.mov, .webm), "screen" lets a black background drop out (light leaks, dust). "at" is seconds into the scene.
export function applyOverlays(base, overlays, dur, root, videoDir = root) {
  if (!overlays?.length) return;
  const tmp = `${base}.part.mp4`, inputs = ['-i', base], chains = [];
  let cur = '[0:v]';
  overlays.forEach((o, j) => {
    const abs = sourceFile(o, 'motion-graphic', root, videoDir);
    inputs.push(...(/\.webm$/i.test(abs) ? ['-c:v', 'libvpx-vp9'] : []), '-i', abs);
    const at = Math.min(o.at, dur), len = Math.max(0.04, Math.min(o.duration || dur, dur - at));
    const fit = `trim=duration=${len.toFixed(3)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}`;
    const out = `[c${j}]`;
    if (o.blend === 'screen') {
      // screen with black changes nothing, so the overlay is padded with black before and after and blended over the whole scene
      // (in RGB: tpad's black in YUV has no chroma and tints the picture)
      chains.push(`${cur}format=gbrp[b${j}]`,
        `[${j + 1}:v]${fit},format=gbrp,tpad=start_mode=add:start_duration=${at.toFixed(3)}:color=black,tpad=stop_mode=add:stop_duration=${dur.toFixed(3)}:color=black,trim=duration=${dur.toFixed(6)},setpts=PTS-STARTPTS[o${j}]`,
        `[b${j}][o${j}]blend=all_mode=screen:all_opacity=${o.opacity}:shortest=1${out}`);
    } else {
      chains.push(`[${j + 1}:v]${fit},format=rgba,colorchannelmixer=aa=${o.opacity},setpts=PTS+${at.toFixed(3)}/TB[o${j}]`,
        `${cur}[o${j}]overlay=eof_action=pass:format=auto:enable='between(t,${at.toFixed(3)},${(at + len).toFixed(3)})'${out}`);
    }
    cur = out;
  });
  ffmpeg([...inputs, '-filter_complex', `${chains.join(';')};${cur}format=yuv420p[v]`, '-map', '[v]', '-map', '0:a', '-c:a', 'copy', ...VIDEO_CODEC,
    '-t', dur.toFixed(6), '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, base);
}

// video.json "look": {"lut": id, "strength": 0..1}
export function lookOf(cfg = {}) {
  const l = cfg.look;
  if (l == null) return null;
  if (typeof l !== 'object' || Array.isArray(l) || typeof l.lut !== 'string' || !l.lut) throw new Error('video.json "look" must be {"lut": "<lut id>", "strength": 0 to 1}');
  const strength = l.strength == null ? 1 : Number(l.strength);
  if (!(Number.isFinite(strength) && strength >= 0 && strength <= 1)) throw new Error('video.json look "strength" must be from 0 to 1');
  return { lut: l.lut, strength };
}
// the whole joined picture through a .cube, mixed back with the ungraded picture by strength (1 = the LUT as it is)
export function applyLook(src, out, cube, strength, workDir) {
  const local = path.join(workDir, 'look.cube');
  fs.copyFileSync(cube, local);                                   // ffmpeg runs in workDir, so the filter needs no escaped path
  const graph = strength >= 1 ? '[0:v]lut3d=file=look.cube,format=yuv420p[v]'
    : `[0:v]split[a][b];[a]lut3d=file=look.cube[g];[g][b]blend=all_mode=normal:all_opacity=${strength}:shortest=1,format=yuv420p[v]`;
  ffmpeg(['-i', src, '-filter_complex', graph, '-map', '[v]', '-an', ...VIDEO_CODEC.map((x, i, a) => (a[i - 1] === '-crf' ? '16' : x)), '-movflags', '+faststart', out], { cwd: workDir });
}

// video.json "music": [{"asset": id, "from": scene id or seconds, "fade": s, "gain_db": -18}]. Each track starts at "from", fades in and
// out over "fade" seconds, runs until the next track starts (they cross-fade) or the end, and loops if it is shorter. The beds are
// mixed, then the same sidechain compression as any music ducks them under the voice. Returns the inputs and the graph that makes [bed].
export function licensedMusic(entries, { times, scenes, seconds, resolve, lengthOf, firstInput = 2 }) {
  if (!entries.length) throw new Error('video.json "music" is an empty list');
  const list = entries.map((e, i) => {
    if (!e || typeof e !== 'object' || typeof e.asset !== 'string') throw new Error(`video.json music[${i}] needs {"asset": "<music id>"}`);
    let from = 0;
    if (e.from != null) {
      if (typeof e.from === 'number') from = e.from;
      else { const k = scenes.findIndex((s) => s.id === String(e.from)); if (k < 0) throw new Error(`video.json music[${i}] "from": "${e.from}" is not a scene id (use a scene's "id", or a number of seconds)`); from = times[k].t0; }
    }
    const fade = e.fade == null ? 2 : Number(e.fade), gain = e.gain_db == null ? -18 : Number(e.gain_db);
    if (!(Number.isFinite(from) && from >= 0 && from < seconds)) throw new Error(`video.json music[${i}] "from" is outside the video (0 to ${seconds.toFixed(1)} s)`);
    if (!(Number.isFinite(fade) && fade >= 0)) throw new Error(`video.json music[${i}] "fade" must be 0 or more seconds`);
    if (!(Number.isFinite(gain) && gain <= 6)) throw new Error(`video.json music[${i}] "gain_db" must be a number of dB, usually -14 to -24`);
    return { ...e, from, fade, gain };
  }).sort((a, b) => a.from - b.from);
  const inputs = [], chains = [];
  list.forEach((e, i) => {
    const file = resolve(e.asset), next = list[i + 1];
    const end = next ? Math.min(seconds, next.from + next.fade) : seconds, len = end - e.from;
    if (len < 0.1) throw new Error(`video.json music[${i}] ("${e.asset}") would play for under 0.1 s`);
    const fade = Math.min(e.fade, len / 2), ms = Math.round(e.from * 1000), tl = lengthOf(file);
    inputs.push(...(Number.isFinite(tl) && tl >= len ? [] : ['-stream_loop', '-1']), '-i', file);
    chains.push(`[${firstInput + i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=end=${len.toFixed(6)},asetpts=PTS-STARTPTS,`
      + `${fade > 0 ? `afade=t=in:st=0:d=${fade.toFixed(3)},afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade.toFixed(3)},` : ''}volume=${e.gain}dB,adelay=${ms}|${ms}[m${i}]`);
  });
  const graph = chains.join(';') + (list.length === 1 ? ';[m0]anull[bed]' : `;${list.map((_, i) => `[m${i}]`).join('')}amix=inputs=${list.length}:duration=longest:dropout_transition=0:normalize=0[bed]`);
  return { inputs, graph, count: list.length };
}

/* ── sound effects ─────────────────────────────────────────────────────────────────────────────── */
// video.json "sfx": "chapters" (default: a whoosh as each chapter starts), "scenes" (also a soft swoosh on every cut) or
// "off". A scene can ask for its own: "sfx": "pop" (at its start) or [{"at": 1.2, "name": "pop", "gain": -3}] (seconds into
// the scene). Names are the Reel Kit sound bank's: whoosh swoosh pop click tick thud impact boom shimmer riser type cash stamp.
// long videos are calmer than reels, so the effects that remain are lifted above the Reel Kit's level to be heard
const SFX_GAIN = 9;
export function sfxCues(items, cfg = {}) {
  const mode = String(cfg.sfx ?? 'chapters');
  if (mode === 'off' || cfg.sfx === false) return [];
  const cues = [];
  items.forEach((it, i) => {
    const t0 = it.time.t0;
    if (i > 0 && it.scene.chapter) cues.push({ t: Math.max(0, t0 - 0.12), name: 'whoosh', gain: -2 });
    else if (i > 0 && mode === 'scenes') cues.push({ t: Math.max(0, t0 - 0.08), name: 'swoosh', gain: -6 });
    const own = typeof it.scene.sfx === 'string' ? [{ at: 0, name: it.scene.sfx }] : Array.isArray(it.scene.sfx) ? it.scene.sfx : [];
    for (const c of own) if (c && c.name) cues.push({ t: t0 + Math.max(0, Number(c.at) || 0), name: String(c.name), gain: Math.min(0, Number(c.gain) || 0) });
  });
  return cues.sort((a, b) => a.t - b.t);
}

function sfxTrack(reel, items, seconds) {
  const cues = sfxCues(items, reel.cfg);
  const build = path.join(reel.dir, 'build'), out = path.join(build, 'sfx.wav'), list = path.join(build, 'sfx.json');
  fs.rmSync(out, { force: true });
  if (!cues.length) return null;
  fs.writeFileSync(list, JSON.stringify(cues, null, 1));
  const r = spawnSync(process.env.PYTHON || 'python3', [path.join(SKILL, 'tools', 'sfx.py'), list, seconds.toFixed(3), out, String(Number(reel.cfg.sfx_gain ?? SFX_GAIN))], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) { console.log(`note: no sound effects this time (${(r.stderr || '').trim().split('\n').pop() || 'sfx.py failed'})`); return null; }
  console.log((r.stdout || '').trim());
  return out;
}

/* ── the music bed ─────────────────────────────────────────────────────────────────────────────── */
// video.json "music_fade": [in, out] in seconds. The bed is cut to the video's length, fades in over the first and out over
// the second, ending exactly with the picture; a track shorter than the video loops, and the fade-out still comes at the
// end. Without "music_fade" it starts at once and fades out over the last 3 s (never a hard cut).
export const MUSIC_FADE = [0, 3];
export function musicFade(cfg = {}) {
  const f = cfg.music_fade;
  if (f == null) return MUSIC_FADE;
  if (!Array.isArray(f) || f.length !== 2 || !f.every((x) => Number.isFinite(Number(x)) && Number(x) >= 0)) throw new Error(`video.json "music_fade" must be [fade-in seconds, fade-out seconds], e.g. [3, 8] (it is ${JSON.stringify(f)})`);
  return f.map(Number);
}
export function musicBed({ seconds, musicLength = null, fade = MUSIC_FADE, volume = 0.18 }) {
  let [fin, fout] = fade;
  if (fin + fout > seconds) { const k = seconds / (fin + fout); fin *= k; fout *= k; }  // a very short video: both fit
  const loop = !(Number.isFinite(musicLength) && musicLength >= seconds);
  const chain = ['aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `atrim=end=${seconds.toFixed(6)}`, 'asetpts=PTS-STARTPTS',
    ...(fin > 0 ? [`afade=t=in:st=0:d=${fin.toFixed(3)}`] : []),
    ...(fout > 0 ? [`afade=t=out:st=${Math.max(0, seconds - fout).toFixed(3)}:d=${fout.toFixed(3)}`] : []),
    `volume=${volume}`].join(',');
  return { loop, chain, fade: [fin, fout] };
}

/* ── render times: how long drawing scenes took in this folder, so `video tidy` can say what a full re-render costs ─ */
// build/render-times.json (kept by tidy): the last RENDER_LOG renders that drew at least one scene, per shape.
const RENDER_LOG = 30;
export function recordRenderTime(dir, { scenes, rendered, seconds }) {
  const f = path.join(dir, 'build', 'render-times.json');
  const log = readJSON(f, []);
  const list = Array.isArray(log) ? log : [];
  list.push({ at: new Date().toISOString().slice(0, 16), shape: SHAPE.name, scenes, rendered, seconds: Math.round(seconds * 10) / 10 });
  try { fs.writeFileSync(f, JSON.stringify(list.slice(-RENDER_LOG), null, 1)); } catch { /* a timing note never stops a render */ }
}

/* ── video render <dir> ─────────────────────────────────────────────────────────────────────────────── */
export async function renderScenes(reel, { only = null, force = false } = {}) {
  const began = Date.now();
  if (reel.cfg.music) musicFade(reel.cfg);                      // a wrong "music_fade" stops here, before any scene is drawn
  const vertical = SHAPE.name === 'vertical';
  const look = vertical ? null : lookOf(reel.cfg);              // so does a wrong "look"
  const prep = prepare(reel);
  const root = licensed.channelRoot(reel.dir);
  // licensed material is for YouTube only: the vertical (Instagram) version carries none of it
  if (vertical) {
    const s = prep.scenes.find((x) => (x.clip?.asset != null && !licensed.verticalOk(root, x.clip.asset)) || x.overlays?.some((o) => o.asset != null && !licensed.verticalOk(root, o.asset)));
    if (s) throw new Error(`scene ${s.n} uses licensed or generated material (stock video, a generated shot or an overlay), which is for YouTube only (your own files, "file", are fine in the vertical version, and so is a generated asset recorded with --vertical-ok). For the vertical version give that scene a "vertical" override without it, for example {"vertical": {"clip": null, "template": "<id>", "props": {...}, "narration": "..."}} (use "overlay": null to drop an overlay), or remove it`);
    if (reel.cfg.look || Array.isArray(reel.cfg.music)) console.log('note: licensed look and music are YouTube only: left out of the vertical version');
  }
  for (const n of prep.notes) console.log(`note: ${n}`);
  const build = path.join(reel.dir, 'build');
  fs.writeFileSync(path.join(build, SHAPE.name === 'vertical' ? 'scene_times-vertical.json' : 'scene_times.json'), JSON.stringify(prep.times, null, 1));
  const items = buildPages(reel, prep);
  // files of scenes no longer in the plan
  for (const f of fs.readdirSync(path.join(build, SHAPE.scenes))) {
    const m = /^(\d{3})\./.exec(f);
    if (m && Number(m[1]) > items.length) fs.rmSync(path.join(build, SHAPE.scenes, f), { force: true });
  }
  let pick = items;
  if (only != null) {
    pick = items.filter((it) => String(it.scene.n) === String(only) || it.scene.id === String(only));
    if (!pick.length) throw new Error(`no scene "${only}" in scenes.json (give its number, 1 to ${items.length}, or its id)`);
  }
  const todo = pick.filter((it) => force || only != null || !freshManifest(it));
  const manifests = new Map(items.map((it) => [it.scene.n, freshManifest(it)]));
  // the same picture in a new place (the voice moved around it): only the clip's sound is made again
  let resliced = 0;
  for (const it of pick) {
    const m = manifests.get(it.scene.n);
    if (todo.includes(it) || !m || m.audio === it.audio) continue;
    manifests.set(it.scene.n, reslice(it, prep.vo, m)); resliced++;
  }
  if (todo.length) {
    const browser = todo.some((it) => !it.scene.clip) ? await launch() : null;   // a stock-video scene needs no browser
    const drawStart = Date.now();
    try {
      for (const it of todo) {
        process.stdout.write(`scene ${it.scene.n}/${items.length} ${it.scene.id} (${it.dur.toFixed(2)} s, ${it.time.frames} frames)... `);
        const t = Date.now();
        const m = it.scene.clip ? renderClip(it, prep.vo, root, reel.dir) : await renderOne(browser, it, prep.vo);
        if (it.scene.overlays?.length) applyOverlays(`${it.base}.mp4`, it.scene.overlays, it.dur, root, reel.dir);
        manifests.set(it.scene.n, m);
        console.log(`${((Date.now() - t) / 1000).toFixed(1)} s${m.errors.length ? `  ${m.errors.length} error(s)` : ''}${it.scene.clip ? '  (stock video)' : ''}${it.scene.overlays?.length ? `  (+${it.scene.overlays.length} overlay)` : ''}`);
        for (const n of m.notes || []) console.log(`note: scene ${it.scene.n}: ${n}`);
      }
    } finally { await browser?.close().catch(() => {}); }
    recordRenderTime(reel.dir, { scenes: items.length, rendered: todo.length, seconds: (Date.now() - drawStart) / 1000 });
  }
  const reused = pick.length - todo.length;
  const all = items.map((it) => manifests.get(it.scene.n));
  const errs = all.filter(Boolean).flatMap((m) => m.errors.map((e) => `scene ${m.n} (${m.id}): ${e}`));
  const errFile = path.join(build, SHAPE.errors);
  if (errs.length) {
    fs.writeFileSync(errFile, errs.join('\n') + '\n');
    process.exitCode = 2;
    console.error(`\n${errs.length} error(s) while drawing scenes: those frames may be INCOMPLETE. Fix them first (also in build/render_errors.txt):\n  ${errs.slice(0, 12).join('\n  ')}`);
  } else fs.rmSync(errFile, { force: true });
  if (only != null) {
    console.log(`scene ${pick[0].scene.n}: ${path.relative(reel.dir, pick[0].base + '.mp4')} (with its slice of the voice). Run video render <dir> to join the video; the other scenes are reused when unchanged.`);
    return;
  }

  // join the scenes without encoding the picture again, then put the whole voice (and music) under it at -14 LUFS
  const list = path.join(build, SHAPE.scenes, 'join.txt'), joined = path.join(build, SHAPE.scenes, 'joined.mp4');
  fs.writeFileSync(list, items.map((it) => `file '${(it.base + '.mp4').split(path.sep).join('/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v', '-c', 'copy', joined]);
  const seconds = items.reduce((n, it) => n + it.time.frames, 0) / FPS;
  let picture = joined;
  if (look && look.strength > 0) {                                // the LUT: one pass over the joined picture (the only step that encodes it again)
    if (!root) throw new Error('video.json "look" names a LUT, but this video is not inside a channel folder');
    const { abs } = licensed.resolveAsset(root, look.lut, 'lut');
    picture = path.join(build, SHAPE.scenes, 'graded.mp4');
    applyLook(joined, picture, abs, look.strength, build);
    console.log(`look: LUT "${look.lut}" at strength ${look.strength}`);
  } else if (look) console.log(`note: look "${look.lut}" has strength 0, so no grade was applied`);
  const video = path.join(build, SHAPE.video), draft = path.join(build, SHAPE.draft);
  const norm = 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const voice = '[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad';
  const licensedBed = Array.isArray(reel.cfg.music) && prep.vo && !vertical
    ? licensedMusic(reel.cfg.music, { times: prep.times, scenes: prep.scenes, seconds, firstInput: 2, lengthOf: mediaLength,
      resolve: (id) => { if (!root) throw new Error('video.json "music" lists licensed assets, but this video is not inside a channel folder'); return licensed.resolveAsset(root, id, 'music').abs; } })
    : null;
  const music = reel.cfg.music && !Array.isArray(reel.cfg.music) ? path.resolve(reel.dir, String(reel.cfg.music)) : null;
  if (music && !fs.existsSync(music)) throw new Error(`video.json "music" points at ${music}, which does not exist`);
  const vol = Number(reel.cfg.music_volume ?? 0.18);
  const bed = music ? musicBed({ seconds, musicLength: mediaLength(music), fade: musicFade(reel.cfg), volume: vol }) : null;
  const stereo = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const out = ['-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', seconds.toFixed(6), '-movflags', '+faststart', video];
  if (!prep.vo) ffmpeg(['-i', picture, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', seconds.toFixed(6), '-movflags', '+faststart', video]);
  else {
    // the voice, the music ducked under it, and the effects track, then the whole mix to -14 LUFS
    const inputs = ['-i', picture, '-i', prep.vo];
    let graph, mixIns;
    if (licensedBed) {
      inputs.push(...licensedBed.inputs);
      graph = `${voice},asplit=2[voice][sc];${licensedBed.graph};[bed][sc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350:makeup=1[ducked]`;
      mixIns = ['[voice]', '[ducked]'];
    } else if (music) {
      inputs.push(...(bed.loop ? ['-stream_loop', '-1'] : []), '-i', music);
      graph = `${voice},asplit=2[voice][sc];[2:a]${bed.chain}[music];[music][sc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350:makeup=1[ducked]`;
      mixIns = ['[voice]', '[ducked]'];
    } else { graph = `${voice}[voice]`; mixIns = ['[voice]']; }
    const sfx = sfxTrack(reel, items, seconds);
    if (sfx) { inputs.push('-i', sfx); graph += `;[${inputs.filter((x) => x === '-i').length - 1}:a]${stereo}[sfx]`; mixIns.push('[sfx]'); }
    graph += `;${mixIns.join('')}${mixIns.length > 1 ? `amix=inputs=${mixIns.length}:duration=first:dropout_transition=0:normalize=0,` : ''}${norm}[a]`;
    ffmpeg([...inputs, '-filter_complex', graph, ...out]);
  }
  ffmpeg(['-i', video, '-vf', `scale=${W / 2}:${H / 2}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', draft]);
  fs.rmSync(joined, { force: true }); fs.rmSync(list, { force: true }); fs.rmSync(picture, { force: true });

  // resting boxes on the video's clock, for tools/qa.py (safe zone)
  const boxes = all.flatMap((m, i) => (m?.boxes || []).map((b) => ({ ...b, t0: r3(b.t0 + items[i].time.t0), t1: r3(b.t1 + items[i].time.t0), scene: items[i].scene.n })));
  const boxFile = path.join(build, SHAPE.boxes);
  if (all.some((m) => m?.inspect)) fs.writeFileSync(boxFile, JSON.stringify(boxes)); else fs.rmSync(boxFile, { force: true });

  console.log(`render: build/${SHAPE.video} (${W}x${H}) and build/${SHAPE.draft} (${W / 2}x${H / 2}), ${seconds.toFixed(2)} s, ${items.length} scenes: ${todo.length} rendered, ${reused} reused unchanged${resliced ? ` (${resliced} with only their sound made again, the voice changed around them)` : ''}, ${Math.round((Date.now() - began) / 1000)} s`);
  if (!prep.vo) console.log('note: no audio/vo.mp3 yet, so the video is silent');
  else if (Math.abs(seconds - prep.voLength - prep.endCard) > 1) console.log(`note: the video (${seconds.toFixed(2)} s) and the voice (${prep.voLength.toFixed(2)} s${prep.endCard ? ` + an end card of ${prep.endCard.toFixed(2)} s` : ''}) differ by more than 1 s`);
  if (standInActive(reel.dir)) console.log('WARNING: audio/vo.mp3 is the STAND-IN tone from video stand-in, not a voice. Voice the script (video voice) before anything is approved or posted.');
}

/* ── frames for the thumbnail: {info, frameAt, close} ─────────── */
export async function openScenes(reel, { scale = 0.5 } = {}) {
  const prep = prepare(reel);
  const items = buildPages(reel, prep);
  const browser = await launch();
  const views = new Map(), problems = new Set();
  async function frameAt(t, quality = 0.92) {
    const k = items.findIndex((it) => t < it.time.t1 - 1e-9);
    const it = k === -1 ? items.at(-1) : items[k];
    if (it.scene.clip) {
      const abs = sourceFile(it.scene.clip, 'stock-video', licensed.channelRoot(reel.dir), reel.dir);
      const at = it.scene.clip.start + Math.min(Math.max(0, t - it.time.t0), it.dur);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', abs, '-frames:v', '1', '-vf', `scale=${Math.round(W * scale)}:${Math.round(H * scale)}:force_original_aspect_ratio=increase,crop=${Math.round(W * scale)}:${Math.round(H * scale)}`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', '-'], { maxBuffer: 1 << 26 });
      if (r.status === 0 && r.stdout.length) return r.stdout;
      problems.add(`scene ${it.scene.n}: no frame could be read from the stock clip`);
      return Buffer.alloc(0);
    }
    if (!views.has(it.scene.n)) views.set(it.scene.n, await openScene(browser, it.html, scale));
    const view = views.get(it.scene.n);
    await view.seek(Math.min(Math.max(0, t - it.time.t0), it.dur - 1 / FPS));
    return view.page.screenshot({ type: 'jpeg', quality: Math.round(quality * 100) });
  }
  async function close() {
    for (const [n, v] of views) for (const e of [...(await v.errors()), ...v.pageErrors]) problems.add(`scene ${n}: ${String(e).slice(0, 200)}`);
    await browser.close().catch(() => {});
    if (problems.size) { process.exitCode = 2; console.error(`\n${problems.size} error(s) while drawing scenes:\n  ${[...problems].slice(0, 12).join('\n  ')}`); }
  }
  return { info: { seconds: prep.length }, frameAt, close };
}

/* ── video check <dir>: every scene's errors, safe area and seeking, with stills to look at ─────────────────────── */
export async function checkScenes(reel, { only = null, times = null } = {}) {
  const prep = prepare(reel);
  for (const n of prep.notes) console.log(`note: ${n}`);
  for (const n of licensed.notesFor(reel.dir)) console.log(`note: ${n}`);
  try { lookOf(reel.cfg); } catch (e) { console.log(`note: ${e.message}`); }
  let items = buildPages(reel, prep);
  if (only != null) items = items.filter((it) => String(it.scene.n) === String(only) || it.scene.id === String(only));
  const out = path.join(reel.dir, 'build', SHAPE.scenes, 'check');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const report = [], sheets = [];
  const browser = await launch();
  try {
    for (const it of items) {
      const { scene, dur } = it, name = `${scene.file}`;
      if (scene.clip) { sheets.push(`scene ${scene.n} (${scene.id}): a clip scene (${scene.clip.asset ?? scene.clip.file}); nothing is drawn, so only the clip's frame can be looked at after  video render`); continue; }
      const view = await openScene(browser, it.html, 1);
      const at = (times || ['20%', '45%', '70%', 'end']).map((x) => {
        x = String(x).trim();
        if (x === 'end') return dur - 0.04;
        if (x.endsWith('%')) return (Number(x.slice(0, -1)) / 100) * dur;
        return Math.min(Number(x), dur - 0.04);
      });
      const shots = [];
      let inspected = false;
      for (const t of at) {
        await view.seek(t);
        const boxes = await view.inspect(t);
        if (Array.isArray(boxes)) inspected = true;
        for (const b of resting(boxes)) if (outside(b))
          report.push(`scene ${scene.n} (${scene.id}) @${t.toFixed(2)}s: ${b.kind} "${String(b.label).slice(0, 30)}" outside the safe area [${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}]`);
        await view.page.evaluate(([x0, y0, x1, y1]) => {
          let g = document.getElementById('__guides');
          if (!g) { g = document.createElement('div'); g.id = '__guides'; document.body.appendChild(g); }
          g.style.cssText = `position:fixed;left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px;outline:3px dashed rgba(255,0,200,.55);pointer-events:none;z-index:99999`;
        }, SAFE_BOX);
        const png = path.join(out, `${name}.${t.toFixed(2)}s.png`);
        await view.page.screenshot({ path: png });
        await view.page.evaluate(() => document.getElementById('__guides')?.remove());
        shots.push(png);
      }
      if (!inspected) report.push(`scene ${scene.n} (${scene.id}): the engine has no S.inspect, so the safe area was NOT checked (look at the stills)`);
      // seeking: the same time must give the same pixels after jumping elsewhere first
      const mid = dur * 0.55;
      await view.seek(mid); const a = await view.page.screenshot();
      await view.seek(0.05); await view.seek(mid); const b = await view.page.screenshot();
      if (!a.equals(b)) {
        const pa = path.join(out, `${name}.seekA.png`), pb = path.join(out, `${name}.seekB.png`);
        fs.writeFileSync(pa, a); fs.writeFileSync(pb, b);
        const q = spawnSync('ffmpeg', ['-hide_banner', '-i', pa, '-i', pb, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
        const mm = /average:(\S+)/.exec(q.stderr || ''), psnr = mm ? Number(mm[1]) : 0;
        if (!(psnr >= 50)) report.push(`scene ${scene.n} (${scene.id}): NOT SEEKABLE, the frame at ${mid.toFixed(2)}s differs after seeking away and back (PSNR ${psnr})`);
        else { fs.rmSync(pa); fs.rmSync(pb); }
      }
      for (const e of [...(await view.errors()), ...view.pageErrors]) report.push(`scene ${scene.n} (${scene.id}): ERROR ${String(e).slice(0, 300)}`);
      for (const u of view.blocked) report.push(`scene ${scene.n} (${scene.id}): network blocked ${u}`);
      await view.ctx.close();
      const sheet = path.join(out, `${name}.sheet.jpg`);
      const graph = shots.map((_, i) => `[${i}:v]scale=${W / 2}:${H / 2}[s${i}]`).join(';') + ';' + shots.map((_, i) => `[s${i}]`).join('') + `hstack=inputs=${shots.length}`;
      const f = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...shots.flatMap((s) => ['-i', s]), '-filter_complex', shots.length > 1 ? graph : `[0:v]scale=${W / 2}:${H / 2}`, '-q:v', '3', sheet]);
      if (f.status === 0) sheets.push(`${path.relative(reel.dir, sheet)}  (scene ${scene.n}, t = ${at.map((t) => t.toFixed(2)).join(', ')})`);
    }
  } finally { await browser.close().catch(() => {}); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ problems: report }, null, 1));
  console.log(`scene check (${reel.cfg.style}, ${items.length} scene(s), safe area x ${SAFE_BOX[0]}..${SAFE_BOX[2]}, y ${SAFE_BOX[1]}..${SAFE_BOX[3]})`);
  for (const s of sheets) console.log(`  sheet ${s}`);
  console.log('  LOOK at every sheet (the magenta box is the safe area): "no problems" is necessary, not sufficient.');
  console.log(report.length ? `\nPROBLEMS (${report.length}):\n  ${report.join('\n  ')}` : '\nscene check: no errors, nothing outside the safe area, every scene seekable');
  if (report.some((r) => !/was NOT checked/.test(r))) process.exitCode = 2;
}

/* ── video plan <dir> ───────────────────────────────────────────────────────────────────────────────────────────── */
export function printPlan(reel) {
  const prep = prepare(reel);
  console.log(`scene plan (${reel.cfg.style}, ${prep.scenes.length} scenes, ${prep.length.toFixed(2)} s${prep.voLength ? `, voice ${prep.voLength.toFixed(2)} s` : ''}${prep.endCard ? `, end card ${prep.endCard.toFixed(2)} s` : ''})`);
  for (const t of prep.times) {
    const s = prep.scenes[t.n - 1];
    const pz = prep.pauses.find((p) => p.n === t.n);
    console.log(`  ${String(t.n).padStart(2)}  ${t.t0.toFixed(2).padStart(6)}-${t.t1.toFixed(2).padStart(6)}s  ${(t.t1 - t.t0).toFixed(2).padStart(5)} s  ${(s.template || (s.clip ? `clip ${s.clip.asset ?? s.clip.file}` : `code ${s.code}`)).padEnd(20)} ` +
      (t.source === 'words' ? `words ${t.found}/${t.of}: "${t.first}" .. "${t.last}"` : pz && !t.of ? 'no words' : `even split (${t.found}/${t.of} words found)`) + (pz ? `  pause ${pz.seconds.toFixed(2)} s at ${pz.at.toFixed(2)} s` : ''));
  }
  for (const n of prep.notes) console.log(`note: ${n}`);
  fs.mkdirSync(path.join(reel.dir, 'build'), { recursive: true });
  fs.writeFileSync(path.join(reel.dir, 'build', 'scene_times.json'), JSON.stringify(prep.times, null, 1));
}

/* ── video styles [<style>] ───────────────────────────────────────────────────────────────────────────────────────── */
export function listStyles(id) {
  const reg = registry();
  if (!reg) { console.log('no scene styles in this kit (styles/STYLES.json is missing)'); return; }
  const first = (s) => String(s || '').split(/(?<=\.)\s/)[0].slice(0, 150);
  if (!id) {
    console.log(`scene styles (${sceneStyleIds().length}, from the styles repo at ${reg.version}, synced ${reg.synced}):`);
    for (const s of reg.styles.filter((x) => isSceneStyle(x.id))) console.log(`  ${s.id.padEnd(17)} ${s.name}: ${first(s.description)} (${s.templates.length} templates)`);
    console.log('\nstart one:  video new <folder> --style <id>     details:  video styles <id>');
    return;
  }
  const info = styleInfo(id);
  if (!info) throw new Error(`no scene style "${id}". The kit has: ${sceneStyleIds().join(', ')}`);
  console.log(`${info.name} (${info.id})\n${info.description}\npalette: ${Object.entries(info.palette).map(([k, v]) => `${k} ${v}`).join(', ')}\ntemplates:`);
  for (const t of info.templateDefs) console.log(`  ${t.id.padEnd(22)} ${first(t.description)}`);
  console.log(`\nread before planning: ${path.join(info.dir, 'SKILL.md')} (art direction), ${path.join(info.dir, 'templates.json')} (props of each template), ${path.join(info.dir, 'docs.md')} (the API for a custom "code" scene)`);
}

/* ── video new <dir> --style <scene style> ──────────────────────────────────────────────────────────────────────────── */
// ASCII only in what the starter writes, the way the styles repo writes its examples
const plain = (v) => typeof v === 'string' ? v.replace(/[\u2014\u2013]/g, ' - ').replace(/\u2026/g, '...').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/ {2,}/g, ' ')
  : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v;

export function starterFiles(style) {
  const info = styleInfo(style);
  const picks = info.templateDefs.slice(0, 3);
  const scenes = picks.map((t) => ({ template: t.id, props: plain(t.exampleProps || {}), narration: plain(t.exampleNarration || '') }));
  return {
    'video.json': { style, title: '', seed: 1 },
    'script.txt': scenes.map((s) => s.narration).join('\n\n') + '\n',
    'scenes.json': { _note: `A sample plan from the first three ${style} templates. Replace it: one scene per idea, "narration" = the exact words of script.txt that scene covers, in order. Templates and their props: kit scene list ${style}. Times come from build/words.json.`, scenes },
  };
}

/* ── video stand-in <dir>: a no-key, no-credit voice for previews and tests ─────────────────────────────────────── */
export function standIn(reel, { pace = 0.38, force = false } = {}) {
  const vo = path.join(reel.dir, 'audio', 'vo.mp3');
  if (fs.existsSync(vo) && !standInActive(reel.dir) && !force)
    throw new Error('audio/vo.mp3 is already there and is not a stand-in (it may be a paid voice take). Refusing to replace it; --force does, if you are sure.');
  const scriptFile = path.join(reel.dir, 'script.txt');
  let text = fs.existsSync(scriptFile) ? fs.readFileSync(scriptFile, 'utf8') : '';
  if (!text.trim()) text = planOf(reel.dir, reel.cfg.style).scenes.map((s) => s.narration).join(' ');
  const spoken = fakeWords(plain(text), pace);
  if (!spoken.length) throw new Error('nothing to say: script.txt and the scene narration are empty');
  // scenes with a "pause" get their silence, as video voice does
  let plan = []; try { plan = planOf(reel.dir, reel.cfg.style).scenes; } catch {}
  const { words, splices, clamped, added } = applyPauses(spoken, placePauses(plan, spoken, spoken.at(-1).e + 0.3));
  // a soft two-tone hum on each word, silence between them, so loudness, length and first-word sync can all be measured
  const rate = 48000, length = spoken.at(-1).e + 0.3 + added, pcm = new Int16Array(Math.ceil(length * rate));
  words.forEach((w, i) => {
    const a = Math.floor(w.s * rate), b = Math.min(pcm.length, Math.floor(w.e * rate)), f = 170 + 25 * (i % 5);
    for (let x = a; x < b; x++) {
      const t = (x - a) / rate, env = Math.min(1, t / 0.015, (b - x) / rate / 0.015);
      pcm[x] = Math.round(9000 * env * (0.7 * Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)));
    }
  });
  const wav = Buffer.alloc(44 + pcm.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer).copy(wav, 44);
  fs.mkdirSync(path.join(reel.dir, 'audio'), { recursive: true });
  const tmp = path.join(os.tmpdir(), `bagelunit-stand-in-${process.pid}.wav`);
  fs.writeFileSync(tmp, wav);
  // the level voice.py gives a real take (-14 LUFS), so qa reads the stand-in the way it reads a voice
  try { ffmpeg(['-i', tmp, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100', '-ac', '1', '-b:a', '192k', vo]); } finally { fs.rmSync(tmp, { force: true }); }
  writeWords(reel.dir, words);
  writePauses(reel.dir, splices);
  if (splices.length) console.log(`pauses: ${splices.map((p) => `${p.seconds.toFixed(2)} s for scene ${p.n} at ${p.at.toFixed(2)} s`).join(', ')}${clamped ? ` (${clamped} word(s) that ran over a splice were cut at it)` : ''}`);
  fs.writeFileSync(path.join(reel.dir, 'build', 'voice-stand-in.json'), JSON.stringify({ note: 'audio/vo.mp3 is a stand-in tone made by video stand-in, not a voice', sha: sha(fs.readFileSync(vo)), words: words.length }, null, 1));
  console.log(`stand-in voice: audio/vo.mp3 ${mediaLength(vo)?.toFixed(2)} s (a tone on each word, no key, no credits) · ${words.length} fake word times → build/words.json + build/word_index.txt`);
  console.log('This is for previews and tests only. Voice the script with video voice before anything is approved or posted.');
}
export { standInActive as standInIsActive };
