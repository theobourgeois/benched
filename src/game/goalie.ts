import { attackDirection, GOALIE, IRON, RINK } from './config';
import { GOALIE_SAVE_TIME } from './actionTiming';
import { clamp } from './math';
import type { MatchState, Puck, SaveKind, Skater, Vec2 } from './types';

/**
 * Goalie model. The goalie is a set of parts in their own frame (side toward the glove, height off
 * the ice): body, standing pads, paddle, and two hands. A shot is read, then committed to, and the
 * commitment throws the hands and pads toward where the puck will cross the save plane. What the
 * puck meets there decides the rebound: a glove catches, a blocker steers to the corner, pads kick
 * it wide, a soft chest shot is smothered.
 */

/** Goalies face away from their own net, toward the play. */
export const goalieFacing = (s: MatchState, g: Skater) =>
  attackDirection(g.team, s.period) > 0 ? Math.PI / 2 : -Math.PI / 2;

/** A point in the goalie's frame: `side` toward the glove (their left), `depth` in front. */
export function goalieFrame(g: Skater, x: number, z: number) {
  const fx = Math.sin(g.angle),
    fz = Math.cos(g.angle),
    dx = x - g.x,
    dz = z - g.z;
  return { side: dx * fz - dz * fx, depth: dx * fx + dz * fz };
}

/**
 * Where the goalie's angle line crosses `depth` out from the goal line, for a puck `ahead` of the
 * line and `lateral` across it. The line bisects the angle the posts make at the puck, which is
 * what a goalie means by square: off-centre, it leans toward the short side instead of splitting
 * the net down the middle and leaving the near post bare.
 */
export function angleLine(ahead: number, lateral: number, depth: number) {
  const half = RINK.goalHalfWidth;
  const near = Math.hypot(ahead, half - lateral),
    far = Math.hypot(ahead, -half - lateral);
  const bx = -ahead / near - ahead / far,
    bz = (half - lateral) / near + (-half - lateral) / far;
  if (bx > -1e-6) return lateral;
  return lateral + (bz * (depth - ahead)) / bx;
}

/** Rink direction of the goalie's glove side. */
export function gloveSide(g: Skater): Vec2 {
  return { x: Math.cos(g.angle), z: -Math.sin(g.angle) };
}

export interface Arrival {
  /** Seconds until the puck reaches the save plane. */
  t: number;
  side: number;
  height: number;
  /** Closing speed toward the goalie. */
  speed: number;
}

/** Where a loose puck will cross the save plane, or null if it is not coming. */
export function shotArrival(g: Skater, puck: Puck, ahead = GOALIE.plane): Arrival | null {
  const fx = Math.sin(g.angle),
    fz = Math.cos(g.angle);
  const speed = -(puck.vx * fx + puck.vz * fz);
  if (speed < 1) return null;
  const { side, depth } = goalieFrame(g, puck.x, puck.z);
  const t = (depth - ahead) / speed;
  if (t < 0) return null;
  const lateral = puck.vx * fz - puck.vz * fx;
  return {
    t,
    side: side + lateral * t,
    height: Math.max(0, puck.y + puck.vy * t - 4.9 * t * t),
    speed,
  };
}

/** A shot that will land on or just around the net, close enough to react to. */
export function onNet(arrival: Arrival | null): arrival is Arrival {
  return (
    !!arrival &&
    arrival.t < GOALIE.readAhead &&
    arrival.speed > 5 &&
    Math.abs(arrival.side) < RINK.goalHalfWidth + 0.7 &&
    arrival.height < IRON.crossbarY + 0.5
  );
}

/** What to throw at a puck arriving at (side, height). */
export function pickSaveKind(side: number, height: number): SaveKind {
  if (height < GOALIE.padHeight) return Math.abs(side) < 0.55 ? 'butterfly' : 'pad';
  if (Math.abs(side) < GOALIE.bodyHalf * 0.8 && height < 1.25) return 'body';
  return side > 0 ? 'glove' : 'blocker';
}

