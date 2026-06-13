---
stage: arch
state: resolved 2026-05-11 — Option β / sub-option β1 (per-surface incidence) selected; see arch.md Revision 2026-05-11 (D10) and wbs.md WP6.5
created: 2026-05-10
resolved: 2026-05-11
source: SURFACE-2026-05-10-02 (bug-fix feature abandoned after exhaustive empirical refutation)
blocks: WP7 Phase E retune, WP9 Phase 1 verification (both now unblocked by WP6.5)
operator_directive_2026-05-10: "the immediate next step should still be making the aircraft spawn airborne with a stable initial state without needing pressing any key. The aircraft should be able to fly straight in that state for eternity." → Option β (airborne trim spawn) is the required path; α (runway) and γ (accept marginal) are off the table.
resolution_2026-05-11: β1 (per-surface `incidenceRad`) selected after (2)-vs-(3) framing debate; (3) tuning-search tooling held in reserve as a fallback path documented in arch.md Revision 2026-05-11. WP6.5 inserted in wbs.md; next step is `/feature-plan` for WP6.5.
---

> **2026-05-11 — RESOLVED.** Decision is recorded in `docs/product/arch.md` Revision 2026-05-11 (D10) and implementation is scheduled as WP6.5 in `docs/product/wbs.md`. The content below is preserved as the decision-context record. `SURFACE-2026-05-10-02` closes-by-implementation when WP6.5 ships.

# Arch handoff: Phase 1 trim-spawn architecture

## TL;DR

The Phase 1 aircraft, even with the AoA sign-convention bug fixed (commit `2bd5119`), **cannot fly stably from spawn** for more than ~1 second. A bug-fix feature attempted four empirical hypotheses to resolve this; all were refuted. The root cause is architectural: **the current `AeroSurface` schema cannot express a trimmable airframe**. This document hands the problem off to the product workflow for an architectural decision before any further feature work is attempted.

## Background

After the AoA sign-convention fix (SURFACE-2026-05-10-01, shipped) closed the *primary* pitch divergence, a *secondary* divergent oscillation was observed by the operator: well-behaved for the first ~1 second post-spawn, then divergent (|pRate| grows from ~94°/s by frame 15 to ±1000–3000°/s by frame 30+). This was originally framed as SURFACE-2026-05-10-02 — a "secondary phugoid" / "weak static stability" bug — and a small/simple bug-fix feature was opened (recommended path: move wings forward in body frame to create positive static margin).

## Empirical attempts (all failed)

The bug-fix feature ran four distinct hypotheses through a Playwright-driven telemetry capture (5-second / ~300-frame window, target `|pRate| < 360°/s` on every frame). Each attempt was a clean change against the WP6 baseline (`mass=1000`, `thrust=6000`, wings at z=0, h-stab at z=+3, all surfaces using bare-string `"symmetric-flat-plate"` curves — i.e. identical and at zero incidence).

| # | Change | Result | Verdict |
|---|--------|--------|---------|
| 1 | Wings forward to `z=-0.5` (mild static margin) | First 49 frames bounded then divergent; max \|pRate\|=**3680°/s** at frame 57 | Worse than baseline |
| 2 | Wings forward to `z=-1.5` (larger static margin) | First 14 frames bounded then divergent; max \|pRate\|=**5586°/s** at frame 112; pitch flips ±180° (tumble) | Even worse — pushing wings too far ahead reverses the static-margin sign and makes wings dominate destabilizingly |
| 3 | Add explicit `cl_q` pitch-rate damping derivative to `AeroSurface` model (h-stab clQ=8.0) | Numerical divergence to NaN by frame 17 with one sign of the damping force; by frame 84 with sign corrected; by frame 119 at clQ=4 | Damping helps slow divergence but never bounds it; mechanism cannot fully compensate alone |
| 4 | Spawn-in-trim attempt — set `controls.throttle = 0.5` at start, set body rotation to +6° pitch nose-up via quaternion (no cl_q, clean baseline) | Frame 0 perfectly trimmed (pitch=6°, pRate=0, vSpd=0, airspeed=30 m/s); divergence still by frame 10 (pRate=490°/s); full tumble by frame 25 | Initial conditions cannot mask underlying instability |

Bonus finding: SURFACE-2026-05-10-02 **reproduces on the clean WP6 baseline** (max |pRate|=2421°/s at frame 48). It is NOT a WP7 mid-retune contamination artifact, as had been hypothesized.

## Root-cause diagnosis (post-empirical)

The bug is architectural, not parametric. With all four surfaces using identical symmetric-flat-plate curves at zero incidence:

