import { ArrowRight } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { attackDirection } from '../game/config';
import { modeInfo } from '../game/modes';
import {
  beginGame,
  canInstantReplay,
  continueGame,
  openInstantReplay,
  pauseGame,
  returnToMenu,
  useGame,
} from '../game/store';
import { cameraUsesAttackUp, type MatchState } from '../game/types';
import { step, useNav } from '../input/menuNavigation';
import { ControlsScreen } from './Controls';
import { FeelHud } from './FeelHud';
import { FpsCounter } from './FpsCounter';
import { MenuItem, Prompts, TeamLogo } from './kit';
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
          {s.notice}
        </div>
      )}
      {s.phase === 'playing' && !cameraUsesAttackUp(settings.camera) && <AttackArrow s={s} />}
      {s.phase !== 'intermission' && s.phase !== 'final' && <PlayerCard s={s} />}
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
      <FeelHud open={feel} onOpenChange={setFeel} />
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

/** The wide camera runs sideways, so it needs to say which way you are going. */
function AttackArrow({ s }: { s: MatchState }) {
  const dir = attackDirection(s.homeTeam, s.period);
  return (
    <div className="attack" aria-label="Attacking direction">
      {dir < 0 && <ArrowRight className="flip" size={16} />}
      Attack
      {dir > 0 && <ArrowRight size={16} />}
    </div>
  );
}

function PlayerCard({ s }: { s: MatchState }) {
  const p = s.skaters[s.controlled];
  const status = p.downTimer > 0 ? 'Down' : p.stumbleTimer > 0 ? 'Off balance' : null;
  return (
    <div className="player-card" style={club(s.teams[s.homeTeam].accent)}>
      <span className="pc-number">{p.number}</span>
      <div className="pc-body">
        {s.shotCharge > 0.05 && (
          <div className="meter power" aria-label="Shot power">
            <i style={{ width: `${s.shotCharge * 100}%` }} />
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
  return (
    <div className="goal-call" style={club(scorer?.accent ?? '#5d7894')}>
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
          <b>{s.score[1]}</b>
          <i>–</i>
          <b>{s.score[0]}</b>
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
  const you = s.homeTeam;
  const headline = !final
    ? 'Intermission'
    : s.score[0] === s.score[1]
      ? 'Draw'
      : s.score[you] > s.score[1 - you]
        ? 'You win'
        : 'You lose';
  const items = [
    final
      ? { label: 'Rematch', run: () => beginGame(s.homeTeam, s.mode) }
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
