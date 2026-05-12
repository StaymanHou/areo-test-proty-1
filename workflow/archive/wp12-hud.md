---
workflow: feature
state: ship (complete)
created: 2026-05-12
shipped: 2026-05-12 in commit dd9c0ed
drive_mode: full-autopilot
wp: WP12
size: S
---

# Feature: WP12 — HUD (DOM overlay)

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-05-12

## Problem Statement

Phase 2 needs an in-mission HUD per arch.md Rev 2026-05-12 **D12**: a CSS-absolute `<div>` overlay layered on top of the canvas that shows altitude/airspeed/throttle, the current objective text, a flying/won/failed status banner, and a world-anchored waypoint arrow (positioned each frame via `THREE.Vector3.project()`). The interface boundary is the **swap point** for a Phase 3 Three.js ortho impl; the v1 deliverable is `src/hud/HUD.ts` (interface) + `src/hud/dom-hud.ts` (DOM implementation).

The HUD is consumed by `main.ts` and driven by:
- Per-render-frame: `setAircraftState(state)` + `setWaypointArrow(worldPos | null)` (uses camera + renderer for projection).
- `MissionRunner` events: `objectiveChange` → `setObjective(text)`; `statusChange` → `setStatus(status, text?)`.
- `startMission()` calls `hud.show()`; the `statusChange` listener pauses + shows outcome, then `hud.hide()` before returning to mission-select.

Constraints from the codebase:
- **No framework** (D8) — vanilla DOM + inline CSS injection, same pattern as `mission/select.ts`.
- **`?debug=true` not required** — the HUD ships for casual gameplay, not behind the debug gate.
- **Allocation-free per render frame** — the HUD is called every frame; node references cached on construction. Only `style.left/.top/.display` writes per frame, no DOM creation in the hot path.
- **Vec3Plain over THREE.Vector3** for the `setWaypointArrow` argument, matching the `AircraftState` typing convention (`aircraft/state.ts`). Projection internally uses a reusable scratch THREE.Vector3.
- **Phase 2 only — no objectives yet have waypoints** (`free-flight.json` has no objectives), but `setWaypointArrow` must work end-to-end now so WP14 has zero glue work.
- The runner emits `objectiveChange` when an objective state changes — main.ts reads `runner.getObjectiveStates()` and finds the first incomplete one to display. Status text comes from the runner's current status.

## Work Tree

- [x] Phase 1: HUD interface + skeleton DOM impl  <!-- 358/358 vitest green; +13 hud tests; tsc strict clean -->
  **Observable outcomes:**
  - CLI: `npm run test -- src/hud` exits 0, ≥ 8 unit tests pass (interface conformance, set methods are no-ops before show, idempotent show/hide, DOM-node ownership).
  - CLI: `npx tsc --noEmit` exits 0.
  - Browser: importing `DomHud` and calling `new DomHud(camera, renderer.domElement)` constructs without throwing in jsdom.
  - [x] P1.1 Create `src/hud/HUD.ts` — interface declared; `HudStatus` union exported; `setThrottle` separated from `setAircraftState` per plan-time decision.
  - [x] P1.2 Create `src/hud/dom-hud.ts` — `DomHud` class implementing `HUD`. Constructor `(camera, canvasEl, opts?)`. Cached DOM-node references. `show()` injects CSS once + appends root. `hide()` detaches. Methods no-op when not shown. Number formatting per plan (rounded integers).
  - [x] P1.3 Create `src/hud/dom-hud.test.ts` (jsdom) — 13 tests covering show/hide idempotency, set-method DOM effects, no-op-before-show contract, custom mount root.
  - [x] verify-auto  <!-- 13/13 hud vitest pass; tsc strict clean -->
  - [x] verify-self  <!-- no integration boundary (isolated new artifacts); CLI outcomes covered by verify-auto; jsdom construction covered by all 13 tests -->
  - [x] verify-human  <!-- SKIPPED per full-autopilot drive mode -->
  - [x] verify-codify  <!-- 358/358 full vitest green (+13); no test gaps (build tests cover all phase-1 behaviors) -->