export function commitSave(g: Skater, kind: SaveKind, side: number, height: number) {
  g.saveTimer = GOALIE_SAVE_TIME;
  g.saveKind = kind;
  g.saveSide = clamp(side, -GOALIE.handReach, GOALIE.handReach);
  g.saveHeight = clamp(height, 0, GOALIE.reachTop);
  g.readTimer = 0;
}

export const committed = (g: Skater) => (g.saveTimer ?? 0) > 0 && !!g.saveKind;
/** Down on the pads: butterfly or pad stack, once the push across has been spent. */
export const onPads = (g: Skater) =>
  committed(g) &&
  (g.saveKind === 'butterfly' || g.saveKind === 'pad') &&
  (g.saveTimer ?? 0) < GOALIE_SAVE_TIME - GOALIE.push;
/** A committed save can be replaced once the body starts coming back. */
export const canRecommit = (g: Skater) => (g.saveTimer ?? 0) <= GOALIE.recover;
/**
 * Seconds from commitment to full extension. A hand flicked a hand-width to the near post or a pad
 * kicked just past the stance gets there almost at once; a full stretch to the far corner takes
 * the whole `extend` or longer. The butterfly is a drop and always takes the same time.
 */
export function reachTime(g: Skater) {
  const kind = g.saveKind;
  if (kind === 'body') return GOALIE.extend * GOALIE.reachQuick;
  if (kind === 'pad') {
    const travel =
      Math.max(0, Math.abs(g.saveSide ?? 0) - GOALIE.padStand) /
      (GOALIE.padStack - GOALIE.padStand);
    return GOALIE.extend * clamp(travel, GOALIE.reachQuick, 1);
  }
  if (kind !== 'glove' && kind !== 'blocker') return GOALIE.extend;
  const rest = kind === 'glove' ? GLOVE_REST : BLOCKER_REST,
    sign = kind === 'glove' ? 1 : -1;
  const travel = Math.hypot(
    Math.max(0.2, (g.saveSide ?? 0) * sign) * sign - rest.side,
    Math.max(0.35, g.saveHeight ?? rest.height) - rest.height,
  );
  return GOALIE.extend * clamp(travel / GOALIE.reachFull, GOALIE.reachQuick, GOALIE.reachSlow);
}
/** How far the hands and pads have got toward the committed point, 0 to 1. */
export function extension(g: Skater) {
  if (!committed(g)) return 0;
  const elapsed = GOALIE_SAVE_TIME - (g.saveTimer ?? 0);
  return clamp(elapsed / reachTime(g), 0, 1);
}
/** Coming back up from a save; the parts are on their way home. */
export const recovering = (g: Skater) => committed(g) && (g.saveTimer ?? 0) < GOALIE.recover;

/** Early in a commit the body pushes across toward the shot. Rink-space move, or null. */
export function savePush(g: Skater): Vec2 | null {
  if (!committed(g) || (g.saveTimer ?? 0) < GOALIE_SAVE_TIME - GOALIE.push) return null;
  // The reach tracks the body, so this fades out once the body is behind the puck.
  const side = g.saveSide ?? 0;
  const drive = clamp((Math.abs(side) - 0.35) / 0.5, 0, 1);
  if (drive <= 0) return null;
  const left = gloveSide(g);
  const sign = Math.sign(side);
  return { x: left.x * sign * drive, z: left.z * sign * drive };
}

/** A committed reach keeps pointing at the same spot on the ice as the body moves under it. */
export function trackSaveSide(g: Skater, fromX: number, fromZ: number) {
  if (!committed(g)) return;
  g.saveSide = (g.saveSide ?? 0) + goalieFrame(g, fromX, fromZ).side;
}

const GLOVE_REST = { side: 0.34, height: 0.92 },
  BLOCKER_REST = { side: -0.36, height: 0.86 };

