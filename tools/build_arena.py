"""
ORBOUND — Blender scene builder + renderer.
Builds a stylized 3D battle arena (floating island terrain in the game's
bold/vibrant palette) and renders a hero promo shot. Runs headless via
`blender --background --python this_script.py`.

Style target: bold, saturated, slightly toy-like/papercraft — matching the
flat vector 2D character art (Super Paper Mario adjacent). Uses flat/toon-ish
shading via emission-boosted principled BSDF rather than realistic PBR, so it
reads as "vibrant game art" rather than a photoreal render.
"""
import bpy
import math
import random
from mathutils import Vector

# ------------------------------------------------------------------
# Cleanup default scene
# ------------------------------------------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.meshes) + list(bpy.data.materials) + list(bpy.data.lights) + list(bpy.data.cameras):
    try:
        block.user_clear()
        bpy.data.batch_remove(ids=[block])
    except Exception:
        pass

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 128
scene.cycles.use_denoising = True
try:
    scene.cycles.device = 'GPU'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'CUDA'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
except Exception as e:
    print('GPU setup skipped:', e)

scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'


def make_flat_material(name, color, emission_strength=0.15, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    # Push saturation harder than the input color to counter Cycles' tendency
    # to wash out flat colors under soft area lighting — boost value/sat directly.
    import colorsys
    r, g, b = color
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    s = min(1.0, s * 1.35 + 0.15)
    v = min(1.0, v * 1.1 + 0.05)
    r2, g2, b2 = colorsys.hsv_to_rgb(h, s, v)
    bsdf.inputs['Base Color'].default_value = (r2, g2, b2, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = 0.15
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (r2, g2, b2, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat


# ------------------------------------------------------------------
# Floating island terrain — sculpted low-poly-ish mound
# ------------------------------------------------------------------
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=6, location=(0, 0, -3))
island = bpy.context.active_object
island.name = 'FloatingIsland'

# Squash into a disc-ish landmass and add noise-based bumps for a hilly top
island.scale = (1.6, 1.6, 0.55)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.object.mode_set(mode='OBJECT')

mod = island.modifiers.new('IslandNoise', 'DISPLACE')
tex = bpy.data.textures.new('IslandNoiseTex', type='CLOUDS')
tex.noise_scale = 1.4
mod.texture = tex
mod.strength = 1.1
mod.mid_level = 0.5

bpy.ops.object.shade_smooth()

# Cut the underside into a jagged rocky point (typical "floating island" look)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.mode_set(mode='OBJECT')
taper = island.modifiers.new('Taper', 'SIMPLE_DEFORM')
taper.deform_method = 'TAPER'
taper.factor = -0.9
taper.deform_axis = 'Z'

grass_mat = make_flat_material('GrassTop', (0.20, 0.72, 0.33), emission_strength=0.25)
dirt_mat = make_flat_material('DirtBottom', (0.42, 0.29, 0.18), emission_strength=0.08, roughness=0.8)
island.data.materials.append(grass_mat)
island.data.materials.append(dirt_mat)

# Assign grass to top faces (normal pointing mostly up), dirt to the rest
bpy.context.view_layer.objects.active = island
bpy.ops.object.mode_set(mode='EDIT')
import bmesh
bm = bmesh.from_edit_mesh(island.data)
bm.faces.ensure_lookup_table()
for f in bm.faces:
    if f.normal.z > 0.45:
        f.material_index = 0
    else:
        f.material_index = 1
bmesh.update_edit_mesh(island.data)
bpy.ops.object.mode_set(mode='OBJECT')


# ------------------------------------------------------------------
# Two toy-like mobile silhouettes on the island (simplified stand-ins
# representing Bastion-style tank and Skyfin-style flyer, matching the
# 2D roster's silhouette language) facing each other across the arena.
# ------------------------------------------------------------------
def build_tank_mobile(name, location, color, facing=1):
    body = bpy.data.objects.new(name, None)
    body.location = location
    bpy.context.collection.objects.link(body)

    bpy.ops.mesh.primitive_cube_add(size=1.6, location=(location[0], location[1], location[2] + 0.5))
    hull = bpy.context.active_object
    hull.name = f'{name}_hull'
    hull.scale = (1.3, 0.9, 0.6)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.modifier_add(type='BEVEL')
    hull.modifiers['Bevel'].width = 0.08
    hull.modifiers['Bevel'].segments = 3
    hull_mat = make_flat_material(f'{name}_mat', color, emission_strength=0.3)
    hull.data.materials.append(hull_mat)
    hull.parent = body
    hull.matrix_parent_inverse = body.matrix_world.inverted()

    bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=1.6,
        location=(location[0] + facing * 0.9, location[1], location[2] + 0.55),
        rotation=(0, math.radians(90), 0))
    barrel = bpy.context.active_object
    barrel.name = f'{name}_barrel'
    barrel_mat = make_flat_material(f'{name}_barrel_mat', (0.15, 0.15, 0.18), emission_strength=0.1)
    barrel.data.materials.append(barrel_mat)
    barrel.parent = body
    barrel.matrix_parent_inverse = body.matrix_world.inverted()

    for side in (-1, 1):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.45, minor_radius=0.16,
            location=(location[0], location[1] + side * 0.75, location[2] + 0.15),
            rotation=(math.radians(90), 0, 0))
        wheel = bpy.context.active_object
        wheel.name = f'{name}_wheel_{side}'
        wheel_mat = make_flat_material(f'{name}_wheel_mat_{side}', (0.1, 0.1, 0.12), emission_strength=0.05)
        wheel.data.materials.append(wheel_mat)
        wheel.parent = body
        wheel.matrix_parent_inverse = body.matrix_world.inverted()

    return body


