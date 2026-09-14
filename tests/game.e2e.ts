import { test, expect, type Page } from '@playwright/test';
async function state(page: Page) {
  return page.evaluate('JSON.parse(JSON.stringify(window.__BENCHED__.runtime.match))');
}
async function changeState(page: Page, code: string) {
  return page.evaluate(
    `(() => { const {runtime,publish} = window.__BENCHED__; ${code}; publish(); })()`,
  );
}
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'PLAY GAME' }).click();
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE', { timeout: 10000 });
}
test('menu renders, selects teams, opens accessible controls and settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SELECT TEAMS' })).toBeVisible();
  await page.getByRole('button', { name: 'HOW TO PLAY' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keyboard', exact: true }).click();
  await expect(page.getByText('W A S D', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Toggle beginner mode' }).click();
  await expect(page.getByRole('button', { name: 'Toggle beginner mode' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByLabel('Graphics').selectOption('low');
  await page.getByLabel('Camera angle').selectOption('tight');
  await page.getByLabel('Camera angle').selectOption('wide');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /MONTRÉAL Redline/ }).click();
  await page.getByRole('button', { name: 'PLAY GAME' }).click();
  expect((await state(page)).homeTeam).toBe(1);
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('keyboard skates, skill stick shoots, pause freezes play and help stays paused', async ({
  page,
}) => {
  await start(page);
  await changeState(
    page,
    'const s=runtime.match; s.controlled=0; s.puck.owner=0; s.skaters[0].x=0; s.skaters[0].z=-8; s.skaters[0].cooldown=0; s.skaters.slice(6).forEach(p=>{p.x=20;p.z=10})',
  );
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  expect((await state(page)).skaters[0].z).toBeGreaterThan(-7.7);
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(550);
  await page.keyboard.up('ArrowDown');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(90);
  await page.keyboard.up('ArrowUp');
  expect((await state(page)).shots[0]).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  const clock = (await state(page)).clock;
  await page.waitForTimeout(300);
  expect((await state(page)).clock).toBe(clock);
  await page.getByRole('button', { name: /Skill-stick controls/ }).click();
  await page.keyboard.press('Escape');
  expect((await state(page)).phase).toBe('paused');
  await page.getByRole('button', { name: 'RESUME GAME', exact: true }).click();
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE');
});
test('virtual Xbox connects, skates, shoots with RS, and safely disconnects', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      testPad: {
        connected: boolean;
        id: string;
        mapping: string;
        axes: number[];
        buttons: { pressed: boolean; value: number }[];
      };
    };
    w.testPad = {
      connected: true,
      id: 'Xbox Wireless Controller (test)',
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => (w.testPad.connected ? [w.testPad] : []),
    });
  });
  await page.goto('/');
  await expect(page.getByText('CONTROLLER CONNECTED')).toBeVisible();
  const pressPad = async (button: number) => {
    await page.evaluate(`window.testPad.buttons[${button}].pressed=true`);
    await page.waitForTimeout(90);
    await page.evaluate(`window.testPad.buttons[${button}].pressed=false`);
    await page.waitForTimeout(90);
  };
  await pressPad(15);
  await expect(page.getByRole('button', { name: /MONTRÉAL Redline/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await pressPad(14);
  await pressPad(0);
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE');
  await changeState(
    page,
    'const s=runtime.match; s.controlled=0; s.puck.owner=0; s.skaters[0].x=0;s.skaters[0].z=-8;s.skaters[0].cooldown=0;s.skaters.slice(6).forEach(p=>{p.x=20;p.z=10})',
  );
  await page.evaluate('window.testPad.axes[0]=1');
  await page.waitForTimeout(350);
  await page.evaluate('window.testPad.axes[0]=0');
  expect((await state(page)).skaters[0].z).toBeGreaterThan(-7.7);
  await page.evaluate('window.testPad.axes[3]=1');
  await page.waitForTimeout(600);
  await page.evaluate('window.testPad.axes[3]=-1');
  await page.waitForTimeout(120);
  await page.evaluate('window.testPad.axes[3]=0');
  expect((await state(page)).shots[0]).toBe(1);
  await pressPad(9);
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await pressPad(1);
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE');
  await changeState(page, 'runtime.match.clock=0.01');
  await expect(page.getByRole('heading', { name: 'Intermission' })).toBeVisible();
  await pressPad(0);
  expect((await state(page)).period).toBe(2);
  await page.evaluate('window.testPad.connected=false');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
});
test('all periods, goal presentation, final result, and rematch work', async ({ page }) => {
  await start(page);
  await changeState(
    page,
    'runtime.match.skaters.forEach(p=>{p.z=10});Object.assign(runtime.match.puck,{owner:null,x:25.8,z:0.8,y:0.4,vx:44,vz:0,lockout:1})',
  );
  await expect(page.locator('.goal-overlay > strong')).toBeVisible();
  expect((await state(page)).score).toEqual([1, 0]);
  for (let period = 1; period <= 3; period++) {
    await changeState(page, "runtime.match.phase='playing';runtime.match.clock=0.01");
    if (period < 3) {
      await expect(page.getByRole('heading', { name: 'Intermission' })).toBeVisible();
      await page.getByRole('button', { name: `START PERIOD ${period + 1}` }).click();
      expect((await state(page)).period).toBe(period + 1);
    } else {
      await expect(page.getByRole('heading', { name: 'You win' })).toBeVisible();
    }
  }
  await page.getByRole('button', { name: 'REMATCH' }).click();
  const s = await state(page);
  expect(s.score).toEqual([0, 0]);
  expect(s.period).toBe(1);
  expect(s.clock).toBe(300);
});
test('desktop and narrow layouts keep primary actions visible', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'artifacts/menu.png' });
  await page.getByRole('button', { name: 'PLAY GAME' }).click();
  await page.waitForTimeout(4200);
  await page.screenshot({ path: 'artifacts/game.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForTimeout(1500);
  expect(await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')).toBe(true);
  await page.getByRole('button', { name: 'PLAY GAME' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'PLAY GAME' })).toBeVisible();
  const footer = await page.locator('.footer-actions').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
});

test('controller test discovers a paired Xbox with no mapping label and does not start a match while testing', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      rawPad: {
        connected: boolean;
        mapping: string;
        id: string;
        axes: number[];
        buttons: { pressed: boolean; value: number }[];
      };
      exposePad: boolean;
    };
    w.exposePad = false;
    w.rawPad = {
      connected: true,
      mapping: '',
      id: 'Xbox Wireless Controller',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => (w.exposePad ? [null, w.rawPad] : []),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect controller', exact: true }).click();
  await expect(page.getByText('No controller detected', { exact: true })).toBeVisible();
  await page.evaluate(
    'window.exposePad=true;window.rawPad.buttons[0].pressed=true;window.rawPad.axes[0]=0.8;window.rawPad.axes[3]=-0.6;window.rawPad.buttons[7].value=0.9',
  );
  await expect(page.getByText('Xbox Wireless Controller', { exact: true })).toBeVisible();
  await expect(page.getByLabel('A pressed', { exact: true })).toBeVisible();
  await expect(page.getByLabel('RT pressed', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Left stick input').locator('i')).toHaveAttribute('style', /26\.4/);
  expect((await state(page)).phase).toBe('menu');
  await page.evaluate(
    'window.rawPad.buttons[0].pressed=false;window.rawPad.axes=[0,0,0,0];window.rawPad.buttons[7].value=0',
  );
  await page.getByRole('button', { name: 'Close controller setup' }).click();
  await expect(page.getByRole('button', { name: 'Test controller', exact: true })).toBeVisible();
});

test('3-on-3 and shootout can be selected from the menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '3 ON 3' }).click();
  await expect(page.getByText('3 PERIODS · 3 MINUTES')).toBeVisible();
  await page.getByRole('button', { name: 'PLAY GAME' }).click();
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE', { timeout: 10000 });
  const three = await state(page);
  expect(three.mode).toBe('threeOnThree');
  expect(three.clock).toBeGreaterThan(170);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'End match & return to menu' }).click();
  await page.getByRole('button', { name: 'SHOOTOUT' }).click();
  await expect(page.getByText('BEST OF 3 · THEN SUDDEN DEATH')).toBeVisible();
  await page.getByRole('button', { name: 'PLAY GAME' }).click();
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE', { timeout: 5000 });
  const shootout = await state(page);
  expect(shootout.mode).toBe('shootout');
  expect(shootout.phase).toBe('playing');
  expect(shootout.puck.owner).toBe(shootout.controlled);
});

