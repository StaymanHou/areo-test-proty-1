# Backlog

Surface-notes from workflow runs. Consumed and resolved by higher-level workflows (arch revisions, new WPs, etc.).

## Open

### SURFACE-2026-05-10-02 — Secondary pitch instability after AoA fix: divergent oscillation builds at ~1 s mark (likely phugoid / weak static stability)
- **Source:** feature:build (AoA sign-convention fix Phase 2 verify-self, 2026-05-10)
- **Target level:** product:arch — phase-1 flight model needs a stability mechanism (static margin or pitch damping)
- **Type:** bug — second-order
- **Summary:** With the AoA convention corrected (SURFACE-2026-05-10-01 fixed), the airframe is stable for the first ~1 s of flight (frames 0-15 max |pRate| ≈ 94°/s; previously 1284°/s by frame 9 under the bug). However, a secondary divergent oscillation emerges around frame 16-30 (1.6-3.0 s after spawn) with |pRate| growing back to ±1000-3000°/s by frame 30+. Captured Playwright telemetry shows altitude oscillates 50→61→50→62 m as airspeed cycles 30→14→25→16 m/s — classic phugoid coupling between speed and altitude, with pitch attitude doing the work. Each cycle pumps a bit more pitch rate, eventually saturating into the same kind of divergence the AoA bug produced (but reached more slowly).
- **Diagnosis (preliminary):** the pitch dynamics are now correct in *direction* but lack adequate damping at the trim airspeed. Real aircraft handle this with: (a) positive static margin — CG positioned ahead of the neutral point so AoA perturbations produce restoring couples; or (b) explicit pitch-rate damping derivative (CL_q on the h-stab). The current model has neither tuned: surfaces are placed at z=0 (wings) and z=+3 (h-stab), CG is at body origin, and there's no separate damping coefficient. The phugoid mode is presumably nearly-undamped or weakly-divergent at the 30 m/s trim point.
- **Why it surfaces only now:** under the AoA-sign bug the early-frame divergence was so steep (|pRate| > 1000°/s by frame 9) that nothing got far enough into a flight regime to exercise phugoid behavior. With early-frame stability restored, the slower instability becomes observable.
- **Suggested action:** open a new bug-fix WP. Two viable directions:
  1. **Geometry tweak (cheap test):** move `wing-left/wing-right` slightly forward (z<0 in body frame) so they sit ahead of CG, while keeping h-stab at z=+3. This creates a restoring pitching couple at non-zero AoA. May resolve the issue without architectural change. Quick to try.
  2. **Add explicit pitch damping (more invasive):** extend the AeroSurface model with a `cl_q` term that adds lift proportional to local pitch rate at the surface. This is the textbook fix for short-period damping but requires extending the curve schema in `aircraft.json`.
- **Alternatively** — could be SURFACE-resolved by accepting that "Phase 1 PoC flight" is a tuned-near-trim experience and the phugoid is acceptable if amplitudes stay bounded for the casual-player scenario. Investigate stability margin first; if marginally stable in tuned conditions, defer the architectural fix.
- **Priority:** HIGH — still blocks WP7 Phase E re-tune (the candidate preset cannot be evaluated for "feel" if the airframe diverges in 3 s, even if the divergence is slower than before). Resolving SURFACE-2026-05-10-01 is necessary but not sufficient to unblock WP7.
- **Status:** pending — discovered 2026-05-10

