#!/usr/bin/env node
// Tests for the optional-tool suggestions (studio/suggestions.json, studio/tools/suggest.mjs, studio/tools/tips.mjs, the verb
// `video suggest`, the tips and the doctor section). A fake HOME, a fake PATH with a fake `claude`, fake key files: no network,
// no key, no ffmpeg, no browser, no Blender. Run: node setup/test-suggest.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(REPO, 'studio', 'tools', 'video.mjs');
const S = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'suggest.mjs')).href);
const T = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'tips.mjs')).href);
const win = process.platform === 'win32';
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'video-suggest-test-')));
const EM = String.fromCharCode(8212);
const SECRET = 'FAKE-KEY-CONTENT-123456';

// a fake HOME (with or without the ElevenLabs key file), a fake PATH folder (with or without `claude`, with or without a `blender`)
function world({ key = false, mcp = null, blender = false } = {}) {
  const home = tmp(), bin = tmp();
  if (key) { fs.mkdirSync(path.join(home, '.config', 'bagelunit-reels'), { recursive: true }); fs.writeFileSync(path.join(home, '.config', 'bagelunit-reels', 'elevenlabs.key'), SECRET + '\n'); }
  if (mcp) {
    if (win) fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n${mcp.map((l) => `echo ${l}`).join('\r\n')}\r\n`);
    else { fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\n${mcp.map((l) => `echo '${l}'`).join('\n')}\n`); fs.chmodSync(path.join(bin, 'claude'), 0o755); }
  }
  if (blender) { const f = path.join(bin, win ? 'blender.cmd' : 'blender'); fs.writeFileSync(f, win ? '@echo off\r\n' : '#!/bin/sh\n'); fs.chmodSync(f, 0o755); }
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: bin, BAGELUNIT_BLENDER_PATHS: '', BAGELUNIT_SUGGEST_NO_PATHS: '1', BAGELUNIT_NO_TIPS: '', BAGELUNIT_REEL_ENGINE: path.join(home, 'no-engine') };
  if (win) { delete env.Path; env.SystemRoot = process.env.SystemRoot; }
  return { home, bin, env };
}
// run code in this process with that world's HOME and PATH
async function within(w, fn) {
  const keep = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PATH: process.env.PATH, B: process.env.BAGELUNIT_BLENDER_PATHS, P: process.env.BAGELUNIT_SUGGEST_NO_PATHS };
  Object.assign(process.env, { HOME: w.home, USERPROFILE: w.home, PATH: w.bin, BAGELUNIT_BLENDER_PATHS: '', BAGELUNIT_SUGGEST_NO_PATHS: '1' });
  S.resetMcpCache();
  try { return await fn(); } finally {
    Object.assign(process.env, { HOME: keep.HOME, USERPROFILE: keep.USERPROFILE, PATH: keep.PATH });
    if (keep.B === undefined) delete process.env.BAGELUNIT_BLENDER_PATHS; else process.env.BAGELUNIT_BLENDER_PATHS = keep.B;
    if (keep.P === undefined) delete process.env.BAGELUNIT_SUGGEST_NO_PATHS; else process.env.BAGELUNIT_SUGGEST_NO_PATHS = keep.P;
    S.resetMcpCache();
  }
}
const channel = (extra = {}) => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'brand', 'licensed'), { recursive: true });
  fs.writeFileSync(path.join(d, 'brand', 'brand.json'), JSON.stringify({ name: 'Quark Street', slug: 'quark-street', niche: { topic: 'physics' }, ...extra }, null, 2));
  fs.writeFileSync(path.join(d, 'brand', 'licensed', 'assets.json'), '{"assets":[]}\n');
  return d;
};
const video = (w, cwd, args) => spawnSync(process.execPath, [VIDEO, ...args], { cwd, env: w.env, encoding: 'utf8' });
const brandJson = (d) => JSON.parse(fs.readFileSync(path.join(d, 'brand', 'brand.json'), 'utf8'));
const status = (rep, id) => rep.categories.flatMap((c) => c.tools).find((t) => t.id === id).status;
const catalogIds = () => S.allTools().map((t) => t.id);

