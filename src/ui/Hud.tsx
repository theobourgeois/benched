import { ArrowRight } from 'lucide-react';
import { lazy, Suspense, useState, type CSSProperties } from 'react';
import { attackDirection } from '../game/config';
import { modeInfo } from '../game/modes';
import {
  beginGame,
  canInstantReplay,
  continueGame,
  openInstantReplay,
  pauseGame,
  returnToMenu,
  runtime,
  useGame,
} from '../app/store';
import { askToLeave, leaveOnline } from '../app/online';
import { cameraUsesAttackUp, type MatchState, type Team } from '../game/types';

/**
 * The simulation leaves point-of-view calls neutral and marks who they happened to, so each
 * client phrases them for the side it is watching.
 */
function noticeText(s: MatchState, you: Team) {
  if (s.noticeTeam === null) return s.notice;
  const mine = s.noticeTeam === you;
  if (s.notice === 'DRAW') return mine ? 'DRAW WON' : 'DRAW LOST';
  if (s.notice === 'SHOT') return mine ? 'YOUR SHOT' : 'THEIR SHOT';
  return s.notice;
}
import { step, useNav } from '../input/menuNavigation';
import { ControlsScreen } from './Controls';
import { FpsCounter } from './FpsCounter';
/** Dev-only feel tuner: a separate chunk, absent from a production build. */
const FeelHud = import.meta.env.DEV
  ? lazy(() => import('./FeelHud').then((m) => ({ default: m.FeelHud })))
  : null;
import { MenuItem, Prompts, TeamLogo, TitleBar } from './kit';
import { SettingsScreen } from './Settings';

