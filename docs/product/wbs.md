---
stage: wbs
state: in-progress
updated: 2026-05-16 (WP14.7 DONE — Node Rapier-WASM harness shipped as commit 8bca32c; D14 cascade step 2 of 3 complete; throttle-high envelope fixture surfaced SURFACE-2026-05-16-01 β4 explicit-Euler instability above V_REF, captured for WP14.5-retry joint (clQ, clAlphaDot) search via WP14.8 optimizer. WP14.8 is next.)
---

# Work Breakdown Structure

T-shirt sizing: **XS** ≤ 2h · **S** ≤ half day · **M** ≤ 1 day · **L** ≤ 2–3 days · **XL** > 3 days (consider splitting).

---

## Phase 1 — Flight PoC

### WP1: Project skeleton & dev loop — DONE 2026-04-19
**Description:** Initialize the Vite + TypeScript + Three.js + Rapier project. Empty scene renders, HMR works, Stats.js + lil-gui in place behind `?debug=true`. Establishes module layout from arch.md.
**Phase:** 1
**Dependencies:** none
**Size:** S (actual: ~S)
**Tasks:**
- [x] `npm create vite@latest` (TS template), install three, @dimforge/rapier3d-compat, lil-gui, stats.js
- [x] Scaffold `src/` module layout (engine/, world/, aircraft/, mission/, hud/ as empty dirs per arch.md D5)
- [x] `main.ts` boots: Three.js renderer + canvas, Rapier world init (async await — WASM load), empty render loop
- [x] Stats.js FPS counter visible; lil-gui panel visible only with `?debug=true`
- [x] README with `npm run dev` / `npm run build` / how to open debug mode
- [x] `CONVENTIONS.md` documenting right-handed Y-up coordinates (arch D7)

### WP2: Fixed-timestep game loop — DONE 2026-04-19
**Description:** Implement the decoupled physics-tick / render-tick loop from arch D1. Accumulator pattern, physics at 60 Hz, render at monitor refresh. No aircraft yet — just prove the loop with a falling cube.
**Phase:** 1
**Dependencies:** WP1
**Size:** S (actual: ~S)
**Tasks:**
- [x] `engine/loop.ts`: accumulator-pattern tick, configurable physics dt, spiral-of-death clamp, pause support. 7 Vitest tests codify behavior.
- [x] Falling-cube demo: Rapier rigid body + Three.js mesh, synced each render frame (Rapier world gravity, static ground collider, dynamic cube)
- [x] Verified stable under frame drops (tab backgrounding) and CPU throttling (6×)

### WP3: Input + camera — DONE 2026-05-04
**Description:** Keyboard + mouse input state with rebindable map. Chase camera (follows body at offset) and cockpit camera (rigid to body). Swap with a key.
**Phase:** 1
**Dependencies:** WP2
**Size:** S (actual: ~S)
**Tasks:**
- [x] `engine/input.ts`: keyboard + mouse state, frame-stable reads, `wasPressed()` single-frame detection, `DEFAULT_KEY_MAP` with 14 logical actions
- [x] `world/camera.ts`: chase camera with exponential-decay damped follow, cockpit camera with rigid attach (position + quaternion copy)
- [x] `V` key swaps cameras; lil-gui "Camera" label shows active mode
- [x] Works on the falling-cube demo (camera follows the cube); 22 Vitest tests

### WP4: Aerosurface primitive — DONE 2026-05-08
**Description:** The core of the flight model. Single `AeroSurface` class: given local-frame position, orientation, area, and piecewise-linear CL/CD curves, computes force + application point from incoming airflow velocity. Unit-tested.
**Phase:** 1
**Dependencies:** WP1 (project skeleton)
**Size:** M (actual: ~M)
**Tasks:**
- [x] `aircraft/aerosurface.ts`: data model (position, normal, chord, area, CL/CD curve)
- [x] Airflow → angle-of-attack math (project velocity onto plane defined by `normal × chord`, measure signed angle from `−chord` direction; sign convention: flow along `−normal` → +AoA → +lift)
- [x] Piecewise-linear CL/CD lookup (`lookupLiftDragCurve`) + Gazebo-style symmetric flat-plate helper (`createSymmetricFlatPlateCurves`)
- [x] `computeAeroForce(surface, bodyState)`: force vector + world application point. Allocation-free hot path (11 module-scoped scratch buffers).
- [x] 27 Vitest cases: shape/normalization, airflow at point with rotational contribution, AoA across the full domain, curve lookup edge cases, force at α≈0/+10°/+30°, post-stall drop, drag rise, app-point world transform, sign-continuity through α=0, force-vector reuse contract.

### WP5: Flight model composition — DONE 2026-05-08
**Description:** Assemble aerosurfaces into an aircraft: main wing (L+R), horizontal stab, vertical stab. Load constants from `public/config/aircraft.json`. Apply summed forces + thrust + gravity to a Rapier rigid body. No control inputs yet.
**Phase:** 1
**Dependencies:** WP4
**Size:** M (actual: ~M)
**Tasks:**
- [x] `aircraft/rigidbody.ts`: `Aircraft` class — Rapier dynamic body (mass + principal inertia from config) + Three.js mesh group (fuselage + 4 surface placeholders). `syncMesh()`, `readBodyState()`.
- [x] `aircraft/flightmodel.ts`: `FlightModel` class — composes N AeroSurfaces, allocation-free per-tick aero force application, thrust along body −Z, throttle clamped [0,1].
- [x] `public/config/aircraft.json` + `aircraft/config.ts`: schema (mass, inertia Vec3, thrust.maxN, surfaces[] with named curves), light runtime validation, vector-to-Vector3 conversion. Async `loadAircraftConfig`.
- [x] Placeholder aircraft mesh (box fuselage + 4 surface boxes with named placement).
- [x] Launched at (0,50,0) with linvel (0,0,-30) at 60% fixed throttle; physics runs and the aircraft moves visibly. (Fully trimmed, stable flight requires WP6 controls + WP7 tuning — confirmed by browser verify-self.)

### WP6: Flight controls — DONE 2026-05-09
**Description:** Map input state to control-surface deflections. Aileron (roll), elevator (pitch), rudder (yaw), throttle. Controls modify aerosurface orientations (aileron) or add torque (simplified). Verify a pilot-like control feel.
**Phase:** 1
**Dependencies:** WP3, WP5
**Size:** M (actual: ~M)
**Tasks:**
- [x] `aircraft/controls.ts`: keyboard → normalized control values (−1..1) with stick-rate ramping; throttle stateful with rate ramping
- [x] Ailerons deflect L/R wings (opposite signs) via `setDeflection` rotating chord+normal about pre-baked spanAxis
- [x] Elevator deflects the horizontal stab; rudder deflects the v-stab; signs determined empirically by per-axis body-torque tests
- [x] Throttle modulates thrust [0..1] (replaces the WP5 hard-coded 0.6)
- [x] Lil-gui Controls folder with live readouts + rebindable key fields (gated on `?debug=true`)
- [x] CONVENTIONS.md documents +aileron→roll right, +elevator→nose up, +rudder→nose right, deflection-via-spanAxis model
- [x] 37 new tests; 106/106 pass; verified end-to-end at localhost:5173

### WP6.5: Per-surface incidence + pitch-rate damping (β1 + β4 — airborne trim-spawn) — DONE 2026-05-11
**Description:** Implements the schema extensions decided in arch Revision 2026-05-11 (D10 + "Fallback path" hedge). Phase 1 added `incidenceRad` (β1) — per-surface mount angle giving the airframe a static moment-trim equilibrium. Phase 2 set wings=+2°, h-stab=-1° in `aircraft.json` and the live verify-self failed (max|pRate|=8401°/s) — β1 creates the trim point but it's dynamically unstable at current mass/speed parameters. Per operator decision, Phase 3 added `clQ` (β4) — per-surface pitch-rate damping that amplifies the natural ω×r mechanism by `(1+clQ)`. Wings clQ=3, h-stab clQ=8. Final verify-self: max|pRate|=149.1°/s (target <360, pass by 2.4×), no gimbal flips, divergence cured. Shipped in commit `6ad3133`.
**Phase:** 1
**Dependencies:** WP6 (controls), WP4 (aerosurface primitive)
**Size:** S (actual: ~M — Phase 3 was added mid-flight after Phase 2 verify-self failed)
**Tasks:**
- [x] β1: `incidenceRad?: number` on `AircraftSurfaceConfig` + `AeroSurfaceConfig`; finite-number validation; threaded through `flightmodel.ts:58`.
- [x] β1: `computeAeroForce` applies the incidence rotation about the surface's span axis at construction (sign: positive = leading edge up → positive AoA → positive lift). Re-applied by `setGeometry` on live edits.
- [x] β4: `clQ?: number` on both configs; finite-number validation; threaded through `flightmodel.ts:58`.
- [x] β4: `computeAeroForce` amplifies the rotation-induced (ω × r) contribution to local airflow by `(1 + clQ)`. No 1/V singularity — distinct from the standard `cl_q·c̄/(2V)` form that NaN'd in the prior abandoned attempt.
- [x] CONVENTIONS.md documents both fields' sign conventions and the trim mechanism.
- [x] `aircraft.json` set: wings incidenceRad=+0.0349 (+2°), h-stab incidenceRad=-0.0175 (-1°), wings clQ=3, h-stab clQ=8, v-stab unchanged.
- [x] Aircraft spawns airborne (unchanged from WP5; `(0,50,0)`, linvel `(0,0,-30)`, throttle=0); no key press required.
- [x] Tests: 6 unit (default-zero parity for both, positive-incidence positive-lift, surface-property invariance, sign-convention regression anchors, clQ amplification, clQ sign) + 6 config-parse (absent/numeric/non-finite for both) + 2 integration-boundary (incidenceRad + clQ threaded through to real-physics behavior). Full suite 242/242 green; tsc clean.
- [x] Verify-self exit gate: max|pRate|=149.10°/s ≪ 360°/s target; no gimbal flips; altitude/airspeed within bounds (descending glide — parameter-tuning concern deferred to WP7 Phase E, not a stability concern).
- [x] Closes-by-implementation: SURFACE-2026-05-10-02 + SURFACE-2026-05-11-01 (both Resolved in `workflow/backlog.md`).

