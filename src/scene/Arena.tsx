import { memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { makeIceTexture, SvgTextureLoader } from './textures';
import { RINK } from '../game/config';
function outline(extra = 0) {
  const points: THREE.Vector2[] = [],
    r = RINK.corner + extra;
  for (const [x, z, start] of [
    [23, 6, 0],
    [-23, 6, 90],
    [-23, -6, 180],
    [23, -6, 270],
  ]) {
    for (let i = 0; i <= 12; i++) {
      const a = ((start + i * 7.5) * Math.PI) / 180;
      points.push(new THREE.Vector2(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
  }
  return points;
}
/** The rails around the boards, bottom to top: kickplate, dasher, cap rail and the glass. */
const RAILS = [
  { y: 0.12, height: 0.23, width: 0.26, color: '#debd43', transparent: false },
  { y: 0.55, height: 1.1, width: 0.22, color: '#e1e9e5', transparent: false },
  { y: 1.13, height: 0.1, width: 0.29, color: '#4b6b70', transparent: false },
  { y: 1.85, height: 1.35, width: 0.05, color: '#9bd5dc', transparent: true },
];
/** Every third outline point carries a glass stanchion. */
const STANCHION_EVERY = 3;
/**
 * The boards are one instanced mesh per rail rather than a mesh per segment, so the whole
 * dasher system is five draw calls. Nothing here moves, so the matrices are set once.
 */
function Rails({ points }: { points: THREE.Vector2[] }) {
  const rails = useRef<(THREE.InstancedMesh | null)[]>([]),
    stanchions = useRef<THREE.InstancedMesh>(null);
  const posts = useMemo(() => points.filter((_, i) => i % STANCHION_EVERY === 0), [points]);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    RAILS.forEach((rail, r) => {
      const mesh = rails.current[r];
      if (!mesh) return;
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length];
        dummy.position.set((a.x + b.x) / 2, rail.y, (a.y + b.y) / 2);
        dummy.rotation.set(0, -Math.atan2(b.y - a.y, b.x - a.x), 0);
        dummy.scale.set(a.distanceTo(b) + 0.06, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
    const post = stanchions.current;
    if (post) {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      posts.forEach((a, i) => {
        dummy.position.set(a.x, 1.8, a.y);
        dummy.updateMatrix();
        post.setMatrixAt(i, dummy.matrix);
      });
      post.instanceMatrix.needsUpdate = true;
      post.computeBoundingSphere();
    }
  }, [points, posts]);
  return (
    <>
      {RAILS.map((rail, r) => (
        <instancedMesh
          key={r}
          ref={(mesh) => {
            rails.current[r] = mesh;
          }}
          args={[undefined, undefined, points.length]}
          receiveShadow
        >
          <boxGeometry args={[1, rail.height, rail.width]} />
          <meshStandardMaterial
            color={rail.color}
            roughness={rail.transparent ? 0.15 : 0.6}
            transparent={rail.transparent}
            opacity={rail.transparent ? 0.12 : 1}
            depthWrite={!rail.transparent}
          />
        </instancedMesh>
      ))}
      <instancedMesh ref={stanchions} args={[undefined, undefined, posts.length]}>
        <boxGeometry args={[0.045, 1.45, 0.045]} />
        <meshStandardMaterial color="#72939a" />
      </instancedMesh>
    </>
  );
}
function Crowd() {
  const ref = useRef<THREE.InstancedMesh>(null),
    heads = useRef<THREE.InstancedMesh>(null),
    seats = useRef<THREE.InstancedMesh>(null);
  const people = useMemo(() => {
    const result: { x: number; y: number; z: number; color: string }[] = [];
    const palette = ['#264267', '#993b4c', '#435665', '#60758a', '#212f3a', '#1f3251', '#a4afba'];
    for (let row = 0; row < 7; row++) {
      const curve = new THREE.SplineCurve([
        ...outline(3.7 + row * 1.25),
        outline(3.7 + row * 1.25)[0],
      ]);
      const count = 180 + row * 12;
      for (let i = 0; i < count; i++) {
        const p = curve.getPointAt(i / count);
        result.push({
          x: p.x,
          y: 1.4 + row * 0.68,
          z: p.y,
          color: palette[(i * 13 + row * 17) % palette.length],
        });
      }
    }
    return result;
  }, []);
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    people.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.y = Math.atan2(-p.x, -p.z);
      dummy.scale.set(0.56, 0.49 + (i % 3) * 0.06, 0.4);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
      ref.current!.setColorAt(i, new THREE.Color(p.color));
      dummy.position.y = p.y + 0.54 + (i % 3) * 0.04;
      dummy.scale.set(0.16, 0.19, 0.16);
      dummy.updateMatrix();
      heads.current!.setMatrixAt(i, dummy.matrix);
      heads.current!.setColorAt(
        i,
        new THREE.Color(['#bb977f', '#886751', '#d5b59b', '#594838'][i % 4]),
      );
      dummy.position.set(p.x, p.y - 0.24, p.z);
      dummy.translateZ(-0.12);
      dummy.scale.set(0.7, 0.52, 0.45);
      dummy.updateMatrix();
      seats.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    heads.current!.instanceMatrix.needsUpdate = true;
    seats.current!.instanceMatrix.needsUpdate = true;
    if (heads.current!.instanceColor) heads.current!.instanceColor.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  }, [people]);
  return (
    <>
      <instancedMesh ref={heads} args={[undefined, undefined, people.length]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh ref={seats} args={[undefined, undefined, people.length]}>
        <boxGeometry />
        <meshStandardMaterial color="#14263e" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={ref} args={[undefined, undefined, people.length]}>
        <capsuleGeometry args={[0.5, 0.7, 2, 5]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
    </>
  );
}
function Goal({ sign }: { sign: number }) {
  const segments = useMemo(() => {
    const vertices: number[] = [];
    for (let z = -1.8; z <= 1.81; z += 0.22) {
      vertices.push(1.4, 0, z, 1.4, 1.35, z, 0, 1.35, z, 1.4, 1.35, z);
    }
    for (let y = 0; y <= 1.36; y += 0.18)
      vertices.push(1.4, y, -1.8, 1.4, y, 1.8, 0, y, -1.8, 1.4, y, -1.8, 0, y, 1.8, 1.4, y, 1.8);
    for (let x = 0; x <= 1.41; x += 0.22)
      vertices.push(
        x,
        0,
        -1.8,
        x,
        1.35,
        -1.8,
        x,
        0,
        1.8,
        x,
        1.35,
        1.8,
        x,
        1.35,
        -1.8,
        x,
        1.35,
        1.8,
      );
    return new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
  }, []);
  return (
    <group position={[sign * RINK.goalX, 0.05, 0]} rotation={[0, sign === -1 ? Math.PI : 0, 0]}>
      <lineSegments geometry={segments}>
        <lineBasicMaterial color="#f3fcfc" transparent opacity={0.55} />
      </lineSegments>
      {[-1.8, 1.8].map((z) => (
        <mesh key={z} position={[0, 0.675, z]} castShadow>
          <cylinderGeometry args={[0.065, 0.065, 1.35, 10]} />
          <meshStandardMaterial color="#f24544" roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 1.35, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.065, 0.065, 3.7, 10]} />
        <meshStandardMaterial color="#f24544" roughness={0.3} />
      </mesh>
      <mesh position={[1.4, 0.05, 0]}>
        <boxGeometry args={[0.1, 0.1, 3.6]} />
        <meshStandardMaterial color="#f24544" />
      </mesh>
    </group>
  );
}
export const Arena = memo(function Arena({ iceLogo }: { iceLogo: string }) {
  const iceFallback = useMemo(() => makeIceTexture(), []);
  useEffect(() => () => iceFallback.dispose(), [iceFallback]);
  const points = useMemo(() => outline(), []);
  const shape = useMemo(() => new THREE.Shape(points), [points]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]} receiveShadow>
        <planeGeometry args={[220, 180]} />
        <meshStandardMaterial color="#071216" roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.26, 0]}>
        <extrudeGeometry args={[shape, { depth: 0.25, bevelEnabled: false, steps: 1 }]} />
        <meshStandardMaterial color="#b6c5c5" />
      </mesh>
      {/* Bare ice until the crest arrives, so the rink never waits on a logo. */}
      <Suspense fallback={<IceSheet map={iceFallback} />}>
        <IceSheetWithLogo src={iceLogo} />
      </Suspense>
      {/* Corner masks cover the rectangular ice texture outside the rounded playing surface. */}
      {[-1, 1].flatMap((x) => [-1, 1].map((z) => <CornerMask key={`${x}:${z}`} x={x} z={z} />))}
      <Rails points={points} />
      {Array.from({ length: 7 }, (_, row) => (
        <group key={row}>
          {[-1, 1].map((sign) => (
            <group key={sign}>
              <mesh position={[0, row * 0.34, sign * (17 + row * 1.3)]} receiveShadow>
                <boxGeometry args={[57 + row * 1.4, 0.6 + row * 0.68, 1.5]} />
                <meshStandardMaterial color={row % 2 ? '#182a30' : '#21343a'} />
              </mesh>
              <mesh position={[sign * (34 + row * 1.3), row * 0.34, 0]}>
                <boxGeometry args={[1.5, 0.6 + row * 0.68, 27 + row * 1.7]} />
                <meshStandardMaterial color={row % 2 ? '#182a30' : '#21343a'} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
      <Crowd />
      {[-1, 1].map((sign) => (
        <group key={sign}>
          <mesh position={[0, 5.5, sign * 26.8]}>
            <boxGeometry args={[76, 0.2, 0.15]} />
            <meshBasicMaterial color="#9cc5ed" />
          </mesh>
          <mesh position={[sign * 43.8, 5.5, 0]}>
            <boxGeometry args={[0.15, 0.2, 48]} />
            <meshBasicMaterial color="#9cc5ed" />
          </mesh>
        </group>
      ))}
      <Goal sign={-1} />
      <Goal sign={1} />
    </group>
  );
});
function IceSheet({ map }: { map: THREE.Texture }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
      <planeGeometry args={[60, 26]} />
      <meshStandardMaterial map={map} roughness={0.28} metalness={0.12} />
    </mesh>
  );
}
function IceSheetWithLogo({ src }: { src: string }) {
  const logo = useLoader(SvgTextureLoader, src);
  const ice = useMemo(() => makeIceTexture(logo.image), [logo]);
  useEffect(() => () => ice.dispose(), [ice]);
  return <IceSheet map={ice} />;
}
function CornerMask({ x, z }: { x: number; z: number }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 7);
    s.lineTo(7, 7);
    s.lineTo(7, 0);
    s.absarc(0, 0, 7, 0, Math.PI / 2, false);
    s.closePath();
    return s;
  }, []);
  return (
    <mesh position={[23 * x, 0.025, 6 * z]} rotation={[-Math.PI / 2, 0, 0]} scale={[x, -z, 1]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#0e2026" side={THREE.DoubleSide} />
    </mesh>
  );
}
