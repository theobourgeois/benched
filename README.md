# BENCHED

A playable, controller-first 3D hockey prototype with a close, end-to-end arena camera. Pick any two NHL teams, with real rosters, logos and colors, and play a local exhibition against the computer: five skaters and a goalie per side, three real-time five-minute periods, intermissions, alternating ends, and a final score. Tied games end as draws.

## Run

Requires Node.js 22.12+ (tested with Node 26) and npm.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Choose a mode from the main menu, pick your club and side, ready up, and choose **Play game**. For a production build:

```sh
npm run build
npm run preview
```

Deploy `dist/` to any static host with HTTPS. Localhost is suitable for development. The Gamepad API needs a secure context and an active page; a plain HTTP LAN address may not expose controllers.

## Two players

**2 Players** on the main menu puts somebody on the other bench. Each seat claims its own
controller: seat one takes the first pad and the keyboard, seat two takes a pad seat one is not
holding. Both seats map their stick through the same camera, because there is one screen, so up
is up for whoever is holding one.

A browser hides a controller until it has seen a press from that exact one, so a second pad that
is plugged in but silent will not appear. Press a face button on it. **Settings → Test
controller** has a tab per seat with a lit dot for each, which is the quickest way to tell which
pads the browser can actually see.

## Online

**Online** opens a room for two. Create a game and you get a four-character code and an invite
link; whoever opens the link lands straight in the lobby. Both players ready up and the host
drops the puck: confirm readies you and, for the host, starts once both are ready; back takes
you back to not ready, and out of the room after that. Exhibition, 3-on-3, 1-on-1 and shootout
are playable online; free skate is practice and stays local.

One browser runs the simulation and the other draws what it is told, so there is no second
simulation to disagree with the first. The host has a small latency advantage, which is the
trade for never having to reconcile two versions of a match. The guest draws a few hundredths
of a second behind the newest thing it has heard, blended between snapshots, so the match moves
every frame rather than every packet. There is no pause online — the other person is still
playing — so the pause button asks whether you mean to leave.

Play traffic goes straight between the two browsers when it can: the host offers a WebRTC data
channel through the room, and once it opens the room drops out of the play. Two networks that
cannot reach each other directly fall back to the room relaying. The FPS counter shows the round
trip and which of the two roads is in use.

Rooms are a Cloudflare Worker (`workers/room.ts`) backed by a Durable Object. It holds who is in
the room and relays bytes between them; it never simulates hockey. The room socket is kept
warm with a ping every twenty seconds, and a socket that drops reconnects to the same seat: the
room holds it for ten seconds before telling the other person you left, so a match survives a
proxy closing an idle line.

```sh
npm run rooms          # rooms on localhost:8787, for development
npm run rooms:deploy   # deploy them to your own Cloudflare account
```

`VITE_ROOM_HOST` points the game at a room server: `.env.development` uses the local one and
`.env.production` the deployed one. Set it to your own worker if you deploy under another name.

## Deploying

The game and the rooms are hosted separately. The split dates from when the skater model was a
53 MB FBX, over Cloudflare's 25 MiB per-file limit for static hosting; it is a 3 MB GLB now, so
nothing stops both from living on one Cloudflare origin if that is ever simpler.

- **The game** goes to GitHub Pages. Pushing `main` builds it and publishes it — see
  `.github/workflows/pages.yml`. A project page is served from a subdirectory, so the workflow
  passes `--base=/<repo>/`.
- **The rooms** go to Cloudflare with `npm run rooms:deploy`.

After a deploy, `tests/deployed.e2e.ts` checks that the shipped bundle really reaches the room
server it was built for:

```sh
npm run build && npx vite preview --port 4173
E2E_BASE_URL=http://localhost:4173 npx playwright test tests/deployed.e2e.ts
```

Both halves need HTTPS: the Gamepad API refuses to expose controllers without a secure context,
which is also why a plain `http://` LAN address is no good for testing across two machines.

## Skill stick

Connect an Xbox controller by USB or Bluetooth and press any button after opening the page. Open **Settings → Test controller** for live stick/button indicators. Pairing in macOS alone does not mean the browser has exposed the device; keep the game tab active and press A. The game accepts standard-mapped controllers and recognizable four-axis Xbox layouts with missing mapping labels. The test panel explains blocked, unavailable, insecure, and unrecognized inputs; unsupported raw layouts are not guessed.

