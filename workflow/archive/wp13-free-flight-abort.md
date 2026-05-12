---
workflow: task
state: act (complete)
created: 2026-05-12
drive_mode: full-autopilot
wp: WP13
size: XS
---

# Task: WP13 — Free flight mission + return-to-menu key

**Workflow:** task
**State:** plan (complete)
**Created:** 2026-05-12

## Problem Statement

The free-flight mission already declaratively ships (WP11 — `public/missions/free-flight.json`) and is validated end-to-end by `casual-flight.spec.ts` + the HUD overlay from WP12. The only WBS task not yet shipped for WP13 is: "Exit condition: player presses a 'return to menu' key". Add a player-initiated abort path via the Escape key that returns to mission-select without falsely showing the "MISSION FAILED" banner.

## Context

- `src/engine/input.ts:8` — `ActionName` union (currently 10 actions, last is `'pause'`); `DEFAULT_KEY_MAP` at line 15.
- `src/mission/runner.ts:49` — `MissionRunner` class; existing methods `start`, `tick`, `getStatus`, `getObjectiveStates`, `getElapsed`, `on`, `off`. Status union `MissionStatus = 'not-started' | 'running' | 'won' | 'failed'` (in `mission/types.ts:95`). The runner emits `statusChange` on every status transition.
- `src/main.ts:269` — existing `statusChange` listener: on terminal `'won' | 'failed'`, pauses loop, shows outcome banner, then re-renders mission-select. WP12 added HUD lifecycle alongside.
- `src/main.ts:96-101` — `onRender` already polls `input.wasActionPressed('swapCamera', ...)` each frame; same pattern works for `returnToMenu`.

## Approach

- **Status union:** keep `MissionStatus` as-is. The cleanest signal for "player aborted, do not show outcome banner" is a new method `abort()` that sets status to `'failed'` and **also** sets a `_aborted` flag the listener can inspect via a new method `wasAborted()`. Alternative considered (add a fourth `'aborted'` status) is heavier — it ripples through every `getStatus()` caller and every win/fail check. The flag approach is one extra field + one boolean check.

  Trade-off: the listener has to call `runner.wasAborted()` to decide between the outcome-banner path and the silent path. That's two boolean reads in the hot-path-adjacent listener — fine.

- **Input plumbing:** add `'returnToMenu'` to `ActionName`, `'Escape'` to `DEFAULT_KEY_MAP`. In `onRender`, gate the abort poll on `runner.getStatus() === 'running'` (matches the existing HUD-update gate).

- **main.ts wiring:** in the existing `statusChange` listener, branch on `runner.wasAborted()`:
  - aborted → no banner, no delay; just `hud.hide()` + `missionSelect.show()` + `activeMission = null` + `loop.setPaused(true)`.
  - won/failed → existing banner flow unchanged.

- **Reset semantics:** `start()` already clears all per-mission state; add `_aborted = false` to that reset. No separate `clear()` needed.

## Work Tree

- [x] T1 input.ts: `'returnToMenu'` added to ActionName, `'Escape'` to DEFAULT_KEY_MAP.
- [x] T2 runner.ts: `_aborted` field + `abort()` + `wasAborted()` methods. `start()` resets the flag.
- [x] T3 main.ts: Escape→abort poll added in onRender's `running` block; statusChange listener branches on `wasAborted()` to skip outcome banner.
- [x] T4 runner.test.ts: 5 new tests (abort sets status+flag, emits statusChange, no-op when not running, start clears flag, natural fail leaves wasAborted=false). 379/379 vitest green.
- [x] T5 hud.spec.ts: new e2e — load free-flight, press Escape, assert mission-select reappears, no outcome banner, HUD root gone. 7/7 Playwright green.
- [x] T6 wbs.md: WP13 marked DONE with task list complete + actual size + dependency on WP12 noted. CHANGELOG + roadmap milestone happen at task-close.

## Current Node
- **Path:** Task > close
- **Active scope:** All 6 steps complete; ready for /task-close
- **Blocked:** none
- **Open discoveries:** none

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary> -->

TRANSITION: T2

## Retrospect

- **What changed in our understanding:** Nothing material. The task was strictly contract-shaped — single new keybinding, single new runner method, one-branch listener split. The instinct to route to task workflow (not feature) was correct: no architectural decisions, no spec surface, atomic change.
- **Assumptions that held:** The `wasAborted()` flag-on-runner approach was clean and small; `start()` already had the right "reset all per-mission state" place to clear it; the existing `statusChange` listener composed cleanly with a leading `if (wasAborted) return-early` branch; the `'failed'` status was an acceptable abort signal at the wire level because the listener's branch hides the semantic mismatch from the user.
- **Assumptions that were wrong:** None.
- **Approach delta:** No delta. 6 planned steps; 6 shipped steps; same scope.

## Communicate

> **Closure notice:** WP13 (free flight mission close) is complete. Free-flight mission was already declaratively shipped at WP11; this task added the player-initiated abort path — pressing Escape during any running mission returns to mission-select without falsely showing the "MISSION FAILED" banner. Verify at `http://localhost:5173/?mission=free-flight` → press Escape → mission-select reappears.

Requester = operator — closure notice for self-record.
