// update.mjs · `video update`: bring the installed engine and a channel folder up to the newest kit.
//
//   node video.mjs update [--apply] [--kit <clone>] [--channel <folder> | --all] [--no-fetch] [--no-pull] [--no-install]
//
// Without --apply it only shows: which kit clone it found, this version and build against the clone's, how far the clone is
// behind its git remote (it runs `git fetch`, which reads the remote and changes no file; --no-fetch skips it), what a pull
// would bring, and what would change in the channel folder.
// With --apply, in this order:
//   1. `git pull --ff-only` in the clone, only when it is behind, and only when its tracked files have no uncommitted
//      change (otherwise it stops and says why: nothing has been changed).
//   2. the installer (`bash setup/install.sh`, on Windows `node setup/install.mjs`), which puts the engine in
//      ~/.claude/skills/bagelunit-video again (linked again if it was linked).
//   3. the channel folder's template files. It updates only what the kit owns (CLAUDE.md, .claude/skills, scripts,
//      brand/licensed/README.md); every file it replaces is first saved next to it as <name>.bak-<stamp>. It adds starter files
//      that are missing and any new setting in brand/brand.json (an existing value is never changed), and adds missing lines
//      to .gitignore. It NEVER touches the channel's own data: brand values, brand/licensed assets, videos/, CLAUDE.local.md.
// The clone is found from, in order: --kit, the engine's install marker (.install.json, written by the installer), the folder
// a linked engine points into, ~/dev/bagelunit-video-kit. The channel folder is the current one (or --channel).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MARKER = '.install.json';
export const BUILD_FILE = '.kit-build';
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const posix = (p) => p.split(path.sep).join('/');
const stampNow = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

/* ── versions and builds ────────────────────────────────────────────────────────────────────────────────────────────── */
export function* walk(root, base = root) {
  for (const e of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === '.DS_Store') continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) yield* walk(p, base); else if (e.isFile()) yield posix(path.relative(base, p));
  }
}
// the build of a kit's channel template: a fingerprint of every file in template/ (a change of one byte is a new build)
export function templateBuild(kit) {
  const t = path.join(kit, 'template'), h = createHash('sha256');
  if (!fs.existsSync(t)) return null;
  for (const rel of walk(t)) if (rel !== BUILD_FILE) h.update(`${rel}\0`).update(fs.readFileSync(path.join(t, rel))).update('\n');
  return h.digest('hex').slice(0, 12);
}
export const kitVersion = (kit) => readText(path.join(kit, 'VERSION')).trim() || 'unknown';
export function channelBuild(channel) {
  const m = /^(\S+)\s+([0-9a-f]{12})/.exec(readText(path.join(channel, BUILD_FILE)).trim());
  return m ? { version: m[1], build: m[2] } : null;
}
export const writeChannelBuild = (channel, kit) => fs.writeFileSync(path.join(channel, BUILD_FILE), `${kitVersion(kit)} ${templateBuild(kit)}\n`);
const semver = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0);
export function newer(a, b) { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; }

