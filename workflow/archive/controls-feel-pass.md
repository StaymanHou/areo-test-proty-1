---
workflow: task
state: act (complete)
drive_mode: full-autopilot
---

# Task: controls-feel-pass

**Workflow:** task
**State:** act (complete)
**Created:** 2026-06-06

## Problem Statement
Operator reported "controls aren't there yet" after WP14.19 cascade-close browser walkthrough — the physics is coherent at V_trim=78 but stick/throttle response feels wrong. Task scope: identify the specific feel deficiency via a directed feel-check session, then apply the smallest targeted fix in `src/aircraft/controls.ts` (input curves, rate limits, trim hold, or schema extension) — no physics changes.

## Context

**Current controls implementation** (`src/aircraft/controls.ts`):
- 4 normalized control values: `aileron`, `elevator`, `rudder` ∈ [-1, +1]; `throttle` ∈ [0, 1].
- Stick axes ramp linearly toward command target at `stickRate=5.0`/s (full deflection in 0.2s, instant if held).
- Throttle ramps only while a throttle key is held at `throttleRate=0.5`/s; otherwise holds.
- No input curves (linear), no rate-limiting at high deflection, no trim hold, no stability augmentation.

**Downstream:** `Controls` values feed `FlightModel.applyControls()` (`flightmodel.ts:114`) which maps each axis to per-surface deflection via `value * sign * maxDeflectionRad`. Per-surface `maxDeflectionRad` lives in `public/config/aircraft.json` — that's the existing tuning knob for *control authority*, not *control feel*.

**Boundary:** the Controls→FlightModel contract is normalized values in [-1,1] / [0,1] — any feel changes happen entirely inside `controls.ts`. No physics changes; no `aircraft.json` edits (control authority retunes are a separate concern).

**Relevant files:**
- `src/aircraft/controls.ts` — the only file likely to change.
- `src/aircraft/controls.test.ts` — extend with new feel-knob tests after changes land.
- `src/main.ts:90-93` — calls `controls.update(dt)` then `flightModel.applyControls(controls)` each physics tick. No change expected here.
- `public/config/aircraft.json` — out of scope; cascade-tuned at WP14.19.

**Pause-note carryover:**
- Specifics undocumented at plan time; T1 must surface them before T2 implementation.
- Operator did a casual-feel walkthrough at session end — fresh in their memory, so a directed feel-check session has the tightest feedback loop.

**Memory anchors that may fire:**
- `feedback_asymmetric_fix_no_op.md` — if extending the schema, the default value should preserve current linear behavior (no surprise regression to the V_trim flight that just landed).
- `feedback_surface_or_means_or.md` — at T2, pick ONE knob, not the union. Don't ship input curves + rate limit + trim hold all at once.
- `feedback_browser_walkthrough_load_bearing.md` — verify-in-browser is required at T4; Vitest alone doesn't prove feel.

## Work Tree

- [x] T1 Feel-check session at `localhost:5173/?mission=free-flight&debug=true` to elicit operator-specific feel complaint; document the 1–2 specific feel deficiencies under `## Discoveries`  <!-- status: complete -->
- [x] T2 Add `stickCurve` opt-in to `ControlsOptions` in `src/aircraft/controls.ts` — default to mild cubic expo `f(x) = 0.5·x + 0.5·x³` (softens small inputs, preserves full-deflection authority); `'linear'` option retained for tests / tuning. Also added `resetSticks()` method (replaces direct field zeroing in `main.ts:332-336`, which would have left raw pre-curve buffer stale).  <!-- status: complete -->
- [x] T3 Extend `src/aircraft/controls.test.ts` with Vitest coverage of the new knob (linear default still possible; cubic at x=0 → 0, x=1 → 1, x=0.5 → 0.3125); run `npm run test -- controls` + full suite + `npm run build` + `npm run test:e2e`. **Results:** controls 26/26 ✓ (11 new tests); full suite 603/603 ✓ (up from 592); tsc default + tools configs clean; production build clean; Playwright e2e 15/15 ✓ in 2.0min (phugoid-probe at throttles 0.05/0.15/0.40 confirm V_trim flight unchanged — alt traces 52→93→0 / 52→108→0 / 52→191→85 match WP14.19 baseline).  <!-- status: complete -->
- [x] T4 Browser walkthrough at `localhost:5173/?mission=free-flight&debug=true` confirming aileron sensitivity feels finer AND V_trim flight from WP14.19 is unregressed across all 3 mission types (free-flight, waypoint-patrol, phugoid-probe-mid). **Results:** (a) **Cubic curve live-verified** in free-flight: 100ms KeyD hold → aileron=0.3125 (vs raw=0.5; 37.5% softer at small-input); 300ms hold → aileron=1.0 (full deflection preserved). (b) **Phugoid-probe-mid:** alt 82→109→0 over 30s; phugoid period ~10s; AS 52–63 m/s through cycle — matches WP14.19 baseline. (c) **Waypoint-patrol:** clean V_trim spawn at AS=77.8 (target 78); glide to WP1 reached at t≈2s with alt 50→58, AS 78→69.3 — matches pause-note's "~1.6s to WP1" baseline. **Minor scope addition:** added `controls` to debug-only `window.__aircraft` global (`src/main.ts:264`) so future feel-tuning sessions can introspect curve/rate state live — opt-in via `?debug=true`, no production impact.  <!-- status: complete -->

