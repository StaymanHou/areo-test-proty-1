---
stage: wbs
state: in-progress
updated: 2026-05-12 (WP10 + WP10.5 + WP11 + WP12 + WP13 + WP14 DONE — Phase 2 arch revision, β5 schema, mission framework, HUD, free-flight close, and waypoint patrol all shipped same day. Two mission types playable end-to-end with HUD overlay and Escape-to-menu. Next: WP14.5 clAlphaDot tuning (SURFACE-2026-05-12-01 — unblocks high-energy patrols + WP15 + WP16), WP15 takeoff/landing M, WP16 combat L.)
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

### WP14.5: `clAlphaDot` tuning pass — pending
**Description:** Tuning-side close of SURFACE-2026-05-11-04 + SURFACE-2026-05-12-01. Set non-zero `clAlphaDot` on wings (try starting ~5-10) and h-stab (try ~10-15) in `aircraft.json`; verify against ≥30s Playwright probe at non-zero throttle values 0.05, 0.15, 0.4 per arch D13. If tuning works, follow-up may amend `waypoint-patrol.json` to a longer/higher patrol or seed a fresh ambitious-patrol mission. Analogous to WP10.5 in shape (schema landed there with default 0; this is the values pass).
**Phase:** 2
**Dependencies:** WP10.5 (schema), WP14 (first mission that needs it)
**Size:** XS-S (tuning iteration with bounded attempt budget per `feedback_retune_attempt_budget.md`)
**Tasks:**
- [ ] Set `clAlphaDot` on `aircraft.json` wings + h-stab (one knob each per surface; default 0 ships unchanged for surfaces not tuned).
- [ ] Verify-self via 30s Playwright probe at throttle ∈ {0.05, 0.15, 0.4} — assert no NaN, bounded altitude/airspeed/pitch.
- [ ] If tuning fits inside 2-3 attempts: amend WP14 mission to longer patrol OR add a separate ambitious-patrol mission.
- [ ] If tuning does not converge: surface as a deeper arch concern (would need WP10-style arch revision).

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
                   │                                                          ├─► WP14 ─┤
WP1 ─► WP8 ────────┘                                              WP10 ─► WP12          ├─► WP17 ─► WP18 ─► WP21 ─► WP22 ─► WP23
                                                                              ├─► WP15 ─┤                                  ▲
                                                                              └─► WP16 ─┘                                  │
                                                                        WP17 ─► WP19 ─────────────────────────────────────┤
                                                                        WP17 ─► WP20 ─────────────────────────────────────┘
```

**Critical path (longest chain to ship):**
`WP1 → WP4 → WP5 → WP6 → WP6.5 → WP7 → WP9 → WP10 → WP10.5 → WP11 → WP16 → WP17 → WP20 → WP21 → WP22 → WP23`

WP7 (flight-feel tuning) and WP16 (combat) are the two heaviest items and sit on the critical path. WP20 (visual polish) is L but trivially parallelizable with WP18/WP19.

**Parallel tracks** within Phase 1: WP4+WP5 can proceed in parallel with WP2+WP3+WP8 after WP1 lands.

## Architectural gaps found

None that require a P8 back-loop. WP10 closed 2026-05-12 as the planned Phase 1→2 arch revision (D11/D12/D13). Phase 2 WPs are now decision-locked. WP10.5 is a small schema-extension WP that lands D13 in code before Phase 2 feature WPs begin.

Recommend `/product-context` next (transition P9) — to refresh `CLAUDE.md` for Phase 2 (mention Phase 1 closed, point to D11/D12/D13, update "Current Phase" section).

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
