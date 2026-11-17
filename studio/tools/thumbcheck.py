#!/usr/bin/env python3
"""thumbcheck.py: is this YouTube thumbnail ready? Facts from pixels. No model, no credits, no network.

  python3 thumbcheck.py <video folder | thumbnail.jpg> [--min-h 60] [--no-ocr] [--lines lines.json] [--json]
  python3 thumbcheck.py --selftest

A folder means its out/thumbnail.jpg. Checks (the thumbnail is 1280x720):
  FILE    a JPEG or PNG, 2 MB at most (YouTube's limit), at least 640 px wide
  SIZE    1280x720 PASS. Another 16:9 size WARN (scale it to 1280x720). Any other shape FAIL.
  SAFE    every line of text at least 5 percent from every edge, and clear of the bottom-right 140x60 px where YouTube draws the
          duration badge (both scaled to the picture's size)
  TEXT    the biggest line of text is at least --min-h px tall (default 60 on 720 px). No text found FAIL: the thumbnail is its words.
  LIGHT   not near-black (mean under 30 and the brightest 1 percent under 60) and not near-white (mean over 225 and the darkest
          1 percent over 180)
  SMALL   shrunk to 168x94 (the size beside a video in the sidebar) the biggest line still stands out: contrast ratio of the
          lightest to the darkest quarter of its pixels at least 3:1 PASS, 2 to 3 WARN, under 2 FAIL
Text is read with Apple Vision on a Mac (built once from a small Swift file, cached in ~/.cache/bagelunit-video), else the Tesseract
program if installed. With neither, or with --no-ocr, text is ESTIMATED from the edges and contrast of the picture (needs numpy):
every text finding then says "estimated" and is at most a WARN, never a FAIL. --lines <json> takes lines you already have, a list of
{"text", "x", "y", "w", "h", "conf"} in pixels with y from the top. Needs ffmpeg and numpy.
Exit code 0 = no FAIL (WARN allowed), 1 = a FAIL, 2 = could not run (no ffmpeg, no numpy, no picture)."""
import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

W0, H0 = 1280, 720
MARGIN = 0.05
BADGE_W, BADGE_H = 140, 60            # at 1280x720
MIN_TITLE_H = 60                       # at 720 px tall
MAX_BYTES = 2 * 1024 * 1024
CACHE = Path.home() / '.cache' / 'bagelunit-video'

SWIFT = '''import Foundation
import Vision
import AppKit
for path in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let W = Double(cg.width), H = Double(cg.height)
    let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = false; req.minimumTextHeight = 0.02
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    var lines: [[String: Any]] = []
    for o in (req.results ?? []) {
        guard let c = o.topCandidates(1).first else { continue }
        let b = o.boundingBox
        lines.append(["text": c.string, "x": b.minX * W, "y": (1 - b.maxY) * H, "w": b.width * W, "h": b.height * H, "conf": Double(c.confidence)])
    }
    let out: [String: Any] = ["w": W, "h": H, "lines": lines]
    if let d = try? JSONSerialization.data(withJSONObject: out), let s = String(data: d, encoding: .utf8) { print(s) }
}
'''


# ---------------------------------------------------------------- pure checks (tested without any picture)
def file_check(nbytes, w):
    if nbytes > MAX_BYTES:
        return 'FAIL', f'FILE {nbytes / 1048576:.1f} MB is over YouTube\'s 2 MB limit: save it at a lower JPEG quality'
    if w < 640:
        return 'FAIL', f'FILE {w} px wide is under YouTube\'s 640 px minimum'
    return 'PASS', f'FILE {nbytes / 1024:.0f} KB (limit 2048 KB)'


def size_check(w, h):
    if (w, h) == (W0, H0):
        return 'PASS', 'SIZE 1280x720'
    if h and abs(w / h - 16 / 9) < 0.01:
        return 'WARN', f'SIZE {w}x{h} is 16:9 but the thumbnail is 1280x720: scale it'
    return 'FAIL', f'SIZE {w}x{h} is not 16:9: make a 1280x720 thumbnail'