## Current Node
- **Path:** Task > all complete
- **Active scope:** all complete — ready for `/task-close`
- **Blocked:** none
- **Open discoveries:** 1 SURFACEd to backlog (SURFACE-2026-06-06-01 — WASD keymap follow-up; explicitly deferred per `feedback_surface_or_means_or.md`)

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

[SURFACED-2026-06-06] T1 — Operator T1 feel-check report (decoded):
  - **(1) A/D too jerky** — current `stickRate=5.0`/s deflects 30% on a 60ms tap; want finer small-input response. THIS IS THE T2 TARGET.
  - **(2) Q/E "wonky, like ice road"** — operator self-flagged "may not be a control issue, is an airplane supposed to fly this way?" — YES, fixed-wing rudder yaw induces sideslip + gentle Dutch-roll. Not a controls.ts concern; expected aviation feel. NO ACTION.
  - **(3) W/S doesn't work** — confirmed: pitch is bound to `ArrowUp`/`ArrowDown` in `DEFAULT_KEY_MAP` (`src/engine/input.ts:16`). Most modern game players expect WASD as the unified stick. Filing as a SURFACE for a follow-up task — out of scope for this single-knob task per `feedback_surface_or_means_or.md`.
  - **(4) Q/E feels less sensitive than A/D** — coupled to (1); the cubic curve at the same `stickRate` softens A/D toward where Q/E currently lives. Likely resolves itself when (1) lands; if not, a per-axis stickRate override is a future feel knob.
  - **(5) Throttle, neutral, trim drift all feel right** — no action.

[SURFACED-2026-06-06] T1 — WASD keymap follow-up — Default keymap binds pitch to ArrowUp/ArrowDown, but operator (and modern game players) expect W/S. Filed as separate small task per `feedback_surface_or_means_or.md` (don't bundle into this task). One-line edit to `DEFAULT_KEY_MAP` in `src/engine/input.ts`. See `workflow/backlog.md`.

## Retrospect

- **What changed in our understanding:** Three things. (1) "Controls aren't there yet" decomposed into three orthogonal signals: a real feel knob (stick sensitivity), a keymap mismatch (W/S binding), and an expected-aviation behavior (rudder yaw / Dutch roll). The first is a controls.ts concern; the second is a separate task; the third is "by design" and not a defect. Without T1's directed feel-check session the task would have spent budget on the wrong knob. (2) The cubic-expo curve interacts cleanly with the existing `stickRate` ramp because ramping happens in raw space and the curve is applied at read time — this preserves rate-independence and lets `stickCurve` be re-tuned mid-flight without losing stick position. The implementation got this right on the first pass; the alternative (curve-before-ramp or stateful curve) would have made `resetSticks()` non-trivial. (3) The existing `controls.test.ts` Vitest fixture (`beforeEach { controls = new Controls(input) }`) was an implicit assertion that the default curve doesn't perturb ramp math. Changing the default broke ~10 tests until the fixture was pinned to `'linear'` — the right move was pinning the existing tests' fixture rather than rewriting their expectations, since their job is to verify ramp behavior, not curve behavior.

- **Assumptions that held:** (a) Per `feedback_surface_or_means_or.md`, picking ONE knob at T2 was correct — the WASD keymap, although a real complaint, is orthogonal and should ship in its own commit. (b) Per `feedback_browser_walkthrough_load_bearing.md`, Vitest + e2e green isn't sufficient for a feel-targeted change; the live cubic-curve verification (raw 0.5 → output 0.3125 at 100ms hold) was the load-bearing observation. Both anchors fired correctly. (c) The control authority change ought to live entirely inside `controls.ts` and not perturb the Controls→FlightModel contract; this held — `applyControls(controls)` consumes the same 4 normalized fields, no downstream change needed beyond the `resetSticks()` swap in `main.ts`.

- **Assumptions that were wrong:** (a) I initially assumed `window.__aircraft.controls` was already exposed for debug introspection — it wasn't. Adding it was a minor scope expansion (one line in `main.ts`) but worth noting: future feel-tuning tasks will want this hook, and adding it opportunistically as part of this task saves rediscovery later. (b) I initially expected `?mission=waypoint-patrol&debug=true` to deep-link-auto-start the mission the same way `?mission=phugoid-probe-mid` did during T4 — it did NOT consistently. Manual click was required after the first auto-start in the session. Probably a one-shot auto-start guard or a focus-event interaction; not a regression from this task, and not in scope to fix here, but worth noting if a future task is dialed in on the mission-select UX.

- **Approach delta:** Implementation matched plan closely. Two minor deltas beyond the plan: (1) added `resetSticks()` method (the plan said "preserve default behavior via opt-in schema" but didn't anticipate that `main.ts:332-336`'s direct field zeroing would leave the new `rawAileron/rawElevator/rawRudder` buffer stale — `resetSticks()` is the clean replacement, and worth keeping even if we backed out the curve); (2) added debug-only `controls` export on `window.__aircraft` (`main.ts:264`) — opportunistic, gated on `?debug=true`, no production impact, makes future feel-tuning sessions much cheaper to run. Both deltas were caught at implementation time, not at verify time, so neither cost rework.
