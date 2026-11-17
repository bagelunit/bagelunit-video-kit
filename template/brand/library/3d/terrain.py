#!/usr/bin/env python3
"""terrain.py: a latitude/longitude box as a 3D shaded-relief render. Plain Python (3.8 or newer, no packages), any system.

  python3 terrain.py --bbox SOUTH,WEST,NORTH,EAST --video <name> --still 30            one frame to look at
  python3 terrain.py --bbox 27.6,85.9,28.3,87.0 --video <name> --clip everest.mov --label "Everest@27.988,86.925"
  python3 terrain.py --bbox ... --video <name> --data-only                              only fetch the data, no render
  python3 terrain.py --from-dir videos/<name>/assets/blender/terrain-data --video <name> --still 30   render saved data (no network)

THE NETWORK IS USED HERE AND NOWHERE ELSE in the kit, only when you run this command. It downloads the free "Terrain Tiles" (Terrarium
PNG tiles) from the AWS open data bucket, https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png (no key, no account),
one tile at a time with a short pause, with retries, and keeps each tile in videos/<name>/assets/blender/.tiles/ so it is fetched once.
The request says only "bagelunit-video-kit-terrain" (no name, no address). Height = (R * 256 + G + B / 256) - 32768 metres.

It writes next to the render: terrain-data/ (heights.f32, heightmap.png, terrain.json) and ATTRIBUTION.txt, and prints the attribution:
put it in the video description (the data is public domain or openly licensed, and its providers ask for credit).

Limits: zoom 14 at most, a map of at most 36 tiles and 2048 px on the longer side unless you raise --max-tiles (100) or --max-size (4096).
Everything not listed here (--still, --clip, --mp4, --vertical, --size, --label, --ramp, --move ...) goes on to the Blender shot
(shots/terrain.py, see its header). Needs Blender only for the render; --data-only needs nothing but Python.
"""
import argparse
import array
import json
import math
import os
import pathlib
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
USER_AGENT = 'bagelunit-video-kit-terrain/1.0 (open source video tool; elevation tiles)'
HARD_MAX_ZOOM, HARD_MAX_TILES, HARD_MAX_SIZE = 14, 100, 4096
EARTH_CIRCUMFERENCE_M = 40075016.686

SHORT_ATTRIBUTION = ('Terrain data: Terrain Tiles (Mapzen, Tilezen) built from USGS SRTM and 3DEP, NASA, NOAA ETOPO1 and other open elevation '
                     'sources; full credits below (source: https://github.com/tilezen/joerd/blob/master/docs/attribution.md).')
# the "Required attribution" block of the Tilezen/joerd attribution page, copied word for word (page read 2026-11-17)
REQUIRED_ATTRIBUTION = '''* ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and
  funded under National Science Foundation awards 1043681, 1559691, and 1542736;
* Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
* Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM)
  Österreich;
* Canada terrain data contains information licensed under the Open Government
  Licence – Canada;
* Europe terrain data produced using Copernicus data and information funded by the
  European Union - EU-DEM layers;
* Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration
* Mexico terrain data source: INEGI, Continental relief, 2016;
* New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New
  Zealand and the New Zealand Government (All rights reserved);
* Norway terrain data © Kartverket;
* United Kingdom terrain data © Environment Agency copyright and/or database right
  2015. All rights reserved;
* United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data
  courtesy of the U.S. Geological Survey.'''


def attribution_text():
    return SHORT_ATTRIBUTION + '\n\n' + REQUIRED_ATTRIBUTION + '\n'


class TerrainError(Exception):
    """A problem the person can fix, said in plain words."""


# ---- the map: latitude/longitude to tiles and pixels (Web Mercator, as the tiles are) --------------------------------------------------
def world_px(lat, lon, z):
    n = 256 * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def px_to_latlon(x, y, z):
    n = 256 * 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def parse_bbox(text):
    try:
        s, w, n, e = (float(v) for v in str(text).split(','))
    except ValueError:
        raise TerrainError(f'--bbox wants SOUTH,WEST,NORTH,EAST in decimal degrees, for example 27.6,85.9,28.3,87.0 (got "{text}")')
    if not (-85.05 <= s < n <= 85.05):
        raise TerrainError(f'the box needs SOUTH below NORTH, both between -85 and 85 degrees (got south {s}, north {n})')
    if not (-180 <= w < e <= 180):
        raise TerrainError(f'the box needs WEST below EAST, between -180 and 180 degrees (got west {w}, east {e}); a box across the 180 degree line is not supported')
    return s, w, n, e


