#!/usr/bin/env node
// Tests for the voice step with the Reel Kit's free built-in voice: which voice speaks and what is said before it starts, the
// credit check ("not needed" for a voice with no credits), the estimated-timing warning, the record of who spoke, QA and the
// upload still refusing the stand-in tone, an older Reel Kit engine, revoice with the built-in voice, and that no key is
// printed. A fake Reel Kit engine (a stub voice.py that writes a tone with ffmpeg), a fake HOME and a fake PATH folder: no
// network, no key, no speech engine needed. Skips cleanly (SKIPPED) without ffmpeg or python. Run: node setup/test-voice.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(REPO, 'studio', 'tools', 'video.mjs');
const win = process.platform === 'win32';
const PY = ['python3', 'python'].find((c) => spawnSync(c, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'], { stdio: 'ignore' }).status === 0);
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0 || spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status !== 0 || !PY) {
  console.log('SKIPPED: test-voice needs ffmpeg, ffprobe and python 3 on the PATH');
  process.exit(0);
}
process.env.PYTHONDONTWRITEBYTECODE = '1';
const V = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'video.mjs')).href);
const gate = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scriptgate.mjs')).href);
const checks = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'checks.mjs')).href);
const scenes = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'scenes.mjs')).href);
const yt = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'youtube.mjs')).href);
const R = await import(pathToFileURL(path.join(REPO, 'studio', 'tools', 'revoice.mjs')).href);

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'video-voice-test-')));
const SECRET = 'FAKE-ELEVEN-KEY-9f8e7d6c5b4a';

// A fake Reel Kit engine. new: with localvoice.py and a voice.py that knows voice_source. The stub speaks the script's words
// (0.3 s each) as a tone and writes build/voice_source.json the way the real tool does; STUB_TIMINGS picks the timings,
// STUB_PROVIDER the provider (else --provider, else local); it prints the real tool's notes on stderr.
const STUB = (modern) => `import sys, json, subprocess, pathlib, os, hashlib
a = sys.argv[1:]; d = pathlib.Path(a[0]); words = (d / 'script.txt').read_text().split()
prov = a[a.index('--provider') + 1] if '--provider' in a else os.environ.get('STUB_PROVIDER', 'local')
(d / 'args.txt').write_text(' '.join(a[1:]))
(d / 'build').mkdir(exist_ok=True); (d / 'audio').mkdir(exist_ok=True)
json.dump([{'w': w, 's': i * 0.3, 'e': i * 0.3 + 0.25} for i, w in enumerate(words)], open(d / 'build' / 'words.json', 'w'))
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=%s' % (len(words) * 0.3), str(d / 'audio' / 'vo.mp3')], check=True)
${modern ? `
tim = os.environ.get('STUB_TIMINGS', 'whisper' if prov == 'local' else 'provider')
json.dump({'provider': prov, 'engine': 'stub-engine', 'voice': 'default', 'timings': tim, 'at': 'now', 'vo_sha256': hashlib.sha256((d / 'audio' / 'vo.mp3').read_bytes()).hexdigest()}, open(d / 'build' / 'voice_source.json', 'w'))
if prov == 'local':
    print('voice: built-in voice (free, basic quality). A natural voice service such as ElevenLabs is a suggested upgrade: kit suggest elevenlabs', file=sys.stderr)
    if tim == 'estimated': print('voice: estimated timings (Whisper is not installed or not used)', file=sys.stderr)
