---
workflow: feature
state: archived (complete)
created: 2026-05-11
completed: 2026-05-11
wp: WP9.5
size: XS (actual: XS)
drive_mode: full-autopilot
closes: SURFACE-2026-05-11-05
outcome: shipped — aircraft collider attached; SURFACE-2026-05-11-05 resolved; 246/246 tests green
---

# Feature: WP9.5 — Aircraft collider + terrain impact

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-05-11

## Problem Statement

Closes **SURFACE-2026-05-11-05** (HIGH priority, Phase 1 BLOCKER discovered in WP9 Phase 3). The `Aircraft` constructor at `src/aircraft/rigidbody.ts:84` creates a Rapier `RigidBody` but never attaches a collider. The aircraft body has mass/inertia but no shape, so it passes through the terrain plane's collider (added by WP8) and the integrator state corrupts to NaN once the body is well below terrain in a steep attitude. The Phase 1 exit criterion in `CLAUDE.md` includes "and crashes" — currently impossible since the plane phases through ground.

**Reproduction artifact (in lieu of a fresh `/feature-reproduce` run):** the WP9 archive `workflow/archive/wp9-phase-1-verification.md` documents two reproducible Playwright probes: an aggressive 30s mixed-input session and a gentle 25s session with just one ~0.5s throttle pulse + two ~0.4s roll inputs. Both NaN within ~12s. The same probes serve as the regression-anchor for this WP's verify-self.

**Scope discipline:**
- IN scope: add a Rapier `Collider` to the aircraft `RigidBody` matching the fuselage placeholder geometry. One regression test that would have failed under the WP9 Phase 3 probe.
- OUT of scope: `@playwright/test` adoption (SURFACE-2026-05-09-01 — separately re-targeted; would expand WP9.5 from XS to S+ if folded in). Phugoid damping (SURFACE-2026-05-11-04 — Phase 2 work). Aerosurface colliders (visual wings; not needed for "fly and crash"). Tuning of restitution/friction coefficients beyond Rapier defaults (Phase 3 polish).
- Fuselage placeholder mesh is `BoxGeometry(1, 0.6, 6)` at `rigidbody.ts:18`. Matching collider: `ColliderDesc.cuboid(0.5, 0.3, 3.0)` (half-extents). Single primitive matching the visible fuselage — wings are visual-only.

## Work Tree

- [x] Phase 1: Add aircraft collider + verify terrain impact
  **Observable outcomes:**
  - CLI: `npm test` exits 0; total tests 245/245 (244 existing + 1 new collider-presence regression test).
  - CLI: `npx tsc --noEmit` exits 0.
  - CLI: `npm run build` exits 0.
  - Browser: Playwright navigates to `http://localhost:5173/?debug=true`, dispatches a gentle casual-session input pattern (one 0.5s `ShiftLeft` pulse + two 0.4s roll inputs, same as the WP9 Phase 3 gentle reproduction probe), waits 25s, then reads `window.__aircraft.getState()`. **Verdict:** all telemetry fields finite (no NaN in `position.y`, `airspeed`, `eulerDeg.*`). This is the regression anchor that would have failed under the pre-fix code.
  - Browser: At t=25s after the casual session, `position.y >= -1.0` (aircraft is at-or-above the terrain plane, not tunneling through). The actual resting altitude depends on collision restitution and where the aircraft settles, but it MUST be ≥ -1m to confirm the collider is interacting with terrain.
  - Browser (long-horizon stability): After 30s of no-input free physics from spawn, telemetry remains finite. Tests the descending-glide → impact trajectory completes cleanly.
  - [x] P1.1 Added `ColliderDesc.cuboid(0.5, 0.3, 3.0).setDensity(0)` to the aircraft body in `src/aircraft/rigidbody.ts` (between `createRigidBody` and `buildPlaceholderMesh`). Density=0 keeps `setAdditionalMassProperties` authoritative.
  - [x] P1.2 Added structural regression test in `src/aircraft/rigidbody.test.ts`: "attaches at least one collider to the body so it can interact with terrain" — uses `aircraft.body.numColliders() > 0`.
  - [x] P1.3 `npm test` → **245/245 pass** (244 + 1 new). `npx tsc --noEmit` clean. `npm run build` → 2.8 MB / 988 KB gzipped (unchanged from pre-fix; bundle size is SURFACE-2026-04-19-01, Phase 3 work).
  - [x] verify-auto  <!-- status: scoped `vitest run src/aircraft/rigidbody.test.ts` → 10/10 pass (incl. new collider regression anchor); tsc clean (full-suite tsc green earlier in build) -->
  - [x] verify-self  <!-- status: targeted collider-engagement probe PASS (impact at alt=0.28m, vy=0.30, bouncing to stable resting motion, no NaN). Long-horizon no-input PASS (30s, no NaN). Plan's original regression-anchor probe FAIL — but the failure is at the unrelated SURFACE-2026-05-11-04 phugoid mode (aircraft NaN's at +112m altitude post-fix, not -11m as pre-fix). See Discoveries for details. -->
  - [x] verify-human  <!-- status: SKIPPED — full-autopilot drive mode -->
  - [x] verify-codify  <!-- status: added behavioral integration test ("aircraft body collides with a static ground plane (does not tunnel through)") to rigidbody.test.ts. 246/246 pass (244 prior + 2 new: numColliders structural + ground-collision behavioral). One flake observed in unrelated `flightmodel.test.ts:368` timing assertion, triaged. -->

