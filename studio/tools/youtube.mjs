#!/usr/bin/env node
// youtube.mjs · long-form upload to YouTube from this computer. No server: the video is sent straight from out/video.mp4.
//
//   node video.mjs youtube login [--slug name]                one-time sign-in in the browser (scope youtube.upload only)
//   node video.mjs youtube upload <folder> [--privacy private|unlisted|public] [--yes] [--again] [--no-thumbnail]
//
// upload is a DRY RUN until --yes: it prints the title, description, privacy, size and every problem, and sends nothing.
// The default privacy is private, so a first upload can be looked at in YouTube Studio before it goes public.
//
// Credentials (never printed, never committed): ~/.config/bagelunit-video/youtube-<slug>.json, {client_id, client_secret,
// refresh_token}, readable by you only. The slug is "default" unless video.json "channel" or --slug says otherwise. The client
// id and secret are a Google Cloud "Desktop app" OAuth client (Reel Kit docs/connect.md step 6B); if this file does not exist yet
// the Reel Kit's youtube-<slug>.json in ~/.config/bagelunit-reels is read for them. Sign in once with `login`.
// In Google's "Testing" state a sign-in ends after 7 days: put the consent screen In production (Reel Kit docs).
//
// Never twice: the upload session address is saved to build/youtube-upload.json before any bytes go out; a run that finds it asks
// YouTube how far it got instead of starting again; and once out/youtube-published.json exists a second upload needs --again.
// The project's daily upload quota is Google's to set (check it in Google Cloud); when it is used up YouTube says so and nothing is lost.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { approvalCurrent } from './checks.mjs';

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

export function metadata({ title, description }, { privacy, categoryId = '27', madeByAi = false }) {
  return {
    snippet: { title, description, categoryId: String(categoryId) },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, ...(madeByAi ? { containsSyntheticMedia: true } : {}) },
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
      cfg = { client_id: borrowed.client_id, client_secret: borrowed.client_secret, ...(borrowed.refresh_token ? { refresh_token: borrowed.refresh_token } : {}) };
  }
  if (!cfg) {
    writePrivate(file, { client_id: 'PASTE-CLIENT-ID-HERE', client_secret: 'PASTE-CLIENT-SECRET-HERE' });
    throw new Plain(`Made ${file} with PASTE-... in place of the client_id and client_secret (a Google Cloud "Desktop app" OAuth client for the YouTube Data API v3; the Reel Kit's docs/connect.md step 6B). Paste them in that file, then run this again.`);
  }
  const inner = cfg.installed || cfg.web;
  if (inner) cfg = { ...cfg, client_id: inner.client_id, client_secret: inner.client_secret };
  if (isPlaceholder(cfg.client_id) || isPlaceholder(cfg.client_secret)) throw new Plain(`${file} still needs client_id and client_secret (it holds the PASTE-... words or nothing).`);
  return { file, cfg };
}

