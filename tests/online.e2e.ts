import { test, expect, type Page } from '@playwright/test';

/**
 * Two browsers, one match. The host runs the simulation and the guest draws what it is told, so
 * what is being checked here is that intent gets from one machine to the other and that the
 * result comes back looking like the same game.
 */

const state = (page: Page) =>
  page.evaluate(
    'JSON.parse(JSON.stringify({ ...window.__BENCHED__.runtime.match, myTeam: window.__BENCHED__.runtime.myTeam }))',
  );
const net = (page: Page) =>
  page.evaluate(`(() => { const n = window.__BENCHED__.runtime.net;
    return n ? { status: n.status, room: n.room, host: n.isHost, team: n.team, players: n.players.length, direct: n.stats.direct, rtt: n.stats.rtt } : null; })()`);
const live = (page: Page) => page.locator('.hud[data-phase="playing"]');

/** A pad each, so both ends are driven the way a person would. */
async function withPad(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { pad: { axes: number[] } };
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
}

test('two browsers meet in a room, drop the puck, and play one match', async ({ browser }) => {
  test.setTimeout(90_000);
  const hostPage = await (await browser.newContext()).newPage();
  const guestPage = await (await browser.newContext()).newPage();
  await withPad(hostPage);
  await withPad(guestPage);

  // The host opens a room and gets a code to hand out.
  await hostPage.goto('/');
  await hostPage.getByRole('button', { name: 'Online', exact: true }).click();
  await hostPage.getByRole('button', { name: /Create game/ }).click();
  await expect(hostPage.getByRole('heading', { name: 'Game Lobby' })).toBeVisible({
    timeout: 20000,
  });
  const room = (await net(hostPage))!.room;
  expect(room).toMatch(/^[A-Z0-9]{4}$/);

  // The guest follows the invite link rather than retyping anything.
  await guestPage.goto(`/?join=${room}`);
  await expect(guestPage.getByRole('heading', { name: 'Game Lobby' })).toBeVisible({
    timeout: 20000,
  });
  await expect.poll(async () => (await net(hostPage))?.players).toBe(2);

  const hostNet = (await net(hostPage))!,
    guestNet = (await net(guestPage))!;
  // Exactly one host, one bench each.
  expect([hostNet.host, guestNet.host]).toEqual([true, false]);
  expect(hostNet.team).not.toBe(guestNet.team);

  // Both screens show the same two clubs, one each, before anybody has picked.
  for (const page of [hostPage, guestPage]) {
    await expect(page.locator('.seat').filter({ hasText: 'Montréal' })).toHaveCount(1);
    await expect(page.locator('.seat').filter({ hasText: 'Toronto' })).toHaveCount(1);
  }

  // Neither side can start alone.
  await hostPage.getByRole('button', { name: /^Ready/ }).click();
  await expect.poll(async () => (await net(hostPage))?.status).toBe('lobby');
  await guestPage.getByRole('button', { name: /^Ready/ }).click();
  // Back takes a ready player back to not ready; it does not throw them out of the room.
  await expect(guestPage.getByRole('button', { name: /^Not ready/ })).toBeVisible();
  await guestPage.keyboard.press('Escape');
  await expect(guestPage.getByRole('button', { name: /^Ready/ })).toBeVisible();
  expect((await net(guestPage))?.status).toBe('lobby');
  // Confirm while ready and waiting does not undo it.
  await guestPage.keyboard.press('Enter');
  await expect(guestPage.getByRole('button', { name: /^Not ready/ })).toBeVisible();
  await guestPage.keyboard.press('Enter');
  await expect(guestPage.getByRole('button', { name: /^Not ready/ })).toBeVisible();
  await hostPage.getByRole('button', { name: /Drop the puck/ }).click();

  // Both ends land in the same match.
  await expect(live(hostPage)).toBeVisible({ timeout: 30000 });
  await expect(live(guestPage)).toBeVisible({ timeout: 30000 });
  const started = await state(hostPage);
  const guestStarted = await state(guestPage);
  expect(started.sides.map((s: { human: boolean }) => s.human)).toEqual([true, true]);
  expect(guestStarted.mode).toBe(started.mode);
  expect(guestStarted.myTeam).not.toBe(started.myTeam);

  // The two browsers open a line straight between them, and the room drops out of the play.
  await expect.poll(async () => (await net(guestPage))?.direct, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await net(hostPage))?.direct, { timeout: 15000 }).toBe(true);
  // Each end times its own round trip off the other's echo.
  await expect.poll(async () => (await net(guestPage))?.rtt, { timeout: 10000 }).toBeGreaterThan(0);

  // The guest's clock advances, which it can only do off the host's snapshots.
  const firstTick = (await state(guestPage)).tick;
  await expect
    .poll(async () => (await state(guestPage)).tick, { timeout: 15000 })
    .toBeGreaterThan(firstTick + 30);

  // The guest's stick moves the guest's skater, on the host's simulation.
  await hostPage.evaluate(
    `(() => { const s = window.__BENCHED__.runtime.match;
      s.phase='playing'; s.countdown=0; s.puck.owner=null;
      s.skaters.forEach(p=>{p.cooldown=0;p.vx=0;p.vz=0});
      window.__BENCHED__.publish(); })()`,
  );
  const guestTeam = guestStarted.myTeam;
  await guestPage.evaluate('window.pad.axes[1]=-1');
  await guestPage.waitForTimeout(1200);
  await guestPage.evaluate('window.pad.axes[1]=0');

  const onHost = await state(hostPage);
  const skater = onHost.skaters[onHost.sides[guestTeam].controlled];
  expect(Math.hypot(skater.vx, skater.vz)).toBeGreaterThan(1);

  // And the guest sees its own skater where the host put it.
  await expect
    .poll(
      async () => {
        const seen = await state(guestPage);
        const mine = seen.skaters[seen.sides[guestTeam].controlled];
        const truth = (await state(hostPage)).skaters[onHost.sides[guestTeam].controlled];
        return Math.hypot(mine.x - truth.x, mine.z - truth.z);
      },
      { timeout: 10000 },
    )
    .toBeLessThan(2);

  // Leaving tells the other person rather than freezing them, and offers a way out.
  await guestPage.close();
  await expect.poll(async () => (await net(hostPage))?.players, { timeout: 20000 }).toBe(1);
  await expect(hostPage.getByRole('heading', { name: 'Opponent left' })).toBeVisible({
    timeout: 10000,
  });
  await hostPage.getByRole('button', { name: 'Quit to Menu' }).click();
  await expect(hostPage.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  await hostPage.close();
});

