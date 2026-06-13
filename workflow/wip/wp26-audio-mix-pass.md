---
workflow: feature
state: verify-codify (all phases complete)
created: 2026-06-13
drive_mode: full-autopilot
---

# Feature: WP26 — Audio mix pass (quieter engine + master volume slider)

## Problem Statement

Operator playtest at WP22 verify-human (2026-06-13) flagged the engine-loop sound as too loud at the default mix. WP19 shipped `MAX_GAIN = 0.2` for the engine sawtooth and `_masterGainValue = 0.6` for the master gain — both hardcoded, no player control. Fix is two coupled deliverables: (1) lower the engine baseline gain so the at-master=1.0 mix is the new "loud" (not a forced shouting default), and (2) ship a master-volume UI surface on the mission-select chrome with `localStorage` persistence so the player's choice survives reloads. The plumbing already exists: `AudioEngine.setMasterGain()` is wired and applies in real time; the missing pieces are the lowered baseline, the slider DOM, and the storage key. The session-pause verify-gap lesson (cessna-trainer-feel-tune missed a Playwright e2e regression) requires this feature to run Playwright e2e in addition to Vitest, since audio is consumed by mission playback.

## Work Tree

- [x] Phase 1: Lower engine baseline gain + add master-volume storage module
  **Observable outcomes:**
  - CLI: `npm run test -- src/audio/engine-loop.test.ts src/audio/master-volume.test.ts` exits 0; engine-loop at throttle=1.0 returns `getGain() === 0.12` (post-lower target); `master-volume.ts` getter returns `0.5` when localStorage has no `flightsim.volume.master` key, returns `0.8` after `setMasterVolume(0.8)`, clamps invalid (NaN, > 1, < 0, non-numeric) to defaults.
  - CLI: `npx tsc --noEmit` clean; `npx tsc -p tsconfig.tools.json --noEmit` clean.
  - Browser: `window.__audio.getState().engineGain` at throttle=1.0 reads ≤ 0.12 (was 0.2 pre-WP26); `window.__audio.getState().masterGain` reads 0.5 on a fresh-localStorage page load.
  - [x] P1.1 Reduce `MAX_GAIN` in `src/audio/engine-loop.ts` from 0.2 → 0.12 (40% drop — closer to the wind layer's typical level so it sits in the mix instead of dominating). Updated `src/audio/audio-engine.test.ts` expectations (no standalone engine-loop.test.ts — gain coverage lives in the AudioEngine integration test).
  - [x] P1.2 Created `src/audio/master-volume.ts` exposing `getMasterVolume()`, `setMasterVolume()`, `MASTER_VOLUME_STORAGE_KEY`, `DEFAULT_MASTER_VOLUME = 0.5`. Defensive pattern: try/catch + `Number.isFinite` + clamp.
  - [x] P1.3 Created `src/audio/master-volume.test.ts` — 15 cases (default, valid, clamp >1, clamp <0, non-numeric, empty, "NaN", throwing storage, persist round-trip, clamp on write, NaN/Infinity reject-no-write, swallowed quota error). All green.
  - [x] P1.4 `AudioEngine` constructor reads `getMasterVolume()` for `_masterGainValue`; `_resetForTests` re-reads. 3 new WP26 test cases (boot-from-storage, default-on-empty, start() applies). Existing reset-baseline test updated 0.6→0.5.
  - [x] verify-auto — Vitest src/audio/ 44/44 green; tsc default + tools clean.
  - [x] verify-self — Playwright subagent confirmed all 5 outcomes PASS: engineGain=0.1197 at throttle=1.0 (target ≤0.12); masterGain=0.5 on fresh storage; masterGain=0.83 on persisted value; 0 JS console errors.
  - [x] verify-human — SKIPPED in Mode 4 full-autopilot per pause-policy table.
  - [x] verify-codify — coverage audit: all 7 verified behaviors already covered at unit/integration layer (18 new Vitest cases). Consuming-surface E2E correctly deferred to Phase 2 P2.4 (`tests/e2e/master-volume.spec.ts`) which exercises the same boot path through the slider UI. Full Vitest suite 846/846 green; no regressions.

- [x] Phase 2: Slider UI on mission-select
  **Observable outcomes:**
  - Browser: mission-select screen contains `[data-testid=master-volume-slider]` — a `<input type="range" min=0 max=1 step=0.05>` with a visible label ("Volume"). Initial value matches `getMasterVolume()` (0.5 default).
  - Browser: dragging the slider triggers `AudioEngine.setMasterGain(newValue)` AND `setMasterVolume(newValue)` in real time (no submit/apply step). Verified by reading `window.__audio.getState().masterGain` matches slider value after a Playwright `fill` + `dispatch input`.
  - Browser: reload after slider change → `window.__audio.getState().masterGain` reads the persisted value, slider shows the persisted value.
  - CLI: `npx playwright test tests/e2e/master-volume.spec.ts` exits 0 (new file added in Phase 2).
  - CLI: `npm run test -- src/mission/select.test.ts` exits 0 with new slider-rendering cases passing.
  - [x] P2.1 `_buildVolumeSlider()` added to `MissionSelectScreen`. Slider (`data-testid=master-volume-slider`, range 0..1 step 0.05) + label + percent display. Input handler writes `setMasterVolume(v)` inline, updates % label, fires `onVolumeChange` callback. CSS for `.master-volume` injected alongside existing picker styles.
  - [x] P2.2 `MissionSelectScreen.onVolumeChange(cb)` API mirrors `onSelect`. `main.ts` registers it to call `audioEngine.setMasterGain(v)`. Persistence stays inline in the slider handler so it works pre-callback-registration too.
  - [x] P2.3 `src/mission/select.test.ts` extended with 8 new WP26 cases (slider attrs, default-on-fresh-storage, persisted-on-prior-storage, % label, input → persist+%label, onVolumeChange callback, callback-optional path, no-mission-trigger). 25/25 green.
  - [x] P2.4 `tests/e2e/master-volume.spec.ts` Playwright (3 specs): slider visible at default 0.5; drag-and-apply (slider→0.8 → localStorage=0.8 → label=80%); persisted boot (set→reload→slider+masterGain reflect persisted). 3/3 chromium green.
  - [x] verify-auto — Vitest src/mission/select.test.ts 25/25 green; tsc default + tools clean.
  - [x] verify-self — Playwright subagent confirmed all 4 outcomes PASS: slider attrs correct on fresh storage; drag-to-0.8 → localStorage=0.8 + masterGain=0.8 + label="80%"; persisted boot reload shows slider=0.8 + label="80%" + masterGain=0.8; 0 JS console errors across full interaction sequence.
  - [x] verify-human — SKIPPED in Mode 4 full-autopilot per pause-policy table.
  - [x] verify-codify — coverage audit: all 11 verified Phase 2 behaviors covered (8 Vitest + 3 Playwright e2e). Full Vitest 854/854 green (+8 from baseline 846). Full Playwright e2e 55/56 — the 1 failure is the pre-existing SURFACE-2026-06-13-PHUGOID-HIGH-REGRESSION, not WP26-introduced (triage in this WIP). 3 new master-volume.spec.ts specs all PASS.

## Current Node
- **Path:** Feature > ship
- **Active scope:** All phases [x]; hand off to feature-ship
- **Blocked:** none
- **Unvisited:** ship → finalize (F17b — Mode 4 skips review-quality)
- **Open discoveries:** none

## Test Triage — phugoid probe @ throttle=0.4: 60s bounded, no NaN
Classification: Pre-existing regression unrelated to WP26 — already filed as SURFACE-2026-06-13-PHUGOID-HIGH-REGRESSION in workflow/backlog.md
Confidence: high
Evidence: SURFACE-2026-06-13-PHUGOID-HIGH-REGRESSION (backlog.md:16) documents the exact failure: `waitForFunction(isScriptComplete)` timeout introduced by commit `ab807e0` (cessna thrust tune, maxN: 6000→4500). WP26 only touches `src/audio/*`, `src/mission/select.ts`, `src/mission/select.test.ts`, `src/main.ts` (1-line volume-callback wire), and `tests/e2e/master-volume.spec.ts` — no overlap with `src/aircraft/`, `public/config/aircraft.json`, `public/missions/phugoid-probe-high.json`, or `tests/e2e/phugoid-probe.spec.ts`. Three new master-volume e2e specs PASS.
Action: No test modification or code change. The failure is independent of WP26 and tracked at the backlog SURFACE — operator-chosen to address as a separate task workflow per session-pause queue. WP26 proceeds to ship; the pre-existing regression is not a WP26-introduced bug.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary> -->
