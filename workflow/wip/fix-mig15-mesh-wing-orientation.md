---
name: Fix MiG-15 mesh — wing/h-stab/v-stab rendered on edge
type: feature
state: verify-codify (all phases complete)
created: 2026-06-13
drive_mode: full-autopilot
size: XS
entry: reproduce (bug-fix feature)
---

# Feature: Fix MiG-15 mesh — wing/h-stab/v-stab rendered on edge

**Workflow:** feature
**State:** reproduce (complete)
**Created:** 2026-06-13
**Entry:** reproduce (bug-fix feature)

## Problem Statement

The MiG-15 procedural mesh in `src/aircraft/aircraft-mesh.ts` (shipped at WP20, exposed to non-deep-link players by WP24) renders the wings, h-stab, and v-stab **standing on edge** — looking like a steep V-shape projecting up from the fuselage instead of flat lifting surfaces. Operator-confirmed visually (2026-06-13) on the live build via the new picker.

**Root cause (identified in conversation):** `ExtrudeGeometry(shape, { depth: 0.08, ... })` extrudes the 2D shape **along its local +Z axis**. The MiG-15 wing shape is defined in the XZ plane (`shape.lineTo(0, rootChord)` — second arg becomes the shape's local Z = chord). The extrusion direction (0.08 m thickness) therefore points along the shape's local Z. Without any rotation applied to the resulting mesh, the wing's local Z becomes the world's Z — meaning the **chord direction (0.8–1.6 m) sits in world Y** (vertical), and the thin extrusion (0.08 m) sits along world Z (chord). The wings appear edge-on instead of flat.

**Cessna mesh is fine** because it uses `BoxGeometry(span, thickness, chord)` directly — width/height/depth args bind to world X/Y/Z without needing a rotation.

**Affected variants:** mig15 (wing-left, wing-right, h-stab left + right, v-stab). The v-stab is intentionally vertical — a separate analysis needed there.

**Expected vs observed:**
- Expected: wing bounding box max-extent along world X (span), min-extent along world Y (thickness), middle-extent along world Z (chord).
- Observed: wing bounding box max-extent along world X (span — correct), middle-extent along world Y (chord — WRONG), min-extent along world Z (thickness — WRONG).

## Reproduction Attempt

**Surface chosen:** failing test (geometry-level — Three.js Box3 inspection; no renderer needed)
**Outcome:** **REPRODUCED — RED.** 3 new tests added to `src/aircraft/aircraft-mesh.test.ts`, all FAIL deterministically:
  - **Wings:** observed `chord(Z)=0.08, thickness(Y)=3.04` — extrusion (0.08m intended thickness) sits in world Z (chord axis); chord (~3m) sits in world Y. Wings stood on edge as predicted.
  - **H-stab:** observed zero candidates at z≈3 with y≈0 — same root cause; the h-stab's bbox center has moved to y≈0.45 because the chord extrudes upward.
  - **V-stab:** observed `thickness(X)=1.40` instead of `<0.3` — the v-stab uses `rotation.y = π/2` but the shape's X (1.6m span) ends up in world Z while the shape's Z (extrusion 0.08m) lands in world X… except it doesn't, the bbox shows the 1.4m sitting in X. Will diagnose precisely at fix time; the test will catch any orientation that's not the intended vertical-fin shape.
**Artifact:** `src/aircraft/aircraft-mesh.test.ts:140–207` — 3 new test cases under `describe('buildAircraftMesh — mig15 mesh orientation (regression: post-WP24 wings-on-edge)', ...)`.
**Determinism:** every-run (pure geometry; no random/timing).
**Notes:** The existing tests in this file already cover "ExtrudeGeometry is present" but never inspect orientation. That's the test gap that let the bug ship at WP20.

### Failing-test plan (to add at red-green step)

Append to `src/aircraft/aircraft-mesh.test.ts`:

```ts
describe('buildAircraftMesh — mig15 mesh orientation (regression: WP24 wings-on-edge)', () => {
  it('mig15 wings render flat (world-Y thickness, world-Z chord, world-X span)', () => {
    const group = buildAircraftMesh(mig15Config, 'mig15');
    // Find wing meshes via ExtrudeGeometry that sit at a wing-surface z (z=0 in fixture).
    const extruded = group.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ) as Mesh[];
    // Pick a wing mesh: the one whose world-bbox center is at z ≈ wing-surface z.
    // (Wings root at z=0 in the fixture; h-stab roots at z=3.)
    const wingCandidates = extruded.filter((m) => {
      const bbox = new Box3().setFromObject(m);
      const center = new Vector3();
      bbox.getCenter(center);
      return Math.abs(center.z) < 1.5; // wing chord range, not h-stab
    });
    expect(wingCandidates.length).toBeGreaterThan(0);
    for (const wing of wingCandidates) {
      const bbox = new Box3().setFromObject(wing);
      const size = new Vector3();
      bbox.getSize(size);
      // Expected: span (X) is largest, thickness (Y) is smallest, chord (Z) is middle.
      expect(size.x, 'wing span (X)').toBeGreaterThan(size.z);
      expect(size.z, 'wing chord (Z)').toBeGreaterThan(size.y);
      expect(size.y, 'wing thickness (Y)').toBeLessThan(0.5);
    }
  });

  it('mig15 h-stab renders flat (world-Y thickness, world-Z chord)', () => {
    const group = buildAircraftMesh(mig15Config, 'mig15');
    const extruded = group.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ) as Mesh[];
    // h-stab sits at z=3 in the fixture; pick the meshes near there.
    const hStabCandidates = extruded.filter((m) => {
      const bbox = new Box3().setFromObject(m);
      const center = new Vector3();
      bbox.getCenter(center);
      return Math.abs(center.z - 3) < 1.5 && Math.abs(center.y) < 0.5;
    });
    expect(hStabCandidates.length).toBeGreaterThan(0);
    for (const tail of hStabCandidates) {
      const bbox = new Box3().setFromObject(tail);
      const size = new Vector3();
      bbox.getSize(size);
      expect(size.y, 'h-stab thickness (Y)').toBeLessThan(0.5);
      expect(size.z, 'h-stab chord (Z)').toBeGreaterThan(size.y);
    }
  });
});
```

Plus the imports: add `Box3` to the three.js import at the top of the file.

## Why red-green discipline pays off here

Without the failing test first, the fix (~1 line per wing: `wing.rotation.x = -Math.PI / 2`) could "pass" because rotation looks geometrically plausible, but a sign-error in the axis convention would invert the wing or flip it backward. The bounding-box assertions are mechanism-free — they describe the *world-frame shape* of a flat wing without caring how we got there, so they cleanly distinguish "fixed correctly" from "rotated to a different broken state."

## Fix-time scope (for the next state — feature-plan)

- One-line fix in each of: `buildSweptWing()` (used by wing-left + wing-right) and the h-stab block (left + right) in `src/aircraft/aircraft-mesh.ts`.
- v-stab analysis: the v-stab is *intended* to be vertical. Its current shape may or may not be oriented correctly; the failing-test set should include a positive case for v-stab too — it should have max-extent along Y (height), small extent along Z (chord), tiny extent along X (thickness).
- No mission, no main.ts, no test scaffolding beyond the file already extended.

## Small/simple criteria check

- [x] No new data models or API endpoints
- [x] No architectural decisions
- [x] Describable in ≤4 sentences (yes — "ExtrudeGeometry extrudes along local Z; rotate extruded wing meshes by -π/2 around X so the chord lies along world Z and thickness along world Y")
- [x] Estimated <4 hours (≤1h: add bounding-box tests, run, fix, re-run, browser-walkthrough)
- [x] ≤200 lines (≤30 lines impl + ≤80 lines new tests)

All five hold → F33 → plan.

---

## Work Tree

- [x] Phase 1: Rotate extruded wing / h-stab meshes into correct world-frame orientation (v-stab was already correct)
  **Observable outcomes:**
  - CLI: `npx vitest run src/aircraft/aircraft-mesh.test.ts` exits 0 with all 14 tests passing (was 11 pass + 3 fail at red-step; fix turns the 3 new tests green).
  - CLI: `npx tsc --noEmit` exits 0.
  - Browser: open `http://localhost:5173/areo-test-proty-1/?debug=true`, pick "Jet (MiG-15)", click "Free Flight" → after reload, the MiG-15 aircraft renders with **flat horizontal wings** (not a V), **flat horizontal h-stab**, and **vertical fin** (v-stab pointing up). Visually compare to the pre-fix screenshot (operator-supplied 2026-06-13) — wings should now lie flat, not project upward at ~45°.
  - Browser: open `?debug=true&mission=combat` (Combat pins MiG-15 anyway) → same flat-wing rendering on the combat target's player aircraft.
  - [x] P1.1 Added `wing.rotation.x = -Math.PI / 2` in `buildSweptWing()` (aircraft-mesh.ts:200). Plan-time analysis had a misread (shape-X/Y vs shape-X/Z); empirical test catch was the right call. Wings now: span=3.20 (X), thickness=0.08 (Y), chord=3.04 (Z) — flat as intended.
  - [x] P1.2 Added `left.rotation.x = -π/2` + `right.rotation.x = -π/2` to both h-stab meshes. Same root cause as wing.
  - [x] P1.3 V-stab was ALREADY CORRECT — debug log showed size=(0.08, 1.50, 1.60), i.e., height in Y (1.50), thickness in X (0.08), chord in Z (1.60). My plan-time concern was a misread of the `rotation.y = π/2` semantics. The test's original v-stab assertion failed because the filter was too loose and picked up h-stab meshes by mistake; once the filter switched to `position.y > 0.3` (v-stab-only anchor), the v-stab passed without code change. Test filter was the bug, not the v-stab code.
  - [x] P1.4 `src/aircraft/aircraft-mesh.test.ts`: 14/14 passing. Full Vitest 826/826 + tsc clean.
  - [x] verify-auto — tsc clean; scoped Vitest aircraft-mesh.test.ts 14/14 green
  - [x] verify-self — all 5 outcomes PASS via subagent: jet-test mission renders MiG-15 with flat wings + flat h-stab + vertical fin (screenshot captured); combat mission likewise; Cessna unaffected; 0 console errors across all 3 live scenarios
  - [x] verify-human — skipped per Mode 4 (full-autopilot)
  - [x] verify-codify — already codified inline with the reproduce artifact (the 3 new tests added at red-step IS the verify-codify deliverable). Phase 1 verify-codify is just confirming the same 3 tests are now green + full Vitest suite stays green — Vitest 826/826 confirmed at end of impl.

## Current Node
- **Path:** Feature > ship
- **Active scope:** Phase 1 complete (single-phase fix). Vitest 826/826 + tsc clean. Ready for ship.
- **Blocked:** none
- **Unvisited:** (none — single-phase fix)
- **Open discoveries:** none

---

## Notes for verify-* (plan-time guidance)

- **verify-auto:** scoped Vitest on `aircraft-mesh.test.ts` only; tsc.
- **verify-self:** Playwright MCP against `npm run dev`. Browser observables are visual — subagent should screenshot the mission and confirm wings are flat (compare to the operator's pre-fix screenshot via accessibility-tree shape if possible, or just confirm `window.__aircraft` flies the MiG-15 without crash + render). Note: subagent can't easily "see" mesh shape, so a useful proxy is to evaluate `Box3.setFromObject(window.__aircraft.getMesh())` against the same dimensions the unit test checks. The unit test is the primary gate; browser observation is the live-system sanity check.
- **verify-human:** SKIPPED (Mode 4 full-autopilot).
- **verify-codify:** No additional test work — the 3 tests added at red-step ARE the codify deliverable. Just confirm green.

## Confidence

- P1.1 / P1.2 (wing + h-stab rotation): **high** — straightforward Three.js convention, the test contract is mechanical (Box3 inspection).
- P1.3 (v-stab rotation): **medium** — combining two rotations always has a sign trap. The test fails loudly if I get it wrong; expect possibly one iteration.

Will run the failing tests after each impl edit to catch sign errors immediately.
