import { describe, expect, it } from 'vitest';
import {
  createMatch,
  drawWinner,
  passPuck,
  resetFormation,
  startMatch,
  stepMatch,
  stickTip,
} from '../src/game/engine';
import { cpuTune } from '../src/game/difficulty';
import { attackDirection, EMPTY_INPUT, FACEOFF, GOALIE, RULES } from '../src/game/config';
import { isOnIce } from '../src/game/modes';
import { createView, REPLAY_HZ, ReplayBuffer, sampleReplay } from '../src/game/replay';
import { decodeSnapshot, encodeSnapshot, poseSnapshot } from '../src/net/snapshot';
import type { MatchState, SideInputs, Skater, Team } from '../src/game/types';

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
  [{ ...EMPTY_INPUT, ...home }],
  [{ ...EMPTY_INPUT, ...away }],
];
const run = (s: MatchState, inputs: SideInputs, seconds: number) => {
  for (let t = 0; t < Math.ceil(seconds / RULES.fixedStep); t++)
    stepMatch(s, inputs, RULES.fixedStep);
};

describe('two people on the ice', () => {
  it('drives one skater per side from that side own stick', () => {
    const s = twoPlayer();
    const home = s.skaters[s.sides[0].humans[0].controlled],
      away = s.skaters[s.sides[1].humans[0].controlled];
    home.cooldown = away.cooldown = 0;
    // Opposite left sticks: each carrier should travel its own way, not share one input.
    run(s, both({ moveX: 1 }, { moveX: -1 }), 0.6);
    expect(home.vx).toBeGreaterThan(1);
    expect(away.vx).toBeLessThan(-1);
  });

  it('holds a side still when its frame goes missing, rather than handing back to the AI', () => {
    const s = twoPlayer();
    const away = s.skaters[s.sides[1].humans[0].controlled];
    away.cooldown = 0;
    // A dropped frame is the shape network starvation takes, and it must read as "stood still".
    run(s, [[{ ...EMPTY_INPUT, moveX: 1 }], []], 0.5);
    expect(Math.hypot(away.vx, away.vz)).toBeLessThan(0.001);
  });

  it('still lets the AI play a side nobody is sitting on', () => {
    const s = twoPlayer();
    s.sides[1].humans = [];
    const away = s.skaters[6];
    away.cooldown = 0;
    run(s, [[{ ...EMPTY_INPUT }], []], 0.6);
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
  // Countdown left at the release: anything above it jumped the drop.
  const release = FACEOFF.fall + FACEOFF.late;
  const drawWith = (homeStrike: number, awayStrike: number) => {
    const s = createMatch([0, 1]);
    s.sides[0].drawInput = homeStrike;
    s.sides[1].drawInput = awayStrike;
    return drawWinner(s);
  };
  it('gives it to the side that swung at the drop', () => {
    expect(drawWith(0.2, -1)).toBe(0);
    expect(drawWith(-1, 0.2)).toBe(1);
  });
  it('gives it to whoever swung first after the release', () => {
    expect(drawWith(release - 0.1, release - 0.3)).toBe(0);
    expect(drawWith(release - 0.3, release - 0.1)).toBe(1);
  });
  it('ties up two sticks that arrive together', () => {
    expect(drawWith(0.3, 0.3 - FACEOFF.tie / 2)).toBeNull();
  });
  it('punishes jumping it, even against a side that never swung', () => {
    expect(drawWith(release + 0.2, -1)).toBe(1);
    expect(drawWith(-1, release + 0.2)).toBe(0);
    expect(drawWith(release + 0.2, 0.1)).toBe(1);
  });
  it('leaves it loose when both jumped or nobody swung', () => {
    expect(drawWith(release + 0.2, release + 0.4)).toBeNull();
    expect(drawWith(-1, -1)).toBeNull();
  });
});

describe('taking a draw with the right stick', () => {
  /** Two people at centre ice, steps until the linesman lets go. */
  const setUp = () => {
    const s = createMatch([0, 1]);
    startMatch(s);
    return s;
  };
  const release = FACEOFF.fall + FACEOFF.late;
  const untilDrop = (s: MatchState, inputs: SideInputs = both({}, {})) => {
    while (s.countdown > release) stepMatch(s, inputs);
  };
  const back = (s: MatchState, team: Team) => ({ stickIceX: -attackDirection(team, s.period) });

  it('holds the puck up until the drop, then lets it fall to the ice', () => {
    const s = setUp();
    expect(s.puck.y).toBeGreaterThan(1);
    untilDrop(s);
    expect(s.puck.y).toBeGreaterThan(1);
    run(s, both({}, {}), FACEOFF.fall);
    expect(s.puck.y).toBeLessThan(0.1);
  });

  it('does not drop on the same beat every time', () => {
    const waits = [0, 1, 2, 3].map((goals) => {
      const s = createMatch([0, 1]);
      s.score = [goals, 0];
      startMatch(s);
      return s.countdown;
    });
    expect(new Set(waits.map((w) => w.toFixed(3))).size).toBeGreaterThan(2);
  });

  it('wins it back to a defenceman for whoever pulls the stick back first', () => {
    const s = setUp();
    untilDrop(s);
    run(s, both(back(s, 0), {}), 0.15);
    run(s, both(back(s, 0), back(s, 1)), 0.5);
    expect(s.phase).toBe('playing');
    expect(s.puck.lastTouch).toBe(0);
    const to = s.skaters[s.puck.passTo ?? s.puck.owner ?? 0];
    expect(to.team).toBe(0);
    expect(['LD', 'RD']).toContain(to.role);
    expect(s.sides[0].humans[0].controlled).toBe(to.id);
  });

  it('sends it to a winger when the stick goes to the side', () => {
    const s = setUp();
    untilDrop(s);
    run(s, both({ stickIceZ: 1 }, {}), 0.6);
    const to = s.skaters[s.puck.passTo ?? s.puck.owner ?? 0];
    expect(to.team).toBe(0);
    expect(['LW', 'RW']).toContain(to.role);
  });

  it('loses the draw for jumping it', () => {
    const s = setUp();
    run(s, both({}, {}), 0.1);
    stepMatch(s, both(back(s, 0), {}));
    untilDrop(s);
    run(s, both({}, back(s, 1)), 0.6);
    expect(s.puck.lastTouch).toBe(1);
  });

  it('leaves the left stick out of it: skating input is not a swing', () => {
    const s = setUp();
    untilDrop(s);
    run(s, both({ moveX: -1, moveZ: 1 }, {}), 0.1);
    expect(s.sides[0].drawInput).toBe(-1);
  });

  it('shows the swing on the stick when it is thrown, early, on time or late', () => {
    const swung = (s: MatchState) => s.skaters[0].shotTimer;
    const early = setUp();
    run(early, both({}, {}), 0.1);
    stepMatch(early, both(back(early, 0), {}));
    expect(early.countdown).toBeGreaterThan(release);
    expect(swung(early)).toBeGreaterThan(0.3);
    // It plays out while the linesman is still holding the puck, not at the drop.
    const before = swung(early);
    run(early, both({}, {}), 0.1);
    expect(swung(early)).toBeLessThan(before);

    const onTime = setUp();
    untilDrop(onTime);
    expect(swung(onTime)).toBe(0);
    stepMatch(onTime, both(back(onTime, 0), {}));
    expect(swung(onTime)).toBeGreaterThan(0.3);

    // Beaten to it: the second swing loses the draw and is still seen.
    const late = setUp();
    untilDrop(late);
    stepMatch(late, both({}, back(late, 1)));
    run(late, both({}, {}), FACEOFF.tie * 2);
    if (late.phase === 'faceoff') {
      stepMatch(late, both(back(late, 0), {}));
      expect(swung(late)).toBeGreaterThan(0.3);
    }
    expect(late.skaters[6].shotTimer).toBeGreaterThan(0);
  });

  it('does not count a stick still held from before the whistle as a swing', () => {
    const s = setUp();
    untilDrop(s, both(back(s, 0), {}));
    expect(s.sides[0].drawInput).toBe(-1);
  });

  it('lets the better CPU centre win more of the draws', () => {
    let legend = 0;
    for (let i = 0; i < 40; i++) {
      const s = createMatch([0]);
      s.tick = i * 997;
      s.difficulty = 'rookie';
      startMatch(s);
      untilDrop(s, both({}, {}));
      // A person reacting like a Legend CPU, against a Rookie one.
      const swing = s.countdown - 0.2;
      while (s.phase === 'faceoff') stepMatch(s, both(s.countdown <= swing ? back(s, 0) : {}, {}));
      if (s.puck.lastTouch === 0) legend++;
    }
    expect(legend).toBeGreaterThan(28);
  });
});

describe('shootout with two people', () => {
  it('puts each side on its only skater: the shooter, then the goalie facing them', () => {
    const s = createMatch([0, 1], 'shootout');
    startMatch(s);
    for (const attempt of [0, 1]) {
      const shooting = s.shootoutShooter,
        defending = (1 - shooting) as Team;
      const shooter = s.skaters[s.sides[shooting].humans[0].controlled],
        keeper = s.skaters[s.sides[defending].humans[0].controlled];
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

/** Two people on the home bench against the CPU, on open ice, nobody able to interfere. */
function sameBench(mode: Parameters<typeof createMatch>[1] = 'exhibition') {
  const s = createMatch([0, 0], mode);
  s.phase = 'playing';
  s.skaters.forEach((p, i) => {
    p.cooldown = 10;
    if (p.role === 'G') return;
    Object.assign(p, { x: -20 + (i % 6) * 8, z: p.team ? -25 : 12, vx: 0, vz: 0 });
  });
  return s;
}
const seats = (...frames: Partial<typeof EMPTY_INPUT>[]): SideInputs => [
  frames.map((f) => ({ ...EMPTY_INPUT, ...f })),
  [],
];
/** Nobody is ever holding a skater somebody else on their bench is holding. */
const heldOnce = (s: MatchState) => {
  const held = s.sides.flatMap((side) => side.humans.map((h) => h.controlled));
  expect(new Set(held).size).toBe(held.length);
};
const place = (p: Skater, x: number, z: number) => Object.assign(p, { x, z, vx: 0, vz: 0 });
const tape = (s: MatchState, p: Skater) => {
  Object.assign(s.puck, { ...stickTip(p), y: 0.1, vx: 0, vz: 0, vy: 0 });
  Object.assign(s.puck, { owner: p.id, lastTouch: p.team, shot: false, lockout: 0 });
};

describe('two people on the same bench', () => {
  it('seats both on the home side, on different skaters, and leaves the away side to the CPU', () => {
    const s = createMatch([0, 0]);
    expect(s.sides[0].humans.map((h) => s.skaters[h.controlled].role)).toEqual(['C', 'LW']);
    expect(s.sides[1].humans).toEqual([]);
    heldOnce(s);
  });

  it('puts the second person in goal in 1-on-1, where there is nobody else to take', () => {
    const s = createMatch([0, 0], 'oneOnOne');
    expect(s.sides[0].humans.map((h) => s.skaters[h.controlled].role)).toEqual(['C', 'G']);
    heldOnce(s);
  });

  it('still plays the CPU bench at the chosen difficulty, and the home bench at All-Star', () => {
    const s = createMatch([0, 0]),
      solo = createMatch(0);
    s.difficulty = solo.difficulty = 'rookie';
    expect(cpuTune(s, s.skaters[7])).toEqual(cpuTune(solo, solo.skaters[7]));
    expect(cpuTune(s, s.skaters[2])).toEqual(cpuTune(createMatch([0, 1]), s.skaters[2]));
  });

  it('drives each skater from its own person', () => {
    const s = sameBench();
    const [one, two] = s.sides[0].humans.map((h) => s.skaters[h.controlled]);
    one.cooldown = two.cooldown = 0;
    run(s, seats({ moveX: 1 }, { moveX: -1 }), 0.6);
    expect(one.vx).toBeGreaterThan(1);
    expect(two.vx).toBeLessThan(-1);
  });

  it('holds the second person still when only the first has a frame', () => {
    const s = sameBench();
    const two = s.skaters[s.sides[0].humans[1].controlled];
    two.cooldown = 0;
    run(s, seats({ moveX: 1 }), 0.5);
    expect(Math.hypot(two.vx, two.vz)).toBeLessThan(0.001);
  });

  it('winds up only the stick that is holding the button', () => {
    const s = sameBench();
    const [one] = s.sides[0].humans;
    tape(s, s.skaters[one.controlled]);
    run(s, seats({ stickY: 1 }, { stickY: 1 }), 0.3);
    expect(one.shotCharge).toBeGreaterThan(0.2);
    expect(s.sides[0].humans[1].shotCharge).toBe(0);
  });

  describe('switching', () => {
    it('never lands on the skater the other person is holding', () => {
      const s = sameBench();
      const [one, two] = s.sides[0].humans;
      // The puck is loose right beside the partner, so they are the obvious pick for a switch.
      const partner = s.skaters[two.controlled];
      place(partner, -5, 0);
      Object.assign(s.puck, { x: -4, z: 0, owner: null });
      stepMatch(s, seats({ switchPlayer: true }));
      expect(one.controlled).not.toBe(partner.id);
      expect(two.controlled).toBe(partner.id);
      heldOnce(s);
    });

    it('leaves a carrier to the teammate who has them, rather than jumping onto the puck', () => {
      const s = sameBench();
      const [one, two] = s.sides[0].humans;
      tape(s, s.skaters[two.controlled]);
      stepMatch(s, seats({ switchPlayer: true }));
      expect(one.controlled).not.toBe(two.controlled);
      expect(s.skaters[one.controlled].role).not.toBe('G');
      heldOnce(s);
    });

    it('still takes an AI carrier on the same bench', () => {
      const s = sameBench();
      const [one] = s.sides[0].humans;
      tape(s, s.skaters[2]);
      stepMatch(s, seats({ switchPlayer: true }));
      expect(one.controlled).toBe(2);
    });

    it('gives the first seat first pick when both switch on the same step', () => {
      const alone = sameBench();
      Object.assign(alone.puck, { x: -10, z: 0, owner: null });
      stepMatch(alone, seats({ switchPlayer: true }));
      const firstPick = alone.sides[0].humans[0].controlled;

      const s = sameBench();
      Object.assign(s.puck, { x: -10, z: 0, owner: null });
      stepMatch(s, seats({ switchPlayer: true }, { switchPlayer: true }));
      expect(s.sides[0].humans[0].controlled).toBe(firstPick);
      heldOnce(s);
    });

    it('stays put when the only other skater is the partner, as in a 1-on-1', () => {
      const s = sameBench('oneOnOne');
      const [one, two] = s.sides[0].humans;
      const [was, wasTwo] = [one.controlled, two.controlled];
      stepMatch(s, seats({ switchPlayer: true }, { switchPlayer: true }));
      expect([one.controlled, two.controlled]).toEqual([was, wasTwo]);
    });
  });

  describe('who the puck brings the stick to', () => {
    it('keeps both people where they are on a pass between them', () => {
      const s = sameBench();
      const [one, two] = s.sides[0].humans;
      const passer = s.skaters[one.controlled],
        receiver = s.skaters[two.controlled];
      place(passer, 0, 0);
      place(receiver, 0, -8);
      tape(s, passer);
      passPuck(s, passer, 0, -1);
      expect(s.puck.passTo).toBe(receiver.id);
      expect([one.controlled, two.controlled]).toEqual([passer.id, receiver.id]);
    });

    it('sends the passer after the puck on a pass to a CPU teammate, even with the partner closer', () => {
      const s = sameBench();
      const [one, two] = s.sides[0].humans;
      const passer = s.skaters[one.controlled],
        partner = s.skaters[two.controlled],
        receiver = s.skaters[3];
      place(passer, 0, 0);
      place(receiver, 0, -10);
      place(partner, 2, -11);
      tape(s, passer);
      passPuck(s, passer, 0, -1);
      expect(s.puck.passTo).toBe(receiver.id);
      expect(one.controlled).toBe(receiver.id);
      expect(two.controlled).toBe(partner.id);
      heldOnce(s);
    });

    it('hands a puck a CPU teammate picks up to whichever person is nearer', () => {
      const s = sameBench();
      const [one, two] = s.sides[0].humans;
      const far = s.skaters[one.controlled],
        near = s.skaters[two.controlled],
        mate = s.skaters[3];
      place(far, -20, 0);
      place(near, 6, 0);
      place(mate, 3, 0);
      mate.cooldown = 0;
      Object.assign(s.puck, { ...stickTip(mate), y: 0.1, vx: 0, vz: 0, vy: 0, owner: null });
      Object.assign(s.puck, { lockout: 0, shot: false, lastTouch: 1 });
      stepMatch(s, seats({}, {}));
      expect(s.puck.owner).toBe(mate.id);
      expect(two.controlled).toBe(mate.id);
      expect(one.controlled).toBe(far.id);
      heldOnce(s);
    });

    it('moves only the nearer person into goal when the goalie freezes it', () => {
      const s = sameBench();
      const [one, two] = s.sides[0].humans;
      const g = s.skaters.find((p) => p.role === 'G' && p.team === 0)!;
      const far = s.skaters[one.controlled],
        near = s.skaters[two.controlled];
      place(far, 0, 0);
      place(near, g.x * 0.8, 3);
      Object.assign(s.puck, { x: g.x, z: g.z, y: 0.1, vx: 0, vz: 0, vy: 0, shot: true });
      Object.assign(s.puck, { owner: null, lockout: 0 });
      g.cooldown = 0;
      stepMatch(s, seats({}, {}));
      expect(s.puck.owner).toBe(g.id);
      expect(two.controlled).toBe(g.id);
      expect(one.controlled).toBe(far.id);
      heldOnce(s);
    });
  });

  it('takes the draw from whoever is on the centre, not the winger swinging beside them', () => {
    const early = createMatch([0, 0]);
    startMatch(early);
    // Only the winger swings, and early: that must not count as the side jumping it.
    stepMatch(early, seats({}, { pass: true }));
    expect(early.sides[0].drawInput).toBe(-1);
    stepMatch(early, seats({ pass: true }, {}));
    expect(early.sides[0].drawInput).toBeGreaterThan(0);
  });

  it('starts every faceoff with the first seat on the centre and the second on a wing', () => {
    const s = sameBench();
    const [one, two] = s.sides[0].humans;
    tape(s, s.skaters[3]);
    stepMatch(s, seats({ switchPlayer: true }, { switchPlayer: true }));
    resetFormation(s);
    expect(s.skaters[one.controlled].role).toBe('C');
    expect(s.skaters[two.controlled].role).toBe('LW');
  });

  it('takes turns in a shootout, shooting and in goal, with the other seat sitting it out', () => {
    const s = createMatch([0, 0], 'shootout');
    startMatch(s);
    const turns: { shooting: Team; seat: number }[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      heldOnce(s);
      const shooting = s.shootoutShooter;
      const onIce = s.sides[0].humans.findIndex((h) => isOnIce(s, s.skaters[h.controlled]));
      const off = s.sides[0].humans.filter((h) => !isOnIce(s, s.skaters[h.controlled]));
      expect(onIce).toBeGreaterThanOrEqual(0);
      expect(off).toHaveLength(1);
      const role = s.skaters[s.sides[0].humans[onIce].controlled].role;
      expect(role).toBe(shooting === 0 ? 'C' : 'G');
      turns.push({ shooting, seat: onIce });
      s.shootoutTaken[shooting]++;
      s.shootoutShooter = (1 - shooting) as Team;
      resetFormation(s);
      startMatch(s);
    }
    const shots = turns.filter((t) => t.shooting === 0).map((t) => t.seat);
    const saves = turns.filter((t) => t.shooting === 1).map((t) => t.seat);
    expect(shots).toEqual([0, 1]);
    expect(saves).toEqual([0, 1]);
  });

  it('never has two people on one skater through a long scramble', () => {
    const s = createMatch([0, 0], 'threeOnThree');
    startMatch(s);
    for (let i = 0; i < 20 / RULES.fixedStep; i++) {
      const beat = Math.floor(i / 30);
      stepMatch(
        s,
        seats(
          { moveX: Math.sin(beat), moveZ: Math.cos(beat), switchPlayer: beat % 3 === 0 },
          { moveX: -Math.cos(beat), pass: beat % 4 === 1, switchPlayer: beat % 5 === 2 },
        ),
        RULES.fixedStep,
      );
      if (i % 12 === 0) heldOnce(s);
      if (s.phase === 'goal' || s.phase === 'intermission') {
        resetFormation(s);
        startMatch(s);
      }
    }
    heldOnce(s);
  });
});

describe('two people on one bench, over the wire and in a replay', () => {
  it('carries both people on a side through a snapshot', () => {
    const host = createMatch([0, 0]);
    startMatch(host);
    host.phase = 'playing';
    host.sides[0].humans[1].shotCharge = 0.6;
    host.sides[0].humans[1].passTarget = 3;
    const guest = createMatch([0, 1]);
    poseSnapshot(guest, decodeSnapshot(encodeSnapshot(host)));
    expect(guest.sides[0].humans.map((h) => h.controlled)).toEqual(
      host.sides[0].humans.map((h) => h.controlled),
    );
    expect(guest.sides[0].humans[1].shotCharge).toBeCloseTo(0.6, 2);
    expect(guest.sides[0].humans[1].passTarget).toBe(3);
    expect(guest.sides[1].humans).toEqual([]);
  });

  it('replays each person on their own skater', () => {
    const s = sameBench();
    const buffer = new ReplayBuffer();
    s.sides[0].humans[1].shotCharge = 0.8;
    buffer.record(s);
    s.sides[0].humans[1].shotCharge = 0.4;
    buffer.record(s);
    const view = createView(s);
    sampleReplay(view, buffer.snapshot(), 0.5 / REPLAY_HZ);
    expect(view.sides[0].humans).toHaveLength(2);
    expect(view.sides[0].humans[1].controlled).toBe(s.sides[0].humans[1].controlled);
    expect(view.sides[0].humans[1].shotCharge).toBeCloseTo(0.6, 2);
    expect(view.sides[0].humans[0].shotCharge).toBe(0);
  });
});
