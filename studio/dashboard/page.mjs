// page.mjs · the video dashboard: one self-contained HTML file (fonts, styles, motion and data inside, no network
// requests, no libraries), drawn from the model in model.mjs. Modelled on the BagelUnit Reel Kit's content dashboard
// and its design notes: paper and a faint grid, heavy capitals, spaced capital labels with square icons, big numbers with
// a short bar in the brand's colour, one navy band (here: the work order), sharp corners, fine lines. Status is never
// colour alone. Sections rise in, numbers count up, the work order's path always moves; all still with reduced motion.
// In five seconds it answers: how am I doing, what needs me, what is next.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEPS, stepIndex } from './model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = fs.readFileSync(path.join(HERE, 'client.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const font = (w) => { try { return `data:font/woff2;base64,${fs.readFileSync(path.join(HERE, 'fonts', `poppins-${w}.woff2`)).toString('base64')}`; } catch { return null; } };
const fontFaces = () => [400, 500, 600, 800].map((w) => [w, font(w)]).filter(([, u]) => u).map(([w, u]) => `@font-face{font-family:'Poppins';font-style:normal;font-weight:${w};font-display:swap;src:url(${u}) format('woff2')}`).join('');

/* ── icons: one line style, 24 px grid ─────────────────────────────────────────────────────────────────────────── */
const ICON = {
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  pen: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3zM14 8l3 3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  up: 'M12 19V5M6 11l6-6 6 6M5 21h14',
  done: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.8 2.8L16 10',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  play: 'M7 4.5v15l12-7.5z',
  disk: 'M4 5h16v14H4zM4 13h16M8 17h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
};
export const STEP_ICON = { research: 'search', map: 'map', script: 'pen', facts: 'check', voice: 'mic', render: 'film', final: 'eye', upload: 'up', done: 'done' };
const icon = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
const label = (name, text) => `<div class="label"><span class="chip">${icon(name)}</span>${esc(text)}</div>`;

/* ── colours that stay readable whatever the brand's accent is (the Reel Kit dashboard's rule) ─────────────────── */
const rgbOf = (hex) => { let h = hex.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); const n = parseInt(h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hexOf = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const stepTo = (base, grounds, target, toward) => { for (let t = 0; t <= 1.0001; t += 0.02) { const c = mixRgb(base, toward, t); if (grounds.every((g) => contrast(c, g) >= target)) return hexOf(c); } return hexOf(toward); };
export function palette(accent) {
  const a = rgbOf(accent), paper = rgbOf('#EFEFEE'), raised = rgbOf('#FBFBFD'), ink = rgbOf('#16121F'), navy = rgbOf('#14142B');
  const soft = mixRgb(raised, a, 0.12);
  return { raw: accent, line: stepTo(a, [paper, raised], 3, ink), text: stepTo(a, [paper, raised, soft], 4.5, ink), onNavy: stepTo(a, [navy, rgbOf('#1C1C3A')], 4.5, raised), soft: hexOf(soft) };
}

/* ── small formatters ──────────────────────────────────────────────────────────────────────────────────────────── */
const fmt = (n) => (n == null ? '-' : Math.round(n).toLocaleString('en'));
const gb = (b) => (b == null ? '-' : b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(b >= 100 * 2 ** 30 ? 0 : 1)} GB` : `${Math.round(b / 2 ** 20)} MB`);
export const minutes = (m) => { if (m == null) return '-'; const s = Math.round(m * 60); const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return h ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`; };
const day = (d) => new Date(`${d}T12:00:00`);
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // today on this computer, not in UTC
const dayText = (d) => day(d).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
export const nextCommand = (v) => (v.step === 'done' ? '' : `/bagelunit-video ${v.slug}`);
const stepOf = (k) => STEPS[stepIndex(k)];

