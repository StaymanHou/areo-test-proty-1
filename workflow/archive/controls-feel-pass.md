---
workflow: feature
state: ship (complete) — commits 9ef802e + 3727c34
drive_mode: full-autopilot
escalated_from: task
escalated_at: 2026-06-06
shipped_at: 2026-06-06
---

# Feature: controls-feel-pass

**Workflow:** feature (escalated from task workflow 2026-06-06 mid-session)
**State:** verify-human (pending)
**Created:** 2026-06-06

## Escalation Note

Originally framed as a task (task-plan → task-act → task-close). Operator interjected at the task-close step: the agent-side cubic-curve math verification (`0.5 raw → 0.3125 output`) confirmed the *math*, but not that the change resolves the "A/D too jerky" feel complaint — which is the actual acceptance criterion. Feel-targeted changes are feature-shaped, not task-shaped, because they require operator-as-X verification before close. The build work (Phase 1 below) is sound and already committed at `9ef802e`; what's missing is `feature-verify-human` (operator confirms the feel deficiency is resolved).

Per `feedback_browser_walkthrough_load_bearing.md` (now 4th observation if it codifies cleanly): Vitest + e2e green ≠ feel-correct. The operator's hands on the keyboard are the load-bearing data point.

## Problem Statement

Operator reported "controls aren't there yet" after WP14.19 cascade-close browser walkthrough — the physics is coherent at V_trim=78 but stick response feels wrong. Phase 1 isolated the deficiency to "A/D aileron too jerky on brief taps" (other reported issues were orthogonal — keymap mismatch (SURFACEd) and expected aviation rudder feel (no action)). Phase 1 shipped a cubic-expo input curve to soften small-stick sensitivity by ~38% while preserving full-deflection authority.

**Acceptance:** operator confirms A/D tap-response feels finer at the live `localhost:5173/?mission=free-flight&debug=true` walkthrough, AND no new feel-regressions surface in pitch/yaw/throttle/neutral-return.

**Problem statement unchanged at F12 back-loop (2026-06-06)** — operator's "A/D still too jerky" at the cubic-mild expo=0.5 curve confirms the *symptom* is unresolved, not that the diagnosis is wrong. Single-knob discipline preserved: stronger curve coefficient, not a different knob. Per `feedback_retune_attempt_budget.md`, this is attempt 2 of 3.

**[Updated 2026-06-06: F23 back-loop to plan — root problem RE-DIAGNOSED]** Phase 1 attempt 2 (pure cubic `x³`, 75% softer at small inputs) ALSO failed operator verify-human. Research probe surfaced the actual root cause: the airframe's **full-deflection roll rate is in 2–3 rotations/second territory (720–1080°/s)** — ~2× past the real-world record-holder Extra 300 (≈400°/s) and ~5× a casual-gamer target of 90–150°/s. The "jerky" symptom is not about input curve shape — at ANY non-trivial deflection, the airframe rolls unphysically fast, so EVERY tap feels like a snap. The input curve softens the *commanded deflection* but cannot reduce the *roll moment* at that deflection. The root fix is in `aircraft.json` (physics-side), not `controls.ts` (input-side). Phase 1 cubic-curve is still defensible as good UX hygiene (preserves authority + softens small inputs) — keep it shipped. **Phase 2 added: reduce full-deflection roll rate to ~120°/s casual-gamer target via `aircraft.json` roll-axis knob.** Single-knob discipline preserved (`inertia.z` bump). Crosses the original task plan's "no `aircraft.json` edits" boundary — that boundary was wrong; operator-as-architect carve-out per CLAUDE.md Rule #3 applies (gameplay feel override, NOT physics-mechanism tuning of the D14→D27 cascade space; roll axis is decoupled from pitch/AS phugoid).

