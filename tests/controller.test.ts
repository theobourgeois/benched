import { afterEach, describe, expect, it, vi } from 'vitest';
import { Controller, deadzone } from '../src/input/controller';
function setupPad() {
  const pad = {
    connected: true,
    mapping: 'standard',
    id: 'Xbox Wireless Controller',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
  return pad;
}
afterEach(() => vi.unstubAllGlobals());
describe('Xbox skill stick', () => {
  it('suppresses stick drift and preserves full deflection', () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(-0.1)).toBe(0);
    expect(deadzone(1)).toBe(1);
    expect(deadzone(-1)).toBe(-1);
  });
  it('detects windup then forward flick once, even while held', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.axes[3] = 1;
    for (let i = 0; i < 60; i++) input.read(1 / 60);
    pad.axes[3] = -1;
    const shot = input.read(1 / 60);
    expect(shot.shoot).toBe(true);
    expect(shot.shotPower).toBe(1);
    expect(input.read(1 / 60).shoot).toBe(false);
    pad.axes[3] = 0;
    input.read(1 / 60);
    pad.axes[3] = -1;
    expect(input.read(1 / 60).shotPower).toBe(0);
  });
  it('maps Xbox triggers, bumpers, sticks, and menu', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.axes[0] = 1;
    pad.axes[1] = -1;
    for (const i of [5, 6, 7, 9, 10]) pad.buttons[i].pressed = true;
    const frame = input.read(1 / 60);
    expect(frame).toMatchObject({
      moveX: 1,
      moveZ: -1,
      pass: true,
      poke: true,
      backskate: true,
      hustle: true,
      pause: true,
    });
    expect(input.read(1 / 60)).toMatchObject({ pass: false, poke: false, pause: false });
  });
  it('treats an RB tap with the puck as a saucer and RB plus RS as a chip', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.buttons[5].pressed = true;
    expect(input.read(1 / 60, true)).toMatchObject({ poke: false, saucer: false, chip: false });
    pad.buttons[5].pressed = false;
    expect(input.read(1 / 60, true)).toMatchObject({ saucer: true, poke: false, chip: false });
    pad.buttons[5].pressed = true;
    input.read(1 / 60, true);
    pad.axes[2] = 1;
    const dump = input.read(1 / 60, true);
    expect(dump).toMatchObject({ chip: true, shoot: false, poke: false, deke: false });
  });
  it('one-touch dekes on RB plus left stick, with jump and through-the-legs on RB plus RS', () => {
    const pad = setupPad(),
      stride = new Controller();
    pad.axes[0] = 1;
    pad.buttons[5].pressed = true;
    expect(stride.read(1 / 60, true)).toMatchObject({ deke: true, chip: false, saucer: false });
    expect(stride.read(1 / 60, true).deke).toBe(false);

    const jump = new Controller();
    pad.axes[0] = 0;
    pad.buttons[5].pressed = true;
    jump.read(1 / 60, true);
    pad.axes[3] = -1;
    expect(jump.read(1 / 60, true)).toMatchObject({
      dekeSpecial: 'jump',
      chip: false,
      shoot: false,
    });

    const through = new Controller();
    pad.axes[3] = 0;
    pad.buttons[5].pressed = true;
    through.read(1 / 60, true);
    pad.axes[3] = 1;
    expect(through.read(1 / 60, true)).toMatchObject({
      dekeSpecial: 'throughLegs',
      chip: false,
    });
  });
  it('windmills when RB is tapped onto a held skill-stick deke, and spins on RB plus LT', () => {
    const pad = setupPad(),
      mill = new Controller();
    pad.axes[2] = 1;
    mill.read(1 / 60, true);
    pad.buttons[5].pressed = true;
    expect(mill.read(1 / 60, true)).toMatchObject({ dekeSpecial: 'windmill', chip: false });

    const spin = new Controller();
    pad.axes[2] = 0;
    pad.buttons[5].pressed = true;
    spin.read(1 / 60, true);
    pad.buttons[6].pressed = true;
    expect(spin.read(1 / 60, true)).toMatchObject({ dekeSpecial: 'spin', chip: false });
  });
  it('dives on both bumpers and checks with a skill-stick flick', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.buttons[4].pressed = true;
    pad.buttons[5].pressed = true;
    const dive = input.read(1 / 60);
    expect(dive).toMatchObject({ dive: true, poke: false });
    pad.buttons[4].pressed = false;
    pad.buttons[5].pressed = false;
    input.read(1 / 60);
    pad.axes[3] = -1;
    expect(input.read(1 / 60)).toMatchObject({ check: true, dive: false });
  });
  it('loads a defensive check without firing, then commits once on a direct down-to-up flick', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.axes[3] = 1;
    for (let i = 0; i < 30; i++) expect(input.read(1 / 60, false).check).toBe(false);
    pad.axes[3] = -1;
    const hit = input.read(1 / 60, false);
    expect(hit.check).toBe(true);
    expect(hit.checkPower).toBeGreaterThan(0.9);
    expect(input.read(1 / 60, false).check).toBe(false);
    pad.axes[3] = 0;
    pad.axes[2] = 1;
    expect(input.read(1 / 60, false).check).toBe(false);
  });
  it('reports disconnects and rejects unsupported mappings', () => {
    const pad = setupPad(),
      input = new Controller(),
      disconnect = vi.fn();
    input.onDisconnect = disconnect;
    input.read(1 / 60);
    expect(input.status.connected).toBe(true);
    pad.connected = false;
    input.read(1 / 60);
    expect(disconnect).toHaveBeenCalledOnce();
    pad.connected = true;
    pad.mapping = '';
    pad.id = 'Unidentified HID device';
    input.read(1 / 60);
    expect(input.status.unsupported).toBe(true);
    expect(input.status.connected).toBe(false);
  });
});