await test('the catalog has the agreed shape, categories and tools', () => {
  const cat = JSON.parse(fs.readFileSync(path.join(REPO, 'studio', 'suggestions.json'), 'utf8'));
  assert.equal(cat.version, 1);
  assert.deepEqual(cat.categories.map((c) => c.id), ['voice', 'music-and-effects', '3d', 'generated-video', 'design']);
  const ids = new Set();
  for (const c of cat.categories) {
    assert.ok(c.title && c.question && c.tools.length, c.id);
    for (const t of c.tools) {
      for (const k of ['id', 'name', 'what_you_get', 'example', 'connect', 'kind', 'detect', 'url', 'tips']) assert.ok(k in t, `${t.id || '?'} has ${k}`);
      assert.ok(['download', 'key', 'mcp', 'app'].includes(t.kind), `${t.id} kind`);
      assert.ok(Array.isArray(t.connect) && t.connect.length >= 1 && Array.isArray(t.tips));
      assert.ok(!ids.has(t.id), `duplicate id ${t.id}`); ids.add(t.id);
    }
  }
  for (const id of ['elevenlabs', 'uppbeat', 'epidemic-sound', 'blender', 'higgsfield', 'canva', 'adobe-firefly', 'adobe-connector']) assert.ok(ids.has(id), id);
  const text = fs.readFileSync(path.join(REPO, 'studio', 'suggestions.json'), 'utf8');
  assert.ok(!text.includes(EM), 'no em dashes');
  assert.ok(!/[$£€]\s?\d/.test(text), 'no prices');
  const by = (id) => cat.categories.flatMap((c) => c.tools).find((t) => t.id === id);
  assert.match(by('higgsfield').example, /5 second establishing shot of a 1900s factory floor/);
  assert.match(by('canva').example, /video thumbnail --image/);
  assert.match(by('blender').example, /shaded-relief map/);
  assert.match(by('uppbeat').example, /per chapter/);
  assert.match(by('elevenlabs').example, /15 minute episode/);
});

await test('every tip entry names catalog tools that list its step', () => {
  const byId = Object.fromEntries(S.allTools().map((t) => [t.id, t]));
  for (const [stage, entries] of Object.entries(T.STAGES)) for (const e of entries) {
    assert.ok(e.tools.includes(e.primary));
    assert.ok(e.text.startsWith('Tip: ') && !e.text.includes('\n') && e.text.length < 200, e.text);
    for (const id of e.tools) { assert.ok(byId[id], `${stage}: ${id}`); }
    assert.ok(byId[e.primary].tips.includes(stage), `${e.primary} lists ${stage}`);
  }
  for (const stage of ['new', 'thumbnail', 'render', 'voice', 'upload']) assert.ok(stage in T.STAGES, stage);
  for (const t of S.allTools()) for (const s of t.tips) assert.ok(s in T.STAGES, `${t.id} tip step ${s}`);
});

await test('detection: key file existence, never its contents', async () => {
  const yes = world({ key: true }), no = world();
  const ch = channel();
  const a = await within(yes, () => S.report(ch)), b = await within(no, () => S.report(ch));
  assert.equal(status(a, 'elevenlabs'), 'connected');
  assert.equal(status(b, 'elevenlabs'), 'not connected');
  assert.ok(!JSON.stringify(a).includes(SECRET));
});

await test('detection: connectors named in `claude mcp list` (a failed one does not count); no claude is skipped quietly', async () => {
  const w = world({ mcp: ['Checking MCP server health...', 'claude.ai Canva: https://mcp.example/canva - Connected', 'blender: uvx blender-mcp - Connected', 'higgsfield: https://mcp.example/h - Failed to connect'] });
  const rep = await within(w, () => S.report(null));
  assert.equal(status(rep, 'canva'), 'connected');
  assert.equal(rep.categories.flatMap((c) => c.tools).find((t) => t.id === 'canva').via, 'connector');
  assert.equal(status(rep, 'blender'), 'connected');
  assert.equal(status(rep, 'higgsfield'), 'not connected');
  assert.equal(status(rep, 'epidemic-sound'), 'not connected');
  const none = await within(world(), () => S.report(null));      // no claude on PATH
  assert.equal(status(none, 'canva'), 'not connected');
});

