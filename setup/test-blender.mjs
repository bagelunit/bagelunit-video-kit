#!/usr/bin/env node
// Tests for the Blender support (own clips and overlays, the 3D library in a channel folder, terrain maps, the thumbnail from an
// image, the installer step and doctor). No network (the tile fetch is stubbed), no key, no browser needed. ffmpeg, Python and
// Blender are used where they are installed and each part says SKIPPED when its tool is missing; no part depends on another.
// Run: node setup/test-blender.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as L from '../studio/tools/licensed.mjs';
import * as scenes from '../studio/tools/scenes.mjs';
import * as upd from '../studio/tools/update.mjs';
import * as bl from '../studio/tools/blender.mjs';
import { makeWorkspace } from './new-workspace.mjs';

process.env.PYTHONDONTWRITEBYTECODE = '1';                         // the tests import the kit's own Python files: leave no __pycache__ in the repo
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(REPO, 'studio', 'tools', 'video.mjs');
const TEMPLATE = path.join(REPO, 'template');
const D3 = path.join(TEMPLATE, 'brand', 'library', '3d');
const IS_WIN = process.platform === 'win32';
let n = 0, skipped = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const skip = (what, why) => { skipped++; console.log(`SKIPPED ${what}: ${why}`); };
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'video-blender-test-')));
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const probe = (f, entries) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1', f], { encoding: 'utf8' }).stdout;
const lines = (s) => String(s).split(/\r?\n/);
const PY = ['python3', 'python'].find((c) => spawnSync(c, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'], { stdio: 'ignore' }).status === 0) || null;
const gitEnv = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'false' };

// a channel folder: a copy of the template with a video in it (never the repo's own template folder)
const channel = (slug = 'quark-street') => {
  const d = tmp();
  fs.cpSync(TEMPLATE, d, { recursive: true });
  const bf = path.join(d, 'brand', 'brand.json'), b = JSON.parse(fs.readFileSync(bf, 'utf8'));
  fs.writeFileSync(bf, JSON.stringify({ ...b, name: 'Quark Street', slug }));
  return d;
};
const useInVideo = (root, name, cfg, plan) => {
  const vid = path.join(root, 'videos', name); fs.mkdirSync(path.join(vid, 'out'), { recursive: true }); fs.mkdirSync(path.join(vid, 'build'), { recursive: true });
  fs.writeFileSync(path.join(vid, 'video.json'), JSON.stringify(cfg)); if (plan) fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify(plan));
  return vid;
};
const styleId = scenes.sceneStyleIds()[0], tpl = scenes.styleInfo(styleId)?.templates?.[0];
const planFor = (scene, dir = tmp()) => { fs.writeFileSync(path.join(dir, 'scenes.json'), JSON.stringify({ scenes: [scene] })); return scenes.planOf(dir, styleId).scenes[0]; };

/* ── own clips and overlays: planning ───────────────────────────────────────────────────────────────────────────────── */
await test('planOf takes a "file" clip and overlay (one of asset or file), with the same defaults as the licensed ones', () => {
  const c = planFor({ clip: { file: 'assets/blender/product.mp4', start: 1, duration: 5 }, narration: 'A product.' });
  assert.deepEqual(c.clip, { file: 'assets/blender/product.mp4', start: 1, duration: 5, mute: true });
  assert.equal(c.id, '01-clip');
  const o = planFor({ template: tpl, narration: 'x', overlay: [{ file: 'assets\\blender\\title.mov', blend: 'screen', opacity: 0.5, at: 1 }, { asset: 'leak' }] });
  assert.deepEqual(o.overlays.map((x) => [x.file ?? null, x.asset ?? null, x.blend, x.opacity, x.at]), [['assets/blender/title.mov', null, 'screen', 0.5, 1], [null, 'leak', 'normal', 1, 0]]);
  assert.equal(planFor({ clip: { asset: 'city' }, narration: 'x' }).clip.asset, 'city', 'a licensed clip is unchanged');
});

await test('planOf refuses both asset and file, neither, an absolute path, "..", and an empty path, each with words that explain', () => {
  const bad = (scene, re) => assert.throws(() => planFor({ narration: 'x', ...scene }), re);
  bad({ clip: { asset: 'a', file: 'b.mp4' } }, /either "asset".* or "file".*not both/);
  bad({ clip: { start: 1 } }, /exactly one of "asset".* or "file"/);
  bad({ clip: { file: '' } }, /"file" must be a path/);
  bad({ clip: { file: 7 } }, /"file" must be a path/);
  bad({ clip: { file: '/etc/hosts' } }, /absolute path/);
  bad({ clip: { file: 'C:\\Users\\x\\a.mp4' } }, /absolute path/);
  bad({ clip: { file: '\\\\server\\share\\a.mp4' } }, /absolute path/);
  bad({ clip: { file: '../outside.mp4' } }, /goes up out of its folder/);
  bad({ clip: { file: 'assets/../../x.mp4' } }, /goes up out of its folder/);
  bad({ template: tpl, overlay: { asset: 'a', file: 'b.mov' } }, /either "asset".* or "file"/);
  bad({ template: tpl, overlay: { file: '..\\x.mov' } }, /goes up out of its folder/);
  bad({ clip: { file: 'a.mp4', mute: false } }, /always muted/);
});

/* ── own clips and overlays: where the file may be ──────────────────────────────────────────────────────────────────── */
await test('ownFile finds a file in the video folder or in brand/library, must exist, and must be a file', () => {
  const root = channel(), vid = useInVideo(root, 'v', {});
  fs.mkdirSync(path.join(vid, 'assets', 'blender'), { recursive: true }); fs.writeFileSync(path.join(vid, 'assets', 'blender', 'a.mp4'), 'x');
  fs.mkdirSync(path.join(root, 'brand', 'library', 'loops'), { recursive: true }); fs.writeFileSync(path.join(root, 'brand', 'library', 'loops', 'b.mov'), 'y');
  assert.equal(L.ownFile(root, vid, 'assets/blender/a.mp4'), path.join(vid, 'assets', 'blender', 'a.mp4'));
  assert.equal(L.ownFile(root, vid, 'loops/b.mov'), path.join(root, 'brand', 'library', 'loops', 'b.mov'));
  assert.throws(() => L.ownFile(root, vid, 'assets/blender/nope.mp4'), /does not exist \(looked in the video folder and in brand\/library\/\)/);
  assert.throws(() => L.ownFile(root, vid, 'assets/blender'), /is a folder, not a file/);
  assert.throws(() => L.ownFile(root, vid, '../v/assets/blender/a.mp4'), /goes up out of its folder/);
});

await test('ownFile refuses a link that leads outside the channel folder (and takes one that stays inside)', () => {
  const root = channel(), vid = useInVideo(root, 'v', {}), outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.mp4'), 's'); fs.mkdirSync(path.join(vid, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(vid, 'real.mp4'), 'r');
  try { fs.symlinkSync(path.join(outside, 'secret.mp4'), path.join(vid, 'assets', 'link.mp4')); fs.symlinkSync(path.join(vid, 'real.mp4'), path.join(vid, 'assets', 'inside.mp4')); }
  catch (e) { return skip('symlink escape test', `this system will not make links (${e.code})`); }
  assert.throws(() => L.ownFile(root, vid, 'assets/link.mp4'), /leads outside the channel folder through a link/);
  assert.ok(L.ownFile(root, vid, 'assets/inside.mp4'));
  fs.rmSync(path.join(vid, 'assets', 'link.mp4')); fs.mkdirSync(path.join(outside, 'dir'));
  fs.writeFileSync(path.join(outside, 'dir', 'z.mp4'), 'z'); fs.symlinkSync(path.join(outside, 'dir'), path.join(vid, 'assets', 'linkdir'));
  assert.throws(() => L.ownFile(root, vid, 'assets/linkdir/z.mp4'), /leads outside the channel folder/);
});

