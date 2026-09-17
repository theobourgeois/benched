import { Check, ChevronLeft, ChevronRight, Copy, Gamepad2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  clubByKey,
  cycleClub,
  LEAGUES,
  jerseysFor,
  openingMatchup,
  type Club,
} from '../game/clubs';
import { modeInfo } from '../game/modes';
import { connectToRoom, disconnect, quickPlay } from '../app/online';
import { useGame } from '../app/store';
import type { GameMode, Team } from '../game/types';
import { useNav, step } from '../input/menuNavigation';
import { DirectorySession } from '../net/directory';
import {
  JOIN_WAIT_MS,
  normaliseCode,
  ONLINE_MODES,
  roomCode,
  type MatchSetup,
  type Player,
  type QuickMode,
} from '../net/protocol';
import { NetSession, ROOM_HOST } from '../net/session';
import { Glyph, MenuItem, Prompts, TeamLogo, TitleBar } from './kit';

/** Re-render whenever the room says anything. */
function useRoom(session: NetSession | null) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!session) return;
    session.onChange = () => bump((n) => n + 1);
    return () => {
      session.onChange = null;
    };
  }, [session]);
}

/**
 * The directory, for as long as the online screen is up: the live count, the open list, and
 * where quick play sends you. Closed on the way out; a room is a different line.
 */
function useDirectory() {
  // Made in the effect, not the state: React mounts an effect twice in development, and a line
  // closed by the first cleanup would never be opened again.
  const [directory, setDirectory] = useState<DirectorySession | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const session = new DirectorySession(ROOM_HOST);
    session.onChange = () => bump((n) => n + 1);
    setDirectory(session);
    return () => session.close();
  }, []);
  return directory;
}

const QUICK_MODE_KEY = 'benched.quickMode';
const QUICK_MODES: QuickMode[] = ['any', ...ONLINE_MODES];
function loadQuickMode(): QuickMode {
  try {
    const saved = localStorage.getItem(QUICK_MODE_KEY);
    return QUICK_MODES.includes(saved as QuickMode) ? (saved as QuickMode) : 'any';
  } catch {
    return 'any';
  }
}
const quickModeLabel = (mode: QuickMode) =>
  mode === 'any' ? 'Any mode' : mode === 'shootout' ? 'Shootout' : modeInfo(mode).format;

/** The landing's fixed rows; open games follow them. */
const ROW_QUICK = 0;
const ROW_PRIVATE = 1;
const ROW_CODE = 2;
const FIXED_ROWS = 3;

export function OnlineScreen({ onBack, join }: { onBack: () => void; join?: string }) {
  const { net, quickJoin } = useGame();
  const [code, setCode] = useState(join ?? '');
  const [copied, setCopied] = useState(false);
  const directory = useDirectory();
  useRoom(net);

  const connect = (room: string) => {
    connectToRoom(room);
    setCode(room);
  };
  // An invite link connects straight through rather than making you retype the code.
  const started = useRef(false);
  useEffect(() => {
    if (join && !started.current) {
      started.current = true;
      connect(normaliseCode(join));
    }
  }, [join]);

  const leave = () => {
    disconnect();
    onBack();
  };

  if (!net)
    return (
      <Landing
        code={code}
        setCode={setCode}
        directory={directory}
        onJoin={connect}
        onBack={onBack}
      />
    );
  if (quickJoin) return <Found net={net} onLeave={disconnect} />;
  return <Lobby net={net} copied={copied} setCopied={setCopied} onLeave={leave} />;
}

/**
 * Before a room: a list, like the main menu. Quick play first (the oldest open game, or a warm-up
 * while you wait to be one), with its format as a value you step on the row. Then a private game
 * or a typed code for playing with somebody in particular, and the open games by name under
 * them for anyone who would rather pick.
 */
