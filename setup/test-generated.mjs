#!/usr/bin/env node
// Tests for generated shots in the licensed register (studio/tools/licensed.mjs): the types generated-image and generated-video, their
// fields (generated, tool, prompt, onscreen_label, no_label_reason, vertical_ok), the refusals, the on-screen label gate on the final
// approval (with no override), the SKIPPED path, the credits and approval text, the vertical rule, the template folders and git.
// No network, no key, no browser, no ffmpeg. Fixtures are generated here. Run: node setup/test-generated.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as L from '../studio/tools/licensed.mjs';
import * as checks from '../studio/tools/checks.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(REPO, 'studio', 'tools', 'video.mjs');
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'video-generated-test-'));
const channel = (slug = 'quark-street') => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'brand', 'licensed'), { recursive: true });
  fs.writeFileSync(path.join(d, 'brand', 'brand.json'), JSON.stringify({ name: 'Quark Street', slug }));
  fs.writeFileSync(path.join(d, 'brand', 'licensed', 'assets.json'), '{"assets":[]}\n');
  return d;
};
const download = (name, bytes = 'pretend media') => { const f = path.join(tmp(), name); fs.writeFileSync(f, bytes); return f; };
const useInVideo = (root, name, cfg, plan) => {
  const vid = path.join(root, 'videos', name); fs.mkdirSync(path.join(vid, 'out'), { recursive: true }); fs.mkdirSync(path.join(vid, 'build'), { recursive: true });
  fs.writeFileSync(path.join(vid, 'video.json'), JSON.stringify(cfg)); if (plan) fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify(plan));
  return vid;
};
const finalFolder = (root, name, cfg, plan) => {
  const vid = useInVideo(root, name, { ...cfg, no_research: 'a test' }, plan);
  fs.writeFileSync(path.join(vid, 'script.txt'), 'A short test.\n'); fs.writeFileSync(path.join(vid, 'research.md'), '# Research\n');
  fs.writeFileSync(path.join(vid, 'out', 'video.mp4'), 'pretend video bytes'); fs.writeFileSync(path.join(vid, 'out', 'youtube.txt'), 'A title\n\nThe description.\n');
  fs.writeFileSync(path.join(vid, 'build', 'qa.json'), JSON.stringify({ result: 'PASS', sha: checks.sha256File(path.join(vid, 'out', 'video.mp4')), at: 'x' }));
  return vid;
};
const facts = (vid) => checks.recordFacts(vid, { scope: 'final', result: 'PASS', cfg: { no_research: 'a test' } });
const cli = (cwd, ...args) => spawnSync(process.execPath, [VIDEO, ...args], { cwd, encoding: 'utf8' });
const readText = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

// no network at all: a fetch or a socket in this run is a failure
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('the network must not be used'); };

