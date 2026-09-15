// Headless animation lab, for agents and quick checks. Needs `npm run dev` on :5173.
//   node scripts/anim-lab.mjs --list                    every clip id with what it should look like
//   node scripts/anim-lab.mjs slap-shot deke-spin       one bundle per clip, report printed to stdout
//   node scripts/anim-lab.mjs all                       every clip
//   node scripts/anim-lab.mjs slap-shot --at 0.5,0.62   frames at these times only
// Options: --cams side,front,hands  --frames 12  --video  --travel  --overlays skeleton,stick,contacts
//          --quiet (print only the summary line)  --strict (exit 1 on any issue or pop)
//          --url http://localhost:5173
// Bundles land in artifacts/anim-lab/<clip>-<stamp>/: report.md, metrics.json, sheet-<cam>.png,
// frames/<cam>-<t>.png. See docs/anim-lab.md.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flags = {},
  clips = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) clips.push(a);
  else if (['--list', '--video', '--travel', '--quiet', '--strict'].includes(a))
    flags[a.slice(2)] = true;
  else flags[a.slice(2)] = args[++i];
}
const url = flags.url ?? 'http://localhost:5173';
const list = (v) => (v ? String(v).split(',').filter(Boolean) : undefined);

try {
  await fetch(url);
} catch {
  console.error(`No dev server at ${url}. Start it with: npm run dev`);
  process.exit(2);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = false;
try {
  await page.goto(`${url}/?lab=${clips[0] && clips[0] !== 'all' ? clips[0] : 'stance'}`);
  await page.waitForFunction(() => window.__LAB__, null, { timeout: 60_000 });
  await page.evaluate(() => window.__LAB__.ready());
  const all = await page.evaluate(() => window.__LAB__.clips());
  if (flags.list || !clips.length) {
    for (const c of all)
      console.log(`${c.id.padEnd(16)} ${c.group.padEnd(8)} ${c.duration.toFixed(2)}s  ${c.look}`);
    if (!clips.length) console.log('\nPass clip ids (or "all") to capture bundles.');
  } else {
    const ids = clips.includes('all') ? all.map((c) => c.id) : clips;
    for (const id of ids) {
      const result = await page.evaluate(
        async ({ id, flags }) => {
          const lab = window.__LAB__;
          await lab.open(id, { travel: Boolean(flags.travel) });
          for (const o of ['skeleton', 'stick', 'contacts', 'trails'])
            lab.overlay(o, (flags.overlays ?? []).includes(o));
          return lab.bundle({
            cameras: flags.cams,
            frames: flags.frames ? Number(flags.frames) : undefined,
            times: flags.at?.map(Number),
            video: Boolean(flags.video),
          });
        },
        {
          id,
          flags: {
            ...flags,
            cams: list(flags.cams),
            at: list(flags.at),
            overlays: list(flags.overlays),
          },
        },
      );
      failed ||= result.issues > 0 || result.pops > 0;
      if (flags.quiet)
        console.log(`${id}: ${result.issues} issues, ${result.pops} pops → ${result.dir}`);
      else console.log(`${result.report}\n→ ${result.dir}\n`);
    }
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
if (flags.strict && failed) process.exit(1);
