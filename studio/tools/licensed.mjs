// licensed.mjs · the channel's register of licensed material (music, sound effects, stock video, motion graphics, LUTs from any
// source you have the rights to; Uppbeat is the one we use and suggest). The kit ships only this mechanism, never a file: you
// download each asset by hand from wherever you license it, and `video licensed add` records it. Nothing here touches the network.
//
//   node video.mjs licensed add <file> --type music|sfx|stock-video|motion-graphic|lut --title "..." [--artist ...] [--url ...]
//                  [--source name] [--plan name] [--channels a,b] [--credit "..."] [--id slug] [--notes ...] [--licence ...] [--move]
//   node video.mjs licensed list [--type T]
//   node video.mjs licensed check [<video folder>]           PASS/FAIL per asset a video uses; exit 1 on any FAIL
//   node video.mjs licensed channels <id> a,b                 which channels are safelisted for that asset (replaces the list)
//   node video.mjs licensed credits <video folder>            writes the "Music and assets" block in out/youtube.txt
//   node video.mjs licensed remove <id> [--keep-file]
//
// The register is <channel folder>/brand/licensed/assets.json; the files sit next to it in brand/licensed/<type>/.
// A video refers to assets by id: video.json "look": {"lut": id, "strength": 0..1}, "music": [{"asset": id, "from": scene id or
// seconds, "fade": s, "gain_db": -18}], and in scenes.json a scene {"clip": {"asset": id, "start": s, "duration": s}} or an
// "overlay": {"asset": id, "blend": "normal|screen", "opacity": 0..1, "at": s, "duration": s} on any scene.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TYPES = ['music', 'sfx', 'stock-video', 'motion-graphic', 'lut'];
export const EXTENSIONS = {
  music: ['.wav', '.mp3', '.flac', '.m4a', '.aiff', '.aif', '.ogg'],
  sfx: ['.wav', '.mp3', '.flac', '.m4a', '.aiff', '.aif', '.ogg'],
  'stock-video': ['.mp4', '.mov', '.m4v', '.mkv', '.webm'],
  'motion-graphic': ['.mov', '.webm', '.mp4', '.mkv', '.gif'],
  lut: ['.cube'],
};
export const CREDITS_HEADING = 'Music and assets';
export const REGISTER = 'brand/licensed/assets.json';   // forward slashes on every system: it is shown in messages and docs, and Windows accepts them for files
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const posix = (p) => p.split(path.sep).join('/');
export function sha256File(file) {
  if (!fs.existsSync(file)) return null;
  const h = createHash('sha256'), fd = fs.openSync(file, 'r'), buf = Buffer.alloc(8 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/* ── where things are ───────────────────────────────────────────────────────────────────────────────────────────────── */
// the channel folder a path sits in: the nearest folder above it that holds brand/brand.json
export function channelRoot(start) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, 'brand', 'brand.json'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}
export const channelSlug = (root) => String(readJSON(path.join(root, 'brand', 'brand.json'), {}).slug || '').trim();

// A recorded path must stay inside <root>/brand/licensed/: no absolute path, no "..", and no symlink that leads out.
export function safePath(root, rel) {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0')) throw new Error('the file path is empty or not text');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith('\\\\')) throw new Error(`"${rel}" is an absolute path: record paths inside the channel folder (brand/licensed/<type>/<file>)`);
  const base = path.resolve(root, 'brand', 'licensed');
  const abs = path.resolve(root, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error(`"${rel}" is outside brand/licensed/ of this channel folder: refused`);
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe), realBase = fs.existsSync(base) ? fs.realpathSync(base) : base;
  if (real !== realBase && !real.startsWith(realBase + path.sep) && fs.existsSync(base)) throw new Error(`"${rel}" leads outside brand/licensed/ through a link: refused`);
  return abs;
}

/* ── the owner's own files (renders from Blender or code): no register, no credits ─────────────────────────────────────── */
// A clip or overlay may name {"file": "<path>"} instead of a recorded asset. The path is relative to the video folder (or to the
// channel's brand/library/), may not be absolute or hold "..", and the file it finds (after links are followed) must sit inside the
// channel folder. These files are the owner's own work: never licensed, never in the credits, never in `video licensed check`.
const real = (p) => (fs.realpathSync.native || fs.realpathSync)(p);
export function checkOwnPath(rel) {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0')) throw new Error('the file path is empty or not text');
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.startsWith('\\\\')) throw new Error(`"${rel}" is an absolute path: use a path inside the channel folder, relative to the video folder (for example assets/blender/shot.mov) or to brand/library/`);
  if (rel.split(/[\\/]+/).includes('..')) throw new Error(`"${rel}" goes up out of its folder (".."): own files must stay inside the channel folder`);
  return rel.replace(/\\/g, '/');
}
export function ownFile(root, videoDir, rel) {
  rel = checkOwnPath(rel);
  const top = root || videoDir, rootReal = real(top);
  const tried = [path.resolve(videoDir, rel)];
  if (root) tried.push(path.resolve(root, 'brand', 'library', rel));
  for (const abs of tried) {
    if (!fs.existsSync(abs)) continue;
    const r = real(abs);
    if (r !== rootReal && !r.startsWith(rootReal + path.sep)) throw new Error(`"${rel}" leads outside the channel folder through a link: refused`);
    if (!fs.statSync(abs).isFile()) throw new Error(`"${rel}" is a folder, not a file`);
    return abs;
  }
  throw new Error(`the file "${rel}" does not exist (looked in the video folder and in brand/library/)`);
}
// Any file of the owner's inside the channel folder (a thumbnail base image, for example). Unlike a clip path this may be absolute or
// relative to the current folder, but it must still be inside the channel folder once links are followed.
export function channelFile(root, bases, p) {
  if (typeof p !== 'string' || !p.trim() || p.includes('\0')) throw new Error('the image path is empty or not text');
  const top = root || bases[0], topReal = real(top);
  const cands = path.isAbsolute(p) ? [p] : bases.map((b) => path.resolve(b, p));
  let lastOutside = null;
  for (const abs of cands) {
    if (!fs.existsSync(abs)) continue;
    const r = real(abs);
    if (r !== topReal && !r.startsWith(topReal + path.sep)) { lastOutside = abs; continue; }
    if (!fs.statSync(abs).isFile()) throw new Error(`"${p}" is a folder, not a file`);
    return abs;
  }
  if (lastOutside) throw new Error(`"${p}" is outside the channel folder (${top.split(path.sep).join('/')}): refused. Copy the image into the channel folder first.`);
  throw new Error(`the image "${p}" does not exist`);
}
// sha256 of a file, remembered while its size and time stay the same (a render asks for it several times)
const shaMemo = new Map();
export function ownSha(file) {
  const st = fs.statSync(file), key = `${file}|${st.size}|${st.mtimeMs}`;
  if (!shaMemo.has(key)) shaMemo.set(key, sha256File(file));
  return shaMemo.get(key);
}

