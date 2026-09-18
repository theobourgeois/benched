import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Arena } from './Arena';
import { Player } from './Player';
import { GoalLamp, IceSpray } from './Effects';
import { runtime, seatHuman, useGame, viewMatch } from '../app/store';
import { impact, loop } from '../app/loop';
import { netShotTarget, shotSpread } from '../game/engine';
import { recordRagdollPoses } from './ragdoll';
import { replayFraming } from './replayCamera';
import { cameraFraming } from './camera';
import { playerLocator } from './locator';
import { PUCK } from '../game/config';
import { labHooks } from './animationReview';
/** Dev-only animation lab: drives the subject, the close-up camera, overlays and captures. */
const LabScene = import.meta.env.DEV
  ? lazy(() => import('./LabScene').then((m) => ({ default: m.LabScene })))
  : null;
const _aimNdc = new THREE.Vector3();
const _aimEdge = new THREE.Vector3();
const _framing = new THREE.Vector3();
/**
 * The loop lives in `app/loop.ts`; this only hands it the render clock and the scene's part of a
 * replay frame, and gives the controllers back when the scene goes away.
 */
function Simulation() {
  useEffect(() => {
    loop.onRecord = recordRagdollPoses;
    const detach = loop.attach();
    return () => {
      detach();
      loop.onRecord = null;
    };
  }, []);
  useFrame((_, delta) => loop.frame(delta));
  return null;
}
function CameraRig() {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3()),
    inReplay = useRef(false);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1),
      aspect = size.width / size.height,
      replay = runtime.replay;
    const framing = replay
      ? replayFraming(replay, dt, aspect, runtime.settings.camera, {
          position: camera.position.toArray(),
          target: look.current.toArray(),
        })
      : {
          ...cameraFraming(runtime.match, runtime.settings.camera, aspect, runtime.myTeam),
          // Coming out of a replay cuts back to the game rather than flying across the rink.
          cut: inReplay.current,
          smoothing: 5,
        };
    inReplay.current = Boolean(replay);
    const smoothing =
      framing.cut || !Number.isFinite(framing.smoothing)
        ? 1
        : 1 - Math.exp(-dt * framing.smoothing);
    camera.position.lerp(_framing.set(...framing.position), smoothing);
    look.current.lerp(_framing.set(...framing.target), smoothing);
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov = THREE.MathUtils.lerp(perspective.fov, framing.fov, smoothing);
    perspective.updateProjectionMatrix();
    camera.lookAt(look.current);
    if (replay) impact.shake = 0;
    if (impact.shake > 0.01) {
      const amplitude = impact.shake * 0.28;
      camera.position.x += (Math.random() - 0.5) * amplitude;
      camera.position.y += (Math.random() - 0.5) * amplitude * 0.7;
      camera.position.z += (Math.random() - 0.5) * amplitude;
      impact.shake *= Math.exp(-Math.min(dt, 0.1) * 11);
    } else impact.shake = 0;
  });
  return null;
}
function Puck() {
  const mesh = useRef<THREE.Mesh>(null),
    shadow = useRef<THREE.Mesh>(null),
    trail = useRef<THREE.InstancedMesh>(null);
  const positions = useRef(Array.from({ length: 14 }, () => new THREE.Vector3())),
    dummy = useRef(new THREE.Object3D());
  useFrame(() => {
    const s = viewMatch(),
      p = s.puck;
    mesh.current!.position.set(p.x, p.y, p.z);
    shadow.current!.position.set(p.x, 0.016, p.z);
    // The oldest vector is reused for the newest position, so the trail never allocates.
    positions.current.unshift(positions.current.pop()!.set(p.x, p.y, p.z));
    const fast =
      Math.hypot(p.vx, p.vz) > 12 &&
      p.owner === null &&
      (s.phase === 'playing' || s.phase === 'goal');
    const airborne = p.y > 0.35;
    positions.current.forEach((pos, i) => {
      dummy.current.position.copy(pos);
      dummy.current.scale.setScalar(
        fast || airborne ? (1 - i / 14) * (airborne ? PUCK.radius * 0.85 : PUCK.radius * 0.7) : 0,
      );
      dummy.current.updateMatrix();
      trail.current!.setMatrixAt(i, dummy.current.matrix);
    });
    trail.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <mesh ref={mesh} castShadow>
        <cylinderGeometry args={[PUCK.radius, PUCK.radius, PUCK.height, 16]} />
        <meshStandardMaterial color="#11161e" roughness={0.6} />
      </mesh>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PUCK.radius * 1.15, PUCK.radius * 1.55, 24]} />
        <meshBasicMaterial color="#203947" transparent opacity={0.6} />
      </mesh>
      <instancedMesh ref={trail} args={[undefined, undefined, 14]}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial color="#526b85" transparent opacity={0.24} />
      </instancedMesh>
    </>
  );
}
/** The pass arrow for one seat on this screen. Each person aims their own. */
function PassAim({ seat }: { seat: 0 | 1 }) {
  const group = useRef<THREE.Group>(null),
    shaft = useRef<THREE.Mesh>(null),
    head = useRef<THREE.Mesh>(null),
    catchRing = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = runtime.match,
      side = seatHuman(seat, s),
      p = side && s.skaters[side.controlled],
      root = group.current;
    if (!root) return;
    const live =
      !!side &&
      !!p &&
      !runtime.replay &&
      runtime.settings.beginner &&
      side.passHeld &&
      s.phase === 'playing' &&
      s.puck.owner === side.controlled &&
      p.role !== 'G';
    root.visible = live;
    if (!live || !side || !p) return;
    const range = Math.max(2.2, side.passRange);
    root.position.set(p.x, 0.05, p.z);
    root.rotation.y = Math.atan2(side.passAim.x, side.passAim.z);
    if (shaft.current) {
      shaft.current.scale.set(1, 1, Math.max(0.4, range - 0.85));
      shaft.current.position.z = 0.55 + shaft.current.scale.z / 2;
    }
    if (head.current) head.current.position.z = range;
    if (catchRing.current) catchRing.current.position.z = range;
  });
  return (
    <group ref={group} visible={false}>
      <mesh ref={shaft}>
        <boxGeometry args={[0.11, 0.02, 1]} />
        <meshBasicMaterial color="#d5fa64" transparent opacity={0.42} depthTest={false} />
      </mesh>
      <mesh ref={head} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.32, 0.72, 3]} />
        <meshBasicMaterial color="#d5fa64" transparent opacity={0.82} depthTest={false} />
      </mesh>
      <mesh ref={catchRing} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.48, 24]} />
        <meshBasicMaterial color="#d5fa64" transparent opacity={0.85} depthTest={false} />
      </mesh>
    </group>
  );
}
/** One seat's chip. With two people on the couch each gets one, labelled with their seat. */
function PlayerLocatorHud({
  marker,
  seat,
}: {
  marker: RefObject<HTMLDivElement | null>;
  seat: 0 | 1;
}) {
  const shown = useRef(false);
  useFrame(({ camera, size }) => {
    const el = marker.current;
    if (!el) return;
    const human = seatHuman(seat, runtime.match);
    const loc =
      runtime.replay || !human
        ? null
        : playerLocator(
            runtime.match,
            camera as THREE.PerspectiveCamera,
            size.width,
            shown.current,
            human,
          );
    shown.current = Boolean(loc);
    if (!loc) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.style.setProperty('--locator', loc.color);
    el.style.transform = `translateX(${loc.x}px) translateX(-50%)`;
    const num = el.querySelector('b');
    if (num && num.textContent !== String(loc.number)) num.textContent = String(loc.number);
    const label = seat ? 'P2' : seatHuman(1, runtime.match) ? 'P1' : 'YOU';
    const tag = el.querySelector('small');
    if (tag && tag.textContent !== label) tag.textContent = label;
  });
  return null;
}
function ShotAimHud({ marker }: { marker: RefObject<HTMLDivElement | null> }) {
  useFrame(({ camera, size }) => {
    const el = marker.current;
    if (!el) return;
    // Only one person can have the puck, so the reticle belongs to whichever seat is carrying it.
    const s = runtime.match,
      side = [seatHuman(0, s), seatHuman(1, s)].find((h) => h && h.controlled === s.puck.owner),
      p = side && s.skaters[side.controlled];
    const live =
      !!side &&
      !!p &&
      !runtime.replay &&
      runtime.settings.beginner &&
      s.phase === 'playing' &&
      s.puck.owner === side.controlled &&
      p.role !== 'G' &&
      !s.puck.shot &&
      !side.passHeld;
    if (!live || !side || !p) {
      el.hidden = true;
      return;
    }
    const target = netShotTarget(s, p, side.shotAim, side.shotLift);
    _aimNdc.set(target.x, target.y, target.z).project(camera);
    if (_aimNdc.z > 1) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const x = (_aimNdc.x * 0.5 + 0.5) * size.width;
    const y = (-_aimNdc.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate(${x}px, ${y}px)`;
    const spread = shotSpread(s, p, side.shotCharge, target);
    _aimEdge.set(target.x, target.y + spread, target.z).project(camera);
    const ring = Math.hypot(
      (_aimEdge.x - _aimNdc.x) * 0.5 * size.width,
      (_aimEdge.y - _aimNdc.y) * 0.5 * size.height,
    );
    el.style.setProperty('--spread', `${ring.toFixed(1)}px`);
  });
  return null;
}
class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="webgl-error">
        <h2>The arena couldn’t load.</h2>
        <p>Enable hardware acceleration in your browser, then reload to get on the ice.</p>
        <button onClick={() => location.reload()}>Reload arena</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function GameScene() {
  const { match, settings } = useGame();
  const shotAim = useRef<HTMLDivElement>(null),
    locator = useRef<HTMLDivElement>(null),
    locatorTwo = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className={`arena-canvas ${match.phase === 'menu' ? 'arena-menu' : ''}`}>
        <div ref={shotAim} className="shot-aim-marker" hidden />
        <SceneBoundary>
          <Canvas
            shadows={settings.quality === 'high'}
            dpr={settings.quality === 'high' ? [1, 1.75] : 1}
            camera={{ position: [35, 39, 45], fov: 43, near: 0.1, far: 250 }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => {
              gl.setClearColor('#071316');
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.15;
            }}
            fallback={
              <div className="webgl-error">
                WebGL is needed to play. Try a browser with hardware acceleration enabled.
              </div>
            }
          >
            <fog attach="fog" args={['#071316', 65, 135]} />
            <ambientLight intensity={0.8} color="#bcd6e0" />
            <hemisphereLight args={['#d4ecf8', '#254545', 1.2]} />
            <directionalLight
              position={[6, 25, 12]}
              intensity={2.2}
              color="#f2f6ff"
              castShadow={settings.quality === 'high'}
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-36}
              shadow-camera-right={36}
              shadow-camera-top={24}
              shadow-camera-bottom={-24}
              shadow-normalBias={0.04}
              shadow-radius={3}
              shadow-bias={-0.0002}
            />
            <directionalLight position={[-22, 16, -10]} intensity={1.1} color="#d6e6ff" />
            <Suspense fallback={null}>
              <Arena iceLogo={match.teams[0].logoLight} />
              <Puck />
              <ShotAimHud marker={shotAim} />
              <PassAim seat={0} />
              <PassAim seat={1} />
              <IceSpray />
              <GoalLamp />
            </Suspense>
            <Suspense fallback={null}>
              {/* Keyed by matchup so jerseys are rebuilt when the clubs or uniforms change. */}
              {Array.from({ length: 12 }, (_, i) => (
                <Player
                  key={`${match.teams[0].key}|${match.teams[1].key}|${match.jerseys.join()}|${i}`}
                  id={i}
                />
              ))}
            </Suspense>
            <Simulation />
            <CameraRig />
            <PlayerLocatorHud marker={locator} seat={0} />
            <PlayerLocatorHud marker={locatorTwo} seat={1} />
            {LabScene && labHooks.active && (
              <Suspense fallback={null}>
                <LabScene />
              </Suspense>
            )}
          </Canvas>
        </SceneBoundary>
      </div>
      {[locator, locatorTwo].map((ref, seat) => (
        <div key={seat} ref={ref} className="player-locator" hidden aria-hidden="true">
          <span>
            <b />
            <small>YOU</small>
          </span>
          <i />
        </div>
      ))}
    </>
  );
}
