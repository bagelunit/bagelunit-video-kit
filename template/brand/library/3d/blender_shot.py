#!/usr/bin/env python3
"""blender_shot.py: run a Blender shot script headless and turn the frames into a still or a clip. Works on Mac, Windows and Linux.

  python3 blender_shot.py shots/product.py --video my-video --still 45          one frame to look at first
  python3 blender_shot.py shots/product.py --video my-video --clip product.mov  the clip, ProRes 4444 with alpha (.webm: VP9 with alpha)
  python3 blender_shot.py shots/product.py --video my-video --mp4 product.mp4   an opaque H.264 clip (no alpha; the background is --bg)

  --video NAME     the video the shot is for: output goes to videos/NAME/assets/blender/ (a folder path works too; inside a video folder it is the default)
  --out DIR        any folder inside this channel folder instead
  --name NAME      file name stem (default: the shot's name): NAME-still.png, NAME.mov, NAME.mp4
  --still N        render only frame N (fast: look at it before the clip)
  --clip FILE.mov  encode the frames with alpha (.mov ProRes 4444, .webm VP9); --mp4 FILE.mp4 without alpha
  --vertical       1080x1920 instead of 1920x1080        --size WxH   any size (default 1920x1080)
  --fps 30  --seconds 4 (or --frames N)  --samples 48   render settings
  --keep-frames    keep the numbered PNG frames       --dry-run   print what would run, change nothing
Everything else (--shape can, --label x.png, --bbox ...) goes to the shot. Blender is found at BAGELUNIT_BLENDER, then `blender` on PATH,
then the standard places (Mac /Applications/Blender.app, Windows Program Files\\Blender Foundation, Linux /usr/bin, /snap/bin, /opt).
"""
import argparse
import os
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent                     # .../brand/library/3d
CHANNEL = HERE.parents[2]                                           # the channel folder
KEEP = ('STILL', 'FRAMES', 'LABEL', 'Error', 'Traceback', 'File "', 'SystemExit', 'ModuleNotFoundError')


def blender_candidates():
    home = pathlib.Path.home()
    if sys.platform == 'darwin':
        return ['/Applications/Blender.app/Contents/MacOS/Blender', str(home / 'Applications/Blender.app/Contents/MacOS/Blender'), '/opt/homebrew/bin/blender', '/usr/local/bin/blender']
    if sys.platform.startswith('win'):
        out = []
        for root in {os.environ.get('ProgramFiles'), os.environ.get('ProgramFiles(x86)'), 'C:\\Program Files'}:
            base = pathlib.Path(root or '') / 'Blender Foundation'
            if root and base.is_dir():
                out += [str(d / 'blender.exe') for d in sorted(base.iterdir(), reverse=True) if d.name.lower().startswith('blender')]
        return out
    out = ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender']
    opt = pathlib.Path('/opt')
    if opt.is_dir():
        out += [str(d / 'blender') for d in sorted(opt.iterdir(), reverse=True) if d.name.lower().startswith('blender')]
    return out + [str(home / 'blender' / 'blender')]


def find_blender():
    env = os.environ.get('BAGELUNIT_BLENDER')
    if env:
        return env if os.path.isfile(env) else None
    paths = os.environ.get('BAGELUNIT_BLENDER_PATHS')
    if paths is not None:                                           # replaces the search (for tests)
        for p in [x for x in paths.split(os.pathsep) if x]:
            if os.path.isfile(p):
                return p
            for n in ('blender', 'blender.exe'):
                if os.path.isfile(os.path.join(p, n)):
                    return os.path.join(p, n)
        return None
    return shutil.which('blender') or next((c for c in blender_candidates() if os.path.isfile(c)), None)


def how_to_get():
    if sys.platform == 'darwin':
        return 'brew install --cask blender (or blender.org)'
    if sys.platform.startswith('win'):
        return 'winget install BlenderFoundation.Blender (or blender.org)'
    return 'sudo snap install blender --classic, sudo apt install blender, or blender.org'


def resolve_out(video=None, out=None, cwd=None):
    """The folder the files go in, always inside this channel folder: --out, else videos/<video>/assets/blender/."""
    cwd = pathlib.Path(cwd or os.getcwd()).resolve()
    chan = CHANNEL.resolve()
    if out:
        d = pathlib.Path(out)
        d = (d if d.is_absolute() else cwd / d).resolve()
    else:
        vdir = None
        if video:
            v = pathlib.Path(video)
            cand = [v if v.is_absolute() else cwd / v, chan / 'videos' / video]
            vdir = next((c.resolve() for c in cand if (c / 'video.json').is_file() or c.is_dir() and c.parent.name == 'videos'), None)
            if vdir is None:
                raise SystemExit(f'no video "{video}" (looked at videos/{video} in {chan.as_posix()}). Make it first: video new {video} --style <id>')
        else:
            for p in [cwd, *cwd.parents]:
                if (p / 'video.json').is_file():
                    vdir = p
                    break
        if vdir is None:
            raise SystemExit('which video is this for? Add --video <name> (the shot goes to videos/<name>/assets/blender/), or --out <folder>')
        d = vdir / 'assets' / 'blender'
    real_chan = pathlib.Path(os.path.realpath(chan))
    real_d = pathlib.Path(os.path.realpath(d))
    if real_d != real_chan and real_chan not in real_d.parents:
        raise SystemExit(f'{d.as_posix()} is outside the channel folder ({chan.as_posix()}): renders stay inside it')
    return d


