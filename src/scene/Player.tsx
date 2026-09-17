import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { runtime, seatHuman, viewMatch, viewTimeScale } from '../app/store';
import { humanOn } from '../game/humans';
import { uniformFor } from '../game/clubs';
import { STICK } from '../game/config';
import { isOnIce } from '../game/engine';
import { activeDeke } from '../game/dekes';
import { activeCelly, cellyRagdoll } from '../game/cellys';
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
  setWorldQuaternion,
} from './skaterModel';
import { GET_UP, fallenAmount, poseSkater } from './skaterPose';
import { labHooks, labPose, reviewSkaters } from './animationReview';
import { createGoalieAction, sampleGoalieAction, shotWindup } from './hockeyMotion';
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
  STICK_URL,
  stickModel,
  type StickParts,
} from './stick';

useLoader.preload(GLTFLoader, SKATER_URL);
useLoader.preload(GLTFLoader, STICK_URL);
useLoader.preload(GLTFLoader, HELMET_PLAYER_URL);
useLoader.preload(GLTFLoader, HELMET_GOALIE_URL);

/** Player root sits at y=0.03; ice surface is ~0.012. Sink the rocker a hair so it reads as planted. */
const BLADE_ICE_Y = -0.028;
/** How far down the shaft from the top hand the bottom hand likes to sit, in world units. */
/** The bottom hand slides up the shaft rather than leave it when the arm cannot reach that far. */
const BOTTOM_HAND_MIN = 0.11;
const REACH_SOFT = 0.08;
/** Forward speed along facing before the bottom hand comes off for a pumping stride. */
const ONE_HAND_FORWARD = 4.5;
/** Rearward speed along facing that counts as backskating. */
const ONE_HAND_BACK = -2;
/** Edge lean is articulated above the planted skates; rolling their parent sinks a blade. */
const DEKE_ROLL = 0;
/** Only the jump deke leaves the ice; other dekes hop the puck while the skater just unweights. */
const DEKE_HOP = 0;
/** The skater faces +z in their own frame. */
const FRONT = new THREE.Vector3(0, 0, 1);
/**
 * Which way each elbow bends, in the skater's frame: out, back and a little down. Fitted to every
 * lab clip so the shoulder-to-hand line never comes within 15° (top) or 50° (bottom) of it.
 */
const TOP_ELBOW = new THREE.Vector3(-0.76, -0.34, -0.55).normalize(),
  LOW_ELBOW = new THREE.Vector3(0.58, -0.66, -0.47).normalize(),
  /**
   * Reaching across for the backhand, the upper arm swings in front of the chest and the elbow drops,
   * rather than folding back through the body.
   */
  TOP_ELBOW_ACROSS = new THREE.Vector3(-0.2, -0.9, 0.4).normalize(),
  /**
   * With the top hand drawn in near the shoulder the arm folds; an elbow out and back then puts
   * the forearm in line with the shaft, like holding a cane. It comes out and forward instead, so
   * the forearm crosses the shaft. (Bending square to the shaft itself was tried: it fixes each
   * fold but the direction flips as the shaft crosses the arm, which costs more than it saves.)
   */
  TOP_ELBOW_FOLD = new THREE.Vector3(-0.62, 0, 0.78).normalize();

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
  spineUp = new THREE.Vector3(),
  frameQ = new THREE.Quaternion(),
  gripWrist = new THREE.Vector3(),
  gripHandQ = new THREE.Quaternion(),
  freeHandQ = new THREE.Quaternion(),
  coverQ = new THREE.Quaternion(),
  palmDown = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);

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
  // Where the reach sphere first touches the shaft the root is vertical, which slid the hand
  // several centimetres in a frame. Below REACH_SOFT² it turns linear with the same slope, so the
  // slide stays gradual and the hand stays within reach, at most REACH_SOFT / 2 short of the sphere.
  const soft = REACH_SOFT * REACH_SOFT;
  const root =
    disc >= soft ? Math.sqrt(disc) - REACH_SOFT / 2 : Math.max(disc, -soft) / (2 * REACH_SOFT);
  return THREE.MathUtils.clamp(t + root, BOTTOM_HAND_MIN, want);
}

const armDir = new THREE.Vector3(),
  bendAway = new THREE.Vector3(),
  topBend = new THREE.Vector3();
/**
 * An elbow pole off the middle of the arm, square to the shoulder-to-hand line. The elbow can only
 * flip sides when the arm lines up with `bend`, so `bend` is a direction the hands never reach
 * toward; a pole at a fixed spot beside the shoulder let the hand swing onto it. `prev` carries the
 * last frame's bend direction: near the degenerate line it holds the plane, and the pole can never
 * flip sides between frames.
 */
