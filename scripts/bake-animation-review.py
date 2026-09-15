"""Blender review project from the live game's measured poses (not a runtime dependency).

Run animation-review.mjs first, then:
  Blender --background --factory-startup --python scripts/bake-animation-review.py
The saved project contains editable bone keys and named timeline sections.
"""
import bpy
import json
import math
import re
from pathlib import Path
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts' / 'animation-review'
clips = json.loads((OUT / 'poses.json').read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=str(ROOT / 'public/models/skater.fbx'))
armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
armature.animation_data_clear()
# FBX character uses Y-up. The review project uses Blender's Z-up coordinates.
axis = Matrix.Rotation(math.pi / 2, 4, 'X')
scale = clips[0].get('modelScale', 0.011337989131665636)
armature.rotation_euler = (math.pi / 2, 0, 0)
armature.scale = (scale,) * 3
bpy.context.view_layer.update()
inverse = armature.matrix_world.inverted()
canonical = lambda name: re.sub(r'^mixamorig\d*[:_]?', '', name)
by_name = {canonical(b.name): b for b in armature.pose.bones}
for bone in armature.pose.bones:
    bone.rotation_mode = 'QUATERNION'
scene = bpy.context.scene
scene.render.fps = 30
frame = 1
for clip in clips:
    scene.timeline_markers.new(clip['name'], frame=frame)
    for sample in clip['samples']:
        at = frame + round(sample['time'] * 30)
        # Parent bones precede their children in the exported pose.
        matrices = {}
        for value in sample['bones'].values():
            bone = by_name.get(canonical(value['name']))
            if not bone:
                continue
            x, y, z, w = value['quaternion']
            matrix = Quaternion((w, x, y, z)).to_matrix().to_4x4()
            matrix.translation = Vector(value['position'])
            # World matrices need the same uniform scale as the armature to preserve limb lengths.
            matrix = axis @ matrix @ Matrix.Diagonal((scale, scale, scale, 1))
            target = inverse @ matrix
            matrices[bone.name] = target
            if bone.parent:
                parent_matrix = matrices.get(bone.parent.name, bone.parent.matrix)
                basis = bone.bone.convert_local_to_pose(target, bone.bone.matrix_local,
                    parent_matrix=parent_matrix, parent_matrix_local=bone.parent.bone.matrix_local, invert=True)
            else:
                basis = bone.bone.convert_local_to_pose(target, bone.bone.matrix_local, invert=True)
            bone.matrix_basis = basis
            bone.keyframe_insert('location', frame=at)
            bone.keyframe_insert('rotation_quaternion', frame=at)
            bone.keyframe_insert('scale', frame=at)
    frame += math.ceil(clip['duration'] * 30) + 10
scene.frame_start = 1
scene.frame_end = frame
scene.frame_set(1)
armature.animation_data.action.name = 'Hockey motion review — baked from game'
armature.show_in_front = True
bpy.context.view_layer.objects.active = armature
armature.select_set(True)
# Give the project a usable review camera, floor and lighting.
bpy.ops.mesh.primitive_plane_add(size=12)
floor = bpy.context.object
floor.name = 'Review ice'
floor.location.z = 0
mat = bpy.data.materials.new('Ice')
mat.diffuse_color = (0.56, 0.7, 0.76, 1)
floor.data.materials.append(mat)
bpy.ops.object.camera_add(location=(3.4, -4.8, 2.5))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 0.95)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 55
scene.camera = camera
for location, energy, size in [((2, -3, 5), 1000, 5), ((-3, -1, 3), 600, 4), ((1, 3, 4), 900, 3)]:
    bpy.ops.object.light_add(type='AREA', location=location)
    light = bpy.context.object
    light.data.energy = energy
    light.data.shape = 'DISK'
    light.data.size = size
    light.rotation_euler = (Vector((0, 0, 1)) - light.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.world.color = (0.2, 0.2, 0.2)
note = bpy.data.texts.new('READ ME')
note.write('Baked review of the in-game motion layer. Timeline markers identify each movement.\n'
           'The game uses editable tracks in src/scene/hockeyMotion.ts plus calibrated IK.\n'
           'This project is an inspection/editing reference; changes here do not automatically update the game.\n'
           'Helmet, gloves and skate runners are fitted in the game and are not included in this FBX review.\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'hockey-motion-review.blend'))
print('SAVED_REVIEW', OUT / 'hockey-motion-review.blend')