await test('a video that is not in a channel folder uses its own folder as the limit', () => {
  const vid = tmp(); fs.writeFileSync(path.join(vid, 'a.mp4'), 'x');
  assert.equal(L.ownFile(null, vid, 'a.mp4'), path.join(vid, 'a.mp4'));
  assert.throws(() => L.ownFile(null, vid, 'b.mp4'), /does not exist/);
});

await test('own files are not licensed: video licensed check ignores them, video check warns about a missing one', () => {
  const root = channel(), vid = useInVideo(root, 'own', { no_research: 'a test' }, { scenes: [{ clip: { file: 'assets/blender/a.mp4' }, narration: 'x' }, { template: tpl, narration: 'y', overlay: { file: 'assets/blender/t.mov' } }] });
  assert.deepEqual(L.usedAssets(vid), []);
  assert.deepEqual(L.usedOwnFiles(vid).map((u) => [u.file, u.use]), [['assets/blender/a.mp4', 'scene 1 clip'], ['assets/blender/t.mov', 'scene 2 overlay']]);
  const r = L.check(root, vid); assert.ok(r.ok); assert.match(r.lines[0].text, /no licensed assets/);
  assert.deepEqual(L.creditsOf(root, vid), []);
  const notes = L.notesFor(vid);
  assert.equal(notes.length, 2); assert.match(notes[0], /scene 1 clip: the file "assets\/blender\/a\.mp4" does not exist .*the render will stop/); assert.match(notes[1], /scene 2 overlay/);
  fs.mkdirSync(path.join(vid, 'assets', 'blender'), { recursive: true }); fs.writeFileSync(path.join(vid, 'assets', 'blender', 'a.mp4'), 'x'); fs.writeFileSync(path.join(vid, 'assets', 'blender', 't.mov'), 'y');
  assert.deepEqual(L.notesFor(vid), []);
  // a licensed asset next to an own file: only the licensed one is a licensed use
  fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify({ scenes: [{ clip: { file: 'assets/blender/a.mp4' }, narration: 'x' }, { clip: { asset: 'city' }, narration: 'y' }] }));
  assert.deepEqual(L.usedAssets(vid).map((u) => u.id), ['city']);
});

