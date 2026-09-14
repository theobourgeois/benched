import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { runtime } from '../game/store';
import { isOnIce } from '../game/engine';
import { activeDeke } from '../game/dekes';
import { SIDES, SKATER_URL, createSkaterRig, reachArm } from './skaterModel';
import { poseSkater } from './skaterPose';
import {
  GOALIE_BLADE,
  SKATER_BLADE,
  STICK_MATERIALS,
  bladeGeometries,
  knobGeometry,
  paddleGeometry,
  placeStick,
  shaftGeometry,
} from './stick';

useLoader.preload(FBXLoader, SKATER_URL);

/** Player root sits at y=0.03; ice surface is ~0.012. Sink the rocker a hair so it reads as planted. */
const BLADE_ICE_Y = -0.028;
/** How far the bottom hand sits down the shaft from the knob toward the hosel. */
const BOTTOM_HAND = 0.45;
/** Forward speed along facing before the bottom hand comes off for a pumping stride. */
const ONE_HAND_FORWARD = 5.2;
/** Rearward speed along facing that counts as backskating. */
const ONE_HAND_BACK = -1.5;

const ankle = new THREE.Vector3(),
  topShoulder = new THREE.Vector3(),
  lowShoulder = new THREE.Vector3(),
  grip = new THREE.Vector3(),
  tip = new THREE.Vector3(),
  hosel = new THREE.Vector3(),
  lowHand = new THREE.Vector3(),
  offset = new THREE.Vector3(),
  target = new THREE.Vector3(),
  pole = new THREE.Vector3();

export const Player = memo(function Player({ id }: { id: number }) {
  const template = useLoader(FBXLoader, SKATER_URL);
  const group = useRef<THREE.Group>(null),
    fall = useRef<THREE.Group>(null),
    body = useRef<THREE.Group>(null),
    ring = useRef<THREE.Mesh>(null);
  const stick = useRef<THREE.Group>(null),
    shaft = useRef<THREE.Mesh>(null),
    knob = useRef<THREE.Mesh>(null),
    paddle = useRef<THREE.Mesh>(null);
  const p = runtime.match.skaters[id],
    goalie = p.role === 'G';
  const rig = useMemo(() => createSkaterRig(template, p.team), [template, p.team]);
  useEffect(() => () => rig.dispose(), [rig]);
  const blade = goalie ? GOALIE_BLADE : SKATER_BLADE,
    bladeParts = bladeGeometries(blade);
  const heading = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  useFrame((_, dt) => {
    const s = runtime.match,
      skater = s.skaters[id];
    const root = group.current,
      tilt = fall.current,
      hips = body.current;
    if (!root || !tilt || !hips) return;
    if (!isOnIce(s, skater)) {
      root.visible = false;
      return;
    }
    root.visible = true;
    const along = skater.vx * Math.sin(skater.angle) + skater.vz * Math.cos(skater.angle);
    const dekeMove = activeDeke(skater);
    const oneHand =
      !goalie &&
      s.puck.owner !== id &&
      skater.liftTimer <= 0 &&
      skater.blockTimer <= 0 &&
      !dekeMove &&
      (along > ONE_HAND_FORWARD || along < ONE_HAND_BACK);
    const twoHand = !oneHand;
    const { bones } = rig,
      { stickBlend, fallen } = poseSkater(rig, skater, dt, goalie, twoHand);
    const ease = 1 - Math.exp(-dt * 14);
    root.position.set(skater.x, 0.03 + (dekeMove?.hop ?? 0), skater.z);
    root.rotation.y = fallen > 0.4 ? skater.fallAngle : skater.angle;
    tilt.rotation.x = THREE.MathUtils.lerp(tilt.rotation.x, fallen * 1.28, ease);
    tilt.rotation.z = THREE.MathUtils.lerp(tilt.rotation.z, dekeMove?.lean ?? 0, ease);
    tilt.position.y = THREE.MathUtils.lerp(tilt.position.y, fallen * 0.22, ease);

    hips.position.y = 0;
    root.updateMatrixWorld(true);
    if (fallen < 0.55) {
      const lowest = Math.min(
        ...SIDES.map((side) => tilt.worldToLocal(bones[`foot${side}`].getWorldPosition(ankle)).y),
      );
      hips.position.y = rig.ankleHeight - lowest;
      hips.updateMatrixWorld(true);
    }

    const shooting = skater.shotTimer / 0.34;
    const charge = s.controlled === id ? s.shotCharge : 0;
    const lift = s.controlled === id ? s.shotLift : 0;
    const pump = Math.sin(skater.stride) * Math.min(Math.hypot(skater.vx, skater.vz) / 8.2, 1);
    // Left-stick net aim keeps shotLift around 0.5 at rest; only raise the blade on a real windup.
    const windup = Math.max(charge, shooting);
    const raise = windup > 0.04 ? windup * (0.55 + lift * 0.7) : 0;
    tip.set(
      THREE.MathUtils.lerp(0.52, skater.stickSide, stickBlend),
      THREE.MathUtils.lerp(BLADE_ICE_Y, BLADE_ICE_Y + raise, stickBlend) + (dekeMove?.lift ?? 0),
      THREE.MathUtils.lerp(0.2, skater.stickReach - charge * 1.15 + shooting * 0.4, stickBlend),
    );
    tilt.worldToLocal(bones.upperArmR.getWorldPosition(topShoulder));
    tilt.worldToLocal(bones.upperArmL.getWorldPosition(lowShoulder));
    if (twoHand) {
      grip
        .copy(topShoulder)
        .add(offset.set(-0.04 + skater.stickSide * 0.05, -0.56, 0.16 + pump * 0.03));
    } else {
      grip.copy(topShoulder).add(offset.set(-0.16, -0.5, 0.1));
    }
    grip.lerp(offset.set(-0.12, 0.08, -0.45), 1 - stickBlend);
    placeStick(
      { root: stick.current!, shaft: shaft.current!, knob: knob.current!, paddle: paddle.current },
      blade,
      grip,
      tip,
      heading,
      hosel,
    );
    if (stickBlend > 0.4) {
      reachArm(
        rig,
        'R',
        tilt.localToWorld(target.copy(grip)),
        tilt.localToWorld(pole.copy(topShoulder).add(offset.set(-0.6, -0.5, -0.4))),
      );
      if (twoHand) {
        lowHand.lerpVectors(grip, hosel, BOTTOM_HAND);
        reachArm(
          rig,
          'L',
          tilt.localToWorld(target.copy(lowHand)),
          tilt.localToWorld(pole.copy(lowShoulder).add(offset.set(0.6, -0.5, -0.4))),
        );
      }
    }
    ring.current!.visible = s.controlled === id || (s.passHeld && s.passTarget === id);
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} scale={[0.8, 1, 1]}>
        <circleGeometry args={[0.65, 32]} />
        <meshBasicMaterial color="#10293d" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <group ref={fall}>
        <group ref={body}>
          <primitive object={rig.root} />
        </group>
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
