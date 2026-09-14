import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { runtime } from '../game/store';
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
    const s = runtime.match,
      dt = Math.min(delta, 0.05);
    if (s !== match.current) {
      match.current = s;
      lastEvent.current = -1;
      pool.current.forEach((p) => (p.life = 0));
    }
    spawnTime.current += dt;
    if (s.phase === 'playing' && spawnTime.current > 0.04) {
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
