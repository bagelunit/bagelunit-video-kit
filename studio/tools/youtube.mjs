#!/usr/bin/env node
// youtube.mjs · long-form upload to YouTube from this computer. No server: the video is sent straight from out/video.mp4.
//
//   node video.mjs youtube login [--slug name] [--upload-only]   one-time sign-in in the browser: upload and manage the channel
//                                                             (captions); --upload-only asks for uploading only. BAGELUNIT_NO_BROWSER=1 only
//                                                             prints the address (to open it in the browser profile of the channel's account)
//   node video.mjs youtube login --client <downloaded.json> [--all]   installs Google's client file for this channel (--all: every
//                                                             channel in channels.json), deletes the download, then signs in
//   node video.mjs youtube upload <folder> [--privacy private|unlisted|public] [--yes] [--again] [--no-thumbnail]
//   node video.mjs youtube captions <folder>                   add out/captions.<lang>.srt to the uploaded video (needs the full sign-in);
//                                                             a file already added unchanged is skipped
//
// upload is a DRY RUN until --yes: it prints the title, description, privacy, size and every problem, and sends nothing.
// It needs the final approval of exactly these files, recorded with --watched (the person watched the whole final cut).
// The description gets the chapters (out/chapters.txt) and, unless it already names them, the sources in research.md.
// out/pinned-comment.txt is shown but never posted: the person pins it by hand.
// The default privacy is private, so a first upload can be looked at in YouTube Studio before it goes public.
//
// Credentials (never printed, never committed): ~/.config/bagelunit-video/youtube-<slug>.json, {client_id, client_secret,
// refresh_token}, readable by you only. The slug is "default" unless video.json "channel" or --slug says otherwise. The client
// id and secret are a Google Cloud "Desktop app" OAuth client (the Video Kit's SETUP.md section 5); Google's downloaded client file
// works as it is (its "installed" block). If this file does not exist yet the Reel Kit's youtube-<slug>.json in
// ~/.config/bagelunit-reels is read for them. Sign in once with `login`.
// In Google's "Testing" state a sign-in ends after 7 days, and it keeps that end after publishing: publish the app first.
//
// Never twice: the upload session address is saved to build/youtube-upload.json before any bytes go out; a run that finds it asks
// YouTube how far it got instead of starting again; and once out/youtube-published.json exists a second upload needs --again.
// Right channel: the upload permission cannot read which channel a sign-in is for, so after an upload the answer's channel id is
// compared with youtube.channel_id in brand/brand.json; a mismatch is a loud warning and exit code 1 (the video stays private).
// The project's daily upload quota is Google's to set (check it in Google Cloud); when it is used up YouTube says so and nothing is lost.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { approvalCurrent, findBrand, sha256File } from './checks.mjs';

export const CONFIG_DIR = process.env.BAGELUNIT_VIDEO_CONFIG || path.join(os.homedir(), '.config', 'bagelunit-video');
const REEL_CONFIG = path.join(os.homedir(), '.config', 'bagelunit-reels');
export class Plain extends Error {}
const readJSON = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writePrivate = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); try { fs.chmodSync(f, 0o600); } catch {} };
const isPlaceholder = (v) => !v || /^PASTE-/i.test(String(v).trim());

export const LIMITS = { title: 100, descriptionBytes: 5000, thumbnailBytes: 2 * 1024 * 1024 };