await test('detection: a program on PATH, a licensed register entry, and the owner\'s own answer', async () => {
  const ch = channel();
  assert.equal(status(await within(world({ blender: true }), () => S.report(ch)), 'blender'), 'connected');
  assert.equal(status(await within(world(), () => S.report(ch)), 'blender'), 'not connected');
  fs.writeFileSync(path.join(ch, 'brand', 'licensed', 'assets.json'), JSON.stringify({ assets: [{ id: 'a', source: 'Uppbeat' }] }));
  assert.equal(status(await within(world(), () => S.report(ch)), 'uppbeat'), 'connected');
  const ch2 = channel({ tools: { have: ['canva'] } });
  const rep = await within(world(), () => S.report(ch2));
  assert.equal(status(rep, 'canva'), 'connected');
  assert.equal(rep.categories.flatMap((c) => c.tools).find((t) => t.id === 'canva').via, 'you said so');
});

await test('video suggest: catalog, detail, --json shape', () => {
  const w = world({ key: true }), ch = channel();
  const list = video(w, ch, ['suggest']);
  assert.equal(list.status, 0, list.stderr);
  for (const c of ['Voice', 'Music and sound effects', '3D', 'Generated video', 'Design']) assert.ok(list.stdout.includes(c), c);
  assert.match(list.stdout, /elevenlabs\s+connected/);
  assert.match(list.stdout, /canva\s+not connected/);
  assert.match(list.stdout, /works with none of them|none of them/i);
  const one = video(w, ch, ['suggest', 'higgsfield']);
  assert.equal(one.status, 0);
  assert.match(one.stdout, /What you get:/); assert.match(one.stdout, /1900s factory floor/); assert.match(one.stdout, /How to connect it:/);
  const j = JSON.parse(video(w, ch, ['suggest', '--json']).stdout);
  assert.equal(j.version, 1);
  assert.equal(j.categories.length, 5);
  for (const c of j.categories) for (const t of c.tools) { assert.ok(['connected', 'not connected', 'dismissed'].includes(t.status)); assert.ok(t.id && t.name && t.example && t.connect); }
  assert.deepEqual(Object.keys(j.answers).sort(), ['asked', 'dismissed', 'have', 'none', 'other', 'tips']);
  const bad = video(w, ch, ['suggest', 'nope']);
  assert.equal(bad.status, 1); assert.match(bad.stderr, /no tool or category/);
  // a category id shows all its tools
  assert.match(video(w, ch, ['suggest', 'design']).stdout, /Adobe connector for Claude/);
});

await test('video suggest never prints the key file\'s contents (list, detail, json, doctor)', () => {
  const w = world({ key: true }), ch = channel();
  for (const args of [['suggest'], ['suggest', 'elevenlabs'], ['suggest', '--json'], ['doctor']]) {
    const r = video(w, ch, args);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET), args.join(' '));
  }
});

await test('recording answers: --have, --none, --other merge into brand.json and keep its other keys', () => {
  const w = world(), ch = channel({ custom: { keep: [1, 2] } });
  let r = video(w, ch, ['suggest', '--have', 'canva,blender']);
  assert.equal(r.status, 0, r.stderr);
  let b = brandJson(ch);
  assert.deepEqual(b.tools.have, ['canva', 'blender']); assert.equal(b.tools.none, false); assert.match(b.tools.asked, /^\d{4}-\d\d-\d\d$/); assert.equal(b.tools.tips, true);
  assert.deepEqual(b.custom, { keep: [1, 2] }); assert.equal(b.name, 'Quark Street');
  r = video(w, ch, ['suggest', '--other', 'Pika; Suno']);
  b = brandJson(ch); assert.deepEqual(b.tools.other, ['Pika', 'Suno']); assert.deepEqual(b.tools.have, ['canva', 'blender']);
  r = video(w, ch, ['suggest', '--none']);
  b = brandJson(ch); assert.equal(b.tools.none, true); assert.deepEqual(b.tools.have, []); assert.deepEqual(b.tools.other, ['Pika', 'Suno']);
  r = video(w, ch, ['suggest', '--have', 'elevenlabs,nonsense']);
  assert.equal(r.status, 1); assert.match(r.stderr, /not a tool in the catalog: nonsense/);
  assert.deepEqual(brandJson(ch).tools.have, []);          // a refused answer changes nothing
  assert.deepEqual(fs.readdirSync(path.join(ch, 'brand')).filter((f) => f.includes('.tmp-')), [], 'no temp file left');
});

