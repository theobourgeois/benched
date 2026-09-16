/**
 * A clock that keeps running when the tab does not.
 *
 * A browser throttles `requestAnimationFrame` to about once a second in a hidden tab, and clamps
 * the page's own timers not long after. Online that is not a cosmetic problem: the host runs the
 * simulation for both players, so a host who switches tabs drags the other person's game into
 * slow motion with them. A worker's timers are not throttled the same way, and a message from one
 * wakes the main thread, so the host keeps stepping while nobody is looking at it.
 *
 * It carries no state and makes no decisions. It only says "now".
 */

const STEP_MS = 1000 / 120;
let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (event: MessageEvent<'start' | 'stop'>) => {
  if (event.data === 'stop') {
    if (timer !== null) clearInterval(timer);
    timer = null;
    return;
  }
  if (timer !== null) return;
  timer = setInterval(() => self.postMessage(0), STEP_MS);
};
