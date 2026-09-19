import { attackDirection, RINK, RINKS } from '../game/config';
import { leadHuman } from '../game/humans';
import { clamp } from '../game/math';
import type { CameraMode, MatchState, Settings, Team } from '../game/types';

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

/**
 * The angles were framed on the barn. A wider sheet pushes the camera up and back by the same
 * share, so the side boards sit where they always did on screen, but only so far: past
 * `MAX_PULL` the skaters would be specks, so on a bandy field the camera stops rising and pans
 * across with the puck instead.
 */
const MAX_PULL = 1.35;
/** Metres the camera leads the play by once it is in on net, so the goal is in the frame. */
const NET_LEAD = 5;
const sheetScale = () => Math.min(MAX_PULL, RINK.halfWidth / RINKS.barn.halfWidth);
/**
 * How far off the middle the camera may slide: the width the pull-back does not already show,
 * and half as much again, so a skater on the far wing sits inside the frame, not on its edge.
 */
const panRoom = () => Math.max(0, RINK.halfWidth - RINKS.barn.halfWidth * MAX_PULL) * 1.5;

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

/** `anchor` is the side being watched: which way the ice runs and whose skater the camera holds. */
export function cameraFraming(
  match: MatchState,
  camera: Settings['camera'],
  aspect: number,
  anchor: Team = 0,
) {
  const debug = debugFraming();
  if (debug) return debug;
  if (match.phase === 'menu')
    return { position: [35, 39, 45] as const, target: [0, 0, -1] as const, fov: 43 };
  switch (camera) {
    case 'wide': {
      // The one camera that shows the whole sheet, so it goes as far back as the sheet needs.
      const k = RINK.halfWidth / RINKS.barn.halfWidth;
      return { position: [3, 47 * k, 53 * k] as const, target: [0, 0, 0] as const, fov: 43 };
    }
    case 'broadcast':
    case 'tight':
    case 'high':
      return trackingFraming(match, aspect, ANGLES[camera], anchor);
    default: {
      const _exhaustive: never = camera;
      return _exhaustive;
    }
  }
}

/** The skater the tracking cameras lean toward: the watching bench's lead person, or its centre. */
const followed = (match: MatchState, anchor: Team) =>
  leadHuman(match, anchor)?.controlled ?? anchor * 6;
function isShootoutGoalie(match: MatchState, anchor: Team) {
  return match.mode === 'shootout' && match.skaters[followed(match, anchor)]?.role === 'G';
}
function goalieFraming(match: MatchState, aspect: number, angle: TrackingAngle, anchor: Team) {
  const goalie = match.skaters[followed(match, anchor)],
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
function trackingFraming(match: MatchState, aspect: number, angle: TrackingAngle, anchor: Team) {
  if (isShootoutGoalie(match, anchor)) return goalieFraming(match, aspect, angle, anchor);
  const human = leadHuman(match, anchor);
  const direction = attackDirection(anchor, match.period),
    player = match.skaters[followed(match, anchor)];
  // Closing on the net is measured from the goal line, as far from centre as that is on this
  // sheet. Written against centre ice, a long sheet reads as "in on net" from its own blue line
  // and the camera runs on ahead of the play.
  const shift = RINK.goalX - RINKS.barn.goalX;
  const attackX = player.x * direction - shift;
  const netView = clamp((attackX - 8) / 14, 0, 1);
  const attackLook = clamp((match.puck.x * direction + 16) / 24, 0, 1);
  const lift = human && match.puck.owner === human.controlled ? human.shotLift : 0;
  const x = clamp(
    match.puck.x * (1 - angle.follow) +
      player.x * angle.follow -
      netView * 0.22 * (match.puck.x - direction * shift) +
      direction * (angle.attackBias + netView * NET_LEAD),
    3 - RINK.goalX,
    RINK.goalX - 3,
  );
  const pan = panRoom();
  const z = clamp(
    match.puck.z * Math.max(0.22, pan / RINK.halfWidth) + (human?.shotAim ?? 0) * netView * 0.55,
    -Math.max(3.4, pan),
    Math.max(3.4, pan),
  );
  const scale = clamp(1.45 / aspect, 1, 2.6) * sheetScale();
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