await test('the vertical version refuses licensed clips but not own files (planning and the refusal rule)', () => {
  const root = channel(), vid = useInVideo(root, 'vr', { style: styleId }, { scenes: [{ clip: { file: 'assets/blender/a.mp4' }, narration: 'One two three.' }] });
  const run = (plan) => {
    fs.writeFileSync(path.join(vid, 'scenes.json'), JSON.stringify(plan));
    const f = path.join(tmp(), 'run.mjs');
    fs.writeFileSync(f, `const s = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href)});
s.setShape('vertical');
const dir = ${JSON.stringify(vid)};
const prep = s.prepare({ dir, cfg: { style: ${JSON.stringify(styleId)} } });
console.log(JSON.stringify(prep.scenes.map((x) => ({ clip: x.clip || null, overlays: x.overlays || null }))));
try { await s.renderScenes({ dir, cfg: { style: ${JSON.stringify(styleId)} } }, {}); } catch (e) { console.log('ERROR ' + e.message); }
`);
    return spawnSync(process.execPath, [f], { encoding: 'utf8' });
  };
  fs.mkdirSync(path.join(vid, 'assets', 'blender'), { recursive: true }); fs.writeFileSync(path.join(vid, 'assets', 'blender', 'a.mp4'), 'x');
  fs.mkdirSync(path.join(vid, 'audio'), { recursive: true });
  const own = run({ scenes: [{ clip: { file: 'assets/blender/a.mp4' }, overlay: { file: 'assets/blender/a.mp4' }, narration: 'One two three.' }] });
  assert.ok(!/uses licensed or generated material/.test(own.stdout), `own files are not refused in the vertical version: ${own.stdout}${own.stderr}`);
  const lic = run({ scenes: [{ clip: { asset: 'stock' }, narration: 'One two three.' }] });
  assert.match(lic.stdout, /ERROR scene 1 uses licensed or generated material .*YouTube only \(your own files, "file", are fine in the vertical version/);
});

/* ── own clips and overlays: real ffmpeg pixels and a render ───────────────────────────────────────────────────────── */
if (!hasFfmpeg) skip('own clip, overlay and render tests', 'ffmpeg or ffprobe is not installed');
else {
  const pixel = (file, t, x = 960, y = 540) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-'], { encoding: 'buffer' }); assert.equal(r.status, 0); return [...r.stdout.subarray(0, 3)]; };
  const near = (got, want, tol, what) => assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= tol), `${what}: got ${got}, wanted about ${want}`);

  await test('real ffmpeg: an own clip fills the frame in the scene codec, muted, last frame held, with the scene voice under it', () => {
    const root = channel(), vid = useInVideo(root, 'c', {}), work = tmp();
    fs.mkdirSync(path.join(vid, 'assets', 'blender'), { recursive: true });
    ff(['-f', 'lavfi', '-i', 'color=c=0x204060:s=320x240:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(vid, 'assets', 'blender', 'own.mp4')]);   // 4:3, 24 fps, 1 s: wrong on purpose
    ff(['-f', 'lavfi', '-i', 'sine=f=440:d=3', path.join(work, 'vo.wav')]);
    const base = path.join(work, '001'), item = { scene: { n: 1, id: '01-clip', clip: { file: 'assets/blender/own.mp4', start: 0, duration: null, mute: true } }, time: { frames: 60, t0: 0.5, t1: 2.5 }, base, hash: 'h', audio: 'a' };
    const m = scenes.renderClip(item, path.join(work, 'vo.wav'), root, vid);
    assert.equal(m.clip, 'assets/blender/own.mp4'); assert.ok(m.notes.some((x) => /"assets\/blender\/own\.mp4" has only 1\.0 s .* held/.test(x)), JSON.stringify(m.notes));
    const info = probe(`${base}.mp4`, 'stream=codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels');
    for (const want of ['codec_name=h264', 'width=1920', 'height=1080', 'r_frame_rate=30/1', 'pix_fmt=yuv420p', 'codec_name=aac', 'sample_rate=48000', 'channels=2']) assert.ok(info.includes(want), `${want} in ${info}`);
    near(pixel(`${base}.mp4`, 1.8), [32, 64, 96], 14, 'the held last frame still fills the picture');
  });

  await test('real ffmpeg: own overlays keep their alpha (.mov), screen drops black, and timing holds', () => {
    const root = channel(), vid = useInVideo(root, 'o', {}), work = tmp();
    fs.mkdirSync(path.join(vid, 'assets'), { recursive: true });
    ff(['-f', 'lavfi', '-i', 'color=c=0x204060:s=1920x1080:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=300:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(work, 'scene.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x806040:s=160x90:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(vid, 'assets', 'leak.mp4')]);
    ff(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=64x64:r=30:d=1,format=rgba', '-c:v', 'qtrle', path.join(vid, 'assets', 'tint.mov')]);
    const screen = path.join(work, 's.mp4'), normal = path.join(work, 'n.mp4');
    fs.copyFileSync(path.join(work, 'scene.mp4'), screen); fs.copyFileSync(path.join(work, 'scene.mp4'), normal);
    scenes.applyOverlays(screen, [{ file: 'assets/leak.mp4', blend: 'screen', opacity: 1, at: 0.5, duration: 1 }], 2, root, vid);
    near(pixel(screen, 0.2), [32, 64, 96], 12, 'before the overlay'); near(pixel(screen, 1.0), [144, 136, 136], 14, 'screen of 0x806040 over 0x204060'); near(pixel(screen, 1.8), [32, 64, 96], 12, 'after');
    scenes.applyOverlays(normal, [{ file: 'assets/tint.mov', blend: 'normal', opacity: 1, at: 0.5, duration: 1 }], 2, root, vid);
    near(pixel(normal, 0.2), [32, 64, 96], 12, 'normal: before'); near(pixel(normal, 1.0), [143, 32, 48], 16, 'normal: the alpha of the .mov is kept'); near(pixel(normal, 1.8), [32, 64, 96], 12, 'normal: after');
    for (const f of [screen, normal]) { const info = probe(f, 'stream=codec_name,width,height,r_frame_rate'); for (const want of ['codec_name=h264', 'width=1920', 'height=1080', 'r_frame_rate=30/1', 'codec_name=aac']) assert.ok(info.includes(want), `${want} in ${info}`); }
  });

  await test('real ffmpeg: an own file scene renders in a video (no register, no browser), a changed file redraws only its own scene, and the vertical version takes it', async () => {
    const root = channel(), work = tmp();
    const vid = useInVideo(root, 'e2e', { style: styleId, sfx: 'off', no_research: 'a test' }, { scenes: [
      { id: 'one', clip: { file: 'assets/blender/a.mp4', start: 0 }, narration: 'First we look at the product.' },
      { id: 'two', clip: { file: 'assets/blender/b.mp4', start: 0 }, narration: 'Then we turn it around slowly.' },
      { id: 'three', clip: { file: 'assets/blender/a.mp4', start: 0 }, narration: 'And that is all of it.' }] });
    fs.mkdirSync(path.join(vid, 'assets', 'blender'), { recursive: true });
    const colour = (name, c) => ff(['-f', 'lavfi', '-i', `color=c=${c}:s=640x360:r=30:d=8`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(vid, 'assets', 'blender', name)]);
    colour('a.mp4', '0x204060'); colour('b.mp4', '0x602020');
    const words = scenes.fakeWords('First we look at the product. Then we turn it around slowly. And that is all of it.', 0.3); scenes.writeWords(vid, words);
    fs.mkdirSync(path.join(vid, 'audio'), { recursive: true });
    ff(['-f', 'lavfi', '-i', `sine=f=300:d=${(words.at(-1).e + 0.4).toFixed(2)}`, path.join(vid, 'audio', 'vo.mp3')]);
    const reel = { dir: vid, cfg: JSON.parse(fs.readFileSync(path.join(vid, 'video.json'), 'utf8')), name: 'e2e' };
    const say = async (fn) => { const log = console.log, out = []; console.log = (...a) => out.push(a.join(' ')); try { await fn(); } finally { console.log = log; } return out.join('\n'); };
    let text = await say(() => scenes.renderScenes(reel, {}));
    const out = path.join(vid, 'build', 'video.mp4');
    assert.ok(fs.existsSync(out), text); assert.match(text, /3 scenes: 3 rendered/);
    near(pixel(out, 0.5), [32, 64, 96], 18, 'scene one is own file a');
    text = await say(() => scenes.renderScenes(reel, {})); assert.match(text, /0 rendered, 3 reused unchanged/);
    colour('b.mp4', '0x206020');                                           // the owner re-renders b: only scene two changes
    text = await say(() => scenes.renderScenes(reel, {})); assert.match(text, /1 rendered, 2 reused unchanged/);
    // a missing file stops the render with a plain message
    fs.rmSync(path.join(vid, 'assets', 'blender', 'b.mp4'));
    await assert.rejects(() => scenes.renderScenes(reel, {}), /the file "assets\/blender\/b\.mp4" does not exist/);
    colour('b.mp4', '0x206020');
    // vertical: the same plan draws 1080x1920 with the own file
    const f = path.join(work, 'vertical.mjs');
    fs.writeFileSync(f, `const s = await import(${JSON.stringify(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href)});
s.setShape('vertical');
await s.renderScenes({ dir: ${JSON.stringify(vid)}, cfg: ${JSON.stringify(reel.cfg)} }, {});
`);
    const r = spawnSync(process.execPath, [f], { encoding: 'utf8' });
    const vv = path.join(vid, 'build', 'video-vertical.mp4'), cands = [vv, path.join(vid, 'build', 'vertical.mp4')].filter((x) => fs.existsSync(x));
    assert.ok(cands.length, `the vertical render wrote no file: ${r.stdout}${r.stderr}`);
    assert.ok(probe(cands[0], 'stream=width,height').includes('width=1080') && probe(cands[0], 'stream=width,height').includes('height=1920'), 'the vertical video is 1080x1920');
  });

  /* ── thumbnail from an image ─────────────────────────────────────────────────────────────────────────────────────── */
  const thumb = (vid, ...args) => spawnSync(process.execPath, [VIDEO, 'thumbnail', vid, ...args], { encoding: 'utf8', cwd: path.dirname(vid) });
  await test('video thumbnail --image: cover fills 1280x720, contain shows the whole picture on --bg, a transparent picture lands on --bg, a path outside is refused', () => {
    const root = channel(), vid = useInVideo(root, 't', { title: 'A test', style: styleId }), work = tmp();
    fs.mkdirSync(path.join(vid, 'assets', 'blender'), { recursive: true });
    ff(['-f', 'lavfi', '-i', 'color=c=0x2040a0:s=600x600', '-frames:v', '1', path.join(vid, 'assets', 'blender', 'square.png')]);
    ff(['-f', 'lavfi', '-i', 'color=c=red@0.0:s=640x360,format=rgba', '-frames:v', '1', path.join(vid, 'assets', 'blender', 'clear.png')]);
    ff(['-f', 'lavfi', '-i', 'color=c=0xaa5500:s=1600x900', '-frames:v', '1', path.join(work, 'elsewhere.png')]);
    let r = thumb(vid, '--image', 'assets/blender/square.png'); assert.equal(r.status, 0, r.stderr + r.stdout);
    const jpg = path.join(vid, 'out', 'thumbnail.jpg');
    assert.match(probe(jpg, 'stream=width,height'), /width=1280\s+height=720/);
    assert.match(r.stdout, /your image videos\/t\/assets\/blender\/square\.png/);
    near(pixel(jpg, 0, 640, 360), [32, 64, 160], 20, 'cover: the picture fills the frame'); near(pixel(jpg, 0, 10, 10), [32, 64, 160], 20, 'cover: the corner is the picture too');
    r = thumb(vid, '--image', 'assets/blender/square.png', '--fit', 'contain', '--bg', '#102030', '--name', 'c'); assert.equal(r.status, 0, r.stderr);
    const c = path.join(vid, 'out', 'thumbnails', 'c.jpg');
    near(pixel(c, 0, 640, 360), [32, 64, 160], 20, 'contain: the picture in the middle'); near(pixel(c, 0, 20, 360), [16, 32, 48], 14, 'contain: the side bars are --bg');
    r = thumb(vid, '--image', 'assets/blender/clear.png', '--bg', '203040', '--name', 'a'); assert.equal(r.status, 0, r.stderr);
    near(pixel(path.join(vid, 'out', 'thumbnails', 'a.jpg'), 0, 640, 360), [32, 48, 64], 14, 'a transparent picture shows the background colour');
    r = thumb(vid, '--image', path.join(work, 'elsewhere.png')); assert.equal(r.status, 1); assert.match(r.stderr, /outside the channel folder .*refused/);
    r = thumb(vid, '--image', '../../../../elsewhere.png'); assert.equal(r.status, 1); assert.match(r.stderr, /does not exist|outside/);
    r = thumb(vid, '--image', 'assets/blender/nope.png'); assert.equal(r.status, 1); assert.match(r.stderr, /does not exist/);
    r = thumb(vid, '--image', 'assets/blender/square.png', '--fit', 'stretch'); assert.equal(r.status, 1); assert.match(r.stderr, /--fit must be cover or contain/);
    r = thumb(vid, '--image'); assert.equal(r.status, 1); assert.match(r.stderr, /--image needs a file/);
  });

  await test('video thumbnail --image with --text draws the words over your picture (needs the Reel Kit engine, so it may be skipped)', () => {
    const reel = process.env.BAGELUNIT_REEL_ENGINE || path.join(os.homedir(), '.claude', 'skills', 'bagelunit-reels');
    if (!fs.existsSync(path.join(reel, 'node_modules', 'playwright'))) return skip('thumbnail text over an image', 'the Reel Kit engine with its headless browser is not installed');
    const root = channel(), vid = useInVideo(root, 'tt', { title: 'A test', style: styleId });
    fs.mkdirSync(path.join(vid, 'assets'), { recursive: true });
    ff(['-f', 'lavfi', '-i', 'color=c=0x2040a0:s=1280x720', '-frames:v', '1', path.join(vid, 'assets', 'bg.png')]);
    const r = thumb(vid, '--image', 'assets/bg.png', '--text', 'BIG *WORDS* HERE');
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /"BIG WORDS HERE"/);
    near(pixel(path.join(vid, 'out', 'thumbnail.jpg'), 0, 1240, 700), [32, 64, 160], 30, 'the far corner is still your picture');
  });
}

/* ── the channel folder ships the library; update treats it as kit-owned ───────────────────────────────────────────── */
await test('the template ships the Blender library, keeps renders out of git, and ships no media', () => {
  for (const f of ['README.md', 'lib/bb.py', 'shots/product.py', 'shots/phone.py', 'shots/terrain.py', 'blender_shot.py', 'blender_shot.sh', 'terrain.py']) assert.ok(fs.existsSync(path.join(D3, f)), f);
  const bb = fs.readFileSync(path.join(D3, 'lib', 'bb.py'), 'utf8');
  for (const fn of ['rgba', 'setup', 'mat', 'mat_image', 'rounded_box', 'cylinder', 'plane', 'text3d', 'import_model', 'blob_shadow', 'studio_lights', 'camera', 'orbit', 'push_in', 'render', 'terrain_shaded_relief']) assert.match(bb, new RegExp(`^def ${fn}\\(`, 'm'), fn);
  assert.ok(fs.existsSync(path.join(TEMPLATE, '.claude', 'skills', 'blender-shot', 'SKILL.md')));
  const skill = fs.readFileSync(path.join(TEMPLATE, '.claude', 'skills', 'blender-shot', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');   // a Windows checkout may have CRLF
  assert.match(skill, /^---\nname: blender-shot\n/); assert.match(skill, /claude mcp list/); assert.match(skill, /Inputs:.*Outputs:.*Next step:/s);
  assert.match(fs.readFileSync(path.join(TEMPLATE, 'CLAUDE.md'), 'utf8'), /\/blender-shot/);
  assert.match(fs.readFileSync(path.join(REPO, 'COMMANDS.md'), 'utf8'), /\/blender-shot/);
  const media = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(png|jpg|mp4|mov|webm|blend|glb|wav|mp3|f32)$/i.test(e.name)) media.push(p); } };
  walk(D3); assert.deepEqual(media, [], 'the library ships no render, model or data file');
  for (const f of ['blender_shot.py', 'terrain.py', 'lib/bb.py', 'shots/product.py', 'shots/phone.py', 'shots/terrain.py', 'README.md']) assert.ok(!fs.readFileSync(path.join(D3, f), 'utf8').includes('\u2014'), `${f} has no em dash`);
});

