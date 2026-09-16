import { EMPTY_INPUT } from '../game/config';
import { clamp } from '../game/math';
import type { InputFrame } from '../game/types';
import {
  pollGamepads,
  WAITING_STATUS,
  type ControllerStatus,
  type ControllerLayout,
} from './gamepads';
const DEADZONE = 0.16;
export function deadzone(value: number) {
  return Math.abs(value) < DEADZONE
    ? 0
    : (Math.sign(value) * (Math.abs(value) - DEADZONE)) / (1 - DEADZONE);
}
export type ReplayInput = ReturnType<Controller['replayInput']>;
export const MENU_BUTTONS = [
  'confirm',
  'back',
  'x',
  'y',
  'left',
  'right',
  'up',
  'down',
  'start',
  'lb',
  'rb',
  'lt',
  'rt',
] as const;
export type MenuButton = (typeof MENU_BUTTONS)[number];
const NO_MENU_BUTTONS = Object.fromEntries(MENU_BUTTONS.map((b) => [b, false])) as Record<
  MenuButton,
  boolean
>;
const NO_MENU_TIMES = Object.fromEntries(MENU_BUTTONS.map((b) => [b, 0])) as Record<
  MenuButton,
  number
>;
const REPEATS = new Set<MenuButton>(['left', 'right', 'up', 'down']);
/** A held direction fires once, waits, then repeats at a steady clip. */
const REPEAT_DELAY = 0.38,
  REPEAT_EVERY = 0.09;
const repeatStep = (held: number) =>
  held < REPEAT_DELAY ? -1 : Math.floor((held - REPEAT_DELAY) / REPEAT_EVERY);
