---
workflow: task
state: act (complete)
created: 2026-06-06
drive_mode: full-autopilot
surfaces: [SURFACE-2026-05-17-02, SURFACE-2026-05-24-02, SURFACE-2026-05-16-03]
---

# Task: arch.md errata bundle — 3 prose-only fixes

**Workflow:** task
**State:** plan (complete)
**Created:** 2026-06-06

## Problem Statement

Three independent, prose-only errata in `docs/product/arch.md` flagged by SURFACE-2026-05-17-02 / -24-02 / -16-03 should be corrected as a single coordinated docs commit so the arch.md prose matches what the code actually does. No behavior change; no test gate beyond `npm run build` (no source touched besides comment cleanup in `aerosurface.ts`).

## Context

Three SURFACE items, each prose-only with code already correct:

### Erratum 1 — SURFACE-2026-05-17-02 (cross-product order)

- **arch.md D17 prose literally specifies `(position × normal)`** as the dampAxis cross-product order. By right-hand rule this produces the *anti*-damping sign (verified analytically in `aerosurface.ts:130-147` field-doc + observed at WP14.9b first failing Vitest run).
- **Code uses `(normal × position)`** at three sites: `aerosurface.ts:214` (constructor), `aerosurface.ts:304` (setGeometry, normal+position change), `aerosurface.ts:334` (setGeometry, position-only change).
- **arch.md sites needing fix:**
  - line 704 (pseudocode comment): `(position × restNormal).normalized()` → `(normal × restNormal).normalized()`
  - line 721 (Sign Convention prose): `(position × restNormal).normalized()` → `(normal × restNormal).normalized()`
  - line 731 (Risk 3 v-stab derivation): the literal cross-product computation `(0, 0.5, 3) × (1, 0, 0) = ...` needs to be flipped to `(1, 0, 0) × (0, 0.5, 3) = (0 · 3 − 0 · 0.5, 0 · 0 − 1 · 3, 1 · 0.5 − 0 · 0) = (0, −3, 0.5)`. Normalized: `(0, −0.987, 0.164)` — primarily −Y (anti-yaw) with a small +Z component. For positive yaw rate (`+ω_y`), the dot product is *negative*, so CL augmentation on v-stab is negative → less sideways force → which dampens nose-right yaw via the loss-of-restoring-force on v-stab. Sign still checks out under the corrected order; analysis prose updates accordingly.
  - line 774 (Schema additions): `(position × restNormal).normalized()` → `(normal × restNormal).normalized()`
- **`wbs.md:370` already says `(normal × position)`** correctly with SURFACE-17-02 footnote — no edit needed.
- **`aerosurface.ts` stale-references-to-erratum:** After arch.md is fixed, 4 in-source comments that say "arch.md says X but we do Y because Z" become stale. They reference a non-existent erratum and would confuse future readers:
  - `aerosurface.ts:35-36` (field-doc preamble) — says dampAxis is `(position × restNormal)` per arch.md
  - `aerosurface.ts:141-147` (binding field-doc cross-product order note) — multi-line erratum explanation
  - `aerosurface.ts:206-213` (constructor inline comment) — "NOT the `(position × normal)` literal in arch.md D17 prose"
  - `aerosurface.ts:301-304` (setGeometry inline comment) — "D17: refresh dampAxis from pre-incidence normal × position"
  - `aerosurface.ts:576-580` (computeAeroForce inline comment) — describes dampAxis derivation in the math-trace narrative
- **Decision on code-comments:** Update comments to (a) drop the "but arch.md says X" wording (post-fix it doesn't), (b) preserve the sign-correction *analysis* (it's the physical reasoning, still load-bearing) but reframe as "binding analysis" rather than "deviation from arch.md". Keep the SURFACE-2026-05-17-02 reference as a historical pointer.

### Erratum 2 — SURFACE-2026-05-24-02 (Iyy/Ixx misnaming)

