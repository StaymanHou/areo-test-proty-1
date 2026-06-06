---
workflow: task
state: act (complete)
created: 2026-06-06
drive_mode: full-autopilot
surface: SURFACE-2026-06-06-01
---

# Task: WASD keymap unification — rebind pitchUp/pitchDown to KeyW/KeyS

**Workflow:** task
**State:** plan (complete)
**Created:** 2026-06-06

## Problem Statement

`DEFAULT_KEY_MAP` in `src/engine/input.ts:15-27` binds pitch to ArrowUp/ArrowDown while roll is already on KeyA/KeyD; operator expects WASD as a unified flight stick (W/S = pitch, A/D = roll) per modern flight-sim conventions. Rebind pitchUp→KeyW, pitchDown→KeyS.

## Context

- **Source:** `src/engine/input.ts:16-17` — `DEFAULT_KEY_MAP.pitchUp = 'ArrowUp', pitchDown = 'ArrowDown'`. Other action bindings (`rollLeft: KeyA`, `rollRight: KeyD`, `yawLeft: KeyQ`, `yawRight: KeyE`, etc.) already use WASD-style `Key*` codes.
- **Test indirection — SAFE:** `src/aircraft/controls.test.ts` references the default via `DEFAULT_KEY_MAP.pitchUp` / `.pitchDown` at lines 84, 92, 220, 267 (not hardcoded `'ArrowUp'`). No change needed — the rebind propagates naturally through the indirection.
- **Test direct-reference — BREAKS:** Three e2e specs drive pitch via `hold:ArrowUp` in the scripted-input harness:
  - `tests/e2e/takeoff-landing.spec.ts:100` (`hold:ArrowUp@0.5:3.0` for the rotation pulse)
  - `tests/e2e/jet-airframe.spec.ts:83` (`hold:ArrowUp@1.0:5.0`)
  - `tests/e2e/scripted-input.spec.ts` lines 48, 51, 68, 72, 151 (multiple harness tests)

  After the keymap rebind, `ArrowUp` no longer maps to `pitchUp`, so these e2e tests would no longer cause pitch-up behavior — they assert on observable pitch change, so they'd fail. **They need `hold:ArrowUp` → `hold:KeyW`.**
- **Harness-internal tests — SAFE:** `src/engine/scripted-input.test.ts` and `src/engine/scripted-input-runner.test.ts` use `'ArrowUp'` as a parser-fixture key code (asserting the harness can hold any KeyCode). They test the harness, not the keymap. **No change needed.**
- **Low-level input plumbing — SAFE:** `src/engine/input.test.ts` uses `'KeyW'` and `'ArrowUp'` as fixture key codes for `isDown`/`wasPressed`. **No change needed.**
- **GUI label — SAFE:** `src/main.ts:233-234` binds the lil-gui label by action name (`'pitchUp'`, `'pitchDown'`), not by key code. **No change needed.**
- **No-arrows-as-alternates:** The backlog entry mentioned the option of extending `KeyMap` to support arrays so arrows remain as alternates — explicitly deferred per the entry's "bigger schema change — defer unless requested". This task is the minimal one-line rebind.

## Work Tree

- [x] T1 Edit `src/engine/input.ts` — rebind `pitchUp: 'KeyW', pitchDown: 'KeyS'`
- [x] T2 Update 3 e2e specs — replaced 7 `hold:ArrowUp` URL substrings with `hold:KeyW` (1× takeoff-landing, 1× jet-airframe, 5× scripted-input). Also updated 1 test-name string + 1 comment to keep prose accurate.
- [x] T3 Verify-auto — tsc strict ×2 clean; Vitest 641/641; Vite build clean (SURFACE-04-19-01 Rapier WASM size warning unchanged, unrelated); Playwright e2e 25/25 green in 4.9m. SURFACE-2026-05-16-02 perf-flake did NOT fire (caught a green window).

## Current Node

- **Path:** Task > all complete
- **Active scope:** all complete
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** none

## Discoveries

<!-- Format: [SURFACED-<date>] <target node> — <summary> -->

## Retrospect

- **What changed in our understanding:** Plan-time audit predicted 8 `hold:ArrowUp` substitutions across 3 e2e files; actual was 7 URL substitutions + 1 test-name string + 1 comment (still 3 files). The plan's count was off-by-one because it conflated a test-name *literal* (descriptive prose) with a URL substring. Real impact: zero — both got updated, but the off-by-one shows the plan-time grep audit could be more precise by distinguishing URL substring matches from prose matches at audit time.
- **Assumptions that held:**
  - **Indirection in `controls.test.ts` was the load-bearing escape hatch.** All 4 `DEFAULT_KEY_MAP.pitchUp` / `.pitchDown` references propagated naturally — zero changes needed in `controls.test.ts` despite being the densest pitch-test file in the codebase. This is exactly what the keymap indirection layer is for.
  - **Harness-internal tests (`scripted-input.test.ts`, `scripted-input-runner.test.ts`) use `'ArrowUp'` as a parser fixture, not as a keymap reference.** They test the harness's ability to press *any* KeyCode — keymap-agnostic by design. No changes needed.
  - **e2e specs hardcode keys in URLs** because the scripted-input harness operates at the DOM event layer, below the keymap indirection. They had to change.
- **Assumptions that were wrong:** None of substance. The off-by-one in the plan's substitution count was the only delta.
- **Approach delta:** None. Three-step Work Tree executed exactly as planned. Verify-auto green on first run (no flakes, no perf-test miss this time — caught a clean window).

## T2 scope clarification — which scripted-input.spec.ts hits to update

Per the audit, `scripted-input.spec.ts` has TWO classes of `hold:ArrowUp` usage:

1. **Tests of the harness itself** at lines 48, 51, 68, 72, 151 — these assert "harness can press ArrowUp at the timing specified" by checking *pitch behavior* downstream. They're testing the harness via the production keymap, so they DO break when `ArrowUp` stops mapping to pitch.

   Decision: All 5 should switch to `hold:KeyW` to preserve their pitch-observation assertions. The harness's ability to press *any* key is already covered by `src/engine/scripted-input.test.ts` (parser unit tests) and `src/engine/scripted-input-runner.test.ts` (runner unit tests), which use `'ArrowUp'` as a fixture key code — those keep `'ArrowUp'` because they assert on `state.keys.has('ArrowUp')`, not on pitch behavior.

2. None of the other types apply.

Final T2 scope: 8 `hold:ArrowUp` → `hold:KeyW` substitutions across 3 files (1 in takeoff-landing, 1 in jet-airframe, 5 in scripted-input e2e — the 4 lines listed by Grep plus 1 at line ~151 in the config-swap test).
