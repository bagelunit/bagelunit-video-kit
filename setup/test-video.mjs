#!/usr/bin/env node
// Tests for the Video Kit that need no key, no network and no browser: script chunking, chapters, YouTube text and
// limits, the upload flow against a fake YouTube (dry run, session saved first, resume, never twice, stand-in refused, the
// right channel), installing Google's client file,
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

const approveFinal = (d, { watched = true } = {}) => { fs.writeFileSync(path.join(d, 'build', 'approvals.json'), JSON.stringify({ final: { at: 'test', watched, files: Object.fromEntries(['video.mp4', 'thumbnail.jpg', 'youtube.txt', 'pinned-comment.txt'].map((x) => [x, checks.sha256File(path.join(d, 'out', x))])) } })); };
const fakeFolder = ({ standIn = false, approved = true, watched = true } = {}) => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'out'), { recursive: true }); fs.mkdirSync(path.join(d, 'audio'), { recursive: true }); fs.mkdirSync(path.join(d, 'build'), { recursive: true });
  fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes', title: 'T' }));
  fs.writeFileSync(path.join(d, 'out', 'video.mp4'), Buffer.alloc(5000, 7));
  fs.writeFileSync(path.join(d, 'out', 'youtube.txt'), 'How volcanoes work\n\nA short description.');
  fs.writeFileSync(path.join(d, 'out', 'chapters.txt'), '0:00 One\n0:30 Two\n1:00 Three\n');
  fs.writeFileSync(path.join(d, 'audio', 'vo.mp3'), 'voice');
  if (standIn) fs.writeFileSync(path.join(d, 'build', 'voice-stand-in.json'), JSON.stringify({ sha: createHash('sha256').update('voice').digest('hex') }));
  if (approved) approveFinal(d, { watched });
  return d;
};
const cred = (scope) => { const c = tmp(); fs.writeFileSync(path.join(c, 'youtube-default.json'), JSON.stringify({ client_id: 'id', client_secret: 'secret-xyz', refresh_token: 'rt', ...(scope ? { scope } : {}) })); return c; };
function fakeYouTube({ cut = false, channel = null } = {}) {
  const video = JSON.stringify({ id: 'vid1', ...(channel ? { snippet: { channelId: channel } } : {}) });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, method: init.method, body: init.body });
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (u.includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { location: 'https://upload.example/session1' } });
    if (u.startsWith('https://upload.example/')) {
      if (init.headers?.['Content-Range']?.startsWith('bytes */')) return cut ? new Response('', { status: 308, headers: { range: 'bytes=0-1999' } }) : new Response(video, { status: 200 });
      if (init.body && typeof init.body.on === 'function') { for await (const _ of init.body) {} }
      return new Response(video, { status: 200 });
    }
    if (u.includes('thumbnails/set')) return new Response('{}', { status: 200 });
    if (u.includes('youtube/v3/captions')) return new Response(JSON.stringify({ id: 'cap1' }), { status: 200 });
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

await test('login --client: Google\'s downloaded file becomes each channel\'s sign-in file, private, nothing printed, download deleted', () => {
  const c = tmp(), dl = tmp(), src = path.join(dl, 'client_secret_123.apps.googleusercontent.com.json');
  const google = { installed: { client_id: 'cid-1', project_id: 'p', auth_uri: 'https://accounts.google.com/o/oauth2/auth', client_secret: 'secret-xyz', redirect_uris: ['http://localhost'] } };
  fs.writeFileSync(src, JSON.stringify(google));
  fs.writeFileSync(path.join(c, 'youtube-old.json'), JSON.stringify({ client_id: 'cid-1', client_secret: 'secret-xyz', refresh_token: 'rt-old' }));
  fs.writeFileSync(path.join(c, 'youtube-other.json'), JSON.stringify({ client_id: 'cid-0', client_secret: 's0', refresh_token: 'rt-0' }));
  const done = yt.installClient(src, ['space', 'old', 'other', 'space'], { dir: c });
  assert.deepEqual(done.map((d) => [d.slug, d.signedIn]), [['space', false], ['old', true], ['other', false]]);
  assert.equal(done.removed, true); assert.ok(!fs.existsSync(src), 'the download is deleted');
  const space = JSON.parse(fs.readFileSync(path.join(c, 'youtube-space.json'), 'utf8'));
  assert.deepEqual(space, { client_id: 'cid-1', client_secret: 'secret-xyz' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(c, 'youtube-old.json'), 'utf8')).refresh_token, 'rt-old', 'same client: the sign-in is kept');
  assert.ok(!('refresh_token' in JSON.parse(fs.readFileSync(path.join(c, 'youtube-other.json'), 'utf8'))), 'another client: its sign-in is dropped');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(c, 'youtube-space.json')).mode & 0o777, 0o600);
  assert.equal(yt.readCredentials('space', { dir: c, reelDir: tmp() }).cfg.client_id, 'cid-1');
  // another channel's sign-in file as the source: only the client is taken, the file stays
  const r = yt.installClient(path.join(c, 'youtube-old.json'), ['newer'], { dir: c });
  assert.equal(r.removed, false); assert.ok(fs.existsSync(path.join(c, 'youtube-old.json')));
  assert.ok(!('refresh_token' in JSON.parse(fs.readFileSync(path.join(c, 'youtube-newer.json'), 'utf8'))), 'never another channel\'s sign-in');
  // the wrong kind of file, said without the secret
  const web = path.join(dl, 'web.json'); fs.writeFileSync(web, JSON.stringify({ web: { client_id: 'w', client_secret: 'secret-xyz' } }));
  assert.throws(() => yt.installClient(web, ['x'], { dir: c }), (e) => /Desktop app/.test(e.message) && !/secret-xyz/.test(e.message));
  const blank = path.join(dl, 'blank.json'); fs.writeFileSync(blank, JSON.stringify({ installed: { client_id: 'PASTE-CLIENT-ID-HERE' } }));
  assert.throws(() => yt.installClient(blank, ['x'], { dir: c }), /no client_id/);
  assert.ok(fs.existsSync(web) && !fs.existsSync(path.join(c, 'youtube-x.json')), 'nothing written or deleted on a refusal');
});

await test('--all reads every registered channel by the slug in its brand.json today; folders that are gone are skipped', () => {
  const a = tmp(), b = tmp(), reg = path.join(tmp(), 'channels.json');
  fs.mkdirSync(path.join(a, 'brand')); fs.writeFileSync(path.join(a, 'brand', 'brand.json'), JSON.stringify({ slug: 'renamed' }));
  fs.writeFileSync(reg, JSON.stringify([{ slug: 'first', dir: a }, { slug: 'second', dir: b }, { slug: 'gone', dir: path.join(b, 'nope') }]));
  assert.deepEqual(yt.registeredSlugs(reg), ['renamed', 'second']);
  assert.deepEqual(yt.registeredSlugs(path.join(tmp(), 'none.json')), []);
});

