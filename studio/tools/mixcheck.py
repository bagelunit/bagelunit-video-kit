#!/usr/bin/env python3
"""Sound design check: is the mix of a finished long video clean? Only ffmpeg and ffprobe (no numpy, no key, no network).

  python3 mixcheck.py <video folder>            out/video.mp4 with the folder's words, chapters and video.json
  python3 mixcheck.py <video.mp4>               a bare file (no ducking and no chapter check: they need the folder)
  python3 mixcheck.py --selftest                builds small test files with ffmpeg and checks the checks (SKIPPED without ffmpeg)

Prints PASS / WARN / FAIL / SKIPPED / INFO lines and writes build/mix.json (a bare file: <name>.mix.json beside it).
  loudness     integrated LUFS -15 to -13 PASS, -16 to -12 WARN, else FAIL (the bar of video qa); true peak above -1 dBTP FAIL
  range        loudness range (LRA): over 15 LU WARN (long-form narration with music moves more than a short clip; over 15 jumps about)
  clipping     sample peak at or above -0.1 dBFS WARN, -0.01 or higher FAIL
  silence      a gap in the sound longer than 3 s WARN (long-form breathes more than a reel; the opening, a hold at the very end and a
               scene "pause" you asked for in scenes.json are not faults: look at the times)
  ducking      only when video.json has "music" or build/sfx.json exists: the mix in the gaps between words (the bed and the effects)
               against the mix while words are spoken. Margin 12 dB or more PASS, 6 to 12 WARN, under 6 FAIL. This tool's own rule of thumb.
  chapters     only with out/chapters.txt: each chapter's integrated loudness against the whole video. More than 3 LU away WARN, more than
               6 LU FAIL (a chapter whose music or voice jumps). Chapters under 8 s are not measured.
  earshot      optional: SKIPPED unless the earshot skill is installed, never needed.
Exit code: 0 all PASS or WARN or SKIPPED, 1 any FAIL, 2 could not run (no ffmpeg or no video)."""
import array
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LUFS_PASS = (-15.0, -13.0)
LUFS_WARN = (-16.0, -12.0)
TP_MAX = -1.0
LRA_WARN = 15.0
CLIP_WARN, CLIP_FAIL = -0.1, -0.01
GAP_S = 3.0
DUCK_PASS, DUCK_WARN = 12.0, 6.0
CHAPTER_WARN, CHAPTER_FAIL, CHAPTER_MIN_S = 3.0, 6.0, 8.0
RATE = 16000
WIN = 0.05


def posix(p):
    return str(p).replace('\\', '/')


def ffmpeg_log(args):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.stderr


def ff_log(path, af, extra=()):
    return ffmpeg_log(list(extra) + ['-i', str(path), '-vn', '-af', af, '-f', 'null', '-'])


