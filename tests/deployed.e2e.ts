import { test, expect } from '@playwright/test';

/**
 * A smoke test for a deploy, rather than part of the normal run: build, `vite preview`, then
 * point this at it to check the shipped bundle really reaches the room server it was built for.
 *
 *   npm run build && npx vite preview --port 4173
 *   E2E_BASE_URL=http://localhost:4173 npx playwright test tests/deployed.e2e.ts
 *
 * It drives the screens only. `window.__BENCHED__` is a development convenience and is not in a
 * production bundle, which is the point of checking one.
 */
test.skip(!process.env.E2E_BASE_URL, 'point E2E_BASE_URL at a preview build');

test('the production build reaches the deployed rooms', async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto('/');
  await a.getByRole('button', { name: 'Online', exact: true }).click();
  await a.getByRole('button', { name: /Create game/ }).click();
  await expect(a.getByRole('heading', { name: 'Game Lobby' })).toBeVisible({ timeout: 25000 });
  const code = (await a.locator('.room-code strong').textContent())!.trim();
  console.log('ROOM', code);
  await expect(a.getByText('Waiting for a player')).toBeVisible();
  await b.goto(`/?join=${code}`);
  await expect(b.getByRole('heading', { name: 'Game Lobby' })).toBeVisible({ timeout: 25000 });
  // Both ends now show two seats rather than one and a spinner.
  await expect(a.locator('.seat').filter({ hasNotText: 'Waiting' })).toHaveCount(2, {
    timeout: 20000,
  });
  await expect(b.locator('.seat').filter({ hasNotText: 'Waiting' })).toHaveCount(2, {
    timeout: 20000,
  });
  await a.getByRole('button', { name: /^Ready/ }).click();
  await b.getByRole('button', { name: /^Ready/ }).click();
  await a.getByRole('button', { name: /Drop the puck/ }).click();
  await expect(a.locator('.hud[data-phase="playing"]')).toBeVisible({ timeout: 30000 });
  await expect(b.locator('.hud[data-phase="playing"]')).toBeVisible({ timeout: 30000 });
  await a.close();
  await b.close();
});