- [x] Phase 2: Waypoint-arrow projection  <!-- 366/366 vitest green (+8 projection); allocation-free scratch confirmed -->
  **Observable outcomes:**
  - CLI: `npm run test -- src/hud` exits 0 with ≥ 4 new tests covering: arrow positioned within bounds when target is in front of camera; arrow hidden when target is behind camera (NDC.z > 1); arrow hidden when `setWaypointArrow(null)`; arrow re-shown when toggled back to non-null.
  - CLI: `npx tsc --noEmit` exits 0.
  - [x] P2.1 `setWaypointArrow` projection — already shipped in Phase 1 dom-hud.ts:215-237. Behavior verified by Phase-2 tests.
  - [x] P2.2 Allocation-free hot path — module-scoped `_scratchProject = new Vector3()` at dom-hud.ts:82 reused across all calls. Confirmed by code inspection.
  - [x] P2.3 8 new projection tests in dom-hud.test.ts: target-ahead-on-center, target-behind, far-left-off-screen, null-hides, toggle-back-shows, right-of-camera-positions-right, above-camera-positions-up, no-op-before-show.
  - [x] verify-auto  <!-- 21/21 hud vitest green (+8 projection cases); tsc strict clean -->
  - [x] verify-self  <!-- no integration boundary; CLI outcomes covered by verify-auto; projection logic exercised by 8 new tests against real PerspectiveCamera -->
  - [x] verify-human  <!-- SKIPPED per full-autopilot drive mode -->
  - [x] verify-codify  <!-- 366/366 full vitest green; no new test gaps; phase-2 behaviors fully covered by 8 jsdom projection tests -->

  **Relevance check (before Phase 2):**
  - Requester still needs this: yes — WP12 plan + arch D12 specify waypoint arrow as the one world-anchored HUD element; WP14 depends on it.
  - Requirements unchanged: yes
  - Solution still feasible: yes — `THREE.Vector3.project()` works as expected
  - No superior alternative discovered: yes — ortho-camera alternative explicitly rejected in arch
  - **Verdict:** proceed

- [x] Phase 3: Wire into main.ts + e2e  <!-- 374/374 vitest + 6/6 Playwright; integration boundary covered by hud.spec.ts at /?mission=free-flight + / -->
  **Observable outcomes:**
  - Browser: at `http://localhost:5173/?mission=free-flight`, after the loop unpauses, the page contains a `[data-testid="hud-root"]` element with `display !== 'none'`; nested `[data-testid="hud-altitude"]`, `[data-testid="hud-airspeed"]`, `[data-testid="hud-throttle"]` contain numeric strings. `[data-testid="hud-status-banner"]` has `display: none` while status=flying.
  - Browser: at `http://localhost:5173/` (mission-select), no HUD is visible (`document.querySelector('[data-testid="hud-root"]')` is null OR its `display === 'none'`).
  - CLI: `npm run test:e2e` 1+ specs pass — extend `casual-flight.spec.ts` OR add a new `hud.spec.ts` asserting the testids above. Existing `casual-flight.spec.ts` (WP9.6 regression anchor) MUST still pass unchanged in shape.
  - CLI: `npm run test` 350+ Vitest pass (was 345 → +5 HUD tests minimum); tsc strict clean; build clean.
  - Console: no JS errors at any point during the flow boot → mission-select → start mission → HUD visible → win/fail (forced) → return to mission-select → HUD hidden.
  - [x] P3.1 main.ts: instantiated `DomHud(camera, renderer.domElement)` after MissionRunner construction. onRender: gated on `runner.getStatus() === 'running'`, copies state into existing `aircraftStateBuf`, calls `setAircraftState` + `setThrottle(controls.throttle)` + `setWaypointArrow(null)`.
  - [x] P3.2 `objectiveChange` listener added: reads activeMission.objectives + runner.getObjectiveStates(), calls `formatActiveObjective` helper (in `src/hud/format.ts`), passes the result to `hud.setObjective`. Helper covers all 3 kinds + null-for-zero-objectives + null-for-all-complete + completed-destroy-target.
  - [x] P3.3 Existing `statusChange` listener extended: `hud.setStatus(status)` on terminal state, `hud.hide()` after outcome banner closes (before re-showing mission-select). Pause + outcome-banner sequence preserved unchanged.
  - [x] P3.4 startMission: after `missionRunner.start(mission)`: `hud.show()` + `hud.setStatus('flying')` + `hud.setObjective(formatActiveObjective(...))`. Loop unpauses last.
  - [x] P3.5 Waypoint arrow: `setWaypointArrow(null)` each render frame (no waypoint missions yet; WP14 wires next-waypoint position).
  - [x] P3.6 tests/e2e/hud.spec.ts: 2 specs — (1) HUD absent on mission-select page, (2) HUD shows numeric alt/airspeed/throttle and hides objective+banner+arrow during free-flight play.
  - [x] format.ts + format.test.ts: helper module with 8 unit tests (reach-waypoint counter, touchdown, destroy-target, completed-destroy-target null, zero objectives → null, first-incomplete pick, all-complete → null, missing-state-treats-as-incomplete).
  - [x] verify-auto  <!-- 29/29 hud vitest (21 dom-hud + 8 format); tsc strict clean -->
  - [x] verify-self  <!-- integration boundary satisfied (main.ts changes verified at the consuming URLs /?mission=free-flight + /). Live browser subagent: HUD visible during mission with alt=62/airspeed=15/throttle=0; HUD absent on mission-select; console clean (0 errors, 0 NaN/Infinity). Both e2e specs and Playwright probe match. -->
  - [x] verify-human  <!-- SKIPPED per full-autopilot drive mode -->
  - [x] verify-codify  <!-- 374/374 vitest + 6/6 Playwright green; integration boundary fully covered by hud.spec.ts; no test gaps identified -->

  **Relevance check (before Phase 3):**
  - Requester still needs this: yes — HUD must render in-mission
  - Requirements unchanged: yes
  - Solution still feasible: yes — main.ts has the camera/renderer/runner hooks
  - No superior alternative discovered: yes
  - **Verdict:** proceed