## Current Node
- **Path:** Feature > feature-finalize
- **Active scope:** Phase 1 fully complete (all 5 verification group nodes `[x]`, parent `[x]`). Ready for finalize.
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** verify-self regression-anchor-probe-selection lesson is a candidate for `/session-store-learning` at reflect time.

## Test Triage — `flightmodel.test.ts: 1000 calls to applyForces complete in under 50 ms`
- **Classification:** Flaky test — failure unrelated to new code; inconsistent across runs
- **Confidence:** high
- **Evidence:** Wall-clock perf assertion at `src/aircraft/flightmodel.test.ts:368` (`elapsed < 50ms`) in a file unmodified by this WP. Failed on run 1, passed on runs 2 + 3 (two consecutive 246/246). The collider change in `rigidbody.ts` is a one-time construction-time `ColliderDesc.cuboid` call; not in the `applyForces` hot path. No plausible mechanism for the new code to affect this timing.
- **Action:** documented as flake; did not modify test. Two consecutive green runs confirm.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

### verify-self log (2026-05-11)

The plan's regression-anchor probe (copied from WP9 Phase 3) was over-broad — it exercised BOTH the tunneling pathology this WP fixes AND the phugoid-divergent pathology (SURFACE-2026-05-11-04) that's explicitly out-of-scope. Running it produced a misleading FAIL signal because the post-fix aircraft is now stable enough to climb to ~110m under the same input, where it hits the divergent phugoid mode and NaN's there instead of tunneling through the ground.

**Resolution:** ran two additional targeted probes that isolate the collider's contract directly.

**Probe A — collider engagement (targeted):** teleported the body to y=3 with vy=-10 (commanded ground impact), 5s observation:
- Result: `anyNaN=false`, `altMin=0.283m`, `collisionDetected=true`. Trajectory: impact at t=0.3 (alt 0.28, vy 0.30 — velocity nearly reversed at ground), then bouncing motion 1.5 → 6.4m with diminishing energy. Final at t=5: alt=6.42m, vy=+0.54, all finite.
- **Verdict:** the collider's contract holds — aircraft impacts terrain, does NOT tunnel through, does NOT NaN. This is the genuine regression-anchor for SURFACE-2026-05-11-05.

**Probe B — long-horizon no-input descending-glide (from subagent run):** 30s no-input, `anyNaN=false`, altitude bounded 56.5–103.7m (phugoid oscillation; never reaches ground because the airframe pumps energy from the bounded baseline). Aircraft stays well above ground; collider unused. PASS for "no regression in the prior working trajectory."

