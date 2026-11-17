#!/usr/bin/env node
// scriptgate.mjs · the gate between a script and the voice (paid). The Video Kit's own version of the Reel Kit's "Script
// review" line. The voice may only be made for words that were reviewed, so two things must hold:
//
//   1. the script's fact check is a current PASS (checks.mjs factsCurrent: the words and the research have not changed since)
//   2. approvals.md ends its "Script review" lines with
//        Script review: meets the bar (NN/100; weakest: <criterion>) [script <12 hex>]
//      where NN is 90 or more and the hash is the fingerprint of script.txt as it is now (scriptcheck.mjs spokenHash).
//
// Change a word of script.txt and the line no longer fits: run /script-coldread and /script-score again and record again.
// Lines are only ever added. Only the owner overrides the review (not the fact check), with a reason, and that is written
// as its own line:  Script review: SKIPPED by the owner (--skip-script-review): <reason> [script <hash>]
//
//   node scriptgate.mjs <video folder> [--minutes N]      check the script (scriptcheck) and print it
//   node scriptgate.mjs <video folder> --hash             the fingerprint
//   node scriptgate.mjs <video folder> --status           is the gate open? (exit 1 and the reason when not)
//   node scriptgate.mjs <video folder> --human            the human score and its parts
//   node scriptgate.mjs <video folder> --record --score 92 [--notes "weakest: pace"] [--by "script-score"]
//   node scriptgate.mjs <video folder> --skip-script-review "reason"      (the owner only)
//
// Module API: scriptHash(dir), scriptProblem(dir), scriptGate(dir, flags), recordScriptReview(dir, {score, notes, by}),
// recordScriptSkip(dir, reason, {by}), reviewState(dir), command(dir, flags).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as checks from './checks.mjs';
import * as sc from './scriptcheck.mjs';

export const MIN_SCORE = 90;
const read = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return ''; } };
const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);   // local time, 2026-11-17 19:23
const one = (s) => String(s ?? '').replace(new RegExp(String.fromCharCode(0x2014), 'g'), '-').replace(/\s+/g, ' ').trim();

export const scriptHash = (dir) => sc.spokenHash(read(path.join(dir, 'script.txt')));