await test('the types, their extensions and the template folders exist', () => {
  assert.ok(L.TYPES.includes('generated-image') && L.TYPES.includes('generated-video'));
  assert.deepEqual(L.GENERATED, ['generated-image', 'generated-video']);
  assert.deepEqual(L.DEFAULT_LABEL, { 'generated-video': 'Re-creation', 'generated-image': 'AI-generated' });
  assert.ok(L.EXTENSIONS['generated-video'].includes('.mp4') && L.EXTENSIONS['generated-image'].includes('.png'));
  for (const t of L.GENERATED) assert.ok(fs.existsSync(path.join(REPO, 'template', 'brand', 'licensed', t, '.gitkeep')), t);
  const src = fs.readFileSync(path.join(REPO, 'studio', 'tools', 'licensed.mjs'), 'utf8');
  assert.ok(!/node:(https?|net|dns)|fetch\(/.test(src), 'licensed.mjs never touches the network');
});

await test('add records a generated video with generated, tool, prompt and the default label; an image gets its own default', () => {
  const root = channel();
  const v = L.addAsset(root, download('shot.mp4'), { type: 'generated-video', tool: 'Higgsfield', prompt: 'a lighthouse at dusk' });
  assert.equal(v.id, 'shot'); assert.equal(v.title, 'shot', 'the title defaults to the file name');
  assert.equal(v.generated, true); assert.equal(v.tool, 'Higgsfield'); assert.equal(v.prompt, 'a lighthouse at dusk'); assert.equal(v.onscreen_label, 'Re-creation');
  assert.equal(v.no_label_reason, undefined); assert.equal(v.vertical_ok, undefined);
  assert.equal(v.file, 'brand/licensed/generated-video/shot.mp4'); assert.ok(fs.existsSync(path.join(root, v.file)));
  const i = L.addAsset(root, download('map.png'), { type: 'generated-image', tool: 'Firefly', title: 'A map' });
  assert.equal(i.onscreen_label, 'AI-generated'); assert.equal(i.id, 'a-map');
  const c = L.addAsset(root, download('c.mp4'), { type: 'generated-video', tool: 'X', onscreenLabel: 'AI re-creation of the scene', id: 'custom' });
  assert.equal(c.onscreen_label, 'AI re-creation of the scene');
  const reg = JSON.parse(fs.readFileSync(path.join(root, L.REGISTER), 'utf8'));
  assert.equal(reg.assets.length, 3); assert.equal(L.listAssets(root, 'generated-image').length, 1);
});

await test('refusals: no --tool, a wrong extension, an empty label without a reason, both label options, flags on a licensed type', () => {
  const root = channel(), f = download('a.mp4');
  assert.throws(() => L.addAsset(root, f, { type: 'generated-video' }), /needs --tool/);
  assert.throws(() => L.addAsset(root, f, { type: 'generated-video', tool: '  ' }), /needs --tool/);
  assert.throws(() => L.addAsset(root, download('a.wav'), { type: 'generated-video', tool: 'X' }), /should be/);
  assert.throws(() => L.addAsset(root, f, { type: 'generated-video', tool: 'X', onscreenLabel: '' }), /only allowed with --no-label/);
  assert.throws(() => L.addAsset(root, f, { type: 'generated-video', tool: 'X', onscreenLabel: '   ' }), /only allowed with --no-label/);
  assert.throws(() => L.addAsset(root, f, { type: 'generated-video', tool: 'X', noLabel: true }), /needs the reason/);
  assert.throws(() => L.addAsset(root, f, { type: 'generated-video', tool: 'X', noLabel: '  ' }), /needs the reason/);
  assert.throws(() => L.addAsset(root, f, { type: 'generated-video', tool: 'X', noLabel: 'why', onscreenLabel: 'Both' }), /either/);
  assert.throws(() => L.addAsset(root, f, { type: 'stock-video', title: 'S', tool: 'X' }), /are for generated-image and generated-video/);
  assert.throws(() => L.addAsset(root, f, { type: 'stock-video', title: 'S', verticalOk: true }), /are for generated-image and generated-video/);
  assert.equal(L.listAssets(root).length, 0, 'nothing was recorded by a refused add');
  assert.equal(fs.readdirSync(path.join(root, 'brand', 'licensed')).filter((x) => x.startsWith('generated')).length, 0, 'and nothing was copied');
});

await test('an empty label with a reason is recorded as no_label_reason; --vertical-ok is recorded', () => {
  const root = channel();
  const r = L.addAsset(root, download('plain.png'), { type: 'generated-image', tool: 'Canva', onscreenLabel: '', noLabel: 'an abstract texture, nothing that looks real', verticalOk: true });
  assert.equal(r.onscreen_label, ''); assert.equal(r.no_label_reason, 'an abstract texture, nothing that looks real'); assert.equal(r.vertical_ok, true);
  assert.equal(L.verticalOk(root, 'plain'), true); assert.equal(L.verticalOk(root, 'nope'), false);
  L.addAsset(root, download('b.mp4'), { type: 'generated-video', tool: 'X' });
  assert.equal(L.verticalOk(root, 'b'), false, 'YouTube only unless recorded');
  L.addAsset(root, download('s.mp4'), { type: 'stock-video', title: 'Stock' });
  assert.equal(L.verticalOk(root, 'stock'), false, 'licensed material is never allowed in the vertical version');
});

await test('the command line: add (label, no label, vertical-ok), list, and the refusals exit 1', () => {
  const root = channel(), f = download('cli.mp4');
  let r = cli(root, 'licensed', 'add', f, '--type', 'generated-video');
  assert.equal(r.status, 1); assert.match(r.stderr + r.stdout, /needs --tool/);
  r = cli(root, 'licensed', 'add', f, '--type', 'generated-video', '--tool', 'Higgsfield', '--prompt', 'a bridge');
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /recorded cli \(generated-video\)/); assert.match(r.stdout, /\[generated with Higgsfield; on-screen label "Re-creation"\]/);
  assert.match(r.stdout, /YouTube only/);
  r = cli(root, 'licensed', 'add', download('x.png'), '--type', 'generated-image', '--tool', 'Firefly', '--onscreen-label', '', '--id', 'x');
  assert.equal(r.status, 1); assert.match(r.stderr + r.stdout, /only allowed with --no-label/);
  r = cli(root, 'licensed', 'add', download('x.png'), '--type', 'generated-image', '--tool', 'Firefly', '--onscreen-label', '', '--no-label', 'abstract texture', '--id', 'x', '--vertical-ok');
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /no on-screen label: abstract texture/); assert.match(r.stdout, /allowed in the vertical version/);
  r = cli(root, 'licensed', 'list');
  assert.match(r.stdout, /cli\s+generated-video\s+cli .*\[generated with Higgsfield; on-screen label "Re-creation"\] \[YouTube only\]/);
  assert.match(r.stdout, /generated-image .*no on-screen label: abstract texture\] \[vertical ok\]/);
  const reg = JSON.parse(readText(path.join(root, L.REGISTER)));
  assert.equal(reg.assets.find((a) => a.id === 'x').vertical_ok, true);
});