export function loadRegister(root) {
  const f = path.join(root, REGISTER);
  if (!fs.existsSync(f)) return { assets: [] };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`${REGISTER} is not valid JSON: ${e.message}`); }
  if (!raw || !Array.isArray(raw.assets)) throw new Error(`${REGISTER} must look like {"assets": [...]}`);
  return raw;
}
function saveRegister(root, reg) {
  const f = path.join(root, REGISTER);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ assets: reg.assets }, null, 2) + '\n');
}
export const findAsset = (reg, id) => reg.assets.find((a) => a && a.id === id) || null;

/* ── a LUT must be a real .cube ─────────────────────────────────────────────────────────────────────────────────────── */
// Header (TITLE, LUT_3D_SIZE or LUT_1D_SIZE, DOMAIN_MIN/MAX), a size from 2 to 256, a sane domain, and exactly size^3 (or size)
// rows of three finite numbers. Returns {size, dims, title}; throws the first problem in plain words.
export function validateCube(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new Error(`cannot read ${file}`); }
  if (text.includes('\0')) throw new Error('this is not a .cube file (it holds binary data)');
  let size = null, dims = null, title = '', rows = 0, dmin = [0, 0, 0], dmax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z_0-9]+)\s*(.*)$/.exec(line);
    if (m && /^[A-Z]/.test(line) && !/^[-+.\d]/.test(line)) {
      const [, key, rest] = m;
      if (key === 'TITLE') title = rest.replace(/^"|"$/g, '');
      else if (key === 'LUT_3D_SIZE' || key === 'LUT_1D_SIZE') {
        if (size != null) throw new Error('the header has two LUT sizes');
        size = Number(rest); dims = key === 'LUT_3D_SIZE' ? 3 : 1;
        if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error(`${key} must be a whole number from 2 to 256 (it is "${rest}")`);
      } else if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
        const v = rest.split(/\s+/).map(Number);
        if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`${key} needs three numbers`);
        if (key === 'DOMAIN_MIN') dmin = v; else dmax = v;
      } else if (key !== 'LUT_IN_VIDEO_RANGE' && key !== 'LUT_OUT_VIDEO_RANGE') throw new Error(`unknown header line "${line.slice(0, 40)}"`);
      continue;
    }
    if (size == null) throw new Error('the data starts before LUT_3D_SIZE (or LUT_1D_SIZE): not a .cube file');
    const v = line.split(/\s+/).map(Number);
    if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`a data row is not three numbers: "${line.slice(0, 40)}"`);
    rows++;
  }
  if (size == null) throw new Error('no LUT_3D_SIZE (or LUT_1D_SIZE) line: not a .cube file');
  if (!dmin.every((x, i) => x < dmax[i])) throw new Error('DOMAIN_MIN must be below DOMAIN_MAX');
  const want = dims === 3 ? size ** 3 : size;
  if (rows !== want) throw new Error(`a size ${size} ${dims}D LUT has ${want} rows, this one has ${rows}`);
  return { size, dims, title };
}

