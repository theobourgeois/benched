/**
 * The small amount of machinery both wire formats share: a declarative table of fields and a
 * cursor that walks a buffer by it, so no byte offset is ever written down by hand and the two
 * ends cannot drift apart.
 */

/**
 * How a field is drawn between two moments of a match, when the watcher's frame falls between
 * the snapshots it has. `snap` takes whichever moment is nearer; everything else is a straight
 * line between them, except where the two numbers are further apart than the time between the
 * moments could explain, which is a reset or a teleport, and drawn as one.
 */
export type Blend =
  /** Whichever moment is nearer. Ids, phases, flags, counts. */
  | 'snap'
  | 'lerp'
  /** A clock in seconds: lerped while it runs, snapped when it is restarted. */
  | 'time'
  /**
   * The period clock, which runs several game seconds a second (see `clockRate`): lerped while it
   * runs, snapped when a new period restarts it.
   */
  | 'gameClock'
  /** Metres: lerped while a skater or puck moves, snapped when a faceoff puts them elsewhere. */
  | 'move'
  /** Radians, along the shorter way round. */
  | 'angle';

export type Field =
  /** Full precision, for anything that accumulates without a bound. */
  (
    | { key: string; kind: 'f32' }
    /** Fixed point. `scale` is the steps per unit, so 256 puts a metre in ~4 mm. */
    | { key: string; kind: 'i16'; scale: number }
    | { key: string; kind: 'u16'; scale: number }
    | { key: string; kind: 'u8'; scale: number }
    /** Radians wrapped into (−π, π]. Facing accumulates past a turn, and only the direction shows. */
    | { key: string; kind: 'angle' }
    | { key: string; kind: 'enum'; values: readonly (string | null)[] }
    | { key: string; kind: 'bool' }
  ) & { blend?: Blend };

export const WIDTH: Record<Field['kind'], number> = {
  f32: 4,
  i16: 2,
  u16: 2,
  u8: 1,
  angle: 2,
  enum: 1,
  bool: 1,
};
/** Radians to a ten-thousandth, which is finer than a pixel at any camera distance. */
const ANGLE_SCALE = 10000;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const sizeOf = (fields: readonly Field[]) => fields.reduce((n, f) => n + WIDTH[f.kind], 0);

export /** A cursor that walks the buffer, so no offset is ever written down by hand. */
class Cursor {
  offset = 0;
  constructor(readonly view: DataView) {}
  write(field: Field, value: unknown) {
    const { view } = this;
    switch (field.kind) {
      case 'f32':
        view.setFloat32(this.offset, Number(value) || 0, true);
        break;
      case 'i16':
        view.setInt16(this.offset, clampInt(Number(value) || 0, field.scale, 32767), true);
        break;
      case 'u16':
        view.setUint16(
          this.offset,
          clampInt(Math.max(0, Number(value) || 0), field.scale, 65535),
          true,
        );
        break;
      case 'u8':
        view.setUint8(this.offset, clampInt(Math.max(0, Number(value) || 0), field.scale, 255));
        break;
      case 'enum': {
        const at = field.values.indexOf((value ?? null) as string | null);
        view.setUint8(this.offset, at < 0 ? 0 : at);
        break;
      }
      case 'angle':
        view.setInt16(this.offset, Math.round(wrapAngle(Number(value) || 0) * ANGLE_SCALE), true);
        break;
      case 'bool':
        view.setUint8(this.offset, value ? 1 : 0);
        break;
    }
    this.offset += WIDTH[field.kind];
  }
  read(field: Field): number | string | boolean | null {
    const { view } = this;
    let out: number | string | boolean | null;
    switch (field.kind) {
      case 'f32':
        out = view.getFloat32(this.offset, true);
        break;
      case 'i16':
        out = view.getInt16(this.offset, true) / field.scale;
        break;
      case 'u16':
        out = view.getUint16(this.offset, true) / field.scale;
        break;
      case 'u8':
        out = view.getUint8(this.offset) / field.scale;
        break;
      case 'enum':
        out = field.values[view.getUint8(this.offset)] ?? null;
        break;
      case 'angle':
        out = view.getInt16(this.offset, true) / ANGLE_SCALE;
        break;
      case 'bool':
        out = view.getUint8(this.offset) === 1;
        break;
    }
    this.offset += WIDTH[field.kind];
    return out;
  }
}
const clampInt = (value: number, scale: number, limit: number) =>
  Math.max(-limit - 1, Math.min(limit, Math.round(value * scale)));

/** A second of game time in thousandths, which covers every timer the simulation keeps. */
export const timer = (key: string): Field => ({ key, kind: 'u16', scale: 1000, blend: 'time' });
/** Metres, to about four millimetres. */
export const metres = (key: string): Field => ({ key, kind: 'i16', scale: 256, blend: 'move' });
/** A small signed quantity - leans, offsets, aim - to a thousandth. */
export const unit = (key: string): Field => ({ key, kind: 'i16', scale: 1000, blend: 'lerp' });

/** Further than anything skates or is shot between two snapshots: it was put there. */
const TELEPORT = 2.5;
/** Game seconds the period clock can cover in a real one, with room to spare. */
const GAME_CLOCK_REACH = 10;

/**
 * The value of a field at a moment `t` of the way from `a` to `b`, which are `span` seconds
 * apart. Anything that is not a number, or is not meant to be drawn in between, snaps.
 */
export function blendField(field: Field, a: unknown, b: unknown, t: number, span: number): unknown {
  const nearer = t < 0.5 ? a : b;
  if (typeof a !== 'number' || typeof b !== 'number') return nearer;
  const blend = field.blend ?? (field.kind === 'angle' ? 'angle' : 'snap');
  switch (blend) {
    case 'lerp':
      return a + (b - a) * t;
    case 'time':
      // A clock moves a second a second. A bigger jump is a restart, drawn as one.
      return Math.abs(b - a) <= span * 1.5 + 0.005 ? a + (b - a) * t : nearer;
    case 'gameClock':
      return b <= a && a - b <= span * GAME_CLOCK_REACH + 0.005 ? a + (b - a) * t : nearer;
    case 'move':
      return Math.abs(b - a) <= TELEPORT ? a + (b - a) * t : nearer;
    case 'angle':
      return a + wrapAngle(b - a) * t;
    default:
      return nearer;
  }
}