/* ── the text ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
// out/youtube.txt: the title on the first line, the description after it. Chapters (out/chapters.txt) are added to the end of the
// description when the description does not already hold them. A long video is not a Short: no #Shorts is added.
export function parts(text, chapters = '') {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const i = lines.findIndex((l) => l.trim());
  const title = i < 0 ? '' : lines[i].trim();
  let description = i < 0 ? '' : lines.slice(i + 1).join('\n').trim();
  const ch = String(chapters || '').trim();
  if (ch && !/^0:00\s/m.test(description)) description = `${description}\n\n${ch}`.trim();
  return { title, description };
}

// The sources of research.md for the description: its "## Sources" list (or, without one, every link in it), one per line,
// as many as fit in YouTube's limit. Nothing is added when the description already holds a "Sources" heading or any of the
// links, or when video.json says "description_sources": false.
export function researchSources(text) {
  const all = String(text || '');
  const sec = all.split(/^##\s+Sources\s*$/im)[1];
  const body = sec != null ? sec.split(/^##\s/m)[0] : all;
  const out = [], seen = new Set();
  for (const m of body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)>\]]+)/g)) {
    const url = m[2] || m[3];
    if (!url || seen.has(url) || /^https?:\/\/\.\.\./.test(url) || url === 'https://') continue;
    seen.add(url);
    out.push({ title: (m[1] || '').trim(), url });
  }
  return out;
}
export function withSources(description, sources, { limit = LIMITS.descriptionBytes } = {}) {
  if (!sources.length) return { description, added: 0, why: 'research.md lists no sources' };
  if (/^\s*(sources|credits|references)\b/im.test(description) || sources.some((x) => description.includes(x.url))) return { description, added: 0, why: 'the description already has its sources' };
  let out = `${description.trim()}\n\nSources:`, added = 0;
  for (const x of sources) {
    const line = `\n${x.title ? `${x.title.replace(/[<>]/g, '')}: ` : ''}${x.url}`;
    if (Buffer.byteLength(out + line) > limit) break;
    out += line; added++;
  }
  if (!added) return { description, added: 0, why: 'no room left in the description for the sources' };
  return { description: out, added, why: added < sources.length ? `${sources.length - added} source(s) did not fit` : '' };
}

export function problems({ title, description }, { video, thumbnail, standIn, privacy, chapters }) {
  const out = [];
  if (!title) out.push('the title is empty (out/youtube.txt: the title on the first line, the description after it)');
  if ([...title].length > LIMITS.title) out.push(`the title is ${[...title].length} characters; YouTube allows ${LIMITS.title}`);
  if (/[<>]/.test(`${title}${description}`)) out.push('the title and description cannot contain < or >');
  const bytes = Buffer.byteLength(description);
  if (bytes > LIMITS.descriptionBytes) out.push(`the description is ${bytes} bytes; YouTube allows ${LIMITS.descriptionBytes}`);
  if (!video) out.push('out/video.mp4 is missing: run  node video.mjs render <folder>  first');
  if (standIn) out.push('audio/vo.mp3 is the stand-in tone, not a voice: run  node video.mjs voice <folder>  and render again');
  if (!['private', 'unlisted', 'public'].includes(privacy)) out.push(`privacy must be private, unlisted or public (not "${privacy}")`);
  if (thumbnail && thumbnail.size > LIMITS.thumbnailBytes) out.push(`the thumbnail is ${thumbnail.size} bytes; YouTube allows ${LIMITS.thumbnailBytes}`);
  return out;
}

// tags: YouTube allows 500 characters in all (a tag with a space counts its quotes); publishAt: an ISO time in the future,
// only with privacy "private" (YouTube then makes the video public at that time); language: e.g. "en" for both the
// title/description language and the spoken language.
export const cleanTags = (tags) => (Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : []);
export function tagChars(tags) { const c = cleanTags(tags); return c.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, c.length - 1); }
export const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
// publish_at needs its offset ("Z" or "-05:00"): without one the time would be read in this computer's zone, a date alone as UTC
export function publishTime(value, { privacy, now = Date.now() } = {}) {
  const v = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) || Number.isNaN(new Date(v).getTime())) return { why: `video.json "publish_at" must be a time with its offset, e.g. 2026-11-17T18:00:00-05:00 (it is ${JSON.stringify(value)})` };
  const when = new Date(v);
  if (when.getTime() < now + 15 * 60e3) return { why: `video.json "publish_at" (${v}) must be at least 15 minutes from now` };
  if (privacy !== 'private') return { why: `a scheduled video uploads as private, then YouTube publishes it at "publish_at"; privacy is "${privacy}" (upload with --privacy private)` };
  return { at: when.toISOString() };
}
export function metadata({ title, description }, { privacy, categoryId = '27', madeByAi = false, tags = null, publishAt = null, language = null }) {
  const clean = cleanTags(tags);
  return {
    snippet: { title, description, categoryId: String(categoryId), ...(clean.length ? { tags: clean } : {}), ...(language ? { defaultLanguage: language, defaultAudioLanguage: language } : {}) },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, ...(publishAt ? { publishAt } : {}), ...(madeByAi ? { containsSyntheticMedia: true } : {}) },
  };
}

/* ── credentials and sign-in ────────────────────────────────────────────────────────────────────────────────────────── */
export function credentialsFile(slug, dir = CONFIG_DIR) { return path.join(dir, `youtube-${slug}.json`); }

