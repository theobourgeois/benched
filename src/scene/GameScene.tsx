import { Component, Suspense, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Arena } from './Arena';
import { Player } from './Player';
import { IceSpray } from './Effects';
import {
  driveReplay,
  goalReplayWanted,
  publish,
  runtime,
  startGoalReplay,
  useGame,
  viewMatch,
  viewTimeScale,
} from '../game/store';
import { stepMatch, togglePause, netShotTarget } from '../game/engine';
import { recordRagdollPoses } from './ragdoll';
import { GOAL_REPLAY, REPLAY_HZ } from '../game/replay';
import { replayFraming } from './replayCamera';
import { navigateWithController } from '../input/menuNavigation';
import { screenInputToRink } from '../input/coordinates';
import { cameraFraming } from './camera';
import { playerLocator } from './locator';
import { PUCK, RULES } from '../game/config';
import type { InputFrame, Phase } from '../game/types';
const _aimNdc = new THREE.Vector3();
const _framing = new THREE.Vector3();
/** Simulation steps per replay snapshot. */
const RECORD_EVERY = Math.max(1, Math.round(1 / RULES.fixedStep / REPLAY_HZ));
const RECORDED: Phase[] = ['faceoff', 'playing', 'goal'];
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
    pending = useRef<InputFrame | null>(null),
    steps = useRef(0),
    goalReplay = useRef(false);
  useEffect(() => {
    const detach = runtime.controller.attach();
    const pause = () => {
      if (runtime.replay) {
        if (runtime.replay.kind === 'instant') runtime.replay.playing = false;
        return;
      }
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
      goalReplay.current = false;
    }
    const tickPublish = () => {
      publishTime.current += delta;
      if (publishTime.current > 0.08) {
        publish();
        publishTime.current = 0;
      }
    };
    // Replay controls read every frame, before read() clears this frame's key taps, so a button
    // already held when a replay opens doesn't count as a press.
    const replayInput = runtime.controller.replayInput();
    const replay = runtime.replay;
    if (replay) {
      const dt = Math.min(delta, 0.05);
      // Play input keeps reading too, so buttons held on the way out aren't fresh presses.
      runtime.controller.read(dt, false);
      pending.current = null;
      accumulator.current = 0;
      driveReplay(replay, replayInput, dt);
      runtime.audio.updateSkating(viewMatch(), Math.min(1, viewTimeScale()));
      tickPublish();
      return;
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
      if (RECORDED.includes(s.phase) && ++steps.current % RECORD_EVERY === 0)
        recordRagdollPoses(runtime.recorder.record(s));
    }
    for (const event of s.events)
      if (event.id > lastEvent.current) {
        runtime.audio.play(event);
        if (event.type === 'goal') goalReplay.current = goalReplayWanted(s);
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
    // Let the goal land live for a moment, then roll the replay.
    if (s.phase !== 'goal' && s.phase !== 'paused') goalReplay.current = false;
    else if (
      goalReplay.current &&
      s.phase === 'goal' &&
      s.countdown <= RULES.goalSeconds - GOAL_REPLAY.celebrate
    ) {
      goalReplay.current = false;
      startGoalReplay();
    }
    runtime.audio.updateSkating(s);
    tickPublish();
  });
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
          ...cameraFraming(runtime.match, runtime.settings.camera, aspect),
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
    positions.current.unshift(new THREE.Vector3(p.x, p.y, p.z));
    positions.current.pop();
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
      !runtime.replay &&
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
function PlayerLocatorHud({ marker }: { marker: RefObject<HTMLDivElement | null> }) {
  const shown = useRef(false);
  useFrame(({ camera, size }) => {
    const el = marker.current;
    if (!el) return;
    const loc = runtime.replay
      ? null
      : playerLocator(runtime.match, camera as THREE.PerspectiveCamera, size.width, shown.current);
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
  });
  return null;
}
function ShotAimHud({ marker }: { marker: RefObject<HTMLDivElement | null> }) {
  useFrame(({ camera, size }) => {
    const el = marker.current;
    if (!el) return;
    const s = runtime.match,
      p = s.skaters[s.controlled];
    const live =
      !runtime.replay &&
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
  const shotAim = useRef<HTMLDivElement>(null),
    locator = useRef<HTMLDivElement>(null);
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
            <PlayerLocatorHud marker={locator} />
          </Canvas>
        </SceneBoundary>
      </div>
      <div ref={locator} className="player-locator" hidden aria-hidden="true">
        <span>
          <b />
          <small>YOU</small>
        </span>
        <i />
      </div>
    </>
  );
}
