# Backlog

Surface-notes from workflow runs. Consumed and resolved by higher-level workflows (arch revisions, new WPs, etc.).

## Open

### SURFACE-2026-05-11-04 — Phugoid (long-period) mode is undamped at Phase 1 airframe
- **Source:** feature:build (WP7 Phase E retune attempts 1 + 2, 2026-05-11)
- **Target level:** product:arch (likely Phase 2 — not Phase 1 blocking)
- **Type:** tech-debt / arch-gap
- **Priority:** low–medium (NOT gating for Phase 1 ship; gates "level cruise feel" if/when that becomes a Phase 2 goal)
- **Summary:** WP7 Phase E tried two single-knob retunes (mass=700+throttle=0.15; mass=1000+throttle=0.05) against the WP6.6-baseline. Both were stable at short observation windows (≤7s) but **divergent at long windows (≥14s)**. Diagnosis: the phugoid mode (long-period airspeed↔altitude exchange, ~10–14s at this airframe) is fundamentally undamped. WP6.6 added airspeed-scaling to the *short-period* β4 damping (pitch-rate `q`) but did NOT add anything to dampen the long-period mode. Any non-zero baseline throttle injects energy that the airframe cannot dissipate per cycle, so the phugoid grows until tumble/NaN. The only stable attractor is throttle=0 (the descending glide). Phase E shipped option (c) — the WP6.5 baseline (descending glide) — and deferred the "feels like level flight" question to Phase F's casual-player feel-check.
- **Context:** This was anticipated as a possible failure mode in arch.md's "Fallback path" (which sanctioned β4-pitch-rate-damping as a hedge against case (3) "tuning is just hard"). The fallback path mentions option (3) automated parameter search but does NOT mention a long-period damping mechanism. A new arch decision would be required.
- **Suggested action (Phase 2 candidate):** Add `cl_alpha_dot` (alpha-rate damping) as a per-surface coefficient — phugoid is driven by AoA tracking lag at constant thrust, so damping `α̇` directly should attenuate the long-period mode. Could be analogous to WP6.6's V-scaling fix (a single field added to AeroSurfaceConfig, simple math in computeAeroForce). Alternative: simulate atmospheric drag growth more aggressively (currently the model has only cdMax=1.2 at ±π/2). Both are arch-level extensions; not in scope for Phase 1.
- **Verification approach:** any future fix must verify against a ≥30-second Playwright probe (3+ phugoid periods) with various baseline throttle values (0.05, 0.15, 0.4) — single-period observation hides the divergence.
- **Why we accept it for Phase 1:** the descending-glide attractor IS playable (matches "takeoff/landing" mission type from vision.md). Phase F's casual-player test will judge whether it's acceptably playable. If not, escalate. Memory `feedback_verify_self_envelope.md` (just persisted) is the lesson here.
- **Update 2026-05-11 (WP9 verify-self):** the phugoid is **divergent under non-zero forcing**, not merely undamped. Under sustained full throttle the airspeed amplitude grows unbounded (3↔113 m/s oscillation crossing to Infinity then NaN at t≈8s). Previously characterized as "bounded oscillation"; that was only true for the zero-forcing case (the descending-glide attractor, which IS marginally stable). Any baseline throttle injects energy faster than the natural damping can dissipate. Phase 2 phugoid-damping work should target the divergent regime, not merely tighten the bounded regime.
- **Status:** pending — Phase 2 candidate; not gating Phase 1 (but compounds with SURFACE-2026-05-11-05)