const openBrowser = (url) => {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
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

export async function login({ slug = 'default', dir = CONFIG_DIR, reelDir = REEL_CONFIG, fetchImpl = fetch, open = openBrowser, log = console.log, timeoutMs } = {}) {
  const { file, cfg } = readCredentials(slug, { dir, reelDir });
  const verifier = randomBytes(48).toString('base64url'), state = randomBytes(16).toString('hex');
  let redirect = '';
  const code = await waitForCode({
    state, timeoutMs,
    onListening: (port) => {
      redirect = `http://127.0.0.1:${port}/`;
      const q = new URLSearchParams({ client_id: cfg.client_id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload', state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' });
      const url = `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
      log(`Opening the YouTube sign-in page. Sign in with the channel's Google account and choose Allow. If no page opens, open this address yourself:\n${url}`);
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
  writePrivate(file, { client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: data.refresh_token, scope: data.scope || 'https://www.googleapis.com/auth/youtube.upload', signed_in_at: new Date().toISOString() });
  log(`Signed in. The refresh token is saved in ${file} (readable by you only; it is never printed).`);
  return { file };
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

export async function upload(dir, { privacy, yes = false, again = false, thumb = true, slug, fetchImpl = fetch, log = console.log, credDir = CONFIG_DIR, reelDir = REEL_CONFIG } = {}) {
  const cfgV = readJSON(path.join(dir, 'video.json'), null) || {};
  slug = slug || cfgV.channel || 'default';
  privacy = privacy || cfgV.privacy || 'private';
  const mp4 = path.join(dir, 'out', 'video.mp4'), jpg = path.join(dir, 'out', 'thumbnail.jpg');
  const txt = path.join(dir, 'out', 'youtube.txt'), chaptersFile = path.join(dir, 'out', 'chapters.txt');
  const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : cfgV.title ? `${cfgV.title}\n` : '';
  const t = parts(text, fs.existsSync(chaptersFile) ? fs.readFileSync(chaptersFile, 'utf8') : '');
  const note = readJSON(path.join(dir, 'build', 'voice-stand-in.json'), null), vo = path.join(dir, 'audio', 'vo.mp3');
  const standIn = Boolean(note && fs.existsSync(vo) && note.sha === createHash('sha256').update(fs.readFileSync(vo)).digest('hex'));
  const size = fs.existsSync(mp4) ? fs.statSync(mp4).size : 0;
  const withThumb = thumb && fs.existsSync(jpg);
  const issues = problems(t, { video: size > 0, thumbnail: withThumb ? fs.statSync(jpg) : null, standIn, privacy });
  const approved = approvalCurrent(dir, 'final');
  if (!approved.ok) issues.push(approved.why);
  const published = readJSON(path.join(dir, 'out', 'youtube-published.json'), null);
  if (published && !again) issues.push(`already uploaded: ${published.url}. A second upload needs --again`);
  const meta = metadata(t, { privacy, categoryId: cfgV.category_id, madeByAi: Boolean(cfgV.ai_generated) });
  const chapterLines = fs.existsSync(chaptersFile) ? fs.readFileSync(chaptersFile, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  log(`YouTube upload ${yes ? '' : '(dry run: nothing is sent)'}\n  title:       ${t.title}\n  privacy:     ${privacy}\n  video:       out/video.mp4 (${(size / 1048576).toFixed(1)} MB)\n  thumbnail:   ${withThumb ? 'out/thumbnail.jpg' : 'none (YouTube picks a frame)'}\n  chapters:    ${chapterLines}\n  description: ${Buffer.byteLength(t.description)} bytes`);
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
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'out', 'youtube-published.json'), JSON.stringify({ id: resource.id, url, privacy, at: new Date().toISOString() }, null, 2) + '\n');
  fs.rmSync(stateFile, { force: true });
  log(`uploaded: ${url} (${privacy})`);
  if (withThumb) { const w = await setThumbnail(token, resource.id, jpg, fetchImpl); log(w || 'thumbnail set'); }
  return { id: resource.id, url };
}

export async function cli(argv) {
  const flags = {}, loose = [];
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) flags[a.slice(2)] = true; else { flags[a.slice(2)] = n; i++; } } else loose.push(a); }
  try {
    if (loose[0] === 'login') return await login({ slug: typeof flags.slug === 'string' ? flags.slug : 'default' });
    if (loose[0] === 'upload') {
      if (!loose[1]) throw new Plain('give the video folder: node video.mjs youtube upload <folder>');
      return await upload(path.resolve(loose[1]), { privacy: typeof flags.privacy === 'string' ? flags.privacy : undefined, yes: Boolean(flags.yes), again: Boolean(flags.again), thumb: !flags['no-thumbnail'], slug: typeof flags.slug === 'string' ? flags.slug : undefined });
    }
    throw new Plain('usage: node video.mjs youtube login  |  youtube upload <folder> [--privacy private|unlisted|public] [--yes] [--again] [--no-thumbnail]');
  } catch (e) { console.error(e instanceof Plain ? e.message : `Unexpected error: ${e?.message || e}`); process.exitCode = 1; }
}