1. At α=0 (level body, level flow), every surface produces **zero lift** (symmetric flat plate).
2. To produce lift at all, the body must pitch nose-up — say to +7° AoA (which roughly balances weight at 30 m/s, mass=1000 with our `clSlope=2π` and `area=12 m²` wings).
3. But at body pitch +7°, the h-stab (at z=+3, identical incidence as wings) is ALSO at +7° AoA → also produces upward lift.
4. The h-stab's upward lift, applied aft of CG, generates a strong **nose-down pitching moment**.
5. Nothing in the model counters this moment. Wings sit at z=0 (at the CG longitudinally), so wing lift contributes zero pitching moment by itself. Moving wings forward (attempts 1 and 2) shifted the combined aerodynamic center but did not eliminate the h-stab's destabilizing contribution.

**No trim equilibrium exists** for level flight. The 1-second of "well-behaved" flight observed post-spawn is just the time it takes for the aircraft to transition from "30 m/s glide with no thrust at α=0" to its true equilibrium, which is a tumble.

Real aircraft solve this with one or more of:

- (a) **Wing-incidence ≠ h-stab-incidence** — wings physically mounted at +2° incidence relative to the fuselage longitudinal axis, h-stab at 0° or -1°. Differential incidence is the *primary* mechanism for stable trim in real aircraft.
- (b) **Wing camber** — asymmetric airfoil with non-zero lift at α=0. Our flat-plate symmetric curve has CL(0)=0 by construction.
- (c) **Trim-elevator** — h-stab elevator pre-deflected upward at spawn so its trailing-edge-up position cancels the +α-induced nose-down moment.
- (d) **Pitch-rate damping (`cl_q`)** — damps oscillations but does not create an equilibrium. Necessary, not sufficient.

The current `AeroSurface` schema supports NONE of (a), (b), or (c). (d) was prototyped in attempt #3 and confirmed insufficient on its own.

## Decision points for product:arch

### Top-level option (DECIDED by operator directive 2026-05-10)

**Goal restated:** The aircraft must spawn airborne in a stable initial state. No key press required. It must fly straight indefinitely from that state.

- ✂️ **Option α: Spawn on runway, stationary.** REJECTED. Conflicts with the "already airborne" goal.
- ✅ **Option β: Spawn airborne in a defined trim state.** SELECTED. Requires schema extension so the model can express a true trim equilibrium (see sub-options below).
- ✂️ **Option γ: Accept marginal stability.** REJECTED. Conflicts with "flies straight indefinitely" goal and the `vision.md` "no-tutorial, fly within 30s" principle.

### Sub-decision (PENDING operator): which schema extension implements Option β

For background: every Option-β path needs to do ONE thing — make the AeroSurface model produce a balanced moment about the CG at level body attitude with non-zero wing lift. Without this, no trim equilibrium exists; with it, level flight self-sustains.

#### β1 — Per-surface incidence (`incidenceRad`)
**Mechanism:** Each surface mounts at a configured incidence angle relative to the fuselage longitudinal axis (e.g., wings at +2°, h-stab at −1°). In real aircraft this is how trim is built in at the airframe level. At zero body pitch the wings see +2° AoA → positive lift; the h-stab sees −1° AoA → small negative lift behind CG → small nose-up moment balancing the wing-lift-induced nose-down moment.

**Schema change:**
- Add `incidenceRad?: number` to `AircraftSurfaceConfig` (default 0).
- Plumb it through `parseAircraftConfig` → `AeroSurface` constructor.
- In `computeAeroForce`, rotate the surface's `normal`/`chord` by `incidenceRad` about its span axis before computing local airflow.

**LOC estimate:** ~50, mostly mechanical.
**Test impact:** Default `incidenceRad=0` preserves existing behavior — no existing test should break. New tests assert that a surface with non-zero incidence at level airflow returns non-zero lift.
**Tuning impact:** WP7 Phase E retune now picks `(mass, thrust, area, wing-incidence, h-stab-incidence)` as a coupled set. Slightly more knobs but more physically meaningful.
**Pros:** Textbook, physically grounded, single mechanism. Preserves symmetric-flat-plate curves. Default-off → backwards compatible.
**Cons:** None significant.

#### β2 — Cambered (asymmetric) CL curve
**Mechanism:** Replace the symmetric flat-plate CL curve with one that has `CL(α=0) ≠ 0` (i.e. positive lift at zero AoA, like a cambered airfoil). Wings get a cambered curve; h-stab stays symmetric so it produces zero lift at level airflow (no destabilizing aft moment).

**Schema change:**
- Add `clAt0?: number` (or similar) to `SymmetricFlatPlateParams` (rename module if appropriate). Affects only curve generation.
- Extend `buildSymmetricFlatPlateCurves` to shift the CL curve vertically by `clAt0`.

**LOC estimate:** ~40, contained to curve generation.
**Test impact:** Default `clAt0=0` preserves the symmetric curve exactly. New tests assert curve at α=0 returns the configured non-zero value.
**Tuning impact:** Two new knobs per cambered surface (`clAt0`, plus residual CL slope shape).
**Pros:** Closer to how real cambered airfoils work; the curve-data file is one localized place to express it.
**Cons:** Per-surface "this one is cambered, this one isn't" coupling is awkward; mixing camber across surfaces complicates the JSON. Less mechanically obvious than β1 ("why does this wing produce lift at α=0?" — because we hand-shifted the curve).

