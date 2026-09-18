import type { InputFrame } from './types';
export const RINK = {
  halfLength: 30,
  halfWidth: 13,
  corner: 7,
  goalX: 26,
  goalHalfWidth: 1.8,
  goalHeight: 1.35,
};
export const RULES = {
  /** What a period shows on the clock. It runs faster than real time; see `clockRate`. */
  periodSeconds: 1200,
  /** Real seconds a 5-on-5 period takes to play. */
  playSeconds: 180,
  /** The last seconds of a period run at real speed, so a late rush is not over in a blink. */
  realTimeFinish: 10,
  periods: 3,
  faceoffSeconds: 3,
  goalSeconds: 6,
  fixedStep: 1 / 120,
};
/** Seconds at the end of a knockdown spent getting back up. */
export const GET_UP = 0.8;
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
  /** Carrying the puck costs a little top end in traffic. A rushing carrier with a beaten
   * defender behind them strides at full speed. */
  carrySpeed: 0.965,
  /** Hustling with the puck costs more in traffic. Beaten defenders on a rush cannot exceed
   * open-ice hustle, so they cannot outskate a breakaway from behind. */
  carryHustle: 0.92,
  /** Forward push in m/s². Hustle earns a higher top end, never a faster first stride. */
  skateAcceleration: 12,
  /** Extra first-stride push after a player switch so a take-over can still close a hit. */
  autoSkatePush: 1.4,
  /** Edges can only redirect this much velocity per second; pace widens the turning circle. */
  edgeAcceleration: 40,
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
  /** Opponent must be this close to smother a tape-to-tape pass; occupying the lane is not enough. */
  passIntercept: 0.42,
  /** Teammates can take a lifted pass this high, so a hop over a body still lands on tape. */
  passCatchHeight: 1.12,
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
  /** Half-width of the lane a poke covers: how far off the aimed line the puck can sit. */
  pokeReach: 0.45,
  /** How far from the body the jab reaches along the aim; not a steal from across a body-length. */
  pokeLength: 1.95,
  /** Visual stick jab on a poke. */
  pokeExtend: 0.32,
  /** Cosine limit between the aim and the body's facing; pokes further round than this use the blade line. */
  pokeCone: -0.1,
  /** Speed the poked puck leaves the carrier's blade at, and how much of it goes off to the side. */
  pokeKick: 3.6,
  pokeOff: 0.7,
  /** Seconds the poked carrier cannot touch the puck. */
  pokeRecover: 0.4,
  /** Extra blade reach and lane width while holding a sweep. */
  sweepReach: 0.38,
  sweepLane: 0.2,
  /** A carrier whose body is this close to the poker's line to the puck is shielding it. */
  pokeShield: 0.4,
  chipSpeed: 16.5,
  chipLift: 3.6,
  saucerLift: 4.4,
  chopSpeed: 13,
  diveSpeed: 10.2,
  /** Seconds on the ice as a shot block: dive onto the ice, then limp. */
  diveTime: 1.15,
  /** Committed flop onto the ice before the body goes limp. */
  diveLand: 0.32,
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
  spread: 0.018,
  /** Per m/s of skating across the shot line. */
  spreadLateral: 0.0016,
  spreadBackhand: 0.012,
  spreadPower: 0.02,
  /** Shooting across the body, scaled by how far the shot turns from the skater's facing. */
  spreadFacing: 0.014,
};
/** Blade pose in player space: +side is the skater's left (forehand for a left shot). */
export const STICK = {
  restSide: 0.58,
  /**
   * How far ahead the puck rides. With the rigid stick's lie and the forward lean, closer than this
   * leaves the top hand nowhere to go but into the belly or up by the chin.
   */
  restReach: 1.3,
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
/**
 * Goalie coverage and movement. Distances are in the goalie's frame: `side` is toward the glove
 * (their left), height is off the ice. A save is what the puck meets on the save plane.
 */
export const GOALIE = {
  /** The save plane sits this far in front of the goalie's centre, where pads and hands are. */
  plane: 0.3,
  /** Inside this radius of the centre the puck is on the body, whatever it was doing. */
  body: 0.42,
  /** Half-width of the torso, standing. Nothing gets through it. */
  bodyHalf: 0.44,
  /** Standing pads and skates. */
  padStand: 0.68,
  padStandHeight: 0.5,
  /** Share of the difficulty's reach scale applied to the standing stance as well. */
  standScale: 1,
  /** Butterfly pads at full extension, a pad stacked out to one side, and how high they cover. */
  padReach: 0.95,
  padStack: 1.25,
  padHeight: 0.52,
  /** Mitt-and-forearm radius, how far a hand can be thrown, and how high. */
  hand: 0.33,
  handReach: 1.25,
  reachTop: 1.5,
  /** Paddle on the ice in front of the skates. */
  stickHalf: 0.55,
  stickHeight: 0.16,
  /** Time from commitment to full extension. The rest of the save is a hold and a recovery. */
  extend: 0.18,
  /** Hand travel that takes the whole `extend`; shorter reaches are quicker, longer ones slower,
   * within these shares of it. */
  reachFull: 0.85,
  reachQuick: 0.35,
  reachSlow: 1.3,
  /** Share of the reaction time a set goalie needs against a shooter in close, how far off the
   * angle still counts as set, and the range inside which the head start starts to build. */
  setRead: 0.75,
  squareSlack: 0.35,
  setRange: 9,
  /** How far off the goal line the goalie plays a puck at their feet, and how much further out
   * per metre of range, up to the top of the crease and beyond. */
  depthMin: 0.75,
  depthRate: 0.075,
  /** Seconds of puck travel the goalie plays ahead of, so a cut across is met rather than chased. */
  lead: 0.16,
  /** Distance off their spot at which a CPU goalie stops shuffling and pushes across. */
  pushGap: 0.7,
  /** Seconds of their own speed a CPU goalie brakes ahead by, so a push across stops on the spot. */
  brake: 0.14,
  /** A carrier this close, moving the puck across at this speed, draws a pad slide after this share
   * of the reaction time. */
  dekeRange: 3.2,
  dekeSpeed: 3,
  /** How far ahead, in seconds of puck travel, the goalie reads a move across. */
  dekeLook: 0.3,
  dekeRead: 1,
  /** Tail of the save spent getting back up, with less to offer. */
  recover: 0.3,
  /** Early in a commit the body pushes toward the shot for this long. */
  push: 0.34,
  /** A shot arriving within this many seconds gets read. */
  readAhead: 1.1,
  /** Lateral shuffle, the explosive push across, and how quickly the shuffle answers the stick. */
  shuffleSpeed: 5.4,
  pushSpeed: 9,
  response: 7,
  /** Sliding on the pads bleeds speed. */
  slideDrag: 3.5,
  /** Share of shuffle speed while carrying the puck. */
  carry: 0.62,
  /** Loose pucks slower than this can be smothered; chest shots slower than `smother` are held. */
  coverSpeed: 7,
  coverReach: 0.98,
  smother: 24,
  /** A covered puck is frozen this long before it is played: by the CPU, or for you by your
   * goalie if you have not moved it yourself. */
  hold: 0.8,
  humanHold: 2.2,
  /** Visual scale over a skater. A goalie in gear is a bigger silhouette. */
  bulk: 1.07,
};
/** Goalie paddle rest pose in player space, so the puck rides on the paddle when carried. */
export const GOALIE_STICK = { side: -0.1, reach: 0.72 };
export const DEFAULT_PHYSICS = Object.freeze({ ...PHYSICS });
export const DEFAULT_GOALIE = Object.freeze({ ...GOALIE });
export const DEFAULT_STICK = Object.freeze({ ...STICK });
export const EMPTY_INPUT: InputFrame = {
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
  reach: false,
  block: false,
  stickIceX: 0,
  stickIceZ: 0,
  switchPlayer: false,
  hustle: false,
  backskate: false,
  pause: false,
  celly: null,
};
export const attackDirection = (team: number, period: number) =>
  (team === 0 ? 1 : -1) * (period === 2 ? -1 : 1);
