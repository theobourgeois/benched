import { useEffect, useRef, useSyncExternalStore } from 'react';
import { MENU_BUTTONS, type Controller, type MenuButton } from './controller';

/**
 * Menu input. Every screen that takes presses mounts a layer; the newest layer owns the pad and
 * keyboard until it unmounts. Screens keep their own focus, so each can decide what a direction
 * means (a list moves, a selector steps, the matchup switches sides).
 */
export type NavAction = MenuButton;
export type NavHandler = (action: NavAction) => void;
/** The input the player last touched, so prompts show the right buttons. */
export type Device = 'pad' | 'keys';

const layers: { current: NavHandler }[] = [];
export const navActive = () => layers.length > 0;

export function useNav(handler: NavHandler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const layer = { current: (action: NavAction) => latest.current(action) };
    layers.push(layer);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
    };
  }, []);
}

let device: Device = 'keys';
const watchers = new Set<() => void>();
function setDevice(next: Device) {
  if (next === device) return;
  device = next;
  watchers.forEach((fn) => fn());
}
export function useDevice() {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => device,
  );
}

const dispatch = (action: NavAction) => layers.at(-1)?.current(action);

/**
 * Seat two's presses, for the few screens that want them (a second player joining the matchup).
 * A separate stack rather than a flag on `useNav`: every other screen belongs to seat one, and
 * a couch guest thumbing their pad should not be able to walk it through the menus.
 */
const seatTwoLayers: { current: NavHandler }[] = [];
export function useSeatTwoNav(handler: NavHandler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const layer = { current: (action: NavAction) => latest.current(action) };
    seatTwoLayers.push(layer);
    return () => {
      seatTwoLayers.splice(seatTwoLayers.indexOf(layer), 1);
    };
  }, []);
}

/** Wraps a list index; skips entries the caller marks unavailable. */
export function step(index: number, dir: number, count: number, skip?: (i: number) => boolean) {
  let next = index;
  for (let tries = 0; tries < count; tries++) {
    next = (next + dir + count) % count;
    if (!skip?.(next)) return next;
  }
  return index;
}

/** Runs once per frame from the simulation loop. True while a menu owns the pad. */
export function navigateWithController(controller: Controller) {
  if (controller.padActive) setDevice('pad');
  if (!navActive()) return false;
  for (const button of MENU_BUTTONS) if (controller.ui[button]) dispatch(button);
  return true;
}

/** Seat two's half of the menus. Only heard while the screen on top also listens for it. */
export function navigateSeatTwo(controller: Controller) {
  const top = seatTwoLayers.at(-1);
  if (!top || !navActive()) return;
  for (const button of MENU_BUTTONS) if (controller.ui[button]) top.current(button);
}

const KEYS: Record<string, NavAction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  Backspace: 'back',
  KeyX: 'x',
  KeyR: 'y',
  KeyQ: 'lb',
  KeyE: 'rb',
  KeyZ: 'lt',
  KeyC: 'rt',
};
const REPEATING = new Set<NavAction>(['up', 'down', 'left', 'right']);

// Capture phase, so a key a menu uses never also reaches gameplay (Escape would re-pause).
function keyDown(e: KeyboardEvent) {
  setDevice('keys');
  if (!layers.length || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as Element | null;
  if (target?.closest?.('input, textarea, select, [data-feel-hud]')) return;
  const action = KEYS[e.code];
  if (!action) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat && !REPEATING.has(action)) return;
  dispatch(action);
}
// A focused button would otherwise click itself on Space release.
function keyUp(e: KeyboardEvent) {
  if (layers.length && (e.code === 'Space' || e.code === 'Enter')) e.preventDefault();
}
window.addEventListener('keydown', keyDown, true);
window.addEventListener('keyup', keyUp, true);
import.meta.hot?.dispose(() => {
  window.removeEventListener('keydown', keyDown, true);
  window.removeEventListener('keyup', keyUp, true);
});