#### β3 — Trim-elevator at spawn
**Mechanism:** Set `controls.elevator` to a non-zero value at spawn so the h-stab is pre-deflected to a trim position. The wings still need to produce lift somehow (so β3 alone is insufficient — must be combined with β1 or β2 or with non-zero body pitch attitude).

**Schema change:**
- Add a `trimOffset` field to `Controls` (or just set `controls.elevator` directly in main.ts).

**LOC estimate:** ~10 (alone), but doesn't solve trim by itself.
**Test impact:** Trivial.
**Tuning impact:** Trim-elevator becomes another knob.
**Pros:** Cheapest if used as a complement.
**Cons:** Not a complete solution alone. Player's first elevator input fights against the trim offset, which is annoying. Visible control-surface deflection at spawn looks weird.

#### β4 — Add `cl_q` pitch-rate damping (orthogonal augmentation)
**Mechanism:** Add a pitch-rate damping derivative to the AeroSurface model so that when the body pitches, the h-stab generates an opposing lift force proportional to local pitch rate. Already prototyped and reverted in this session.

**Status:** Necessary or not? *Probably not* for the "flies straight forever" goal under β1, since a true trim equilibrium doesn't need damping to be stationary — only perturbations away from trim need damping to decay. If β1 produces a strong-enough equilibrium that small numerical perturbations (sub-rad/s pitch rates from Rapier integrator drift) decay naturally, `cl_q` is not required. If they don't decay, `cl_q` becomes mandatory.

**Recommendation:** Defer. Implement β1 first. If verify-self shows residual non-zero pitch-rate drift in level flight, add β4 as a follow-up.

### Combinations table

| Combo | Solves airborne trim? | LOC est | Notes |
|---|---|---|---|
| β1 alone | Yes (textbook) | ~50 | Recommended starting point |
| β2 alone | Yes | ~40 | Equivalent outcome via cambered curves |
| β3 alone | **No** | ~10 | Must be combined with β1 or β2 |
| β1 + β4 | Yes + forgiving | ~130 | If β1 alone has integrator-drift issues |
| β2 + β4 | Yes + forgiving | ~120 | Same as above with cambered approach |
| β1 + β2 | Yes (redundant) | ~90 | Over-engineered; pick one mechanism |
| β1 + β3 | Yes + spawn-only stick offset | ~60 | Useful only if WP7 tuning discovers a trim-elevator is needed beyond what incidence provides |

### Sub-decision pending

**Recommended: β1 (per-surface incidence) as the primary mechanism, with β4 (`cl_q`) held in reserve as a follow-up if level flight shows residual drift.**

But this is the operator's call to confirm or override. Once confirmed, the implementation WP gets defined and slotted in before WP7 Phase E retune.

### WBS implications (unchanged)

Whichever sub-option is chosen, the new WP slots in BEFORE WP7 Phase E retune (currently paused) — there is no point tuning feel against an airframe that can't sustain flight. WP9 Phase 1 verification is similarly blocked.

## Recommended next move

Run `/product-arch` (or whichever product-workflow entry-point the workflow uses for re-opening architecture decisions) with this document as context. The decision is short — one design choice across α/β/γ, then schema sub-choices — and should land in a single arch-pass session. Once decided, a new WP gets created and the bug-fix-feature workflow is no longer involved.

## What was preserved

- **AoA sign-convention fix (commit 2bd5119)** is still shipped and correct — confirmed via clean-baseline re-test.
- **227/227 tests green** against the WP6 baseline. Working tree is clean except for paused WP7 telemetry instrumentation in `src/main.ts` (which is the diagnostic tool that made all this empirical work possible — keep until WP7 ships).
- **Archived plan** with retrospect lives at `workflow/archive/static-margin-geometry-fix-ABANDONED.md`.
- **SURFACE-2026-05-10-02** in `workflow/backlog.md` rewritten with empirical findings and architectural recommendations.

## What is blocked

- **WP7 Phase E retune** (already paused). Re-blocked behind this arch decision — same chain as before.
- **WP9 Phase 1 verification** ("developer takes off, flies, crashes"). Cannot be exercised against an airframe that tumbles in 1 second.

## Resolution — 2026-05-11
Resumed via `/session-resume` → `/product-arch`. After a debate framing the problem as (1) physics-wrong vs (2) schema-too-restrictive vs (3) tuning-just-hard, the operator accepted (2) as the working hypothesis with (3) kept as a documented fallback (see arch.md Revision 2026-05-11, "Fallback path"). Sub-option β1 (per-surface `incidenceRad`) confirmed. Decision written into `docs/product/arch.md` (D10 + Revision 2026-05-11). WP6.5 inserted in `docs/product/wbs.md` between WP6 and WP7 on the critical path. WP9 dependencies updated to include WP6.5. Next: `/feature-plan` for WP6.5.