/* ── add, list, remove ──────────────────────────────────────────────────────────────────────────────────────────────── */
const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
const csv = (v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const today = () => new Date().toISOString().slice(0, 10);

export function addAsset(root, source, o = {}) {
  const type = o.type;
  if (!TYPES.includes(type)) throw new Error(`--type must be one of: ${TYPES.join(', ')}`);
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`file not found: ${source || '(none given)'}. Download it first, from wherever you license it (choose WAV when downloading if the site offers it)`);
  const ext = path.extname(source).toLowerCase();
  if (!EXTENSIONS[type].includes(ext)) throw new Error(`a ${type} should be ${EXTENSIONS[type].join(' ')} (this is "${ext || 'no extension'}")`);
  const title = String(o.title || '').trim();
  if (!title) throw new Error('--title "..." is needed (the name on the page you got it from), it goes in the credits; record that page with --url, and add --source and --plan too');
  const id = o.id ? String(o.id) : slugOf(title) || slugOf(path.basename(source, ext));
  if (!ID.test(id)) throw new Error(`the id "${id}" must be lowercase letters, digits and dashes (for example clear-skies); give --id`);
  const reg = loadRegister(root);
  if (findAsset(reg, id)) throw new Error(`there is already an asset with the id "${id}": give another --id, or  video licensed remove ${id}  first`);
  if (type === 'lut') { try { validateCube(source); } catch (e) { throw new Error(`${path.basename(source)} is not a usable .cube LUT: ${e.message}`); } }
  const rel = posix(path.join('brand', 'licensed', type, `${id}${ext}`));
  const dest = safePath(root, rel);
  const src = fs.realpathSync(source);
  const same = fs.existsSync(dest) && fs.realpathSync(dest) === src;
  if (fs.existsSync(dest) && !same) throw new Error(`${rel} already exists: refusing to overwrite it (give another --id)`);
  const sha = sha256File(source);
  if (!same) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (o.move) { try { fs.renameSync(source, dest); } catch { fs.copyFileSync(source, dest); fs.rmSync(source); } } else fs.copyFileSync(source, dest);
  }
  const rec = {
    id, type, title, artist: String(o.artist || ''), source: String(o.source || ''), url: String(o.url || ''), plan: String(o.plan || ''), licence: String(o.licence || ''),
    channels: csv(o.channels), file: rel, sha256: sha, credit: String(o.credit || ''), downloaded: today(), notes: String(o.notes || ''),
  };
  reg.assets.push(rec);
  saveRegister(root, reg);
  return rec;
}

