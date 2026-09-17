import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { runtime, viewMatch, viewTimeScale } from '../app/store';
import { RINK } from '../game/config';
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}
/** A fixed particle pool keeps skate spray and impact bursts allocation-free during play. */
export function IceSpray() {
  const mesh = useRef<THREE.InstancedMesh>(null),
    cursor = useRef(0),
    lastEvent = useRef(-1),
    match = useRef(runtime.match);
  const pool = useRef<Particle[]>(
    Array.from({ length: 220 }, () => ({
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
    })),
  );
  const dummy = useRef(new THREE.Object3D()),
    spawnTime = useRef(0);
  const spawn = (x: number, z: number, vx: number, vz: number, force: number) => {
    const p = pool.current[cursor.current++ % pool.current.length];
    p.x = x;
    p.y = 0.12;
    p.z = z;
    p.vx = -vx * 0.12 + (Math.random() - 0.5) * force;
    p.vz = -vz * 0.12 + (Math.random() - 0.5) * force;
    p.vy = 1 + Math.random() * force * 0.3;
    p.life = p.maxLife = 0.25 + Math.random() * 0.35;
  };
  useFrame((_, delta) => {
    const s = viewMatch(),
      dt = Math.min(delta, 0.05) * viewTimeScale();
    if (s !== match.current) {
      match.current = s;
      // Only new bursts: cutting to or from a replay must not re-fire hits already shown.
      lastEvent.current = s.events.at(-1)?.id ?? -1;
      pool.current.forEach((p) => (p.life = 0));
    }
    spawnTime.current += dt;
    if ((s.phase === 'playing' || s.phase === 'goal') && spawnTime.current > 0.04) {
      spawnTime.current = 0;
      for (const p of s.skaters) if (Math.hypot(p.vx, p.vz) > 4) spawn(p.x, p.z, p.vx, p.vz, 2.5);
    }
    for (const event of s.events)
      if (event.id > lastEvent.current) {
        if (['shot', 'hit', 'save', 'post'].includes(event.type)) {
          const burst = event.type === 'hit' ? (event.power >= 0.5 ? 32 : 18) : 12;
          const force = event.type === 'hit' ? 6 + event.power * 8 : 6;
          const x = event.x ?? s.puck.x,
            z = event.z ?? s.puck.z;
          for (let i = 0; i < burst; i++) spawn(x, z, 0, 0, force);
        }
        lastEvent.current = event.id;
      }
    pool.current.forEach((p, i) => {
      if (s.phase !== 'paused') {
        p.life = Math.max(0, p.life - dt);
        p.x += p.vx * dt;
        p.y = Math.max(0.05, p.y + p.vy * dt);
        p.z += p.vz * dt;
        p.vy -= 7 * dt;
      }
      dummy.current.position.set(p.x, p.y, p.z);
      dummy.current.scale.setScalar((p.life / p.maxLife) * 0.075);
      dummy.current.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.current.matrix);
    });
    mesh.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 220]}>
      <tetrahedronGeometry args={[1]} />
      <meshBasicMaterial color="#f0ffff" transparent opacity={0.7} />
    </instancedMesh>
  );
}

/**
 * The red lamp behind the glass. It strobes on the eighths of the goal beat over the net that was
 * scored on, and washes the ice around it, while the call is up.
 */
export function GoalLamp() {
  const lamps = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)],
    lights = [useRef<THREE.PointLight>(null), useRef<THREE.PointLight>(null)],
    clock = useRef(0),
    lit = useRef(false);
  useFrame((_, delta) => {
    const s = viewMatch(),
      on = s.phase === 'goal' && s.scoringTeam !== null && s.mode !== 'freeSkate';
    if (on !== lit.current) clock.current = 0;
    lit.current = on;
    clock.current += Math.min(delta, 0.1) * viewTimeScale();
    const end = Math.sign(s.puck.x) || 1;
    const half = runtime.audio.celebrationBeat() / 2;
    const beat = (clock.current % half) / half;
    const glow = on ? 0.35 + 0.65 * Math.max(0, 1 - beat * 2.2) : 0;
    for (const sign of [-1, 1]) {
      const i = sign < 0 ? 0 : 1,
        mine = on && sign === end;
      const lamp = lamps[i].current,
        light = lights[i].current;
      if (lamp)
        (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = mine ? glow * 3 : 0;
      if (light) light.intensity = mine ? glow * 320 : 0;
    }
  });
  return (
    <>
      {[-1, 1].map((sign, i) => (
        <group key={sign} position={[sign * (RINK.halfLength + 0.55), 2.35, 0]}>
          <mesh ref={lamps[i]}>
            <sphereGeometry args={[0.28, 16, 12]} />
            <meshStandardMaterial color="#3a0808" emissive="#ff1a10" emissiveIntensity={0} />
          </mesh>
          <mesh position={[0, -0.45, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.6, 6]} />
            <meshStandardMaterial color="#1c1c1c" />
          </mesh>
          <pointLight
            ref={lights[i]}
            color="#ff3a22"
            intensity={0}
            distance={30}
            decay={2}
            position={[-sign * 1.2, 0, 0]}
          />
        </group>
      ))}
    </>
  );
}
