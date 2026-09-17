# Working on Benched

Benched is a controller-first 3D hockey game in the browser: React 19, TypeScript, Vite,
three.js through React Three Fiber, and a Cloudflare Durable Object for online rooms. The
README is the player's manual and the deploy guide; this file is the map for changing the code.

## Commands

```sh
npm run dev          # game on localhost:5173
npm run rooms        # room server on localhost:8787 (needed for Online and the online e2e)
npm test             # import layering check + vitest unit tests
npm run test:e2e     # Playwright in Chrome; starts dev + rooms itself
npm run build        # layering check + strict tsc (app and worker) + vite build
npm run lint         # scripts/check-imports.mjs alone
npm run format       # prettier
```

`tests/skating.test.ts` has one long-standing failure ("has a wider carve at speed"): a speed
assertion that sits exactly on its bound. CI reports it but does not gate on it. Everything else
must stay green. Run the unit tests after any change under `src/game/`, and
`npx playwright test tests/game.e2e.ts` after touching the loop, the HUD, or the menus;
`tests/online.e2e.ts` after touching `src/net/`, `src/app/online.ts` or `workers/`.

## Layout and the one rule

```text
src/
  game/    The simulation. Pure TypeScript, no browser, no React, no three. Tested directly.
  data/    League snapshots (nhl.json) and their types.
  input/   Gamepad + keyboard → InputFrame; menu input layers.
  audio/   Web Audio: samples, synthesized signals, the goal soundtrack.
  net/     Wire format, snapshots, guest interpolation, WebRTC link, room and directory sessions.
  scene/   three.js rendering: arena, skater rig and pose, stick, ragdolls, cameras, effects.
  ui/      React screens: menu, matchup, online lobby, settings, HUD, replay overlay.
  app/     Composition: the runtime object, the game loop, the online lifecycle.
  dev/     Development tools: the animation lab and the feel tuner. Never in a production build.
workers/   room.ts and directory.ts, the Durable Objects. Deployed on their own; share only
           net/protocol and game/types.
tests/     *.test.ts are vitest (pure); *.e2e.ts are Playwright.
scripts/   Data refresh, animation review, the import check.
```

**Folders only import downward.** `game/` imports nothing outside itself and `data/`. `net/` may
use `game/` and `input/frames`. `scene/` may use everything except `ui/`. `ui/`, `app/` and
`dev/` may use anything. `scripts/check-imports.mjs` enforces this and runs in `npm test` and
`npm run build`; if a change needs a new edge, change the table there deliberately and say why
in the commit. The reason for the rule: the whole simulation runs in vitest with no browser,
and the room worker compiles with only `src/net/protocol.ts` and `src/game/types.ts` in scope
(`tsconfig.worker.json`).

## How a frame happens

1. `src/app/store.ts` owns `runtime`: the live `match`, which side this client watches
   (`myTeam`), both controllers, the audio engine, the replay recorder, the online session
   (`net`) and `settings`. It is one mutable object; nothing is copied per frame.
2. `src/app/loop.ts` is the game loop. `GameScene` calls `loop.frame(delta)` from R3F's
   `useFrame`. `advance` reads the pads, lets a menu claim them, folds presses into `pending`,
   then steps `stepMatch` at a fixed 120 Hz from an accumulator, records replay frames, drains
   new match events into sound, rumble and camera shake, and finally `publish()`es to React at
   about 12 Hz. Read `advance` top to bottom before changing anything about timing.
3. `src/game/engine.ts` `stepMatch(s, inputs, dt)` advances the match in place. The engine is
   deterministic given its inputs. It never reads the clock, settings, or the DOM.
4. Scene components read `runtime.match` (or `viewMatch()` during a replay) inside their own
   `useFrame` and write to three.js objects directly. They never `setState` per frame.
5. React screens call `useGame()`; it re-renders them when `publish()` fires. Anything that
   mutates `runtime` outside the loop must call `publish()` afterwards or the HUD will not
   notice.