def plan(bbox, zoom=None, max_size=2048, max_zoom=12, max_tiles=36):
    """Which tiles and which pixel window: the highest zoom within the caps (or the zoom asked for, refused if it breaks a cap)."""
    s, w, n, e = bbox
    if not (1 <= max_size <= HARD_MAX_SIZE):
        raise TerrainError(f'--max-size can be 1 to {HARD_MAX_SIZE}')
    if not (1 <= max_tiles <= HARD_MAX_TILES):
        raise TerrainError(f'--max-tiles can be 1 to {HARD_MAX_TILES}')

    def window(z):
        x0, y1 = world_px(s, w, z)
        x1, y0 = world_px(n, e, z)
        ix0, iy0, ix1, iy1 = math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1)
        tx0, ty0, tx1, ty1 = ix0 // 256, iy0 // 256, (ix1 - 1) // 256, (iy1 - 1) // 256
        return {'zoom': z, 'px': (ix0, iy0, ix1, iy1), 'width': ix1 - ix0, 'height': iy1 - iy0,
                'tiles': (tx0, ty0, tx1, ty1), 'count': (tx1 - tx0 + 1) * (ty1 - ty0 + 1)}
    if zoom is not None:
        if not (0 <= zoom <= HARD_MAX_ZOOM):
            raise TerrainError(f'--zoom can be 0 to {HARD_MAX_ZOOM}')
        p = window(zoom)
        if max(p['width'], p['height']) > max_size or p['count'] > max_tiles:
            raise TerrainError(f"zoom {zoom} for this box is {p['width']}x{p['height']} px from {p['count']} tiles, over the caps ({max_size} px, {max_tiles} tiles). "
                               'Use a smaller box or a lower zoom, or raise --max-size / --max-tiles (hard limits 4096 px, 100 tiles).')
    else:
        p = None
        for z in range(min(max_zoom, HARD_MAX_ZOOM), -1, -1):
            c = window(z)
            if max(c['width'], c['height']) <= max_size and c['count'] <= max_tiles:
                p = c
                break
        if p is None:
            raise TerrainError('this box is too small to map (under 2 pixels at any zoom) or too large for the caps; give a larger or smaller box')
    if p['width'] < 2 or p['height'] < 2:
        raise TerrainError(f"the box is only {p['width']}x{p['height']} px even at zoom {p['zoom']}: give a larger box")
    return p


# ---- PNG (just enough to read the tiles and write the previews: no packages) ----------------------------------------------------------
def decode_png(data):
    """-> (width, height, channels, bytes of rows, 8 bits per sample). Reads 8-bit grey, RGB, RGBA and palette PNGs, not interlaced."""
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise TerrainError('a tile is not a PNG file (the server sent something else)')
    pos, idat, plte, hdr = 8, [], None, None
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            hdr = struct.unpack('>IIBBBBB', body)
        elif typ == b'PLTE':
            plte = body
        elif typ == b'IDAT':
            idat.append(body)
        elif typ == b'IEND':
            break
    if not hdr:
        raise TerrainError('a tile PNG has no header')
    w, h, depth, ctype, _, _, interlace = hdr
    if depth != 8 or interlace != 0 or ctype not in (0, 2, 3, 6):
        raise TerrainError(f'a tile PNG is in a format this reader does not handle (bit depth {depth}, colour type {ctype}, interlace {interlace})')
    ch = {0: 1, 2: 3, 3: 1, 6: 4}[ctype]
    raw = zlib.decompress(b''.join(idat))
    stride = w * ch
    if len(raw) != (stride + 1) * h:
        raise TerrainError('a tile PNG is cut short')
    out = bytearray(stride * h)
    prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif f != 0:
            raise TerrainError(f'a tile PNG uses an unknown row filter ({f})')
        out[y * stride:(y + 1) * stride] = line
        prev = line
    if ctype == 3:                                                  # palette -> RGB
        if not plte:
            raise TerrainError('a palette tile PNG has no palette')
        rgb = bytearray()
        for v in out:
            rgb += plte[v * 3:v * 3 + 3]
        return w, h, 3, bytes(rgb)
    return w, h, ch, bytes(out)


