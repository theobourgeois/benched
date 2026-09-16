import { attackDirection } from '../game/config';
import { clamp } from '../game/math';
import {
  cameraUsesAttackUp,
  type InputFrame,
  type MatchState,
  type Settings,
  type Team,
} from '../game/types';

/**
 * Map a screen-space stick onto the net: lateral is posts, up is shelf. The round stick gate is
 * stretched to the square net, so a full diagonal reaches the top corner.
 */
export function netAimFromStick(lateral: number, up: number, forcedHigh = false) {
  const edge = Math.max(Math.abs(lateral), Math.abs(up)),
    stretch = edge > 1e-3 ? Math.min(1, Math.hypot(lateral, up) / 0.9) / edge : 0;
  return {
    aimZ: clamp(lateral * stretch, -1, 1),
    shotHeight: forcedHigh ? 1 : clamp((up * stretch + 1) / 2, 0, 1),
  };
}

/** Right-stick direction on the ice: screen up is the attacking net. */
export function screenStickToIce(
  stickX: number,
  stickY: number,
  direction: number,
  attackUp: boolean,
) {
  if (!attackUp) return { stickIceX: stickX, stickIceZ: stickY };
  return { stickIceX: -stickY * direction, stickIceZ: stickX * direction };
}

/**
 * Convert screen directions to rink coordinates. Shot aim follows the left stick.
 *
 * `anchor` is the side the camera is framing, not necessarily the side holding the stick: two
 * people on one screen share an orientation, so both map through the same anchor or one of them
 * would find up-screen sending them backwards.
 */
export function screenInputToRink(
  input: InputFrame,
  match: MatchState,
  camera: Settings['camera'],
  anchor: Team = 0,
): InputFrame {
  const direction = attackDirection(anchor, match.period);
  const forcedHigh = (input.shotHeight ?? 0) >= 1;
  const attackUp = cameraUsesAttackUp(camera);
  const ice = screenStickToIce(input.stickX, input.stickY, direction, attackUp);
  if (!attackUp)
    return {
      ...input,
      ...ice,
      ...netAimFromStick(input.moveZ, input.moveX * direction, forcedHigh),
    };
  return {
    ...input,
    ...ice,
    moveX: -input.moveZ * direction,
    moveZ: input.moveX * direction,
    ...netAimFromStick(input.moveX * direction, -input.moveZ, forcedHigh),
  };
}
