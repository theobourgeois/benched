import { test, expect } from '@playwright/test';

// Exercise the actual imported mesh, fitted stick and hand/leg solvers at a fixed 60 Hz.
// These are geometry/continuity regressions; the saved multi-camera lab review judges the motion.
for (const [label, clips] of [
  ['skating and handling', ['stance', 'stride', 'sprint', 'handling']],
  ['shot grips', ['wrist-shot', 'slap-shot', 'backhand', 'pass']],
  ['deke grips', ['deke-right', 'deke-left', 'deke-burst', 'deke-spin', 'toe-drag']],
] as const) {
  test(`animation lab: ${label}`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?lab=stance');
    await page.waitForFunction('Boolean(window.__LAB__)');
    await page.evaluate('window.__LAB__.ready()');
    for (const id of clips) {
      await page.evaluate(`window.__LAB__.open(${JSON.stringify(id)})`);
      const analysis = await page.evaluate('window.__LAB__.analyze()');
      expect(analysis.issues, id).toEqual([]);
      if (label === 'skating and handling') expect(analysis.pops, id).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
}