print('voice: audio/vo.mp3 stub')
` : `print('voice: audio/vo.mp3 stub (old engine)')
`}`;
function engine({ modern = true, budgetFails = false } = {}) {
  const e = tmp(); fs.mkdirSync(path.join(e, 'tools'));
  fs.writeFileSync(path.join(e, 'tools', 'voice.py'), STUB(modern));
  if (modern) fs.writeFileSync(path.join(e, 'tools', 'localvoice.py'), '# stub\n');
  // a budget tool that leaves a marker when it runs and (if asked) says there are not enough characters
  fs.writeFileSync(path.join(e, 'tools', 'budget.py'), `import sys, pathlib\npathlib.Path(sys.argv[1]).with_name('budget-ran.txt').write_text('ran')\nprint('verdict: ${budgetFails ? 'NOT ENOUGH' : 'OK'}')\nsys.exit(${budgetFails ? 1 : 0})\n`);
  return e;
}
// a fake HOME (with or without a key file) and a PATH folder holding a fake espeak-ng (so the built-in voice is "installed")
function world({ key = false, speech = true } = {}) {
  const home = tmp(), bin = tmp();
  if (key) { fs.mkdirSync(path.join(home, '.config', 'bagelunit-reels'), { recursive: true }); fs.writeFileSync(path.join(home, '.config', 'bagelunit-reels', 'elevenlabs.key'), SECRET + '\n'); }
  if (speech) { const f = path.join(bin, win ? 'espeak-ng.cmd' : 'espeak-ng'); fs.writeFileSync(f, win ? '@echo off\r\n' : '#!/bin/sh\n'); fs.chmodSync(f, 0o755); }
  const sep = win ? ';' : ':';
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${sep}${process.env.PATH ?? process.env.Path}`, PYTHONDONTWRITEBYTECODE: '1', BAGELUNIT_SUGGEST_NO_PATHS: '1', BAGELUNIT_NO_TIPS: '1' };
  delete env.ELEVENLABS_API_KEY;
  return { home, bin, env };
}
const approved = (cfg = {}, { skip = true } = {}) => {
  const dir = tmp();
  const vcfg = { style: 'clean-shapes', no_research: 'a test script', voice: { local_engine: 'espeak-ng' }, ...cfg };
  fs.writeFileSync(path.join(dir, 'video.json'), JSON.stringify(vcfg));
  fs.writeFileSync(path.join(dir, 'script.txt'), Array.from({ length: 6 }, (_, i) => `Paragraph ${i} has some words in it, nothing more.`).join('\n\n'));
  fs.writeFileSync(path.join(dir, 'outline.md'), '# Map\n');
  checks.approve(dir, 'map'); checks.recordFacts(dir, { scope: 'script', result: 'PASS', cfg: { no_research: 'a test script' } });
  if (skip) gate.recordScriptSkip(dir, 'fixture script, voice mechanics under test');
  return dir;
};
const run = (w, eng, args, extra = {}) => spawnSync(process.execPath, [VIDEO, ...args], { encoding: 'utf8', env: { ...w.env, BAGELUNIT_REEL_ENGINE: eng, VIDEO_CHUNK: '120', ...extra } });
const out = (r) => `${r.stdout}${r.stderr}`;
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

await test('engineSupport: an engine with localvoice.py and voice_source is new; one without is older', () => {
  assert.deepEqual(V.engineSupport(engine()), { installed: true, builtIn: true });
  assert.deepEqual(V.engineSupport(engine({ modern: false })), { installed: true, builtIn: false });
  assert.deepEqual(V.engineSupport(path.join(tmp(), 'none')), { installed: false, builtIn: false });
});

await test('chooseProvider follows the engine: key first, else the built-in voice, else nothing; --provider is taken as given', () => {
  const c = V.chooseProvider;
  assert.equal(c({}, undefined, true, true).provider, 'elevenlabs');
  assert.deepEqual(c({}, undefined, false, true), { provider: 'local', auto: true });
  assert.equal(c({}, undefined, false, false).provider, 'standin');
  assert.equal(c({ provider: 'auto' }, undefined, false, true).provider, 'local');
  assert.equal(c({ provider: 'local' }, undefined, true, true).provider, 'local', 'a brand that chose the built-in voice keeps it even with a key');
  assert.equal(c({ provider: 'command' }, undefined, false, false).provider, 'command');
  assert.equal(c({}, 'elevenlabs', false, true).provider, 'elevenlabs', 'asked for by name: no silent swap');
  assert.equal(c({}, 'local', true, true).provider, 'local');
});

await test('findBuiltInEngine: the forced engine, the first one found, and why none', () => {
  const only = (...names) => (n) => (names.includes(n) ? `/bin/${n}` : null);
  assert.deepEqual(V.findBuiltInEngine({}, { which: only('say'), platform: 'darwin' }), ['say', '/bin/say']);
  assert.deepEqual(V.findBuiltInEngine({}, { which: only('espeak-ng', 'say'), platform: 'linux' })[0], 'say');
  assert.deepEqual(V.findBuiltInEngine({ local_engine: 'espeak-ng' }, { which: only('espeak-ng', 'say'), platform: 'linux' }), ['espeak-ng', '/bin/espeak-ng']);
  assert.match(V.findBuiltInEngine({ local_engine: 'say' }, { which: only(), platform: 'linux' })[1], /not installed/);
  assert.match(V.findBuiltInEngine({}, { which: only(), platform: 'linux' })[1], /espeak-ng/);
  assert.equal(V.findBuiltInEngine({}, { which: only('powershell'), platform: 'win32' })[0], 'sapi');
  assert.equal(V.findBuiltInEngine({}, { which: only('piper'), platform: 'linux' })[0], null, 'piper needs a model file');
});

await test('no ElevenLabs key: the built-in voice speaks, and it is said plainly before it starts', () => {
  const w = world(), e = engine({ budgetFails: true }), dir = approved();
  const r = run(w, e, ['voice', dir]);
  assert.equal(r.status, 0, out(r));
  const text = r.stdout;
  const say = text.indexOf('no ElevenLabs key: using the free built-in voice (basic quality');
  assert.ok(say >= 0, text);
  assert.match(text, /`video suggest elevenlabs` for a natural one/);
  assert.ok(say < text.indexOf('voice: chunk 1/'), 'said before the first chunk');
  assert.match(text, /credits check: not needed/);
  assert.ok(!fs.existsSync(path.join(dir, 'build', 'voice', 'budget-ran.txt')), 'the ElevenLabs budget tool was never asked');
  assert.ok(fs.existsSync(path.join(dir, 'audio', 'vo.mp3')) && JSON.parse(fs.readFileSync(path.join(dir, 'build', 'words.json'), 'utf8')).length === 6 * 9);
  assert.match(fs.readFileSync(path.join(dir, 'build', 'voice', '001', 'args.txt'), 'utf8'), /--speed 1\b/);
});

await test('a long video is voiced in chunks, each in its own folder, joined into one voice, and the engine notes are shown once', () => {
  const w = world(), e = engine(), dir = approved();
  const r = run(w, e, ['voice', dir]);
  assert.equal(r.status, 0, out(r));
  const chunks = fs.readdirSync(path.join(dir, 'build', 'voice')).filter((x) => /^\d{3}$/.test(x));
  assert.ok(chunks.length >= 3, `${chunks.length} chunks`);
  for (const c of chunks) assert.ok(fs.existsSync(path.join(dir, 'build', 'voice', c, 'audio', 'vo.mp3')), c);
  assert.equal((r.stderr.match(/built-in voice \(free, basic quality\)/g) || []).length, 1, 'the engine note once, not once per chunk');
  const words = readJSON(path.join(dir, 'build', 'words.json'));
  assert.ok(words.every((x, i) => i === 0 || x.s >= words[i - 1].s), 'the word clock only goes forward across chunks');
  assert.ok(!/WARNING/.test(out(r)), out(r));
  // resume: delete the joined voice and one chunk's audio; the others are not touched
  const before = fs.statSync(path.join(dir, 'build', 'voice', '001', 'audio', 'vo.mp3')).mtimeMs;
  const again = run(w, e, ['voice', dir]);
  assert.equal(again.status, 0, out(again));
  assert.ok(fs.existsSync(path.join(dir, 'build', 'voice', '001', 'audio', 'vo.mp3')) && before > 0);
});

await test('the record of who spoke: build/voice_source.json tied to the audio, and one line under "Voice" in approvals.md', () => {
  const w = world(), e = engine(), dir = approved();
  assert.equal(run(w, e, ['voice', dir]).status, 0);
  const src = readJSON(path.join(dir, 'build', 'voice_source.json'));
  assert.equal(src.provider, 'local'); assert.equal(src.engine, 'stub-engine'); assert.equal(src.timings, 'whisper');
  assert.equal(src.vo_sha256, checks.sha256File(path.join(dir, 'audio', 'vo.mp3')));
  assert.equal(checks.voiceSource(dir).provider, 'local');
  const md = fs.readFileSync(path.join(dir, 'approvals.md'), 'utf8');
  assert.match(md, /\n## Voice\n- \d{4}-\d\d-\d\d \d\d:\d\d {2}the built-in voice \(stub-engine; basic quality\), word times whisper/);
  assert.match(md, /## Map\n- /, 'the earlier lines stay');
  const lines = (md.match(/^- .*the built-in voice/gm) || []).length;
  assert.equal(run(w, e, ['voice', dir]).status, 0);
  assert.equal((fs.readFileSync(path.join(dir, 'approvals.md'), 'utf8').match(/^- .*the built-in voice/gm) || []).length, lines, 'the same voice again adds no second line');
  fs.writeFileSync(path.join(dir, 'audio', 'vo.mp3'), 'something else');
  assert.equal(checks.voiceSource(dir), null, 'a voice replaced afterwards is not described by the old record');
});

await test('estimated word times: a WARNING that captions and cuts may drift, with Whisper as the advice; QA warns too', () => {
  const w = world(), e = engine(), dir = approved();
  const r = run(w, e, ['voice', dir], { STUB_TIMINGS: 'estimated' });
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /WARNING: the word times are estimated .*captions and cuts may drift.*Whisper/s);
  assert.equal(readJSON(path.join(dir, 'build', 'voice_source.json')).timings, 'estimated');
  assert.match(fs.readFileSync(path.join(dir, 'approvals.md'), 'utf8'), /word times estimated/);
  const cap = run(w, e, ['captions', dir]);
  assert.equal(cap.status, 0, out(cap)); assert.match(cap.stdout, /WARNING: the word times are estimated .*captions may drift/);
  // QA on a finished file: a WARN on the voice line, not a FAIL
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const ff = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6', '-i', path.join(dir, 'audio', 'vo.mp3'), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'out', 'video.mp4')]);
  assert.equal(ff.status, 0);
  const q = checks.qa(dir, { cfg: {} }).checks.find((c) => c.name === 'voice');
  assert.equal(q.status, 'WARN'); assert.match(q.text, /real voice.*estimated.*Whisper/s);
});

await test('qa and upload accept a built-in voice as a real voice and still refuse the stand-in tone', () => {
  const w = world(), e = engine(), dir = approved();
  assert.equal(run(w, e, ['voice', dir]).status, 0);
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const ffm = () => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6', '-i', path.join(dir, 'audio', 'vo.mp3'), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'out', 'video.mp4')]);
  assert.equal(ffm().status, 0);
  assert.equal(scenes.standInIsActive(dir), false, 'a built-in voice leaves no stand-in note');
  const real = checks.qa(dir, { standIn: Boolean(scenes.standInIsActive(dir)), cfg: {} }).checks.find((c) => c.name === 'voice');
  assert.equal(real.status, 'PASS'); assert.match(real.text, /built-in voice/);
  assert.ok(!yt.problems({ title: 'T', description: 'D' }, { video: true, thumbnail: null, standIn: false, privacy: 'private' }).some((x) => /stand-in/.test(x)));
  // the stand-in tone: its note wins, even beside a voice_source.json
  fs.writeFileSync(path.join(dir, 'audio', 'vo.mp3'), 'tone');
  fs.writeFileSync(path.join(dir, 'build', 'voice-stand-in.json'), JSON.stringify({ sha: createHash('sha256').update('tone').digest('hex') }));
  assert.equal(scenes.standInIsActive(dir), true);
  fs.writeFileSync(path.join(dir, 'audio', 'vo.mp3'), 'tone');
  assert.equal(checks.voiceSource(dir), null);
  const fake = checks.voiceLabel({ provider: 'local', engine: 'say', voice: 'Samantha' });
  assert.match(fake, /built-in voice \(say, Samantha; basic quality\)/);
  assert.ok(yt.problems({ title: 'T', description: 'D' }, { video: true, thumbnail: null, standIn: true, privacy: 'private' }).some((x) => /stand-in/.test(x)));
});

await test('revoice with the built-in voice: the lead-in is voiced with the line, no credits, spliced into a copy, --use records who spoke', () => {
  const w = world(), e = engine(), dir = approved();
  assert.equal(run(w, e, ['voice', dir]).status, 0);
  const dry = run(w, e, ['revoice', dir, '--line', 'Paragraph 3 has', '--to', 'Chapter 3 holds']);
  assert.equal(dry.status, 0, out(dry));
  assert.match(dry.stdout, /no ElevenLabs key: using the free built-in voice/);
  assert.match(dry.stdout, /lead-in: "/); assert.match(dry.stdout, /the free built-in voice, no credits/);
  const r = run(w, e, ['revoice', dir, '--line', 'Paragraph 3 has', '--to', 'Chapter 3 holds', '--apply'], { STUB_TIMINGS: 'estimated' });
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /credits check: not needed/);
  assert.match(r.stdout, /WARNING: the new line's word times are estimated/);
  assert.ok(fs.existsSync(path.join(dir, 'audio', 'vo-revoiced.mp3')) && fs.existsSync(path.join(dir, 'build', 'words-revoiced.json')));
  assert.ok(readJSON(path.join(dir, 'build', 'words-revoiced.json')).some((x) => x.w === 'Chapter'));
  assert.ok(!fs.existsSync(path.join(dir, 'build', 'revoice', 'budget-ran.txt')));
  const used = run(w, e, ['revoice', dir, '--use']);
  assert.equal(used.status, 0, out(used));
  const src = checks.voiceSource(dir);
  assert.ok(src && src.revoiced && src.timings === 'estimated' && src.provider === 'local', JSON.stringify(src));
  assert.match(fs.readFileSync(path.join(dir, 'approvals.md'), 'utf8'), /a line was voiced again: the built-in voice/);
});

await test('with an ElevenLabs key the key is used, the credit check runs, and not enough characters stops it before anything is voiced', () => {
  const w = world({ key: true }), e = engine({ budgetFails: true }), dir = approved({ voice: undefined });
  const r = run(w, e, ['voice', dir], { STUB_PROVIDER: 'elevenlabs' });
  assert.equal(r.status, 1, out(r));
  assert.match(out(r), /not enough ElevenLabs characters/);
  assert.ok(fs.existsSync(path.join(dir, 'build', 'voice', 'budget-ran.txt')), 'the budget tool ran');
  assert.ok(!fs.existsSync(path.join(dir, 'audio', 'vo.mp3')), 'nothing voiced');
  assert.ok(!/using the free built-in voice/.test(out(r)));
  // enough characters: voiced with the key's provider, and a built-in voice can be asked for by name without a credit check
  const ok = run(world({ key: true }), engine(), ['voice', approved({ voice: undefined })], { STUB_PROVIDER: 'elevenlabs' });
  assert.equal(ok.status, 0, out(ok)); assert.match(ok.stdout, /credits check: verdict: OK/);
  const local = run(w, e, ['voice', approved(), '--provider', 'local']);
  assert.equal(local.status, 0, out(local)); assert.match(local.stdout, /credits check: not needed/);
  assert.match(local.stdout, /^voice: using the free built-in voice/m);
});

await test('no key and no speech engine: it stops and says what fixes it; the stand-in tone is only for a silent preview', () => {
  const w = world({ speech: false }), e = engine();
  const r = spawnSync(process.execPath, [VIDEO, 'voice', approved({ voice: undefined })], { encoding: 'utf8', env: { ...w.env, PATH: w.bin, Path: w.bin, BAGELUNIT_REEL_ENGINE: e, VIDEO_CHUNK: '120' } });
  assert.equal(r.status, 1, out(r));
  assert.match(out(r), /no real voice is possible yet/); assert.match(out(r), /video suggest elevenlabs/); assert.match(out(r), /video stand-in/);
});

await test('an older Reel Kit engine: it says to update the Reel Kit, and keeps the old behaviour (ElevenLabs or the stand-in)', () => {
  const w = world(), e = engine({ modern: false }), dir = approved({ voice: undefined });
  const r = run(w, e, ['voice', dir]);
  assert.match(out(r), /older than the free built-in voice/); assert.match(out(r), /\/kit-update/);
  assert.match(out(r), /video stand-in/);
  assert.equal(r.status, 0, 'the old voice tool still runs as it did');
  assert.ok(!/free built-in voice \(basic/.test(out(r)));
  assert.equal(readJSON(path.join(dir, 'build', 'voice_source.json')).provider, 'elevenlabs', 'recorded as the provider that was asked');
  // with a key an older engine needs no note
  const k = run(world({ key: true }), e, ['voice', approved({ voice: undefined })]);
  assert.ok(!/older than/.test(out(k)), out(k));
});

await test('the refusals before the voice stay: no map approval, no fact check, no research', () => {
  const w = world(), e = engine(), dir = approved();
  fs.writeFileSync(path.join(dir, 'outline.md'), '# Map changed\n');
  const a = run(w, e, ['voice', dir]);
  assert.equal(a.status, 1); assert.match(out(a), /map/i); assert.ok(!/built-in voice/.test(out(a)));
  const d2 = tmp(); fs.writeFileSync(path.join(d2, 'video.json'), JSON.stringify({ style: 'clean-shapes' })); fs.writeFileSync(path.join(d2, 'script.txt'), 'One two three.');
  const b = run(w, e, ['voice', d2]);
  assert.equal(b.status, 1); assert.match(out(b), /research/);
});

await test('the script gate: voice and revoice refuse with no review, pass with one, refuse after the script changes, accept the owner\'s recorded skip', () => {
  const w = world(), e = engine();
  const reviewed = (dir) => {   // a Script review line the way /script-score records it (the script check must have no error, so the fixture words are replaced by a good script)
    const sc = path.join(REPO, 'studio', 'tools', 'scriptcheck.mjs');
    return import(pathToFileURL(sc).href).then((m) => { fs.writeFileSync(path.join(dir, 'script.txt'), m.SAMPLE_GOOD); });
  };
  const dir = approved({}, { skip: false });
  const r = run(w, e, ['voice', dir]);
  assert.equal(r.status, 1, out(r)); assert.match(out(r), /Script review/); assert.match(out(r), /Only the owner overrides/); assert.ok(!fs.existsSync(path.join(dir, 'audio', 'vo.mp3')), 'nothing is voiced');
  // a reviewed script (a recorded 90 or more for exactly these words) opens it
  return reviewed(dir).then(() => {
    checks.recordFacts(dir, { scope: 'script', result: 'PASS', cfg: { no_research: 'a test script' } });
    gate.recordScriptReview(dir, { score: 93, notes: 'weakest: pace', by: 'test' });
    assert.equal(gate.scriptGate(dir, {}), null);
    const ok = run(w, e, ['voice', dir]);
    assert.equal(ok.status, 0, out(ok)); assert.ok(fs.existsSync(path.join(dir, 'audio', 'vo.mp3')));
    // one changed word cancels it, for voice and for revoice (which needs the voice to exist, so it is tried now)
    fs.appendFileSync(path.join(dir, 'script.txt'), ' One more thing.');
    checks.recordFacts(dir, { scope: 'script', result: 'PASS', cfg: { no_research: 'a test script' } });
    const again = run(w, e, ['voice', dir, '--force']);
    assert.equal(again.status, 1, out(again)); assert.match(out(again), /changed after it was reviewed/);
    const re = run(w, e, ['revoice', dir, '--line', 'Yet sailors can see it from thirty miles away.', '--to', 'Sailors see it from thirty miles away.']);
    assert.equal(re.status, 1, out(re)); assert.match(out(re), /changed after it was reviewed/);
    // the skip needs a reason, and is written down; a skip does not cover a later change
    const bare = run(w, e, ['voice', dir, '--skip-script-review']);
    assert.equal(bare.status, 1, out(bare)); assert.match(out(bare), /needs a reason/);
    const skip = run(w, e, ['voice', dir, '--skip-script-review', 'the owner read it aloud']);
    assert.equal(skip.status, 0, out(skip)); assert.match(out(skip), /skipped by the owner/);
    assert.match(fs.readFileSync(path.join(dir, 'approvals.md'), 'utf8'), /Script review: SKIPPED by the owner \(--skip-script-review\): the owner read it aloud \[script [0-9a-f]{12}\]/);
    fs.appendFileSync(path.join(dir, 'script.txt'), ' Last bit.');
    checks.recordFacts(dir, { scope: 'script', result: 'PASS', cfg: { no_research: 'a test script' } });
    const late = run(w, e, ['voice', dir]);
    assert.equal(late.status, 1, out(late)); assert.match(out(late), /changed after the owner skipped/);
  });
});

await test('no key is ever printed or written', () => {
  const w = world({ key: true }), e = engine(), dir = approved({ voice: undefined });
  const r = run(w, e, ['voice', dir], { STUB_PROVIDER: 'elevenlabs' });
  assert.equal(r.status, 0, out(r));
  const all = [out(r)];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(json|md|txt)$/.test(f.name)) all.push(fs.readFileSync(p, 'utf8')); } };
  walk(dir);
  for (const t of all) assert.ok(!t.includes(SECRET), 'the key text is nowhere');
  assert.equal(V.elevenKeyReady(), V.elevenKeyReady());
});

await test('chunkDone: a chunk made by another provider is not done; one with no record, or the same provider, is', () => {
  const d = tmp(); fs.mkdirSync(path.join(d, 'audio')); fs.mkdirSync(path.join(d, 'build'));
  fs.writeFileSync(path.join(d, 'audio', 'vo.mp3'), 'x'); fs.writeFileSync(path.join(d, 'script.txt'), 'Hello there.\n');
  assert.equal(V.chunkDone(d, 'Hello there.'), true);
  assert.equal(V.chunkDone(d, 'Hello there.', 'elevenlabs'), true, 'no record: as before');
  fs.writeFileSync(path.join(d, 'build', 'voice_source.json'), JSON.stringify({ provider: 'local' }));
  assert.equal(V.chunkDone(d, 'Hello there.', 'local'), true);
  assert.equal(V.chunkDone(d, 'Hello there.', 'elevenlabs'), false);
  assert.equal(V.chunkDone(d, 'Other words.', 'local'), false);
});

await test('relay prints an engine note once however many chunks say it, and everything else as it is', () => {
  const seen = new Set(), lines = [];
  const note = 'voice: built-in voice (free, basic quality). A natural voice service such as ElevenLabs is a suggested upgrade: kit suggest elevenlabs';
  for (let i = 0; i < 3; i++) V.relay(`voice: piece 1/1 (10 characters)\n${note}\n`, seen, (l) => lines.push(l));
  assert.equal(lines.filter((l) => l === note).length, 1);
  assert.equal(lines.filter((l) => /piece 1\/1/.test(l)).length, 3);
});

console.log(`\n${n} test(s) passed${process.exitCode ? ', some FAILED' : ''}`);