await test('a clip takes a generated-video, an overlay takes either generated type, a clip refuses a generated image', () => {
  const root = channel();
  L.addAsset(root, download('gv.mp4'), { type: 'generated-video', tool: 'X' }); L.addAsset(root, download('gi.png'), { type: 'generated-image', tool: 'X' });
  L.addAsset(root, download('st.mp4'), { type: 'stock-video', title: 'St' }); L.addAsset(root, download('mg.mov'), { type: 'motion-graphic', title: 'Mg' });
  assert.ok(L.resolveAsset(root, 'gv', 'stock-video').abs.endsWith('gv.mp4'), 'a generated video fills a clip');
  assert.ok(L.resolveAsset(root, 'gv', 'motion-graphic') && L.resolveAsset(root, 'gi', 'motion-graphic'), 'either generated type is an overlay');
  assert.throws(() => L.resolveAsset(root, 'gi', 'stock-video'), /is a generated-image, but it is used as a stock-video/);
  assert.throws(() => L.resolveAsset(root, 'mg', 'stock-video'), /is a motion-graphic, but it is used as a stock-video/);
  assert.throws(() => L.resolveAsset(root, 'gv', 'music'), /is a generated-video, but it is used as a music/);
  const vid = useInVideo(root, 'use', {}, { scenes: [{ clip: { asset: 'gv' } }, { template: 't', overlay: [{ asset: 'gi' }, { asset: 'gv' }] }, { clip: { asset: 'gi' } }] });
  const r = L.check(root, vid);
  assert.ok(!r.ok); const bad = r.lines.filter((l) => l.status === 'FAIL');
  assert.match(bad.map((l) => l.text).join('\n'), /gi \(scene 3 clip\): it is a generated-image, used as a stock-video/);
});

await test('check: a generated asset needs no channel safelist; hash and file are still checked; list shows it', () => {
  const root = channel('other-channel'), vid = useInVideo(root, 'v', {}, { scenes: [{ clip: { asset: 'gv' }, narration: 'x' }, { template: 't', props: { title: 'Re-creation' } }] });
  const rec = L.addAsset(root, download('gv.mp4', 'bytes'), { type: 'generated-video', tool: 'Higgsfield' });
  let r = L.check(root, vid);
  assert.ok(r.ok, JSON.stringify(r.lines)); assert.match(r.lines[0].text, /\[generated with Higgsfield; on-screen label "Re-creation"\]/); assert.ok(!/channel .* listed/.test(r.lines[0].text));
  fs.appendFileSync(path.join(root, rec.file), 'tampered');
  r = L.check(root, vid); assert.ok(!r.ok); assert.match(r.lines.find((l) => l.status === 'FAIL').text, /sha256 differs/);
});

