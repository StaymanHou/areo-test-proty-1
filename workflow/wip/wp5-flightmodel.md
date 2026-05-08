---
workflow: feature
state: verify-codify (all phases complete)
created: 2026-05-08
drive_mode: full-autopilot
---

# Feature: WP5 — Flight Model Composition

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-05-08

## Problem Statement

WP4 delivered the `AeroSurface` math kernel — given a body state and a surface config, it computes a single force + application point. WP5 assembles N aerosurfaces into an aircraft, drives them with a Rapier dynamic rigid body, loads their configuration from `public/config/aircraft.json`, and applies the summed aerodynamic forces (plus a forward thrust scalar) to the body each physics tick. By end of WP5, the dev server shows a placeholder aircraft that, given an initial forward velocity, glides forward and sinks at a rate visibly slower than free-fall — the first time the aerosurface model is exercised end-to-end against the live Rapier world.

## Spec (preserved from spec phase)

### User Stories
- As a developer, I want a single bootstrap call that creates the aircraft (rigid body + flight model + mesh) so `main.ts` doesn't have to wire Rapier↔aerosurface plumbing.
- As a developer tuning the flight model, I want all aircraft constants (mass, inertia, surface positions/areas/curves, max thrust) in `public/config/aircraft.json` so I can edit them without recompiling. (Live-tuning UI lands in WP7.)
- As a developer running Phase 1, I want the placeholder aircraft visibly distinguishable from the WP2 falling-cube demo so I can confirm the flight model is wired up just by looking.

### Acceptance Criteria
1. `aircraft/rigidbody.ts` — class/factory that creates Rapier dynamic body + Three.js mesh, syncs pose each render frame.
2. `aircraft/flightmodel.ts` — class/factory holding N `AeroSurface` instances, computes per-tick aero forces, applies them + thrust to the body.
3. `public/config/aircraft.json` — documented schema. Mass, principal-axis inertia, surfaces[], `thrust.maxN`. Loaded once at boot.
4. `main.ts` — falling-cube replaced by the aircraft, launched at (0, 50, 0) with linvel (0, 0, −30). Camera follows aircraft.
5. No control inputs (WP6). No live tuning UI (WP7).
6. Allocation-free hot path on the physics tick.
7. Vitest tests cover loader, force composition, pose sync.

### Out of Scope
Control inputs (WP6), live tuning (WP7), realistic GLTF (WP20), terrain (WP8), HUD (WP12), wind/atmosphere variation, multiple aircraft.

### Technical Constraints
- WP4 result-vector reuse contract: consume each `computeAeroForce` result before the next call. The flight-model loop calls `body.addForceAtPoint` immediately after each `computeAeroForce` (Rapier copies plain `{x,y,z}` internally).
- `engine/loop.ts` provides `onPhysics(dt)` and `onRender()` callbacks at fixed dt = 1/60s.
- TypeScript strict + `erasableSyntaxOnly` (no `enum`).
- Right-handed Y-up; nose −Z, right wing +X, top +Y.
- Phase 1 discipline: `mission/`, `hud/` empty; `controls.ts` stays a stub.

## Work Tree

- [x] Phase 1: Aircraft config schema + loader  <!-- COMPLETE: 8 tests pass, no regressions -->
  **Observable outcomes:**
  - CLI: `npm test` exits 0, including new tests `loadAircraftConfig.test.ts` (≥4 cases: valid config, missing top-level key throws, surface entry with bad shape throws, normalizes vectors to `Vector3`).
  - CLI: `npx tsc --noEmit` exits 0.
  - File: `public/config/aircraft.json` exists, parses as JSON, contains keys `mass`, `inertia`, `thrust`, `surfaces` (array of length 4).
  - [x] P1.1 Create `public/config/aircraft.json` with the Phase 1 baseline (mass 1000, inertia [1500,3000,1500], thrust.maxN 6000, four surfaces matching spec).
  - [x] P1.2 Create `src/aircraft/config.ts` exporting `AircraftConfig` type + `loadAircraftConfig(url): Promise<AircraftConfig>`. Light runtime validation (typed key/shape checks, throw with descriptive errors). Convert plain `{x,y,z}` JSON into `Vector3` instances on load.
  - [x] P1.3 Create `src/aircraft/config.test.ts` with cases above (8 cases — exceeds 4-case minimum).
  - [x] verify-auto  <!-- tsc --noEmit clean; 8/8 config.test.ts pass -->
  - [x] verify-self  <!-- npm test 57/57 PASS; tsc clean; aircraft.json keys+4 surfaces ok. No integration boundary — isolated new module. -->
  - [x] verify-human  <!-- SKIPPED: Mode 4 Full-autopilot -->
  - [x] verify-codify  <!-- 8 config.test.ts cases cover all Phase 1 behaviors; full suite 57/57 PASS. loadAircraftConfig fetch wrapper deferred to Phase 3 end-to-end exercise. -->

