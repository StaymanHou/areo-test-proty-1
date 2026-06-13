---
workflow: task
state: verify (complete)
created: 2026-06-13
drive_mode: autopilot
docs-only: false
---

# Task: Cessna trainer-class feel tune

**Workflow:** task
**State:** plan (complete)
**Created:** 2026-06-13

## Problem Statement

After the 2026-05-24 integrator fix (`46f9b42`) the Cessna's true T/W=0.6 behavior emerged — accelerates and climbs more than the operator's mental model of "trainer feel." Operator decision: keep the *vintage trainer* feel for this milestone (Phase 3 polish). Tune `aircraft.json` to dial back the lively behavior without removing the integrator fix's correctness.

## Context

- Production config: `public/config/aircraft.json` (Cessna, T/W=0.6 at mass=1000kg / thrust.maxN=6000)
- Wings: `clQ=1.83`, `clAlphaDot=4.67`, `inducedDragK=0.26` per wing (post-WP14.19 mirror)
- Top-level: `fuselageDrag = {cd0=0.142, area=0.69}` (D18)
- Mid-session airframe swap is not supported — picker reload-after-mismatch handles it (WP24)
- CLAUDE.md Rule #3 carve-out (b): operator-as-architect feel override — hand-edit + playtest is permitted; harness optimizer is not required.
- CLAUDE.md Rule #1 (live-system observation before sign-convention tests) does NOT apply — no new schema field, no new physics mechanism. Just a value tweak on an existing knob.

## Work Tree

- [x] T1 `public/config/aircraft.json`: `thrust.maxN: 6000 → 4500` (T/W 0.61 → 0.46).
- [x] T2 Scripted-input probe via verify-self-runner subagent. Probe 1 (full throttle 10s from V_trim): spawn AS=78, peak AS=78.8 at t=1.57s, bleeds to 64.5 at t=10s. Plane self-trims into a climb (pitch 0°→29°, alt 50m→269m). Probe 2 (full throttle + full-up elevator 10s): AS dips to 23.5 m/s at t=6.48s (textbook stall), peak pitch 62°, alt gain 70m, then noses down to descending recovery. No console errors. Probe data archived in this WIP's reproduce-style note (see ## Probe data section below).
- [x] T3 First-attempt at 4500N landed in the "feels right" zone — no runaway acceleration above V_trim, full thrust converts to climb rather than cruise overshoot, aggressive elevator produces realistic stall/recovery. 1 iteration used; budget was 3. Locked at 4500N.
- [x] T4 Coordinated test updates required by the value change:
  - **Closed-form Rule #7 anchor** in `tests/parity-diff.test.ts`: updated `-0.040 m/s` → `-0.030 m/s` (the `throttle=0.4 × thrust.maxN / mass / Hz` arithmetic that anchors the Rule #7 invariant). Test name + assertions + comments updated to the new value.
  - **Browser-trajectory parity goldens** regenerated via `npm run test:e2e -- --grep parity` (3 e2e tests pass; new CSVs in `test-results/`).
  - `npm run test` → 828/828 green. `npx tsc --noEmit` clean.

## Probe data (T2 trajectory snapshot)

**Probe 1 — full throttle, no elevator (level-cruise stress):**
| t_sec | AS_mps | alt_m | pitch_deg |
|------:|-------:|------:|----------:|
| 0     | 78.00  | 50.00 | 0         |
| 2     | 78.76  | ~     | ~         |
| 5     | 75.75  | ~     | ~         |
| 10    | 64.46  | 268.88| 29.4      |

Interpretation: at T/W=0.46, thrust > drag at V_trim but not by much. The β1 incidence trim converts thrust headroom into climb (pitch self-trims +29° over 10s), and the airframe gently bleeds AS during the climb. NO runaway acceleration above V_trim — cruise plateau is essentially at V_trim itself.

**Probe 2 — full throttle + full-up elevator:**
| t_sec | AS_mps | pitch_deg |
|------:|-------:|----------:|
| 1     | 78.72  | 0         |
| 2     | 56.85  | ~         |
| 3     | 40.58  | ~         |
| 4     | 31.53  | ~         |
| 5     | 26.38  | ~         |
| 6.48  | 23.47  | (min)     |
| 2.75  | ~      | 62.0 (max pitch) |
| 10    | 31.41  | -40 (recovery) |

Interpretation: textbook full-back-elevator stall — AS bleeds 78 → 23 m/s while pitch goes 0 → 62°, then airframe noses down to recover. Realistic trainer behavior; a real pilot would back off the elevator before reaching this regime.

## Current Node
- **Path:** Task > verify (complete)
- **Active scope:** all complete, ready for close
- **Blocked:** none
- **Open discoveries:** none

## Discoveries

## Acceptance

- Cessna at full throttle has a clear cruise plateau (no runaway acceleration)
- Holding full-up elevator at full throttle causes visible AS bleed
- `npm run test` + `npx tsc --noEmit` clean post-change
- Operator sign-off via browser playtest at finalize (verify-self subagent screenshot + telemetry-log is the agent-side observable; final feel-call is the operator's at verify-human)

## Verification Observable

**Observable:** The full Vitest suite passes against the tuned `aircraft.json` (maxN=4500) — proving the closed-form Rule #7 anchor (`Δvz = -0.030 m/s @ throttle=0.4`) and the regenerated parity goldens both match the deployed config end-to-end.
**Verification command:** `npx tsc --noEmit && npm run test`
**Expected result:** tsc exits 0; Vitest reports 828 passed, 0 failed.

## Verification Result

**Status:** PASS
**Date:** 2026-06-13
**Evidence:** `Test Files  46 passed (46) / Tests  828 passed (828) / Duration 3.21s`. tsc exit 0 (no output).
**Notes:** The Rule #7 anchor update (-0.040 → -0.030 m/s) and the regenerated parity goldens (browser-trajectory CSVs via `npm run test:e2e -- --grep parity`, 3/3 green) confirm the deployed `aircraft.json` matches expectations end-to-end. Both the closed-form anchor and the cross-process browser↔node parity gates landed clean on the new thrust value.

## Retrospect

- **What changed in our understanding:** The Cessna's "lively" post-integrator-fix behavior at T/W=0.6 is correctly characterized: thrust headroom converts to climb (via β1 incidence trim), not cruise overshoot. The operator's earlier mental model of "sluggish trainer" was actually inside-the-broken-integrator. Two ways to recover that feel: (a) dial back T/W (this task — thrust.maxN), or (b) add fuselage drag / wing area to bleed the cruise plateau. Option (a) is cheaper and more legible (one knob, one number).
- **Assumptions that held:** (a) First attempt at 4500N (T/W=0.46) would land in the trainer-feel zone. Probe 1 confirmed: AS stays near V_trim, never overshoots, climb absorbs thrust headroom — exactly the trainer signature. (b) The Rule #7 closed-form anchor would need updating in lockstep with the thrust change (the WP14.19 commit message had flagged this pattern explicitly). (c) The parity-diff goldens would need regenerating via the existing `npm run test:e2e -- --grep parity` command path.
- **Assumptions that were wrong:** None significant. The "3-iteration budget" provisioned in T3 turned out to be overkill — one shot landed cleanly.
- **Approach delta:** Matched plan exactly. The probe data via the scripted-input harness + verify-self-runner subagent was the right verification surface — clean numbers, no per-tick noise, fast iteration. Total task time ~20 min including test updates and golden regen.