export function readCredentials(slug, { dir = CONFIG_DIR, reelDir = REEL_CONFIG } = {}) {
  const file = credentialsFile(slug, dir);
  let cfg = readJSON(file, null);
  if (!cfg) {
    const borrowed = readJSON(path.join(reelDir, `youtube-${slug}.json`), null);
    if (borrowed && !isPlaceholder(borrowed.client_id) && !isPlaceholder(borrowed.client_secret))
      cfg = { client_id: borrowed.client_id, client_secret: borrowed.client_secret, ...(borrowed.refresh_token ? { refresh_token: borrowed.refresh_token, ...(borrowed.scope ? { scope: borrowed.scope } : {}) } : {}) };
  }
  if (!cfg) {
    writePrivate(file, { client_id: 'PASTE-CLIENT-ID-HERE', client_secret: 'PASTE-CLIENT-SECRET-HERE' });
    throw new Plain(`Made ${file} with PASTE-... in place of the client_id and client_secret (a Google Cloud "Desktop app" OAuth client for the YouTube Data API v3; the Video Kit's SETUP.md section 5). Paste them in that file, then run this again.`);
  }
  const inner = cfg.installed || cfg.web;
  if (inner) cfg = { ...cfg, client_id: inner.client_id, client_secret: inner.client_secret };
  if (isPlaceholder(cfg.client_id) || isPlaceholder(cfg.client_secret)) throw new Plain(`${file} still needs client_id and client_secret (it holds the PASTE-... words or nothing).`);
  return { file, cfg };
}

// Google's downloaded client file ("Download JSON" on a Desktop app client) becomes the sign-in file of each channel given, readable
// by you only. Nothing in it is printed. A sign-in already saved for the same client is kept; one for another client is dropped
// (it would not work with the new client). The downloaded copy is deleted afterwards, so the secret is not left in Downloads; a file
// in the kit's own config folder (another channel's sign-in file, for its client) is only read: its sign-in is never copied.
export function installClient(src, slugs, { dir = CONFIG_DIR, remove = true } = {}) {
  const raw = readJSON(src, null);
  if (!raw || typeof raw !== 'object') throw new Plain(`${src} is not a client file from Google (it could not be read as JSON). Download it again: Clients, your Desktop app client, Download JSON.`);
  if (raw.web && !raw.installed) throw new Plain(`${src} is for a "Web application" client. Make a "Desktop app" client instead (SETUP.md section 5, step 6) and download that one.`);
  const inner = raw.installed || raw;
  if (isPlaceholder(inner.client_id) || isPlaceholder(inner.client_secret)) throw new Plain(`${src} has no client_id and client_secret. Download it again: Clients, your Desktop app client, Download JSON.`);
  const done = [];
  for (const slug of [...new Set(slugs)]) {
    const file = credentialsFile(slug, dir), old = readJSON(file, null);
    const same = old && old.client_id === inner.client_id && !isPlaceholder(old.refresh_token);
    writePrivate(file, { client_id: inner.client_id, client_secret: inner.client_secret, ...(same ? { refresh_token: old.refresh_token, scope: old.scope, signed_in_at: old.signed_in_at } : {}) });
    done.push({ slug, file, signedIn: Boolean(same) });
  }
  const rel = path.relative(path.resolve(dir), path.resolve(src));
  const inConfig = Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
  const removed = remove && !inConfig;
  if (removed) fs.rmSync(src, { force: true });
  return Object.assign(done, { removed });
}

// every channel folder made by /video-setup (channels.json), by the slug in its brand.json today; folders that are gone are skipped
export function registeredSlugs(registry = path.join(CONFIG_DIR, 'channels.json')) {
  const out = [];
  for (const c of readJSON(registry, []) || []) {
    if (!c?.dir || !fs.existsSync(c.dir)) continue;
    const slug = readJSON(path.join(c.dir, 'brand', 'brand.json'), {})?.slug || c.slug;
    if (slug) out.push(slug);
  }
  return [...new Set(out)];
}

// The sign-in asks for upload plus channel management (youtube.force-ssl) by default: captions, and later playlists and video
// edits, need the second. `login --upload-only` asks for the first alone (captions are then skipped with a note), as does a
// sign-in made before this kit asked for both.
export const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const MANAGE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
export const SCOPES = [UPLOAD_SCOPE, MANAGE_SCOPE];
export const canManage = (cfg) => String(cfg?.scope || '').split(/\s+/).includes(MANAGE_SCOPE);
export const noBrowser = (env = process.env) => Boolean(env.BAGELUNIT_NO_BROWSER) && !/^(0|false|no)$/i.test(String(env.BAGELUNIT_NO_BROWSER).trim());
export const openBrowser = (url) => {
  if (noBrowser()) return false;                              // the caller opens the printed address in a browser of its choice
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
  return true;
};