/* ── finding the clone and the engine ───────────────────────────────────────────────────────────────────────────────── */
export const defaultEngine = (env = process.env, home = os.homedir()) => env.BAGELUNIT_VIDEO_ENGINE || path.join(home, '.claude', 'skills', 'bagelunit-video');
export const isKit = (d) => Boolean(d) && fs.existsSync(path.join(d, 'VERSION')) && fs.existsSync(path.join(d, 'template', 'CLAUDE.md')) && fs.existsSync(path.join(d, 'setup', 'install.mjs'));
export function engineInfo(engine) {
  let linked = false, target = null;
  try { linked = fs.lstatSync(engine).isSymbolicLink(); if (linked) target = fs.realpathSync(engine); } catch { return { present: false }; }
  if (!fs.existsSync(path.join(engine, 'SKILL.md'))) return { present: false };
  const marker = readJSON(path.join(engine, MARKER), null);
  return { present: true, linked, target, marker, version: marker?.version || null, build: marker?.build || null };
}
export function findKit({ kit = null, engine = defaultEngine(), home = os.homedir() } = {}) {
  if (kit) { const d = path.resolve(String(kit).replace(/^~(?=$|[\\/])/, home)); return isKit(d) ? { dir: d, how: 'given with --kit' } : { error: `${d} is not a BagelUnit Video Kit folder (no VERSION, setup/install.mjs and template/CLAUDE.md)` }; }
  const info = engineInfo(engine);
  if (info.marker?.kit && isKit(info.marker.kit)) return { dir: info.marker.kit, how: 'recorded when the engine was installed' };
  if (info.linked && info.target && isKit(path.dirname(info.target))) return { dir: path.dirname(info.target), how: 'the folder the linked engine points into' };
  const guess = path.join(home, 'dev', 'bagelunit-video-kit');
  if (isKit(guess)) return { dir: guess, how: 'the usual place (~/dev/bagelunit-video-kit)' };
  return { error: 'cannot find the kit folder. Give it with  video update --kit <folder>  (the clone of bagelunit-video-kit that you installed from), or clone it again: git clone https://github.com/bagelunit/bagelunit-video-kit ~/dev/bagelunit-video-kit' };
}

/* ── git ────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
export const defaultRun = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) return { status: 127, stdout: '', stderr: r.error.code === 'ENOENT' ? 'git is not installed' : String(r.error.message) };
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
};
// where the clone stands against its remote. fetch only reads the remote; nothing in the working tree changes.
export function gitState(kit, { fetch = true, run = defaultRun } = {}) {
  const g = (...a) => run(kit, a);
  const top = g('rev-parse', '--show-toplevel');
  if (top.status !== 0 || fs.realpathSync(top.stdout) !== fs.realpathSync(kit)) return { git: false, why: 'this folder is not a git clone (for example a downloaded ZIP), so there is nothing to pull: download the newest kit and install from it, or clone it with git' };
  const branch = g('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  const remotes = g('remote').stdout.split('\n').filter(Boolean), remote = remotes.includes('origin') ? 'origin' : remotes[0] || null;
  const dirty = g('status', '--porcelain', '--untracked-files=no').stdout.split('\n').filter(Boolean);
  const out = { git: true, branch, remote, dirty, fetched: false, head: g('rev-parse', '--short', 'HEAD').stdout };
  if (!remote) return { ...out, why: 'the clone has no git remote, so it cannot be compared with anything' };
  if (fetch) {
    const f = g('fetch', '--quiet', remote);
    out.fetched = f.status === 0;
    if (!out.fetched) out.fetchError = f.stderr.split('\n')[0] || 'git fetch failed (offline?)';
  }
  const up = g('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  const upstream = up.status === 0 && up.stdout ? up.stdout : `${remote}/main`;
  const has = g('rev-parse', '--verify', '--quiet', upstream);
  if (has.status !== 0) return { ...out, upstream, why: `${upstream} is not known here${fetch ? '' : ' (run without --no-fetch)'}` };
  const [ahead, behind] = g('rev-list', '--left-right', '--count', `HEAD...${upstream}`).stdout.split(/\s+/).map(Number);
  const commits = behind ? g('log', '--oneline', '-n', '15', `HEAD..${upstream}`).stdout.split('\n') : [];
  const stat = behind ? g('diff', '--stat', '--stat-width=100', `HEAD...${upstream}`).stdout.split('\n') : [];
  const newVersion = behind ? g('show', `${upstream}:VERSION`).stdout.trim() : '';
  return { ...out, upstream, ahead: ahead || 0, behind: behind || 0, commits, stat, newVersion };
}

// the files of one ref as they are in git, written to a new temporary folder (to show a dry run what a pull would bring)
export function exportRef(kit, ref, run = defaultRun) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'video-kit-ref-'));
  const names = run(kit, ['ls-tree', '-r', '--name-only', ref]).stdout.split('\n').filter((f) => f === 'VERSION' || f === 'CHANGELOG.md' || f.startsWith('template/'));
  for (const f of names) {
    const r = spawnSync('git', ['show', `${ref}:${f}`], { cwd: kit, maxBuffer: 1 << 28 });
    if (r.status !== 0) continue;
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), r.stdout);
  }
  return out;
}

/* ── the installer ──────────────────────────────────────────────────────────────────────────────────────────────────── */
export function installCommand(kit, { link = false, platform = process.platform } = {}) {
  const extra = link ? ['--link'] : [];
  return platform === 'win32' ? { cmd: process.execPath, args: [path.join(kit, 'setup', 'install.mjs'), ...extra], text: `node setup/install.mjs${link ? ' --link' : ''}` }
    : { cmd: 'bash', args: [path.join(kit, 'setup', 'install.sh'), ...extra], text: `bash setup/install.sh${link ? ' --link' : ''}` };
}
export const defaultInstall = (kit, o) => {
  const c = installCommand(kit, o), r = spawnSync(c.cmd, c.args, { cwd: kit, encoding: 'utf8' });
  return { status: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), text: c.text };
};

