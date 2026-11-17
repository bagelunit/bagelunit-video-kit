#!/usr/bin/env node
// Tests for licensed material (studio/tools/licensed.mjs and its use in scenes.mjs and checks.mjs): the register (add, list,
// remove, duplicates, path escapes, hash changes), the check, the .cube validator, clip and overlay planning through planOf,
// the music plan, the approval gate and credits block, the shipped template, and a real ffmpeg composite of a tiny generated
// stock clip + overlays + LUT. No network, no key, no browser. Fixtures are generated here; nothing is downloaded.
// Run: node setup/test-licensed.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as L from '../studio/tools/licensed.mjs';
import * as scenes from '../studio/tools/scenes.mjs';
import * as checks from '../studio/tools/checks.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(REPO, 'studio', 'tools', 'video.mjs');
let n = 0, skipped = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'video-licensed-test-'));
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const probe = (f, entries) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1', f], { encoding: 'utf8' }).stdout;

// a channel folder: brand/brand.json with a slug and an empty register
const channel = (slug = 'quark-street') => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'brand', 'licensed'), { recursive: true });
  fs.writeFileSync(path.join(d, 'brand', 'brand.json'), JSON.stringify({ name: 'Quark Street', slug }));
  fs.writeFileSync(path.join(d, 'brand', 'licensed', 'assets.json'), '{"assets":[]}\n');
  return d;
};
const download = (name, bytes = 'not really audio') => { const f = path.join(tmp(), name); fs.writeFileSync(f, bytes); return f; };
const CUBE_INVERT = ['TITLE "invert"', 'LUT_3D_SIZE 2', ...[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${1 - r} ${1 - g} ${1 - b}`)))].join('\n') + '\n';

await test('the template ships an empty register, a README, the type folders and keeps media out of git', () => {
  const t = path.join(REPO, 'template');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t, 'brand', 'licensed', 'assets.json'), 'utf8')), { assets: [] });
  const readme = fs.readFileSync(path.join(t, 'brand', 'licensed', 'README.md'), 'utf8');
  assert.match(readme, /uppbeat\.io/); assert.match(readme, /WAV/); assert.match(readme, /Safelist/); assert.match(readme, /YouTube only/);
  for (const type of L.TYPES) assert.ok(fs.existsSync(path.join(t, 'brand', 'licensed', type, '.gitkeep')), type);
  const gi = fs.readFileSync(path.join(t, '.gitignore'), 'utf8');
  assert.match(gi, /^brand\/licensed\/\*\/\*$/m); assert.match(gi, /^!brand\/licensed\/\*\/\.gitkeep$/m);
  const media = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(wav|mp3|mp4|mov|webm|cube|flac|m4a)$/i.test(e.name)) media.push(p); } };
  walk(t); assert.deepEqual(media, [], 'the template ships no asset files');
});

await test('git ignores licensed media but keeps assets.json, the README and .gitkeep', () => {
  if (spawnSync('git', ['--version']).status !== 0) return;
  const d = tmp(); fs.cpSync(path.join(REPO, 'template'), d, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'brand', 'licensed', 'music', 'a.wav'), 'x'); fs.writeFileSync(path.join(d, 'brand', 'licensed', 'lut', 'a.cube'), 'x');
  const ignored = (f) => spawnSync('git', ['check-ignore', '-q', f], { cwd: d }).status === 0;
  assert.ok(ignored('brand/licensed/music/a.wav')); assert.ok(ignored('brand/licensed/lut/a.cube'));
  assert.ok(!ignored('brand/licensed/assets.json')); assert.ok(!ignored('brand/licensed/README.md')); assert.ok(!ignored('brand/licensed/music/.gitkeep'));
});

await test('add copies the file into brand/licensed/<type>/, hashes it and records it; list and remove work', () => {
  const root = channel(), src = download('Clear Skies.wav', 'bytes of a track');
  const rec = L.addAsset(root, src, { type: 'music', title: 'Clear Skies', artist: 'A. Writer', url: 'https://uppbeat.io/x', source: 'uppbeat', plan: 'business', channels: 'quark-street, other', credit: '' });
  assert.equal(rec.id, 'clear-skies'); assert.equal(rec.file, 'brand/licensed/music/clear-skies.wav'); assert.equal(rec.source, 'uppbeat'); assert.equal(rec.plan, 'business');
  assert.deepEqual(rec.channels, ['quark-street', 'other']);
  assert.ok(fs.existsSync(path.join(root, rec.file)) && fs.existsSync(src), 'copied, the download stays');
  assert.equal(rec.sha256, L.sha256File(src));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, L.REGISTER), 'utf8')).assets.length, 1);
  assert.equal(L.listAssets(root).length, 1); assert.equal(L.listAssets(root, 'sfx').length, 0);
  assert.throws(() => L.listAssets(root, 'poem'), /--type must be one of/);
  const r = L.removeAsset(root, 'clear-skies');
  assert.ok(r.removed && !fs.existsSync(path.join(root, rec.file)) && L.listAssets(root).length === 0);
  assert.throws(() => L.removeAsset(root, 'clear-skies'), /no asset/);
  const moved = download('m.wav'); L.addAsset(root, moved, { type: 'sfx', title: 'Whoosh', move: true });
  assert.ok(!fs.existsSync(moved), '--move takes the download');
});

await test('add refuses a missing file, a duplicate id, a wrong type or extension, a bad id and a missing title', () => {
  const root = channel(), src = download('a.wav');
  assert.throws(() => L.addAsset(root, path.join(os.tmpdir(), 'nope-nothing.wav'), { type: 'music', title: 'x' }), /file not found/);
  assert.throws(() => L.addAsset(root, src, { type: 'poem', title: 'x' }), /--type must be/);
  assert.throws(() => L.addAsset(root, src, { type: 'stock-video', title: 'x' }), /should be/);
  assert.throws(() => L.addAsset(root, src, { type: 'music' }), /--title/);
  assert.throws(() => L.addAsset(root, src, { type: 'music', title: 'x', id: '../../evil' }), /lowercase/);
  const bare = L.addAsset(root, src, { type: 'music', title: 'Dup' });
  assert.equal(bare.source, ''); assert.equal(bare.plan, '', 'no source or plan is assumed');
  assert.equal(L.creditLine(bare), '"Dup"'); assert.equal(L.creditLine({ title: 'T', artist: 'A', url: 'https://x.example/t' }), '"T" by A (https://x.example/t)');
  assert.throws(() => L.addAsset(root, download('b.wav'), { type: 'music', title: 'Dup' }), /already an asset with the id "dup"/);
  assert.equal(L.listAssets(root).length, 1, 'the refused one left no record');
  fs.mkdirSync(path.join(root, 'brand', 'licensed', 'sfx'), { recursive: true }); fs.writeFileSync(path.join(root, 'brand', 'licensed', 'sfx', 'taken.wav'), 'someone else');
  assert.throws(() => L.addAsset(root, download('c.wav'), { type: 'sfx', title: 'Taken' }), /already exists/);
});

await test('paths that leave the channel folder or brand/licensed are refused, also through a link', () => {
  const root = channel();
  for (const bad of ['../outside.wav', 'brand/licensed/../../outside.wav', '/etc/passwd', 'brand/brand.json', 'C:\\Windows\\x.wav', '']) assert.throws(() => L.safePath(root, bad), /outside|absolute|empty/, bad);
  assert.ok(L.safePath(root, 'brand/licensed/music/ok.wav').startsWith(root));
  fs.writeFileSync(path.join(root, 'brand', 'licensed', 'assets.json'), JSON.stringify({ assets: [{ id: 'evil', type: 'music', file: '../../../etc/hosts', sha256: 'x', channels: ['quark-street'] }] }));
  const v = tmp(); fs.writeFileSync(path.join(v, 'video.json'), JSON.stringify({ look: null, music: [{ asset: 'evil' }] }));
  const r = L.check(root, path.join(root, 'v')); assert.ok(r.ok, 'a video that uses nothing passes');
  const vid = path.join(root, 'videos', 'v'); fs.mkdirSync(vid, { recursive: true }); fs.writeFileSync(path.join(vid, 'video.json'), JSON.stringify({ music: [{ asset: 'evil' }] }));
  const c = L.check(root, vid); assert.equal(c.ok, false); assert.match(c.lines[0].text, /outside brand\/licensed/);
  assert.throws(() => L.resolveAsset(root, 'evil', 'music'), /outside/);
  // a record's file can be removed through remove() only when its path is safe
  assert.equal(L.removeAsset(root, 'evil').removed, false);
  if (process.platform !== 'win32') {
    const out = tmp(); fs.writeFileSync(path.join(out, 'secret.wav'), 's');
    fs.symlinkSync(out, path.join(root, 'brand', 'licensed', 'music'));
    assert.throws(() => L.safePath(root, 'brand/licensed/music/secret.wav'), /through a link/);
  }
});

const useInVideo = (root, name, cfg, plan) => {
  const vid = path.join(root, 'videos', name); fs.mkdirSync(path.join(vid, 'out'), { recursive: true }); fs.mkdirSync(path.join(vid, 'build'), { recursive: true });
  fs.writeFileSync(path.join(vid, 'video.json'), JSON.stringify(cfg)); if (plan) fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify(plan));
  return vid;
};

await test('check: no assets is a PASS; a missing record, a missing file, a changed hash, a wrong type and an unlisted channel FAIL; everything right PASSes', () => {
  const root = channel(), vid = useInVideo(root, 'one', { music: [{ asset: 'clear-skies' }] });
  assert.ok(L.check(root, useInVideo(root, 'none', {})).ok);
  let r = L.check(root, vid); assert.equal(r.ok, false); assert.match(r.lines[0].text, /not in brand\/licensed\/assets\.json/);
  L.addAsset(root, download('a.wav', 'track one'), { type: 'music', title: 'Clear Skies' });
  r = L.check(root, vid); assert.equal(r.ok, false); assert.match(r.lines[0].text, /channel "quark-street" is not in its channels/); assert.match(r.lines[0].text, /Safelist/);
  L.setChannels(root, 'clear-skies', 'quark-street');
  r = L.check(root, vid); assert.ok(r.ok, JSON.stringify(r.lines)); assert.match(r.lines[0].text, /hash match/);
  fs.writeFileSync(path.join(root, 'brand', 'licensed', 'music', 'clear-skies.wav'), 'tampered');
  r = L.check(root, vid); assert.equal(r.ok, false); assert.match(r.lines[0].text, /sha256 differs/);
  fs.rmSync(path.join(root, 'brand', 'licensed', 'music', 'clear-skies.wav'));
  r = L.check(root, vid); assert.match(r.lines[0].text, /is missing/);
  const wrong = useInVideo(root, 'wrong', { look: { lut: 'clear-skies' } });
  L.addAsset(root, download('b.wav', 'track two'), { type: 'music', title: 'Other', channels: 'quark-street' });
  assert.match(L.check(root, useInVideo(root, 'wrong2', { look: { lut: 'other' } })).lines[0].text, /it is a music, used as a lut/);
  assert.ok(wrong);
});

await test('check reads every place an asset can be used: look, music, clip, overlay and the vertical variants', () => {
  const root = channel(), vid = useInVideo(root, 'all', { look: { lut: 'l1' }, music: [{ asset: 'm1' }, { asset: 'm2' }] },
    { scenes: [{ template: 't', clip: { asset: 'c1' } }, { template: 't', overlay: { asset: 'o1' }, vertical: { overlay: [{ asset: 'o2' }] } }] });
  assert.deepEqual(L.usedAssets(vid).map((u) => `${u.id}:${u.type}`), ['l1:lut', 'm1:music', 'm2:music', 'c1:stock-video', 'o1:motion-graphic', 'o2:motion-graphic']);
});

await test('video licensed check prints PASS/FAIL lines and exits 1 on a FAIL (the command line)', () => {
  const root = channel(), vid = useInVideo(root, 'cli', { music: [{ asset: 'nope' }] });
  const run = (...a) => spawnSync(process.execPath, [VIDEO, 'licensed', ...a], { cwd: root, encoding: 'utf8' });
  let r = run('check', vid); assert.equal(r.status, 1); assert.match(r.stdout, /^FAIL  nope \(music\[0\]\)/m);
  r = run('add', download('s.wav'), '--type', 'music', '--title', 'Nope', '--channels', 'quark-street'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /recorded nope/);
  r = run('check', vid); assert.equal(r.status, 0); assert.match(r.stdout, /^PASS  nope/m);
  r = run('list'); assert.match(r.stdout, /nope\s+music/);
  r = run('add', path.join(os.tmpdir(), 'no-such-file.wav'), '--type', 'music', '--title', 'x'); assert.equal(r.status, 1); assert.match(r.stderr, /file not found/);
  r = run('remove', 'nope'); assert.equal(r.status, 0); assert.match(r.stdout, /removed nope/);
  assert.equal(spawnSync(process.execPath, [VIDEO, 'licensed', 'list'], { cwd: os.tmpdir(), encoding: 'utf8' }).status, 1, 'outside a channel folder it says so');
});

await test('a LUT must be a real .cube: header, size, domain, row count; the add refuses anything else', () => {
  const f = (text) => { const p = path.join(tmp(), 'x.cube'); fs.writeFileSync(p, text); return p; };
  assert.deepEqual(L.validateCube(f(CUBE_INVERT)), { size: 2, dims: 3, title: 'invert' });
  assert.equal(L.validateCube(f('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n')).dims, 1);
  assert.throws(() => L.validateCube(f('0 0 0\n1 1 1\n')), /before LUT_3D_SIZE/);
  assert.throws(() => L.validateCube(f('TITLE "x"\n')), /no LUT_3D_SIZE/);
  assert.throws(() => L.validateCube(f('LUT_3D_SIZE 1\n0 0 0\n')), /from 2 to 256/);
  assert.throws(() => L.validateCube(f('LUT_3D_SIZE 999\n')), /from 2 to 256/);
  assert.throws(() => L.validateCube(f(CUBE_INVERT.replace(/\n0 0 0\n$/, '\n'))), /has 7/);
  assert.throws(() => L.validateCube(f(CUBE_INVERT.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0'))), /DOMAIN_MIN must be below/);
  assert.throws(() => L.validateCube(f(CUBE_INVERT.replace('1 0 0', '1 zero 0'))), /not three numbers/);
  assert.throws(() => L.validateCube(f('MYSTERY 4\n')), /unknown header/);
  assert.throws(() => L.validateCube(f('\0\0\0')), /binary/);
  const root = channel();
  assert.throws(() => L.addAsset(root, f('this is not a LUT'), { type: 'lut', title: 'Bad' }), /not a usable \.cube/);
  assert.equal(L.listAssets(root).length, 0);
  assert.equal(L.addAsset(root, f(CUBE_INVERT), { type: 'lut', title: 'Invert' }).file, 'brand/licensed/lut/invert.cube');
});

await test('video check notes a missing LUT or clip file (a warning, before the render stops)', () => {
  const root = channel(); L.addAsset(root, download('l.cube', CUBE_INVERT), { type: 'lut', title: 'Warm' });
  const vid = useInVideo(root, 'lutnote', { look: { lut: 'warm' } });
  assert.deepEqual(L.notesFor(vid), []);
  fs.rmSync(path.join(root, 'brand', 'licensed', 'lut', 'warm.cube'));
  assert.match(L.notesFor(vid)[0], /file for "warm" is missing .*the render will stop/);
  assert.match(L.notesFor(useInVideo(root, 'nolut', { look: { lut: 'ghost' } }))[0], /not in brand\/licensed\/assets\.json/);
});

const styleId = scenes.sceneStyleIds()[0], tpl = scenes.styleInfo(styleId)?.templates?.[0];
await test('planOf plans a stock-video clip scene and overlays on any scene (no template needed for the clip)', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify({ scenes: [
    { clip: { asset: 'city', start: 4, duration: 6, mute: true }, narration: 'A city at dusk.' },
    { template: tpl, props: {}, narration: 'Then the light changes.', overlay: { asset: 'leak', blend: 'screen', opacity: 0.6, at: 1.5, duration: 4 } },
    { template: tpl, narration: 'Two.', overlay: [{ asset: 'dust' }, { asset: 'leak', blend: 'normal', opacity: 0.2 }] },
  ] }));
  const { scenes: s } = scenes.planOf(d, styleId);
  assert.equal(s[0].template, null); assert.equal(s[0].id, '01-clip'); assert.deepEqual(s[0].clip, { asset: 'city', start: 4, duration: 6, mute: true });
  assert.deepEqual(s[1].overlays, [{ asset: 'leak', blend: 'screen', opacity: 0.6, at: 1.5, duration: 4 }]);
  assert.deepEqual(s[2].overlays.map((o) => [o.asset, o.blend, o.opacity, o.at, o.duration]), [['dust', 'normal', 1, 0, null], ['leak', 'normal', 0.2, 0, null]]);
  assert.equal(s[0].narration, 'A city at dusk.', 'its time comes from its narration like any scene');
  const bad = (scene, re) => { fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify({ scenes: [scene] })); assert.throws(() => scenes.planOf(d, styleId), re); };
  bad({ clip: { asset: 'x' }, template: tpl }, /no template or code/);
  bad({ clip: { start: 1 } }, /"clip" needs exactly one of "asset"/);
  bad({ clip: { asset: 'x', start: -1 } }, /"start"/);
  bad({ clip: { asset: 'x', duration: 0 } }, /"duration"/);
  bad({ clip: { asset: 'x', mute: false } }, /always muted/);
  bad({ template: tpl, overlay: { asset: 'x', blend: 'multiply' } }, /normal or screen/);
  bad({ template: tpl, overlay: { asset: 'x', opacity: 2 } }, /opacity/);
  bad({ template: tpl, overlay: { asset: 'x', at: -1 } }, /"at"/);
  bad({ template: tpl, overlay: {} }, /"overlay" needs exactly one of/);
});

await test('look: strength defaults to 1 and is checked', () => {
  assert.equal(scenes.lookOf({}), null);
  assert.deepEqual(scenes.lookOf({ look: { lut: 'warm' } }), { lut: 'warm', strength: 1 });
  assert.equal(scenes.lookOf({ look: { lut: 'warm', strength: 0.4 } }).strength, 0.4);
  assert.throws(() => scenes.lookOf({ look: { lut: 'warm', strength: 1.5 } }), /strength/);
  assert.throws(() => scenes.lookOf({ look: 'warm' }), /"look" must be/);
});

await test('the music plan: from a scene id or seconds, fades, gain, cross-fade into the next track, looping a short one', () => {
  const sc = [{ id: 'intro' }, { id: 'middle' }, { id: 'end' }], times = [{ t0: 0 }, { t0: 20 }, { t0: 50 }];
  const lengths = { 'a.wav': 100, 'b.wav': 5 };
  const p = scenes.licensedMusic([{ asset: 'b', from: 'middle', fade: 3, gain_db: -20 }, { asset: 'a' }], { times, scenes: sc, seconds: 80, firstInput: 2, resolve: (id) => `${id}.wav`, lengthOf: (f) => lengths[f] });
  assert.equal(p.count, 2);
  assert.deepEqual(p.inputs, ['-i', 'a.wav', '-stream_loop', '-1', '-i', 'b.wav']);                    // sorted by start; the 5 s track loops
  assert.match(p.graph, /\[2:a\].*atrim=end=23\.000000.*afade=t=out:st=21\.000.*volume=-18dB,adelay=0\|0\[m0\]/);   // a: 0 to 20 + b's 3 s fade
  assert.match(p.graph, /\[3:a\].*atrim=end=60\.000000.*volume=-20dB,adelay=20000\|20000\[m1\]/);
  assert.match(p.graph, /\[m0\]\[m1\]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0\[bed\]/);
  assert.throws(() => scenes.licensedMusic([{ asset: 'a', from: 'nowhere' }], { times, scenes: sc, seconds: 80, resolve: (i) => i, lengthOf: () => 1 }), /not a scene id/);
  assert.throws(() => scenes.licensedMusic([{ asset: 'a', from: 99 }], { times, scenes: sc, seconds: 80, resolve: (i) => i, lengthOf: () => 1 }), /outside the video/);
  assert.throws(() => scenes.licensedMusic([], { times, scenes: sc, seconds: 80 }), /empty list/);
});

// approval: licensed material gates the final approval and is recorded
const finalFolder = (root, name, cfg) => {
  const vid = useInVideo(root, name, { ...cfg, no_research: 'a test' }, null);
  fs.writeFileSync(path.join(vid, 'script.txt'), 'A short test.\n'); fs.writeFileSync(path.join(vid, 'research.md'), '# Research\n');
  fs.writeFileSync(path.join(vid, 'out', 'video.mp4'), 'pretend video bytes'); fs.writeFileSync(path.join(vid, 'out', 'youtube.txt'), 'A title\n\nThe description.\n');
  fs.writeFileSync(path.join(vid, 'build', 'qa.json'), JSON.stringify({ result: 'PASS', sha: checks.sha256File(path.join(vid, 'out', 'video.mp4')), at: 'x' }));
  return vid;
};
await test('video approve final refuses while the licensed check fails, then records the assets and credits', () => {
  const root = channel(), vid = finalFolder(root, 'gate', { music: [{ asset: 'clear-skies' }] });
  checks.recordFacts(vid, { scope: 'final', result: 'PASS', cfg: { no_research: 'a test' } });
  assert.throws(() => checks.approve(vid, 'final'), /licensed assets: not cleared[\s\S]*not in brand\/licensed\/assets\.json/);
  L.addAsset(root, download('a.wav', 'a track'), { type: 'music', title: 'Clear Skies', artist: 'A. Writer', url: 'https://uppbeat.io/t/1', source: 'uppbeat', channels: 'other-channel' });
  assert.throws(() => checks.approve(vid, 'final'), /not in its channels/);
  L.setChannels(root, 'clear-skies', 'quark-street');
  assert.throws(() => checks.approve(vid, 'final'), /credits block .* video licensed credits/);
  // writing the credits changes youtube.txt, so the final fact check is recorded again after it (the order in SKILL.md)
  const block = L.writeCredits(root, vid);
  assert.equal(block, 'Music and assets\n- "Clear Skies" by A. Writer, from Uppbeat (https://uppbeat.io/t/1)');
  assert.equal(fs.readFileSync(path.join(vid, 'out', 'youtube.txt'), 'utf8'), `A title\n\nThe description.\n\n${block}\n`);
  L.writeCredits(root, vid); assert.equal((fs.readFileSync(path.join(vid, 'out', 'youtube.txt'), 'utf8').match(/Music and assets/g) || []).length, 1, 'idempotent');
  checks.recordFacts(vid, { scope: 'final', result: 'PASS', cfg: { no_research: 'a test' } });
  const rec = checks.approve(vid, 'final', { watched: true });
  assert.equal(rec.licensed[0].id, 'clear-skies'); assert.match(rec.licensed[0].credit, /Clear Skies/); assert.equal(rec.licensed[0].sha256, L.listAssets(root)[0].sha256);
  assert.match(fs.readFileSync(path.join(vid, 'approvals.md'), 'utf8'), /licensed assets: clear-skies \(music\)/);
  assert.ok(checks.approvalCurrent(vid, 'final').ok);
  // a video with no licensed asset is untouched by all of this
  const plain = finalFolder(root, 'plain', {}); checks.recordFacts(plain, { scope: 'final', result: 'PASS', cfg: { no_research: 'a test' } });
  assert.equal(checks.approve(plain, 'final').licensed, undefined);
});

await test('credits: a LUT is not credited, a custom credit text wins, the block is removed when nothing needs one', () => {
  const root = channel();
  L.addAsset(root, download('l.cube', CUBE_INVERT), { type: 'lut', title: 'Grade', channels: 'quark-street' });
  L.addAsset(root, download('c.mp4', 'v'), { type: 'stock-video', title: 'City', credit: 'City aerial by Someone via Uppbeat', channels: 'quark-street' });
  const vid = useInVideo(root, 'cr', { look: { lut: 'grade' } }, { scenes: [{ clip: { asset: 'city' } }] });
  fs.writeFileSync(path.join(vid, 'out', 'youtube.txt'), 'T\n\nD.\n');
  assert.equal(L.writeCredits(root, vid), 'Music and assets\n- City aerial by Someone via Uppbeat');
  fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify({ scenes: [{ template: 't' }] }));
  L.writeCredits(root, vid); assert.equal(fs.readFileSync(path.join(vid, 'out', 'youtube.txt'), 'utf8'), 'T\n\nD.\n');
  fs.rmSync(path.join(vid, 'out', 'youtube.txt')); assert.throws(() => L.writeCredits(root, vid), /does not exist yet/);
});

/* ── real ffmpeg: a tiny generated stock clip, overlays and a LUT ───────────────────────────────────────────────────── */
if (!hasFfmpeg) { skipped++; console.log('SKIPPED real ffmpeg composite test: ffmpeg or ffprobe is not installed'); }
else {
  const pixel = (file, t) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'crop=1:1:960:540,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' }); assert.equal(r.status, 0); return [...r.stdout.subarray(0, 3)]; };
  const near = (got, want, tol, what) => assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= tol), `${what}: got ${got}, wanted about ${want}`);

  await test('real ffmpeg: a stock clip fills the 1920x1080 frame in the scene codec, muted, held, with the scene voice under it', () => {
    const root = channel(), work = tmp();
    ff(['-f', 'lavfi', '-i', 'color=c=0x204060:s=320x240:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'stock.mp4')]);     // 4:3, 24 fps, 1 s: wrong shape, rate and length on purpose
    L.addAsset(root, path.join(work, 'stock.mp4'), { type: 'stock-video', title: 'Stock', channels: 'quark-street' });
    ff(['-f', 'lavfi', '-i', 'sine=f=440:d=3', path.join(work, 'vo.wav')]);
    const base = path.join(work, '001'), item = { scene: { n: 1, id: '01-clip', clip: { asset: 'stock', start: 0, duration: null, mute: true } }, time: { frames: 60, t0: 0.5, t1: 2.5 }, base, hash: 'h', audio: 'a' };
    const m = scenes.renderClip(item, path.join(work, 'vo.wav'), root);
    assert.equal(m.frames, 60); assert.ok(m.notes.some((x) => /only 1\.0 s .* held/.test(x)), JSON.stringify(m.notes));
    const info = probe(`${base}.mp4`, 'stream=codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels');
    for (const want of ['codec_name=h264', 'width=1920', 'height=1080', 'r_frame_rate=30/1', 'pix_fmt=yuv420p', 'codec_name=aac', 'sample_rate=48000', 'channels=2']) assert.ok(info.includes(want), `${want} in ${info}`);
    assert.ok(Math.abs(parseFloat(probe(`${base}.mp4`, 'format=duration').split('=')[1]) - 2) < 0.1);
    near(pixel(`${base}.mp4`, 1.8), [32, 64, 96], 14, 'the held last frame still fills the picture');
    assert.ok(JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')).hash === 'h');
  });

  await test('real ffmpeg: overlays composite after the scene render: screen drops black, normal keeps alpha, timing and opacity hold', () => {
    const root = channel(), work = tmp();
    ff(['-f', 'lavfi', '-i', 'color=c=0x204060:s=1920x1080:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=300:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(work, 'scene.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x806040:s=160x90:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'leak.mp4')]);                      // light leak, no alpha: screen
    ff(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=64x64:r=30:d=1,format=rgba', '-c:v', 'qtrle', path.join(work, 'tint.mov')]);                                      // half-transparent red, with alpha
    L.addAsset(root, path.join(work, 'leak.mp4'), { type: 'motion-graphic', title: 'Leak' }); L.addAsset(root, path.join(work, 'tint.mov'), { type: 'motion-graphic', title: 'Tint' });
    const screen = path.join(work, 's.mp4'), normal = path.join(work, 'n.mp4');
    fs.copyFileSync(path.join(work, 'scene.mp4'), screen); fs.copyFileSync(path.join(work, 'scene.mp4'), normal);
    scenes.applyOverlays(screen, [{ asset: 'leak', blend: 'screen', opacity: 1, at: 0.5, duration: 1 }], 2, root);
    near(pixel(screen, 0.2), [32, 64, 96], 12, 'before the overlay');
    near(pixel(screen, 1.0), [144, 136, 136], 14, 'screen of 0x806040 over 0x204060');
    near(pixel(screen, 1.8), [32, 64, 96], 12, 'after the overlay');
    scenes.applyOverlays(normal, [{ asset: 'tint', blend: 'normal', opacity: 1, at: 0.5, duration: 1 }], 2, root);
    near(pixel(normal, 0.2), [32, 64, 96], 12, 'normal: before');
    near(pixel(normal, 1.0), [143, 32, 48], 16, 'normal: the alpha of the .mov is kept (half red over the base)');
    near(pixel(normal, 1.8), [32, 64, 96], 12, 'normal: after');
    for (const f of [screen, normal]) {
      const info = probe(f, 'stream=codec_name,width,height,r_frame_rate');
      for (const want of ['codec_name=h264', 'width=1920', 'height=1080', 'r_frame_rate=30/1', 'codec_name=aac']) assert.ok(info.includes(want), `${want} in ${info}`);
      assert.ok(Math.abs(parseFloat(probe(f, 'format=duration').split('=')[1]) - 2) < 0.1, 'same length as the scene');
    }
    const half = path.join(work, 'h.mp4'); fs.copyFileSync(path.join(work, 'scene.mp4'), half);
    scenes.applyOverlays(half, [{ asset: 'leak', blend: 'screen', opacity: 0.5, at: 0 }], 2, root);
    near(pixel(half, 0.5), [88, 100, 116], 16, 'screen at half opacity is halfway between base and the full screen');
  });

  await test('real ffmpeg: the LUT (a .cube through lut3d) at full and half strength, on the joined picture', () => {
    const work = tmp();
    ff(['-f', 'lavfi', '-i', 'color=c=0x204060:s=640x360:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'joined.mp4')]);
    fs.writeFileSync(path.join(work, 'invert.cube'), CUBE_INVERT);
    const full = path.join(work, 'full.mp4'), half = path.join(work, 'half.mp4'), build = tmp();
    scenes.applyLook(path.join(work, 'joined.mp4'), full, path.join(work, 'invert.cube'), 1, build);
    scenes.applyLook(path.join(work, 'joined.mp4'), half, path.join(work, 'invert.cube'), 0.5, build);
    const px = (f) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-frames:v', '1', '-vf', 'crop=1:1:320:180,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' }); return [...r.stdout.subarray(0, 3)]; };
    near(px(path.join(work, 'joined.mp4')), [32, 64, 96], 10, 'the source');
    near(px(full), [223, 191, 159], 16, 'the inverted LUT at strength 1');
    near(px(half), [128, 128, 128], 16, 'strength 0.5 halfway between the source and the grade');
    assert.ok(probe(full, 'stream=codec_name,width,height,pix_fmt').includes('pix_fmt=yuv420p'));
    assert.ok(fs.existsSync(path.join(build, 'look.cube')), 'the LUT is run from a local copy, so no path needs escaping');
  });

  await test('real ffmpeg: the licensed music graph builds a bed of the video\'s length, delayed, faded and looped', () => {
    const work = tmp();
    ff(['-f', 'lavfi', '-i', 'sine=f=220:d=2', path.join(work, 'a.wav')]); ff(['-f', 'lavfi', '-i', 'sine=f=330:d=30', path.join(work, 'b.wav')]);
    const lens = { [path.join(work, 'a.wav')]: 2, [path.join(work, 'b.wav')]: 30 };
    const plan = scenes.licensedMusic([{ asset: 'a', from: 0, fade: 0.5, gain_db: -12 }, { asset: 'b', from: 3, fade: 1 }], { times: [], scenes: [], seconds: 8, firstInput: 0, resolve: (id) => path.join(work, `${id}.wav`), lengthOf: (f) => lens[f] });
    ff([...plan.inputs, '-filter_complex', plan.graph, '-map', '[bed]', '-t', '8', path.join(work, 'bed.wav')]);
    const d = parseFloat(probe(path.join(work, 'bed.wav'), 'format=duration').split('=')[1]);
    assert.ok(d > 7.5 && d <= 8.1, `the bed is ${d} s`);
    const vol = (t0, t1) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(t0), '-t', String(t1 - t0), '-i', path.join(work, 'bed.wav'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); return parseFloat(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1] ?? '-91'); };
    assert.ok(vol(0.6, 1.6) > -55, 'the first track plays at the start'); assert.ok(vol(5, 7) > -55, 'the second track plays after its start');
  });

  await test('real ffmpeg: video render joins stock-video scenes with overlays, the LUT and licensed music under the voice (no browser needed)', async () => {
    const root = channel(), work = tmp();
    ff(['-f', 'lavfi', '-i', 'color=c=0x204060:s=640x360:r=30:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'stock.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x806040:s=160x90:r=30:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'leak.mp4')]);
    ff(['-f', 'lavfi', '-i', 'sine=f=220:d=30', path.join(work, 'bed.wav')]);
    fs.writeFileSync(path.join(work, 'invert.cube'), CUBE_INVERT);
    const add = (f, type, title) => L.addAsset(root, path.join(work, f), { type, title, channels: 'quark-street' });
    add('stock.mp4', 'stock-video', 'Stock'); add('leak.mp4', 'motion-graphic', 'Leak'); add('bed.wav', 'music', 'Bed'); add('invert.cube', 'lut', 'Invert');
    const text = 'First we look at the city. Then the light changes slowly. And that is all of it.';
    const vid = useInVideo(root, 'e2e', { style: styleId, sfx: 'off', look: { lut: 'invert', strength: 1 }, music: [{ asset: 'bed', from: 0, fade: 1, gain_db: -20 }] },
      { scenes: [
        { id: 'one', clip: { asset: 'stock', start: 0 }, narration: 'First we look at the city.' },
        { id: 'two', clip: { asset: 'stock', start: 1 }, overlay: { asset: 'leak', blend: 'screen', opacity: 0.5, at: 0.5 }, narration: 'Then the light changes slowly.' },
        { id: 'three', clip: { asset: 'stock', start: 2 }, narration: 'And that is all of it.' }] });
    const words = scenes.fakeWords(text, 0.3); scenes.writeWords(vid, words);
    fs.mkdirSync(path.join(vid, 'audio'), { recursive: true });
    ff(['-f', 'lavfi', '-i', `sine=f=300:d=${(words.at(-1).e + 0.4).toFixed(2)}`, path.join(vid, 'audio', 'vo.mp3')]);
    const reel = { dir: vid, cfg: JSON.parse(fs.readFileSync(path.join(vid, 'video.json'), 'utf8')), name: 'e2e' };
    const log = console.log; const lines = []; console.log = (...a) => lines.push(a.join(' '));
    try { await scenes.renderScenes(reel, {}); } finally { console.log = log; }
    const out = path.join(vid, 'build', 'video.mp4'), outText = lines.join('\n');
    assert.ok(fs.existsSync(out), outText); assert.match(outText, /3 scenes: 3 rendered/); assert.match(outText, /look: LUT "invert" at strength 1/);
    const info = probe(out, 'stream=codec_name,width,height');
    for (const want of ['codec_name=h264', 'width=1920', 'height=1080', 'codec_name=aac']) assert.ok(info.includes(want), `${want} in ${info}`);
    const px = (t) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'crop=1:1:960:540,format=rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' }); return [...r.stdout.subarray(0, 3)]; };
    near(px(0.5), [223, 191, 159], 18, 'scene one is the stock clip through the inverted LUT');
    const heard = spawnSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    assert.ok(parseFloat(/mean_volume: (-?[\d.]+)/.exec(heard)[1]) > -40, 'there is sound (voice and bed)');
    // a second render reuses every scene; changing an overlay redraws only that scene
    lines.length = 0; console.log = (...a) => lines.push(a.join(' '));
    try { await scenes.renderScenes(reel, {}); } finally { console.log = log; }
    assert.match(lines.join('\n'), /0 rendered, 3 reused unchanged/);
    fs.writeFileSync(path.join(vid, 'scenes.json'), fs.readFileSync(path.join(vid, 'scenes.json'), 'utf8').replace('"opacity":0.5', '"opacity":0.9'));
    lines.length = 0; console.log = (...a) => lines.push(a.join(' '));
    try { await scenes.renderScenes(reel, {}); } finally { console.log = log; }
    assert.match(lines.join('\n'), /1 rendered, 2 reused unchanged/);
    // the check refuses an approval for it until credits and channel are right
    assert.ok(L.check(root, vid).ok);
  });

  await test('the vertical (Instagram) render refuses licensed clips and overlays, and a "vertical" override clears them', () => {
    const root = channel(), vid = useInVideo(root, 'vert', { style: styleId, look: { lut: 'x' }, music: [{ asset: 'y' }] }, { scenes: [{ clip: { asset: 'stock' }, narration: 'One two three.' }] });
    const script = (extra) => `const s = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href)}); s.setShape('vertical'); try { await s.renderScenes({ dir: ${JSON.stringify(vid.replace(/\\/g, '/'))}, cfg: JSON.parse(${JSON.stringify(JSON.stringify({ style: styleId }))}) }, {}); console.log('RENDERED'); } catch (e) { console.log('ERROR ' + e.message); }`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script()], { encoding: 'utf8' });
    assert.match(r.stdout, /ERROR scene 1 uses licensed material .* YouTube only.*"clip": null/);
    const planned = (scene) => { fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify({ scenes: [scene] })); return scenes.planOf(vid, styleId).scenes[0]; };
    assert.ok(planned({ clip: { asset: 'stock' }, narration: 'x' }).clip, 'wide keeps the clip');
    planned({ clip: { asset: 'stock' }, overlay: { asset: 'leak' }, vertical: { clip: null, overlay: null, template: tpl, props: {} }, narration: 'x' });
    const probeV = `const s = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href)}); s.setShape('vertical'); const p = s.planOf(${JSON.stringify(vid.replace(/\\/g, '/'))}, ${JSON.stringify(styleId)}).scenes[0]; console.log(JSON.stringify({ template: p.template, clip: p.clip || null, overlays: p.overlays || null }));`;
    const o = spawnSync(process.execPath, ['--input-type=module', '-e', probeV], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(o.stdout.trim().split('\n').pop()), { template: tpl, clip: null, overlays: null });
  });
}

console.log(`\n${n} test(s) passed${skipped ? `, ${skipped} SKIPPED (ffmpeg missing)` : ''}`);