export function waitForCode({ state, timeoutMs = 5 * 60 * 1000, onListening }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404).end('not here'); return; }
      const done = (status, text, fn) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); clearTimeout(timer); server.close(); fn(); };
      if (u.searchParams.get('state') !== state) return done(400, 'This did not match the sign-in that was started. Go back to the terminal and try again.', () => reject(new Plain('the answer did not match the sign-in that was started')));
      if (u.searchParams.get('error')) return done(400, 'The sign-in was not allowed. You can close this tab.', () => reject(new Plain(`the sign-in was refused (${String(u.searchParams.get('error')).slice(0, 80)})`)));
      const code = u.searchParams.get('code');
      if (!code) return done(400, 'No code came back.', () => reject(new Plain('no code came back from the sign-in page')));
      done(200, 'Signed in. You can close this tab and go back to the terminal.', () => resolve(code));
    });
    const timer = setTimeout(() => { server.close(); reject(new Plain('nobody signed in within 5 minutes: run it again when you are ready')); }, timeoutMs);
    server.on('error', (e) => { clearTimeout(timer); reject(new Plain(`could not listen on this computer: ${e.message}`)); });
    server.listen(0, '127.0.0.1', () => onListening(server.address().port));
  });
}

export async function login({ slug = 'default', dir = CONFIG_DIR, reelDir = REEL_CONFIG, fetchImpl = fetch, open = openBrowser, log = console.log, timeoutMs, scopes = SCOPES } = {}) {
  const { file, cfg } = readCredentials(slug, { dir, reelDir });
  const verifier = randomBytes(48).toString('base64url'), state = randomBytes(16).toString('hex');
  let redirect = '';
  const code = await waitForCode({
    state, timeoutMs,
    onListening: (port) => {
      redirect = `http://127.0.0.1:${port}/`;
      const q = new URLSearchParams({ client_id: cfg.client_id, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' });
      const url = `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
      const asks = scopes.includes(MANAGE_SCOPE) ? 'to upload videos to this channel and manage them (captions now; this permission could also edit or delete its videos)' : 'to upload videos to this channel (uploads only: no captions)';
      log(`${noBrowser() ? 'Open this address in the browser signed in to the channel\'s Google account' : 'Opening the YouTube sign-in page. If no page opens, open this address yourself'}. Sign in with the channel's Google account and choose Allow; it asks ${asks}:\n${url}`);
      open(url);
    },
  });
  let res, data;
  try {
    res = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, code, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }) });
    data = await res.json().catch(() => ({}));
  } catch (e) { throw new Plain(`could not reach Google to finish the sign-in (${e?.cause?.code || e?.name || 'network error'})`); }
  const hide = (s) => [cfg.client_secret, code, verifier].reduce((t, x) => (x ? String(t).split(String(x)).join('***') : t), String(s));
  if (!res.ok || !data.refresh_token) throw new Plain(`Google did not finish the sign-in: ${hide(data.error_description || (typeof data.error === 'string' ? data.error : data.error?.message) || 'no refresh token came back')}`);
  const scope = data.scope || scopes.join(' ');
  writePrivate(file, { client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: data.refresh_token, scope, signed_in_at: new Date().toISOString() });
  const full = canManage({ scope });
  log(`Signed in. The refresh token is saved in ${file}, readable by you only, never printed, and it stays on this computer. ${full ? 'It can upload to and manage this channel: keep this computer\'s account to yourself.' : 'It can upload only, so captions are skipped.'}`);
  if (!full && scopes.includes(MANAGE_SCOPE)) log('Google gave upload permission only (a box was left unticked). For captions, run  node video.mjs youtube login  again and tick both boxes.');
  return { file, scope };
}

async function accessToken(cfg, fetchImpl) {
  if (isPlaceholder(cfg.refresh_token)) throw new Plain('not signed in yet: run  node video.mjs youtube login');
  const res = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: 'refresh_token' }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const why = data.error_description || data.error || res.status;
    throw new Plain(`Google refused the saved sign-in (${String(why).replace(cfg.client_secret, '***').slice(0, 160)}). In Google's "Testing" state a sign-in ends after 7 days: sign in again with  node video.mjs youtube login`);
  }
  return data.access_token;
}