build_tank_mobile('Bastion', (-2.2, -0.8, 1.55), (0.75, 0.28, 0.28), facing=1)
build_tank_mobile('Ricochet', (2.2, 0.8, 1.55), (0.75, 0.78, 0.85), facing=-1)

# Snap both mobiles onto the actual terrain surface via raycast (avoids
# guessing a z-height that either floats above or clips into the mesh).
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
island_eval = island.evaluated_get(depsgraph)

def snap_to_terrain(obj, xy):
    origin = Vector((xy[0], xy[1], 20.0))
    direction = Vector((0, 0, -1))
    result, loc, normal, face_idx = island_eval.ray_cast(
        island_eval.matrix_world.inverted() @ origin,
        island_eval.matrix_world.inverted().to_3x3() @ direction,
    )
    if result:
        world_loc = island_eval.matrix_world @ loc
        obj.location = (xy[0], xy[1], world_loc.z + 0.15)
    else:
        print(f'WARNING: raycast miss for {obj.name}, leaving at fallback height')

for ob in (bpy.data.objects.get('Bastion'), bpy.data.objects.get('Ricochet')):
    if ob:
        snap_to_terrain(ob, (ob.location.x, ob.location.y))


# ------------------------------------------------------------------
# Sky, lighting, camera
# ------------------------------------------------------------------
world = bpy.data.worlds.new('OrboundSky')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.30, 0.65, 0.88, 1.0)
bg.inputs['Strength'].default_value = 0.55

bpy.ops.object.light_add(type='SUN', location=(6, -6, 12))
sun = bpy.context.active_object
sun.data.energy = 6.5
sun.data.angle = math.radians(3)
sun.rotation_euler = (math.radians(45), 0, math.radians(35))

bpy.ops.object.light_add(type='AREA', location=(-6, 4, 6))
fill = bpy.context.active_object
fill.data.energy = 450
fill.data.size = 6
fill.data.color = (0.55, 0.75, 1.0)

bpy.ops.object.light_add(type='AREA', location=(0, -8, 3))
rim = bpy.context.active_object
rim.data.energy = 200
rim.data.size = 4
rim.data.color = (1.0, 0.95, 0.85)

bpy.ops.object.camera_add(location=(9, -13, 8), rotation=(math.radians(68), 0, math.radians(35)))
cam = bpy.context.active_object
cam.data.lens = 32
scene.camera = cam

# Aim camera roughly at the island center
direction = Vector((0, 0, 0.8)) - cam.location
rot_quat = direction.to_track_quat('-Z', 'Y')
cam.rotation_euler = rot_quat.to_euler()

# ------------------------------------------------------------------
# Render
# ------------------------------------------------------------------
scene.render.filepath = '/home/rjl/orbound/assets/3d/arena_hero_shot.png'
bpy.ops.render.render(write_still=True)
print('RENDER COMPLETE:', scene.render.filepath)

bpy.ops.wm.save_as_mainfile(filepath='/home/rjl/orbound/assets/3d/orbound_arena.blend')
print('SAVED BLEND FILE')
