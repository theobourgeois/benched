import { ArrowRight, Loader2 } from 'lucide-react';
import { lazy, Suspense, useState, type CSSProperties } from 'react';
import { attackDirection, FACEOFF } from '../game/config';
import { modeInfo } from '../game/modes';
import {
  beginGame,
  canInstantReplay,
  continueGame,
  openInstantReplay,
  pauseGame,
  returnToMenu,
  runtime,
  seatHuman,
  useGame,
} from '../app/store';
import {
  askToLeave,
  confirmFound,
  leaveOnline,
  leaveQueue,
  lookAgain,
  returnToLobby,
} from '../app/online';
import { FOUND_CONFIRM_MS } from '../net/protocol';
import type { NetSession } from '../net/session';
import { cameraUsesAttackUp, type Human, type MatchState, type Team } from '../game/types';

/**
 * The simulation leaves point-of-view calls neutral and marks who they happened to, so each
 * client phrases them for the side it is watching.
 */
function noticeText(s: MatchState, you: Team) {
  if (s.noticeTeam === null) return s.notice;
  const mine = s.noticeTeam === you;
  if (s.notice === 'DRAW') return mine ? 'DRAW WON' : 'DRAW LOST';
  if (s.notice === 'JUMPED') return mine ? 'YOU JUMPED IT' : 'THEY JUMPED IT';
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
      {runtime.queue && !runtime.found && <QueueStatus />}
      {runtime.found && <FoundOverlay />}
      {s.phase !== 'intermission' && s.phase !== 'final' && (
        <>
          {seatCards(s).map((card, i) => (
            <PlayerCard key={i} s={s} {...card} />
          ))}
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
 * Online there is nothing to pause, so this covers what still needs saying: a line is down and
 * the game is holding for it, the room called the match off, or you pressed the button that
 * used to pause and probably meant to leave. It never stops the simulation itself; the host's
 * loop holds on its own while a line is down, because the other end sees the same thing.
 */
function OnlineOverlay() {
  const { net, leaving } = useGame();
  if (!net) return null;
  const ended = net.status === 'lobby';
  const cut = !ended && net.interrupted;
  // Mounted only while it shows: a menu layer owns the pad and the keys, so one sitting hidden
  // over the ice would swallow the stick and the pause button for the whole match.
  if (!ended && !cut && !leaving) return null;
  return <OnlineDialog net={net} ended={ended} cut={cut} />;
}

function OnlineDialog({ net, ended, cut }: { net: NetSession; ended: boolean; cut: boolean }) {
  const [index, setIndex] = useState(0);
  const reconnecting = cut && !net.connected;
  const waiting = cut && net.connected;
  const items = ended
    ? [
        { label: 'Back to lobby', run: returnToLobby },
        { label: 'Quit to Menu', run: leaveOnline },
      ]
    : reconnecting || waiting
      ? [{ label: 'Leave game', run: leaveOnline }]
      : [
          { label: 'Back to the game', run: () => askToLeave(false) },
          { label: 'Leave game', run: leaveOnline },
        ];
  const at = Math.min(index, items.length - 1);
  const asking = !ended && !reconnecting && !waiting;
  useNav((a) => {
    if (asking && a === 'back') return askToLeave(false);
    if (a === 'up' || a === 'down') setIndex(step(at, a === 'up' ? -1 : 1, items.length));
    if (a === 'confirm') items[at].run();
  });
  const them = net.opponent?.name ?? 'the other player';
  const remaining = net.awayRemaining;
  const title = ended
    ? 'Game over'
    : reconnecting
      ? 'Reconnecting'
      : waiting
        ? 'Connection lost'
        : 'Leave game?';
  return (
    <div className="screen online-overlay" role="dialog" aria-modal="true" aria-label="Online game">
      <div className="stage-frame narrow">
        <div className="plate">
          <TitleBar crumb="Online" title={title} />
          {ended && (
            <p className="room-notice">
              {net.notice ?? 'The game was called off.'} The room is still open: back in the lobby
              they can rejoin with code <strong>{net.room}</strong>.
            </p>
          )}
          {reconnecting && (
            <p className="online-lede" role="status">
              Lost the line to the game. Trying again — the game is on hold, and your seat is kept
              while you are away.
            </p>
          )}
          {waiting && (
            <p className="online-lede" role="status">
              Waiting for {them} to come back. The game is on hold
              {remaining !== null && ` — ${Math.ceil(remaining / 1000)}s before it is called off`}.
            </p>
          )}
          {asking && (
            <p className="online-lede">
              There is no pause online — the other person is still playing. You can leave, and they
              will be told.
            </p>
          )}
          <nav className="menu-list" aria-label="Online options">
            {items.map((item, i) => (
              <MenuItem
                key={item.label}
                focused={i === at}
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

/**
 * A card for each person this screen should show: seat one, then one more mirrored to the far
 * corner — the couch partner on either bench, or online the person across the ice.
 */
function seatCards(s: MatchState): { team: Team; human: Human; seat?: 'two' }[] {
  const one = seatHuman(0, s);
  const two = runtime.net ? s.sides[1 - runtime.myTeam].humans[0] : seatHuman(1, s);
  const cards: { team: Team; human: Human; seat?: 'two' }[] = [];
  if (one) cards.push({ team: runtime.myTeam, human: one });
  if (two) cards.push({ team: s.skaters[two.controlled].team, human: two, seat: 'two' });
  return cards;
}

function PlayerCard({
  s,
  team,
  human: side,
  seat,
}: {
  s: MatchState;
  team: Team;
  human: Human;
  seat?: 'two';
}) {
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

/**
 * No count: the linesman drops it whenever, and the puck falling is the cue. The whistle goes
 * the moment it leaves the hand, so nothing here can be timed off a HUD that redraws at 12 Hz.
 */
function Faceoff({ s }: { s: MatchState }) {
  const held = s.countdown > FACEOFF.fall + FACEOFF.late;
  if (!held) return null;
  return (
    <div className="faceoff">
      <span>{periodMark(s.period)} period</span>
      <strong className="faceoff-set">Faceoff</strong>
      <em>Snap the right stick at the drop · back to your D, sideways to a wing</em>
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
    // A warm-up can stop being one: the game stays, the listing goes.
    ...(runtime.queue ? [{ label: 'Stop looking for a game', run: leaveQueue }] : []),
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

/**
 * Over a warm-up: a quiet word that this game is a wait for another one. No menu layer, so the
 * pad stays with the skater.
 */
function QueueStatus() {
  return (
    <div className="queue-status" role="status">
      <Loader2 className="spin" size={13} aria-hidden="true" />
      <span>Looking for an opponent</span>
      <em>Warm-up</em>
    </div>
  );
}

/**
 * Somebody walked into the queued room. The warm-up carries on underneath; the host is asked
 * rather than pulled off the ice. Left unanswered, the room goes private and the question
 * changes to whether to look again. Mounted only while it shows, for the same reason as the
 * online dialog: a hidden layer would own the pad.
 */
function FoundOverlay() {
  const { queue: net, found } = useGame();
  const [index, setIndex] = useState(0);
  if (!net || !found) return null;
  const them = net.opponent;
  const confirmed = net.me?.ready ?? false;
  const left = Math.max(
    0,
    Math.ceil((FOUND_CONFIRM_MS - (performance.now() - found.since)) / 1000),
  );
  const items = found.missed
    ? [
        { label: 'Look again', run: lookAgain },
        { label: 'Keep warming up', run: leaveQueue },
      ]
    : confirmed
      ? [{ label: 'Keep warming up', run: leaveQueue }]
      : [
          { label: 'Play now', run: confirmFound },
          { label: 'Keep warming up', run: leaveQueue },
        ];
  const at = Math.min(index, items.length - 1);
  useNav((a) => {
    if (a === 'up' || a === 'down') setIndex(step(at, a === 'up' ? -1 : 1, items.length));
    if (a === 'confirm') items[at].run();
    if (a === 'back') leaveQueue();
  });
  const title = found.missed ? 'Missed a game' : confirmed ? 'Dropping the puck' : 'Opponent found';
  return (
    <div
      className="screen online-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Opponent found"
    >
      <div className="stage-frame narrow">
        <div className="plate">
          <TitleBar crumb="Quick play" title={title} />
          {found.missed ? (
            <p className="room-notice">
              Nobody answered, so the room was taken off the list. Look again to be listed, or keep
              this game to yourself.
            </p>
          ) : confirmed ? (
            <p className="online-lede" role="status">
              Waiting for {them?.name ?? 'the other player'} to ready up. The game starts the moment
              they do.
            </p>
          ) : (
            <p className="online-lede" role="status">
              {them?.name ?? 'Somebody'} is here to play {modeInfo(net.mode).format}. The warm-up
              ends when you say so — {left}s before they are sent on.
            </p>
          )}
          <nav className="menu-list" aria-label="Quick play options">
            {items.map((item, i) => (
              <MenuItem
                key={item.label}
                focused={i === at}
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
      ? {
          label: runtime.queue ? 'Another warm-up' : 'Rematch',
          // The same people on the same benches: a rematch keeps the couch together.
          run: () =>
            beginGame(
              runtime.myTeam,
              s.mode,
              s.teams,
              s.jerseys,
              runtime.queue ? null : runtime.seatTwo,
            ),
        }
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