/* ── the upload ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

export async function startSession(token, meta, size, fetchImpl) {
  const res = await fetchImpl(UPLOAD, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify(meta) });
  const loc = res.headers.get('location');
  if (!res.ok || !loc) {
    const body = await res.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.message || res.status;
    throw new Plain(`YouTube would not start the upload (${String(reason).slice(0, 200)})${reason === 'quotaExceeded' || reason === 'uploadLimitExceeded' ? ': the daily upload limit is used up; try again tomorrow' : ''}`);
  }
  return loc;
}

// Ask the session how far it got: complete (with the video), or the bytes it has.
export async function querySession(token, uri, size, fetchImpl) {
  const res = await fetchImpl(uri, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
  if (res.status === 200 || res.status === 201) return { complete: true, resource: await res.json().catch(() => ({})) };
  if (res.status === 308) { const m = /bytes=0-(\d+)/.exec(res.headers.get('range') || ''); return { complete: false, received: m ? Number(m[1]) + 1 : 0 }; }
  const e = new Plain(`YouTube could not say how far the upload got (HTTP ${res.status})`); e.status = res.status; throw e;
}

export async function sendBytes(token, uri, file, size, offset, fetchImpl) {
  const stream = fs.createReadStream(file, { start: offset });
  const res = await fetchImpl(uri, { method: 'PUT', duplex: 'half', body: stream,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(size - offset), ...(offset ? { 'Content-Range': `bytes ${offset}-${size - 1}/${size}` } : {}) } });
  if (res.status !== 200 && res.status !== 201) throw new Plain(`YouTube did not take the video (HTTP ${res.status}). If the upload was cut off, run upload again: it asks YouTube how far it got and sends only the rest.`);
  return res.json();
}

async function setThumbnail(token, id, file, fetchImpl) {
  const res = await fetchImpl(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(id)}&uploadType=media`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(file) });
  return res.ok ? null : `the thumbnail was not set (HTTP ${res.status}; custom thumbnails need a verified channel). Set it in YouTube Studio: out/thumbnail.jpg`;
}

// Captions: every out/captions.<language>.srt (e.g. captions.en.srt) goes to the video as a published track.
export function captionFiles(dir) {
  const out = path.join(dir, 'out');
  return fs.existsSync(out) ? fs.readdirSync(out).filter((f) => /^captions\.[a-zA-Z-]{2,10}\.srt$/.test(f)).map((f) => ({ file: path.join(out, f), language: f.split('.')[1] })) : [];
}
async function insertCaption(token, videoId, { file, language }, fetchImpl) {
  const boundary = `bagelunit${randomBytes(8).toString('hex')}`;
  const meta = JSON.stringify({ snippet: { videoId, language, name: language === 'en' ? 'English' : language, isDraft: false } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fs.readFileSync(file), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const res = await fetchImpl('https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return `the ${language} captions were not added (${String(b?.error?.errors?.[0]?.reason || b?.error?.message || res.status).slice(0, 120)}). Add ${path.basename(file)} in YouTube Studio, Subtitles`;
}
// a caption file made by `video captions` from an older word clock (the voice changed since) is out of date
export function staleCaptions(dir) {
  const rec = readJSON(path.join(dir, 'build', 'captions.json'), {}) || {};
  const words = sha256File(path.join(dir, 'build', 'words.json'));
  return captionFiles(dir).filter((f) => rec[f.language] && rec[f.language].words !== words)
    .map((f) => `out/captions.${f.language}.srt was made before the voice last changed: run  node video.mjs captions <folder>  again`);
}
const fileSha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
// sends each caption file not yet added as it is now; what was sent is kept in out/youtube-published.json "captions"
async function sendCaptions(dir, token, cfg, videoId, fetchImpl, log) {
  const files = captionFiles(dir);
  if (!files.length) return {};
  if (!canManage(cfg)) { log('captions not sent: this sign-in only allows uploads. Sign in again (node video.mjs youtube login, without --upload-only) to allow captions, then run  node video.mjs youtube captions <folder>'); return {}; }
  const pubFile = path.join(dir, 'out', 'youtube-published.json');
  const sent = { ...(readJSON(pubFile, {})?.captions || {}) };
  for (const f of files) {
    const h = fileSha(f.file);
    if (sent[f.language] === h) { log(`captions (${f.language}) already added unchanged; skipped`); continue; }
    const again = Boolean(sent[f.language]);
    const w = await insertCaption(token, videoId, f, fetchImpl);
    if (w) { log(w); continue; }
    sent[f.language] = h;
    log(`captions added (${f.language})${again ? '. This is a second track in that language: delete the older one in YouTube Studio, Subtitles' : ''}`);
  }
  const pub = readJSON(pubFile, null);
  if (pub) fs.writeFileSync(pubFile, JSON.stringify({ ...pub, captions: sent }, null, 2) + '\n');
  return sent;
}
export async function captions(dir, { slug, fetchImpl = fetch, log = console.log, credDir = CONFIG_DIR, reelDir = REEL_CONFIG } = {}) {
  const published = readJSON(path.join(dir, 'out', 'youtube-published.json'), null);
  if (!published?.id) throw new Plain('this video has not been uploaded yet (no out/youtube-published.json)');
  if (published.wrong_channel) throw new Plain(`this upload went to the wrong channel (${published.channel_id}): delete it there and upload again before adding captions`);
  if (!captionFiles(dir).length) throw new Plain('no out/captions.<lang>.srt to add: make it with  node video.mjs captions <folder>');
  const stale = staleCaptions(dir);
  if (stale.length) throw new Plain(`not sent:\n  ${stale.join('\n  ')}`);
  const cfgV = readJSON(path.join(dir, 'video.json'), null) || {};
  const brand = findBrand(dir);
  slug = slug || cfgV.channel || brand?.cfg.slug || 'default';
  const { cfg } = readCredentials(slug, { dir: credDir, reelDir });
  await sendCaptions(dir, await accessToken(cfg, fetchImpl), cfg, published.id, fetchImpl, log);
}

export async function upload(dir, { privacy, yes = false, again = false, thumb = true, slug, fetchImpl = fetch, log = console.log, credDir = CONFIG_DIR, reelDir = REEL_CONFIG } = {}) {
  const cfgV = readJSON(path.join(dir, 'video.json'), null) || {};
  // the channel folder this video sits in names the sign-in (one per channel) and may set a calmer default privacy
  const brand = findBrand(dir);
  slug = slug || cfgV.channel || brand?.cfg.slug || 'default';
  const brandPrivacy = ['private', 'unlisted'].includes(brand?.cfg.youtube?.privacy) ? brand.cfg.youtube.privacy : null;
  privacy = privacy || cfgV.privacy || brandPrivacy || 'private';
  const mp4 = path.join(dir, 'out', 'video.mp4'), jpg = path.join(dir, 'out', 'thumbnail.jpg');
  const txt = path.join(dir, 'out', 'youtube.txt'), chaptersFile = path.join(dir, 'out', 'chapters.txt');
  const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : cfgV.title ? `${cfgV.title}\n` : '';
  const t = parts(text, fs.existsSync(chaptersFile) ? fs.readFileSync(chaptersFile, 'utf8') : '');
  const src = cfgV.description_sources === false ? { added: 0, why: 'off in video.json' } : withSources(t.description, researchSources(fs.existsSync(path.join(dir, 'research.md')) ? fs.readFileSync(path.join(dir, 'research.md'), 'utf8') : ''));
  if (src.added) t.description = src.description;
  const pinnedFile = path.join(dir, 'out', 'pinned-comment.txt');
  const pinned = fs.existsSync(pinnedFile) ? fs.readFileSync(pinnedFile, 'utf8').trim() : '';
  const note = readJSON(path.join(dir, 'build', 'voice-stand-in.json'), null), vo = path.join(dir, 'audio', 'vo.mp3');
  const standIn = Boolean(note && fs.existsSync(vo) && note.sha === createHash('sha256').update(fs.readFileSync(vo)).digest('hex'));
  const size = fs.existsSync(mp4) ? fs.statSync(mp4).size : 0;
  const withThumb = thumb && fs.existsSync(jpg);
  const issues = problems(t, { video: size > 0, thumbnail: withThumb ? fs.statSync(jpg) : null, standIn, privacy });
  const approved = approvalCurrent(dir, 'final');
  if (!approved.ok) issues.push(approved.why);
  else if (!approved.watched) issues.push('the final approval does not say the person watched the whole final cut: once they have, record it with  node video.mjs approve <folder> final --watched');
  if (pinned.length > 10000) issues.push(`out/pinned-comment.txt is ${pinned.length} characters; a YouTube comment takes 10,000`);
  issues.push(...staleCaptions(dir));
  const published = readJSON(path.join(dir, 'out', 'youtube-published.json'), null);
  if (published && !again) issues.push(`already uploaded: ${published.url}. A second upload needs --again`);
  // scheduled publishing: video.json "publish_at" (ISO time with its offset, e.g. "2026-11-17T18:00:00-05:00"); the upload
  // stays private and YouTube publishes it then. Setting it is the owner's say-so, like any change of privacy.
  let publishAt = null;
  if (cfgV.publish_at) { const p = publishTime(cfgV.publish_at, { privacy }); if (p.why) issues.push(p.why); else publishAt = p.at; }
  if (cfgV.tags != null && !Array.isArray(cfgV.tags)) issues.push('video.json "tags" must be a list, e.g. ["volcanoes", "how volcanoes form"]');
  const tags = Array.isArray(cfgV.tags) ? cleanTags(cfgV.tags) : null;
  if (tags && tagChars(tags) > 500) issues.push(`the tags are ${tagChars(tags)} characters; YouTube allows 500`);
  if (tags && tags.some((x) => /[<>]/.test(x))) issues.push('a tag cannot contain < or >');
  const language = String(cfgV.language || brand?.cfg.youtube?.language || '').trim() || null;
  if (language && !LANGUAGE.test(language)) issues.push(`the language "${language}" is not a language code like en, es or pt-BR (video.json "language" or brand.json youtube.language)`);
  const meta = metadata(t, { privacy, categoryId: cfgV.category_id, madeByAi: Boolean(cfgV.ai_generated), tags, publishAt, language });
  const chapterLines = fs.existsSync(chaptersFile) ? fs.readFileSync(chaptersFile, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  const caps = captionFiles(dir).map((f) => f.language);
  log(`YouTube upload ${yes ? '' : '(dry run: nothing is sent)'}\n  title:       ${t.title}\n  privacy:     ${privacy}${publishAt ? ` (scheduled: YouTube publishes it ${publishAt})` : ''}\n  tags:        ${tags ? tags.length : 0}${language ? `\n  language:    ${language}` : ''}\n  video:       out/video.mp4 (${(size / 1048576).toFixed(1)} MB)\n  thumbnail:   ${withThumb ? 'out/thumbnail.jpg' : 'none (YouTube picks a frame)'}\n  chapters:    ${chapterLines}\n  sources:     ${src.added ? `${src.added} added from research.md${src.why ? ` (${src.why})` : ''}` : `none added (${src.why})`}\n  captions:    ${caps.length ? caps.join(', ') : 'none (node video.mjs captions <folder> makes them)'}\n  description: ${Buffer.byteLength(t.description)} bytes\n  watched:     ${approved.ok ? (approved.watched ? 'yes, the whole final cut (recorded with the approval)' : 'NOT recorded') : 'no final approval yet'}\n  pinned:      ${pinned ? `out/pinned-comment.txt (${pinned.length} characters; not posted by the upload: pin it by hand)\n${pinned.split('\n').map((l) => `               ${l}`).join('\n')}` : 'none (out/pinned-comment.txt)'}`);
  if (issues.length) throw new Plain(`not sent:\n  ${issues.join('\n  ')}`);
  if (!yes) { log('\nAll checks passed. Run again with --yes to upload.'); return { dryRun: true, meta }; }

  const { cfg } = readCredentials(slug, { dir: credDir, reelDir });
  const token = await accessToken(cfg, fetchImpl);
  const stateFile = path.join(dir, 'build', 'youtube-upload.json');
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  let st = readJSON(stateFile, null);
  let offset = 0, resource = null;
  if (st?.session && st.size === size && !again) {
    let q;
    try { q = await querySession(token, st.session, size, fetchImpl); }
    catch (e) {
      if (e.status === 404 || e.status === 410) throw new Plain('YouTube forgot the upload session: check the channel for the video before uploading again (then delete build/youtube-upload.json and run with --again)');
      throw e;
    }
    if (q.complete) resource = q.resource; else { offset = q.received; log(offset ? `YouTube has the first ${offset} bytes; sending the rest` : 'YouTube has no bytes yet; sending the video'); }
  } else {
    st = { session: await startSession(token, meta, size, fetchImpl), size, started: new Date().toISOString() };
    fs.writeFileSync(stateFile, JSON.stringify(st, null, 1));        // saved before the bytes go out
  }
  if (!resource) { log('sending the video...'); resource = await sendBytes(token, st.session, mp4, size, offset, fetchImpl); }
  if (!resource?.id) throw new Plain('YouTube took the upload but did not return the video id: check the channel before uploading again');
  const url = `https://www.youtube.com/watch?v=${resource.id}`;
  const channelId = resource.snippet?.channelId || null;
  const expected = String(brand?.cfg.youtube?.channel_id || '').trim();
  const wrongChannel = Boolean(channelId && expected && channelId !== expected);
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'out', 'youtube-published.json'), JSON.stringify({ id: resource.id, url, privacy, ...(channelId ? { channel_id: channelId } : {}), ...(wrongChannel ? { wrong_channel: true } : {}), at: new Date().toISOString() }, null, 2) + '\n');
  fs.rmSync(stateFile, { force: true });
  log(`uploaded: ${url} (${privacy})`);
  // The upload permission cannot read which channel a sign-in belongs to, so the answer is the first place a wrong pick shows.
  if (wrongChannel) {
    log(`\n!!! WRONG CHANNEL !!!\n!!! YouTube put this video on the channel ${channelId}, but brand/brand.json says this channel is ${expected}.\n!!! The video is ${privacy}. Delete it in YouTube Studio on that channel. Then, from this folder, sign in again (node video.mjs youtube login),\n!!! choose this channel or Brand Account, and upload again with --again. The thumbnail was not set.\n`);
    return { id: resource.id, url, channelId, wrongChannel };
  }
  if (channelId && !expected) log(`channel: ${channelId}. Check in YouTube Studio that the video is on the right channel, then save this as youtube.channel_id in brand/brand.json: later uploads are checked against it.`);
  if (withThumb) { const w = await setThumbnail(token, resource.id, jpg, fetchImpl); log(w || 'thumbnail set'); }
  await sendCaptions(dir, token, cfg, resource.id, fetchImpl, log);
  if (pinned) log(`pin the comment by hand: open ${url} (or YouTube Studio, Comments), post the text of out/pinned-comment.txt as the channel, then "Pin" in its menu. The upload never posts comments.`);
  return { id: resource.id, url, channelId, wrongChannel };
}

export async function cli(argv) {
  const flags = {}, loose = [];
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) flags[a.slice(2)] = true; else { flags[a.slice(2)] = n; i++; } } else loose.push(a); }
  try {
    if (loose[0] === 'login') {
      const b = findBrand(process.cwd()), slug = typeof flags.slug === 'string' ? flags.slug : b?.cfg.slug || 'default';
      if (flags.client === true) throw new Plain('give the downloaded file: node video.mjs youtube login --client ~/Downloads/client_secret_<...>.json');
      if (flags.all && typeof flags.client !== 'string') throw new Plain('--all goes with --client: node video.mjs youtube login --client <downloaded.json> --all');
      if (typeof flags.client === 'string') {
        const here = b || typeof flags.slug === 'string' ? [slug] : [];
        const slugs = flags.all ? [...here, ...registeredSlugs()] : here;
        if (!slugs.length) throw new Plain('not in a channel folder: run this from the channel\'s folder, or add --all for every channel made with /video-setup');
        const done = installClient(path.resolve(flags.client.replace(/^~(?=$|\/)/, os.homedir())), slugs);
        console.log(`client file installed for ${done.length} channel(s): ${done.map((d) => d.slug + (d.signedIn ? ' (already signed in)' : '')).join(', ')}. Readable by you only; nothing was printed${done.removed ? '; the downloaded copy was deleted' : ''}.`);
        if (!here.length) { console.log('Now sign in each channel from its own folder: node video.mjs youtube login'); return done; }
      }
      console.log(`signing in for the channel "${slug}"${b ? ` (${b.cfg.name || path.basename(b.dir)})` : ''}${flags['upload-only'] ? ', uploads only' : ''}`);
      return await login({ slug, scopes: flags['upload-only'] ? [UPLOAD_SCOPE] : SCOPES });
    }
    if (loose[0] === 'captions') {
      if (!loose[1]) throw new Plain('give the video folder: node video.mjs youtube captions <folder>');
      return await captions(path.resolve(loose[1]), { slug: typeof flags.slug === 'string' ? flags.slug : undefined });
    }
    if (loose[0] === 'upload') {
      if (!loose[1]) throw new Plain('give the video folder: node video.mjs youtube upload <folder>');
      const r = await upload(path.resolve(loose[1]), { privacy: typeof flags.privacy === 'string' ? flags.privacy : undefined, yes: Boolean(flags.yes), again: Boolean(flags.again), thumb: !flags['no-thumbnail'], slug: typeof flags.slug === 'string' ? flags.slug : undefined });
      if (r?.wrongChannel) process.exitCode = 1;
      return r;
    }
    throw new Plain('usage: node video.mjs youtube login [--client <downloaded.json> [--all]] [--upload-only]  |  youtube upload <folder> [--privacy private|unlisted|public] [--yes] [--again] [--no-thumbnail]  |  youtube captions <folder>');
  } catch (e) { console.error(e instanceof Plain ? e.message : `Unexpected error: ${e?.message || e}`); process.exitCode = 1; }
}