await test('after an upload the channel is checked: a wrong Brand Account is a loud warning, no thumbnail; none saved yet prints it', async () => {
  const setup = (channelId) => {
    const ch = tmp(); fs.mkdirSync(path.join(ch, 'brand')); fs.mkdirSync(path.join(ch, 'videos'));
    fs.writeFileSync(path.join(ch, 'brand', 'brand.json'), JSON.stringify({ name: 'Space', slug: 'space', youtube: { privacy: 'private', channel_id: channelId } }));
    const v = path.join(ch, 'videos', 'v1'); fs.cpSync(fakeFolder(), v, { recursive: true });
    fs.writeFileSync(path.join(v, 'out', 'thumbnail.jpg'), 'jpg'); approveFinal(v);
    const c = tmp(); fs.writeFileSync(path.join(c, 'youtube-space.json'), JSON.stringify({ client_id: 'id', client_secret: 's', refresh_token: 'rt' }));
    return { v, c };
  };
  let s = setup('UCright'), f = fakeYouTube({ channel: 'UCwrong' }), lines = [];
  let r = await yt.upload(s.v, { yes: true, fetchImpl: f.fetchImpl, credDir: s.c, log: (x) => lines.push(x) });
  assert.equal(r.wrongChannel, true); assert.ok(lines.join('\n').includes('WRONG CHANNEL') && lines.join('\n').includes('UCright'));
  assert.ok(!f.calls.some((x) => x.url.includes('thumbnails')), 'no thumbnail on the wrong channel');
  const pub = JSON.parse(fs.readFileSync(path.join(s.v, 'out', 'youtube-published.json'), 'utf8'));
  assert.equal(pub.channel_id, 'UCwrong'); assert.equal(pub.wrong_channel, true);
  s = setup('UCright'); f = fakeYouTube({ channel: 'UCright' }); lines = [];
  r = await yt.upload(s.v, { yes: true, fetchImpl: f.fetchImpl, credDir: s.c, log: (x) => lines.push(x) });
  assert.equal(r.wrongChannel, false); assert.ok(!lines.join('\n').includes('WRONG')); assert.ok(f.calls.some((x) => x.url.includes('thumbnails')));
  s = setup(''); f = fakeYouTube({ channel: 'UCfirst' }); lines = [];
  r = await yt.upload(s.v, { yes: true, fetchImpl: f.fetchImpl, credDir: s.c, log: (x) => lines.push(x) });
  assert.equal(r.wrongChannel, false); assert.ok(lines.some((x) => x.includes('UCfirst') && x.includes('youtube.channel_id')));
});

await test('styles are wide, registered, and every file matches its fingerprint', () => {
  const reg = scenes.registry();
  assert.equal(reg.format, 'wide'); assert.deepEqual(reg.size, [1920, 1080]);
  assert.equal(scenes.sceneStyleIds().length, 20);
  assert.ok(scenes.sceneStyleIds().includes('deep-zoom'));
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


await test('thumbnail words: 2 to 5 of them, and not a copy of the title', async () => {
  const { thumbnailNotes } = await import('../studio/tools/video.mjs');
  assert.deepEqual(thumbnailNotes('Jupiter eats *Earth*', 'How big is Jupiter, really?'), []);
  assert.ok(thumbnailNotes('one two three four five six', '').some((n) => /6 words/.test(n)));
  assert.ok(thumbnailNotes('How big is Jupiter', 'How big is Jupiter, really?').some((n) => /repeats the title/.test(n)));
});


await test('reels: stretches per chapter, ranges checked, numbering never reuses a reel, research lines found in nested props', async () => {
  const R = await import('../studio/tools/reels.mjs');
  const b = tmp(); fs.mkdirSync(path.join(b, 'brand')); fs.writeFileSync(path.join(b, 'brand', 'brand.json'), '{}'); fs.mkdirSync(path.join(b, 'reels', 'space-reel-2'), { recursive: true });
  const d = path.join(b, 'videos', 'space'); fs.mkdirSync(path.join(d, 'build'), { recursive: true });
  const scenesList = Array.from({ length: 8 }, (_, i) => ({ template: 't', props: i === 5 ? { levels: [{ label: 'Earth', note: '12,742 km' }] } : {}, narration: `Scene ${i + 1} says a few words here.`, ...(i % 4 === 0 ? { chapter: `Part ${i / 4 + 1}` } : {}) }));
  fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify({ scenes: scenesList }));
  fs.writeFileSync(path.join(d, 'build', 'scene_times.json'), JSON.stringify(scenesList.map((_, i) => ({ t0: i * 10, t1: (i + 1) * 10 }))));
  fs.writeFileSync(path.join(d, 'research.md'), '- Earth is 12,742 km wide [a](https://example.org/a)\n- Mars is 6,779 km wide [b](https://example.org/b)\n');
  const { suggestions } = R.suggest(d);
  assert.deepEqual(suggestions.map((x) => [x.from, x.to]), [[1, 4], [5, 8]]);
  assert.throws(() => R.parsePick('7-9', 8), /scenes 1 to 8/);
  const plans = R.planReels({ dir: d, name: 'space', cfg: { style: 'clean-shapes' } }, R.parsePick('1-2,5-6', 8));
  assert.deepEqual(plans.map((p) => p.slug), ['space-reel-3', 'space-reel-4']);
  assert.deepEqual(plans[1].facts, ['- Earth is 12,742 km wide [a](https://example.org/a)']);
  assert.ok(plans.every((p) => p.scenes.every((x) => !('chapter' in x))), 'chapters stay with the video');
});


await test('channel folders: named <channel>-videos, never over files, started from a reels brand as a copy', async () => {
  const W = await import('./new-workspace.mjs');
  const root = tmp(), registry = path.join(tmp(), 'channels.json');
  assert.equal(path.basename(W.folderFor(path.join(root, 'Space Facts'))), 'space-facts-videos');
  assert.equal(path.basename(W.folderFor(path.join(root, 'acme-videos'))), 'acme-videos');
  const r = W.makeWorkspace(path.join(root, 'space'), { registry });
  for (const f of ['CLAUDE.md', 'brand/brand.json', 'brand/facts.md', 'brand/voice.md', '.claude/skills/channel-setup/SKILL.md']) assert.ok(fs.existsSync(path.join(r.dir, f)), f);
  assert.equal(JSON.parse(fs.readFileSync(path.join(r.dir, 'brand', 'brand.json'), 'utf8')).slug, 'space');
  assert.throws(() => W.makeWorkspace(path.join(root, 'space'), { registry }), /already has files/);
  const reels = tmp(); fs.mkdirSync(path.join(reels, 'brand'));
  fs.writeFileSync(path.join(reels, 'brand', 'brand.json'), JSON.stringify({ name: 'acme', slug: 'acme', niche: { topic: 'AI for small shops', keywords: ['ai tools'] }, colors: { accent: '#2255EE' }, voice: { voice_id: 'v1', voice_name: 'Brian', pronunciation: { acme: 'ack me' } }, cta: { default: 'follow' } }));
  fs.writeFileSync(path.join(reels, 'brand', 'facts.md'), '# facts\n| a | b | c | d |\n');
  const r2 = W.makeWorkspace(path.join(root, 'acme'), { reels, registry });
  const b = JSON.parse(fs.readFileSync(path.join(r2.dir, 'brand', 'brand.json'), 'utf8'));
  assert.equal(b.name, 'acme'); assert.equal(b.voice.voice_id, 'v1'); assert.equal(b.voice.speed, 1); assert.deepEqual(b.niche.search_terms, ['ai tools']);
  assert.equal(b.reels_folder, reels); assert.equal(b.cta.line, '', 'a reel call to action is not a video one');
  assert.ok(!fs.lstatSync(path.join(r2.dir, 'brand')).isSymbolicLink(), 'each channel owns its brand files');
  assert.equal(JSON.parse(fs.readFileSync(registry, 'utf8')).length, 2);
});

await test('a channel folder names the YouTube sign-in and the default privacy; never public by default', async () => {
  const ch = tmp(); fs.mkdirSync(path.join(ch, 'brand')); fs.mkdirSync(path.join(ch, 'videos'));
  fs.writeFileSync(path.join(ch, 'brand', 'brand.json'), JSON.stringify({ name: 'Space', slug: 'space', youtube: { privacy: 'unlisted' } }));
  const d = fakeFolder(); const v = path.join(ch, 'videos', 'v1'); fs.cpSync(d, v, { recursive: true });
  const c = tmp(); fs.writeFileSync(path.join(c, 'youtube-space.json'), JSON.stringify({ client_id: 'id', client_secret: 's', refresh_token: 'rt' }));
  const r = await yt.upload(v, { fetchImpl: fakeYouTube().fetchImpl, credDir: c, log: () => {} });
  assert.equal(r.meta.status.privacyStatus, 'unlisted');
  fs.writeFileSync(path.join(ch, 'brand', 'brand.json'), JSON.stringify({ name: 'Space', slug: 'space', youtube: { privacy: 'public' } }));
  assert.equal((await yt.upload(v, { fetchImpl: fakeYouTube().fetchImpl, credDir: c, log: () => {} })).meta.status.privacyStatus, 'private');
  const f = fakeYouTube();
  await yt.upload(v, { yes: true, fetchImpl: f.fetchImpl, credDir: c, log: () => {} });   // uses youtube-space.json, not youtube-default.json
  assert.ok(f.calls.some((x) => x.url.includes('token')));
});

await test('reels from a channel folder go to the linked Reel Kit brand folder', async () => {
  const R = await import('../studio/tools/reels.mjs');
  const reels = tmp(); fs.mkdirSync(path.join(reels, 'brand')); fs.writeFileSync(path.join(reels, 'brand', 'brand.json'), '{}'); fs.mkdirSync(path.join(reels, 'reels'));
  const ch = tmp(); fs.mkdirSync(path.join(ch, 'brand')); fs.writeFileSync(path.join(ch, 'brand', 'brand.json'), JSON.stringify({ slug: 'space', reels_folder: reels }));
  const d = path.join(ch, 'videos', 'moon'); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify({ scenes: [{ template: 't', props: {}, narration: 'One two three.' }] }));
  const [p] = R.planReels({ dir: d, name: 'moon', cfg: { style: 'clean-shapes' } }, [[1, 1]]);
  assert.equal(p.dir, path.join(reels, 'reels', 'moon-reel-1'));
  fs.writeFileSync(path.join(ch, 'brand', 'brand.json'), JSON.stringify({ slug: 'space' }));
  assert.throws(() => R.planReels({ dir: d, name: 'moon', cfg: { style: 'clean-shapes' } }, [[1, 1]]), /reels_folder/);
});


