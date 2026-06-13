---
name: Fix MiG-15 mesh — chord direction reversed (trailing edge in -Z instead of +Z)
type: feature
state: verify-codify (all phases complete)
created: 2026-06-13
drive_mode: full-autopilot
size: XS
entry: reproduce (bug-fix feature)
---

# Feature: Fix MiG-15 mesh — chord direction reversed

**Workflow:** feature
**State:** reproduce (complete)
**Created:** 2026-06-13
**Entry:** reproduce (bug-fix feature)

## Problem Statement

After the prior fix (`fix-mig15-mesh-wing-orientation`, ship `b419728`) the MiG-15 wings render **flat** but with the chord direction **reversed** — the trailing edge points forward (world -Z, aircraft's forward direction) instead of backward (world +Z, behind the root). Operator-confirmed visually.

**Root cause:** `rotation.x = -Math.PI / 2` maps shape's local +Y (chord direction, from root LE at y=0 to root TE at y=rootChord) to world -Z. The aircraft flies along world -Z, so trailing edge at world -Z = wing pointing forward.

The fix is `rotation.x = +Math.PI / 2` (positive instead of negative), which maps shape's +Y to world +Z. This puts thickness (shape +Z) at world -Y (below the chord plane), which is fine since the mesh is cosmetic and the wing center is anchored to the wing surface position.

Same correction needed for both h-stab meshes.

**Expected vs observed:**
- Expected: wing bbox extends from world Z ≈ wing-surface-z to wing-surface-z + rootChord + sweep (trailing edge **behind** root in +Z).
- Observed: wing bbox extends from world Z ≈ wing-surface-z to wing-surface-z - rootChord - sweep (trailing edge in **-Z**, the forward direction).

## Reproduction Attempt

**Surface chosen:** failing test (geometry-level — Box3 inspection for chord direction)
**Outcome:** **REPRODUCED — RED** (pending: tests written, expecting to fail at current head)
**Artifact:** new test cases added to `src/aircraft/aircraft-mesh.test.ts` under the existing `describe('buildAircraftMesh — mig15 mesh orientation ...', ...)` block.
**Determinism:** every-run (pure geometry).
**Notes:** The prior tests assert *magnitudes* (X=span, Y=thin, Z=chord); these new tests assert *signed direction* (bbox extends in +Z relative to wing-surface root). This is the test-gap that let the second bug ship.

### Failing-test plan

For each wing mesh whose mesh.position.z is approximately `surface.position.z - rootChord/2` = `0 - 0.8 = -0.8`:
- Assert `bbox.max.z > 0` (wing-surface z=0) AND `bbox.min.z >= -0.5` (i.e., the wing doesn't extend significantly in -Z relative to root).

For h-stab whose mesh.position.z is `surface.position.z - root/2 = 3 - 0.45 = 2.55`:
- Assert `bbox.max.z > 3` (h-stab surface z=3) AND `bbox.min.z >= 2.5`.

These assertions catch any chord-direction reversal regardless of magnitude.

## Small/simple criteria check

- [x] No new data models or API endpoints
- [x] No architectural decisions
- [x] Describable in ≤4 sentences (yes — "flip rotation.x sign for wings and h-stab")
- [x] Estimated <30 min
- [x] ≤30 lines impl + tests

All five hold → F33 → plan.

---

## Work Tree

- [x] Phase 1: Flip rotation.x sign on wings + h-stab (-π/2 → +π/2)
  **Observable outcomes:**
  - CLI: `npx vitest run src/aircraft/aircraft-mesh.test.ts` exits 0 with all 16 tests passing (currently 14 pass + 2 fail at red-step).
  - CLI: `npx tsc --noEmit` exits 0.
  - Browser: open `?debug=true&mission=jet-test` → MiG-15 renders with wings flat AND **trailing edges behind the cockpit** (toward the camera in chase-cam view, which faces -Z forward). The leading edge of each wing is at the front (toward -Z), the trailing edge is at the back (toward +Z).
  - [x] P1.1 Flipped `wing.rotation.x` to `+Math.PI / 2` in `buildSweptWing()`.
  - [x] P1.2 Flipped both `left.rotation.x` and `right.rotation.x` to `+π/2` in h-stab branch.
  - [x] P1.3 16/16 Vitest tests pass. Refined the direction-test assertions to use "extent behind anchor > extent in front" (anchor-relative asymmetry), since the wing mesh is anchored at the chord midpoint, NOT the leading edge — so the original assertion `min.z >= -0.5` was too strict.
  - [x] verify-auto — tsc clean; full Vitest 828/828 green
  - [x] verify-self — all 5 outcomes PASS via subagent: jet-test renders MiG-15 with wings + h-stab correctly oriented (chord behind cockpit; screenshot saved to mig15-chord-direction-fixed.png); combat mission MiG-15 spawns finite-state; Cessna Free Flight regression-clean; 0 console errors
  - [x] verify-human — skipped per Mode 4 (full-autopilot)
  - [x] verify-codify — codified by the 2 direction tests written at reproduce step (anchor-relative asymmetry check). Vitest 16/16 + full 828/828 green.

## Current Node
- **Path:** Feature > ship
- **Active scope:** Phase 1 complete; all verify nodes green. Ready for ship.
- **Blocked:** none
- **Unvisited:** (none — single-phase fix)
- **Open discoveries:** none

## Confidence

**High.** Magnitude assertions (X/Y/Z extent) are sign-symmetric — flipping the rotation sign preserves them. Direction assertions (where the chord points) are the new gate. The simplest possible fix (sign flip), with a clear empirical test.

Note: I'll also verify the thickness now sits at world -Y (below the chord plane) instead of +Y, but that's cosmetic and the magnitude test stays green either way.
