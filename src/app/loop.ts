import { GOAL_BEAT } from '../audio/goalTrack';
import { hasActiveCelly } from '../game/cellys';
import { EMPTY_INPUT, RULES } from '../game/config';
import { stepMatch, togglePause } from '../game/engine';
import { GOAL_REPLAY, REPLAY_HZ, type ReplayFrame } from '../game/replay';
import type { InputFrame, MatchState, Phase, SideInputs, Team } from '../game/types';
import type { Controller } from '../input/controller';
import { screenInputToRink } from '../input/coordinates';
import { mergeEdges, noEdges } from '../input/frames';
import { navigateWithController } from '../input/menuNavigation';
import { labHooks } from '../scene/animationReview';
import { askToLeave } from './online';
import {
  driveReplay,
  followLiveGoalReplay,
  goalReplayWanted,
  publish,
  runtime,
  startGoalReplay,
  viewMatch,
  viewTimeScale,
} from './store';

/**
 * The game loop: once a frame, read the sticks, advance the match, and play what happened.
 *
 * This is where the pieces meet — controllers, the simulation, the online session, replays,
 * audio and rumble — and it is deliberately not a React component, so the order things happen
 * in each frame can be read top to bottom in `advance`. The scene calls `frame` from its render
 * loop and `attach` once when it mounts; nothing else drives the match.
 *
 * The simulation runs at a fixed 120 Hz inside a variable-rate render loop, so each frame is
 * split into fixed steps by an accumulator. Online, the host is the only one stepping: the
 * guest sends its input and poses the match on what the host has sent back.
 */

/** Simulation steps per replay snapshot. */
const RECORD_EVERY = Math.max(1, Math.round(1 / RULES.fixedStep / REPLAY_HZ));
const RECORDED: Phase[] = ['faceoff', 'playing', 'goal'];
/** The world holds for two sixteenths as the puck crosses, so the drop lands on a still frame. */
const GOAL_FREEZE = GOAL_BEAT / 2;
/** A frame longer than this is clamped, so a stall never turns into a burst of catch-up steps. */
const MAX_FRAME = 0.05;
/** Calls that reach the pad and the camera as well as the speakers. */
const FELT_EVENTS = new Set(['shot', 'hit', 'goal', 'post', 'crossbar', 'save']);
/** Phases a person can pause from. */
const PAUSABLE: Phase[] = ['playing', 'faceoff', 'goal'];

/** Impact feedback shared between the loop and the camera: a big hit shakes the frame. */
export const impact = { shake: 0 };

export class GameLoop {
  private accumulator = 0;
  private lastEvent = -1;
  private publishTime = 0;
  private lastMatch: MatchState = runtime.match;
  private pending: SideInputs = [null, null];
  private steps = 0;
  private goalReplay = false;
  private replayedGoal: string | null = null;
  private freeze = 0;
  private pulses: number[] = [];
  /** Host: the match was held for a dropped line on the last frame. */
  private held = false;
  /**
   * Called with every replay frame as it is recorded, so the scene can attach what only it
   * knows about that moment (a ragdoll's pose) for the replay to show.
   */
  onRecord: ((frame: ReplayFrame) => void) | null = null;

  /**
   * Take the controllers and the page events the loop needs. Returns the function that gives
   * them back; the scene calls it when it unmounts.
   */
  attach(): () => void {
    const detach = runtime.controller.attach(),
      detachTwo = runtime.controllerTwo.attach();
    const pause = () => this.pauseFromOutside();
    runtime.controller.onDisconnect = pause;
    // A second player's pad dying mid-shift stops the game too, but only while they are on it.
    runtime.controllerTwo.onDisconnect = () => {
      if (runtime.match.sides[1 - runtime.myTeam].human) pause();
    };
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    const stopHeartbeat = this.startHeartbeat();
    return () => {
      detach();
      detachTwo();
      runtime.controller.onDisconnect = undefined;
      runtime.controllerTwo.onDisconnect = undefined;
      document.removeEventListener('visibilitychange', visibility);
      stopHeartbeat();
      this.pulses.forEach(clearTimeout);
    };
  }

