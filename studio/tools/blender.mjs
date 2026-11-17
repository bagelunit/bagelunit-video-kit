// Where Blender is, and which version (Blender is an optional, free tool: only the 3D shots in brand/library/3d need it).
// The same search the channel's launcher (brand/library/3d/blender_shot.py) does, in the same order:
//   1. BAGELUNIT_BLENDER (a path to the program), 2. `blender` on PATH, 3. the standard places for the system.
// BAGELUNIT_BLENDER_PATHS (a PATH-style list of programs or of folders that hold one) replaces steps 2 and 3, for tests.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MIN_BLENDER = [4, 2];

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const subdirs = (dir, rx) => { try { return fs.readdirSync(dir).filter((n) => rx.test(n)).sort().reverse().map((n) => path.join(dir, n)); } catch { return []; } };
const exe = process.platform === 'win32' ? 'blender.exe' : 'blender';

// every place Blender may be, in order (not checked for existence)
export function standardPlaces({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (platform === 'darwin') return ['/Applications/Blender.app/Contents/MacOS/Blender', path.join(home, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender'), '/opt/homebrew/bin/blender', '/usr/local/bin/blender'];
  if (platform === 'win32') {
    const roots = new Set([env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean));
    const out = [];
    for (const r of roots) for (const d of subdirs(path.join(r, 'Blender Foundation'), /^Blender/i)) out.push(path.join(d, 'blender.exe'));
    return out;
  }
  return ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender', ...subdirs('/opt', /^blender/i).map((d) => path.join(d, 'blender')), path.join(home, 'blender', 'blender')];
}

// a program name on PATH (Windows: also the .exe)
function onPath(name, env) {
  for (const d of String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const n of process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name]) if (isFile(path.join(d, n))) return path.join(d, n);
  }
  return null;
}

// -> {path, how} or null
export function findBlender({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.BAGELUNIT_BLENDER) return isFile(env.BAGELUNIT_BLENDER) ? { path: env.BAGELUNIT_BLENDER, how: 'BAGELUNIT_BLENDER' } : null;
  if (env.BAGELUNIT_BLENDER_PATHS !== undefined) {
    for (const p of env.BAGELUNIT_BLENDER_PATHS.split(path.delimiter).filter(Boolean)) {
      const f = isFile(p) ? p : isFile(path.join(p, exe)) ? path.join(p, exe) : null;
      if (f) return { path: f, how: 'BAGELUNIT_BLENDER_PATHS' };
    }
    return null;
  }
  const p = onPath('blender', env);
  if (p) return { path: p, how: 'PATH' };
  const std = standardPlaces({ platform, home, env }).find(isFile);
  return std ? { path: std, how: 'the standard place' } : null;
}

// "Blender 5.3.0" -> {major, minor, patch, text}; null when the program did not answer like Blender
export function blenderVersion(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000 });
  const m = /Blender\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(`${r.stdout || ''}`);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: m[3] == null ? 0 : Number(m[3]), text: `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}` } : null;
}
export const tooOld = (v) => v.major < MIN_BLENDER[0] || (v.major === MIN_BLENDER[0] && v.minor < MIN_BLENDER[1]);

// how to get it, for this system (a suggestion: nothing is ever installed for the person)
export function howToGet({ platform = process.platform, has = () => false } = {}) {
  if (platform === 'darwin') return 'brew install --cask blender (or blender.org)';
  if (platform === 'win32') return 'winget install BlenderFoundation.Blender (or blender.org)';
  if (has('snap')) return 'sudo snap install blender --classic (or blender.org)';
  if (has('apt-get')) return 'sudo apt install blender (apt may be older than 4.2; blender.org has the current one)';
  return 'download it from blender.org';
}

// the line `video doctor` and the installer print: {ok: bool|null, text}
export function describe(opts = {}) {
  const hit = findBlender(opts);
  if (!hit) return { ok: null, found: null, text: `Blender not found (optional: only the 3D shots in brand/library/3d and /blender-shot need it). To add it: ${howToGet({ platform: opts.platform || process.platform, has: (c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0 })}` };
  const v = blenderVersion(hit.path);
  if (!v) return { ok: null, found: hit, text: `Blender is at ${hit.path.split(path.sep).join('/')} but did not report a version, so it may not start (open it once by hand, or reinstall it from blender.org)` };
  if (tooOld(v)) return { ok: null, found: hit, version: v, text: `Blender ${v.text} found at ${hit.path.split(path.sep).join('/')}, but the 3D shots want ${MIN_BLENDER.join('.')} or newer (update it: ${howToGet(opts)})` };
  return { ok: true, found: hit, version: v, text: `Blender ${v.text} found (${hit.path.split(path.sep).join('/')}, from ${hit.how})` };
}