**Probe C — original regression-anchor (informational, FAIL):** the WP9 Phase 3 gentle casual session (ShiftLeft pulse + roll inputs). Pre-fix: NaN at t≈12.5s, last finite alt=-11m (tunneling pathology). Post-fix: NaN at t≈12.5s, last finite alt=+112m (phugoid-divergent-at-altitude pathology). Both NaN at the same wall-clock time but for completely different physical reasons. The collider fix is correct; the test pattern crosses an unrelated defect zone. SURFACE-2026-05-11-04 already has the appropriate Phase 2 anchor — no new SURFACE needed.

## Retrospect

- **What changed in our understanding:** The verify-self regression-anchor methodology matters as much as the fix itself. I copied the WP9 Phase 3 gentle-input probe verbatim as the WP9.5 regression anchor, and that produced a misleading FAIL because the probe crosses two defect zones (tunneling at low altitude / phugoid-divergent at high altitude). The collider fix WAS correct from the first commit, but a casual reader of the initial verify-self output would have concluded "fix didn't work." Targeted probes that isolate the specific contract (here: teleport-to-ground to exercise the collider directly) are how to avoid that.
- **Assumptions that held:** (a) The Rapier collider semantics around `setDensity(0)` — confirmed that the existing `setAdditionalMassProperties` configuration stays authoritative. (b) The fuselage placeholder geometry as the right collider footprint — confirmed (a single cuboid matching the visible fuselage suffices; aerosurface meshes are visual-only). (c) The structural test (`numColliders() > 0`) catches the original SURFACE-2026-05-11-05 mode immediately — confirmed. (d) Memory `feedback_asymmetric_fix_no_op.md` predicted the fix would be no-op above terrain (the previously-working regime) — confirmed: probe B (no-input 30s) showed no behavior change in that regime.
- **Assumptions that were wrong:** I assumed the WP9 Phase 3 gentle-input probe was a clean regression anchor for THIS specific defect. It wasn't — it was an over-broad probe that incidentally exposed SURFACE-2026-05-11-05 because the tunneling pathology dominated pre-fix. Once tunneling was removed, the probe revealed the OTHER pathology (phugoid divergent) hiding behind it.
- **Approach delta:** The plan called for the original casual-session probe as the verify-self target. The actual verification needed three probes (gentle casual session — FAIL on phugoid; teleport-to-ground — PASS on collider engagement; no-input 30s — PASS on no-regression). The final codification test in `rigidbody.test.ts` (an integration-style ground-collision test with controlled timestep) is the right CI artifact — closer to the targeted teleport probe than to the original casual-session probe, on purpose.
- **Lesson worth persisting (candidate for `/session-store-learning`):** "Regression-anchor probes must isolate the specific defect contract; over-broad probes that cross multiple defect zones produce misleading signals post-fix." Practical heuristic: when a fix targets a structural invariant (here: 'body has a collider'), the verify-self probe should ALSO target that invariant directly (here: 'put the body near terrain at low velocity and observe collision'), not a high-level user-flow that happens to cross the invariant. Especially under full-autopilot where I'm interpreting my own probe results without an external sanity check.

## Active-recall checklist (from memory, per `feedback_memory_active_recall.md`)

Before verify-self, confirm:
- **`feedback_verify_self_envelope.md`** — probe ENVELOPE BOUNDARIES, including the long-horizon mixed-input pattern that found SURFACE-2026-05-11-05. The verify-self for this WP MUST include the gentle-25s casual-session probe, not just a no-input trajectory. Otherwise this regression slips back in the same way it slipped in initially.
- **`feedback_asymmetric_fix_no_op.md`** — adding a collider is no-op above terrain (the previously-working regime). Only matters at impact. ✓ correct shape of fix.
- **`feedback_retune_attempt_budget.md`** — N/A here (structural fix, not parameter tune).
