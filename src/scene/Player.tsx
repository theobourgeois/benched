import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { runtime, viewMatch, viewTimeScale } from '../game/store';
import { uniformFor } from '../game/clubs';
import { isOnIce } from '../game/engine';
import { activeDeke } from '../game/dekes';
import type { MatchState, Skater } from '../game/types';
import {
  HELMET_GOALIE_URL,
  HELMET_PLAYER_URL,
  SKATER_URL,
  createSkaterRig,
  curlFingers,
  holdStick,
  reachLimb,
  poseBone,
} from './skaterModel';
import { GET_UP, fallenAmount, poseSkater } from './skaterPose';
import { reviewSkaters } from './animationReview';
import {
  POSE_SIZE,
  SkaterPhysics,
  applyPose,
  capturePose,
  createRagdoll,
  driveRagdoll,
  leashRagdoll,
  mixPose,
  physicsReady,
  replayPose,
  showPose,
  stepPhysics,
} from './ragdoll';
import { SvgTextureLoader } from './textures';
import {
  GOALIE_BLADE,
  SKATER_BLADE,
  STICK_MATERIALS,
  bladeGeometries,
  knobGeometry,
  paddleGeometry,
  placeStick,
  shaftGeometry,
  type StickParts,
} from './stick';

useLoader.preload(FBXLoader, SKATER_URL);
useLoader.preload(GLTFLoader, HELMET_PLAYER_URL);
useLoader.preload(GLTFLoader, HELMET_GOALIE_URL);

/** Player root sits at y=0.03; ice surface is ~0.012. Sink the rocker a hair so it reads as planted. */
const BLADE_ICE_Y = -0.028;
/** How far down the shaft from the top hand the bottom hand likes to sit, in world units. */
/** The bottom hand slides up the shaft rather than leave it when the arm cannot reach that far. */
const BOTTOM_HAND_MIN = 0.14;
/** Forward speed along facing before the bottom hand comes off for a pumping stride. */
const ONE_HAND_FORWARD = 4.5;
/** Rearward speed along facing that counts as backskating. */
const ONE_HAND_BACK = -2;
/** Residual whole-body roll on a deke; most of the lean comes from the hips and torso. */
const DEKE_ROLL = 0.25;
/** Only the jump deke leaves the ice; other dekes hop the puck while the skater just unweights. */
const DEKE_HOP = 0;

const topShoulder = new THREE.Vector3(),
  lowShoulder = new THREE.Vector3(),
  grip = new THREE.Vector3(),
  tip = new THREE.Vector3(),
  hosel = new THREE.Vector3(),
  along = new THREE.Vector3(),
  alongWorld = new THREE.Vector3(),
  lowHand = new THREE.Vector3(),
  reach = new THREE.Vector3(),
  offset = new THREE.Vector3(),
  point = new THREE.Vector3(),
  pole = new THREE.Vector3(),
  hips = new THREE.Vector3(),
  frameQ = new THREE.Quaternion();

/** Largest distance down the shaft from the top hand, up to `want`, that a shoulder can reach. */
function reachableDown(
  shoulder: THREE.Vector3,
  top: THREE.Vector3,
  down: THREE.Vector3,
  radius: number,
  want: number,
) {
  reach.subVectors(top, shoulder);
  const t = reach.dot(down);
  const disc = t * t - reach.lengthSq() + radius * radius;
  if (disc < 0) return THREE.MathUtils.clamp(t, BOTTOM_HAND_MIN, want);
  const far = t + Math.sqrt(disc);
  return THREE.MathUtils.clamp(far, BOTTOM_HAND_MIN, want);
}