def encode_png(width, height, channels, depth, rows):
    """rows: bytes of height*width*channels*(depth/8), top row first (16-bit samples big-endian). channels 1 (grey) or 3 (RGB)."""
    ctype = {1: 0, 3: 2}[channels]
    stride = width * channels * (depth // 8)
    raw = b''.join(b'\x00' + rows[y * stride:(y + 1) * stride] for y in range(height))

    def chunk(t, body):
        c = struct.pack('>I', len(body)) + t + body
        return c + struct.pack('>I', zlib.crc32(t + body) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, depth, ctype, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')


def terrarium_heights(png_bytes):
    """One Terrarium tile -> (size, array('f') of metres): height = (R * 256 + G + B / 256) - 32768."""
    w, h, ch, px = decode_png(png_bytes)
    if ch < 3:
        raise TerrainError('a tile PNG is not a Terrarium tile (it has no colour channels)')
    out = array.array('f', bytes(4 * w * h))
    for i in range(w * h):
        o = i * ch
        out[i] = px[o] * 256.0 + px[o + 1] + px[o + 2] / 256.0 - 32768.0
    return w, h, out


# ---- fetching (the only network code; `http_get` is the one thing a test replaces) -------------------------------------------------------
def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_tile(z, x, y, cache_dir, retries=3, pause=0.15, log=print):
    """The tile's PNG bytes: from the cache folder if it is there, else downloaded (retried) and cached."""
    f = pathlib.Path(cache_dir) / str(z) / str(x) / f'{y}.png'
    if f.is_file() and f.stat().st_size > 0:
        return f.read_bytes(), True
    url = TILE_URL.format(z=z, x=x, y=y)
    last = None
    for attempt in range(retries):
        try:
            data = http_get(url)
            if not data.startswith(b'\x89PNG'):
                raise TerrainError(f'{url} did not return a PNG')
            f.parent.mkdir(parents=True, exist_ok=True)
            tmp = f.with_suffix('.part')
            tmp.write_bytes(data)
            os.replace(tmp, f)
            time.sleep(pause)                                       # one at a time, politely
            return data, False
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code} {e.reason}'
            if e.code in (400, 403, 404):
                raise TerrainError(f'the server has no tile {z}/{x}/{y} ({last}); try a different box or a lower --zoom')
        except TerrainError as e:
            last = str(e)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = f'could not reach the server: {getattr(e, "reason", e)}'
        if attempt + 1 < retries:
            wait = 0.5 * (3 ** attempt)
            log(f'  tile {z}/{x}/{y}: {last}; trying again in {wait:.1f} s')
            time.sleep(wait)
    raise TerrainError(f'could not download tile {z}/{x}/{y} after {retries} tries ({last}). Check the internet connection and run the same command again: '
                       'tiles that were already downloaded are kept and are not fetched again.')


def build(bbox, out_dir, cache_dir, zoom=None, max_size=2048, max_zoom=12, max_tiles=36, log=print):
    """Fetch (or read from the cache) the tiles of a box, stitch and crop them, and write the data folder. Returns terrain.json's content."""
    p = plan(bbox, zoom, max_size, max_zoom, max_tiles)
    z = p['zoom']
    tx0, ty0, tx1, ty1 = p['tiles']
    ix0, iy0, ix1, iy1 = p['px']
    W, H = p['width'], p['height']
    lat_c = (bbox[0] + bbox[2]) / 2
    m_per_px = EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat_c)) / (256 * 2 ** z)
    log(f"zoom {z}: {p['count']} tile(s), {W}x{H} px, about {m_per_px:.0f} m per pixel")
    rows = [array.array('f', bytes(4 * W)) for _ in range(H)]
    cached = 0
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            data, hit = fetch_tile(z, tx, ty, cache_dir, log=log)
            cached += 1 if hit else 0
            size, _, tile = terrarium_heights(data)
            if size != 256:
                raise TerrainError(f'tile {z}/{tx}/{ty} is {size} px wide, not 256')
            # the part of this tile inside the window
            gx0, gy0 = tx * 256, ty * 256
            ax0, ax1 = max(ix0, gx0), min(ix1, gx0 + 256)
            ay0, ay1 = max(iy0, gy0), min(iy1, gy0 + 256)
            for gy in range(ay0, ay1):
                src = (gy - gy0) * 256
                rows[gy - iy0][ax0 - ix0:ax1 - ix0] = tile[src + ax0 - gx0:src + ax1 - gx0]
    log(f"tiles: {p['count'] - cached} downloaded, {cached} from the cache")
    flat = array.array('f')
    for r in rows:
        flat.extend(r)
    lo, hi = min(flat), max(flat)
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    little = array.array('f', flat)
    if sys.byteorder == 'big':
        little.byteswap()
    (out / 'heights.f32').write_bytes(little.tobytes())
    span = (hi - lo) or 1.0
    grey = bytearray()
    for v in flat:
        grey += struct.pack('>H', int(round((v - lo) / span * 65535)))
    (out / 'heightmap.png').write_bytes(encode_png(W, H, 1, 16, bytes(grey)))
    la1, lo0 = px_to_latlon(ix0, iy1, z)
    la0, lo1 = px_to_latlon(ix1, iy0, z)
    meta = {'version': 1, 'bbox': {'south': la1, 'west': lo0, 'north': la0, 'east': lo1},
            'requested_bbox': {'south': bbox[0], 'west': bbox[1], 'north': bbox[2], 'east': bbox[3]},
            'zoom': z, 'tiles': p['count'], 'width': W, 'height': H, 'm_per_px': m_per_px, 'min_m': lo, 'max_m': hi,
            'source': 'Terrain Tiles (Terrarium), ' + TILE_URL, 'attribution': SHORT_ATTRIBUTION}
    (out / 'terrain.json').write_text(json.dumps(meta, indent=1) + '\n')
    return meta


