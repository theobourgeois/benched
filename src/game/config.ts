export const RINK = {
  halfLength: 30,
  halfWidth: 13,
  corner: 7,
  goalX: 26,
  goalHalfWidth: 1.8,
  goalHeight: 1.35,
};
export const RULES = {
  periodSeconds: 300,
  periods: 3,
  faceoffSeconds: 3,
  goalSeconds: 4,
  fixedStep: 1 / 120,
};
/** Visual puck size. A real puck is 3.8 cm radius × 2.5 cm thick; this is a bit larger so it still reads from the broadcast camera. */
export const PUCK = {
  radius: 0.085,
  height: 0.038,
  /** Center height while sitting on the ice (ice surface is ~0.012). */
  restY: 0.031,
};
export const PHYSICS = {
  /** Top skating speed. Real NHL pace is about 9 m/s; this runs a touch hotter for arcade feel. */
  maxSpeed: 9.6,
  hustleSpeed: 11.2,
  /** Carrying the puck costs a little top end, so a chaser can close but not walk them down. */
  carrySpeed: 0.965,
  /** Hustling with the puck costs more; a chasing defender can run a carrier down. */
  carryHustle: 0.92,
  /** Forward push in m/s². Hustle earns a higher top end, never a faster first stride. */
  skateAcceleration: 12,
  /** Extra first-stride push after a player switch so a take-over can still close a hit. */
  autoSkatePush: 1.4,
  /** Edges can only redirect this much velocity per second; pace widens the turning circle. */
  edgeAcceleration: 40,
  // Feel tweaks — paste into src/game/config.ts

  /** Tight turns spend speed as the skater loads an edge. */
  carveBleed: 0.0,

  /** Blade alignment at low speed, independently of the torso facing. */
  pivotRate: 12,
  /** A planted hockey stop sheds metres per second, rather than multiplying velocity away. */
  stopDeceleration: 19,
  stopAlign: -0.35,
  coastDrag: 0.22,
  /** Relative edge grip, reduced while reaching out through a deke. */
  edgeGrip: 14,
  dekeGrip: 8,
  backskateSpeed: 0.68,
  hustleDrain: 0.2,
  staminaRecover: 0.14,
  puckDrag: 0.24,
  playerRadius: 0.58,
  pickupRadius: 0.88,
  shotSpeed: 34,
  /** Share of the shooter's skating velocity a released puck carries. */
  puckCarry: 0.23,
  passSpeed: 21,
  /** Dump a pass this far when no teammate is in the aim cone. */
  passDump: 10,
  /** Cosine of the pass aim-assist cone (~47° from the stick). */
  passAssist: 0.68,
  /** Lunge a committed check adds to the checker's speed, before loading. */
  checkLunge: 2.8,
  /** Extra lunge from a fully loaded (pulled-back) check. */
  checkLoadLunge: 1.6,
  /** Ceiling on speed during a lunge. */
  checkLungeCap: 1.4,
  /** How long a committed check is live for, from the flick. */
  checkWindow: 0.46,
  /** The last part of the window is follow-through; contact there is only a bump. */
  checkRecovery: 0.12,
  /** A committed check counts its own drive into the body, not only the relative closing speed. */
  checkDrive: 0.4,
  /** Skating speed that a committed shoulder (side contact) adds as hit power. */
  checkShoulderDrive: 1.18,
  /** Extra shoulder reach while a check is live. */
  checkReach: 0.24,
  /** A flick thrown during a cooldown is held this long and fires when it can. */
  checkBuffer: 0.3,
  /** Lead time for the one-time aim assistance at check launch. */
  hitLockLead: 0.12,
  /** Flat power a committed check adds on top of closing momentum. */
  checkCommit: 1.6,
  /** How much a fully loaded check scales that commitment. */
  checkLoadBonus: 1.25,
  /** Closing power that staggers the victim and knocks the puck loose. */
  checkStumble: 6.0,
  /** Closing power that puts the victim on the ice. */
  checkKnockdown: 9.0,
  /** Incidental collisions never exceed a stumble unless closing this hard (two sprinters head-on). */
  bumpKnockdown: 13,
  /** Incidental closing that staggers whoever was on their heels. */
  bumpStumble: 7,
  /** Squaring up to a hit takes this much off it; it does not cancel the hit. */
  checkBrace: 0.9,
  /** A victim mid-deke or already off balance takes this much more. */
  checkExposed: 1.15,
  /** Reduce impact when the victim is skating away along the contact. */
  checkFromBehind: 0.85,
  /** How far a committed check will pick a target. */
  hitLockRange: 3.8,
  /** Cosine of the lock cone; you have to be flicking at them. */
  hitLockCone: 0.65,
  /** Maximum aim assistance at launch, in radians. The committed path cannot home afterward. */
  checkAimAssist: 0.32,
  /** Stamina a committed check costs; loading costs a little more. */
  checkStamina: 0.06,
  /** Time frozen on a knockdown for impact. */
  hitstop: 0.07,
  /** Blade must be this close to the puck for a poke to lift it. */
  pokeReach: 0.62,
  /** Stick jab on a poke; not a steal from across a body-length. */
  pokeExtend: 0.32,
  /** Extra blade reach while holding a sweep. */
  sweepReach: 0.38,
  chipSpeed: 16.5,
  chipLift: 3.6,
  saucerLift: 4.4,
  chopSpeed: 13,
  diveSpeed: 10.2,
  diveTime: 0.78,
  liftRange: 1.38,
};
/**
 * Goal frame as the arena draws it: post axes at z = ±goalHalfWidth and the crossbar axis at
 * crossbarY, all on the goal line.
 */