def duration_of(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def has_audio(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True).stdout
    return 'audio' in out


def parse_ebur(log):
    summ = log[log.rfind('Summary:'):] if 'Summary:' in log else ''
    mi = re.search(r'I:\s+(-?[\d.]+|-inf) LUFS', summ)
    mr = re.search(r'LRA:\s+(-?[\d.]+) LU', summ)
    mp = re.search(r'True peak:.*?Peak:\s+(-?[\d.]+|-inf) dBFS', summ, re.S)
    if not (mi and mp):
        return None
    f = lambda s: float('-inf') if s == '-inf' else float(s)
    return {'lufs': f(mi.group(1)), 'lra': float(mr.group(1)) if mr else None, 'true_peak_db': f(mp.group(1))}


def loudness(path, start=None, length=None):
    extra = []
    if start is not None:
        extra += ['-ss', f'{start:.3f}']
    if length is not None:
        extra += ['-t', f'{length:.3f}']
    return parse_ebur(ff_log(path, 'ebur128=peak=true', extra))


def sample_peak(path):
    log = ff_log(path, 'astats=metadata=0:reset=0')
    m = re.findall(r'Peak level dB:\s+(-?[\d.]+|-inf)', log)
    if not m:
        return None
    return max(float('-inf') if v == '-inf' else float(v) for v in m)


def silences(path, total):
    log = ff_log(path, f'silencedetect=n=-50dB:d={GAP_S}')
    starts = [float(x) for x in re.findall(r'silence_start: (-?[\d.]+)', log)]
    ends = [float(x) for x in re.findall(r'silence_end: (-?[\d.]+)', log)]
    out = []
    for i, a in enumerate(starts):
        out.append((max(0.0, a), ends[i] if i < len(ends) else total))
    return out


def pcm_rms(path):
    """Mono 16 kHz samples -> RMS (dB) per 50 ms window."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         capture_output=True).stdout
    a = array.array('f')
    a.frombytes(raw[:len(raw) - len(raw) % 4])
    n = int(RATE * WIN)
    out = []
    for i in range(0, len(a) - n + 1, n):
        s = sum(x * x for x in a[i:i + n]) / n
        out.append(10 * math.log10(s) if s > 1e-12 else -120.0)
    return out


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return default


def speech_windows(folder, n_windows):
    words = read_json(folder / 'build' / 'words.json')
    if not isinstance(words, list):
        return None
    spans = sorted((float(w['s']), float(w['e'])) for w in words if isinstance(w, dict) and 's' in w and 'e' in w)
    if not spans:
        return None
    merged = [list(spans[0])]
    for s, e in spans[1:]:
        if s - merged[-1][1] < 0.3:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    mask = [False] * n_windows
    for s, e in merged:
        for i in range(int(s / WIN), min(n_windows, int(e / WIN) + 1)):
            mask[i] = True
    return mask


def has_music_or_sfx(folder):
    cfg = read_json(folder / 'video.json', {}) or {}
    return bool(cfg.get('music')) or (folder / 'build' / 'sfx.json').is_file()


def ducking(video, folder):
    """(status, message, data). Needs the video folder (words.json) and music in video.json or a build/sfx.json."""
    if folder is None:
        return 'SKIPPED', 'a bare video has no folder, so no word timing to compare against', {}
    if not has_music_or_sfx(folder):
        return 'SKIPPED', 'no "music" in video.json and no build/sfx.json: voice only, nothing to duck', {}
    rms = pcm_rms(video)
    mask = speech_windows(folder, len(rms))
    if mask is None:
        return 'SKIPPED', 'no build/words.json to tell where words are spoken', {}
    sp = [r for r, m in zip(rms, mask) if m and r > -100]
    gap = [r for r, m in zip(rms, mask) if not m and r > -100]      # true silence carries no bed: the silence check owns it
    if len(sp) < 10 or len(gap) < 10:
        return 'SKIPPED', f'too little to compare ({len(sp)} speech and {len(gap)} gap windows of {int(WIN * 1000)} ms)', {}
    avg_db = lambda v: 10 * math.log10(sum(10 ** (x / 10) for x in v) / len(v))
    s_db, g_db = avg_db(sp), avg_db(gap)
    margin = s_db - g_db
    data = {'speech_db': round(s_db, 1), 'gap_db': round(g_db, 1), 'margin_db': round(margin, 1)}
    status = 'PASS' if margin >= DUCK_PASS else 'WARN' if margin >= DUCK_WARN else 'FAIL'
    note = f'speech {s_db:.1f} dB, gaps {g_db:.1f} dB (the bed and effects), the voice stands {margin:.1f} dB above the gap level'
    if status != 'PASS':
        note += f' (want {DUCK_PASS:.0f} or more: lower the bed, "gain_db" in the video.json music list or "music_volume")'
    return status, note, data


def parse_chapters(text):
    """out/chapters.txt: 'm:ss Title' or 'h:mm:ss Title' per line -> [(seconds, title)]."""
    out = []
    for line in text.replace('\ufeff', '').splitlines():
        m = re.match(r'^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+?)\s*$', line)
        if m:
            out.append((int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3)), m.group(4)))
    return out


def chapter_levels(chapters, total, video, overall):
    """-> (status, message, data). Each chapter's integrated loudness against the whole video's."""
    rows, skipped = [], []
    for i, (t0, title) in enumerate(chapters):
        t1 = chapters[i + 1][0] if i + 1 < len(chapters) else total
        if t1 - t0 < CHAPTER_MIN_S:
            skipped.append(title)
            continue
        m = loudness(video, t0, t1 - t0)
        if not m or not math.isfinite(m['lufs']) or m['lufs'] < -60:
            skipped.append(title)
            continue
        rows.append({'title': title, 'from': t0, 'to': round(t1, 2), 'lufs': round(m['lufs'], 1), 'off': round(m['lufs'] - overall, 1)})
    if not rows:
        return 'SKIPPED', 'no chapter long enough to measure', {'chapters': []}
    worst = max(abs(r['off']) for r in rows)
    status = 'FAIL' if worst > CHAPTER_FAIL else 'WARN' if worst > CHAPTER_WARN else 'PASS'
    off = [r for r in rows if abs(r['off']) > CHAPTER_WARN]
    spans = '; '.join(f'"{r["title"]}" ({int(r["from"]) // 60}:{int(r["from"]) % 60:02d}) {r["lufs"]:.1f} LUFS, {r["off"]:+.1f} LU' for r in off[:6])
    msg = (f'{len(off)} of {len(rows)} chapter(s) more than {CHAPTER_WARN:.0f} LU from the video\'s {overall:.1f} LUFS: {spans}'
           if off else f'all {len(rows)} chapters within {CHAPTER_WARN:.0f} LU of the video\'s {overall:.1f} LUFS (largest {worst:.1f} LU)')
    if skipped:
        msg += f' (not measured: {len(skipped)} under {CHAPTER_MIN_S:.0f} s or silent)'
    return status, msg, {'chapters': rows, 'worst_lu': round(worst, 1)}


def earshot_line():
    try:
        import earshot  # noqa: F401
        return 'INFO', 'the earshot Python package is installed: ask Claude to run its measure and realness tools on this file (not run here)'
    except Exception:
        pass
    if (Path.home() / '.claude' / 'skills' / 'earshot').is_dir():
        return 'INFO', 'the earshot skill is installed: ask Claude to run its measure and realness tools on this file (not run here)'
    return 'SKIPPED', 'earshot is not installed (optional, not needed)'


def run(folder, video, quiet=False):
    results = []

    def add(name, status, msg, **data):
        results.append({'check': name, 'status': status, 'message': msg, **data})
        if not quiet:
            print(f'{status:8} {name:10} {msg}')

    if not quiet:
        print(f'mixcheck: {posix(video)}')
    if not has_audio(video):
        add('loudness', 'FAIL', 'no audio stream to measure')
        return results
    total = duration_of(video)
    m = loudness(video)
    overall = None
    if not m:
        add('loudness', 'FAIL', 'ffmpeg ebur128 gave no readable summary')
    else:
        lufs, tp = m['lufs'], m['true_peak_db']
        overall = lufs if math.isfinite(lufs) else None
        status, notes = 'PASS', []
        if not LUFS_PASS[0] <= lufs <= LUFS_PASS[1]:
            status = 'WARN' if LUFS_WARN[0] <= lufs <= LUFS_WARN[1] else 'FAIL'
            notes.append('target -15 to -13')
        if tp > TP_MAX:
            status = 'FAIL'
            notes.append('true peak above -1 dBTP')
        add('loudness', status, f'{lufs:.1f} LUFS, true peak {tp:.1f} dBTP' + (f' ({"; ".join(notes)})' if notes else ''), lufs=lufs, true_peak_db=tp)
        lra = m['lra']
        if lra is not None:
            add('range', 'WARN' if lra > LRA_WARN else 'PASS', f'loudness range {lra:.1f} LU' + (f' (over {LRA_WARN:.0f}: the level jumps about)' if lra > LRA_WARN else ''), lra=lra)
    pk = sample_peak(video)
    if pk is None:
        add('clipping', 'SKIPPED', 'ffmpeg gave no peak level')
    else:
        st = 'FAIL' if pk >= CLIP_FAIL else 'WARN' if pk >= CLIP_WARN else 'PASS'
        add('clipping', st, f'sample peak {pk:.2f} dBFS' + ('' if st == 'PASS' else ' (touching full scale: lower the master)'), sample_peak_db=pk)
    gaps = [(a, b) for a, b in silences(video, total) if b - a > GAP_S]
    tail = [g for g in gaps if total and total - g[1] < 0.05]
    head = [g for g in gaps if g[0] < 0.05 and g not in tail]
    inner = [g for g in gaps if g not in tail and g not in head]
    spans = ', '.join(f'{a:.1f}-{b:.1f}s' for a, b in inner[:6])
    skipped = (' (a silent tail is not counted)' if tail else '') + (' (a silent opening is not counted)' if head else '')
    add('silence', 'WARN' if inner else 'PASS',
        (f'{len(inner)} gap(s) over {GAP_S:.0f} s: {spans}; a scene "pause" you asked for is fine' if inner else f'no silence gap over {GAP_S:.0f} s') + skipped,
        gaps=[[round(a, 2), round(b, 2)] for a, b in inner])
    st, msg, data = ducking(video, folder)
    add('ducking', st, msg, **data)
    if folder is None:
        add('chapters', 'SKIPPED', 'a bare video has no out/chapters.txt')
    else:
        cf = folder / 'out' / 'chapters.txt'
        chapters = parse_chapters(cf.read_text(encoding='utf-8-sig')) if cf.is_file() else []
        if len(chapters) < 2:
            add('chapters', 'SKIPPED', 'no out/chapters.txt with two or more chapters (video chapters <folder>)')
        elif overall is None:
            add('chapters', 'SKIPPED', 'no overall loudness to compare against')
        else:
            st, msg, data = chapter_levels(chapters, total, video, overall)
            add('chapters', st, msg, **data)
    st, msg = earshot_line()
    add('earshot', st, msg)
    return results


def summarize(results):
    return 1 if any(r['status'] == 'FAIL' for r in results) else 0


# ---------------------------------------------------------------- self test
def selftest():
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        print('SKIPPED mixcheck selftest: ffmpeg or ffprobe not found')
        return 0
    bad = 0

    def expect(cond, msg):
        nonlocal bad
        if not cond:
            print('FAIL selftest: ' + msg)
            bad += 1

    def mk(out, af, dur=6):
        return subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency=300:sample_rate=48000:duration={dur}',
                               '-filter_complex', af, '-map', '[a]', '-c:a', 'aac', str(out)], capture_output=True, text=True)

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        good = td / 'good.mp4'
        r = mk(good, '[0:a]loudnorm=I=-14:TP=-2:LRA=7[a]')
        if r.returncode:
            print('SKIPPED mixcheck selftest: this ffmpeg could not make the test file: ' + r.stderr.strip()[-120:])
            return 0
        res = {x['check']: x for x in run(None, good, quiet=True)}
        expect(res['loudness']['status'] in ('PASS', 'WARN') and 'lufs' in res['loudness'], 'a normalised tone should measure about -14 LUFS: ' + res['loudness']['message'])
        expect(res['silence']['status'] == 'PASS', 'a steady tone has no silence gap')
        expect(res['ducking']['status'] == 'SKIPPED' and res['chapters']['status'] == 'SKIPPED', 'a bare video skips ducking and chapters')
        # a 4 s hole is over the 3 s long-form limit; a 2 s hole is not
        hole = td / 'hole.mp4'
        mk(hole, '[0:a]volume=10dB,atrim=0:1.5,asetpts=N/SR/TB[x];anullsrc=r=48000:cl=mono,atrim=0:4[s];[0:a]volume=10dB,atrim=0:1.5,asetpts=N/SR/TB[y];[x][s][y]concat=n=3:v=0:a=1[a]')
        res = {x['check']: x for x in run(None, hole, quiet=True)}
        expect(res['silence']['status'] == 'WARN', 'a 4 s silent gap should WARN (long-form limit 3 s)')
        short = td / 'short.mp4'
        mk(short, '[0:a]volume=10dB,atrim=0:1.5,asetpts=N/SR/TB[x];anullsrc=r=48000:cl=mono,atrim=0:2[s];[0:a]volume=10dB,atrim=0:1.5,asetpts=N/SR/TB[y];[x][s][y]concat=n=3:v=0:a=1[a]')
        res = {x['check']: x for x in run(None, short, quiet=True)}
        expect(res['silence']['status'] == 'PASS', 'a 2 s gap is fine in long-form')
        hot = td / 'hot.mp4'
        mk(hot, '[0:a]volume=30dB,alimiter=limit=1:level=disabled[a]')
        res = {x['check']: x for x in run(None, hot, quiet=True)}
        expect(res['loudness']['status'] == 'FAIL', 'a very hot tone should FAIL loudness')
        # a folder: words 0-3 s over a loud voice, then a bed 30 dB down
        folder = td / 'video'
        (folder / 'build').mkdir(parents=True)
        (folder / 'out').mkdir()
        (folder / 'video.json').write_text(json.dumps({'style': 'comic', 'music': [{'asset': 'x'}]}))
        (folder / 'build' / 'words.json').write_text(json.dumps([{'w': 'a', 's': 0.0, 'e': 3.0}]))
        vid = folder / 'out' / 'video.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=3',
                        '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=3', '-filter_complex',
                        '[0:a]volume=-10dB[v];[1:a]volume=-40dB[b];[v][b]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'aac', str(vid)], capture_output=True)
        res = {x['check']: x for x in run(folder, vid, quiet=True)}
        expect(res['ducking']['status'] == 'PASS', 'a voice 30 dB over the bed should PASS ducking: ' + res['ducking']['message'])
        expect(res['chapters']['status'] == 'SKIPPED', 'no chapters.txt skips the chapter check')
        # chapters: two at the same level, one 12 LU quieter (3 chapters of 8 s)
        ch = td / 'chap'
        (ch / 'out').mkdir(parents=True)
        (ch / 'out' / 'chapters.txt').write_text('0:00 One\r\n0:08 Two\r\n0:16 Three\r\n')
        cv = ch / 'out' / 'video.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=8',
                        '-f', 'lavfi', '-i', 'sine=frequency=350:sample_rate=48000:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=48000:duration=8',
                        '-filter_complex', '[0:a]volume=-10dB[a1];[1:a]volume=-10dB[a2];[2:a]volume=-22dB[a3];[a1][a2][a3]concat=n=3:v=0:a=1[a]',
                        '-map', '[a]', '-c:a', 'aac', str(cv)], capture_output=True)
        res = {x['check']: x for x in run(ch, cv, quiet=True)}
        expect(res['chapters']['status'] in ('WARN', 'FAIL') and 'Three' in res['chapters']['message'], 'a chapter 12 LU quieter should be flagged: ' + res['chapters']['message'])
        flat = td / 'flat'
        (flat / 'out').mkdir(parents=True)
        (flat / 'out' / 'chapters.txt').write_text('0:00 One\n0:08 Two\n0:16 Three\n')
        fv = flat / 'out' / 'video.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=24', '-af', 'volume=-10dB', '-c:a', 'aac', str(fv)], capture_output=True)
        res = {x['check']: x for x in run(flat, fv, quiet=True)}
        expect(res['chapters']['status'] == 'PASS', 'chapters at one level should PASS: ' + res['chapters']['message'])
        # the same folder with the bed as loud as the voice: ducking fails
        loud = folder / 'out' / 'loud.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=3',
                        '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=3', '-filter_complex',
                        '[0:a]volume=-10dB[v];[1:a]volume=-12dB[b];[v][b]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'aac', str(loud)], capture_output=True)
        res = {x['check']: x for x in run(folder, loud, quiet=True)}
        expect(res['ducking']['status'] == 'FAIL', 'a bed as loud as the voice should FAIL ducking: ' + res['ducking']['message'])
        # chapter parsing, CRLF and hours
        expect(parse_chapters('0:00 A\r\n1:02:03 B C\r\n') == [(0, 'A'), (3723, 'B C')], 'chapter parse')
    print('mixcheck selftest: ' + ('FAIL' if bad else 'OK'))
    return 1 if bad else 0


def main(argv):
    if '--selftest' in argv:
        return selftest()
    args = [a for a in argv if not a.startswith('--')]
    if not args:
        print(__doc__)
        return 2
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        print('mixcheck: ffmpeg and ffprobe are needed (install ffmpeg)')
        return 2
    target = Path(args[0]).expanduser()
    folder = video = None
    if target.is_file():
        video = target
    elif target.is_dir():
        folder = target
        video = target / 'out' / 'video.mp4'
    if video is None or not video.is_file():
        print(f'mixcheck: no video found for "{posix(args[0])}" (give an mp4, or a video folder with out/video.mp4)')
        return 2
    results = run(folder, video)
    out_dir = (folder / 'build') if folder else video.parent
    out = out_dir / ('mix.json' if folder else video.stem + '.mix.json')
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({'video': posix(video), 'checks': results}, indent=1, default=str) + '\n', encoding='utf-8')
        print('wrote ' + posix(out))
    except OSError as e:
        print(f'could not write {posix(out)}: {e}')
    return summarize(results)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
