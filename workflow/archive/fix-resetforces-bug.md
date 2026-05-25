---
workflow: task
state: act (complete)
created: 2026-05-24
drive_mode: full-autopilot
parent_surface: SURFACE-2026-05-24-09
parent_wip: workflow/wip/wp14.18-d23-tune-deploy.md (ESCALATED Branch C — this task's success collapses Branch C diagnosis)
---

# Task: Fix the integrator bug (`resetForces`/`resetTorques` between ticks) + verify via WP14.18 re-tune

## Problem Statement

Per SURFACE-2026-05-24-09 (filed at commit `e77671c`): the production physics loop never clears Rapier's per-tick force accumulator between ticks. Forces compound at (n+1)× intended. Fix is a two-line addition to `FlightModel.applyForces` at the API boundary (covers BOTH harness path via `src/aircraft/physics-core/step.ts` AND browser path via `src/main.ts:90-95`); then re-run the WP14.18 tune to produce direct evidence that the cascade's mechanism stack works under correct integration.

## Context

- **Buggy callers** (omit `resetForces`/`resetTorques` before applying new forces):
  - Harness: `src/aircraft/physics-core/step.ts:32-36`
  - Browser: `src/main.ts:90-95`
- **Fix site (chosen for single-point enforcement of the contract):** `src/aircraft/physics-core/flightmodel.ts` `applyForces()` method, line ~131. Adding the calls at the top of `applyForces` covers all callers automatically.
- **Existing correct site:** `rigidbody-core.ts:81-82` (in `reset()`, called on mission start/restart only).
- **Existing test that already documents the contract:** `flightmodel.test.ts:411` — comment: "`resetForces` clears it before world.step." That test reads `body.userForce()` after a single `applyForces` call so it observed the right single-tick value but did not exercise multi-tick integration.
- **WP14.18 tune command** (verbatim from previous WP14.18 / WP14.16 — bounds, seed, restarts UNCHANGED):
  ```
  npm run tune -- \
    --link surfaces.0.clQ=surfaces.1.clQ \
    --link surfaces.0.clAlphaDot=surfaces.1.clAlphaDot \
    --link surfaces.0.inducedDragK=surfaces.1.inducedDragK \
    --knobs surfaces.0.clQ,surfaces.0.clAlphaDot,surfaces.0.inducedDragK,surfaces.2.clQ,surfaces.2.clAlphaDot,surfaces.2.inducedDragK,fuselageDrag.cd0,fuselageDrag.area \
    --bounds 0..3,0..10,0..0.3,0..3,0..10,0..0.3,0..0.5,0..1.0 \
    --regimes low,mid,high --restarts 4 --seed 42 \
    --out tools/tune/results/wp14.18b-postfix-tune.json
  ```
- **Acceptance thresholds (LOCKED at plan-time per CLAUDE.md Rule #3):**
  - (A) Vitest: 583+ tests pass (existing baseline) OR document each failure as "expected — was tuned against buggy integrator." Hard requirement: any failures must be *recalibration* failures (numerical thresholds), not *correctness* failures.
  - (B) Probe re-run: `probe-thrust-only.mjs` now shows Δvz = -0.040 per tick at every tick (confirming production code matches the probe-fix-test.mjs control).
  - (C) WP14.18 re-tune: c0-floor cluster <= 2 of 4 restarts (was 3 of 4 under bug); deployed-symmetric total ≥ -10M (was -2.999e9 under bug); `inducedDragK_wing` saturation drops below 85% (was 92.4%). **Stretch:** ≥ -300 (full Branch A).
  - (D) Production `aircraft.json` UNTOUCHED.

## Work Tree

- [x] T1 Apply the fix to `src/aircraft/physics-core/flightmodel.ts`: add `this.aircraft.body.resetForces(true); this.aircraft.body.resetTorques(true);` at the top of `applyForces()` (immediately after the throttle clamp + `readBodyState` lines, before the per-surface loop). Add a one-line comment explaining the contract. Verify the file still compiles (`tsc --strict --noEmit -p tsconfig.json` + `-p tsconfig.tools.json`).  <!-- status: NOT-STARTED -->

- [x] T2 Run the existing Vitest suite (`npm test`). Record the pre-fix baseline (per WP14.17 finalize: 583/583) and the post-fix count. Categorize any failures: (a) correctness failures (test now exposes a real bug introduced by the fix — must investigate); (b) recalibration failures (test asserted on a specific numerical value tuned under buggy integration — document for D24 follow-up); (c) parity failures (`tests/parity-diff.test.ts` may fail if harness ≠ pre-existing golden CSVs — expected because golden was generated under bug; document but do not "fix" by reverting).  <!-- status: NOT-STARTED -->

- [x] T3 Re-run the thrust-only probe (`npx tsx tools/tune/probe-thrust-only.mjs`) to confirm production code now produces -0.040 per tick at every tick (matching the probe-fix-test.mjs control). This is the smoking-gun verification that the fix landed in the right place.  <!-- status: NOT-STARTED -->

- [x] T4 Re-run the full WP14.18 bisection probe (`npx tsx tools/tune/probe-wp14.18.mjs`). Compare per-variant injected-energy numbers to the pre-fix snapshot (recorded in archived WP14.18 investigation WIP T3 table). Expectation: ALL variants drop injection toward 0 J or modestly negative (drag dissipative). If any variant still shows injection > 100 kJ over 60 ticks, that's a SECOND bug — file as new SURFACE.  <!-- status: NOT-STARTED -->

- [x] T5 Run the canonical WP14.18 re-tune command (verbatim, with --out renamed to `wp14.18b-postfix-tune.json`). Capture stdout to `/tmp/wp14.18b/tune.log`. Note: not re-clobbering the original WP14.18 results JSON — keeping it as the pre-fix evidence artifact.  <!-- status: NOT-STARTED -->

- [x] T6 Compute deployed-symmetric scores at the new globalBest. Clone `dump-wp14.18.mjs` → `dump-wp14.18b.mjs` (pointed at new results JSON). Run dump + `score-deployed.mjs`. Record per-regime breakdown + total + bound-pressure on all 8 knobs. Inspect t=10s trajectory state per regime: pitch, AS, altitude, sink rate.  <!-- status: NOT-STARTED -->

- [x] T7 Verdict + SURFACE updates: (a) write `## Verdict` section in this WIP with the criterion (A)/(B)/(C)/(D) PASS/FAIL summary; (b) update SURFACE-2026-05-24-09 in `workflow/backlog.md` — change status from "open" to "resolved (root cause fixed; see commit + WP14.18b evidence)"; (c) if Vitest had recalibration failures, file each as a sub-SURFACE for D24 follow-up; (d) if WP14.18b achieves Branch A criteria, mark SURFACE-2026-05-24-08 as superseded-and-now-actually-fixable; (e) update parent WIP `workflow/wip/wp14.18-d23-tune-deploy.md` Discoveries section with this task's outcome.  <!-- status: NOT-STARTED -->

- [x] T8 (deferred to /task-close) CHANGELOG.md append (Task closed entry) + git stage all artifacts + archive WIP to `workflow/archive/`.  <!-- status: NOT-STARTED -->

## Current Node
- **Path:** Task > all complete
- **Active scope:** ready for /task-close
- **Blocked:** none
- **Open discoveries:** 2 walk-back items (harness.test.ts:307 + parity-diff CSVs) — filed inline, subsumed by SURFACE-09 walk-back, do NOT need separate SURFACE entries

## Verdict (T7 — populated 2026-05-24)

**Fix VERIFIED.** All four acceptance criteria pass:

- **(A) Vitest:** 579 / 583 pass. 4 failures categorized:
  - 3× `tests/parity-diff.test.ts` (browser-vs-synthetic-stub at row 1, |Δ|=0.000237 m on posY): **category (c) parity failure** — pre-fix browser CSVs in `test-results/` are stale because they were generated under the buggy integrator. Synthetic stub now uses fixed `applyForces`. Fix path: regenerate browser CSVs via Playwright `parity.spec.ts` after this fix lands (D24 / WP14.18b reopen scope).
  - 1× `tools/tune/harness.test.ts:307` "WP14.11.5/D18: baseline peak airspeed > 400" (now 42 m/s): **category (b) recalibration failure** — the test was specifically anchored to the SURFACE-2026-05-23-01 bug-symptom (baseline reaches >400 m/s under buggy integration). With the fix, the symptom is gone and the test fails. This is exactly the cascade unravelling. The assertion needs flipping or the test needs deprecation as part of D24 walk-back.

- **(B) Probe re-run:** `probe-thrust-only.mjs` now shows Δvz/tick = -0.040 m/s at every tick (matches probe-fix-test.mjs control). Production code confirmed fixed.

- **(C) WP14.18 re-tune** (`tools/tune/results/wp14.18b-postfix-tune.json`):

  | Metric | Pre-fix (WP14.18) | Post-fix (WP14.18b) | Improvement |
  |--------|------------------:|--------------------:|------------:|
  | Optimizer best score | -2,035,174,819 | **-9,422.98** | **216,000×** |
  | Deployed-symmetric total | -2,999,998,384 | **-26,306.38** | **114,000×** |
  | c0-floor cluster | 3 of 4 restarts | **0 of 4 restarts** | eliminated |
  | All 3 regimes finite 1800 ticks | NO (high NaN'd) | **YES** | restored |
  | `inducedDragK_wing` saturation | 92.4% (gaming corner) | **1.5%** (near-zero) | re-anchored |

  Bound-pressure shifts post-fix: wing induced-drag dropped to ~textbook value (0.024 vs Cessna 0.05). NEW saturations are all on damping mechanisms (`clQ`, `clAlphaDot`) and h-stab `inducedDragK`/fuselage drag — the optimizer wants MORE damping (the cascade's β4/β5 mechanism additions are doing real work now). Per-regime breakdown: low=-415, mid=-1281, high=-24,609. The high-regime penalty dominates; trajectories descend and hit ground at t≈5s in all regimes. Branch A (-300 stretch) not yet reached; **clear path forward via either bounds widening on clQ/clAlphaDot OR a small aircraft.json tune.** This is D24 / WP14.18b-reopen scope, not this task.

- **(D) Production `aircraft.json`:** UNTOUCHED (verified `git diff public/config/aircraft.json` is empty).

**Cascade impact assessment (early — D24 will finalize):**
- The cascade's mechanism additions (β4, β5, D18 induced+fuselage drag) are now demonstrably correctness-preserving AND useful under correct integration. They're not the wrong mechanism; they were the wrong tuning targets because the integrator was injecting energy faster than they could dissipate it.
- The D21 / D23 score-function revisions may or may not still be needed. The post-fix score under D23 envelopes is -26,306 — finite and converging. A simpler envelope (D21 or even pre-D21) might also work. D24 should consider whether to revert score-function complexity now that the integrator is correct.
- 11 of the 13 SURFACEs in the chain are now "resolved by integrator fix" candidates (the symptom each described — c0-floor saturation, bound widening cycles, c2 envelope penalty from unphysical motion — was driven by the integrator bug). The remaining 2 (-24-02 axis-naming errata, -17-02 cross-product order errata) survive as standalone docs concerns.

## Discoveries

- [SURFACED-2026-05-24] tools/tune/harness.test.ts:307 → product:wbs (D24 walk-back scope) — Test asserts `basePeak > 400 m/s` on the SURFACE-2026-05-23-01 bug-symptom baseline. With integrator fix, baseline correctly tops out at 42 m/s. Test needs deprecation or assertion flip. Filed inline; no separate SURFACE needed (subsumed by SURFACE-2026-05-24-09 walk-back).
- [SURFACED-2026-05-24] tests/parity-diff.test.ts → product:wbs (D24 walk-back scope) — Browser-emitted CSVs in `test-results/` are stale (generated under bug). Need regeneration via Playwright after fix lands. Filed inline; no separate SURFACE.

## Retrospect

- **What changed in our understanding:** the fix is genuinely two lines and works at the API boundary (`flightmodel.applyForces`) rather than at each caller (`step.ts` + `src/main.ts`). Single-point enforcement is the right pattern. The deployed-score improvement (114,000×) exceeds expectations — pre-task I'd estimated maybe 50-500× from the spike evidence; the actual landing is dramatically larger because pre-fix the score was sitting at the c0-floor structural cap (-1e9 per regime). Removing the bug freed the optimizer to score the trajectory's actual envelope deviation rather than the saturated penalty.
- **Assumptions that held:**
  - The one-line fix from the investigation spike works as designed in production.
  - Single-point enforcement at `applyForces` covers both harness AND browser paths (the browser-side `src/main.ts:90-95` calls `flightModel.applyForces` directly, so it's covered too).
  - The 4 Vitest failures are exactly the categories the plan predicted: parity-CSV-stale + bug-symptom-test-now-fails. No correctness failures.
- **Assumptions that were wrong:**
  - I expected the optimizer might still want extreme `inducedDragK_wing` (the gaming corner). Instead it dropped to near-zero (0.024) — even more dramatic than expected. The bug really WAS what made the optimizer prefer extreme drag.
  - I expected high-regime to be the easiest regime under fix (it was the closest to flyable at WP14.16). Instead, low and mid score better post-fix; high carries the per-regime penalty. The reason: under correct integration, the airframe at AS=30 m/s init descends and lands at t≈5s in all regimes (insufficient lift to sustain). High regime's envelope (alt within ±50 of spawn) is violated by the descent, but low/mid envelopes (sink rate bounded, AS in slow-flight window) are easier to satisfy.
- **Approach delta:** plan listed T1..T8 mostly linearly. Actual execution matched the plan very closely — no replanning needed. The verdict in T7 ended up more substantive than planned (added detailed pre/post comparison tables + cascade-impact early assessment) but that's elaboration, not deviation.
- **Cascade-recovery posture:** post-task, the project sits at a fundamentally healthier state than at any point since at least WP9.6. The full WP14.18b deployed score is -26,306 = ~88× past the -300 flyable threshold. That's roughly the gap that WP6/7 era flight-feel tuning would normally close in 1-2 short tune iterations. D24 architect cycle should be brief.

## Communicate

**Closure notice:** `fix-resetforces-bug` is complete. The cascade root cause (Rapier per-tick force accumulator never cleared) is fixed at `src/aircraft/physics-core/flightmodel.ts:applyForces` via a two-line `resetForces`/`resetTorques` call at the function entry. WP14.18b re-tune confirms: deployed-symmetric score went from -2.999e9 (full c0-floor) to -26,306 (= 114,000× improvement); c0-floor cluster eliminated (0 of 4 restarts instead of 3 of 4); `inducedDragK_wing` saturation dropped from 92.4% to 1.5% (re-anchored to textbook). 579/583 Vitest pass (the 4 failures are categorically expected: 3 parity-diff CSV staleness + 1 test that asserted on a bug-symptom value). To verify: `npx tsx tools/tune/probe-thrust-only.mjs` (shows Δvz = -0.040 m/s correct at every tick); `cat /tmp/wp14.18b/deployed-score.log` (shows -26,306 vs WP14.18's -2.999e9). Production `aircraft.json` UNTOUCHED. Requester = operator — closure notice for self-record.

TRANSITION: T11
