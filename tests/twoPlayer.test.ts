import { describe, expect, it } from 'vitest';
import { createMatch, drawWinner, resetFormation, startMatch, stepMatch } from '../src/game/engine';
import { cpuTune } from '../src/game/difficulty';
import { EMPTY_INPUT, GOALIE, RULES } from '../src/game/config';
import { isOnIce } from '../src/game/modes';
import type { MatchState, SideInputs, Team } from '../src/game/types';

/** Both sides taken by a person, on open ice, with nobody able to interfere. */
function twoPlayer(mode: Parameters<typeof createMatch>[1] = 'exhibition') {
  const s = createMatch([0, 1], mode);
  s.phase = 'playing';
  s.skaters.forEach((p, i) => {
    p.x = -20 + (i % 6) * 3;
    p.z = p.team ? -10 : 10;
    p.cooldown = 10;
  });
  return s;
}
const both = (home: Partial<typeof EMPTY_INPUT>, away: Partial<typeof EMPTY_INPUT>): SideInputs => [
  { ...EMPTY_INPUT, ...home },
  { ...EMPTY_INPUT, ...away },
];
const run = (s: MatchState, inputs: SideInputs, seconds: number) => {
  for (let t = 0; t < Math.ceil(seconds / RULES.fixedStep); t++)
    stepMatch(s, inputs, RULES.fixedStep);
};

describe('two people on the ice', () => {
  it('drives one skater per side from that side own stick', () => {
    const s = twoPlayer();
    const home = s.skaters[s.sides[0].controlled],
      away = s.skaters[s.sides[1].controlled];
    home.cooldown = away.cooldown = 0;
    // Opposite left sticks: each carrier should travel its own way, not share one input.
    run(s, both({ moveX: 1 }, { moveX: -1 }), 0.6);
    expect(home.vx).toBeGreaterThan(1);
    expect(away.vx).toBeLessThan(-1);
  });

  it('holds a side still when its frame goes missing, rather than handing back to the AI', () => {
    const s = twoPlayer();
    const away = s.skaters[s.sides[1].controlled];
    away.cooldown = 0;
    // A dropped frame is the shape network starvation takes, and it must read as "stood still".
    run(s, [{ ...EMPTY_INPUT, moveX: 1 }, null], 0.5);
    expect(Math.hypot(away.vx, away.vz)).toBeLessThan(0.001);
  });

  it('still lets the AI play a side nobody is sitting on', () => {
    const s = twoPlayer();
    s.sides[1].human = false;
    const away = s.skaters[s.sides[1].controlled];
    away.cooldown = 0;
    run(s, [{ ...EMPTY_INPUT }, null], 0.6);
    expect(Math.hypot(away.vx, away.vz)).toBeGreaterThan(0.5);
  });

  it('gives both benches the same tuning, so neither side gets the easier opponent', () => {
    const s = twoPlayer();
    s.difficulty = 'rookie';
    const home = cpuTune(s, s.skaters[1]),
      away = cpuTune(s, s.skaters[7]);
    expect(home).toEqual(away);
    expect(home.speed).toBe(cpuTune(createMatch(0), s.skaters[1]).speed);
  });

  it('holds a covered puck for the same beat at both ends', () => {
    // Each end gets its own match so the freeze is read at the moment it is set, not a step later.
    const freeze = ([0, 1] as Team[]).map((team) => {
      const s = twoPlayer();
      const g = s.skaters.find((p) => p.role === 'G' && p.team === team)!;
      Object.assign(s.puck, {
        x: g.x,
        z: g.z,
        y: 0.1,
        vx: 0,
        vz: 0,
        vy: 0,
        shot: true,
        lockout: 0,
      });
      s.puck.owner = null;
      g.cooldown = 0;
      stepMatch(s, both({}, {}), RULES.fixedStep);
      return g.coverTimer;
    });
    expect(freeze).toEqual([GOALIE.humanHold, GOALIE.humanHold]);
  });
});

describe('the draw with two people swinging', () => {
  const drawWith = (homeStrike: number, awayStrike: number) => {
    const s = createMatch([0, 1]);
    s.sides[0].drawInput = homeStrike;
    s.sides[1].drawInput = awayStrike;
    return drawWinner(s);
  };
  it('gives it to the side that timed the drop', () => {
    expect(drawWith(0.2, -1)).toBe(0);
    expect(drawWith(-1, 0.2)).toBe(1);
  });
  it('gives it to whoever struck closest to the drop when both timed it', () => {
    expect(drawWith(0.05, 0.3)).toBe(0);
    expect(drawWith(0.3, 0.05)).toBe(1);
  });
  it('punishes jumping it, even against a side that never swung', () => {
    expect(drawWith(0.9, -1)).toBe(1);
    expect(drawWith(-1, 0.9)).toBe(0);
  });
  it('is decided by the least early swing when both jumped it', () => {
    expect(drawWith(0.6, 0.9)).toBe(0);
    expect(drawWith(0.9, 0.6)).toBe(1);
  });
});

describe('shootout with two people', () => {
  it('puts each side on its only skater: the shooter, then the goalie facing them', () => {
    const s = createMatch([0, 1], 'shootout');
    startMatch(s);
    for (const attempt of [0, 1]) {
      const shooting = s.shootoutShooter,
        defending = (1 - shooting) as Team;
      const shooter = s.skaters[s.sides[shooting].controlled],
        keeper = s.skaters[s.sides[defending].controlled];
      expect(shooter.role).toBe('C');
      expect(shooter.team).toBe(shooting);
      expect(keeper.role).toBe('G');
      expect(keeper.team).toBe(defending);
      expect(isOnIce(s, shooter)).toBe(true);
      expect(isOnIce(s, keeper)).toBe(true);
      expect(s.puck.owner).toBe(shooter.id);
      expect(attempt).toBeLessThan(2);
      // Hand the attempt over and check the roles swap.
      s.shootoutShooter = defending;
      s.shootoutTaken[shooting]++;
      resetFormation(s);
      startMatch(s);
    }
  });
});