**[Updated 2026-06-06 second F23 back-loop: Phase 2 knob WAS WRONG — re-pivoting]** The `inertia.z` 1500→6000 bump did not reduce terminal roll rate. A deterministic Vitest harness test (`src/aircraft/roll-rate.test.ts`, added at Phase 2 verify-codify attempt) measured terminal angvel.z at full deflection: **550°/s at inertia.z=1500 AND at inertia.z=6000** — essentially unchanged. **Reason:** terminal roll rate is governed by aileron-moment-vs-damping balance, not inertia. Inertia changes the *time-to-terminal* (post-bump trace ramps slower) but NOT the terminal itself. My initial force-balance was for instantaneous angular acceleration; at terminal angvel is constant and inertia drops out of the moment equation. **CLAUDE.md Rule #5 violation noted:** a proper plan-time derivation of *steady-state* (not just *initial accel*) would have caught this. Earlier agent Playwright probe (146°/s) misread the post-coupling phase as terminal; the operator's qualitative observation ("<1s for 360°" → >360°/s) was the load-bearing correction. Also surfaced SURFACE-2026-06-06-03: the airframe lacks an aerodynamic roll-rate damping mechanism (no clP analogous to D17 clQ) — the *proper* fix is mechanism-level; the *pragmatic* workaround is `wings.maxDeflectionRad` cap to reduce the aileron moment at full input. Operator chose workaround path at the previous routing question. **Phase 2 re-planned with `wings.maxDeflectionRad` 25°→~6° single-knob.** `inertia.z` reverted to 1500.

**Memory anchors firing at this back-loop:**
- `feedback_surface_or_means_or.md` — still single-knob, just a different knob (roll inertia, not input curve coefficient).
- `feedback_recency_bias_in_cascades.md` — the cubic curve was a recency-fix on the wrong layer; the bug lives in `aircraft.json` (untouched by this feature originally), not `controls.ts` (where I had focused).
- CLAUDE.md Rule #3 carve-out (b) — operator-as-architect explicit gameplay feel override; Phase 3 playtest is the re-validation hook.
- CLAUDE.md Rule #5 — plan-time physics derivation: force balance `q·S·CL·arm² / I` at V_trim showed roll inertia is the dominant lever; without that derivation the fix would have hand-guessed another curve coefficient.

## Context

**Phase 1 shipped (commit `9ef802e`):**
- `src/aircraft/controls.ts` — added `StickCurve` type + `stickCurve` option (default `'cubic'`: `0.5·x + 0.5·x³`); added `resetSticks()` method; introduced raw pre-curve buffer (`rawAileron/rawElevator/rawRudder`) so ramp rate is decoupled from curve shape.
- `src/aircraft/controls.test.ts` — pinned existing tests to `stickCurve: 'linear'` (their job is ramp verification, not curve verification); added 9 cubic-curve tests + 2 `resetSticks()` tests (11 new, suite now 603/603 from 592).
- `src/main.ts` — swapped mission-reset to `controls.resetSticks()` (preserves raw buffer invariant); added `controls` to debug-only `window.__aircraft` for live introspection.

**Boundary:** Controls→FlightModel contract unchanged — same 4 normalized fields. No physics changes; no `aircraft.json` edits.

**Memory anchors active for verify:**
- `feedback_browser_walkthrough_load_bearing.md` — verify-human is load-bearing for feel-targeted changes.
- `feedback_operator_as_external.md` — under full-autopilot drive_mode, operator-as-X defers are explicitly documented; here verify-human is NOT being deferred (the whole reason this escalated to feature workflow is to NOT skip it).
- `feedback_surface_or_means_or.md` — single-knob discipline preserved.

## Work Tree

