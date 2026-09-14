import { attackDirection } from '../game/config';
import { clamp } from '../game/math';
import { cameraUsesAttackUp, type InputFrame, type MatchState, type Settings } from '../game/types';

/** Map a screen-space stick onto the net: lateral is posts, up is shelf. */
export function netAimFromStick(lateral: number, up: number, forcedHigh = false) {
  return {
    aimZ: clamp(lateral, -1, 1),
    shotHeight: forcedHigh ? 1 : clamp((up + 1) / 2, 0, 1),
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

/** Convert screen directions to rink coordinates. Shot aim follows the left stick. */
export function screenInputToRink(
  input: InputFrame,
  match: MatchState,
  camera: Settings['camera'],
): InputFrame {
  const direction = attackDirection(match.homeTeam, match.period);
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
