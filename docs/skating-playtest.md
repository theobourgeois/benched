# Skating and contact playtest — September 14, 2026

Played the local game in headed Chrome using Playwright keyboard input, inspected rendered screenshots and runtime state, then repeated rush/turnover/defense sequences after the changes. Also used isolated simulation scenarios for repeatable measurements. This was keyboard and virtual Xbox validation; physical controller feel and rumble still need human playtesting.

## Reproduced problems

- Hustle gave a much stronger first stride immediately. A CPU carrier could create separation before a defender had time to react.
- A beaten defenseman still chose backskating (68% of normal top speed). In a sampled breakout with a carrier moving at 9 m/s and a defender four metres behind, the old AI chose backskating with no hustle.
- Skating and check homing steered the same velocity independently, while the contact allowance extended around the entire body. The outcome depended on steering and incidental contacts as well as the approach.
- During backchecking, the up flick aimed toward the attacking end instead of the direction being skated. Pulling down to load also triggered an immediate check; a direct down-to-up transition could then fail to check because the stick magnitude never returned to neutral.
- CPU carriers could advance stick dynamics twice per simulation step. Knockdown impulses also accelerated the loose puck after contact.

## What changed

Locomotion now limits forward push and lateral edge force. Fast turns cost speed, stops preserve a readable braking phase, and facing can pivot without destroying travel momentum. Hustle shares normal first-stride acceleration, adds less top speed, and requires a straight skating path. Deke acceleration has a shared push budget. Striding and edge lean follow the simulation.

Defenders hold a gap until they need to pivot and pursue. Carriers stop hustling into defended lanes, cut around pressure, and avoid blocked outlet passes. Both teams use the same movement engine and AI frame snapshot.

The left stick aims a check; RS up commits it. RS down loads without firing. Limited launch assistance sets the path once. Swept contact must meet the forward shoulder, and contacts resolve in encounter order. A late dodge can produce a real whiff. The puck is freed before the victim receives the hit impulse.

## Repeatable measurements

From rest, carrying the puck on open ice, full forward input, fixed 120 Hz simulation. Speeds are in game metres per second.

| Elapsed | Normal before | Normal after | Hustle before | Hustle after |
| ------- | ------------: | -----------: | ------------: | -----------: |
| 0.25 s  |          3.91 |         3.00 |          4.73 |         3.00 |
| 0.50 s  |          5.91 |         5.94 |          7.16 |         6.00 |
| 1.00 s  |          7.80 |         8.54 |          9.45 |         9.35 |
| 2.00 s  |          8.93 |         9.23 |         10.82 |        10.26 |

The change reduces the instant sprint advantage while keeping ordinary skating responsive after the opening stride. In the same beaten-defender scenario, the revised AI chooses forward pursuit with hustle. An isolated two-second chase with equal initial speeds and hustle reduces a three-metre gap to under 1.8 m without a defender-specific speed bonus.

## Regression coverage

`tests/skating.test.ts` covers acceleration limits, carving, braking, backskating pivots, pursuit, deke speed accumulation, step-rate consistency, committed direction, late dodges, rear brushes, swept contacts and loose-puck momentum. Controller tests cover loading and direct down-to-up release. A Chrome integration test skates toward the defending end and lands a keyboard backcheck on a moving carrier.

Existing shooting, passing, match modes, camera, controller, recovery and browser tests remain part of the validation. Passing these checks establishes mechanical behavior; it does not establish parity with NHL 14's animation, controller response or overall feel.
