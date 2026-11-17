#!/usr/bin/env node
// Tests for `video update` (studio/tools/update.mjs): finding the kit clone, comparing it with its git remote, pulling only when
// that is safe, running the installer (a stub here), and updating a channel folder with a dry run first and backups, without ever
// touching the channel's own data. Uses temporary git repositories (a local "remote"); no network, no key, no real install.
// Run: node setup/test-update.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as U from '../studio/tools/update.mjs';
import { makeWorkspace } from './new-workspace.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(REPO, 'studio', 'tools', 'video.mjs');
Object.assign(process.env, { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t', GIT_TERMINAL_PROMPT: '0',
  // the temporary repos keep LF on every system: Windows git would otherwise check files out as CRLF and the byte comparisons below would differ
  GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'core.safecrlf', GIT_CONFIG_VALUE_1: 'false' });
const hasGit = spawnSync('git', ['--version']).status === 0;
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}\n  ${e.stack || e}`); process.exitCode = 1; } };
if (!hasGit) { console.log('SKIPPED update tests: git is not installed'); process.exit(0); }
const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'video-update-test-')));
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const put = (root, files) => { for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); } };

// a tiny kit: VERSION, CHANGELOG.md, setup/install.*, template/ (CLAUDE.md, a skill, brand.json, .gitignore, videos/)
const KIT_V1 = {
  VERSION: '1.0.0\n', 'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n- the first release\n',
  'setup/install.mjs': '// stub\n', 'setup/install.sh': '#!/usr/bin/env bash\n',
  'template/CLAUDE.md': '# Channel rules v1\n', 'template/.gitignore': 'videos/*/build/\n', 'template/videos/.gitkeep': '',
  'template/brand/brand.json': JSON.stringify({ name: '', slug: '', youtube: { privacy: 'private' } }, null, 2) + '\n', 'template/brand/voice.md': 'voice starter\n',
  'template/.claude/skills/channel-setup/SKILL.md': 'channel-setup v1\n',
};
const KIT_V2 = {
  VERSION: '1.1.0\n', 'CHANGELOG.md': '# Changelog\n\n## 1.1.0\n- licensed assets\n- update command\n\n## 1.0.0\n- the first release\n',
  'template/CLAUDE.md': '# Channel rules v2\n', 'template/.gitignore': 'videos/*/build/\nbrand/licensed/*/*\n!brand/licensed/*/.gitkeep\n',
  'template/brand/brand.json': JSON.stringify({ name: '', slug: '', youtube: { privacy: 'private', language: 'en' }, licensed: { plan: 'business' } }, null, 2) + '\n',
  'template/brand/voice.md': 'voice starter CHANGED (never replaced)\n',
  'template/brand/licensed/README.md': 'how to download v2\n', 'template/brand/licensed/assets.json': '{"assets":[]}\n', 'template/brand/licensed/music/.gitkeep': '',
  'template/.claude/skills/video-update/SKILL.md': 'video-update v2\n', 'template/.claude/skills/channel-setup/SKILL.md': 'channel-setup v2\n',
};
// remote (bare), upstream (where "we" push new releases from), kit (the clone the owner installed from)
const world = () => {
  const base = tmp(), remote = path.join(base, 'remote.git'), up = path.join(base, 'upstream'), kit = path.join(base, 'kit');
  git(base, 'init', '-q', '--bare', '-b', 'main', remote); git(base, 'init', '-q', '-b', 'main', up);
  put(up, KIT_V1); git(up, 'add', '-A'); git(up, 'commit', '-q', '-m', 'v1'); git(up, 'remote', 'add', 'origin', remote); git(up, 'push', '-q', 'origin', 'main');
  git(base, 'clone', '-q', remote, kit);
  const release = () => { put(up, KIT_V2); git(up, 'add', '-A'); git(up, 'commit', '-q', '-m', 'v2: licensed assets and update'); git(up, 'push', '-q', 'origin', 'main'); };
  return { base, remote, up, kit, release };
};
const channelFrom = (kit) => {                                  // a channel folder made from the kit's current template, then given its own data
  const dir = path.join(tmp(), 'acme-videos');
  fs.cpSync(path.join(kit, 'template'), dir, { recursive: true });
  U.writeChannelBuild(dir, kit);
  put(dir, { 'CLAUDE.local.md': 'my own rules\n', 'videos/first/video.json': '{"style":"x"}\n', 'brand/facts.md': 'cleared facts\n' });
  const b = JSON.parse(fs.readFileSync(path.join(dir, 'brand', 'brand.json'), 'utf8')); b.name = 'Acme'; b.slug = 'acme'; b.youtube.privacy = 'unlisted';
  fs.writeFileSync(path.join(dir, 'brand', 'brand.json'), JSON.stringify(b, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'brand', 'voice.md'), 'acme voice\n');
  return dir;
};
const engineDir = (kit, { linked = false } = {}) => {
  const e = path.join(tmp(), 'bagelunit-video');
  if (linked) { fs.symlinkSync(path.join(kit, 'template'), e); return e; }
  fs.mkdirSync(e); fs.writeFileSync(path.join(e, 'SKILL.md'), '# engine\n');
  fs.writeFileSync(path.join(e, U.MARKER), JSON.stringify({ kit, version: U.kitVersion(kit), build: U.templateBuild(kit) }));
  return e;
};
const capture = () => { const lines = []; return { lines, log: (x) => lines.push(String(x)), text: () => lines.join('\n') }; };
const stubInstall = (status = 0) => { const calls = []; const fn = (kit, o) => { calls.push({ kit, ...o }); return { status, out: status ? 'ffmpeg is missing' : 'ok   copied studio/', text: 'bash setup/install.sh' }; }; fn.calls = calls; return fn; };

await test('the kit clone is found from --kit, the install marker, a linked engine, then ~/dev/bagelunit-video-kit; a wrong folder is explained', () => {
  const w = world(), home = tmp();
  assert.equal(U.findKit({ kit: w.kit, engine: path.join(home, 'none'), home }).how, 'given with --kit');
  assert.match(U.findKit({ kit: home, home }).error, /not a BagelUnit Video Kit folder/);
  assert.match(U.findKit({ engine: path.join(home, 'none'), home }).error, /cannot find the kit folder.*--kit/);
  const e = engineDir(w.kit);
  assert.deepEqual(U.findKit({ engine: e, home }), { dir: w.kit, how: 'recorded when the engine was installed' });
  fs.mkdirSync(path.join(home, 'dev'), { recursive: true }); fs.cpSync(w.kit, path.join(home, 'dev', 'bagelunit-video-kit'), { recursive: true });
  assert.match(U.findKit({ engine: path.join(home, 'none'), home }).how, /usual place/);
  if (process.platform !== 'win32') {
    const studioKit = tmp(); fs.cpSync(w.kit, studioKit, { recursive: true }); fs.mkdirSync(path.join(studioKit, 'studio')); fs.writeFileSync(path.join(studioKit, 'studio', 'SKILL.md'), 's');
    const link = path.join(tmp(), 'bagelunit-video'); fs.symlinkSync(path.join(studioKit, 'studio'), link);
    assert.deepEqual(U.findKit({ engine: link, home: tmp() }), { dir: fs.realpathSync(studioKit), how: 'the folder the linked engine points into' });
  }
});

await test('a dry run shows versions, builds and how far behind the remote the clone is, and changes nothing', async () => {
  const w = world(), ch = channelFrom(w.kit), e = engineDir(w.kit); w.release();
  const before = git(w.kit, 'rev-parse', 'HEAD'), c = capture(), inst = stubInstall();
  const r = await U.update({ kit: w.kit, channel: ch, engine: e, home: tmp(), log: c.log, install: inst });
  const t = c.text();
  assert.equal(r.ok, true); assert.equal(r.git.behind, 1); assert.equal(inst.calls.length, 0, 'a dry run installs nothing');
  assert.match(t, /version 1\.0\.0, build [0-9a-f]{12}/); assert.match(t, /1 commit behind origin\/main.*it is version 1\.1\.0/);
  assert.match(t, /v2: licensed assets and update/); assert.match(t, /template\/CLAUDE\.md/);
  assert.match(t, /would replace[^\n]*\n\s+\.claude\/skills\/channel-setup\/SKILL\.md\n\s+CLAUDE\.md/); assert.match(t, /would add[^\n]*\n[\s\S]*video-update\/SKILL\.md/);
  assert.match(t, /would add these settings to brand\/brand\.json:\n\s+youtube\.language\n\s+licensed/); assert.match(t, /would add these lines to \.gitignore/);
  assert.match(t, /This was a dry run: nothing was changed/);
  assert.equal(git(w.kit, 'rev-parse', 'HEAD'), before, 'not pulled'); assert.equal(fs.readFileSync(path.join(ch, 'CLAUDE.md'), 'utf8'), '# Channel rules v1\n');
  assert.ok(!fs.existsSync(path.join(ch, '.claude', 'skills', 'video-update')));
});

await test('--apply pulls (fast-forward), installs again, updates the channel with backups and never touches its data', async () => {
  const w = world(), ch = channelFrom(w.kit), e = engineDir(w.kit); w.release();
  const c = capture(), inst = stubInstall();
  const r = await U.update({ apply: true, kit: w.kit, channel: ch, engine: e, home: tmp(), log: c.log, install: inst, stamp: '20261117120000' });
  const t = c.text();
  assert.equal(r.ok, true, t); assert.equal(r.pulled, true); assert.equal(r.installed, true); assert.equal(U.kitVersion(w.kit), '1.1.0');
  assert.equal(inst.calls.length, 1); assert.equal(inst.calls[0].kit, w.kit); assert.equal(inst.calls[0].link, false);
  assert.ok(t.indexOf('pulled:') < t.indexOf('engine:          installed again') && t.indexOf('installed again') < t.indexOf('channel folder:'), 'order: pull, install, channel');
  // replaced files: new text, old kept as .bak-<stamp>
  assert.equal(fs.readFileSync(path.join(ch, 'CLAUDE.md'), 'utf8'), '# Channel rules v2\n'); assert.equal(fs.readFileSync(path.join(ch, 'CLAUDE.md.bak-20261117120000'), 'utf8'), '# Channel rules v1\n');
  assert.equal(fs.readFileSync(path.join(ch, '.claude/skills/channel-setup/SKILL.md'), 'utf8'), 'channel-setup v2\n'); assert.ok(fs.existsSync(path.join(ch, '.claude/skills/channel-setup/SKILL.md.bak-20261117120000')));
  assert.equal(fs.readFileSync(path.join(ch, '.claude/skills/video-update/SKILL.md'), 'utf8'), 'video-update v2\n');
  // added starter files
  for (const f of ['brand/licensed/README.md', 'brand/licensed/assets.json', 'brand/licensed/music/.gitkeep']) assert.ok(fs.existsSync(path.join(ch, f)), f);
  // the channel's own data: untouched
  assert.equal(fs.readFileSync(path.join(ch, 'CLAUDE.local.md'), 'utf8'), 'my own rules\n'); assert.equal(fs.readFileSync(path.join(ch, 'videos/first/video.json'), 'utf8'), '{"style":"x"}\n');
  assert.equal(fs.readFileSync(path.join(ch, 'brand/facts.md'), 'utf8'), 'cleared facts\n'); assert.equal(fs.readFileSync(path.join(ch, 'brand/voice.md'), 'utf8'), 'acme voice\n');
  const b = JSON.parse(fs.readFileSync(path.join(ch, 'brand/brand.json'), 'utf8'));
  assert.equal(b.name, 'Acme'); assert.equal(b.youtube.privacy, 'unlisted', 'an existing value is never changed'); assert.equal(b.youtube.language, 'en'); assert.deepEqual(b.licensed, { plan: 'business' });
  assert.equal(fs.readFileSync(path.join(ch, '.gitignore'), 'utf8').split('\n').filter((l) => l === 'brand/licensed/*/*').length, 1);
  assert.ok(!fs.readdirSync(ch).some((f) => /\.bak-/.test(f) && f.startsWith('CLAUDE.local')));
  assert.deepEqual(U.channelBuild(ch), { version: '1.1.0', build: U.templateBuild(w.kit) });
  assert.match(t, /this channel folder now needs:[\s\S]*restart Claude Code[\s\S]*brand\/licensed\/README\.md/); assert.match(t, /The engine is updated: restart Claude Code/);
  assert.match(t, /## 1\.1\.0\n- licensed assets/);
  // run again: nothing left to do, and no more backups
  const c2 = capture(); await U.update({ apply: true, kit: w.kit, channel: ch, engine: e, home: tmp(), log: c2.log, install: stubInstall(), stamp: '20261117130000' });
  assert.match(c2.text(), /already current: nothing to change/); assert.ok(!fs.existsSync(path.join(ch, 'CLAUDE.md.bak-20261117130000')));
});

await test('--apply stops, changing nothing, when the clone has uncommitted tracked changes and is behind (it says why)', async () => {
  const w = world(), ch = channelFrom(w.kit); w.release();
  fs.appendFileSync(path.join(w.kit, 'CHANGELOG.md'), 'my edit\n');
  const c = capture(), inst = stubInstall(), before = git(w.kit, 'rev-parse', 'HEAD');
  const r = await U.update({ apply: true, kit: w.kit, channel: ch, engine: engineDir(w.kit), home: tmp(), log: c.log, install: inst });
  assert.equal(r.ok, false); assert.match(r.stopped, /uncommitted changes in tracked files[\s\S]*CHANGELOG\.md/); assert.match(c.text(), /STOPPED/);
  assert.equal(git(w.kit, 'rev-parse', 'HEAD'), before); assert.equal(inst.calls.length, 0, 'no install after a refused pull'); assert.equal(fs.readFileSync(path.join(ch, 'CLAUDE.md'), 'utf8'), '# Channel rules v1\n');
  assert.ok(fs.readFileSync(path.join(w.kit, 'CHANGELOG.md'), 'utf8').endsWith('my edit\n'), 'the owner\'s edit is still there');
  // an untracked file does not count as dirty
  git(w.kit, 'checkout', '--', 'CHANGELOG.md'); fs.writeFileSync(path.join(w.kit, 'notes.txt'), 'scratch');
  const r2 = await U.update({ apply: true, kit: w.kit, channel: ch, engine: engineDir(w.kit), home: tmp(), log: () => {}, install: stubInstall() });
  assert.equal(r2.ok, true); assert.equal(r2.pulled, true);
});

await test('--apply stops when the clone has diverged from the remote (ahead and behind)', async () => {
  const w = world(); w.release();
  put(w.kit, { 'local.txt': 'mine' }); git(w.kit, 'add', '-A'); git(w.kit, 'commit', '-q', '-m', 'local commit');
  const r = await U.update({ apply: true, kit: w.kit, engine: engineDir(w.kit), home: tmp(), cwd: tmp(), log: () => {}, install: stubInstall() });
  assert.equal(r.ok, false); assert.match(r.stopped, /diverged/); assert.equal(r.git.ahead, 1); assert.equal(r.git.behind, 1);
});

await test('when the clone is up to date nothing is pulled but the engine and the channel are still updated; a failed installer stops before the channel', async () => {
  const w = world(); w.release(); git(w.kit, 'pull', '-q', '--ff-only');
  const ch = channelFrom(w.up), c = capture(), inst = stubInstall(); fs.writeFileSync(path.join(ch, 'CLAUDE.md'), '# older\n');
  const r = await U.update({ apply: true, kit: w.kit, channel: ch, engine: engineDir(w.kit), home: tmp(), log: c.log, install: inst, stamp: '20261117140000' });
  assert.equal(r.pulled, false); assert.match(c.text(), /up to date with origin\/main/); assert.equal(inst.calls.length, 1); assert.equal(fs.readFileSync(path.join(ch, 'CLAUDE.md.bak-20261117140000'), 'utf8'), '# older\n');
  const ch2 = channelFrom(w.kit); fs.writeFileSync(path.join(ch2, 'CLAUDE.md'), '# older\n');
  const c2 = capture(), bad = stubInstall(1);
  const r2 = await U.update({ apply: true, kit: w.kit, channel: ch2, engine: engineDir(w.kit), home: tmp(), log: c2.log, install: bad });
  assert.equal(r2.ok, false); assert.match(r2.stopped, /installer failed.*channel folder was not updated/); assert.match(c2.text(), /ffmpeg is missing/); assert.equal(fs.readFileSync(path.join(ch2, 'CLAUDE.md'), 'utf8'), '# older\n');
});

await test('a linked engine is linked again (the installer gets --link); --no-pull and --no-install skip those steps', async () => {
  if (process.platform === 'win32') return;
  const w = world(); w.release();
  const link = path.join(tmp(), 'bagelunit-video'); fs.mkdirSync(path.join(w.kit, 'studio')); fs.writeFileSync(path.join(w.kit, 'studio', 'SKILL.md'), 's'); fs.symlinkSync(path.join(w.kit, 'studio'), link);
  const inst = stubInstall(), c = capture();
  const r = await U.update({ apply: true, kit: w.kit, engine: link, home: tmp(), cwd: tmp(), pull: false, log: c.log, install: inst });
  assert.equal(r.pulled, false); assert.equal(inst.calls[0].link, true); assert.match(c.text(), /follows the clone|linked to the kit folder/);
  const inst2 = stubInstall(); await U.update({ apply: true, kit: w.kit, engine: link, home: tmp(), cwd: tmp(), install: false, pull: false, log: () => {} }); assert.equal(inst2.calls.length, 0);
});

await test('a clone that is not a git repository (a ZIP) or has no remote is explained, not an error', async () => {
  const w = world(), zip = tmp(); fs.cpSync(w.kit, zip, { recursive: true }); fs.rmSync(path.join(zip, '.git'), { recursive: true, force: true });
  const c = capture(); const r = await U.update({ kit: zip, engine: engineDir(zip), home: tmp(), cwd: tmp(), log: c.log, install: stubInstall() });
  assert.equal(r.ok, true); assert.match(c.text(), /not a git clone \(for example a downloaded ZIP\)/);
  git(w.kit, 'remote', 'remove', 'origin');
  const c2 = capture(); await U.update({ kit: w.kit, engine: engineDir(w.kit), home: tmp(), cwd: tmp(), log: c2.log, install: stubInstall() });
  assert.match(c2.text(), /no git remote/);
});

await test('--no-fetch does not touch the remote; an unreachable remote is reported and the rest carries on', async () => {
  const w = world(); w.release();
  const c = capture(); const r = await U.update({ kit: w.kit, engine: engineDir(w.kit), home: tmp(), cwd: tmp(), fetch: false, log: c.log, install: stubInstall() });
  assert.equal(r.git.fetched, false); assert.equal(r.git.behind ?? 0, 0, 'without a fetch it cannot know about the new commit'); assert.match(c.text(), /not fetched/);
  git(w.kit, 'remote', 'set-url', 'origin', path.join(w.base, 'gone.git'));
  const c2 = capture(); const r2 = await U.update({ kit: w.kit, engine: engineDir(w.kit), home: tmp(), cwd: tmp(), log: c2.log, install: stubInstall() });
  assert.equal(r2.ok, true); assert.match(c2.text(), /could not fetch/);
});

await test('only a channel folder is updated: not the kit\'s own template, not a plain folder; --all uses the channel list', async () => {
  const w = world(); w.release();
  assert.equal(U.isChannel(path.join(w.kit, 'template'), w.kit), false); assert.equal(U.isChannel(tmp(), w.kit), false);
  const c = capture(); const r = await U.update({ apply: true, kit: w.kit, channel: path.join(w.kit, 'template'), engine: engineDir(w.kit), home: tmp(), log: c.log, install: stubInstall() });
  assert.ok(r.channels[0].skipped); assert.match(c.text(), /is not a channel folder/);
  const home = tmp(), a = channelFrom(w.up), b = channelFrom(w.up);
  fs.mkdirSync(path.join(home, '.config', 'bagelunit-video'), { recursive: true }); fs.writeFileSync(path.join(home, '.config', 'bagelunit-video', 'channels.json'), JSON.stringify([{ slug: 'a', dir: a }, { slug: 'b', dir: b }, { slug: 'gone', dir: path.join(home, 'gone') }]));
  const r2 = await U.update({ apply: true, kit: w.kit, all: true, engine: engineDir(w.kit), home, cwd: tmp(), log: () => {}, install: stubInstall() });
  assert.equal(r2.channels.length, 2); assert.ok(r2.channels.every((x) => x.plan));
  assert.match(fs.readFileSync(path.join(a, 'CLAUDE.md'), 'utf8'), /v2/); assert.match(fs.readFileSync(path.join(b, 'CLAUDE.md'), 'utf8'), /v2/);
});

await test('outside a channel folder it updates the engine and lists the channels to update', async () => {
  const w = world(), home = tmp(), ch = channelFrom(w.kit); fs.mkdirSync(path.join(home, '.config', 'bagelunit-video'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'bagelunit-video', 'channels.json'), JSON.stringify([{ slug: 'acme', dir: ch }]));
  const c = capture(), inst = stubInstall(); await U.update({ apply: true, kit: w.kit, engine: engineDir(w.kit), home, cwd: tmp(), log: c.log, install: inst });
  assert.equal(inst.calls.length, 1); assert.match(c.text(), /channel folder:  none here\. Run this inside a channel folder[\s\S]*acme-videos/);
});

await test('the real template: a channel made by new-workspace records its build and is "already current"; the install marker is written by the installer code', () => {
  const home = tmp(), folder = path.join(home, 'quark-videos');
  const r = makeWorkspace(folder, { registry: path.join(home, 'channels.json') });
  assert.deepEqual(U.channelBuild(r.dir), { version: U.kitVersion(REPO), build: U.templateBuild(REPO) });
  const plan = U.planTemplate(REPO, r.dir);
  assert.deepEqual([plan.add, plan.replace, plan.settings, plan.gitignore], [[], [], [], []], JSON.stringify(plan));
  fs.writeFileSync(path.join(r.dir, 'CLAUDE.md'), 'edited');
  assert.deepEqual(U.planTemplate(REPO, r.dir).replace, ['CLAUDE.md']);
  fs.rmSync(path.join(r.dir, '.claude', 'skills', 'db'), { recursive: true });
  assert.ok(U.planTemplate(REPO, r.dir).add.includes('.claude/skills/db/SKILL.md'));
  for (const skill of ['db', 'video-update', 'channel-setup']) assert.ok(fs.existsSync(path.join(REPO, 'template', '.claude', 'skills', skill, 'SKILL.md')), skill);
  assert.match(fs.readFileSync(path.join(REPO, 'setup', 'install.mjs'), 'utf8'), /\.install\.json/);
});

await test('an older channel folder gets brand/jargon.md and the brand.json "writing" settings added, and its own jargon list is kept', () => {
  const home = tmp(), r = makeWorkspace(path.join(home, 'old-videos'), { registry: path.join(home, 'channels.json') });
  const bf = path.join(r.dir, 'brand', 'brand.json'), b = JSON.parse(fs.readFileSync(bf, 'utf8')); delete b.writing; fs.writeFileSync(bf, JSON.stringify(b));
  fs.rmSync(path.join(r.dir, 'brand', 'jargon.md'));
  const plan = U.planTemplate(REPO, r.dir);
  assert.ok(plan.add.includes('brand/jargon.md'), JSON.stringify(plan));
  assert.ok(plan.settings.includes('writing'), JSON.stringify(plan.settings));
  fs.writeFileSync(path.join(r.dir, 'brand', 'jargon.md'), '# mine\n\n## Terms\nphotolysis | breaking apart with light\n');
  const again = U.planTemplate(REPO, r.dir);
  assert.ok(!again.add.includes('brand/jargon.md') && again.kept.includes('brand/jargon.md'), JSON.stringify(again));
});

await test('the command line: video update is a dry run by default and explains a missing kit folder', () => {
  const home = tmp(), env = { ...process.env, HOME: home, USERPROFILE: home, BAGELUNIT_VIDEO_ENGINE: path.join(home, 'none') };
  let r = spawnSync(process.execPath, [VIDEO, 'update'], { cwd: home, encoding: 'utf8', env });
  assert.equal(r.status, 1); assert.match(r.stdout, /cannot find the kit folder/);
  r = spawnSync(process.execPath, [VIDEO, 'update', '--kit', REPO, '--no-fetch', '--channel', makeWorkspace(path.join(home, 'x-videos'), { registry: path.join(home, 'c.json') }).dir], { cwd: home, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /This was a dry run/); assert.match(r.stdout, /already current: nothing to change/);
});

await test('the command line path installs for real: options as video update passes them (install: true), no stub function', async () => {
  const w = world(), ch = channelFrom(w.kit), e = engineDir(w.kit); w.release();
  const c = capture();
  // video update's command line passes install: true (or false for --no-install), never a function: the default installer must run (the kit's setup/install.* here are empty scripts)
  const r = await U.update({ apply: true, kit: w.kit, channel: ch, engine: e, home: tmp(), log: c.log, install: true, stamp: '20261117120000' });
  assert.equal(r.ok, true, c.text()); assert.equal(r.installed, true, c.text()); assert.match(c.text(), /installed again/);
  const r2 = await U.update({ apply: true, kit: w.kit, channel: ch, engine: e, home: tmp(), log: capture().log, install: false });
  assert.equal(r2.installed, false);
});

console.log(`\n${n} test(s) passed`);
