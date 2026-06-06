---
workflow: feature
state: completed
created: 2026-06-06
completed: 2026-06-06
drive_mode: full-autopilot
entry: spec (complex feature)
ship_commit: 01674bf
finalize_commit: <set at finalize commit>
---

# Feature: Jet airframe (MiG-15-class) — operator-playable deep-link fixture

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-06-06

## Problem Statement

The simulation can produce a +180° backflip when given aerobatic-class parameters (SURFACE-06 Path A close, 2026-06-06, Pitts-class `aircraft-aerobatic.json` T/W=2.4) — proving the per-surface aero model IS airframe-class-faithful. But no JET airframe exists in the repo: production is Cessna-class (T/W=0.6, V_trim=78), the only alternate is a Pitts-class prop plane. The operator (pause note 2026-06-06 14:30) has directed: *"build a jet airframe and let me try it in next session."* Deliverable is a MiG-15-class jet config + deep-link-reachable mission JSON the operator can fly manually to validate end-to-end airframe-class-faithfulness. This deliberately negotiates the v1 vision exclusion `docs/product/roadmap.md:62` toward Option α (deep-link-only fixture, NOT added to home menu), parallel to the existing `aerobatic-test.json` pattern.

## Spec (preserved from spec stage)

### Target parameters (MiG-15-class, derived per CLAUDE.md Rule #9)

| Parameter | Value | Source |
|---|---|---|
| mass | 3000 kg | 3× Cessna (heavy fighter scale) |
| inertia | {x: 6750, y: 13500, z: 6750} | Cessna scaled by mass + span² ratio |
| thrust.maxN | 30000 N | T/W ≈ 1.0 (military power) |
| wing area (per wing) | 9 m² (18 m² total) | 1.5× Cessna for jet stall margin |
| wing incidenceRad | 0 rad | jet-wing zero-incidence convention |
| h-stab incidenceRad | -0.0087 rad (-0.5°) | symmetric all-flying tail |
| maxDeflectionRad | 0.175 rad (10°) | jets need high-G authority |
| fuselageDrag | { cd0: 0.142, area: 0.693 } | inherit Cessna (tradeoffs cancel) |
| Per-surface clQ, clAlphaDot, inducedDragK | inherit D14→D27 cascade-tuned Cessna values | Rule #3 carve-out (b) feel-tune protocol |
| V_trim | ~180 m/s | derived: √(2·W/(ρ·S·CL_α=4°)) = 194; round to 180 |
| Mission spawn | (0, 1000, 0), linvel.z=-180 | mid-terrain, altitude headroom for backflip |

### Acceptance gates (consolidated from spec acceptance criteria)

1. **`public/config/aircraft-mig15.json`** exists, parses via `loadAircraftConfig('mig15')`, mass/thrust/area differ from both `aircraft.json` AND `aircraft-aerobatic.json`.
2. **`public/missions/jet-test.json`** has `config: "mig15"`, NOT in `index.json` (deep-link-only). Deep-link `localhost:5173/?debug=true&mission=jet-test` loads the jet, no console errors.
3. **Scripted-input harness e2e** at `?config=mig15`: no NaN across 5s at full throttle, terminal AS > 120 m/s. Backflip scenario: pitch crosses ±90° under `hold:ArrowUp@1.0:5.0,hold:Throttle=1.0@0:end`.
4. **Operator playtest (verify-human)** — load-bearing under full-autopilot per `feedback_operator_as_external.md`. Operator flies ≥60s, reports felt jet experience + can complete a backflip.
5. **Test suite green:** Vitest + Playwright + tsc (both configs) + build.

### Out of scope (preserved)

Adding jet to `index.json`; second non-jet airframe; mid-session swap; mission-select airframe choice UI; combat / weapons / AI; CLI tuner extension for jet; cross-browser; sound / visual differentiation; clP roll-damping (pre-implement); multiple jet classes.

### Memory anchors binding for this feature

