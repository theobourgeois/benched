import type { InputFrame } from '../game/types';

/**
 * A button press happens once. These two keep that true across the gap between how often intent
 * is sampled and how often it is consumed — a stick read at display rate feeding a simulation at
 * 120 Hz, or a frame that crossed a network and has to stand in until the next one lands.
 */

/** What is left of a frame once a simulation step has taken its presses. */
export const noEdges = (input: InputFrame) => ({
  ...input,
  shoot: false,
  pass: false,
  passRelease: false,
  poke: false,
  saucer: false,
  chip: false,
  deke: false,
  dekeSpecial: null,
  dive: false,
  check: false,
  reach: false,
  switchPlayer: false,
  pause: false,
  celly: null,
});
/**
 * Keep button edges until a simulation step consumes them, even on 240 Hz displays, along with
 * the analog values latched at the moment of the press.
 */
export function mergeEdges(old: InputFrame | null, frame: InputFrame): InputFrame {
  if (!old) return frame;
  return {
    ...frame,
    shoot: frame.shoot || old.shoot,
    shotPower: frame.shoot ? frame.shotPower : old.shotPower,
    shotHeight: frame.shoot ? frame.shotHeight : old.shoot ? old.shotHeight : frame.shotHeight,
    aimZ: frame.shoot ? frame.aimZ : old.shoot ? old.aimZ : frame.aimZ,
    pass: frame.pass || old.pass,
    passRelease: frame.passRelease || old.passRelease,
    poke: frame.poke || old.poke,
    saucer: frame.saucer || old.saucer,
    chip: frame.chip || old.chip,
    deke: frame.deke || old.deke,
    dekeSpecial: frame.dekeSpecial ?? old.dekeSpecial,
    dive: frame.dive || old.dive,
    check: frame.check || old.check,
    checkPower: frame.check ? frame.checkPower : old.checkPower,
    reach: frame.reach || old.reach,
    stickIceX: frame.reach || !old.reach ? frame.stickIceX : old.stickIceX,
    stickIceZ: frame.reach || !old.reach ? frame.stickIceZ : old.stickIceZ,
    switchPlayer: frame.switchPlayer || old.switchPlayer,
    pause: frame.pause || old.pause,
  };
}
