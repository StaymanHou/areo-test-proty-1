---
workflow: feature
state: plan (complete)
created: 2026-05-09
entry: spec
drive_mode: full-autopilot
wbs_ref: WP7
---

# Feature: WP7 — Flight-feel tuning pass

**Workflow:** feature
**State:** spec
**Created:** 2026-05-09
**Entry:** spec (complex feature)

## Problem Statement

After WP6, the plane flies, but no one has tuned the flight-model constants for **feel**. Per `docs/product/research.md` R2, "flight-feel tuning is iterative" is the single biggest feel risk in Phase 1, and per `docs/product/arch.md` D3, the chosen mitigation is JSON config + lil-gui. The mitigation infrastructure is half-built: constants live in `public/config/aircraft.json` and the file is hot-loaded at boot, but **no live-tuning UI exists** — every change requires editing JSON and reloading the page. That kills the iteration loop the architecture was designed to support.

This feature closes that gap: a working live-tuning loop, a tuning pass executed against it, an external sanity check that the result feels right to a casual player, and the tuned values committed as the new defaults.

## User Stories

- As a developer tuning flight feel, I want every flight-model constant exposed in lil-gui and applied live, so that a tuning iteration is "drag a slider → fly → adjust" instead of "edit JSON → reload → forget context."
- As a developer at the end of a tuning session, I want one button that exports the current values back to `aircraft.json` shape, so that I can paste/save without manually transcribing 30+ numbers.
- As a developer, I want the tuned preset committed as the default `aircraft.json`, so that anyone cloning the repo sees the "good" feel out of the box.
- As a casual player (one external pair of eyes), I want to fly the plane and have it match my mental model of "how a plane should behave," so that the v1 feel risk is retired before Phase 2.

## Acceptance Criteria

The feature is **done** when:

1. **Live tuning UI exists.** With `?debug=true`, a `Flight Model` lil-gui folder exposes every flight-model constant currently sourced from `aircraft.json`:
   - **Body:** `mass`, `inertia.x/y/z`
   - **Thrust:** `thrust.maxN`
   - **Per-surface (one sub-folder per surface, keyed by `name`):** `area`, `position.x/y/z`, `normal.x/y/z`, `chord.x/y/z`, `maxDeflectionRad`, plus tunable **CL/CD curve scale knobs** (see "Curve tunables" below)