// "(92/100; ..." or "(4.5/5; ..." -> 0 to 100, or null
export function lineScore(line) {
  const m = String(line || '').match(/\((\d+(?:\.\d+)?)\s*\/\s*(100|5)\b/);
  return m ? Math.round((Number(m[1]) * 100) / Number(m[2]) * 10) / 10 : null;
}

// the Script review lines of approvals.md, oldest first (the line may sit behind a "- 2026-11-17 19:23  " stamp)
export const reviewLines = (dir) => (read(path.join(dir, 'approvals.md')).match(/Script review:[^\r\n]*/g) || []).map((l) => l.trim());

// the latest line decides: { kind: 'none' | 'meets' | 'skipped' | 'other', line, score, hash }
export function reviewState(dir) {
  const lines = reviewLines(dir), line = lines.at(-1) || '';
  if (!line) return { kind: 'none', line: '', score: null, hash: null };
  const hash = (line.match(/\[script ([0-9a-f]{12})\]/) || [])[1] || null, score = lineScore(line);
  const kind = /Script review:\s*SKIPPED by the owner/i.test(line) ? 'skipped' : /meets the bar/i.test(line) ? 'meets' : 'other';
  return { kind, line, score, hash };
}

export function factsProblem(dir) {
  const f = checks.factsCurrent(dir, 'script');
  return f.ok ? null : `the script's fact check is not a current PASS: ${f.why}`;
}

export function reviewProblem(dir) {
  const now_ = scriptHash(dir);
  if (!now_) return 'there is no script.txt (or it is empty): write the script first (SKILL.md step 5)';
  const r = reviewState(dir), fix = 'Run /script-coldread, then /script-score; it records the line (video script <folder> --record --score NN).';
  if (r.kind === 'none') return `approvals.md has no "Script review" line for this script. ${fix}`;
  if (r.kind === 'skipped') return r.hash === now_ ? null : `script.txt changed after the owner skipped its review (the skip was for [script ${r.hash || 'no hash'}], the script is now [script ${now_}]). ${fix}`;
  if (r.kind === 'other' || r.score == null) return `the latest "Script review" line has no score or does not say "meets the bar". ${fix}`;
  if (r.score < MIN_SCORE) return `the latest script review scores ${r.score}/100, under the bar of ${MIN_SCORE}: fix the script, then score it again. ${fix}`;
  if (!r.hash) return `the latest script review names no script ([script <hash>] is missing). ${fix}`;
  if (r.hash !== now_) return `script.txt changed after it was reviewed (the review was for [script ${r.hash}], the script is now [script ${now_}]): any change to the words cancels the review. ${fix}`;
  return null;
}

// null when the voice may be made for this script, else the reason in plain words
export const scriptProblem = (dir) => factsProblem(dir) || reviewProblem(dir);

// the gate as the voice step calls it: the fact check always holds; the review can be skipped by the OWNER with a reason
// (flags['skip-script-review']), which is recorded. Returns null (go on) or the reason to stop.
export function scriptGate(dir, flags = {}) {
  const facts = factsProblem(dir);
  if (facts) return facts;
  const review = reviewProblem(dir);
  if (!review) return null;
  const skip = flags['skip-script-review'];
  if (skip === true || skip === '') return '--skip-script-review needs a reason in quotes (only the owner overrides the script review)';
  if (skip) { recordScriptSkip(dir, String(skip), { by: 'the owner' }); console.log(`script review skipped by the owner: ${one(skip)} (written to approvals.md)`); return null; }
  return `${review} Only the owner overrides this, with  --skip-script-review "reason".`;
}

// approvals.md: add under "## Script review", never change an earlier line (same layout as the kit's other approval lines)
function appendApproval(dir, line) {
  const f = path.join(dir, 'approvals.md'), h = '## Script review';
  let text = fs.existsSync(f) ? read(f) : '# Approvals\n\nAdded by the kit; earlier lines are never rewritten.\n';
  if (!text.includes(`\n${h}\n`)) text = `${text.trimEnd()}\n\n${h}\n`;
  const at = text.indexOf(`\n${h}\n`) + h.length + 2, next = text.indexOf('\n## ', at);
  const entry = `- ${now()}  ${line}\n`;
  text = next < 0 ? `${text.trimEnd()}\n${entry}` : `${text.slice(0, next).trimEnd()}\n${entry}${text.slice(next)}`;
  fs.writeFileSync(f, text);
}

export function recordScriptReview(dir, { score, notes = '', by = 'script-score' } = {}) {
  const hash = scriptHash(dir);
  if (!hash) throw new Error('there is no script.txt (or it is empty): nothing to review');
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('give the score as a number from 0 to 100 (--score 92)');
  if (n < MIN_SCORE) throw new Error(`a script scoring ${n}/100 is not recorded: the bar is ${MIN_SCORE}. Fix the weakest criterion, score it again, and record only a score the script has earned`);
  const facts = factsProblem(dir);
  if (facts) throw new Error(`not recorded: ${facts}`);
  const r = sc.checkVideo(dir, { write: false }), errs = r.findings.filter((f) => f.sev === 'ERROR');
  if (errs.length) throw new Error(`not recorded: the script check has ${errs.length} error(s), fix them first (video script <folder>): ${errs.slice(0, 3).map((f) => `${f.code} ${f.msg.slice(0, 80)}`).join(' | ')}`);
  const shown = Number.isInteger(n) ? String(n) : n.toFixed(1);
  const line = `Script review: meets the bar (${shown}/100; ${one(notes) || 'no notes'}; by ${one(by) || 'script-score'}) [script ${hash}]`;
  appendApproval(dir, line);
  return { line, hash, score: n };
}

export function recordScriptSkip(dir, reason, { by = 'the owner' } = {}) {
  const hash = scriptHash(dir);
  if (!hash) throw new Error('there is no script.txt (or it is empty): nothing to skip a review of');
  const why = one(reason);
  if (why.length < 3) throw new Error('--skip-script-review needs a reason in quotes (what the owner knows that the review does not)');
  const line = `Script review: SKIPPED by the owner (--skip-script-review): ${why} [script ${hash}]`;
  appendApproval(dir, line);
  return { line, hash, by: one(by) };
}

/* ── command line (also what `video script` runs) ───────────────────────────────────────────────────────────────────── */
// flags: { hash, status, human, record, score, notes, by, minutes, 'skip-script-review' }; returns the exit code
export function command(dir, flags = {}) {
  const log = (s) => console.log(s);
  try {
    if (flags.hash) { const h = scriptHash(dir); if (!h) throw new Error('no script.txt (or it is empty)'); log(h); return 0; }
    if (flags.status) {
      const p = scriptProblem(dir);
      if (p) { log(`script gate: CLOSED. ${p}`); return 1; }
      log(`script gate: OPEN. ${reviewState(dir).kind === 'skipped' ? 'the owner skipped the review' : `reviewed ${reviewState(dir).score}/100`} for [script ${scriptHash(dir)}], fact check PASS`);
      return 0;
    }
    if (flags.human) {
      const ctx = sc.loadContext(dir), bar = Number(ctx.brandCfg.writing?.human_score_min ?? sc.BAR) || sc.BAR;
      const h = sc.humanScore(read(path.join(dir, 'script.txt')), { banned: ctx.brandCfg.writing?.banned_phrases || [], bar });
      log(h.score == null ? `human score: not given (${h.notes[0]})` : `human score: ${h.score}/100 (bar ${bar}: ${h.met ? 'met' : 'NOT met'}); parts ${Object.entries(h.parts).map(([k, v]) => `${k} ${v}`).join(', ')}; ${h.notes.join('; ')}`);
      return h.score != null && h.score >= bar ? 0 : 1;
    }
    if (flags.record) {
      const r = recordScriptReview(dir, { score: flags.score, notes: typeof flags.notes === 'string' ? flags.notes : '', by: typeof flags.by === 'string' ? flags.by : 'script-score' });
      log(`recorded in approvals.md: ${r.line}`); return 0;
    }
    if (flags['skip-script-review'] !== undefined) {
      const s = flags['skip-script-review'];
      if (s === true || s === '') throw new Error('--skip-script-review needs a reason in quotes (only the owner overrides the script review)');
      const r = recordScriptSkip(dir, s); log(`recorded in approvals.md: ${r.line}`); return 0;
    }
    const r = sc.checkVideo(dir, { minutes: flags.minutes && flags.minutes !== true ? flags.minutes : undefined });
    log(sc.render(r, path.basename(path.resolve(dir))));
    log(`fingerprint [script ${r.hash}]  (written to build/scriptcheck.md)`);
    return r.pass ? 0 : 1;
  } catch (e) { console.error(`script: ${e.message}`); return 1; }
}

export function parseFlags(argv) {
  const flags = {}, loose = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2), v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) { flags[k] = v; i++; } else flags[k] = true; } else loose.push(a);
  }
  return { flags, loose };
}

const here = (() => { try { return fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return ''; } })();
const called = (() => { try { return process.argv[1] ? fs.realpathSync.native(path.resolve(process.argv[1])) : ''; } catch { return ''; } })();
if (here && here === called) {
  const { flags, loose } = parseFlags(process.argv.slice(2));
  if (!loose[0]) { console.error('usage: node scriptgate.mjs <video folder> [--hash | --status | --human | --record --score NN [--notes ".."] | --skip-script-review "reason"]'); process.exitCode = 2; }
  else process.exitCode = command(loose[0], flags);
}
