import { attackDirection, RINK } from '../game/config';
import { clamp } from '../game/math';
import { GOAL_REPLAY, type ReplayCamera, type ReplaySession } from '../game/replay';
import type { Settings } from '../game/types';
import { cameraFraming } from './camera';

type Vec3 = readonly [number, number, number];
export interface ReplayFraming {
  position: Vec3;
  target: Vec3;
  fov: number;
  /** Jump straight to this shot instead of easing toward it. */
  cut: boolean;
  /** Easing rate per second; Infinity follows exactly. */
  smoothing: number;
}

export const ORBIT = {
  minPitch: 0.06,
  maxPitch: 1.45,
  minDistance: 2.5,
  maxDistance: 60,
  fov: 40,
  /** Stick orbit, radians per second at full tilt. */
  yawRate: 2.4,
  pitchRate: 1.4,
  /** Full zoom input scales the distance by e^zoomRate per second. */
  zoomRate: 1.6,
  dragYaw: 0.006,
  dragPitch: 0.005,
  wheel: 0.0015,
};
const FOCUS_Y = 0.5;

/** Adopts an orbit that reproduces the current camera, so taking control never jumps. */
export function seedOrbit(cam: ReplayCamera, position: Vec3, target: Vec3) {
  const dx = position[0] - target[0],
    dy = position[1] - target[1],
    dz = position[2] - target[2];
  const distance = Math.hypot(dx, dy, dz) || 18;
  cam.distance = clamp(distance, ORBIT.minDistance, ORBIT.maxDistance);
  cam.yaw = Math.atan2(dx, dz);
  cam.pitch = clamp(Math.asin(clamp(dy / distance, -1, 1)), ORBIT.minPitch, ORBIT.maxPitch);
  cam.focus = { x: target[0], y: target[1], z: target[2] };
  cam.seeded = true;
}

export function orbitPosition(cam: ReplayCamera): Vec3 {
  const flat = Math.cos(cam.pitch) * cam.distance;
  return [
    cam.focus.x + Math.sin(cam.yaw) * flat,
    cam.focus.y + Math.sin(cam.pitch) * cam.distance,
    cam.focus.z + Math.cos(cam.yaw) * flat,
  ];
}

/** Moves the focus in the camera's own frame: +x to screen right, −z straight ahead. */
export function panFocus(cam: ReplayCamera, right: number, back: number) {
  const s = Math.sin(cam.yaw),
    c = Math.cos(cam.yaw);
  cam.focus.x = clamp(
    cam.focus.x + c * right + s * back,
    -RINK.halfLength - 2,
    RINK.halfLength + 2,
  );
  cam.focus.z = clamp(cam.focus.z - s * right + c * back, -RINK.halfWidth - 2, RINK.halfWidth + 2);
}

function steerOrbit(r: ReplaySession, dt: number) {
  const cam = r.camera,
    { input, drag } = cam;
  const panning = input.moveX !== 0 || input.moveZ !== 0 || drag.panX !== 0 || drag.panY !== 0;
  if (panning && cam.mode === 'puck') cam.mode = 'free';
  cam.yaw += input.orbitX * ORBIT.yawRate * dt - drag.x * ORBIT.dragYaw;
  cam.pitch = clamp(
    cam.pitch - input.orbitY * ORBIT.pitchRate * dt + drag.y * ORBIT.dragPitch,
    ORBIT.minPitch,
    ORBIT.maxPitch,
  );
  cam.distance = clamp(
    cam.distance * Math.exp(input.zoom * ORBIT.zoomRate * dt + drag.wheel * ORBIT.wheel),
    ORBIT.minDistance,
    ORBIT.maxDistance,
  );
  const speed = 4 + cam.distance * 0.9,
    grab = cam.distance * 0.0022;
  panFocus(
    cam,
    input.moveX * speed * dt - drag.panX * grab,
    input.moveZ * speed * dt - drag.panY * grab,
  );
  if (cam.mode === 'puck') {
    const p = r.view.puck,
      follow = 1 - Math.exp(-dt * 6);
    cam.focus.x += (p.x - cam.focus.x) * follow;
    cam.focus.y += (Math.max(FOCUS_Y, p.y) - cam.focus.y) * follow;
    cam.focus.z += (p.z - cam.focus.z) * follow;
  }
}

/**
 * Two broadcast shots for a goal: a chase from behind the play at full speed, then a hard cut to
 * a raised camera behind the net for the slow-motion finish.
 */
export function goalShot(r: ReplaySession) {
  const goal = r.goal!,
    view = r.view,
    puck = view.puck;
  const sign = attackDirection(goal.team, view.period);
  if (r.time - goal.time < -GOAL_REPLAY.slowFrom) {
    return {
      shot: 'chase',
      position: [
        clamp(puck.x - sign * 10, -RINK.halfLength - 2, RINK.halfLength + 2),
        5.4,
        puck.z * 0.45,
      ] as Vec3,
      target: [puck.x + sign * 4, 0.7, puck.z * 0.8] as Vec3,
      fov: 42,
      smoothing: 3.5,
    };
  }
  // Raised and pulled back to the end boards, so the goal frame sits across the bottom of the
  // shot and the slot fills the middle.
  const slot = sign * (RINK.goalX - 5.5);
  const x = sign * Math.min(puck.x * sign, RINK.goalX - 3);
  return {
    shot: 'net',
    position: [sign * (RINK.goalX + 3.6), 4.2, clamp(-puck.z * 0.3, -2.4, 2.4)] as Vec3,
    target: [x * 0.4 + slot * 0.6, 0.3, puck.z * 0.6] as Vec3,
    fov: 50,
    smoothing: 4,
  };
}

/** Where the replay camera wants to be this frame. Consumes the camera's input and drag. */
export function replayFraming(
  r: ReplaySession,
  dt: number,
  aspect: number,
  setting: Settings['camera'],
  current: { position: Vec3; target: Vec3 },
): ReplayFraming {
  const cam = r.camera;
  const { input, drag } = cam;
  const steering =
    input.orbitX !== 0 ||
    input.orbitY !== 0 ||
    input.moveX !== 0 ||
    input.moveZ !== 0 ||
    input.zoom !== 0 ||
    drag.x !== 0 ||
    drag.y !== 0 ||
    drag.panX !== 0 ||
    drag.panY !== 0 ||
    drag.wheel !== 0;
  // Touching the camera during the broadcast angle hands it over to the puck orbit.
  if (steering && cam.mode === 'broadcast') {
    cam.mode = 'puck';
    cam.seeded = false;
  }
  let framing: ReplayFraming;
  switch (cam.mode) {
    case 'cinematic': {
      const shot = goalShot(r);
      const cut = shot.shot !== cam.shot;
      cam.shot = shot.shot;
      framing = { ...shot, cut };
      break;
    }
    case 'broadcast': {
      const f = cameraFraming(r.view, setting, aspect);
      framing = { ...f, cut: false, smoothing: 5 };
      break;
    }
    case 'puck':
    case 'free': {
      if (!cam.seeded) seedOrbit(cam, current.position, current.target);
      steerOrbit(r, dt);
      const f = cam.focus;
      framing = {
        position: orbitPosition(cam),
        target: [f.x, f.y, f.z],
        fov: ORBIT.fov,
        cut: false,
        smoothing: Infinity,
      };
      break;
    }
    default: {
      const _exhaustive: never = cam.mode;
      return _exhaustive;
    }
  }
  drag.x = drag.y = drag.panX = drag.panY = drag.wheel = 0;
  return framing;
}
