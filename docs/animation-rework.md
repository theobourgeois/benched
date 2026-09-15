# Hockey animation rework

The Mixamo Ch01 FBX has a valid skin and skeleton, but its animation takes contain one frame and an empty take. Gameplay now uses editable hockey motion tracks with calibrated limb constraints. These are authored control trajectories evaluated in code, not motion capture or imported skeletal clips.

## Changes

- `hockeyMotion.ts`: cubic motion tracks for forward push, recovery and contact; separate shot release and check commitment curves; body weight transfer, shot types and intentional hand release during special dekes.
- `skaterPose.ts`: revised stance and torso balance, backward C-cuts, crossover recovery, blade orientation during sideways stops, and half-kneeling get-up targets. Shoulder support blends with the hand release weight.
- `animationMath.ts` / `skaterModel.ts`: two-bone IK calibrated against the actual rest axes; reachable endpoints, elbow/knee bend limits, singularity handling, bounded wrist deviation and forearm twist. Palm position is resolved after the wrist adjustment.
- `stick.ts`: fixed shaft length; top-hand socket constrained by both maximum reach and minimum elbow clearance. Bottom hand slides along the shaft within reach.
- `Player.tsx`: continuous free-arm/re-grip blending, release follow-through, and a supported stage between a physics fall and standing. Goalies hold the stick near the paddle with one hand while the catching hand tracks saves.
- `hockeyEquipment.ts`: fitted articulated glove pieces, skate holders/runners, goalie leg pads, a blocker and a rounded catching mitt. Goal pads rotate around the shins to keep their broad face forward during a butterfly. The original body and clothing remain.
- Simulation records shot style, duration, release socket positions, charged-shot downswing state and goalie save direction/height. Replay samples these details without starting a new action before its recorded event. Goalies anticipate approaching shots, then use the recorded save to hold and recover their low or high save pose.

The existing Rapier ragdoll bodies, collision response, impact impulses and recorded fall playback remain in use. Gameplay movement, shot trajectories and hit-power tuning are unchanged. Quick shots, backhands and one-timers release immediately. An already charged slap shot commits to a 75 ms downswing before puck release, so the blade reaches contact without snapping out of the windup. A hit, lost possession or a deke cancels the pending shot. Pause and hitstop freeze this timing with the simulation.

## Stick handling (2026-09-15)

A replay review showed the hands bunched at the top of the shaft, the top hand riding up to the chin with the stick nearly vertical, a winged top elbow, a glove cuff floating off the wrist, and the pose popping between a high and a low solution.

- `stick.ts`: skaters carry `public/models/hockey-stick.glb` (CC BY-NC, see CREDITS). `stickModel` converts it once at load: mirrored so the curve faces the forehand, blade lengthened 1.6× to read on camera, shaft section widened, shaft rebent to a 48° lie. Goalies keep the procedural paddle stick; the hidden procedural shaft still carries the axis for the ragdoll.
- `placeStick` treats a spec with `lie` as rigid: the blade lies flat on the ice unless the top hand would be out of reach or inside the belly, and then rocks onto its heel or toe about the end still on the ice. Only reach and a plane in front of the belly bound that roll, so the valid rolls form one interval and the hands move continuously; a unit test sweeps the blade across the body and fails on any jump. A raised blade (windup, follow-through, deke lift) follows the hands instead.
- `skaterModel.ts`: Ch01's arms are lengthened 15%. `skaterPose.ts`: with both hands on the stick the skater sits a little lower, hunches more and dips the bottom-hand shoulder. Hand spread is 0.34. The top-hand target hangs off the top shoulder, crossing in front of the belt toward the backhand; the top elbow hangs down and back. `hockeyEquipment.ts`: the glove cuff rides the forearm.
- When the shaft passes out of the bottom arm's reach (the puck at the skates, as in a toe drag) the bottom hand comes off the stick instead of floating beside it.
- Known limit: with the puck pulled in close and near the middle (reach under about 0.8) a rigid stick has to stand up, so the top hand rises to about shoulder height and can sit a few centimetres off the shaft where it gets closer to the shoulder than the arm can fold. Letting the top hand swing around the puck fixed that pose but snapped between sides of the body as the blade crossed, so it was dropped.

## Review

With `npm run dev` running:

```sh
node scripts/animation-review.mjs
node scripts/pose-shots.mjs stand push2 dekeR windup shot check goalie
OUT=artifacts/ragdoll-review REPLAY=1 node scripts/ragdoll-shots.mjs open
```

The motion review writes a video, screenshots, measurements and sampled skeleton poses under `artifacts/animation-review`. Optional positional arguments select clips, for example `node scripts/animation-review.mjs handling slap-shot`.

Grip measurements use the palm center's distance to the shaft axis. A released hand is intentionally away from the shaft during checks and through-the-legs moves, and the goalie's catching hand remains free; it should not be assessed as a grip error. The review is a visual/geometry check, not a substitute for controller playtesting.

To generate an editable Blender inspection project:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/bake-animation-review.py
```

Open `artifacts/animation-review/hockey-motion-review.blend`. Timeline markers name the movements. It contains the original character with baked bone animation, a camera and lights; runtime equipment is not exported. Edits in this review project do not automatically update the game. The baker uses Blender's [bone pose-space conversion API](https://docs.blender.org/api/current/bpy.types.Bone.html#bpy.types.Bone.convert_local_to_pose) to preserve the parent/child transforms.

## Validation and limits

- Production build succeeds.
- The 16 browser integration tests pass, including keyboard/controller actions, pause and replay.
- New unit coverage checks limb lengths for degenerate/unreachable targets, joint limits, fixed stick/socket geometry, stride contact and continuity, action metadata, charged-shot contact/cancellation through the real simulation loop, goalie shot anticipation, and replay event boundaries.
- One pre-existing unit test expects carving to shed speed while `PHYSICS.carveBleed` is currently zero. The same failure was reproduced from an untouched `HEAD` checkout. This rework does not change that tuning.
- The review harness samples actions from fixed cameras. It does not establish a frame-rate guarantee across devices.

The original clothing, skin weights and absence of twist bones still limit close-up quality. The equipment is a lightweight fitted approximation. A production hockey mesh and a professionally authored or captured movement library would raise the visual ceiling. Goalies now have ready, butterfly and high-glove reactions with recovery. These are compact procedural movements; they do not cover every specialized save, desperation dive or rebound transition.
