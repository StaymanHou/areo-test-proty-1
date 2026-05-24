---
workflow: task
state: act (complete)
created: 2026-05-24
drive_mode: full-autopilot
---

# Task: Add `--link` flag to tune CLI for mirror-symmetric search

## Problem Statement

Per SURFACE-2026-05-24-03 (filed today at WP14.13 close): the tune CLI evaluates an asymmetric search-airframe (only the listed `--knobs` override `aircraft.json` baseline) while the operator deploys symmetric (wing-right mirrored to wing-left). WP14.13 produced the first asymmetric/deployed ratio INVERSION (0.67×) in the D14/D17/D18/D19 cascade — the optimizer's gradient now points away from deployable solutions because the symmetric deployment can be MORE unstable than the asymmetric search at heavy dissipation. This task adds a `--link <src-path>=<dst-path>` flag (repeatable) that copies the source path's knob values to the destination path at every optimizer evaluation, making the search-airframe match the deployment.

## Context

- `tools/tune/tune.ts:81` — `parseArgs(argv)` — argument parsing entry; add `--link` here.
- `tools/tune/tune.ts:168-191` — `buildObjective` — builds `paramStrings` from knobs and passes to harness; add the mirror-expansion here at the natural hook point (line 178).
- `tools/tune/tune.ts:33-41` — `TuneArgs` interface — extend with `links: Array<[srcPath, dstPath]>`.
- `tools/tune/tune.ts:55-65` — `ResultsJson.meta` — extend with `links` for audit-trail (so re-running with the same results JSON reproduces).
- `tools/tune/tune.test.ts` — existing test patterns to follow (mock HarnessFn, capture `params`).
- `tools/tune/harness.ts:24-25` — `--params` consumer; accepts `key.path=value,key.path=value` format. We piggyback on that interface — `--link` just appends mirror entries to the same `params` array.

## Work Tree

- [x] T1 Extended `TuneArgs` with `links: Array<{src, dst}>` field + JSDoc citing SURFACE-24-03. Empty array preserves pre-link behavior.  <!-- status: complete -->
- [x] T2 Extended `parseArgs` with `--link <src>=<dst>` (repeatable). Validation: rejects no-`=`, empty src, empty dst, and self-link. Pushes onto `links: []` accumulator.  <!-- status: complete -->
- [x] T3 Extended `buildObjective` to take optional `links` parameter (defaults to `[]` for backward compat). After paramStrings are built from knob overrides, iterate links and for each knob starting with `${src}.`, append a mirror entry `${dst}.${suffix}=${value}`. Allocation pattern matches the existing knob.map().  <!-- status: complete -->
- [x] T4 Extended `ResultsJson.meta` with `links: Array<{src, dst}>` audit trail. `composeResults` shallow-copies `args.links` (not by reference, so the JSON is a snapshot).  <!-- status: complete -->
- [x] T5 Wired `args.links` through `main()` → `buildObjective(args.knobs, args.regimes, args.ticks, runHarness, args.links)`. Confirmed at T8 smoke.  <!-- status: complete -->
- [x] T6 Added 13 new Vitest cases at `tune.test.ts`:
  - parseArgs: defaults to `[]`, single `--link`, repeated `--link`, malformed (no `=`), empty src, empty dst, self-link rejected.
  - buildObjective: single mirror, multi-knob mirror (3 knobs × 1 link → 6 params), non-matching knobs unaffected, omitted links preserves original, repeated links produces all mirrors.
  - composeResults: `meta.links` preserved bit-identically when present.
  - Updated 1 pre-existing test (`records meta fields with wallClockMs...`) + 1 baseArgs fixture to include `links: []`.
  - **Triage:** 2 of the 13 new tests initially failed at first run due to JS `Number.toString()` stripping trailing `.0` from `2.0`. Triage: obsolete-test (test expectations were wrong about JS number formatting; implementation correct). Fixed expectations to use non-round numbers (1.6/2.1, 1.1/2.2 — same convention as pre-existing test at line 182). See `## Test Triage` section below.  <!-- status: complete -->
