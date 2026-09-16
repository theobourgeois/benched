import { PerspectiveCamera, Vector3 } from 'three';
import { isOnIce } from '../game/modes';
import { clamp } from '../game/math';
import type { MatchState, Team } from '../game/types';

const _world = new Vector3();
const _view = new Vector3();
/** How far below the frame counts as gone; a shown chip stays a little longer so it doesn't flicker. */
const SHOW_BELOW = -0.9;
const KEEP_BELOW = -0.72;
/** Camera-space depth used to spread a skater who's behind the lens across the bottom edge. */
const BEHIND_DEPTH = 12;

export type PlayerLocator = {
  x: number;
  number: number;
  color: string;
};

/** Screen-space chip for the controlled skater when they're off the bottom of a tracking camera. */
export function playerLocator(
  match: MatchState,
  camera: PerspectiveCamera,
  width: number,
  wasVisible = false,
  anchor: Team = 0,
): PlayerLocator | null {
  if (match.phase !== 'playing') return null;
  const player = match.skaters[match.sides[anchor].controlled];
  if (!player || !isOnIce(match, player)) return null;
  _world.set(player.x, 0.95, player.z);
  _view.copy(_world).applyMatrix4(camera.matrixWorldInverse);
  _world.project(camera);
  const inFront = _view.z < -0.4;
  const below = _world.y < (wasVisible ? KEEP_BELOW : SHOW_BELOW);
  if (inFront && !below) return null;
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const aspect = Math.max(0.5, camera.aspect);
  const nx = inFront
    ? clamp(_world.x, -0.92, 0.92)
    : clamp(_view.x / (BEHIND_DEPTH * tanHalf * aspect), -0.92, 0.92);
  return {
    x: (nx * 0.5 + 0.5) * width,
    number: player.number,
    color: match.teams[player.team].accent,
  };
}
