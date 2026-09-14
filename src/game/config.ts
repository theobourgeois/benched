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
  hustleSpeed: 12.2,
  /** Carrying the puck costs a little top end, so a chaser can close but not walk them down. */
  carrySpeed: 0.965,
  /** Hustling with the puck costs more; a chasing defender can run a carrier down. */
  carryHustle: 0.92,
  /** Exponential approach rate toward the stick's speed at a standstill; the first strides bite. */
  launchRate: 2.4,
  /** How much of that rate is lost as you near top speed; the last metre per second is earned. */
  topEndTaper: 1.0,
  /** Heading turn rate near a standstill (rad/s): pivots are instant. */
  turnRateLow: 14,
  /** Heading turn rate at top speed (rad/s): about a 2.5 m carve radius. */
  turnRateHigh: 4.8,
  /** Extra turn-rate loss while hustling; a sprinting skater is a train. */
  hustleTurn: 0.9,
  /** How quickly sideways slip is bitten off by the edges. Lower lets the skater drift. */
  edgeGrip: 14,
  /** Grip while the puck is being thrown wide on a deke; the skater rides an edge. */
  dekeGrip: 2.2,
  /** Speed scrubbed per radian of carve at top speed. */
  carveBleed: 0.1,
  /** Glide when the stick is released. Ice should carry you; it should not feel like running. */
  coastDrag: 0.42,
  /** Opposite-stick hockey stop. */
  stopDrag: 7.5,
  /** Turn-rate multiplier while stopping, so the skater swings around as they bite. */
  stopPivot: 2.4,
  /** Fraction of speed that must oppose the stick to read as a stop instead of a carve. */
  stopAlign: -0.35,
  drag: 2.8,
  backskateSpeed: 0.68,
  hustleDrain: 0.2,
  staminaRecover: 0.14,
  puckDrag: 0.24,
  playerRadius: 0.58,
  pickupRadius: 0.88,
  shotSpeed: 34,
  passSpeed: 21,
  /** Dump a pass this far when no teammate is in the aim cone. */
  passDump: 10,
  /** Cosine of the pass aim-assist cone (~47° from the stick). */
  passAssist: 0.68,
  /** Lunge a committed check adds to the checker's speed, before loading. */
  checkLunge: 4.4,
  /** Extra lunge from a fully loaded (pulled-back) check. */
  checkLoadLunge: 2.2,
  /** Ceiling on speed during a lunge. */
  checkLungeCap: 1.4,
  /** How long a committed check is live for, from the flick. */
  checkWindow: 0.5,
  /** The last part of the window is follow-through; contact there is only a bump. */
  checkRecovery: 0.12,
  /** A committed check counts its own drive into the body, not only the relative closing speed. */
  checkDrive: 0.4,
  /** Extra shoulder reach while a check is live. */
  checkReach: 0.35,
  /** A flick thrown during a cooldown is held this long and fires when it can. */
  checkBuffer: 0.3,
  /** How far ahead a live check leads a moving target. */
  hitLockLead: 0.12,
  /** Flat power a committed check adds on top of closing momentum. */
  checkCommit: 1.6,
  /** How much a fully loaded check scales that commitment. */
  checkLoadBonus: 0.6,
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
  /** Hitting someone skating away from you is a shove, not a hit. */
  checkFromBehind: 0.85,
  /** How far a committed check will pick a target. */
  hitLockRange: 5,
  /** Cosine of the lock cone; you have to be flicking at them. */
  hitLockCone: 0.2,
  /** How quickly a live check steers onto its target. */
  hitLockSteer: 16,
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
export const TEAMS = [
  {
    name: 'Northstar',
    city: 'HALIFAX',
    abbr: 'NTH',
    color: '#8bb8e8',
    dark: '#173d65',
    short: 'N',
  },
  {
    name: 'Redline',
    city: 'MONTRÉAL',
    abbr: 'RED',
    color: '#e74b59',
    dark: '#651c2a',
    short: 'R',
  },
] as const;
/** Team crest vector paths on an 80×80 grid, shared by the HUD logos and jersey crests. */
export const TEAM_MARKS = [
  {
    body: 'M40 7L47 27L69 21L55 40L71 57L49 54L40 75L32 54L10 58L24 40L11 22L33 27Z',
    inner: 'M30 48L36 29H42L39 39L49 29H55L42 49H36L39 40L32 49Z',
    innerColor: '#25342a',
    underline: null,
  },
  {
    body: 'M18 13H51L68 27L58 43L66 65H46L38 47H31L26 65H9Z',
    inner: 'M34 26H49L44 34H32Z',
    innerColor: '#4a2b29',
    underline: 'M5 70H64',
  },
] as const;
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