def zones(w, h):
    """(safe box x0, y0, x1, y1, badge box x0, y0, x1, y1), the badge scaled to the picture."""
    sx = w / W0
    return (w * MARGIN, h * MARGIN, w * (1 - MARGIN), h * (1 - MARGIN), w - BADGE_W * sx, h - BADGE_H * sx, w, h)


def text_checks(lines, w, h, min_h=MIN_TITLE_H, estimated=False):
    """lines: [{text, x, y, w, h, conf}] in pixels, y from the top -> list of (level, message). `estimated` downgrades FAIL to WARN."""
    bad = 'WARN' if estimated else 'FAIL'
    tag = ' (estimated, no text reader)' if estimated else ''
    out = []
    real = [l for l in lines if len(str(l.get('text', '')).strip()) >= 2 and float(l.get('conf', 1)) >= 0.5]
    if not real:
        return [(bad, f'TEXT no text found{tag}: a thumbnail needs 2 to 5 big words')]
    x0, y0, x1, y1, bx0, by0, bx1, by1 = zones(w, h)
    off = [l for l in real if l['x'] < x0 - 1 or l['y'] < y0 - 1 or l['x'] + l['w'] > x1 + 1 or l['y'] + l['h'] > y1 + 1]
    badge = [l for l in real if l['x'] + l['w'] > bx0 and l['y'] + l['h'] > by0 and l['x'] < bx1 and l['y'] < by1]
    for l in off:
        out.append((bad, f'SAFE "{l["text"]}" at x {l["x"]:.0f}-{l["x"] + l["w"]:.0f}, y {l["y"]:.0f}-{l["y"] + l["h"]:.0f} is inside the 5% margin (keep x {x0:.0f}-{x1:.0f}, y {y0:.0f}-{y1:.0f}){tag}'))
    for l in badge:
        out.append((bad, f'SAFE "{l["text"]}" runs into the bottom-right corner (x {bx0:.0f}+, y {by0:.0f}+) where YouTube draws the duration badge{tag}'))
    if not off and not badge:
        out.append(('PASS', f'SAFE {len(real)} text line(s) inside the 5% margin and clear of the duration badge corner{tag}'))
    scale = h / H0
    top = max(real, key=lambda l: l['h'])
    need = min_h * scale
    if top['h'] < need:
        out.append((bad, f'TEXT the biggest line "{top["text"]}" is {top["h"]:.0f} px tall; at least {need:.0f} px so it reads small{tag}'))
    else:
        out.append(('PASS', f'TEXT the biggest line "{top["text"]}" is {top["h"]:.0f} px tall (needs {need:.0f}){tag}'))
    return out


def light_check(stats):
    m, lo, hi = stats['mean'], stats['p1'], stats['p99']
    if m < 30 and hi < 60:
        return 'FAIL', f'LIGHT near-black (mean {m:.0f}, brightest 1 percent {hi:.0f}): it disappears on a dark page'
    if m > 225 and lo > 180:
        return 'FAIL', f'LIGHT near-white (mean {m:.0f}, darkest 1 percent {lo:.0f}): it disappears on a light page'
    return 'PASS', f'LIGHT mean {m:.0f}, darkest 1 percent {lo:.0f}, brightest 1 percent {hi:.0f}'


def lum(v):
    """sRGB-ish 0..255 grey -> relative luminance 0..1 (the grey is already a gamma-coded value)."""
    c = v / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def contrast_ratio(light, dark):
    a, b = lum(light), lum(dark)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def small_check(ratio, text, estimated=False):
    bad = 'WARN' if estimated else 'FAIL'
    tag = ' (estimated)' if estimated else ''
    if ratio >= 3:
        return 'PASS', f'SMALL at 168x94 the biggest line "{text}" keeps a {ratio:.1f}:1 contrast{tag}'
    if ratio >= 2:
        return 'WARN', f'SMALL at 168x94 the biggest line "{text}" has only {ratio:.1f}:1 contrast (want 3:1): add an outline or a darker/lighter backing{tag}'
    return bad, f'SMALL at 168x94 the biggest line "{text}" has {ratio:.1f}:1 contrast: it fades into the picture{tag}'