/* ── the channel folder ─────────────────────────────────────────────────────────────────────────────────────────────── */
const BRAND_OWNED = new Set(['brand/licensed/README.md']);          // docs inside brand/ that belong to the kit
function addMissing(target, source, trail = '') {
  const added = [];
  for (const [k, v] of Object.entries(source)) {
    if (!(k in target)) { target[k] = v; added.push(trail + k); }
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) added.push(...addMissing(target[k], v, `${trail}${k}.`));
  }
  return added;
}
// what updating a channel folder from the clone's template would do (changes nothing)
export function planTemplate(kit, channel) {
  const t = path.join(kit, 'template');
  const plan = { add: [], replace: [], same: [], gitignore: [], settings: [], kept: [] };
  for (const rel of walk(t)) {
    if (rel === BUILD_FILE || rel === 'CLAUDE.local.md' || rel.startsWith('videos/')) continue;
    const src = path.join(t, rel), dst = path.join(channel, rel), has = fs.existsSync(dst);
    if (rel === '.gitignore') {
      const have = new Set(readText(dst).split('\n').map((l) => l.trim()));
      plan.gitignore = readText(src).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !have.has(l));
    } else if (rel === 'brand/brand.json') {
      if (!has) { plan.add.push(rel); continue; }
      const mine = readJSON(dst, null), theirs = readJSON(src, {});
      if (!mine) plan.kept.push(`${rel} (not valid JSON: left alone)`); else plan.settings = addMissing(JSON.parse(JSON.stringify(mine)), theirs);
    } else if (rel.startsWith('brand/') && !BRAND_OWNED.has(rel)) { if (!has) plan.add.push(rel); else plan.kept.push(rel); }
    else if (!has) plan.add.push(rel);
    else if (fs.readFileSync(src).equals(fs.readFileSync(dst))) plan.same.push(rel);
    else plan.replace.push(rel);
  }
  return plan;
}
export function applyTemplate(kit, channel, plan, stamp = stampNow()) {
  const t = path.join(kit, 'template'), backups = [];
  for (const rel of [...plan.add, ...plan.replace]) {
    const dst = path.join(channel, rel);
    if (fs.existsSync(dst)) { const b = `${dst}.bak-${stamp}`; fs.copyFileSync(dst, b); backups.push(posix(path.relative(channel, b))); }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(t, rel), dst);
  }
  if (plan.gitignore.length) {
    const f = path.join(channel, '.gitignore'), cur = readText(f);
    fs.writeFileSync(f, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}# added by video update ${stamp.slice(0, 8)}\n${plan.gitignore.join('\n')}\n`);
  }
  if (plan.settings.length) {
    const f = path.join(channel, 'brand', 'brand.json'), mine = readJSON(f, {});
    addMissing(mine, readJSON(path.join(t, 'brand', 'brand.json'), {}));
    fs.writeFileSync(f, JSON.stringify(mine, null, 2) + '\n');
  }
  writeChannelBuild(channel, kit);
  return { backups };
}
export function isChannel(dir, kit = null) {
  if (!dir || !fs.existsSync(path.join(dir, 'brand', 'brand.json'))) return false;
  if (kit) { const real = fs.realpathSync(dir), k = fs.realpathSync(kit); if (real === k || real.startsWith(k + path.sep)) return false; }   // never the kit's own template/
  return true;
}