### SURFACE-2026-05-10-01 — AoA sign-convention bug in `computeAngleOfAttack` causes divergent pitch instability — escalates beyond WP7
- **Source:** feature:build (WP7 Phase F → Phase E back-loop → code investigation, 2026-05-10)
- **Target level:** product:arch (F26 pause-and-escalate). Likely needs a dedicated bug-fix WP between current Phase 1 work and WP9 verification.
- **Type:** bug / convention error
- **Summary:** Phase F feel-check exposed a divergent pitch oscillation (~5 Hz, ±2000–4000°/s pitch rate) from spawn with no input. Reverting the WP7 candidate preset in steps did not fix it; even reverting all four surfaces to the WP6 placeholders produced near-identical instability. A standalone diagnostic (gravity off, level body, level airflow, no controls) showed the body developing pitch rate from rest — angvel.x grows from 0 → 1.31 rad/s over 10 physics steps with identity quaternion throughout.
- **Root cause:** the AoA convention in `src/aircraft/aerosurface.ts` `computeAngleOfAttack` (line 217-219) computes `perp = -projected · normal`, which is **sign-inverted** vs. the physics. With this convention, an h-stab moving downward through still air (i.e., body pitching nose-up) sees airflow with +Y component in body frame and is computed to have NEGATIVE AoA → NEGATIVE lift → DOWNWARD force at +z (behind CG) → NOSE-UP moment → positive feedback. Probe confirms: body pitching at +1 rad/s produces a +1561 N·m nose-up moment (should be NEGATIVE/restoring for a stable aircraft). The h-stab is *amplifying* pitch rate rather than damping it. The same bug applies to wings but wing-y position = 0 means the asymmetry is invisible at level flight; the v-stab's small mounting offset (y=+0.5) *triggers* the instability via drag-couple at α=0.
- **Why it wasn't caught:** every existing AoA test passes the buggy convention (e.g. `flightmodel.test.ts:93` "positive-AoA velocity vector produces positive lift" sets `linvel=(0,+5,-30)` — body climbing with level wing — which by physics should produce *negative* lift on a level wing, not positive; the test asserts positive lift, so the test itself is wrong in the same direction as the code). The convention is also documented this way in `CONVENTIONS.md` line 15. Single-step torque tests pass because they only check the sign of the *response to control input*, not the absolute force direction at α=0+.
- **Why it surfaces now:** the divergent oscillation is invisible without a horizon (SURFACE-2026-05-09-02, resolved by WP8) — Phase E "noted but unconfirmable" attitude items in the candidate preset's tuning notes were exactly the failure mode hiding from view.
- **Suggested action:** open a dedicated bug-fix WP (e.g. `WP7.5 — fix AoA sign convention`):
  1. Flip the sign of `perp` in `computeAngleOfAttack` (or equivalently, invert the input-normal convention).
  2. Update CONVENTIONS.md §Coordinates to match.
  3. Audit and update tests in `aerosurface.test.ts` and `flightmodel.test.ts` whose expected values depend on the convention. Specifically `flightmodel.test.ts:93` "positive-AoA velocity vector produces positive lift on the wings" needs both physics and assertion fixed (a level wing climbing should produce NEGATIVE lift, or alternatively use `linvel=(0,-5,-30)` for a descending-flightpath setup which gives genuine positive AoA → positive lift).
  4. Verify the four control-axis torque tests still produce correct sign body motion; flip routing-table signs in `flightmodel.ts` if necessary.
  5. Re-run the gravity-on flight scenario: trim should be a damped pitch oscillation that converges, not divergent.
  6. After the fix lands, return to WP7 Phase E (the candidate preset and notes need re-evaluation against a stable airframe — most of the Phase E "feel survived" assertions were collected against the buggy model).
- **Priority:** HIGH — blocks WP7 Phase F completion and WP9 (Phase 1 verification exit criteria require "the developer flies, crashes, and it feels right"; with this bug the airframe is unflyable and all WP7 tuning was against bad signal).
- **Status:** pending — escalated 2026-05-10

### SURFACE-2026-05-09-05 — Phase 4 verify-self required WP7 trim to fully validate; need a verify-self-friendly trim
- **Source:** feature:build (WP8 Phase 4 verify-self back-loop)
- **Target level:** product:wbs (process; relates to WP9 verification approach)
- **Type:** process / observability gap
- **Summary:** WP8 Phase 4 had two observable outcomes (`horizon-tilt-after-roll`, `tower-parallax-on-approach`) that required sustained level flight to evaluate. Without WP7's tuning preset committed, the default-trim aircraft dives off-screen quickly, breaking continuity for these sustained-frame checks. The skybox-upload fix is verifiable from a single boot screenshot (P4.vs.1 PASS) — but anything requiring "fly for several seconds and observe X" needs a flyable trim.
- **Context:** This confirms the two-way dependency originally noted in SURFACE-2026-05-09-02. WP8's success is partially observable without WP7; WP7's success is partially observable without WP8. Both must land before WP9 can do its "developer takes off, flies, crashes" exit-criteria check.
- **Suggested action:** When `/session-resume`-ing WP7 Phase F, the first action after PF.1 (casual-player nomination) should be to commit the candidate preset block to `public/config/aircraft.json` BEFORE the external feel-check; then re-take WP8's deferred observability outcomes (P4.vs.2 + P4.vs.3) opportunistically during the WP7 feel-check, not as separate verify-self runs.
- **Priority:** medium (load-bearing for the WP7 → WP8 → WP9 chain)
- **Status:** pending

### SURFACE-2026-05-09-03 — `window.__aircraft` debug telemetry hook not implemented
- **Source:** feature:build (WP7 Phase E tuning session)
- **Target level:** product:wbs (likely WP9 Phase 1 verification, paired with SURFACE-2026-05-09-01)
- **Type:** observability gap / tooling
- **Summary:** WP7 Phase E tuning had no programmatic way to read aircraft pitch/altitude/airspeed/bank-angle. The only readouts were the existing lil-gui Controls panel and screenshots (uninformative without a horizon). Future tuning passes (and the proposed Playwright e2e infra in SURFACE-2026-05-09-01) would benefit from a debug-only `window.__aircraft` hook exposing live numeric state.
- **Context:** Mentioned in passing in WP6 retro and SURFACE-2026-05-09-01's "Suggested action" — WP9 already targets this. Phase E surfaces it again as a real (rather than hypothetical) gap.
- **Suggested action:** At WP9 (Phase 1 verification), add a debug-only `window.__aircraft = { body, flightModel, getState: () => ({...}) }` hook in `src/main.ts`'s `if (debug) {...}` block. Use it both for Playwright assertions and for a future tuning-readouts panel in lil-gui.
- **Priority:** low–medium (tracked alongside SURFACE-2026-05-09-01; both wait for WP9 timing)
- **Status:** pending

