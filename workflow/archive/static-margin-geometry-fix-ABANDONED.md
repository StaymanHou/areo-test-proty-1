---
workflow: feature
state: ABANDONED — escalated to product:arch
created: 2026-05-10
revised: 2026-05-10
closed: 2026-05-10
entry: plan
drive_mode: full-autopilot
surface_ref: SURFACE-2026-05-10-02
---

## Retrospect (closing without ship — code fully reverted)

- **What changed in our understanding:** The "secondary phugoid" framing was an artifact of incomplete diagnosis. The deeper truth is that with identical symmetric-flat-plate curves at zero incidence on all surfaces, this airframe has no level-trim equilibrium. The h-stab at the same AoA as the wings produces a strong unbalanced nose-down moment that nothing in the current model can counter.
- **Assumptions that held:** AoA fix (commit 2bd5119) is correct; the first second of flight IS well-behaved on the clean baseline. The Playwright + telemetry diagnostic loop continues to be excellent.
- **Assumptions that were wrong:**
  - "Geometry tweak (CG/CL offset) is sufficient" — empirically false in both directions (z=-0.5 and z=-1.5 both worse than z=0).
  - "Adding cl_q damping will close it" — empirically false: implemented cleanly, never bounded |pRate|<360°/s at any clQ value attempted (4, 8); always NaN'd within the 5s window.
  - "WP7 mid-retune values might be the contamination" — empirically false: reproduces on the clean WP6 baseline.
  - "Spawning in trim (throttle=0.5 + nose-up pitch) will work" — empirically false: first frame is clean but divergence still by frame 10 because there IS no trim equilibrium to spawn into.
- **Approach delta:** No code shipped. The session's value was diagnostic — characterized the divergence boundary and ruled out four hypotheses. The bug is reclassified from "second-order bug" to "architectural gap" and surfaced back to product:arch with concrete recommendations (per-surface incidence, asymmetric curves, or trim-offset support).