# ---------------------------------------------------------------- reading the picture
def ffmpeg_gray(path, tw, th):
    import numpy as np
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', f'scale={tw}:{th}:flags=area,format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'],
                       capture_output=True)
    a = np.frombuffer(r.stdout, dtype=np.uint8)
    if a.size != tw * th:
        raise RuntimeError('ffmpeg could not decode the picture')
    return a.reshape(th, tw)


def dimensions(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', str(path)],
                       capture_output=True, text=True)
    try:
        a, b = r.stdout.strip().split('x')
        return int(a), int(b)
    except ValueError:
        raise RuntimeError('could not read the picture size (is ffprobe installed, and is this a JPEG or PNG?)')


def brightness(path, w, h):
    import numpy as np
    a = ffmpeg_gray(path, max(2, w // 4), max(2, h // 4))
    return {'mean': float(a.mean()), 'p1': float(np.percentile(a, 1)), 'p99': float(np.percentile(a, 99))}


def apple_ocr_binary():
    if platform.system() != 'Darwin' or not shutil.which('swiftc'):
        return None
    tag = hashlib.sha256(SWIFT.encode()).hexdigest()[:10]
    exe = CACHE / f'ocr-{tag}'
    if exe.exists():
        return exe
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'ocr.swift'
            src.write_text(SWIFT, encoding='utf-8')
            r = subprocess.run(['swiftc', '-O', str(src), '-o', str(exe)], capture_output=True, text=True)
        return exe if r.returncode == 0 and exe.exists() else None
    except OSError:
        return None


def tesseract_lines(path):
    r = subprocess.run(['tesseract', str(path), 'stdout', '--psm', '11', 'tsv'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    rows, groups = [l.split('\t') for l in r.stdout.splitlines()[1:]], {}
    for c in rows:
        if len(c) < 12 or not c[11].strip():
            continue
        try:
            conf = float(c[10])
            x, y, ww, hh = int(c[6]), int(c[7]), int(c[8]), int(c[9])
        except ValueError:
            continue
        if conf < 0:
            continue
        groups.setdefault((c[2], c[3], c[4]), []).append((x, y, ww, hh, c[11].strip(), conf / 100))
    out = []
    for ws in groups.values():
        x0 = min(a[0] for a in ws); y0 = min(a[1] for a in ws); x1 = max(a[0] + a[2] for a in ws); y1 = max(a[1] + a[3] for a in ws)
        out.append({'text': ' '.join(a[4] for a in sorted(ws)), 'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0, 'conf': sum(a[5] for a in ws) / len(ws)})
    return out


def read_text(path):
    """OCR lines, or None when no reader is installed."""
    exe = apple_ocr_binary()
    if exe:
        r = subprocess.run([str(exe), str(Path(path).resolve())], capture_output=True, text=True, encoding='utf-8', errors='replace')
        for l in r.stdout.splitlines():
            if l.strip():
                try:
                    return json.loads(l).get('lines', [])
                except ValueError:
                    pass
    if shutil.which('tesseract'):
        return tesseract_lines(path)
    return None


def estimate_text(gray):
    """Text-like regions from edges and contrast, numpy only. gray: 2-D uint8. -> [{text, x, y, w, h, conf}] in the picture's pixels.
    A rough guess: busy artwork also has edges, so a person reads the result as 'something text-sized is here'."""
    import numpy as np
    h, w = gray.shape
    g = gray.astype(np.float32)
    gx = np.abs(np.diff(g, axis=1, prepend=g[:, :1]))
    gy = np.abs(np.diff(g, axis=0, prepend=g[:1, :]))
    edge = (np.maximum(gx, gy) > 60).astype(np.float32)
    b = max(4, w // 80)                                   # a block is 1/80 of the width
    bh, bw = h // b, w // b
    if bh < 3 or bw < 3:
        return []
    dens = edge[:bh * b, :bw * b].reshape(bh, b, bw, b).mean(axis=(1, 3))
    spread = (g[:bh * b, :bw * b].reshape(bh, b, bw, b).max(axis=(1, 3)) - g[:bh * b, :bw * b].reshape(bh, b, bw, b).min(axis=(1, 3)))
    on = (dens > 0.06) & (spread > 90)
    # join blocks one step apart (the gap inside a letter or between letters), then take connected groups
    grown = on.copy()
    grown[:, 1:] |= on[:, :-1]
    grown[:, :-1] |= on[:, 1:]
    seen = np.zeros_like(grown, dtype=bool)
    boxes = []
    for sy in range(bh):
        for sx in range(bw):
            if not grown[sy, sx] or seen[sy, sx]:
                continue
            stack, cells = [(sy, sx)], []
            seen[sy, sx] = True
            while stack:
                cy, cx = stack.pop()
                cells.append((cy, cx))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < bh and 0 <= nx < bw and grown[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            ys = [c[0] for c in cells]; xs = [c[1] for c in cells]
            x0, x1, y0, y1 = min(xs) * b, (max(xs) + 1) * b, min(ys) * b, (max(ys) + 1) * b
            if (x1 - x0) >= 3 * b and (y1 - y0) >= 2 * b and len(cells) >= 6:
                boxes.append({'text': 'text-like region', 'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0, 'conf': 0.5})
    return boxes


def region_contrast(gray_small, box, sw, sh, w, h):
    """Contrast ratio of the lightest to the darkest quarter of the pixels of box (picture pixels) in the shrunk picture."""
    import numpy as np
    x0 = max(0, int(box['x'] * sw / w)); x1 = min(sw, max(x0 + 1, int(math.ceil((box['x'] + box['w']) * sw / w))))
    y0 = max(0, int(box['y'] * sh / h)); y1 = min(sh, max(y0 + 1, int(math.ceil((box['y'] + box['h']) * sh / h))))
    px = np.sort(gray_small[y0:y1, x0:x1].ravel())
    q = max(1, len(px) // 4)
    return contrast_ratio(float(px[-q:].mean()), float(px[:q].mean()))


def check(path, min_h=MIN_TITLE_H, use_ocr=True, lines=None):
    path = Path(path)
    if not path.is_file():
        raise RuntimeError(f'no picture at {str(path).replace(chr(92), "/")}')
    w, h = dimensions(path)
    out = [file_check(path.stat().st_size, w), size_check(w, h)]
    try:
        out.append(light_check(brightness(path, w, h)))
        import numpy  # noqa: F401
    except ImportError:
        raise RuntimeError('numpy is needed (pip install numpy)')
    estimated = False
    if lines is None and use_ocr:
        lines = read_text(path)
    if lines is None:
        lines = estimate_text(ffmpeg_gray(path, 640, round(640 * h / w)))
        sc = w / 640
        lines = [{**l, 'x': l['x'] * sc, 'y': l['y'] * sc, 'w': l['w'] * sc, 'h': l['h'] * sc} for l in lines]
        estimated = True
    out += text_checks(lines, w, h, min_h, estimated)
    real = [l for l in lines if len(str(l.get('text', '')).strip()) >= 2 and float(l.get('conf', 1)) >= 0.5]
    if real:
        top = max(real, key=lambda l: l['h'])
        sw, sh = 168, 94
        out.append(small_check(region_contrast(ffmpeg_gray(path, sw, sh), top, sw, sh, w, h), top['text'], estimated))
    return out


def report(results):
    return 1 if any(l == 'FAIL' for l, _ in results) else 0


# ---------------------------------------------------------------- self test (numpy needed for the picture parts, nothing else)
def selftest():
    bad = 0

    def expect(cond, msg):
        nonlocal bad
        if not cond:
            print('FAIL selftest: ' + msg)
            bad += 1

    expect(size_check(1280, 720)[0] == 'PASS' and size_check(1920, 1080)[0] == 'WARN' and size_check(1080, 1920)[0] == 'FAIL', 'size')
    expect(file_check(500_000, 1280)[0] == 'PASS' and file_check(3_000_000, 1280)[0] == 'FAIL' and file_check(10_000, 320)[0] == 'FAIL', 'file')
    x0, y0, x1, y1, bx0, by0, bx1, by1 = zones(1280, 720)
    expect((round(x0), round(y0), round(x1), round(y1), round(bx0), round(by0)) == (64, 36, 1216, 684, 1140, 660), 'zones ' + str((x0, y0, x1, y1, bx0, by0)))
    ok = [{'text': 'WHY ICE FLOATS', 'x': 100, 'y': 200, 'w': 700, 'h': 110, 'conf': 0.9}]
    expect(all(l == 'PASS' for l, _ in text_checks(ok, 1280, 720)), 'good text')
    badge = [{'text': 'WHY ICE FLOATS', 'x': 900, 'y': 600, 'w': 330, 'h': 100, 'conf': 0.9}]       # bottom-right: the badge covers it
    expect(any(l == 'FAIL' and 'badge' in m for l, m in text_checks(badge, 1280, 720)), 'badge corner')
    edge = [{'text': 'WHY ICE FLOATS', 'x': 20, 'y': 200, 'w': 700, 'h': 110, 'conf': 0.9}]
    expect(any(l == 'FAIL' and m.startswith('SAFE') for l, m in text_checks(edge, 1280, 720)), '5 percent margin')
    small = [{'text': 'WHY ICE FLOATS', 'x': 100, 'y': 200, 'w': 400, 'h': 40, 'conf': 0.9}]
    expect(any(l == 'FAIL' and m.startswith('TEXT') for l, m in text_checks(small, 1280, 720)), 'text too small')
    expect(text_checks([], 1280, 720)[0][0] == 'FAIL' and text_checks([], 1280, 720, estimated=True)[0][0] == 'WARN', 'no text; estimated is a WARN')
    expect(text_checks([{'text': 'x', 'x': 100, 'y': 200, 'w': 20, 'h': 100, 'conf': 0.2}], 1280, 720)[0][0] == 'FAIL', 'a smudge is not text')
    expect(all(l != 'FAIL' for l, _ in text_checks(small, 1280, 720, estimated=True)), 'estimated never FAILs')
    expect(light_check({'mean': 12, 'p1': 0, 'p99': 40})[0] == 'FAIL' and light_check({'mean': 245, 'p1': 220, 'p99': 255})[0] == 'FAIL', 'near-black and near-white')
    expect(light_check({'mean': 25, 'p1': 10, 'p99': 240})[0] == 'PASS' and light_check({'mean': 110, 'p1': 30, 'p99': 220})[0] == 'PASS', 'dark with a bright title passes')
    expect(abs(contrast_ratio(255, 0) - 21) < 0.01 and contrast_ratio(120, 118) < 1.1, 'contrast ratio')
    expect(small_check(4, 'A')[0] == 'PASS' and small_check(2.5, 'A')[0] == 'WARN' and small_check(1.2, 'A')[0] == 'FAIL' and small_check(1.2, 'A', True)[0] == 'WARN', 'small check levels')
    expect(report([('PASS', 'a'), ('WARN', 'b')]) == 0 and report([('WARN', 'a'), ('FAIL', 'b')]) == 1, 'report')
    try:
        import numpy as np
    except ImportError:
        print('SKIPPED thumbcheck selftest (picture part): numpy not found')
        print('thumbcheck selftest: ' + ('FAIL' if bad else 'OK (without numpy)'))
        return 1 if bad else 0
    # the estimator finds a block of white strokes on a dark picture, and nothing on flat colour
    g = np.full((360, 640), 40, dtype=np.uint8)
    for k in range(7):
        g[150:210, 60 + k * 26:60 + k * 26 + 12] = 245
    boxes = estimate_text(g)
    expect(len(boxes) == 1 and boxes[0]['x'] <= 80 and boxes[0]['y'] <= 160 and boxes[0]['h'] >= 50, 'the estimator should find the strokes: ' + str(boxes))
    expect(estimate_text(np.full((360, 640), 90, dtype=np.uint8)) == [], 'flat colour has no text')
    expect(region_contrast(g[::4, ::4], boxes[0], 160, 90, 640, 360) > 3, 'white strokes on dark keep their contrast when shrunk')
    flat_grey = np.full((94, 168), 100, dtype=np.uint8)
    expect(region_contrast(flat_grey, {'x': 10, 'y': 10, 'w': 50, 'h': 20}, 168, 94, 168, 94) < 1.1, 'no contrast on flat grey')
    # with ffmpeg: a real JPEG, run through check() with given lines (no reader needed)
    if shutil.which('ffmpeg') and shutil.which('ffprobe'):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            good, dark = td / 'good.jpg', td / 'dark.jpg'
            px = np.full((720, 1280, 3), (30, 60, 130), dtype=np.uint8)
            px[250:370, 120:900] = 250                                   # a white block where the title sits
            (td / 'g.ppm').write_bytes(b'P6\n1280 720\n255\n' + px.tobytes())
            (td / 'd.ppm').write_bytes(b'P6\n1280 720\n255\n' + np.full((720, 1280, 3), 8, dtype=np.uint8).tobytes())
            r1 = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(td / 'g.ppm'), '-q:v', '3', str(good)], capture_output=True)
            r2 = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(td / 'd.ppm'), '-q:v', '3', str(dark)], capture_output=True)
            if r1.returncode or r2.returncode or not good.exists():
                print('SKIPPED thumbcheck selftest (picture part): this ffmpeg could not write a JPEG')
            else:
                lines = [{'text': 'WHY ICE FLOATS', 'x': 120, 'y': 250, 'w': 780, 'h': 120, 'conf': 0.9}]
                res = check(good, lines=lines)
                expect(report(res) == 0, 'a good thumbnail should pass: ' + str([r for r in res if r[0] != 'PASS']))
                res = check(dark, lines=lines)
                expect(report(res) == 1 and any(l == 'FAIL' and m.startswith('LIGHT') for l, m in res), 'a near-black picture should FAIL: ' + str(res))
                res = check(good, lines=[{'text': 'WHY ICE FLOATS', 'x': 900, 'y': 600, 'w': 330, 'h': 100, 'conf': 0.9}])
                expect(report(res) == 1, 'text under the duration badge should FAIL')
                res = check(good, use_ocr=False)                        # the estimator on the real file: one white block is found
                expect(any(m.startswith('TEXT') for _, m in res) and all(l != 'FAIL' or m.startswith(('LIGHT', 'SIZE', 'FILE')) for l, m in res), 'estimated findings never FAIL: ' + str(res))
    print('thumbcheck selftest: ' + ('FAIL' if bad else 'OK'))
    return 1 if bad else 0


def main(argv):
    if '--selftest' in argv:
        return selftest()
    args, opts, i = [], {}, 0
    while i < len(argv):
        a = argv[i]
        if a in ('--min-h', '--lines'):
            opts[a] = argv[i + 1] if i + 1 < len(argv) else ''
            i += 2
            continue
        if a.startswith('--'):
            opts[a] = True
        else:
            args.append(a)
        i += 1
    if not args:
        print(__doc__)
        return 2
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        print('thumbcheck: ffmpeg and ffprobe are needed (install ffmpeg)')
        return 2
    target = Path(args[0]).expanduser()
    path = target / 'out' / 'thumbnail.jpg' if target.is_dir() else target
    lines = None
    if '--lines' in opts:
        try:
            lines = json.loads(Path(opts['--lines']).read_text(encoding='utf-8-sig'))
        except (OSError, ValueError) as e:
            print(f'thumbcheck: could not read --lines: {e}')
            return 2
    try:
        results = check(path, float(opts.get('--min-h', MIN_TITLE_H)), '--no-ocr' not in opts, lines)
    except RuntimeError as e:
        print(f'thumbcheck: {e}')
        return 2
    code = report(results)
    if '--json' in opts:
        print(json.dumps({'file': str(path).replace('\\', '/'), 'exit': code, 'results': [{'level': l, 'message': m} for l, m in results]}, indent=1))
    else:
        print(f'thumbcheck: {str(path).replace(chr(92), "/")}')
        for l, m in results:
            print(f'{l:6} {m}')
        print('THUMBNAIL OK' if code == 0 else 'THUMBNAIL NEEDS FIXING (a FAIL above)')
    return code


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
