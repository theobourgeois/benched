import type { SkaterRig } from './skaterModel';
import type { StickParts } from './stick';
import type { HockeyAction } from './hockeyMotion';

/** Populated only in development. Used by the browser rig checks and Blender clip export. */
export const reviewSkaters = new Map<number, { rig: SkaterRig; stick: StickParts }>();

type V3 = [number, number, number];
/** What the stick-and-hands pass decided on the last frame. Points are in the skater's tilt frame. */
export interface PoseDebug {
  twoHand: number;
  freeHand: number;
  release: number;
  stickBlend: number;
  crouch: number;
  swing: number;
  ragdoll: boolean;
  goalie: boolean;
  action: HockeyAction;
  tip: V3;
  grip: V3;
  hosel: V3;
}
export const labPose: PoseDebug = {
  twoHand: 1,
  freeHand: 0,
  release: 0,
  stickBlend: 1,
  crouch: 0,
  swing: 0,
  ragdoll: false,
  goalie: false,
  action: {
    bend: 0,
    twist: 0,
    hipX: 0,
    hipZ: 0,
    hipDrop: 0,
    bladeSide: 0,
    bladeReach: 0,
    bladeLift: 0,
    handLift: 0,
    handSpread: 0,
    releaseHand: 0,
    check: 0,
  },
  tip: [0, 0, 0],
  grip: [0, 0, 0],
  hosel: [0, 0, 0],
};

/**
 * Dev-only hooks the animation lab (src/dev/lab.ts) installs. The game never sets them, and every
 * read sits behind import.meta.env.DEV so production builds drop them.
 */
export const labHooks = {
  active: false,
  /** The one skater drawn while the lab is open. */
  subject: -1,
  /** Animation seconds this frame (slow motion, frame steps, fixed-step captures); null is real time. */
  delta: null as number | null,
  /** Simulation speed in the lab's live mode. */
  simScale: 1,
  afterPose: null as ((rig: SkaterRig, stick: StickParts, pose: PoseDebug) => void) | null,
};