  /** The render loop's entry: one frame, `delta` seconds after the last. */
  frame(delta: number) {
    // A hidden tab throttles the render loop to about once a second; the heartbeat takes over.
    if (!document.hidden) this.advance(delta);
  }

  /**
   * Online, the host runs the match for both people, so it has to keep stepping even while
   * nobody is looking at this tab. A worker's clock is not throttled the way the render loop is.
   */
  private startHeartbeat() {
    const beat = new Worker(new URL('../net/heartbeat.worker.ts', import.meta.url), {
      type: 'module',
    });
    let last = performance.now();
    beat.onmessage = () => {
      const now = performance.now();
      const delta = (now - last) / 1000;
      last = now;
      if (document.hidden && runtime.net) this.advance(Math.min(delta, MAX_FRAME));
    };
    // It only runs while it is needed: hidden, and with somebody on the other end.
    const sync = () => {
      const wanted = document.hidden && !!runtime.net;
      last = performance.now();
      beat.postMessage(wanted ? 'start' : 'stop');
    };
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      document.removeEventListener('visibilitychange', sync);
      beat.postMessage('stop');
      beat.terminate();
    };
  }

  /** A pad dropped or the tab was hidden: stop the game if this is a game that can stop. */
  private pauseFromOutside() {
    if (runtime.replay) {
      if (runtime.replay.kind === 'instant') runtime.replay.playing = false;
      return;
    }
    // Online there is nothing to pause. The host pausing would stop the match for the guest
    // too, and a dropped pad or a hidden tab is no reason to freeze somebody else's game.
    if (runtime.net) return;
    if (PAUSABLE.includes(runtime.match.phase)) {
      togglePause(runtime.match);
      runtime.audio.updateSkating(runtime.match, 1, runtime.myTeam);
      publish();
    }
  }

  /** The pad thumps with every 808 for the first bars of the celebration. */
  private rumbleToTheBeat() {
    this.pulses.forEach(clearTimeout);
    this.pulses = runtime.audio
      .celebrationPulses()
      .map((ms) => window.setTimeout(() => runtime.controller.rumble(0.85, 90), ms));
  }

  /**
   * Whistles, hits and horns: sound, rumble and camera shake. The watching side runs this on the
   * calls the host sent rather than on any of its own, which is why they cross with the snapshot.
   */
  private drainEvents(s: MatchState) {
    for (const event of s.events) {
      if (event.id <= this.lastEvent) continue;
      runtime.audio.play(event, s.mode);
      if (event.type === 'goal') {
        this.goalReplay = goalReplayWanted(s);
        if (s.mode !== 'freeSkate') {
          this.freeze = GOAL_FREEZE;
          impact.shake = Math.max(impact.shake, 0.6);
          this.rumbleToTheBeat();
        }
      }
      if (FELT_EVENTS.has(event.type)) {
        const bigHit = event.type === 'hit' && event.power >= 0.5;
        if (bigHit) impact.shake = Math.max(impact.shake, event.power >= 0.75 ? 1 : 0.45);
        if (event.barDown && event.type === 'crossbar') impact.shake = Math.max(impact.shake, 0.3);
        const iron = event.type === 'crossbar';
        const strength =
          event.type === 'goal'
            ? 1
            : bigHit
              ? Math.max(0.7, event.power)
              : iron
                ? Math.max(0.55, event.power)
                : event.power * 0.7;
        const ms =
          event.type === 'goal'
            ? 380
            : bigHit
              ? 280
              : event.type === 'hit'
                ? 160
                : iron
                  ? 130
                  : 100;
        runtime.controller.rumble(strength, ms);
      }
      this.lastEvent = event.id;
    }
  }

  /** The HUD is React, and it redraws at about twelve times a second rather than every frame. */
  private tickPublish(delta: number) {
    this.publishTime += delta;
    if (this.publishTime > 0.08) {
      publish();
      this.publishTime = 0;
    }
  }

  /** A new match is a new timeline: nothing carried from the old one applies. */
  private resetFor(s: MatchState) {
    this.lastMatch = s;
    this.lastEvent = -1;
    this.accumulator = 0;
    this.pending = [null, null];
    this.goalReplay = false;
    this.replayedGoal = null;
    this.freeze = 0;
    this.pulses.forEach(clearTimeout);
  }

  /** Let the goal land live for a moment, then roll the replay. True when one just opened. */
  private rollGoalReplay(match: MatchState) {
    if (match.phase !== 'goal' && match.phase !== 'paused') {
      this.goalReplay = false;
      return false;
    }
    const scoreKey = `${match.score[0]}-${match.score[1]}`;
    // The watching side can miss the call itself and still see the celebration, so arm off
    // the score rather than the event. The key stops a skip from rolling the same goal again.
    if (match.phase === 'goal' && goalReplayWanted(match) && this.replayedGoal !== scoreKey)
      this.goalReplay = true;
    if (
      this.goalReplay &&
      match.phase === 'goal' &&
      match.countdown <= RULES.goalSeconds - GOAL_REPLAY.celebrate &&
      match.countdown > 0 &&
      !hasActiveCelly(match) &&
      startGoalReplay()
    ) {
      this.replayedGoal = scoreKey;
      this.goalReplay = false;
      return true;
    }
    return false;
  }

  private record(s: MatchState) {
    const frame = runtime.recorder.record(s);
    this.onRecord?.(frame);
  }

  /** One pass of the game loop: read the sticks, advance the match, play what happened. */
  advance(delta: number) {
    const s = runtime.match;
    if (s !== this.lastMatch) this.resetFor(s);
    const dt = Math.min(delta, MAX_FRAME);
    runtime.audio.updateCelebration(
      s.phase === 'goal' || (s.phase === 'paused' && s.previousPhase === 'goal'),
      s.phase === 'paused',
    );
    // Replay controls read every frame, before read() clears this frame's key taps, so a button
    // already held when a replay opens doesn't count as a press.
    const replayInput = runtime.controller.replayInput();
    const replay = runtime.replay;
    if (replay) {
      // Play input keeps reading too, so buttons held on the way out aren't fresh presses.
      runtime.controller.claimed = [];
      runtime.controller.read(dt, false);
      runtime.controllerTwo.claimed =
        runtime.controller.padIndex === undefined ? [] : [runtime.controller.padIndex];
      runtime.controllerTwo.read(dt, false);
      this.pending = [null, null];
      this.accumulator = 0;
      driveReplay(replay, replayInput, dt);
      const net = runtime.net;
      if (net?.isHost) {
        // The sim is held, but the guest still needs the freeze-point — and a skip that
        // zeros the countdown — or it never catches up enough to open or close its overlay.
        net.publish(s, dt);
      } else if (net) {
        net.view(s, dt);
        if (followLiveGoalReplay(s)) this.drainEvents(s);
      }
      runtime.audio.updateSkating(viewMatch(), Math.min(1, viewTimeScale()), runtime.myTeam);
      this.tickPublish(delta);
      return;
    }
    // Every seat reads its own pad but maps through the same anchor: one screen, one orientation,
    // so up is up for whoever is holding a stick.
    const readSeat = (seat: Controller, team: Team) =>
      screenInputToRink(
        seat.read(dt, s.puck.owner === s.sides[team].controlled),
        s,
        runtime.settings.camera,
        runtime.myTeam,
      );
    const net = runtime.net;
    const guest = (1 - runtime.myTeam) as Team;
    // Seat one picks first and seat two takes what is left, so one pad always belongs to P1.
    runtime.controller.claimed = [];
    const mine = readSeat(runtime.controller, runtime.myTeam);
    runtime.controllerTwo.claimed =
      runtime.controller.padIndex === undefined ? [] : [runtime.controller.padIndex];
    // Seat two is polled even with nobody on it, so the matchup screen can tell you whether a
    // second controller has turned up yet. Its frame only counts once somebody is playing it.
    const guestFrame = readSeat(runtime.controllerTwo, guest);
    // The first press on a pad is the gesture that lets sound start.
    if (runtime.controller.padActive) runtime.audio.unlock();
    // Menus consume the pad only after it has been read, or a press lands on the stale frame.
    const menuOwnsInput = navigateWithController(runtime.controller);
    // Only the dev animation lab sets this, so production never walks the document for it.
    const blocked = import.meta.env.DEV && !!document.querySelector('[data-block-game-input]');
    const gate = (frame: InputFrame) => {
      if (menuOwnsInput) {
        frame.pause = false;
        frame.switchPlayer = false;
      }
      if (blocked) frame.pause = false;
      return frame;
    };
    this.pending[runtime.myTeam] = mergeEdges(this.pending[runtime.myTeam], gate(mine));
    // Online, the other bench is a person somewhere else; the second seat belongs to the couch.
    this.pending[guest] = net
      ? null
      : s.sides[guest].human
        ? mergeEdges(this.pending[guest], gate(guestFrame))
        : null;
    if (net && !net.isHost) {
      // The pause button asks about leaving here too. It is this person's question, so it never
      // crosses to the host as input.
      const own = this.pending[runtime.myTeam];
      if (own?.pause) {
        own.pause = false;
        askToLeave(!runtime.leaving);
      }
      // A guest runs no simulation. It says what it is trying to do and draws what it is told,
      // so there is no second version of the match to disagree with the host's.
      // Presses are kept until a frame actually goes out, so none is lost between sends.
      if (net.sendInput(this.pending[runtime.myTeam] ?? EMPTY_INPUT))
        this.pending[runtime.myTeam] = noEdges(this.pending[runtime.myTeam] ?? EMPTY_INPUT);
      if (net.view(s, dt) && RECORDED.includes(s.phase)) this.record(s);
      this.drainEvents(s);
      this.rollGoalReplay(s);
      runtime.audio.updateSkating(s, 1, runtime.myTeam);
      this.tickPublish(delta);
      return;
    }
    // Pausing is a request from a person, not something the physics can decide: with two sticks
    // on the ice the engine cannot know whose pause it is, so it is resolved out here. Either
    // seat can call it. Online nobody gets to freeze somebody else's game, so the pause button
    // asks about leaving instead.
    if (this.pending.some((frame) => frame?.pause)) {
      this.pending = this.pending.map((frame) => frame && noEdges(frame)) as SideInputs;
      if (net) askToLeave(!runtime.leaving);
      else {
        togglePause(s);
        runtime.audio.updateSkating(s, 1, runtime.myTeam);
        publish();
        this.accumulator = 0;
        return;
      }
    }
    if (net && s.phase !== 'menu' && (net.status === 'lobby' || net.interrupted)) {
      // Somebody's line is down, or the room called the match off. Nothing is played against an
      // empty bench: the clock and every skater hold where they are. Snapshots keep going out,
      // so a guest coming back sees exactly where it stopped.
      this.accumulator = 0;
      this.held = true;
      net.publish(s, dt);
      this.tickPublish(delta);
      return;
    }
    if (this.held) {
      this.held = false;
      net?.clearGuestInput();
    }
    if (this.freeze > 0) {
      this.freeze -= delta;
      this.accumulator = 0;
    } else
      this.accumulator += dt * (import.meta.env.DEV && labHooks.active ? labHooks.simScale : 1);
    while (this.accumulator >= RULES.fixedStep) {
      // As host, the other bench is whatever the last packet said. A missing one repeats rather
      // than handing the skater back to the AI.
      if (net) this.pending[guest] = net.takeGuestInput();
      stepMatch(s, this.pending, RULES.fixedStep);
      this.pending = this.pending.map((frame) => frame && noEdges(frame)) as SideInputs;
      this.accumulator -= RULES.fixedStep;
      if (RECORDED.includes(s.phase) && ++this.steps % RECORD_EVERY === 0) this.record(s);
    }
    net?.publish(s, dt);
    this.drainEvents(s);
    if (this.rollGoalReplay(s)) net?.publish(s, 1);
    runtime.audio.updateSkating(s, 1, runtime.myTeam);
    this.tickPublish(delta);
  }
}

/** The one loop. The scene drives it; everything else reads the runtime it advances. */
export const loop = new GameLoop();