await test('--dismiss and --undismiss; a dismissed tool shows as dismissed; declaring it again clears the dismissal', () => {
  const w = world(), ch = channel();
  assert.equal(video(w, ch, ['suggest', '--dismiss', 'canva']).status, 0);
  assert.deepEqual(brandJson(ch).tools.dismissed, ['canva']);
  assert.equal(status(JSON.parse(video(w, ch, ['suggest', '--json']).stdout), 'canva'), 'dismissed');
  assert.equal(video(w, ch, ['suggest', '--undismiss', 'canva']).status, 0);
  assert.deepEqual(brandJson(ch).tools.dismissed, []);
  video(w, ch, ['suggest', '--dismiss', 'higgsfield']);
  video(w, ch, ['suggest', '--have', 'higgsfield']);
  assert.deepEqual(brandJson(ch).tools.dismissed, []);
  assert.equal(video(w, ch, ['suggest', '--dismiss', 'zzz']).status, 1);
});

await test('recording outside a channel folder is refused with the way out; listing still works', () => {
  const w = world(), bare = tmp();
  const r = video(w, bare, ['suggest', '--none']);
  assert.equal(r.status, 1); assert.match(r.stderr, /channel folder/);
  assert.equal(video(w, bare, ['suggest']).status, 0);
  assert.equal(video(w, bare, ['suggest', '--channel', channel()]).status, 0);
});

await test('tips: one line, the right words, once per tool per 7 days, written to brand/.tips.json', async () => {
  const w = world(), ch = channel(), lines = [], t0 = Date.parse('2026-11-17T10:00:00Z');
  const run = (stage, now, extra = {}) => within(w, () => T.tip(stage, { dir: ch, now, out: (l) => lines.push(l), env: {}, ...extra }));
  assert.equal(await run('thumbnail', t0), 'canva');
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'Tip: Canva or Adobe Firefly could design this thumbnail (video suggest canva). Dismiss: video suggest --dismiss canva');
  assert.ok(JSON.parse(fs.readFileSync(path.join(ch, 'brand', '.tips.json'), 'utf8')).canva);
  // the same stage again: canva is resting, so the next entry (blender) speaks: still ONE tip per command
  assert.equal(await run('thumbnail', t0 + 3600e3), 'blender'); assert.equal(lines.length, 2);
  assert.equal(await run('thumbnail', t0 + 7200e3), null); assert.equal(lines.length, 2);   // both rest
  assert.equal(await run('thumbnail', t0 + 6 * 86400e3), null);
  assert.equal(await run('thumbnail', t0 + 8 * 86400e3), 'canva');                          // after 7 days it may speak again
  assert.equal(lines.length, 3);
  assert.equal(await run('upload', t0), null);                                              // no tip at the upload
});

await test('tips: every hook step has a tip when nothing is connected', async () => {
  const w = world();
  for (const stage of ['new', 'thumbnail', 'render', 'voice']) {
    const ch = channel(), lines = [];
    await within(w, () => T.tip(stage, { dir: ch, out: (l) => lines.push(l), env: {} }));
    assert.equal(lines.length, 1, stage);
    assert.match(lines[0], /^Tip: .* Dismiss: video suggest --dismiss [a-z-]+$/, stage);
  }
});

