// suggest.mjs · optional outside tools the kit can suggest (never requires). The kit renders everything in code with no outside
// tool; this lists tools that make results better, finds out which ones are connected, and remembers the owner's answers.
//
//   node video.mjs suggest [--channel <folder>] [--json]      the catalog by category, each tool with its status
//   node video.mjs suggest <id|category>                      one tool in detail: what you get, an example, how to connect it
//   node video.mjs suggest --have a,b | --none | --later | --other "text"   record what the owner has (brand/brand.json "tools")
//   node video.mjs suggest --dismiss <id> | --undismiss <id>  stop (or restart) tips about one tool
//
// Detection looks at existence only: a program on PATH or at a known path, a key FILE that exists (its contents are never read
// or printed), a connector named in `claude mcp list` (skipped when the claude command is missing), and the owner's own answer.
// No network, no telemetry; nothing here is sent anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBlender } from './blender.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_FILE = path.join(HERE, '..', 'suggestions.json');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const today = () => new Date().toISOString().slice(0, 10);

export const loadCatalog = () => readJSON(CATALOG_FILE, { version: 1, categories: [] });
export const allTools = (cat = loadCatalog()) => cat.categories.flatMap((c) => c.tools.map((t) => ({ ...t, category: c.id })));

const home = () => os.homedir();
const expand = (p) => String(p).replace(/^~(?=$|[\\/])/, home());

/* ── channel brand.json "tools" ─────────────────────────────────────────────────────────────────────────────────────── */
export function findBrandDir(start) {
  let d = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(d, 'brand', 'brand.json'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}
const brandFile = (dir) => path.join(dir, 'brand', 'brand.json');
export function readTools(dir) {
  const t = (dir && readJSON(brandFile(dir), {}).tools) || {};
  const list = (v) => (Array.isArray(v) ? v.map(String) : []);
  return { have: list(t.have), none: t.none === true, other: list(t.other), dismissed: list(t.dismissed), asked: typeof t.asked === 'string' ? t.asked : '', tips: t.tips !== false };
}
// read, merge into the existing file (other keys kept), write a temp file next to it, then rename: never a half-written brand.json
export function writeTools(dir, patch) {
  const f = brandFile(dir);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  const next = { ...readTools(dir), ...patch };
  cfg.tools = { have: next.have, none: next.none, other: next.other, dismissed: next.dismissed, asked: next.asked, tips: next.tips };
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(tmp, f);
  return cfg.tools;
}

/* ── detection (existence only) ─────────────────────────────────────────────────────────────────────────────────────── */
export function onPath(cmd, env = process.env) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['', ...String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)] : [''];
  for (const d of dirs) for (const e of exts) { try { if (fs.statSync(path.join(d, cmd + e)).isFile()) return true; } catch {} }
  return false;
}
let mcpCache = null;
export function mcpNames() {
  if (mcpCache) return mcpCache;
  if (process.env.BAGELUNIT_SUGGEST_NO_MCP === '1' || !onPath('claude')) return (mcpCache = []);
  const r = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', timeout: 6000, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  const out = r.status === 0 ? String(r.stdout || '') : '';
  // lines look like "name: command - status"; connector names may have spaces ("claude.ai Canva: https://... - connected").
  // a server that failed to connect or needs a sign-in does not count as connected.
  mcpCache = out.split(/\r?\n/).filter((l) => /:\s/.test(l) && !/failed|needs auth/i.test(l)).map((l) => l.split(/:\s/)[0].trim().toLowerCase()).filter(Boolean);
  return mcpCache;
}
export const resetMcpCache = () => { mcpCache = null; };