function handAt(rest: { side: number; height: number }, g: Skater, kind: SaveKind) {
  const drop = onPads(g) ? 0.3 * extension(g) : 0;
  if (g.saveKind !== kind)
    return { side: rest.side, height: rest.height - drop, radius: GOALIE.hand };
  const ext = extension(g),
    target = { side: g.saveSide ?? 0, height: g.saveHeight ?? rest.height };
  const sign = kind === 'glove' ? 1 : -1;
  return {
    side: rest.side + (Math.max(0.2, target.side * sign) * sign - rest.side) * ext,
    height: rest.height + (Math.max(0.35, target.height) - rest.height) * ext,
    radius: GOALIE.hand * (1 + 0.25 * ext),
  };
}

/**
 * The part of the goalie a puck meets at (side, height) on the save plane, or null if it is past
 * them. `reach` scales the hands and pads (difficulty); a body coming back up offers less.
 */
export function coverage(g: Skater, side: number, height: number, reach: number): SaveKind | null {
  const ext = extension(g),
    back = recovering(g) ? 0.75 : 1,
    kind = committed(g) ? g.saveKind! : null;
  const lean = kind === 'glove' || kind === 'blocker' ? Math.sign(g.saveSide ?? 0) * 0.12 * ext : 0;
  for (const hand of ['glove', 'blocker'] as const) {
    const at = handAt(hand === 'glove' ? GLOVE_REST : BLOCKER_REST, g, hand);
    const radius = at.radius * reach * (kind === hand ? 1 : back);
    if (Math.hypot(side - at.side, height - at.height) < radius) return hand;
  }
  const down = kind === 'butterfly' || kind === 'pad' ? ext : 0;
  if (Math.abs(side - lean) < GOALIE.bodyHalf * back && height < 1.32 - down * 0.35) return 'body';
  const padTop = GOALIE.padStandHeight + (GOALIE.padHeight - GOALIE.padStandHeight) * down;
  const padSide = Math.sign(g.saveSide ?? 0) || 1;
  // A pad stack throws one leg out on the committed side; the butterfly fans both.
  const stack = kind === 'pad' && Math.sign(side) === padSide;
  const spread =
    ((stack ? GOALIE.padStack : GOALIE.padReach) - GOALIE.padStand) *
    down *
    reach *
    back *
    (kind === 'pad' && !stack ? 0.3 : 1);
  // A better goalie is simply bigger in the net: the stance widens with difficulty too.
  const stand = GOALIE.padStand * (1 + (reach - 1) * GOALIE.standScale);
  if (Math.abs(side) < stand + spread && height < padTop) return 'pad';
  if (
    kind !== 'glove' &&
    kind !== 'blocker' &&
    Math.abs(side) < GOALIE.stickHalf &&
    height < GOALIE.stickHeight
  )
    return 'stick';
  return null;
}

export interface SaveContact {
  part: SaveKind;
  side: number;
  height: number;
  /** Closing speed at contact. */
  speed: number;
  /** Fraction of the step at which the puck reached the goalie. */
  t: number;
}

/**
 * Sweeps a loose puck from where it was against the goalie: crossing the save plane inbound, or
 * running into the body. Returns what it met, or null.
 */
export function sweepGoalie(
  g: Skater,
  puck: Puck,
  from: { x: number; y: number; z: number },
  reach: number,
): SaveContact | null {
  const fx = Math.sin(g.angle),
    fz = Math.cos(g.angle);
  const speed = -(puck.vx * fx + puck.vz * fz);
  if (speed <= 0.5) return null;
  const a = goalieFrame(g, from.x, from.z),
    b = goalieFrame(g, puck.x, puck.z);
  let t: number | null = null;
  if (a.depth > GOALIE.plane && b.depth <= GOALIE.plane)
    t = (a.depth - GOALIE.plane) / (a.depth - b.depth);
  // Released from inside the plane, a shot in tight still has to get past the pads and skates on
  // its way by the goalie's line.
  else if (a.depth > 0 && b.depth <= 0) t = a.depth / (a.depth - b.depth);
  if (t === null) {
    // Already inside the plane: point-blank, or a puck that slipped by and came back.
    const inside = Math.hypot(b.side, b.depth) < GOALIE.body;
    if (!inside || b.depth < -0.1) return null;
    t = 1;
  }
  const side = a.side + (b.side - a.side) * t,
    height = from.y + (puck.y - from.y) * t;
  if (height > GOALIE.reachTop + 0.2) return null;
  const part = coverage(g, side, height, reach);
  return part ? { part, side, height, speed, t } : null;
}

