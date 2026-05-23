---
stage: context
state: complete
updated: 2026-05-23
---

# Context

Project `CLAUDE.md` is at the repository root. Refreshed 2026-05-23 to reflect the D17+D16 cascade completion, WP14.11 ESCALATION, and the D18 architect cycle that produced the WP14.11.5 + WP14.12 work-package additions.

**Active phase:** Phase 2 — Mission System MVP. Mission content (WP15/WP16/WP17) remains paused at the post-WP14 line. The pause line will move to "post-WP14.12 branch A" once the D18 cascade lands.

**First feature (next WP):** **WP14.11.5** — D18 drag polar implementation per arch.md Revision 2026-05-23. Schema extension (`inducedDragK?` per-surface, `fuselageDrag?: {cd0, area}` top-level) + `computeAeroForce` CD augmentation + `flightmodel.ts` body-drag accumulator + triple-gate verify-self (CLAUDE.md Rules #1+#2+#4). NO `aircraft.json` change (deferred to WP14.12 per the D17/D16 two-close-gates precedent). Size S–M, single focused session. Route to `/feature-plan` — small/simple enough to skip `/feature-spec` since arch.md D18 already contains binding implementation spec.

**Next-after-that:** **WP14.12** — 8-dim joint tune over (clQ, clAlphaDot, inducedDragK) × wings+h-stab + (fuselageDrag.cd0, fuselageDrag.area). Includes deployed-symmetric scoring via `tools/tune/score-deployed.mjs` and explicit browser-walkthrough verify-self gate. Replaces ESCALATED WP14.11 as actionable joint-tune WP. Closes-by-implementation SURFACE-2026-05-23-01 (+ transitively 7 chained SURFACEs) on branch A. Routes to D19 (inertia-tensor revision) on branch B per the singular-not-stacked discipline.

**Phase 3 re-validation hooks (cumulative from arch.md):**
- D11 (mission framework choice) — reviewable at WP21 (cross-browser QA); swap point is the `Mission` interface in `src/mission/`.
- D12 (DOM HUD) — reviewable at WP21; swap point is the `HUD` interface in `src/hud/`.
- D13 (β5 mechanism) — reviewable at WP17 phugoid probe.
- D14 (harness methodology) — reviewable at WP21 or sooner if cascade WPs surface problems.
- D17 (β4 non-dim form) — reviewable at WP21 or sooner.
- D16 (β5 non-dim form) — reviewable at WP21 or sooner.
- D18 (drag polar) — reviewable at WP21 or sooner if WP14.12 surfaces problems. Default-zero/default-absent → mechanically clean rollback.

**Open SURFACE items at WP14.11.5 entry:** **SURFACE-2026-05-23-01 (high — D18 cascade driver; closes at WP14.12 branch A)**; SURFACE-2026-05-17-03 (high — partial); -17-01 + -16-01 + -16-04 + -12-03 + -12-01 + -11-04 (all blocked-by -23-01; transitively close at WP14.12 branch A); SURFACE-2026-05-17-02 (medium — arch.md D17 errata, non-blocking); SURFACE-2026-05-11-02 (medium); SURFACE-2026-05-16-03 / -16-02 / -12-02 (low); SURFACE-2026-04-19-01 (Phase 3 — bundle).

**Drive mode:** operator-as-architect deviation per `feedback_operator_as_external.md` continues at full-autopilot; verify-human skipped; SURFACE-IN documents Phase 2 outcomes for Phase 3 re-validation. The browser-walkthrough verify-self gate added to WP14.12 closes the WP14.11-retrospect gap ("Browser walkthrough NOT done at session end") at the cascade-terminal WP under Mode 4.
