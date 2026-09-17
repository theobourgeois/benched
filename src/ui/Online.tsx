import { Check, Copy, Gamepad2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  clubByKey,
  cycleClub,
  LEAGUES,
  jerseysFor,
  openingMatchup,
  type Club,
} from '../game/clubs';
import { modeInfo } from '../game/modes';
import { connectToRoom, disconnect } from '../app/online';
import { useGame } from '../app/store';
import type { GameMode, Team } from '../game/types';
import { useNav } from '../input/menuNavigation';
import {
  normaliseCode,
  ONLINE_MODES,
  roomCode,
  type MatchSetup,
  type Player,
} from '../net/protocol';
import type { NetSession } from '../net/session';
import { Glyph, Prompts, TeamLogo, TitleBar } from './kit';

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
  const [copied, setCopied] = useState(false);
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

  if (!net) return <Landing code={code} setCode={setCode} onJoin={connect} onBack={onBack} />;
  return <Lobby net={net} copied={copied} setCopied={setCopied} onLeave={leave} />;
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