export function setChannels(root, id, channels) {
  const reg = loadRegister(root), rec = findAsset(reg, id);
  if (!rec) throw new Error(`no asset "${id}" (video licensed list)`);
  rec.channels = csv(channels);
  saveRegister(root, reg);
  return rec;
}

export function removeAsset(root, id, { keepFile = false } = {}) {
  const reg = loadRegister(root), rec = findAsset(reg, id);
  if (!rec) throw new Error(`no asset "${id}" (video licensed list)`);
  reg.assets = reg.assets.filter((a) => a !== rec);
  saveRegister(root, reg);
  let removed = false;
  if (!keepFile) { try { const f = safePath(root, rec.file); if (fs.existsSync(f)) { fs.rmSync(f); removed = true; } } catch { /* a bad recorded path is never deleted */ } }
  return { rec, removed };
}

export function listAssets(root, type = null) {
  if (type && !TYPES.includes(type)) throw new Error(`--type must be one of: ${TYPES.join(', ')}`);
  return loadRegister(root).assets.filter((a) => !type || a.type === type);
}

/* ── what a video uses ──────────────────────────────────────────────────────────────────────────────────────────────── */
// [{id, use, type}] from video.json (look.lut, music[]) and scenes.json (clip, overlay, and the vertical variants of them)
export function usedAssets(videoDir) {
  const cfg = readJSON(path.join(videoDir, 'video.json'), {}) || {};
  const plan = readJSON(path.join(videoDir, 'scenes.json'), {});
  const list = Array.isArray(plan) ? plan : plan?.scenes || [];
  const out = [];
  if (cfg.look && typeof cfg.look === 'object' && cfg.look.lut != null) out.push({ id: String(cfg.look.lut), use: 'look.lut', type: 'lut' });
  if (Array.isArray(cfg.music)) cfg.music.forEach((m, i) => { if (m && m.asset != null) out.push({ id: String(m.asset), use: `music[${i}]`, type: 'music' }); });
  list.forEach((s, k) => {
    for (const x of [s, s?.vertical]) {
      if (!x || typeof x !== 'object') continue;
      if (x.clip && x.clip.asset != null) out.push({ id: String(x.clip.asset), use: `scene ${k + 1} clip`, type: 'stock-video' });
      for (const o of [].concat(x.overlay || [])) if (o && o.asset != null) out.push({ id: String(o.asset), use: `scene ${k + 1} overlay`, type: 'motion-graphic' });
    }
  });
  return out;
}

// [{file, use}] for the owner's own files in scenes.json: {"clip": {"file"}} and {"overlay": {"file"}} (and their vertical variants).
// They are not licensed assets: usedAssets, the credits and `video licensed check` never see them.
export function usedOwnFiles(videoDir) {
  const plan = readJSON(path.join(videoDir, 'scenes.json'), {});
  const list = Array.isArray(plan) ? plan : plan?.scenes || [];
  const out = [];
  list.forEach((s, k) => {
    for (const x of [s, s?.vertical]) {
      if (!x || typeof x !== 'object') continue;
      if (x.clip && typeof x.clip.file === 'string') out.push({ file: x.clip.file, use: `scene ${k + 1} clip` });
      for (const o of [].concat(x.overlay || [])) if (o && typeof o.file === 'string') out.push({ file: o.file, use: `scene ${k + 1} overlay` });
    }
  });
  return out;
}