describe('keyboard tap buffering', () => {
  it('does not lose a press released between two render frames', () => {
    setupPad();
    const events = new EventTarget();
    vi.stubGlobal('window', events);
    vi.stubGlobal('document', { querySelector: () => null });
    const controller = new Controller(),
      detach = controller.attach();
    const dispatch = (type: string, code: string) => {
      const event = new Event(type);
      Object.defineProperty(event, 'code', { value: code });
      events.dispatchEvent(event);
    };
    dispatch('keydown', 'Escape');
    dispatch('keyup', 'Escape');
    expect(controller.read(1 / 60).pause).toBe(true);
    expect(controller.read(1 / 60).pause).toBe(false);
    dispatch('keydown', 'ArrowUp');
    dispatch('keyup', 'ArrowUp');
    expect(controller.read(1 / 60).shoot).toBe(true);
    expect(controller.read(1 / 60).shoot).toBe(false);
    detach();
  });
});

describe('browser controller detection', () => {
  it('accepts an Xbox with a missing mapping label when its layout matches', () => {
    const pad = setupPad();
    pad.mapping = '';
    pad.axes = [0.8, -0.7, 0.3, -1];
    const input = new Controller();
    const frame = input.read(1 / 60);
    expect(input.status.connected).toBe(true);
    expect(input.status.mapping).toBe('Xbox compatibility layout');
    expect(frame.moveX).toBeGreaterThan(0.7);
    expect(frame.moveZ).toBeLessThan(-0.6);
    expect(frame.shoot).toBe(true);
  });
  it('does not guess the mapping of a six-axis raw Xbox device', () => {
    const pad = setupPad();
    pad.mapping = '';
    pad.axes = [0, 0, -1, 0, 0, -1];
    const input = new Controller();
    input.read(1 / 60);
    expect(input.status.unsupported).toBe(true);
  });
  it('supports an explicit Xbox-layout override for generic four-axis controllers', () => {
    const pad = setupPad();
    pad.mapping = '';
    pad.id = 'Wireless Controller';
    const input = new Controller();
    input.read(1 / 60);
    expect(input.status.unsupported).toBe(true);
    input.layout = 'xbox';
    input.read(1 / 60);
    expect(input.status.connected).toBe(true);
  });
  it('handles unavailable, insecure, and blocked APIs without breaking keyboard input', () => {
    vi.stubGlobal('navigator', {});
    const input = new Controller();
    expect(() => input.read(1 / 60)).not.toThrow();
    expect(input.status.state).toBe('unavailable');
    vi.stubGlobal('isSecureContext', false);
    input.read(1 / 60);
    expect(input.status.state).toBe('insecure');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {
      getGamepads: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    expect(() => input.read(1 / 60)).not.toThrow();
    expect(input.status.state).toBe('blocked');
  });
  it('discovers an already-paired pad after the browser exposes it on button press', () => {
    const pad = setupPad();
    let exposed = false;
    vi.stubGlobal('navigator', { getGamepads: () => (exposed ? [null, pad] : []) });
    const input = new Controller();
    input.read(1 / 60);
    expect(input.status.state).toBe('waiting');
    exposed = true;
    pad.buttons[0].pressed = true;
    input.read(1 / 60);
    expect(input.status.connected).toBe(true);
    expect(input.ui.confirm).toBe(true);
  });
  it('uses analog trigger values when the browser does not set pressed', () => {
    const pad = setupPad();
    pad.buttons[7].value = 0.9;
    expect(new Controller().read(1 / 60).pass).toBe(true);
  });
  it('holds a pass while the trigger is down and sends it on release', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.buttons[7].pressed = true;
    const press = input.read(1 / 60);
    expect(press).toMatchObject({ pass: true, passHeld: true, passRelease: false });
    expect(input.read(1 / 60)).toMatchObject({ pass: false, passHeld: true, passRelease: false });
    pad.buttons[7].pressed = false;
    expect(input.read(1 / 60)).toMatchObject({ pass: false, passHeld: false, passRelease: true });
  });
});

