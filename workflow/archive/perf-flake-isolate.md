---
name: perf-flake-isolate
workflow: task
state: close (complete)
drive_mode: full-autopilot
created: 2026-06-06
completed: 2026-06-06
surface: SURFACE-2026-05-16-02
---

# Task: Isolate `flightmodel` wall-clock perf assertion to a perf-only Vitest invocation

**Workflow:** task
**State:** plan (complete)
**Created:** 2026-06-06

## Problem Statement

`flightmodel.test.ts:368` perf assertion (`elapsed < 50ms` after 1000 `applyForces` calls) has flaked 4 consecutive times this session under various parallel-load triggers (Playwright e2e, parallel tsc+vitest+build). Isolation runs consistently pass at ~47ms. Resolves SURFACE-2026-05-16-02; preserves the regression signal under an explicit perf-only invocation.

## Context

- `src/aircraft/physics-core/flightmodel.test.ts:357-369` — the perf test (one `it()` block; otherwise no other perf tests in the suite)
- `vitest.config.ts:1-8` — current `exclude` array already lists `tests/e2e/**`; add `**/*.perf.test.ts` to the same array
- `package.json:6-16` — `test` and `test:e2e` scripts; need new `test:perf` script
- `workflow/backlog.md:196-209` — SURFACE-2026-05-16-02 (4 consecutive triggers, actionable threshold crossed); operator-queued
- Memory: `feedback_surface_or_means_or.md` (single-knob discipline — bound to (b2), not bundled with (b1))

## Plan Choice (decided at plan time per single-knob discipline)

**(b2) Separate `flightmodel.perf.test.ts` file + vitest config exclusion + `npm run test:perf` script.**

Rejected (b1) `test.skipIf(process.env.PERF_TESTS !== '1')` because:
1. No existing env-var-gated tests in this codebase — introducing one is a new convention requiring justification.
2. `*.perf.test.ts` glob is self-documenting; future perf tests follow the pattern without each one needing its own `skipIf` guard.
3. Cleaner separation: vitest.config `exclude` + a `perf` script that overrides via `--exclude '' --include` (or runs a single file directly).

## Work Tree

- [x] T1 Extract perf test to new file `src/aircraft/physics-core/flightmodel.perf.test.ts` (standalone — duplicates `baselineRaw()` + `beforeAll(RAPIER.init)` so it has no dependency on `flightmodel.test.ts`)
- [x] T2 Remove the perf test from `flightmodel.test.ts` (replaced with a one-line breadcrumb comment pointing to the perf file + SURFACE)
- [x] T3 Update `vitest.config.ts` to exclude `**/*.perf.test.ts` from default runs
- [x] T4 Add `test:perf` script to `package.json` — chose `--config vitest.perf.config.ts` route (created new `vitest.perf.config.ts` with `include: ['**/*.perf.test.ts']`) because vitest's `--exclude` is *additive* and positional file-path filters still respect `exclude` (verified empirically — first attempt `vitest run <path>` reported "No test files found" with the perf glob in exclude). Cleanest: dedicated perf config.
- [x] T5 Default `npm run test`: 640/640 GREEN in 2.02s (was 641 — exactly 1 perf test extracted ✓). `npm run test:perf`: 1/1 GREEN in 33ms (well under 50ms threshold in isolation).
- [x] T6 `npm run build` clean (tsc + vite, only pre-existing bundle-size warning per SURFACE-04-19-01). `tsc -p tsconfig.tools.json --noEmit` also clean.

## Current Node
- **Path:** Task > all complete
- **Active scope:** all complete
- **Blocked:** none
- **Open discoveries:** none — clean execution

## Act notes

- **(b2) chosen over (b1).** Plan-time pick stuck. Separate file + dedicated config; no env-var coupling, no `skipIf` precedent introduced.
- **T4 implementation pivot mid-act.** The plan named `vitest run src/aircraft/physics-core/flightmodel.perf.test.ts` as the perf script body, but empirical check confirmed vitest's exclude filter wins over positional filters (vitest 4.1.4 reports "No test files found" when the path matches an `exclude` glob). Created `vitest.perf.config.ts` with `include: ['**/*.perf.test.ts']` and `exclude` minus the perf glob; pointed `test:perf` script at it via `--config`. Self-documenting, isolates perf invocation completely.
- **Files changed:** 4 (1 new perf test file, 1 new perf config file, edited `flightmodel.test.ts`, `vitest.config.ts`, `package.json`).
- **No SURFACEs filed.** No discoveries during execution.

## Retrospect

- **What changed in our understanding:** Vitest 4.1.4's `--exclude` flag is purely *additive* — it cannot remove a glob already in the config-file `exclude` array. Positional file-path filters (`vitest run <path>`) also still respect `exclude`, returning "No test files found" when the path matches an excluded glob. The plan's first-draft script body (`vitest run <path>`) was empirically wrong; a separate `--config` file is the correct shape for invocation-flipped include/exclude.
- **Assumptions that held:** (b2) was the right pick over (b1) — the `*.perf.test.ts` glob convention is self-documenting, no env-var coupling, and `skipIf` would have introduced a new project convention requiring justification. Plan's framing of "two reasonable shapes" was load-bearing — single-knob discipline survived act.
- **Assumptions that were wrong:** Initial assumption that vitest's positional path filter would override `exclude`. Caught at first verification command (~10s of compute), not at write time. Cheap recovery: pivoted to dedicated `vitest.perf.config.ts`. Net cost of the wrong assumption: one extra config file (which is arguably more discoverable than a CLI flag chain anyway).
- **Approach delta:** T4 mid-act pivot from "positional path arg in `test:perf` script" to "dedicated `vitest.perf.config.ts` + `--config` flag." Plan named the wrong implementation shape; act recovered cleanly with a single small detour. Files-changed went from 3 planned (1 new test + 2 edits) to 5 actual (2 new + 3 edits). No back-loop needed — pivot was contained to T4 scope.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
