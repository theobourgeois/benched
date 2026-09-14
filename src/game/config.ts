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
  acceleration: 21,
  maxSpeed: 8.8,
  hustleSpeed: 11.5,
  /** Glide when the stick is released. Ice should carry you; it should not feel like running. */
  coastDrag: 0.58,
  /** Opposite-stick hockey stop. */
  stopDrag: 9.2,
  /** Speed bled on a hard cut at pace. */
  cutDrag: 1.55,
  drag: 2.8,
  puckDrag: 0.24,
  playerRadius: 0.58,
  pickupRadius: 0.88,
  shotSpeed: 34,
  passSpeed: 20,
  /** Dump a pass this far when no teammate is in the aim cone. */
  passDump: 10,
  /** Cosine of the pass aim-assist cone (~47° from the stick). */
  passAssist: 0.68,
  /** Distance at which another skater counts as traffic for rush catch-up. */
  rushClear: 2.15,
  /** How fast unused rush eases toward current speed in traffic. */
  rushCrowdDecay: 2.6,
  /** Speed that starts to look like a real check for lean / lock animation. */
  checkMinRush: 6.0,
  /** Fraction of speed that must point at the opponent to throw a left-stick hit. */
  checkMinApproach: 0.16,
  /** Body-check power that knocks the puck loose and staggers. */
  checkStumble: 7.2,
  /** Open-ice power that puts the victim on the ice. */
  checkKnockdown: 8.8,
  /** Squaring up shortens the slide; it does not cancel the hit. */
  checkBrace: 0.85,
  /** Alignment below this, without a committed check, is a glancing blow. */
  checkGlance: 0.34,
  /** How far a committed check will magnet toward an opponent. */
  hitLockRange: 5.8,
  /** Cosine of the lock cone — skating at them, not past them. */
  hitLockCone: 0.32,
  /** Lateral miss a finishing check will still catch. */
  hitLockCatch: 1.7,
  /** How quickly velocity turns onto the lock. */
  hitLockSteer: 13,
  /** Close-range snap that turns an inch-miss into a hit. */
  hitLockSnap: 17,
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