- [x] Phase 1: Implement cubic-expo input curve — shipped at pure cubic `x³`, Vitest 26/26, operator-approved transitively via Phase 2 verify-human.  <!-- status: complete -->
  **Observable outcomes:**
  - Browser: at `localhost:5173/?mission=free-flight&debug=true`, a brief A/D tap should produce a smaller aileron deflection than before (subjectively: less twitchy / less jerky), while a held A/D should still reach full deflection at the same speed (0.2s).
  - HTTP: N/A (no network surface).
  - CLI: `window.__aircraft.controls.stickCurve === 'cubic'` evaluated in DevTools console reads `'cubic'`; `window.__aircraft.controls.aileron` after a 100ms hold of D reads ~0.3125 (not 0.5).
  - [x] P1.1 Add `StickCurve` type + `stickCurve` option to `ControlsOptions`  <!-- status: complete -->
  - [x] P1.2 Refactor `update()` to ramp in raw space, apply curve at read time  <!-- status: complete -->
  - [x] P1.3 Add `applyCurve()` helper + `resetSticks()` method  <!-- status: complete -->
  - [x] P1.4 Swap `main.ts` mission-reset to `controls.resetSticks()` + expose `controls` on debug global  <!-- status: complete -->
  - [x] P1.5 Pin existing test fixture to `stickCurve: 'linear'`; add cubic-curve + resetSticks test blocks  <!-- status: complete -->
  - [x] verify-auto — attempt 2 re-verify: scoped Vitest `controls` 26/26 ✓; tsc clean. (Full-suite + e2e + build will re-run at verify-codify.)  <!-- status: complete -->
  - [x] verify-self — Re-verify gate after F12 back-loop (2026-06-06): live Playwright probe confirms attempt-2 curve: 100ms tap → aileron=0.125 (vs 0.3125 at attempt 1; vs 0.5 raw); 300ms hold → 1.0 (full authority preserved); release → 0. V_trim flight regression check from attempt 1 stands (cubic→pure-cubic does not alter authority at full deflection, which is what V_trim uses).  <!-- status: complete -->
  - [x] verify-human — All six leaves [x] (5 approved at Phase 1 attempt 2; .1 resolved transitively via Phase 2 2026-06-06 operator "all pass"). Phase 1 fully approved.  <!-- status: complete -->
    - [x] P1.verify-human.1 — Aileron tap feel: at `localhost:5173/?mission=free-flight&debug=true`, tap A or D briefly (~100ms). RESOLVED transitively by Phase 2 (2026-06-06 operator "all pass"). The "too jerky" complaint was actually about full-deflection roll rate (snap-roll at 550°/s), not curve shape. Phase 1 cubic curve + Phase 2 5° aileron cap together produce the feel the operator was after.  <!-- status: complete (transitive close via Phase 2) -->
    - [x] P1.verify-human.2 — Aileron full-deflection authority: hold A or D for 1+ second. Expected: full authority preserved.  <!-- status: complete — operator: "full-deflection authority: good enough" -->
    - [x] P1.verify-human.3 — Pitch regression check: tap ↑/↓ arrow keys briefly and hold for 1+s. Expected: pitch response feels similar to A/D (softened) tap response.  <!-- status: complete — operator did not flag pitch feel as jerky; surfaced an orthogonal envelope concern (nose dive / backflip unreachable) which is logged separately as SURFACE-2026-06-06-02 — NOT a regression of this task -->
    - [x] P1.verify-human.4 — Yaw regression check: tap and hold Q/E. Expected: rudder feel unchanged from baseline.  <!-- status: complete — operator: "feels right" -->
    - [x] P1.verify-human.5 — Throttle regression check: hold Shift / Ctrl. Expected: ramps 0→1 over ~2s, holds when no key pressed.  <!-- status: complete — operator: "good" -->
    - [x] P1.verify-human.6 — Neutral-return regression check: deflect A/D briefly then release.  <!-- status: complete — operator: "good" -->
  - [x] verify-codify — Cubic-curve behavior already codified by 11 Vitest cases in `controls.test.ts` (P1.5). Operator approved feel at Phase 2 verify-human (transitive close of P1.verify-human.1). No additional codification needed beyond what was already shipped.  <!-- status: complete -->

