export type Team = 0 | 1;
export type GameMode = 'exhibition' | 'threeOnThree' | 'oneOnOne' | 'shootout' | 'freeSkate';
export type Phase = 'menu' | 'faceoff' | 'playing' | 'goal' | 'intermission' | 'paused' | 'final';
export type DekeKind =
  'stride' | 'burst' | 'protect' | 'jump' | 'throughLegs' | 'windmill' | 'spin';
export type DekeSpecial = 'jump' | 'throughLegs' | 'windmill' | 'spin';
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
  downTimer: number;
  /** Knocked off balance by a check: coasting with little control, unable to play the puck. */
  stumbleTimer: number;
  /** Smoothed skating speed. Feeds hit power; it is not a gate on who can check. */
  rush: number;
  /** Opponent the current check is locked onto, or -1. */
  hitLock: number;
  hitImmunity: number;
  fallAngle: number;
  /** Blade offset to the skater's left (+) or right (−). */
  stickSide: number;
  /** Blade distance in front of the skater. */
  stickReach: number;
  stickSideVel: number;
  stickReachVel: number;
  shotTimer: number;
  /** Window after a tape-to-tape catch where a one-timer is live. */
  passTimer: number;
  /** Belly-flop block; player is sliding, not ragdolled. */
  diveTimer: number;
  /** Stick held in a passing lane. */
  blockTimer: number;
  /** Stick-lift steal animation. */
  liftTimer: number;
  dekeKind: DekeKind | null;
  dekeTimer: number;
  /** Player's right is +1, left is −1. */
  dekeDir: number;
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
  /** LB held without the puck: block a pass or shot. */
  block: boolean;
  /** Right stick in rink space, used for chips and checks. */
  stickIceX: number;
  stickIceZ: number;
  switchPlayer: boolean;
  hustle: boolean;
  backskate: boolean;
  pause: boolean;
}
export interface GameEvent {
  id: number;
  type: 'shot' | 'pass' | 'hit' | 'goal' | 'post' | 'save' | 'faceoff' | 'horn';
  power: number;
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
  homeTeam: Team;
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
}
