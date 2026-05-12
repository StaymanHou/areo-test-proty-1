---
stage: context
state: complete
updated: 2026-05-12
---

# Context

Project `CLAUDE.md` is at the repository root and reflects the Phase 1→2 transition:
- Phase 1 closed 2026-05-11 at the Chromium-only / operator-as-tester bar (WP1–WP9 + WP9.5 + WP9.6, 246/246 Vitest + 1/1 Playwright green).
- Phase 2 arch revision closed 2026-05-12 (WP10) under operator-as-architect (full-autopilot deviation per `feedback_operator_as_external.md`).
- `mission/` and `hud/` source dirs are now active per D11/D12.

**Active phase:** Phase 2 — Mission System MVP.

**First feature (next WP):** **WP10.5** — β5 (`clAlphaDot`) schema extension per arch.md Revision 2026-05-12 D13. Closes SURFACE-2026-05-11-04 architecturally. Schema-only, default-zero parity with the 246 existing tests. Small/simple by all five criteria — route to `/feature-plan`.

**Parallel-track Phase 2 features after WP10.5:** WP11 (mission framework, D11) and WP12 (HUD, D12). Both block on WP10 (now complete); WP11 also blocks on WP10.5 since mission tuning may need non-zero `clAlphaDot`.

**Phase 3 re-validation hooks (from arch.md Rev 2026-05-12):**
- D11 (mission framework choice) — reviewable at WP21 (cross-browser QA); swap point is the `Mission` interface in `src/mission/`.
- D12 (DOM HUD) — reviewable at WP21; swap point is the `HUD` interface in `src/hud/`.
- D13 (β5 mechanism) — reviewable at WP17 (Phase 2 verification's ≥30s phugoid probe at non-zero throttle).

**Open SURFACE items at Phase 2 entry:** SURFACE-2026-05-11-04 (phugoid — addressed architecturally by D13/WP10.5; tuning per-mission); SURFACE-2026-05-11-02 (descending-glide vs level cruise — depends on phugoid fix); SURFACE-2026-04-19-01 (bundle size — Phase 3).