- [x] Phase 2 (re-revised): Reduce full-deflection terminal roll rate via `wings.maxDeflectionRad` cap — shipped at 0.0873 rad (5°), Vitest gate at 179°/s sustained, operator-approved 2026-06-06.  <!-- status: complete -->

  **Relevance check (before Phase 2 re-attempt):**
  - Requester still needs this: yes — operator's "still rolls 360° in <1s" complaint at the previous attempt confirms the root issue is unresolved.
  - Requirements unchanged: yes — acceptance is still terminal roll ≤200°/s, target ~120°/s.
  - Solution still feasible: yes — `wings.maxDeflectionRad` is a per-surface optional field with default 25°; aircraft.json currently doesn't override it on wings (wings inherit default). Adding an override is a 2-line JSON addition on each wing surface.
  - No superior alternative discovered: yes for this feature scope. The *better* alternative is a β6 clP roll-rate damping mechanism (SURFACE-2026-06-06-03), but that's arch-level work outside this feature. `maxDeflectionRad` cap is the pragmatic operator-as-architect workaround.
  **Verdict:** proceed.

  **Plan-time derivation (CLAUDE.md Rule #5 — proper steady-state this time):** At terminal roll rate, angvel.z is constant → angular accel = 0 → aileron_moment = damping_moment. Both scale with V² (dynamic pressure q) and aileron deflection (linear in small-angle regime). The aileron moment scales linearly with `maxDeflectionRad` (since `surface.setDeflection(value * sign * maxDeflectionRad)` clamps at full input). The damping moment scales with angvel (from the weak β5 coupling). So at terminal: `aileron_moment(maxDef) = damping_moment(angvel_terminal)` → `angvel_terminal ∝ maxDef`. Linear-scaling prediction: to drop terminal from 550°/s to 120°/s, reduce `maxDeflectionRad` by 550/120 ≈ 4.6× → 25° / 4.6 ≈ **5.4°**. Round to **6°** for cleanliness.

  **Operator tradeoff acknowledgment:** P1.verify-human.2 approved "full-deflection authority good enough" at maxDeflectionRad=25°. Reducing to 6° literally reduces the maximum aero command. But what operator was actually approving was the visual roll rate at full hold (which the cubic curve preserved); since the visual roll rate at full hold is exactly what we're trying to slow down (550°/s → 120°/s), the operator's actual preference is for slower roll at full hold, not literally for 25° aileron deflection. So this knob change is consistent with the operator's actual preference, despite literally regressing the P1.verify-human.2 wording. P2.verify-human.2 re-tests this.

  **Observable outcomes:**
  - CLI/Vitest (PRIMARY GATE): `src/aircraft/roll-rate.test.ts` "sustained roll rate at full +aileron ≤ 200°/s (firm gate); ~120°/s is the goal" — currently FAILing at 550°/s; must PASS after this phase. This is the load-bearing codified acceptance criterion.
  - Browser: at `localhost:5173/?mission=free-flight&debug=true`, hold A or D for 1.5s and observe — full rotation should take ~2-3 seconds visually (down from <1s), feeling like a WWII-fighter / RV-class roll rather than aerobatic snap-roll.
  - HTTP: N/A.

  - [x] P2.1 Baseline measured 2026-06-06: deterministic Vitest test (`src/aircraft/roll-rate.test.ts`) reports terminal body-Z angvel.z = 550°/s at full +aileron in the production aircraft.json (inertia.z=1500, default wings.maxDeflectionRad=25°). The pre-Phase-1 Playwright probe (~500°/s pre-coupling plateau) and the failed-inertia-bump probe (same 550°/s via Vitest) are consistent. P2.1 result REUSED.  <!-- status: complete -->
  - [x] P2.2 Added `maxDeflectionRad` field to wing-left and wing-right in `public/config/aircraft.json`. Attempt 1: `0.1047` (6°) — terminal 215°/s, FAIL firm-gate. Attempt 2: `0.0873` (5°) — terminal 179°/s, PASS firm-gate. Sub-linear scaling observed (550°/s × 6/25 predicted 132°/s, actual 215°/s; predicted 110°/s at 5°, actual 179°/s). Probable cause: β5 AoA-rate damping weakens as aileron deflection shrinks (less wing α change per cycle), so the moment-vs-damping balance equilibrates higher than pure-linear predicts. Working value 5° (0.0873 rad).  <!-- status: complete -->
  - [x] P2.3 Vitest `roll-rate.test.ts` PASS at 0.0873 (5°): sustained peak 179.3°/s, trace 175→179→174→171 (clean stable roll, no coupling instability). Within firm gate ≤200°/s. Upper edge of goal band 80-180°/s. Per `feedback_retune_attempt_budget.md` 2-attempt budget consumed. Defer further fine-tuning to verify-human; if operator wants ~120°/s instead of 175°/s, F12 back-loop iterates to ~3.5°.  <!-- status: complete -->
  - [x] verify-auto — JSON parse ✓; `roll-rate` test 3/3 ✓ (firm gate flipped green at 179.3°/s); `aircraft` suite 220/220 ✓ (up from 217; no regression in any prior test). tsc + production build deferred to verify-codify per scoped-checks discipline.  <!-- status: complete -->
  - [x] verify-self — **Deterministic Vitest gate is the load-bearing measurement** (`src/aircraft/roll-rate.test.ts`, attempt 2 of P2.3): sustained peak 179.3°/s at 5° aileron cap, well within firm gate ≤200°/s and at upper edge of goal band 80-180°/s. Sign-convention anchors PASS. Live Playwright probe attempted but produced inconsistent readings (107-150°/s) at the same physics state, surfacing SURFACE-2026-06-06-04 (need scripted-input URL mode for reliable live verification). V_trim regression: `maxDeflectionRad` only affects wings' aileron authority — h-stab elevator (pitch/AS) and v-stab rudder (yaw) unchanged; phugoid mechanics are pitch+AS so untouched by this knob. Confirmed at code-level inspection: `flightmodel.ts:114` `applyControls` routes aileron→wings, elevator→h-stab, rudder→v-stab; capping wings.maxDeflectionRad doesn't affect h-stab. No browser regression check needed.  <!-- status: complete -->
  - [x] verify-human — Operator confirms ALL three leaves PASS at 2026-06-06 ("all pass"). A/D full-deflection roll feels right at ~2s per rotation; A/D tap feel acceptable at the smaller-maxDeflectionRad combined with cubic curve; pitch/yaw/throttle/neutral-return all unregressed.  <!-- status: complete -->
    - [x] P2.verify-human.1 — Aileron full-deflection roll rate: PASS — operator approves ~2s per full rotation at 5° aileron cap.  <!-- status: complete -->
    - [x] P2.verify-human.2 — Aileron tap feel: PASS — Phase 1 cubic curve + Phase 2 5° aileron cap acceptable; operator did not flag full-hold authority reduction.  <!-- status: complete -->
    - [x] P2.verify-human.3 — Pitch / yaw / throttle / neutral-return regression: PASS — unchanged from Phase 1 approval.  <!-- status: complete -->
  - [x] verify-codify — `roll-rate.test.ts` IS the codified Phase 2 acceptance gate (3 tests; firm gate ≤200°/s; sign anchors). No new tests needed — all verified behaviors covered. Full suite 605/606 (1 pre-existing flake per SURFACE-2026-05-16-02, triage recorded above). tsc both configs clean; production build clean; Playwright e2e 15/15 ✓ in 2.0min. No regressions detected. Both Phase 1 + Phase 2 codify complete.  <!-- status: complete -->

## Current Node
- **Path:** Feature > shipped (finalize in progress)
- **Active scope:** finalize
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** 4 SURFACEd (SURFACE-2026-06-06-01 WASD keymap deferred; SURFACE-2026-06-06-02 pitch envelope IMMEDIATE-NEXT after this feature; SURFACE-2026-06-06-03 missing clP roll-damping mechanism, arch-level, deferred-by-workaround; SURFACE-2026-06-06-04 scripted-input URL mode for reliable live feel verification)

## Test Triage — flightmodel.test.ts:368 "1000 calls to applyForces complete in under 50 ms"
Classification: Flaky test (pre-existing — known load-flaky perf assertion documented as SURFACE-2026-05-16-02 in `workflow/backlog.md`)
Confidence: high
Evidence: 4-run sequence at Phase 2 verify-codify (2026-06-06) — pass / pass / fail (115ms) / pass / fail (115ms). The test asserts wall-clock elapsed time against an absolute 50ms threshold, which is intrinsically load-flaky under full-suite parallelism. SURFACE-2026-05-16-02 records the same flake pattern across multiple prior cycles (50-86ms range). Today's 115ms is on the higher end but matches the same load-induced shape. The test exercises `applyForces`, untouched by this feature. The flake is independent of any controls-feel-pass change.
Action: NO test or code modification. Per the §3b triage rule, flaky tests are never modified to eliminate the flake; instead, they remain as a load signal. The SURFACE entry already proposes the proper fix (relative baseline or perf-only test invocation tag) which is out of scope for this feature. Proceeding to verify-codify F16 ship because: (a) the firm gates (`roll-rate.test.ts` 3/3, controls 26/26, full new-test count 605/606 with the 1 flake) all pass; (b) the flake is pre-existing and unrelated to this feature.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

[SURFACED-2026-06-06] Phase 1 — Operator T1 (now Phase-1-entry) feel-check decoded:
  - **(1) A/D too jerky** — current `stickRate=5.0`/s deflects 30% on a 60ms tap; want finer small-input response. THIS IS PHASE 1 TARGET.
  - **(2) Q/E "wonky, like ice road"** — operator self-flagged "may not be a control issue, is an airplane supposed to fly this way?" — YES, fixed-wing rudder yaw induces sideslip + gentle Dutch-roll. Not a controls.ts concern; expected aviation feel. NO ACTION.
  - **(3) W/S doesn't work** — confirmed: pitch is bound to `ArrowUp`/`ArrowDown` in `DEFAULT_KEY_MAP` (`src/engine/input.ts:16`). Most modern game players expect WASD as the unified stick. Filed as SURFACE-2026-06-06-01 for follow-up task — out of scope per `feedback_surface_or_means_or.md`.
  - **(4) Q/E feels less sensitive than A/D** — coupled to (1); cubic curve at the same `stickRate` softens A/D toward where Q/E currently lives. Likely resolves itself when (1) lands; if not, a per-axis stickRate override is a future feel knob.
  - **(5) Throttle, neutral, trim drift all feel right** — no action.

[SURFACED-2026-06-06] Phase 1 — WASD keymap follow-up — Default keymap binds pitch to ArrowUp/ArrowDown, but operator (and modern game players) expect W/S. Filed as SURFACE-2026-06-06-01 in `workflow/backlog.md`. One-line edit to `DEFAULT_KEY_MAP` in `src/engine/input.ts` if/when separately picked up.

[SURFACED-2026-06-06] verify-human — Process correction: this feature was originally driven as a task workflow (no verify-human step). Operator interjected at task-close to require the operator-side verify pass. Escalated to feature workflow mid-session; Phase 1 reconstructed as already-complete. Lesson candidate for memory: "feel-targeted changes always escalate to feature workflow, regardless of code-size, because the verify gate is human-only." Awaiting second observation before persisting per `feedback_memory_active_recall.md` two-observation threshold.

## Retrospect (feature-finalize, 2026-06-06)

This feature started as a task (`task-plan controls-feel-pass`) and escalated to feature workflow mid-session at operator interjection. It then went through THREE F23 back-loops on Phase 2's knob choice plus an F12 within Phase 1. The shipped result is small (~10 lines of production code change across `controls.ts` + `aircraft.json`); the path here was disproportionately long, and that's where the most durable lessons live.

- **What changed in our understanding:**

  **1. The operator's vague feel-complaint decomposed into ORTHOGONAL signals, only after directed elicitation.** "Controls aren't there yet" actually meant: (a) snap-roll at full deflection (the root issue, addressed by Phase 2 maxDeflectionRad cap); (b) coarse stick tap response (partially addressed by Phase 1 cubic curve); (c) WASD vs Arrows mismatch (orthogonal, SURFACE-06-01); (d) "Q/E feels icy" which is real fixed-wing rudder behavior, not a bug; (e) "can't backflip" which is a pitch-envelope concern needing an arch-level cycle (SURFACE-06-02). One vague qualitative input → five distinct signals.

  **2. Inertia governs ACCELERATION, not TERMINAL roll rate.** Biggest plan-time derivation error. At terminal angvel, ω̇ = 0 → inertia drops out of the moment equation; only damping vs commanding moment matters. Initial Phase 2 inertia.z bump (1500→6000) produced zero terminal-rate effect; caught it via a deterministic Vitest test surfacing what neither my agent-side Playwright probe (sample-window artifact) nor my mental-math force-balance (only computed *initial* angular accel) revealed. Mental-math force-balance is fine if it's at the *right operating point*; "initial accel" ≠ "steady state."

  **3. Agent-side Playwright `dispatchEvent` is unreliable for time-sensitive physics observations.** Playwright reported 146°/s sustained after the (broken) inertia bump; operator's verify-human reported "<1s per rotation" (>360°/s); Vitest harness confirmed actual terminal 550°/s. Three different numbers from the same physics state. Root cause: dispatchEvent timing doesn't align with the game loop's fixed-timestep ticks; the aircraft's body-Z axis rotates during the sample window in ways that decouple body-frame measurements from world-frame observations. Filed SURFACE-2026-06-06-04 (scripted-input URL mode).

  **4. The codebase lacks a roll-rate aerodynamic damping mechanism (no clP analogous to D17 clQ).** Terminal roll equilibrates only through weak β5 coupling, giving an unphysical 550°/s at default aileron. The Phase 2 `maxDeflectionRad` cap is a workaround — bounds commanding moment but doesn't introduce damping. The proper arch-level fix is SURFACE-2026-06-06-03; deferred.

- **Assumptions that held:**
  - `feedback_surface_or_means_or.md` single-knob discipline — Phase 1 picked cubic curve over keymap fix; Phase 2 picked maxDeflectionRad over inertia after inertia attempt failed. Filing orthogonal items as SURFACEs (06-01, 06-02, 06-03) kept each phase's scope clean.
  - `feedback_browser_walkthrough_load_bearing.md` — operator's qualitative observation was load-bearing; Vitest+e2e green did NOT mean the feature worked. Fifth observation now; the pattern is firm.
  - Operator-as-X carve-out under CLAUDE.md Rule #3 (b) applies cleanly for `aircraft.json` feel-tuning; this feature didn't need the harness optimizer because the search space was 1-D.

- **Assumptions that were wrong:**
  - **Original task plan boundary "no aircraft.json edits" was wrong.** Operator's complaint was a physics knob, not a controls.ts knob. Cost two F12 cycles before F23-to-plan added Phase 2.
  - **Inertia bump as first physics fix was wrong** (covered above).
  - **Linear extrapolation of terminal-rate vs aileron was wrong** — predicted 132°/s at 6° aileron; actual 215°/s. Sub-linear because β5 coupling damping also shrinks with smaller aileron. Required iteration to 5° to hit the firm gate.
  - **`process.env` in the new Vitest test was wrong** — Node-only global, not in the project's browser-default tsconfig types. tsc caught it during verify-codify; trivial fix (removed env-gated debug log).

- **Approach delta:** The plan was iterated three times (initial task → escalation to feature Phase 1 only → Phase 2 inertia → Phase 2 maxDeflectionRad). Each revision was driven by a real diagnostic insight, not by drift — so the F23 back-loops were correct uses of the workflow. The shipped result (10 lines of code + 14 new tests + 4 SURFACEs filed + 1 deterministic codified acceptance test) is much smaller than the path length suggests; that's the cost of iterative diagnosis vs upfront perfect planning. Drive mode was full-autopilot but the operator interjected at THREE key moments (task-close escalation, "research roll rates" routing, "scripted-input mode" infrastructure request) — without those interjections, this would have shipped premature task-close at commit `9ef802e` with an unaddressed feel issue.

- **Lesson candidates for memory persistence** (per `feedback_memory_active_recall.md` two-observation threshold; defer until second observation, EXCEPT where this is a second-or-later observation):

  1. **Terminal-vs-initial physics derivation** — "for steady-state physics quantities, derive at the steady-state condition (ω̇=0, a=0), not the initial-acceleration condition. Inertia is irrelevant at terminal." First observation here. Defer.
  2. **Vitest > Playwright dispatchEvent for time-sensitive physics measurements** — first observation. Defer (SURFACE-2026-06-06-04 covers the actionable side).
  3. **Mid-session task→feature escalation pattern: feel-targeted changes always need verify-human regardless of code-size; defaulting to task workflow is the trap.** First observation here. Defer.
  4. **`feedback_browser_walkthrough_load_bearing.md` 5th observation** — pattern firmly established; possibly worth promoting from "feedback memory" to a CLAUDE.md rule that names the workflow boundary (any change that affects user-felt behavior MUST go through verify-human, regardless of task/feature classification). Worth proposing at next codify cycle.
