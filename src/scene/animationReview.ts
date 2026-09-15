import type { SkaterRig } from './skaterModel';
import type { StickParts } from './stick';

/** Populated only in development. Used by the browser rig checks and Blender clip export. */
export const reviewSkaters = new Map<number, { rig: SkaterRig; stick: StickParts }>();