await test('tips: silent when connected, declared, dismissed, switched off (env, flag, brand.json) or outside a channel', async () => {
  const w = world({ key: true, blender: true });
  const lines = [], out = (l) => lines.push(l);
  const tip = (stage, ch, extra = {}) => within(w, () => T.tip(stage, { dir: ch, out, env: {}, ...extra }));
  assert.equal(await tip('voice', channel()), null);                                       // elevenlabs connected (key file)
  assert.equal(await tip('new', channel()), 'higgsfield');                                 // blender connected, the next one speaks
  assert.equal(await tip('new', channel({ tools: { have: ['higgsfield'] } })), null);      // declared
  assert.equal(await tip('new', channel({ tools: { dismissed: ['higgsfield'] } })), null); // dismissed
  assert.equal(await tip('new', channel({ tools: { tips: false } })), null);               // brand.json
  assert.equal(await tip('new', channel(), { env: { BAGELUNIT_NO_TIPS: '1' } }), null);     // env
  assert.equal(await tip('new', channel(), { flags: { 'no-tips': true } }), null);          // flag
  assert.equal(await tip('new', tmp()), null);                                              // no channel to remember in
  assert.equal(lines.length, 1);
});

await test('tips on the real command: stderr only, stdout and exit code unchanged, off with the switches', () => {
  const w = world(), ch = channel();
  const ids = fs.readdirSync(path.join(REPO, 'studio', 'styles')).filter((f) => fs.existsSync(path.join(REPO, 'studio', 'styles', f, 'templates.json')));
  assert.ok(ids.length, 'a style to make a folder from');
  const r1 = video(w, ch, ['new', 'ep1', '--style', ids[0]]);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stderr, /^Tip: .*Dismiss: video suggest --dismiss /m);
  assert.ok(!r1.stdout.includes('Tip:'), 'stdout has no tip');
  assert.equal(r1.stderr.split(/\r?\n/).filter((l) => l.startsWith('Tip:')).length, 1, 'one tip');
  const r2 = video(w, ch, ['new', 'ep2', '--style', ids[0]]);                                 // the same tool rests for 7 days
  assert.ok(!/Blender/.test(r2.stderr), r2.stderr);                                            // blender rests; at most one other tip speaks
  assert.ok(r2.stderr.split(/\r?\n/).filter((l) => l.startsWith('Tip:')).length <= 1);
  const r3 = video(w, channel(), ['new', 'ep3', '--style', ids[0], '--no-tips']);
  assert.equal(r3.status, 0); assert.ok(!r3.stderr.includes('Tip:'));
  const r4 = video({ ...w, env: { ...w.env, BAGELUNIT_NO_TIPS: '1' } }, channel(), ['new', 'ep4', '--style', ids[0]]);
  assert.ok(!r4.stderr.includes('Tip:'));
  assert.match(r1.stdout, /^new /); assert.match(r3.stdout, /^new /);
});

await test('video doctor has the "works without any outside tool" section', () => {
  const w = world({ key: true }), ch = channel();
  const r = video(w, ch, ['doctor']);
  assert.match(r.stdout, /Works without any outside tool:/);
  assert.match(r.stdout, /Optional upgrades you could add:.*music.*Uppbeat/);
  assert.match(r.stdout, /connected: ElevenLabs/);
  assert.ok(!r.stdout.includes('a natural voice'), 'a connected area is not offered again');
});

await test('the kit text: no em dashes in the new files; skill, CLAUDE.md and docs mention the feature', () => {
  const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8').replace(/\r\n/g, '\n');
  for (const f of [['studio', 'tools', 'suggest.mjs'], ['studio', 'tools', 'tips.mjs'], ['template', '.claude', 'skills', 'suggested-tools', 'SKILL.md']]) assert.ok(!read(...f).includes(EM), f.join('/'));
  const skill = read('template', '.claude', 'skills', 'suggested-tools', 'SKILL.md');
  assert.match(skill, /^---\nname: suggested-tools\n/);
  assert.match(skill, /AskUserQuestion/); assert.match(skill, /video suggest --json/); assert.match(skill, /I have none of these/); assert.match(skill, /Save these answers \(Recommended\)/);
  assert.match(read('template', 'CLAUDE.md'), /suggested-tools/);
  assert.match(read('template', '.claude', 'skills', 'channel-setup', 'SKILL.md'), /suggested-tools/);
  assert.match(read('COMMANDS.md'), /video suggest/);
  assert.match(read('studio', 'SKILL.md'), /video suggest/);
  assert.ok(Object.keys(JSON.parse(read('template', 'brand', 'brand.json'))).includes('tools'), 'the template brand.json has the tools block');
});

console.log(`\n${n} tests run${process.exitCode ? ', with failures' : ', all passed'}`);
