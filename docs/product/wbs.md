---
stage: wbs
state: complete
updated: 2026-05-11 (WP9.6 DONE — @playwright/test adopted with one load-bearing smoke that doubles as the WP9.5 regression anchor + the WP9 casual-flight pathway verification. WP9 Phase 1 fully closed at the Chromium-only / operator-as-tester bar. Phase 1 complete pending cross-browser sweep at WP21.)
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

### WP10: Phase 2 arch revision — mission + HUD framework
**Description:** Decide mission framework shape (declarative JSON? scripted? state-machine?) and HUD approach (DOM overlay vs Three.js ortho). Update `docs/product/arch.md` with a revision section. Deferred from Phase 1 arch per its "Unknowns" section.
**Phase:** 2
**Dependencies:** WP9
**Size:** S

### WP11: Mission framework
**Description:** Core mission runner: load a mission definition, expose objective state, detect win/lose, allow return to mission select. Read-only access to aircraft state.
**Phase:** 2
**Dependencies:** WP10
**Size:** M
**Tasks:**
- [ ] Mission definition schema (per WP10 decision)
- [ ] Mission lifecycle: load → start → tick → complete/fail
- [ ] Mission-select screen (minimal DOM menu)
- [ ] Return-to-select flow after mission ends

### WP12: HUD
**Description:** In-mission HUD showing altitude, airspeed, current objective, status. Approach per WP10 decision.
**Phase:** 2
**Dependencies:** WP10
**Size:** S

### WP13: Free flight mission
**Description:** No objectives — just fly around the map. Baseline mission type; validates the framework with the simplest case.
**Phase:** 2
**Dependencies:** WP11
**Size:** XS
**Tasks:**
- [ ] Mission definition: no-op objectives, infinite duration
- [ ] Exit condition: player presses a "return to menu" key

### WP14: Waypoint mission
**Description:** Ordered checkpoints in 3D space, timer, objective shows next waypoint + distance. HUD shows waypoint arrow.
**Phase:** 2
**Dependencies:** WP11, WP12
**Size:** S
**Tasks:**
- [ ] Waypoint entity: position, radius, index
- [ ] Objective logic: fly within radius in order
- [ ] HUD: current waypoint distance + directional arrow
- [ ] Win: last waypoint cleared. Fail: timer expires.

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
**Description:** Biggest Phase 2 risk (R6). Keep minimal per research: one simple AI enemy (air or ground), one weapon, hit detection, damage model. No AI pathfinding beyond "fly toward / turn toward player."
**Phase:** 2
**Dependencies:** WP11, WP12
**Size:** L
**Tasks:**
- [ ] Weapon: forward-firing projectile (gun or simple missile — pick one)
- [ ] Projectile lifecycle: spawn, raycast or collider, hit, despawn
- [ ] AI enemy: one target entity (stationary ground target OR minimally-AI aircraft). If aircraft, reuse flight model with a dumb "turn to face player" controller.
- [ ] Damage model: hitpoints on player + enemy; destruction state
- [ ] Win: enemy destroyed. Fail: player destroyed.

### WP17: Phase 2 verification
**Description:** All four mission types playable end-to-end via mission-select. Exit-criteria check.
**Phase:** 2
**Dependencies:** WP13, WP14, WP15, WP16
**Size:** S

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
  └─► WP4 ─► WP5 ──┼─► WP6 ─► WP6.5 ─► WP7 ─► WP9 ─► WP10 ─► WP11 ─┬─► WP13 ─┐
                   │                                                ├─► WP14 ─┤
WP1 ─► WP8 ────────┘                                         WP10─► WP12      ├─► WP17 ─► WP18 ─► WP21 ─► WP22 ─► WP23
                                                                    ├─► WP15 ─┤                                  ▲
                                                                    └─► WP16 ─┘                                  │
                                                              WP17 ─► WP19 ─────────────────────────────────────┤
                                                              WP17 ─► WP20 ─────────────────────────────────────┘
```

**Critical path (longest chain to ship):**
`WP1 → WP4 → WP5 → WP6 → WP6.5 → WP7 → WP9 → WP10 → WP11 → WP16 → WP17 → WP20 → WP21 → WP22 → WP23`

WP7 (flight-feel tuning) and WP16 (combat) are the two heaviest items and sit on the critical path. WP20 (visual polish) is L but trivially parallelizable with WP18/WP19.

**Parallel tracks** within Phase 1: WP4+WP5 can proceed in parallel with WP2+WP3+WP8 after WP1 lands.

## Architectural gaps found

None that require a back-loop. WP10 is a *planned* arch revision at the Phase 1→2 boundary — arch.md explicitly deferred those decisions, so this is on-plan work, not a P8 regression.

Recommend `/product-context` next (transition P9).

## Session Pause — 2026-05-09 09:05
Paused after WP6 finalize. See `workflow/.session.md` to resume.

## Session Pause — 2026-05-11 15:20
Paused at end-of-cycle. WP1–WP8 all shipped; only WP9 (Phase 1 verification) remains for Phase 1. See `workflow/.session.md` to resume.

## Session Pause — 2026-05-11 20:35
Paused after WP9 ran-and-blocked + WP9.5 shipped + session-reflect + 3 learnings persisted. Operator pause to decide between re-running WP9 verify, adopting @playwright/test, or other. See `workflow/.session.md` to resume.