/* ── 2026-11-13 batch: pauses, word clock, render cache, captions, music, end card, thumbnail, YouTube, review ─────── */
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const probe = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout);
const maxVolume = (f, ss, t) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr); return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null; };
const sc = (n, narration, extra = {}) => ({ n, id: `s${n}`, narration, ...extra });
const W = (list) => list.map(([w, s, e]) => ({ w, s, e }));

await test('pause: silence goes between words before the scene, words after move on, a straddling word is cut at the splice', () => {
  const words = W([['one', 0.1, 0.4], ['two', 0.5, 0.9], ['three', 1.2, 1.5], ['four', 1.6, 1.9]]);
  const plan = [sc(1, 'one two'), sc(2, 'three four', { pause: 4 })];
  const placed = scenes.placePauses(plan, words, 2.2);
  assert.deepEqual(placed.map((p) => [p.n, p.at, p.seconds]), [[2, 1.05, 4]]);
  const r = scenes.applyPauses(words, placed);
  assert.deepEqual(r.words.map((w) => [w.s, w.e]), [[0.1, 0.4], [0.5, 0.9], [5.2, 5.5], [5.6, 5.9]]);
  assert.deepEqual(r.splices[0], { n: 2, id: 's2', seconds: 4, at: 1.05, from: 1.05 });
  // a word that straddles the splice (the field case: it got a 4 s end) is cut at it
  const bad = W([['one', 0.1, 0.4], ['two', 0.5, 1.3], ['three', 1.2, 1.5]]);
  const cut = scenes.applyPauses(bad, [{ n: 2, id: 's2', seconds: 4, at: 1.1 }]);
  assert.equal(cut.clamped, 1);
  assert.deepEqual(cut.words[1], { w: 'two', s: 0.5, e: 1.1 });
  assert.ok(cut.words.every((w) => w.e - w.s < 1), 'no word holds the silence');
  // an intro with no words goes at the start, an end card at the end; two pauses in one place keep the scene order
  const intro = scenes.placePauses([sc(1, '', { pause: 3 }), sc(2, 'one two three four')], words, 2.2);
  assert.equal(intro[0].at, 0);
  const end = scenes.placePauses([sc(1, 'one two three four'), sc(2, '', { pause: 5 })], words, 2.2);
  assert.equal(end[0].at, 2.2);
  const two = scenes.applyPauses(words, [{ n: 3, seconds: 1, at: 1.05 }, { n: 2, seconds: 2, at: 1.05 }]);
  assert.deepEqual(two.splices.map((p) => [p.n, p.at]), [[2, 1.05], [3, 3.05]]);
  assert.equal(two.words[2].s, 4.2);
});

await test('pause: the scene owns its silence, and the scene after a wordless intro keeps its full length', () => {
  const plan = [sc(1, 'one two'), sc(2, '', { pause: 4 }), sc(3, 'three four five six seven eight')];
  const words = W([['one', 0.1, 0.4], ['two', 0.5, 0.9], ['three', 1.2, 1.5], ['four', 1.6, 1.9], ['five', 2, 2.3], ['six', 2.4, 2.7], ['seven', 2.8, 3.1], ['eight', 3.2, 3.5]]);
  const r = scenes.applyPauses(words, scenes.placePauses(plan, words, 3.8));
  const t = scenes.timeScenes(plan, r.words, { voLength: 8.3, pauses: r.splices });
  assert.ok(Math.abs(t[1].t0 - 1.05) < 0.034 && Math.abs(t[1].t1 - (5.2 - 0.15)) < 0.034, JSON.stringify(t[1]));
  assert.ok(t[2].t1 - t[2].t0 > 2.5, `scene 3 lasts ${t[2].t1 - t[2].t0}`);
  assert.ok(Math.abs(t.at(-1).t1 - 8.3) < 0.034);
});

const chunkDir = (root, name, words, len) => {
  const d = path.join(root, 'build', 'voice', name); fs.mkdirSync(path.join(d, 'audio'), { recursive: true }); fs.mkdirSync(path.join(d, 'build'), { recursive: true });
  fs.writeFileSync(path.join(d, 'build', 'words.json'), JSON.stringify(words));
  ff(['-f', 'lavfi', '-i', `sine=frequency=220:duration=${len}`, '-ac', '1', path.join(d, 'audio', 'vo.mp3')]);
  return d;
};

