import { describe, expect, it } from 'vitest';
import { cycleClub, jerseysFor, LEAGUES, openingMatchup, uniformFor } from '../src/game/clubs';
import { createMatch } from '../src/game/engine';

const nhl = LEAGUES.find((l) => l.id === 'nhl')!;

describe('leagues', () => {
  it('fields a full, uniquely numbered lineup for every NHL club', () => {
    expect(nhl.clubs).toHaveLength(32);
    for (const club of nhl.clubs) {
      expect(club.lineup).toHaveLength(6);
      expect(new Set(club.lineup.map((p) => p.number)).size).toBe(6);
      expect(club.lineup.every((p) => p.name.length > 0)).toBe(true);
    }
  });

  it('opens on a real matchup with the away side in white', () => {
    const [home, away] = openingMatchup(nhl);
    expect([home.key, away.key]).toEqual(['nhl:TOR', 'nhl:MTL']);
    expect(uniformFor(home, 'home').jersey).toBe(home.home.jersey);
    expect(uniformFor(away, 'away').jersey).not.toBe(uniformFor(home, 'home').jersey);
    expect(home.logoLight).toMatch(/logos\/nhl\/TOR_light\.svg$/);
    expect(uniformFor(home, 'home').crest).toMatch(/logos\/nhl\/TOR_dark\.svg$/);
    expect(uniformFor(away, 'away').crest).toMatch(/logos\/nhl\/MTL_light\.svg$/);
    expect(jerseysFor(0, 'away')).toEqual(['away', 'home']);
    expect(jerseysFor(1, 'home')).toEqual(['away', 'home']);
  });

  it('never cycles a club into playing itself', () => {
    const [home, away] = openingMatchup(nhl);
    let club = home;
    for (let i = 0; i < nhl.clubs.length * 2; i++) {
      club = cycleClub(nhl, club, away, i % 3 ? 1 : -1);
      expect(club.key).not.toBe(away.key);
    }
  });

  it("puts the chosen clubs' starters on the ice", () => {
    const teams = openingMatchup(nhl);
    const s = createMatch(0, 'exhibition', teams);
    expect(s.teams).toBe(teams);
    expect(s.skaters.map((p) => `${p.name} ${p.number}`)).toEqual(
      [...teams[0].lineup, ...teams[1].lineup].map((p) => `${p.name} ${p.number}`),
    );
  });
});
