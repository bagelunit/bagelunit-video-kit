// archive.mjs · `video archive <folder> --to <rclone-remote:path>`: copies what a video cannot get back to somewhere else,
// and proves the copy, before `video tidy` is allowed to delete scratch.
//
//   node video.mjs archive <video folder> --to <remote:path> [--dry-run]
//
// What is copied (everything that is expensive or impossible to make again): the finished files in out/, the project's text
// (research, outline, script, scenes, video.json, approvals, fact checks, source safety), the voice (audio/) and the paid
// voice pieces (build/voice*, build/words*.json). Render scratch (build/scenes*, build/*.mp4) is not copied: a render makes it
// again for free. They go to <remote:path>/<video folder name>/ with `rclone copy`, then `rclone check --one-way` compares
// checksums, and only a clean check writes archive.json in the video folder. `video tidy` reads it and warns when the
// episode has no clean archive (it warns, it does not block).
// The remote comes from --to, else brand.json "archive": {"to": "remote:path"}, else the BAGELUNIT_ARCHIVE_TO environment
// variable. Set rclone up once yourself (`rclone config`); this kit never asks for or stores a key. rclone is called through
// BAGELUNIT_RCLONE (default "rclone"). Nothing is scheduled by the kit: template/scripts/nightly-backup.sh is for you to run.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as checks from './checks.mjs';

export const FILTERS = [
  '+ /research.md', '+ /outline.md', '+ /script.txt', '+ /scenes.json', '+ /scenes/**', '+ /video.json', '+ /approvals.md',
  '+ /factcheck-5x.md', '+ /source-safety.md', '+ /source-safety.json', '+ /out/**', '+ /audio/**', '+ /build/voice*/**', '+ /build/words*.json', '+ /build/pauses*.json',
  '- **',
];
const filterArgs = () => FILTERS.flatMap((f) => ['--filter', f]);

export const defaultRun = (args) => {
  const r = spawnSync(process.env.BAGELUNIT_RCLONE || 'rclone', args, { encoding: 'utf8' });
  if (r.error) return { status: 127, stdout: '', stderr: r.error.code === 'ENOENT' ? 'rclone is not installed (https://rclone.org/install/), or BAGELUNIT_RCLONE points at nothing' : String(r.error.message) };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};

export function targetFor(dir, flags = {}, env = process.env) {
  const brand = checks.findBrand(dir);
  const raw = (flags.to && flags.to !== true ? flags.to : null) || brand?.cfg?.archive?.to || env.BAGELUNIT_ARCHIVE_TO;
  if (!raw) return null;
  return raw;
}

export function archive(dir, { to, run = defaultRun, dry = false, log = console.log, now = new Date() } = {}) {
  dir = path.resolve(dir);
  if (!to) throw new Error('say where to: --to <rclone remote:path> (for example gdrive:Videos/Archive), or set "archive": {"to": "..."} in brand/brand.json, or BAGELUNIT_ARCHIVE_TO. Set the remote up once with: rclone config');
  const remote = String(to).trim().replace(/[\\/]+$/, '');
  if (!/^[^\s:]+:/.test(remote) && !path.isAbsolute(remote)) throw new Error(`"${to}" is not an rclone destination: use remote:path (for example gdrive:Videos/Archive) or an absolute folder`);
  const dest = `${remote}/${path.basename(dir)}`;
  const outFiles = fs.existsSync(path.join(dir, 'out')) ? fs.readdirSync(path.join(dir, 'out')).filter((f) => !f.startsWith('.')) : [];
  const finished = fs.existsSync(path.join(dir, 'out', 'video.mp4'));
  if (!finished) log('note: there is no out/video.mp4 yet, so only the work in progress is copied. Archive again after the final render.');
  const copy = run(['copy', dir, dest, '--checksum', '--stats-one-line', ...(dry ? ['--dry-run'] : []), ...filterArgs()]);
  if (copy.status !== 0) throw new Error(`rclone copy failed (exit ${copy.status}): ${(copy.stderr || copy.stdout).trim().slice(-300)}. Nothing is recorded as archived.`);
  if (dry) { log(`dry run: rclone would copy this video to ${dest}`); return { dry: true, dest }; }
  const chk = run(['check', dir, dest, '--one-way', ...filterArgs()]);
  if (chk.status !== 0) throw new Error(`the copy at ${dest} does not match this folder (rclone check, exit ${chk.status}): ${(chk.stderr || chk.stdout).trim().slice(-300)}. Not recorded as archived; run archive again.`);
  const video = path.join(dir, 'out', 'video.mp4');
  const rec = { to: dest, at: now.toISOString(), verified: true, finished, video_sha256: finished ? checks.sha256File(video) : null, out: outFiles };
  fs.writeFileSync(path.join(dir, 'archive.json'), JSON.stringify(rec, null, 1) + '\n');
  log(`archived: ${dest} (checksums verified${finished ? ', the finished video included' : ', work in progress only'}) -> archive.json`);
  if (finished) log('`video tidy <folder>` will no longer warn about this episode.');
  return rec;
}

export function cli(video, flags) {
  const to = targetFor(video.dir, flags);
  try { archive(video.dir, { to, dry: Boolean(flags['dry-run']) }); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