function registerHas(dir, source) {
  if (!dir) return false;
  const reg = readJSON(path.join(dir, 'brand', 'licensed', 'assets.json'), { assets: [] });
  return (reg.assets || []).some((a) => String(a.source || '').toLowerCase().includes(source));
}
// why a tool counts as connected, or null: 'program', 'app', 'key file', 'connector', 'register'
export function detect(tool, dir) {
  const d = tool.detect || {};
  if (d.command && onPath(d.command)) return 'program';
  if (d.blender) { try { if (findBlender()) return 'program'; } catch {} }
  if (d.file && fs.existsSync(expand(d.file))) return 'key file';
  if (process.env.BAGELUNIT_SUGGEST_NO_PATHS !== '1') for (const p of d.paths || []) if (fs.existsSync(expand(p))) return 'app';   // (the env var is for tests)
  if (d.register_source && registerHas(dir, d.register_source)) return 'register';
  if (d.mcp && mcpNames().some((n) => n.includes(String(d.mcp).toLowerCase()))) return 'connector';
  return null;
}
// every tool with a status: connected (detected or declared), dismissed, or not connected
export function statuses(dir, cat = loadCatalog()) {
  const mine = readTools(dir);
  return Object.fromEntries(allTools(cat).map((t) => {
    const how = detect(t, dir);
    if (how) return [t.id, { status: 'connected', via: how }];
    if (mine.have.includes(t.id)) return [t.id, { status: 'connected', via: 'you said so' }];
    if (mine.dismissed.includes(t.id)) return [t.id, { status: 'dismissed', via: null }];
    return [t.id, { status: 'not connected', via: null }];
  }));
}
export function report(dir) {
  const cat = loadCatalog(), st = statuses(dir, cat);
  return {
    version: cat.version, channel: dir || null, answers: dir ? readTools(dir) : null,
    categories: cat.categories.map((c) => ({ id: c.id, title: c.title, question: c.question, tools: c.tools.map((t) => ({ ...t, ...st[t.id] })) })),
  };
}

/* ── the command ────────────────────────────────────────────────────────────────────────────────────────────────────── */
const oneLine = (s) => { const first = String(s).split(/(?<=[.!?])\s/)[0]; return first.length > 110 ? first.slice(0, 107).trimEnd() + '...' : first; };
const csv = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
const slash = (p) => String(p).split(path.sep).join('/');

function printCatalog(r) {
  console.log('Optional tools. The kit works with none of them (pure code rendering); each one only makes something better.');
  for (const c of r.categories) {
    console.log(`\n${c.title}  (${c.question})`);
    for (const t of c.tools) {
      const mark = t.status === 'connected' ? `connected${t.via ? ` (${t.via})` : ''}` : t.status;
      console.log(`  ${t.id.padEnd(22)} ${mark.padEnd(30)} ${oneLine(t.what_you_get)}`);
    }
  }
  console.log('\nMore on one: video suggest <id>.  Record what you have: video suggest --have a,b | --none | --other "text".  Stop tips about one: video suggest --dismiss <id>.');
  console.log('Nothing is sent anywhere: this only looks at what is on this computer and your answers in brand/brand.json.');
}
function printTool(t, category) {
  console.log(`${t.name}  [${t.id}]  ${category.title}`);
  console.log(`status: ${t.status}${t.via ? ` (${t.via})` : ''}`);
  console.log(`\nWhat you get: ${t.what_you_get}`);
  console.log(`Example: ${t.example}`);
  console.log('\nHow to connect it:');
  t.connect.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  if (t.url) console.log(`\nSite: ${t.url} (check it for current plans and prices)`);
  console.log('Optional. The kit works without it.');
}

