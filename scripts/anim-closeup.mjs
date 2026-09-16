// Close-up screenshots of clip frames from an orbit camera, saved by the lab under artifacts/anim-lab/shots.
//   node scripts/anim-closeup.mjs <clip> <t[,t...]> <name> [yaw] [pitch] [distance] [height]
import { chromium } from 'playwright';
const [clip = 'stance', times = '0.5', name = 'shot', yaw = '0.9', pitch = '0.25', distance = '1.5', height = '0.8'] =
  process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`http://localhost:5173/?lab=${clip}`);
await page.waitForFunction(() => window.__LAB__, null, { timeout: 60_000 });
await page.evaluate(() => window.__LAB__.ready());
for (const t of times.split(',').map(Number)) {
  const path = await page.evaluate(
    async ({ clip, t, yaw, pitch, distance, height, name }) => {
      const L = window.__LAB__;
      await L.open(clip, {});
      L.overlay('grid', false);
      L.set({ orbit: { yaw: +yaw, pitch: +pitch, distance: +distance, height: +height } });
      await L.seek(t);
      for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
      return L.screenshot({ camera: 'orbit', name: `${name}-${clip}-${t.toFixed(2)}` });
    },
    { clip, t, yaw, pitch, distance, height, name },
  );
  console.log(path);
}
await browser.close();