def write_attribution(folder):
    f = pathlib.Path(folder) / 'ATTRIBUTION.txt'
    f.write_text(attribution_text(), encoding='utf-8')
    return f


def main(argv=None):
    ap = argparse.ArgumentParser(prog='terrain.py', description='A lat/lon box as a 3D shaded-relief render (free Terrain Tiles; the network is used only here).', allow_abbrev=False)
    ap.add_argument('--bbox')
    ap.add_argument('--zoom', type=int)
    ap.add_argument('--max-size', type=int, default=2048)
    ap.add_argument('--max-zoom', type=int, default=12)
    ap.add_argument('--max-tiles', type=int, default=36)
    ap.add_argument('--video')
    ap.add_argument('--out')
    ap.add_argument('--name', default='terrain')
    ap.add_argument('--data-only', action='store_true')
    ap.add_argument('--from-dir')
    a, rest = ap.parse_known_args(sys.argv[1:] if argv is None else argv)
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')      # the attribution has accents and a copyright sign
    except Exception:
        pass
    import blender_shot
    try:
        out = blender_shot.resolve_out(a.video, a.out)
        data = pathlib.Path(a.from_dir) if a.from_dir else out / f'{a.name}-data'
        if a.from_dir:
            real = pathlib.Path(os.path.realpath(data))
            chan = pathlib.Path(os.path.realpath(blender_shot.CHANNEL))
            if real != chan and chan not in real.parents:
                raise TerrainError(f'--from-dir {data.as_posix()} is outside the channel folder')
            if not (data / 'terrain.json').is_file() or not (data / 'heights.f32').is_file():
                raise TerrainError(f'{data.as_posix()} has no terrain.json and heights.f32 (terrain.py writes them)')
            meta = json.loads((data / 'terrain.json').read_text())
            print(f"using the saved data in {data.as_posix()} ({meta['width']}x{meta['height']} px, zoom {meta['zoom']}); no network")
        else:
            if not a.bbox:
                raise TerrainError('give the area: --bbox SOUTH,WEST,NORTH,EAST (decimal degrees), for example --bbox 27.6,85.9,28.3,87.0')
            bbox = parse_bbox(a.bbox)
            print(f'fetching elevation tiles from s3.amazonaws.com (the free Terrain Tiles, no key) into {(out / ".tiles").as_posix()}')
            meta = build(bbox, data, out / '.tiles', a.zoom, a.max_size, a.max_zoom, a.max_tiles)
            print(f"wrote {data.as_posix()}: {meta['width']}x{meta['height']} px, {meta['min_m']:.0f} to {meta['max_m']:.0f} m")
        att = write_attribution(out)
    except TerrainError as e:
        print(f'terrain: {e}', file=sys.stderr)
        return 1
    print(f'\nAttribution (saved in {att.as_posix()}; put it in the video description):\n')
    print(attribution_text())
    if a.data_only:
        return 0
    shot = ['shots/terrain.py', '--data', str(data), '--name', a.name]
    if a.video:
        shot += ['--video', a.video]
    if a.out:
        shot += ['--out', a.out]
    return blender_shot.main(shot + rest)


if __name__ == '__main__':
    sys.exit(main())