// the entries of CHANGELOG.md newer than a version (or just the newest one), trimmed
export function changelogSince(kit, since, maxLines = 24) {
  const lines = readText(path.join(kit, 'CHANGELOG.md')).split('\n'), heads = [];
  lines.forEach((l, i) => { const m = /^## (\d+\.\d+\.\d+)/.exec(l); if (m) heads.push({ v: m[1], i }); });
  const pick = heads.filter((h, k) => (since ? newer(h.v, since) || (k === 0 && h.v === since) : k === 0));
  return pick.map((h) => { const next = heads.find((x) => x.i > h.i)?.i ?? lines.length; const body = lines.slice(h.i, next).filter((l) => l.trim()); return body.slice(0, maxLines).join('\n') + (body.length > maxLines ? `\n  ... (${body.length - maxLines} more lines in CHANGELOG.md)` : ''); });
}

/* ── the whole thing ────────────────────────────────────────────────────────────────────────────────────────────────── */
export async function update(o = {}) {
  const log = o.log || console.log, env = o.env || process.env, home = o.home || os.homedir();
  const engine = o.engine || defaultEngine(env, home), apply = Boolean(o.apply), run = o.run || defaultRun, install = o.install || defaultInstall;
  const res = { ok: true, stopped: null, applied: false, pulled: false, installed: false, channels: [] };
  const stop = (why) => { res.ok = false; res.stopped = why; log(`STOPPED: ${why}\nNothing was changed after this point.`); return res; };

  const found = findKit({ kit: o.kit, engine, home });
  if (found.error) { log(found.error); res.ok = false; res.stopped = found.error; return res; }
  const kit = found.dir; res.kit = kit;
  const info = engineInfo(engine), version = kitVersion(kit), build = templateBuild(kit);
  log(`kit folder:      ${kit} (${found.how})`);
  log(`kit (the clone): version ${version}, build ${build}`);
  log(`engine:          ${info.present ? `${engine}${info.linked ? ' (linked to the kit folder, so it follows the clone)' : ''}${info.version ? `, installed from version ${info.version}, build ${info.build}` : info.linked ? '' : ', no install marker (installed before updates existed)'}` : `NOT installed at ${engine}`}`);

  // 1. git
  const git = gitState(kit, { fetch: o.fetch !== false, run });
  res.git = git;
  if (!git.git) log(`git:             ${git.why}`);
  else {
    log(`git:             branch ${git.branch}${git.remote ? `, remote ${git.remote}` : ''}${git.fetched ? ' (fetched just now)' : git.fetchError ? ` (could not fetch: ${git.fetchError})` : ' (not fetched)'}`);
    if (git.why) log(`                 ${git.why}`);
    else if (git.behind) log(`                 ${git.behind} commit${git.behind === 1 ? '' : 's'} behind ${git.upstream}${git.ahead ? `, ${git.ahead} ahead` : ''}${git.newVersion && git.newVersion !== version ? `: it is version ${git.newVersion}` : ''}`);
    else log(`                 up to date with ${git.upstream}${git.ahead ? ` (${git.ahead} commit${git.ahead === 1 ? '' : 's'} ahead, not pushed)` : ''}`);
    if (git.behind) {
      log('what a pull would bring:');
      for (const c of git.commits) log(`   ${c}`);
      if (git.behind > git.commits.length) log(`   ... and ${git.behind - git.commits.length} more`);
      for (const l of git.stat.slice(-12)) log(`   ${l}`);
    }
    if (git.dirty.length) log(`                 uncommitted changes in tracked files: ${git.dirty.length}${git.behind ? ' (a pull is refused while there are any)' : ''}`);
  }
  const needsPull = Boolean(git.git && git.behind);
  // a dry run shows the channel plan against what the clone will be after the pull (read from git, nothing is written to the clone)
  let planKit = kit, ghost = null;
  if (!apply && needsPull && o.pull !== false) { try { ghost = exportRef(kit, git.upstream, run); planKit = ghost; } catch { /* the plan then uses the clone as it is */ } }
  if (apply && needsPull && o.pull !== false) {
    if (git.dirty.length) return stop(`the kit folder has uncommitted changes in tracked files, so it is not pulled:\n   ${git.dirty.slice(0, 8).join('\n   ')}\nCommit or stash them in ${kit}, then run  video update --apply  again (or use --no-pull to update from what is there).`);
    if (git.ahead) return stop(`the kit folder has ${git.ahead} commit(s) that ${git.upstream} does not, and is ${git.behind} behind it: it has diverged, and a fast-forward pull cannot be done. Sort that out in ${kit} (rebase or merge), then run this again.`);
    const p = run(kit, ['pull', '--ff-only']);
    if (p.status !== 0) return stop(`git pull --ff-only failed: ${(p.stderr || p.stdout).split('\n')[0]}`);
    res.pulled = true;
    log(`pulled: ${kitVersion(kit)} (${templateBuild(kit)}), ${git.behind} commit${git.behind === 1 ? '' : 's'}`);
  }

  // 2. the engine
  const link = Boolean(info.linked);
  const after = { version: kitVersion(planKit), build: templateBuild(planKit) };
  const engineBehind = !info.present || (!info.linked && (info.version !== after.version || info.build !== after.build));
  if (!apply) log(`engine:          ${engineBehind ? 'would be installed again' : info.linked ? 'follows the clone, would be linked again' : 'looks current (installed again anyway on --apply)'}: ${installCommand(kit, { link }).text}`);
  else if (o.install === false) log('engine:          skipped (--no-install)');
  else {
    const r = install(kit, { link });
    res.installed = r.status === 0;
    if (r.out) log(r.out.split('\n').map((l) => `   ${l}`).join('\n'));
    if (r.status !== 0) return stop(`the installer failed (${r.text}, exit ${r.status}); the channel folder was not updated`);
    log(`engine:          installed again (${r.text})`);
  }

  // 3. the channel folder(s)
  const regFile = path.join(home, '.config', 'bagelunit-video', 'channels.json');
  const cwdChannel = (() => { let d = path.resolve(o.cwd || process.cwd()); for (;;) { if (fs.existsSync(path.join(d, 'brand', 'brand.json'))) return d; const up = path.dirname(d); if (up === d) return null; d = up; } })();
  let channels = [];
  if (o.channel) channels = [path.resolve(String(o.channel).replace(/^~(?=$|[\\/])/, home))];
  else if (o.all) channels = readJSON(regFile, []).map((c) => c.dir).filter((d) => d && fs.existsSync(d));
  else if (cwdChannel) channels = [cwdChannel];
  if (!channels.length) {
    log('channel folder:  none here. Run this inside a channel folder (or give --channel <folder>, or --all for every channel on this computer) to update it too.');
    const known = readJSON(regFile, []).filter((c) => c.dir && fs.existsSync(c.dir));
    for (const c of known) log(`                 ${c.dir}`);
  }
  for (const ch of channels) {
    const entry = { dir: ch };
    res.channels.push(entry);
    if (!isChannel(ch, kit)) { log(`channel folder:  ${ch} is not a channel folder (no brand/brand.json, or it is the kit itself): skipped`); entry.skipped = true; continue; }
    const rec = channelBuild(ch), plan = planTemplate(planKit, ch);
    entry.plan = plan;
    log(`channel folder:  ${ch}\n                 on ${rec ? `version ${rec.version}, build ${rec.build}` : 'an unknown version (made before updates were recorded)'}; the kit's template ${planKit !== kit ? 'after the pull' : 'now'} is version ${after.version}, build ${after.build}`);
    const show = (label, list) => { if (list.length) log(`   ${label}:\n${list.slice(0, 40).map((x) => `      ${x}`).join('\n')}${list.length > 40 ? `\n      ... and ${list.length - 40} more` : ''}`); };
    show(apply ? 'added' : 'would add', plan.add);
    show(apply ? 'replaced (the old copy is kept next to it as <name>.bak-<stamp>)' : 'would replace (the old copy is kept next to it as <name>.bak-<stamp>)', plan.replace);
    show(apply ? 'settings added to brand/brand.json' : 'would add these settings to brand/brand.json', plan.settings);
    show(apply ? 'lines added to .gitignore' : 'would add these lines to .gitignore', plan.gitignore);
    if (!plan.add.length && !plan.replace.length && !plan.settings.length && !plan.gitignore.length) log('   already current: nothing to change');
    if (!apply) continue;
    const r = applyTemplate(kit, ch, plan, o.stamp);
    entry.backups = r.backups;
    res.applied = true;
    log(`   done. ${r.backups.length ? `${r.backups.length} old file${r.backups.length === 1 ? '' : 's'} kept as .bak-${(o.stamp || stampNow()).slice(0, 8)}...: if you changed ${plan.replace.includes('CLAUDE.md') ? 'CLAUDE.md or ' : ''}a skill for this channel only, move that change into CLAUDE.local.md (updates never touch it).` : 'no file needed a backup.'}`);
    const needs = [];
    if (plan.replace.some((x) => x.startsWith('.claude/skills/')) || plan.add.some((x) => x.startsWith('.claude/skills/'))) needs.push('restart Claude Code in this folder so the new skills load');
    if (plan.add.some((x) => x.startsWith('brand/licensed/'))) needs.push('licensed material (Uppbeat) now has its place: brand/licensed/README.md says how to download by hand and record it (video licensed add ...)');
    if (plan.settings.length) needs.push(`check the new setting${plan.settings.length === 1 ? '' : 's'} in brand/brand.json (${plan.settings.join(', ')}); /channel-setup asks about them`);
    if (plan.gitignore.length) needs.push('nothing: .gitignore now also keeps the new kinds of files out of git');
    entry.needs = needs;
    log(needs.length ? `   this channel folder now needs:\n${needs.map((x) => `      - ${x}`).join('\n')}` : '   this channel folder needs nothing more.');
  }
  if (apply && res.installed) log('The engine is updated: restart Claude Code so the new engine and skills load.');
  const first = res.channels.find((c) => !c.skipped);
  const entries = changelogSince(planKit, channels.length ? channelBuild(channels[0])?.version || null : null);
  if (entries.length && (res.pulled || !apply || res.applied)) log(`\nwhat is in the kit's changelog${first && channelBuild(first.dir)?.version ? ` since ${channelBuild(first.dir).version}` : ' (newest entry)'}:\n${entries.join('\n\n')}`);
  if (ghost) fs.rmSync(ghost, { recursive: true, force: true });
  if (!apply) log('\nThis was a dry run: nothing was changed. Run  video update --apply  to pull, install and update the channel folder.');
  return res;
}

export async function cli(flags) {
  const res = await update({ apply: Boolean(flags.apply), kit: typeof flags.kit === 'string' ? flags.kit : null, channel: typeof flags.channel === 'string' ? flags.channel : null, all: Boolean(flags.all),
    fetch: !flags['no-fetch'], pull: !flags['no-pull'], install: !flags['no-install'] });
  if (!res.ok) process.exitCode = 1;
}