export const IRON = {
  radius: 0.065,
  crossbarY: 1.4,
  /** The drawn puck's rim against a post, so a puck that visibly clips the iron rings it. */
  puckRim: PUCK.radius,
  /** The drawn puck's flat face against the crossbar, with a little slack for tilt. */
  puckFace: 0.03,
  restitution: 0.45,
  /** Share of glancing speed the puck keeps along the pipe. */
  friction: 0.9,
  /** Beat the play holds on a bar-down ring, so the ding lands. */
  ringHold: 0.06,
};
/** Shot placement and accuracy. Spread is an angle, so the aim circle grows with distance. */
export const SHOT = {
  /** Highest aim point, just under the crossbar so a slightly high top-shelf shot rings it. */
  topShelf: 1.24,
  /** Widest aim point, inside the posts. */
  corner: 1.46,
  spread: 0.01,
  /** Per m/s of skating across the shot line. */
  spreadLateral: 0.0016,
  spreadBackhand: 0.012,
  spreadPower: 0.005,
  /** Shooting across the body, scaled by how far the shot turns from the skater's facing. */
  spreadFacing: 0.014,
};
/** Blade pose in player space: +side is the skater's left (forehand for a left shot). */
export const STICK = {
  restSide: 0.58,
  restReach: 1.05,
  /** Lower-hand hinge the blade sweeps around on a deke or toe drag. */
  pivotSide: 0.18,
  pivotReach: 0.28,
  /** Natural frequency of the puck follow. Lower feels heavier. */
  omega: 15,
  /** Under 1 leaves follow-through instead of settling on the pose. */
  zeta: 0.68,
  /** How much blade speed pushes the skater sideways. */

  cut: 0.55,
  /** Extra edge while skating with the puck held off-center. */
  drift: 1.15,
};
export const DEFAULT_PHYSICS = Object.freeze({ ...PHYSICS });
export const DEFAULT_STICK = Object.freeze({ ...STICK });
export const EMPTY_INPUT = {
  moveX: 0,
  moveZ: 0,
  stickX: 0,
  stickY: 0,
  shoot: false,
  shotPower: 0,
  pass: false,
  passHeld: false,
  passRelease: false,
  poke: false,
  pokeHeld: false,
  saucer: false,
  chip: false,
  deke: false,
  dekeSpecial: null,
  dive: false,
  check: false,
  checkPower: 0,
  block: false,
  stickIceX: 0,
  stickIceZ: 0,
  switchPlayer: false,
  hustle: false,
  backskate: false,
  pause: false,
};
export const attackDirection = (team: number, period: number) =>
  (team === 0 ? 1 : -1) * (period === 2 ? -1 : 1);
