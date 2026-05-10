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

### SURFACE-2026-05-10-01 — AoA sign-convention bug in `computeAngleOfAttack` causes divergent pitch instability
- **Source:** feature:build (WP7 Phase F → Phase E back-loop → code investigation, 2026-05-10)
- **Resolution:** Resolved-with-test by commit `2bd5119` (`fix(aero): correct AoA sign convention`). Phase 1 flipped the sign of `perp` in `src/aircraft/aerosurface.ts` `computeAngleOfAttack` and updated `CONVENTIONS.md`. Phase 2 flipped the four routing-table sign multipliers in `flightmodel.ts` (aileron L/R, elevator, rudder) so `+control` still produces the documented body motion under the corrected physics, and corrected 13 test setups whose physics embedded the same sign error. Phase 3 added `src/aircraft/stability.test.ts` with two regression-anchor tests that would have failed under the buggy convention (rest-state |angvel.x| < 0.7 rad/s after 10 steps, was 1.31; perturbation Mx < −100 N·m restoring, was +1561 amplifying). Final 227/227 tests green. **Note:** SURFACE-2026-05-08-01 (resolved 2026-05-08) had documented the *chord-direction* convention but baked the sign-flip in question into the test fixtures it produced — a reminder that conventions need an independent physical check, not just internal consistency. Lesson captured in archived plan retrospect.
- **Status:** resolved 2026-05-10

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