- `feedback_browser_walkthrough_load_bearing.md` — physics-feel WPs require harness probe (verify-self) + browser walkthrough (verify-human).
- `feedback_operator_as_external.md` — operator-as-playtester is the documented verify-human carve-out FOR THIS FEATURE under full-autopilot.
- `feedback_terminal_vs_initial_derivation.md` — terminal rates set by damping vs commanding moment, not inertia.
- CLAUDE.md Rule #9 — spawn AS at V_trim.
- CLAUDE.md Rule #3 carve-out (b) — operator-feel-override territory; hand-set values, no harness optimizer cycle.

## Work Tree

- [x] Phase 1: Author jet airframe config + Vitest parse coverage  <!-- all leaves [x]: build + verify-auto + verify-self + verify-human (skipped per full-autopilot) + verify-codify -->
  **Observable outcomes:**
  - CLI: `npm test -- src/aircraft/physics-core/config.test.ts` exits 0 with the test "loads MiG-15 jet config via `loadAircraftConfig('mig15')` and parses all jet-class fields" passing
  - CLI: `node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('public/config/aircraft-mig15.json','utf8')); console.log(c.mass, c.thrust.maxN, c.surfaces[0].area)"` outputs `3000 30000 9`
  - CLI: `npx tsc --noEmit -p tsconfig.json` exits 0; `npx tsc --noEmit -p tsconfig.tools.json` exits 0
  - File: `public/config/aircraft-mig15.json` exists, has top-level fields {mass: 3000, inertia, thrust: {maxN: 30000}, fuselageDrag, surfaces[4]}; surfaces[0].area=9, surfaces[0].incidenceRad=0
  - [x] P1.1 Author `public/config/aircraft-mig15.json` with derived MiG-15-class parameters per spec table
  - [x] P1.2 Add Vitest case in `src/aircraft/physics-core/config.test.ts` that loads the MiG-15 config and asserts the jet-distinctive fields (mass=3000, thrust=30000, wing area=9, wing incidenceRad=0)
  - [x] verify-auto  <!-- JSON parses; targeted Vitest 1/1 pass; full config suite 43/43; tsc both configs clean -->
  - [x] verify-self  <!-- No integration boundary — phase adds isolated new artifacts (JSON file + Vitest case importing it). All observable outcomes are CLI-only and already verified in verify-auto. No live-system surface to probe. -->
  - [x] verify-human  <!-- Skipped per full-autopilot drive mode policy (verify-self → verify-codify directly). -->
  - [x] verify-codify  <!-- The MiG-15 Vitest case authored at P1.2 IS the codification artifact (TDD pattern). Full Vitest suite 640/640 pass (was 639/639 + 1 new case). No regressions. No integration boundary → no consuming-surface test needed. -->