Online: the host runs the loop as above and `net.publish`es a binary snapshot at 60 Hz; the
guest runs no simulation, sends its `InputFrame`s, and `net.view` poses the match a few
hundredths of a second behind the newest snapshot. Match events cross with snapshots, so the
guest hears the whistle when the host does. `src/app/online.ts` is the only file that joins a
`NetSession` to the runtime: every way into a room goes through `connectToRoom`.

## Adding things

**A match rule or constant.** `src/game/config.ts`. `PHYSICS`, `STICK` and `GOALIE` are
mutable on purpose: the dev feel tuner writes into them. Add a `DEFAULT_*` entry if you add a
table. If a number is worth tuning by hand, describe it in `src/dev/feel.ts` too
(`tests/feel.test.ts` checks every entry names a real key).

**A game mode.** Add it to `GameMode` in `src/game/types.ts`; the `never` checks in
`src/game/modes.ts` (`modeInfo`, `isOnIce`) will then fail to compile until you describe it.
Mode-specific behaviour in the engine keys off `modeInfo(s.mode)` flags first and `s.mode`
only where it must. Add a menu entry in `src/ui/Menu.tsx`, and to `ONLINE_MODES` in
`src/net/protocol.ts` if two people can play it.

**A match event** (a whistle, a call, something the HUD or audio reacts to). Extend
`GameEvent` in `src/game/types.ts`, emit it with `emit(s, ...)` in the engine, then handle the
new `type` in `src/audio/sound.ts` `play` and, if it is felt, in `FELT_EVENTS` in
`src/app/loop.ts`. Events are capped at 32 per match and identified by `id`; consumers track
the last id they handled.

**A field on `MatchState`, `SideState`, `Human`, `Skater` or `Puck`.** Decide whether it moves
during a match. If it does, add it to the matching field table in `src/net/snapshot.ts`
(`MATCH`, `SIDE`, `HUMAN`, `SKATER`, `PUCK_FIELDS`) with a kind and a blend, or the guest will
never see it. Enum orders there are the wire format: append, never reorder. If it must survive a replay, check
`src/game/replay.ts` copies it. `tests/snapshot.test.ts` round-trips a stepped match; add an
assertion for the new field.

**A lobby or room message.** Add the variant to `ClientMessage` or `ServerMessage` in
`src/net/protocol.ts`, validate it field by field in `workers/room.ts` (everything from a
browser is untrusted), handle it in `NetSession.receive` in `src/net/session.ts`, and expose a
method on the session for the UI. The worker is deployed separately: after changing the
protocol, run `npm run rooms:deploy`, or production clients will talk to a room that does not
understand them. Play traffic is binary and tagged (`WIRE_INPUT`, `WIRE_SNAPSHOT`); the room
relays it without reading it.

**A setting.** Add it to `Settings` in `src/game/types.ts`, give it a default in
`loadSettings` in `src/app/store.ts`, and a row in `src/ui/Settings.tsx`. Settings persist
under the `benched.settings` localStorage key; unknown saved keys are ignored, so renames are
safe.

**A screen.** A React component under `src/ui/` that mounts `useNav` from
`src/input/menuNavigation.ts` for pad and keyboard presses. The newest mounted layer owns the
input. Confirm goes forward, back goes back; never make one button toggle. Use the pieces in
`src/ui/kit.tsx` (`TitleBar`, `Prompts`, `MenuItem`, `TeamLogo`) and the existing classes in
`src/style.css`. No component libraries. The look is icy, grungy and minimal, and the ice
itself carries no chrome beyond the HUD.

**A sound.** Bundled recordings live in `public/audio` with credits in `CREDITS.txt`;
synthesized signals are in `src/audio/sound.ts` and `goalTrack.ts`. Sound only starts after a
user gesture; `runtime.audio.unlock()` is called from the first press.

**Something that renders.** A component under `src/scene/` with its own `useFrame`. Allocate
vectors and objects once at module scope or in a `useRef`, never inside the frame callback.
Share geometries and materials across skaters where possible. Dev-only visualisation belongs
behind `import.meta.env.DEV` reads of `labHooks` (see `src/scene/animationReview.ts`).

