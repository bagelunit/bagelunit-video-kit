#!/usr/bin/env node
// Makes a new YouTube channel folder from template/: one folder per channel, named <channel>-videos.
//
//   node setup/new-workspace.mjs <folder> [--from-reels <reel brand folder>] [--dry-run]
//
//   <folder>        where the channel lives, e.g. ~/Videos/acme (it becomes ~/Videos/acme-videos)
//   --from-reels    start the channel from a BagelUnit Reel Kit brand folder: its name, slug, niche, accent colour and
//                   voice, its voice.md and facts.md are copied (a copy: the two folders can then differ), and
//                   reels_folder points at it so `video reels` can make reels there
//   --dry-run       say what would be made, change nothing
//
// It never overwrites a folder that already has files in it. The channel is added to ~/.config/bagelunit-video/channels.json
// (the list of this computer's channel folders). Next: open Claude Code in the new folder and type /channel-setup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeChannelBuild } from '../studio/tools/update.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = path.join(REPO, 'template');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const expand = (p) => path.resolve(String(p).replace(/^~(?=$|[\\/])/, os.homedir()));
export const slugOf = (s) => String(s).toLowerCase().replace(/-videos$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'channel';
export function folderFor(arg) {
  const p = expand(arg), base = path.basename(p);
  return base.endsWith('-videos') ? p : path.join(path.dirname(p), `${slugOf(base)}-videos`);
}

export function fromReels(reelsDir) {
  const dir = expand(reelsDir), b = readJSON(path.join(dir, 'brand', 'brand.json'), null);
  if (!b) throw new Error(`${dir} is not a Reel Kit brand folder (no brand/brand.json)`);
  return {
    dir,
    fields: {
      name: b.name || '', slug: b.slug || '',
      niche: { topic: (typeof b.niche === 'string' ? b.niche : b.niche?.topic || b.niche?.what) || '', audience: b.niche?.audience || b.niche?.who || '', search_terms: Array.isArray(b.niche?.search_terms || b.niche?.keywords) ? (b.niche.search_terms || b.niche.keywords) : [] },
      colors: { accent: b.colors?.accent || '' },
      voice: { provider: b.voice?.provider || 'elevenlabs', voice_id: b.voice?.voice_id || '', voice_name: b.voice?.voice_name || '', speed: 1, never_say: b.voice?.never_say || [], pronunciation: b.voice?.pronunciation || {} },
    },
  };
}

export function makeWorkspace(arg, { reels = null, dry = false, registry = path.join(os.homedir(), '.config', 'bagelunit-video', 'channels.json') } = {}) {
  const dir = folderFor(arg);
  if (fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f !== '.DS_Store').length) throw new Error(`${dir} already has files in it: nothing was changed. Pick another folder.`);
  const src = reels ? fromReels(reels) : null;
  const plan = { dir, from: src?.dir || null };
  if (dry) return plan;
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(TEMPLATE, dir, { recursive: true });
  writeChannelBuild(dir, REPO);                     // which kit build this folder was made from, for `video update`
  const bf = path.join(dir, 'brand', 'brand.json'), brand = readJSON(bf, {});
  brand.slug = slugOf(path.basename(dir));
  if (src) {
    Object.assign(brand, { name: src.fields.name, niche: src.fields.niche, colors: src.fields.colors, voice: src.fields.voice, reels_folder: src.dir });
    if (src.fields.slug) brand.slug = src.fields.slug;
    for (const f of ['voice.md', 'facts.md']) { const from = path.join(src.dir, 'brand', f); if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, 'brand', f)); }
  }
  fs.writeFileSync(bf, JSON.stringify(brand, null, 2) + '\n');
  try {
    const list = readJSON(registry, []).filter((c) => c.dir !== dir);
    list.push({ slug: brand.slug, name: brand.name || '', dir, created: new Date().toISOString().slice(0, 10) });
    fs.mkdirSync(path.dirname(registry), { recursive: true });
    fs.writeFileSync(registry, JSON.stringify(list, null, 2) + '\n');
  } catch {}
  return { ...plan, slug: brand.slug, named: Boolean(brand.name) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const target = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--from-reels');
  const ri = argv.indexOf('--from-reels'), reels = ri >= 0 ? argv[ri + 1] : null;
  if (!target) { console.log('usage: node setup/new-workspace.mjs <folder> [--from-reels <reel brand folder>] [--dry-run]'); process.exit(1); }
  try {
    const r = makeWorkspace(target, { reels, dry: argv.includes('--dry-run') });
    if (argv.includes('--dry-run')) { console.log(`would make ${r.dir}${r.from ? ` from the Reel Kit brand folder ${r.from}` : ''}`); process.exit(0); }
    console.log(`made ${r.dir} (channel slug: ${r.slug})${r.from ? `\nstarted from ${r.from}: name, niche, colour, voice, voice.md and facts.md copied; reels_folder points there` : ''}`);
    console.log(`\nNext: open Claude Code in ${r.dir} and type /channel-setup${r.named ? ' (to check what was copied and fill the rest)' : ''}.`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
