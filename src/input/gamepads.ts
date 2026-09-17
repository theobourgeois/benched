export type ControllerLayout = 'auto' | 'xbox';
export type ConnectionState =
  'waiting' | 'connected' | 'unsupported' | 'insecure' | 'unavailable' | 'blocked';
export interface ControllerStatus {
  connected: boolean;
  name: string;
  unsupported: boolean;
  state: ConnectionState;
  detail: string;
  mapping: string;
  axes: number[];
  buttons: number[];
}
export const WAITING_STATUS: ControllerStatus = {
  connected: false,
  name: 'No controller detected',
  unsupported: false,
  state: 'waiting',
  detail: 'Click this page, then press A on your controller to make it visible to the browser.',
  mapping: '',
  axes: [],
  buttons: [],
};
export function supportsPad(pad: Gamepad, layout: ControllerLayout) {
  if (pad.mapping === 'standard') return true;
  // Some Xbox browser/OS combinations expose the usual layout without its mapping label.
  // Do not guess axis-based trigger layouts or arbitrary HID device mappings.
  return (
    pad.axes.length === 4 &&
    pad.buttons.length >= 16 &&
    (layout === 'xbox' || /xbox|xinput/i.test(pad.id))
  );
}
/**
 * `claimed` holds the pads other seats are already using. Two people on one couch must never end
 * up sharing a controller, so a seat only ever sees pads nobody else is holding.
 */
const NO_VALUES: number[] = [];
export function pollGamepads(
  layout: ControllerLayout,
  previousIndex?: number,
  claimed: readonly number[] = [],
  /** Fill the raw axis and button arrays. Only the controller test screen reads them. */
  detail = false,
) {
  const fail = (state: ConnectionState, detail: string) => ({
    pad: null,
    status: { ...WAITING_STATUS, state, detail },
  });
  if (globalThis.isSecureContext === false)
    return fail(
      'insecure',
      'Open this game on localhost or HTTPS so the browser can access your controller.',
    );
  if (typeof navigator.getGamepads !== 'function')
    return fail(
      'unavailable',
      'This browser does not expose controller input here. Open the game directly in Chrome or Safari.',
    );
  let pads: Gamepad[];
  try {
    pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p?.connected);
  } catch {
    return fail(
      'blocked',
      'Controller access is blocked by the browser or the page embedding this game. Open the game directly in a browser tab.',
    );
  }
  const free = pads.filter((p) => !claimed.includes(p.index));
  const supported = free.filter((p) => supportsPad(p, layout));
  const pad = supported.find((p) => p.index === previousIndex) ?? supported[0] ?? null;
  const visible = pad ?? free[0];
  if (!visible) return { pad: null, status: { ...WAITING_STATUS } };
  return {
    pad,
    status: {
      connected: !!pad,
      name: visible.id.replace(/\s*\(.*\)/, '') || 'Game controller',
      unsupported: !pad,
      state: pad ? 'connected' : 'unsupported',
      detail: pad
        ? 'Move both sticks and press a trigger. The indicators below should respond.'
        : 'The browser sees this controller but has not supplied a supported layout. Check the raw inputs below.',
      mapping: pad
        ? pad.mapping === 'standard'
          ? 'Browser standard layout'
          : 'Xbox compatibility layout'
        : 'Unmapped controller',
      axes: detail ? Array.from(visible.axes) : NO_VALUES,
      buttons: detail ? Array.from(visible.buttons, (b) => b.value || +b.pressed) : NO_VALUES,
    } satisfies ControllerStatus,
  };
}
