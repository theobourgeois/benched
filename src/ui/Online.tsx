import { Check, Copy, Gamepad2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clubByKey, cycleClub, LEAGUES, jerseysFor, openingMatchup } from '../game/clubs';
import { modeInfo } from '../game/modes';
import { beginOnlineMatch, runtime, useGame } from '../game/store';
import type { GameMode, Team } from '../game/types';
import { useNav } from '../input/menuNavigation';
import { normaliseCode, roomCode, type MatchSetup, type Player } from '../net/protocol';
import { NetSession, ROOM_HOST } from '../net/session';
import { Glyph, Prompts, TeamLogo, TitleBar } from './kit';

/** Modes two people can play against each other. Free skate is practice, so it stays local. */
const ONLINE_MODES: GameMode[] = ['exhibition', 'threeOnThree', 'oneOnOne', 'shootout'];

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

export function OnlineScreen({ onBack, join }: { onBack: () => void; join?: string }) {
  const { net } = useGame();
  const [code, setCode] = useState(join ?? '');
  const [mode, setMode] = useState<GameMode>('exhibition');
  const [club, setClub] = useState(openingMatchup(LEAGUES[0])[0]);
  const [copied, setCopied] = useState(false);
  useRoom(net);

  const connect = (room: string) => {
    runtime.net?.close();
    const session = new NetSession(room, ROOM_HOST, 'Player');
    session.onStart = (setup) => beginOnlineMatch(setup, session.team);
    runtime.net = session;
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
    runtime.net?.close();
    runtime.net = null;
    onBack();
  };

  if (!net) return <Landing code={code} setCode={setCode} onJoin={connect} onBack={onBack} />;
  return (
    <Lobby
      net={net}
      mode={mode}
      setMode={setMode}
      club={club}
      setClub={setClub}
      copied={copied}
      setCopied={setCopied}
      onLeave={leave}
    />
  );
}