await test('git ignores the Blender renders and the tile cache of a video but not its other files', () => {
  if (spawnSync('git', ['--version']).status !== 0) return skip('gitignore test', 'git is not installed');
  const d = channel(); spawnSync('git', ['init', '-q'], { cwd: d, env: gitEnv });
  const ignored = (f) => spawnSync('git', ['check-ignore', '-q', f], { cwd: d, env: gitEnv }).status === 0;
  for (const f of ['videos/a/assets/blender/x.mov', 'videos/a/assets/blender/.tiles/9/1/2.png', 'videos/a/assets/blender/terrain-data/heights.f32']) assert.ok(ignored(f), f);
  assert.ok(!ignored('videos/a/scenes.json')); assert.ok(!ignored('brand/library/3d/lib/bb.py'));
});

await test('new-workspace copies the library, and update treats brand/library/3d as kit-owned while the owner\'s other library files stay', () => {
  const made = makeWorkspace(path.join(tmp(), 'acme'), { registry: path.join(tmp(), 'channels.json') });
  assert.ok(fs.existsSync(path.join(made.dir, 'brand', 'library', '3d', 'blender_shot.py')));
  assert.ok(upd.brandOwned('brand/library/3d/lib/bb.py')); assert.ok(!upd.brandOwned('brand/library/INDEX.md')); assert.ok(!upd.brandOwned('brand/brand.json')); assert.ok(upd.brandOwned('brand/licensed/README.md'));
  const ch = made.dir;
  fs.writeFileSync(path.join(ch, 'brand', 'library', 'mine.txt'), 'the owner added this'); fs.writeFileSync(path.join(ch, 'brand', 'library', 'INDEX.md'), 'sources');
  fs.appendFileSync(path.join(ch, 'brand', 'library', '3d', 'lib', 'bb.py'), '\n# an old edit\n'); fs.rmSync(path.join(ch, 'brand', 'library', '3d', 'shots', 'phone.py'));
  const plan = upd.planTemplate(REPO, ch);
  assert.ok(plan.replace.includes('brand/library/3d/lib/bb.py'), 'a changed library file is replaced (after a backup)');
  assert.ok(plan.add.includes('brand/library/3d/shots/phone.py'), 'a missing library file is added');
  assert.ok(!plan.replace.concat(plan.add).some((f) => /mine\.txt|INDEX\.md/.test(f)), 'files the owner added are not touched');
  assert.ok(plan.same.includes('brand/library/3d/terrain.py'));
  const res = upd.applyTemplate(REPO, ch, plan, '20261117T000000');
  assert.ok(res.backups.some((b) => /bb\.py\.bak-/.test(b)));
  assert.ok(!fs.readFileSync(path.join(ch, 'brand', 'library', '3d', 'lib', 'bb.py'), 'utf8').includes('an old edit'));
  assert.equal(fs.readFileSync(path.join(ch, 'brand', 'library', 'mine.txt'), 'utf8'), 'the owner added this');
});

