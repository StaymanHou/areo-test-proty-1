---
drive_mode: full-autopilot
---

# Task: Refactor phugoid-probe.spec.ts to use the scripted-input harness

**Workflow:** task
**State:** act (complete)
**Created:** 2026-06-06
**Closes:** SURFACE-2026-06-06-05, SURFACE-2026-06-06-07 (discovered + resolved inline)

## Problem Statement

`tests/e2e/phugoid-probe.spec.ts` uses 30× `page.waitForTimeout(1000)` + repeated `getState()` polls — exactly the wall-clock pattern the new `?script=` harness eliminates. Refactor as a dogfooding exercise to surface any harness API rough edges before SURFACE-06 (aerobatic tune) starts from this baseline.

## Context

- **Current spec:** `tests/e2e/phugoid-probe.spec.ts` — 3 tests, ~30s wall-clock each, `for` loop over `{low:0.05, mid:0.15, high:0.4}` throttle probes; 90s test timeout; sample loop with explicit fail-fast.
- **Harness reference:** `tests/e2e/scripted-input.spec.ts:29-46` defines the canonical `runScript(page, query)` helper: `page.goto(query)` → `waitForFunction(isScriptComplete)` → `getScriptedLog()`. 30s `waitForFunction` timeout.
- **Log row shape:** `tests/e2e/scripted-input.spec.ts:3-17` — `{tick, t_sec, position, linvel, rotation, angvel, pitch_deg, roll_deg, yaw_deg, AS_mps, alpha_deg, beta_deg, throttle}`. Note field names differ from `getState()`: `position.y` is altitude; airspeed is `AS_mps` (was `airspeed`); pitch is `pitch_deg` (was `eulerDeg.pitch`).
- **Throttle scripting:** project CLAUDE.md `### Browser-walkthrough discipline` Quickstart → `hold:Throttle=<float>@<start>:<end>`. With `:end` keyword, holds until log buffer fills (60s @ 60Hz = 3600 ticks).
- **Log buffer freeze:** harness latches the log array byte-stable at first `isScriptComplete()` true tick — re-reading is idempotent (the determinism gate codified in `scripted-input.spec.ts:65-94`).

## Plan shape (target diff)

For each probe (`low`/`mid`/`high`):
- Navigate `/?mission=phugoid-probe-<id>&debug=true&script=hold:Throttle=<value>@0:end`.
- `await page.waitForFunction(() => window.__aircraft.isScriptComplete())` with a generous timeout (60s log fill at 60Hz is real-time-bounded but Vite cold-start adds a few s).
- `const log = await page.evaluate(() => window.__aircraft.getScriptedLog())`.
- Iterate ALL rows (not 30 samples) — assert NaN-free, altitude/AS/pitch envelope unchanged.
- Drop `consoleNaN` / `pageErrors` listeners (the per-tick log already covers NaN detection; no scattered console).
- Test timeout 90s (preserved — log fill is wall-clock-bounded by the 60s buffer + boot overhead; tightening to 30s as the SURFACE entry suggested would risk flake on slow CI).

## Open question (resolved at plan time)

The SURFACE entry suggests "30s test timeout instead of 90s." Resolved: **keep 90s**. The harness still runs wall-clock — `?script=...@0:end` fills the 60s log buffer in 60s of wall-clock + Vite cold start. Tightening to 30s would create the same flakiness category the harness was built to eliminate. Pure-determinism wins remain: zero `waitForTimeout` calls, byte-stable log content, all 3600 ticks asserted.

## Work Tree

- [x] T1 Read current `phugoid-probe.spec.ts` end-to-end + confirm log buffer capacity (default 60s @ 60Hz = 3600 ticks)
- [x] T2 Rewrite `tests/e2e/phugoid-probe.spec.ts`: replace `getState()` polling loop with `runScript(...)` harness pattern; assert envelope across all log rows
  - [x] SURFACED-2026-06-06 — deep-link regression: `?mission=<id>` for an id NOT in `index.json` falls through to mission-select; the prior commit `f77aa36` pruned phugoid-probe missions from `index.json`, silently breaking the "deep-link still works for e2e" contract. Fixed in same edit by removing the manifest pre-check in `src/main.ts` (`startMission` already handles load failure gracefully via `errorForId`). Logged to backlog as SURFACE-2026-06-06-07.
- [x] T3 Run `npm run test:e2e -- phugoid-probe` and confirm all 3 tests green deterministically — 2 reruns byte-identical at the diagnostic sample level (determinism gate codified in scripted-input.spec.ts:65-94 already proves byte-identity).
- [x] T4 Run full e2e suite `npm run test:e2e` — 19/19 green; no regressions in casual-flight / scripted-input / hud / parity / mission-select. Wall-clock 3.9m.
- [x] T5 `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.tools.json && npm run build` — all clean.

## Current Node
- **Path:** Task > complete
- **Active scope:** all complete — ready for /task-close
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** none (SURFACE-07 discovered + resolved inline)

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
[SURFACED-2026-06-06] T2 — `?mission=<id>` deep-link silently fell through to mission-select when `<id>` was absent from `public/missions/index.json`. The session-pause note for `f77aa36` (phugoid-probe menu prune) claimed deep-link still worked for e2e — false. Fixed inline by removing the manifest pre-check in `src/main.ts:431-439`; `startMission` already handles load failure gracefully. Filed as SURFACE-2026-06-06-07.

## Retrospect

- **What changed in our understanding:** The session-pause note from the prior cycle claimed "deep-link via `?mission=` still works for e2e" after pruning phugoid missions from `index.json`. The claim was unverified — the prune broke deep-link reachability because `src/main.ts` gated it on manifest membership. This task surfaced the latent bug by being the first thing to try the supposed-to-work deep-link path after the prune.
- **Assumptions that held:** Plan-time decision to keep the 90s test timeout was correct (raised further to 150s once we knew `:end` requires real 60s wall-clock to fill the buffer). The harness's byte-stable log buffer made the assertion shape trivial — just iterate all rows. The post-refactor diagnostic samples are byte-identical across reruns.
- **Assumptions that were wrong:** Initial 75s `isScriptComplete` timeout was naively too tight even before discovering the deep-link bug — the second `waitForFunction` (75s) PLUS the first (20s) PLUS Vite boot exceeded the test's 90s ceiling, masking the deeper deep-link bug behind a Playwright timeout. Lesson: layered timeouts need slack at the test-level cap.
- **Approach delta:** Plan was a single-file rewrite of `phugoid-probe.spec.ts`. Actual landing added a second file change to `src/main.ts` to unbreak the deep-link path. The discovery → fix → re-run cycle stayed inside the act state (no back-loop to plan) because the fix was the minimum change to make the documented contract hold and matched the SURFACE-07 filing perfectly. Sanctioned by the "Attach Discoveries to the Tree" sub-procedure of task-act.

## Closure notice

**Closure notice:** `phugoid-probe-harness-refactor` complete. `tests/e2e/phugoid-probe.spec.ts` now uses the `?script=hold:Throttle=<v>@0:end` harness instead of 30 × `waitForTimeout(1000)` polling; all 3600 ticks of each ~60s flight are asserted per test. Inline fix to `src/main.ts` restored the documented `?mission=<id>` deep-link contract that the prior menu-prune had silently broken. Verify via `npm run test:e2e` (19/19 green). Requester = operator — closure notice for self-record.
