# A shaded-relief map: terrain.py's elevation data as a 3D surface under a soft sun, with optional labels, orbited or pushed in on.
#   python3 terrain.py --bbox SOUTH,WEST,NORTH,EAST --video <name> [--still 30 | --clip map.mov | --mp4 map.mp4] [options below]
#   (terrain.py fetches the data, then runs this shot; to run it by hand: python3 blender_shot.py shots/terrain.py --video <name> --data <data folder> ...)
#   --data DIR            a folder written by terrain.py (terrain.json and heights.f32)
#   --move orbit|push|still   how the camera moves (default orbit)    --tilt 42   camera elevation in degrees     --sweep 40   orbit angle in degrees
#   --ramp earth|mono|snow|heat|#hex,#hex,...   colours from low to high ground    --hillshade 0.35   baked slope shading 0..1
#   --sun-azimuth 315 --sun-elevation 38   where the sun is (compass degrees, degrees above the horizon)
#   --exaggeration 1.5    height scale (1 is true to the ground)    --sea-level 0   metres: lower ground becomes flat water (--water 3E6E8E)
#   --label "Name@lat,lon" (repeat for more)   --label-size 0.5    --no-block 1   no solid base under the map    --zoom-out 1.0   frame wider
# Transparent by default (an overlay); --opaque 1 with --bg HEX gives a solid background. The data attribution is written next to the data
# by terrain.py (ATTRIBUTION.txt): put it in the video description.
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
import bb

DATA = bb.opt('--data', None)
if not DATA:
    raise SystemExit('shots/terrain.py needs --data <folder with terrain.json and heights.f32> (python3 terrain.py makes it)')
MOVE = bb.opt('--move', 'orbit')
TILT = math.radians(bb.opt('--tilt', 42.0, float))
SWEEP = bb.opt('--sweep', 40.0, float)
AZ, EL = bb.opt('--sun-azimuth', 315.0, float), bb.opt('--sun-elevation', 38.0, float)
WIDTH = 12.0
sc = bb.setup(world_strength=0.9)
N = sc.frame_end
T = bb.terrain_shaded_relief(DATA, width=WIDTH, exaggeration=bb.opt('--exaggeration', 1.5, float), ramp=bb.opt('--ramp', 'earth'),
                             hillshade_strength=bb.opt('--hillshade', 0.35, float), azimuth=AZ, elevation=EL,
                             sea_level=bb.opt('--sea-level', None, float), water_hex=bb.opt('--water', '3E6E8E'), block=not bb.opt('--no-block', 0, int))
sx, sy = T['size']
bb.sun(AZ, EL)
LENS = 35.0
a = bb.aspect()
half = math.radians(SWEEP / 2) if MOVE == 'orbit' else 0.0                          # an orbit turns the map under the view: allow for its corners
ex, ey = sx * math.cos(half) + sy * math.sin(half), sy * math.cos(half) + sx * math.sin(half)
need_w = ex * 1.12 * bb.opt('--zoom-out', 1.0, float)
d_w = bb.view_width_distance(need_w, LENS)                                          # to see the whole width
span_h = (ey * math.sin(TILT) + (T['zmax'] + 0.7) * math.cos(TILT)) * 1.15 * bb.opt('--zoom-out', 1.0, float)   # the height the view must cover, seen from the tilt
d_h = bb.view_width_distance(span_h * a, LENS)                                      # the same, for the height
D = max(d_w, d_h)
center = (0, 0, T['zmax'] * 0.35)
def cam_at(deg):
    r = math.radians(deg)
    return (center[0] + D * math.cos(TILT) * math.cos(r), center[1] + D * math.cos(TILT) * math.sin(r), center[2] + D * math.sin(TILT))
cam, tgt = bb.camera(cam_at(-90), center, lens=LENS)
if MOVE == 'orbit':
    for f in range(1, N + 1):
        t = (f - 1) / max(1, N - 1)
        bb.key(cam, f, location=cam_at(-90 - SWEEP / 2 + SWEEP * bb.smooth(t)))
elif MOVE == 'push':
    for f in range(1, N + 1):
        t = bb.smooth((f - 1) / max(1, N - 1)); k = 1.25 - 0.25 * t
        r = math.radians(-90)
        bb.key(cam, f, location=(center[0] + D * k * math.cos(TILT) * math.cos(r), center[1] + D * k * math.cos(TILT) * math.sin(r), center[2] + D * k * math.sin(TILT)))
LS = bb.opt('--label-size', 0.5, float)
for spec in bb.opts('--label'):
    if '@' not in spec:
        raise SystemExit(f'--label wants "Name@lat,lon" (for example "Cairo@30.04,31.24"), not "{spec}"')
    name, _, pos = spec.rpartition('@')
    lat, lon = (float(v) for v in pos.split(','))
    z = bb.terrain_height_at(T, lat, lon)
    if z is None:
        print(f'LABEL skipped: {name} is outside the map')
        continue
    x = ((lon - T['meta']['bbox']['west']) / (T['meta']['bbox']['east'] - T['meta']['bbox']['west']) - 0.5) * sx
    y = (0.5 - (T['meta']['bbox']['north'] - lat) / (T['meta']['bbox']['north'] - T['meta']['bbox']['south'])) * sy
    g = bb.map_label(name, (x, y, z), size=LS)
    bb.face_camera(g, cam)
bb.render(bb.opt('--out', 'out/terrain'), bb.opt('--still', None, int))