| Action                         | Xbox                                                | Keyboard                                |
| ------------------------------ | --------------------------------------------------- | --------------------------------------- |
| Skate / aim shot & pass        | Left stick                                          | WASD                                    |
| Forehand / backhand deke       | Right stick left / right                            | Left / right arrows                     |
| One-touch dekes                | Hold LB + left stick                                | Hold R + WASD                           |
| Jump / through-the-legs        | Hold RB + right stick up / down                     | Hold E + up / down arrow                |
| Windmill / spin-o-rama         | Tap RB with RS left/right / tap LT                  | Tap E while ←/→ / tap Ctrl              |
| Wrist shot                     | Flick right stick up                                | Up arrow                                |
| Slap shot                      | Hold right stick down, flick up                     | Hold down arrow, then up arrow          |
| Shoot high                     | Left stick up, or hold LB                           | W, or hold R                            |
| Toe drag                       | RS click + pull RS down; or roll RS sideways → down | Hold C + down arrow                     |
| Aim shot                       | Left stick (any direction)                          | WASD                                    |
| Pass / switch on defense       | Hold RT to aim, release to send                     | Hold Space to aim, release to send      |
| Poke check                     | RB                                                  | E                                       |
| Body check, without possession | Flick right stick up; pull down first to load       | Up arrow; hold down arrow first to load |
| Hustle                         | Hold left-stick click                               | Shift                                   |
| Backskate                      | Hold LT                                             | Hold Left Ctrl                          |
| Switch skater                  | A                                                   | Q                                       |
| Goalie: shuffle                | Left stick                                          | WASD                                    |
| Goalie: glove / blocker / pad  | Flick right stick that way (up-left, up-right, out) | Up + left / right arrow; left / right   |
| Goalie: butterfly              | Flick right stick down; hold LB to stay down        | Down arrow; hold R to stay down         |
| Goalie: play a covered puck    | Hold RT to aim a pass, or flick RS up to shoot      | Hold Space, or up arrow                 |
| Pause / resume                 | Menu                                                | Escape                                  |

Every menu runs on the controller: the D-pad or left stick moves (hold to repeat), A selects, B goes back, and Menu resumes from pause. Keyboard mirrors it with arrows or WASD, Enter and Escape. On the matchup screen, left/right picks your side, up/down changes your club, Y picks a random one, and X cycles CPU difficulty. A readies you up; while ready, up/down swaps between your home and away sweaters and the opponent wears the other set. A again drops the puck; B backs out of ready. In settings, left/right changes a focused selector. Button prompts along the bottom of menus and the in-game FPS counter can be turned off in settings.

Passing is aimed: hold RT (Space) and point the left stick, then release to send. Aim-assist helps if a teammate is in that lane; otherwise the puck dumps into space. Shooting aims the same way: point the left stick at the corner you want, then flick the right stick to shoot. Stick up is top shelf, down is ice, left and right are the posts, and diagonals are the corners. Beginner mode (on by default) shows a small dot in the goal and a pass-lane arrow; turn it off in settings. Tape-to-tape passes switch control to the receiver. Collecting the puck switches control to its carrier. The arena camera follows the puck and controlled skater lengthwise, with your attacking end always at the top. Skating, passing, and shot aim are screen-relative in every period. The wide full-rink camera remains available in settings; its shot aim uses left-stick up/down for posts and left/right for height. The stick and puck move together through forehand/backhand reaches and toe drags. Hold LB (R) and cut with the left stick for NHL-style one-touch dekes — side cuts, a burst through, or a pull-in — and use RB with the skill stick for a jump deke, through-the-legs, or a windmill. Tap LT (Ctrl) for a spin-o-rama; hold it to backskate. Roll the right stick from either side toward the bottom, or hold right-stick click and pull down, to drag the puck back toward your skates. Flick up to release a wrist shot; a straight pull down without the deke modifier still winds up a slap shot. Hold LB (R on keyboard) to lock top shelf. Height comes from the left stick. Contact only becomes a hit when you check: without the puck, flick the right stick up (up arrow) to commit your body, or pull it down first to load a bigger lunge. Aim the body check with your left-stick skating direction; the right-stick up flick commits the shoulder, including when skating back toward your own net. With the left stick released, the check follows your momentum or facing. Pulling down only loads the check, and a direct down-to-up flick releases it. A check has a short committed path with a little aim assistance at launch and shoulder reach in front of the body. It cannot home onto a dodging opponent or turn with the left stick after commitment. A flick thrown a hair early is held and fires as soon as your body is free. Its power is NHL 14 style relative momentum: the speed you bring _into_ the other body along the contact, scaled by how square you are, plus a small commitment bonus. It lands as a shove, a stagger that knocks the puck loose, or a knockdown that freezes the frame for a beat and sends the victim sliding. A carrier who has squared up to you absorbs a little; one mid-deke or already off balance takes more. Run a breakaway down from behind and connect and the puck comes loose; do it with a loaded check at full hustle and they go down. The counterplay is the deke: a check that finds nothing but air is a whiff. Miss, and you are overextended for a beat: no puck, no second swing. Skating into someone without checking is a bump that can rock them but never puts them down, unless two sprinters meet head-on; a carrier who skates into a defender who has squared up gets stood up and loses the puck. Every hit drains stamina, downed players cannot skate or play the puck until they recover, and recovery protection prevents repeated hits. Computer defenders hold a gap, pivot into forward pursuit when beaten, and check when they have closing speed and an opportunity. Computer carriers release hustle and cut around a defender in their lane; they look for passing lanes that are clear of defenders. An attacking-direction indicator follows end changes. Hustle earns a modest higher top speed once your stride opens up on a straight path; it does not accelerate the first strides faster. It consumes stamina, which recovers when released.

