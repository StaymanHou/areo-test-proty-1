# Backlog

Surface-notes from workflow runs. Consumed and resolved by higher-level workflows (arch revisions, new WPs, etc.).

## Open

### SURFACE-2026-05-11-02 — β1+β4 stable state is a descending glide, not level cruise (parameter-tuning gap)
- **Source:** feature:build (WP6.5 Phase 3 verify-self, 2026-05-11)
- **Target level:** product:wbs (WP7 Phase E retune — already paused and queued)
- **Type:** parameter-tuning / feel
- **Priority:** medium (load-bearing for WP9 verification: "developer takes off, flies around, crashes" needs an aircraft that can hold airspeed)
- **Summary:** With wings incidenceRad=+2°, h-stab incidenceRad=-1°, wings clQ=3, h-stab clQ=8, the airframe is dynamically stable (max|pRate|=149°/s, no tumble). But airspeed bleeds 30→2 m/s and altitude trends 50→33m within the 6s observation window. The system is in a low-energy descending glide because at mass=1000 kg, spawn airspeed v=30 m/s, and zero throttle, lift is only ~14.8% of weight. Force balance for level flight requires v≈90 m/s OR baseline throttle ≈ 0.4 OR reduced mass.
- **Context:** WP6.5 closed the *architectural* gap (no level-trim equilibrium / dynamic instability). The remaining "feels like flight" tuning is exactly WP7 Phase E's job. WP7 was already paused awaiting WP6.5; it now resumes with a clean stable baseline to tune against.
- **Suggested action:** At WP7 Phase E entry: experiment with (a) baseline `throttle = 0.4` at spawn (cheapest — `Controls` class might need a constructor option), (b) `mass = 500–700 kg` (changes ground feel), (c) `area = 9–10 m²` per wing (changes visual feel of wing size). Iterate via lil-gui live; export preset to `aircraft.json` when it feels right. The strong physical priors (incidence 0–4°, clQ 0–16, lift/weight ratio ~1 at cruise speed) make this a bounded search — likely 1–2 lil-gui sessions.
- **Status:** pending — WP7 Phase E timing

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

### SURFACE-2026-05-10-02 — Phase 1 airframe has no level-trim equilibrium (architectural) + SURFACE-2026-05-11-01 — β1 alone is dynamically unstable
- **Source:** feature:build (AoA sign-convention fix Phase 2 verify-self, 2026-05-10; deepened in static-margin geometry fix attempt, 2026-05-10; β1-alone divergence finding 2026-05-11)
- **Resolution:** Resolved-with-test by WP6.5 (2026-05-11). Two-phase implementation:
  - **β1 (`incidenceRad`)** per arch.md Revision 2026-05-11 / D10 — per-surface mount angle gives the airframe a level-trim equilibrium. Wings +2°, h-stab −1°, v-stab 0.
  - **β4 (`clQ`)** per arch.md "Fallback path" hedge — per-surface pitch-rate damping amplifies the natural ω×r damping mechanism by `(1 + clQ)`. Wings clQ=3, h-stab clQ=8, v-stab clQ=0. No 1/V singularity (a key correction over the prior abandoned attempt's standard `cl_q · c̄ / (2V)` form, which NaN'd at low airspeed).
  - **Verification:** live telemetry 6s window at `http://localhost:5174/?debug=true` showed max|pRate|=149.10°/s (target <360, pass by 2.4×), no gimbal flips, no JS errors. β1 alone produced 8401°/s divergence; β1+β4 brings it to 149 — full stability achieved.
  - **Test coverage:** 7 unit tests in `src/aircraft/aerosurface.test.ts` (default-zero parity for both incidence and clQ, positive-incidence positive-lift, surface-property invariance, sign-convention regression anchors, amplification ratio) + 6 unit tests in `src/aircraft/config.test.ts` (absent / explicit numeric / non-finite-throws for both fields) + 2 integration-boundary tests in `src/aircraft/flightmodel.test.ts` (asserts `incidenceRad` and `clQ` thread through `parseAircraftConfig → FlightModel.surfaces` and produce real-physics behavior). Total 242/242 tests green, tsc clean.
  - **Caveat (deferred to WP7 Phase E retune):** the verified-stable state is a descending glide, not level flight — airspeed bleeds from 30 to ~2 m/s and altitude trends down 50→33m within bounds. The cause is parametric (mass=1000 too high for spawn airspeed v=30 to produce lift=weight without thrust; lift~mg balance only at v≈90 m/s). The architectural goal of WP6.5 ("spawn airborne, no tumble, bounded pitch rate") is fully achieved; making the aircraft hold a useful cruise state is a parameter-tuning concern for WP7.
- **Lessons captured in archived plan:**
  - The β1 static-margin path was empirically refuted in the prior abandoned attempt before β1's actual mechanism was understood — confirmation that "structural property of the schema" (not parameters) was the real gap.
  - The dynamic-instability finding (200× discrepancy between my linearized analytical model and observed angular acceleration) is a useful frame for any future tuning work: linear-stability analysis underestimates the real divergence rate because stall regime + descent-induced AoA coupling are first-order, not perturbative.
  - The agent's first-try sign error on the incidence rotation (P1.6 catch — `-incidenceRad` not `+incidenceRad` per the canonical span axis) demonstrates that **physical-sign tests** ("positive incidence → positive lift") are the only reliable convention anchor. Pure-math identity tests would have passed.
  - Operator instinct to stop-and-escalate after Phase 2 failure (rather than have the agent unilaterally pick A/B/C) preserved the option to choose between path (A) damping or (C) automated tuning-search; (A) succeeded, (C) deferred.
- **Status:** resolved 2026-05-11

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