- **arch.md Revision 2026-05-23 line 808** mis-names the pitch-axis inertia: in this project's Y-up convention pitch is about body X, so pitch-axis inertia is `Ixx`, not `Iyy`. NASA-aero convention's `Iyy ≈ 1346 kg·m²` for Cessna 172 (Z-down convention) maps to our `Ixx ≈ 1346`. Current `aircraft.json` has `Ixx=1500` (already Cessna-class, only 1.11× heavy) and `Iyy=3000` (yaw inertia in our convention).
- **Edit:** Replace line 808's prose `"Iyy=3000 vs Cessna-class ≈1346 is ~2.2× heavy. Halving Iyy speeds the phugoid period by `√2 ≈ 1.41×` (since `T ∝ √I`) but does not change peak energy excursion — the phugoid amplitude is set by initial conditions + dissipation, not period. Won't close the 320,000× score gap. Rejected as the third mechanism layer; potentially worth a small hand-tune later under CLAUDE.md Rule #3's operator-as-architect gameplay-feel exemption."` with the corrected prose drawn from the SURFACE's suggested action (line 184 of `backlog.md`): explain Ixx vs Iyy in Y-up convention, note current Ixx is already Cessna-class, note Iyy=3000 is yaw inertia which doesn't directly couple to airspeed-overshoot.
- **Line 924 (the D19 architect cycle's diagnostic of the SURFACE-24-02 origin):** Stays as-is. It's describing the error; it's NOT the error site.
- **Line 984 (the SURFACE-24-02 meta-note inside arch.md):** Stays as-is. Same reasoning.

### Erratum 3 — SURFACE-2026-05-16-03 (NaN-penalty sign typo)

- **arch.md line 409** writes `-1e9 - tick_of_first_NaN` while the surrounding text says "Higher is better" + "prefer-failing-later" — under higher-is-better, `-1e9 - tick` makes EARLIER NaN score *higher* (better), which is opposite-of-intent.
- **`tools/tune/score.ts`** already implements `-1e9 + tick_of_first_NaN` (intent-correct). Verified — file header documents the discrepancy with the explicit "arch.md is wrong; intent is right" note.
- **Edit:** Single-character fix at arch.md line 409: `-1e9 - tick_of_first_NaN` → `-1e9 + tick_of_first_NaN`.

## Work Tree

- [x] T1 Edit `docs/product/arch.md` — **5 cross-product-order substitutions** (lines 704, 721, 731, 774, +784 discovered during edit). Line 731's literal cross-product math rewritten with corrected `(normal × position)` → `(0, −0.987, 0.164)` (anti-yaw axis for v-stab); Risk 3 analysis revised honestly to note v-stab β4 would *anti-damp* yaw at non-zero clQ — practically inert because v-stab clQ defaults to 0.
- [x] T2 Edit `docs/product/arch.md` line 808 — replaced Iyy/Ixx prose with Y-up-convention-correct analysis. Current Ixx=1500 is already Cessna-class (1.11× heavy); Iyy=3000 is yaw inertia which doesn't couple to airspeed-overshoot symptom; even if Ixx were the right knob, period change doesn't fix energy excursion.
- [x] T3 Edit `docs/product/arch.md` line 409 — flipped NaN-penalty sign `-` → `+`.
- [x] T4 Edit `src/aircraft/physics-core/aerosurface.ts` — 4 comment sites updated:
  - Lines 35-38: clQ field-doc preamble, fixed cross-product order.
  - Lines 141-147: dampAxis field-doc cross-product order note, reframed from "arch.md says X but we do Y" to "moment-balance demands `(normal × position)`; historical note: arch.md initially specified wrong order, corrected 2026-06-06".
  - Lines 206-213: constructor inline comment, dropped "NOT the literal in arch.md D17 prose" wording.
  - Lines 576-582 (computeAeroForce): **NEW DISCOVERY — comment had a real sign-analysis bug.** It described `dampAxis = (position × restNormal)` = `(−1,0,0)` and reasoned "negative dot product → ΔCL < 0 → downward lift → nose-down damping" — two wrong steps that *cancelled out* to the right answer. Rewrote to use the correct `(normal × position) = (+1,0,0)` chain: positive ω_x → positive dot → ΔCL > 0 → upward lift at +Z → nose-down moment → damping. Also fixed an ambiguity in body-axis labeling (the original hedged "+ω_y... actually +ω_x in body-Y-up"; pitch IS body X in this convention, no hedging needed).
- [x] T5 Verify-auto:
  - tsc strict (main config): clean
  - tsc strict (tools config): clean
  - Vitest first run: 640/641 — **SURFACE-2026-05-16-02 perf-flake fired** (58.3ms vs 50ms at `flightmodel.test.ts:368`) under parallel system load. Isolation re-run: 22/22 in 47ms. Full-suite re-run after load cleared: **641/641 GREEN in 1.92s.** Verified the flake is the known issue, unrelated to this task's edits (only doc prose + comment changes; no logic). Updated SURFACE-2026-05-16-02 with 4th-consecutive observation + new trigger (parallel verify-auto load, not just Playwright-pegging).
  - Vite build: clean (Rapier WASM size warning unchanged — unrelated).

## Current Node

- **Path:** Task > all complete
- **Active scope:** all complete
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** none NEW from this task; SURFACE-2026-05-16-02 received a 4th-consecutive-feature observation note in `workflow/backlog.md`.

## Discoveries

<!-- Format: [SURFACED-<date>] <target node> — <summary> -->

[SURFACED-2026-06-06] T4 — Plan-time discovery: `aerosurface.ts` carries 4-5 in-source comment blocks (lines 35-36, 141-147, 206-213, 301-304, 576-580) that explicitly reference the arch.md D17 erratum ("arch.md says X but we do Y because Z"). After arch.md is fixed, these comments reference a non-existent erratum and confuse future readers. Pulled INTO this task as T4 rather than filing as a new SURFACE — scope is identical (prose-only cleanup) and the two are causally linked (the comments only exist BECAUSE of the arch.md error).

[SURFACED-2026-06-06] T4 — Act-time discovery: the `computeAeroForce` inline comment at lines 576-582 contained a real *sign-analysis bug* (not just a stale arch.md reference). It used the wrong cross-product order `(position × restNormal)` AND drew a sign argument that compensated for the wrong direction — two wrongs that cancelled to a correct conclusion. Fixed both halves; the corrected comment now reasons through the same direction the code actually takes. No behavior change (the code was always right); the comment was an unreliable witness to its own correctness. NOT filing as a new SURFACE — same family as the SURFACE-2026-05-17-02 cleanup; absorbed in T4 scope.

[SURFACED-2026-06-06] T5 — Verify-auto-time observation: SURFACE-2026-05-16-02 perf-flake fired again, this time under a new trigger (4 parallel verify-auto commands during the same prompt turn, no Playwright). 4th consecutive feature/task observation; updated the SURFACE inline with the new data point.

## Retrospect

- **What changed in our understanding:**
  - **The `aerosurface.ts:576-582` comment contained a real sign-analysis bug**, not just a stale arch.md reference. It claimed `dampAxis = (position × restNormal) = (−1,0,0)` for an aft h-stab AND argued "negative dot product → ΔCL < 0 → downward lift → nose-down damping." Both halves were wrong: the cross-product order was the broken arch.md order, and the sign argument was anti-damping reasoning that happened to land on the right conclusion (damping) through cancellation. The code has always been correct because it computes `(normal × position) = (+1,0,0)` and the live behavior is verified by Vitest. Comments cannot be trusted to describe their own code's correctness when both have lived through a sign-convention bug. This is a stronger version of the SURFACE-2026-05-17-02 finding — the erratum was deeper than "arch.md prose was wrong but the code is right and the field-doc explains why"; one of the in-code comments had ALSO inherited the wrong reasoning and survived in stealth.
  - **Edit count was 5 cross-product substitutions in arch.md, not 4 as planned.** Discovered line 784 (in an "Open question" section about whether geometric derivation is correct) during T1 verification grep. The plan's site enumeration was based on a literal-cross-product grep at plan time; line 784 used the same literal but wasn't caught by the initial scan because it was inside a different `^#+ ` section. Lesson for future doc-errata bundles: a SURFACE entry's site enumeration is a *floor*, not a ceiling; verify-grep after edits to confirm exhaustion.
- **Assumptions that held:**
  - **Indirection in the binding field-doc (`aerosurface.ts:130-153`) was authoritative.** The field-doc explicitly worked the moment-balance chain and named the correct cross-product order; trusting it for the v-stab math rewrite at line 731 produced an internally-consistent result on first attempt (line 139 said "v-stab → primarily −Y (anti-yaw)" — my derivation confirmed `(0, −0.987, 0.164)` which is primarily −Y). Without that anchor I'd have had to derive from textbook scratch.
  - **The size guard rule was correctly read as governing context-loading, not edit targets.** arch.md is 2645 lines but the task EDITS arch.md — reading the file IS the work, not pre-load context. Did not append a size-guard note to Discoveries.
  - **Single-knob discipline correctly distinguished "OR alternatives for the same problem" from "independent fixes batched in one doc commit."** Bundling 3 SURFACEs in one task was the right call; they live in one file, each is independent, and the verify-auto pass is shared.
- **Assumptions that were wrong:**
  - The plan said T4 would touch "4-5 in-source comment blocks" — actual was 4. The `setGeometry` blocks at lines 301-304 and 326-334 use the cross-product correctly in code AND their comments do NOT mention the arch.md erratum (they just say "D17: refresh dampAxis from pre-incidence normal × position" — which is already the corrected order). No edit needed there. The plan's "4-5" was an estimate; should have been precise.
- **Approach delta:**
  - Plan said "T5 verify-auto: skip Playwright e2e — no source-behavior change." Held. e2e skipped; Vitest physics suite + tsc strict caught any accidental code-edit slip; build clean.
  - Plan did not anticipate the perf-flake firing under the new "parallel verify-auto load" trigger. Triaged inline per existing SURFACE-2026-05-16-02 discipline; updated the SURFACE with the new data point; isolated re-run + full re-run confirmed not-a-regression.
  - Plan did not anticipate the `aerosurface.ts:576-582` sign-analysis bug — that was found at T4 edit time when I tried to rewrite the comment to match the corrected cross-product order and the existing chain of reasoning didn't add up. The "cancelling errors" pattern is more subtle than the original SURFACE captured.

## Why this stays a task and not a feature/spec

- All three errata are prose-only changes to docs (and one comment-cleanup in code that's also prose-only).
- Code behavior is unchanged. The Vitest suite tests behavior; running it post-edit catches any accidental slip in comment-editing that inadvertently touched logic.
- No API, no data shape, no module boundary, no state machine. The conditional `arch.md` read trigger at Step 0 does NOT fire.
- The size-guard rule (300 lines) DID fire informationally — arch.md is 2645 lines — but the file is being **edited** as the task's primary work, not **read for context**. Size guard governs context-loading, not edit targets.

## Single-knob discipline

Per `feedback_surface_or_means_or.md`: this task bundles three SURFACEs, but they're not "OR alternatives" — they're three independent prose corrections that happen to all live in arch.md and all need to land. Bundling is appropriate (single doc, single commit, single verify-auto pass). The single-knob rule applies to *trying multiple fixes for the same problem*, not to *batching multiple independent fixes*.