The game pauses on focus loss, tab hiding, or a connected controller disconnecting. Sound starts after the Play gesture. Rumble is optional and depends on device/browser support. Keyboard control remains available. There are no touch controls; use a controller or keyboard on smaller screens.

## Architecture

React 19 + TypeScript + Vite + Three.js + React Three Fiber. The simulation runs at a fixed 120 Hz and the React HUD publishes at about 12 Hz. Scene objects read mutable simulation state each render frame. The rink and players are memoized; crowds, spray, and puck trails use instanced geometry.

```text
src/
  game/            The simulation: pure TypeScript, tested without a browser
    types.ts       Match, player, puck, input, event and settings contracts
    config.ts      Rink dimensions, physics constants, match rules
    modes.ts       Exhibition, 3-on-3, 1-on-1, shootout and free skate: rules and who is on the ice
    difficulty.ts  CPU skill tiers
    clubs.ts       Leagues, clubs, starting lineups and uniforms built from league snapshots
    math.ts        Vectors, angular smoothing, rounded-board collision
    skating.ts     Shared acceleration, edge forces, stops, pivots and committed movement
    dekes.ts       One-touch and special deke clips
    cellys.ts      Goal celebrations
    ai.ts          Puck pursuit, support lanes, defensive shape, goalie positioning and puck play
    goalie.ts      Goalie model: reading shots, committed saves, coverage, rebounds and covers
    engine.ts      Possession, shots, collisions, periods, scoring; stepMatch
    replay.ts      Ring buffer of recent play, and replay transport
  app/
    store.ts       The runtime object (match, controllers, audio, session, settings) and React subscriptions
    loop.ts        The game loop: pads → fixed-step simulation → events → publish
    online.ts      Opening, joining and leaving a room; starting the agreed match
  net/
    protocol.ts    Lobby messages and the binary tags, shared with the room worker
    session.ts     One side of an online match: room socket, direct link, input and snapshot flow
    snapshot.ts    Binary snapshot of a moment of a match, and posing a match from one
    view.ts        Guest-side interpolation a little behind the newest snapshot
    peer.ts        WebRTC data channel between the two browsers
    wire.ts        Field encoders
  input/
    controller.ts  Gamepad + keyboard, dead zones, tap buffering, shot gestures
    frames.ts      Folding presses across frames so each is delivered once
    coordinates.ts Screen-relative sticks to rink-relative intent
    menuNavigation.ts  Menu input layers: pad and keyboard presses go to the screen on top
  audio/
    sound.ts       Recorded puck strikes and speed-responsive skate loop, synthesized arena signals
    goalTrack.ts   The goal soundtrack and its beat
  scene/
    Arena.tsx      Procedural rink, rounded boards, glass, stands, crowds, nets
    Player.tsx     Places each skater, plants the stick and wraps both hands around the shaft
    skaterPose.ts  Skating posture: stride cycle with planted leg IK, hip sway, torso lean, knockdown ragdoll
    skaterModel.ts Runtime skeleton for the skater model, team jersey recolor, crest/number decals, limb IK, hand grip
    stick.ts       Curved, taped blade geometry and stick placement from grip and puck position
    ragdoll.ts     Rapier ragdolls for knockdowns
    camera.ts, replayCamera.ts  Broadcast, wide and replay framing
    Effects.tsx    Pooled ice spray and impact particles
    textures.ts    Canvas-generated ice graphics, board ads and jersey numbers
    GameScene.tsx  The canvas, lighting, puck renderer, camera rig
  ui/
    kit.tsx        Shared pieces: menu items, option rows, button glyphs and prompts
    Menu.tsx       Main menu and screen routing
    TeamSelect.tsx Matchup: side, club, ready and jersey
    Online.tsx     Create or join a room, and the lobby
    Settings.tsx   Settings and the live controller test
    Hud.tsx        Score bug, player card, calls, pause and results
    Controls.tsx   Xbox and keyboard reference
    ReplayHud.tsx  Goal and instant replay overlays
  dev/             Animation lab and feel tuner; development builds only
  data/leagues/    League snapshots (nhl.json) and their types
  fonts.css        Locally bundled font declarations
  style.css        Responsive UI
workers/
  room.ts          The room: a Durable Object that seats two players and relays bytes
scripts/
  fetch-nhl.ts     Refreshes the NHL snapshot and logos (npm run data:nhl)
  export-skater.mjs  Rebuilds the skater GLB from assets/skater.fbx (npm run model:skater)
  check-imports.mjs  Enforces which folders may import which (npm run lint)
```

