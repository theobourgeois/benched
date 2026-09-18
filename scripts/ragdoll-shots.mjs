// Knockdown ragdoll review. With `npm run dev` running on :5173, knocks a skater down in a few
// scenarios and screenshots the fall over time from a camera that tracks them.
//   node scripts/ragdoll-shots.mjs              every scenario
//   node scripts/ragdoll-shots.mjs boards       only scenarios whose name starts with this
// Output lands in artifacts/ragdoll-shots (override with OUT=dir).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.OUT ?? 'artifacts/ragdoll-shots';
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__HCKY__);
await page.evaluate(() => window.__HCKY__.beginGame(0));
await page.locator('.hud[data-phase="playing"]').waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);

// Victim starts at (x, z) skating at (vx, vz) and is pushed along `push` (radians, 0 = +z).
const SCENARIOS = {
  open: { x: 0, z: 0, vx: 0, vz: 6, push: Math.PI / 2, power: 6 },
  frontal: { x: -6, z: -3, vx: 0, vz: 7, push: Math.PI, power: 7 },
  boards: { x: 4, z: 10.4, vx: 0, vz: 5, push: 0, power: 7 },
};
const TIMES = [0.05, 0.2, 0.4, 0.7, 1.1, 1.6, 2.1];
for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (only.length && !only.some((o) => name.startsWith(o))) continue;
  const victim = await page.evaluate((sc) => {
    const { runtime } = window.__HCKY__;
    runtime.settings.beginner = false;
    const s = runtime.match;
    s.hitstop = 0;
    // The controlled skater is always on the ice; bench skaters aren't drawn.
    const id = s.controlled;
    s.skaters.forEach((q, i) => {
      if (i === id) return;
      q.x = 20 + i * 0.3;
      q.z = -8;
    });
    const p = s.skaters[id];
    s.puck.owner = null;
    s.puck.x = 15;
    s.puck.z = 5;
    p.x = sc.x;
    p.z = sc.z;
    p.angle = Math.atan2(sc.vx, sc.vz);
    p.vx = sc.vx + Math.sin(sc.push) * sc.power;
    p.vz = sc.vz + Math.cos(sc.push) * sc.power;
    p.fallAngle = sc.push;
    p.downTimer = 2.2;
    p.hitImmunity = 2.8;
    p.cooldown = 2.2;
    p.stumbleTimer = 0;
    window.__CAMERA__ = { position: [p.x + 3.2, 1.9, p.z - 3.4], target: [p.x, 0.5, p.z], fov: 42 };
    window.__knockAt = performance.now();
    return id;
  }, sc);
  let t = 0;
  for (const at of TIMES) {
    await page.waitForTimeout((at - t) * 1000);
    t = at;
    await page.evaluate((id) => {
      const p = window.__HCKY__.runtime.match.skaters[id];
      window.__CAMERA__ = {
        position: [p.x + 3.2, 1.9, p.z - 3.4],
        target: [p.x, 0.5, p.z],
        fov: 42,
      };
    }, victim);
    await page.screenshot({ path: `${OUT}/${name}-${String(at.toFixed(2)).replace('.', '_')}.png` });
  }
  // REPLAY=1: open an instant replay and check the fall plays back as it happened live.
  if (process.env.REPLAY) {
    for (const at of [0.4, 1.1]) {
      await page.evaluate(
        async ({ id, at }) => {
          // A fresh import can be a separate module copy, so use the app's own runtime and only
          // borrow the replay module's pure functions.
          const replay = await import('/src/game/replay.ts');
          const { runtime, publish } = window.__HCKY__;
          if (!runtime.replay) {
            runtime.replay = replay.startReplay(
              runtime.match,
              runtime.recorder.snapshot(),
              'instant',
            );
            publish();
            // The live clock keeps running under the replay, so pin the hit's replay time now.
            window.__knockReplay =
              runtime.replay.end - (performance.now() - window.__knockAt) / 1000;
          }
          const r = runtime.replay;
          replay.seekReplay(r, window.__knockReplay + at);
          const p = r.view.skaters[id];
          Object.assign(r.camera, {
            mode: 'free',
            seeded: true,
            focus: { x: p.x, y: 0.5, z: p.z },
            distance: 4.8,
            pitch: 0.35,
            yaw: Math.atan2(3.2, -3.4),
          });
        },
        { id: victim, at },
      );
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${name}-replay-${String(at.toFixed(2)).replace('.', '_')}.png` });
    }
    await page.evaluate(() => {
      const { runtime, publish } = window.__HCKY__;
      runtime.replay = null;
      publish();
    });
  }
  await page.waitForTimeout(800);
}
console.log('errors', errors);
await browser.close();