await test('the label gate: the label must be in the on-screen text; the text may come from build/on_screen_text.txt or the scene props', () => {
  const root = channel();
  L.addAsset(root, download('gv.mp4'), { type: 'generated-video', tool: 'Higgsfield' });
  const plan = (props) => ({ scenes: [{ clip: { asset: 'gv' }, narration: 'a clip' }, { template: 't', props, narration: 'drawn' }] });
  let vid = useInVideo(root, 'no', {}, plan({ title: 'The harbour' }));
  let r = L.check(root, vid);
  assert.equal(r.ok, false); assert.match(r.lines.find((l) => l.status === 'FAIL').text, /must show the text "Re-creation" on screen, but it is not in the scene props in scenes\.json/);
  vid = useInVideo(root, 'yes', {}, plan({ title: 'The harbour', badge: { text: 'RE-CREATION: not real footage' } }));
  r = L.check(root, vid); assert.ok(r.ok); assert.ok(r.lines.some((l) => l.status === 'PASS' && /shows its label "Re-creation" on screen/.test(l.text)));
  // text in a clip scene's own props is not drawn, so it does not count
  vid = useInVideo(root, 'clipprops', {}, { scenes: [{ clip: { asset: 'gv' }, props: { t: 'Re-creation' } }] });
  assert.equal(L.check(root, vid).ok, false);
  // the engine's own text file wins when there is one
  fs.writeFileSync(path.join(vid, 'build', 'on_screen_text.txt'), 'Chapter one\nRe-creation\n');
  r = L.check(root, vid); assert.ok(r.ok); assert.match(r.lines.find((l) => /shows its label/.test(l.text)).text, /build\/on_screen_text\.txt/);
  // a label that is a different language or punctuation is compared by words
  L.addAsset(root, download('gi.png'), { type: 'generated-image', tool: 'Firefly', onscreenLabel: 'AI-generated image' });
  vid = useInVideo(root, 'punct', {}, { scenes: [{ template: 't', props: { s: 'ai generated image, see notes' } }, { template: 't', overlay: { asset: 'gi' } }] });
  assert.ok(L.check(root, vid).ok);
});

await test('SKIPPED: no readable text means the label was not checked, said plainly, never a PASS', () => {
  const root = channel();
  L.addAsset(root, download('gv.mp4'), { type: 'generated-video', tool: 'Higgsfield' });
  const vid = useInVideo(root, 'skip', {}, null);
  fs.writeFileSync(path.join(vid, 'video.json'), JSON.stringify({ music: [] }));
  // the video uses the asset (an overlay) but has no scenes.json to read: write one that cannot be read as scenes
  fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify({ scenes: [{ clip: { asset: 'gv' } }] }));
  fs.rmSync(path.join(vid, 'scenes.json'));
  assert.equal(L.onScreenText(vid), null);
  const lab = L.labelCheck(vid, L.listAssets(root));
  assert.equal(lab.pass.length, 0); assert.equal(lab.problems.length, 0); assert.equal(lab.skipped.length, 1); assert.match(lab.skipped[0], /NOT checked/);
});

await test('video approve final refuses a missing label with no override, then records the tool and label in credits and approvals.md', () => {
  const root = channel();
  L.addAsset(root, download('gv.mp4'), { type: 'generated-video', tool: 'Higgsfield', title: 'Lighthouse', id: 'gv' });
  const plan = (text) => ({ scenes: [{ clip: { asset: 'gv' }, narration: 'a clip' }, { template: 't', props: { title: text }, narration: 'drawn' }] });
  const vid = finalFolder(root, 'gate', {}, plan('No label here'));
  L.writeCredits(root, vid); facts(vid);
  assert.throws(() => checks.approve(vid, 'final', { watched: true }), /licensed assets: not cleared[\s\S]*the video must show the text "Re-creation" on screen/);
  assert.throws(() => checks.approve(vid, 'final', { watched: true, note: 'override', force: true }), /not cleared/, 'there is no way around it');
  assert.ok(!fs.existsSync(path.join(vid, 'approvals.md')) || !/Final/.test(readText(path.join(vid, 'approvals.md'))), 'nothing is recorded by a refusal');
  fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify(plan('Re-creation: not real footage')));
  const block = L.writeCredits(root, vid);
  assert.equal(block, 'Music and assets\n- "Lighthouse" [generated with Higgsfield; on-screen label "Re-creation"]');
  assert.match(readText(path.join(vid, 'out', 'youtube.txt')), /\[generated with Higgsfield; on-screen label "Re-creation"\]/);
  facts(vid);
  const rec = checks.approve(vid, 'final', { watched: true });
  assert.match(rec.licensed[0].credit, /\[generated with Higgsfield; on-screen label "Re-creation"\]/);
  const md = readText(path.join(vid, 'approvals.md'));
  assert.match(md, /generated asset gv \(generated-video\) \[generated with Higgsfield; on-screen label "Re-creation"\]/);
  assert.match(md, /licensed assets: gv \(generated-video\)/); assert.ok(!/SKIPPED/.test(md));
  assert.ok(checks.approvalCurrent(vid, 'final').ok);
});