export const Player = memo(function Player({ id }: { id: number }) {
  const template = useLoader(FBXLoader, SKATER_URL);
  const playerHelmet = useLoader(GLTFLoader, HELMET_PLAYER_URL);
  const goalieHelmet = useLoader(GLTFLoader, HELMET_GOALIE_URL);
  const group = useRef<THREE.Group>(null),
    fall = useRef<THREE.Group>(null),
    ring = useRef<THREE.Mesh>(null),
    shadow = useRef<THREE.Mesh>(null);
  const stick = useRef<THREE.Group>(null),
    shaft = useRef<THREE.Mesh>(null),
    knob = useRef<THREE.Mesh>(null),
    paddle = useRef<THREE.Mesh>(null);
  const p = runtime.match.skaters[id],
    goalie = p.role === 'G';
  const uniform = uniformFor(runtime.match.teams[p.team], runtime.match.jerseys[p.team]);
  const crest = useLoader(SvgTextureLoader, uniform.crest);
  const helmet = goalie ? goalieHelmet.scene : playerHelmet.scene;
  const rig = useMemo(() => {
    crest.colorSpace = THREE.SRGBColorSpace;
    crest.anisotropy = 8;
    return createSkaterRig(template, helmet, uniform, p.number, crest, goalie);
  }, [template, helmet, uniform, p.number, crest, goalie]);
  useEffect(() => () => rig.dispose(), [rig]);
  const physics = useMemo(() => new SkaterPhysics(), []);
  // A new rig starts from its bind pose, so a ragdoll built on the old one no longer fits it.
  useEffect(() => () => physics.release(), [physics, rig]);
  useEffect(
    () => () => {
      physics.dispose();
      reviewSkaters.delete(id);
      showPose(id, null);
    },
    [physics, id],
  );
  const poses = useMemo(
    () => ({
      doll: new Float32Array(POSE_SIZE),
      stand: new Float32Array(POSE_SIZE),
      drawn: new Float32Array(POSE_SIZE),
    }),
    [],
  );
  const blade = goalie ? GOALIE_BLADE : SKATER_BLADE,
    bladeParts = bladeGeometries(blade);
  const heading = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const gripPose = useMemo(
    () => [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()],
    [],
  );

  /** The procedural skater: skating pose, stick and hands. */
  function drawSkater(
    s: MatchState,
    skater: Skater,
    dt: number,
    root: THREE.Group,
    tilt: THREE.Group,
    parts: StickParts,
    recoveryProgress = 1,
  ) {
    const along_ = skater.vx * Math.sin(skater.angle) + skater.vz * Math.cos(skater.angle);
    const dekeMove = activeDeke(skater);
    const canRelease =
      !goalie &&
      s.puck.owner !== id &&
      skater.liftTimer <= 0 &&
      skater.blockTimer <= 0 &&
      !dekeMove &&
      skater.shotTimer <= 0;
    let freeHand = canRelease
      ? Math.max(
          THREE.MathUtils.smoothstep(along_, ONE_HAND_FORWARD, ONE_HAND_FORWARD + 2.5),
          THREE.MathUtils.smoothstep(-along_, -ONE_HAND_BACK, -ONE_HAND_BACK + 2),
        )
      : 0;
    const twoHand = 1 - freeHand;
    // The body frame must be current before the pose plants skates and hands in world space.
    const fallen = fallenAmount(skater);
    const ease = 1 - Math.exp(-dt * 14);
    const hop = (dekeMove?.hop ?? 0) * (skater.dekeKind === 'jump' ? 1 : DEKE_HOP);
    root.position.set(skater.x, 0.03 + hop, skater.z);
    root.rotation.y = fallen > 0.4 ? skater.fallAngle : skater.angle;
    // A knockdown lies at a bit over 70°; a belly-flop block slides nearly flat on the ice.
    const diving = skater.diveTimer > 0 && skater.downTimer <= 0;
    tilt.rotation.x = THREE.MathUtils.lerp(tilt.rotation.x, fallen * (diving ? 1.42 : 1.28), ease);
    tilt.rotation.z = THREE.MathUtils.lerp(
      tilt.rotation.z,
      (dekeMove?.lean ?? 0) * DEKE_ROLL,
      ease,
    );
    tilt.position.y = THREE.MathUtils.lerp(tilt.position.y, fallen * (diving ? 0.1 : 0.22), ease);
    root.updateMatrixWorld(true);
    const { bones } = rig;
    const charge = s.controlled === id ? s.shotCharge : 0;
    // The ragdoll runs on replay time, so a knockdown tumbles slowly in slow motion.
    const posture = poseSkater(
      rig,
      skater,
      dt * viewTimeScale(),
      goalie,
      twoHand,
      charge,
      tilt,
      recoveryProgress,
    );
    const { stickBlend, pelvis, swing, action } = posture;
    const support = 1 - THREE.MathUtils.smoothstep(recoveryProgress, 0.25, 0.7);
    freeHand = Math.max(freeHand, action.releaseHand, support);
    // Release clips start at the recorded puck contact and return to the current carrying pose.
    const release =
      skater.shotTimer > 0
        ? THREE.MathUtils.smoothstep(skater.shotTimer / (skater.shotDuration ?? 0.34), 0, 0.55)
        : 0;
    const side = THREE.MathUtils.lerp(
      skater.stickSide,
      skater.shotSide ?? skater.stickSide,
      release,
    );
    const reach_ = THREE.MathUtils.lerp(
      skater.stickReach,
      skater.shotReach ?? skater.stickReach,
      release,
    );
    tip.set(
      THREE.MathUtils.lerp(0.52, side + action.bladeSide, stickBlend),
      BLADE_ICE_Y + action.bladeLift * stickBlend + (dekeMove?.lift ?? 0),
      THREE.MathUtils.lerp(0.2, reach_ + action.bladeReach, stickBlend),
    );
    tilt.worldToLocal(bones.upperArmR.getWorldPosition(topShoulder));
    tilt.worldToLocal(bones.upperArmL.getWorldPosition(lowShoulder));
    // The knob is carried ahead of the belt, with an elbow hanging below the shoulder.
    // Fixed stick length then resolves the final socket before either arm is solved.
    grip
      .copy(pelvis)
      .add(
        offset.set(
          -0.21 + side * 0.13,
          0.14 + action.handLift + freeHand * swing * 0.025,
          0.39 + action.check * 0.08,
        ),
      );
    grip.lerp(offset.set(-0.12, 0.08, -0.45), 1 - stickBlend);
    placeStick(parts, blade, grip, tip, heading, hosel, topShoulder, rig.armReach - 0.065);
    if (stickBlend > 0.4) {
      tilt.getWorldQuaternion(frameQ);
      along.subVectors(grip, hosel).normalize();
      alongWorld.copy(along).applyQuaternion(frameQ);
      holdStick(
        rig,
        'R',
        tilt.localToWorld(point.copy(grip)),
        alongWorld,
        tilt.localToWorld(pole.copy(topShoulder).add(offset.set(-0.22, -0.48, -0.1))),
        1,
      );
      {
        const down = reachableDown(
          lowShoulder,
          grip,
          along,
          rig.armReach * 0.94,
          action.handSpread,
        );
        lowHand.copy(grip).addScaledVector(along, -down);
        holdStick(
          rig,
          'L',
          tilt.localToWorld(point.copy(lowHand)),
          alongWorld,
          tilt.localToWorld(pole.copy(lowShoulder).add(offset.set(0.26, -0.4, 0.02))),
          1,
        );
      }
      if (freeHand > 0) {
        const armNames = ['upperArmL', 'forearmL', 'handL'] as const;
        armNames.forEach((name, i) => gripPose[i].copy(bones[name].quaternion));
        // Blend the whole arm, including the wrist, through the release and re-grip.

        reachLimb(
          rig,
          'arm',
          'L',
          tilt.localToWorld(
            point
              .copy(lowShoulder)
              .add(
                offset.set(
                  0.06 - 0.1 * Math.max(0, swing),
                  -0.43 + 0.08 * swing,
                  0.09 + 0.22 * swing,
                ),
              ),
          ),
          tilt.localToWorld(pole.copy(lowShoulder).add(offset.set(0.22, -0.35, -0.18))),
        );
        if (support > 0) {
          reachLimb(
            rig,
            'arm',
            'L',
            tilt.localToWorld(point.set(0.32, 0.065, 0.3)),
            tilt.localToWorld(pole.set(0.5, 0.4, 0.05)),
          );
        }
        poseBone(rig, 'handL', 0.06 + support * 0.65, 0, 0);
        armNames.forEach((name, i) => bones[name].quaternion.slerp(gripPose[i], 1 - freeHand));
        curlFingers(rig, 'L', 1 - freeHand * 0.55);
      }
    } else {
      curlFingers(rig, 'L', 0.3);
      curlFingers(rig, 'R', 0.3);
    }
  }

  useFrame((state, dt) => {
    const s = viewMatch(),
      skater = s.skaters[id];
    const root = group.current,
      tilt = fall.current;
    if (!root || !tilt) return;
    const replay = runtime.replay;
    const live = !replay && s.phase !== 'paused' && s.hitstop <= 0;
    stepPhysics(state.clock.elapsedTime, dt, live);
    const parts: StickParts = {
      root: stick.current!,
      shaft: shaft.current!,
      knob: knob.current!,
      paddle: paddle.current,
    };
    if (!replay && skater.downTimer <= 0 && physics.doll) {
      physics.release();
      showPose(id, null);
    }
    if (!isOnIce(s, skater)) {
      root.visible = false;
      if (!replay) physics.follow(skater.x, skater.z, goalie, false);
      return;
    }
    root.visible = true;
    if (!replay) physics.follow(skater.x, skater.z, goalie, skater.downTimer <= 0);

    if (import.meta.env.DEV) reviewSkaters.set(id, { rig, stick: parts });

    // A full knockdown is a physics ragdoll; replays show the recorded fall.
    let ragdoll = false;
    if (replay) ragdoll = replayPose(replay.frames, replay.time, id, poses.drawn);
    else if (skater.downTimer > 0 && physicsReady()) {
      if (!physics.doll) {
        // First frame down: the bones still hold the pose the hit landed on, one step behind.
        root.position.set(skater.x, root.position.y, skater.z);
        root.updateMatrixWorld(true);
        physics.doll = createRagdoll(rig, parts, blade, skater);
      }
      ragdoll = physics.doll !== null;
      if (physics.doll && live)
        leashRagdoll(physics.doll, skater.x, skater.z, skater.vx, skater.vz, dt);
    }
    if (ragdoll) {
      root.position.set(skater.x, 0.03, skater.z);
      root.rotation.y = skater.angle;
      tilt.rotation.set(0, 0, 0);
      tilt.position.set(0, 0, 0);
      root.updateMatrixWorld(true);
      if (!replay) {
        driveRagdoll(physics.doll!, rig, parts, blade);
        if (skater.downTimer < GET_UP) {
          // Gather into a supported half-kneel, then push off the planted front skate.
          capturePose(rig, parts, poses.doll);
          const progress = 1 - skater.downTimer / GET_UP;
          drawSkater(s, { ...skater, downTimer: 0 }, dt, root, tilt, parts, progress);
          capturePose(rig, parts, poses.stand);
          const t = THREE.MathUtils.smoothstep(progress, 0, 0.42);
          mixPose(poses.doll, poses.stand, t, poses.drawn);
        } else capturePose(rig, parts, poses.drawn);
        showPose(id, poses.drawn);
      }
      applyPose(rig, parts, blade, poses.drawn);
      curlFingers(rig, 'L', 0.3);
      curlFingers(rig, 'R', 0.3);
      // Shadow and marker follow the body, not the simulated position.
      root.worldToLocal(rig.bones.pelvis.getWorldPosition(hips));
      shadow.current!.position.set(hips.x, 0.012, hips.z);
      ring.current!.position.set(hips.x, 0.016, hips.z);
    } else {
      drawSkater(s, skater, dt, root, tilt, parts);
      shadow.current!.position.set(0, 0.012, 0);
      ring.current!.position.set(0, 0.016, 0);
    }
    ring.current!.visible =
      !runtime.replay && (s.controlled === id || (s.passHeld && s.passTarget === id));
    const marker = ring.current!.material;
    if (marker instanceof THREE.MeshBasicMaterial)
      marker.color.set(s.controlled === id ? '#e84a4a' : '#d5fa64');
  });
  return (
    <group ref={group}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]}>
        <ringGeometry args={[0.73, 0.81, 48]} />
        <meshBasicMaterial color="#e84a4a" transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh
        ref={shadow}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        scale={[0.8, 1, 1]}
      >
        <circleGeometry args={[0.65, 32]} />
        <meshBasicMaterial color="#10293d" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <group ref={fall}>
        <primitive object={rig.root} />
        <group ref={stick}>
          <mesh geometry={bladeParts.blade} material={STICK_MATERIALS.blade} castShadow />
          <mesh geometry={bladeParts.tape} material={STICK_MATERIALS.tape} />
          <mesh ref={shaft} geometry={shaftGeometry} material={STICK_MATERIALS.shaft} castShadow />
          <mesh ref={knob} geometry={knobGeometry} material={STICK_MATERIALS.tape} />
          {goalie && (
            <mesh
              ref={paddle}
              geometry={paddleGeometry}
              material={STICK_MATERIALS.shaft}
              castShadow
            />
          )}
        </group>
      </group>
    </group>
  );
});
