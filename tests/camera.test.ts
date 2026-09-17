import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createMatch, netShotTarget, resetFormation, startMatch } from '../src/game/engine';
import { attackDirection, EMPTY_INPUT } from '../src/game/config';
import { netAimFromStick, screenInputToRink } from '../src/input/coordinates';
import { cameraFraming } from '../src/scene/camera';
import { playerLocator } from '../src/scene/locator';
import type { Team } from '../src/game/types';
import { drive, played } from './support';
describe('end-to-end arena camera', () => {
  for (const team of [0, 1] as Team[])
    for (const period of [1, 2, 3]) {
      it(`keeps attack up and movement screen-relative for team ${team}, period ${period}`, () => {
        const match = createMatch(team);
        match.phase = 'playing';
        match.period = period;
        const framing = cameraFraming(match, 'broadcast', 1.5, team);
        const camera = new PerspectiveCamera(framing.fov, 1.5, 0.1, 250);
        camera.position.set(...framing.position);
        camera.lookAt(new Vector3(...framing.target));
        camera.updateMatrixWorld();
        const origin = new Vector3(...framing.target),
          center = origin.clone().project(camera);
        const up = screenInputToRink({ ...EMPTY_INPUT, moveZ: -1 }, match, 'broadcast', team);
        const right = screenInputToRink({ ...EMPTY_INPUT, moveX: 1 }, match, 'broadcast', team);
        expect(
          origin
            .clone()
            .add(new Vector3(up.moveX, 0, up.moveZ))
            .project(camera).y,
        ).toBeGreaterThan(center.y);
        expect(
          origin
            .clone()
            .add(new Vector3(right.moveX, 0, right.moveZ))
            .project(camera).x,
        ).toBeGreaterThan(center.x);
        expect(up.moveX).toBe(attackDirection(team, period));
        expect(up.aimZ).toBeCloseTo(0);
        expect(up.shotHeight).toBe(1);
        const shot = screenInputToRink(
          { ...EMPTY_INPUT, moveX: 1, shoot: true },
          match,
          'broadcast',
          team,
        );
        expect(shot.aimZ).toBe(attackDirection(team, period));
        expect(shot.shoot).toBe(true);
        const deke = screenInputToRink(
          { ...EMPTY_INPUT, stickX: 1, stickY: -1, shoot: true },
          match,
          'broadcast',
          team,
        );
        expect(deke.aimZ).toBeCloseTo(0);
        expect(deke.stickY).toBe(-1);
        const corner = screenInputToRink(
          { ...EMPTY_INPUT, moveX: 1, moveZ: -1, shoot: true },
          match,
          'broadcast',
          team,
        );
        expect(corner.aimZ).toBe(attackDirection(team, period));
        expect(corner.shotHeight).toBe(1);
        const ice = screenInputToRink({ ...EMPTY_INPUT, moveZ: 1 }, match, 'broadcast', team);
        expect(ice.shotHeight).toBe(0);
        const locked = screenInputToRink(
          { ...EMPTY_INPUT, moveZ: 1, shotHeight: 1 },
          match,
          'broadcast',
          team,
        );
        expect(locked.shotHeight).toBe(1);
        const rest = screenInputToRink(EMPTY_INPUT, match, 'broadcast', team);
        expect(rest.aimZ).toBeCloseTo(0);
        expect(rest.shotHeight).toBeCloseTo(0.5);
      });
    }
  it('tracks either offensive zone and keeps the old wide camera available', () => {
    const match = createMatch();
    match.phase = 'playing';
    match.puck.x = 25;
    expect(cameraFraming(match, 'broadcast', 1.5).target[0]).toBeGreaterThan(15);
    match.puck.x = -25;
    expect(cameraFraming(match, 'broadcast', 1.5).target[0]).toBeLessThan(-15);
    expect(cameraFraming(match, 'wide', 1.5).target).toEqual([0, 0, 0]);
    expect(screenInputToRink({ ...EMPTY_INPUT, moveX: 1 }, match, 'wide').moveX).toBe(1);
    expect(screenInputToRink({ ...EMPTY_INPUT, moveZ: 1 }, match, 'wide').aimZ).toBe(1);
    expect(screenInputToRink({ ...EMPTY_INPUT, moveX: 1 }, match, 'wide').aimZ).toBe(0);
    expect(screenInputToRink({ ...EMPTY_INPUT, moveX: 1 }, match, 'wide').shotHeight).toBe(1);
  });
  it('reaches the top corner from a full pad diagonal on the round stick gate', () => {
    for (const edge of [Math.SQRT1_2, 0.65]) {
      const aim = netAimFromStick(edge, edge);
      expect(aim.aimZ).toBeCloseTo(1);
      expect(aim.shotHeight).toBeCloseTo(1);
    }
    const nudge = netAimFromStick(0.3, 0);
    expect(nudge.aimZ).toBeCloseTo(0.3 / 0.9);
    expect(nudge.shotHeight).toBeCloseTo(0.5);
  });
  it('keeps the skater in frame at center ice and still shows the net as a goal mouth', () => {
    const match = createMatch();
    match.phase = 'playing';
    const framing = cameraFraming(match, 'broadcast', 1.5);
    const camera = new PerspectiveCamera(framing.fov, 1.5, 0.1, 250);
    camera.position.set(...framing.position);
    camera.lookAt(new Vector3(...framing.target));
    camera.updateMatrixWorld();
    const player = match.skaters[match.sides[played(match)].humans[0].controlled];
    const skater = new Vector3(player.x, 0.95, player.z).project(camera);
    expect(skater.y).toBeGreaterThan(-0.72);
    expect(skater.y).toBeLessThan(0.15);
    const dir = attackDirection(played(match), match.period);
    const ice = new Vector3(dir * 26, 0.12, 0).project(camera);
    const shelf = new Vector3(dir * 26, 1.35, 0).project(camera);
    const left = new Vector3(dir * 26, 0.7, -1.8).project(camera);
    const right = new Vector3(dir * 26, 0.7, 1.8).project(camera);
    expect(ice.y).toBeLessThan(0.95);
    expect(shelf.y).toBeGreaterThan(ice.y + 0.04);
    expect(Math.abs(right.x - left.x)).toBeGreaterThan(0.04);
  });
  it('starts closer and less top-down so the attacking net still has an angle', () => {
    const match = createMatch();
    match.phase = 'playing';
    const open = cameraFraming(match, 'broadcast', 1.5);
    const lookDown = Math.atan2(
      open.position[1] - open.target[1],
      Math.abs(open.position[0] - open.target[0]),
    );
    expect(open.fov).toBeLessThan(40);
    expect(lookDown).toBeLessThan((50 * Math.PI) / 180);
  });
  it('offers tighter and higher angles than the default broadcast camera', () => {
    const match = createMatch();
    match.phase = 'playing';
    const broadcast = cameraFraming(match, 'broadcast', 1.5);
    const tight = cameraFraming(match, 'tight', 1.5);
    const high = cameraFraming(match, 'high', 1.5);
    const player = match.skaters[match.sides[played(match)].humans[0].controlled];
    const pitch = (f: typeof tight) =>
      Math.atan2(f.position[1] - f.target[1], Math.abs(f.position[0] - f.target[0]));
    expect(Math.abs(tight.position[0] - player.x)).toBeLessThan(
      Math.abs(broadcast.position[0] - player.x),
    );
    expect(pitch(tight)).toBeGreaterThan(pitch(broadcast));
    expect(high.position[1]).toBeGreaterThan(broadcast.position[1]);
    expect(cameraFraming(match, 'wide', 1.5).target).toEqual([0, 0, 0]);
  });
  it('drops toward the net in the offensive zone so the goal mouth is readable', () => {
    const match = createMatch();
    match.phase = 'playing';
    const open = cameraFraming(match, 'broadcast', 1.5);
    match.skaters[match.sides[played(match)].humans[0].controlled].x = 22;
    match.puck.x = 22;
    match.puck.owner = match.sides[played(match)].humans[0].controlled;
    match.sides[played(match)].humans[0].shotLift = 1;
    const crease = cameraFraming(match, 'broadcast', 1.5);
    expect(crease.target[1]).toBeGreaterThan(0.6);
    expect(crease.position[1]).toBeLessThan(open.position[1] - 3);
    expect(crease.target[0] * attackDirection(played(match), match.period)).toBeGreaterThan(
      open.target[0] * attackDirection(played(match), match.period),
    );
  });
  it('stays with the goalie when the other team is shooting in a shootout', () => {
    const match = createMatch(0, 'shootout');
    startMatch(match);
    match.shootoutShooter = 1;
    resetFormation(match);
    startMatch(match);
    const goalie = match.skaters[match.sides[played(match)].humans[0].controlled];
    const shooter = match.skaters.find((p) => p.team === 1 && p.role === 'C')!;
    expect(goalie.role).toBe('G');
    const framing = cameraFraming(match, 'broadcast', 1.5);
    expect(Math.abs(framing.position[0] - goalie.x)).toBeGreaterThan(12);
    expect(Math.abs(framing.position[0] - goalie.x)).toBeLessThan(
      Math.abs(framing.position[0] - shooter.x),
    );
    const camera = new PerspectiveCamera(framing.fov, 1.5, 0.1, 250);
    camera.position.set(...framing.position);
    camera.lookAt(new Vector3(...framing.target));
    camera.updateMatrixWorld();
    const onScreen = new Vector3(goalie.x, 0.95, goalie.z).project(camera);
    const rush = new Vector3(shooter.x, 0.95, shooter.z).project(camera);
    expect(onScreen.y).toBeGreaterThan(-0.95);
    expect(onScreen.y).toBeLessThan(0.55);
    expect(Math.abs(onScreen.x)).toBeLessThan(0.85);
    expect(rush.y).toBeGreaterThan(-0.85);
    expect(rush.y).toBeLessThan(0.95);
    expect(Math.abs(rush.x)).toBeLessThan(1.05);
    const out = screenInputToRink({ ...EMPTY_INPUT, moveZ: -1 }, match, 'broadcast');
    expect(out.moveX).toBe(attackDirection(0, 1));
  });
  it('puts the beginner shot marker on-screen in free skate from center ice', () => {
    const match = createMatch(0, 'freeSkate');
    startMatch(match);
    match.phase = 'playing';
    const player = match.skaters[match.sides[played(match)].humans[0].controlled];
    const target = netShotTarget(match, player, 0, 0.35);
    const framing = cameraFraming(match, 'broadcast', 1.5);
    const camera = new PerspectiveCamera(framing.fov, 1.5, 0.1, 250);
    camera.position.set(...framing.position);
    camera.lookAt(new Vector3(...framing.target));
    camera.updateMatrixWorld();
    const marker = new Vector3(target.x, Math.max(0.35, target.y), target.z).project(camera);
    expect(marker.x).toBeGreaterThan(-0.9);
    expect(marker.x).toBeLessThan(0.9);
    expect(marker.y).toBeGreaterThan(-0.2);
    expect(marker.y).toBeLessThan(0.95);
  });
});
function framedCamera(
  match: ReturnType<typeof createMatch>,
  mode: 'broadcast' | 'wide' = 'broadcast',
) {
  const framing = cameraFraming(match, mode, 1.5);
  const camera = new PerspectiveCamera(framing.fov, 1.5, 0.1, 250);
  camera.position.set(...framing.position);
  camera.lookAt(new Vector3(...framing.target));
  camera.updateMatrixWorld();
  return camera;
}
describe('off-screen player locator', () => {
  it('stays hidden while the skater is in the broadcast frame', () => {
    const match = createMatch();
    match.phase = 'playing';
    expect(playerLocator(match, framedCamera(match), 1600)).toBeNull();
  });
  it('pins a trailing skater to the bottom and keeps left wing left of right wing', () => {
    const match = createMatch();
    match.phase = 'playing';
    const player = match.skaters[match.sides[played(match)].humans[0].controlled];
    match.puck.x = 25;
    match.puck.z = 0;
    player.x = -18;
    player.z = 0;
    const camera = framedCamera(match);
    const center = playerLocator(match, camera, 1600);
    expect(center).not.toBeNull();
    expect(center!.number).toBe(player.number);
    expect(center!.color).toBe(match.teams[player.team].accent);
    expect(center!.x).toBeGreaterThan(560);
    expect(center!.x).toBeLessThan(1040);
    player.z = -10;
    const left = playerLocator(match, framedCamera(match), 1600)!;
    player.z = 10;
    const right = playerLocator(match, framedCamera(match), 1600)!;
    expect(left.x).toBeLessThan(center!.x);
    expect(right.x).toBeGreaterThan(center!.x);
  });
  it('does not mark a full-rink camera', () => {
    const match = createMatch();
    match.phase = 'playing';
    match.puck.x = 25;
    match.skaters[match.sides[played(match)].humans[0].controlled].x = -18;
    expect(playerLocator(match, framedCamera(match, 'wide'), 1600)).toBeNull();
  });
});