await test('the final approval with a label it could not look for writes a SKIPPED line in approvals.md, never a PASS; no label text is a FAIL', () => {
  const root = channel();
  L.addAsset(root, download('gi.png'), { type: 'generated-image', tool: 'Firefly', title: 'Map', id: 'gi' });
  const vid = finalFolder(root, 'skipped', {}, { scenes: [{ template: 't', props: { title: 'x' }, overlay: { asset: 'gi' } }] });
  L.writeCredits(root, vid); facts(vid);
  assert.throws(() => checks.approve(vid, 'final'), /must show the text "AI-generated"/);
  // the engine's text file with the label: approved and the label is read from it
  fs.writeFileSync(path.join(vid, 'build', 'on_screen_text.txt'), 'AI-generated\n');
  checks.approve(vid, 'final');
  assert.ok(!/SKIPPED/.test(readText(path.join(vid, 'approvals.md'))));
  // a reader that finds no text at all (so the label cannot be looked for): the check passes, but says SKIPPED
  const vid2 = finalFolder(root, 'skipped2', {}, { scenes: [{ template: 't', overlay: { asset: 'gi' } }] });
  L.writeCredits(root, vid2);
  const none = () => null;
  const r = L.check(root, vid2, { onScreen: none });
  assert.ok(r.ok); assert.equal(r.lines.filter((l) => l.status === 'PASS' && /shows its label/.test(l.text)).length, 0, 'not a PASS');
  const sk = r.lines.filter((l) => l.status === 'SKIPPED'); assert.equal(sk.length, 1); assert.match(sk[0].text, /"AI-generated" for gi was NOT checked/);
  const g = L.gate(vid2, { onScreen: none });
  assert.ok(g.notes.some((x) => /^SKIPPED: the label "AI-generated" for gi was NOT checked/.test(x)));
  const md = readText(path.join(vid2, 'approvals.md'));
  assert.match(md, /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}  SKIPPED: the label "AI-generated" for gi was NOT checked/m);
  assert.match(md, /generated asset gi \(generated-image\) \[generated with Firefly; on-screen label "AI-generated"\]/);
  assert.match(md, /^## Final$/m);
});

await test('no label with a recorded reason passes the gate and is said in the approval; the vertical rule keeps generated clips YouTube only', () => {
  const root = channel();
  L.addAsset(root, download('tex.png'), { type: 'generated-image', tool: 'Canva', onscreenLabel: '', noLabel: 'an abstract gradient, nothing that looks real' });
  const vid = finalFolder(root, 'nolabel', {}, { scenes: [{ template: 't', props: { title: 'Plain' }, overlay: { asset: 'tex' } }] });
  L.writeCredits(root, vid); facts(vid);
  checks.approve(vid, 'final');
  assert.match(readText(path.join(vid, 'approvals.md')), /\[generated with Canva; no on-screen label: an abstract gradient, nothing that looks real\]/);
  // vertical: the engine refuses an asset in the vertical version; verticalOk is the question it asks the register
  assert.equal(L.verticalOk(root, 'tex'), false);
});

await test('the vertical render refuses a generated clip unless it was recorded --vertical-ok (scenes.mjs asks licensed.verticalOk)', async () => {
  const scenes = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href);
  const styleId = scenes.sceneStyleIds()[0];
  const root = channel();
  L.addAsset(root, download('gv.mp4'), { type: 'generated-video', tool: 'X' });
  const vid = useInVideo(root, 'vert', { style: styleId }, { scenes: [{ clip: { asset: 'gv' }, narration: 'One two three.' }] });
  const script = `const s = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href)}); s.setShape('vertical'); try { await s.renderScenes({ dir: ${JSON.stringify(vid.replace(/\\/g, '/'))}, cfg: { style: ${JSON.stringify(styleId)} } }, {}); console.log('RENDERED'); } catch (e) { console.log('ERROR ' + e.message); }`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.match(r.stdout, /ERROR scene 1 uses licensed or generated material .* YouTube only/, r.stdout + r.stderr);
  // the register's answer, which the render uses once it is wired in
  const reg = JSON.parse(fs.readFileSync(path.join(root, L.REGISTER), 'utf8')); assert.equal(reg.assets[0].vertical_ok, undefined);
  L.addAsset(root, download('gv2.mp4'), { type: 'generated-video', tool: 'X', verticalOk: true });
  assert.equal(L.verticalOk(root, 'gv2'), true);
});

