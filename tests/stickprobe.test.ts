import { describe, it } from 'vitest';
import * as THREE from 'three';
import { placeStick, SKATER_BLADE } from '../src/scene/stick';

describe('stick solver continuity probe', () => {
  it('socket moves smoothly as a raised blade lands', () => {
    const parts = {
      root: new THREE.Group(),
      shaft: new THREE.Mesh(),
      knob: new THREE.Mesh(),
      paddle: null,
    };
    const hosel = new THREE.Vector3(),
      heading = new THREE.Vector3(0, 0, 1),
      shoulder = new THREE.Vector3(-0.07, 1.3, 0.28);
    // Descend from follow-through height to the ice at the carry spot, like the shot tail.
    let last: THREE.Vector3 | null = null;
    for (let i = 0; i <= 120; i++) {
      const u = i / 120;
      const lift = 0.3 * (1 - u);
      const grip = new THREE.Vector3(-0.05, 0.95 + lift * 0.8, 0.45);
      const tip = new THREE.Vector3(0.58 - 0.1 * u, -0.028 + lift, 1.3);
      placeStick(parts, SKATER_BLADE, grip, tip, heading, hosel, {
        shoulder,
        armReach: 0.5,
        handsLead: THREE.MathUtils.smoothstep(lift, 0.03, 0.22),
        torso: {
          at: new THREE.Vector3(0.15, 0.86, 0.02),
          front: new THREE.Vector3(0, 0, 1),
          up: new THREE.Vector3(0, 0.9, 0.45).normalize(),
        },
      });
      if (last) {
        const d = grip.distanceTo(last);
        if (d > 0.02)
          console.log(
            `u=${u.toFixed(3)} lift=${lift.toFixed(3)} socket jump ${(d * 100).toFixed(1)}cm`,
          );
      }
      last = grip.clone();
    }
  });
});