### WP6.6: Airspeed-scaled β4 pitch damping — DONE 2026-05-11
**Description:** Closes SURFACE-2026-05-11-03 — the WP6.5 β4 stability margin proved not robust to airspeed (damping ratio collapses as V grows because the (1+clQ) factor on (ω×r) is velocity-independent while the destabilizing pitch moment from incidenceRad scales as V²). Replaces the constant amplification with `(1 + clQ · max(v, V_REF) / V_REF)` where V_REF=30 m/s. The `max(v, V_REF)` floor preserves WP6.5's low-V calibration bit-for-bit; above V_REF, amplification grows linearly so the damping moment scales as V². Shipped in commit `e14cfef`.
**Phase:** 1
**Dependencies:** WP6.5
**Size:** XS (actual: ~XS — one-line formula change + 2 tests + docs)
**Tasks:**
- [x] Hoist `BETA4_V_REF=30` module constant in `aerosurface.ts`.
- [x] Replace `multiplyScalar(1 + surface.clQ)` with the airspeed-scaled form using `bodyState.linvel.length()`. Allocation-free.
- [x] CONVENTIONS.md β4 paragraph updated with the new formula + floor rationale; AeroSurfaceConfig.clQ docstring updated.
- [x] Two regression-anchor tests: "clQ amplification grows with airspeed above V_REF" + "clQ amplification floors at (1 + clQ) for v ≤ V_REF".
- [x] Verify-self trajectories: low-V regression bit-identical to WP6.5 baseline (max|pRate|≤110°/s); high-V probe (spawn linvel z=-90) max|pRate|=390°/s, bounded, no NaN, no gimbal flips.
- [x] Closes-by-implementation: SURFACE-2026-05-11-03 (Resolved in `workflow/backlog.md`). Also closes SURFACE-2026-05-09-03 (window.__aircraft + Telemetry GUI debug hook — formalized as the canonical observability infrastructure across WP6.5/WP6.6/WP7).

### WP7: Flight-feel tuning pass — DONE 2026-05-11
**Description:** Live-tuning loop (lil-gui Flight Model folder + per-surface curve knobs + JSON export button) + a developer tuning pass against the WP6.5 + WP6.6 stable airframe. The infrastructure (Phases A–D) shipped 2026-05-09 (commit `c556cb6`). Phases E + F (the actual tuning pass + feel-check) shipped 2026-05-11 (commit `602c6ae`) — but the tuning pass empirically showed the WP6.5 baseline is *already* Phase-1-acceptable: no single-knob throttle/mass tune produces a long-horizon stable cruise (the phugoid mode is undamped at this airframe; only the throttle=0 descending-glide attractor is stable). Phase E shipped option (c) — accept the WP6.5 baseline (descending glide) unchanged. Phase F's feel-check (operator-as-tester per full-autopilot directive) accepted at the "bounded, controllable, non-tumbling" bar. The undamped phugoid is logged as SURFACE-2026-05-11-04 (Phase 2 candidate; not gating Phase 1).
**Phase:** 1
**Dependencies:** WP6 (controls), WP6.5 (airborne trim-spawn), WP6.6 (V-scaled damping)
**Size:** L (actual: ~L — original A-D infra was M; F26 escalation to WP6.6 + 2 refuted retune attempts + Phase F operator-as-tester disposition brought it to L)
**Tasks (Phases A–F):**
- [x] Phase A: parametric `symmetric-flat-plate` curve schema (6 knobs: clSlope/stallAlpha/clPostStall/cdMin/cdStall/cdMax). Back-compat with named-string curve form.
- [x] Phase B: live mutators on AeroSurface (`setGeometry`, `setCurves`) and Aircraft (`setMassProperties`). Re-bake invariants. Allocation-free per tick.
- [x] Phase C: lil-gui Flight Model folder with Body/Thrust + per-surface geometry/curve sliders, gated on `?debug=true`.
- [x] Phase D: "Export preset (copy JSON)" button — round-trips through `parseAircraftConfig`.
- [x] Phase E (developer tuning pass): retune from post-WP6.6 baseline. Two single-knob attempts (mass=700+throttle=0.15, then mass=1000+throttle=0.05) both refuted by long-horizon verify-self (divergent phugoid → tumble at frames ≥80). Shipped option (c) WP6.5 baseline unchanged.
- [x] Phase F (feel-check + commit defaults): operator-as-tester verdict PASS at "bounded, controllable, non-tumbling" bar. 14-second Playwright probe confirmed shipped baseline: max|pRate|=164.9°/s, altitude 32.82–49.89m, no NaN, control routing intact. `aircraft.json` ships unchanged from WP6.5; no candidate-preset commit needed.
- [x] Telemetry observability infrastructure (lil-gui Telemetry folder + `[tel f=N]` console log + `window.__aircraft` global) added to `src/main.ts`; closes SURFACE-2026-05-09-03.
- [x] All four verify-* gates passed for each of Phases A–F. 244/244 tests green, tsc clean.
- [x] SURFACE-2026-05-11-04 logged (phugoid undamped — Phase 2 candidate, not gating Phase 1).

