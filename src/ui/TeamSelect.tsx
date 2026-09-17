import { ChevronDown, ChevronUp, Gamepad2, Keyboard, X } from 'lucide-react';
import { useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import {
  cycleClub,
  jerseysFor,
  LEAGUES,
  leagueOf,
  openingMatchup,
  otherJersey,
  uniformFor,
  type Club,
} from '../game/clubs';
import { DIFFICULTIES, difficultyInfo } from '../game/difficulty';
import { MODES, modeInfo } from '../game/modes';
import { beginGame, updateSettings, useGame } from '../app/store';
import type { GameMode, Jersey, Team } from '../game/types';
import { useDevice, useNav, useSeatTwoNav } from '../input/menuNavigation';
import { Glyph, JerseyIcon, Prompts, TeamLogo, TitleBar } from './kit';

/** Pick a club, then ready up. Once ready, up and down swap your sweater. */
type Stage = 'team' | 'ready';
/**
 * Where a second person on the couch is sitting, relative to seat one: across the ice, or on the
 * same bench against the CPU. Relative, so seat one changing sides takes the arrangement along.
 */
export type Partner = 'versus' | 'with';
const SIDE = ['home', 'away'] as const;
/** What the bumpers step through. Free skate is its own menu entry, not a format. */
const FORMATS = MODES.filter((m) => !m.practice);
// Written in sentence case and uppercased by CSS, so the tabs read as '3 on 3' to a screen reader.
const formatLabel = (mode: GameMode) =>
  mode === 'shootout' ? 'Shootout' : modeInfo(mode).format.toLowerCase();

export function TeamSelect({
  mode,
  setMode,
  teams,
  setTeams,
  side,
  setSide,
  jersey,
  setJersey,
  partner,
  setPartner,
  onBack,
}: {
  mode: GameMode;
  setMode: (mode: GameMode) => void;
  teams: [Club, Club];
  setTeams: Dispatch<SetStateAction<[Club, Club]>>;
  side: Team;
  setSide: (side: Team) => void;
  jersey: Jersey;
  setJersey: Dispatch<SetStateAction<Jersey>>;
  /** A second person playing on this screen, and which bench they took. */
  partner: Partner | null;
  setPartner: (partner: Partner | null) => void;
  onBack: () => void;
}) {
  const { settings, controllerTwo } = useGame();
  const device = useDevice();
  const [stage, setStage] = useState<Stage>('team');
  const info = modeInfo(mode);
  const league = leagueOf(teams[0]);
  const difficulty = difficultyInfo(settings.difficulty);
  const jerseys = jerseysFor(side, jersey);

  const cycle = (dir: 1 | -1) =>
    setTeams((pair) => {
      const next: [Club, Club] = [...pair];
      next[side] = cycleClub(league, pair[side], pair[1 - side], dir);
      return next;
    });
  const random = () =>
    setTeams((pair) => {
      const pool = league.clubs.filter((c) => c.key !== pair[0].key && c.key !== pair[1].key);
      if (!pool.length) return pair;
      const next: [Club, Club] = [...pair];
      next[side] = pool[Math.floor(Math.random() * pool.length)];
      return next;
    });
  const cycleLeague = (dir: 1 | -1) => {
    if (LEAGUES.length < 2) return;
    const i = LEAGUES.indexOf(league);
    setTeams(openingMatchup(LEAGUES[(i + dir + LEAGUES.length) % LEAGUES.length]));
  };
  const pickSide = (next: Team) => {
    if (next === side) return;
    setSide(next);
    setJersey(next === 0 ? 'home' : 'away');
  };
  const nextDifficulty = () => {
    const i = DIFFICULTIES.findIndex((d) => d.id === settings.difficulty);
    updateSettings({ difficulty: DIFFICULTIES[(i + 1) % DIFFICULTIES.length].id });
  };
  const flip = () => setJersey((j) => otherJersey(j));
  // Two people need two pads. Starting without the second one would leave that bench frozen,
  // so the match waits rather than dropping somebody into a game they cannot play.
  const secondPad = controllerTwo.status.connected;
  const ready = !partner || secondPad;
  /** The bench seat two is on, if anybody is. */
  const partnerSide: Team | null = !partner
    ? null
    : partner === 'with'
      ? side
      : ((1 - side) as Team);
  // With a CPU bench on the ice, its difficulty still matters; two people across the ice have none.
  const versus = partner === 'versus';
  const play = () => ready && beginGame(side, mode, teams, jerseys, partnerSide);
  const advance = () => (stage === 'ready' ? play() : ready && setStage('ready'));
  const unready = () => setStage('team');
  const stepFormat = (dir: 1 | -1) => {
    const i = FORMATS.findIndex((m) => m.id === mode);
    setMode(FORMATS[(i + dir + FORMATS.length) % FORMATS.length].id);
  };
  // Practice is one skater's rink, so there is no second bench to take. Seat two starts across
  // the ice, as a couch game always has.
  const join = () => !info.practice && !partner && setPartner('versus');
  const drop = () => setPartner(null);
  // Away is drawn on the left, home on the right, for seat two exactly as for seat one.
  const sitAt = (bench: Team) => partner && setPartner(bench === side ? 'with' : 'versus');

  // Seat two joins, picks a bench, or leaves. The matchup itself is seat one's to drive.
  useSeatTwoNav((a) => {
    if (a === 'confirm' || a === 'start') join();
    else if (a === 'back') drop();
    else if (a === 'left') sitAt(1);
    else if (a === 'right') sitAt(0);
  });

  useNav((a) => {
    if (a === 'back') return stage === 'ready' ? unready() : onBack();
    if (a === 'confirm') return advance();
    if (a === 'start') return play();
    if (a === 'x') return versus ? undefined : nextDifficulty();
    if (a === 'lb' || a === 'rb')
      return info.practice ? undefined : stepFormat(a === 'lb' ? -1 : 1);
    if (stage === 'ready') {
      if (a === 'up' || a === 'down') flip();
      return;
    }
    // Away is drawn on the left, home on the right, like a broadcast.
    if (a === 'left') pickSide(1);
    else if (a === 'right') pickSide(0);
    else if (a === 'up') cycle(-1);
    else if (a === 'down') cycle(1);
    else if (a === 'y') random();
    else if (a === 'lt') cycleLeague(-1);
    else if (a === 'rt') cycleLeague(1);
  });

  const onPanel = (t: Team) => {
    if (t === side) return advance();
    pickSide(t);
    unready();
  };

  return (
    <div className="screen team-select" data-stage={stage}>
      <div className="stage-frame">
        <TitleBar
          crumb={info.practice ? 'Free Skate' : 'Play Now'}
          title={info.practice ? 'Select Team' : 'Select Teams'}
        >
          <div className="title-chips">
            {!versus && (
              <button
                className="cpu-chip"
                onClick={nextDifficulty}
                aria-label={`CPU difficulty: ${difficulty.label}`}
              >
                <Glyph k="x" />
                <span>CPU</span>
                <strong>{difficulty.label}</strong>
              </button>
            )}
            {partner ? (
              // Both benches skate All-Star with two people across the ice, so there is no
              // difficulty to set; two on one bench still face the CPU at the chosen level.
              <button
                className="cpu-chip"
                data-waiting={!secondPad || undefined}
                onClick={drop}
                aria-label={
                  secondPad
                    ? 'Player two ready. Remove player two'
                    : 'Waiting for a second controller. Remove player two'
                }
              >
                <Gamepad2 size={14} aria-hidden="true" />
                <span>P2</span>
                <strong>{!secondPad ? 'Connect' : versus ? 'Versus' : 'Same team'}</strong>
                <X size={15} aria-hidden="true" />
              </button>
            ) : (
              !info.practice && (
                <button className="cpu-chip join-chip" onClick={join} aria-label="Add player two">
                  <Glyph k="confirm" device="pad" />
                  <span>P2</span>
                  <strong>Join</strong>
                </button>
              )
            )}
          </div>
        </TitleBar>
        {!info.practice && (
          <div className="format-strip">
            <button tabIndex={-1} aria-label="Previous format" onClick={() => stepFormat(-1)}>
              <Glyph k="lb" />
            </button>
            <div className="format-tabs" role="tablist" aria-label="Format">
              {FORMATS.map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={m.id === mode}
                  onClick={() => setMode(m.id)}
                >
                  {formatLabel(m.id)}
                </button>
              ))}
            </div>
            <button tabIndex={-1} aria-label="Next format" onClick={() => stepFormat(1)}>
              <Glyph k="rb" />
            </button>
            <span className="format-duration">{info.duration}</span>
          </div>
        )}
        <div className="plate matchup">
          {([1, 0] as Team[]).map((t) => (
            <TeamPanel
              key={t}
              t={t}
              club={teams[t]}
              mine={t === side}
              partner={t === partnerSide}
              stage={stage}
              jersey={jerseys[t]}
              opponent={info.practice ? 'Goalie' : 'CPU'}
              canCycle={league.clubs.length > 2}
              onPick={() => onPanel(t)}
              onCycle={cycle}
              onFlip={flip}
            />
          ))}
          <div className="matchup-center" aria-hidden="true">
            <span className="versus">VS</span>
            <span className="token" data-side={SIDE[side]}>
              {device === 'pad' ? <Gamepad2 size={24} /> : <Keyboard size={24} />}
            </span>
            {partnerSide !== null && (
              <span className="token" data-side={SIDE[partnerSide]} data-seat="two">
                <Gamepad2 size={24} />
              </span>
            )}
          </div>
        </div>
        <div className="matchup-foot">
          {/* Say why the second bench is empty. A browser hides a pad until it has seen a press
              from that exact controller, which reads as a dead cable if nothing explains it. */}
          {partner && !secondPad && (
            <span className="pad-hint" role="status">
              {controllerTwo.status.state === 'unsupported'
                ? `Second controller not in a layout the browser exposes (${controllerTwo.status.name}).`
                : 'Press a button on the second controller to wake it up.'}
            </span>
          )}
          {partner && secondPad && stage === 'team' && (
            <span className="pad-hint" role="status">
              P2 picks a bench with left and right on their controller.
            </span>
          )}
          {LEAGUES.length > 1 && <span className="league-tag">{league.name}</span>}
          <button className="cta" onClick={advance} disabled={!ready}>
            {!ready ? 'Connect P2 controller' : stage === 'ready' ? 'Play game' : 'Ready'}
            <i className="caret" aria-hidden="true" />
          </button>
        </div>
      </div>
      <Prompts
        items={
          stage === 'team'
            ? [
                { k: 'confirm', label: 'Ready', onClick: advance },
                { k: 'leftright', label: 'Side' },
                { k: 'updown', label: 'Team' },
                ...(info.practice ? [] : [{ k: 'bumpers' as const, label: 'Format' }]),
                { k: 'y', label: 'Random', onClick: random },
                { k: 'back', label: 'Back', onClick: onBack },
              ]
            : [
                { k: 'confirm', label: 'Play', onClick: play },
                { k: 'updown', label: 'Jersey', onClick: flip },
                { k: 'back', label: 'Back', onClick: unready },
              ]
        }
      />
    </div>
  );
}

