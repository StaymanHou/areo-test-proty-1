---
workflow: feature
state: complete
created: 2026-05-08
completed: 2026-05-08
shipped_commit: 3a531c1
entry: spec
work_package: WP4
drive_mode: full-autopilot
---

# Feature: WP4 — Aerosurface primitive

## Problem Statement

Phase 1 needs a flight model that produces correct-feeling dynamics (banking-to-turn, stall, adverse yaw) without hand-coded behavioral rules. Architecture decision D2 commits to **per-surface aerodynamics**: every lift-producing part of the aircraft is an independent `AeroSurface` instance that computes its own force from local airflow. WP4 builds *only the primitive* — one self-contained class with the math kernel. WP5 composes; WP6 deflects via controls; WP7 tunes. Pure deterministic math, no Rapier dep, fully unit-testable in Vitest.

## Spec

(See spec section above this plan — preserved during back-loops.)

### User Stories

- As a flight-model developer, I want a single `AeroSurface` class with a clear `computeForce(bodyState)` contract so I can compose four-to-six surfaces into an aircraft in WP5 without duplicating math.
- As a tuner, I want CL/CD curves expressed as piecewise-linear data so WP7 can iterate via lil-gui and `aircraft.json` without recompiling.
- As a maintainer, I want pure deterministic math with unit tests so a regression in lift/stall behavior is caught at the test suite, not by playtesting.

### Acceptance Criteria

1. `src/aircraft/aerosurface.ts` exports `AeroSurface` with data model: local-frame `position`, `normal`, `chord`, `area`, CL/CD curves.
2. A method that, given parent body's linear velocity, angular velocity, and world transform, returns world-frame **force vector** + world-frame **application point**.
3. AoA computed correctly: project airflow onto plane defined by `normal × chord`; sign convention positive AoA → positive lift on a flat-plate symmetric surface.
4. CL/CD lookup uses Gazebo two-line piecewise-linear curves: pre-stall slope, stall break, post-stall flat-plate slope. Curve data passed at construction.
5. Vitest suite codifying: α=0 → lift≈0, lift linear in pre-stall, lift drops at stall, drag rises with |α|, zero-airflow → zero force, application-point world transform correct.
6. TypeScript strict, no `any`, right-handed Y-up local frame.
7. No avoidable allocations in hot path — reuse scratch `Vector3` buffers.

### Out of Scope

Composing into an aircraft (WP5), control deflection (WP6), `aircraft.json` loading (WP5), Rapier integration (WP5), Reynolds/compressibility/ground effect/propwash (none), tuning curves to feel (WP7), micro-benchmarks (WP9+).

### Technical Constraints

- Per arch D2 — only place lift/drag math lives.
- Per CONVENTIONS.md — local frame: nose −Z, right wing +X, top +Y; world is right-handed Y-up.
- Class accepts a minimal `BodyState` shape, not a Rapier body — keeps tests WASM-free.
- Math via Three.js `Vector3` / `Quaternion` (already a dep).
- Vitest is the test framework.
- Project pattern: `const` objects + type aliases (no enums — `erasableSyntaxOnly` forbids).

## Work Tree

- [x] Phase 1: Data model + airflow→AoA math
  **Observable outcomes:**
  - CLI: `npx vitest run src/aircraft/aerosurface.test.ts -t "Phase 1"` exits 0; suite covers AoA-from-flow cases for ±10°, 0°, and 90° projections.
  - CLI: `npx tsc --noEmit` exits 0 with `aerosurface.ts` and the test file present.
  - Console: importing `{ AeroSurface, createAeroSurface }` from `src/aircraft/aerosurface.ts` in a quick `npx tsx -e` snippet logs an instance with the expected shape (`position`, `normal`, `chord`, `area`, `clCurve`, `cdCurve`); no runtime errors.
  - [x] P1.1 Define types: `AeroSurfaceConfig` (position/normal/chord/area + curves), `BodyState` (position, quaternion, linvel, angvel), `LiftDragCurve` (piecewise-linear data shape).
  - [x] P1.2 Implement `AeroSurface` class (or factory) holding config; expose getters for inspection in lil-gui later.
  - [x] P1.3 Implement `computeAirflowAtPoint(bodyState, worldOffset, out)` — combines body linvel and `angvel × r`, negates for incoming flow.
  - [x] P1.4 Implement `computeAngleOfAttack(localFlow, normal, chord)` — project flow onto plane defined by `normal × chord`, measure signed angle. Sign convention: flow along −normal → +AoA → +lift on flat plate.
  - [x] P1.5 Vitest cases for AoA: zero flow → 0; flow along chord → 0; flow along ±normal → ±π/2; +10° rotated flow → +10°; spanwise flow rejected.
  - [x] verify-auto
  - [x] verify-self  <!-- All 3 outcomes PASS (vitest 11/11, tsc clean, import smoke green). No integration boundary — module is isolated; WP5 will be first consumer. -->
  - [x] verify-human  <!-- status: SKIPPED (Mode 4 — full-autopilot; verify-self is acceptance gate) -->
  - [x] verify-codify  <!-- 12 aerosurface tests; full suite 34/34 green; +1 negative-AoA regression case added. No integration boundary — module is isolated. -->

