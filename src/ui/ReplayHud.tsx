import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useRef, type CSSProperties, type MouseEvent } from 'react';
import {
  REPLAY_CAMERAS,
  REPLAY_SPEEDS,
  seekReplay,
  setReplayCamera,
  stepReplay,
  toggleReplayPlayback,
  type ReplaySession,
} from '../game/replay';
import { closeReplay, publish, useGame } from '../app/store';
import type { MatchState } from '../game/types';
import { useDevice } from '../input/menuNavigation';
import { Glyph, KeyChip } from './kit';

/** Transport buttons never take focus, so Space stays play/pause instead of re-clicking them. */
const keepFocus = (e: MouseEvent) => e.preventDefault();
const speedLabel = (speed: number) => (speed === 0.25 ? '¼×' : speed === 0.5 ? '½×' : `${speed}×`);
/** Controller buttons, keyboard keys, what they do. */
const HINTS: [pad: string, keys: string, label: string][] = [
  ['A', 'Space', 'Play'],
  ['LT RT', 'Q E', 'Scrub'],
  ['RS', '← →', 'Orbit'],
  ['LS', 'W A S D', 'Move'],
  ['LB RB', 'R F', 'Zoom'],
  ['Y', 'C', 'Camera'],
  ['B', 'Esc', 'Exit'],
];

export function ReplayHud() {
  const { replay, match } = useGame();
  if (!replay) return null;
  return replay.kind === 'goal' ? (
    <GoalReplay r={replay} match={match} />
  ) : (
    <InstantReplay r={replay} />
  );
}

function ReplayBug({ r }: { r: ReplaySession }) {
  const slow = r.rate > 0 && r.rate < 0.9;
  return (
    <div className="replay-bug">
      <i aria-hidden="true" />
      REPLAY
      {slow && <small>SLOW MO</small>}
    </div>
  );
}

function GoalReplay({ r, match }: { r: ReplaySession; match: MatchState }) {
  const goal = r.goal!,
    club = match.teams[goal.team],
    scorer = goal.scorer === null ? null : match.skaters[goal.scorer];
  const progress = (r.time - r.start) / Math.max(0.01, r.end - r.start);
  return (
    <div
      className="replay-hud goal-replay"
      onClick={closeReplay}
      role="region"
      aria-label="Goal replay"
      style={{ '--club': club.accent } as CSSProperties}
    >
      <div className="letterbox top" />
      <div className="letterbox bottom" />
      <ReplayBug r={r} />
      <div className="goal-replay-card">
        <span>
          Goal · {club.city} {club.name}
        </span>
        {scorer && (
          <strong>
            #{scorer.number} {scorer.name}
          </strong>
        )}
      </div>
      <button className="replay-skip" onClick={closeReplay}>
        <Glyph k="confirm" /> Skip replay
      </button>
      <div className="replay-progress">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

function InstantReplay({ r }: { r: ReplaySession }) {
  const { settings } = useGame();
  const device = useDevice();
  const drag = useRef<{ id: number; pan: boolean } | null>(null);
  const cam = r.camera,
    behind = r.end - r.time;
  const act = (fn: () => void) => () => {
    fn();
    publish();
  };
  return (
    <div className="replay-hud instant-replay">
      <div
        className="replay-surface"
        aria-hidden="true"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, pan: e.button === 2 || e.shiftKey };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          if (d.pan) {
            cam.drag.panX += e.movementX;
            cam.drag.panY += e.movementY;
          } else {
            cam.drag.x += e.movementX;
            cam.drag.y += e.movementY;
          }
        }}
        onPointerUp={(e) => {
          if (drag.current?.id === e.pointerId) drag.current = null;
        }}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => (cam.drag.wheel += e.deltaY)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <ReplayBug r={r} />
      <section className="plate replay-deck" aria-label="Replay controls">
        <div className="replay-timeline">
          <input
            type="range"
            aria-label="Replay position"
            min={r.start}
            max={r.end}
            step={0.001}
            value={r.time}
            style={
              {
                '--at': `${((r.time - r.start) / Math.max(0.01, r.end - r.start)) * 100}%`,
              } as CSSProperties
            }
            onChange={(e) => {
              r.playing = false;
              seekReplay(r, Number(e.target.value));
              publish();
            }}
          />
          <span className="replay-time">{behind < 0.05 ? 'NOW' : `−${behind.toFixed(1)}s`}</span>
        </div>
        <div className="replay-transport">
          <div className="replay-buttons">
            <button
              aria-label="Restart replay"
              onMouseDown={keepFocus}
              onClick={act(() => {
                seekReplay(r, r.start);
                r.playing = true;
              })}
            >
              <RotateCcw size={17} />
            </button>
            <button
              aria-label="Back one frame"
              onMouseDown={keepFocus}
              onClick={act(() => stepReplay(r, -1))}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="replay-play"
              aria-label={r.playing ? 'Pause replay' : 'Play replay'}
              onMouseDown={keepFocus}
              onClick={act(() => toggleReplayPlayback(r))}
            >
              {r.playing ? (
                <Pause size={19} fill="currentColor" />
              ) : (
                <Play size={19} fill="currentColor" />
              )}
            </button>
            <button
              aria-label="Forward one frame"
              onMouseDown={keepFocus}
              onClick={act(() => stepReplay(r, 1))}
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="replay-segment" role="group" aria-label="Replay speed">
            {REPLAY_SPEEDS.map((speed) => (
              <button
                key={speed}
                aria-pressed={r.speed === speed}
                onMouseDown={keepFocus}
                onClick={act(() => (r.speed = speed))}
              >
                {speedLabel(speed)}
              </button>
            ))}
          </div>
          <div className="replay-segment" role="group" aria-label="Replay camera">
            {REPLAY_CAMERAS.map((c) => (
              <button
                key={c.mode}
                aria-pressed={cam.mode === c.mode}
                onMouseDown={keepFocus}
                onClick={act(() => setReplayCamera(r, c.mode))}
              >
                {c.label}
              </button>
            ))}
          </div>
          <button className="replay-exit" onMouseDown={keepFocus} onClick={closeReplay}>
            <X size={15} /> Exit replay
          </button>
        </div>
        {settings.hints && (
          <div className="replay-hints" aria-hidden="true">
            {HINTS.map(([pad, keys, label]) => (
              <span key={label}>
                {(device === 'pad' ? pad : keys).split(' ').map((token) => (
                  <KeyChip key={token} label={token} device={device} />
                ))}
                {label}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