test('a room only seats two', async ({ browser }) => {
  test.setTimeout(60_000);
  const pages = await Promise.all(
    [0, 1, 2].map(async () => (await browser.newContext()).newPage()),
  );
  await pages[0].goto('/');
  await pages[0].getByRole('button', { name: 'Online', exact: true }).click();
  await pages[0].getByRole('button', { name: /Create game/ }).click();
  await expect(pages[0].getByRole('heading', { name: 'Game Lobby' })).toBeVisible({
    timeout: 20000,
  });
  const room = (await net(pages[0]))!.room;

  await pages[1].goto(`/?join=${room}`);
  await expect.poll(async () => (await net(pages[1]))?.players, { timeout: 15000 }).toBe(2);

  // A third is told the game is full rather than quietly watching.
  await pages[2].goto(`/?join=${room}`);
  await expect(pages[2].getByText(/already full/)).toBeVisible({ timeout: 15000 });
  for (const page of pages) await page.close();
});

test('a hidden host keeps the match running for the other player', async ({ browser }) => {
  test.setTimeout(90_000);
  const hostPage = await (await browser.newContext()).newPage();
  const guestPage = await (await browser.newContext()).newPage();

  await hostPage.goto('/');
  await hostPage.getByRole('button', { name: 'Online', exact: true }).click();
  await hostPage.getByRole('button', { name: /Create game/ }).click();
  await expect(hostPage.getByRole('heading', { name: 'Game Lobby' })).toBeVisible({
    timeout: 20000,
  });
  const room = (await net(hostPage))!.room;
  await guestPage.goto(`/?join=${room}`);
  await expect.poll(async () => (await net(hostPage))?.players, { timeout: 20000 }).toBe(2);
  await hostPage.getByRole('button', { name: /^Ready/ }).click();
  await guestPage.getByRole('button', { name: /^Ready/ }).click();
  await hostPage.getByRole('button', { name: /Drop the puck/ }).click();
  await expect(live(guestPage)).toBeVisible({ timeout: 30000 });

  // Put the host's tab in the background. Its render loop is now throttled to about 1 Hz.
  await guestPage.bringToFront();
  await hostPage.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);

  // The match must keep moving for the person who is still watching it.
  const before = (await state(guestPage)).tick;
  await guestPage.waitForTimeout(3000);
  const after = (await state(guestPage)).tick;
  // Three seconds of 120 Hz is 360 steps; anything near that beats the ~1 Hz a throttled
  // render loop would manage, and proves the host never paused itself either.
  expect(after - before).toBeGreaterThan(120);
  expect((await state(hostPage)).phase).not.toBe('paused');

  await guestPage.close();
  await hostPage.close();
});