function TeamPanel({
  t,
  club,
  mine,
  partner,
  stage,
  jersey,
  opponent,
  canCycle,
  onPick,
  onCycle,
  onFlip,
}: {
  t: Team;
  club: Club;
  mine: boolean;
  /** Seat two is on this bench. */
  partner: boolean;
  stage: Stage;
  jersey: Jersey;
  opponent: string;
  canCycle: boolean;
  onPick: () => void;
  onCycle: (dir: 1 | -1) => void;
  onFlip: () => void;
}) {
  const name = SIDE[t];
  const ready = mine && stage === 'ready';
  return (
    <div
      className={`team-panel side-${name}`}
      data-mine={mine || undefined}
      data-ready={ready || undefined}
      style={{ '--club': club.accent } as CSSProperties}
    >
      <button
        className="panel-hit"
        aria-pressed={mine}
        aria-label={`${club.city} ${club.name}`}
        onClick={onPick}
      />
      <span className="watermark" aria-hidden="true">
        {name}
      </span>
      <span className="panel-tag">
        {ready ? 'Ready' : mine && partner ? 'P1 + P2' : mine ? 'P1' : partner ? 'P2' : opponent}
      </span>
      <TeamLogo club={club} className="panel-logo" />
      <div className="panel-name">
        <small>{club.city}</small>
        <strong>{club.name}</strong>
      </div>
      {mine && stage === 'team' && canCycle && (
        <div className="panel-arrows">
          <button aria-label={`Previous ${name} team`} onClick={() => onCycle(-1)}>
            <ChevronUp size={20} />
          </button>
          <button aria-label={`Next ${name} team`} onClick={() => onCycle(1)}>
            <ChevronDown size={20} />
          </button>
        </div>
      )}
      {stage === 'ready' && (
        <div className="panel-jersey">
          {mine && (
            <button aria-label="Previous jersey" onClick={onFlip}>
              <ChevronUp size={18} />
            </button>
          )}
          <JerseyIcon uniform={uniformFor(club, jersey)} />
          <span>{jersey === 'home' ? 'Home' : 'Away'}</span>
          {mine && (
            <button aria-label="Next jersey" onClick={onFlip}>
              <ChevronDown size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