describe('shot elevation and toe drag gestures', () => {
  it('aims corners from the left stick, not the skill-stick flick', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.axes[3] = -1;
    expect(input.read(1 / 60)).toMatchObject({ shoot: true, shotPower: 0, shotHeight: 0 });
  });
  it('lets LB force a top-shelf shot', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.buttons[4].pressed = true;
    pad.axes[3] = -0.7;
    expect(input.read(1 / 60).shotHeight).toBe(1);
  });
  it('does not aim shots with a skill-stick deke', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.axes[2] = 0.7;
    pad.axes[3] = -0.9;
    const shot = input.read(1 / 60);
    expect(shot.shoot).toBe(true);
    expect(shot.aimZ).toBeUndefined();
    expect(shot.moveX).toBe(0);
  });
  it('RS click and pull-back drags without loading a slap shot', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.buttons[11].pressed = true;
    pad.axes[3] = 1;
    for (let i = 0; i < 60; i++) expect(input.read(1 / 60).toeDrag).toBe(true);
    pad.buttons[11].pressed = false;
    pad.axes[3] = -1;
    expect(input.read(1 / 60)).toMatchObject({ shoot: true, shotPower: 0 });
  });
  it('rolling from the side to the bottom performs a toe drag and resets in neutral', () => {
    const pad = setupPad(),
      input = new Controller();
    pad.axes[2] = 1;
    input.read(1 / 60);
    pad.axes[2] = 0.7;
    pad.axes[3] = 0.8;
    expect(input.read(1 / 60).toeDrag).toBe(true);
    pad.axes[2] = 0;
    pad.axes[3] = 1;
    expect(input.read(1 / 60).toeDrag).toBe(true);
    pad.axes[3] = 0;
    expect(input.read(1 / 60).toeDrag).toBe(false);
  });
});