### SURFACE-2026-05-09-01 — End-to-end browser test infrastructure not configured
- **Source:** feature:verify-codify (WP6 Phase 4)
- **Target level:** product:wbs (likely WP9 Phase 1 verification, or a dedicated tooling WP)
- **Type:** gap / tech-debt
- **Summary:** The project tests via Vitest (unit/integration only). Browser-driven end-to-end verification is performed ad-hoc via Playwright MCP during workflow `verify-self` runs but is not codified into a runnable test suite. The `.playwright-mcp/` directory in the working tree is MCP scratch state, not a configured Playwright test runner.
- **Context:** Phase 4 of WP6 wired flight controls into the dev page. The integration-boundary check at verify-codify wanted to write a "consuming-surface" test, but the codebase has no harness to host it. Live Playwright via MCP served the codification role this iteration. As phases multiply (mission, HUD, combat), one-shot MCP runs won't scale — eventually we want CI-runnable browser tests for at least the critical input-→-motion path.
- **Suggested action:** At WP9 (Phase 1 verification), evaluate adding `@playwright/test` as a dev dep with one CI smoke: load page, dispatch a roll keypress, assert the aircraft body's yaw/pitch/roll changed via a debug-only `window.__aircraft` hook. Keep the suite tiny — single happy-path test per critical input — to avoid the "Playwright tests are flaky" trap.
- **Priority:** low (live verification is sufficient for now; the gap becomes real at Phase 2+)
- **Status:** pending

### SURFACE-2026-04-19-01 — Bundle size: Rapier WASM dominates build
- **Source:** feature:build (WP1 verify-auto)
- **Target level:** product:arch or feature (Phase 3 polish)
- **Type:** perf / tech-debt
- **Summary:** The first production build clocked in at ~2.7 MB unminified / ~978 KB gzipped — above Vite's default 500 KB warning threshold. Dominated by Rapier WASM which is currently bundled inline.
- **Context:** Relates to R1 in research.md (WASM load UX). At 978 KB gzipped, first-load on a mid-range connection is meaningful. WP18 (onboarding) already plans to preload WASM in parallel with splash — this is the mitigation. No action needed before Phase 3.
- **Suggested action:** Leave as-is for Phase 1/2. At Phase 3 WP18/WP21, measure real load time and consider: (a) code-splitting Rapier via dynamic import, (b) loading WASM from `@dimforge/rapier3d-compat`'s external `.wasm` file instead of inlining.
- **Priority:** low (tracked, not urgent)
- **Status:** pending

## Resolved

### SURFACE-2026-05-09-04 — Three.js CubeTexture data-upload contract is non-obvious
- **Source:** feature:build (WP8 Phase 4 verify-self back-loop)
- **Resolution:** Resolved-with-test in WP8 Phase 4 back-loop. Codified by `skybox.test.ts: cube texture face entries are DataTexture instances` and `scene-composition.test.ts: skybox has the data-texture upload-path contract intact`. Lesson for future procedural-cubemap WPs (likely WP20 visual polish): pass `DataTexture` instances to `new CubeTexture(...)`, not the raw `.image` records. Three's `uploadCubeTexture` (three.module.js:12411) inspects `image[0].isDataTexture` to choose the upload branch; the wrong branch throws `texSubImage2D` and corrupts WebGL state.
- **Status:** resolved 2026-05-09

### SURFACE-2026-05-09-02 — No-horizon viewport blocks visual confirmation of attitude
- **Source:** feature:build (WP7 Phase E tuning session)
- **Resolution:** Resolved by WP8 (2026-05-09). Viewport now renders gradient skybox + textured ground + runway + tower; horizon line plainly visible. Verified at the WP8 Phase 4 boot screenshot. Unblocks WP7 Phase F (external casual-player feel-check).
- **Status:** resolved 2026-05-09

### SURFACE-2026-04-19-02 — Destructive-scaffold near-miss
- **Source:** feature:build (WP1 Phase 1)
- **Resolution:** Recovery complete via conversation transcript at the time. Lesson captured in user's auto-memory (`feedback_pre_scaffold_checklist.md`, `feedback_read_cli_flags.md`) and global CLAUDE.md "Pre-risky-action checklist" — `git init` baseline + read flag docs before running scaffolders / template generators / `--overwrite` CLIs.
- **Status:** resolved 2026-04-19

### SURFACE-2026-05-08-01 — AoA sign convention "chord = into the wind"
- **Source:** feature:build (WP4 Phase 2)
- **Resolution:** Documented in `CONVENTIONS.md` §Coordinates during WP4 finalize. Convention is now: `chord` points leading-edge-into-wind; for a forward-flying plane chord = (0,0,−1); positive AoA = wind on underside → positive lift. Six Phase 1 tests rewritten to physical setups during the discovery fix.
- **Status:** resolved 2026-05-08