### WP8: Phase 1 world (flat terrain + skybox + landmarks) — DONE 2026-05-09
**Description:** Per arch D4, flat textured ground plane + skybox + 2–3 placed landmarks (runway, control tower) for spatial reference. Rapier ground collider. Runs at 60fps.
**Phase:** 1
**Dependencies:** WP1
**Size:** S (actual: ~M — the back-loop fix for the cubemap upload-path contract added a half-day)
**Tasks:**
- [x] `world/terrain.ts` with the arch-defined interface (`getHeight`, `getMesh`, `getColliderDesc` — descriptor-not-collider, slight rename from arch.md's `getCollider`)
- [x] Flat textured plane + static Rapier collider (4000m × 4000m, procedural checker DataTexture)
- [x] Skybox (procedural CubeTexture, 6 faces × 256², gradient sky + sun on +X)
- [x] Placed runway (30m × 600m along world Z, painted on terrain — no separate collider) + a single landmark tower (8m × 30m at world (40, 0, -250) with static cuboid collider)
- [x] Sanity-check 60fps budget with the aircraft flying (60fps Chrome + 60.19fps Playwright headless)

### WP9.5: Aircraft collider + terrain impact — DONE 2026-05-11
**Description:** Closes SURFACE-2026-05-11-05 (Phase 1 BLOCKER discovered in WP9 Phase 3). The aircraft `RigidBody` was created without a collider; the aircraft tunneled through the terrain plane and the integrator NaN'd within ~12s on any non-trivial input. WP9.5 attaches `ColliderDesc.cuboid(0.5, 0.3, 3.0).setDensity(0)` to the body in `src/aircraft/rigidbody.ts` constructor, matching the fuselage placeholder geometry. Density=0 keeps the pre-existing `setAdditionalMassProperties` configuration authoritative.
**Phase:** 1
**Dependencies:** WP5 (rigidbody), WP8 (terrain collider)
**Size:** XS (actual: ~XS — one-line collider add + 2 tests + verify-self pass via targeted teleport-to-ground probe)
**Tasks:**
- [x] Add `ColliderDesc.cuboid(0.5, 0.3, 3.0).setDensity(0)` to aircraft body in `rigidbody.ts` constructor.
- [x] Structural regression test (`numColliders() > 0`) and behavioral integration test ("aircraft body collides with a static ground plane (does not tunnel through)") in `rigidbody.test.ts`. 246/246 tests pass; tsc clean.
- [x] verify-self via targeted teleport probe: aircraft at y=3 with vy=-10 impacts ground at alt=0.28m, vy reverses to +0.30 (bounce), settles to bounded oscillation 1.5–6.4m, no NaN. Long-horizon no-input 30s also clean.
- [x] **Verify-self lesson captured:** the original WP9 Phase 3 regression-anchor probe was over-broad (it exercised both the tunneling pathology AND the SURFACE-2026-05-11-04 phugoid-divergent pathology). The targeted teleport probe isolates the collider's contract. Lesson candidate for `/session-store-learning`.

### WP9: Phase 1 verification — DONE 2026-05-11 (closed via WP9.6 regression anchor)

**Description:** Meets Phase 1 exit criteria. Deployable dev build; a developer can open the URL, take off, fly around, and crash; 60fps on a mid-range laptop in Chrome/Safari/Firefox.
**Phase:** 1
**Dependencies:** WP2, WP3, WP6.5, WP7, WP8
**Size:** S (actual: M — expanded to 4 phases including a backlog-tooling-decision phase; closed via WP9.5 + WP9.6 follow-ups)
**Tasks:**
- [x] End-to-end playthrough: takeoff, fly, land-or-crash — closed by WP9.6's `tests/e2e/casual-flight.spec.ts`. Aircraft state finite + moving + within bounds at 5s; no NaN/Infinity; no JS console errors. The WP9.5 collider fix makes "crash" achievable (verified via teleport-to-ground probe); the WP9.6 smoke codifies the casual-flight pathway as a CI artifact.
- [~] FPS check on Chrome, Safari, Firefox — **Chromium PASS** (60.01 fps avg, 56.82 min, 0 spikes). **WebKit + Firefox carried forward to WP21** (strict-bar cross-browser QA). The `@playwright/test` runner now supports all three engines natively, so WP21's cross-browser sweep is a config-only expansion.
- [~] Phase 1 playtest: a non-developer flies and it feels right — **PASS at "bounded, controllable, non-tumbling" bar** under operator-as-tester deviation. Strict external-non-developer venue remains WP23. Casual-flight pathway is now CI-anchored (any NaN regression would fail `npm run test:e2e`).

### WP9.6: Adopt @playwright/test as Phase 1 regression anchor — DONE 2026-05-11
**Description:** Closes SURFACE-2026-05-09-01 by adopting `@playwright/test` minimally (Chromium-only, single load-bearing smoke). The smoke (`tests/e2e/casual-flight.spec.ts`) doubles as the WP9.5 collider-fix regression anchor AND the WP9 Phase 3 casual-flight pathway verification. New npm script `npm run test:e2e`. Vitest exclude added (`vitest.config.ts`) to prevent glob collision. CLAUDE.md "Testing" section updated.
**Phase:** 1
**Dependencies:** WP9.5
**Size:** XS (actual: ~XS — playwright.config.ts + 1 spec + npm script + 1 vitest config + docs; commit 70b2c2b)
**Tasks:**
- [x] Install `@playwright/test` + `@types/node` as devDeps; install Chromium headless-shell binary.
- [x] `playwright.config.ts` at repo root — Chromium project, webServer auto-starts `npm run dev` on :5173, `reuseExistingServer: !process.env.CI`, timeout 30s, retries 0, workers 1, list reporter.
- [x] `tests/e2e/casual-flight.spec.ts` — single test loads `/?debug=true`, `waitForFunction` until `window.__aircraft` is defined (handles Rapier WASM + config async load), 5s simulation window, then asserts via `__aircraft.getState()`: `position.{x,y,z}` finite, `airspeed` finite + > 0 (moving), aircraft moved from spawn within loose bounds (|x|<1000, |z+150|<1000), no console errors, no pageerrors, no `NaN`/`Infinity` in console output.
- [x] `vitest.config.ts` created with `exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**']` to prevent Vitest from picking up Playwright specs.
- [x] `npm run test:e2e` script added to `package.json`.
- [x] `.gitignore` extended with `/test-results/`, `/playwright-report/`, `/blob-report/`, `/playwright/.cache/`.
- [x] CLAUDE.md "Testing" section + Phase 1 status line updated. SURFACE-2026-05-09-01 moved to Resolved; regression-anchor note appended to SURFACE-2026-05-11-05 resolution entry.
- [x] verify-self: `npm run test:e2e` 1/1 in 9.0s; `npm run test` 246/246 in 0.41s; `npm run build` clean in 134ms. Bundle warning unchanged (SURFACE-2026-04-19-01, Phase 3 concern).
- [x] verify-codify: feature deliverable IS the codified regression test; no additional tests required. No integration boundary (isolated new artifacts only).

---

## Phase 2 — Mission System MVP

**Note:** Phase 2 opens with a brief arch revision (see P8 back-loop risk) to decide the mission framework and HUD approach. That work is WP10 below, before the mission-type WPs.

### WP10: Phase 2 arch revision — mission + HUD framework — DONE 2026-05-12
**Description:** Decide mission framework shape and HUD approach; document in `docs/product/arch.md` Revision 2026-05-12. **Decisions made (operator-as-architect under full-autopilot deviation per `feedback_operator_as_external.md`; Phase 3 re-validation hook recorded in arch.md Rev 2026-05-12):**
- **D11 — Mission framework: declarative JSON + optional script hook.** Each mission is a JSON file under `public/missions/<name>.json` matching the `Mission` schema (objectives, win/fail conditions, spawn, optional `scriptHook`). Combat (WP16) is the only mission expected to register a script hook (for AI enemy). The other three are declarative-pure.
- **D12 — HUD: DOM overlay.** CSS-absolute `<div>` over the canvas, with waypoint arrows via `THREE.Vector3.project()`. `HUD` interface boundary is the Phase 3 swap point if a Three.js ortho impl becomes needed.
- **D13 — β5 AoA-rate damping (`clAlphaDot`).** Schema extension on `AeroSurface` and `AircraftSurfaceConfig`; closes SURFACE-2026-05-11-04 architecturally; default 0 so existing 246 tests still pass; implementation lands in WP10.5.
**Phase:** 2
**Dependencies:** WP9
**Size:** S (actual: ~S — three decisions documented in one arch revision)
**Tasks:**
- [x] Decide mission framework shape — D11 (declarative JSON + script hook).
- [x] Decide HUD approach — D12 (DOM overlay).
- [x] Settle phugoid mechanism — D13 (β5 `clAlphaDot`).
- [x] Append `## Revision 2026-05-12` section to `docs/product/arch.md` with rationale, alternatives rejected, schema sketches, and Phase-3 swap points.
- [x] Update D11/D12/D13 highlights into `arch.md` "Key Decisions" list for discoverability.
- [x] Bump `wbs.md` Phase 2: insert WP10.5; lock WP11/WP12 specs to D11/D12; augment WP17 with phugoid probe.

### WP10.5: β5 (`clAlphaDot`) schema extension — DONE 2026-05-12
**Description:** Implements arch revision D13 — adds `clAlphaDot?: number` to `AircraftSurfaceConfig` and `AeroSurfaceConfig`, plumbs it through `parseAircraftConfig` → `AeroSurface` constructor, and augments `computeAeroForce`'s CL by `clAlphaDot · dα/dt` (finite difference over the fixed physics timestep). Default 0 → bit-for-bit parity with current 246-test suite. First-tick handling skips the augmentation (no previous-AoA reference). Same shape as WP6.5/WP6.6 schema extensions. Closes the **architectural** side of SURFACE-2026-05-11-04 (tuning side remains open per WP14/WP16/WP17). Shipped in commit `7b2018d` (arch revision commit `1410fb2`).
**Phase:** 2
**Dependencies:** WP10
**Size:** XS (actual: ~XS — single-pass build, no back-loops)
**Tasks:**
- [x] Add `clAlphaDot?: number` to `AircraftSurfaceConfig` and `AeroSurfaceConfig`; finite-number validation in `parseAircraftConfig`.
- [x] Thread through `flightmodel.ts` and `AeroSurface` constructor; add `prevAoA: number | undefined` field on the surface instance.
- [x] In `computeAeroForce`: triple-gated on `clAlphaDot !== 0` AND `dt !== undefined` AND `prevAoA !== undefined` — augmentation `CL += clAlphaDot · dα/dt`; `prevAoA` updated every call so the next finite difference is primed; first call always skips augmentation. Allocation-free.
- [x] `computeAeroForce(surface, body, dt?)` and `FlightModel.applyForces(throttle, dt?)` — dt threaded from `src/main.ts:65`. Optional argument preserves all existing test fixtures.
- [x] CONVENTIONS.md β5 paragraph appended after the β4 block — sign convention, physics-dt requirement, first-tick contract, setGeometry-resets-prevAoA invariant.
- [x] Tests: 7 new aero (default-zero parity, first-tick contract, constant-α zero augmentation, rising/falling α sign convention, dt-omitted gate, setGeometry resets prevAoA) + 3 new config-parse (absent / numeric / non-finite).
- [x] `aircraft.json` ships unchanged — default 0 → bit-for-bit Phase 1 parity preserved.
- [x] verify-auto: scoped vitest aerosurface.test + config.test 99/99 in 149ms; tsc strict clean.
- [x] verify-self: full Vitest 256/256 (was 246, +10 new β5); `npm run build` 152ms clean; `npm run test:e2e` 1/1 in 7.5s (WP9.5+9.6 regression anchor preserved); browser at `?debug=true` boots clean, `window.__aircraft.getState()` finite at 5s (position z=-157, aircraft moved 157m from spawn), zero NaN/Infinity in 128 console messages.
- [x] verify-codify: feature deliverable IS the codified regression suite; integration-boundary anchor is `tests/e2e/casual-flight.spec.ts` (already covers the consuming surface end-to-end).

### WP11: Mission framework — DONE 2026-05-12
**Description:** Core mission runner per **D11** (declarative JSON + optional script hook). `src/mission/loader.ts` loads `public/missions/<id>.json`; `src/mission/runner.ts` owns the lifecycle (load → start → tick → complete/fail) and reads aircraft state via the typed `AircraftState` interface (not via `window.__aircraft`). DOM mission-select screen per **D12** with return-to-select flow on win/fail. Script-hook registry under `src/mission/hooks/` (empty at ship — WP16 registers `combat-ai`). Aircraft now boots into mission-select; `?mission=<id>` deep-link auto-starts. Shipped in commit `690788a`.
**Phase:** 2
**Dependencies:** WP10, WP10.5
**Size:** M (actual: ~M — three phases, single-pass build, no back-loops)
**Tasks:**
- [x] `Mission` + `Objective` + `FailCondition` + `MissionStatus` + `SpawnConfig` + `MissionManifestEntry` types in `src/mission/types.ts` per arch.md Rev 2026-05-12 D11. `Vec3Plain` declared in `src/aircraft/state.ts` (dep direction: mission → aircraft) and re-exported from mission types.
- [x] `src/mission/parse.ts`: strict `parseMission` mirroring `parseAircraftConfig` style. Discriminated-union per `Objective.kind`. Default-fills `winCondition='all-objectives'` and `failCondition='crash'`. Rejects unknown top-level and sub-fields.
- [x] `src/mission/loader.ts`: `loadMission(id)` + `loadMissionList()` (static fetch from `public/missions/`).
- [x] `src/mission/runner.ts`: `MissionRunner` class — lifecycle (`start`, `tick(aircraft, dt)`, `getStatus()`, `getObjectiveStates()`, `getElapsed()`); declarative win/fail evaluation (all-objectives, timeout, out-of-bounds, crash with `CRASH_VSPEED_THRESHOLD=2`, OOB `±5000`). Event emitter (`on`/`off` for `objectiveChange | statusChange`). Hook fires BEFORE objective eval; reach-waypoint ordering enforced. Allocation-free per tick.
- [x] `src/mission/hooks/registry.ts`: name → `HookFn` registry. `registerHook`/`getHook`/`clearRegistry`. Duplicate-register throws.
- [x] `src/mission/select.ts`: minimal DOM overlay with `show`/`hide`/`onSelect`/`showOutcome` + bare-bones inline CSS. `data-testid` attributes for Playwright. Visual polish deferred to WP20.
- [x] `src/aircraft/state.ts`: `AircraftState` plain-data interface + `toAircraftState()` allocation-free adapter from `BodyState`. Decouples mission code from three.js classes.
- [x] `Aircraft.reset(position, linvel)` in `rigidbody.ts` + `FlightModel.resetSurfaceState()` (clears deflection + β5 prevAoA per WP10.5 invariant) for mission restart.
- [x] `public/missions/index.json` (manifest) + `public/missions/free-flight.json` (the framework-smoke mission — spawn matches the pre-WP11 hardcoded baseline bit-for-bit).
- [x] `src/main.ts` rewired: aircraft spawns at placeholder; mission-select renders on boot; `?mission=<id>` auto-starts; `startMission` does reset + start + unpause; `statusChange` listener drives return-to-select flow with brief outcome banner.
- [x] Tests: **93 new** — Phase 1 (51 unit: parse 24 + state 9 + loader 8 + registry 5 + reset 7), Phase 2 (30 unit: runner lifecycle/objectives/events/perf), Phase 3 (8 jsdom select + 3 e2e mission-select + 1 updated casual-flight e2e for the `?mission=free-flight&debug=true` compat path). 345/345 Vitest + 4/4 Playwright + tsc strict + build all clean.
- [x] verify-auto + verify-self + verify-codify all green per phase. Phase 3 integration boundary covered by both updated `casual-flight.spec.ts` (WP9.6 regression anchor preserved) and new `mission-select.spec.ts`. Live browser subagent confirmed all 4 Phase 3 browser outcomes PASS.
- [x] Dev dep added: `jsdom` (vitest peer-dep for DOM tests; additive only).

### WP12: HUD — DONE 2026-05-12
**Description:** In-mission HUD per **D12** (DOM overlay, CSS-absolute `<div>` over the canvas). `src/hud/dom-hud.ts` implements the `HUD` interface (`setAircraftState`, `setThrottle`, `setObjective`, `setWaypointArrow`, `setStatus`, `show`/`hide`). Waypoint arrow positioned each frame via `THREE.Vector3.project()` with allocation-free module-scoped scratch. The interface boundary is the Phase 3 swap point per arch.md. Plan-time decision: `setThrottle` is a separate setter (not part of `AircraftState`) to keep physics-readout and controls-input layers cleanly separated. Shipped in commit `dd9c0ed`.
**Phase:** 2
**Dependencies:** WP10
**Size:** S (actual: ~S — three phases, single-pass build, no back-loops)
**Tasks:**
- [x] `src/hud/HUD.ts`: interface declaration per arch.md Rev 2026-05-12 D12 + `HudStatus = 'flying' | 'won' | 'failed'` union + separate `setThrottle` setter.
- [x] `src/hud/dom-hud.ts`: `DomHud` class — cached DOM nodes for altitude/airspeed/throttle/objective/status-banner/waypoint-arrow. Constructor `(camera, canvasEl, opts?)`. Inline-CSS injection on first `show()` (mirrors `mission/select.ts` pattern). Idempotent show/hide. No-op-before-show contract. Number formatting: rounded integers (alt/airspeed in m, throttle in %).
- [x] `setWaypointArrow(worldPos)`: module-scoped scratch `THREE.Vector3` projects worldPos to NDC; `ndc.z > 1` (behind camera) OR `|ndc.x|>1` OR `|ndc.y|>1` (off-screen) → hide; otherwise compute screen-px via `(ndc.x*0.5+0.5)*canvasW` / `(-ndc.y*0.5+0.5)*canvasH`. Allocation-free.
- [x] CSS inline-injected at first `show()` (no separate stylesheet) — bare-bones layout per WP20 deferral; HUD hidden until `show()` per interface contract.
- [x] Tests: 21 jsdom tests on `dom-hud.test.ts` (set-method DOM effects, show/hide idempotency, no-op-before-show, 8 projection cases against real `PerspectiveCamera`). 8 unit tests on `format.test.ts` for `formatActiveObjective` (3 objective kinds, completed-destroy-target null, zero/all-complete/missing-state).
- [x] `src/main.ts` wired: per-frame `setAircraftState` + `setThrottle` + `setWaypointArrow(null)` gated on running mission; `objectiveChange`/`statusChange` listeners drive `setObjective`/`setStatus`; `startMission` calls `show` + initial setters; outcome flow calls `hide` before mission-select re-renders.
- [x] `tests/e2e/hud.spec.ts` (Playwright): 2 specs — HUD absent on mission-select page, HUD shows numeric alt/airspeed/throttle and hides banner/arrow/objective during free-flight.
- [x] All four verify-* gates passed each phase. 374/374 Vitest (was 345, +29 hud) + 6/6 Playwright (was 4, +2 hud) + tsc strict + build clean. Live browser subagent at `/` and `/?mission=free-flight` confirmed HUD lifecycle works end-to-end (alt=62, airspeed=15, throttle=0, banner/arrow/objective hidden, console clean).

### WP13: Free flight mission — DONE 2026-05-12
**Description:** No objectives — just fly around the map. Baseline mission type; validates the framework with the simplest case. Mission JSON shipped at WP11 (`public/missions/free-flight.json`); HUD overlay shipped at WP12. WP13 closed by adding the player-initiated abort path: Escape key returns from running mission to mission-select without falsely showing the "MISSION FAILED" banner. Implementation: new `'returnToMenu'` action (`'Escape'`) in `DEFAULT_KEY_MAP`, `MissionRunner.abort()` + `wasAborted()`, main.ts statusChange listener branches on `wasAborted()` to bypass outcome banner. Atomic task — shipped via task workflow, not feature workflow.
**Phase:** 2
**Dependencies:** WP11, WP12
**Size:** XS (actual: ~XS — single-pass task, ~80 LOC including tests)
**Tasks:**
- [x] Mission definition: free-flight.json (shipped at WP11 — zero objectives, infinite duration via no timeout/oob bounds).
- [x] Exit condition: Escape key triggers `runner.abort()`; main.ts skips the outcome banner when `wasAborted()` is true; mission-select re-renders silently.

### WP14: Waypoint mission — DONE 2026-05-12 (reduced scope per SURFACE-2026-05-12-01)
**Description:** Ordered reach-waypoint navigation with timeout fail. Two ordered waypoints at descending altitude (y=30→y=20, z=-150→z=-250, radius=100m each), spawn throttle=0, timeoutSec=30. Glide-reachable mission scope. The original plan (4-waypoint patrol loop with spawn throttle=0.4 for sustained flight) hit SURFACE-2026-05-11-04 phugoid-NaN within ~3s of mission start — the two-SURFACE dual (cannot mitigate descending-glide without surfacing phugoid divergence at this airframe) forced a back-loop. Ship-side close: mission within the working envelope; tuning-side close (non-zero `clAlphaDot`) is the new SURFACE-2026-05-12-01 → likely WP14.5 (analogous to WP10.5 schema-extension WP). Shipped in commit `a64b115`.
**Phase:** 2
**Dependencies:** WP11, WP12
**Size:** S (actual: ~S — F9b back-loop after initial verify-self NaN; 2-phase build; 1 SURFACE event escalated to WBS)
**Tasks:**
- [x] Mission JSON: 2 ordered `reach-waypoint` objectives per D11 schema; `failCondition: 'timeout'`, `timeoutSec: 30`. Spawn throttle=0 (glide envelope, post-back-loop).
- [x] Runner ordering enforcement: verified end-to-end at /?mission=waypoint-patrol (HUD shows "Fly to waypoint (1/2)" → "(2/2)" as the player progresses).
- [x] HUD waypoint-arrow: `getActiveWaypointPosition(objectives, states)` in `src/hud/format.ts` feeds `hud.setWaypointArrow` each frame in `main.ts onRender`. 6 unit tests. E2E asserts arrow element renders in DOM at /?mission=waypoint-patrol.
- [x] Win/fail wiring: runner already handles all-objectives win + timeout fail (WP11). End-to-end works via existing statusChange listener.
- [ ] (Deferred to WP14.5) Non-zero `clAlphaDot` tuning — SURFACE-2026-05-12-01 logged. WP14 ships within the glide envelope; sustained-throttle patrols wait on the tuning pass.

### WP14.6: Physics-core extraction + harness↔browser parity test — DONE 2026-05-12 (afternoon)
**Description:** First WP in the D14 cascade (arch.md Rev 2026-05-12 afternoon §D14.2 + §D14.3). File-move reorg: extract framework-agnostic flight model into `src/aircraft/physics-core/` so the same code can run in Node and the browser. `rigidbody.ts` stays in `src/aircraft/` as the Three.js-mesh-binding wrapper; the Rapier-only `rigidbody-core.ts` lives under `physics-core/`. Add a harness↔browser **parity test** that asserts bit-identical trajectories (`|Δ|<1e-6` per scalar) across the WASM boundary for the WP14.5 throttle fixtures (0.05/0.15/0.4 from `(0,50,0)` linvel `(0,0,-30)` for 1800 ticks). Parity test runs in CI; protects against drift between harness (Node) and shipped (browser) physics. **No behavioral change** in the browser — pure file moves + new test artifacts.
**Phase:** 2
**Dependencies:** WP10.5 (β5 schema — physics-core depth-locks the surface schema we extract); WP14 (last mission shipped before the pause)
**Size:** M
**Tasks:**
- [x] Split criterion refined intent-based ("requires a browser API to run", not literal "imports three") — Vector3/Quaternion math-only allowed under physics-core/. Operator-approved at plan-time.
- [x] Moved 4 source files + their tests into `src/aircraft/physics-core/` via `git mv` (blame preserved). Added `rigidbody-core.ts` (Rapier-only `AircraftBody`) and `step.ts` (composable single-tick driver).
- [x] `src/aircraft/rigidbody.ts` `Aircraft extends AircraftBody`; keeps Three.js mesh ownership + `syncMesh`. Public API surface bit-identical.
- [x] Updated all importers across `src/`. Plan-time grep missed `src/mission/hooks/registry.ts` (one level deeper) — caught by `tsc --noEmit`, fixed. 385/385 Vitest post-move.
- [x] Added `tests/e2e/parity.spec.ts` driving `window.__aircraft.runFixture()`; produces `test-results/browser-trajectory-<id>.csv` (1800 rows + header in 1.1s wall-clock — 27× browser-side preview of harness speedup).
- [x] Added `tests/parity-diff.test.ts` (Vitest) with in-process synthetic stub (Rapier-WASM in Node, `AircraftBody` directly without Three.js). Bit-identical across 1800 ticks at `|Δ|<1e-6`. Caught a real production bug (`Aircraft.reset()` not clearing Rapier force/torque accumulators) — fixed in same WP.
- [x] CONVENTIONS.md: new `### src/aircraft/physics-core/ boundary` subsection documents the intent-based split rule, allowed/disallowed class lists, and the parity test as enforcement mechanism.
- [x] Acceptance: 402/402 Vitest (was 385, +17 — step.test.ts 4 + trajectory-buffer.test.ts 12 + parity-diff.test.ts 1) · 10/10 Playwright (was 9, +1 parity emitter) · tsc strict · build clean.
- [x] Bonus: widened `FlightModel`'s constructor parameter from `Aircraft` to `AircraftBody` so the harness can construct it without the Three.js wrapper.

### WP14.7: Node harness — single-probe driver — DONE 2026-05-16
**Description:** Second WP in the D14 cascade (arch.md Rev 2026-05-12 afternoon §D14.1). `tools/tune/harness.ts` boots Rapier-WASM in Node, loads `aircraft.json`, takes initial conditions + parameter overrides + tick-count from CLI args, steps the physics-core `step.ts` in a tight loop, emits a trajectory CSV. No optimizer — this is the deterministic inner loop the optimizer will call repeatedly. Acceptance gate is parity (WP14.6's test must keep passing using the harness as the Node-side trajectory source — i.e., the WP14.6 parity-diff test consumes harness output, not a synthetic stub).
**Phase:** 2
**Dependencies:** WP14.6 (physics-core split must land first)
**Size:** M
**Tasks:**
- [x] Add `tsx` as devDep (zero-config TS-on-Node). Add `tsconfig.tools.json` extending the root tsconfig but targeting Node module resolution if Vite's tsconfig doesn't reach `tools/`.
- [x] `tools/tune/harness.ts`: imports from `src/aircraft/physics-core/`; constructs a Rapier world; steps fixed-dt=1/60s; emits CSV columns `tick, posX, posY, posZ, vX, vY, vZ, pitch, yaw, roll, airspeed`.
- [x] CLI argument shape: `--fixture <name>` (selects one of the seeded fixtures), `--ticks <N>`, optional `--params <k=v,...>` for parameter overrides on `aircraft.json` knobs (deep-paths like `surfaces.wings.clAlphaDot=5`), optional `--out <path>` (default stdout).
- [x] Fixture set seeded: at minimum `throttle-low` (0.05), `throttle-mid` (0.15), `throttle-high` (0.4), all spawning at `(0,50,0)` linvel `(0,0,-30)`. Same initial conditions as the existing WP14.5 phugoid-probe missions.
- [x] `package.json`: `"harness": "tsx tools/tune/harness.ts"`. Sanity smoke: `npm run harness -- --fixture throttle-mid --ticks 60 --out -` produces a 61-row CSV (tick 0..60).
- [x] Determinism check: run the same fixture twice, diff output — must be byte-identical.
- [x] Wire WP14.6's `tests/parity-diff.test.ts` to consume harness output (replace synthetic stub if used). Parity must hold.
- [x] Vitest covers: CLI arg parsing, parameter-override deep-path application, CSV row format, determinism (same inputs → byte-identical output across runs).
- [x] `.gitignore` extension: `tools/tune/results/`.
- [ ] Acceptance: harness produces deterministic CSV; parity test still green; 385/385+ Vitest green; tsc strict clean.

### WP14.8: Score function + Nelder-Mead optimizer + CLI
**Description:** Third WP in the D14 cascade (arch.md Rev 2026-05-12 afternoon §D14.4 + §D14.5). The "search" half of the harness — turns WP14.7's single-probe driver into a parameter-space search. `tools/tune/score.ts` implements the envelope-probing fitness (NaN-penalty with time-to-NaN gradient encoding, altitude/airspeed/pitch-rate envelopes, phugoid growth penalty, multi-regime weighted sum). `tools/tune/optimizer.ts` implements Nelder-Mead with K=4 random restarts and local quadratic regression on the best simplex (for human-readable convergence diagnosis). `tools/tune/tune.ts` is the CLI entry that ties them together and emits results JSON.
**Phase:** 2
**Dependencies:** WP14.7 (harness must be callable as a function from `tune.ts`)
**Size:** M
**Tasks:**
- [ ] `tools/tune/score.ts`: implements `score(trajectoryByRegime, envelopeConsts)` per D14.4. NaN penalty = `-1e9 - tick_of_first_NaN` so optimizer has gradient toward later-NaN regions. Envelope constants live at top of file with comments — easy to tune.
- [ ] Vitest coverage of score: synthetic trajectories (level cruise = high score, mild oscillation = mid, divergent NaN = low + tick-of-NaN encoded). At minimum: nominal trajectory, NaN-at-tick-N trajectory, phugoid trajectory, pitch-rate-blowup trajectory. ≥6 cases.
- [ ] `tools/tune/optimizer.ts`: Nelder-Mead simplex (reflect, expand, contract, shrink) over a normalized parameter space `[0,1]^N`; per-run normalization back to user-given bounds. Random-restart from K=4 seeded starts. Quadratic-regression fit (`a + bᵀΔp + ΔpᵀCΔp`) on best simplex at convergence; emit fit coefficients in results.
- [ ] Stopping criteria per D14.5: `SCORE_TOL=1e-3` over 30 iter; `PARAM_TOL=1e-4` in normalized space; `MAX_ITER=500` per restart.
- [ ] Vitest coverage of optimizer: known objective functions (Rosenbrock, sphere, Booth) — assert convergence to known optima within tolerance. Determinism: same seed → identical result.
- [ ] `tools/tune/tune.ts`: CLI entry. Argument shape: `--knobs <deep-path,deep-path>`, `--bounds <lo..hi,lo..hi>`, `--regimes <low,mid,high>` (uses harness fixtures by name), `--restarts <K>` (default 4), `--seed <N>` (for reproducibility), `--out <path>` (default `tools/tune/results/<timestamp>.json`).
- [ ] Results JSON shape: `{ params: {...best}, score: <number>, convergenceTrace: [...], regression: { gradient, hessian, conditionNumber }, restarts: [...per-restart-final] }`. Each restart's final state recorded so we can see whether they all agreed.
- [ ] `package.json`: `"tune": "tsx tools/tune/tune.ts"`.
- [ ] CLAUDE.md update: append rule #3 (per D14.6) to the existing "Physics-mechanism discipline" subsection — physics-mechanism tuning runs through `npm run tune`, not hand-guessing.
- [ ] Acceptance: synthetic-objective optimizer tests green; smoke `npm run tune -- --knobs surfaces.wings.clAlphaDot --bounds 0..1 --regimes mid --restarts 1 --seed 42` runs end-to-end and emits a results JSON; tsc strict + build clean.

### WP14.5: `clAlphaDot` tuning pass via harness (rescoped)
**Description:** Tuning-side close of SURFACE-2026-05-11-04 + SURFACE-2026-05-12-01, now driven by the WP14.8 harness optimizer. Per arch.md Rev 2026-05-12 (afternoon) §D14.8, replaces the original hand-guessing approach. Run `npm run tune -- --knobs surfaces.wings.clAlphaDot,surfaces.hstab.clAlphaDot --bounds -10..20,-10..20 --regimes low,mid,high --restarts 4`; commit the result only if score crosses an explicit acceptance threshold (defined at plan time). If no parameter point in the searched space produces a passing score across all three regimes, escalate to mechanism revision (Options A/B/C in SURFACE-2026-05-12-03) — now with regression-gradient evidence from the optimizer's results JSON to argue which option is best. The harness becomes the experiment platform for A/B/C comparison if it comes to that.

**Original attempts (archived — historical record).** WP14.5 first ran as a hand-guessing tuning pass on 2026-05-12 (before the D14 arch revision). Three attempts — wings/h-stab `clAlphaDot` at +5/+10, +1/+2, -1/-2 — all diverged catastrophically in every operating regime tested (≤2s NaN at low+mid throttle; high throttle worse, not better). Closed via option-c (revert config, surface SURFACE-2026-05-12-03 for mechanism revision). The session-pause note and the archived plan at `workflow/archive/wp14.5-cl-alpha-dot-tuning.md` carry the full retrospect including the WP10.5 sign-convention test now classified as an over-claim. The D14 arch revision was the response.

**Phase:** 2
**Dependencies:** WP10.5 (β5 schema), WP14 (first mission that needs it), WP14.8 (harness optimizer)
**Size:** S–M (one-to-two optimizer runs + acceptance evaluation; M-end if mechanism-revision escalation triggers)
**Tasks:**
- [ ] Plan-time: define acceptance threshold for the score (e.g., "all three regimes ≥ -100; no regime NaN"). Threshold sits in the WIP file, NOT in `score.ts`.
- [ ] Run `npm run tune` per the command above (or with refined bounds based on intuition); commit the results JSON to `tools/tune/results/` (not gitignored for this run).
- [ ] If score crosses threshold: write the optimizer's best `clAlphaDot` values into `aircraft.json`; verify via the existing `tests/e2e/phugoid-probe.spec.ts` (currently `test.skip`'d) — un-skip it; run; assert green.
- [ ] If score does not cross threshold across all 3 regimes: do NOT commit `aircraft.json` change. Surface as mechanism-revision WP (SURFACE-2026-05-12-03 Options A/B/C). Attach the optimizer's regression Hessian + per-regime trajectories to the SURFACE entry to make the option choice data-driven.
- [ ] verify-self in browser at `/?mission=waypoint-patrol`: confirm no regression on the WP14 glide envelope (clAlphaDot must be no-op for the descending-glide regime per `feedback_asymmetric_fix_no_op.md`).
- [ ] Update SURFACE-2026-05-12-01 + SURFACE-2026-05-11-04 status in `workflow/backlog.md` based on outcome (Resolved if shipped; updated-pending if escalated to mechanism revision).

### WP15: Takeoff/landing mission
**Description:** Airfield with a runway. Detect wheels-down on runway within bounds + safe vertical speed. Objective: take off, pattern around, land.
**Phase:** 2
**Dependencies:** WP11, WP12
**Size:** M
**Tasks:**
- [ ] Runway collider + bounds
- [ ] Touchdown detection: velocity + position + orientation thresholds
- [ ] Objective phases: take off → reach altitude → return → land
- [ ] HUD: current phase, glideslope indicator (optional)

### WP16: Combat mission
**Description:** Biggest Phase 2 risk (R6). Keep minimal per research: one simple AI enemy (air or ground), one weapon, hit detection, damage model. No AI pathfinding beyond "fly toward / turn toward player." Per **D11**, this is the only Phase 2 mission expected to register a `scriptHook` — the AI enemy logic lives in `src/mission/hooks/combat-ai.ts`. The internal AI architecture (behavior tree vs FSM) is a WP16-internal decision; arch.md does not pre-commit.
**Phase:** 2
**Dependencies:** WP11, WP12
**Size:** L
**Tasks:**
- [ ] Weapon: forward-firing projectile (gun or simple missile — pick one)
- [ ] Projectile lifecycle: spawn, raycast or collider, hit, despawn
- [ ] AI enemy: one target entity (stationary ground target OR minimally-AI aircraft). If aircraft, reuse flight model with a dumb "turn to face player" controller.
- [ ] Damage model: hitpoints on player + enemy; destruction state
- [ ] `src/mission/hooks/combat-ai.ts` registered with the hook registry per D11.
- [ ] Mission JSON: `scriptHook: 'combat-ai'` + a `destroy-target` objective.
- [ ] Win: enemy destroyed. Fail: player destroyed.

### WP17: Phase 2 verification
**Description:** All four mission types playable end-to-end via mission-select. Exit-criteria check. Adds a ≥30s level-cruise probe per arch.md Rev 2026-05-12 D13 to validate β5 (`clAlphaDot`) damping under non-zero throttle, since phugoid behavior hides in single-period observation.
**Phase:** 2
**Dependencies:** WP13, WP14, WP15, WP16
**Size:** S
**Tasks:**
- [ ] End-to-end mission-select → play → win/lose → return-to-select for each of the four mission types.
- [ ] ≥30s Playwright probe at non-zero throttles (`0.05`, `0.15`, `0.4`) — assert bounded |altitude − spawn| and bounded pitch oscillation across the full window. Phugoid coverage per D13. (Memory `feedback_verify_self_envelope.md` applies.)
- [ ] FPS check at Chromium across all four mission types (cross-browser sweep remains WP21).

---

## Phase 3 — v1 Ship

### WP18: Onboarding pass
**Description:** New player is flying within 30s. No tutorial — in-world prompts only. First-load UX.
**Phase:** 3
**Dependencies:** WP17
**Size:** M
**Tasks:**
- [ ] Boot directly into a "just fly" state or a 1-screen mission select (test both)
- [ ] On-screen key hints fade in during first minute
- [ ] Preload Rapier WASM in parallel with splash (mitigates R1)
- [ ] Timed test: stopwatch from URL-open to airborne

### WP19: Audio
**Description:** Engine, wind, weapon, crash sounds. Web Audio API. Guard for Safari latency (R4).
**Phase:** 3
**Dependencies:** WP17
**Size:** S
**Tasks:**
- [ ] Engine loop scaled by throttle
- [ ] Wind tied to airspeed
- [ ] Weapon fire + impact SFX (if combat)
- [ ] Crash SFX
- [ ] Safari audio check

### WP20: Visual polish pass
**Description:** Replace placeholders. Nicer skybox, textured terrain (optional terrain upgrade to heightmap — swap via `terrain.ts` interface), better aircraft GLTF, basic particle effects (contrails, explosions, gunfire).
**Phase:** 3
**Dependencies:** WP17
**Size:** L
**Tasks:**
- [ ] Skybox: chosen art direction, 6 hi-res faces
- [ ] Terrain: decide upgrade vs keep flat (swap heightmap impl if upgrade)
- [ ] Aircraft: final GLTF with materials, animated control surfaces
- [ ] Particles: contrails, explosion, muzzle flash
- [ ] Lighting: directional sun + ambient

### WP21: Cross-browser QA
**Description:** Chrome, Safari, Firefox latest on desktop. 60fps on mid-range laptop. Fix compat regressions.
**Phase:** 3
**Dependencies:** WP18, WP19, WP20
**Size:** S
**Tasks:**
- [ ] Test each mission in each browser
- [ ] FPS meter on mid-range hardware (user's existing laptop is the reference machine)
- [ ] Input feel check (mouse sensitivity differs per browser)
- [ ] WASM load on slow connection (throttled network in devtools)

### WP22: Deploy + share
**Description:** Pick a static host (Vercel / Netlify / Cloudflare Pages — equivalent), deploy, public URL.
**Phase:** 3
**Dependencies:** WP21
**Size:** XS

### WP23: Playtesting
**Description:** 3–5 casual players open the URL and complete a mission without help. Record observations; loop back if any mission is unclear.
**Phase:** 3
**Dependencies:** WP22
**Size:** S

---

## Dependency map (critical path)

```
WP1 ─► WP2 ─► WP3 ─┐
  │                │
  └─► WP4 ─► WP5 ──┼─► WP6 ─► WP6.5 ─► WP7 ─► WP9 ─► WP10 ─► WP10.5 ─► WP11 ─┬─► WP13 ─┐
                   │                                                          ├─► WP14 ─► WP14.6 ─► WP14.7 ─► WP14.8 ─► WP14.5(retry)
WP1 ─► WP8 ────────┘                                              WP10 ─► WP12          │                                            │
                                                                                         └────────┐                                   │
                                                                                                  ├─► WP15 ─┐                         │
                                                                                                  └─► WP16 ─┼─► WP17 ─► WP18 ─► WP21 ─► WP22 ─► WP23
                                                                                                            │                  ▲
                                                                                                            │                  │
                                                                                                      WP17 ─► WP19 ────────────┤
                                                                                                      WP17 ─► WP20 ────────────┘
```

**Critical path (longest chain to ship — updated 2026-05-12 afternoon for D14 cascade):**
`WP1 → WP4 → WP5 → WP6 → WP6.5 → WP7 → WP9 → WP10 → WP10.5 → WP11 → WP14 → WP14.6 → WP14.7 → WP14.8 → WP14.5(retry) → WP16 → WP17 → WP20 → WP21 → WP22 → WP23`

The D14 cascade (WP14.6 + WP14.7 + WP14.8 + WP14.5-retry) adds ~3 M-sized WPs between WP14 and WP15/WP16, totalling ~2 days of agent work before Phase 2 mission content resumes. The trade is paid once and amortized across every subsequent physics-tuning WP (WP14.5-retry, any future βN coefficient tuning in WP15/WP16/Phase 3 polish). WP7 (flight-feel tuning) and WP16 (combat) remain the two heaviest *mission-side* items on the critical path; the harness cascade is now the third heavyweight block.

**Parallel tracks** within Phase 1: WP4+WP5 can proceed in parallel with WP2+WP3+WP8 after WP1 lands. **Within the D14 cascade,** the three harness WPs are strictly sequential — WP14.7 needs WP14.6's physics-core extraction, WP14.8 needs WP14.7's single-probe driver. Only WP15 (takeoff/landing) can in principle run in parallel with the cascade since WP15 lives in the glide envelope and does not strictly depend on β5 tuning; per operator directive that parallel track is **not opened** — Phase 2 mission content is paused until the harness lands.

## Architectural gaps found

None that require a P8 back-loop on this pass. The D14 cascade landed in this WBS revision IS the consumed output of the P12-arch-back-loop that triggered Revision 2026-05-12 (afternoon); no additional gaps surfaced while decomposing it. WP10 closed 2026-05-12 (morning) as the planned Phase 1→2 arch revision (D11/D12/D13); WP10.5 shipped the β5 schema. D14 (afternoon) added the harness/optimizer methodology to address SURFACE-2026-05-12-03; the cascade WPs (14.6/14.7/14.8 + rescoped 14.5) are all decision-locked to arch.md §D14.1–§D14.9.

Phase 2 WPs are now decision-locked. The CLAUDE.md update for D14.6 (the new tuning-workflow rule) is scheduled inside WP14.8's task list rather than via a separate `/product-context` pass, since CLAUDE.md was already refreshed at the Phase 1→2 boundary and the D14 rule is a single bullet under the existing "Physics-mechanism discipline" subsection.

Next: drive into the D14 cascade. WP14.6 is the first work-package (physics-core extraction + parity test). Under full-autopilot the orchestrator transitions P9 → cross-workflow EXIT→feature:plan with WP14.6 as the entry unit.

## Session Pause — 2026-05-09 09:05
Paused after WP6 finalize. See `workflow/.session.md` to resume.

## Session Pause — 2026-05-11 15:20
Paused at end-of-cycle. WP1–WP8 all shipped; only WP9 (Phase 1 verification) remains for Phase 1. See `workflow/.session.md` to resume.

## Session Pause — 2026-05-11 20:35
Paused after WP9 ran-and-blocked + WP9.5 shipped + session-reflect + 3 learnings persisted. Operator pause to decide between re-running WP9 verify, adopting @playwright/test, or other. See `workflow/.session.md` to resume.

## Session Pause — 2026-05-11 21:10
Paused after WP9.6 shipped + finalized (commits 70b2c2b + d6d1c0e). Phase 1 closed at the Chromium-only / operator-as-tester bar. Both operator-requested options shipped. Next unit is WP10 (Phase 2 arch revision — mission framework + HUD approach), which requires operator architectural input — paused per orchestrator cross-workflow rule §5 + operator's "absolutely necessary" escalation clause. See `workflow/.session.md` to resume.

## WBS Update — 2026-05-12 (Phase 2 arch revision)
WP10 closed under operator-as-architect (full-autopilot deviation per `feedback_operator_as_external.md`). Three architectural decisions landed in `arch.md` Revision 2026-05-12: **D11** (declarative-JSON missions + optional script hook), **D12** (DOM-overlay HUD), **D13** (β5 `clAlphaDot` AoA-rate damping — closes SURFACE-2026-05-11-04 architecturally). WBS updates: WP10 marked DONE; **new WP10.5** inserted as the β5 schema-extension WP (XS); WP11/WP12/WP14/WP16/WP17 task lists locked to the binding D11/D12/D13 specs; WP17 augmented with a ≥30s phugoid probe per D13. Critical path now: `... → WP10 → WP10.5 → WP11 → WP16 → ...`. Phase 1 entries (WP1–WP9.6) unchanged.

## WP10.5 Shipped — 2026-05-12
β5 `clAlphaDot` schema extension landed in commits `1410fb2` (arch revision) + `7b2018d` (code + tests). Single-pass build with no back-loops. 256/256 Vitest + 1/1 Playwright + tsc strict + build clean. Default 0 preserves Phase 1 bit-for-bit parity. SURFACE-2026-05-11-04 moved to "partial — architectural side resolved; tuning side pending Phase 2 (WP14/WP16/WP17)". Next WP: **WP11** (mission framework, D11) or **WP12** (HUD, D12) — parallel-trackable.

## WP11 Shipped — 2026-05-12
Mission framework — declarative-JSON missions + DOM mission-select + MissionRunner lifecycle — landed in commit `690788a`. Three phases, single-pass build, no back-loops. 24 files changed (+2937 LOC). 345/345 Vitest (was 256, +89) + 4/4 Playwright + tsc strict + build clean. WP9.6 casual-flight regression anchor preserved via `?mission=free-flight&debug=true` compat path. Live integration verified end-to-end (mission-select renders, click → run, deep-link auto-start, invalid id → error fallback). Hook registry empty (WP16 will register `combat-ai`). Next: **WP12** (HUD, D12) — parallel-trackable, since the runner already emits `objectiveChange`/`statusChange` events that the HUD will consume. Then WP13–WP16 mission content (each ships its own JSON; WP16 adds the one script hook).

## Session Pause — 2026-05-12 09:55
Paused at the post-WP11 fork. WP10 + WP10.5 + WP11 all shipped this session (full-autopilot). Operator chose to pause rather than continue. See `workflow/.session.md` to resume — live options listed there (WP12 HUD next is the natural pick).

## WP12 Shipped — 2026-05-12
HUD (DOM overlay per D12) — `src/hud/HUD.ts` interface + `src/hud/dom-hud.ts` implementation + `src/hud/format.ts` helper + main.ts wiring — landed in commit `dd9c0ed`. Three phases, single-pass build, no back-loops. 8 files changed (+712 LOC). 374/374 Vitest (was 345, +29 hud) + 6/6 Playwright (was 4, +2 hud) + tsc strict + build clean. Live browser subagent verified HUD lifecycle end-to-end at `/` + `/?mission=free-flight`. Next: WP13 (free flight, XS — could be a small task or WBS mark-done; framework already validates), WP14 (waypoint, S — needs WP12 ✓ now), WP15 (takeoff/landing, M), WP16 (combat, L). Phase 2 verification (WP17) blocked until all four mission types playable.


## WP13 Shipped — 2026-05-12
Free flight closure via task workflow — Escape-key player-initiated abort path. Mission JSON shipped at WP11; HUD at WP12; this is the missing player exit per WBS task list. New `'returnToMenu'` ActionName mapped to Escape; `MissionRunner.abort()` + `wasAborted()`; main.ts statusChange listener branches on wasAborted to bypass the "MISSION FAILED" banner. Commit `cdeb77a`. 379/379 Vitest (+5) + 7/7 Playwright (+1) + tsc strict + build clean. Roadmap milestone "Free flight mission" now checked off.

## WP14 Shipped — 2026-05-12 (reduced-scope; WP14.5 logged)
Waypoint patrol mission — 2 ordered reach-waypoints at descending altitude, glide-reachable from spawn, 30s timeout. Helper `getActiveWaypointPosition` in `src/hud/format.ts` feeds the HUD waypoint-arrow each frame in main.ts onRender. Commit `a64b115`. 385/385 Vitest (+6 helper) + 9/9 Playwright (+2 WP14) + tsc strict + build clean.

**Back-loop captured:** initial plan set spawn throttle=0.4 to mitigate SURFACE-2026-05-11-02 descending-glide. Verify-self at /?mission=waypoint-patrol hit NaN within ~3s — the SURFACE-2026-05-11-04 phugoid divergence under non-zero throttle forcing. The two open SURFACE items are dual at this airframe (cannot mitigate -11-02 without surfacing -11-04). Ship-side response: mission scope reduced to a glide-reachable short patrol; tuning-side close (non-zero `clAlphaDot`) logged as new SURFACE-2026-05-12-01 → **WP14.5** inserted into WBS as the tuning-pass WP (analogous to WP10.5 schema-extension). High-energy/longer patrols wait on WP14.5.

Next: **WP14.5** (clAlphaDot tuning — unblocks WP15 takeoff/landing + WP16 combat too), then WP15 (takeoff/landing, M), WP16 (combat, L), WP17 (Phase 2 verification).

## Session Pause — 2026-05-12 11:36
Paused after WP14 ship+finalize+reflect. Five WPs shipped this session (WP12 HUD, WP13 free-flight close, WP14 waypoint patrol) plus WP10/10.5/11 from earlier in the day = 10 commits, working tree clean. Operator chose WP14.5 (clAlphaDot tuning pass per SURFACE-2026-05-12-01) as the next unit. See `workflow/.session.md` to resume.

## Session Pause — 2026-05-12 12:52
Paused after WP14.5 close + reflect + store-learning. WP14.5 disposition: **option-c** — 3 tuning attempts (+5/+10, +1/+2, -1/-2) all diverged catastrophically; β5 mechanism is dimensionally mismatched (raw `dα/dt`, no V-normalization). Surfaced SURFACE-2026-05-12-03 (high-priority arch revision with 3 candidate fixes — non-dimensional form / magnitude clamp / sign-flip). Also surfaced SURFACE-2026-05-12-02 (low-priority test-mission pollution). CLAUDE.md updated with two physics-mechanism discipline rules (commit `679521f`). Next decision deferred to operator at resume: WP14.5 retry via D14 arch revision, OR WP15 takeoff/landing (works in glide envelope, doesn't need β5 fix), OR WP16 combat. See `workflow/.session.md` to resume.

## WBS Update — 2026-05-12 (afternoon) — D14 cascade

Operator on resume reframed the WP14.5 close: not just "the β5 mechanism is wrong" but "we lack a systematic way to search physics parameter space at all." Three hand-driven Playwright probes is the right discipline for *refuting* a mechanism, but it's far too sparse to *find* parameter values in a continuous space. Operator routed to `/product-arch` for D14, accepted a major detour (~2 days of agent work), and paused Phase 2 mission progress at the post-WP14 line.

**D14 landed in arch.md** as Revision 2026-05-12 (afternoon) — physics tuning harness + automated parameter search. Nine sub-decisions (D14.1–D14.9): Rapier-in-Node (not pure-TS re-impl), `src/aircraft/physics-core/` module extraction, harness↔browser parity test as drift guard, envelope-probing score function with NaN-time-gradient encoding, Nelder-Mead + K=4 restarts + quadratic regression on best simplex, tuning workflow change codified for CLAUDE.md.

**WBS changes:**
- **WP14.5 rescoped** — original hand-guessing attempts archived in-entry as historical record (3 attempts +5/+10, +1/+2, -1/-2 all diverged; closed option-c per `feedback_retune_attempt_budget.md`). Active scope swapped to "run `npm run tune` against β5; if score crosses acceptance threshold ship the values, else escalate to mechanism revision (Options A/B/C in SURFACE-2026-05-12-03) with regression-gradient evidence."
- **WP14.6 inserted** (M) — extract `src/aircraft/physics-core/` framework-agnostic core; add harness↔browser parity test (`|Δ|<1e-6` per scalar, in CI).
- **WP14.7 inserted** (M) — Node harness single-probe driver (`tools/tune/harness.ts`); Rapier-WASM in Node; deterministic CSV emission; `npm run harness`.
- **WP14.8 inserted** (M) — score function (`tools/tune/score.ts`) + Nelder-Mead optimizer with random restarts and quadratic regression (`tools/tune/optimizer.ts`) + CLI (`tools/tune/tune.ts`); `npm run tune`. Includes CLAUDE.md update for "Physics-mechanism discipline" rule #3.

**Critical path updated** to include the D14 cascade: `… → WP14 → WP14.6 → WP14.7 → WP14.8 → WP14.5(retry) → WP16 → WP17 → …`. WP15 (takeoff/landing, M) could in principle parallel-track the cascade since it lives in the glide envelope; per operator directive that track is **not opened** — Phase 2 mission content waits for harness.

**Why this is the right detour cost.** Three attempts in WP14.5 burned ~hours and produced 3 sparse points in a 2-knob × 3-regime space. The harness will eval hundreds of points in seconds-to-minutes per `npm run tune` invocation, with deterministic gradient signal for the optimizer and regression evidence for the human reviewer. Net amortization: every future physics-tuning WP (WP14.5-retry, WP15 if it surfaces tuning needs, any future βN coefficients, Phase 3 polish) gains the same speed-up. The operator-as-architect deviation per `feedback_operator_as_external.md` continues with Phase 3 re-validation hook recorded in arch.md.

**Open SURFACE items unchanged in priority:** SURFACE-2026-05-12-03 (high — β5 mechanism revision; now downstream of WP14.5-retry outcome, not blocking it); SURFACE-2026-05-12-01 (medium — blocked-by -03); SURFACE-2026-05-11-04 (partial — arch side resolved); SURFACE-2026-05-11-02 (medium); SURFACE-2026-05-12-02 (low — test-mission pollution); SURFACE-2026-04-19-01 (Phase 3 — bundle).

## WP14.6 Shipped — 2026-05-12 (afternoon)

D14 cascade step 1 of 3 — physics-core extraction + harness↔browser parity test landed in commits `fb54c65` (Phase 1, file-move + AircraftBody + step.ts, 29 files / +728 / -148) + `cf6254a` (Phase 2+3, parity test + bug fix + CONVENTIONS.md, 10 files / +624 / -34). Three phases, three commits-worth of work, two back-loops handled in-flight.

**Headline result:** the `tests/parity-diff.test.ts` Vitest spec runs a synthetic Node-side stub through `physics-core/step()` in-process (Rapier-WASM in Node, no Three.js mesh) and asserts bit-identical trajectories to the live browser across 1800 fixed-dt ticks at `|Δ|<1e-6`. This is the structural foundation the WP14.7 Node harness inherits: the same Rapier-WASM binary, the same `step()` entry point, the same fixture format — only the surrounding driver changes.

**Production bug caught + fixed in-flight:** `Aircraft.reset()` was leaving stale Rapier force/torque accumulators on the rigid body. Mission restart (return-to-menu → start new mission) would have inherited forces from the previous mission's final tick. Subtle enough that no prior test caught it — the parity test caught it on its first real run, exactly as the arch revision predicted. Fix in `physics-core/rigidbody-core.ts`: `AircraftBody.reset()` now calls `body.resetForces(true) + body.resetTorques(true)`. Permanently regression-anchored by the parity diff.

**Numbers:** 402/402 Vitest (was 385, +17 new — step.test.ts 4 + trajectory-buffer.test.ts 12 + parity-diff.test.ts 1); 10/10 Playwright (was 9, +1 parity emitter); tsc strict clean; build clean (only pre-existing SURFACE-2026-04-19-01 bundle warning). 1800-tick browser-side `runFixture` runs in 1.1s wall-clock — a 27× speedup preview of what WP14.7's full Node harness will deliver in a tighter loop without browser overhead.

**Forward nudge for WP14.7:** the synthetic stub in `tests/parity-diff.test.ts` duplicates world-construction (ground + tower colliders) from `src/main.ts`. WP14.7's Node harness should consolidate this into a shared "world fixture" helper that both the parity test and the harness consume. Comment in `parity-diff.test.ts:50-56` already nudges this. No SURFACE-to-backlog — just a forward-WP nudge.

**Next:** **WP14.7** — Node Rapier-WASM harness single-probe driver. Then WP14.8 (score function + Nelder-Mead optimizer), then rescoped WP14.5 (β5 tuning via harness).

## WP14.7 Shipped — 2026-05-16

D14 cascade step 2 of 3 — promotes the WP14.6 synthetic Vitest stub into a real CLI harness (`tools/tune/harness.ts`) that boots Rapier-WASM in Node, loads `aircraft.json`, accepts deep-path parameter overrides, and emits trajectory CSVs the browser path will diff to within `|Δ|<1e-6`. Becomes the inner loop for the WP14.8 Nelder-Mead optimizer.

**Headline results:**
- **Harness ships.** `tools/tune/harness.ts` exports pure helpers (`parseArgs`, `applyParamOverrides`, `lookupFixture`, `runHarness`) for in-process testing plus a `main()` dispatch on `import.meta.url`. CLI shape: single-probe mode (`--fixture <id> --ticks <N> [--params ...] [--out path|-]`) or batch mode (`--all-fixtures --out-dir <dir>`). Two 1800-tick subprocess invocations are byte-identical (codified in `harness.determinism.test.ts`).
- **World-fixture helper consolidates ground + tower collider construction** into `src/aircraft/physics-core/world-fixture.ts`. `FlatTerrain.getColliderDesc()` and `createTower()` re-import the shape constants. Eliminates the latent `(2000, 0.001, 2000)` vs `(2000, 0.1, 2000)` drift in the WP14.6 parity test that was invisible only because the WP14.6 fixture never touched the ground.
- **Envelope-coverage gap closed.** `PARITY_FIXTURES` now ships three throttles — low/mid/high — at the same initial conditions. The throttle-high fixture (0.4 throttle, sustained) takes body |v| above V_REF=30 m/s for the first time in the parity test suite.
- **SURFACE-2026-05-16-01 surfaced (high priority).** Throttle-high exposes a **β4 explicit-Euler instability above V_REF**: h-stab's `clQ=8` produces a discrete-time damping stiffness that exceeds what `dt=1/60` can integrate stably. Aircraft flips 180° in one tick, |v| → 10¹³ in 4 ticks, NaN by tick 417. Browser and synthetic stub diverge identically — parity is intact, the *simulator* is not. Captured with full tick-by-tick diagnostic in `workflow/backlog.md` for WP14.5-retry to address via joint (clQ, clAlphaDot) search through the WP14.8 optimizer.
- **Parity-of-divergence semantics** (P1.7): `parity-diff.test.ts` rewritten with a `nonFiniteKind()` helper so the assertion handles "both runners exploded identically" as parity-success, while still requiring `|Δ|<1e-6` on every finite row. Honest contract: bit-identity preserved through and beyond explosion. Without this, a future fix to β4 would have been able to pass the parity test without producing finite trajectories — codifying the existing failure mode rather than catching the fix. With it, throttle-high parity is a precise statement about determinism, not stability.
- **`parity-diff.test.ts` precedence wired** (Phase 3): browser→(harness | synthetic) via extracted `pickNodeSource()` helper used on the live path AND unit-codified across all 4 corners of the (browser-present, harness-present) truth table. The synthetic-stub fallback is preserved for the WP14.6 single-tool Vitest contract.

**Numbers:** **448/448 Vitest** (was 402, +46 new — 6 world-fixture + 5 nonFiniteKind unit + 4 pickNodeSource unit + 26 harness + 3 harness-determinism, plus 2 incidental fixture additions); 12/12 Playwright (3 phugoid-probes still skipped per SURFACE-2026-05-12-03); tsc strict clean across both `tsconfig.json` and the new `tsconfig.tools.json`; build clean (only pre-existing SURFACE-2026-04-19-01 bundle warning). Commit `8bca32c` on `main`: 17 files, +1612 / -63.

**Lesson reinforced:** `feedback_verify_self_envelope.md` ("probe envelope boundaries, not a single nominal initial condition") earned its keep this WP. The envelope-widening that Phase 1.4 added — adding throttle-low and throttle-high to a fixture set that was previously mid-only — is precisely what surfaced SURFACE-2026-05-16-01. Pure-math tests at clQ=8 would have passed forever. Live observation at the envelope boundary surfaced a real numerical-stiffness bug. This is the second time on this WP (and the third time in the broader physics work) that the same memory anchor has caught what unit tests missed; the rule continues to do load-bearing work.

**Next:** **WP14.8** — score function + Nelder-Mead optimizer with K=4 random restarts and local quadratic regression on the best simplex. The optimizer's joint-search space is now demonstrably (clQ, clAlphaDot) per surface, not clAlphaDot alone — SURFACE-2026-05-16-01 forced that finding before WP14.8 even started. Then rescoped WP14.5 (β5 tuning via harness; now genuinely a joint-β-coefficient search).