- [x] Phase 2: Author jet-test mission + scripted-input harness verify-self  <!-- all leaves [x] -->
  **Observable outcomes:**
  - File: `public/missions/jet-test.json` exists with `config: "mig15"`, spawn at (0, 1000, 0) with linvel.z=-180; mission NOT listed in `public/missions/index.json`
  - Browser: Playwright navigates to `localhost:5173/?debug=true&mission=jet-test` and `window.__aircraft.getState()` returns finite values (no NaN/Infinity in position/linvel/rotation) within 5s of load; no console errors
  - CLI: `npm run test:e2e -- tests/e2e/jet-airframe.spec.ts` exits 0 with both scenarios (terminal-AS + backflip) passing
  - CLI: full e2e suite green — `npm run test:e2e` exits 0
  - Harness: at `?config=mig15&script=hold:Throttle=1.0@0:5.0`, terminal AS (last log row's AS_mps) > 120 m/s; no NaN in any field across all 300 ticks
  - Harness: at `?config=mig15&script=hold:ArrowUp@1.0:5.0,hold:Throttle=1.0@0:end`, the absolute pitch_deg crosses ≥ 90° at least once in the log window
  - [x] P2.1 Author `public/missions/jet-test.json` (free-flight type, `config: "mig15"`, spawn (0,1000,0), linvel.z=-180, throttle=0.5); did NOT modify `index.json`
  - [x] P2.2 Author `tests/e2e/jet-airframe.spec.ts` with two scenarios: terminal-AS assertion + backflip pitch-crossing assertion. Reused `runScript` helper pattern; both scenarios green on first run
  - [x] P2.3 Validated deep-link reachability — full e2e suite 23/23 (was 21/21 + 2 new jet scenarios); zero regressions
  - [x] verify-auto  <!-- JSON parses; mission parser Vitest 27/27; tsc clean; new jet-airframe.spec.ts 2/2 pass -->
  - [x] verify-self  <!-- Playwright MCP live probe at ?debug=true&mission=jet-test: jet loaded, AS=198 m/s at spawn, AS=216 m/s after 3s, pos_y 1000→820→393 (descending at throttle=0.5), pitch -7→-9°, all finite. e2e suite 23/23. Only console error is favicon.ico 404 (pre-existing, unrelated). NO BLOCKING failures. -->
  - [x] verify-human  <!-- Skipped per full-autopilot drive mode policy for Phase 2 (verify-self → verify-codify directly). Phase 3 IS the operator-playtest verify-human; that gate is preserved as the carve-out documented in the spec. -->
  - [x] verify-codify  <!-- Codification artifacts written alongside impl (TDD): tests/e2e/jet-airframe.spec.ts (terminal-AS + backflip + assertAllFinite). Integration boundary satisfied — consuming surface `?mission=jet-test` is exercised end-to-end by both tests. Vitest full suite 640/640; e2e full suite 23/23. No regressions. -->

<!-- Phase 2 closed above -->

- [x] Phase 3: Operator playtest (verify-human) — load-bearing  <!-- PASS verdict 2026-06-06; all leaves [x] -->

  - [x] verify-codify  <!-- N/A for new test additions — operator-feel-PASS is not codifiable; mechanical jet-class proxies (terminal AS > 120, backflip pitch crosses ±90°, no NaN) already codified by Phase 2 e2e tests. Pre-ship regression sweep: Vitest 640/640, tsc both configs clean, build clean. -->
  **Observable outcomes:**
  - Browser: operator launches `localhost:5173/?debug=true&mission=jet-test` in their browser of choice
  - Browser: operator flies the jet for ≥ 60 seconds using WASD + space/ctrl + arrow keys
  - Verdict: operator returns one of {PASS, FAIL-with-feedback, FAIL-with-escalation}
    - PASS: jet feels jet-class (faster than Cessna, different control response, can complete a backflip when commanded). Feature ships.
    - FAIL-with-feedback: jet is finite but feels wrong on specific dimensions (e.g., "rolls too slowly", "stalls too easily", "elevator authority too sensitive"). → enters Phase 4 (feel-tune iteration).
    - FAIL-with-escalation: jet has a structural problem an operator cannot debug from controls alone (e.g., "starts flying, then NaN at t=12s every time"). → ESCALATE to /feature-research or back-loop to plan.
  - This phase has no agent-side verify-auto / verify-self / verify-codify — it's pure verify-human per the documented full-autopilot carve-out (`feedback_operator_as_external.md`)
  - [x] P3.1 Started dev server (`npm run dev` backgrounded, pid in /tmp/jet-dev.pid); confirmed reachable at `localhost:5173` (curl 200 OK)
  - [x] P3.2 Operator-handoff prompt presented (see chat); awaiting operator verdict
  - [x] verify-auto  <!-- N/A — Phase 3 has no agent-side code changes; verify-auto is a no-op per plan ("pure verify-human") -->
  - [x] verify-self  <!-- N/A — Phase 3 has no agent-side observable; verify-self is a no-op per plan ("pure verify-human") -->
  - [x] verify-human  <!-- OPERATOR VERDICT: PASS (2026-06-06). Jet feels jet-class; backflip works; no FAIL-with-feedback or FAIL-with-escalation. Phase 4 SKIPPED per conditional. -->

- [x] Phase 4: Feel-tune iteration (CONDITIONAL — only enters if Phase 3 returns FAIL-with-feedback)  <!-- SKIPPED — Phase 3 returned PASS, so Phase 4 was never entered (conditional gate not triggered) -->
  **Observable outcomes:**
  - File: `public/config/aircraft-mig15.json` has one or more of (`clQ`, `clAlphaDot`, `maxDeflectionRad`, `inertia`) adjusted per operator feedback; mass/thrust/wing-area stay at Phase 1 values (those are class-defining)
  - Operator: re-playtest at Phase 3 outcomes; operator returns PASS within 2-3 iteration cycles per `feedback_retune_attempt_budget.md`. If 3 cycles fail to satisfy, ESCALATE to architect cycle (likely SURFACE-2026-06-06-03 clP gap firing).
  - [ ] P4.1 Read operator feedback, identify ONE knob per `feedback_surface_or_means_or.md` single-knob discipline  <!-- status: NOT-STARTED -->
  - [ ] P4.2 Adjust the chosen knob in `aircraft-mig15.json`; re-run e2e suite to confirm no regressions  <!-- status: NOT-STARTED -->
  - [ ] P4.3 Re-prompt operator for playtest; record result  <!-- status: NOT-STARTED -->
  - [ ] verify-auto  <!-- status: NOT-STARTED -->
  - [ ] verify-human  <!-- status: NOT-STARTED -->
  - [ ] verify-codify  <!-- status: NOT-STARTED -->

## Current Node
- **Path:** Feature > finalize
- **Active scope:** SHIPPED at commit `01674bf` (2026-06-06). All phases [x]; all tests green; operator playtest PASS. Ready for `/feature-finalize`.
- **Blocked:** none
- **Unvisited:** finalize → reflect
- **Open discoveries:** none

## Retrospect

- **What changed in our understanding:** The MiG-15-class jet flew end-to-end on the FIRST attempt — no NaN, no instability, no need to enter Phase 4. The D14→D27 cascade-tuned damping coefficients (tuned at V_trim=78 m/s on the Cessna) generalized cleanly to V_trim=180 m/s on the jet. The non-dimensional textbook forms (`clQ · ω · c̄ / (2V)` and `clAlphaDot · dα/dt · c̄ / (2V)`) did exactly what the textbook says they should: stay invariant across AS regime when the airframe geometry is changed. R3 in the plan (cascade-inherited damping may not generalize) was wrong — it generalized perfectly.

- **Assumptions that held:**
  - **V_trim derivation per CLAUDE.md Rule #9 was load-bearing.** Spawning at V_trim=180 (not the WP14.5-era V_trim=78) gave a coherent flight entry that operator could fly immediately. Had I spawned at AS=30 or AS=78, the jet would have stalled or rocket-climbed on entry, polluting the playtest.
  - **Option α (deep-link-only, NOT home menu) was the right negotiation.** Honoring `docs/product/roadmap.md:62` keeps the v1 vision intact AND ships the operator-requested deliverable. No vision/roadmap edit was needed.
  - **Operator-as-playtester carve-out IS load-bearing under full-autopilot.** Spec AC #4 + plan Phase 3 explicit pause preserved the verify-human gate even though the rest of the workflow ran AUTO. Without that pause, the entire "let me try it" deliverable would have been silently bypassed.
  - **Inheriting cascade-tuned damping (Rule #3 carve-out b) instead of running the harness optimizer was the right call.** Tuning a NEW airframe via the optimizer would have been a multi-day cascade; inheriting + verifying via playtest was 1h end-to-end. Phase 4 was never entered.

- **Assumptions that were wrong:**
  - **Throttle=0.5 spawn is descending, not cruising.** I picked 0.5 reasoning "T/W=1.0 implies trim throttle ~0.3-0.5." Live-probe showed the jet sinks at throttle=0.5 (lift < weight at the spawn α). At verify-self I called this "natural physics" and accepted it. Operator playtest PASS came back, so it didn't matter — but a future tuning cycle would likely want throttle=0.7-0.8 at spawn to enter level flight. Not a blocker; possible Phase 3 polish.
  - **R1 in the plan (clP roll-damping gap may bite harder on jet) did not fire.** Operator playtest PASS came back without any "rolls too fast" feedback. SURFACE-06-03 status updated to record this as a data point.

- **Approach delta:** Implementation matched plan exactly. Four planned phases, Phase 4 conditional, operator returned PASS at Phase 3, Phase 4 skipped. End-to-end full-autopilot from `/feature-spec` to `/feature-ship` in one session, with the documented pause at Phase 3 verify-human. The one minor process deviation was a duplicate-phase-marker text edit error I introduced when marking Phase 1 [x] and again at Phase 2 [x] (both fixed in-place); not a workflow-level issue.

- **Process gotcha worth recording (single observation):** A pre-existing perf-test flake in `flightmodel.test.ts:368` (1000-call applyForces <50ms) fired on one of three runs during the ship phase (53ms vs 50ms threshold). The §3b flaky-test triage protocol handled it cleanly: classify → retry → pass → document → proceed. Not a new SURFACE — this perf-test instability is pre-existing project state, well below threshold for filing.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

## Test Triage — `1000 calls to applyForces complete in under 50 ms (allocation-free perf proxy)` (flightmodel.test.ts:368)
Classification: Flaky test — failure unrelated to new code; failure threshold breached by 6% (53ms vs 50ms) on one of three runs in this session
Confidence: high
Evidence: `flightmodel.test.ts:368` is UNCHANGED in this feature (no edits to `src/aircraft/physics-core/flightmodel.ts` or its tests). Assertion is a wall-clock perf threshold (`< 50ms`) — environment-load-dependent. Same suite passed 640/640 at verify-codify (15:01:15) and at Phase 1 verify-codify (14:51:29); failed only at the ship-phase sanity re-run (15:18:43). Targeted retry at 15:19:13 passed in 38ms.
Action: NO test file modified or deleted. Confirmed flake via retry; proceeding with ship per §3b flaky-test policy. No SURFACE filed (perf-test instability is pre-existing project state, well below SURFACE threshold).

## Risks accepted at plan

- **R1: `clP` roll-damping gap (SURFACE-2026-06-06-03)** may fire harder on jet than Cessna. Detection: operator reports "rolls too fast / never stops rolling" at Phase 3. Response: ESCALATE to architect cycle, NOT iterate Phase 4 on a knob that can't fix it.
- **R2: Cascade-inherited damping at V_trim=180 may NaN.** The D14→D27 cascade was tuned at V_trim=78. The non-dim form should generalize but unverified at 2.3× higher AS. Detection: verify-self at Phase 2 surfaces NaN. Response: log discovery, drop damping coefficients by 50% as first attempt (`feedback_retune_attempt_budget.md`), re-run; if still NaN, ESCALATE.
- **R3: `maxDeflectionRad=0.175` may produce uncontrollable pitch.** Detection: operator reports "elevator too sensitive" at Phase 3. Response: Phase 4 single-knob reduction to 0.13 then 0.10 if needed.
- **R4: World bounds (4000m terrain).** Jet exits rendered terrain in ~30s at cruise. Operator flying over invisible space is acceptable per Phase 1 vision; the engine does not have a hard wall. If operator confuses void for crash, document as Phase 3 polish note (NOT a blocker for this feature).

## Why this phase shape (rationale)

- **Phase 1 is pure data + Vitest** — fastest path to "config parses, jet exists as a JS object." No browser, no Playwright. ~30 min.
- **Phase 2 is mission + e2e** — proves end-to-end plumbing works without manual playtest. ~45 min.
- **Phase 3 is the load-bearing operator playtest** — full-autopilot mode does NOT skip this; it's the documented carve-out, the entire deliverable is "let me try it." Without Phase 3 the feature has not been validated.
- **Phase 4 is conditional** — only enters on FAIL-with-feedback. If operator returns PASS at Phase 3, Phase 4 is `[x]` skipped and the feature goes straight to ship.

## Why NO research phase

The spec resolved all design questions (Q1-Q6) by independent CLAUDE.md Rule #5 derivation. No 3rd-party API, no unknown library, no spike-needed integration. The MiG-15 parameter values are derived from textbook physics + existing config patterns. The plan can be executed without further investigation.

TRANSITION: F7
