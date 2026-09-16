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
import { IceSpray } from './Effects';
import {
  driveReplay,
  askToLeave,
  goalReplayWanted,
  mySide,
  publish,
  runtime,
  startGoalReplay,
  useGame,
  viewMatch,
  viewTimeScale,
} from '../game/store';
import { stepMatch, togglePause, netShotTarget, shotSpread } from '../game/engine';
import { recordRagdollPoses } from './ragdoll';
import { GOAL_REPLAY, REPLAY_HZ } from '../game/replay';
import { replayFraming } from './replayCamera';
import { navigateWithController } from '../input/menuNavigation';
import { screenInputToRink } from '../input/coordinates';
import { cameraFraming } from './camera';
import { playerLocator } from './locator';
import { EMPTY_INPUT, PUCK, RULES } from '../game/config';
import { hasActiveCelly } from '../game/cellys';
import type { InputFrame, MatchState, Phase, SideInputs, Team } from '../game/types';
import { mergeEdges, noEdges } from '../input/frames';
import type { Controller } from '../input/controller';
import { labHooks } from './animationReview';
/** Dev-only animation lab: drives the subject, the close-up camera, overlays and captures. */
const LabScene = import.meta.env.DEV
  ? lazy(() => import('./LabScene').then((m) => ({ default: m.LabScene })))
  : null;
