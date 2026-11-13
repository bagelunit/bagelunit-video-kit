#!/usr/bin/env node
// Tests for the Video Kit that need no key, no network and no browser: script chunking, chapters, YouTube text and
// limits, the upload flow against a fake YouTube (dry run, session saved first, resume, never twice, stand-in refused),
// and that the synced styles are wide and match their fingerprints. Run: node setup/test-video.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chunkScript, chapterLines, stamp } from '../studio/tools/video.mjs';
import * as yt from '../studio/tools/youtube.mjs';
import * as scenes from '../studio/tools/scenes.mjs';
import * as checks from '../studio/tools/checks.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'video-kit-test-'));

await test('chunkScript cuts at paragraphs, never over the limit, keeps every word', () => {
  const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} says something quite ordinary about the number ${i}. It has two sentences.`).join('\n\n');
  const c = chunkScript(text, 400);
  assert.ok(c.length > 1 && c.every((x) => x.length <= 400));
  assert.equal(c.join(' ').replace(/\s+/g, ' ').split(' ').length, text.replace(/\s+/g, ' ').split(' ').length);
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  assert.ok(chunkScript(long, 200).every((x) => x.length <= 200));
});

await test('stamp and chapters: first at 0:00, at least three, ten seconds apart', () => {
  assert.equal(stamp(0), '0:00'); assert.equal(stamp(75), '1:15'); assert.equal(stamp(3725), '1:02:05');
  const plan = [{ chapter: 'Intro' }, {}, { chapter: 'Middle' }, { chapter: 'End' }], times = [0, 12, 30, 45].map((t0) => ({ t0 }));
  const r = chapterLines(plan, times);
  assert.deepEqual(r.lines, ['0:00 Intro', '0:30 Middle', '0:45 End']);
  assert.equal(r.notes.length, 0);
  assert.ok(chapterLines(plan, [0, 12, 5, 45].map((t0) => ({ t0 }))).notes.some((x) => /10 s/.test(x)));
});

await test('chapterLines moves the first chapter to 0:00 and warns about fewer than three', () => {
  const r = chapterLines([{}, { chapter: 'A' }], [{ t0: 0 }, { t0: 20 }]);
  assert.equal(r.lines[0], '0:00 A');
  assert.ok(r.notes.some((x) => /at least 3/.test(x)));
});

await test('parts and problems: title, limits, chapters appended, no #Shorts', () => {
  const p = yt.parts('A title\n\nThe description.', '0:00 One\n0:30 Two\n1:00 Three\n');
  assert.equal(p.title, 'A title'); assert.ok(p.description.endsWith('1:00 Three')); assert.ok(!/Shorts/i.test(p.description));
  assert.equal(yt.parts('T\n\n0:00 Mine\n', '0:00 Other').description, '0:00 Mine');
  const ok = { video: true, thumbnail: null, standIn: false, privacy: 'private' };
  assert.deepEqual(yt.problems(p, ok), []);
  assert.ok(yt.problems({ title: 'x'.repeat(101), description: '' }, ok).some((x) => /101/.test(x)));
  assert.ok(yt.problems({ title: 'a<b', description: '' }, ok).length);
  assert.ok(yt.problems(p, { ...ok, standIn: true }).some((x) => /stand-in/.test(x)));
  assert.ok(yt.problems(p, { ...ok, privacy: 'everyone' }).length);
});

const approveFinal = (d) => { fs.writeFileSync(path.join(d, 'build', 'approvals.json'), JSON.stringify({ final: { at: 'test', files: Object.fromEntries(['video.mp4', 'thumbnail.jpg', 'youtube.txt'].map((x) => [x, checks.sha256File(path.join(d, 'out', x))])) } })); };
const fakeFolder = ({ standIn = false, approved = true } = {}) => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'out'), { recursive: true }); fs.mkdirSync(path.join(d, 'audio'), { recursive: true }); fs.mkdirSync(path.join(d, 'build'), { recursive: true });
  fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes', title: 'T' }));
  fs.writeFileSync(path.join(d, 'out', 'video.mp4'), Buffer.alloc(5000, 7));
  fs.writeFileSync(path.join(d, 'out', 'youtube.txt'), 'How volcanoes work\n\nA short description.');
  fs.writeFileSync(path.join(d, 'out', 'chapters.txt'), '0:00 One\n0:30 Two\n1:00 Three\n');
  fs.writeFileSync(path.join(d, 'audio', 'vo.mp3'), 'voice');
  if (standIn) fs.writeFileSync(path.join(d, 'build', 'voice-stand-in.json'), JSON.stringify({ sha: createHash('sha256').update('voice').digest('hex') }));
  if (approved) approveFinal(d);
  return d;
};
const cred = () => { const c = tmp(); fs.writeFileSync(path.join(c, 'youtube-default.json'), JSON.stringify({ client_id: 'id', client_secret: 'secret-xyz', refresh_token: 'rt' })); return c; };
function fakeYouTube({ cut = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, method: init.method, body: init.body });
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (u.includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { location: 'https://upload.example/session1' } });
    if (u.startsWith('https://upload.example/')) {
      if (init.headers?.['Content-Range']?.startsWith('bytes */')) return cut ? new Response('', { status: 308, headers: { range: 'bytes=0-1999' } }) : new Response(JSON.stringify({ id: 'vid1' }), { status: 200 });
      if (init.body && typeof init.body.on === 'function') { for await (const _ of init.body) {} }
      return new Response(JSON.stringify({ id: 'vid1' }), { status: 200 });
    }
    if (u.includes('thumbnails/set')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}

await test('upload is a dry run without --yes and sends nothing', async () => {
  const d = fakeFolder(), f = fakeYouTube();
  const r = await yt.upload(d, { fetchImpl: f.fetchImpl, credDir: cred(), log: () => {} });
  assert.equal(r.dryRun, true); assert.equal(f.calls.length, 0);
  assert.equal(r.meta.status.privacyStatus, 'private');
});

await test('upload refuses a stand-in voice and a missing video', async () => {
  await assert.rejects(yt.upload(fakeFolder({ standIn: true }), { yes: true, fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: () => {} }), /stand-in/);
  const d = fakeFolder(); fs.rmSync(path.join(d, 'out', 'video.mp4'));
  await assert.rejects(yt.upload(d, { fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: () => {} }), /video.mp4 is missing/);
});

await test('upload --yes: session first, bytes, published record, then a second upload is refused', async () => {
  const d = fakeFolder(), f = fakeYouTube(), c = cred();
  const r = await yt.upload(d, { yes: true, fetchImpl: f.fetchImpl, credDir: c, log: () => {} });
  assert.equal(r.id, 'vid1');
  const order = f.calls.map((x) => (x.url.includes('resumable') ? 'start' : x.url.startsWith('https://upload.example') ? 'put' : x.url.includes('thumbnails') ? 'thumb' : 'token'));
  assert.ok(order.indexOf('start') < order.indexOf('put'));
  assert.ok(fs.existsSync(path.join(d, 'out', 'youtube-published.json')) && !fs.existsSync(path.join(d, 'build', 'youtube-upload.json')));
  await assert.rejects(yt.upload(d, { yes: true, fetchImpl: f.fetchImpl, credDir: c, log: () => {} }), /already uploaded/);
});

await test('upload resumes from a saved session: asks YouTube how far it got, sends only the rest', async () => {
  const d = fakeFolder(), f = fakeYouTube({ cut: true });
  fs.writeFileSync(path.join(d, 'build', 'youtube-upload.json'), JSON.stringify({ session: 'https://upload.example/session1', size: 5000 }));
  await yt.upload(d, { yes: true, fetchImpl: f.fetchImpl, credDir: cred(), log: () => {} });
  assert.ok(!f.calls.some((x) => x.url.includes('resumable')), 'no new session');
  assert.ok(f.calls.some((x) => x.method === 'PUT'));
});

await test('missing credentials make a PASTE file and say so; secrets never appear in messages', async () => {
  const c = tmp(), r = tmp();
  assert.throws(() => yt.readCredentials('default', { dir: c, reelDir: r }), /PASTE-/);
  assert.ok(fs.existsSync(path.join(c, 'youtube-default.json')));
  assert.throws(() => yt.readCredentials('default', { dir: c, reelDir: r }), (e) => !/secret-xyz/.test(e.message) && /still needs/.test(e.message));
  fs.writeFileSync(path.join(r, 'youtube-x.json'), JSON.stringify({ client_id: 'cid', client_secret: 'cs' }));
  assert.equal(yt.readCredentials('x', { dir: c, reelDir: r }).cfg.client_id, 'cid');   // borrowed from the Reel Kit file
});

await test('styles are wide, registered, and every file matches its fingerprint', () => {
  const reg = scenes.registry();
  assert.equal(reg.format, 'wide'); assert.deepEqual(reg.size, [1920, 1080]);
  assert.equal(scenes.sceneStyleIds().length, 19);
  for (const s of reg.styles) for (const [file, fp] of Object.entries(s.files)) {
    const h = createHash('sha256').update(fs.readFileSync(path.join(REPO, 'studio', 'styles', s.id, file))).digest('hex').slice(0, 16);
    assert.equal(h, fp, `${s.id}/${file} was edited by hand: sync from the styles repo instead`);
  }
});

await test('video voice joins chunks with a stand-in voice.py: one audio file, word times shifted, natural pace', () => {
  const eng = tmp(); fs.mkdirSync(path.join(eng, 'tools'));
  fs.writeFileSync(path.join(eng, 'tools', 'voice.py'), `import sys, json, subprocess, pathlib
d = pathlib.Path(sys.argv[1]); open(d / 'args.txt', 'w').write(' '.join(sys.argv[2:])); words = (d / 'script.txt').read_text().split()
(d / 'build').mkdir(exist_ok=True); (d / 'audio').mkdir(exist_ok=True)
json.dump([{'w': w, 's': i * 0.3, 'e': i * 0.3 + 0.25} for i, w in enumerate(words)], open(d / 'build' / 'words.json', 'w'))
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=%s' % (len(words) * 0.3), str(d / 'audio' / 'vo.mp3')], check=True)
`);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ style: 'clean-shapes', no_research: 'a test script' }));
  fs.writeFileSync(path.join(dir, 'script.txt'), Array.from({ length: 12 }, (_, i) => `Paragraph ${i} has some words in it, nothing more.`).join('\n\n'));
  fs.writeFileSync(path.join(dir, 'outline.md'), '# Map\n');
  checks.approve(dir, 'map'); checks.recordFacts(dir, { scope: 'script', result: 'PASS', cfg: { no_research: 'a test script' } });
  const r = spawnSync(process.execPath, [path.join(REPO, 'studio', 'tools', 'video.mjs'), 'voice', dir], { encoding: 'utf8', env: { ...process.env, BAGELUNIT_REEL_ENGINE: eng, VIDEO_CHUNK: '120' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(dir, 'audio', 'vo.mp3')));
  const w = JSON.parse(fs.readFileSync(path.join(dir, 'build', 'words.json'), 'utf8'));
  assert.equal(w.length, 12 * 9);
  assert.ok(w.every((x, i) => i === 0 || x.s >= w[i - 1].s), 'word times only go forward');
  assert.match(fs.readFileSync(path.join(dir, 'build', 'voice', '001', 'args.txt'), 'utf8'), /--speed 1\b/, 'a video is voiced at natural pace, not the reel speed-up');
});

await test('research comes before the voice: empty page, too few sources, a reason to skip, and two sources', async () => {
  const { researchState, RESEARCH_PAGE } = await import('../studio/tools/video.mjs');
  const d = tmp();
  assert.equal(researchState(d).ok, false, 'no research.md');
  fs.writeFileSync(path.join(d, 'research.md'), RESEARCH_PAGE);
  assert.match(researchState(d).why, /empty page/);
  fs.writeFileSync(path.join(d, 'research.md'), '# Research\n- a fact [a](https://example.org/a)\n');
  assert.match(researchState(d).why, /1 source/);
  fs.writeFileSync(path.join(d, 'research.md'), '# Research\n- a fact [a](https://example.org/a)\n- another [b](https://example.org/b)\n');
  assert.equal(researchState(d).ok, true);
  assert.equal(researchState(tmp(), { no_research: 'a bedtime story' }).ok, true);
  const v = tmp();
  fs.writeFileSync(path.join(v, 'video.json'), JSON.stringify({ style: 'clean-shapes' }));
  fs.writeFileSync(path.join(v, 'script.txt'), 'Words to say.');
  fs.writeFileSync(path.join(v, 'research.md'), RESEARCH_PAGE);
  const r = spawnSync(process.execPath, [path.join(REPO, 'studio', 'tools', 'video.mjs'), 'voice', v], { encoding: 'utf8', env: { ...process.env, BAGELUNIT_REEL_ENGINE: tmp() } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /not voicing yet/);
});


await test('upload needs the final approval, for exactly the approved files', async () => {
  await assert.rejects(yt.upload(fakeFolder({ approved: false }), { fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: () => {} }), /not been approved/);
  const d = fakeFolder();
  fs.writeFileSync(path.join(d, 'out', 'youtube.txt'), 'A different title\n\nChanged after approval.');
  await assert.rejects(yt.upload(d, { fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: () => {} }), /youtube.txt changed after the final approval/);
});

await test('numbers are read the way scripts say them and sources write them', () => {
  const v = (t) => checks.numbersIn(t).map((n) => n.value);
  assert.deepEqual(v('About sixty four percent of adults'), [64]);
  assert.deepEqual(v('in nineteen sixty nine and twenty twenty four'), [1969, 2024]);
  assert.deepEqual(v('one point four million km, 1,400,000 km, 1.4 million'), [1.4e6, 1.4e6, 1.4e6]);
  assert.deepEqual(v('a hundred and twelve, two thousand and five, three hundred thousand'), [112, 2005, 300000]);
  assert.ok(checks.numbersIn('64%')[0].pct && checks.numbersIn('sixty four per cent')[0].pct);
});

await test('fact check: unsourced numbers fail, rounding warns, never-say fails, PASS needs a clean check and goes stale', () => {
  const b = tmp(); fs.mkdirSync(path.join(b, 'brand'));
  fs.writeFileSync(path.join(b, 'brand', 'brand.json'), JSON.stringify({ name: 'Acme', voice: { never_say: ['guaranteed results'] } }));
  fs.writeFileSync(path.join(b, 'brand', 'facts.md'), '# facts\n\n## Never say\n- miracle\n');
  const d = path.join(b, 'videos', 'v1'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes' }));
  fs.writeFileSync(path.join(d, 'research.md'), '# Research\n- 64% of adults need glasses [a](https://example.org/a)\n- Earth is 12,742 km wide [b](https://example.org/b)\n');
  fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify({ scenes: [{ template: 'x', props: { note: '12,742 km' } }] }));
  fs.writeFileSync(path.join(d, 'script.txt'), 'Sixty four percent of adults need glasses. Earth is about twelve thousand seven hundred km wide.');
  let r = checks.factCheck(d);
  assert.equal(r.errors.length, 0, r.errors.join('\n')); assert.ok(r.warnings.some((w) => /rounded/.test(w)));
  fs.writeFileSync(path.join(d, 'script.txt'), 'Seventy one percent of people agree. It is a miracle.');
  r = checks.factCheck(d);
  assert.ok(r.errors.some((e) => /seventy one/.test(e))); assert.ok(r.errors.some((e) => /miracle/.test(e)));
  assert.throws(() => checks.recordFacts(d, { scope: 'script', result: 'PASS' }), /refused/);
  fs.writeFileSync(path.join(d, 'script.txt'), 'Sixty four percent of adults need glasses.');
  checks.recordFacts(d, { scope: 'script', result: 'PASS' });
  assert.equal(checks.factsCurrent(d, 'script').ok, true);
  fs.appendFileSync(path.join(d, 'script.txt'), ' And more words.');
  assert.match(checks.factsCurrent(d, 'script').why, /changed/);
  assert.match(fs.readFileSync(path.join(d, 'approvals.md'), 'utf8'), /## Fact check\n- .* script: PASS/);
});

await test('the voice waits for the map approval and the fact check', () => {
  const v = tmp();
  fs.writeFileSync(path.join(v, 'video.json'), JSON.stringify({ style: 'clean-shapes', no_research: 'test' }));
  fs.writeFileSync(path.join(v, 'script.txt'), 'Words to say.');
  const run = () => spawnSync(process.execPath, [path.join(REPO, 'studio', 'tools', 'video.mjs'), 'voice', v], { encoding: 'utf8', env: { ...process.env, BAGELUNIT_REEL_ENGINE: tmp() } });
  assert.match(run().stderr, /map has not been approved/);
  fs.writeFileSync(path.join(v, 'outline.md'), '# Map\n'); checks.approve(v, 'map');
  assert.match(run().stderr, /no fact check recorded/);
  checks.recordFacts(v, { scope: 'script', result: 'PASS', cfg: { no_research: 'test' } });
  assert.match(run().stderr, /Reel Kit engine is not installed/);
  fs.appendFileSync(path.join(v, 'outline.md'), 'A new chapter\n');
  assert.match(run().stderr, /changed after it was approved/);
});

await test('qa passes a clean 1920x1080 file and fails a still picture and the wrong size', () => {
  const make = (src) => {
    const d = tmp(); fs.mkdirSync(path.join(d, 'out')); fs.mkdirSync(path.join(d, 'audio'));
    spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=300:d=6', '-af', 'loudnorm=I=-14:TP=-1.5', '-ar', '44100', path.join(d, 'audio', 'vo.mp3')]);
    const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `${src}:rate=30:duration=6`, '-i', path.join(d, 'audio', 'vo.mp3'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(d, 'out', 'video.mp4')]);
    assert.equal(r.status, 0, r.stderr);
    return d;
  };
  const good = checks.qa(make('testsrc2=size=1920x1080'));
  assert.equal(good.result, 'PASS', JSON.stringify(good.checks));
  const still = checks.qa(make('color=c=0x336699:size=1920x1080'));
  assert.equal(still.checks.find((c) => c.name === 'still picture').status, 'FAIL');
  assert.equal(checks.qa(make('testsrc2=size=1080x1920')).checks.find((c) => c.name === 'spec').status, 'FAIL');
});

await test('final approval needs a current QA PASS and a final fact check', () => {
  const d = fakeFolder({ approved: false });
  assert.throws(() => checks.approve(d, 'final'), /no quality check/);
  fs.writeFileSync(path.join(d, 'build', 'qa.json'), JSON.stringify({ result: 'PASS', sha: checks.sha256File(path.join(d, 'out', 'video.mp4')), at: 'x' }));
  assert.throws(() => checks.approve(d, 'final'), /no fact check recorded for the final/);
});

await test('tidy lists first, then removes only what a render makes again', () => {
  const d = tmp();
  for (const f of ['build/scenes/001.mp4', 'build/video.mp4', 'build/voice/001/audio/vo.mp3', 'audio/vo.mp3', 'out/video.mp4']) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), Buffer.alloc(1000)); }
  assert.equal(checks.tidy(d).items.length, 2);
  assert.ok(fs.existsSync(path.join(d, 'build', 'video.mp4')), 'a dry run deletes nothing');
  checks.tidy(d, { apply: true });
  for (const kept of ['build/voice/001/audio/vo.mp3', 'audio/vo.mp3', 'out/video.mp4']) assert.ok(fs.existsSync(path.join(d, kept)), kept);
  assert.ok(!fs.existsSync(path.join(d, 'build', 'scenes')) && !fs.existsSync(path.join(d, 'build', 'video.mp4')));
});

await test('video new inside a brand folder makes videos/<name>', () => {
  const b = tmp(); fs.mkdirSync(path.join(b, 'brand')); fs.writeFileSync(path.join(b, 'brand', 'brand.json'), JSON.stringify({ name: 'Acme' }));
  const r = spawnSync(process.execPath, [path.join(REPO, 'studio', 'tools', 'video.mjs'), 'new', 'first-video', '--style', 'clean-shapes'], { encoding: 'utf8', cwd: b });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(b, 'videos', 'first-video', 'research.md')));
  assert.match(r.stdout, /brand: Acme/);
});


await test('dashboard: each folder lands on the right step, and the person is asked only at their steps', async () => {
  const { load } = await import('../studio/dashboard/model.mjs');
  const root = tmp();
  const mk = (name, files) => { const d = path.join(root, name); fs.mkdirSync(path.join(d, 'build'), { recursive: true }); fs.mkdirSync(path.join(d, 'out'), { recursive: true }); fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes', title: name })); for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); } return d; };
  const R = '# Research\n- a [a](https://example.org/a)\n- b [b](https://example.org/b)\n';
  mk('a-research', { 'research.md': '# Research\n<!-- not researched yet -->\n' });
  mk('b-map', { 'research.md': R, 'outline.md': '# Map\n' });
  const c = mk('c-script', { 'research.md': R, 'outline.md': '# Map\n' }); checks.approve(c, 'map');
  const u = mk('d-done', { 'research.md': R, 'out/youtube-published.json': JSON.stringify({ url: 'https://www.youtube.com/watch?v=x', privacy: 'private', at: '2026-11-12T10:00:00Z' }) });
  const M = load(root);
  const step = Object.fromEntries(M.videos.map((v) => [v.slug, v.step]));
  assert.deepEqual(step, { 'a-research': 'research', 'b-map': 'map', 'c-script': 'script', 'd-done': 'done' });
  assert.ok(M.needs.some((n) => n.video === 'b-map' && n.prio === 'now'), 'the map waits for the person');
  assert.ok(!M.needs.some((n) => n.video === 'a-research' || n.video === 'c-script'), 'Claude\'s steps are not "needs you"');
  assert.equal(M.stats.uploaded, 1);
});

await test('dashboard page: one file, no network requests, names escaped, accent kept readable', async () => {
  const { load } = await import('../studio/dashboard/model.mjs');
  const { html, palette, contrast } = await import('../studio/dashboard/page.mjs');
  const root = tmp(), d = path.join(root, 'x'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes', title: '<img src=x onerror=alert(1)>' }));
  const page = html(load(root));
  assert.ok(!page.includes('<img src=x'), 'a title is text, never markup');
  assert.ok(!/(src|href)=["']?https?:/i.test(page.replace(/<script id="dash-data"[\s\S]*?<\/script>/, '')), 'nothing is loaded from the web');
  assert.ok(/@font-face/.test(page) && /<dialog class="card"/.test(page));
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const a of ['#FFE600', '#E4572E', '#00FF00', '#111111']) { const P = palette(a); assert.ok(contrast(rgb(P.text), rgb('#EFEFEE')) >= 4.5, a); assert.ok(contrast(rgb(P.onNavy), rgb('#14142B')) >= 4.5, a); }
});

await test('video dashboard draws the page in a brand folder and redraws it after a change', () => {
  const b = tmp(); fs.mkdirSync(path.join(b, 'brand')); fs.writeFileSync(path.join(b, 'brand', 'brand.json'), JSON.stringify({ name: 'Acme', colors: { accent: '#2255EE' } }));
  const V = path.join(REPO, 'studio', 'tools', 'video.mjs');
  const r = spawnSync(process.execPath, [V, 'dashboard'], { encoding: 'utf8', cwd: b });
  assert.equal(r.status, 0, r.stderr);
  const page = path.join(b, 'videos', 'video-dashboard.html');
  assert.match(fs.readFileSync(page, 'utf8'), /Acme/);
  spawnSync(process.execPath, [V, 'new', 'first', '--style', 'clean-shapes', '--title', 'First video'], { encoding: 'utf8', cwd: b });
  assert.match(fs.readFileSync(page, 'utf8'), /First video/, 'the page was redrawn after video new');
});


await test('sound effects: a whoosh per chapter by default, cuts only when asked, a scene\'s own cues, off means none', () => {
  const items = [{ time: { t0: 0 }, scene: { chapter: 'A' } }, { time: { t0: 8 }, scene: {} }, { time: { t0: 16 }, scene: { chapter: 'B', sfx: [{ at: 2, name: 'pop', gain: 3 }] } }, { time: { t0: 30 }, scene: { sfx: 'boom' } }];
  const names = (cfg) => scenes.sfxCues(items, cfg).map((c) => `${c.name}@${c.t.toFixed(2)}`);
  assert.deepEqual(names({}), ['whoosh@15.88', 'pop@18.00', 'boom@30.00']);
  assert.deepEqual(names({ sfx: 'scenes' }), ['swoosh@7.92', 'whoosh@15.88', 'pop@18.00', 'swoosh@29.92', 'boom@30.00']);
  assert.deepEqual(names({ sfx: 'off' }), []);
  assert.ok(scenes.sfxCues(items, {}).every((c) => c.gain <= 0), 'a scene cannot push an effect over the house level');
});

console.log(n ? `\n${n} test(s) passed` : '');
