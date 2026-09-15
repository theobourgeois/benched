# Animation lab

A dev-only close-up of one skater. It runs any movement as a clip you can scrub, loop and slow
down. The same clips are available to scripts and agents through `window.__LAB__` and
`scripts/anim-lab.mjs`. Production builds don't include it.

## Opening it

With `npm run dev` running, open **Animation Lab** from the main menu, or go to
`http://localhost:5173/?lab` (`?lab=slap-shot&t=0.62&cam=hands` opens a clip at a frame and
camera). The URL follows what you're looking at, so reloading, or getting a hot update after you
edit pose code, brings you back to the same frame.

- **Clips**: every movement the pose code handles: skating, puck handling, shots, all seven dekes,
  contact and goalie saves. Each clip has a "looks right when" note.
- **Live**: the simulation runs and you skate the skater yourself. The rate buttons slow the whole
  simulation. **Record take** (F8) turns what you did into a clip under _Takes_. Knockdowns are
  physics, so takes don't replay them. Use `scripts/ragdoll-shots.mjs` for falls.
- **Cameras**: Left, Front, Back, Right, Top, Hands, Skates, Head, Orbit (drag to orbit, wheel to
  zoom, shift-drag to change height, double-click to reset), and Game.
- **Overlays**: skeleton (cyan = skater's left, orange = right), stick axis with palm markers (red
  when the palm is off the shaft), skate contact rings (green planted, amber lifted, red through
  the ice), motion trails for the palms, ankles and blade, and a grid.
- **Travel**: the skater covers ground instead of skating in place.
- **Timeline**: angle, distance and 0–1 lanes across the clip. Red bars are issue spans and yellow
  ticks are one-frame pops. Click to jump there.
- **Inspector**: the current frame's joint angles, grip, skate lift, stick, the pose code's own
  intermediate values (`crouch`, `freeHand`, `action.*` and so on) and the skater inputs.
  **Copy frame JSON** and **Copy clip report** put them on the clipboard to paste into a chat.
- **Reference**: load or drop a video or image, for example NHL footage. It sits in a corner or
  over the view, synced to the clip with an offset and a rate. Bundles add a side-by-side
  `sheet-compare.png`.

Keys (Clips mode): Space play/pause, ←/→ step one frame (shift steps ten), `[`/`]` rate, Home
restart, L loop, 1–0 cameras, K/S/C/T/G overlays, P screenshot, V video, B bundle.

## Captures

Everything is saved under `artifacts/anim-lab/` by the dev server (loopback only), and the status
line shows the path.

- **Screenshot**: the view as it is, with a caption of the clip, time, key angles and any issues.
- **Video**: records the screen as `.webm`, with the reference alongside when one is loaded.
- **Capture bundle**: plays the clip once at exactly 60 Hz, one frame per render, so a slow machine
  gives the same result. It writes `<clip>-<stamp>/`:
  - `report.md`: issues with time ranges, pops, value ranges, and a timeline table.
  - `metrics.json`: every frame's joints (skater frame, metres), angles, grip, lift, stick, pose
    internals and inputs.
  - `sheet-<camera>.png`: contact sheets. A red border marks a frame with an issue or a pop.
  - `frames/<camera>-<t>.png`: captioned 480 px frames.

## For agents

```sh
node scripts/anim-lab.mjs --list                        # clip ids and what each should look like
node scripts/anim-lab.mjs slap-shot                     # bundle; prints report.md
node scripts/anim-lab.mjs slap-shot --at 0.6,0.617 --cams side,hands --overlays skeleton,stick
node scripts/anim-lab.mjs all --quiet --strict          # every clip; exit 1 on any issue or pop
```

Loop: run the clip, read `report.md`, look at the flagged frames (`frames/…png` or `--at` those
times with a close camera), edit the pose code, run it again and compare the issue and pop counts.
The numbers show _that_ something is off. Look at the frames before deciding _what_ is wrong.

In a browser session, `window.__LAB__` has `clips()`, `open(id, {camera, travel})`, `seek(t)`
(holds the frame and returns its measurements), `sample()`, `analyze()`, `camera(id)`,
`overlay(id, on)`, `set({loop, travel})`, `screenshot({camera})`, `bundle({frames, times, cameras,
video})`, `record(seconds)`, `state()` and `close()`.

## What the checks mean

Limits are in `LIMITS` in `src/dev/labMetrics.ts`.

- **Hand off the shaft**: palm centre more than 3.5 cm from the shaft axis while that hand should
  be holding (the top hand always; the bottom hand when `freeHand` is under 0.05).
- **Knee or elbow locked**: flexion under 6° or 4°. **Knee over-folded**: over 145°.
- **Wrist folded**: hand more than 55° off the forearm line.
- **Limb stretched**: shoulder-to-wrist or hip-to-ankle longer than the bones, so the IK couldn't
  reach.
- **Skate or blade through the ice**, and **shaft through the body** (the shaft below the top hand
  within 9 cm of the pelvis–neck line).
- **Pop**: a joint's one-frame second difference over 1.6 cm and four times its neighbours. A
  solution flipping or a blend snapping shows up this way even when every single frame looks fine.

A released hand is supposed to be off the shaft (checks, sprints, through-the-legs). `freeHand`
in the inspector says whether the pose meant to let go.

## How it's wired

- `src/dev/labClips.ts`: clips as pure functions of time, plus recorded takes and travel.
- `src/dev/labMetrics.ts`: measurement, checks, analysis and the report.
- `src/dev/lab.ts`: state, the frame driver, captures, bundles and `window.__LAB__`.
- `src/scene/LabScene.tsx`: in the canvas: drives the clip before the players draw, then places the
  camera, draws overlays, renders and captures.
- `src/ui/AnimLab.tsx`: the panels.
- `scripts/labSavePlugin.mjs`: the dev-server save endpoint.
- `Player.tsx` reports its internals through `labHooks`/`labPose` in `scene/animationReview.ts`.
  The simulation freezes with `hitstop` while a clip plays.