export function cli(loose, flags) {
  const cat = loadCatalog(), ids = allTools(cat).map((t) => t.id);
  const channel = typeof flags.channel === 'string' ? findBrandDir(flags.channel) : findBrandDir(process.cwd());
  const need = () => { if (!channel) throw new Error('this records answers in a channel folder (brand/brand.json); open Claude Code in the channel folder, or pass --channel <folder>'); return channel; };
  const known = (list) => { const bad = list.filter((x) => !ids.includes(x)); if (bad.length) throw new Error(`not a tool in the catalog: ${bad.join(', ')}. The ids: ${ids.join(', ')}`); return list; };
  const uniq = (a) => [...new Set(a)];

  if (typeof flags.have === 'string') {
    const have = known(csv(flags.have)), d = need(), cur = readTools(d);
    const t = writeTools(d, { have: uniq(have), none: false, dismissed: cur.dismissed.filter((x) => !have.includes(x)), asked: today() });
    return console.log(`recorded: you have ${t.have.join(', ') || 'none'}${t.other.length ? `; other: ${t.other.join(', ')}` : ''} (brand/brand.json)`);
  }
  if (flags.later === true) {
    const d = need();
    writeTools(d, { asked: today() });
    return console.log('recorded: asked, answer later (brand/brand.json). Run /suggested-tools or video suggest whenever you like.');
  }
  if (flags.none === true) {
    const d = need();
    writeTools(d, { have: [], none: true, asked: today() });
    return console.log('recorded: none of these (brand/brand.json). The kit renders everything in code; ask again any time with video suggest.');
  }
  if (flags.other !== undefined) {
    const d = need(), other = flags.other === true ? [] : uniq(String(flags.other).split(/\s*[;,]\s*/).map((s) => s.trim()).filter(Boolean));
    writeTools(d, { other, asked: today() });
    return console.log(`recorded: other tools ${other.length ? other.join(', ') : '(cleared)'} (brand/brand.json)`);
  }
  if (typeof flags.dismiss === 'string') {
    const id = known([flags.dismiss])[0], d = need(), cur = readTools(d);
    writeTools(d, { dismissed: uniq([...cur.dismissed, id]) });
    return console.log(`dismissed: no more tips about ${id}. Undo: video suggest --undismiss ${id}`);
  }
  if (typeof flags.undismiss === 'string') {
    const id = known([flags.undismiss])[0], d = need(), cur = readTools(d);
    writeTools(d, { dismissed: cur.dismissed.filter((x) => x !== id) });
    return console.log(`tips about ${id} are back on`);
  }
  if (flags.dismiss === true || flags.undismiss === true) throw new Error('say which tool: video suggest --dismiss <id>');

  const r = report(channel);
  const q = loose[0];
  if (q) {
    for (const c of r.categories) {
      if (c.id === q) { if (flags.json) return console.log(JSON.stringify(c, null, 2)); return c.tools.forEach((t, i) => { if (i) console.log('\n----\n'); printTool(t, c); }); }
      const t = c.tools.find((x) => x.id === q);
      if (t) { if (flags.json) return console.log(JSON.stringify(t, null, 2)); return printTool(t, c); }
    }
    throw new Error(`no tool or category "${q}". The ids: ${ids.join(', ')}; categories: ${cat.categories.map((c) => c.id).join(', ')}`);
  }
  if (flags.json) return console.log(JSON.stringify(r, null, 2));
  printCatalog(r);
}

// one paragraph for `video doctor`
export function doctorLines(dir) {
  const cat = loadCatalog(), st = statuses(dir, cat);
  const label = { voice: 'a natural voice', 'music-and-effects': 'music', '3d': '3D', 'generated-video': 'generated shots', design: 'design' };
  const have = allTools(cat).filter((t) => st[t.id].status === 'connected').map((t) => t.name.replace(/ \(.*\)$/, ''));
  const adds = cat.categories.map((c) => {
    const left = c.tools.filter((t) => st[t.id].status !== 'connected' && !t.id.startsWith('other-')).map((t) => t.name.replace(/ \(.*\)$/, ''));
    return left.length && !c.tools.some((t) => st[t.id].status === 'connected') ? `${label[c.id] || c.title} (${left.join(', ')})` : null;
  }).filter(Boolean);
  const out = [`Works without any outside tool: every style, scenes, stand-in voice, thumbnails, captions and QA are drawn in code${have.length ? `; connected: ${have.join(', ')}` : ''}.`];
  if (adds.length) out.push(`Optional upgrades you could add: ${adds.join('; ')}. Details: video suggest`);
  return out;
}