/* ── finding Blender: the installer step and doctor ─────────────────────────────────────────────────────────────────── */
const fakeBlender = (version) => {
  const d = tmp(), f = path.join(d, 'blender');
  fs.writeFileSync(f, `#!/bin/sh\necho "Blender ${version}"\necho "  build date: 2026-01-01"\n`); fs.chmodSync(f, 0o755);
  return d;
};
const install = (env) => spawnSync(process.execPath, [path.join(REPO, 'setup', 'install.mjs'), '--dry-run'], { encoding: 'utf8', env: { ...process.env, ...env } });
await test('installer step: not found prints a NOTE with how to get it and asks nothing (BAGELUNIT_BLENDER_PATHS replaces the places)', () => {
  const r = install({ BAGELUNIT_BLENDER_PATHS: tmp(), BAGELUNIT_BLENDER: '' });
  assert.equal(r.status, 0, r.stderr);
  const line = lines(r.stdout).find((l) => /Blender/.test(l));
  assert.match(line, /^NOTE Blender not found \(optional/);
  assert.match(line, /brew install --cask blender|winget install BlenderFoundation\.Blender|snap install blender|apt install blender|blender\.org/);
  assert.ok(!/\?\s*$/m.test(line), 'it asks no question');
});
if (IS_WIN) skip('installer and doctor tests with a stub Blender', 'the stub is a shell script');
else {
  await test('installer step: a Blender 5.3 is reported ok, 4.1 and a program that is not Blender get a NOTE', () => {
    let r = install({ BAGELUNIT_BLENDER_PATHS: fakeBlender('5.3.0'), BAGELUNIT_BLENDER: '' });
    assert.match(lines(r.stdout).find((l) => /Blender/.test(l)), /^ok   Blender 5\.3\.0 found \(.*from BAGELUNIT_BLENDER_PATHS\)/);
    r = install({ BAGELUNIT_BLENDER_PATHS: fakeBlender('4.2.1'), BAGELUNIT_BLENDER: '' });
    assert.match(lines(r.stdout).find((l) => /Blender/.test(l)), /^ok   Blender 4\.2\.1 found/);
    r = install({ BAGELUNIT_BLENDER_PATHS: fakeBlender('4.1.0'), BAGELUNIT_BLENDER: '' });
    assert.match(lines(r.stdout).find((l) => /Blender/.test(l)), /^NOTE Blender 4\.1\.0 found at .*but the 3D shots want 4\.2 or newer \(update it: /);
    const d = tmp(); fs.writeFileSync(path.join(d, 'blender'), '#!/bin/sh\necho hello\n'); fs.chmodSync(path.join(d, 'blender'), 0o755);
    r = install({ BAGELUNIT_BLENDER_PATHS: d, BAGELUNIT_BLENDER: '' });
    assert.match(lines(r.stdout).find((l) => /Blender/.test(l)), /^NOTE Blender is at .* did not report a version/);
  });
  await test('video doctor reports Blender as a note (not an error), found or not', () => {
    const doctor = (env) => spawnSync(process.execPath, [VIDEO, 'doctor'], { encoding: 'utf8', env: { ...process.env, ...env } });
    let r = doctor({ BAGELUNIT_BLENDER_PATHS: tmp(), BAGELUNIT_BLENDER: '' });
    assert.match(lines(r.stdout).find((l) => /Blender/.test(l)), /^note    Blender not found \(optional/); assert.ok(!/MISSING.*Blender/.test(r.stdout));
    r = doctor({ BAGELUNIT_BLENDER_PATHS: fakeBlender('5.3.0'), BAGELUNIT_BLENDER: '' });
    assert.match(lines(r.stdout).find((l) => /Blender/.test(l)), /^ok      Blender 5\.3\.0 found/);
  });
}
await test('blender.mjs: the order is BAGELUNIT_BLENDER, then the stated places; how-to text is per system', () => {
  assert.equal(bl.findBlender({ env: { BAGELUNIT_BLENDER: path.join(tmp(), 'nope') } }), null);
  const d = tmp(), f = path.join(d, process.platform === 'win32' ? 'blender.exe' : 'blender'); fs.writeFileSync(f, 'x');
  assert.equal(bl.findBlender({ env: { BAGELUNIT_BLENDER: f } }).how, 'BAGELUNIT_BLENDER');
  assert.equal(bl.findBlender({ env: { BAGELUNIT_BLENDER_PATHS: d } }).path, f);
  assert.equal(bl.findBlender({ env: { BAGELUNIT_BLENDER_PATHS: '' } }), null);
  assert.match(bl.howToGet({ platform: 'darwin' }), /brew install --cask blender/); assert.match(bl.howToGet({ platform: 'win32' }), /winget install BlenderFoundation\.Blender/);
  assert.match(bl.howToGet({ platform: 'linux', has: (c) => c === 'snap' }), /snap install blender/); assert.match(bl.howToGet({ platform: 'linux' }), /blender\.org/);
  assert.ok(bl.tooOld({ major: 4, minor: 1 })); assert.ok(!bl.tooOld({ major: 4, minor: 2 })); assert.ok(!bl.tooOld({ major: 5, minor: 0 }));
  assert.ok(bl.standardPlaces({ platform: 'darwin', home: '/h' }).includes('/Applications/Blender.app/Contents/MacOS/Blender'));
  assert.ok(bl.standardPlaces({ platform: 'linux', home: '/h' }).includes('/snap/bin/blender'));
});

/* ── the launcher and terrain (Python, no packages, no Blender needed for these) ───────────────────────────────────── */
// a minimal PNG writer for fixtures
const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (type, body) => { const t = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(body.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, body]))); return Buffer.concat([len, t, body, crc]); };
const rgbPng = (w, h, rgbAt, filter = 0) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = rgbAt(x, y); raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3); } }
  if (filter) {                                                          // re-filter every row (1 sub, 2 up, 3 average, 4 paeth) so the reader's unfilter is tested
    const out = Buffer.alloc(raw.length), s = w * 3;
    for (let y = 0; y < h; y++) {
      out[y * (s + 1)] = filter;
      for (let i = 0; i < s; i++) {
        const cur = raw[y * (s + 1) + 1 + i], a = i >= 3 ? raw[y * (s + 1) + 1 + i - 3] : 0, b = y ? raw[(y - 1) * (s + 1) + 1 + i] : 0, c = y && i >= 3 ? raw[(y - 1) * (s + 1) + 1 + i - 3] : 0;
        let pred = 0;
        if (filter === 1) pred = a; else if (filter === 2) pred = b; else if (filter === 3) pred = (a + b) >> 1;
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        out[y * (s + 1) + 1 + i] = (cur - pred) & 255;
      }
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', Buffer.from([...u32(w), ...u32(h), 8, 2, 0, 0, 0])), pngChunk('IDAT', zlib.deflateSync(out)), pngChunk('IEND', Buffer.alloc(0))]);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', Buffer.from([...u32(w), ...u32(h), 8, 2, 0, 0, 0])), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
};
function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
// metres -> Terrarium RGB, the encoding the real tiles use (height = R*256 + G + B/256 - 32768)
const terrarium = (m) => { const v = m + 32768, r = Math.floor(v / 256), g = Math.floor(v % 256), b = Math.floor((v - Math.floor(v)) * 256); return [r, g, b]; };
// independent slippy-map maths (the standard formulas), to check the Python against
const tileOf = (lat, lon, z) => { const n = 2 ** z, x = Math.floor(((lon + 180) / 360) * n), r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); return [x, y]; };