**Public rooms and quick play.** `workers/directory.ts` is one Durable Object (named `main`)
that `Room` reports to over RPC whenever anything changes and on every sweep while public; it
keeps nothing on disk and prunes listings it stops hearing about. Quick play (`quickPlay` in
`src/app/online.ts`) asks it for the oldest open room, or a fresh code to host. A host waits on
the ice: the session sits in `runtime.queue`, not `runtime.net`, and a local match against the
AI runs as a warm-up. When somebody arrives `runtime.found` raises the confirm overlay in the
HUD; the host's yes readies them, the room's `start` moves the session into `runtime.net` and
`beginOnlineMatch` replaces the match. A joiner is an ordinary `connectToRoom` with
`runtime.quickJoin`, auto-ready, waiting for that start. Wire types for the directory live in
`src/net/protocol.ts` (`DirectoryClientMessage`, `DirectoryServerMessage`), and its one
decision, `chooseListing`, is pure and tested in `tests/directory.test.ts`. A new Durable Object
class needs a binding and a migration tag in `wrangler.jsonc`.

## Pitfalls

- The engine mutates in place and the scene reads identity: `runtime.match = createMatch(...)`
  is how a new game starts, and the loop resets its bookkeeping when it sees a new object.
  Do not clone the match to "be safe"; the guest-side snapshot code keeps the same object on
  purpose.
- `noEdges` and `mergeEdges` in `src/input/frames.ts` are how a press is delivered exactly
  once to a 120 Hz simulation. If a button fires twice or not at all, look there and at
  `pending` in the loop before touching the controller.
- Controllers: seat one claims the first pad and the keyboard, seat two takes a pad seat one
  is not holding. A browser hides a pad until it has seen a press. Online, seat two is never
  read as a player.
- A side holds a list of `humans`, one per person, in seat order; an empty list is a CPU side.
  Anything a person's stick carries (windup, aim, pass arrow) goes on `Human`, never `SideState`,
  because two people can share a bench, and online rooms will later seat more than one per team.
  `SideInputs` is a frame per person. When the puck moves control, go through `handOver` in the
  engine and switch through `switchSkater`; they keep the rule that no two people hold one skater.
- Pause is resolved in the loop, not the engine, and does not exist online: the pause button
  asks whether to leave instead (`askToLeave`).
- A queued session (`runtime.queue`) is not an online match. The loop never reads it, so the
  warm-up pauses, replays and ends like any local game; only `runtime.net` makes a match online.
  Anything that leaves the ice for the menu must close the queue (`returnToMenu` does).
- Goal replays are a local overlay over a live match. Online, the guest does not own the clock,
  so it can only close its overlay, never skip the celebration.
- `src/dev/feel.ts` applies saved tweaks from localStorage over the config tables in
  development. If physics feels wrong in dev and right in tests, open the feel tuner (backquote
  during play) and reset.
- The skater is `public/models/skater.glb`, exported from `assets/skater.fbx` by
  `npm run model:skater` with the dev server running. The export goes through three's own FBX
  loader in the browser on purpose: the pose code was fitted to the bone frames that loader
  produces, and a Blender round trip changes them. Do not add assets over 25 MB, and never
  edit the GLB by hand.
- `.wrangler/` is the local room server's state and is ignored. Do not commit it.
- Shell here is zsh: quote globs (`--include='*.ts'`) or they fail as "no matches found".
- Comments explain why, in prose, and there are no default exports. Strict TypeScript with
  `noUnusedLocals`; the build fails on an unused import.

## Reference

- README.md: controls table, online design, deploy, validation scope.
- docs/anim-lab.md: the animation lab and its scripted review (`scripts/anim-lab.mjs`).
- docs/skating-playtest.md, docs/animation-rework.md: design notes behind skating and the rig.
- `window.__BENCHED__` (dev only) exposes `runtime`, `publish`, `beginGame` and the config
  tables; the e2e tests drive the game through it.