function elbowPole(
  shoulder: THREE.Vector3,
  hand: THREE.Vector3,
  bend: THREE.Vector3,
  out: THREE.Vector3,
  prev?: THREE.Vector3,
  dt = 1 / 60,
) {
  armDir.subVectors(hand, shoulder);
  const length = armDir.length();
  if (length < 1e-6) return out.copy(shoulder).add(bend);
  armDir.divideScalar(length);
  bendAway.copy(bend).addScaledVector(armDir, -bend.dot(armDir));
  if (bendAway.lengthSq() < 1e-6) {
    if (prev) bendAway.copy(prev).addScaledVector(armDir, -prev.dot(armDir));
    if (bendAway.lengthSq() < 1e-6) bendAway.set(0, -1, 0).addScaledVector(armDir, armDir.y);
  }
  bendAway.normalize();
  if (prev) {
    // Transport the previous bend plane onto this arm direction, then turn it toward the
    // anatomical pole. A sign decision alone can flip an elbow by half a metre in one frame.
    prev.addScaledVector(armDir, -prev.dot(armDir));
    if (prev.lengthSq() > 1e-6) {
      prev.normalize();
      if (bendAway.dot(prev) < 0) bendAway.negate();
      bendAway.lerp(prev, Math.exp(-Math.min(dt, 0.1) * 24)).normalize();
    }
    prev.copy(bendAway);
  }
  return out
    .copy(shoulder)
    .addScaledVector(armDir, length / 2)
    .addScaledVector(bendAway.normalize(), 0.3);
}

/** Ring colours: the skater you hold, the one the other seat holds, and a pass target. */
const MARKER_YOURS = new THREE.Color('#e84a4a'),
  MARKER_THEIRS = new THREE.Color('#4aa8e8'),
  MARKER_TARGET = new THREE.Color('#d5fa64');
