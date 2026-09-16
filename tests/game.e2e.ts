import { test, expect, type Page } from '@playwright/test';
async function state(page: Page) {
  return page.evaluate(
    'JSON.parse(JSON.stringify({ ...window.__BENCHED__.runtime.match, myTeam: window.__BENCHED__.runtime.myTeam }))',
  );
}
async function settings(page: Page) {
  return page.evaluate('JSON.parse(JSON.stringify(window.__BENCHED__.runtime.settings))');
}
async function changeState(page: Page, code: string) {
  return page.evaluate(
    `(() => { const {runtime,publish} = window.__BENCHED__; ${code}; publish(); })()`,
  );
}
const live = (page: Page) => page.locator('.hud[data-phase="playing"]');
/** Main menu entry, then ready up and drop the puck. */
async function play(page: Page, entry = 'Play Now') {
  await page.getByRole('button', { name: entry, exact: true }).click();
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Play game', exact: true }).click();
}
async function start(page: Page) {
  await page.goto('/');
  await play(page);
  await expect(live(page)).toBeVisible({ timeout: 30000 });
}
test('menu renders, selects teams, opens accessible controls and settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Controls' })).toBeVisible();
  await page.getByRole('tab', { name: 'Keyboard' }).click();
  await expect(page.locator('.control-row').first()).toContainText('Skate');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous CPU difficulty' }).click();
  await page.getByRole('button', { name: 'Previous CPU difficulty' }).click();
  expect((await settings(page)).difficulty).toBe('rookie');
  const beginner = page.getByRole('switch', { name: 'Beginner mode' });
  await beginner.click();
  await expect(beginner).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Next Graphics' }).click();
  await page.getByRole('button', { name: 'Next Camera angle' }).click();
  await page.getByRole('switch', { name: 'FPS counter' }).click();
  expect(await settings(page)).toMatchObject({ quality: 'low', showFps: false, beginner: false });
  expect((await settings(page)).camera).not.toBe('broadcast');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Play Now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Select Teams' })).toBeVisible();
  await page.getByRole('button', { name: 'Toronto Maple Leafs' }).click();
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Play game', exact: true }).click();
  const s = await state(page);
  expect(s.myTeam).toBe(1);
  expect(s.difficulty).toBe('rookie');
  expect(s.jerseys).toEqual(['home', 'away']);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(live(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.fps-counter')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('settings survive a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Button prompts' }).click();
  await expect(page.locator('.prompts')).toHaveCount(0);
  await page.reload();
  expect((await settings(page)).hints).toBe(false);
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  await expect(page.locator('.prompts')).toHaveCount(0);
});
test('an NHL matchup puts real clubs, logos and starters on the ice', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play Now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Montréal Canadiens' })).toBeVisible();
  await page.getByRole('button', { name: 'Toronto Maple Leafs' }).click();
  await page.getByRole('button', { name: 'Next away team' }).click();
  await expect(page.getByRole('button', { name: 'Utah Mammoth' })).toBeVisible();
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Play game', exact: true }).click();
  await expect(live(page)).toBeVisible({ timeout: 30000 });
  const s = await state(page);
  expect(s.teams.map((t: { key: string }) => t.key)).toEqual(['nhl:MTL', 'nhl:UTA']);
  expect(s.skaters[0].name).toBe(s.teams[0].lineup[0].name);
  const logos = page.locator('.bug-team img');
  await expect(logos).toHaveCount(2);
  await expect
    .poll(() =>
      logos.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit to Menu' }).click();
  await page.getByRole('button', { name: 'Play Now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Utah Mammoth' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('keyboard skates, skill stick shoots, pause freezes play and help stays paused', async ({
  page,
}) => {
  await start(page);
  await changeState(
    page,
    'const s=runtime.match; s.sides[0].controlled=0; s.puck.owner=0; s.skaters[0].x=0; s.skaters[0].z=-8; s.skaters[0].cooldown=0;Object.assign(s.skaters[0],{vx:0,vz:0,angle:Math.PI/2,downTimer:0,stumbleTimer:0,checkTimer:0}); s.skaters.slice(6).forEach(p=>{p.x=20;p.z=10})',
  );
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await state(page)).skaters[0].z).toBeGreaterThan(-7.7);
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
  await expect(live(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  const clock = (await state(page)).clock;
  await page.waitForTimeout(300);
  expect((await state(page)).clock).toBe(clock);
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Controls' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect((await state(page)).phase).toBe('paused');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(live(page)).toBeVisible();
});
test('virtual Xbox drives the menus, picks a jersey, skates, shoots, and safely disconnects', async ({
  page,
}) => {
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
  await expect
    .poll(() => page.evaluate('window.__BENCHED__.runtime.controller.status.connected'))
    .toBe(true);
  const pressPad = async (button: number) => {
    await page.evaluate(`window.testPad.buttons[${button}].pressed=true`);
    await page.waitForTimeout(90);
    await page.evaluate(`window.testPad.buttons[${button}].pressed=false`);
    await page.waitForTimeout(90);
  };
  // A on Play Now opens the matchup; the prompts switch to controller glyphs.
  await pressPad(0);
  await expect(page.getByRole('heading', { name: 'Select Teams' })).toBeVisible();
  await expect(page.locator('.prompts .glyph.pad').first()).toBeVisible();
  // Left takes the away side, right comes back home; down changes your club.
  await pressPad(14);
  await expect(page.getByRole('button', { name: 'Toronto Maple Leafs' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await pressPad(15);
  await pressPad(13);
  await expect(page.getByRole('button', { name: 'Nashville Predators' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.evaluate('window.testPad.axes[1]=-1');
  await page.waitForTimeout(90);
  await page.evaluate('window.testPad.axes[1]=0');
  await page.waitForTimeout(90);
  await expect(page.getByRole('button', { name: 'Toronto Maple Leafs' })).toBeVisible();
  // A readies up; down swaps to the away sweater; B backs out and A readies again.
  await pressPad(0);
  await expect(page.locator('.team-select')).toHaveAttribute('data-stage', 'ready');
  await pressPad(13);
  await expect(page.locator('.side-home .panel-jersey')).toContainText('Away');
  await pressPad(1);
  await expect(page.locator('.team-select')).toHaveAttribute('data-stage', 'team');
  await pressPad(0);
  await pressPad(0);
  await expect(live(page)).toBeVisible();
  const started = await state(page);
  expect(started.jerseys).toEqual(['away', 'home']);
  expect(started.mode).toBe('exhibition');
  await changeState(
    page,
    'const s=runtime.match; s.sides[0].controlled=0; s.puck.owner=0; s.skaters[0].x=0;s.skaters[0].z=-8;s.skaters[0].cooldown=0;Object.assign(s.skaters[0],{vx:0,vz:0,angle:Math.PI/2,downTimer:0,stumbleTimer:0,checkTimer:0});s.skaters.slice(6).forEach(p=>{p.x=20;p.z=10})',
  );
  await page.evaluate('window.testPad.axes[0]=1');
  await expect.poll(async () => (await state(page)).skaters[0].z).toBeGreaterThan(-7.7);
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
  await expect(live(page)).toBeVisible();
  await changeState(page, 'runtime.match.clock=0.01');
  await expect(page.getByRole('heading', { name: 'Intermission' })).toBeVisible();
  await pressPad(0);
  expect((await state(page)).period).toBe(2);
  await page.evaluate('window.testPad.connected=false');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
});
test('a held stick repeats through a menu', async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      connected: true,
      id: 'Xbox Wireless Controller (test)',
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.assign(window, { testPad: pad });
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  const focusIndex = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.menu-item')).findIndex((e) =>
        e.hasAttribute('data-focused'),
      ),
    );
  await page.evaluate('window.testPad.axes[1]=1');
  // One step on the press, then repeats after a short hold. Poll fast so it's seen before it wraps.
  await expect.poll(focusIndex, { timeout: 2000 }).toBe(1);
  await expect.poll(focusIndex, { intervals: [50], timeout: 4000 }).toBeGreaterThan(1);
  await page.evaluate('window.testPad.axes[1]=0');
});
test('all periods, goal presentation, final result, and rematch work', async ({ page }) => {
  await start(page);
  await changeState(
    page,
    'runtime.match.skaters.forEach(p=>{p.z=10});Object.assign(runtime.match.puck,{owner:null,x:25.8,z:0.8,y:0.4,vx:44,vz:0,lockout:1})',
  );
  await expect(page.locator('.goal-call .goal-word')).toHaveText('GOAL');
  expect((await state(page)).score).toEqual([1, 0]);
  const celebrating = await state(page);
  expect(celebrating.phase).toBe('goal');
  await page.waitForTimeout(400);
  const stillLive = await state(page);
  expect(stillLive.phase).toBe('goal');
  expect(
    stillLive.skaters.some(
      (p: { x: number; z: number }, i: number) =>
        Math.abs(p.x - celebrating.skaters[i].x) > 0.04 ||
        Math.abs(p.z - celebrating.skaters[i].z) > 0.04,
    ),
  ).toBe(true);
  for (let period = 1; period <= 3; period++) {
    await changeState(page, "runtime.match.phase='playing';runtime.match.clock=0.01");
    if (period < 3) {
      await expect(page.getByRole('heading', { name: 'Intermission' })).toBeVisible();
      await page.getByRole('button', { name: `Start period ${period + 1}` }).click();
      expect((await state(page)).period).toBe(period + 1);
    } else {
      await expect(page.getByRole('heading', { name: 'You win' })).toBeVisible();
    }
  }
  await page.getByRole('button', { name: 'Rematch' }).click();
  const s = await state(page);
  expect(s.score).toEqual([0, 0]);
  expect(s.period).toBe(1);
  expect(s.clock).toBe(300);
});
test('desktop and narrow layouts keep primary actions visible', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'artifacts/menu.png' });
  await page.getByRole('button', { name: 'Play Now', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/teams.png' });
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Play game', exact: true }).click();
  await page.waitForTimeout(4200);
  await page.screenshot({ path: 'artifacts/game.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForTimeout(1500);
  expect(await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')).toBe(true);
  await page.getByRole('button', { name: 'Play Now', exact: true }).click();
  const ready = page.getByRole('button', { name: 'Ready', exact: true });
  await ready.scrollIntoViewIfNeeded();
  await expect(ready).toBeVisible();
  expect(await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')).toBe(true);
  const prompts = await page.locator('.prompts').boundingBox();
  expect(prompts!.y + prompts!.height).toBeLessThanOrEqual(844);
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Test controller' }).click();
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
  await page.getByRole('button', { name: 'Close controller test' }).click();
  await expect(page.getByRole('button', { name: 'Test controller' })).toHaveAccessibleDescription(
    'Connected',
  );
});

test('3-on-3 and shootout can be selected from the menu', async ({ page }) => {
  await page.goto('/');
  await play(page, '3 on 3');
  await expect(live(page)).toBeVisible({ timeout: 30000 });
  const three = await state(page);
  expect(three.mode).toBe('threeOnThree');
  expect(three.clock).toBeGreaterThan(170);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit to Menu' }).click();
  await play(page, 'Shootout');
  await expect(live(page)).toBeVisible({ timeout: 5000 });
  const shootout = await state(page);
  expect(shootout.mode).toBe('shootout');
  expect(shootout.phase).toBe('playing');
  expect(shootout.puck.owner).toBe(shootout.sides[shootout.myTeam].controlled);
});

test('free skate starts on open ice, keeps saves live, and resets after a goal', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Free Skate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Select Team' })).toBeVisible();
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Play game', exact: true }).click();
  await expect(live(page)).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.bug-clock')).toHaveText('Free Skate');
  const opened = await state(page);
  expect(opened.mode).toBe('freeSkate');
  expect(opened.phase).toBe('playing');
  expect(opened.puck.owner).toBe(opened.sides[opened.myTeam].controlled);
  await changeState(
    page,
    'const s=runtime.match; const g=s.skaters.find(p=>p.role==="G"&&p.team!==runtime.myTeam); Object.assign(g,{x:25,z:0}); Object.assign(s.puck,{owner:null,x:24.1,z:0.1,y:0.4,vx:30,vz:0,shot:true,lockout:0})',
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
  await expect(page.locator('.goal-call .goal-word')).toHaveText('GOAL');
  await expect(live(page)).toBeVisible({ timeout: 5000 });
  expect((await state(page)).puck.owner).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Test controller' }).click();
  await expect(page.getByText(/Controller access is blocked/)).toBeVisible();
  await page.getByRole('button', { name: 'Close controller test' }).click();
  await page.keyboard.press('Escape');
  await play(page);
  await expect(live(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a keyboard flick drives a backcheck toward your own end and dislodges the carrier', async ({
  page,
}) => {
  await start(page);
  await changeState(
    page,
    `
    const s=runtime.match;
    s.mode='oneOnOne'; s.sides[0].controlled=0; s.hitstop=0; s.hits=[0,0]; s.phase='playing';
    Object.assign(s.skaters[0], {x:2,z:5,vx:-8,vz:0,angle:-Math.PI/2,cooldown:0,downTimer:0,stumbleTimer:0,checkTimer:0,checkLanded:false});
    Object.assign(s.skaters[6], {x:-0.5,z:5,vx:-5,vz:0,angle:-Math.PI/2,cooldown:10,stumbleTimer:1,downTimer:0,hitImmunity:0});
    Object.assign(s.puck, {owner:6,x:-1.5,z:5,vx:-5,vz:0,shot:false});
  `,
  );
  await page.keyboard.down('KeyS');
  await page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await state(page)).hits[0]).toBe(1);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('KeyS');
  const s = await state(page);
  expect(s.skaters[0].vx).toBeLessThan(0);
  expect(s.skaters[6].downTimer + s.skaters[6].stumbleTimer).toBeGreaterThan(0);
  expect(s.puck.owner).not.toBe(6);
});

test('feel tuner changes live physics, shows a readout, and resets', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Backquote');
  await expect(page.getByRole('heading', { name: 'How it feels' })).toBeVisible();
  await expect(page.getByText(/Build to top speed/)).toBeVisible();
  await expect(page.getByText('Speed', { exact: true })).toBeVisible();
  await page.getByRole('slider', { name: 'Cruise speed' }).fill('14');
  expect(await page.evaluate('window.__BENCHED__.PHYSICS.maxSpeed')).toBe(14);
  await expect(page.getByText(/changed from shipped/)).toBeVisible();
  await page.getByRole('tab', { name: 'Hitting' }).click();
  await expect(page.getByText(/Throw a loaded shoulder/)).toBeVisible();
  await page.getByRole('button', { name: 'Reset all' }).click();
  expect(await page.evaluate('window.__BENCHED__.PHYSICS.maxSpeed')).toBe(9.6);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'How it feels' })).toHaveCount(0);
});

test('shows a bottom locator when you trail the play off-camera', async ({ page }) => {
  await start(page);
  await expect(page.locator('.player-locator')).toBeHidden();
  await changeState(
    page,
    'const s=runtime.match,c=s.sides[runtime.myTeam].controlled,p=s.skaters[c]; s.puck.x=24; s.puck.z=0; s.puck.owner=6; s.skaters.forEach(q=>{if(q.id!==c){q.x=22;q.z=(q.id-6)*1.4}}); p.x=-18; p.z=0; p.vx=0; p.vz=0',
  );
  await expect(page.locator('.player-locator')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.player-locator small')).toHaveText('YOU');
});
test('a goal rolls a skippable replay, and pause opens a scrubbable instant replay', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  await page.waitForTimeout(2000);
  // The same swept goal the engine tests use, with the goalies pulled so nothing saves it.
  await changeState(
    page,
    `const s = runtime.match;
     for (const p of s.skaters) if (p.role === 'G') { p.x = 0; p.z = p.team ? -10 : 10; }
     Object.assign(s.puck, { owner: null, x: 25.8, z: 0.8, y: 0.4, vx: 44, vz: 0, vy: 0, lockout: 1 })`,
  );
  await expect(page.locator('.goal-call')).toBeVisible();
  const goalReplay = page.getByRole('region', { name: 'Goal replay' });
  await expect(goalReplay).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.replay-bug')).toContainText('REPLAY');
  await page.getByRole('button', { name: /Skip replay/ }).click();
  await expect(goalReplay).toHaveCount(0);
  await expect(page.locator('.faceoff')).toBeVisible();
  const s = await state(page);
  expect(s.score[0] + s.score[1]).toBe(1);

  await expect(page.locator('.fps-counter')).toHaveText(/^\d+ FPS$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Instant Replay' }).click();
  const deck = page.getByRole('region', { name: 'Replay controls' });
  await expect(deck).toBeVisible();
  const replay = (path: string) => page.evaluate(`window.__BENCHED__.runtime.replay.${path}`);
  // Opens held: nothing moves until play.
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
  const time = (await replay('time')) as number;
  await page.waitForTimeout(300);
  expect(await replay('time')).toBe(time);
  await page.getByRole('button', { name: 'Back one frame' }).click();
  expect(await replay('time')).toBeLessThan(time);
  await page.getByRole('button', { name: 'Free cam' }).click();
  await expect(page.getByRole('button', { name: 'Free cam' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const distance = (await replay('camera.distance')) as number;
  await page.mouse.move(700, 300);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => replay('camera.distance')).toBeGreaterThan(distance);
  await page.keyboard.press('Escape');
  await expect(deck).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Game paused' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('two pads take a bench each and drive their own skater', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      pads: { connected: boolean; index: number; axes: number[] }[];
    };
    w.pads = [0, 1].map((index) => ({
      connected: true,
      index,
      id: 'Xbox Wireless Controller (test)',
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    }));
    Object.defineProperty(navigator, 'getGamepads', { value: () => w.pads });
  });
  await page.goto('/');
  // Each seat must claim a different pad rather than both grabbing the first one.
  await expect
    .poll(() =>
      page.evaluate(
        'JSON.stringify([runtime.controller.status.connected, runtime.controllerTwo.status.connected])'.replace(
          /runtime/g,
          'window.__BENCHED__.runtime',
        ),
      ),
    )
    .toBe('[true,true]');

  await page.getByRole('button', { name: '2 Players', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Select Teams' })).toBeVisible();
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Play game', exact: true }).click();
  await expect(live(page)).toBeVisible({ timeout: 30000 });

  const started = await state(page);
  expect(started.sides.map((side: { human: boolean }) => side.human)).toEqual([true, true]);
  // Two cards on the ice, one per bench.
  await expect(page.locator('.player-card')).toHaveCount(2);

  await changeState(
    page,
    `const s=runtime.match; s.phase='playing'; s.countdown=0; s.puck.owner=null;
     s.skaters.forEach(p=>{p.cooldown=0;p.vx=0;p.vz=0});
     s.skaters[s.sides[0].controlled].x=-6; s.skaters[s.sides[1].controlled].x=6;`,
  );
  // Opposite sticks: each bench should travel its own way, not share one input.
  await page.evaluate('window.pads[0].axes[0]=1; window.pads[1].axes[0]=-1');
  await page.waitForTimeout(600);
  await page.evaluate('window.pads[0].axes[0]=0; window.pads[1].axes[0]=0');
  const moved = await state(page);
  // Compare the velocity vectors rather than one axis: the camera decides which way screen
  // left runs on the ice, and both seats map through the same one.
  const drift = (team: number) => moved.skaters[moved.sides[team].controlled];
  const [a, b] = [drift(0), drift(1)];
  expect(Math.hypot(a.vx, a.vz)).toBeGreaterThan(1);
  expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(1);
  expect(a.vx * b.vx + a.vz * b.vz).toBeLessThan(0);
});

test('two-player waits for a second pad and says why', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { pad: { connected: boolean } };
    w.pad = {
      connected: true,
      index: 0,
      id: 'Xbox Wireless Controller (test)',
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [w.pad] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '2 Players', exact: true }).click();
  // One pad is seat one's. Seat two must not quietly share it.
  await expect
    .poll(() => page.evaluate('window.__BENCHED__.runtime.controllerTwo.status.connected'))
    .toBe(false);
  await expect(page.getByRole('button', { name: /Connect P2 controller/ })).toBeVisible();
  await expect(page.getByText(/Press a button on the second controller/)).toBeVisible();
  // And the match cannot start on one pad.
  await page.getByRole('button', { name: /Connect P2 controller/ }).click({ force: true });
  await expect(page.getByRole('heading', { name: 'Select Teams' })).toBeVisible();
});