## Closure message
**Feature ABANDONED, no ship:** Static-margin geometry fix for SURFACE-2026-05-10-02 cannot resolve the issue at the feature level — the root cause is architectural (the AeroSurface schema can't express a trimmable airframe). All code attempted has been reverted; tree is clean at 227/227. The SURFACE entry has been rewritten with empirical findings and architectural recommendations. Next move: a product:arch decision on how Phase 1 PoC defines its trim experience (runway spawn vs. airborne trim spawn) and what schema extensions are needed.

---



# Feature: Static-margin + pitch-damping fix (SURFACE-2026-05-10-02)

**Workflow:** feature
**State:** plan (revised — back-loop from P1 verify-self)
**Created:** 2026-05-10
**Revised:** 2026-05-10 (back-loop F23: P1 verify-self refuted "geometry alone" hypothesis)
**Entry:** plan (small/simple → revised after empirical failure)

## Problem Statement

With the AoA sign-convention bug (SURFACE-2026-05-10-01, shipped commit `2bd5119`) corrected, the airframe is now well-behaved for the first ~1 s of flight — but a **secondary divergent oscillation** still flips the aircraft within 2–3 s. The mechanical cause has two contributing factors: (1) **lack of positive static margin** — wings and CG colinear, no aerodynamic-center-ahead-of-CG geometry to damp AoA perturbations; (2) **absent pitch-rate damping** — no `cl_q` term in the AeroSurface model that would produce restoring force proportional to local pitch rate at each surface.

The original plan hypothesized that the geometry tweak alone (wings forward to z=−0.5) would be sufficient — empirical test refuted this. With wings at z=−0.5: max |pRate| over a 5-second telemetry capture was 3680°/s, peak first reached at frame 57 (≈0.95s after spawn). Compared to the pre-fix state (peak ~3000°/s by frame 30+), the offset bought roughly 0.5 seconds of additional stability but did NOT damp the phugoid below the 360°/s threshold.

**[Updated 2026-05-10: P1 back-loop]** — The revised plan tries one more geometry swing (z=−1.5) before pivoting to the more invasive `cl_q` damping path. Phugoid mode in textbook aerodynamics is **weakly damped by static margin alone** — the phugoid is a low-frequency mode coupling speed and altitude, and the dominant damper is actually the drag-rise-with-speed effect, not static margin. The short-period mode (which IS what's flipping here) IS damped by static margin and pitch-rate damping. So the larger offset MAY work, but the textbook fix is `cl_q`. Plan phases are now: (P1) larger forward offset (z=−1.5); (P2) cl_q damping if P1 still fails; (P3) regression-anchor codification.

**Problem-statement re-check (2026-05-10 build re-entry):** Problem statement unchanged — the underlying mechanism (insufficient static margin + absent pitch-rate damping) is what the revised plan already addresses. P1 verify-self only refuted a specific magnitude (z=-0.5 not enough), not the diagnosis.

This is **no longer strictly small/simple** — Phase 2 touches `src/aircraft/aerosurface.ts`, the curve schema, and `computeAeroForce`. But it stays bounded: one new coefficient with a well-defined formula (Δlift = cl_q · q_local · chord/(2·V) · area), one schema addition, one config-default migration for the four surfaces.

## Work Tree

- [ ] Phase 1: Larger forward wing offset (z=-1.5)  <!-- status: NOT-STARTED -->
  **Observable outcomes:**
  - Browser: Playwright navigates to `http://localhost:5173/?debug=true`, waits 5+ s. Across all captured `[tel f=N]` telemetry lines, `|pRate| < 360` on every frame.
  - Browser: Across the same capture, `alt` stays within `[10, 200]` m on every line.
  - Browser: No JS console errors on load.
  - CLI: `npx vitest run` exits 0 with full suite green (the JSON edit doesn't affect test fixtures which use their own `baselineRaw()`).
  - CLI: `npx tsc --noEmit` exits 0.
  - [x] P1.1 Edit `public/config/aircraft.json`: change `wing-left.position.z` from `-0.5` to `-1.5`, change `wing-right.position.z` from `-0.5` to `-1.5`. Leave all other surfaces unchanged.
  - [x] P1.2 Run `npx vitest run` + `npx tsc --noEmit`. (227/227 green, tsc clean.)
  - [x] verify-auto  <!-- JSON.parse valid (wings at z=-1.5); config.test.ts 23/23 pass -->
  - [ ] verify-self  <!-- status: FAILED: WORSE than z=-0.5. Playwright 6s capture: max |pRate|=5585.7°/s at frame 112 (vs 3680 at z=-0.5). Multiple frames exceed 360°/s (f=110: -2765, f=111: -2232, f=112: 5585, f=114: -4729). Pitch and roll flip ±180° at f=112 (tumbling). Altitude bounded [49.88, 99.34]m. No JS errors. Geometry-only path is empirically dead — both swings (z=-0.5 and z=-1.5) fail. Pivot to Phase 2 (cl_q damping). -->
  - [ ] verify-human  <!-- status: NOT-STARTED -->
  - [ ] verify-codify  <!-- status: NOT-STARTED -->

- [ ] Phase 2: Add cl_q pitch-rate damping (entered only if P1 fails)  <!-- status: NOT-STARTED; depends on Phase 1 verify-self result -->
  **Relevance check (before Phase 2):**
  - To be filled at phase entry. If P1 closed the bug, Phase 2 may be SKIPPED entirely and the plan advances directly to Phase 3.
  - If P1 still failed → Phase 2 becomes mandatory and the original `z=-0.5` may be restored or kept at `z=-1.5` depending on what P1 telemetry suggests.
  **Observable outcomes:**
  - Browser: same as Phase 1 — `|pRate| < 360` over 5+ s, `alt` in `[10, 200]`, no JS errors.
  - CLI: `npx vitest run` exits 0. NEW unit test in `src/aircraft/aerosurface.test.ts` asserts that with `cl_q != 0`, a surface moving downward through still air (positive local pitch rate at z>0) experiences additional upward lift proportional to cl_q · q · chord/(2V) · area · ρ.
  - CLI: `npx tsc --noEmit` exits 0.
  - [ ] P2.1 Extend curve schema (`src/aircraft/config.ts`): add optional `clQ` field to `symmetric-flat-plate` curve params (default 0 if absent — backwards-compatible).  <!-- status: NOT-STARTED -->
  - [ ] P2.2 Extend `computeAeroForce` in `src/aircraft/aerosurface.ts`: after the static-AoA lift is computed, add a dynamic-damping term proportional to local pitch rate at the surface application point. Formula: `Δ_lift_dynamic = clQ * q_local * (chord_length/(2*V)) * area * (rho/2) * V²` simplified to `clQ * q_local * chord_length * area * rho * V * 0.5`. `q_local` is the component of body angular velocity perpendicular to both the chord and the normal (i.e., pitch component at the surface position). Apply at the same application point as the static lift.  <!-- status: NOT-STARTED -->
  - [ ] P2.3 Update `aircraft.json` to add `clQ` to each surface's curve block. Suggested starting values: wings clQ=3.0, h-stab clQ=8.0 (h-stab is the primary damper — high cl_q is textbook), v-stab clQ=0.0 (v-stab damps yaw, not pitch).  <!-- status: NOT-STARTED -->
  - [ ] P2.4 Add a unit test in `src/aircraft/aerosurface.test.ts` that constructs a surface with non-zero clQ, applies a pure pitch-rate body state (linvel=0, angvel.x != 0), and asserts the resulting force has the expected sign and magnitude per the formula above.  <!-- status: NOT-STARTED -->
  - [ ] P2.5 Run `npx vitest run` + `npx tsc --noEmit`. Expect some existing tests to need updates if they assert exact lift values at non-zero angular velocity — triage per the codify protocol.  <!-- status: NOT-STARTED -->
  - [ ] verify-auto  <!-- status: NOT-STARTED -->
  - [ ] verify-self  <!-- status: NOT-STARTED -->
  - [ ] verify-human  <!-- status: NOT-STARTED -->
  - [ ] verify-codify  <!-- status: NOT-STARTED -->

- [ ] Phase 3: Regression anchor update  <!-- status: NOT-STARTED; depends on Phase 2 or Phase 1 -->
  **Relevance check (before Phase 3):**
  - To be filled at phase entry.
  **Observable outcomes:**
  - CLI: A NEW test scenario in `src/aircraft/stability.test.ts` codifies whichever fix mechanism actually closed the bug. If P1 closed it: a "with-static-margin" variant. If P2 closed it: an "active pitch damping with cl_q" variant that asserts the per-surface force returned by `computeAeroForce` with non-zero `q_local` includes the dynamic damping term.
  - CLI: Existing `stability.test.ts` Scenario A threshold may be tightened from `< 0.7 rad/s` to a meaningful new value if the corrected production geometry materially affects the in-test fixture (it doesn't — the fixture uses its own `baselineRaw()`). Most likely: existing thresholds untouched; new scenario added.
  - CLI: `npx vitest run` full green.
  - [ ] P3.1 Append regression scenario to `src/aircraft/stability.test.ts`. Comment must reference SURFACE-2026-05-10-02 and identify whether the anchor codifies the static-margin or cl_q fix.  <!-- status: NOT-STARTED -->
  - [ ] P3.2 Run `npx vitest run` and confirm new test passes and all existing tests stay green.  <!-- status: NOT-STARTED -->
  - [ ] verify-auto  <!-- status: NOT-STARTED -->
  - [ ] verify-self  <!-- status: NOT-STARTED -->
  - [ ] verify-human  <!-- status: NOT-STARTED -->
  - [ ] verify-codify  <!-- status: NOT-STARTED -->

## Current Node
- **Path:** Feature > Phase 2 verify-self (FAILED — escalating decision)
- **Active scope:** Phase 2 cl_q implementation built and tested (231/231 unit tests green). Three live verify-self attempts all fail:
  1. cl_q=8 (h-stab), original sign — physics diverges to NaN by frame 17, max |pRate|=1.86e8°/s
  2. cl_q=8 sign-corrected (negate qLocal contribution) — extends to frame 84 before NaN, max |pRate|=3.05e11°/s; first crosses 360 at frame 15
  3. cl_q=4 (sign-corrected, halved) — extends to frame 119 before NaN, max |pRate|=2.85e13°/s; first crosses 360 even earlier
- **Suspected confound:** aircraft.json currently carries WP7 mid-retune values (mass=900, thrust=8000) that were NEVER validated and were left dirty when WP7 was paused. The original WP6/AoA-fix verify-human used mass=1000, thrust=6000 — and reported "first 1 s well-behaved". The current "secondary phugoid" SURFACE-2026-05-10-02 may be partly an artifact of testing on contaminated WP7 values rather than a separate bug.
- **Blocked:** awaiting operator judgment on three paths:
  - (a) REVERT aircraft.json to the validated WP6 baseline (mass=1000, thrust=6000, wings z=0, all clQ=0) and re-verify whether SURFACE-2026-05-10-02 even reproduces on clean baseline — possibly the AoA fix alone was sufficient.
  - (b) Continue cl_q tuning (try clQ=1, clQ=2) and/or add wing clQ.
  - (c) SURFACE-IN escalate to product:arch — AeroSurface model is structurally inadequate; needs more fundamental rework before Phase 1 can ship.
- **Aircraft.json state:** mass=900, thrust=8000 (WP7 mid-retune, dirty), wings z=-0.5, h-stab clQ=4.0, others clQ=0
- **Code state:** AeroSurface + parseCurve + computeAeroForce all extended with clQ; 4 new unit tests; full suite 231/231 green; tsc clean
- **Unvisited:** Phase 3 (regression anchor) — blocked until live verify-self passes
- **Open discoveries:** the WP7 contamination hypothesis (see above) might mean SURFACE-2026-05-10-02 needs re-scoping
- **Blocked:** none
- **Unvisited:** Phase 2 (cl_q damping, conditional), Phase 3 (regression anchor)
- **Open discoveries:** none

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

## Test Triage — canonical public/config/aircraft.json on disk parses with the new schema
Classification: Obsolete test — new feature intentionally supersedes what the test checked
Confidence: high
Evidence: config.test.ts:220 asserts every surface's `curveParams` deep-equals `DEFAULT_FLAT_PLATE_PARAMS`. Phase 2 of SURFACE-2026-05-10-02 fix sets `h-stab.clQ=8.0` in aircraft.json (intentionally non-default — that IS the fix). The remaining 3 surfaces keep clQ=0 (matches default).
Action: relax the assertion to check the static parameters individually but exempt clQ (or assert clQ-per-surface against expected values from the canonical config). Auto-update.

## Back-loop history
- **2026-05-10 P1.verify-self FAILED (BLOCKING):** wings at z=-0.5 produced max |pRate|=3680°/s at frame 57 over 5s/133-frame Playwright capture. Altitude bounded [42.12, 79.65]m, no JS errors. The geometry-alone hypothesis was insufficient. Plan revised: P1 now tries z=-1.5 (cheap one-more-swing); P2 becomes optional pivot to cl_q damping; P3 (formerly P2) becomes the regression anchor.
- **2026-05-10 P1.verify-self FAILED AGAIN (BLOCKING):** wings at z=-1.5 produced max |pRate|=5585.7°/s at frame 112 (WORSE than z=-0.5). Altitude bounded [49.88, 99.34]m, no JS errors. Likely cause: pushing wings too far ahead of CG inverts the static-margin sign (wings dominate; combined aerodynamic center is now ahead of CG; unstable). Geometry-only path is fully refuted in both directions. Phase 2 (cl_q damping) is now MANDATORY — no longer "if P1 fails", it IS the fix.

## Notes
- **Working-tree contamination:** `src/main.ts` carries WP7 telemetry instrumentation. KEEP IT — verify-self uses it. Exclude from any ship commit unless explicitly decided otherwise.
- **Aircraft.json state at plan-revision time:** wings already at z=-0.5 (from the previous P1.1 attempt). P1.1 in this revision edits FROM z=-0.5 TO z=-1.5.
- **Test fixtures:** `src/aircraft/stability.test.ts`, `flightmodel.test.ts`, `tuning.test.ts` carry an internal `baselineRaw()` fixture hardcoding wing positions at `z=0`. NOT affected by the aircraft.json edit. Phase 3 adds a NEW test scenario; existing tests stay as-is.
- **If even Phase 2 fails:** SURFACE-IN escalation to product:arch — the AeroSurface model is structurally inadequate for stable Phase 1 flight, and a full rebuild of the pitch dynamics model is warranted. That's a separate WP, not in scope here.