/* ── sections ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function strip(M) {
  const S = M.stats, cr = S.credits;
  const metric = (lab, num, sub, raw = '') => `<div class="metric" data-reveal><div class="mlabel">${esc(lab)}</div><div class="mnum"${raw !== '' ? ` data-count="${raw}"` : ''}>${num}</div><span class="mbar" aria-hidden="true"></span><div class="msub">${sub}</div></div>`;
  const left = cr && Number.isFinite(cr.left) ? cr.left : null;
  return `<div class="strip" role="group" aria-label="The numbers">
${metric('In progress', fmt(S.inProgress), `${M.videos.filter((v) => ['map', 'final', 'upload'].includes(v.step)).length} waiting for you`, S.inProgress)}
${metric('Uploaded', fmt(S.uploaded), S.uploaded ? `${M.videos.filter((v) => v.step === 'done' && v.privacy === 'public').length} public` : 'none yet', S.uploaded)}
${metric('Minutes uploaded', minutes(S.minutes), S.uploaded ? `across ${S.uploaded} video${S.uploaded === 1 ? '' : 's'}` : 'counts from the first upload')}
${metric('Voice characters left', left == null ? '-' : fmt(left), left == null ? 'not checked: <code>video dashboard --credits</code>' : `about ${Math.round(left / 900)} minutes of voice · checked ${esc(cr.at || '')}`, left == null ? '' : left)}
${metric('Disk free', gb(S.free), S.tidyBytes > 50 * 2 ** 20 ? `tidy could free ${gb(S.tidyBytes)}` : 'about 65 MB a minute while a video is built')}
</div>`;
}

function needsYou(M) {
  if (!M.needs.length) return `<p class="empty">Nothing needs you right now.</p>`;
  const word = { now: 'Now', soon: 'Soon', later: 'Later' };
  return `<ol class="needs">${M.needs.map((n, i) => `<li${n.id ? ` data-id="${esc(n.id)}"` : ''}><span class="n">${String(i + 1).padStart(2, '0')}</span><div><div class="nt"><b>${n.id ? `<button class="linkish" data-open="${esc(n.id)}">${esc(n.video)}</button>` : esc(n.video)}</b><span class="prio ${n.prio}">${word[n.prio]}</span></div><div class="nw">${esc(n.text)}</div>${n.id ? `<div class="nref"><code>${esc(nextCommand(M.videos.find((v) => v.id === n.id)))}</code></div>` : ''}</div></li>`).join('')}</ol>`;
}

function comingUp(M) {
  const today = localDay(M.at);
  const items = [];
  for (const v of M.videos) {
    if (v.publishOn && v.step !== 'done') items.push({ date: v.publishOn, v, kind: v.publishOn < today ? 'late' : 'planned' });
    if (v.uploadedAt) items.push({ date: v.uploadedAt, v, kind: 'posted' });
  }
  const future = items.filter((x) => x.kind !== 'posted').sort((a, b) => a.date.localeCompare(b.date));
  const past = items.filter((x) => x.kind === 'posted').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const word = { planned: 'Planned', late: 'Date passed', posted: 'Uploaded' };
  const row = (x) => `<li data-id="${esc(x.v.id)}"><div class="when"><span>${esc(word[x.kind])}</span><b>${esc(dayText(x.date))}</b></div><div class="ag"><i class="sw ${x.kind}" aria-hidden="true"></i><button class="linkish" data-open="${esc(x.v.id)}">${esc(x.v.name)}</button><em>${esc(stepOf(x.v.step).name)}</em></div></li>`;
  if (!future.length && !past.length) return `<p class="empty">No dates yet. A video gets one with <code>"publish_on": "2026-12-01"</code> in its video.json, and an upload adds its own.</p>`;
  return `<ol class="agenda">${[...future, ...past].map(row).join('')}</ol>`;
}

function band(M) {
  const nodes = M.steps.map((s, i) => `<li class="node${s.count ? ' live' : ''}${s.who === 'you' ? ' yours' : ''}" style="--i:${i}" data-step="${s.key}"><span class="nic">${icon(STEP_ICON[s.key])}</span><span class="nname">${esc(s.name)}</span><b class="ncount" data-count="${s.count}">${s.count}</b><span class="nwho">${s.who === 'you' ? 'Your yes' : s.who === 'claude' ? 'Claude' : 'Done'}</span></li>`).join('');
  return `<section class="band" id="work" aria-labelledby="work-title"><div class="wrap">
<div class="band-top" data-reveal><div>${label('loop', 'The work order')}<h2 id="work-title">From topic to upload</h2>
<p class="lead">Every video goes through these steps in order. The number in each box is how many of your videos wait there now. Three steps are yours: nothing is voiced before you approve the map, and nothing is uploaded before you approve the final video.</p></div></div>
<ol class="flow" data-reveal>${nodes}</ol>
</div></section>`;
}

function videoRows(M) {
  if (!M.videos.length) return `<p class="empty">No videos yet. Type <code>/bagelunit-video</code> with a topic to start one.</p>`;
  const sorted = [...M.videos].sort((a, b) => (a.step === 'done') - (b.step === 'done') || stepIndex(b.step) - stepIndex(a.step) || b.changed - a.changed);
  return `<ol class="vlist">${sorted.map((v, i) => {
    const s = stepOf(v.step), yours = s.who === 'you';
    const thumb = v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : `<span class="ph">${icon('film')}</span>`;
    return `<li class="vrow" data-id="${esc(v.id)}" data-step="${v.step}" data-needs="${v.issues.some((x) => x.prio === 'now') ? 1 : 0}" data-find="${esc(`${v.name} ${v.slug} ${v.style}`.toLowerCase())}">
<button class="vopen" data-open="${esc(v.id)}" aria-label="Open ${esc(v.name)}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="vthumb">${thumb}${v.video ? `<span class="pmark">${icon('play')}<span class="sr">has a video</span></span>` : ''}</span>
<span class="vmain"><b>${esc(v.name)}</b><span class="vmeta">${esc(v.style)} · ${esc(v.rel)}</span></span>
<span class="vstep${yours ? ' yours' : ''}${v.step === 'done' ? ' done' : ''}">${icon(STEP_ICON[v.step])}<span>${esc(s.name)}</span><em>${v.step === 'done' ? esc(v.privacy) : yours ? 'your yes' : 'Claude'}</em></span>
<span class="vnum"><b>${esc(minutes(v.minutes))}</b><em>${v.lengthKind === 'estimate' ? 'estimate' : v.lengthKind || ''}</em></span>
<span class="vnum"><b>${v.sources.length}</b><em>sources</em></span></button>
${v.step !== 'done' ? `<div class="vcmd"><code>${esc(nextCommand(v))}</code><button class="copy" data-copy="${esc(nextCommand(v))}">Copy</button></div>` : v.url ? `<div class="vcmd"><a href="${esc(v.url)}" target="_blank" rel="noopener">Watch on YouTube</a></div>` : '<div class="vcmd"></div>'}
</li>`;
  }).join('')}</ol>`;
}

function calendar(M) {
  const now = M.at, y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const ymd = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const today = localDay(now);
  const ev = {};
  for (const v of M.videos) {
    if (v.uploadedAt) (ev[v.uploadedAt] ||= []).push({ v, kind: 'posted' });
    if (v.publishOn && v.step !== 'done') (ev[v.publishOn] ||= []).push({ v, kind: v.publishOn < today ? 'late' : 'planned' });
  }
  const word = { planned: 'planned', late: 'date passed', posted: 'uploaded' };
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="day out" aria-hidden="true"></div>');
  for (let d = 1; d <= days; d++) {
    const k = ymd(d), list = ev[k] || [];
    cells.push(`<div class="day${k === today ? ' today' : ''}"><span class="dn">${d}</span>${list.map((e) => `<button class="ev ${e.kind}" data-open="${esc(e.v.id)}"><i class="sw ${e.kind}" aria-hidden="true"></i>${esc(e.v.name)}<span class="sr"> (${word[e.kind]})</span></button>`).join('')}</div>`);
  }
  return `<div class="cal-head"><b>${esc(first.toLocaleDateString('en', { month: 'long', year: 'numeric' }))}</b><span class="legend"><span><i class="sw planned"></i>Planned</span><span><i class="sw posted"></i>Uploaded</span><span><i class="sw late"></i>Date passed</span></span></div>
<div class="cal" role="grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>`;
}

/* ── the page ──────────────────────────────────────────────────────────────────────────────────────────────────── */
export function html(M) {
  const P = palette(M.accent);
  const data = { steps: STEPS, icons: Object.fromEntries(Object.entries(STEP_ICON).map(([k, n]) => [k, ICON[n]])), play: ICON.play, videos: M.videos.map((v) => ({ ...v, dir: undefined, next: nextCommand(v), len: minutes(v.minutes) })) };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const updated = M.at.toLocaleString('en', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${esc(M.name)} · video dashboard</title>
<style>
${fontFaces()}
:root{
  --accent:${P.line}; --accent-raw:${P.raw}; --accent-text:${P.text}; --accent-soft:${P.soft}; --accent-on-navy:${P.onNavy};
  --accent-glow:color-mix(in oklch, var(--accent-raw) 20%, transparent);
  --paper:#EFEFEE; --raised:#FBFBFD; --sunken:#E8E8E7; --ink:#16121F; --body:#27222F; --mute:#5C5866; --line:#D5D4DB; --line-strong:#858092;
  --navy:#14142B; --navy-raised:#1C1C3A; --navy-line:#3A3350; --navy-body:#E4E1EC; --navy-mute:#B4AFC4;
  --good:#1A7347; --bad:#B42318; --good-on-navy:#74D9A4;
  --ease:cubic-bezier(.16,1,.3,1); --dur:480ms; --step:70ms; --rise:14px;
  --shadow:0 1px 0 rgb(22 18 31 / .04), 0 18px 40px -24px rgb(22 18 31 / .35);
  --sans:'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font:400 15px/1.5 var(--sans);color:var(--body);background:var(--paper);overflow-x:hidden;overflow-wrap:break-word}
.bg{position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(60rem 28rem at 50% -6rem, var(--accent-glow), transparent 70%),linear-gradient(to right, rgb(22 18 31 / .045) 1px, transparent 1px) 0 0/48px 48px,linear-gradient(to bottom, rgb(22 18 31 / .045) 1px, transparent 1px) 0 0/48px 48px}
a{color:var(--accent-text);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
code{font:500 .86em/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--accent-soft);color:var(--ink);padding:.18em .42em;white-space:nowrap}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:1240px;margin:0 auto;padding-inline:28px}
section{padding:44px 0 0}
.label{display:flex;align-items:center;gap:10px;font:600 12px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink)}
.chip{display:grid;place-items:center;width:26px;height:26px;border:1px solid var(--line);background:var(--raised)}
.ic{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.sec-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap}
.sec-head .aside{font-size:13px;color:var(--mute)}
.empty{color:var(--mute);font-size:14px;margin:4px 0}
.linkish{all:unset;cursor:pointer;color:var(--ink);font-weight:600;text-decoration:underline;text-decoration-color:var(--line-strong);text-underline-offset:3px}
.linkish:hover{text-decoration-color:var(--accent)}
.linkish:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* top */
.top{padding-top:34px}
.top .row{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap}
h1{margin:14px 0 0;font:800 clamp(2.1rem,5vw,3.6rem)/.95 var(--sans);letter-spacing:-.02em;text-transform:uppercase;color:var(--ink)}
h1 .dot{color:var(--accent-raw)}
.meta{font-size:13px;color:var(--mute);text-align:right;line-height:1.6}
.meta b{color:var(--ink);font-weight:600}

/* number strip */
.strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:30px;border-top:1px solid var(--line-strong);border-bottom:1px solid var(--line)}
.metric{padding:22px 22px 20px;border-left:1px solid var(--line)}
.metric:first-child{border-left:0;padding-left:0}
.mlabel{font:600 11.5px/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.mnum{font:800 clamp(2rem,3.4vw,2.9rem)/1.05 var(--sans);letter-spacing:-.02em;color:var(--ink);margin-top:12px;font-variant-numeric:tabular-nums}
.mbar{display:block;width:34px;height:3px;background:var(--accent);margin:10px 0;transform-origin:left}
.msub{font-size:12.5px;color:var(--mute)}

/* needs you + coming up */
.split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:40px}
.needs,.agenda{list-style:none;margin:0;padding:0;border-top:1px solid var(--line-strong)}
.needs li{display:grid;grid-template-columns:44px minmax(0,1fr);gap:6px;padding:14px 0;border-bottom:1px solid var(--line)}
.n{font:600 13px/1.6 var(--sans);color:var(--line-strong);letter-spacing:.04em}
.nt{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.nt b{color:var(--ink);font-weight:600;font-size:15px}
.nw{font-size:14px;margin-top:2px}
.nref{font-size:12px;color:var(--mute);margin-top:6px}
.prio{flex:none;font:600 10.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;padding:5px 7px;border:1px solid var(--line-strong);color:var(--mute)}
.prio.now{background:var(--ink);border-color:var(--ink);color:var(--raised)}
.prio.soon{border-color:var(--accent);color:var(--accent-text)}
.agenda li{display:grid;grid-template-columns:96px minmax(0,1fr);gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.when span{display:block;font:600 11px/1.3 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.when b{font:600 14px/1.3 var(--sans);color:var(--ink)}
.ag{display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:baseline;gap:10px;font-size:14px}
.ag em{font-style:normal;font-size:12px;color:var(--mute)}
.sw{width:10px;height:10px;display:inline-block;transform:translateY(1px);background:var(--line)}
.sw.posted{background:color-mix(in oklch, var(--good) 55%, var(--raised))}.sw.planned{background:var(--accent)}.sw.late{background:transparent;border:1.5px dashed var(--bad)}

/* the work order: the navy band */
.band{margin-top:56px;background:var(--navy);color:var(--navy-body);padding:56px 0 60px;position:relative;overflow:hidden}
.band::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(40rem 22rem at 18% 30%, color-mix(in oklch, var(--accent-raw) 22%, transparent), transparent 70%),linear-gradient(to right, rgb(251 251 253 / .045) 1px, transparent 1px) 0 0/48px 48px,linear-gradient(to bottom, rgb(251 251 253 / .045) 1px, transparent 1px) 0 0/48px 48px}
.band .wrap{position:relative}
.band .label{color:var(--navy-body)} .band .chip{background:var(--navy-raised);border-color:var(--navy-line)}
h2{margin:16px 0 14px;font:800 clamp(1.8rem,3.6vw,2.7rem)/1 var(--sans);letter-spacing:-.01em;text-transform:uppercase;color:var(--ink)}
.band h2{color:var(--raised)}
.band p.lead{max-width:62ch;color:var(--navy-mute);margin:0}
.flow{list-style:none;margin:36px 0 0;padding:0;display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:22px}
.node{position:relative;background:var(--navy-raised);border:1px solid var(--navy-line);padding:14px 12px 12px;display:grid;gap:6px;min-height:132px;animation:breathe 4.8s var(--ease) infinite;animation-delay:calc(var(--i) * 280ms)}
.node::before,.node::after{content:"";position:absolute;width:9px;height:9px;border:0 solid var(--navy-mute)}
.node::before{top:-1px;left:-1px;border-top-width:1.5px;border-left-width:1.5px}
.node::after{bottom:-1px;right:-1px;border-bottom-width:1.5px;border-right-width:1.5px}
.node:not(:last-child) .nic::after{content:"";position:absolute;top:28px;right:-23px;width:22px;height:2px;background:radial-gradient(circle, var(--accent-on-navy) 1.2px, transparent 1.8px) 0 50%/7px 2px repeat-x;animation:travel 900ms linear infinite}
.node.live{border-color:var(--accent-on-navy)}
.node.yours .nwho{color:var(--accent-on-navy)}
.nic{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--navy-line);color:var(--raised)}
.nname{font:600 11px/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--navy-body)}
.ncount{font:800 34px/1 var(--sans);color:var(--raised);font-variant-numeric:tabular-nums}
.node:not(.live) .ncount{color:var(--navy-mute)}
.nwho{font-size:11.5px;color:var(--navy-mute)}
@keyframes travel{to{background-position:7px 50%}}
@keyframes breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}