export interface SaveOutcome {
  /** The puck is held: a catch or a smother. */
  cover: boolean;
  label: string;
}

/** Applies the rebound for what the puck met. The caller decides what a cover means for play. */
export function applySave(g: Skater, puck: Puck, contact: SaveContact): SaveOutcome {
  const forward = { x: Math.sin(g.angle), z: Math.cos(g.angle) },
    left = gloveSide(g),
    { part, side, speed } = contact;
  const send = (out: number, across: number, lift: number) => {
    puck.vx = forward.x * out + left.x * across;
    puck.vz = forward.z * out + left.z * across;
    puck.vy = lift;
  };
  const sideSign = Math.sign(side) || 1;
  switch (part) {
    case 'glove':
      send(0, 0, 0);
      return { cover: true, label: 'GLOVE SAVE' };
    case 'blocker':
      // Steered off the blocker and out toward the corner.
      send(4 + speed * 0.14, -(6 + speed * 0.28), 1.4);
      return { cover: false, label: 'BLOCKER SAVE' };
    case 'body':
      if (speed < GOALIE.smother) {
        send(0, 0, 0);
        return { cover: true, label: 'SMOTHERED' };
      }
      // Off the chest and dropped in front: the dangerous rebound.
      send(2.4 + speed * 0.08, sideSign * 0.8, 0.4);
      return { cover: false, label: 'CHEST SAVE' };
    case 'stick':
      send(3 + speed * 0.12, sideSign * (6 + speed * 0.25), 0.5);
      return { cover: false, label: 'STICK SAVE' };
    case 'pad':
    case 'butterfly':
      send(5 + speed * 0.2, sideSign * (3.5 + Math.abs(side) * 4), 0.55);
      return { cover: false, label: 'PAD SAVE' };
    default: {
      const _never: never = part;
      return _never;
    }
  }
}

/** Fold what the puck actually met into the save state, so the pose shows the contact. */
export function recordContact(g: Skater, contact: SaveContact) {
  if (committed(g) && g.saveKind === contact.part) return;
  const kind = contact.part === 'pad' && !onPads(g) ? 'pad' : contact.part;
  g.saveKind = kind;
  g.saveTimer = Math.max(g.saveTimer ?? 0, GOALIE_SAVE_TIME * 0.8);
  g.saveSide = clamp(contact.side, -GOALIE.handReach, GOALIE.handReach);
  g.saveHeight = clamp(contact.height, 0, GOALIE.reachTop);
}

/** A held puck can be picked up: slow, low, and the goalie is not thrown up at a high shot. */
export function canCover(g: Skater, puck: Puck) {
  if ((g.saveKind === 'glove' || g.saveKind === 'blocker') && committed(g) && !canRecommit(g))
    return false;
  return Math.hypot(puck.vx, puck.vz) < GOALIE.coverSpeed && puck.y < 0.5;
}

/**
 * A goalie square to a shooter in close has been reading the blade all the way in and reacts
 * sooner than to a shot from distance. Pulled off the angle by a move across, they get no head
 * start: that is what a deke is for.
 */
export function setRead(s: MatchState, g: Skater) {
  const dir = attackDirection(g.team, s.period),
    netX = -dir * RINK.goalX,
    puck = s.puck,
    ahead = (puck.x - netX) * dir,
    depth = (g.x - netX) * dir;
  if (ahead <= depth + 0.3) return 1;
  const off = Math.abs(g.z - angleLine(ahead, puck.z, depth));
  if (off > GOALIE.squareSlack) return 1;
  const range = Math.hypot(ahead, puck.z);
  return 1 - (1 - GOALIE.setRead) * clamp((GOALIE.setRange - range) / 5, 0, 1);
}

