---
workflow: task
state: verify (complete)
created: 2026-06-13
drive_mode: autopilot
docs-only: false
---

# Task: Fix chase-camera flip during backflip / inverted flight

**Workflow:** task
**State:** plan (complete)
**Created:** 2026-06-13

## Problem Statement

`src/world/camera.ts:59` calls `camera.lookAt(targetPosition)` which uses Three.js's default world-`+Y` up vector. When the aircraft pitches past ~90° (e.g. during a backflip), the projection of the body's up-vector onto world-`+Y` crosses zero and `lookAt` snaps the camera 180° to keep its own up-vector aligned with world `+Y`. Cockpit camera (lines 62-67) is unaffected because it uses `quaternion.copy(targetQuaternion)` directly. SURFACE-2026-06-13-CAMERA-BACKFLIP-WRAPAROUND.

## Context

- `src/world/camera.ts` — single fix site (`_updateChase` method).
- `src/world/camera.test.ts` — 7 existing Vitest cases (Chase + Cockpit modes); will extend with an inverted-flight assertion.
- `src/main.ts:121` — sole consumer (`new CameraController(camera)`). No API surface changes expected.
- `docs/product/arch.md:82` — describes chase camera as "lerps toward target pose"; no D-numbered decision binds the up-vector mechanism, so this is an implementation-internal fix.

## Fix approach

**Option 1 (chosen):** Derive the camera's up-vector from the aircraft's quaternion before each `lookAt` call.

```ts
this._chaseUp.set(0, 1, 0).applyQuaternion(targetQuaternion);
this.camera.up.copy(this._chaseUp);
this.camera.lookAt(targetPosition);
```

Rotates world-`+Y` by the aircraft quaternion to get body-up in world space, assigns to `camera.up` so `lookAt`'s internal frame matches the aircraft's. Eliminates the gimbal-lock snap because the up-vector follows the body smoothly through inverted attitudes.

**Rationale over alternatives:**
- Option 2 (quaternion-slerp toward target orientation including roll) — more invasive; removes the "stays behind via lookAt" convention; not justified for a snap-fix.
- Option 3 (blend body-up with world-up via gimbal-saturating weight) — better feel during normal flight (horizon stays level) but adds tuning knobs and edge cases. Defer to playtest follow-up if Option 1's full-body-up feels disorienting.
- Option 1 matches arcade flight sim convention (Ace Combat, War Thunder arcade mode) — camera rolls with the plane. Low-risk, ~3 lines, definitively eliminates the snap.

**Allocation discipline:** add a `_chaseUp` Vector3 scratch field alongside the existing `_desired` / `_cockpitOffset` scratches — avoid per-frame allocation in the render hot path.

## Work Tree

- [x] T1 Add `_chaseUp: Vector3` scratch field to CameraController
- [x] T2 In `_updateChase`, derive body-up from `targetQuaternion` and assign to `camera.up` before `lookAt(targetPosition)`
- [x] T3 Add Vitest case: with aircraft pitched 180° (inverted), camera's resulting `up` vector points roughly opposite world-`+Y` (no snap)
- [x] T4 Add Vitest case: with aircraft rolled 90° around Z, camera up tracks the rolled body-up (→ world-X direction)
- [ ] T5 Run `npm run test` (Vitest) — all camera tests pass  <!-- status: NOT-STARTED; deferred to task-verify -->
- [ ] T6 Run `npm run test:e2e` — verify no regression in existing Playwright suites (casual-flight, mission smokes)  <!-- status: NOT-STARTED; deferred to task-verify -->

## Current Node
- **Path:** Task > T5
- **Active scope:** T5 (full Vitest) + T6 (e2e) — both deferred to task-verify
- **Blocked:** none
- **Open discoveries:** none
- **Act notes:** camera.test.ts subset passed 9/9 locally; deferred full suite + e2e to task-verify per workflow convention.

## Verification Observable

**Observable:** With aircraft pitched 180° (inverted), chase camera's `up` vector tracks body-up (~world-(0,-1,0)) instead of world-`+Y` — directly exercising the SURFACE-2026-06-13-CAMERA-BACKFLIP-WRAPAROUND failure mode. Full Vitest suite + Playwright e2e suite pass with no regression.

**Verification commands:**
1. `npx vitest run src/world/camera.test.ts` — new no-snap + roll assertions present and passing.
2. `npm run test` — full Vitest suite passes (no regression in any consumer).
3. `npm run test:e2e` — Playwright e2e passes (no in-game regression).

**Expected result:** All three commands exit 0; vitest reports all camera tests pass (9/9 for the targeted subset, ≥854 for the full suite per WP26 baseline); e2e at least 55/56 (the pre-existing SURFACE-2026-06-13-PHUGOID-HIGH-REGRESSION is allowed per pause-note baseline).

## Verification Result

**Status:** PASS
**Date:** 2026-06-13
**Evidence:**
- `npx vitest run src/world/camera.test.ts` → 9/9 tests pass (7 existing + 2 new — inverted-flight no-snap + 90° roll body-up tracking).
- `npm run test` → 856/856 across 47 files (WP26 baseline was 854; +2 new camera cases = 856 expected).
- `npm run test:e2e` → 55/56. The single failure is `phugoid probe @ throttle=0.4` — pre-existing `SURFACE-2026-06-13-PHUGOID-HIGH-REGRESSION` from upstream cessna-trainer-feel-tune commit `ab807e0`, explicitly excluded from the WP26 baseline per pause-note 2026-06-13 12:35. Camera change has no causal path to phugoid physics divergence (camera reads target pose, doesn't write).

**Notes:** Fix confirmed. Body-up rotated from quaternion onto `camera.up` eliminates the `lookAt` default-world-+Y snap during inverted flight.

## Current Node
- **Path:** Task > verify (complete)
- **Active scope:** all complete, ready for close
- **Blocked:** none
- **Open discoveries:** none

## Retrospect

- **What changed in our understanding:** Nothing fundamental — diagnosis from the pause note (`lookAt` default-world-+Y causing 180° snap when body-up's projection on world-+Y crosses zero) was exactly right. Three.js documents `lookAt` as honoring `camera.up`, so assigning a body-rotated up before each call is the canonical fix shape.
- **Assumptions that held:** Single-file fix in `_updateChase` only; cockpit path was untouched and unaffected (`quaternion.copy` already bypasses the issue); `main.ts:121` consumer needed no change.
- **Assumptions that were wrong:** None.
- **Approach delta:** Plan called for Option 1 (~3 lines); actual was 4 lines (scratch field + 3 lines in `_updateChase`) — within plan estimate. Added a second Vitest case (90° roll body-up tracking) beyond the strict no-snap regression check to anchor the roll-with-the-plane semantics; this catches a future refactor that swaps to Option 3 (horizon-locked blend) without updating the test.

## Closure notice

**Closure notice (requester = operator, self-record):** chase-camera backflip flip is fixed. `src/world/camera.ts:_updateChase` now derives body-up from the aircraft quaternion and assigns it to `camera.up` before `lookAt`, so the camera rolls smoothly with the plane through inverted attitudes instead of snapping 180° at the gimbal-lock plane. SURFACE-2026-06-13-CAMERA-BACKFLIP-WRAPAROUND resolved. Verify on the live URL by performing a backflip — camera should follow the aircraft through inverted instead of snapping.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
