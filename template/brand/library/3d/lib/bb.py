# bb.py: helpers for Blender shots in a channel folder (runs inside Blender: blender -b -P shot.py -- --out dir ...).
# The size is 1920x1080 at 30 fps by default (--vertical: 1080x1920, --size WxH, --fps, --frames, --samples); blender_shot.py sets them.
# Import it from a shot script:
#     import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib')); import bb
# It does the parts every shot repeats and that go wrong: brand colours in linear space (or everything looks washed out), a transparent
# render, a soft studio light rig, a camera that tracks a target, a contact shadow that works with a transparent background, easing,
# and the output (a still, or a numbered PNG sequence f_0001.png ...). Blender's Python has no PIL; use numpy if you need arrays.
import bpy, bmesh, math, os, sys, json, re, pathlib
from mathutils import Vector, Matrix

HERE = pathlib.Path(__file__).resolve().parent                      # .../brand/library/3d/lib
BRAND_JSON = HERE.parents[2] / 'brand.json'                         # .../brand/brand.json
ENGINE_FONTS = pathlib.Path.home() / '.claude/skills/bagelunit-reels/fonts'   # the Reel Kit engine's Anton, if it is installed


# ---- arguments ----------------------------------------------------------------------------------------------------------------------
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def opt(name, default=None, cast=str):
    """--name value from the command line after --, cast to the type of default if none is given."""
    if name in ARGV:
        v = ARGV[ARGV.index(name) + 1]
        return cast(v) if cast is not str or default is None else type(default)(v)
    return default


def opts(name):
    """Every value of a flag that may repeat: --label a --label b -> ['a', 'b']."""
    return [ARGV[i + 1] for i, a in enumerate(ARGV[:-1]) if a == name]


def flag(name):
    return name in ARGV


def frame_size(default=(1920, 1080)):
    """(width, height) from the command line: --size WxH (or one number N for a square) wins, then --vertical is 1080x1920, else 1920x1080."""
    v = opt('--size', None)
    if not v and flag('--vertical'):
        return 1080, 1920
    if v:
        m = re.fullmatch(r'(\d+)\s*[xX]\s*(\d+)', str(v).strip())
        if m:
            return int(m.group(1)), int(m.group(2))
        if str(v).strip().isdigit():
            return int(v), int(v)
        raise SystemExit(f'--size wants WIDTHxHEIGHT (for example 1920x1080), not "{v}"')
    return default


def aspect():
    w, h = frame_size()
    return w / h


def lens_for(base_lens):
    """A lens that keeps a shot framed the way it is in a square: wider than the square's on a landscape frame (the sensor spans the width)."""
    a = aspect()
    return base_lens / a if a > 1 else base_lens


def view_width_distance(width, lens):
    """How far a camera must stand to see `width` scene units across the frame (the 36 mm sensor spans the longer side of the frame)."""
    return width * lens / (36.0 * min(1.0, aspect()))


# ---- colour ---------------------------------------------------------------------------------------------------------------------------
def lin(c):
    return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92


def rgba(hexstr, a=1.0):
    """'#E23B2E' or 'E23B2E' -> linear (r, g, b, a). Blender wants linear: sRGB hexes straight in look washed out."""
    h = str(hexstr).lstrip('#')
    return (lin(int(h[0:2], 16) / 255), lin(int(h[2:4], 16) / 255), lin(int(h[4:6], 16) / 255), a)


def brand_colors():
    """The brand's own colours (brand/brand.json -> colors), else the kit's Print look. Hex strings without #."""
    d = {'paper': 'FBF5E6', 'ink': '15110E', 'accent': 'E23B2E'}
    try:
        c = json.loads(BRAND_JSON.read_text()).get('colors', {})
        for k, src in (('paper', 'background'), ('ink', 'ink'), ('accent', 'accent')):
            h = str(c.get(src) or '').lstrip('#')
            if re.fullmatch(r'[0-9A-Fa-f]{6}', h):
                d[k] = h.upper()
    except Exception:
        pass
    return d