// one asset resolved for use: the record and its absolute path (throws when the record, its type or its file is wrong)
export function resolveAsset(root, id, wantType) {
  const rec = findAsset(loadRegister(root), String(id));
  if (!rec) throw new Error(`the asset "${id}" is not in ${REGISTER}: video licensed add <file> --type ${wantType || '...'}`);
  if (wantType && rec.type !== wantType) throw new Error(`the asset "${id}" is a ${rec.type}, but it is used as a ${wantType}`);
  const abs = safePath(root, rec.file);
  if (!fs.existsSync(abs)) throw new Error(`the file of "${id}" is missing: ${rec.file}`);
  return { rec, abs };
}

// PASS/FAIL lines for the assets a video uses (or, with no video folder, for the whole register)
export function check(root, videoDir = null) {
  const lines = [];
  const pass = (text) => lines.push({ status: 'PASS', text });
  const fail = (text) => lines.push({ status: 'FAIL', text });
  let reg;
  try { reg = loadRegister(root); } catch (e) { return { ok: false, lines: [{ status: 'FAIL', text: e.message }], used: [] }; }
  const slug = channelSlug(root);
  const used = videoDir ? usedAssets(videoDir) : reg.assets.map((a) => ({ id: a.id, use: 'register', type: null }));
  if (!used.length) { pass(videoDir ? 'no licensed assets are used in this video' : 'the register is empty'); return { ok: true, lines, used }; }
  const seen = new Set();
  for (const u of used) {
    const key = `${u.id}|${u.use}`;
    if (seen.has(key)) continue; seen.add(key);
    const tag = `${u.id} (${u.use})`;
    const rec = findAsset(reg, u.id);
    if (!rec) { fail(`${tag}: not in ${REGISTER}`); continue; }
    if (u.type && rec.type !== u.type) { fail(`${tag}: it is a ${rec.type}, used as a ${u.type}`); continue; }
    let abs;
    try { abs = safePath(root, rec.file); } catch (e) { fail(`${tag}: ${e.message}`); continue; }
    if (!fs.existsSync(abs)) { fail(`${tag}: the file ${rec.file} is missing`); continue; }
    const sha = sha256File(abs);
    if (!rec.sha256) { fail(`${tag}: no sha256 recorded`); continue; }
    if (sha !== rec.sha256) { fail(`${tag}: the file changed since it was recorded (sha256 differs)`); continue; }
    if (rec.type === 'lut') { try { validateCube(abs); } catch (e) { fail(`${tag}: not a usable .cube: ${e.message}`); continue; } }
    if (videoDir) {
      if (!slug) { fail(`${tag}: brand/brand.json has no slug, so the channel cannot be checked against the channel's safelist`); continue; }
      const ch = Array.isArray(rec.channels) ? rec.channels : [];
      if (!ch.includes(slug)) { fail(`${tag}: the channel "${slug}" is not in its channels (${ch.join(', ') || 'none'}). Safelist the channel with the source that licenses it (Uppbeat: Account, Safelist), then  video licensed channels ${rec.id} ${[...ch, slug].join(',')}`); continue; }
    }
    pass(`${tag}: ${rec.type} "${rec.title}"${rec.artist ? ` by ${rec.artist}` : ''}, file and hash match${videoDir ? `, channel ${slug} listed` : ''}`);
  }
  return { ok: !lines.some((l) => l.status === 'FAIL'), lines, used };
}

