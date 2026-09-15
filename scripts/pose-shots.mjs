// Animation review harness. With `npm run dev` running on :5173, screenshots the controlled skater
// frozen in a set of poses from fixed close-up cameras (via the dev-only window.__CAMERA__ hook).
//   node scripts/pose-shots.mjs            all poses, front/side/back cameras
//   node scripts/pose-shots.mjs stand deke  only poses whose name starts with these
//   CAMS=hands node scripts/pose-shots.mjs  hand close-ups; CAMS=all for every camera
// Output lands in artifacts/pose-shots (override with OUT=dir).
import { chromium } from 'playwright';
const OUT = process.env.OUT ?? 'artifacts/pose-shots';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__BENCHED__);
await page.evaluate(() => window.__BENCHED__.beginGame(0));
await page.locator('.hud[data-phase="playing"]').waitFor({ timeout: 30000 });
await page.evaluate(() => {
  const { runtime } = window.__BENCHED__;
  runtime.settings.beginner = false;
  const s = runtime.match;
  s.controlled = 0;
  s.puck.owner = 0;
  s.hitstop = 1e9;
  s.skaters.forEach((p, i) => {
    p.x = 20 + i;
    p.z = 8;
    p.vx = 0;
    p.vz = 0;
  });
});
const CAMS = {
  front: { position: [2.6, 1.7, 4.2], target: [0, 0.85, 0.2], fov: 40 },
  side: { position: [4.6, 1.3, 0.6], target: [0, 0.85, 0.3], fov: 40 },
  back: { position: [-1.8, 1.8, -3.6], target: [0, 0.8, 0.3], fov: 42 },
  hands: { position: [-1.4, 1.1, 2.2], target: [-0.1, 0.75, 0.4], fov: 32 },
  handsR: { position: [-1.5, 0.9, 1.0], target: [-0.15, 0.8, 0.4], fov: 26 },
  handsL: { position: [1.3, 0.9, 1.9], target: [0.05, 0.62, 0.5], fov: 26 },
  headFront: { position: [0.9, 1.75, 2.2], target: [0, 1.62, 0.2], fov: 22 },
  headSide: { position: [2.4, 1.7, 0.3], target: [0, 1.62, 0.2], fov: 22 },
};
const CAM_SETS = {
  default: ['front', 'side', 'back'],
  hands: ['hands', 'handsR', 'handsL'],
  head: ['headFront', 'headSide'],
};
const POSES = {
  stand: { vx: 0, vz: 0, skateDrive: 0, stride: 0.5, stickSide: 0.58, stickReach: 1.05 },
  glide: { vx: 0, vz: 6, skateDrive: 0, stride: 1.2, stickSide: 0.58, stickReach: 1.05 },
  push0: { vx: 0, vz: 7, skateDrive: 0.85, stride: 0.0, stickSide: 0.58, stickReach: 1.05 },
  push1: { vx: 0, vz: 7, skateDrive: 0.85, stride: 1.57, stickSide: 0.58, stickReach: 1.05 },
  push2: { vx: 0, vz: 7, skateDrive: 0.85, stride: 3.14, stickSide: 0.58, stickReach: 1.05 },
  push3: { vx: 0, vz: 7, skateDrive: 0.85, stride: 4.71, stickSide: 0.58, stickReach: 1.05 },
  sprint: {
    vx: 0,
    vz: 8.5,
    skateDrive: 0.7,
    stride: 1.0,
    stickSide: 0.58,
    stickReach: 1.05,
    noPuck: true,
  },
  sprint2: {
    vx: 0,
    vz: 8.5,
    skateDrive: 0.7,
    stride: 4.1,
    stickSide: 0.58,
    stickReach: 1.05,
    noPuck: true,
  },
  dekeR: {
    vx: 0,
    vz: 6,
    skateDrive: 0.3,
    stride: 1,
    stickSide: -0.7,
    stickReach: 0.8,
    dekeKind: 'stride',
    dekeTimer: 0.16,
    dekeDir: 1,
  },
  dekeL: {
    vx: 0,
    vz: 6,
    skateDrive: 0.3,
    stride: 1,
    stickSide: 1.0,
    stickReach: 0.6,
    dekeKind: 'stride',
    dekeTimer: 0.16,
    dekeDir: -1,
  },
  carveL: {
    vx: 0,
    vz: 7,
    skateDrive: 0.4,
    stride: 2,
    stickSide: 0.58,
    stickReach: 1.05,
    edgeLean: 0.9,
  },
  toedrag: { vx: 0, vz: 4, skateDrive: 0.2, stride: 2, stickSide: 0.2, stickReach: 0.1 },
  windup: {
    vx: 0,
    vz: 3,
    skateDrive: 0.2,
    stride: 2,
    stickSide: 0.7,
    stickReach: 0.9,
    charge: 0.9,
  },
  shot: {
    vx: 0,
    vz: 3,
    skateDrive: 0.2,
    stride: 2,
    stickSide: 0.4,
    stickReach: 1.2,
    shotTimer: 0.25,
  },
  backskate: {
    vx: 0,
    vz: -3.5,
    skateDrive: 0.5,
    stride: 1.5,
    stickSide: 0.58,
    stickReach: 1.05,
    noPuck: true,
  },
  goalie: { goalie: true },
  goalieLow: { goalie: true, saveTimer: 0.56, saveHeight: 0.1, saveSide: 0.7 },
  goalieGlove: { goalie: true, saveTimer: 0.56, saveHeight: 1.3, saveSide: 0.7 },
  limp: { downTimer: 1.3, noPuck: true },
  getup: { downTimer: 0.45, noPuck: true },
  dive: { diveTimer: 0.4, vz: 4, noPuck: true },
  check: { checkTimer: 0.15, vz: 6, skateDrive: 0.5, stride: 2, noPuck: true },
  jump: {
    vx: 0,
    vz: 6,
    skateDrive: 0.3,
    stride: 1,
    stickSide: 0.5,
    stickReach: 0.9,
    dekeKind: 'jump',
    dekeTimer: 0.24,
    dekeDir: 1,
  },
  cyc0: { vz: 7, skateDrive: 0.8, stride: 0.0, stickSide: 0.58, stickReach: 1.05 },
  cyc1: { vz: 7, skateDrive: 0.8, stride: 0.785, stickSide: 0.58, stickReach: 1.05 },
  cyc2: { vz: 7, skateDrive: 0.8, stride: 1.571, stickSide: 0.58, stickReach: 1.05 },
  cyc3: { vz: 7, skateDrive: 0.8, stride: 2.356, stickSide: 0.58, stickReach: 1.05 },
  cyc4: { vz: 7, skateDrive: 0.8, stride: 3.142, stickSide: 0.58, stickReach: 1.05 },
  cyc5: { vz: 7, skateDrive: 0.8, stride: 3.927, stickSide: 0.58, stickReach: 1.05 },
  cyc6: { vz: 7, skateDrive: 0.8, stride: 4.712, stickSide: 0.58, stickReach: 1.05 },
  cyc7: { vz: 7, skateDrive: 0.8, stride: 5.498, stickSide: 0.58, stickReach: 1.05 },
};
for (const [pose, fields] of Object.entries(POSES)) {
  if (only.length && !only.some((o) => pose.startsWith(o))) continue;
  await page.evaluate((fields) => {
    const s = window.__BENCHED__.runtime.match;
    const id = fields.goalie ? s.skaters.findIndex((q) => q.role === 'G') : 0;
    s.controlled = id;
    s.skaters.forEach((q, i) => {
      q.x = 20 + i;
      q.z = 8;
    });
    const p = s.skaters[id];
    p.x = 0;
    p.z = 0;
    p.angle = 0;
    p.edgeLean = 0;
    p.dekeKind = null;
    p.dekeTimer = 0;
    p.dekeDir = 0;
    p.vx = 0;
    p.vz = 0;
    p.skateDrive = 0;
    p.downTimer = 0;
    p.stumbleTimer = 0;
    p.checkTimer = 0;
    p.diveTimer = 0;
    p.shotTimer = 0;
    p.pendingShot = null;
    p.saveTimer = 0;
    p.saveSide = 0;
    p.saveHeight = 0;
    p.fallAngle = 0.6;
    s.shotCharge = fields.charge ?? 0;
    s.puck.owner = fields.noPuck ? null : id;
    if (fields.noPuck) {
      s.puck.x = 15;
      s.puck.z = 5;
    } else {
      s.puck.x = 0.58;
      s.puck.z = 1.05;
    }
    const { noPuck, goalie, charge, ...rest } = fields;
    Object.assign(p, rest);
  }, fields);
  const camSet =
    process.env.CAMS === 'all'
      ? Object.keys(CAMS)
      : (CAM_SETS[process.env.CAMS] ?? CAM_SETS.default);
  for (const cam of camSet) {
    const framing = CAMS[cam];
    await page.evaluate((f) => {
      window.__CAMERA__ = f;
    }, framing);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${pose}-${cam}.png` });
  }
}
console.log('errors', errors);
await browser.close();