test('free skate starts on open ice, keeps saves live, and resets after a goal', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'FREE SKATE' }).click();
  await expect(page.getByRole('heading', { name: 'FREE SKATE' })).toBeVisible();
  await page.getByRole('button', { name: 'START SKATE' }).click();
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE', { timeout: 5000 });
  await expect(page.getByText('SKATE', { exact: true })).toBeVisible();
  const opened = await state(page);
  expect(opened.mode).toBe('freeSkate');
  expect(opened.phase).toBe('playing');
  expect(opened.puck.owner).toBe(opened.controlled);
  await changeState(
    page,
    'const s=runtime.match; const g=s.skaters.find(p=>p.role==="G"&&p.team!==s.homeTeam); Object.assign(g,{x:25,z:0}); Object.assign(s.puck,{owner:null,x:24.1,z:0.1,y:0.4,vx:30,vz:0,shot:true,lockout:0})',
  );
  await expect
    .poll(async () => (await state(page)).events.some((e: { type: string }) => e.type === 'save'))
    .toBe(true);
  const afterSave = await state(page);
  expect(afterSave.phase).toBe('playing');
  expect(afterSave.puck.vx).toBeLessThan(0);
  await changeState(
    page,
    'const s=runtime.match; s.skaters.forEach(p=>{if(p.role==="G")p.z=8}); Object.assign(s.puck,{owner:null,x:25.8,z:0.8,y:0.4,vx:44,vz:0,lockout:1})',
  );
  await expect(page.locator('.goal-overlay > strong')).toHaveText('GOAL');
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE', { timeout: 5000 });
  expect((await state(page)).puck.owner).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'RESUME SKATE' })).toBeVisible();
});

test('a blocked Gamepad API explains the problem and leaves keyboard gameplay usable', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect controller', exact: true }).click();
  await expect(page.getByText(/Controller access is blocked/)).toBeVisible();
  await page.getByRole('button', { name: 'Close controller setup' }).click();
  await page.getByRole('button', { name: 'PLAY GAME' }).click();
  await expect(page.locator('.score-clock small')).toHaveText('● LIVE');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  expect(errors).toEqual([]);
});
