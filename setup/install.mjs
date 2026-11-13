#!/usr/bin/env node
// BagelUnit Video Kit installer. Puts studio/ where Claude Code finds it as the skill "bagelunit-video"
// (~/.claude/skills/bagelunit-video) and checks what the kit borrows from the Reel Kit engine.
//
//   node setup/install.mjs [--link] [--dry-run]
//
//   --link      link studio/ instead of copying it (good if you edit the kit or pull updates with git)
//   --dry-run   say what would be done, change nothing
//
// It never asks for, reads or stores a key. The voice key and the headless browser belong to the Reel Kit
// (~/.claude/skills/bagelunit-reels): install that first (its own setup/install.sh). Safe to run again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const link = process.argv.includes('--link'), dry = process.argv.includes('--dry-run');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = path.join(REPO, 'studio');
const TARGET = path.join(os.homedir(), '.claude', 'skills', 'bagelunit-video');
const REEL = path.join(os.homedir(), '.claude', 'skills', 'bagelunit-reels');
const say = (ok, text) => console.log(`${ok === true ? 'ok  ' : ok === false ? 'NOTE' : '    '} ${text}`);
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;

if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Node 22 or newer is needed.'); process.exit(1); }
say(has('ffmpeg') && has('ffprobe'), has('ffmpeg') ? 'ffmpeg found' : 'ffmpeg is missing: brew install ffmpeg (Mac), or your system\'s package (Windows: winget install ffmpeg)');
const reelOk = fs.existsSync(path.join(REEL, 'tools', 'voice.py'));
say(reelOk, reelOk ? 'Reel Kit engine found (voice, headless browser, fonts)' : `the Reel Kit engine is missing (${REEL}): run bash setup/install.sh in the Reel Kit first, then this again`);
const pwOk = fs.existsSync(path.join(REEL, 'node_modules', 'playwright'));
say(pwOk, pwOk ? 'Playwright found in the Reel Kit engine' : 'Playwright is missing: npm install and npm run browser inside ~/.claude/skills/bagelunit-reels');
const key = fs.existsSync(path.join(os.homedir(), '.config', 'bagelunit-reels', 'elevenlabs.key'));
say(key, key ? 'voice key file found (a real voice works)' : 'no ElevenLabs key file yet: a stand-in tone works without it; the Reel Kit SETUP.md section 3 says how to add one');

if (dry) { say(null, `would ${link ? 'link' : 'copy'} ${STUDIO} to ${TARGET}`); process.exit(0); }
fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.rmSync(TARGET, { recursive: true, force: true });
if (link) fs.symlinkSync(STUDIO, TARGET, process.platform === 'win32' ? 'junction' : 'dir');
else fs.cpSync(STUDIO, TARGET, { recursive: true });
say(true, `${link ? 'linked' : 'copied'} studio/ to ${TARGET}`);
const tools = path.join(TARGET, 'tools', 'video.mjs');
say(null, `the command: node ${tools} doctor`);
console.log('\nNext: open Claude Code in a folder where the video should live and type /bagelunit-video (the skill is in studio/SKILL.md).');
