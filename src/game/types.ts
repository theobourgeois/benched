import type { Club } from './clubs';
export type Team = 0 | 1;
export type Jersey = 'home' | 'away';
export type GameMode = 'exhibition' | 'threeOnThree' | 'oneOnOne' | 'shootout' | 'freeSkate';
export type Phase = 'menu' | 'faceoff' | 'playing' | 'goal' | 'intermission' | 'paused' | 'final';
export type DekeKind =
  'stride' | 'burst' | 'protect' | 'jump' | 'throughLegs' | 'windmill' | 'spin';
export type DekeSpecial = 'jump' | 'throughLegs' | 'windmill' | 'spin';
export type CellyKind = 'helicopter' | 'jump' | 'limp' | 'dance';
/** What a goalie committed to, or what the puck met. */
export type SaveKind = 'butterfly' | 'pad' | 'glove' | 'blocker' | 'body' | 'stick';
export interface Vec2 {
  x: number;
  z: number;
}
export interface Skater extends Vec2 {
  id: number;
  team: Team;
  role: 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G';
  number: number;
  name: string;
  vx: number;
  vz: number;
  angle: number;
  stamina: number;
  cooldown: number;
  /** Shoulder lean while finishing a hit. */
  checkTimer: number;
  stride: number;
  /** Actual push effort and signed edge load, used by the skating pose. */
  skateDrive: number;
  edgeLean: number;
  downTimer: number;
  /** Knocked off balance by a check: coasting with little control, unable to play the puck. */
  stumbleTimer: number;
  /** Smoothed skating speed, for animation and audio. Hit power comes from real closing speed. */
  rush: number;
  /** Opponent used for aim assistance at launch, or -1; never tracked in flight. */
  hitLock: number;
  /** How far the current check was loaded, 0 to 1. */
  checkPower: number;
  /** The live check already connected; the follow-through is not a whiff. */
  checkLanded: boolean;
  /** A flick thrown while unavailable, waiting to fire. */
  queuedCheck: { x: number; z: number; load: number; timer: number } | null;
  hitImmunity: number;
  fallAngle: number;
  /** Blade offset to the skater's left (+) or right (−). */
  stickSide: number;
  /** Blade distance in front of the skater. */
  stickReach: number;
  stickSideVel: number;
  stickReachVel: number;
  shotTimer: number;
  /** Charged-shot animation commits briefly before releasing the puck at blade contact. */
  pendingShot?: {
    timer: number;
    load: number;
    power: number;
    aim: number;
    height: number;
    tick: number;
  } | null;
  /** Committed save: how long it holds, what it is, and where in the goalie's frame it reaches. */
  saveTimer?: number;
  saveKind?: SaveKind | null;
  /** Metres toward the glove (their left); tracks the body as it pushes across. */
  saveSide?: number;
  saveHeight?: number;
  /** Reading a shot; the save commits when it runs out. */
  readTimer?: number;
  /** Holding a covered puck. Opponents cannot poke a frozen puck. */
  coverTimer?: number;
  /** Recorded with the simulation so action clips are stable during replay and seeking. */
  shotStyle?: 'wrist' | 'slap' | 'backhand' | 'pass';
  shotDuration?: number;
  shotSide?: number;
  shotReach?: number;
  /** Windup load held at release; the pose unwinds it through the shot instead of snapping. */
  shotLoad?: number;
  /** Window after a tape-to-tape catch where a one-timer is live. */
  passTimer: number;
  /** Dive-block window: flop onto the ice, then ragdoll; still a shot block. */
  diveTimer: number;
  /** Stick held in a passing lane. */
  blockTimer: number;
  /** Stick-lift steal animation. */
  liftTimer: number;
  dekeKind: DekeKind | null;
  dekeTimer: number;
  /** Player's right is +1, left is −1. */
  dekeDir: number;
  /** Post-goal celebration clip. */
  cellyKind: CellyKind | null;
  cellyTimer: number;
}
export interface Puck extends Vec2 {
  y: number;
  vx: number;
  vz: number;
  vy: number;
  owner: number | null;
  lastTouch: Team | null;
  lockout: number;
  shot: boolean;
  /** Aimed tape-to-tape receiver while the pass is still live; dumps and shots leave this empty. */
  passTo: number | null;
}
export interface InputFrame {
  moveX: number;
  moveZ: number;
  stickX: number;
  stickY: number;
  shoot: boolean;
  shotPower: number;
  aimZ?: number;
  shotHeight?: number;
  toeDrag?: boolean;
  pass: boolean;
  /** True while RT / Space is held so a pass can be aimed. */
  passHeld: boolean;
  /** True on the frame the pass button is released. */
  passRelease: boolean;
  poke: boolean;
  /** RB held for a sweep poke. */
  pokeHeld: boolean;
  /** RB tap with the puck: lifted saucer pass. */
  saucer: boolean;
  /** RB + skill-stick flick: dump, chip-in, or chop a loose puck. */
  chip: boolean;
  /** RB + left stick: one-touch deke in the skate direction. */
  deke: boolean;
  /** RB + skill-stick or LT specials. */
  dekeSpecial: DekeSpecial | null;
  /** LB + RB without the puck. */
  dive: boolean;
  /** Skill-stick flick without the puck: committed body check. */
  check: boolean;
  /** How far the stick was pulled back before the flick, 0 to 1. */
  checkPower?: number;
  /** Skill-stick flick as a goalie: throw a glove, blocker or pad at the flicked side. */
  reach: boolean;
  /** LB held without the puck: block a pass or shot. */
  block: boolean;
  /** Right stick in rink space, used for chips and checks. */
  stickIceX: number;
  stickIceZ: number;
  switchPlayer: boolean;
  hustle: boolean;
  backskate: boolean;
  pause: boolean;
  /** Face-button celly after a goal: A chopper, X leap, Y dance, B limp. */
  celly: CellyKind | null;
}
export interface GameEvent {
  id: number;
  type: 'shot' | 'pass' | 'hit' | 'goal' | 'post' | 'crossbar' | 'save' | 'faceoff' | 'horn';
  power: number;
  /** Where it happened on the ice, when it was not the puck. */
  x?: number;
  z?: number;
  /** A crossbar ring dropping into the net, and the goal it becomes. */
  barDown?: boolean;
}
export interface MatchState {
  mode: GameMode;
  phase: Phase;
  previousPhase: Phase;
  period: number;
  clock: number;
  countdown: number;
  score: [number, number];
  shots: [number, number];
  hits: [number, number];
  skaters: Skater[];
  puck: Puck;
  controlled: number;
  /** After a defensive switch, keep skating at the play while the left stick is quiet. */
  autoSkate: boolean;
  homeTeam: Team;
  /** Club on each side. Side 0 has home ice. */
  teams: [Club, Club];
  /** Which uniform each side wears. */
  jerseys: [Jersey, Jersey];
  /** How hard opposing CPUs play. The player's teammates stay All-Star. */
  difficulty: Difficulty;
  scoringTeam: Team | null;
  shotCharge: number;
  /** Left-stick shot aim across the net, −1 (right post from behind) to 1. */
  shotAim: number;
  /** Shot height on the net, 0 (ice) to 1 (top shelf). */
  shotLift: number;
  /** Holding the pass button with the puck, ready to aim. */
  passHeld: boolean;
  /** Aimed pass direction on the ice. */
  passAim: Vec2;
  /** Intended receiver while aiming, or null for a dump into space. */
  passTarget: number | null;
  /** Ice-arrow length while aiming a pass. */
  passRange: number;
  tick: number;
  /** Seconds the simulation holds still after a knockdown, for impact. */
  hitstop: number;
  /** Tick the puck last rang the crossbar, or -1. */
  barTick: number;
  events: GameEvent[];
  notice: string;
  noticeTimer: number;
  possession: [number, number];
  /** Faceoff countdown remaining when the player struck; -1 if they have not. */
  drawInput: number;
  /** Team currently taking a shootout attempt. */
  shootoutShooter: Team;
  /** 1-based shootout round, including sudden death. */
  shootoutRound: number;
  /** Shootout attempts taken by each team. */
  shootoutTaken: [number, number];
}
export type Difficulty = 'rookie' | 'pro' | 'allStar' | 'legend';
export type CameraMode = 'broadcast' | 'tight' | 'high' | 'wide';
export function cameraUsesAttackUp(camera: CameraMode) {
  switch (camera) {
    case 'wide':
      return false;
    case 'broadcast':
    case 'tight':
    case 'high':
      return true;
    default: {
      const _exhaustive: never = camera;
      return _exhaustive;
    }
  }
}
export interface Settings {
  sound: boolean;
  camera: CameraMode;
  quality: 'high' | 'low';
  /** Shot target in the net and pass-lane arrow. */
  beginner: boolean;
  difficulty: Difficulty;
  /** Replay the build-up after a goal; any button skips it. */
  goalReplays: boolean;
  /** Frame counter in the corner of the ice. */
  showFps: boolean;
  /** Button prompts along the bottom of menus. */
  hints: boolean;
}