export const Player = memo(function Player({ id }: { id: number }) {
  const template = useLoader(GLTFLoader, SKATER_URL).scene;
  const playerHelmet = useLoader(GLTFLoader, HELMET_PLAYER_URL);
  const goalieHelmet = useLoader(GLTFLoader, HELMET_GOALIE_URL);
  const stickSource = useLoader(GLTFLoader, STICK_URL);
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
  const blade = goalie ? GOALIE_BLADE : SKATER_BLADE;
  // Goalies keep the procedural paddle stick; skaters carry the modelled one.
  const bladeParts = goalie ? bladeGeometries(blade) : null,
    stickMesh = goalie ? null : stickModel(stickSource.scene);
  const heading = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const goalieAction = useMemo(createGoalieAction, []);
  // Last frame's elbow bend directions, so the IK pole plane can never flip between frames.
  const polePrev = useMemo(
    () => ({ top: new THREE.Vector3(0, -1, 0), low: new THREE.Vector3(0, -1, 0) }),
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
    const cellyMove = activeCelly(skater);
    const chopper = skater.cellyKind === 'helicopter' && cellyMove;
    const canRelease =
      !goalie &&
      s.puck.owner !== id &&
      skater.liftTimer <= 0 &&
      skater.blockTimer <= 0 &&
      !dekeMove &&
      !cellyMove &&
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
    const hop =
      (dekeMove?.hop ?? 0) * (skater.dekeKind === 'jump' ? 1 : DEKE_HOP) + (cellyMove?.hop ?? 0);
    root.position.set(skater.x, 0.03 + hop, skater.z);
    root.rotation.y = fallen > 0.4 ? skater.fallAngle : skater.angle;
    // A knockdown lies at a bit over 70°; the dive flop is nearly flat before the ragdoll takes over.
    const diving = skater.diveTimer > 0 && skater.downTimer <= 0;
    tilt.rotation.x = THREE.MathUtils.lerp(
      tilt.rotation.x,
      fallen * (diving ? 1.42 : 1.28) + (cellyMove?.pitch ?? 0),
      ease,
    );
    tilt.rotation.z = THREE.MathUtils.lerp(
      tilt.rotation.z,
      (dekeMove?.lean ?? 0) * DEKE_ROLL + (cellyMove?.lean ?? 0) * 0.45,
      ease,
    );
    tilt.position.y = THREE.MathUtils.lerp(tilt.position.y, fallen * (diving ? 0.1 : 0.22), ease);
    root.updateMatrixWorld(true);
    const { bones } = rig;
    const charge = shotWindup(skater, humanOn(s, skater)?.shotCharge ?? 0);
    if (goalie) sampleGoalieAction(skater, s.puck, goalieAction, dt * viewTimeScale());
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
      goalie ? goalieAction : undefined,
    );
    const { stickBlend, pelvis, swing, lean, action } = posture;
    const support = 1 - THREE.MathUtils.smoothstep(recoveryProgress, 0.25, 0.7);
    freeHand = Math.max(
      freeHand,
      action.releaseHand,
      support,
      cellyMove?.releaseHand ?? 0,
      goalie ? 1 : 0,
    );
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
    if (goalie) {
      // The paddle sits where the simulation keeps the puck; a blocker save takes it up with the hand.
      tip.set(skater.stickSide + goalieAction.side * 0.08, BLADE_ICE_Y, skater.stickReach);
      // The paddle stays down and angles out under the raised blocker rather than standing up.
      tip.lerp(offset.set(goalieAction.blockerX - 0.45, BLADE_ICE_Y, 0.42), goalieAction.blocker);
    }
    if (chopper) {
      const spin = cellyMove.rotor;
      tip.set(Math.cos(spin) * 1.22, 1.58, Math.sin(spin) * 1.22);
    }
    tilt.worldToLocal(bones.upperArmR.getWorldPosition(topShoulder));
    tilt.worldToLocal(bones.upperArmL.getWorldPosition(lowShoulder));
    // The knob is carried ahead of the belt, with an elbow hanging below the shoulder.
    // Fixed stick length then resolves the final socket before either arm is solved.
    // The top hand rides the right hip on the forehand. Toward the backhand, or reaching wide, it
    // crosses in front of the belt so the shaft passes in front of the body rather than through it.
    // It hangs off the top shoulder, so it follows the torso through a deke's lean.
    const cross = Math.abs(side - STICK.restSide) * (side > STICK.restSide ? 0.13 : 0.2);
    // With the puck pulled in close (toe drag, pull-in) the hands cannot stay behind it at the
    // belt: the long rigid stick would stand up and lift the top hand to the chin. They go out to
    // the side away from the puck and forward, level with it, so the shaft lies across the body
    // and the arms reach rather than fold. A one-handed wrap keeps its own socket.
    const wrap =
      skater.dekeKind === 'throughLegs' || skater.dekeKind === 'windmill' ? action.releaseHand : 0;
    const closeCarry =
      (1 - THREE.MathUtils.smoothstep(reach_, 0.25, 0.95)) *
      (1 - THREE.MathUtils.smoothstep(action.bladeLift, 0, 0.3)) *
      (1 - wrap);
    const puckSide = THREE.MathUtils.clamp((tip.x - topShoulder.x) / 0.3, -1, 1);
    grip
      .copy(topShoulder)
      .add(
        offset.set(
          0.085 + cross - closeCarry * 0.32 * puckSide,
          -0.29 + action.handLift + freeHand * swing * 0.025 - closeCarry * 0.06,
          0.125 + cross * 0.4 + action.check * 0.08 + action.handForward + closeCarry * 0.38,
        ),
      );
    if (skater.dekeKind === 'throughLegs' || skater.dekeKind === 'windmill') {
      // The top arm reaches around the hip during a one-handed wrap. Keeping its usual belt
      // socket forced the long shaft to flip upright as the blade came back through the feet.
      grip.x = THREE.MathUtils.lerp(grip.x, Math.min(grip.x, tip.x - 0.6), action.releaseHand);
      grip.z += action.releaseHand * 0.12;
    }
    if (goalie)
      grip
        .copy(pelvis)
        .add(offset.set(-0.22, -0.02, 0.34))
        .lerp(offset.set(goalieAction.blockerX, goalieAction.blockerY, 0.3), goalieAction.blocker);
    grip.lerp(offset.set(-0.12, 0.08, -0.45), 1 - stickBlend);
    if (chopper) {
      const overhead = topShoulder.y + 0.46;
      grip.set(-0.08, overhead, 0.15);
      tip.y = overhead + 0.14;
    }
    placeStick(
      parts,
      chopper ? { ...blade, lie: undefined } : blade,
      grip,
      tip,
      heading,
      hosel,
      chopper
        ? undefined
        : {
            shoulder: topShoulder,
            armReach: rig.armReach - 0.065,
            // A blade lifted for a windup or follow-through follows the hands; on the ice it lies flat.
            handsLead: THREE.MathUtils.smoothstep(tip.y - BLADE_ICE_Y, 0, 0.5),
            // Crouched low, the belt drops under the flat stick's top hand and the arms fold up to
            // the chin; the stick rocks a little onto its heel instead so the hands stay at the belt.
            restRoll: THREE.MathUtils.smoothstep(1.24 - topShoulder.y, 0, 0.26) * 0.16,
            torso: {
              at: pelvis,
              front: FRONT,
              up: tilt.worldToLocal(bones.neck.getWorldPosition(spineUp)).sub(pelvis).normalize(),
            },
          },
    );
    if (stickBlend > 0.4) {
      // How far the top hand has crossed in front of the chest (backhand, protect).
      const across = THREE.MathUtils.smoothstep(grip.x - topShoulder.x, 0.15, 0.45);
      tilt.getWorldQuaternion(frameQ);
      along.subVectors(grip, hosel).normalize();
      alongWorld.copy(along).applyQuaternion(frameQ);
      holdStick(
        rig,
        'R',
        tilt.localToWorld(point.copy(grip)),
        alongWorld,
        // The top elbow hangs down and back rather than winging out to the side, and comes round in
        // front of the chest as the hand crosses the body.
        tilt.localToWorld(
          elbowPole(
            topShoulder,
            grip,
            topBend
              .lerpVectors(TOP_ELBOW, TOP_ELBOW_ACROSS, across)
              .lerp(
                TOP_ELBOW_FOLD,
                (1 - across) *
                  THREE.MathUtils.smoothstep(
                    1 - grip.distanceTo(topShoulder) / rig.armReach,
                    0.3,
                    0.55,
                  ),
              )
              .normalize(),
            pole,
            polePrev.top,
            dt,
          ),
        ),
        1,
        // The paddle hangs almost along the forearm; the blocker hides the hand anyway.
        goalie ? 1.1 : undefined,
      );
      if (!goalie) {
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
          tilt.localToWorld(elbowPole(lowShoulder, lowHand, LOW_ELBOW, pole, polePrev.low, dt)),
          1,
        );
        // Only when the shaft passes well out of the bottom arm's reach, even with the hands
        // together, does that hand come off the stick rather than float beside it. Letting go
        // any earlier turned every toe drag one-handed, which read as the hand slipping off.
        // armReach runs shoulder to wrist; the palm on the shaft reaches about a hand past that.
        const gap = lowHand.distanceTo(lowShoulder) - rig.armReach - 0.06;
        freeHand = Math.max(freeHand, THREE.MathUtils.smoothstep(gap, 0, 0.22));
      }
      if (freeHand > 0) {
        // Blend the wrist target before IK. Blending independently solved bone rotations can
        // switch quaternion hemispheres and throw the elbow across the body during re-grips.
        tilt.worldToLocal(bones.handL.getWorldPosition(gripWrist));
        bones.handL.getWorldQuaternion(gripHandQ);

        reachLimb(
          rig,
          'arm',
          'L',
          tilt.localToWorld(
            point
              .copy(lowShoulder)
              .add(
                offset.set(
                  0.06 -
                    0.1 * Math.max(0, swing) +
                    // The free arm works as a counterweight: out against a lean, up on a one-hander.
                    lean * 0.28 +
                    action.releaseHand * 0.16,
                  -0.43 + 0.08 * swing + action.releaseHand * 0.18,
                  0.09 + 0.22 * swing,
                ),
              )
              .lerp(gripWrist, 1 - freeHand),
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
        if (goalie && support === 0) {
          // Ready with the mitt open; thrown to the committed point; or down over a frozen puck.
          point
            .copy(lowShoulder)
            .add(offset.set(0.13 + Math.max(0, goalieAction.side) * 0.1, -0.16, 0.32))
            .lerp(offset.set(goalieAction.gloveX, goalieAction.gloveY, 0.38), goalieAction.glove)
            .lerp(offset.set(0.24, 0.06, 0.55), goalieAction.cover);
          reachLimb(
            rig,
            'arm',
            'L',
            tilt.localToWorld(point),
            tilt.localToWorld(
              pole.copy(lowShoulder).add(offset.set(0.3, -0.28 + goalieAction.glove * 0.2, 0.1)),
            ),
          );
          // The mitt faces the shooter; over a frozen puck it turns palm down.
          setWorldQuaternion(
            bones.handL,
            coverQ
              .copy(frameQ)
              .multiply(palmDown.setFromAxisAngle(X_AXIS, (-Math.PI / 2) * goalieAction.cover)),
          );
        }
        bones.handL.getWorldQuaternion(freeHandQ);
        setWorldQuaternion(bones.handL, freeHandQ.slerp(gripHandQ, 1 - freeHand));
        curlFingers(rig, 'L', goalie ? 0.2 + goalieAction.reach * 0.3 : 1 - freeHand * 0.55);
      }
    } else {
      curlFingers(rig, 'L', 0.3);
      curlFingers(rig, 'R', 0.3);
    }
    if (import.meta.env.DEV && labHooks.subject === id) {
      Object.assign(labPose.action, action);
      labPose.twoHand = twoHand;
      labPose.freeHand = freeHand;
      labPose.release = release;
      labPose.stickBlend = stickBlend;
      labPose.crouch = posture.crouch;
      labPose.swing = swing;
      labPose.goalie = goalie;
      labPose.tip = tip.toArray();
      labPose.grip = grip.toArray();
      labPose.hosel = hosel.toArray();
    }
  }

  useFrame((state, dt) => {
    if (import.meta.env.DEV && labHooks.active && labHooks.delta !== null) dt = labHooks.delta;
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
    if (!replay && skater.downTimer <= 0 && !cellyRagdoll(skater) && physics.doll) {
      physics.release();
      showPose(id, null);
    }
    const shown =
      import.meta.env.DEV && labHooks.active ? labHooks.subject === id : isOnIce(s, skater);
    if (!shown) {
      root.visible = false;
      if (!replay) physics.follow(skater.x, skater.z, goalie, false);
      return;
    }
    root.visible = true;
    if (!replay)
      physics.follow(skater.x, skater.z, goalie, skater.downTimer <= 0 && !cellyRagdoll(skater));

    if (import.meta.env.DEV) reviewSkaters.set(id, { rig, stick: parts });

    // A full knockdown is a physics ragdoll; replays show the recorded fall.
    let ragdoll = false;
    if (replay) ragdoll = replayPose(replay.frames, replay.time, id, poses.drawn);
    else if ((skater.downTimer > 0 || cellyRagdoll(skater)) && physicsReady()) {
      if (!physics.doll) {
        // First frame down: the bones still hold the pose the hit landed on, one step behind.
        root.position.set(skater.x, root.position.y, skater.z);
        root.updateMatrixWorld(true);
        physics.doll = createRagdoll(rig, parts, blade, skater, {
          limp: cellyRagdoll(skater),
          dive: skater.diveTimer > 0,
        });
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
        if (skater.downTimer > 0 && skater.downTimer < GET_UP && !cellyRagdoll(skater)) {
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
    if (import.meta.env.DEV && labHooks.subject === id && labHooks.afterPose) {
      labPose.ragdoll = ragdoll;
      labHooks.afterPose(rig, parts, labPose);
    }
    // Red under seat one's skater, blue under anybody else's — the couch partner on either bench,
    // or the person across the ice online — and green on the player a seat here is passing to. A
    // CPU side marks nobody.
    const holder = humanOn(s, skater);
    const yours = !!holder && holder === seatHuman(0, s),
      theirs = !!holder && !yours;
    const aimedAt = [seatHuman(0, s), seatHuman(1, s)].some(
      (h) => h?.passHeld && h.passTarget === id,
    );
    ring.current!.visible =
      !runtime.replay && !(import.meta.env.DEV && labHooks.active) && (yours || theirs || aimedAt);
    const marker = ring.current!.material;
    if (marker instanceof THREE.MeshBasicMaterial) {
      const want = yours ? MARKER_YOURS : theirs ? MARKER_THEIRS : MARKER_TARGET;
      if (!marker.color.equals(want)) marker.color.copy(want);
    }
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
          {bladeParts && (
            <>
              <mesh geometry={bladeParts.blade} material={STICK_MATERIALS.blade} castShadow />
              <mesh geometry={bladeParts.tape} material={STICK_MATERIALS.tape} />
            </>
          )}
          {stickMesh && (
            <mesh geometry={stickMesh.geometry} material={stickMesh.material} castShadow />
          )}
          {/* Hidden under the modelled stick, they still carry its shaft axis for the ragdoll. */}
          <mesh
            ref={shaft}
            geometry={shaftGeometry}
            material={STICK_MATERIALS.shaft}
            castShadow
            visible={goalie}
          />
          <mesh
            ref={knob}
            geometry={knobGeometry}
            material={STICK_MATERIALS.tape}
            visible={goalie}
          />
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