if (!PY) skip('launcher and terrain tests', 'Python 3.8 or newer is not installed');
else {
  const py = (code, opts = {}) => spawnSync(PY, ['-c', code], { encoding: 'utf8', cwd: D3, ...opts });
  const run = (file, args, opts = {}) => spawnSync(PY, [file, ...args], { encoding: 'utf8', ...opts });
  const pyJson = (code) => { const r = py(code); assert.equal(r.status, 0, r.stderr + r.stdout); return JSON.parse(lines(r.stdout).filter(Boolean).at(-1)); };
  const T = 'import sys, json, pathlib; sys.path.insert(0, "."); import terrain';

  await test('terrain: the Terrarium decode, the Web Mercator tile maths and the bounding box to tile range', () => {
    const tile = rgbPng(256, 256, (x, y) => (y < 128 ? terrarium(530.25) : x < 128 ? terrarium(-0.5) : terrarium(8848.0)));
    const f = path.join(tmp(), 't.png'); fs.writeFileSync(f, tile);
    const j = pyJson(`${T}
d = open(${JSON.stringify(f)}, 'rb').read()
w, h, a = terrain.terrarium_heights(d)
print(json.dumps({'w': w, 'a': a[0], 'b': a[127 * 256 + 255], 'c': a[200 * 256 + 10], 'd': a[200 * 256 + 200], 'x': terrain.world_px(0, 0, 1), 'lon': terrain.px_to_latlon(256, 256, 1)}))`);
    assert.equal(j.w, 256); assert.ok(Math.abs(j.a - 530.25) < 0.01); assert.ok(Math.abs(j.b - 530.25) < 0.01);
    assert.ok(Math.abs(j.c - -0.5) < 0.01, `below zero: ${j.c}`); assert.ok(Math.abs(j.d - 8848) < 0.01);
    assert.deepEqual(j.x, [256, 256]); assert.ok(Math.abs(j.lon[0]) < 1e-9 && Math.abs(j.lon[1]) < 1e-9);
    // 530.25 by hand: 530.25 + 32768 = 33298.25 = 130 * 256 + 18 + 64 / 256
    assert.deepEqual(terrarium(530.25), [130, 18, 64]); assert.ok(130 * 256 + 18 + 64 / 256 - 32768 === 530.25);
    // plan: which tiles cover a box, at which zoom, compared with the standard formulas
    const [tx, ty] = tileOf(51.5074, -0.1278, 10); assert.deepEqual([tx, ty], [511, 340]);
    const p = pyJson(`${T}
p = terrain.plan((51.4, -0.3, 51.6, 0.1), zoom=10)
print(json.dumps({'tiles': p['tiles'], 'w': p['width'], 'h': p['height'], 'count': p['count'], 'zoom': p['zoom']}))`);
    const [a0x, a0y] = tileOf(51.6, -0.3, 10), [a1x, a1y] = tileOf(51.4, 0.1, 10);
    assert.deepEqual(p.tiles, [a0x, a0y, a1x, a1y]); assert.equal(p.count, (a1x - a0x + 1) * (a1y - a0y + 1)); assert.ok(p.w > 0 && p.h > 0 && p.w > p.h * 0.8);
  });

  await test('terrain: the PNG reader handles every row filter (sub, up, average, paeth)', () => {
    for (const filter of [0, 1, 2, 3, 4]) {
      const png = rgbPng(40, 30, (x, y) => [(x * 5 + y) & 255, (y * 7) & 255, (x * y) & 255], filter);
      const f = path.join(tmp(), `f${filter}.png`); fs.writeFileSync(f, png);
      const j = pyJson(`${T}
w, h, ch, px = terrain.decode_png(open(${JSON.stringify(f)}, 'rb').read())
print(json.dumps({'w': w, 'h': h, 'ch': ch, 'ok': all(px[(y * w + x) * 3:(y * w + x) * 3 + 3] == bytes(((x * 5 + y) & 255, (y * 7) & 255, (x * y) & 255)) for y in range(h) for x in range(w))}))`);
      assert.deepEqual([j.w, j.h, j.ch, j.ok], [40, 30, 3, true], `filter ${filter}`);
    }
    assert.match(py(`${T}\ntry:\n    terrain.decode_png(b'not a png')\nexcept terrain.TerrainError as e:\n    print(e)`).stdout, /not a PNG/);
  });

  await test('terrain: stitching tiles and cropping to the box is exact across tile borders; a second run reads the cache with no requests', () => {
    // a world where the height at global pixel (gx, gy) of zoom 3 is gx * 0.1 + gy * 0.2 metres
    const stubDir = tmp(); const z = 3;
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      fs.mkdirSync(path.join(stubDir, String(z), String(x)), { recursive: true });
      fs.writeFileSync(path.join(stubDir, String(z), String(x), `${y}.png`), rgbPng(256, 256, (px, py) => terrarium((x * 256 + px) * 0.1 + (y * 256 + py) * 0.2)));
    }
    const out = tmp();
    const j = pyJson(`${T}
import time
terrain.time.sleep = lambda s: None
calls = []
def stub(url):
    calls.append(url)
    z, x, y = url.split('/terrarium/')[1][:-4].split('/')
    return open(pathlib.Path(${JSON.stringify(stubDir)}) / z / x / (y + '.png'), 'rb').read()
terrain.http_get = stub
bbox = (-30.0, -40.0, 20.0, 30.0)
meta = terrain.build(bbox, pathlib.Path(${JSON.stringify(path.join(out, 'data'))}), pathlib.Path(${JSON.stringify(path.join(out, 'tiles'))}), zoom=3)
first = len(calls)
terrain.build(bbox, pathlib.Path(${JSON.stringify(path.join(out, 'data2'))}), pathlib.Path(${JSON.stringify(path.join(out, 'tiles'))}), zoom=3)
print(json.dumps({'meta': meta, 'first': first, 'second': len(calls) - first, 'urls': calls[:2]}))`);
    const m = j.meta;
    assert.equal(m.zoom, 3); assert.equal(j.second, 0, 'the cache answers the second run'); assert.equal(j.first, m.tiles);
    assert.match(j.urls[0], /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/3\/\d+\/\d+\.png$/);
    const heights = fs.readFileSync(path.join(out, 'data', 'heights.f32')), view = new DataView(heights.buffer, heights.byteOffset, heights.length);
    assert.equal(heights.length, m.width * m.height * 4);
    // the window's top-left global pixel: from the standard formulas
    const px = (lat, lon) => { const nn = 256 * 2 ** z, s = Math.sin((lat * Math.PI) / 180); return [((lon + 180) / 360) * nn, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * nn]; };
    const [wx, wy] = px(20.0, -40.0), ix0 = Math.floor(wx), iy0 = Math.floor(wy);
    for (const [c, r] of [[0, 0], [m.width - 1, 0], [0, m.height - 1], [m.width - 1, m.height - 1], [255 - ix0 % 256, 3], [4, 255 - iy0 % 256], [Math.floor(m.width / 2), Math.floor(m.height / 2)]]) {
      const want = (ix0 + c) * 0.1 + (iy0 + r) * 0.2, got = view.getFloat32((r * m.width + c) * 4, true);
      assert.ok(Math.abs(got - want) < 0.02, `pixel ${c},${r}: ${got} vs ${want}`);
    }
    assert.ok(Math.abs(m.min_m - view.getFloat32(0, true)) < 0.02, 'the top-left corner is the lowest here'); assert.ok(m.max_m > m.min_m);
    assert.ok(m.bbox.south <= -29.9 && m.bbox.south > -31 && m.bbox.north >= 19.9 && m.bbox.north < 21, `the actual box is the requested box to a pixel: ${JSON.stringify(m.bbox)}`);
    assert.ok(Math.abs(m.m_per_px - 40075016.686 * Math.cos((-5 * Math.PI) / 180) / (256 * 8)) < 1);
    const png = fs.readFileSync(path.join(out, 'data', 'heightmap.png'));
    assert.equal(png.readUInt32BE(16), m.width); assert.equal(png.readUInt32BE(20), m.height); assert.equal(png[24], 16, 'a 16-bit grey preview'); assert.equal(png[25], 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'data', 'terrain.json'), 'utf8')).width, m.width);
  });

  await test('terrain: caps and clear errors (bad box, zoom or size over the caps, a box across the date line)', () => {
    const err = (code) => { const r = py(`${T}\ntry:\n    ${code}\nexcept terrain.TerrainError as e:\n    print('ERR', e)`); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    assert.match(err('terrain.parse_bbox("1,2,3")'), /ERR --bbox wants SOUTH,WEST,NORTH,EAST/);
    assert.match(err('terrain.parse_bbox("10,0,5,1")'), /SOUTH below NORTH/);
    assert.match(err('terrain.parse_bbox("0,170,10,-170")'), /across the 180 degree line is not supported/);
    assert.match(err('terrain.parse_bbox("0,0,89,10")'), /between -85 and 85/);
    assert.match(err('terrain.plan((0, 0, 10, 10), zoom=15)'), /--zoom can be 0 to 14/);
    assert.match(err('terrain.plan((0, 0, 30, 30), zoom=9)'), /over the caps \(2048 px, 36 tiles\)/);
    assert.match(err('terrain.plan((0, 0, 1, 1), zoom=4, max_size=5000)'), /--max-size can be 1 to 4096/);
    const auto = pyJson(`${T}\np = terrain.plan((27.6, 85.9, 28.3, 87.0))\nprint(json.dumps({'z': p['zoom'], 'w': p['width'], 'h': p['height'], 'c': p['count']}))`);
    assert.ok(auto.z >= 8 && auto.z <= 12 && Math.max(auto.w, auto.h) <= 2048 && auto.c <= 36, JSON.stringify(auto));
    const world = pyJson(`${T}\np = terrain.plan((-60, -170, 70, 170))\nprint(json.dumps({'z': p['zoom'], 'c': p['count']}))`);
    assert.ok(world.z <= 3 && world.c <= 36, `a huge box gets a low zoom, not a huge download: ${JSON.stringify(world)}`);
  });

  await test('terrain: the request is polite (generic User-Agent, no personal details), retried with a pause, and fails with a clear message', () => {
    const j = pyJson(`${T}
import urllib.request, urllib.error, time
terrain.time.sleep = lambda s: None
seen = {'headers': None, 'urls': [], 'n': 0}
tile = open(${JSON.stringify((() => { const f = path.join(tmp(), 'tile.png'); fs.writeFileSync(f, rgbPng(256, 256, () => [128, 0, 0])); return f; })())}, 'rb').read()
class R:
    def __init__(self, b): self.b = b
    def read(self): return self.b
    def __enter__(self): return self
    def __exit__(self, *a): return False
def flaky(req, timeout=None):
    seen['n'] += 1; seen['headers'] = dict(req.header_items()); seen['urls'].append(req.full_url)
    if seen['n'] < 3: raise urllib.error.URLError('connection reset')
    return R(tile)
terrain.urllib.request.urlopen = flaky
cache = pathlib.Path(${JSON.stringify(tmp())})
data, hit = terrain.fetch_tile(3, 1, 2, cache, log=lambda *a: None)
out = {'tries': seen['n'], 'hit': hit, 'ua': seen['headers'].get('User-agent'), 'url': seen['urls'][-1], 'cached': (cache / '3' / '1' / '2.png').is_file()}
def dead(req, timeout=None): raise urllib.error.URLError('no route')
terrain.urllib.request.urlopen = dead
try: terrain.fetch_tile(3, 5, 5, cache, log=lambda *a: None)
except terrain.TerrainError as e: out['dead'] = str(e)
def nf(req, timeout=None): raise urllib.error.HTTPError(req.full_url, 404, 'Not Found', {}, None)
terrain.urllib.request.urlopen = nf
try: terrain.fetch_tile(3, 6, 6, cache, log=lambda *a: None)
except terrain.TerrainError as e: out['nf'] = str(e)
print(json.dumps(out))`);
    assert.equal(j.tries, 3, 'two failures, then it worked'); assert.equal(j.hit, false); assert.equal(j.cached, true);
    assert.equal(j.url, 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/3/1/2.png');
    assert.match(j.ua, /^bagelunit-video-kit-terrain\/[\d.]+ \(/); assert.ok(!/[@]|\/Users\/|\\Users\\|home/i.test(j.ua), `no personal details in "${j.ua}"`); assert.ok(!j.ua.includes(os.userInfo().username) || os.userInfo().username.length < 4);
    assert.match(j.dead, /could not download tile 3\/5\/5 after 3 tries .*no route.*already downloaded are kept/);
    assert.match(j.nf, /the server has no tile 3\/6\/6 \(HTTP 404/);
  });

  await test('terrain: the attribution file and printed text carry the Terrain Tiles credits and the source page', () => {
    const j = pyJson(`${T}\nd = pathlib.Path(${JSON.stringify(tmp())})\nf = terrain.write_attribution(d)\nprint(json.dumps({'text': f.read_text(encoding='utf-8'), 'name': f.name}))`);
    assert.equal(j.name, 'ATTRIBUTION.txt');
    for (const re of [/Terrain Tiles \(Mapzen, Tilezen\)/, /USGS SRTM/, /NASA/, /github\.com\/tilezen\/joerd\/blob\/master\/docs\/attribution\.md/, /United States 3DEP \(formerly NED\) and global GMTED2010 and SRTM terrain data\s+courtesy of the U\.S\. Geological Survey/, /ArcticDEM/, /Copernicus/, /ETOPO1/]) assert.match(j.text, re);
  });

  // a channel with a video, for the launcher
  const chan = channel(), vidDir = useInVideo(chan, 'demo', { style: styleId });
  const shotPy = path.join(chan, 'brand', 'library', '3d', 'blender_shot.py'), terrainPy = path.join(chan, 'brand', 'library', '3d', 'terrain.py');
  const noBlender = { ...process.env, BAGELUNIT_BLENDER: '', BAGELUNIT_BLENDER_PATHS: tmp() };

  await test('launcher: sizes, the output folder, the clip kinds and what it refuses (a dry run, so Blender is not needed)', () => {
    let r = run(shotPy, ['shots/product.py', '--video', 'demo', '--dry-run', '--still', '45'], { cwd: path.dirname(shotPy), env: noBlender });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /--size 1920x1080 --fps 30 --frames 120 --samples 48/); assert.match(r.stdout, /--still 45/);
    assert.match(lines(r.stdout).find((l) => l.startsWith('output folder:')), /videos\/demo\/assets\/blender\s+\(Blender was not found\)/);
    r = run(shotPy, ['shots/phone.py', '--video', 'demo', '--dry-run', '--vertical', '--mp4', 'p.mp4', '--seconds', '2', '--fps', '25', '--samples', '9', '--screen', 'x.png'], { cwd: path.dirname(shotPy), env: noBlender });
    assert.match(r.stdout, /--size 1080x1920 --fps 25 --frames 50 --samples 9 --vertical --opaque 1 --screen x\.png/);
    r = run(shotPy, ['shots/product.py', '--video', 'demo', '--dry-run', '--size', '640x360', '--clip', 'p.webm', '--shape', 'can'], { cwd: path.dirname(shotPy), env: noBlender });
    assert.match(r.stdout, /--size 640x360 .*--shape can/); assert.ok(!/--opaque/.test(r.stdout), 'a clip keeps its alpha');
    // refusals
    for (const [args, re] of [[['--clip', 'a.avi'], /--clip wants a \.mov .* or \.webm/], [['--mp4', 'a.mov'], /--mp4 wants a name ending in \.mp4/], [['--clip', 'a.mov', '--mp4', 'a.mp4'], /--clip or --mp4, not both/],
      [['--video', 'nope'], /no video "nope"/], [['--out', '../../../..'], /outside the channel folder/], [['--out', os.tmpdir()], /outside the channel folder/]]) {
      r = run(shotPy, ['shots/product.py', '--video', 'demo', '--dry-run', ...args], { cwd: path.dirname(shotPy), env: noBlender }); assert.notEqual(r.status, 0, args.join(' ')); assert.match(r.stderr, re, args.join(' '));
    }
    r = run(shotPy, ['shots/nothing.py', '--video', 'demo', '--dry-run'], { cwd: path.dirname(shotPy), env: noBlender }); assert.match(r.stderr, /no shot script "shots\/nothing\.py"/);
    r = run(shotPy, ['shots/product.py', '--dry-run'], { cwd: path.dirname(shotPy), env: noBlender }); assert.match(r.stderr, /which video is this for\? Add --video/);
    r = run(shotPy, ['shots/product.py', '--dry-run'], { cwd: vidDir, env: noBlender }); assert.equal(r.status, 0, 'inside a video folder it needs no --video'); assert.match(r.stdout, /videos\/demo\/assets\/blender/);
  });

  await test('launcher: without Blender it says so, with how to get it, and exits 1 (a real run, not a dry run)', () => {
    const r = run(shotPy, ['shots/product.py', '--video', 'demo', '--still', '1'], { cwd: path.dirname(shotPy), env: noBlender });
    assert.equal(r.status, 1); assert.match(r.stderr, /Blender was not found\. It is free and optional: .*BAGELUNIT_BLENDER/);
    assert.ok(!fs.existsSync(path.join(vidDir, 'assets', 'blender', 'product_frames')), 'nothing was made');
  });

  await test('terrain.py --from-dir: no network, renders saved data through the launcher, refuses data outside the channel folder, writes the attribution', () => {
    const data = path.join(vidDir, 'assets', 'blender', 'saved-data'); fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'terrain.json'), JSON.stringify({ width: 4, height: 3, zoom: 5, m_per_px: 100 })); fs.writeFileSync(path.join(data, 'heights.f32'), Buffer.alloc(48));
    let r = run(terrainPy, ['--from-dir', data, '--video', 'demo', '--dry-run', '--still', '10', '--label', 'A@1,2'], { cwd: path.dirname(terrainPy), env: noBlender });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /using the saved data in .*saved-data \(4x3 px, zoom 5\); no network/);
    assert.match(r.stdout, /Terrain Tiles \(Mapzen, Tilezen\)/); assert.match(r.stdout, /would run: .*shots[\\/]terrain\.py -- --out .* --data .*saved-data .*--label A@1,2/s);
    assert.ok(fs.existsSync(path.join(vidDir, 'assets', 'blender', 'ATTRIBUTION.txt')), 'the attribution sits next to the render');
    r = run(terrainPy, ['--from-dir', tmp(), '--video', 'demo', '--dry-run'], { cwd: path.dirname(terrainPy), env: noBlender }); assert.equal(r.status, 1); assert.match(r.stderr, /outside the channel folder/);
    r = run(terrainPy, ['--video', 'demo', '--dry-run'], { cwd: path.dirname(terrainPy), env: noBlender }); assert.equal(r.status, 1); assert.match(r.stderr, /give the area: --bbox SOUTH,WEST,NORTH,EAST/);
    r = run(terrainPy, ['--bbox', '1,2', '--video', 'demo'], { cwd: path.dirname(terrainPy), env: noBlender }); assert.equal(r.status, 1); assert.match(r.stderr, /--bbox wants SOUTH,WEST,NORTH,EAST/);
  });

  /* ── a real Blender render (skipped when Blender is not installed; not run in CI) ─────────────────────────────────── */
  const blenderBin = bl.findBlender();
  if (!blenderBin) skip('real Blender render tests', 'Blender is not installed');
  else {
    const real = { ...process.env, BAGELUNIT_BLENDER: blenderBin.path };
    const pngHead = (f) => { const b = fs.readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), ctype: b[25] }; };
    const alphaAt = (f, x, y) => { if (!hasFfmpeg) return null; const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y},format=rgba`, '-f', 'rawvideo', '-'], { encoding: 'buffer' }); return r.stdout[3]; };
    await test(`real Blender (${blenderBin.path.split(path.sep).join('/')}): a product still at 320x180, transparent, the object in the middle`, () => {
      const r = run(shotPy, ['shots/product.py', '--video', 'demo', '--size', '320x180', '--samples', '4', '--still', '30'], { cwd: path.dirname(shotPy), env: real, timeout: 240000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const still = path.join(vidDir, 'assets', 'blender', 'product-still.png');
      assert.deepEqual(pngHead(still), { w: 320, h: 180, ctype: 6 });
      const mid = alphaAt(still, 160, 90), corner = alphaAt(still, 2, 2);
      if (mid !== null) { assert.ok(mid > 200, `the object is solid in the middle (alpha ${mid})`); assert.equal(corner, 0, 'the corner is clear'); }
    });
    await test('real Blender: a vertical alpha clip is encoded (ProRes 4444) at the size asked for', () => {
      if (!hasFfmpeg) return skip('clip encode', 'ffmpeg is not installed');
      const r = run(shotPy, ['shots/phone.py', '--video', 'demo', '--vertical', '--size', '180x320', '--samples', '3', '--seconds', '0.5', '--fps', '8', '--clip', 'phone.mov'], { cwd: path.dirname(shotPy), env: real, timeout: 240000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const f = path.join(vidDir, 'assets', 'blender', 'phone.mov'), info = probe(f, 'stream=codec_name,width,height,nb_frames,pix_fmt');
      for (const want of ['codec_name=prores', 'width=180', 'height=320', 'nb_frames=4']) assert.ok(info.includes(want), `${want} in ${info}`);
      assert.ok(/pix_fmt=yuva/.test(info), `the clip has alpha: ${info}`);
      assert.ok(!fs.existsSync(path.join(vidDir, 'assets', 'blender', 'phone_frames')), 'the frames are removed after encoding');
    });
    await test('real Blender: a terrain still from a synthetic heightmap (no network), labelled, opaque, filling the frame', () => {
      // a 96x64 map with one smooth peak, written exactly as terrain.py writes it
      const W = 96, H = 64, data = path.join(vidDir, 'assets', 'blender', 'synthetic-data'); fs.mkdirSync(data, { recursive: true });
      const f32 = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f32.writeFloatLE(100 + 900 * Math.exp(-(((x - 64) / 14) ** 2 + ((y - 32) / 12) ** 2)), (y * W + x) * 4);
      fs.writeFileSync(path.join(data, 'heights.f32'), f32);
      fs.writeFileSync(path.join(data, 'terrain.json'), JSON.stringify({ version: 1, bbox: { south: 10, west: 20, north: 10.64, east: 20.96 }, zoom: 9, width: W, height: H, m_per_px: 1000, min_m: 100, max_m: 1000 }));
      const r = run(terrainPy, ['--from-dir', data, '--video', 'demo', '--name', 'syn', '--size', '480x270', '--samples', '4', '--still', '1', '--opaque', '1', '--bg', '000000', '--move', 'still', '--label', 'Peak@10.32,21.04', '--label', 'Outside@50,50'], { cwd: path.dirname(terrainPy), env: real, timeout: 240000 });
      assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /LABEL skipped: Outside is outside the map/);
      const still = path.join(vidDir, 'assets', 'blender', 'syn-still.png');
      assert.deepEqual(pngHead(still), { w: 480, h: 270, ctype: 2 });
      if (hasFfmpeg) {
        const px = (x, y) => { const q = spawnSync('ffmpeg', ['-v', 'error', '-i', still, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-'], { encoding: 'buffer' }); return [...q.stdout.subarray(0, 3)]; };
        assert.deepEqual(px(2, 2), [0, 0, 0], 'the background is --bg');
        // the map is drawn: count non-background pixels on the middle row
        let lit = 0; for (let x = 0; x < 480; x += 8) if (px(x, 150).some((v) => v > 20)) lit++;
        assert.ok(lit > 10, `the terrain fills a good part of the frame (${lit} of 60 samples)`);
      }
    });
  }
}

console.log(`\n${n} test(s) passed${skipped ? `, ${skipped} SKIPPED (a tool is missing; see above)` : ''}`);
