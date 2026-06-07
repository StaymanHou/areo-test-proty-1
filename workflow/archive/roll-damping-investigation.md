---
name: roll-damping-investigation
workflow: task
state: close (complete)
drive_mode: full-autopilot
created: 2026-06-06
completed: 2026-06-06
surface: SURFACE-2026-06-06-03
---

# Task: Investigate whether existing D17 clQ mechanism is correctly-shaped for wing roll damping

**Workflow:** task
**State:** plan (complete)
**Created:** 2026-06-06

## Problem Statement

SURFACE-2026-06-06-03 claims "no clP exists in codebase", but plan-time derivation (per CLAUDE.md Rule #5) shows the D17 `clQ` mechanism with per-surface `dampAxis = (restNormal × position).normalized()` evaluates to ±Z (roll axis) on wings. Production `aircraft.json` ships `clQ_wing=1.83`. Yet terminal roll at full aileron is 550°/s (well above 200°/s firm gate). Determine which of three hypotheses explains the gap before architect-cycle commits to D28 vs no-arch-change.

## Context

- `src/aircraft/roll-rate.test.ts` — existing Vitest harness measuring sustained roll at full aileron (`peakSustained` over t=0.5s..1.5s window). Pattern reuse: same world setup, same control input, same RAPIER timestep.
- `src/aircraft/physics-core/aerosurface.ts:582-588` — D17 clQ implementation. Uses `surface.chordLength` (~1m on wings) as the reduced-frequency length.
- `public/config/aircraft.json` — wing-left + wing-right both have `clQ: 1.83`, `position.x: ±2` (so dampAxis evaluates per the D17 formula).
- `docs/product/archive/phase-2-physics-cascade/arch-cycle-D10-D27.md` Revision 2026-05-17 — D17 spec text. The reduced-frequency form `c̄/(2V)` is named for pitch-axis damping; the textbook (Etkin & Reid §5.11) uses `b/(2V)` with wingspan `b` for roll-axis damping. This is the basis for hypothesis (b).
- Memory anchor: `feedback_investigation_before_architect.md` (the rule this task obeys — investigate before committing arch.md when Rule #5 refutes a SURFACE candidate).

## Plan-time arithmetic (per CLAUDE.md Rule #5 derivation)

At observed terminal 550°/s = 9.6 rad/s with `clQ_wing=1.83, chordLength≈1m, V=78 m/s`:
- **Current code (chord-based):** ΔCL = 1.83 × 9.6 × 1 / (2 × 78) ≈ **0.113** — modest damping ΔCL contribution.
- **Textbook roll form (wingspan-based):** ΔCL = 1.83 × 9.6 × 8 / (2 × 78) ≈ **0.901** — **8× larger damping effect** at the same coefficient.

If the formula uses chord-length where wingspan is textbook-correct, the existing mechanism is **under-strength by 8×** at the same nominal coefficient. Hypothesis (b) is strong on this arithmetic alone; investigation confirms whether (b) is the full story or whether (a)/(c) also contribute.

## Branches (outcomes that determine next action)

| Outcome | Diagnosis | Next action |
|---|---|---|
| **Branch 1** | Mechanism correct shape, sign correct, just undertuned. Bumping `clQ_wing` to 8-10 brings terminal under 200°/s. | WP-level retune via harness (no arch change, no D28). SURFACE-06-03 closes via WP-level tune-deploy. |
| **Branch 2** | Mechanism correct shape, sign correct, BUT using `chordLength` instead of wingspan for the non-dim length on roll-axis surfaces. With span=8m substituted, current `clQ_wing=1.83` produces sustained ≤200°/s. | Small arch tweak (D28-α): per-surface `dampLength?` field OR auto-derive based on dampAxis vs primary chord direction. Schema-land + tune-deploy WP pair per CLAUDE.md Rule #6. |
| **Branch 3** | dampAxis sign for wings produces anti-damping (positive clQ AMPLIFIES roll). Increasing clQ_wing makes it WORSE. | Full D28 arch revision required: fix dampAxis sign OR add a separate clP field with correct sign convention for non-pitch axes. |

## Work Tree

- [x] T1 Added Vitest spec `src/aircraft/roll-damping-investigation.test.ts` with Hypothesis (c) sign probe: 3-row comparison clQ_wing ∈ {0, 1.83, 10}.
- [x] T2 Added Hypothesis (b) arithmetic probe to same spec (compute predicted ΔCL contribution with both chord and wingspan; ratio test). Used arithmetic prediction rather than code fork as the plan suggested — cheaper and conclusive for the architectural question.
- [x] T3 Added Hypothesis (a) sweep clQ_wing ∈ {1.83, 3, 5, 8, 12, 20}.
- [x] T4 Diagnostic summary recorded in the Act notes below.
- [x] T5 Updated SURFACE-2026-06-06-03 in `workflow/backlog.md` with the resolution: investigation REFUTED all three hypotheses as actionable; production mechanism already adequate at firm-gate level.
- [x] T6 Full Vitest: **643/643 GREEN** (640 + 3 new investigation cases). Investigation spec runs in 28ms total. No `aircraft.json` change.

## Current Node
- **Path:** Task > all complete
- **Active scope:** all complete
- **Blocked:** none
- **Open discoveries:** none — clean investigation outcome

## Act notes — Investigation diagnostic summary

### Findings at production aircraft.json + V_trim=78 spawn + full aileron + maxDeflectionRad cap=5°

**Hypothesis (c) — sign defect — REFUTED.**

| clQ_wing | Sustained peak (deg/s) over t=0.5..1.5s window | Final tick (deg/s) |
|---|---|---|
| 0 (control) | 192.3 | -183 |
| 1.83 (production) | 179.3 | -171.1 |
| 10 (large non-default) | 137.6 | -132.9 |

Monotonic decrease in sustained peak as clQ_wing increases. clQ=10 produces 28% less roll than clQ=0. **Mechanism correctly damps wings; no sign defect.**

**Hypothesis (b) — wrong reduced-frequency length — REFUTED AS ACTIONABLE.**

Arithmetic prediction at observed 179.3°/s (3.13 rad/s), clQ=1.83, V=78:
- Chord-based ΔCL (current code, c̄=1m): **0.0367**
- Wingspan-based ΔCL (textbook for roll, b=8m): **0.2937** (8× larger)

The wingspan-based formula would produce 8× larger damping at the same coefficient. **However**: the chord-based formula ALREADY adequately damps at production tune (179.3°/s < 200°/s firm gate). The hypothesis is *textbook-correct in principle* (the reduced-frequency length for roll IS wingspan, not chord) but **non-actionable for the SURFACE-06-03 close gate** because the chord-based variant already meets the gate. A wingspan-based revision would over-damp at the same tune (predicted ~22°/s sustained) and require re-tuning. Cost-benefit doesn't favor a D28 cycle just for textbook correctness when the firm gate is met.

**Hypothesis (a) — undertuned — REFUTED.**

| clQ_wing | Sustained peak (deg/s) | meetsGate (≤200) |
|---|---|---|
| 1.83 (production) | 179.3 | ✓ |
| 3 | 171.9 | ✓ |
| 5 | 160.5 | ✓ |
| 8 | 145.9 | ✓ |
| 12 | 130.2 | ✓ |
| 20 | 107.1 | ✓ |

First clQ meeting the gate = production value 1.83. Production aircraft.json is ALREADY adequately tuned for the firm gate. Sweep also shows monotonic damping all the way to clQ=20 (within textbook 0-15 + small headroom).

### Root cause of SURFACE-06-03's "550°/s" framing

**Stale observation.** SURFACE-06-03 was filed during controls-feel-pass Phase 2 verify-self (2026-06-06) when measurements were taken at the **pre-cap** airframe state (`wings.maxDeflectionRad = 25°` = 0.436 rad). Phase 2 capped it to 5° (0.0873 rad) — a 5× reduction in elevator moment at full input — which mechanically caps terminal roll regardless of damping mechanism. The SURFACE entry references this workaround but then claims "feel-knob, not a damping mechanism" — that framing was correct (cap is feel-knob), but the conclusion ("therefore D28 needed") doesn't follow once you measure at the production post-cap state.

The existing `src/aircraft/roll-rate.test.ts` firm-gate assertion (≤200°/s sustained) is GREEN at production. The SURFACE could have been resolved at that test's passing without an investigation cycle — it remained in the backlog as "pending" because the SURFACE entry's prose described the gap in mechanism terms ("no clP") rather than the firm-gate terms.

### Recommendation: Branch 1 (special "already-satisfied" form)

**No D28 architect cycle. No new mechanism. No aircraft.json change. Resolve SURFACE-06-03 by amending the backlog entry to reflect that the existing D17 `clQ + dampAxis` mechanism IS the roll-damping mechanism for non-pitch-axis surfaces.**

If combat WP16 stress-test under sustained aerial maneuvering surfaces a higher-amplitude need (e.g. operator complains "rolls too fast in combat dogfight"), bump `clQ_wing` within the textbook `[0..15]` bound. Investigation spec persists as `src/aircraft/roll-damping-investigation.test.ts` as a diagnostic codification — future tuning passes can re-run it as a regression check on the mechanism's correctness shape.

### Files changed
- **New:** `src/aircraft/roll-damping-investigation.test.ts` (148 lines, 3 Vitest cases, all GREEN, runs in 28ms)
- **Modified:** `workflow/backlog.md` (SURFACE-06-03 status update)
- **NOT modified:** `public/config/aircraft.json` (no production change), `docs/product/arch.md` (no D28 added), `src/aircraft/physics-core/aerosurface.ts` (no mechanism change)

## Retrospect

- **What changed in our understanding:** SURFACE-06-03's prose framing ("no clP exists, need D28 architect cycle") was structurally wrong — D17's existing `clQ + dampAxis` IS the β6 roll-damping mechanism for non-pitch-axis surfaces, because `dampAxis = (restNormal × position).normalized()` evaluates to the roll axis on wings (where `position.x ≠ 0` and `normal = +Y`). The D17 cascade already shipped roll damping; nobody named it that. Independent Rule #5 derivation at the architect-cycle stage caught this before any arch.md text was written. **More structurally:** the "550°/s terminal" observation in SURFACE-06-03 was from a pre-Phase-2-cap airframe state that no longer exists in production. Production measures 179.3°/s sustained — already meeting the firm gate. The SURFACE was effectively self-resolved by the unrelated Phase 2 `maxDeflectionRad` cap commit but its prose lagged the actual state.
- **Assumptions that held:** (i) Plan-time arithmetic on the non-dim form was directionally correct (chord vs span comparison gives the right magnitude analysis). (ii) Three-hypothesis ranking (sign / length / tuning) covered the actual decision space — no fourth surprise hypothesis emerged. (iii) `feedback_investigation_before_architect.md` was the right routing decision — a D28 architect cycle would have been ~3-5h of arch.md text + WBS additions + schema-land WP + tune-deploy WP, all in service of a problem that doesn't exist at production. The 28ms investigation spike was the right cost-benefit.
- **Assumptions that were wrong:** Major: the SURFACE's stated terminal (550°/s) was treated as load-bearing at plan time. Should have been verified at first read instead of trusted. The Phase 2 `maxDeflectionRad` cap was mentioned in the SURFACE entry as a "workaround that doesn't restore damping" — but the test it left behind (`roll-rate.test.ts` at ≤200°/s) was already passing. **Three observations now of the "SURFACE prose lags actual state" pattern** (this one + last week's `arch-md-errata-bundle` 5th-line-discovery + earlier "stale escalation" patterns). The "Before recommending from memory" / "memories can become stale" CLAUDE.md rule applies to backlog SURFACE entries too — they're a kind of memory that drifts.
- **Approach delta:** Plan said T2 would "fork the wing-only computeAeroForce code path"; act used arithmetic-prediction instead (cheaper, conclusive for the architectural question — actual code fork would only be needed if Hypothesis (b) confirmation required runtime validation, which it didn't because (a) already self-resolved). Plan T3 sweep was {1.83, 5, 10, 15, 20}; act expanded to {1.83, 3, 5, 8, 12, 20} for tighter resolution near the production value. No back-loops; investigation flowed cleanly from sign → length → tuning rule-out chain.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