const _aimNdc = new THREE.Vector3();
const _aimEdge = new THREE.Vector3();
const _framing = new THREE.Vector3();
/** Simulation steps per replay snapshot. */
const RECORD_EVERY = Math.max(1, Math.round(1 / RULES.fixedStep / REPLAY_HZ));
const RECORDED: Phase[] = ['faceoff', 'playing', 'goal'];
/** Impact feedback shared between the simulation loop and the camera: a big hit shakes the frame. */
const impact = { shake: 0 };
function Simulation() {
  const accumulator = useRef(0),
    lastEvent = useRef(-1),
    publishTime = useRef(0),
    lastMatch = useRef(runtime.match),
    pending = useRef<SideInputs>([null, null]),
    steps = useRef(0),
    goalReplay = useRef(false),
    frameRef = useRef<(delta: number) => void>(() => {});
  // Online, the host runs the match for both people, so it has to keep stepping even while
  // nobody is looking at this tab. A worker's clock is not throttled the way the render loop is.
  useEffect(() => {
    const beat = new Worker(new URL('../net/heartbeat.worker.ts', import.meta.url), {
      type: 'module',
    });
    let last = performance.now();
    beat.onmessage = () => {
      const now = performance.now();
      const delta = (now - last) / 1000;
      last = now;
      if (document.hidden && runtime.net) frameRef.current(Math.min(delta, 0.05));
    };
    // It only runs while it is needed: hidden, and with somebody on the other end.
    const sync = () => {
      const wanted = document.hidden && !!runtime.net;
      last = performance.now();
      beat.postMessage(wanted ? 'start' : 'stop');
    };
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      beat.postMessage('stop');
      beat.terminate();
    };
  }, []);
  useEffect(() => {
    const detach = runtime.controller.attach(),
      detachTwo = runtime.controllerTwo.attach();
    const pause = () => {
      if (runtime.replay) {
        if (runtime.replay.kind === 'instant') runtime.replay.playing = false;
        return;
      }
      // Online there is nothing to pause. The host pausing would stop the match for the guest
      // too, and a dropped pad or a hidden tab is no reason to freeze somebody else's game.
      if (runtime.net) return;
      if (['playing', 'faceoff', 'goal'].includes(runtime.match.phase)) {
        togglePause(runtime.match);
        runtime.audio.updateSkating(runtime.match, 1, runtime.myTeam);
        publish();
      }
    };
    runtime.controller.onDisconnect = pause;
    // A second player's pad dying mid-shift stops the game too, but only while they are on it.
    runtime.controllerTwo.onDisconnect = () => {
      if (runtime.match.sides[1 - runtime.myTeam].human) pause();
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      detach();
      detachTwo();
      runtime.controller.onDisconnect = undefined;
      runtime.controllerTwo.onDisconnect = undefined;
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  /**
   * Whistles, hits and horns: sound, rumble and camera shake. The watching side runs this on the
   * calls the host sent rather than on any of its own, which is why they cross with the snapshot.
   */
  const drainEvents = (s: MatchState) => {
    for (const event of s.events)
      if (event.id > lastEvent.current) {
        runtime.audio.play(event, s.mode);
        if (event.type === 'goal') goalReplay.current = goalReplayWanted(s);
        if (['shot', 'hit', 'goal', 'post', 'crossbar', 'save'].includes(event.type)) {
          const bigHit = event.type === 'hit' && event.power >= 0.5;
          if (bigHit) impact.shake = Math.max(impact.shake, event.power >= 0.75 ? 1 : 0.45);
          if (event.barDown && event.type === 'crossbar')
            impact.shake = Math.max(impact.shake, 0.3);
          const iron = event.type === 'crossbar';
          runtime.controller.rumble(
            event.type === 'goal'
              ? 1
              : bigHit
                ? Math.max(0.7, event.power)
                : iron
                  ? Math.max(0.55, event.power)
                  : event.power * 0.7,
            event.type === 'goal'
              ? 650
              : bigHit
                ? 280
                : event.type === 'hit'
                  ? 160
                  : iron
                    ? 130
                    : 100,
          );
        }
        lastEvent.current = event.id;
      }
  };
  /** One pass of the game loop: read the sticks, advance the match, play what happened. */
  const advance = (delta: number) => {
    const s = runtime.match;
    if (s !== lastMatch.current) {
      lastMatch.current = s;
      lastEvent.current = -1;
      accumulator.current = 0;
      pending.current = [null, null];
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
      runtime.controller.claimed = [];
      runtime.controller.read(dt, false);
      runtime.controllerTwo.claimed =
        runtime.controller.padIndex === undefined ? [] : [runtime.controller.padIndex];
      runtime.controllerTwo.read(dt, false);
      pending.current = [null, null];
      accumulator.current = 0;
      driveReplay(replay, replayInput, dt);
      runtime.audio.updateSkating(viewMatch(), Math.min(1, viewTimeScale()), runtime.myTeam);
      tickPublish();
      return;
    }
    // Every seat reads its own pad but maps through the same anchor: one screen, one orientation,
    // so up is up for whoever is holding a stick.
    const readSeat = (seat: Controller, team: Team) =>
      screenInputToRink(
        seat.read(Math.min(delta, 0.05), s.puck.owner === s.sides[team].controlled),
        s,
        runtime.settings.camera,
        runtime.myTeam,
      );
    const net = runtime.net;
    const guest = (1 - runtime.myTeam) as Team;
    // Seat one picks first and seat two takes what is left, so one pad always belongs to P1.
    runtime.controller.claimed = [];
    const mine = readSeat(runtime.controller, runtime.myTeam);
    runtime.controllerTwo.claimed =
      runtime.controller.padIndex === undefined ? [] : [runtime.controller.padIndex];
    // Seat two is polled even with nobody on it, so the matchup screen can tell you whether a
    // second controller has turned up yet. Its frame only counts once somebody is playing it.
    const guestFrame = readSeat(runtime.controllerTwo, guest);
    // Menus consume the pad only after it has been read, or a press lands on the stale frame.
    const menuOwnsInput = navigateWithController();
    const blocked = !!document.querySelector('[data-block-game-input]');
    const gate = (frame: InputFrame) => {
      if (menuOwnsInput) {
        frame.pause = false;
        frame.switchPlayer = false;
      }
      if (blocked) frame.pause = false;
      return frame;
    };
    pending.current[runtime.myTeam] = mergeEdges(pending.current[runtime.myTeam], gate(mine));
    // Online, the other bench is a person somewhere else; the second seat belongs to the couch.
    pending.current[guest] = net
      ? null
      : s.sides[guest].human
        ? mergeEdges(pending.current[guest], gate(guestFrame))
        : null;
    if (net && !net.isHost) {
      // A guest runs no simulation. It says what it is trying to do and draws what it is told,
      // so there is no second version of the match to disagree with the host's.
      // Presses are kept until a frame actually goes out, so none is lost between sends.
      if (net.sendInput(pending.current[runtime.myTeam] ?? EMPTY_INPUT))
        pending.current[runtime.myTeam] = noEdges(pending.current[runtime.myTeam] ?? EMPTY_INPUT);
      if (net.view(s, Math.min(delta, 0.05)) && RECORDED.includes(s.phase))
        recordRagdollPoses(runtime.recorder.record(s));
      drainEvents(s);
      runtime.audio.updateSkating(s, 1, runtime.myTeam);
      tickPublish();
      return;
    }
    // Pausing is a request from a person, not something the physics can decide: with two sticks
    // on the ice the engine cannot know whose pause it is, so it is resolved out here. Either
    // seat can call it.
    // Nobody gets to freeze somebody else's game, so the pause button asks about leaving instead.
    if (net && pending.current.some((frame) => frame?.pause)) {
      pending.current = pending.current.map((frame) => frame && noEdges(frame)) as SideInputs;
      askToLeave(!runtime.leaving);
    }
    if (!net && pending.current.some((frame) => frame?.pause)) {
      togglePause(s);
      pending.current = pending.current.map((frame) => frame && noEdges(frame)) as SideInputs;
      runtime.audio.updateSkating(s, 1, runtime.myTeam);
      publish();
      accumulator.current = 0;
      return;
    }
    accumulator.current +=
      Math.min(delta, 0.05) * (import.meta.env.DEV && labHooks.active ? labHooks.simScale : 1);
    while (accumulator.current >= RULES.fixedStep) {
      // As host, the other bench is whatever the last packet said. A missing one repeats rather
      // than handing the skater back to the AI.
      if (net) pending.current[guest] = net.takeGuestInput();
      stepMatch(s, pending.current, RULES.fixedStep);
      pending.current = pending.current.map((frame) => frame && noEdges(frame)) as SideInputs;
      accumulator.current -= RULES.fixedStep;
      if (RECORDED.includes(s.phase) && ++steps.current % RECORD_EVERY === 0)
        recordRagdollPoses(runtime.recorder.record(s));
    }
    net?.publish(s, Math.min(delta, 0.05));
    drainEvents(s);
    // Let the goal land live for a moment, then roll the replay.
    if (s.phase !== 'goal' && s.phase !== 'paused') goalReplay.current = false;
    else if (
      goalReplay.current &&
      s.phase === 'goal' &&
      s.countdown <= RULES.goalSeconds - GOAL_REPLAY.celebrate &&
      !hasActiveCelly(s)
    ) {
      goalReplay.current = false;
      startGoalReplay();
    }
    runtime.audio.updateSkating(s, 1, runtime.myTeam);
    tickPublish();
  };
  frameRef.current = advance;
  // A hidden tab throttles this to about once a second, so the heartbeat takes over there.
  useFrame((_, delta) => {
    if (!document.hidden) advance(delta);
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
      side = mySide(s),
      p = s.skaters[side.controlled],
      root = group.current;
    if (!root) return;
    const live =
      !runtime.replay &&
      runtime.settings.beginner &&
      side.passHeld &&
      s.phase === 'playing' &&
      s.puck.owner === side.controlled &&
      p.role !== 'G';
    root.visible = live;
    if (!live) return;
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
function PlayerLocatorHud({ marker }: { marker: RefObject<HTMLDivElement | null> }) {
  const shown = useRef(false);
  useFrame(({ camera, size }) => {
    const el = marker.current;
    if (!el) return;
    const loc = runtime.replay
      ? null
      : playerLocator(
          runtime.match,
          camera as THREE.PerspectiveCamera,
          size.width,
          shown.current,
          runtime.myTeam,
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
  });
  return null;
}
function ShotAimHud({ marker }: { marker: RefObject<HTMLDivElement | null> }) {
  useFrame(({ camera, size }) => {
    const el = marker.current;
    if (!el) return;
    const s = runtime.match,
      side = mySide(s),
      p = s.skaters[side.controlled];
    const live =
      !runtime.replay &&
      runtime.settings.beginner &&
      s.phase === 'playing' &&
      s.puck.owner === side.controlled &&
      p.role !== 'G' &&
      !s.puck.shot &&
      !side.passHeld;
    if (!live) {
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
              <Arena iceLogo={match.teams[0].logoLight} />
              <Puck />
              <ShotAimHud marker={shotAim} />
              <PassAim />
              <IceSpray />
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
            <PlayerLocatorHud marker={locator} />
            {LabScene && labHooks.active && (
              <Suspense fallback={null}>
                <LabScene />
              </Suspense>
            )}
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
