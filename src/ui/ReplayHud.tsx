import {
  ChevronLeft,
  ChevronRight,
  History,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  X,
} from 'lucide-react';
import { useRef, type MouseEvent } from 'react';
import {
  REPLAY_CAMERAS,
  REPLAY_SPEEDS,
  seekReplay,
  setReplayCamera,
  stepReplay,
  toggleReplayPlayback,
  type ReplaySession,
} from '../game/replay';
import { closeReplay, publish, useGame } from '../game/store';
import type { MatchState } from '../game/types';

/** Transport buttons never take focus, so Space stays play/pause instead of re-clicking them. */
const keepFocus = (e: MouseEvent) => e.preventDefault();
const speedLabel = (speed: number) => (speed === 0.25 ? '¼×' : speed === 0.5 ? '½×' : `${speed}×`);

export function ReplayHud() {
  const { replay, match, controller } = useGame();
  if (!replay) return null;
  const pad = controller.status.connected;
  return replay.kind === 'goal' ? (
    <GoalReplay r={replay} match={match} pad={pad} />
  ) : (
    <InstantReplay r={replay} pad={pad} />
  );
}

function ReplayBug({ r }: { r: ReplaySession }) {
  const slow = r.rate > 0 && r.rate < 0.9;
  return (
    <div className="replay-bug">
      <History size={17} /> REPLAY
      {slow && <small>SLOW MOTION</small>}
    </div>
  );
}

function GoalReplay({ r, match, pad }: { r: ReplaySession; match: MatchState; pad: boolean }) {
  const goal = r.goal!,
    club = match.teams[goal.team],
    scorer = goal.scorer === null ? null : match.skaters[goal.scorer];
  const progress = (r.time - r.start) / Math.max(0.01, r.end - r.start);
  return (
    <div
      className={`replay-hud goal-replay goal-team-${goal.team}`}
      onClick={closeReplay}
      role="region"
      aria-label="Goal replay"
    >
      <div className="letterbox top" />
      <div className="letterbox bottom" />
      <ReplayBug r={r} />
      <div className="goal-replay-card">
        <span className="eyebrow">
          GOAL · {club.city} {club.name}
        </span>
        {scorer && (
          <strong>
            <i style={{ background: club.accent }} />#{scorer.number} {scorer.name.toUpperCase()}
          </strong>
        )}
      </div>
      <button className="replay-skip" onClick={closeReplay}>
        <kbd>{pad ? 'A' : 'SPACE'}</kbd> Skip replay <SkipForward size={15} />
      </button>
      <div className="replay-progress">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

function InstantReplay({ r, pad }: { r: ReplaySession; pad: boolean }) {
  const drag = useRef<{ id: number; pan: boolean } | null>(null);
  const cam = r.camera,
    behind = r.end - r.time;
  const act = (fn: () => void) => () => {
    fn();
    publish();
  };
  const hints = pad
    ? [
        ['A', 'Play / pause'],
        ['LT · RT', 'Rewind · fast-forward'],
        ['RS', 'Orbit'],
        ['LS', 'Move camera'],
        ['LB · RB', 'Zoom'],
        ['D-PAD', 'Frame · speed'],
        ['Y', 'Camera'],
        ['B', 'Exit'],
      ]
    : [
        ['SPACE', 'Play / pause'],
        ['Q · E', 'Rewind · fast-forward'],
        ['DRAG · ARROWS', 'Orbit'],
        ['WASD · RIGHT-DRAG', 'Move camera'],
        ['WHEEL · R F', 'Zoom'],
        [', .', 'Frame'],
        ['C', 'Camera'],
        ['ESC', 'Exit'],
      ];
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
      <section className="replay-deck" aria-label="Replay controls">
        <div className="replay-timeline">
          <input
            type="range"
            aria-label="Replay position"
            min={r.start}
            max={r.end}
            step={0.001}
            value={r.time}
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
        <div className="replay-hints">
          {hints.map(([keys, label]) => (
            <span key={label}>
              <kbd>{keys}</kbd> {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
