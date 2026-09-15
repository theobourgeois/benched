import { attackDirection, RINK } from '../game/config';
import { clamp } from '../game/math';
import type { CameraMode, MatchState, Settings } from '../game/types';

export const CAMERA_OPTIONS: { value: CameraMode; label: string }[] = [
  { value: 'broadcast', label: 'Broadcast · net angle' },
  { value: 'tight', label: 'Tight · close-up' },
  { value: 'high', label: 'Overhead · high' },
  { value: 'wide', label: 'Wide · full rink' },
];

type TrackingAngle = {
  height: number;
  heightDrop: number;
  back: number;
  backIn: number;
  fov: number;
  fovDrop: number;
  look: number;
  attackLook: number;
  netLook: number;
  targetY: number;
  targetYIn: number;
  attackBias: number;
  /** Share of the framing that tracks the controlled skater instead of the puck. */
  follow: number;
};

const ANGLES: Record<Exclude<CameraMode, 'wide'>, TrackingAngle> = {
  broadcast: {
    height: 22,
    heightDrop: 6,
    back: 24,
    backIn: 3.5,
    fov: 38,
    fovDrop: 2,
    look: 0.5,
    attackLook: 3,
    netLook: 1.6,
    targetY: 0.7,
    targetYIn: 0.45,
    attackBias: 1.6,
    follow: 0.2,
  },
  tight: {
    height: 19,
    heightDrop: 4,
    back: 12,
    backIn: 3,
    fov: 40,
    fovDrop: 2,
    look: 0.8,
    attackLook: 2,
    netLook: 0.6,
    targetY: 0.6,
    targetYIn: 0.35,
    attackBias: 1,
    follow: 0.65,
  },
  high: {
    height: 27,
    heightDrop: 9,
    back: 18,
    backIn: 4,
    fov: 38,
    fovDrop: 4,
    look: 0,
    attackLook: 0,
    netLook: 3.2,
    targetY: 0.12,
    targetYIn: 0.85,
    attackBias: 1.2,
    follow: 0.2,
  },
};

type Framing = {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
};
/** Dev hook: `window.__CAMERA__ = { position, target, fov }` pins the camera for animation close-ups. */
function debugFraming(): Framing | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  return (window as unknown as { __CAMERA__?: Framing }).__CAMERA__ ?? null;
}

export function cameraFraming(match: MatchState, camera: Settings['camera'], aspect: number) {
  const debug = debugFraming();
  if (debug) return debug;
  if (match.phase === 'menu')
    return { position: [35, 39, 45] as const, target: [0, 0, -1] as const, fov: 43 };
  switch (camera) {
    case 'wide':
      return { position: [3, 47, 53] as const, target: [0, 0, 0] as const, fov: 43 };
    case 'broadcast':
    case 'tight':
    case 'high':
      return trackingFraming(match, aspect, ANGLES[camera]);
    default: {
      const _exhaustive: never = camera;
      return _exhaustive;
    }
  }
}

function isShootoutGoalie(match: MatchState) {
  return match.mode === 'shootout' && match.skaters[match.controlled]?.role === 'G';
}
function goalieFraming(match: MatchState, aspect: number, angle: TrackingAngle) {
  const goalie = match.skaters[match.controlled],
    look = attackDirection(goalie.team, match.period),
    puck = match.puck,
    scale = clamp(1.45 / aspect, 1, 2.6);
  const range = clamp(Math.abs(puck.x - goalie.x) / 28, 0.4, 1);
  const z = clamp(goalie.z * 0.4 + puck.z * 0.6, -3.4, 3.4);
  const back = (16 + range * 8) * scale;
  const height = (12 + range * 5 + angle.heightDrop * 0.12) * scale;
  return {
    position: [goalie.x - look * back, height, z] as const,
    target: [goalie.x * 0.3 + puck.x * 0.7, 0.65, z] as const,
    fov: angle.fov + 8,
  };
}
function trackingFraming(match: MatchState, aspect: number, angle: TrackingAngle) {
  if (isShootoutGoalie(match)) return goalieFraming(match, aspect, angle);
  const direction = attackDirection(match.homeTeam, match.period),
    player = match.skaters[match.controlled];
  const attackX = player.x * direction;
  const netView = clamp((attackX - 8) / 14, 0, 1);
  const attackLook = clamp((match.puck.x * direction + 16) / 24, 0, 1);
  const lift = match.puck.owner === match.controlled ? match.shotLift : 0;
  const x = clamp(
    match.puck.x * (1 - angle.follow - netView * 0.22) +
      player.x * angle.follow +
      direction * (angle.attackBias + netView * (RINK.goalX - 21)),
    -23,
    23,
  );
  const z = clamp(match.puck.z * 0.22 + match.shotAim * netView * 0.55, -3.4, 3.4);
  const scale = clamp(1.45 / aspect, 1, 2.6);
  const height = (angle.height - netView * angle.heightDrop - lift * 1.8) * scale;
  const back = (angle.back + netView * angle.backIn) * scale;
  return {
    position: [x - direction * back, height, z] as const,
    target: [
      x + direction * (angle.look + attackLook * angle.attackLook + netView * angle.netLook),
      angle.targetY + netView * angle.targetYIn + lift * 0.4,
      z,
    ] as const,
    fov: angle.fov - netView * angle.fovDrop,
  };
}
