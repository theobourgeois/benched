// Rebuilds public/models/skater.glb from assets/skater.fbx.
//
//   npm run dev            (in another terminal)
//   node scripts/export-skater.mjs [--url http://localhost:5173]
//
// The conversion runs in the browser through src/dev/exportSkater.ts, with the FBX loader the
// game was fitted against, so the bones come out exactly as the pose code expects them.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://localhost:5173';
const root = resolve(new URL('..', import.meta.url).pathname);
const source = `${url}/@fs${root}/assets/skater.fbx`;
const target = resolve(root, 'public/models/skater.glb');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url);
await page.waitForFunction('window.__HCKY__?.exportSkater');
const base64 = await page.evaluate(async (fbx) => {
  const buffer = await window.__HCKY__.exportSkater(fbx);
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
}, source);
await browser.close();
const glb = Buffer.from(base64, 'base64');
writeFileSync(target, glb);
console.log(`${target}: ${(glb.length / 1024 / 1024).toFixed(2)} MB`);