function Landing({
  code,
  setCode,
  directory,
  onJoin,
  onBack,
}: {
  code: string;
  setCode: (code: string) => void;
  directory: DirectorySession | null;
  onJoin: (room: string) => void;
  onBack: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<QuickMode>(loadQuickMode);
  /** Asked the directory and waiting on the answer. One press, one question. */
  const [finding, setFinding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rooms = directory?.rooms ?? [];
  const count = FIXED_ROWS + rooms.length;
  const at = Math.min(index, count - 1);

  const go = async (room?: string) => {
    if (finding || !directory) return;
    setFinding(true);
    setNotice(null);
    const went = await quickPlay(directory, mode, room);
    setFinding(false);
    if (!went) setNotice('That game filled up. Pick another, or quick play.');
  };
  const createPrivate = () => onJoin(roomCode());
  const join = () => code.length === 4 && onJoin(code);
  const typeCode = () => {
    setIndex(ROW_CODE);
    field.current?.focus();
  };
  const stepMode = (dir: 1 | -1) => {
    const next =
      QUICK_MODES[(QUICK_MODES.indexOf(mode) + dir + QUICK_MODES.length) % QUICK_MODES.length];
    setMode(next);
    try {
      localStorage.setItem(QUICK_MODE_KEY, next);
    } catch {
      // Nothing to remember it with; the pick still holds for the screen.
    }
  };
  const select = (row = at) => {
    if (row === ROW_QUICK) return void go();
    if (row === ROW_PRIVATE) return createPrivate();
    if (row === ROW_CODE) return code.length === 4 ? join() : typeCode();
    void go(rooms[row - FIXED_ROWS].code);
  };
  useNav((a) => {
    if (a === 'back') return onBack();
    if (a === 'confirm') return select();
    if ((a === 'left' || a === 'right') && at === ROW_QUICK) return stepMode(a === 'left' ? -1 : 1);
    if (a === 'up' || a === 'down') setIndex(step(at, a === 'up' ? -1 : 1, count));
  });
  // Typing in the field is outside the menu layer; the arrows and Escape hand the pad back.
  const fieldKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') return join();
    if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      field.current?.blur();
      if (e.key !== 'Escape') setIndex(step(ROW_CODE, e.key === 'ArrowUp' ? -1 : 1, count));
    }
  };

  const live = directory?.connected ?? false;
  const status = !live
    ? 'Connecting…'
    : rooms.length
      ? `${directory!.browsing} online · ${rooms.length} waiting · ${directory!.playing} playing`
      : `${directory!.browsing} online · ${directory!.playing} playing · nobody waiting, you warm up against the AI`;
  return (
    <div className="screen online-screen">
      <div className="stage-frame narrow">
        <TitleBar crumb="Main Menu" title="Online" />
        <div className="plate online-plate">
          <nav className="menu-list online-list" aria-label="Online">
            <div className="menu-row">
              <MenuItem
                focused={at === ROW_QUICK}
                onFocus={() => setIndex(ROW_QUICK)}
                onSelect={() => select(ROW_QUICK)}
              >
                {finding ? 'Finding a game…' : 'Quick play'}
                {finding && <Loader2 className="spin" size={20} aria-hidden="true" />}
              </MenuItem>
              <span className="row-value" data-focused={at === ROW_QUICK || undefined}>
                <button tabIndex={-1} aria-label="Previous mode" onClick={() => stepMode(-1)}>
                  <ChevronLeft size={20} />
                </button>
                <strong aria-label={`Mode: ${quickModeLabel(mode)}`}>{quickModeLabel(mode)}</strong>
                <button tabIndex={-1} aria-label="Next mode" onClick={() => stepMode(1)}>
                  <ChevronRight size={20} />
                </button>
              </span>
            </div>
            <MenuItem
              focused={at === ROW_PRIVATE}
              onFocus={() => setIndex(ROW_PRIVATE)}
              onSelect={() => select(ROW_PRIVATE)}
            >
              Create private game
            </MenuItem>
            <div className="menu-row">
              <MenuItem
                focused={at === ROW_CODE}
                onFocus={() => setIndex(ROW_CODE)}
                onSelect={() => select(ROW_CODE)}
              >
                Join with a code
              </MenuItem>
              <span className="row-value" data-focused={at === ROW_CODE || undefined}>
                <input
                  ref={field}
                  className="code-field"
                  value={code}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4}
                  placeholder="CODE"
                  aria-label="Room code"
                  onFocus={() => setIndex(ROW_CODE)}
                  onChange={(e) => setCode(normaliseCode(e.target.value))}
                  onKeyDown={fieldKeys}
                />
              </span>
            </div>
            {rooms.length > 0 && <h2 className="online-heading">Open games</h2>}
            {rooms.map((room, i) => (
              <MenuItem
                key={room.code}
                focused={at === FIXED_ROWS + i}
                onFocus={() => setIndex(FIXED_ROWS + i)}
                onSelect={() => select(FIXED_ROWS + i)}
                className="online-room-item"
              >
                <span>{room.host}</span>
                <small>
                  {modeInfo(room.mode).format} · waiting <Waited since={room.since} />
                </small>
              </MenuItem>
            ))}
          </nav>
          <p className="online-count" role="status">
            {status}
          </p>
          {notice && <p className="room-notice">{notice}</p>}
        </div>
      </div>
      <Prompts
        items={[
          { k: 'confirm', label: 'Select', onClick: () => select() },
          ...(at === ROW_QUICK
            ? [{ k: 'leftright' as const, label: 'Mode', onClick: () => stepMode(1) }]
            : []),
          { k: 'back', label: 'Back', onClick: onBack },
        ]}
      />
    </div>
  );
}

