import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BoneName, Side } from './skaterModel';

/** Room below the existing boot sole for a holder and steel runner. */
export const SKATE_LIFT = 0.055;

/** Lightweight fitted equipment follows the original rig, including its animated finger joints. */
export function fitHockeyEquipment(
  bones: Record<BoneName, THREE.Bone>,
  bindWorld: Record<BoneName, THREE.Quaternion>,
  scale: number,
  ankleHeight: number,
  goalie: boolean,
) {
  const shell = new THREE.MeshStandardMaterial({ color: '#121b2a', roughness: 0.63 });
  const padding = new THREE.MeshStandardMaterial({ color: '#263449', roughness: 0.8 });
  const holder = new THREE.MeshStandardMaterial({ color: '#dde4e7', roughness: 0.45 });
  const steel = new THREE.MeshStandardMaterial({
    color: '#8eabb9',
    metalness: 0.8,
    roughness: 0.24,
  });
  const geometries: THREE.BufferGeometry[] = [];
  const pads: Partial<Record<Side, THREE.Group>> = {};
  function pad(
    parent: THREE.Object3D,
    size: number[],
    position: number[],
    material: THREE.Material,
    radius = 0.012,
  ) {
    const geometry = new RoundedBoxGeometry(
      size[0] / scale,
      size[1] / scale,
      size[2] / scale,
      2,
      radius / scale,
    );
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0] / scale, position[1] / scale, position[2] / scale);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  for (const side of ['L', 'R'] as Side[]) {
    const hand = bones[`hand${side}`];
    pad(hand, [0.105, 0.07, 0.068], [0, -0.005, 0], shell);
    pad(hand, [0.095, 0.085, 0.055], [0, 0.05, -0.012], shell);
    for (let i = 0; i < 3; i++)
      pad(hand, [0.027, 0.068, 0.018], [(i - 1) * 0.03, 0.055, -0.041], padding, 0.006);
    hand.traverse((child) => {
      if (
        !(child as THREE.Bone).isBone ||
        !/Hand(Thumb|Index|Middle|Ring|Pinky)[123]$/.test(child.name)
      )
        return;
      const next = child.children.find(
        (c) => (c as THREE.Bone).isBone && c.position.length() > 0.01,
      );
      const length = next ? next.position.length() * scale : 0.022;
      pad(child, [0.028, Math.max(0.02, length), 0.029], [0, length * 0.4, -0.003], shell, 0.009);
    });
    if (goalie) {
      if (side === 'R') pad(hand, [0.17, 0.23, 0.045], [0, 0.055, -0.06], holder, 0.024);
      else {
        // A catcher's mitt has a thumb lobe and an open pocket, rather than a blocker silhouette.
        const outline = new THREE.Shape();
        outline.moveTo(-0.05, -0.035);
        outline.lineTo(0.05, -0.035);
        outline.quadraticCurveTo(0.13, 0, 0.115, 0.11);
        outline.quadraticCurveTo(0.105, 0.22, 0.02, 0.2);
        outline.quadraticCurveTo(-0.025, 0.19, -0.05, 0.145);
        outline.quadraticCurveTo(-0.14, 0.13, -0.13, 0.06);
        outline.quadraticCurveTo(-0.13, 0, -0.05, -0.035);
        const geometry = new THREE.ExtrudeGeometry(outline, {
          depth: 0.04,
          bevelEnabled: true,
          bevelSize: 0.012,
          bevelThickness: 0.012,
          bevelSegments: 3,
          curveSegments: 12,
        });
        geometry.translate(0, 0, -0.02);
        geometry.scale(1 / scale, 1 / scale, 1 / scale);
        geometries.push(geometry);
        const mitt = new THREE.Mesh(geometry, shell);
        mitt.castShadow = true;
        hand.add(mitt);
        const pocketGeometry = new THREE.SphereGeometry(1, 20, 12);
        geometries.push(pocketGeometry);
        const pocket = new THREE.Mesh(pocketGeometry, padding);
        pocket.scale.set(0.075 / scale, 0.078 / scale, 0.012 / scale);
        pocket.position.set(0, 0.09 / scale, 0.032 / scale);
        hand.add(pocket);
        for (let i = 0; i < 4; i++)
          pad(hand, [0.056, 0.004, 0.008], [-0.063, 0.065 + i * 0.019, 0.04], holder, 0.001);
      }
    }
    const foot = bones[`foot${side}`];
    const skate = new THREE.Group();
    // Equipment is modelled in the character's forward/up frame, independent of FBX bone roll.
    skate.quaternion.copy(bindWorld[`foot${side}`]).invert();
    foot.add(skate);
    const sole = -ankleHeight;
    pad(skate, [0.058, 0.03, 0.265], [0, sole - 0.012, 0.04], holder, 0.01);
    for (const z of [-0.045, 0.13])
      pad(skate, [0.024, 0.037, 0.035], [0, sole - 0.03, z], holder, 0.006);
    pad(skate, [0.009, 0.023, 0.285], [0, sole - SKATE_LIFT + 0.0115, 0.04], steel, 0.004);
    if (goalie) {
      const shin = new THREE.Group();
      pads[side] = shin;
      shin.quaternion.copy(bindWorld[`shin${side}`]).invert();
      bones[`shin${side}`].add(shin);
      pad(shin, [0.23, 0.48, 0.13], [0, -0.16, 0.09], holder, 0.025);
      for (let i = 0; i < 4; i++)
        pad(shin, [0.2, 0.014, 0.015], [0, 0.015 - i * 0.105, 0.16], padding, 0.005);
    }
  }
  return {
    pads,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
    },
  };
}