/** One input vocabulary for Gamepad API and keyboard. Shot gestures are edge-triggered. */
export class Controller {
  /**
   * Seat one owns the keyboard; a second local player is pad-only, since one keyboard cannot
   * sensibly be split between two people mid-rush.
   */
  constructor(readonly keyboard = true) {}
  private keys = new Set<string>();
  private taps = new Set<string>();
  private previous = {
    up: false,
    pass: false,
    poke: false,
    both: false,
    rb: false,
    switchPlayer: false,
    pause: false,
    faceA: false,
    faceB: false,
    faceX: false,
    faceY: false,
  };
  private windup = 0;
  private arcDrag = false;
  private lastStickX = 0;
  private stickMag = 0;
  private bumperTime = 0;
  private bumperChipped = false;
  private moveMag = 0;
  private triggerTime = 0;
  private previousUI: Record<MenuButton, boolean> = { ...NO_MENU_BUTTONS };
  /** Seconds each direction has been held, for menu auto-repeat. */
  private heldFor: Record<MenuButton, number> = { ...NO_MENU_TIMES };
  private menuClock = 0;
  /** Menu presses this frame. Held directions repeat like a console menu. */
  ui: Record<MenuButton, boolean> = { ...NO_MENU_BUTTONS };
  /** A pad button or stick moved this frame. */
  padActive = false;
  private lastPad: Gamepad | null = null;
  /** The pad this seat is holding, so the next seat along can be told to skip it. */
  get padIndex() {
    return this.lastPad?.index;
  }
  status: ControllerStatus = { ...WAITING_STATUS };
  layout: ControllerLayout = 'auto';
  /**
   * `claimed` is what the seats ahead of this one are already holding. The caller passes it in
   * rather than seats discovering each other: whoever drives the frame knows the order, and a
   * registry of live seats is at the mercy of mount and unmount.
   */
  claimed: readonly number[] = [];
  refresh = () => {
    this.status = pollGamepads(this.layout, this.lastPad?.index, this.claimed).status;
  };
  onDisconnect?: () => void;
  private keyDown = (e: KeyboardEvent) => {
    if (e.code === 'Backquote') return;
    const target = e.target as { closest?: (selector: string) => Element | null } | null;
    if (target?.closest?.('input[type="number"], input[type="search"], textarea, select')) return;
    if (document.querySelector('[data-block-game-input]')) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
      e.preventDefault();
    if (!this.keys.has(e.code)) this.taps.add(e.code);
    this.keys.add(e.code);
  };
  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private blur = () => {
    this.keys.clear();
    this.taps.clear();
    this.windup = 0;
    this.arcDrag = false;
    this.lastStickX = 0;
    this.stickMag = 0;
    this.bumperTime = 0;
    this.bumperChipped = false;
    this.moveMag = 0;
    this.triggerTime = 0;
    this.onDisconnect?.();
  };
  attach() {
    if (this.keyboard) {
      window.addEventListener('keydown', this.keyDown);
      window.addEventListener('keyup', this.keyUp);
    }
    window.addEventListener('blur', this.blur);
    window.addEventListener('gamepadconnected', this.refresh);
    window.addEventListener('gamepaddisconnected', this.refresh);
    this.refresh();
    return () => {
      window.removeEventListener('keydown', this.keyDown);
      window.removeEventListener('keyup', this.keyUp);
      window.removeEventListener('blur', this.blur);
      window.removeEventListener('gamepadconnected', this.refresh);
      window.removeEventListener('gamepaddisconnected', this.refresh);
    };
  }
  read(dt: number, hasPuck = false): InputFrame {
    const { pad, status } = pollGamepads(this.layout, this.lastPad?.index, this.claimed);
    if (this.lastPad && !pad) {
      this.windup = 0;
      this.arcDrag = false;
      this.lastStickX = 0;
      this.stickMag = 0;
      this.bumperTime = 0;
      this.bumperChipped = false;
      this.moveMag = 0;
      this.triggerTime = 0;
      this.onDisconnect?.();
    }
    this.lastPad = pad;
    this.status = status;
    const key = (k: string) => this.keys.has(k);
    const tapped = (k: string) => key(k) || this.taps.has(k);
    const button = (i: number) => !!pad?.buttons[i]?.pressed || (pad?.buttons[i]?.value ?? 0) > 0.5;
    const axis = (i: number) => deadzone(pad?.axes[i] ?? 0);
    const moveX = clamp(axis(0) + +key('KeyD') - +key('KeyA'), -1, 1);
    const moveZ = clamp(axis(1) + +key('KeyS') - +key('KeyW'), -1, 1);
    const stickX = clamp(axis(2) + +key('ArrowRight') - +key('ArrowLeft'), -1, 1);
    const stickY = clamp(axis(3) + +key('ArrowDown') - +tapped('ArrowUp'), -1, 1);
    if (Math.abs(this.lastStickX) > 0.6 && stickY > 0.35) this.arcDrag = true;
    if (Math.hypot(stickX, stickY) < 0.15 || stickY < -0.55) this.arcDrag = false;
    this.lastStickX = stickX;
    const lb = button(4) || key('KeyR');
    const rb = button(5) || key('KeyE') || this.taps.has('KeyE');
    const both = lb && rb;
    const stickMag = Math.hypot(stickX, stickY);
    const stickFlick = stickMag > 0.62 && this.stickMag < 0.38;
    const toeDrag = button(11) || key('KeyC') || this.arcDrag;
    if (toeDrag || rb) this.windup = 0;
    else if (stickY > 0.3) this.windup = clamp(this.windup + dt * 1.9, 0, 1);
    else if (stickY > -0.55) this.windup = Math.max(0, this.windup - dt * 1.1);
    const moveMag = Math.hypot(moveX, moveZ);
    const rbPress = rb && !this.previous.rb && !both;
    const passHeld = button(7) || tapped('Space');
    const lt = button(6) || key('ControlLeft');
    let chip = false,
      saucer = false,
      poke = false,
      check = false,
      checkPower = 0,
      reach = false,
      deke = false,
      dekeSpecial: InputFrame['dekeSpecial'] = null;
    // Tap LT (or Ctrl) for a spin-o-rama; holding it still backskates.
    const backskate = lt;
    if (lt) this.triggerTime += dt;
    else {
      if (hasPuck && this.triggerTime > 0 && this.triggerTime < 0.28) dekeSpecial = 'spin';
      this.triggerTime = 0;
    }
    if (hasPuck) {
      if (rb && !both && !passHeld) {
        const sideStick = Math.abs(stickX) > 0.62 && Math.abs(stickY) < 0.38;
        if (rbPress && sideStick) dekeSpecial = 'windmill';
        else if ((rbPress && moveMag > 0.55) || (moveMag > 0.55 && this.moveMag <= 0.55))
          deke = true;
        if (stickFlick) {
          if (stickY < -0.45 && Math.abs(stickY) >= Math.abs(stickX) * 0.85) dekeSpecial = 'jump';
          else if (stickY > 0.45 && Math.abs(stickY) >= Math.abs(stickX) * 0.85)
            dekeSpecial = 'throughLegs';
          else if (!dekeSpecial) chip = true;
        }
        if (dekeSpecial) deke = false;
        if (deke || dekeSpecial || chip) this.bumperChipped = true;
      }
      if (rb) this.bumperTime += dt;
      else {
        saucer =
          this.previous.rb &&
          !this.previous.both &&
          !this.bumperChipped &&
          this.bumperTime > 0 &&
          this.bumperTime < 0.28;
        this.bumperTime = 0;
        this.bumperChipped = false;
      }
    } else {
      poke = rb && !this.previous.rb && !both;
      // Pulling down loads the shoulder. Only the forward edge commits it, including a
      // direct down-to-up flick that never crosses a neutral frame.
      check = stickY < -0.55 && !this.previous.up && !rb && !both;
      if (check) checkPower = this.windup;
      // Any flick, as a goalie, throws a save that way.
      reach = stickFlick && !rb && !both;
      this.bumperTime = 0;
      this.bumperChipped = false;
    }
    const dive = (both && !this.previous.both) || (!hasPuck && this.taps.has('KeyF'));
    const faceA = button(0) || tapped('Digit1') || tapped('KeyZ');
    const faceB = button(1) || tapped('Digit2') || tapped('KeyB');
    const faceX = button(2) || tapped('Digit3') || tapped('KeyX');
    const faceY = button(3) || tapped('Digit4') || tapped('KeyY');
    const held = {
      up: stickY < -0.55,
      pass: passHeld,
      poke,
      both,
      rb,
      switchPlayer: button(0) || tapped('KeyQ'),
      pause: button(9) || tapped('Escape'),
    };
    const shoot = held.up && !this.previous.up && !rb;
    const uiHeld: Record<MenuButton, boolean> = {
      confirm: button(0),
      back: button(1),
      x: button(2),
      y: button(3),
      left: button(14) || axis(0) < -0.6,
      right: button(15) || axis(0) > 0.6,
      up: button(12) || axis(1) < -0.6,
      down: button(13) || axis(1) > 0.6,
      start: button(9),
      lb: button(4),
      rb: button(5),
      lt: button(6),
      rt: button(7),
    };
    // Menus repeat on the wall clock, so a slow frame rate doesn't make them sluggish.
    const now = performance.now() / 1000;
    const menuDt = this.menuClock ? Math.min(now - this.menuClock, 0.25) : 0;
    this.menuClock = now;
    for (const name of MENU_BUTTONS) {
      const before = this.heldFor[name];
      const after = uiHeld[name] ? before + menuDt : 0;
      this.heldFor[name] = after;
      const edge = uiHeld[name] && !this.previousUI[name];
      this.ui[name] =
        edge || (REPEATS.has(name) && before > 0 && repeatStep(after) > repeatStep(before));
    }
    this.previousUI = uiHeld;
    this.padActive =
      !!pad &&
      (pad.buttons.some((b) => b.pressed || b.value > 0.5) ||
        pad.axes.some((a) => Math.abs(a) > 0.5));
    const frame = {
      ...EMPTY_INPUT,
      moveX,
      moveZ,
      stickX,
      stickY,
      toeDrag,
      shotHeight: lb && !rb ? 1 : 0,
      shoot,
      shotPower: shoot ? this.windup : 0,
      pass: held.pass && !this.previous.pass,
      passHeld: held.pass,
      passRelease: this.previous.pass && !held.pass,
      poke,
      pokeHeld: rb && !both && !hasPuck,
      saucer,
      chip,
      deke,
      dekeSpecial,
      dive,
      check,
      checkPower,
      reach,
      block: lb && !rb && !hasPuck,
      switchPlayer: held.switchPlayer && !this.previous.switchPlayer,
      pause: held.pause && !this.previous.pause,
      hustle: button(10) || key('ShiftLeft') || key('ShiftRight'),
      backskate,
      celly:
        !this.previous.faceA && faceA
          ? ('helicopter' as const)
          : !this.previous.faceB && faceB
            ? ('limp' as const)
            : !this.previous.faceX && faceX
              ? ('jump' as const)
              : !this.previous.faceY && faceY
                ? ('dance' as const)
                : null,
    };
    if (shoot || check) this.windup = 0;
    this.previous = { ...held, faceA, faceB, faceX, faceY };
    this.stickMag = stickMag;
    this.moveMag = moveMag;
    this.taps.clear();
    return frame;
  }
  private previousReplay = new Set<string>();
  /**
   * Replay transport and camera, from the same pad and keys as play. Call it every frame, before
   * read() clears the key taps, so a button already held when a replay opens is not a press.
   */
  replayInput() {
    const { pad } = pollGamepads(this.layout, this.lastPad?.index, this.claimed);
    const key = (k: string) => this.keys.has(k) || this.taps.has(k);
    const button = (i: number) => !!pad?.buttons[i]?.pressed || (pad?.buttons[i]?.value ?? 0) > 0.5;
    const trigger = (i: number) => {
      const value = pad?.buttons[i]?.value ?? 0;
      return value > 0.08 ? value : 0;
    };
    const axis = (i: number) => deadzone(pad?.axes[i] ?? 0);
    const held = {
      play: button(0) || key('Space') || key('Enter') || key('KeyK'),
      exit: button(1) || button(9) || key('Escape') || key('Backspace'),
      camera: button(3) || key('KeyC'),
      restart: button(2) || key('Home') || key('Digit0'),
      stepBack: button(14) || key('Comma'),
      stepForward: button(15) || key('Period'),
      slower: button(13) || key('Minus'),
      faster: button(12) || key('Equal'),
    };
    const names = Object.keys(held) as (keyof typeof held)[];
    const pressed = Object.fromEntries(
      names.map((name) => [name, held[name] && !this.previousReplay.has(name)]),
    ) as Record<keyof typeof held, boolean>;
    this.previousReplay = new Set(names.filter((name) => held[name]));
    return {
      ...pressed,
      /** RT runs forward, LT rewinds; both up to 2×. */
      scrub: clamp(trigger(7) - trigger(6) + +key('KeyE') - +key('KeyQ'), -1, 1),
      orbitX: clamp(axis(2) + +key('ArrowRight') - +key('ArrowLeft'), -1, 1),
      orbitY: clamp(axis(3) + +key('ArrowDown') - +key('ArrowUp'), -1, 1),
      moveX: clamp(axis(0) + +key('KeyD') - +key('KeyA'), -1, 1),
      moveZ: clamp(axis(1) + +key('KeyS') - +key('KeyW'), -1, 1),
      /** + pulls the camera back (LB, F), − pushes in (RB, R). */
      zoom: clamp(+button(4) + +key('KeyF') - +button(5) - +key('KeyR'), -1, 1),
    };
  }
  rumble(power: number, duration = 100) {
    const actuator = this.lastPad?.vibrationActuator;
    if (actuator?.playEffect)
      void actuator
        .playEffect('dual-rumble', {
          duration,
          strongMagnitude: clamp(power, 0, 1),
          weakMagnitude: clamp(power * 0.6, 0, 1),
        })
        .catch(() => {});
  }
}