export function formatClock(seconds: number) {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function periodMark(period: number) {
  if (period === 1) return '1st';
  if (period === 2) return '2nd';
  if (period === 3) return '3rd';
  return `${period}th`;
}
const shootoutMark = (round: number) => (round > 3 ? 'SD' : `Rnd ${round}`);
/** Away on the left, home on the right, the same way round as the matchup screen. */
const BROADCAST_ORDER = [1, 0] as const;
const club = (c: string) => ({ '--club': c }) as CSSProperties;

type Panel = 'settings' | 'controls' | null;

/** On the ice: the score, your skater, and the calls. Nothing else. */
export function Hud() {
  const { match: s, settings } = useGame();
  const [panel, setPanel] = useState<Panel>(null);
  const [feel, setFeel] = useState(false);
  const [pauseIndex, setPauseIndex] = useState(0);
  const paused = s.phase === 'paused';
  return (
    <div className="hud" data-phase={s.phase}>
      {settings.showFps && <FpsCounter />}
      <ScoreBug s={s} />
      {s.phase === 'playing' && s.noticeTimer > 0 && (
        <div className="notice" key={s.notice}>
          {noticeText(s, runtime.myTeam)}
        </div>
      )}
      {s.phase === 'playing' && !cameraUsesAttackUp(settings.camera) && <AttackArrow s={s} />}
      {runtime.net && <OnlineOverlay />}
      {s.phase !== 'intermission' && s.phase !== 'final' && (
        <>
          <PlayerCard s={s} team={runtime.myTeam} />
          {/* A second person on the couch gets their own card, mirrored to the far corner. */}
          {s.sides[1 - runtime.myTeam].human && (
            <PlayerCard s={s} team={(1 - runtime.myTeam) as Team} seat="two" />
          )}
        </>
      )}
      {s.phase === 'faceoff' && <Faceoff s={s} />}
      {s.phase === 'goal' && <GoalCall s={s} />}
      {paused && !panel && !feel && (
        <PauseMenu
          index={pauseIndex}
          setIndex={setPauseIndex}
          onPanel={setPanel}
          onFeel={() => setFeel(true)}
        />
      )}
      {paused && panel === 'settings' && (
        <SettingsScreen crumb="Paused" onClose={() => setPanel(null)} />
      )}
      {paused && panel === 'controls' && (
        <ControlsScreen crumb="Paused" onClose={() => setPanel(null)} />
      )}
      {(s.phase === 'intermission' || s.phase === 'final') && <Results s={s} />}
      {FeelHud && (
        <Suspense fallback={null}>
          <FeelHud open={feel} onOpenChange={setFeel} />
        </Suspense>
      )}
    </div>
  );
}

function ScoreBug({ s }: { s: MatchState }) {
  if (modeInfo(s.mode).practice)
    return (
      <div className="bug">
        <div className="bug-clock">
          <strong>Free Skate</strong>
        </div>
      </div>
    );
  return (
    <div className="bug" aria-label="Scoreboard">
      {BROADCAST_ORDER.map((t) => (
        <div key={t} className="bug-team" style={club(s.teams[t].accent)}>
          <TeamLogo club={s.teams[t]} />
          <span>{s.teams[t].abbr}</span>
          <strong>{s.score[t]}</strong>
        </div>
      ))}
      <div className="bug-clock">
        <span>{s.mode === 'shootout' ? shootoutMark(s.shootoutRound) : periodMark(s.period)}</span>
        <strong>{formatClock(s.clock)}</strong>
      </div>
    </div>
  );
}

/**
 * Online there is nothing to pause, so this covers the two things that still need saying: the
 * other person has gone, or you pressed the button that used to pause and probably meant to
 * leave. It never stops the simulation, because the other end is still playing it.
 */
function OnlineOverlay() {
  const { net, leaving } = useGame();
  const gone = net?.notice;
  const [index, setIndex] = useState(0);
  const items = gone
    ? [{ label: 'Quit to Menu', run: leaveOnline }]
    : [
        { label: 'Back to the game', run: () => askToLeave(false) },
        { label: 'Leave game', run: leaveOnline },
      ];
  useNav((a) => {
    if (!gone && a === 'back') return askToLeave(false);
    if (a === 'up' || a === 'down') setIndex(step(index, a === 'up' ? -1 : 1, items.length));
    if (a === 'confirm') items[index].run();
  });
  if (!gone && !leaving) return null;
  return (
    <div className="screen online-overlay" role="dialog" aria-modal="true" aria-label="Online game">
      <div className="stage-frame narrow">
        <div className="plate">
          <TitleBar crumb="Online" title={gone ? 'Opponent left' : 'Leave game?'} />
          {gone && <p className="room-notice">{gone}</p>}
          {!gone && (
            <p className="online-lede">
              There is no pause online — the other person is still playing. You can leave, and they
              will be told.
            </p>
          )}
          <nav className="menu-list" aria-label="Online options">
            {items.map((item, i) => (
              <MenuItem
                key={item.label}
                focused={i === index}
                onFocus={() => setIndex(i)}
                onSelect={item.run}
              >
                {item.label}
              </MenuItem>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

/** The wide camera runs sideways, so it needs to say which way you are going. */
function AttackArrow({ s }: { s: MatchState }) {
  const dir = attackDirection(runtime.myTeam, s.period);
  return (
    <div className="attack" aria-label="Attacking direction">
      {dir < 0 && <ArrowRight className="flip" size={16} />}
      Attack
      {dir > 0 && <ArrowRight size={16} />}
    </div>
  );
}

function PlayerCard({ s, team, seat }: { s: MatchState; team: Team; seat?: 'two' }) {
  const side = s.sides[team];
  const p = s.skaters[side.controlled];
  const status = p.downTimer > 0 ? 'Down' : p.stumbleTimer > 0 ? 'Off balance' : null;
  return (
    <div className="player-card" data-seat={seat} style={club(s.teams[team].accent)}>
      <span className="pc-number">{p.number}</span>
      <div className="pc-body">
        {side.shotCharge > 0.05 && (
          <div className="meter power" aria-label="Shot power">
            <i style={{ width: `${side.shotCharge * 100}%` }} />
          </div>
        )}
        <strong>{p.name}</strong>
        <div className="meter stamina" data-low={p.stamina < 0.25 || undefined}>
          <i style={{ width: `${p.stamina * 100}%` }} />
        </div>
      </div>
      {status && <span className="pc-status">{status}</span>}
    </div>
  );
}

function Faceoff({ s }: { s: MatchState }) {
  const count = Math.ceil(s.countdown) || 1;
  return (
    <div className="faceoff">
      <span>{periodMark(s.period)} period</span>
      <strong key={count}>{count}</strong>
    </div>
  );
}

function GoalCall({ s }: { s: MatchState }) {
  const practice = modeInfo(s.mode).practice;
  const scorer = s.scoringTeam === null ? null : s.teams[s.scoringTeam];
  const style = {
    ...club(scorer?.accent ?? '#5d7894'),
    '--beat': `${runtime.audio.celebrationBeat()}s`,
  } as CSSProperties;
  return (
    <div className="goal-call" style={style} data-scored={scorer ? 'yes' : 'no'}>
      {scorer && <div className="goal-flash" />}
      <div className="goal-band" />
      {scorer && !practice && (
        <span className="goal-team">
          {scorer.city} {scorer.name}
        </span>
      )}
      <strong className="goal-word">
        {scorer ? 'GOAL' : (s.notice || 'NO GOAL').toUpperCase()}
      </strong>
      {scorer && !practice && (
        <div className="goal-score">
          <TeamLogo club={s.teams[1]} />
          <b className={s.scoringTeam === 1 ? 'scored' : ''}>{s.score[1]}</b>
          <i>–</i>
          <b className={s.scoringTeam === 0 ? 'scored' : ''}>{s.score[0]}</b>
          <TeamLogo club={s.teams[0]} />
        </div>
      )}
    </div>
  );
}

function PauseMenu({
  index,
  setIndex,
  onPanel,
  onFeel,
}: {
  index: number;
  setIndex: (i: number) => void;
  onPanel: (panel: Panel) => void;
  onFeel: () => void;
}) {
  const items = [
    { label: 'Resume', run: pauseGame },
    { label: 'Instant Replay', run: openInstantReplay, disabled: !canInstantReplay() },
    { label: 'Settings', run: () => onPanel('settings') },
    { label: 'Controls', run: () => onPanel('controls') },
    ...(import.meta.env.DEV ? [{ label: 'Feel Tuner', run: onFeel }] : []),
    { label: 'Quit to Menu', run: returnToMenu },
  ];
  const at = Math.min(index, items.length - 1);
  const skip = (i: number) => !!items[i].disabled;
  const run = (i: number) => !items[i].disabled && items[i].run();
  useNav((a) => {
    if (a === 'up' || a === 'down') setIndex(step(at, a === 'up' ? -1 : 1, items.length, skip));
    else if (a === 'confirm') run(at);
    else if (a === 'back' || a === 'start') pauseGame();
  });
  return (
    <div className="pause-layer">
      <section className="pause" role="dialog" aria-modal="true" aria-label="Game paused">
        <h2 className="title-bar pause-title">Paused</h2>
        <nav className="plate menu-list">
          {items.map((item, i) => (
            <MenuItem
              key={item.label}
              focused={i === at}
              disabled={item.disabled}
              onFocus={() => setIndex(i)}
              onSelect={() => run(i)}
              className={item.label === 'Quit to Menu' ? 'gap' : ''}
            >
              {item.label}
            </MenuItem>
          ))}
        </nav>
      </section>
      <Prompts
        items={[
          { k: 'confirm', label: 'Select', onClick: () => run(at) },
          { k: 'back', label: 'Resume', onClick: pauseGame },
        ]}
      />
    </div>
  );
}

function Results({ s }: { s: MatchState }) {
  const [index, setIndex] = useState(0);
  const final = s.phase === 'final';
  const you = runtime.myTeam;
  const headline = !final
    ? 'Intermission'
    : s.score[0] === s.score[1]
      ? 'Draw'
      : s.score[you] > s.score[1 - you]
        ? 'You win'
        : 'You lose';
  const items = [
    final
      ? { label: 'Rematch', run: () => beginGame(runtime.myTeam, s.mode) }
      : { label: `Start period ${s.period + 1}`, run: continueGame },
    { label: 'Quit to Menu', run: returnToMenu },
  ];
  useNav((a) => {
    if (a === 'up' || a === 'down') setIndex(step(index, a === 'up' ? -1 : 1, items.length));
    else if (a === 'confirm') items[index].run();
    else if (a === 'start') items[0].run();
  });
  const stats: [string, (t: 0 | 1) => string][] = [
    ['Shots', (t) => String(s.shots[t])],
    ['Hits', (t) => String(s.hits[t])],
    ['Possession', (t) => formatClock(s.possession[t])],
  ];
  return (
    <div className="results-layer">
      <section
        className="results"
        role="dialog"
        aria-modal="true"
        aria-label={final ? 'Final results' : 'Intermission'}
      >
        <header className="title-bar">
          <div className="crumb">
            <span>{final ? 'Final' : `End of ${periodMark(s.period)}`} /</span>
            <h2>{headline}</h2>
          </div>
        </header>
        <div className="plate results-body">
          <div className="results-score">
            <div className="results-team">
              <TeamLogo club={s.teams[1]} />
              <span>{s.teams[1].abbr}</span>
            </div>
            <strong>
              {s.score[1]}
              <i>–</i>
              {s.score[0]}
            </strong>
            <div className="results-team">
              <TeamLogo club={s.teams[0]} />
              <span>{s.teams[0].abbr}</span>
            </div>
          </div>
          <dl className="stats">
            {stats.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value(1)}</dd>
                <dd>{value(0)}</dd>
              </div>
            ))}
          </dl>
          <nav className="menu-list">
            {items.map((item, i) => (
              <MenuItem
                key={item.label}
                focused={i === index}
                onFocus={() => setIndex(i)}
                onSelect={item.run}
              >
                {item.label}
              </MenuItem>
            ))}
          </nav>
        </div>
      </section>
      <Prompts items={[{ k: 'confirm', label: 'Select', onClick: () => items[index].run() }]} />
    </div>
  );
}
