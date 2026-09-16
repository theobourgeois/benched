import { EMPTY_INPUT } from '../game/config';
import type { CellyKind, DekeSpecial, InputFrame } from '../game/types';
import { Cursor, sizeOf, unit, type Field } from './wire';

/**
 * A player's intent for one step, on its way to whoever is running the simulation. It is sent
 * already mapped into rink space, so the host never has to know which way the other person's
 * camera is pointing.
 */

/** Enum orders are part of the wire format: append to them, never reorder. */
const SPECIALS: readonly (DekeSpecial | null)[] = [null, 'jump', 'throughLegs', 'windmill', 'spin'];
const CELLIES: readonly (CellyKind | null)[] = [null, 'helicopter', 'jump', 'limp', 'dance'];

const FIELDS: readonly Field[] = [
  // The sender's clock, and the newest snapshot stamp it has seen. The host reads the second
  // back to measure its own round trip, and sends the first back for the guest to do the same.
  { key: 'stamp', kind: 'f32' },
  { key: 'echo', kind: 'f32' },
  unit('moveX'),
  unit('moveZ'),
  unit('stickX'),
  unit('stickY'),
  unit('shotPower'),
  unit('aimZ'),
  unit('shotHeight'),
  unit('checkPower'),
  unit('stickIceX'),
  unit('stickIceZ'),
  { key: 'dekeSpecial', kind: 'enum', values: SPECIALS },
  { key: 'celly', kind: 'enum', values: CELLIES },
  // Everything that is simply down or not, one byte each. Sixteen bytes is not worth packing.
  { key: 'shoot', kind: 'bool' },
  { key: 'toeDrag', kind: 'bool' },
  { key: 'pass', kind: 'bool' },
  { key: 'passHeld', kind: 'bool' },
  { key: 'passRelease', kind: 'bool' },
  { key: 'poke', kind: 'bool' },
  { key: 'pokeHeld', kind: 'bool' },
  { key: 'saucer', kind: 'bool' },
  { key: 'chip', kind: 'bool' },
  { key: 'deke', kind: 'bool' },
  { key: 'dive', kind: 'bool' },
  { key: 'check', kind: 'bool' },
  { key: 'reach', kind: 'bool' },
  { key: 'block', kind: 'bool' },
  { key: 'switchPlayer', kind: 'bool' },
  { key: 'hustle', kind: 'bool' },
  { key: 'backskate', kind: 'bool' },
  { key: 'pause', kind: 'bool' },
];

export const INPUT_BYTES = sizeOf(FIELDS);
/** An input frame with the sender's clock and the snapshot stamp it is answering. */
export interface StampedInput {
  stamp: number;
  echo: number;
  frame: InputFrame;
}

export function encodeInput(
  frame: InputFrame,
  stamp: number,
  echo = 0,
  into?: ArrayBuffer,
): ArrayBuffer {
  const buffer = into ?? new ArrayBuffer(INPUT_BYTES);
  const at = new Cursor(new DataView(buffer));
  const values: Record<string, unknown> = { ...frame, stamp, echo };
  for (const field of FIELDS) at.write(field, values[field.key]);
  return buffer;
}

export function decodeInput(buffer: ArrayBuffer): StampedInput {
  const at = new Cursor(new DataView(buffer));
  const values: Record<string, unknown> = {};
  for (const field of FIELDS) values[field.key] = at.read(field);
  const { stamp, echo, ...rest } = values;
  return {
    stamp: stamp as number,
    echo: echo as number,
    frame: { ...EMPTY_INPUT, ...rest } as InputFrame,
  };
}