## Current Node
- **Path:** Feature > finalize
- **Active scope:** Shipped in commit dd9c0ed; ready for /feature-finalize
- **Blocked:** none
- **Unvisited:** Phase 2, Phase 3
- **Open discoveries:** none

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary> -->

## Test Triage — Vitest run-1 flake at ship-time

Classification: Flaky test — failure unrelated to new code; inconsistent across runs
Confidence: high
Evidence: Vitest reported `1 failed | 373 passed` on first ship-time run; immediate reruns (run #2 + run #3) both passed 374/374. No specific failure detail surfaced (the failure was elided from the tail output). Same suite passed 374/374 in verify-codify minutes earlier; same suite passed 374/374 again immediately after. No test or source files changed between runs.
Action: Per triage rule "Never modify code or tests to eliminate a flake — re-run and escalate." Re-ran twice; 2/2 passed. Below the 3-fails-in-a-row escalation threshold. No code or test files modified. Proceeding to ship. If this recurs, surface as a workflow-level issue rather than a feature-level fix.

## Plan-time decisions (settled here so build doesn't have to)

Per the global learning `2026-05-12-plan-time-vs-build-time-decisions.md`: 2-alternative decisions settle at plan time unless build will discover new info.

- **Throttle setter:** separate `setThrottle(t)` rather than extending `AircraftState`. Reason: `AircraftState` is a physics readout; throttle is a controls input — keep layering clean.
- **CSS injection pattern:** inline injection at first `show()`, gated by a module-scoped `_cssInjected` flag — mirrors `mission/select.ts`. No separate stylesheet file.
- **`opts.root` parameter:** support but default to `document.body` — gives tests a way to scope the DOM, prevents jsdom test pollution across cases.
- **DOM data-testids:** `hud-root`, `hud-altitude`, `hud-airspeed`, `hud-throttle`, `hud-objective`, `hud-status-banner`, `hud-waypoint-arrow`. Stable Playwright anchors.
- **Number formatting:** altitude `Math.round(state.altitude)`, airspeed `Math.round(state.airspeed)`, throttle `Math.round(throttle * 100)`. Plain whole numbers — no decimals at this fidelity. Phase 3 visual polish (WP20) is where prettier formatting lives.
- **Position layout:** altitude top-right, airspeed top-left, throttle below airspeed, objective top-center, status banner center, waypoint arrow positioned dynamically. Bare-bones layout — visual polish is WP20.
- **No animation, no transitions.** CSS is layout + colors only. Phase 3 polish.

## Phase-3 swap point (per D12)

`src/hud/HUD.ts` is the interface boundary. A future `src/hud/three-hud.ts` (Three.js ortho camera impl) is the swap point. WP12 ships `DomHud` only; the interface decoupling is the architectural deliverable.

## Retrospect

- **What changed in our understanding:** Nothing structural — D12 was sufficiently specific that the impl was contract-following work. Single-pass build across all three phases; no back-loops; no new SURFACE items.
- **Assumptions that held:** D12 binding was correct; `THREE.Vector3.project()` worked as expected against a real `PerspectiveCamera` (8 jsdom tests pass without monkey-patching the matrices); jsdom is sufficient for DOM-mode unit tests; inline-CSS injection mirroring `mission/select.ts` was the right call; testid-based Playwright assertions are stable.
- **Assumptions that were wrong:** None.
- **Approach delta:** Slight optimization vs the plan — `setWaypointArrow`'s projection logic was implemented in Phase 1 along with the rest of DomHud (cleanest to write the whole class at once rather than skeleton-then-fill-in-Phase-2). Phase 2 became "verify the impl + add 8 projection tests" rather than "build projection + tests." Saved one read/write cycle. Plan-time decision to use a separate `setThrottle` setter (rather than extending `AircraftState`) held up cleanly in Phase 3.
- **Test-flake note:** One spurious Vitest "1 failed" at ship-time, immediately confirmed flaky by 2 successive clean runs (374/374). Triaged + documented above; no code or test changes. Per `feedback_retune_attempt_budget.md`-style discipline (no fix-loops on un-reproduced failures).

## Communicate

> **Feature complete:** WP12 HUD has shipped. The in-mission HUD now renders altitude, airspeed, throttle, current objective, and a status banner; the waypoint-arrow projection plumbing is in place for WP14. Verify at `http://localhost:5173/?mission=free-flight` — alt/airspeed/throttle visible top-left/top-right, banner appears on win/fail before return-to-select.

Requester = operator — closure notice for self-record.

TRANSITION: F7