/** How long a host has been waiting, kept ticking without the directory saying anything. */
function Waited({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
  return <>{seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`}</>;
}

/**
 * Quick play sent us into somebody's warm-up. We are already ready; what is left is for them
 * to say yes. If they take too long the session looks elsewhere on its own, so this only
 * counts down and offers the way out.
 */
function Found({ net, onLeave }: { net: NetSession; onLeave: () => void }) {
  const me = net.me;
  const them = net.opponent;
  const [since] = useState(() => performance.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((JOIN_WAIT_MS - (performance.now() - since)) / 1000));
  useNav((a) => {
    if (a === 'back') onLeave();
  });
  const info = modeInfo(net.mode);
  return (
    <div className="screen online-screen">
      <div className="stage-frame">
        <TitleBar
          crumb="Quick play"
          title={net.status === 'connecting' ? 'Connecting' : 'Game found'}
        >
          <span className="cpu-chip" aria-label={`Mode: ${info.format}`}>
            <span>Mode</span>
            <strong>{info.format}</strong>
          </span>
        </TitleBar>
        <div className="plate online-room">
          <div className="room-seats">
            <Seat player={me} club={clubOf(me)} you mode={net.mode} />
            <span className="versus" aria-hidden="true">
              VS
            </span>
            {them ? (
              <Seat player={them} club={clubOf(them)} mode={net.mode} />
            ) : (
              <div className="seat empty" role="status">
                <Loader2 className="spin" size={22} aria-hidden="true" />
                <strong>Finding them</strong>
              </div>
            )}
          </div>
          <p className="online-lede" role="status">
            {them?.name ?? 'The host'} is finishing a warm-up. You are ready; the puck drops when
            they say so — {left}s before we look elsewhere.
          </p>
          {net.notice && <p className="room-notice">{net.notice}</p>}
        </div>
      </div>
      <Prompts items={[{ k: 'back', label: 'Leave', onClick: onLeave }]} />
    </div>
  );
}

/**
 * The club a seat skates for. The room holds everyone's pick, so both screens read the same
 * thing; until somebody has picked, a seat shows the featured club for its side.
 */
const clubOf = (player: Player | undefined): Club =>
  (player?.club ? clubByKey(player.club) : undefined) ??
  openingMatchup(LEAGUES[0])[player?.team ?? 0];

/** In a room: who is here, which side they are on, and whether they are ready. */
function Lobby({
  net,
  copied,
  setCopied,
  onLeave,
}: {
  net: NetSession;
  copied: boolean;
  setCopied: (copied: boolean) => void;
  onLeave: () => void;
}) {
  const me = net.me;
  const them = net.opponent;
  const waiting = !them;
  // The room holds the mode, so both lobbies say the same thing before the puck drops.
  const mode = net.mode;
  const club = clubOf(me);
  const theirs = clubOf(them);
  const canStart = net.isHost && net.everyoneReady;
  const link = `${location.origin}${location.pathname}?join=${net.room}`;

  // A seat arrives with no club. Pick the featured one for its side, or the other featured one
  // if the person across the table already has it, and tell the room, so what the other person
  // sees on their screen is the same as what is on this one.
  const defaulted = useRef('');
  useEffect(() => {
    if (!me || me.club || defaulted.current === me.id) return;
    defaulted.current = me.id;
    const featured = openingMatchup(LEAGUES[0]);
    const pick = featured[me.team].key === them?.club ? featured[1 - me.team] : featured[me.team];
    net.setClub(pick.key);
  }, [me, them?.club, net]);

  const pickSide = (team: Team) => net.pickTeam(team);
  const cycle = (step: 1 | -1) => net.setClub(cycleClub(LEAGUES[0], club, theirs, step).key);
  const ready = () => net.setReady(true);
  const unready = () => net.setReady(false);
  const cycleMode = () =>
    net.setMode(ONLINE_MODES[(ONLINE_MODES.indexOf(mode) + 1) % ONLINE_MODES.length]);
  // Listed for anyone to walk into, or kept for whoever has the code. A setting, not a step.
  const togglePublic = () => net.isHost && net.setPublic(!net.isPublic);
  const start = () => {
    if (!canStart || !me) return;
    const clubs: [string, string] = me.team === 0 ? [club.key, theirs.key] : [theirs.key, club.key];
    const setup: MatchSetup = {
      mode,
      clubs,
      jerseys: jerseysFor(me.team, 'home'),
      hostTeam: me.team,
    };
    net.start(setup);
  };
  // Confirm takes you forward: ready, then the puck. Back takes you out: not ready, then gone.
  // Being ready and waiting on the other person, confirm does nothing rather than undoing it.
  const forward = () => (canStart ? start() : me?.ready ? undefined : ready());
  const back = () => (me?.ready ? unready() : onLeave());
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  useNav((a) => {
    if (a === 'back') return back();
    if (a === 'confirm') return forward();
    if (a === 'start') return start();
    if (a === 'y') return copy();
    if (a === 'x') return net.isHost ? cycleMode() : undefined;
    if (a === 'lb') return togglePublic();
    if (a === 'up') cycle(-1);
    else if (a === 'down') cycle(1);
    else if (a === 'left') pickSide(1);
    else if (a === 'right') pickSide(0);
  });

  const info = modeInfo(mode);
  return (
    <div className="screen online-screen">
      <div className="stage-frame">
        <TitleBar
          crumb="Online"
          title={
            net.status !== 'connecting' ? 'Game Lobby' : net.you ? 'Reconnecting' : 'Connecting'
          }
        >
          <button
            className="cpu-chip"
            onClick={() => net.isHost && cycleMode()}
            aria-label={`Mode: ${info.format}`}
          >
            {net.isHost && <Glyph k="x" />}
            <span>Mode</span>
            <strong>{info.format}</strong>
          </button>
        </TitleBar>
        <div className="plate online-room">
          <div className="room-code" aria-label={`Room code ${net.room}`}>
            <span>Room code</span>
            <strong>{net.room}</strong>
            <button className="ghost-button" onClick={copy}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <button
              className="ghost-button"
              onClick={togglePublic}
              disabled={!net.isHost}
              aria-pressed={net.isPublic}
              data-on={net.isPublic || undefined}
            >
              {net.isHost && <Glyph k="lb" />}
              {net.isPublic ? 'Open to anyone' : 'Invite only'}
            </button>
          </div>
          <div className="room-seats">
            <Seat player={me} club={club} you mode={mode} />
            <span className="versus" aria-hidden="true">
              VS
            </span>
            {them ? (
              <Seat player={them} club={theirs} mode={mode} />
            ) : (
              <div className="seat empty" role="status">
                <Loader2 className="spin" size={22} aria-hidden="true" />
                <strong>Waiting for a player</strong>
                <span>Send them the code or the link</span>
              </div>
            )}
          </div>
          {net.notice && <p className="room-notice">{net.notice}</p>}
        </div>
        <div className="matchup-foot">
          {!net.isHost && net.everyoneReady && (
            <span className="pad-hint">Waiting for the host to drop the puck.</span>
          )}
          <button
            className="cta"
            onClick={canStart ? start : me?.ready ? unready : ready}
            disabled={waiting && !me?.ready}
          >
            {canStart ? 'Drop the puck' : me?.ready ? 'Not ready' : 'Ready'}
            <i className="caret" aria-hidden="true" />
          </button>
        </div>
      </div>
      <Prompts
        items={[
          { k: 'confirm', label: canStart ? 'Start' : 'Ready', onClick: forward },
          { k: 'updown', label: 'Team' },
          { k: 'leftright', label: 'Side' },
          { k: 'y', label: 'Copy link', onClick: copy },
          ...(net.isHost
            ? [
                {
                  k: 'lb' as const,
                  label: net.isPublic ? 'Make private' : 'Make public',
                  onClick: togglePublic,
                },
              ]
            : []),
          { k: 'back', label: me?.ready ? 'Not ready' : 'Leave', onClick: back },
        ]}
      />
    </div>
  );
}

function Seat({
  player,
  club: side,
  you,
  mode,
}: {
  player: Player | undefined;
  club: Club;
  you?: boolean;
  mode: GameMode;
}) {
  if (!player) return null;
  return (
    <div
      className="seat"
      data-ready={player.ready || undefined}
      data-mine={you || undefined}
      data-away={player.away || undefined}
    >
      <TeamLogo club={side} className="seat-logo" />
      <strong>{side.city}</strong>
      <span className="seat-club">{side.name}</span>
      <span className="seat-tag">
        {player.away ? 'Reconnecting…' : player.ready ? 'Ready' : you ? 'You' : player.name}
        {player.host && ' · Host'}
      </span>
      <span className="seat-side">
        <Gamepad2 size={13} aria-hidden="true" />
        {modeInfo(mode).format} · {player.team === 0 ? 'Home' : 'Away'}
      </span>
    </div>
  );
}