// notes for `video check`: things that will stop the render (a missing LUT or clip file), as warnings
export function notesFor(videoDir) {
  const root = channelRoot(videoDir), notes = [];
  for (const u of usedOwnFiles(videoDir)) {
    try { ownFile(root, videoDir, u.file); } catch (e) { notes.push(`${u.use}: ${e.message} (the render will stop)`); }
  }
  const used = usedAssets(videoDir);
  if (!used.length) return notes;
  if (!root) return [`this video uses licensed assets (${used.map((u) => u.id).join(', ')}) but is not inside a channel folder, so none can be found`];
  const reg = (() => { try { return loadRegister(root); } catch (e) { notes.push(e.message); return { assets: [] }; } })();
  for (const u of used) {
    const rec = findAsset(reg, u.id);
    if (!rec) { notes.push(`${u.use}: the asset "${u.id}" is not in ${REGISTER}`); continue; }
    try { const f = safePath(root, rec.file); if (!fs.existsSync(f)) notes.push(`${u.use}: the ${rec.type} file for "${u.id}" is missing (${rec.file})${rec.type === 'lut' ? ': the render will stop' : ''}`); } catch (e) { notes.push(`${u.use}: ${e.message}`); }
  }
  return notes;
}

/* ── credits ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
export const creditLine = (r) => (r.credit && r.credit.trim() ? r.credit.trim() : [`"${r.title}"${r.artist ? ` by ${r.artist}` : ''}`, r.source ? `from ${r.source[0].toUpperCase()}${r.source.slice(1)}` : '', r.url ? `(${r.url})` : ''].filter(Boolean).join(', ').replace(', (', ' ('));
// the assets of a video that need a credit: everything but a LUT (a grade is not shown or heard as someone's work)
export function creditsOf(root, videoDir) {
  const reg = loadRegister(root), seen = new Set(), out = [];
  for (const u of usedAssets(videoDir)) {
    const r = findAsset(reg, u.id);
    if (r && !seen.has(r.id)) { seen.add(r.id); out.push(r); }
  }
  return out;
}
export function creditsBlock(records) {
  const rows = records.filter((r) => r.type !== 'lut').map((r) => `- ${creditLine(r)}`);
  return rows.length ? `${CREDITS_HEADING}\n${rows.join('\n')}` : '';
}
// text with its credits block replaced (or added at the end, or removed when there is nothing to credit); the block is its
// heading line and the "- " lines after it
export function withCredits(text, block) {
  const lines = String(text).replace(/\s+$/, '').split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === CREDITS_HEADING);
  let head = lines;
  if (at >= 0) { let end = at + 1; while (end < lines.length && lines[end].startsWith('- ')) end++; head = [...lines.slice(0, at), ...lines.slice(end)]; }
  const body = head.join('\n').replace(/\s+$/, '');
  return block ? `${body}${body ? '\n\n' : ''}${block}\n` : `${body}\n`;
}
export function creditsCurrent(root, videoDir) {
  const f = path.join(videoDir, 'out', 'youtube.txt');
  if (!fs.existsSync(f)) return { ok: true, skipped: true };
  const block = creditsBlock(creditsOf(root, videoDir)), text = fs.readFileSync(f, 'utf8');
  return { ok: withCredits(text, block).trim() === text.trim(), block };
}
export function writeCredits(root, videoDir) {
  const f = path.join(videoDir, 'out', 'youtube.txt');
  if (!fs.existsSync(f)) throw new Error('out/youtube.txt does not exist yet: write the YouTube text first (SKILL.md step 12), then run this');
  const block = creditsBlock(creditsOf(root, videoDir));
  fs.writeFileSync(f, withCredits(fs.readFileSync(f, 'utf8'), block));
  return block;
}

// the gate used by `video approve final`: throws when the check fails or the credits are not in the description
export function gate(videoDir) {
  const root = channelRoot(videoDir);
  const used = usedAssets(videoDir);
  if (!used.length) return { used: [], records: [] };
  if (!root) throw new Error('this video uses licensed assets but is not inside a channel folder: nothing can be checked');
  const r = check(root, videoDir);
  if (!r.ok) throw new Error(`licensed assets: not cleared\n${r.lines.filter((l) => l.status === 'FAIL').map((l) => `  FAIL ${l.text}`).join('\n')}\nfix these (video licensed check <folder> shows them all), then approve again`);
  const cur = creditsCurrent(root, videoDir);
  if (!cur.ok) throw new Error('the credits block ("Music and assets") in out/youtube.txt is missing or out of date: run  video licensed credits <folder>  then record the fact check again if it asks, and approve');
  return { used, records: creditsOf(root, videoDir) };
}

/* ── command line ───────────────────────────────────────────────────────────────────────────────────────────────────── */
export function cli(loose, flags, cwd = process.cwd()) {
  const [sub, a1, a2] = loose;
  const rootFor = (p) => { const r = channelRoot(flags.channel && flags.channel !== true ? flags.channel : p || cwd); if (!r) throw new Error('run this inside a channel folder (one with brand/brand.json), or give --channel <folder>'); return r; };
  const text = (k) => (typeof flags[k] === 'string' ? flags[k] : '');
  switch (sub) {
    case 'add': {
      const root = rootFor(), rec = addAsset(root, a1 ? path.resolve(cwd, a1) : null, { type: text('type'), title: text('title'), artist: text('artist'), url: text('url'), channels: text('channels'), credit: text('credit'), id: text('id'), notes: text('notes'), licence: text('licence'), source: text('source'), plan: text('plan'), move: Boolean(flags.move) });
      console.log(`recorded ${rec.id} (${rec.type}): ${rec.file}\n  sha256 ${rec.sha256.slice(0, 16)}...`);
      if (!rec.channels.length) console.log(`note: channels is empty. If your source has a safelist (Uppbeat: Account, Safelist), safelist this channel for the YouTube upload, then record it:  video licensed channels ${rec.id} ${channelSlug(root) || '<channel slug>'}`);
      return;
    }
    case 'list': {
      const rows = listAssets(rootFor(), text('type') || null);
      if (!rows.length) return console.log('no licensed assets recorded (video licensed add <file> --type ...)');
      for (const r of rows) console.log(`${r.id.padEnd(24)} ${r.type.padEnd(15)} ${r.title}${r.artist ? ` - ${r.artist}` : ''}  [${(r.channels || []).join(', ') || 'no channel safelisted'}]  ${r.file}`);
      return;
    }
    case 'check': {
      const video = a1 ? path.resolve(cwd, a1) : null, root = rootFor(video || undefined);
      const r = check(root, video);
      for (const l of r.lines) console.log(`${l.status}  ${l.text}`);
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case 'channels': {
      if (!a1 || !a2) throw new Error('video licensed channels <id> <slug,slug>');
      const r = setChannels(rootFor(), a1, a2);
      return console.log(`${r.id}: channels = ${r.channels.join(', ') || '(none)'}`);
    }
    case 'credits': {
      const video = path.resolve(cwd, a1 || '.'), root = rootFor(video);
      const block = writeCredits(root, video);
      return console.log(block ? `out/youtube.txt now ends with:\n${block}` : 'nothing to credit (no music, sound effect, stock video or motion graphic is used): the block was removed');
    }
    case 'remove': {
      if (!a1) throw new Error('video licensed remove <id>');
      const r = removeAsset(rootFor(), a1, { keepFile: Boolean(flags['keep-file']) });
      return console.log(`removed ${r.rec.id} from the register${r.removed ? ` and deleted ${r.rec.file}` : ''}`);
    }
    default:
      console.log('video licensed add <file> --type T --title "..." [--artist ..] [--url ..] [--channels a,b] [--credit ".."] [--id slug] [--notes ..] [--move]\nvideo licensed list [--type T]\nvideo licensed check [<video folder>]\nvideo licensed channels <id> a,b\nvideo licensed credits <video folder>\nvideo licensed remove <id> [--keep-file]');
      if (sub) process.exitCode = 1;
  }
}