test('a socket that drops mid-match comes back to the same seat', async ({ browser }) => {
  test.setTimeout(90_000);
  const hostPage = await (await browser.newContext()).newPage();
  const guestPage = await (await browser.newContext()).newPage();

  await hostPage.goto('/');
  await hostPage.getByRole('button', { name: 'Online', exact: true }).click();
  await hostPage.getByRole('button', { name: /Create game/ }).click();
  await expect(hostPage.getByRole('heading', { name: 'Game Lobby' })).toBeVisible({
    timeout: 20000,
  });
  const room = (await net(hostPage))!.room;
  await guestPage.goto(`/?join=${room}`);
  await expect.poll(async () => (await net(hostPage))?.players, { timeout: 20000 }).toBe(2);
  await hostPage.getByRole('button', { name: /^Ready/ }).click();
  await guestPage.getByRole('button', { name: /^Ready/ }).click();
  await hostPage.getByRole('button', { name: /Drop the puck/ }).click();
  await expect(live(hostPage)).toBeVisible({ timeout: 30000 });
  await expect(live(guestPage)).toBeVisible({ timeout: 30000 });
  const before = { host: (await net(hostPage))!, guest: (await net(guestPage))! };

  // Each socket drops in turn, the way an idle line closed by a proxy would, and reconnects
  // on its own. The room hands the same seat back; nobody is told anybody left.
  for (const page of [guestPage, hostPage]) {
    await page.evaluate('window.__BENCHED__.runtime.net.socket.reconnect()');
    await expect.poll(async () => (await net(page))?.status, { timeout: 15000 }).toBe('playing');
  }
  await hostPage.waitForTimeout(1500);
  const after = { host: (await net(hostPage))!, guest: (await net(guestPage))! };
  expect([after.host.host, after.guest.host]).toEqual([before.host.host, before.guest.host]);
  expect([after.host.team, after.guest.team]).toEqual([before.host.team, before.guest.team]);
  expect([after.host.players, after.guest.players]).toEqual([2, 2]);
  await expect(hostPage.getByRole('heading', { name: 'Opponent left' })).toHaveCount(0);
  await expect(guestPage.getByRole('heading', { name: 'Opponent left' })).toHaveCount(0);
  await expect(live(hostPage)).toBeVisible();
  await expect(live(guestPage)).toBeVisible();

  // The match carried on through it: the guest's clock is still moving off the host's snapshots.
  const tick = (await state(guestPage)).tick;
  await expect
    .poll(async () => (await state(guestPage)).tick, { timeout: 15000 })
    .toBeGreaterThan(tick + 30);
  await hostPage.close();
  await guestPage.close();
});