def parse(argv):
    ap = argparse.ArgumentParser(prog='blender_shot.py', description='Run a Blender shot headless and encode a still or a clip.', allow_abbrev=False, add_help=True)
    ap.add_argument('shot')
    ap.add_argument('--video')
    ap.add_argument('--out')
    ap.add_argument('--name')
    ap.add_argument('--still', type=int)
    ap.add_argument('--clip')
    ap.add_argument('--mp4')
    ap.add_argument('--vertical', action='store_true')
    ap.add_argument('--size')
    ap.add_argument('--fps', type=int, default=30)
    ap.add_argument('--seconds', type=float, default=4.0)
    ap.add_argument('--frames', type=int)
    ap.add_argument('--samples', type=int, default=48)
    ap.add_argument('--keep-frames', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    a, rest = ap.parse_known_args(argv)
    if a.clip and a.mp4:
        raise SystemExit('give --clip or --mp4, not both')
    if a.clip and not a.clip.lower().endswith(('.mov', '.webm')):
        raise SystemExit('--clip wants a .mov (ProRes 4444 with alpha) or .webm (VP9 with alpha) name; use --mp4 for an opaque H.264 file')
    if a.mp4 and not a.mp4.lower().endswith('.mp4'):
        raise SystemExit('--mp4 wants a name ending in .mp4')
    if a.size is None:
        size = '1080x1920' if a.vertical else '1920x1080'
    else:
        size = a.size
    return a, rest, size


def build(a, rest, size, out):
    shot = pathlib.Path(a.shot)
    if not shot.is_absolute():
        shot = (pathlib.Path(os.getcwd()) / shot) if (pathlib.Path(os.getcwd()) / shot).is_file() else HERE / shot
    if not shot.is_file():
        raise SystemExit(f'no shot script "{a.shot}" (try shots/product.py, shots/phone.py or shots/terrain.py in {HERE.as_posix()})')
    name = a.name or shot.stem
    frames_dir = out / f'{name}_frames'
    frames = a.frames or max(1, round(a.seconds * a.fps))
    args = ['--out', str(frames_dir), '--size', size, '--fps', str(a.fps), '--frames', str(frames), '--samples', str(a.samples)]
    if a.vertical:
        args.append('--vertical')
    if a.mp4:
        args += ['--opaque', '1']                                    # an mp4 has no alpha: the shot fills its own background
    if a.still is not None:
        args += ['--still', str(a.still)]
    return shot, name, frames_dir, frames, args + rest


def encode(a, name, frames_dir, out):
    ff = shutil.which('ffmpeg')
    if not ff:
        raise SystemExit(f'ffmpeg is needed to make the clip (the frames are kept in {frames_dir.as_posix()}): brew install ffmpeg, or winget install ffmpeg')
    src = str(frames_dir / 'f_%04d.png')
    target = out / (a.clip or a.mp4)
    if a.mp4:
        cmd = [ff, '-loglevel', 'error', '-y', '-framerate', str(a.fps), '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', str(target)]
    elif a.clip.lower().endswith('.webm'):
        cmd = [ff, '-loglevel', 'error', '-y', '-framerate', str(a.fps), '-i', src, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', str(target)]
    else:
        cmd = [ff, '-loglevel', 'error', '-y', '-framerate', str(a.fps), '-i', src, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', str(target)]
    r = subprocess.run(cmd)
    if r.returncode != 0:
        raise SystemExit(f'ffmpeg could not make {target.name}; the frames are kept in {frames_dir.as_posix()}')
    return target


def main(argv=None):
    a, rest, size = parse(sys.argv[1:] if argv is None else argv)
    out = resolve_out(a.video, a.out)
    shot, name, frames_dir, frames, args = build(a, rest, size, out)
    blender = find_blender()
    cmd = [blender or 'blender', '-b', '--factory-startup', '-P', str(shot), '--', *args]
    if a.dry_run:
        print('would run: ' + ' '.join(cmd))
        print(f'output folder: {out.as_posix()}' + ('' if blender else '   (Blender was not found)'))
        return 0
    if not blender:
        raise SystemExit(f'Blender was not found. It is free and optional: {how_to_get()}. Or set BAGELUNIT_BLENDER to its program.')
    out.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(frames_dir, ignore_errors=True)
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace', env=env)
    tail = []
    for line in p.stdout:
        t = line.rstrip()
        if t.startswith(KEEP) or t.startswith('  ') and tail:
            tail.append(t)
            tail = tail[-30:]
    p.wait()
    print('\n'.join(tail))
    if p.returncode != 0:
        raise SystemExit(f'Blender stopped with an error (exit {p.returncode}); the lines above say where')
    if a.still is not None:
        png = frames_dir / 'still.png'
        if not png.is_file():
            raise SystemExit('Blender finished but wrote no still')
        target = out / f'{name}-still.png'
        shutil.move(str(png), str(target))
        shutil.rmtree(frames_dir, ignore_errors=True)
        print(f'still: {target.as_posix()}')
        return 0
    if not (frames_dir / 'f_0001.png').is_file():
        raise SystemExit('Blender finished but wrote no frames')
    if a.clip or a.mp4:
        target = encode(a, name, frames_dir, out)
        if not a.keep_frames:
            shutil.rmtree(frames_dir, ignore_errors=True)
        print(f'clip: {target.as_posix()}')
    else:
        print(f'frames: {frames_dir.as_posix()} ({frames} PNGs). Add --clip name.mov (or --mp4 name.mp4) to encode them.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