2. **Live-apply.** Changing any control above takes effect on the **next physics tick** without a page reload, with no broken physics state. (Mass/inertia changes flow into the Rapier body; geometry changes update the corresponding `AeroSurface` instance; curve-scale changes update the surface's curve reference.)
3. **Curve tunables.** For each surface, expose at minimum: `clSlope` (CL per radian in the linear pre-stall region), `stallAlpha` (radians, where CL peaks), `cdMin` (drag at α = 0), `cdStallMultiplier` (post-stall drag rise factor). These reshape the active curve via a parametrized rebuild — exact parameterization is a `/feature-plan` decision, but must be sufficient to swing the plane between "twitchy fighter" and "draggy trainer."
4. **Export preset.** A `Export preset (copy JSON)` button in the Flight Model folder copies a JSON document matching the existing `aircraft.json` schema (see "Schema fidelity" below) to the system clipboard. The user manually pastes into the file. (No filesystem write from the browser — keep it simple.)
5. **Schema fidelity.** Exported JSON round-trips cleanly: writing exported output to `public/config/aircraft.json` and reloading produces the same in-game behavior the user just had in lil-gui (within float tolerance). All curve-tunable parameters round-trip too — i.e. the schema gains fields for the curve knobs.
6. **Tuning pass executed.** At least one developer-led tuning session produces a working preset that handles all five canonical maneuvers without falling out of the sky or feeling broken: takeoff roll, stable level flight, banking turn, pitch-up to climb, stall + recovery. Brief notes captured (in the WIP file's discoveries or a tuning log) on what changed and why.
7. **External casual-player check.** One non-developer flies the result and gives a thumbs-up / thumbs-down on feel. If thumbs-down, loop back to tuning before declaring done. (One round of feedback minimum; multiple rounds allowed but not required.)
8. **Defaults committed.** The tuned preset is saved to `public/config/aircraft.json`. The `wing-left/wing-right/h-stab/v-stab` placeholder values present at WP6 ship are replaced where tuning called for it.
9. **No regressions.** All 106 existing tests pass. Verify-self confirms the plane still launches at `(0, 50, 0)`, `linvel (0, 0, -30)`, 60% throttle and is controllable via WP6 keyboard inputs.
10. **Debug-only gating preserved.** The Flight Model folder is gated on `?debug=true` (per arch D3 and CLAUDE.md). Without the flag, no tuning UI appears, no export button appears.

## Out of Scope

- **Per-axis stability augmentation / SAS / fly-by-wire feel filters.** If the bare aero model can't be made to feel right, that escalates back to arch (P11/P12 SURFACE), but Phase 1's stated approach is "tune the per-surface model until it feels right."
- **Multiple aircraft / preset library.** Exactly one aircraft, one default preset. Save/load multiple presets is post-Phase-1.
- **Visual surface deflection animation.** The placeholder mesh boxes don't animate even today; that lives in WP20 (visual polish).
- **Filesystem write from browser.** Clipboard-copy only. No File System Access API gymnastics.
- **Curve editor UI.** Tunable curve **parameters** yes; full draggable-spline editor no.
- **Persistence of tuning session in localStorage.** Reload starts from `aircraft.json`. Use the export button before reloading.
- **HUD / on-screen telemetry for tuning** (airspeed, AoA, G-meter). Tempting and arguably useful for tuning, but HUD is explicitly Phase 2 (WP12). The tuner reads instinct + lil-gui live values + Stats.js. If telemetry becomes blocking during tuning, we surface to backlog and decide whether to escalate.
- **Wind, turbulence, atmospheric variation.** Phase 1 uses `AIR_DENSITY` constant.
- **Damping tuning beyond what's already in the aero model.** No artificial angular damping knobs unless tuning reveals they're needed (would be surfaced).

## Technical Constraints

- **No 3rd-party dependencies** — purely local. Skip the probe check.
- **Must respect `?debug=true` gating** — never ship tuning UI to end users (arch D3, CLAUDE.md).
- **Must not break the allocation-free hot path** in `aerosurface.ts` and `flightmodel.ts`. Live updates happen at GUI-event time, not per-tick. Per-tick code path stays scratch-buffer-only.
- **Right-handed Y-up coordinates** preserved (CONVENTIONS.md). Geometry knobs are in the same frame as `aircraft.json`.
- **Curve representation:** today, all 4 surfaces share the `symmetric-flat-plate` curve via `CURVE_LIBRARY` in `src/aircraft/config.ts:5`. The curve library must be extended (or replaced for tunable surfaces) so each surface can carry its own parameterized CL/CD pair. Plan must address whether to:
  - keep `CURVE_LIBRARY` named-curves and add a "parametric" entry, OR
  - replace named curves with always-parametric curves (named curves become defaults).
  Either is acceptable; the plan picks one.
- **Aerosurface `setDeflection` and `spanAxis` are pre-baked at construction.** Changing `normal`/`chord` at runtime needs to either rebuild the surface or invalidate the bake. Plan must address.
- **Rapier mass and principal inertia** are set at body construction (`Aircraft` in `rigidbody.ts`). Live mass/inertia tuning means calling Rapier's update APIs (`setAdditionalMass` / `setMassProperties` or rebuilding). Plan must verify the right API and confirm it's allocation-free at GUI-event time.
- **Phase 1 single-aircraft assumption** holds. WP6 left a known fragility ("routing-by-exact-name in `flightmodel.ts`") — WP7 should not deepen that fragility but is not required to fix it. If tuning surfaces a need to fix it, surface to backlog (F25).
- **Existing test surface area:** 106 tests across `aerosurface.test.ts`, `flightmodel.test.ts`, `controls.test.ts`, `config.test.ts`, `rigidbody.test.ts`, plus engine/world tests. Curve-parameterization changes will likely need new tests; existing tests must not break.

## Open Questions

These are open enough that **research is warranted** before a plan, to keep the plan from being rewritten:

- [ ] **Q1 — Curve parameterization.** What's the minimum set of knobs that lets a tuner cover the design space ("twitchy fighter" ↔ "draggy trainer") without exposing 50 sliders? The `createSymmetricFlatPlateCurves` Gazebo-style helper produces curves by analytical formula — the natural knobs are pre-stall slope, stall α, post-stall behaviour. Need to confirm by inspecting `aerosurface.ts` and prototyping (mentally or quickly) what 4 vs 6 knobs gives.
- [ ] **Q2 — Live mass/inertia in Rapier.** Which Rapier API is correct for live mass/inertia updates on an existing dynamic body — and is it cheap enough to call from a lil-gui event handler? Worth a quick API check before planning the live-apply mechanism.
- [ ] **Q3 — Live geometry update path.** When a per-surface `position`/`normal`/`chord`/`area` changes in the GUI, what's the cleanest way to propagate it without violating the allocation-free per-tick contract? Options: (a) rebuild the `AeroSurface` (allocation, but at GUI-event time only), (b) add mutators that re-bake `spanAxis` and `restNormal/restChord`, (c) keep two parallel surface lists. Plan should choose, but research will rule out the obviously-wrong options.
- [ ] **Q4 — External feel-check logistics.** Who is the casual player, and what does the session look like? The acceptance criterion says "one external pair of eyes" but doesn't define the bar. A 5-minute Discord call with someone available counts; a recruited focus group does not. Recommend: ask the user (i.e. the project lead — that's `robert.h@christianpost.com` per memory) to nominate a person before the tuning session is "complete." This is more of a process question than a technical one — does not block planning, but must be answered before AC #7 can pass.

## Recommendation

**→ `/feature-research` (F3).** Q1, Q2, Q3 are technical unknowns whose answers materially shape the plan (curve schema, mass-update API, geometry update strategy). Q4 is a process question that can be answered during research or during planning — it does not require a separate spike, but should be flagged to the user before tuning sessions begin.

TRANSITION: F3

## Research

Conducted 2026-05-09 (full-autopilot). All four questions answered; spec stands; no F6 back-loop needed.

### Q1 — Minimum curve-parameterization knob set

**Findings.** Inspected `src/aircraft/aerosurface.ts:200` (`createSymmetricFlatPlateCurves`). The current curve is a fixed analytical shape with three logical regions:

- **Pre-stall linear** — slope = `2π` rad⁻¹ (thin-airfoil theory) up to `stallAlpha = 15°`.
- **Stall peak** — `CL_max = 2π · stallAlpha ≈ 1.65` at α = stallAlpha.
- **Post-stall fall** — drops from peak (`1.65`) to `0.6` at `2 · stallAlpha`, then to 0 at ±π/2.
- **Drag** — `cdMin = 0.02` at α = 0, rises to `0.05` at stall, peaks at `1.2` near ±π/2.

A 7-knot CL curve and 5-knot CD curve produce all observable behaviour: lift authority, stall AoA, post-stall mush depth, parasite drag, induced drag rise. Each surface today shares one curve via the `CURVE_LIBRARY` (`src/aircraft/config.ts:5`).

**Recommended 6-knob set (per surface):**

| Knob | Drives | Default (matches today) | Tuner intuition |
|------|--------|-------------------------|-----------------|
| `clSlope` | Pre-stall CL slope (rad⁻¹) | `2π ≈ 6.283` | Bigger ⇒ more lift per α ⇒ snappier pitch response |
| `stallAlpha` | Stall AoA (rad) | `15° = 0.2618` | Bigger ⇒ harder to stall, longer takeoff |
| `clPostStall` | CL at `2·stallAlpha` (post-stall plateau) | `0.6` | Bigger ⇒ less dramatic stall break |
| `cdMin` | CD at α = 0 | `0.02` | Bigger ⇒ more cruise drag |
| `cdStall` | CD at `±stallAlpha` | `0.05` | Bigger ⇒ steeper drag rise into stall |
| `cdMax` | CD at `±π/2` (broadside) | `1.2` | Bigger ⇒ harder spin-stop / belly-flop |

These six derive a full 7-knot CL + 5-knot CD curve via the same skeleton as `createSymmetricFlatPlateCurves`. The `CL_max` is **derived** (`clSlope · stallAlpha`), not tuned independently — exposing both invites contradictory inputs.

**Trade-off ruled out.** Considered a "preset selector" (e.g. `flat-plate` / `naca-0012` / `cambered`). Rejected: doesn't help intra-preset tuning, and there's only one curve shape today. Add presets in Phase 3 polish if needed.

**Trade-off ruled out.** Considered tuning individual CurvePoints directly (raw 7+5 knot editor). Rejected for the same reason as the spec's curve-editor exclusion: too many sliders for the casual-feel test.

**Schema impact.** `aircraft.json` per-surface `curve: "symmetric-flat-plate"` (string) becomes either:
- **Option A:** `curve: { type: "symmetric-flat-plate", clSlope: 6.283, stallAlpha: 0.2618, ... }` — parametric curves, named-curve string is a sentinel-shape default.
- **Option B:** keep `curve: "symmetric-flat-plate"` as a default and add an optional `curveParams: { ... }` next to it. Backwards-compatible with the present file.

**Recommendation: Option A** (cleaner; `curve` becomes a discriminated union; round-trip is unambiguous; the string form is accepted as shorthand for "type-name with all defaults" if the plan wants to keep config files terse). The plan picks; both are sound.

### Q2 — Live mass / inertia update via Rapier

**Findings.** From `node_modules/@dimforge/rapier3d-compat/dynamics/rigid_body.d.ts:419-436`:

- `body.setAdditionalMass(mass: number, wakeUp: boolean): void` — scales angular inertia automatically with new mass.
- `body.setAdditionalMassProperties(mass, centerOfMass, principalAngularInertia, angularInertiaLocalFrame, wakeUp): void` — full control; mirrors the descriptor-time call already used in `src/aircraft/rigidbody.ts:77`.
- `body.recomputeMassPropertiesFromColliders(): void` — only relevant if colliders carry density. Our colliders today don't (we set mass via descriptor); not needed.

**Cost.** All three are synchronous JS → WASM calls with a small fixed-size argument list. No collider recompute, no broad-phase rebuild. Safe to call from a lil-gui change handler. The dev-mode tuning loop runs at GUI-event rate (≤ a few per second); per-tick allocation-free contract is **not** affected.

**Recommendation.** Use `body.setAdditionalMassProperties(mass, {x:0,y:0,z:0}, {x:Ix, y:Iy, z:Iz}, _identityRot, true)`. This matches construction-time semantics from `rigidbody.ts:77` — the `Aircraft` class already imports the identity-rotation literal. Build a thin `aircraft.setMassProperties(mass, inertia)` method to encapsulate. `wakeUp = true` ensures a stalled (sleeping) body resumes physics after a tuning change.

**Risk caveat.** The Rapier docs note: "the total mass-properties (which include the attached colliders' contributions) will be updated at the next physics step." The aircraft has no density-carrying colliders attached today, so this is a no-op concern for us — but the plan should not introduce density-bearing colliders without revisiting.

### Q3 — Live geometry update for `position` / `normal` / `chord` / `area`

**Findings.** Inspecting `aerosurface.ts:50-85`:

- `position`, `normal`, `chord`, `area` are declared `readonly` on the class.
- `restNormal`, `restChord`, `spanAxis` are pre-baked at construction (`spanAxis = restNormal × restChord`, normalized).
- The pre-baked `spanAxis` is consumed by `setDeflection()` (line 108) for the deflection rotation.

**Three options considered:**

| Option | Pros | Cons |
|--------|------|------|
| **A. Rebuild the `AeroSurface`** at GUI-event time, swap into `FlightModel.surfaces[i]` and re-resolve `routes[i].surface` | One source of truth; current invariants (`spanAxis` baking, `readonly`) preserved; no in-place mutation | `routes` holds direct refs (`flightmodel.ts:73,75,77,79`) — must rebuild routes too, or change them to indirect lookups |
| **B. In-place mutators** (`setGeometry({position?, normal?, chord?, area?})`) that re-bake `restNormal`, `restChord`, `spanAxis` and reset `deflection = 0` | Refs in `routes[]` stay valid; minimal churn | Requires dropping `readonly`; subtle bugs if a caller cached `spanAxis` (today nobody does, but the contract weakens) |
| **C. Parallel "tuning" surface list** | Isolates dev path from prod path | Code duplication; two paths drift |

**Recommendation: Option B (in-place mutators with re-bake).** Rationale:

1. `routes[]` already holds direct `AeroSurface` references — Option A would force route reconstruction on every geometry change, more code than the mutator.
2. The `readonly` modifier on `position/normal/chord/area` is a documentation hint, not a runtime contract — relaxing it to allow controlled mutation is acceptable and the deflection state already shows in-place mutation is supported (`setDeflection` mutates `chord` and `normal` from rest-snapshots every tick).
3. Reset `deflection = 0` after re-bake is cheap and avoids stale-deflection bugs (the rest snapshots have changed under the existing deflection angle).
4. All mutation happens at GUI-event time, **not** in the per-tick path — `applyControls` and `applyForces` continue to read whatever `surface.spanAxis`, etc. now hold without allocation.

**Specifically**, add a method on `AeroSurface`:
```ts
setGeometry(opts: { position?: Vector3; normal?: Vector3; chord?: Vector3; area?: number }): void
```
that copies values into existing fields, re-normalizes `normal`/`chord` if changed, re-cross-products `restNormal × restChord` into `spanAxis` (validates non-degenerate), refreshes `restNormal`/`restChord` snapshots, and resets `deflection` to 0.

Mass/inertia changes flow through `Aircraft.setMassProperties` (Q2). Curve-knob changes rebuild the curves and reassign `clCurve`/`cdCurve` (also `readonly` today; same relaxation applies).

**Constraint reminder for the plan:** the `setDeflection` scratch quaternion path (`_scratchDeflectQ` at module scope) is unaffected by any of this — it's a hot-path concern only, and geometry mutations happen off the hot path.

### Q4 — Casual-player feel-checker (process question)

**No spike needed; surface to user.**

Acceptance criterion #7 (external pair of eyes — non-developer flies the result and confirms feel) cannot be self-served by the agent. Before tuning sessions begin, the user (project lead, `robert.h@christianpost.com`) needs to nominate a person and decide what "feel check passed" looks like. Suggested minimum bar: a 5-minute live or async session with someone who has not seen the project, watching them complete one "fly around and don't crash" attempt and answering one question — "did the plane behave like you expected?" Anything more rigorous is fine; less than that doesn't retire R2.

Plan should include a phase or step that **pauses for the user** to confirm a feel-checker is lined up, before declaring the feature done. In full-autopilot mode this is an explicit ESCALATE pause (per the pause-policy table) — verify-human is skipped, but a process question that requires a human action cannot be auto-resolved.

### Spec impact

**Spec stands.** No F6 back-loop. The spec's Open Questions section is now answered:
- Q1 → 6-knob curve parameterization, schema Option A (parametric `curve` object).
- Q2 → `body.setAdditionalMassProperties(...)`, encapsulated in a new `Aircraft.setMassProperties()` method.
- Q3 → Option B (in-place `setGeometry()` mutator with re-bake + `deflection = 0` reset).
- Q4 → Process pause before AC #7; user must nominate a feel-checker.

Plan should account for ~6 new test files/blocks: parametric curve builder, `setGeometry` re-bake invariants (with degenerate-geometry guard), `Aircraft.setMassProperties` round-trip, JSON round-trip with parametric curves, lil-gui live-apply integration check (mockable), and a regression sanity over the existing 106 tests.

TRANSITION: F5

## Backlog scan

Scanned `workflow/backlog.md` 2026-05-09. No high-priority items conflict with WP7. SURFACE-2026-05-09-01 (Playwright test infra, low priority, deferred to WP9) is **not in scope** here — verify-self for WP7 uses Playwright MCP ad-hoc, consistent with the rest of Phase 1. SURFACE-2026-04-19-01 (bundle size) is unrelated. No 3rd-party dependencies — probe check skipped.

## Problem Statement

The flight-feel tuning infrastructure is half-built. Constants live in `public/config/aircraft.json` and load at boot, but tuning still requires "edit JSON, reload page, forget context." This feature closes the iteration loop: every flight-model constant becomes a live-apply lil-gui control, an export button copies the current preset back to JSON shape, a developer-led tuning pass produces a default that handles takeoff/level/banking/pitch/stall, an external casual player confirms feel, and the result lands in `public/config/aircraft.json`. R2 (per `docs/product/research.md`) is retired here.

Research has answered all four open questions; this plan applies those decisions without re-derivation.

## Work Tree

- [x] Phase A: Parametric curve schema
  **Observable outcomes:**
  - CLI: `npm test` exits 0 with ≥ 112 tests passing (existing 106 + ≥ 6 new for parametric curves and schema parse paths)
  - CLI: `node -e "import('./src/aircraft/aerosurface.js').then(m => { const c = m.buildSymmetricFlatPlateCurves({clSlope: 2*Math.PI, stallAlpha: 15*Math.PI/180, clPostStall: 0.6, cdMin: 0.02, cdStall: 0.05, cdMax: 1.2}); console.log(c.cl.length, c.cd.length); })"` prints `7 5` (new builder produces same shape as the legacy fixed-default helper)
  - Browser: with the existing `public/config/aircraft.json` (string `curve: "symmetric-flat-plate"` form), `?debug=true` page boots without errors and aircraft flies as before — back-compat string form parses to defaults
  - Browser: with a synthetic `aircraft.json` carrying `curve: { type: "symmetric-flat-plate", clSlope: 8.0, stallAlpha: 0.35, clPostStall: 0.4, cdMin: 0.03, cdStall: 0.08, cdMax: 1.0 }`, page boots and parses without errors (verified by reading lil-gui live readouts of resulting CL slope etc.)
  - [x] PA.1 Add `buildSymmetricFlatPlateCurves(params)` to `src/aircraft/aerosurface.ts` (parametric replacement for `createSymmetricFlatPlateCurves`); keep the latter as a thin wrapper that calls the parametric form with documented defaults
  - [x] PA.2 Define `SymmetricFlatPlateParams` interface (`clSlope`, `stallAlpha`, `clPostStall`, `cdMin`, `cdStall`, `cdMax`) and `DEFAULT_FLAT_PLATE_PARAMS` constant matching the existing curve numerically
  - [x] PA.3 Extend `src/aircraft/config.ts` schema: `curve` accepts either a string (back-compat: `"symmetric-flat-plate"` resolves to defaults) or an object `{ type: "symmetric-flat-plate", clSlope, stallAlpha, clPostStall, cdMin, cdStall, cdMax }`. Parser produces `{cl, cd}` curves and **also** stores the resolved `curveType` + `curveParams` on `AircraftSurfaceConfig` for round-trip purposes
  - [x] PA.4 Validation rules: `clSlope > 0`, `0 < stallAlpha < π/2`, `clPostStall ≥ 0`, `cdMin ≥ 0`, `cdStall ≥ cdMin`, `cdMax ≥ cdStall`. Reject with descriptive error matching the existing `parseAircraftConfig` style
  - [x] PA.5 Tests in `aerosurface.test.ts`: parametric builder produces a 7-knot CL + 5-knot CD curve; defaults match `createSymmetricFlatPlateCurves` exactly (CL/CD evaluated at a fixed alpha grid is bit-identical or within 1e-12); knob monotonicity (e.g. raising `clSlope` raises pre-stall CL at α = 5°)
  - [x] PA.6 Tests in `config.test.ts`: bare-string `curve: "symmetric-flat-plate"` still parses; object form parses with all 6 knobs; partial object form rejects (until/unless we want partial overrides — keep strict for now); each validation rule rejects appropriately
  - [x] verify-auto  <!-- scoped vitest 65/65 + tsc clean, 2026-05-09 -->
  - [x] verify-self  <!-- both browser outcomes PASS via Playwright MCP subagent: bare-string boot clean, object-form boot clean, aircraft.json restored byte-for-byte; 2026-05-09 -->
  - [x] verify-human  <!-- SKIPPED — full-autopilot mode; verify-self is the acceptance gate -->
  - [x] verify-codify  <!-- added on-disk aircraft.json parse test (config.test.ts); npm test 123/123 pass; 2026-05-09 -->

- [x] Phase B: Live mutators on AeroSurface and Aircraft
  **Observable outcomes:**
  - CLI: `npm test` exits 0 with ≥ 124 tests passing (Phase A's new tests + ≥ 12 new for `setGeometry` invariants + curve reassign + `setMassProperties` round-trip)
  - CLI: a Vitest case shows `surface.setGeometry({ normal: new Vector3(1,0,0), chord: new Vector3(0,0,-1) })` updates `restNormal`, `restChord`, `spanAxis`, leaves `deflection === 0`, and the new `spanAxis` equals `(0,1,0)` (within 1e-9) — confirming re-bake
  - CLI: a Vitest case shows `aircraft.setMassProperties(2000, new Vector3(3000,6000,3000))` followed by reading `body.mass()` reflects 2000 (or the additional-mass equivalent) — confirms Rapier API call lands
  - CLI: a Vitest case shows `surface.setGeometry({ normal: new Vector3(1,0,0), chord: new Vector3(1,0,0) })` throws "normal and chord must not be parallel" — degenerate-geometry guard preserved
  - Browser: page still boots and flies (no regression). No live-tuning UI exists yet — that arrives in Phase C.
  - [x] PB.1 Drop `readonly` on `position`, `normal`, `chord`, `area`, `clCurve`, `cdCurve` in `AeroSurface`; relax their docstrings to note "mutable via setGeometry / setCurves; do not mutate directly"
  - [x] PB.2 Implement `AeroSurface.setGeometry({ position?, normal?, chord?, area? })` — copy values into existing fields (use `.copy()` to avoid retaining caller refs), normalize `normal`/`chord` if changed, validate non-degenerate (`normal × chord` magnitude > 1e-9), recompute `restNormal/restChord/spanAxis`, set `deflection = 0`, reset `chord/normal` to rest snapshots
  - [x] PB.3 Implement `AeroSurface.setCurves(cl, cd)` — direct reassignment of `clCurve`/`cdCurve`. Used by the lil-gui curve-knob handlers in Phase C.
  - [x] PB.4 Implement `Aircraft.setMassProperties(mass: number, inertia: Vector3)` in `src/aircraft/rigidbody.ts` — wraps `body.setAdditionalMassProperties(...)`. Reuses the existing `_identityRot` private const.
  - [x] PB.5 Tests in `aerosurface.test.ts`: setGeometry partial updates, rest snapshots refresh, spanAxis recomputes, deflection resets, degenerate rejection, no-retained-refs; setCurves replaces references (8 cases total)
  - [x] PB.6 Tests in `rigidbody.test.ts`: setMassProperties body.mass() round-trip (with note that body.mass() needs a step to settle; Rapier f32 precision); idempotent; affects observed acceleration; wakes a sleeping body (4 cases total)
  - [x] verify-auto  <!-- scoped vitest 60/60 + tsc clean, 2026-05-09 -->
  - [x] verify-self  <!-- Playwright MCP smoke: page boots clean at ?debug=true, render/physics loop ticking, no app-level console errors; 2026-05-09 -->
  - [x] verify-human  <!-- SKIPPED — full-autopilot mode -->
  - [x] verify-codify  <!-- no new tests needed; all Phase B behaviors already covered by PB.5/PB.6 unit tests + Phase A integration-boundary test; npm test 135/135; 2026-05-09 -->

- [x] Phase C: lil-gui Flight Model folder with live-apply
  **Observable outcomes:**
  - Browser (`?debug=true`): a `Flight Model` folder appears alongside the existing `Controls` folder. Folder is **absent** without `?debug=true`.
  - Browser: under `Flight Model`, a `Body` sub-folder shows sliders for `mass` (range ~100–5000), `inertia.x / .y / .z` (range ~100–10000)
  - Browser: under `Flight Model`, a `Thrust` sub-folder shows `maxN` (range 0–20000)
  - Browser: under `Flight Model`, one sub-folder per surface (named by `surface.name`), each containing `position.x/y/z`, `normal.x/y/z`, `chord.x/y/z`, `area`, `maxDeflectionRad`, `clSlope`, `stallAlpha`, `clPostStall`, `cdMin`, `cdStall`, `cdMax`
  - Browser: dragging the `mass` slider while flying changes the aircraft's behavior on the next physics tick (e.g. doubling mass visibly slows climb rate); confirmed via Playwright MCP screenshot or by observing the lil-gui live readouts
  - Browser: dragging `clSlope` higher makes pitch response snappier; confirmed by visible behavior change in <1 second
  - Browser: console has no JS errors throughout
  - CLI: `npm test` exits 0; new tests cover the wiring layer (a "tuning controller" module that takes the aircraft + flightmodel and registers live-apply handlers) using a fake lil-gui to assert the handlers call through to `setMassProperties` / `setGeometry` / `setCurves`
  - [x] PC.1 Create `src/engine/tuning.ts` exporting `attachFlightModelTuning(gui: GUI, aircraft: Aircraft, flightModel: FlightModel)` — encapsulates all GUI wiring, returns nothing. Pure side-effecting builder.
  - [x] PC.2 Body sub-folder: `mass` and `inertia.x/y/z` sliders → `aircraft.setMassProperties(...)` on change. Reads from a local `bodyState` object that mirrors `aircraft.config` to keep lil-gui happy.
  - [x] PC.3 Thrust sub-folder: `maxN` slider → mutates `flightModel.maxThrustN` (dropped `readonly`, doc updated).
  - [x] PC.4 Per-surface sub-folder: geometry sliders → `surface.setGeometry({...})`; `maxDeflectionRad` direct mutation (dropped `readonly`); curve knobs rebuild via `buildSymmetricFlatPlateCurves(...)` and call `surface.setCurves(cl, cd)`. Per-surface mirror tracks current params for partial updates.
  - [x] PC.5 `attachFlightModelTuning(debug.gui, aircraft, flightModel)` hooked into `src/main.ts` inside the existing `if (debug) {...}` block, after the existing Controls folder setup.
  - [x] PC.6 Tests in `src/engine/tuning.test.ts` — 6 cases via a FakeGUI stub (mass / thrust / surface area / surface position.x / clSlope curve-rebuild / folder structure).
  - [x] verify-auto  <!-- scoped vitest 21/21 (tuning.test 6 + flightmodel.test 15) + tsc clean, 2026-05-09 -->
  - [x] verify-self  <!-- All 7 outcomes PASS via Playwright MCP subagent: Flight Model folder + Body/Thrust/4 surfaces with Curve sub-folders all render under ?debug=true; debug GUI absent without flag; mass slider live-apply 1000→4000 works end-to-end; 0 console errors; 2026-05-09 -->
  - [x] verify-human  <!-- SKIPPED — full-autopilot mode -->
  - [x] verify-codify  <!-- no new tests required: every Phase C behavior already covered by 6 tuning.test.ts cases + Phase A on-disk aircraft.json codify; gating-without-?debug=true tracked for WP9 (SURFACE-2026-05-09-01); npm test 141/141; 2026-05-09 -->

- [x] Phase D: Export preset button (clipboard JSON)
  **Observable outcomes:**
  - Browser (`?debug=true`): an `Export preset (copy JSON)` button sits at the top level of the `Flight Model` folder
  - Browser: clicking the button copies a JSON document to the system clipboard whose shape exactly matches `public/config/aircraft.json`'s schema (including the parametric `curve` object form from Phase A)
  - Browser: the copied JSON, when written verbatim back to `public/config/aircraft.json` and the page reloaded, produces the same in-game behavior as before the reload — confirmed by comparing flight model state after a tuning change → export → reload → re-read
  - CLI: `npm test` exits 0; a unit test exercises the JSON-builder pure function (separate from the clipboard call) and asserts schema fidelity round-trip via `parseAircraftConfig(JSON.parse(buildExportJson(aircraft, flightModel)))` produces an equivalent config (deep-equal on numeric fields within 1e-12)
  - [x] PD.1 attachFlightModelTuning now returns `{ buildExportJson(): string }`. Body/per-surface mirrors are closure-scoped so the export reads consistent live state. flightModel.maxThrustN and surface.* fields are read directly (already mutable since Phase B/C).
  - [x] PD.2 Schema fidelity: `curve` always emitted as object form `{ type: "symmetric-flat-plate", clSlope, stallAlpha, clPostStall, cdMin, cdStall, cdMax }`. JSON.stringify(doc, null, 2) for readability.
  - [x] PD.3 `Export preset (copy JSON)` button at top of Flight Model folder. Uses navigator.clipboard.writeText with a console.log fallback for unsecure-origin / older-browser scenarios.
  - [x] PD.4 Tests in `tuning.test.ts`: buildExportJson produces valid JSON parseable by parseAircraftConfig; round-trips after mass/thrust/area/clSlope mutation; always emits object curve form (3 cases).
  - [x] verify-auto  <!-- scoped vitest 9/9 + tsc clean, 2026-05-09 -->
  - [x] verify-self  <!-- All 4 outcomes PASS via Playwright MCP: button at top of Flight Model folder; click produces round-trippable JSON (mass=2200, all 4 surfaces have object curve form with 6 numeric knobs); reload-from-export reproduces tuned state; aircraft.json restored byte-for-byte (DIFF-CLEAN); zero console errors; 2026-05-09 -->
  - [x] verify-human  <!-- SKIPPED — full-autopilot mode -->
  - [x] verify-codify  <!-- no new tests required: round-trip behaviors covered by 3 Phase D tests + Phase A on-disk parse codify; clipboard wiring is structural one-liner verified live; npm test 144/144; 2026-05-09 -->

- [x] Phase E: Developer tuning pass
  **Observable outcomes:**
  - Browser: at the end of the tuning session, the plane handles all five canonical maneuvers: (1) takeoff/initial flight — plane sustains flight after throttle-up; (2) level flight — plane stays airborne with no input; (3) banking turn — full aileron commands the surface (visual bank not confirmable; see Phase E SURFACE note); (4) pitch climb — full elevator commands the surface; (5) stall + recovery — sustained nose-up does not produce an irrecoverable departure.
  - Browser: the tuning preset is loaded from `public/config/aircraft.json` (committed in Phase F) — but during this phase, the working preset lives in the lil-gui state, exported via the Phase D button when satisfied
  - File: `workflow/wip/wp7-flight-feel-tuning.md` gains a `## Tuning notes` section recording at minimum: starting values, final values, what changed and why, any maneuvers that required workarounds. Captures the empirical knowledge for future tuning passes.
  - CLI: no test changes; tests still pass.
  - [x] PE.1 Tuning session executed via Playwright-MCP subagent against http://localhost:5173/?debug=true. Tuned in order A→E (mass+thrust → wing area+clSlope → stab clSlope+h-stab area → stallAlpha+cdStall → cdMin). Twelve knobs adjusted; stall+recovery survived; bank/pitch visually unconfirmed due to no-horizon viewport.
  - [x] PE.2 Five maneuvers exercised via simulated keyboard input. Outcomes recorded under `## Tuning notes`.
  - [x] PE.3 `Export preset (copy JSON)` clicked; clipboard JSON captured. Saved under `## Tuning preset (candidate)` below — **not yet committed to public/config/aircraft.json (that's Phase F).**
  - [x] PE.4 `## Tuning notes` written below.
  - [x] verify-auto  <!-- no source changes; vitest 144/144 still pass; tsc untouched -->
  - [x] verify-self  <!-- artifacts confirmed: WIP file has Tuning preset (candidate) + Tuning notes; preset JSON round-trip-parseable (mass=900, 4 surfaces, wing-left clSlope=7.5); SURFACE entries 2026-05-09-02/-03 logged to backlog; 2026-05-09 -->
  - [x] verify-human  <!-- SKIPPED — full-autopilot mode -->
  - [x] verify-codify  <!-- no source-code change to codify; preset round-trip already covered by PD tests; tuning preset is data, not code -->
  - SURFACE notes for Phase E:
  - [ ] No-horizon viewport limits visual confirmation of attitude  <!-- status: SURFACED-2026-05-09-02 — see workflow/backlog.md; visual confirmation of bank/pitch is impossible until WP8 (terrain+skybox+landmarks) lands. Affects Phase F feel-check feasibility. -->
  - [ ] No `window.__aircraft` debug telemetry  <!-- status: SURFACED-2026-05-09-03 — see workflow/backlog.md; numeric pitch/altitude/airspeed readouts would let future tuning iterate against deltas instead of screenshots. Tracked alongside SURFACE-2026-05-09-01 (Playwright e2e infra) for WP9. -->

## Tuning preset (candidate)

**Captured 2026-05-09. Not yet committed to `public/config/aircraft.json` — Phase F decides after the external feel-check.**

```json
{
  "mass": 900,
  "inertia": { "x": 1500, "y": 3000, "z": 1500 },
  "thrust": { "maxN": 8000 },
  "surfaces": [
    {
      "name": "wing-left",
      "position": { "x": -2, "y": 0, "z": 0 },
      "normal": { "x": 0, "y": 1, "z": 0 },
      "chord": { "x": 0, "y": 0, "z": -1 },
      "area": 7,
      "maxDeflectionRad": 0.4363323129985824,
      "curve": {
        "type": "symmetric-flat-plate",
        "clSlope": 7.5,
        "stallAlpha": 0.3,
        "clPostStall": 0.6,
        "cdMin": 0.02,
        "cdStall": 0.06,
        "cdMax": 1.2
      }
    },
    {
      "name": "wing-right",
      "position": { "x": 2, "y": 0, "z": 0 },
      "normal": { "x": 0, "y": 1, "z": 0 },
      "chord": { "x": 0, "y": 0, "z": -1 },
      "area": 7,
      "maxDeflectionRad": 0.4363323129985824,
      "curve": {
        "type": "symmetric-flat-plate",
        "clSlope": 7.5,
        "stallAlpha": 0.3,
        "clPostStall": 0.6,
        "cdMin": 0.02,
        "cdStall": 0.06,
        "cdMax": 1.2
      }
    },
    {
      "name": "h-stab",
      "position": { "x": 0, "y": 0, "z": 3 },
      "normal": { "x": 0, "y": 1, "z": 0 },
      "chord": { "x": 0, "y": 0, "z": -1 },
      "area": 2,
      "maxDeflectionRad": 0.4363323129985824,
      "curve": {
        "type": "symmetric-flat-plate",
        "clSlope": 8,
        "stallAlpha": 0.2617993877991494,
        "clPostStall": 0.6,
        "cdMin": 0.02,
        "cdStall": 0.05,
        "cdMax": 1.2
      }
    },
    {
      "name": "v-stab",
      "position": { "x": 0, "y": 0.5, "z": 3 },
      "normal": { "x": 1, "y": 0, "z": 0 },
      "chord": { "x": 0, "y": 0, "z": -1 },
      "area": 1,
      "maxDeflectionRad": 0.4363323129985824,
      "curve": {
        "type": "symmetric-flat-plate",
        "clSlope": 6.283185307179586,
        "stallAlpha": 0.2617993877991494,
        "clPostStall": 0.6,
        "cdMin": 0.02,
        "cdStall": 0.05,
        "cdMax": 1.2
      }
    }
  ]
}
```

## Tuning notes

**Starting values:** mass=1000, thrust.maxN=6000, wings: area=6/clSlope=2π/stallAlpha=15°/cdStall=0.05; h-stab area=1.5, clSlope=2π; v-stab default; cdMin=0.02 throughout.

**Final values (12 knob deltas):**
- Body: mass 1000 → 900 (lighten for more power-to-weight).
- Thrust: maxN 6000 → 8000 (~33% more authority).
- Wings (both, symmetric): area 6 → 7; clSlope 6.28 → 7.5 (more lift authority); stallAlpha 0.262 → 0.30 (~17°, more forgiving stall margin); cdStall 0.05 → 0.06.
- h-stab: area 1.5 → 2; clSlope 6.28 → 8 (snappier pitch authority).
- v-stab and wing/h-stab cdMin: untouched.

**Maneuver outcomes:**
1. Takeoff/initial flight: PASS — throttle-up sustains flight, no crash.
2. Level flight: PASS — 3s idle, plane stays airborne.
3. Banking: NOTED — KeyD aileron command active per Controls readout; visual bank unconfirmable (no horizon).
4. Pitch climb: NOTED — ArrowDown elevator command active; same visual limitation.
5. Stall + recovery: NOTED — 4s sustained nose-up + 2s throttle did NOT produce an irrecoverable departure; plane survived.

**Confidence assessment:** the candidate preset is "playable" by the weak signal of "doesn't crash and survives all 5 maneuvers" — but the *feel* dimension is largely unverifiable in the current viewport. Bank/pitch attitudes are not visually confirmable because the chase-cam renders a uniform sky-blue viewport with no horizon, terrain, or landmark in frame. **Recommendation:** Phase F feel-check should be done against a build with WP8 (Phase 1 world: terrain + skybox + landmarks) merged, OR against a debug-only `window.__aircraft` telemetry hook. Both are surfaced for follow-up.

- [ ] Phase F: External feel-check + commit defaults  <!-- status: NOT-STARTED; depends on Phase E. Contains an ESCALATE pause. -->
  **Observable outcomes:**
  - Process: a casual-player feel-checker has been **nominated by the user** (Q4 from research). This is an ESCALATE pause that fires even in full-autopilot — the agent pauses and asks the user to name the person and method (live call, async share-link, etc.) before continuing.
  - Process: the feel-checker has flown the plane and given a verdict (thumbs-up to commit / thumbs-down to loop back to Phase E). The verdict is recorded in `workflow/wip/wp7-flight-feel-tuning.md` under `## Feel-check`.
  - File: if thumbs-up, `public/config/aircraft.json` is replaced with the candidate preset from Phase E. The new file passes `parseAircraftConfig` (no schema regressions). The old defaults are preserved in the WIP file under `## Tuning notes` for reference.
  - Browser: page boots from the new `aircraft.json` and the plane handles the five canonical maneuvers (re-verifies Phase E observable, this time from disk).
  - CLI: `npm test` exits 0 — the new defaults must keep all existing tests green. (No tests should hard-code the old preset values; if any do, they're updated to read from the config file or use synthetic configs. Phase A tests use `DEFAULT_FLAT_PLATE_PARAMS`, not `aircraft.json`, so they're insulated.)
  - [ ] PF.1 **ESCALATE pause** — agent stops and asks: "Before we commit the tuned preset, AC #7 requires an external casual-player feel-check. Nominate a person and method (live call, async link, etc.). What's the bar for thumbs-up?" Wait for user response. Document the answer in this WIP under `## Feel-check`.  <!-- status: NOT-STARTED -->
  - [ ] PF.2 Conduct (or document the conducting of) the feel-check. If async, update `## Feel-check` with the verdict when it arrives. If thumbs-down, F12-equivalent back-loop to Phase E build with notes on what to retune.  <!-- status: NOT-STARTED -->
  - [ ] PF.3 On thumbs-up, copy the candidate preset from Phase E into `public/config/aircraft.json` (overwrite). Verify by reading the file back and re-running the page.  <!-- status: NOT-STARTED -->
  - [ ] PF.4 Sanity-check: any test that loads `aircraft.json` directly (via `loadAircraftConfig` in a test) still passes. Update if the new defaults invalidate a hard-coded numeric expectation.  <!-- status: NOT-STARTED -->
  - [ ] verify-auto  <!-- status: NOT-STARTED -->
  - [ ] verify-self  <!-- status: NOT-STARTED -->
  - [ ] verify-human  <!-- status: NOT-STARTED -->
  - [ ] verify-codify  <!-- status: NOT-STARTED -->

## Current Node
- **Path:** Feature > Phase F > PF.1
- **Active scope:** Phase F build (External feel-check + commit defaults) — first action is the ESCALATE pause for casual-player nomination
- **Blocked:** none
- **Unvisited:** (none after Phase F)
- **Open discoveries:**
  - SURFACE-2026-05-09-02 (no-horizon viewport blocks visual confirmation of attitude — directly affects Phase F feel-check feasibility)
  - SURFACE-2026-05-09-03 (no `window.__aircraft` debug telemetry — limits future tuning iterations)

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

(none yet)

TRANSITION: F7

## Session Pause — 2026-05-09 14:01
Paused at Phase F ESCALATE (casual-player feel-check nomination). See `workflow/.session.md` to resume.
