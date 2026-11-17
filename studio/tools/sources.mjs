// sources.mjs · `video sources <folder>`: protects a video's sources.
//
//   node video.mjs sources <video folder> [--no-archive] [--no-doi]
//
// 1. DOI check: every DOI in research.md, script.txt, outline.md, out/youtube.txt and factcheck-5x.md (those that exist)
//    is looked up at Crossref (api.crossref.org, free, no key; DataCite is tried when Crossref does not know it). A DOI
//    that does not resolve is an error. Each DOI's real title, first author and year are listed, so a wrong DOI pasted on
//    the right claim is easy to spot.
// 2. Archive: every public http(s) link in research.md and out/youtube.txt is checked at the Wayback Machine; a link with
//    no snapshot from the last 30 days is sent to Save Page Now, so a source that later moves or disappears can still be
//    read. Only public URLs are sent (never localhost, private addresses, or links with a password or key in them).
// Writes source-safety.md and source-safety.json in the video folder. Exit code 1 when any DOI fails.
// The requests carry a polite User-Agent with no personal details; set BAGELUNIT_CONTACT (an address or a URL) to add one
// yourself, which Crossref's "polite pool" likes. The network calls take a fetch and a sleep so the tests run offline.
import fs from 'node:fs';
import path from 'node:path';

export const SOURCE_FILES = ['research.md', 'script.txt', 'outline.md', 'out/youtube.txt', 'factcheck-5x.md'];
export const LINK_FILES = ['research.md', 'out/youtube.txt'];
export const userAgent = (env = process.env) => `BagelUnitVideoKit/1.1 (source check; +https://github.com/bagelunit/bagelunit-video-kit${env.BAGELUNIT_CONTACT ? `; ${env.BAGELUNIT_CONTACT}` : ''})`;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };

// DOIs may contain balanced brackets, e.g. 10.1016/0017-9310(77)90057-6; drop trailing punctuation and an unbalanced ')'
const doiTidy = (d) => { for (;;) { const t = d.replace(/[.,;:]+$/, ''); if (t.endsWith(')') && (t.match(/\(/g) || []).length < (t.match(/\)/g) || []).length) { d = t.slice(0, -1); continue; } return t; } };
export function findDois(text) {
  const all = [...new Set([...String(text).matchAll(/\b(10\.\d{4,9}\/[^\s"'<>\],;*`]+)/g)].map((m) => doiTidy(m[1])))];
  // a checker's note may quote a cut-off DOI: skip any that is only the start of a longer one found here
  return all.filter((d) => !all.some((o) => o !== d && o.startsWith(d)));
}

// keep brackets that belong to the URL (e.g. .../SOLAS-(1974).aspx); drop trailing punctuation and an unbalanced ')'
const urlTidy = (u) => { u = u.replace(/[.,;:'"]+$/, ''); while (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) u = u.slice(0, -1); return u.replace(/[.,;:]+$/, ''); };
export function isPublicUrl(u) {
  let x; try { x = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(x.protocol) || x.username || x.password) return false;
  const h = x.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)|^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '::1' || /^(fc|fd|fe80)/.test(h)) return false;
  if (/[?&](key|token|api_key|apikey|access_token|password|secret|sig|signature)=/i.test(x.search)) return false;
  return true;
}
export function findLinks(text) {
  return [...new Set([...String(text).matchAll(/https?:\/\/[^\s"'<>\]]+/g)].map((m) => urlTidy(m[0])))]
    .filter((u) => !/web\.archive\.org/.test(u) && isPublicUrl(u));
}

// GET json, with retries: a 429 waits as long as the server says (up to 30 s), a 5xx or a dropped connection waits longer each time
export async function getJSON(url, { fetchImpl = fetch, sleep = defaultSleep, tries = 3, ua = userAgent() } = {}) {
  let status = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': ua, Accept: 'application/json' } });
      status = r.status;
      if (r.status === 404) return { status: 404 };
      if (r.ok) { try { return { status: r.status, json: await r.json() }; } catch { return { status: r.status }; } }
      const wait = Number(r.headers?.get?.('retry-after'));
      if (i < tries - 1) await sleep(r.status === 429 && wait > 0 ? Math.min(wait, 30) * 1000 : 1500 * (i + 1));
    } catch { if (i < tries - 1) await sleep(1500 * (i + 1)); }
  }
  return { status };
}

async function lookupDoi(doi, io) {
  const r = await getJSON(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, io);
  let m = r.json?.message;
  let source = 'Crossref';
  if (!m) {   // not a Crossref DOI: datasets and some reports are registered with DataCite
    const d = (await getJSON(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, io)).json?.data?.attributes;
    if (d) {
      source = 'DataCite';
      m = { title: [d.titles?.[0]?.title || ''], author: d.creators?.[0] ? [{ family: d.creators[0].familyName || d.creators[0].name || '' }] : [], issued: { 'date-parts': [[d.publicationYear || null]] }, 'container-title': [d.publisher?.name || d.publisher || ''] };
    }
  }
  if (!m) return { doi, ok: false, why: r.status === 404 ? 'not found at Crossref or DataCite (check the DOI)' : 'Crossref did not answer (run again later)' };
  return { doi, ok: true, source, title: (m.title || [''])[0], first_author: m.author?.[0] ? `${m.author[0].family || m.author[0].name || ''}` : '', year: m.issued?.['date-parts']?.[0]?.[0] || null, journal: (m['container-title'] || [''])[0] };
}

async function archiveLink(url, io, now) {
  const a = await getJSON(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, io);
  const snap = a.json?.archived_snapshots?.closest;
  const ts = snap?.timestamp ? Date.UTC(+snap.timestamp.slice(0, 4), +snap.timestamp.slice(4, 6) - 1, +snap.timestamp.slice(6, 8)) : 0;
  if (snap?.available && ts > now - 30 * 864e5) return { url, archived: snap.url, saved_now: false };
  let saved = null;
  try {
    const r = await io.fetchImpl(`https://web.archive.org/save/${url}`, { headers: { 'User-Agent': io.ua }, redirect: 'manual' });
    const loc = r.headers?.get?.('content-location') || r.headers?.get?.('location');
    if (loc) saved = loc.startsWith('http') ? loc : `https://web.archive.org${loc}`;
    else if (r.ok) saved = `https://web.archive.org/web/${url}`;
  } catch {}
  return { url, archived: saved || snap?.url || null, saved_now: Boolean(saved), note: saved ? '' : 'not archived (Save Page Now refused or rate-limited; run again later)' };
}

export async function checkSources(dir, { noArchive = false, noDoi = false, fetchImpl = fetch, sleep = defaultSleep, now = Date.now(), pace = { doi: 300, save: 5000 }, log = console.log } = {}) {
  dir = path.resolve(dir);
  const io = { fetchImpl, sleep, ua: userAgent() };
  const report = { folder: dir, at: new Date(now).toISOString(), dois: [], links: [] };
  if (!noDoi) {
    for (const doi of findDois(SOURCE_FILES.map((f) => read(dir, f)).join('\n'))) { report.dois.push(await lookupDoi(doi, io)); await sleep(pace.doi); }
  }
  if (!noArchive) {
    for (const url of findLinks(LINK_FILES.map((f) => read(dir, f)).join('\n'))) { report.links.push(await archiveLink(url, io, now)); await sleep(pace.save); }   // Save Page Now asks anonymous users to go slowly
  }
  const bad = report.dois.filter((d) => !d.ok), got = report.links.filter((l) => l.archived).length;
  const md = [`# Source safety for ${path.basename(dir)}`, '', `Checked ${report.at}.`, '',
    `## DOIs (${report.dois.length}, ${bad.length} failed)`, '',
    ...report.dois.map((d) => d.ok ? `- OK ${d.doi}: ${d.first_author} (${d.year}), "${d.title}", ${d.journal}` : `- FAIL ${d.doi}: ${d.why}`),
    '', `## Archived links (${got} of ${report.links.length})`, '',
    ...report.links.map((l) => `- ${l.archived ? 'OK' : 'NOT YET'} ${l.url}${l.archived ? ` -> ${l.archived}` : ` (${l.note})`}`), ''].join('\n');
  fs.writeFileSync(path.join(dir, 'source-safety.md'), md);
  fs.writeFileSync(path.join(dir, 'source-safety.json'), JSON.stringify(report, null, 1) + '\n');
  log(`sources: ${report.dois.length} DOIs (${bad.length} failed), ${report.links.length} links (${got} archived) -> source-safety.md`);
  for (const d of report.dois) log(d.ok ? `  DOI ok    ${d.doi}: ${d.first_author} (${d.year}), "${d.title}"  <- is this the paper the claim means?` : `  DOI FAIL  ${d.doi}: ${d.why}`);
  return { ...report, failed: bad.length };
}

export async function cli(video, flags) {
  const r = await checkSources(video.dir, { noArchive: Boolean(flags['no-archive']), noDoi: Boolean(flags['no-doi']) });
  if (r.failed) process.exitCode = 1;
}