### SURFACE-2026-05-11-02 — β1+β4 stable state is a descending glide, not level cruise (parameter-tuning gap)
- **Source:** feature:build (WP6.5 Phase 3 verify-self, 2026-05-11)
- **Target level:** product:wbs (WP7 Phase E retune — already paused and queued)
- **Type:** parameter-tuning / feel
- **Priority:** medium (load-bearing for WP9 verification: "developer takes off, flies around, crashes" needs an aircraft that can hold airspeed)
- **Summary:** With wings incidenceRad=+2°, h-stab incidenceRad=-1°, wings clQ=3, h-stab clQ=8, the airframe is dynamically stable (max|pRate|=149°/s, no tumble). But airspeed bleeds 30→2 m/s and altitude trends 50→33m within the 6s observation window. The system is in a low-energy descending glide because at mass=1000 kg, spawn airspeed v=30 m/s, and zero throttle, lift is only ~14.8% of weight. Force balance for level flight requires v≈90 m/s OR baseline throttle ≈ 0.4 OR reduced mass.
- **Context:** WP6.5 closed the *architectural* gap (no level-trim equilibrium / dynamic instability). The remaining "feels like flight" tuning is exactly WP7 Phase E's job. WP7 was already paused awaiting WP6.5; it now resumes with a clean stable baseline to tune against.
- **Suggested action:** At WP7 Phase E entry: experiment with (a) baseline `throttle = 0.4` at spawn (cheapest — `Controls` class might need a constructor option), (b) `mass = 500–700 kg` (changes ground feel), (c) `area = 9–10 m²` per wing (changes visual feel of wing size). Iterate via lil-gui live; export preset to `aircraft.json` when it feels right. The strong physical priors (incidence 0–4°, clQ 0–16, lift/weight ratio ~1 at cruise speed) make this a bounded search — likely 1–2 lil-gui sessions.
- **Status:** WP7 Phase E disposition 2026-05-11 — the "level cruise" goal is **not closable within Phase 1 scope** due to SURFACE-2026-05-11-04 (phugoid undamped). Phase E shipped option (c) (accept descending glide). This entry stays open as a candidate for Phase 2 if the casual-player feel-check (Phase F AC #7) rejects the descending glide as unplayable.

### SURFACE-2026-05-09-01 — End-to-end browser test infrastructure not configured
- **Source:** feature:verify-codify (WP6 Phase 4)
- **Target level:** product:wbs (re-targeted 2026-05-11 — see Update below)
- **Type:** gap / tech-debt
- **Summary:** The project tests via Vitest (unit/integration only). Browser-driven end-to-end verification is performed ad-hoc via Playwright MCP during workflow `verify-self` runs but is not codified into a runnable test suite. The `.playwright-mcp/` directory in the working tree is MCP scratch state, not a configured Playwright test runner.
- **Context:** Phase 4 of WP6 wired flight controls into the dev page. The integration-boundary check at verify-codify wanted to write a "consuming-surface" test, but the codebase has no harness to host it. Live Playwright via MCP served the codification role this iteration. As phases multiply (mission, HUD, combat), one-shot MCP runs won't scale — eventually we want CI-runnable browser tests for at least the critical input-→-motion path.
- **Suggested action:** At WP9 (Phase 1 verification), evaluate adding `@playwright/test` as a dev dep with one CI smoke: load page, dispatch a roll keypress, assert the aircraft body's yaw/pitch/roll changed via a debug-only `window.__aircraft` hook. Keep the suite tiny — single happy-path test per critical input — to avoid the "Playwright tests are flaky" trap.
- **Priority:** low (live verification is sufficient for now; the gap becomes real at Phase 2+)
- **Update 2026-05-11 (WP9 Phase 4 decision — DEFER):** Evaluated at WP9 Phase 4. Decision = **DEFER adoption to immediately post-WP9.5** (the proposed collider-fix WP per SURFACE-2026-05-11-05). Reasoning:
  - The natural first smoke test is "after 5s of casual flight, aircraft state is finite and altitude is in expected range" — exactly the regression-anchor SURFACE-2026-05-11-05 (collider gap) needs.
  - Adopting TODAY would either commit a failing test (anti-pattern) or commit a test scoped around the known defect (also bad — wouldn't catch the very defect it's meant to anchor).
  - Adopting AFTER WP9.5 (collider added) lets the smoke test land green AND immediately serves as the regression anchor for the collider fix.
  - Adopting also resolves WP9 Phase 2's WebKit/Firefox gap (Playwright test runner supports all three engines natively), so re-validating the FPS check across engines becomes a CI artifact rather than an operator-as-tester deviation. Strong compounding rationale.
- **Re-targeted:** if WP9.5 is authorized, fold this adoption into WP9.5 (collider + smoke test in one WP). Otherwise, surface as **WP10.5** or **a Phase 2 tooling WP** to land before mission framework work begins.
- **Priority:** **medium** (upgraded 2026-05-11 — the Phase 3 BLOCKER finding showed how a tiny smoke would have caught a structural defect; the gap is no longer "theoretical Phase 2+ concern" but "would have caught a known Phase 1 blocker").
- **Status:** pending — re-targeted to post-WP9.5

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

### SURFACE-2026-05-11-05 — Aircraft has no collider; tunnels through terrain and NaN's the simulation under any non-trivial input
- **Source:** feature:build (WP9 Phase 3 operator-as-tester probe, 2026-05-11)
- **Resolution:** Resolved-with-test by WP9.5 (2026-05-11). One-line addition in `src/aircraft/rigidbody.ts` constructor: `world.createCollider(ColliderDesc.cuboid(0.5, 0.3, 3.0).setDensity(0), this.body)` — matching the fuselage placeholder geometry (`BoxGeometry(1, 0.6, 6)`). `setDensity(0)` keeps the existing `setAdditionalMassProperties` configuration authoritative (otherwise the collider's auto-computed mass would stack on top).
  - **Test coverage:** two new tests in `src/aircraft/rigidbody.test.ts` — (1) structural anchor "attaches at least one collider to the body so it can interact with terrain" (`numColliders() > 0`), (2) behavioral integration "aircraft body collides with a static ground plane (does not tunnel through)" (creates a Rapier world with a static ground collider, drops the aircraft from y=3 with vy=-10, steps 60 ticks, asserts final y > 0). Total 246/246 tests green; tsc clean.
  - **Verification (verify-self):** targeted teleport-to-ground probe via Playwright-MCP — body to y=3 with vy=-10, observed impact at t=0.3 (alt=0.28m, vy reversed to +0.30), then bounded bouncing motion in 1.5–6.4m range. `anyNaN=false`, `collisionDetected=true`. Long-horizon no-input 30s also clean.
  - **Lesson captured (verify-self method):** the original WP9 Phase 3 regression-anchor probe (the gentle casual-input session) was over-broad. It exercised BOTH the tunneling pathology this WP fixes AND the SURFACE-2026-05-11-04 phugoid-divergent-under-forcing pathology that's explicitly out-of-scope. Running it post-fix produced a misleading FAIL signal because the now-stable aircraft climbs to ~110m where it hits the unrelated divergent mode. The targeted teleport probe isolates the collider's contract directly. **General lesson candidate for `/session-store-learning`:** when a regression-anchor exercises multiple defect zones, isolate each zone with a targeted probe; broad probes mask success on one fix when a different defect lights up.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-09-05 — Phase 4 verify-self required WP7 trim to fully validate (resolved by disposition)
- **Source:** feature:build (WP8 Phase 4 verify-self back-loop, 2026-05-09)
- **Resolution:** Closed-by-implementation 2026-05-11 at WP7 finalize. The original surface expected a WP7-committed-tuned-preset (level cruise) to enable sustained-frame observation of WP8's deferred outcomes (`horizon-tilt-after-roll`, `tower-parallax-on-approach`). WP7's actual disposition was option (c) — ship the WP6.5 baseline (descending glide) unchanged — because the phugoid is undamped (SURFACE-2026-05-11-04) and no single-knob tune produces a usable long-horizon cruise. The descending-glide trajectory IS observable for 6+ seconds before significant altitude loss, which proved sufficient for WP8's Phase F verify-self outcomes during the WP7 verify-self subagent run (multiple successful long-horizon Playwright probes documented in the WP7 archive). The two-way dependency the surface noted is now moot. If WP9 finds that the descending-glide trajectory IS still too short for some cross-browser observation, the right path is to use the `?debug=true` paused state (the debug GUI has a "Pause physics" toggle) for any sustained-frame visual check, not a tuning fix.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-09-03 — `window.__aircraft` debug telemetry hook
- **Source:** feature:build (WP7 Phase E tuning session, 2026-05-09)
- **Resolution:** Implemented in `src/main.ts` inside the existing `if (debug)` block during the Phase F back-loop diagnosis (2026-05-10). Adds: a `Telemetry` lil-gui folder with read-only displays for altitude/airspeed/vertical speed/pitch/roll/yaw + their rates; a `window.__aircraft` global exposing `{ body, flightModel, getState() }`; a 100 ms `[tel f=N]` `console.log` line carrying the full kinematic state. Gated on `?debug=true`. Used heavily and successfully as the verify-self mechanism for WP6.5 and WP6.6 — the back-loop diagnosis tooling became the project's primary aero-physics observability infrastructure. No tests written (debug-only helper). Surface closed retroactively during WP6.6 task-close (2026-05-11) on the observation that it had been silently providing service for two work-packages.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-11-03 — β1+β4 stability margin is not robust to airspeed (damping ratio collapses as V grows)
- **Source:** feature:build (WP7 Phase E retune, 2026-05-11)
- **Resolution:** Resolved-with-test by WP6.6 (2026-05-11). One-line change in `src/aircraft/aerosurface.ts` `computeAeroForce`: replaced the airspeed-independent `(1 + clQ)` β4 amplification on `(ω × r)` with `(1 + clQ · max(v, V_REF) / V_REF)` where `v = |bodyState.linvel|` and `V_REF = 30 m/s`. The `max(v, V_REF)` floor preserves WP6.5's low-V β4 calibration bit-for-bit (the formula reduces to `(1 + clQ)` for all v ≤ V_REF — exactly matching pre-fix); above V_REF the amplification grows linearly with v so the damping moment scales as V², matching the V² growth of the destabilizing pitch moment from `incidenceRad`. No 1/V singularity. Schema unchanged (`clQ` keeps its meaning).
  - **Test coverage:** two new regression anchors in `src/aircraft/aerosurface.test.ts` — one asserting the high-V growth branch (`yHigh > yRef` at v=60 vs v=30), one asserting the low-V floor doesn't blow up (forces at v=5,10,20,30 are all finite and bounded). Existing β4 default-zero-parity and sign-convention tests preserved unchanged. Total 244/244 tests green, tsc clean.
  - **Verification:** two Playwright-MCP verify-self trajectories at `?debug=true`:
    - Trajectory A (low-V regression, spawn linvel z=-30): output bit-identical to the pre-fix WP6.5 baseline (max|pRate| ≤ 110°/s, bounded ±30° pitch). The floor branch does its job — no behavior change in the WP6.5 regime.
    - Trajectory B (high-V probe, spawn linvel z=-90, 3·V_REF): max|pRate| = 390°/s (single transient at f=64 during near-stall recovery, surrounding frames ≪ 360°/s), airspeed bounded < 70 m/s, no NaN, no gimbal flips. **Dramatic improvement vs the pre-fix high-V failure modes:** the previous Run A (mass=700, thrust=8000, throttle=0.4) collapsed to NaN at f=54 (airspeed 845 m/s); the previous Run B (WP6.5 baseline + throttle=0.4) produced max|pRate|=1766°/s with ±90° pitch flips. The post-fix Trajectory B has max|pRate| ~4.5× lower than pre-fix Run B, ~3e8× lower than pre-fix Run A, and is bounded throughout.
  - **Residual:** ±50° pitch oscillation at high-V is parameter-tuning territory (precisely WP7 Phase E's job). The architectural goal — "make β4 damping work across the V envelope so tuning can take over" — is met.
  - **Lessons captured:** the initial implementation (no floor: `1 + clQ · v / V_REF`) regressed low-V by shrinking amplification below the WP6.5-calibrated `(1 + clQ)` baseline. When a fix targets an asymmetric problem (here: only high-V was broken), write the formula to be a no-op in the unaffected regime, not a redistribution across both. Caught by Trajectory A retest before commit.
- **Status:** resolved 2026-05-11

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