/* every video */
.tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.find{display:flex;align-items:center;gap:8px;border:1px solid var(--line-strong);background:var(--raised);padding:0 10px;height:36px}
.find input{border:0;background:none;font:400 14px var(--sans);color:var(--ink);width:180px;outline:none}
.toggle,.sel{height:36px;border:1px solid var(--line-strong);background:var(--raised);font:500 13px var(--sans);color:var(--ink);padding:0 12px;cursor:pointer}
.toggle[aria-pressed="true"]{background:var(--ink);color:var(--raised);border-color:var(--ink)}
.vlist{list-style:none;margin:0;padding:0;border-top:1px solid var(--line-strong)}
.vrow{display:grid;grid-template-columns:minmax(0,1fr) 300px;align-items:center;border-bottom:1px solid var(--line);transition:background 200ms var(--ease)}
.vrow:hover,.vrow.is-hl{background:color-mix(in oklch, var(--raised) 70%, transparent)}
.vrow.is-dim{display:none}
.vopen{all:unset;cursor:pointer;display:grid;grid-template-columns:36px 112px minmax(0,1fr) 150px 70px 60px;gap:14px;align-items:center;padding:12px 0}
.vopen:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.vthumb{position:relative;width:112px;aspect-ratio:16/9;background:var(--sunken);border:1px solid var(--line);display:grid;place-items:center;overflow:hidden;color:var(--line-strong)}
.vthumb img{width:100%;height:100%;object-fit:cover;display:block}
.vthumb .ph .ic{width:22px;height:22px}
.pmark{position:absolute;right:4px;bottom:4px;width:20px;height:20px;display:grid;place-items:center;background:var(--ink);color:var(--raised)}
.pmark .ic{width:11px;height:11px;fill:currentColor;stroke:none}
.vmain b{display:block;color:var(--ink);font-weight:600;font-size:15px;line-height:1.3}
.vmeta{display:block;font-size:12px;color:var(--mute);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vstep{display:grid;grid-template-columns:18px auto;column-gap:8px;align-items:center;font:600 13px/1.25 var(--sans);color:var(--ink)}
.vstep em{grid-column:2;font:500 11px/1.2 var(--sans);font-style:normal;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.vstep.yours em{color:var(--accent-text)}
.vstep.done .ic{color:var(--good)}
.vnum b{display:block;font:600 15px/1.2 var(--sans);color:var(--ink);font-variant-numeric:tabular-nums}
.vnum em{font-style:normal;font-size:11px;color:var(--mute)}
.vcmd{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding-left:12px;font-size:13px}
.vcmd code{overflow:hidden;text-overflow:ellipsis;max-width:200px}
.copy{border:1px solid var(--line-strong);background:var(--raised);font:600 11px var(--sans);letter-spacing:.06em;text-transform:uppercase;padding:6px 9px;cursor:pointer;color:var(--ink);transition:transform 160ms var(--ease)}
.copy:hover{transform:translateY(-1px)} .copy.done{background:var(--ink);color:var(--raised)}

/* calendar */
.cal-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.cal-head b{font:800 18px var(--sans);text-transform:uppercase;color:var(--ink)}
.legend{display:flex;gap:16px;font-size:12.5px;color:var(--mute)} .legend span{display:flex;gap:6px;align-items:center}
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border-top:1px solid var(--line-strong);border-left:1px solid var(--line)}
.dow{font:600 11px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--mute);padding:10px 8px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.day{min-height:92px;padding:6px 8px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:color-mix(in oklch, var(--raised) 55%, transparent)}
.day.out{background:transparent}
.day.today{outline:2px solid var(--accent);outline-offset:-2px}
.dn{font:600 12px var(--sans);color:var(--mute)}
.day.today .dn{color:var(--accent-text)}
.ev{all:unset;cursor:pointer;display:flex;gap:6px;align-items:baseline;font-size:12px;line-height:1.3;color:var(--ink);margin-top:4px}
.ev:focus-visible{outline:2px solid var(--accent)}

/* the video card */
dialog.card{border:0;padding:0;margin:0 0 0 auto;width:min(620px,100vw);height:100dvh;max-height:none;background:var(--raised);color:var(--body);box-shadow:var(--shadow)}
dialog.card::backdrop{background:rgb(22 18 31 / .38)}
.card-in{padding:26px 28px 40px}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.card-top h3{margin:10px 0 4px;font:800 26px/1.05 var(--sans);text-transform:uppercase;color:var(--ink)}
.close{border:1px solid var(--line-strong);background:var(--raised);width:36px;height:36px;cursor:pointer;font:500 20px/1 var(--sans);color:var(--ink)}
.card video,.card .cthumb{width:100%;aspect-ratio:16/9;background:#000;display:block;margin-top:18px;object-fit:contain}
.card h4{margin:24px 0 8px;font:600 11.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink)}
.csteps{list-style:none;margin:0;padding:0;border-top:1px solid var(--line-strong)}
.csteps li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
.csteps .mk{width:18px;height:18px;border:1.5px solid var(--line-strong);display:grid;place-items:center}
.csteps li.done .mk{background:var(--ink);border-color:var(--ink);color:var(--raised)}
.csteps li.now .mk{border:2px dashed var(--accent)}
.csteps li.now b{color:var(--accent-text)}
.csteps .mk .ic{width:12px;height:12px}
.csteps em{font-style:normal;font-size:12px;color:var(--mute)}
.kv{margin:0;padding:0;list-style:none;font-size:13.5px}
.kv li{padding:6px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;justify-content:space-between}
.kv li span:first-child{color:var(--mute)}
.st{font:600 10.5px/1 var(--sans);letter-spacing:.08em;padding:4px 6px;border:1px solid var(--line-strong)}
.st.PASS{border-color:var(--good);color:var(--good)} .st.FAIL{border-color:var(--bad);color:var(--bad)} .st.WARN{border-style:dashed}
.next{margin-top:18px;padding:14px;border:1px solid var(--line-strong);background:var(--accent-soft)}
.next p{margin:0 0 8px;font-size:14px;color:var(--ink)}

footer{margin:64px 0 0;padding:24px 0 48px;border-top:1px solid var(--line);font-size:12.5px;color:var(--mute)}

/* motion */
@media (prefers-reduced-motion: no-preference){
  .js [data-reveal]{opacity:0;transform:translateY(var(--rise))}
  .js [data-reveal].in{opacity:1;transform:none;transition:opacity var(--dur) var(--ease),transform var(--dur) var(--ease);transition-delay:calc(var(--d, 0) * var(--step))}
  .js .in .mbar{animation:grow 600ms var(--ease) both}
  @keyframes grow{from{transform:scaleX(0)}}
}
@media (prefers-reduced-motion: reduce){ .node,.node .nic::after{animation:none!important} }

@media (max-width:1100px){ .flow{grid-template-columns:repeat(5,minmax(0,1fr))} .node:nth-child(5n) .nic::after{display:none} }
@media (max-width:980px){
  .strip{grid-template-columns:repeat(3,minmax(0,1fr))} .metric:nth-child(4){border-left:0;padding-left:0}
  .split{grid-template-columns:1fr}
  .vrow{grid-template-columns:1fr} .vcmd{justify-content:flex-start;padding:0 0 12px 50px}
  .vopen{grid-template-columns:36px 96px minmax(0,1fr) 120px} .vopen .vnum{display:none} .vthumb{width:96px}
}
@media (max-width:640px){
  .wrap{padding-inline:18px}
  .strip{grid-template-columns:repeat(2,minmax(0,1fr))} .metric{padding:16px 14px 14px} .metric:nth-child(odd){border-left:0;padding-left:0} .metric:nth-child(4){border-left:1px solid var(--line);padding-left:14px}
  .flow{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px} .node{min-height:112px} .node .nic::after{display:none}
  .vopen{grid-template-columns:30px 72px minmax(0,1fr);row-gap:6px} .vthumb{width:72px} .vstep{grid-column:3} .vcmd{padding-left:44px}
  .day{min-height:64px;padding:4px} .ev{font-size:0} .ev .sw{width:12px;height:12px}
  .find input{width:130px}
  .meta{text-align:left}
}
.meta a.rev{color:inherit;text-decoration:underline;text-underline-offset:3px}
</style></head>
<body class="nojs"><div class="bg" aria-hidden="true"></div>
<header class="wrap top" data-reveal><div class="row"><div>${label('film', 'Video dashboard')}<h1>${esc(M.name)}<span class="dot">.</span></h1></div>
<div class="meta">Updated <b>${esc(updated)}</b><br>${M.videos.length} video${M.videos.length === 1 ? '' : 's'}${M.brand ? ` · brand <b>${esc(M.brand.name)}</b>` : ''}${M.review ? `<br><a class="rev" href="${esc(encodeURI(M.review.href))}" title="${esc(M.review.headline)}">Channel review ${esc(M.review.date)}</a>` : ''}</div></div>
${strip(M)}</header>

<section class="wrap split" aria-label="What needs you and what is next">
<div data-reveal><div class="sec-head">${label('bell', 'Needs you')}<span class="aside">${M.needs.filter((n) => n.prio === 'now').length} now</span></div>${needsYou(M)}</div>
<div data-reveal><div class="sec-head">${label('cal', 'Coming up')}</div>${comingUp(M)}</div>
</section>

${band(M)}

<section class="wrap" id="videos" aria-labelledby="videos-title">
<div class="sec-head" data-reveal><div>${label('grid', 'Every video')}<h2 id="videos-title">Your videos</h2></div>
<div class="tools"><label class="find">${icon('search')}<span class="sr">Find a video</span><input id="find" type="search" placeholder="Find a video"></label>
<button class="toggle" id="needs-only" aria-pressed="false">Needs you</button>
<label><span class="sr">Step</span><select class="sel" id="step-filter"><option value="">Every step</option>${STEPS.map((s) => `<option value="${s.key}">${esc(s.name)}</option>`).join('')}</select></label></div></div>
<div data-reveal>${videoRows(M)}</div>
</section>

<section class="wrap" id="calendar" aria-labelledby="cal-title">
<div class="sec-head" data-reveal>${label('cal', 'Calendar')}</div><h2 id="cal-title" class="sr">Calendar</h2>
<div data-reveal>${calendar(M)}</div>
</section>

<footer class="wrap">Drawn by <code>video dashboard</code> from the video folders under ${esc(M.root)}. Nothing on this page changes a video: steps come from the approvals and checks, and each card shows the command for the next one. Lengths marked "estimate" are the script's words at 150 a minute. Voice characters are read from ElevenLabs only when you ask (<code>video dashboard --credits</code>).</footer>

<dialog class="card" id="card" aria-labelledby="card-title"><div class="card-in" id="card-in"></div></dialog>
<script id="dash-data" type="application/json">${json}</script>
<script>${CLIENT}</script>
</body></html>`;
}