await test('video voice joins with the pause spliced into vo.mp3, the clock shifted, build/pauses.json written', async () => {
  const { joinVoice } = await import('../studio/tools/video.mjs');
  const dir = tmp();
  const a = chunkDir(dir, '001', W([['alpha', 0.1, 0.6], ['beta', 0.8, 1.4]]), 1.6);
  const b = chunkDir(dir, '002', W([['gamma', 0.1, 0.7], ['delta', 0.9, 1.5]]), 1.6);
  const plan = [sc(1, 'alpha beta'), sc(2, 'gamma delta', { pause: 3 })];
  const lines = [];
  const r = joinVoice(dir, [a, b], { plan, log: (x) => lines.push(x) });
  const len = probe(path.join(dir, 'audio', 'vo.mp3'));
  assert.ok(Math.abs(len - (1.6 + 0.45 + 1.6 + 3)) < 0.1, `length ${len}`);
  const w = JSON.parse(fs.readFileSync(path.join(dir, 'build', 'words.json'), 'utf8'));
  const at = r.splices[0].at;
  assert.ok(at > 1.4 && at < 2.15, `splice at ${at}`);
  assert.ok(Math.abs(w[2].s - (2.05 + 0.1 + 3)) < 0.01, `gamma at ${w[2].s}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'build', 'pauses.json'), 'utf8')).map((p) => [p.n, p.seconds]), [[2, 3]]);
  assert.ok(maxVolume(path.join(dir, 'audio', 'vo.mp3'), at + 0.3, 2.4) < -60, 'silence where the pause is');
  assert.ok(maxVolume(path.join(dir, 'audio', 'vo.mp3'), w[2].s, 0.5) > -30, 'the voice after it');
  assert.ok(lines.some((x) => /pauses: 3.00 s for scene 2/.test(x)));
  assert.equal(r.warnings.length, 0);
  // no pause: no pauses.json, and the old join
  joinVoice(dir, [a, b], { plan: [sc(1, 'alpha beta'), sc(2, 'gamma delta')], log: () => {} });
  assert.ok(!fs.existsSync(path.join(dir, 'build', 'pauses.json')));
  assert.ok(Math.abs(probe(path.join(dir, 'audio', 'vo.mp3')) - 3.65) < 0.05, 'the 0.45 s breath between chunks is in the audio, as the word clock counts it');
  assert.ok(maxVolume(path.join(dir, 'audio', 'vo.mp3'), 1.7, 0.25) < -60, 'silence in the breath');
  assert.ok(maxVolume(path.join(dir, 'audio', 'vo.mp3'), 2.15, 0.4) > -30, 'the second chunk starts where its words say');
});

await test('word clock check: a chunk whose words run past its audio is a warning with both times', async () => {
  const { joinVoice } = await import('../studio/tools/video.mjs');
  assert.equal(scenes.clockCheck(W([['a', 0, 1]]), 1.02), null);
  assert.match(scenes.clockCheck(W([['a', 527, 529.1]]), 527.75), /1\.35 s past the audio \(the last word ends at 529\.10 s, the audio at 527\.75 s\)/);
  const dir = tmp();
  const a = chunkDir(dir, '001', W([['alpha', 0.1, 0.6], ['beta', 0.8, 2.9]]), 1.5);
  const lines = [];
  const r = joinVoice(dir, [a], { log: (x) => lines.push(x) });
  assert.ok(r.warnings.some((x) => /chunk 1/.test(x) && /2\.90 s/.test(x)), r.warnings.join('\n'));
  assert.ok(lines.some((x) => x.startsWith('WARNING:')));
});

const sceneVideo = (pauseOn = null) => {
  const d = tmp();
  const defs = scenes.styleInfo('clean-shapes').templateDefs.slice(0, 4);
  const list = defs.map((t, i) => ({ template: t.id, props: t.exampleProps || {}, narration: t.exampleNarration || `Scene ${i} words here.`, ...(i + 1 === pauseOn ? { pause: 2 } : {}) }));
  fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes', title: 'T' }));
  fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify({ scenes: list }));
  fs.writeFileSync(path.join(d, 'script.txt'), list.map((s) => s.narration).join('\n\n'));
  return d;
};
const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

await test('render cache: a pause re-draws only the scene it is in; scenes that only moved keep their picture', async () => {
  const d = sceneVideo();
  const v = { dir: d, cfg: { style: 'clean-shapes' } };
  await quiet(() => scenes.standIn(v));
  const before = scenes.buildPages(v, scenes.prepare(v));
  const s = JSON.parse(fs.readFileSync(path.join(d, 'scenes.json'), 'utf8')); s.scenes[1].pause = 2; fs.writeFileSync(path.join(d, 'scenes.json'), JSON.stringify(s));
  const stale = scenes.prepare(v);
  assert.ok(stale.notes.some((n) => /not in the voice yet/.test(n)), 'a pause not yet in the voice is noted');
  await quiet(() => scenes.standIn(v));
  const prep = scenes.prepare(v);
  assert.equal(prep.pauses.length, 1);
  const after = scenes.buildPages(v, prep);
  assert.equal(after[0].hash, before[0].hash, 'scene 1: same picture');
  assert.notEqual(after[1].hash, before[1].hash, 'scene 2 holds the pause');
  assert.equal(after[2].hash, before[2].hash, 'scene 3 moved by 2 s, same picture');
  assert.notEqual(after[2].audio, before[2].audio, '... but its slice of the voice moved, so its clip sound is made again');
  assert.ok(Math.abs(after[2].time.t0 - before[2].time.t0 - 2) < 1e-6);
  assert.ok(after[1].time.t1 - after[1].time.t0 > before[1].time.t1 - before[1].time.t0 + 1.9);
});

await test('captions: two lines of 42 at most, a new caption per sentence and at pauses, names spelled their real way', async () => {
  const { captionCues, srt, captionLines } = await import('../studio/tools/video.mjs');
  const text = 'Volcanoes are openings in the crust where melted rock, gas and ash escape from deep below. Ack me Labs measured one. It erupted for nine days, and then it stopped, quite suddenly, without any warning at all for the people nearby.';
  const words = fakeWordsFor(text);
  const cues = captionCues(words, { pronunciation: { acme: 'ack me' } });
  assert.ok(cues.every((c) => c.lines.length <= 2 && c.lines.every((l) => l.length <= 42)), JSON.stringify(cues));
  assert.ok(cues.every((c, i) => c.end > c.start && (i === 0 || c.start >= cues[i - 1].end)), 'no overlaps');
  assert.ok(cues.every((c) => c.end - c.start <= 7));
  assert.ok(cues.some((c) => c.lines.join(' ').startsWith('Acme Labs')), 'respelled: ' + cues.map((c) => c.lines.join(' / ')).join(' | '));
  assert.ok(cues.some((c) => /below\.$/.test(c.lines.at(-1))), 'a sentence ends its caption');
  assert.deepEqual(captionLines(W([['short', 0, 1]])), ['short']);
  const gap = captionCues(W([['before', 0, 0.5], ['after', 4, 4.5]]));
  assert.equal(gap.length, 2, 'a pause starts a new caption');
  assert.equal(gap[0].end, 1, 'held for at least 1 s');
  assert.match(srt(gap), /^1\n00:00:00,000 --> 00:00:01,000\nbefore\n\n2\n00:00:04,000 --> 00:00:05,000\nafter\n$/);
});
function fakeWordsFor(text) { return scenes.fakeWords(text, 0.38); }

await test('video captions writes out/captions.<lang>.srt in the channel language; the upload refuses it once the voice changed', async () => {
  const ch = tmp(); fs.mkdirSync(path.join(ch, 'brand')); fs.writeFileSync(path.join(ch, 'brand', 'brand.json'), JSON.stringify({ slug: 'space', youtube: { language: 'es' } }));
  const v = path.join(ch, 'videos', 'v1'); fs.cpSync(fakeFolder(), v, { recursive: true });
  scenes.writeWords(v, fakeWordsFor('Hola a todos. Esto es una prueba.'));
  const r = spawnSync(process.execPath, [path.join(REPO, 'studio', 'tools', 'video.mjs'), 'captions', v], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const f = path.join(v, 'out', 'captions.es.srt');
  assert.match(fs.readFileSync(f, 'utf8'), /^1\n00:00:00,350 --> /);
  assert.deepEqual(yt.captionFiles(v).map((x) => x.language), ['es']);
  assert.deepEqual(yt.staleCaptions(v), []);
  scenes.writeWords(v, fakeWordsFor('Hola a todos. Esto es otra prueba.'));
  await assert.rejects(yt.upload(v, { fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: () => {} }), /captions\.es\.srt was made before the voice last changed/);
});

await test('music bed: cut to the video, fade-in and fade-out, looped only when shorter, 3 s fade-out by default', () => {
  assert.deepEqual(scenes.musicFade({}), [0, 3]);
  assert.deepEqual(scenes.musicFade({ music_fade: [3, 8] }), [3, 8]);
  assert.throws(() => scenes.musicFade({ music_fade: 4 }), /music_fade/);
  assert.equal(scenes.musicBed({ seconds: 60, musicLength: 90 }).loop, false);
  assert.equal(scenes.musicBed({ seconds: 60, musicLength: 20 }).loop, true);
  assert.deepEqual(scenes.musicBed({ seconds: 4, fade: [3, 5] }).fade.map((x) => +x.toFixed(2)), [1.5, 2.5]);
  const d = tmp(), m = path.join(d, 'm.wav'), out = path.join(d, 'bed.wav');
  ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', m]);
  const bed = scenes.musicBed({ seconds: 6, musicLength: probe(m), fade: [1, 2], volume: 1 });
  ff([...(bed.loop ? ['-stream_loop', '-1'] : []), '-i', m, '-filter_complex', `[0:a]${bed.chain}[a]`, '-map', '[a]', out]);
  assert.ok(Math.abs(probe(out) - 6) < 0.05, `length ${probe(out)}`);
  assert.ok(maxVolume(out, 0, 0.05) < maxVolume(out, 2.5, 0.5) - 20, 'fades in');
  assert.ok(maxVolume(out, 5.9, 0.1) < maxVolume(out, 3, 0.5) - 15, 'fades out at the very end, not cut');
});

await test('qa: an end card after the voice passes the length check, and its still picture is the card, not a fault', () => {
  const d = tmp(); fs.mkdirSync(path.join(d, 'out')); fs.mkdirSync(path.join(d, 'audio'));
  ff(['-f', 'lavfi', '-i', 'sine=f=300:d=4', '-af', 'loudnorm=I=-14:TP=-1.5', '-ar', '44100', path.join(d, 'audio', 'vo.mp3')]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'color=c=0x336699:size=1920x1080:rate=30:duration=6', '-i', path.join(d, 'audio', 'vo.mp3'),
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v];[2:a]apad,atrim=0:10[a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(d, 'out', 'video.mp4')]);
  const plain = checks.qa(d, { cfg: {} });
  assert.equal(plain.checks.find((c) => c.name === 'length').status, 'FAIL');
  assert.equal(plain.checks.find((c) => c.name === 'still picture').status, 'FAIL');
  const card = checks.qa(d, { cfg: { end_card: 6 } });
  assert.equal(card.checks.find((c) => c.name === 'length').status, 'PASS', JSON.stringify(card.checks));
  assert.notEqual(card.checks.find((c) => c.name === 'still picture').status, 'FAIL', JSON.stringify(card.checks));
  assert.match(card.checks.find((c) => c.name === 'still picture').text, /end card/);
  const t = scenes.timeScenes([sc(1, 'one two')], W([['one', 0.1, 0.4], ['two', 0.5, 0.9]]), { voLength: 1.6, endCard: 5 });
  assert.ok(Math.abs(t[0].t1 - 6.6) < 0.034, JSON.stringify(t));
});

await test('thumbnail --plain: no accent-coloured word', async () => {
  const { thumbPage } = await import('../studio/tools/video.mjs');
  const opts = { accent: '#FFD23F', font: null, side: 'left' };
  assert.match(thumbPage('x.jpg', 'Jupiter eats *Earth*', opts), /<b>Earth<\/b>/);
  const plain = thumbPage('x.jpg', 'Jupiter eats *Earth*', { ...opts, plain: true });
  assert.ok(!/<b>/.test(plain) && /Jupiter eats Earth/.test(plain));
});

await test('YouTube text: tags counted as YouTube does, language and publish time checked, sources added once', () => {
  assert.equal(yt.tagChars(['volcano', 'how volcanoes form', '  ', ' lava ']), 7 + 20 + 4 + 2);
  const m = yt.metadata({ title: 'T', description: 'D' }, { privacy: 'private', tags: [' a ', ''], language: 'en', publishAt: '2026-12-01T23:00:00.000Z' });
  assert.deepEqual(m.snippet.tags, ['a']); assert.equal(m.snippet.defaultAudioLanguage, 'en'); assert.equal(m.status.publishAt, '2026-12-01T23:00:00.000Z');
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.match(yt.publishTime('2026-11-17', { privacy: 'private', now }).why, /offset/);
  assert.match(yt.publishTime('2026-11-17T18:00:00', { privacy: 'private', now }).why, /offset/);
  assert.match(yt.publishTime('2026-11-13T12:05:00Z', { privacy: 'private', now }).why, /15 minutes/);
  assert.match(yt.publishTime('2026-11-17T18:00:00-05:00', { privacy: 'unlisted', now }).why, /--privacy private/);
  assert.equal(yt.publishTime('2026-11-17T18:00:00-05:00', { privacy: 'private', now }).at, '2026-11-17T23:00:00.000Z');
  const research = '# Research\n- a fact [a](https://example.org/a)\n## Sources\n1. [Survey 2025](https://example.org/survey) by them\n2. https://example.org/other\n';
  const src = yt.researchSources(research);
  assert.deepEqual(src.map((x) => x.url), ['https://example.org/survey', 'https://example.org/other']);
  assert.match(yt.withSources('About it.', src).description, /About it\.\n\nSources:\nSurvey 2025: https:\/\/example.org\/survey\nhttps:\/\/example.org\/other$/);
  assert.equal(yt.withSources('About it.\n\nSources: https://example.org/survey', src).added, 0);
  assert.equal(yt.withSources('About it.', yt.researchSources(checks.RESEARCH_PAGE)).added, 0, 'the empty page has no sources');
  assert.equal(yt.withSources('x'.repeat(4990), src).added, 0, 'never over the limit');
});

await test('upload dry run: bad tags, language and schedule are refused; the description gets the sources; pinned comment shown, never posted', async () => {
  const d = fakeFolder();
  const cfg = (x) => fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes', title: 'T', ...x }));
  const dry = (lines = []) => yt.upload(d, { fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: (x) => lines.push(x) });
  cfg({ tags: Array.from({ length: 60 }, (_, i) => `tag number ${i}`) }); await assert.rejects(dry(), /YouTube allows 500/);
  cfg({ tags: 'one, two' }); await assert.rejects(dry(), /must be a list/);
  cfg({ language: 'English' }); await assert.rejects(dry(), /not a language code/);
  cfg({ publish_at: '2020-01-01T00:00:00Z' }); await assert.rejects(dry(), /15 minutes/);
  cfg({ publish_at: '2099-01-01T10:00:00+01:00', tags: ['volcanoes'], language: 'en' });
  fs.writeFileSync(path.join(d, 'research.md'), '# Research\n## Sources\n1. [Survey](https://example.org/survey)\n');
  const lines = [];
  let r = await dry(lines);
  assert.equal(r.meta.status.publishAt, '2099-01-01T09:00:00.000Z');
  assert.match(r.meta.snippet.description, /Sources:\nSurvey: https:\/\/example.org\/survey$/);
  assert.ok(lines.join('\n').includes('sources:     1 added from research.md') && lines.join('\n').includes('watched:     yes'));
  fs.writeFileSync(path.join(d, 'out', 'pinned-comment.txt'), 'Which volcano should we cover next?');
  await assert.rejects(dry(), /pinned-comment\.txt was added after the final approval/);
  approveFinal(d);
  const l2 = []; await dry(l2);
  assert.ok(l2.join('\n').includes('Which volcano should we cover next?') && /pin it by hand/.test(l2.join('\n')));
  const f = fakeYouTube(), l3 = [];
  await yt.upload(d, { yes: true, fetchImpl: f.fetchImpl, credDir: cred(), log: (x) => l3.push(x) });
  assert.ok(!f.calls.some((x) => /commentThreads|comments/.test(x.url)), 'the uploader posts no comment');
  assert.ok(l3.some((x) => /pin the comment by hand/.test(x)));
});

await test('upload --yes needs the final approval to say the whole final cut was watched; approve final --watched records it', async () => {
  const d = fakeFolder({ watched: false });
  const lines = [];
  await assert.rejects(yt.upload(d, { fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: (x) => lines.push(x) }), /watched the whole final cut/);
  assert.ok(lines.join('\n').includes('watched:     NOT recorded'));
  await assert.rejects(yt.upload(d, { yes: true, fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: () => {} }), /--watched/);
  fs.writeFileSync(path.join(d, 'build', 'qa.json'), JSON.stringify({ result: 'PASS', sha: checks.sha256File(path.join(d, 'out', 'video.mp4')), at: 'x' }));
  checks.recordFacts(d, { scope: 'final', result: 'PASS' });
  checks.approve(d, 'final');
  assert.equal(checks.approvalCurrent(d, 'final').watched, false);
  checks.approve(d, 'final', { watched: true });
  assert.equal(checks.approvalCurrent(d, 'final').watched, true);
  assert.match(fs.readFileSync(path.join(d, 'approvals.md'), 'utf8'), /watched the whole final cut/);
  assert.equal((await yt.upload(d, { yes: true, fetchImpl: fakeYouTube().fetchImpl, credDir: cred(), log: () => {} })).id, 'vid1');
});

await test('captions after an upload: sent with the full sign-in, skipped with a note on upload-only, never twice unchanged', async () => {
  const withCaptions = () => { const d = fakeFolder(); fs.writeFileSync(path.join(d, 'out', 'captions.en.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHello\n'); return d; };
  let d = withCaptions(), f = fakeYouTube(), lines = [];
  await yt.upload(d, { yes: true, fetchImpl: f.fetchImpl, credDir: cred(yt.SCOPES.join(' ')), log: (x) => lines.push(x) });
  const call = f.calls.find((x) => x.url.includes('youtube/v3/captions'));
  assert.ok(call, 'captions sent');
  const body = call.body.toString('utf8');
  assert.ok(body.includes('"videoId":"vid1"') && body.includes('"language":"en"') && body.includes('Hello') && body.includes('"isDraft":false'));
  assert.ok(lines.includes('captions added (en)'));
  assert.ok(JSON.parse(fs.readFileSync(path.join(d, 'out', 'youtube-published.json'), 'utf8')).captions.en);
  // youtube captions <folder>: unchanged, skipped; changed, sent again with a note about the older track
  const c = cred(yt.SCOPES.join(' '));
  f = fakeYouTube(); lines = [];
  await yt.captions(d, { fetchImpl: f.fetchImpl, credDir: c, log: (x) => lines.push(x) });
  assert.ok(!f.calls.some((x) => x.url.includes('captions')) && lines.some((x) => /already added unchanged/.test(x)));
  fs.appendFileSync(path.join(d, 'out', 'captions.en.srt'), '\n2\n00:00:01,000 --> 00:00:02,000\nAgain\n');
  f = fakeYouTube(); lines = [];
  await yt.captions(d, { fetchImpl: f.fetchImpl, credDir: c, log: (x) => lines.push(x) });
  assert.ok(f.calls.some((x) => x.url.includes('captions')) && lines.some((x) => /second track/.test(x)));
  // an upload-only sign-in: a note, no request
  d = withCaptions(); f = fakeYouTube(); lines = [];
  await yt.upload(d, { yes: true, fetchImpl: f.fetchImpl, credDir: cred(yt.UPLOAD_SCOPE), log: (x) => lines.push(x) });
  assert.ok(!f.calls.some((x) => x.url.includes('captions')) && lines.some((x) => /only allows uploads/.test(x)));
  // a video that went to the wrong channel gets no captions
  const pub = path.join(d, 'out', 'youtube-published.json');
  fs.writeFileSync(pub, JSON.stringify({ ...JSON.parse(fs.readFileSync(pub, 'utf8')), wrong_channel: true, channel_id: 'UCx' }));
  await assert.rejects(yt.captions(d, { fetchImpl: fakeYouTube().fetchImpl, credDir: c, log: () => {} }), /wrong channel/);
  await assert.rejects(yt.captions(fakeFolder(), { fetchImpl: fakeYouTube().fetchImpl, credDir: c, log: () => {} }), /not been uploaded/);
});

await test('youtube login asks for upload and management by default, upload only with --upload-only, and saves what Google gave', async () => {
  const run = async (scopes, granted) => {
    const c = tmp(); fs.writeFileSync(path.join(c, 'youtube-default.json'), JSON.stringify({ client_id: 'cid', client_secret: 'secret-xyz' }));
    let asked = null; const lines = [];
    const open = (url) => { const u = new URL(url); asked = u.searchParams.get('scope'); fetch(`${u.searchParams.get('redirect_uri')}?state=${u.searchParams.get('state')}&code=c1`).catch(() => {}); };
    const fetchImpl = async () => new Response(JSON.stringify({ refresh_token: 'rt', scope: granted }), { status: 200 });
    const r = await yt.login({ dir: c, reelDir: tmp(), open, fetchImpl, log: (x) => lines.push(x), timeoutMs: 5000, ...(scopes ? { scopes } : {}) });
    return { asked, saved: JSON.parse(fs.readFileSync(path.join(c, 'youtube-default.json'), 'utf8')), lines: lines.join('\n'), r };
  };
  let x = await run(null, yt.SCOPES.join(' '));
  assert.equal(x.asked, yt.SCOPES.join(' '));
  assert.ok(yt.canManage(x.saved) && /stays on this computer/.test(x.lines) && /manage this channel/.test(x.lines) && !x.lines.includes('secret-xyz'));
  x = await run([yt.UPLOAD_SCOPE], yt.UPLOAD_SCOPE);
  assert.equal(x.asked, yt.UPLOAD_SCOPE); assert.equal(yt.canManage(x.saved), false);
  x = await run(null, yt.UPLOAD_SCOPE);
  assert.match(x.lines, /a box was left unticked/);
  assert.equal(yt.noBrowser({ BAGELUNIT_NO_BROWSER: '1' }), true);
  assert.equal(yt.noBrowser({ BAGELUNIT_NO_BROWSER: '0' }), false);
  assert.equal(yt.noBrowser({}), false);
  const r = tmp(); fs.writeFileSync(path.join(r, 'youtube-x.json'), JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt', scope: yt.SCOPES.join(' ') }));
  assert.equal(yt.canManage(yt.readCredentials('x', { dir: tmp(), reelDir: r }).cfg), true, 'a borrowed Reel Kit sign-in keeps its scope');
});

const R = await import('../studio/tools/review.mjs');
const channel = () => {
  const ch = tmp(); fs.mkdirSync(path.join(ch, 'brand')); fs.writeFileSync(path.join(ch, 'brand', 'brand.json'), JSON.stringify({ name: 'Space Facts', slug: 'space' }));
  const v = (name, extra) => { const d = path.join(ch, 'videos', name); fs.mkdirSync(path.join(d, 'out'), { recursive: true }); fs.writeFileSync(path.join(d, 'video.json'), JSON.stringify({ style: 'clean-shapes', title: name })); for (const [f, b] of Object.entries(extra)) fs.writeFileSync(path.join(d, 'out', f), b); };
  v('moon', { 'youtube-published.json': JSON.stringify({ id: 'AAAAAAAAAA1', at: '2026-10-01T10:00:00Z' }) });
  v('mars', { 'youtube.txt': 'Why Mars is red, really\n\nText.' });
  return ch;
};
const CSV = `Content,Video title,Video publish time,Duration,Views,Watch time (hours),Impressions,Impressions click-through rate (%),Average view duration,Average percentage viewed (%)
Total,,,,9100,410.5,120000,4.6,0:03:40,41.2
AAAAAAAAAA1,"How big is the Moon, really?","Oct 1, 2026",600,5000,250.2,50000,7.1,0:04:30,45.0
BBBBBBBBBB2,"Why Mars is red, really","Oct 20, 2026",480,2500,100.1,40000,4.0,0:03:10,39.5
CCCCCCCCCC3,Saturn's rings in 8 minutes,"Nov 10, 2026",900,900,40.0,20000,2.9,0:02:00,13.3
DDDDDDDDDD4,The coldest place,"Sep 5, 2026",420,700,20.2,10000,4.5,0:03:30,50.0
`;

await test('review: no export means no review, only what to download; a zip or a daily chart is refused', () => {
  const ch = channel();
  assert.throws(() => R.review(ch, [], { log: () => {} }), (e) => e.howTo && /Advanced mode/.test(e.message) && /Table data\.csv/.test(e.message));
  assert.ok(!fs.existsSync(path.join(ch, 'reviews')), 'nothing written');
  const z = path.join(tmp(), 'export.zip'); fs.writeFileSync(z, 'PK');
  assert.throws(() => R.review(ch, [z], { log: () => {} }), /unzip it first/);
  const chart = path.join(tmp(), 'Chart data.csv'); fs.writeFileSync(chart, 'Date,Content,Views\n2026-11-01,AAAAAAAAAA1,10\n');
  assert.throws(() => R.review(ch, [chart], { log: () => {} }), (e) => e.howTo && /day-by-day/.test(e.message));
  const r = spawnSync(process.execPath, [path.join(REPO, 'studio', 'tools', 'video.mjs'), 'review', ch], { encoding: 'utf8' });
  assert.equal(r.status, 1); assert.match(r.stderr, /never guesses numbers/);
});

await test('review: real numbers only, matched to video folders, observations apart from hypotheses, small and young samples flagged, at most 5 tests', () => {
  const ch = channel(), f = path.join(tmp(), 'Table data.csv'); fs.writeFileSync(f, CSV);
  const r = R.review(ch, [f], { today: new Date('2026-11-13T12:00:00Z'), log: () => {} });
  assert.equal(path.relative(ch, r.file), path.join('reviews', '2026-11-13.md'));
  const md = fs.readFileSync(r.file, 'utf8');
  assert.equal(r.videos.length, 4, 'the Total row is not a video');
  assert.equal(r.videos.find((v) => v.id === 'AAAAAAAAAA1').folder, 'moon', 'matched by YouTube id');
  assert.equal(r.videos.find((v) => v.id === 'BBBBBBBBBB2').folder, 'mars', 'matched by title');
  assert.ok(/Small sample: 4 videos/.test(md) && /Saturn's rings in 8 minutes", 3 days/.test(md));
  assert.ok(md.indexOf('## Observations') < md.indexOf('## Hypotheses') && md.indexOf('## Hypotheses') < md.indexOf('## Tests'));
  const obs = md.slice(md.indexOf('## Observations'), md.indexOf('## Hypotheses'));
  assert.ok(obs.includes('impressions CTR 4.3% (4 videos)') && obs.includes('"How big is the Moon, really?" (videos/moon) 7.1%'), obs);
  assert.ok(obs.includes('5,000 views, 55% of all 9,100 views'));
  assert.ok(r.tests.length >= 1 && r.tests.length <= 5);
  assert.ok(md.includes('Title.') && md.includes('Thumbnail.') && md.includes('Hook.'));
  // every number in the observations is one of the file's, or a median/share of them
  const fileNums = new Set(CSV.match(/\d+(\.\d+)?/g));
  for (const n of ['7.1', '2.9', '5,000', '13.3']) assert.ok(obs.includes(n) && fileNums.has(n.replace(',', '')), n);
  // a second review the same day never overwrites the first; the dashboard links the newest
  const r2 = R.review(ch, [f], { today: new Date('2026-11-13T15:00:00Z'), log: () => {} });
  assert.equal(path.basename(r2.file), '2026-11-13-2.md');
  assert.equal(path.basename(R.latestReview(ch).file), '2026-11-13-2.md');
  assert.match(R.latestReview(ch).headline, /^4 videos, median CTR 4\.3%/);
});

await test('review: column names that differ and columns that are missing are said, never filled in; retention files read', async () => {
  const rows = R.readExport((() => { const f = path.join(tmp(), 't.csv'); fs.writeFileSync(f, 'Video,Title,Views,CTR\nAAAAAAAAAA1,One,"1,200",5.5%\n'); return f; })());
  assert.equal(rows.videos[0].views, 1200); assert.equal(rows.videos[0].ctr, 5.5);
  assert.ok(rows.missing.includes('Average percentage viewed (%)') && rows.missing.includes('Impressions'));
  const ret = path.join(tmp(), 'Moon retention.csv');
  fs.writeFileSync(ret, 'Video position (%),Absolute audience retention (%)\n0,100\n5,62\n10,58\n50,40\n100,20\n');
  const ch = channel(), t = path.join(tmp(), 'Table data.csv'); fs.writeFileSync(t, 'Video,Title,Views,CTR\nAAAAAAAAAA1,One,"1,200",5.5%\n');
  const r = R.review(ch, [t, ret], { today: new Date('2026-11-13T12:00:00Z'), log: () => {} });
  const md = fs.readFileSync(r.file, 'utf8');
  assert.match(md, /Missing from the export: .*Average percentage viewed/);
  assert.match(md, /Retention file "Moon retention": 58% still watching at 10%; the largest fall is 38 points, from 0% to 5%/);
  assert.ok(md.includes('largest fall comes in the opening'));
  const { load } = await import('../studio/dashboard/model.mjs');
  const { html } = await import('../studio/dashboard/page.mjs');
  fs.mkdirSync(path.join(ch, 'videos'), { recursive: true });
  const page = html(load(path.join(ch, 'videos'), { pageDir: path.join(ch, 'videos') }));
  assert.ok(page.includes('href="../reviews/2026-11-13.md"') && page.includes('Channel review 2026-11-13'));
});

const r3t = (x) => Math.round(x * 1000) / 1000;
/* ── video revoice: one line voiced again with its lead-in, spliced into a copy ─────────────────────────────────────── */
await test('revoice finds the line, takes the sentence before it as lead-in, and plans the splice (end card moves with it)', async () => {
  const R = await import('../studio/tools/revoice.mjs');
  const words = W([['First', 0, 0.3], ['line', 0.35, 0.6], ['here.', 0.65, 1], ['Like,', 1.6, 1.9], ['subscribe', 2, 2.5], ['and', 2.55, 2.7], ['share.', 2.75, 3.1]]);
  assert.deepEqual(R.findLine(words, 'like subscribe and share'), { a: 3, b: 6 });
  assert.throws(() => R.findLine(words, 'not said'), /not in the voice/);
  assert.throws(() => R.findLine(W([['go', 0, 1], ['go', 1, 2]]), 'go'), /said 2 times/);
  assert.deepEqual(R.leadIn(words, 3), { from: 0, text: 'First line here.' });
  assert.equal(R.leadIn(words, 0).text, '');
  // the take: lead-in then the new line, at its own clock
  const take = { words: W([['First', 0.1, 0.4], ['line', 0.45, 0.7], ['here.', 0.75, 1.1], ['Like,', 1.5, 1.8], ['follow', 1.9, 2.3], ['and', 2.35, 2.5], ['share.', 2.55, 3.0]]), length: 3.3 };
  const base = { words, length: 3.5, pauses: [{ n: 9, id: 'end', seconds: 4, at: 3.5 }] };
  const plan = R.planSplice(base, { a: 3, b: 6 }, take, 4);
  assert.equal(plan.baseIn, 1.3, 'cut in the middle of the gap before the old line');
  assert.equal(plan.takeIn, 1.3, 'the lead-in is cut off in the gap before the new line');
  assert.equal(plan.baseOut, 3.35, 'the last line keeps a short tail, the silence after it stays');
  assert.deepEqual(plan.words.map((w) => w.w), ['First', 'line', 'here.', 'Like,', 'follow', 'and', 'share.']);
  assert.equal(plan.words[4].s, 1.9);
  assert.equal(plan.pauses[0].at, r3t(3.5 + plan.delta), 'a pause after the line moves by the change in length');
  assert.ok(Math.abs(plan.delta - ((3.0 + 0.25 - 1.3) - (3.35 - 1.3))) < 1e-6);
});
await test('revoice pace: new line, old line and episode words per second, warned over 20%', async () => {
  const R = await import('../studio/tools/revoice.mjs');
  const words = scenes.fakeWords('One two three four. Five six seven eight. Nine ten eleven twelve.', 0.3);
  const ep = R.episodeRate(words);
  assert.ok(ep > 2 && ep < 6, `episode ${ep}`);
  assert.equal(R.paceReport({ fresh: ep, old: ep, episode: ep }).length, 1, 'no warning at the episode pace');
  const slow = R.paceReport({ fresh: ep * 0.7, old: ep * 1.45, episode: ep }).join('\n');
  assert.match(slow, /new line reads 30% slower/);
  assert.match(slow, /old line itself read 45% faster/);
});

function revoiceFolder() {
  const eng = tmp(); fs.mkdirSync(path.join(eng, 'tools'));
  // a stand-in voice.py: one word every 0.3 s, a tone as long as the words, and a count of calls (no key, no credits)
  fs.writeFileSync(path.join(eng, 'tools', 'voice.py'), `import sys, json, subprocess, pathlib
d = pathlib.Path(sys.argv[1]); words = (d / 'script.txt').read_text().split()
c = d.parent / 'calls.txt'; c.write_text(str(int(c.read_text()) + 1 if c.exists() else 1))
(d / 'build').mkdir(exist_ok=True); (d / 'audio').mkdir(exist_ok=True)
json.dump([{'w': w, 's': 0.1 + i * 0.3, 'e': 0.1 + i * 0.3 + 0.25} for i, w in enumerate(words)], open(d / 'build' / 'words.json', 'w'))
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=%s' % (0.2 + len(words) * 0.3), str(d / 'audio' / 'vo.mp3')], check=True)
`);
  const dir = tmp();
  const script = 'Ice is slippery for a reason. Water sits on top of it. Like, subscribe to Quark Street and share.';
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify({ style: 'clean-shapes', no_research: 'a test script' }));
  fs.writeFileSync(path.join(dir, 'script.txt'), script);
  fs.writeFileSync(path.join(dir, 'outline.md'), '# Map\n');
  checks.approve(dir, 'map'); checks.recordFacts(dir, { scope: 'script', result: 'PASS', cfg: { no_research: 'a test script' } });
  const words = scenes.fakeWords(script, 0.38);
  scenes.writeWords(dir, words);
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  ff(['-f', 'lavfi', '-i', `sine=frequency=300:duration=${(words.at(-1).e + 0.4).toFixed(2)}`, '-ac', '1', path.join(dir, 'audio', 'vo.mp3')]);
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'studio', 'tools', 'video.mjs'), 'revoice', dir, ...args], { encoding: 'utf8', env: { ...process.env, BAGELUNIT_REEL_ENGINE: eng } });
  return { dir, run, words };
}
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

await test('video revoice --vertical: dry run first, then the vertical voice only, with the lead-in cut off', () => {
  const { dir, run, words } = revoiceFolder();
  const wide = sha(path.join(dir, 'audio', 'vo.mp3')), wideWords = fs.readFileSync(path.join(dir, 'build', 'words.json'), 'utf8');
  const line = ['--line', 'Like, subscribe to Quark Street and share.', '--to', 'Like, follow Quark Street and share.', '--vertical'];
  let r = run(...line);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /lead-in: "Water sits on top of it\."/);
  assert.match(r.stdout, /will send: \d+ characters \(\d+ lead-in \+ 36 new line\).*a paid voice call/);
  assert.match(r.stdout, /a dry run: nothing sent/);
  assert.ok(!fs.existsSync(path.join(dir, 'audio', 'vo-vertical.mp3')) && !fs.existsSync(path.join(dir, 'build', 'revoice')), 'a dry run makes nothing');
  r = run(...line, '--apply');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const vw = JSON.parse(fs.readFileSync(path.join(dir, 'build', 'words-vertical.json'), 'utf8'));
  assert.deepEqual(vw.map((w) => w.w), ['Ice', 'is', 'slippery', 'for', 'a', 'reason.', 'Water', 'sits', 'on', 'top', 'of', 'it.', 'Like,', 'follow', 'Quark', 'Street', 'and', 'share.']);
  assert.equal(words.length, 19);
  assert.ok(vw.every((x, i) => i === 0 || x.s >= vw[i - 1].e - 1e-6), 'word times only go forward');
  assert.equal(sha(path.join(dir, 'audio', 'vo.mp3')), wide, 'the YouTube voice is not touched');
  assert.equal(fs.readFileSync(path.join(dir, 'build', 'words.json'), 'utf8'), wideWords);
  const len = probe(path.join(dir, 'audio', 'vo-vertical.mp3'));
  assert.ok(vw.at(-1).e <= len + 0.05, `the word clock ends inside the audio (${vw.at(-1).e} vs ${len})`);
  assert.match(r.stdout, /pace: new line [\d.]+ words\/s, old line [\d.]+ words\/s, episode [\d.]+ words\/s/);
  // a second change works on the vertical voice, where the old words are gone now
  r = run(...line);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not in the voice's words/);
});

await test('video revoice without --vertical writes a copy; --use swaps it in and keeps the old voice', () => {
  const { dir, run } = revoiceFolder();
  const wide = sha(path.join(dir, 'audio', 'vo.mp3'));
  const r = run('--line', 'Water sits on top of it.', '--to', 'A thin film of water sits on top of it.', '--apply');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(fs.existsSync(path.join(dir, 'audio', 'vo-revoiced.mp3')));
  assert.equal(sha(path.join(dir, 'audio', 'vo.mp3')), wide, 'not replaced until --use');
  assert.match(r.stdout, /--use/);
  const again = run('--line', 'Water sits on top of it.', '--to', 'A thin film of water sits on top of it.');
  assert.match(again.stdout, /already voiced, free \(reused\)/, 'the same request is not a new paid call');
  const u = run('--use');
  assert.equal(u.status, 0, u.stderr + u.stdout);
  assert.equal(sha(path.join(dir, 'audio', 'vo-before-revoice.mp3')), wide);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'build', 'words.json'), 'utf8')).some((w) => w.w === 'film'));
  assert.ok(!fs.existsSync(path.join(dir, 'audio', 'vo-revoiced.mp3')));
});

/* ── tidy: what the next render costs ───────────────────────────────────────────────────────────────────────────────── */
await test('tidy says the next render draws every scene again, with an estimate from the folder\'s render times', () => {
  const d = tmp();
  for (let i = 1; i <= 64; i++) { const f = path.join(d, 'build', 'scenes-vertical', `${String(i).padStart(3, '0')}.mp4`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(10)); }
  fs.mkdirSync(path.join(d, 'build', 'scenes')); fs.writeFileSync(path.join(d, 'build', 'scenes', '001.mp4'), Buffer.alloc(10));
  assert.deepEqual(checks.tidy(d).rerender.map((e) => e.seconds), [null, null], 'no render times yet: no estimate');
  fs.writeFileSync(path.join(d, 'build', 'render-times.json'), JSON.stringify([{ shape: 'vertical', scenes: 64, rendered: 64, seconds: 762 }, { shape: 'vertical', scenes: 64, rendered: 0, seconds: 0 }]));
  const est = checks.tidy(d).rerender;
  assert.deepEqual(est.find((e) => e.shape === 'vertical'), { shape: 'vertical', scenes: 64, seconds: 762, from: 'this shape' });
  assert.deepEqual(est.find((e) => e.shape === 'wide'), { shape: 'wide', scenes: 1, seconds: 12, from: 'the other shape' });
  checks.tidy(d, { apply: true });
  assert.ok(fs.existsSync(path.join(d, 'build', 'render-times.json')), 'tidy keeps the render times');
  const v = tmp(); fs.writeFileSync(path.join(v, 'video.json'), JSON.stringify({ style: 'clean-shapes' }));
  fs.cpSync(path.join(d, 'build'), path.join(v, 'build'), { recursive: true });
  for (let i = 1; i <= 3; i++) { const f = path.join(v, 'build', 'scenes-vertical', `00${i}.mp4`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(10)); }
  const r = spawnSync(process.execPath, [path.join(REPO, 'studio', 'tools', 'video.mjs'), 'tidy', v], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /next  video render --vertical  draws all 3 scenes again \(free, nothing is left to reuse\): about 36 s/);
});

await test('a render that draws scenes records how long it took (build/render-times.json, last 30)', () => {
  const d = tmp(); fs.mkdirSync(path.join(d, 'build'));
  for (let i = 0; i < 35; i++) scenes.recordRenderTime(d, { scenes: 10, rendered: 2, seconds: 20.04 });
  const log = JSON.parse(fs.readFileSync(path.join(d, 'build', 'render-times.json'), 'utf8'));
  assert.equal(log.length, 30);
  assert.deepEqual({ ...log[0], at: 'x' }, { at: 'x', shape: 'wide', scenes: 10, rendered: 2, seconds: 20 });
});

console.log(n ? `\n${n} test(s) passed` : '');
