// Live motion review: npm run dev, then node scripts/animation-review.mjs.
// Produces a video, representative frames, rig measurements and a Blender-readable pose library.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.env.OUT ?? 'artifacts/animation-review');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1100, height: 850 },
  recordVideo: { dir: out, size: { width: 1100, height: 850 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const clips = [
  ['stance', 1],
  ['stride', 2],
  ['backward', 2],
  ['crossover', 2],
  ['stop', 1.5],
  ['handling', 2],
  ['toe-drag', 1.6],
  ['slap-shot', 1.6],
  ['wrist-shot', 1.4],
  ['pass', 1.4],
  ['check', 1.4],
  ['through-legs', 1.4],
  ['goalie', 1.5],
  ['goalie-low-save', 1.4],
  ['goalie-glove-save', 1.4],
].filter(([name]) => process.argv.length <= 2 || process.argv.slice(2).includes(name));
try {
  await page.goto('http://localhost:5173');
  await page.waitForFunction(() => window.__HCKY__);
  await page.evaluate(() => window.__HCKY__.beginGame(0));
  await page.locator('.hud[data-phase="playing"]').waitFor();
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: '.hud,.controls,.feel-hud { opacity: 0 !important; }' });
  const library = [];
  for (const [name, duration] of clips) {
    const result = await page.evaluate(
      async ({ name, duration }) => {
        const { reviewSkaters } = await import('/src/scene/animationReview.ts');
        const { stickTip, shootPuck, passPuck } = await import('/src/game/engine.ts');
        const { PHYSICS, PUCK } = await import('/src/game/config.ts');
        const { sampleDeke } = await import('/src/game/dekes.ts');
        const { SHOT_DOWNSWING, GOALIE_SAVE_TIME } = await import('/src/game/actionTiming.ts');
        const { runtime } = window.__HCKY__;
        const s = runtime.match;
        const id = name.startsWith('goalie') ? s.skaters.findIndex((p) => p.role === 'G') : 0;
        s.controlled = id;
        s.hitstop = 1e9;
        s.skaters.forEach((p, i) => {
          p.x = 20 + i;
          p.z = 8;
        });
        const p = s.skaters[id];
        Object.assign(p, {
          x: 0,
          z: 0,
          angle: 0,
          vx: 0,
          vz: 0,
          skateDrive: 0,
          stride: 0,
          edgeLean: 0,
          dekeKind: null,
          dekeTimer: 0,
          dekeDir: 1,
          downTimer: 0,
          stumbleTimer: 0,
          diveTimer: 0,
          checkTimer: 0,
          blockTimer: 0,
          liftTimer: 0,
          shotTimer: 0,
          pendingShot: null,
          saveTimer: 0,
          saveSide: 0,
          saveHeight: 0,
          shotStyle: 'wrist',
          shotDuration: 0.34,
          shotSide: 0.58,
          shotReach: 1.05,
          stickSide: 0.58,
          stickReach: 1.05,
        });
        runtime.settings.beginner = false;
        let label = document.getElementById('animation-review-label');
        if (!label) {
          label = document.createElement('div');
          label.id = 'animation-review-label';
          label.style.cssText =
            'position:fixed;left:30px;top:30px;z-index:10000;color:white;background:#0b1529;padding:12px 20px;font:20px sans-serif;border-radius:8px';
          document.body.appendChild(label);
        }
        label.textContent = name;
        const samples = [];
        const start = performance.now();
        let previous = -1;
        let released = null;
        while ((performance.now() - start) / 1000 < duration) {
          const t = (performance.now() - start) / 1000,
            u = Math.min(1, t / duration);
          s.shotCharge = 0;
          s.puck.owner = id;
          p.stride = t * 7.4;
          if (['stride', 'crossover', 'backward'].includes(name)) {
            p.vz = name === 'backward' ? -4 : 7;
            p.skateDrive = 0.8;
            p.edgeLean = name === 'crossover' ? 0.85 : 0;
          }
          if (name === 'stop') {
            p.vx = 7 * (1 - u);
            p.vz = 1.5 * (1 - u);
            p.edgeLean = -0.8 * (1 - u);
          }
          if (name === 'handling') p.stickSide = 0.1 + 0.8 * Math.sin(t * Math.PI);
          if (name === 'toe-drag') {
            p.stickSide = 0.58 - 0.45 * Math.sin(Math.PI * u);
            p.stickReach = 1.05 - 0.9 * Math.sin(Math.PI * u);
          }
          if (name.includes('shot') || name === 'pass') {
            p.angle = Math.PI / 2;
            const slap = name === 'slap-shot',
              pass = name === 'pass';
            const releaseAt = 0.55 + (slap ? SHOT_DOWNSWING : 0);
            s.shotCharge = slap && t < 0.55 ? Math.min(1, t / 0.4) : 0;
            p.pendingShot =
              slap && t >= 0.55 && t < releaseAt
                ? { timer: releaseAt - t, load: 1, power: 1, aim: 0, height: 0.5, tick: s.tick }
                : null;
            p.shotStyle = slap ? 'slap' : pass ? 'pass' : 'wrist';
            p.shotDuration = pass ? 0.28 : 0.34;
            p.shotTimer = t >= releaseAt ? Math.max(0, p.shotDuration - (t - releaseAt)) : 0;
            if (t >= releaseAt) s.puck.owner = null;
          }
          if (name.startsWith('goalie')) {
            s.puck.owner = null;
            if (name !== 'goalie') {
              p.saveTimer = t >= 0.2 ? Math.max(0, GOALIE_SAVE_TIME - (t - 0.2)) : 0;
              p.saveHeight = name === 'goalie-low-save' ? 0.1 : 1.25;
              p.saveSide = 0.7;
            }
          }
          if (name === 'check') {
            p.checkTimer = Math.max(0, 0.46 - Math.max(0, t - 0.2));
            s.puck.owner = null;
          }
          if (name === 'through-legs') {
            const phase = Math.min(1, u * 1.5);
            p.dekeKind = 'throughLegs';
            p.dekeTimer = phase * 0.56;
            const deke = sampleDeke('throughLegs', phase, 1);
            p.stickSide = deke.side;
            p.stickReach = deke.reach;
          }
          const tip = stickTip(p);
          s.puck.x = tip.x;
          s.puck.z = tip.z;
          s.puck.y = 0.031;
          if (name.includes('shot') || name === 'pass') {
            const releaseAt = 0.55 + (name === 'slap-shot' ? SHOT_DOWNSWING : 0);
            if (t >= releaseAt) {
              if (!released) {
                s.puck.owner = id;
                if (name === 'pass') passPuck(s, p, 1, 0);
                else shootPuck(s, p, name === 'slap-shot' ? 1 : 0.35, 0, 0.45);
                released = { at: t, puck: { ...s.puck } };
                s.controlled = id;
              }
              const elapsed = t - released.at;
              const travel =
                PHYSICS.puckDrag > 1e-6
                  ? (1 - Math.exp(-PHYSICS.puckDrag * elapsed)) / PHYSICS.puckDrag
                  : elapsed;
              s.puck.x = released.puck.x + released.puck.vx * travel;
              s.puck.z = released.puck.z + released.puck.vz * travel;
              s.puck.y = Math.max(
                PUCK.restY,
                released.puck.y + released.puck.vy * elapsed - 4.9 * elapsed * elapsed,
              );
            }
          }
          window.__CAMERA__ = { position: [3.1, 1.85, 3.8], target: [0, 0.95, 0.2], fov: 35 };
          // Wait until the renderer has consumed this sample.
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          const entry = reviewSkaters.get(id);
          if (!entry) continue;
          const { rig, stick } = entry;
          const bucket = Math.floor(t * 30);
          if (bucket !== previous) {
            previous = bucket;
            const v = rig.root.position.clone(),
              q = rig.root.quaternion.clone();
            const a = stick.shaft.localToWorld(v.clone().set(0, -0.5, 0));
            const b = stick.shaft.localToWorld(v.clone().set(0, 0.5, 0));
            const axis = b.clone().sub(a);
            const hands = ['L', 'R'].map((side) => {
              const hand = rig.bones[`hand${side}`];
              hand.getWorldQuaternion(q);
              const palm = hand
                .getWorldPosition(v)
                .clone()
                .add(v.clone().set(0, 0.068, 0.03).applyQuaternion(q));
              const along = palm.clone().sub(a).dot(axis) / axis.lengthSq();
              return palm.distanceTo(a.clone().addScaledVector(axis, along));
            });
            samples.push({
              time: t,
              shaftLength: a.distanceTo(b),
              hands,
              bones: Object.fromEntries(
                [
                  ...Object.entries(rig.bones),
                  ...Object.values(rig.fingers)
                    .flat()
                    .map((f) => [f.bone.name, f.bone]),
                ].map(([key, bone]) => [
                  key,
                  {
                    name: bone.name,
                    position: bone.getWorldPosition(v).toArray(),
                    quaternion: bone.getWorldQuaternion(q).toArray(),
                  },
                ]),
              ),
            });
          }
        }
        return { name, duration, modelScale: reviewSkaters.get(id).rig.scale, samples };
      },
      { name, duration },
    );
    if (!result.samples.length) throw new Error(`No rendered samples for ${name}`);
    for (const sample of result.samples) {
      const expected = name.startsWith('goalie') ? 1.48 : 1.42;
      if (!Number.isFinite(sample.shaftLength) || Math.abs(sample.shaftLength - expected) > 1e-5)
        throw new Error(`Shaft length changed in ${name}`);
      for (const bone of Object.values(sample.bones))
        if (![...bone.position, ...bone.quaternion].every(Number.isFinite))
          throw new Error(`Invalid bone transform in ${name}`);
    }
    library.push(result);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(
      name,
      'frames:',
      result.samples.length,
      'max hand distance:',
      Math.max(...result.samples.flatMap((s) => s.hands)).toFixed(3),
    );
  }
  writeFileSync(`${out}/poses.json`, JSON.stringify(library));
  writeFileSync(
    `${out}/report.json`,
    JSON.stringify(
      {
        errors,
        clips: library.map((c) => ({
          name: c.name,
          samples: c.samples.length,
          maxPalmDistance: [0, 1].map((i) => Math.max(...c.samples.map((s) => s.hands[i]))),
          shaftError: Math.max(
            ...c.samples.map((s) =>
              Math.abs(s.shaftLength - (c.name.startsWith('goalie') ? 1.48 : 1.42)),
            ),
          ),
        })),
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await context.close();
  await page.video().saveAs(`${out}/motion-review.webm`);
  await browser.close();
}
console.log('Review saved to', out);
