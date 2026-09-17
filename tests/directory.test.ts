import { describe, expect, it } from 'vitest';
import { chooseListing, CLAIM_MS, isOpen, type RoomListing } from '../src/net/protocol';

/**
 * The directory makes one decision: which room quick play sends somebody to. It is a pure
 * function of the listings, so it is checked here rather than through a worker.
 */

type Listed = RoomListing & { claimedUntil: number };
const listing = (over: Partial<Listed>): Listed => ({
  code: 'AAAA',
  host: 'Player 1',
  mode: 'exhibition',
  public: true,
  seats: 1,
  playing: false,
  since: 1000,
  claimedUntil: 0,
  ...over,
});

describe('chooseListing', () => {
  it('serves the host who has waited longest', () => {
    const rooms = [
      listing({ code: 'NEWR', since: 3000 }),
      listing({ code: 'OLDR', since: 1000 }),
      listing({ code: 'MIDR', since: 2000 }),
    ];
    expect(chooseListing(rooms, 'any', 5000)?.code).toBe('OLDR');
  });

  it('only offers rooms anybody can walk into', () => {
    const rooms = [
      listing({ code: 'PRIV', public: false }),
      listing({ code: 'FULL', seats: 2 }),
      listing({ code: 'LIVE', playing: true, seats: 2 }),
      listing({ code: 'EMPT', seats: 0 }),
      listing({ code: 'OPEN', since: 9000 }),
    ];
    expect(rooms.map(isOpen)).toEqual([false, false, false, false, true]);
    expect(chooseListing(rooms, 'any', 10_000)?.code).toBe('OPEN');
  });

  it('matches the mode asked for, and any takes whatever is oldest', () => {
    const rooms = [
      listing({ code: 'SHOT', mode: 'shootout', since: 1000 }),
      listing({ code: 'EXHI', mode: 'exhibition', since: 2000 }),
    ];
    expect(chooseListing(rooms, 'exhibition', 5000)?.code).toBe('EXHI');
    expect(chooseListing(rooms, 'any', 5000)?.code).toBe('SHOT');
    expect(chooseListing(rooms, 'oneOnOne', 5000)).toBeNull();
  });

  it('skips a room handed to somebody else until the claim runs out', () => {
    const now = 20_000;
    const rooms = [
      listing({ code: 'TAKN', since: 1000, claimedUntil: now + CLAIM_MS }),
      listing({ code: 'FREE', since: 2000 }),
    ];
    expect(chooseListing(rooms, 'any', now)?.code).toBe('FREE');
    expect(chooseListing(rooms, 'any', now + CLAIM_MS + 1)?.code).toBe('TAKN');
  });

  it('has nothing to offer from an empty list', () => {
    expect(chooseListing([], 'any', 0)).toBeNull();
  });
});