- [x] Phase 2: Piecewise-linear CL/CD curves + force computation
  **Observable outcomes:**
  - CLI: `npx vitest run src/aircraft/aerosurface.test.ts` exits 0; full Phase 1 + Phase 2 test suite green (≥ 12 cases total).
  - CLI: `npx tsc --noEmit` exits 0.
  - Console: in a `tsx` snippet, calling `computeAeroForce(surface, bodyState)` on a symmetric flat-plate at α≈0 returns `{ force: ~zero lift, small drag, applicationPoint: <world coords> }`; at α=10° (pre-stall) returns force with positive +Y lift component; at α=30° (post-stall) returns force with notably reduced +Y component vs α=10° peak.
  - [x] P2.1 Implement `lookupLiftDragCurve(curve, alpha)` — piecewise-linear interpolation, clamps at endpoints.
  - [x] P2.2 Implement `computeAeroForce(surface, bodyState)` returning `{ force, applicationPoint }`. Lift along world normal, drag along +airflow_world (opposes body motion). Required AoA convention fix (chord = "into the wind" — see [SURFACED] below).
  - [x] P2.3 `createSymmetricFlatPlateCurves()` helper: linear pre-stall slope = 2π·α, stall at ±15°, flat-plate region toward ±π/2; CD: 0.02 at α=0, rising to 1.2 at ±π/2.
  - [x] P2.4 Allocation-free hot path: 11 module-scoped scratch buffers; `grep new Vector3|new Quaternion` shows all calls at module init only.
  - [x] P2.5 Vitest cases: 4 curve-lookup tests, 6 computeAeroForce tests (zero flow, α≈0, +α lift, post-stall drop, drag rises with |α|, app-point transform under non-identity body, force-vector reuse contract), 2 helper symmetry tests.
  - [x] verify-auto
  - [x] verify-self  <!-- All 3 outcomes PASS. α=0 → zero lift + small drag; α=10° → +66.7 N lift; α=30° → +28.2 N (post-stall). App point correctly transformed. No integration boundary — module isolated; WP5 first consumer. -->
  - [x] verify-human  <!-- status: SKIPPED (Mode 4 — full-autopilot; verify-self is acceptance gate) -->
  - [x] verify-codify  <!-- 27 aerosurface tests; full suite 49/49. Added sign-continuity regression test through α=0. No integration boundary. -->
  - [SURFACED-2026-05-08] Phase 2 P2.2 — AoA sign convention required revision. Original Phase 1 impl used `along = +projected.dot(chord)`, but for a chord pointing in nose direction (per CONVENTIONS.md), level-flight airflow flows opposite chord, so the correct formula is `along = -projected.dot(chord)`. Phase 1 tests passed only because they used abstract flow vectors, not physical setups. Fixed in this phase; six Phase 1 AoA tests rewritten to physical flow patterns. Logged to backlog as a process note.

## Current Node
- **Path:** Feature > complete (shipped 3a531c1, finalized 2026-05-08)
- **Active scope:** none — feature done.
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** none

## Discoveries
- [SURFACED-2026-05-08] Phase 2 P2.2 — AoA sign convention. Logged to backlog as SURFACE-2026-05-08-01; resolved during finalize by adding a paragraph to `CONVENTIONS.md` clarifying chord direction.

## Retrospect
- **What changed in our understanding:** The "chord direction" convention isn't fully constrained by "nose along −Z" alone. Aerosurface chord must point *into the relative wind*, which for a forward-flying plane equals nose direction (= −Z). But that's a physical correspondence, not a coordinate rule — easy to miss.
- **Assumptions that held:** Khan & Nahon per-surface model is a clean primitive; Three.js Vector3/Quaternion math is sufficient (no extra deps); pure-math separation from Rapier kept tests trivial and fast (full suite 49 tests in ~140 ms). Phase split was right: data + AoA before curves + force kept each phase reviewable.
- **Assumptions that were wrong:** The Phase 1 AoA tests passed but were not *physical* — they constructed flow vectors abstractly. The bug surfaced only when Phase 2 wrote tests where a body actually moves through air. Lesson: physics-math primitives need at least one "realistic body in motion" test from the start.
- **Approach delta:** Implementation matched the plan structurally (two phases, scoped tasks, allocation-free hot path). One mid-phase fix: the AoA formula needed a sign flip discovered during Phase 2; six Phase 1 tests were rewritten in-place. No re-plan needed — the spec held.