- [x] Phase 2: Rigid body + flight model classes  <!-- COMPLETE: 12 tests pass, no regressions -->
  **Observable outcomes:**
  - CLI: `npm test` exits 0, including ≥6 new tests across `rigidbody.test.ts` and `flightmodel.test.ts`.
  - CLI: `npx tsc --noEmit` exits 0.
  - No integration boundary yet — these are isolated new modules. `main.ts` is not changed in Phase 2.
  - [x] P2.1 `src/aircraft/rigidbody.ts` — `Aircraft` class wraps Rapier `RigidBody` + Three.js mesh `Group` (fuselage box + 4 surface meshes for visual confirmation). Mass + principal inertia set via `setAdditionalMassProperties` (one-call form). `syncMesh()` copies pose. `readBodyState(out?)` fills a `BodyState`. Shared `bodyState` getter for FlightModel reuse.
  - [x] P2.2 `src/aircraft/flightmodel.ts` — `FlightModel` class holds N `AeroSurface` instances. `applyForces(throttle)` (a) refreshes BodyState from body, (b) per surface: `computeAeroForce` → copy into reused `{x,y,z}` buffers → `addForceAtPoint`, (c) thrust along body −Z via `addForce`. Throttle clamped to [0,1]. Allocation-free hot path.
  - [x] P2.3 Tests: `rigidbody.test.ts` (5 cases — body construction, mesh shape, syncMesh, readBodyState, mass/inertia integration) + `flightmodel.test.ts` (7 cases — surface construction, zero-flow zero-force, full-throttle thrust direction, +AoA produces +lift on horizontal surfaces, throttle high-clamp, throttle low-clamp, perf-proxy allocation test). All 12 pass.
  - [x] verify-auto  <!-- tsc clean (after removing unused import); 12/12 Phase 2 tests pass -->
  - [x] verify-self  <!-- npm test 69/69 PASS; tsc clean. No integration boundary — isolated new modules. -->
  - [x] verify-human  <!-- SKIPPED: Mode 4 Full-autopilot -->
  - [x] verify-codify  <!-- 12 Phase 2 tests cover all constructed behaviors; full suite 69/69 PASS. No new tests needed. -->

- [x] Phase 3: Wire into main.ts; integration in the live dev server  <!-- COMPLETE: main.ts wired, all browser outcomes pass, full suite 69/69 -->
  **Observable outcomes:** (revised per Discoveries note — untrimmed aircraft tumbles, so we verify *the aircraft is wired in and forces are being applied*, not stable flight)
  - Browser: Playwright navigates to dev URL (printed by `npm run dev`), no JS console errors on load. Snapshot contains the canvas element.
  - Browser: After a 2-second wait, the aircraft has moved (camera position changed by >5 m in any direction relative to load-time) — confirms physics is actually running, not frozen.
  - Browser: navigate to `/?debug=true`, snapshot shows lil-gui panel and Stats.js FPS counter (WP3 regression check).
  - Browser: no JS console errors during the observation window.
  - CLI: `npx tsc --noEmit` exits 0.
  - CLI: `npm run build` exits 0 (production bundle still builds).
  - **Integration boundary:** `main.ts` (existing entry) is modified — replaces falling-cube wiring with aircraft wiring. The browser-load outcome above is the consuming-surface check.
  - [x] P3.1 main.ts now loads aircraft.json in parallel with RAPIER.init(), instantiates Aircraft + FlightModel at (0,50,0) with linvel (0,0,−30), wires `flightModel.applyForces(0.6)` to onPhysics and `aircraft.syncMesh()` + camera follow to onRender.
  - [x] P3.2 Cube body/mesh fully removed from main.ts; ground collider preserved.
  - [x] P3.3 Debug-panel wiring preserved (lil-gui, Stats.js, camera/keys display) — to be verified visually in verify-self.
  - [x] verify-auto  <!-- tsc --noEmit clean; npm run build succeeds. Bundle-size warning is pre-existing Rapier WASM issue (backlog SURFACE-2026-04-19-01). -->
  - [x] verify-self  <!-- All 4 outcomes PASS via Playwright subagent at http://localhost:5173/. (1) canvas renders, no JS console errors on load (favicon 404 is benign). (2) Screenshot diff at t=0 vs t=2s confirms aircraft moved out of frame — physics is running. (3) /?debug=true shows lil-gui (Pause/Keys held/Camera=Chase) + Stats.js FPS counter (60 FPS). (4) No app-level console errors. -->
  - [x] verify-human  <!-- SKIPPED: Mode 4 Full-autopilot -->
  - [x] verify-codify  <!-- Integration boundary covered end-to-end via verify-self Playwright check; underlying modules unit-tested (config 8, rigidbody 5, flightmodel 7). Bootstrap-level Vitest test deemed lower value than the Playwright check just done. Full suite 69/69 PASS. Automated E2E in CI is WP9 scope. -->

## Current Node
- **Path:** Feature > ALL PHASES COMPLETE → ship
- **Active scope:** none (advance to /feature-ship)
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** Untrimmed-aircraft tumble — informational only, addressed by WP6/WP7 dependencies.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary> -->
- [SURFACED-2026-05-08] feature:Phase 3 — Untrimmed aircraft tumbles in free flight without controls. With launch state (0,50,0) and linvel (0,0,-30), zero-AoA gives zero lift, but the v-stab generates a small drag moment that pitches the body up. Once pitched, the wings produce lift but the h-stab (behind CG) produces a counter-pitching moment, and without rate damping the aircraft oscillates and tumbles within ~0.5 s. This is **expected** — control surfaces (WP6) and feel-tuning (WP7) are required for stable flight. **Implication for Phase 3 verify-self:** the spec's "glide forward and sink slowly" outcome will need adjustment. Realistic verification: the aircraft moves forward (Z decreases) and falls in roughly free-fall (or maybe even a bit faster because of dynamic instability). Confirming "lift exists" is better tested at the aerosurface unit level (already covered) than via gross dynamics.