- [x] T7 Full suite: Vitest 558/558 PASS (545 pre-existing + 13 new), tsc strict on both configs clean (src + tools), Vite production build clean (bundle warning pre-existing SURFACE-2026-04-19-01).  <!-- status: complete -->
- [x] T8 End-to-end smoke at `/tmp/wp14.13-link/tune-with-link.json` (14.6s wall time). Confirmed:
  - `meta.links: [{"src":"surfaces.0","dst":"surfaces.1"}]` recorded for reproducibility.
  - Optimizer's reported score **= −6,705,355.09**; independent `score-deployed.mjs` re-score on 3 mirror-symmetric harness CSVs returned **−6,705,355.09** — bit-identical. **Search-vs-deploy ratio = exactly 1.0×; methodology mismatch ELIMINATED.**
  - Per-regime deployed: low=−60,435, mid=−3,910,511, high=−2,734,409. Total weighted: −6,705,355.
  - globalBest knobs: `clQ_wing=1.391, clAlphaDot_wing=0.439, inducedDragK_wing=1.290, clQ_hstab=2.667, clAlphaDot_hstab=3.565, inducedDragK_hstab=0.359, fuselageDrag.cd0=0.523, area=7.897`. Notably clAlphaDot_wing collapsed to ~0.44 (vs WP14.13's 3.50) — the symmetric search prefers low β5 on wings.
  - Compared to cascade: WP14.11 deployed −96.1M, WP14.12 deployed −92.6M, WP14.13 deployed −2.999e9 (NaN-floor), WP14.13-link deployed **−6.7M** — **~14× better than WP14.12, ~447× better than WP14.13.** Still ~22,000× past flyable threshold (−300), but the slope is now reliable and substantively closer.
  - **Did NOT deploy `aircraft.json`** — that's the next architect cycle's tune-deploy WP, with the linked CLI as the new standard methodology.  <!-- status: complete -->

## Current Node
- **Path:** Task > all steps complete
- **Active scope:** all complete
- **Blocked:** none
- **Open discoveries:** none

## Retrospect

- **What changed in our understanding:** The methodology fix is a bigger win than expected. I anticipated: tooling-fix → search-vs-deploy ratio converges to 1.0× → optimizer's score becomes reliable → future tune WPs can produce dependable signal. What ALSO happened: the very first linked tune (~15s wall time) found a deployed-symmetric globalBest **~14× better than WP14.12's best** and **~447× better than WP14.13's NaN-floor**. The methodology fix not only enables reliable signal — it *also* unblocked the optimizer to find regions it was previously dodging. The asymmetric search-airframe was actively misleading the optimizer toward false optima at WP14.13; the linked-symmetric search finds substantively different (and better) parameter regions. This validates the SURFACE-24-03 framing that the asymmetric/symmetric mismatch was load-bearing across the cascade.
- **Assumptions that held:**
  - **`--link <src>=<dst>` syntax is the right API shape.** Repeatable flag, simple syntax, no parser ambiguity. Existing CLI patterns absorbed it cleanly.
  - **The hook point in `buildObjective` (after knob-override paramStrings built, before harness call) is the right layer.** The mirror logic is 7 lines; no other code path needed changes.
  - **`feedback_optimizer_bounds_are_floor.md` still applies.** Even at the linked-symmetric search, `inducedDragK_wing=1.290` is at 86% of the widened bound (1.5) — the optimizer still wants more induced drag than the textbook prior. The previous-cycle widening was the right call; widening further at the next tune WP is the same signal.
  - **`feedback_surface_or_means_or.md` — singular not stacked.** SURFACE-24-03 listed 4 candidates ranked 1-4; this task picked rank 1 (tooling-fix) and shipped it cleanly. Stacking with D19d or D19b would have obscured what the tooling-fix alone accomplished.
- **Assumptions that were wrong:**
  - **"The tooling-fix unblocks reliable signal but doesn't directly move the deployed score":** I expected the *same* globalBest as WP14.13 (~−92M deployed-equivalent) and a credible foundation for the NEXT WP to find improvements. Actual: deployed score moved from −2.999e9 (NaN-floor) directly to −6.7M in a single 15-second run. The tooling-fix was *itself* the unlock, not just a precondition. The "asymmetric exploration was actively misleading" framing in SURFACE-24-03 was understated.
  - **JS `Number.toString()` quirk:** picked round numbers (`2.0`, `1.0`) in test expectations; `Number(2.0).toString() === "2"`, not `"2.0"`. Caught at first Vitest run; obvious-triage fix. Note for future test-writing in this codebase: the pre-existing pattern (`3.5, -2.1` at tune.test.ts:178) was using non-round numbers ON PURPOSE; should have noticed and matched at plan time.
  - **The smoke run's `clAlphaDot_wing` collapsing to ~0.44 (vs WP14.13's 3.50):** I expected the linked-symmetric optimum to be *similar* to WP14.13's globalBest, just at higher deployed-quality. Instead, the optimizer found a *qualitatively different* operating point — low β5 on wings, higher β5 on h-stab. The interpretation: WP14.13's high `clAlphaDot_wing=3.50` was an artifact of the asymmetric airframe (where wing-right's baseline `clAlphaDot=0` left damping work to wing-left to compensate). With symmetric wings, the optimizer redistributes the damping role. **This is a real physics insight that wasn't visible until the methodology fix landed.**
- **Approach delta:** Plan had 8 steps T1-T8; executed all 8 in sequence with one minor protocol deviation:
  1. The pre-flight smoke step (Plan T8 prerequisite) was the end-to-end smoke; no separate dry-run smoke was needed because the bounds parser + path parser were already verified at the prior WP14.13 plan.
  2. Test triage fired once (round-number expectations) per CLAUDE.md §3b — handled in-band via the high-confidence obsolete-test path; documented in the WIP `## Test Triage` section per the discipline.

## Communicate

Requester = operator — closure notice for self-record.

> **Closure notice:** task `tune-cli-link-flag` (SURFACE-2026-05-24-03 primary candidate) is complete. Added `--link <src>=<dst>` flag (repeatable) to `tools/tune/tune.ts` for symmetric-mirror search. 13 new Vitest cases; 558/558 full suite passes; tsc + Vite build clean. End-to-end smoke at `/tmp/wp14.13-link/tune-with-link.json` confirms search-vs-deploy ratio collapses to exactly 1.0× (methodology gap eliminated) AND yields a substantively better deployed-symmetric globalBest (~−6.7M, ~14× better than WP14.12) — the tooling-fix is itself a major optimization unlock, not just a methodology repair. **Flyability still gated** at ~22,000× past threshold; next architect cycle re-evaluates remaining D19 candidates (envelope re-calibration, inertia revision re-anchored to Ixx, or new fifth-mechanism) against the now-reliable evidence base. Production `aircraft.json` unchanged. SURFACE-2026-05-24-03 status: partial-close (tooling-fix done; flyability-tune pending).

## Test Triage — buildObjective tests using round-number params
Classification: Obsolete test — new feature intentionally supersedes what the test checked (in this case, the test expectations themselves were wrong about JS number-to-string formatting; the implementation is correct)
Confidence: high
Evidence: JavaScript's `Number.prototype.toString()` returns `"2"` for `2.0`, not `"2.0"`. The existing test at `tune.test.ts:182-183` uses non-round numbers (3.5, -2.1) precisely to avoid this. My new tests at lines 426 and 467 picked round numbers and asserted the wrong string form.
Action: Auto-fixed test expectations to use non-round numbers (1.6/2.1 + 1.1/2.2 — same pattern as the pre-existing buildObjective test). Implementation unchanged; full suite 558/558 PASS post-fix.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