# ---- scene ---------------------------------------------------------------------------------------------------------------------------
def setup(width=None, height=None, frames=None, fps=None, transparent=None, samples=None, world_strength=0.5, world_hex='C8CCD2'):
    """A clean empty scene with EEVEE. Size, frames, fps and samples come from the command line (frame_size, --frames, --fps, --samples)
    unless given. Transparent by default (an overlay); --opaque 1 fills the picture with --bg (default the brand's paper colour)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    fw, fh = frame_size()
    width, height = int(width or fw), int(height or fh)
    frames = int(frames or opt('--frames', 120, int))
    fps = int(fps or opt('--fps', 30, int))
    samples = int(samples or opt('--samples', 48, int))
    if transparent is None:
        transparent = not opt('--opaque', 0, int)
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    sc.render.engine = next(e for e in engines if e.startswith('BLENDER_EEVEE'))
    try:
        sc.eevee.taa_render_samples = samples
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = width, height, 100
    sc.render.film_transparent = bool(transparent)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    sc.frame_start, sc.frame_end, sc.render.fps = 1, frames, fps
    sc.view_settings.view_transform = 'Standard'                    # Filmic/AgX wash out brand colours
    if not transparent:
        world_hex, world_strength = opt('--bg', brand_colors()['paper']), 1.0   # the world is the picture's background
    w = bpy.data.worlds.new('world')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = rgba(world_hex)
    bg.inputs['Strength'].default_value = world_strength
    sc.world = w
    return sc


def collection_objects():
    return [o for o in bpy.context.scene.objects]


# ---- materials ------------------------------------------------------------------------------------------------------------------------
def mat(name, hexstr, rough=0.4, metal=0.0, emit=0.0, coat=0.0, alpha=1.0):
    """A Principled material in a brand hex. emit > 0 keeps the colour true under any light (good for UI and printed colour)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    c = rgba(hexstr)
    b.inputs['Base Color'].default_value = c
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = c
        b.inputs['Emission Strength'].default_value = emit
    if coat:
        try:
            b.inputs['Coat Weight'].default_value = coat
            b.inputs['Coat Roughness'].default_value = 0.1
        except Exception:
            pass
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
    return m


def mat_image(name, path, rough=0.5, emit=0.0, metal=0.0):
    """A material whose colour is an image (a label, a screen capture). emit 1.0 shows the picture at its own brightness."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.abspath(path))
    tex.image.colorspace_settings.name = 'sRGB'
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = emit
    return m


def solid_image(path, width, height, hexstr):
    """Write a flat colour PNG (a stand-in screen or label when none is given). Returns the path."""
    img = bpy.data.images.new(os.path.basename(path), width, height, alpha=True)
    c = rgba(hexstr)
    img.pixels[:] = [c[0], c[1], c[2], 1.0] * (width * height)
    img.filepath_raw = os.path.abspath(path)
    img.file_format = 'PNG'
    img.save()
    return path


# ---- objects --------------------------------------------------------------------------------------------------------------------------
def _smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True


def rounded_box(name, w, d, h, radius=0.2, material=None, loc=(0, 0, 0), segments=6):
    """A box w (x) by d (y) by h (z) with rounded edges. radius is capped to a third of the thinnest side."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, h)
    bpy.ops.object.transform_apply(scale=True)
    r = min(radius, min(w, d, h) / 3)
    bv = o.modifiers.new('bevel', 'BEVEL')
    bv.width, bv.segments, bv.limit_method = r, segments, 'NONE'
    bpy.ops.object.modifier_apply(modifier='bevel')
    _smooth(o)
    if material:
        o.data.materials.append(material)
    return o


