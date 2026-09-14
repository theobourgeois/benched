import { Component, Suspense, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Arena } from './Arena';
import { Player } from './Player';
import { IceSpray } from './Effects';
import { runtime, publish, useGame } from '../game/store';
import { stepMatch, togglePause, netShotTarget } from '../game/engine';
import { navigateWithController } from '../input/menuNavigation';
import { screenInputToRink } from '../input/coordinates';
import { cameraFraming } from './camera';
import { PUCK, RULES } from '../game/config';
import type { InputFrame } from '../game/types';
const _aimNdc = new THREE.Vector3();
/** Impact feedback shared between the simulation loop and the camera: a big hit shakes the frame. */
const impact = { shake: 0 };
const noEdges = (input: InputFrame) => ({
  ...input,
  shoot: false,
  pass: false,
  passRelease: false,
  poke: false,
  saucer: false,
  chip: false,
  deke: false,
  dekeSpecial: null,
  dive: false,
  check: false,
  switchPlayer: false,
  pause: false,
});
function Simulation() {
  const accumulator = useRef(0),
    lastEvent = useRef(-1),
    publishTime = useRef(0),
    lastMatch = useRef(runtime.match),
    pending = useRef<InputFrame | null>(null);
  useEffect(() => {
    const detach = runtime.controller.attach();
    const pause = () => {
      if (['playing', 'faceoff', 'goal'].includes(runtime.match.phase)) {
        togglePause(runtime.match);
        runtime.audio.updateSkating(runtime.match);
        publish();
      }
    };
    runtime.controller.onDisconnect = pause;
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      detach();
      runtime.controller.onDisconnect = undefined;
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useFrame((_, delta) => {
    const s = runtime.match;
    if (s !== lastMatch.current) {
      lastMatch.current = s;
      lastEvent.current = -1;
      accumulator.current = 0;
      pending.current = null;
    }
    const frame = screenInputToRink(
      runtime.controller.read(Math.min(delta, 0.05), s.puck.owner === s.controlled),
      s,
      runtime.settings.camera,
    );
    if (navigateWithController()) {
      frame.pause = false;
      frame.switchPlayer = false;
    }
    if (document.querySelector('[data-block-game-input]')) frame.pause = false;
    // Keep button edges until a simulation step consumes them, even on 240 Hz displays.
    const old = pending.current;
    pending.current = old
      ? {
          ...frame,
          shoot: frame.shoot || old.shoot,
          shotPower: frame.shoot ? frame.shotPower : old.shotPower,
          shotHeight: frame.shoot
            ? frame.shotHeight
            : old.shoot
              ? old.shotHeight
              : frame.shotHeight,
          aimZ: frame.shoot ? frame.aimZ : old.shoot ? old.aimZ : frame.aimZ,
          pass: frame.pass || old.pass,
          passRelease: frame.passRelease || old.passRelease,
          poke: frame.poke || old.poke,
          saucer: frame.saucer || old.saucer,
          chip: frame.chip || old.chip,
          deke: frame.deke || old.deke,
          dekeSpecial: frame.dekeSpecial ?? old.dekeSpecial,
          dive: frame.dive || old.dive,
          check: frame.check || old.check,
          checkPower: frame.check ? frame.checkPower : old.checkPower,
          switchPlayer: frame.switchPlayer || old.switchPlayer,
          pause: frame.pause || old.pause,
        }
      : frame;
    accumulator.current += Math.min(delta, 0.05);
    while (accumulator.current >= RULES.fixedStep) {
      stepMatch(s, pending.current, RULES.fixedStep);
      pending.current = noEdges(pending.current);
      accumulator.current -= RULES.fixedStep;
    }
    for (const event of s.events)
      if (event.id > lastEvent.current) {
        runtime.audio.play(event);
        if (['shot', 'hit', 'goal', 'post', 'save'].includes(event.type)) {
          const bigHit = event.type === 'hit' && event.power >= 0.5;
          if (bigHit) impact.shake = Math.max(impact.shake, event.power >= 0.75 ? 1 : 0.45);
          runtime.controller.rumble(
            event.type === 'goal' ? 1 : bigHit ? Math.max(0.7, event.power) : event.power * 0.7,
            event.type === 'goal' ? 650 : bigHit ? 280 : event.type === 'hit' ? 160 : 100,
          );
        }
        lastEvent.current = event.id;
      }
    runtime.audio.updateSkating(s);
    publishTime.current += delta;
    if (publishTime.current > 0.08) {
      publish();
      publishTime.current = 0;
    }
  });
  return null;
}
function CameraRig() {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    const framing = cameraFraming(runtime.match, runtime.settings.camera, size.width / size.height);
    const smoothing = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
    camera.position.lerp(new THREE.Vector3(...framing.position), smoothing);
    look.current.lerp(new THREE.Vector3(...framing.target), smoothing);
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov = THREE.MathUtils.lerp(perspective.fov, framing.fov, smoothing);
    perspective.updateProjectionMatrix();
    camera.lookAt(look.current);
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
    const p = runtime.match.puck;
    mesh.current!.position.set(p.x, p.y, p.z);
    shadow.current!.position.set(p.x, 0.016, p.z);
    positions.current.unshift(new THREE.Vector3(p.x, p.y, p.z));
    positions.current.pop();
    const fast =
      Math.hypot(p.vx, p.vz) > 12 && p.owner === null && runtime.match.phase === 'playing';
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
function PassAim() {
  const group = useRef<THREE.Group>(null),
    shaft = useRef<THREE.Mesh>(null),
    head = useRef<THREE.Mesh>(null),
    catchRing = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = runtime.match,
      p = s.skaters[s.controlled],
      root = group.current;
    if (!root) return;
    const live =
      runtime.settings.beginner &&
      s.passHeld &&
      s.phase === 'playing' &&
      s.puck.owner === s.controlled &&
      p.role !== 'G';
    root.visible = live;
    if (!live) return;
    const range = Math.max(2.2, s.passRange);
    root.position.set(p.x, 0.05, p.z);
    root.rotation.y = Math.atan2(s.passAim.x, s.passAim.z);
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
function ShotAimHud({ marker }: { marker: RefObject<HTMLDivElement | null> }) {
  useFrame(({ camera, size }) => {
    const el = marker.current;
    if (!el) return;
    const s = runtime.match,
      p = s.skaters[s.controlled];
    const live =
      runtime.settings.beginner &&
      s.phase === 'playing' &&
      s.puck.owner === s.controlled &&
      p.role !== 'G' &&
      !s.puck.shot &&
      !s.passHeld;
    if (!live) {
      el.hidden = true;
      return;
    }
    const target = netShotTarget(s, p, s.shotAim, s.shotLift);
    _aimNdc.set(target.x, target.y, target.z).project(camera);
    if (_aimNdc.z > 1) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const x = (_aimNdc.x * 0.5 + 0.5) * size.width;
    const y = (-_aimNdc.y * 0.5 + 0.5) * size.height;
    el.style.transform = `translate(${x}px, ${y}px)`;
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
  const shotAim = useRef<HTMLDivElement>(null);
  return (
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
            <Arena />
            <Puck />
            <ShotAimHud marker={shotAim} />
            <PassAim />
            <IceSpray />
          </Suspense>
          <Suspense fallback={null}>
            {/* Keyed by matchup so jerseys are rebuilt when the clubs change. */}
            {Array.from({ length: 12 }, (_, i) => (
              <Player key={`${match.teams[0].key}|${match.teams[1].key}|${i}`} id={i} />
            ))}
          </Suspense>
          <Simulation />
          <CameraRig />
        </Canvas>
      </SceneBoundary>
    </div>
  );
}