`CLAUDE.md` describes how a frame flows through these, and where each kind of change goes.

Gameplay physics is purpose-built. Human and CPU skaters share bounded forward acceleration and lateral edge forces. Velocity determines the skating arc while body facing can pivot independently for backskating. Fast cuts widen the turning circle and spend speed; opposite-stick stops shed momentum before the next push. Hustle adds top-end pace once moving, and dekes share a finite push budget instead of stacking speed boosts. The animation follows actual push effort and edge load, so releasing the stick produces a glide. CPU decisions read the same pre-movement frame, and puck handling advances once per skater. Body collisions sweep the movement path and resolve contacts in time order. A check needs forward shoulder contact and closing momentum; glancing or rear contact cannot consume the committed hit. A dislodged puck keeps its pre-impact momentum instead of inheriting the knockdown impulse. Also rounded rink constraints, skater separation, solid net frames, friction and gravity for the puck, swept goal-line checks, post rebounds, body deflections, goalie saves and puck pickup. Physics parameters live in `game/config.ts`, locomotion in `game/skating.ts`, and team tactics in `game/ai.ts`. The pure engine can be tested without WebGL or a browser.

See [the skating and contact playtest notes](docs/skating-playtest.md) for reproduced problems, before/after measurements, and validation scope.

Skaters share the rigged Mixamo character `public/models/skater.glb`, exported from `assets/skater.fbx` with `npm run model:skater` (see [model credits](public/models/CREDITS.txt)). Hockey motion tracks drive its existing skeleton, with calibrated limb IK, a fixed-length stick, fitted gloves/skate runners, and physics ragdolls. See the [animation rework and review workflow](docs/animation-rework.md). The rink, crowd, textures and particles are generated in code. NHL rosters, ratings and logos are a local snapshot in `src/data/leagues` and `public/logos`, refreshed with `npm run data:nhl`. Puck strikes and skating use locally bundled field recordings; arena signals and impact accents are synthesized. See [sound credits and licenses](public/audio/CREDITS.txt). Barlow fonts are bundled locally under their SIL Open Font Licenses in `public/fonts`. Runtime has no remote asset or font requests.

## Validation

```sh
npm test           # Import layering check, then simulation and controller unit tests
npm run test:e2e  # Chrome browser integration tests
npm run build     # Strict TypeScript + production bundle
npm run format    # Format source, tests, and configuration
```

Browser tests use installed Google Chrome (`channel: 'chrome'` in `playwright.config.ts`). They cover menu/settings and their persistence, NHL team selection, controller-driven menus with held-stick repeat and jersey selection, keyboard skating and shots, pause/help behavior, virtual Xbox input and disconnection, goal presentation, all three periods, rematches, and desktop/narrow layouts. The unit suite covers scoring direction, high/low shot trajectories, posts, boards, saves, stamina, passing, defensive input, carving and pivots, committed checks versus bumps, hits from behind, whiffs, hitstop, knockdowns and recovery, toe-drag gestures, and sustained play. Virtual controller tests do not replace physical hardware playtesting.

For development inspection only, `window.__BENCHED__` exposes the runtime, publish and beginGame. Vite removes this hook from production builds.

## Prototype scope

Local play against AI, two players on one screen, or two players online. No penalties, offside, icing, line changes, overtime, or fighting. You control your goalie in shootouts and whenever they freeze the puck (shuffle, throw a glove, blocker or pad with the right stick, butterfly, poke, then pass or shoot it out); the rest of the time the goalie reads shots itself. Faceoffs use a countdown followed by a race for the loose puck. All players share one sculpted skater, recolored per team with crest and number decals; goalies add pads. Its animation is procedural — skating crouch and stride, arms solved onto the stick, and knockdown recovery — with no motion capture. Settings persist in local storage; the matchup is kept for the session. The physics and AI are an arcade foundation for further playtesting and tuning.

Technical references: [React Three Fiber setup](https://r3f.docs.pmnd.rs/getting-started/installation), [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad), [controller haptics](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad/vibrationActuator).

Controller/browser reference: [Gamepad visibility and interaction](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API). In Arc, use the live test to distinguish a controller that the browser has not exposed from a mapping issue. If Arc exposes no input after focusing the direct localhost page and pressing a face button, compare the same address in Chrome.

Control reference: [EA NHL 22 Skill Stick manual](https://www.ea.com/able/resources/nhl/nhl-22/ps4/text-manual). The deke/pull-back gestures are adapted to this game; the separate LB high-shot modifier is specific to BENCHED.