await test('real ffmpeg: a generated clip recorded --vertical-ok renders in the vertical shape (1080x1920); a licensed one is still refused', async () => {
  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
  if (!hasFfmpeg) { console.log('SKIPPED vertical render of a generated clip: ffmpeg or ffprobe is not installed'); return; }
  const scenes = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href);
  const styleId = scenes.sceneStyleIds()[0], root = channel(), work = tmp();
  const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  ff(['-f', 'lavfi', '-i', 'color=c=0x204060:s=640x360:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'gen.mp4')]);
  ff(['-f', 'lavfi', '-i', 'color=c=0x602040:s=640x360:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(work, 'stock.mp4')]);
  L.addAsset(root, path.join(work, 'gen.mp4'), { type: 'generated-video', tool: 'X', verticalOk: true });
  L.addAsset(root, path.join(work, 'stock.mp4'), { type: 'stock-video', title: 'Stock', channels: 'quark-street' });
  const make = (name, asset) => {
    const vid = useInVideo(root, name, { style: styleId, sfx: 'off' }, { scenes: [{ id: 'one', clip: { asset, start: 0 }, narration: 'One two three four.' }] });
    const words = scenes.fakeWords('One two three four.', 0.3); scenes.writeWords(vid, words);
    fs.mkdirSync(path.join(vid, 'audio'), { recursive: true });
    ff(['-f', 'lavfi', '-i', `sine=f=300:d=${(words.at(-1).e + 0.4).toFixed(2)}`, path.join(vid, 'audio', 'vo.mp3')]);
    return vid;
  };
  const render = (vid) => {
    const script = `const s = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href)}); const shape = s.setShape('vertical'); try { await s.renderScenes({ dir: ${JSON.stringify(vid.replace(/\\/g, '/'))}, cfg: { style: ${JSON.stringify(styleId)}, sfx: 'off' }, name: 'v' }, {}); console.log('RENDERED ' + shape.video); } catch (e) { console.log('ERROR ' + e.message); }`;
    return spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  };
  const ok = render(make('gen', 'gen')), m = /RENDERED (\S+)/.exec(ok.stdout);
  assert.ok(m, ok.stdout + ok.stderr);
  const info = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(root, 'videos', 'gen', 'build', m[1])], { encoding: 'utf8' }).stdout.trim();
  assert.equal(info, '1080,1920');
  assert.match(render(make('lic', 'stock')).stdout, /ERROR scene 1 uses licensed or generated material/);
});

await test('git ignores generated media but keeps the .gitkeep folders; the repo scan has nothing to say about them', () => {
  if (spawnSync('git', ['--version']).status !== 0) return;
  const d = tmp(); fs.cpSync(path.join(REPO, 'template'), d, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'brand', 'licensed', 'generated-video', 'a.mp4'), 'x'); fs.writeFileSync(path.join(d, 'brand', 'licensed', 'generated-image', 'a.png'), 'x');
  const ignored = (f) => spawnSync('git', ['check-ignore', '-q', f], { cwd: d }).status === 0;
  assert.ok(ignored('brand/licensed/generated-video/a.mp4') && ignored('brand/licensed/generated-image/a.png'));
  assert.ok(!ignored('brand/licensed/generated-video/.gitkeep') && !ignored('brand/licensed/generated-image/.gitkeep') && !ignored('brand/licensed/assets.json'));
  const readme = readText(path.join(REPO, 'template', 'brand', 'licensed', 'README.md'));
  for (const w of ['generated-video', 'generated-image', '--tool', '--no-label', '--vertical-ok', 'Re-creation', 'AI-generated', 'optional']) assert.ok(readme.includes(w), `README mentions ${w}`);
  assert.ok(!readme.includes(String.fromCharCode(0x2014)), 'no em dash');
});

globalThis.fetch = realFetch;
console.log(`\n${n} test(s) passed`);