/** Before a room: start one, or type the four letters somebody read out to you. */
function Landing({
  code,
  setCode,
  onJoin,
  onBack,
}: {
  code: string;
  setCode: (code: string) => void;
  onJoin: (room: string) => void;
  onBack: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const create = () => onJoin(roomCode());
  const join = () => code.length === 4 && onJoin(code);
  useNav((a) => {
    if (a === 'back') return onBack();
    if (a === 'confirm') return create();
    if (a === 'x') field.current?.focus();
  });
  return (
    <div className="screen online-screen">
      <div className="stage-frame narrow">
        <TitleBar crumb="Main Menu" title="Play Online" />
        <div className="plate online-plate">
          <p className="online-lede">
            One game, two people, wherever they are. Start a game and send the link, or type the
            code somebody sent you.
          </p>
          <button className="cta" onClick={create}>
            Create game
            <i className="caret" aria-hidden="true" />
          </button>
          <div className="online-join">
            <label htmlFor="room-code">Join with a code</label>
            <div>
              <input
                id="room-code"
                ref={field}
                className="code-field"
                value={code}
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={4}
                placeholder="7K2M"
                aria-label="Room code"
                onChange={(e) => setCode(normaliseCode(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && join()}
              />
              <button className="ghost-button" onClick={join} disabled={code.length !== 4}>
                Join
              </button>
            </div>
          </div>
        </div>
      </div>
      <Prompts
        items={[
          { k: 'confirm', label: 'Create', onClick: create },
          { k: 'x', label: 'Enter a code', onClick: () => field.current?.focus() },
          { k: 'back', label: 'Back', onClick: onBack },
        ]}
      />
    </div>
  );
}

/** In a room: who is here, which side they are on, and whether they are ready. */
function Lobby({
  net,
  mode,
  setMode,
  club,
  setClub,
  copied,
  setCopied,
  onLeave,
}: {
  net: NetSession;
  mode: GameMode;
  setMode: (mode: GameMode) => void;
  club: ReturnType<typeof openingMatchup>[0];
  setClub: (club: ReturnType<typeof openingMatchup>[0]) => void;
  copied: boolean;
  setCopied: (copied: boolean) => void;
  onLeave: () => void;
}) {
  const me = net.me;
  const them = net.opponent;
  const waiting = !them;
  const link = `${location.origin}${location.pathname}?join=${net.room}`;

  const pickSide = (team: Team) => net.pickTeam(team);
  const cycle = (step: 1 | -1) => {
    const league = LEAGUES[0];
    const theirs = them?.club ? (clubByKey(them.club) ?? league.clubs[1]) : league.clubs[1];
    const next = cycleClub(league, club, theirs, step);
    setClub(next);
    net.setClub(next.key);
  };
  const toggleReady = () => net.setReady(!me?.ready);
  const cycleMode = () =>
    setMode(ONLINE_MODES[(ONLINE_MODES.indexOf(mode) + 1) % ONLINE_MODES.length]);
  const start = () => {
    if (!net.isHost || !net.everyoneReady || !me) return;
    const mine = club.key;
    const theirs = them?.club || LEAGUES[0].clubs.find((c) => c.key !== mine)!.key;
    const clubs: [string, string] = me.team === 0 ? [mine, theirs] : [theirs, mine];
    const setup: MatchSetup = {
      mode,
      clubs,
      jerseys: jerseysFor(me.team, 'home'),
      hostTeam: me.team,
    };
    net.start(setup);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  useNav((a) => {
    if (a === 'back') return onLeave();
    if (a === 'confirm') return net.isHost && net.everyoneReady ? start() : toggleReady();
    if (a === 'start') return start();
    if (a === 'y') return copy();
    if (a === 'x') return net.isHost ? cycleMode() : undefined;
    if (a === 'up') cycle(-1);
    else if (a === 'down') cycle(1);
    else if (a === 'left') pickSide(1);
    else if (a === 'right') pickSide(0);
  });

  const info = modeInfo(mode);
  return (
    <div className="screen online-screen">
      <div className="stage-frame">
        <TitleBar crumb="Online" title={net.status === 'connecting' ? 'Connecting' : 'Game Lobby'}>
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
          </div>
          <div className="room-seats">
            <Seat player={me} club={club.key} you mode={mode} />
            <span className="versus" aria-hidden="true">
              VS
            </span>
            {them ? (
              <Seat player={them} club={them.club} mode={mode} />
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
            onClick={net.isHost && net.everyoneReady ? start : toggleReady}
            disabled={waiting && !me?.ready}
          >
            {net.isHost && net.everyoneReady ? 'Drop the puck' : me?.ready ? 'Not ready' : 'Ready'}
            <i className="caret" aria-hidden="true" />
          </button>
        </div>
      </div>
      <Prompts
        items={[
          { k: 'confirm', label: net.isHost && net.everyoneReady ? 'Start' : 'Ready' },
          { k: 'updown', label: 'Team' },
          { k: 'leftright', label: 'Side' },
          { k: 'y', label: 'Copy link', onClick: copy },
          { k: 'back', label: 'Leave', onClick: onLeave },
        ]}
      />
    </div>
  );
}

function Seat({
  player,
  club,
  you,
  mode,
}: {
  player: Player | undefined;
  club: string;
  you?: boolean;
  mode: GameMode;
}) {
  if (!player) return null;
  const side = clubByKey(club) ?? openingMatchup(LEAGUES[0])[player.team];
  return (
    <div className="seat" data-ready={player.ready || undefined} data-mine={you || undefined}>
      <TeamLogo club={side} className="seat-logo" />
      <strong>{side.city}</strong>
      <span className="seat-club">{side.name}</span>
      <span className="seat-tag">
        {player.ready ? 'Ready' : you ? 'You' : player.name}
        {player.host && ' · Host'}
      </span>
      <span className="seat-side">
        <Gamepad2 size={13} aria-hidden="true" />
        {modeInfo(mode).format} · {player.team === 0 ? 'Home' : 'Away'}
      </span>
    </div>
  );
}