/**
 * Reads a live shot and commits to it after the reaction time. Human goalies read too, a beat
 * slower, so a flick of the stick is worth throwing.
 */
export function stepGoalieRead(
  s: MatchState,
  g: Skater,
  dt: number,
  reaction: number,
  human: boolean,
) {
  const puck = s.puck;
  if (committed(g) && !canRecommit(g)) {
    g.readTimer = 0;
    return;
  }
  const arrival = puck.owner === null && puck.shot ? shotArrival(g, puck) : null;
  const shot = onNet(arrival);
  // Your own goalie never slides on a deke for you; that is your read to make.
  const deke = shot || human ? 0 : dekeThreat(s, g);
  if (!shot && !deke) {
    g.readTimer = 0;
    return;
  }
  if ((g.readTimer ?? 0) <= 0) {
    g.readTimer = reaction * (human ? 1.35 : 1) * (deke ? GOALIE.dekeRead : setRead(s, g));
    return;
  }
  g.readTimer = Math.max(0, g.readTimer! - dt);
  if (g.readTimer > 0) return;
  if (shot) commitSave(g, pickSaveKind(arrival.side, arrival.height), arrival.side, arrival.height);
  else commitSave(g, 'pad', deke * GOALIE.padStack, 0.3);
}

/**
 * A carrier in tight pulling the puck back across the mouth of the net: the side it is heading for
 * (+1 glove, −1 blocker), or 0. A goalie cannot beat a backhand from arm's length by reacting to
 * the release, so they read the move and slide the pad across, sealing the ice and leaving the top
 * of the net for a shooter with the hands to lift it. Taking the puck wide is not a read: that is
 * the fake, and the goalie just shuffles with it.
 */
export function dekeThreat(s: MatchState, g: Skater) {
  const puck = s.puck;
  if (puck.owner === null) return 0;
  const carrier = s.skaters[puck.owner];
  if (carrier.team === g.team) return 0;
  const { depth } = goalieFrame(g, puck.x, puck.z);
  if (depth < 0.3 || depth > GOALIE.dekeRange) return 0;
  // A carried puck moves with the blade as well as the body: a pull across is mostly hands.
  const cx = Math.sin(carrier.angle),
    cz = Math.cos(carrier.angle);
  const vx = carrier.vx + cz * carrier.stickSideVel + cx * carrier.stickReachVel,
    vz = carrier.vz - cx * carrier.stickSideVel + cz * carrier.stickReachVel;
  // Goal-line lateral is rink z; heading across means toward and over the middle of the net.
  if (Math.abs(vz) < GOALIE.dekeSpeed) return 0;
  if (puck.z * vz > 0 && Math.abs(puck.z) > 0.5) return 0;
  const soon = puck.z + vz * GOALIE.dekeLook - g.z;
  if (Math.sign(soon) !== Math.sign(vz) || Math.abs(soon) < GOALIE.bodyHalf + 0.15) return 0;
  const fx = Math.sin(g.angle),
    fz = Math.cos(g.angle);
  return Math.sign(vx * fz - vz * fx);
}

/** A human flick in rink space becomes a committed reach in the goalie's frame. */
export function manualSave(g: Skater, iceX: number, iceZ: number) {
  const fx = Math.sin(g.angle),
    fz = Math.cos(g.angle);
  const side = iceX * fz - iceZ * fx,
    up = iceX * fx + iceZ * fz;
  const mag = Math.hypot(side, up);
  if (mag < 0.3) return;
  if (up < -0.35 * mag) {
    commitSave(g, 'butterfly', side * 0.6, 0.2);
    return;
  }
  if (up > 0.35 * mag) {
    const height = 0.6 + clamp(up, 0, 1) * 0.85;
    if (Math.abs(side) < 0.3) commitSave(g, 'body', 0, height);
    else commitSave(g, side > 0 ? 'glove' : 'blocker', side * GOALIE.handReach, height);
    return;
  }
  commitSave(g, 'pad', side * GOALIE.padStack, 0.3);
}