def cylinder(name, radius, height, material=None, loc=(0, 0, 0), bevel=0.05, verts=64):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=height, vertices=verts, location=loc)
    o = bpy.context.active_object
    o.name = name
    if bevel:
        bv = o.modifiers.new('bevel', 'BEVEL')
        bv.width, bv.segments = bevel, 3
        bpy.ops.object.modifier_apply(modifier='bevel')
    _smooth(o)
    if material:
        o.data.materials.append(material)
    return o


def plane(name, w, h, material=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    """A flat w by h plane (faces +Z; rotate it to stand up: rot=(90deg,0,0) faces -Y, toward a camera at -Y)."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, h, 1)
    if material:
        o.data.materials.append(material)
    return o


def text3d(text, size=1.0, extrude=0.08, material=None, loc=(0, 0, 0), rot=(math.radians(90), 0, 0), font=None, align='CENTER', bevel=0.01):
    """3D text standing up, facing -Y (toward a camera at -Y). font: a .ttf path; default is the engine's Anton."""
    bpy.ops.object.text_add(location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = 'text_' + re.sub(r'\W+', '_', text)[:20]
    o.data.body = text
    o.data.size = size
    o.data.extrude = extrude
    o.data.bevel_depth = bevel
    o.data.align_x = align
    o.data.align_y = 'CENTER'
    f = font or str(ENGINE_FONTS / 'Anton-Regular.ttf')
    if os.path.exists(f):
        o.data.font = bpy.data.fonts.load(f)
    if material:
        o.data.materials.append(material)
    return o


def import_model(path, scale_to=None, loc=(0, 0, 0)):
    """Bring in a .glb/.gltf/.obj/.fbx/.blend-free model, centre it, optionally scale its longest side to scale_to. Returns the root empty.
    Only use models whose licence allows it (CC0 or your own) and record the source in brand/library/INDEX.md."""
    ext = pathlib.Path(path).suffix.lower()
    before = set(bpy.data.objects)
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=os.path.abspath(path))
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=os.path.abspath(path))
    else:
        raise SystemExit(f'import_model: {ext} is not supported (use .glb, .obj or .fbx)')
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new('model', None)
    bpy.context.scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == 'MESH' for c in o.bound_box]
    if pts:
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        mid = (lo + hi) / 2
        for o in new:
            if o.parent is root:
                o.location -= mid
        if scale_to:
            k = scale_to / max((hi - lo).x, (hi - lo).y, (hi - lo).z)
            root.scale = (k, k, k)
    root.location = loc
    return root


def blob_shadow(loc=(0, 0, 0), w=4.0, h=2.0, strength=0.55, name='shadow'):
    """A soft contact shadow that works on a transparent background: a black ellipse that fades to nothing at its edge."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, h, 1)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    gr = nt.nodes.new('ShaderNodeTexGradient')
    gr.gradient_type = 'SPHERICAL'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Location'].default_value = (-1, -1, 0)                   # a point is scaled first and then moved: uv * 2 - 1 is (uv - 0.5) * 2, centred
    mp.inputs['Scale'].default_value = (2, 2, 2)                        # the gradient reaches 0 at the middle of each edge of the plane
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'EASE'
    ramp.color_ramp.elements[0].position = 0.0                         # the gradient is 1 at the centre, 0 at the rim
    ramp.color_ramp.elements[0].color = (0, 0, 0, 0)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (0, 0, 0, strength)
    bs = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0, 0, 0, 1)
    mix = nt.nodes.new('ShaderNodeMixShader')
    inv = nt.nodes.new('ShaderNodeMath')
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
    nt.links.new(gr.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Alpha'], mix.inputs['Fac'])
    nt.links.new(bs.outputs['BSDF'], mix.inputs[1])
    nt.links.new(em.outputs['Emission'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    for attr, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    try:
        m.use_backface_culling = False
    except Exception:
        pass
    o.data.materials.append(m)
    return o


# ---- light and camera -----------------------------------------------------------------------------------------------------------------
def studio_lights(key=900, fill=350, rim=500, size=6.0, center=(0, 0, 0), warm=True):
    """A soft three-light rig around center: a big key from the front-left and above, a fill from the right, a rim from behind."""
    cx, cy, cz = center
    rig = []
    for name, loc, energy, tint in (('key', (-6, -8, 7), key, (1.0, 0.96, 0.9) if warm else (1, 1, 1)),
                                    ('fill', (8, -6, 2), fill, (0.9, 0.95, 1.0)),
                                    ('rim', (4, 7, 6), rim, (1, 1, 1))):
        bpy.ops.object.light_add(type='AREA', location=(cx + loc[0], cy + loc[1], cz + loc[2]))
        L = bpy.context.active_object
        L.name = name
        L.data.energy, L.data.size = energy, size
        L.data.color = tint
        t = L.constraints.new('TRACK_TO')
        t.target = target_empty(center, 'lightaim_' + name)
        t.track_axis, t.up_axis = 'TRACK_NEGATIVE_Z', 'UP_Y'
        rig.append(L)
    return rig


def target_empty(loc=(0, 0, 0), name='target'):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e


def camera(loc=(0, -14, 1.5), look_at=(0, 0, 0), lens=55, name='camera'):
    """A camera at loc that always looks at a target empty (returned as .target so a move can animate it).
    --shift X (a fraction of the frame width, for example 0.2) slides the subject off centre to leave room for text beside it."""
    bpy.ops.object.camera_add(location=loc)
    c = bpy.context.active_object
    c.name = name
    c.data.lens = lens
    c.data.shift_x = opt('--shift', 0.0, float)
    tgt = target_empty(look_at, 'camera_target')
    t = c.constraints.new('TRACK_TO')
    t.target, t.track_axis, t.up_axis = tgt, 'TRACK_NEGATIVE_Z', 'UP_Y'
    bpy.context.scene.camera = c
    return c, tgt


def smooth(t):
    """Ease in and out, 0..1 -> 0..1."""
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def key(obj, frame, **props):
    """Set properties (location=(x,y,z), rotation_euler=(...), scale=(...)) on obj and keyframe them at frame."""
    for k, v in props.items():
        setattr(obj, k, v)
        obj.keyframe_insert(k, frame=frame)


def orbit(cam, center=(0, 0, 0), radius=14.0, height=1.5, start_deg=-100, end_deg=-80, frames=None, ease=True):
    """Move the camera on an arc around center from start_deg to end_deg (degrees; -90 is straight in front, looking along +Y)."""
    n = frames or bpy.context.scene.frame_end
    for f in range(1, n + 1):
        t = (f - 1) / max(1, n - 1)
        a = math.radians(start_deg + (end_deg - start_deg) * (smooth(t) if ease else t))
        key(cam, f, location=(center[0] + radius * math.cos(a), center[1] + radius * math.sin(a), center[2] + height))


def push_in(cam, start, end, frames=None, ease=True):
    """Dolly the camera from the start location to the end location."""
    n = frames or bpy.context.scene.frame_end
    for f in range(1, n + 1):
        t = (f - 1) / max(1, n - 1)
        t = smooth(t) if ease else t
        key(cam, f, location=tuple(start[i] + (end[i] - start[i]) * t for i in range(3)))


# ---- terrain: a shaded-relief map from elevation data (terrain.py fetches it; shots/terrain.py uses this) ------------------------
RAMPS = {                                                            # colour stops from the lowest to the highest ground (hex)
    'earth': ['2F5D50', '7A9E5B', 'C9B77A', '9A8672', 'F2F0EA'],
    'mono': ['1B1B1F', '6E6E75', 'E8E6DF'],
    'snow': ['3C5A73', '8FA9BD', 'DDE6EE', 'FFFFFF'],
    'heat': ['440154', '3B528B', '21908C', '5DC863', 'FDE725'],
}


def load_terrain(data_dir):
    """Reads what terrain.py wrote: terrain.json (bbox, size, metres per pixel, attribution) and heights.f32 (metres, north row first).
    Returns (meta, heights) with heights a numpy array of shape (rows, cols)."""
    import numpy as np
    d = pathlib.Path(data_dir)
    meta = json.loads((d / 'terrain.json').read_text())
    h = np.fromfile(str(d / 'heights.f32'), dtype='<f4')
    if h.size != meta['width'] * meta['height']:
        raise SystemExit(f"terrain: heights.f32 has {h.size} values but terrain.json says {meta['width']}x{meta['height']}")
    return meta, h.reshape(meta['height'], meta['width']).astype('float64')


def _resample(a, ny, nx):
    import numpy as np
    ys, xs = np.linspace(0, a.shape[0] - 1, ny), np.linspace(0, a.shape[1] - 1, nx)
    tmp = np.array([np.interp(xs, np.arange(a.shape[1]), row) for row in a])
    return np.array([np.interp(ys, np.arange(a.shape[0]), tmp[:, i]) for i in range(nx)]).T


def ramp_colors(t, stops):
    """t: numpy array 0..1 -> (n, 4) linear rgba along the colour stops (hex strings, lowest first)."""
    import numpy as np
    rgb = np.array([[int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)] for h in stops])
    xs = np.linspace(0, 1, len(stops))
    out = np.stack([np.interp(np.clip(t, 0, 1).ravel(), xs, rgb[:, c]) for c in range(3)], axis=1)
    lin_ = np.where(out > 0.04045, ((out + 0.055) / 1.055) ** 2.4, out / 12.92)
    return np.concatenate([lin_, np.ones((lin_.shape[0], 1))], axis=1)


def hillshade(h, cell_m, azimuth=315.0, elevation=38.0, exaggeration=1.0):
    """Classic hillshade of a height grid (metres, north row first, cell_m metres per cell): 1.0 on flat ground, darker facing away from the sun."""
    import numpy as np
    dzdy_south, dzdx = np.gradient(h * exaggeration, cell_m)          # np.gradient of rows runs southward
    nx_, ny_, nz_ = -dzdx, dzdy_south, np.ones_like(h)                # surface normal (x east, y north)
    n = np.sqrt(nx_ ** 2 + ny_ ** 2 + nz_ ** 2)
    az, el = math.radians(azimuth), math.radians(elevation)
    sun = (math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))
    return np.clip((nx_ * sun[0] + ny_ * sun[1] + nz_ * sun[2]) / n / math.sin(el), 0.0, 1.3)


def terrain_height_at(terrain, lat, lon):
    """Scene height (z) of the terrain at a latitude and longitude, bilinear; None if the point is outside the map."""
    b = terrain['meta']['bbox']
    fx = (lon - b['west']) / (b['east'] - b['west'])
    fy = (b['north'] - lat) / (b['north'] - b['south'])
    if not (0 <= fx <= 1 and 0 <= fy <= 1):
        return None
    g = terrain['grid']
    x, y = fx * (g.shape[1] - 1), fy * (g.shape[0] - 1)
    x0, y0 = int(min(x, g.shape[1] - 2)), int(min(y, g.shape[0] - 2))
    tx, ty = x - x0, y - y0
    z = (g[y0, x0] * (1 - tx) + g[y0, x0 + 1] * tx) * (1 - ty) + (g[y0 + 1, x0] * (1 - tx) + g[y0 + 1, x0 + 1] * tx) * ty
    return float(z)


def terrain_shaded_relief(data_dir, width=12.0, exaggeration=1.5, ramp='earth', hillshade_strength=0.35, azimuth=315.0, elevation=38.0,
                          sea_level=None, water_hex='3E6E8E', grid=384, block=True, block_depth=0.7, name='terrain'):
    """Builds a displaced, vertex-coloured surface from terrain.py's output (a folder with terrain.json and heights.f32), lit by the
    scene's lights. The longer side is `width` scene units; heights use the same scale times `exaggeration` (1.0 is true to the ground).
    ramp: 'earth', 'mono', 'snow', 'heat' or a comma-separated list of hexes. hillshade_strength 0..1 bakes slope shading into the colour
    (so relief reads even in flat light). sea_level: metres; ground below it is flattened and coloured water_hex. block: a solid base
    under the map, like a diorama. Returns a dict: object, meta, grid (scene heights), size (x, y), zmax, scale (scene units per metre)."""
    import numpy as np
    meta, h = load_terrain(data_dir)
    rows, cols = h.shape
    longer_px = max(rows, cols)
    k = min(1.0, grid / longer_px)
    ny, nx = max(2, int(round(rows * k))), max(2, int(round(cols * k)))
    g = _resample(h, ny, nx) if (ny, nx) != (rows, cols) else h.copy()
    water = None
    if sea_level is not None:
        water = g <= sea_level
        g = np.where(water, sea_level, g)
    lo, hi = float(g.min()), float(g.max())
    span = max(hi - lo, 1.0)
    ground_x = meta['m_per_px'] * (cols - 1)
    ground_y = meta['m_per_px'] * (rows - 1)
    longer_m = max(ground_x, ground_y)
    scale = width / longer_m                                                   # scene units per metre
    sx, sy = ground_x * scale, ground_y * scale
    z = (g - lo) * scale * exaggeration
    cell_m = ground_x / max(1, nx - 1)
    t = (g - lo) / span
    stops = RAMPS.get(ramp) or [c.strip() for c in str(ramp).split(',') if c.strip()]
    if len(stops) < 2:
        raise SystemExit(f'terrain: --ramp wants earth, mono, snow, heat or a list of hex colours (it is "{ramp}")')
    col = ramp_colors(t, stops)
    if hillshade_strength:
        shade = hillshade(g, cell_m, azimuth, elevation, exaggeration)
        col[:, :3] *= (1 - hillshade_strength + hillshade_strength * shade).reshape(-1, 1)
    if water is not None:
        wc = np.array(rgba(water_hex))
        col[water.ravel()] = wc
    # the top surface
    xs = (np.arange(nx) / (nx - 1) - 0.5) * sx
    ys = (0.5 - np.arange(ny) / (ny - 1)) * sy                                   # row 0 is north, +y
    X, Y = np.meshgrid(xs, ys)
    verts = np.stack([X.ravel(), Y.ravel(), z.ravel()], axis=1)
    idx = np.arange(ny * nx).reshape(ny, nx)
    # (x, y) -> row, col; winding counter-clockwise seen from above
    faces = np.stack([idx[1:, :-1].ravel(), idx[1:, 1:].ravel(), idx[:-1, 1:].ravel(), idx[:-1, :-1].ravel()], axis=1)
    colors = col
    if block:
        top = [(0, i) for i in range(nx)] + [(j, nx - 1) for j in range(1, ny)] + [(ny - 1, i) for i in range(nx - 2, -1, -1)] + [(j, 0) for j in range(ny - 2, 0, -1)]
        # the perimeter as seen from above runs clockwise here (north edge first, west to east), so the side quads are wound to face outward
        n0 = len(verts)
        top_v = np.array([verts[j * nx + i] for j, i in top])
        bot_v = top_v.copy()
        bot_v[:, 2] = -block_depth
        verts = np.concatenate([verts, top_v, bot_v])
        side_c = np.array([col[j * nx + i] for j, i in top])
        dark = side_c.copy()
        dark[:, :3] *= 0.5
        colors = np.concatenate([col, side_c, dark])
        m = len(top)
        quads = [(n0 + k_, n0 + (k_ + 1) % m, n0 + m + (k_ + 1) % m, n0 + m + k_) for k_ in range(m)]
        faces_list = [tuple(f) for f in faces.tolist()] + quads + [tuple(n0 + m + k_ for k_ in range(m))]
    else:
        faces_list = [tuple(f) for f in faces.tolist()]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts.tolist(), [], faces_list)
    mesh.update()
    ca = mesh.color_attributes.new(name='relief', type='FLOAT_COLOR', domain='POINT')
    ca.data.foreach_set('color', colors.astype('float32').ravel())
    mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'relief'
    b = nt.nodes['Principled BSDF']
    nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    try:
        b.inputs['Specular IOR Level'].default_value = 0.1
    except Exception:
        pass
    mesh.materials.append(m)
    return {'object': obj, 'meta': meta, 'grid': z, 'size': (sx, sy), 'zmax': float(z.max()), 'scale': scale}


def sun(azimuth=315.0, elevation=38.0, strength=2.6, angle=6.0, name='sun'):
    """A soft sun (angle degrees of blur on its shadows). azimuth is the compass direction the light comes FROM (315 = north-west), as on a map."""
    bpy.ops.object.light_add(type='SUN')
    L = bpy.context.active_object
    L.name = name
    L.data.energy, L.data.angle = strength, math.radians(angle)
    az, el = math.radians(azimuth), math.radians(elevation)
    to_sun = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))      # x east, y north
    L.rotation_euler = to_sun.to_track_quat('Z', 'Y').to_euler()                                      # a sun shines along its -Z
    return L


def map_label(text, loc, size=0.5, box_hex=None, text_hex=None, pin=0.9, font=None):
    """A pin with a text box on top of it at loc, always turned to the camera. Returns the group empty (parent of the parts)."""
    col = brand_colors()
    box_hex, text_hex = box_hex or col['ink'], text_hex or col['paper']
    g = bpy.data.objects.new('label_' + re.sub(r'\W+', '_', text)[:16], None)
    bpy.context.scene.collection.objects.link(g)
    g.location = loc
    stick = cylinder('pin', size * 0.04, pin, mat('pin', box_hex, rough=0.5), loc=(loc[0], loc[1], loc[2] + pin / 2), bevel=0)
    txt = text3d(text, size=size, extrude=0.02, material=mat('labeltext', text_hex, rough=0.5, emit=0.6), loc=(loc[0], loc[1] - size * 0.28, loc[2] + pin + size * 0.7), font=font, bevel=0.0)
    w = max(size * 0.6 * len(text) * 0.62 + size * 0.7, size * 1.6)
    box = rounded_box('labelbox', w, size * 0.15, size * 1.3, size * 0.12, mat('labelbox', box_hex, rough=0.45, emit=0.15), loc=(loc[0], loc[1], loc[2] + pin + size * 0.7))
    for o in (stick, txt, box):
        o.parent = g
        o.matrix_parent_inverse = Matrix.Translation(-Vector(loc))     # the parts were made at their final places: keep them there
    return g


def face_camera(group, cam):
    """Keep a label group turned to the camera (its -Y side), upright."""
    t = group.constraints.new('TRACK_TO')
    t.target, t.track_axis, t.up_axis = cam, 'TRACK_NEGATIVE_Y', 'UP_Z'


# ---- output ---------------------------------------------------------------------------------------------------------------------------
def render(out_dir, still=None, name='f_'):
    """still=N renders frame N to out_dir/still.png; otherwise the whole range to out_dir/f_0001.png ... (RGBA PNGs)."""
    sc = bpy.context.scene
    os.makedirs(out_dir, exist_ok=True)
    if still:
        sc.frame_set(int(still))
        sc.render.filepath = os.path.join(out_dir, 'still.png')
        bpy.ops.render.render(write_still=True)
        print('STILL', sc.render.filepath)
    else:
        sc.render.filepath = os.path.join(out_dir, name)
        bpy.ops.render.render(animation=True)
        print('FRAMES', out_dir, sc.frame_end)
