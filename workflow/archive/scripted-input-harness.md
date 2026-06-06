---
workflow: feature
state: ship (complete)
drive_mode: full-autopilot
created: 2026-06-06
ship_commit: 14975f4
entry: spec (complex feature — URL schema + game-loop hook + log buffer + e2e + CLAUDE.md mandate)
---

# Feature: Scripted-Input Browser Harness

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-06-06
**Entry:** spec (complex feature)

## Problem Statement

Currently, the only way to drive in-browser flight verification is via Playwright's `dispatchEvent(new KeyboardEvent(...))` to simulate keyboard input. This is **unreliable for time-sensitive observations**:

- Playwright keyboard event timing is subject to OS-level scheduling jitter
- The dispatched event arrives at a non-deterministic point relative to the fixed-timestep game loop (60 Hz physics ticks)
- Sample-window measurements decouple from the underlying physics state (body-frame quantities vs world-frame observations at non-identity attitude)

Evidence: SURFACE-2026-06-06-04 (filed during controls-feel-pass Phase 2). A Playwright probe produced 107-150°/s mean / peak roll rate readings vs 179°/s in a deterministic Vitest harness at the same physics state. The operator's qualitative observation (full rotation in <1s = >360°/s) was correct; the Playwright probe's quantitative measurement was misleading.

Vitest at the physics-core layer is deterministic but **bypasses** the full game pipeline (controls curves, stickRate ramp, applyControls routing, mission framework, HUD). There is no current way to verify the complete in-game controls→flight pipeline deterministically.

The harness must drive **the real game loop** (preserving controls.ts curve+ramp, mission framework, all of main.ts wiring) but with deterministic input timing keyed to the fixed-timestep physics tick rather than wall-clock OS scheduling.

## User Stories

- **As an agent doing feature-verify-self for a physics/feel WP**, I want to drive the in-browser game with a precise tick-keyed script (e.g. "hold ↑ from 1s to 4s; throttle 60% from start") and read back a structured per-tick log, so that my observations are deterministic and reproducible across machines.

- **As an agent doing feature-verify-self for an aerobatic/airframe-class question**, I want to swap aircraft.json without modifying it on disk (e.g. `?config=aerobatic`), so that I can compare configurations without polluting the production config or working tree.

- **As an operator reviewing an agent's verify-self report**, I want the Playwright probe to use the harness rather than `dispatchEvent`, so that the numbers in the report are repeatable when I re-run them locally.

## Acceptance Criteria

The feature is done when:

1. **URL schema** — query params `?script=<spec>&logLevel=<level>&config=<name>` are accepted and parsed.
2. **Tick-keyed input scheduling** — given `?script=hold:ArrowUp@1.0:4.0`, the harness presses ArrowUp at exactly physics-tick 60 (1.0s × 60Hz) and releases it at physics-tick 240. Multiple comma-separated scripts work concurrently (e.g. `?script=hold:KeyD@0:2.0,hold:ArrowUp@1.0:5.0`). Throttle override supported (e.g. `hold:Throttle=0.6@0:end`).
3. **Determinism gate** — running the same `?script=...` URL twice produces byte-identical log buffers (asserted by a Playwright e2e test).
4. **Per-tick log buffer** — exposes `window.__aircraft.getScriptedLog()` returning an array of per-tick state rows. Default `logLevel=feel` shape: `{tick, t_sec, position, linvel, rotation, angvel, pitch_deg, roll_deg, yaw_deg, AS_mps, alpha_deg, beta_deg, throttle}`.
5. **End signal** — `window.__aircraft.isScriptComplete()` returns `true` once all scheduled inputs have been processed AND a configurable post-script settle window (default 60 ticks = 1s) has elapsed. Playwright `waitForFunction` on this signal returns control deterministically.
6. **Config swap** — `?config=aerobatic` loads `/config/aircraft-aerobatic.json` instead of the default; absent param keeps default `/config/aircraft.json`. Filename validated against a regex (`/^[a-z0-9_-]+$/i`) to prevent path traversal.
7. **Single e2e test** demonstrates the full flow: navigate URL, wait for completion signal, fetch log, assert a basic invariant (e.g. AS within bounds at end of held-elevator scenario). Lives under `tests/e2e/`.
8. **CLAUDE.md mandate** — a new section in the global `## Physics-mechanism discipline` block (or a new sibling block) codifies that time-sensitive browser observation MUST use this harness, NOT Playwright `dispatchEvent`. Cites SURFACE-2026-06-06-04 as origin.
9. **Vitest 592+ green; e2e 16/16 green; tsc both configs clean; build clean.**

## Out of Scope

- Mouse / touch input scripting (keyboard-only for v1).
- Modifier-key combinations (no `Shift+ArrowUp` etc.; not needed for any current flight control).
- "Tap" semantics (press then release in same tick). The `hold:Key@start:end` form covers all current use cases. If a future feature needs a single-tick tap, extend the grammar later.
- Recording / replay of human play sessions. The harness consumes pre-authored scripts only.
- Production-mode operation. The harness is debug-only — gated on `?debug=true` like the existing trajectory buffer. Production builds carry no overhead.
- A `?script=` GUI / authoring tool. Operators / agents write the string directly.
- Logging level γ (per-surface CL/CD/lift/drag forces). Default β (flight-feel quantities) is sufficient for all expected use cases; agents needing per-surface dumps should use the Vitest harness, not the URL harness.
- Replacing `aircraft.json` loading globally. `?config=<name>` is a runtime override at boot only; no file mutation, no persistence.

## Technical Constraints

- **No new 3rd-party dependencies.** Pure DOM + existing engine modules (`input.ts`, `loop.ts`, `main.ts`).
- **Determinism must be preserved.** The harness MUST run inside the existing `GameLoop` (no separate timer loops). Input dispatch happens at the `onPhysics(dt)` callback boundary, keyed by tick counter.
- **Log buffer capacity** = 3600 ticks (60s @ 60Hz) — sufficient for any reasonable scripted scenario. Bounded ring buffer to avoid runaway memory if `?script` has no end.
- **Fixed-timestep alignment**: tick 0 = first `onPhysics` invocation after `loop.start()`. The script schedule references tick numbers from that origin.
- **Existing `?debug=true`** gating: the harness is only initialized when debug mode is active. URL `?script=...` without `?debug=true` is a silent no-op (warn in console).
- **Input integration point**: the harness synthesizes `KeyboardEvent`-equivalent state directly into `InputManager.state.keys` at the physics-tick boundary, bypassing the DOM event dispatch entirely. This is the key determinism win.
- **Throttle handling**: throttle is `Controls.throttle` (a stateful field), not a key. Scripted throttle overrides set it directly each tick during the held window.
- **Config swap**: `loadAircraftConfig` already takes a path argument; main.ts currently hard-codes `'/config/aircraft.json'`. The change is a 2-line URL-param read.
- **The 3 pause-note diagnostic test files** (`pitch-envelope.test.ts`, `pitch-envelope-stall-probe.test.ts`, `pitch-envelope-aerobatic-probe.test.ts`) remain orthogonal to this feature. They're disposed in the post-feature Path A close, NOT here.

## Open Questions

(none — all design decisions confirmed by operator)

- ~~Timing model — ticks vs seconds?~~ → **seconds** (operator preference; `@1.0:4.0` syntax).
- ~~Log scope — which fields per tick?~~ → **β / flight-feel** (default; `?logLevel=full` opt-in deferred until requested).
- ~~Config swap included?~~ → **yes** (operator-confirmed; needed for immediate Path A walkthrough use case).
- ~~Mandate placement?~~ → **finalize** (after feature ships and discipline is provable). Mandate text drafted in operator handoff.

## Architectural Decision Records (drafted; final-form on plan)

- **AD-SH1: Scripted input bypasses the DOM event layer.** The harness writes directly to `InputManager.state.keys` at the `onPhysics` boundary rather than calling `dispatchEvent`. Rationale: Playwright's keyboard dispatch jitter is the exact failure mode this feature exists to eliminate. Synthesizing key state at the tick boundary is the only way to achieve byte-identical reruns. The DOM event handlers in `InputManager` (`onKeyDown`/`onKeyUp`) remain untouched and continue to drive real user input.

- **AD-SH2: Throttle is a special-case key.** Grammar `hold:Throttle=0.6@1:5` sets `Controls.throttle = 0.6` during the held window. This is the cleanest way to script throttle without inventing a separate URL param.

- **AD-SH3: Completion signal is post-script-end + settle window.** `isScriptComplete()` returns true after `max(end_tick across scripts) + settleTicks`. Default `settleTicks = 60` (1s). Lets the agent observe what happens AFTER all inputs release (e.g. does the airframe stabilize, does AS recover) without inventing a separate "wait" primitive in the grammar.

- **AD-SH4: Path traversal defense on `?config=<name>`.** Regex `/^[a-z0-9_-]+$/i` rejects `/`, `..`, etc. The resulting path is `/config/aircraft-${name}.json` (NOT `/config/${name}`). Two layers of defense: regex on the name AND a hard-coded prefix.

## CLAUDE.md mandate (draft — lands at finalize)

```markdown
### Browser-walkthrough verify-self must use scripted-input harness

When a feature workflow's verify-self stage requires observing in-game flight
behavior over a window > 2s, the agent MUST use the scripted-input harness
(`?script=...&logLevel=...&config=...`) and read `window.__aircraft.getScriptedLog()`,
NOT Playwright `dispatchEvent` keyboard simulation.

**Why:** Playwright keyboard events are subject to OS-level scheduling jitter
that decouples observation from the fixed-timestep game loop, producing
inconsistent measurements (origin: SURFACE-2026-06-06-04, controls-feel-pass
Phase 2 — Playwright probe read 107-150°/s vs Vitest 179°/s at the same
physics state).

**How to apply:**
- Write the input script as a URL query string. Use `hold:<Key>@<startSec>:<endSec>` for keys, `hold:Throttle=<float>@<startSec>:<endSec>` for throttle.
- Use `?config=<name>` to swap aircraft.json without modifying the production file.
- Playwright navigates the URL, calls `page.waitForFunction(() => window.__aircraft.isScriptComplete())`, then reads the structured log.
- Manual keyboard walkthrough by the operator remains valid for qualitative verify-human checks — this mandate covers agent-side automated probes only.
- Vitest at the physics-core layer remains the gold standard for unit-level determinism. Use the harness when full-pipeline verification is required (controls curves + ramp + mission + HUD).
```

## SURFACE references

- **SURFACE-2026-06-06-04** (medium, this feature closes it on Branch A)
- **SURFACE-2026-06-06-02** (Path A close — orthogonal to this feature but the immediate consumer; the aerobatic-config walkthrough is the first user of `?config=aerobatic`)

## Out-of-context-but-relevant

- Pause note 2026-06-06 (workflow/.session.md, deleted at resume) documented the operator-decision flow that routed here. The aerobatic Vitest jet-experiment delivered JET-PASS for Path A.
- Future closure of SURFACE-2026-06-06-02 (Path A) requires this harness for the browser-walkthrough confidence step (ii in the resume handoff).

---

## Work Tree

- [x] Phase 1: Scripted-input harness — URL parser + game-loop hook + log buffer + config-swap + e2e + CLAUDE.md mandate  <!-- status: COMPLETE -->
  **Observable outcomes:**
  - **Browser:** Navigating to `http://localhost:5173/?debug=true&mission=free-flight&script=hold:ArrowUp@1.0:4.0` causes the aircraft to pitch up over the scripted window (max pitch deg measurable from `getScriptedLog()`); `window.__aircraft.isScriptComplete()` returns `true` after script end + 1s settle.
  - **Browser:** Navigating to `?debug=true&mission=free-flight&config=aerobatic` loads `/config/aircraft-aerobatic.json`; `getState()` reports `mass=500` airframe behavior (e.g. AS climbs faster at full throttle); invalid `?config=../etc/passwd` is rejected (regex match fails) and the default config loads instead with a `console.warn`.
  - **Browser:** Navigating to the same `?script=...` URL twice and capturing both `getScriptedLog()` outputs produces byte-identical buffers (asserted via `JSON.stringify(a) === JSON.stringify(b)` in the e2e test).
  - **Browser:** Navigating with `?script=hold:Throttle=0.6@0:end` sets `controls.throttle` to 0.6 for the duration of the script window; verified via the log row's `throttle` field.
  - **CLI:** `npm run test:e2e -- scripted-input.spec.ts` exits 0; new test passes (deterministic-rerun + held-elevator-causes-pitch-up + config-swap).
  - **CLI:** `npm run test` exits 0; existing 610 Vitest cases + ~5 new parser-unit cases all green.
  - **CLI:** `npm run build` exits 0 (production build still works; harness debug-gated has no runtime cost in non-debug mode).
  - **CLI:** `npx tsc -p tsconfig.json && npx tsc -p tsconfig.tools.json` both exit 0.
  - **File:** `/Users/stayman/.claude/CLAUDE.md` contains the new mandate section at the end of `## Physics-mechanism discipline` OR as a sibling block (whichever placement reads most coherently with existing rule numbering).

  - [x] P1.1 Write `src/engine/scripted-input.ts` — parser + 15 unit tests (all green).  <!-- status: COMPLETE -->

  - [x] P1.2 Write `src/engine/scripted-input-runner.ts` — runner class + 8 unit tests (all green). Added freeze-latch at first isComplete() to make log byte-stable across observation timing.  <!-- status: COMPLETE -->

  - [x] P1.3 Wire harness into `src/main.ts` — runner ticked at start of onPhysics so synthesized keys are visible to controls.update(dt); window.__aircraft.getScriptedLog / isScriptComplete exposed (debug-only).  <!-- status: COMPLETE -->

  - [x] P1.4 Wire `?config=<name>` into `src/main.ts` — URL parsed at bootstrap, configNameToPath() resolves to `/config/aircraft-${name}.json`, fallback-on-invalid with console.warn.  <!-- status: COMPLETE -->

  - [x] P1.5 Write `tests/e2e/scripted-input.spec.ts` — 4 tests: pitch-up under hold:ArrowUp, byte-identical-rerun determinism, ?config=aerobatic differs from default, malformed config falls back. All 4 green; 6/6 stable on determinism re-run.  <!-- status: COMPLETE -->

  - [x] verify-auto  <!-- status: COMPLETE -->
    - [x] Scoped Vitest (parser + runner) → 23/23
    - [x] e2e scripted-input.spec.ts → 4/4 + 6/6 stable on determinism rerun
    - [x] tsc both configs → clean
    - [x] npm run build → clean
    - Pre-existing failures unchanged (pitch-envelope Path-A-pending + flightmodel.test.ts:368 perf-flake) — not introduced by this build.

  - [x] verify-self  <!-- status: COMPLETE -->
    - [x] hold:ArrowUp@1.0:4.0 → maxPitch=55.28° at tick 175 (well above +20° threshold) ✓
    - [x] Determinism — JSON.stringify match across two runs, checksum 1517133524, log length 100652 chars ✓ (BLOCKING gate confirmed)
    - [x] ?config=aerobatic differs from default — terminal AS 124.98 vs 81.89 m/s (~52% higher) ✓
    - [x] hold:Throttle=0.6 → controls.throttle=0.6 read at tick 31 + tick 531 ✓
    - [x] Path-traversal ?config=../etc/passwd silently rejected with expected warning + default config still loads ✓ (BLOCKING gate confirmed)
    - (Browser-walkthrough verify-self contract — observation #4 of `feedback_browser_walkthrough_load_bearing.md`; reinforces the rule that motivated this feature.)

  - [ ] verify-human  <!-- status: NOT-STARTED -->
    - [ ] Operator confirms the URL schema (`?script=hold:ArrowUp@1.0:4.0`) feels right — does the `@<startSec>:<endSec>` syntax read naturally? Comma-separator for multiple scripts intuitive? Throttle special-case (`hold:Throttle=0.6@0:end`) OK?
    - [ ] Operator confirms the log shape (β / flight-feel fields) is what they'd want to inspect in a verify-self review. Field names readable? Anything obviously missing?
    - [ ] Operator confirms the CLAUDE.md mandate text reads as intended — clear directive, fair scope (agent-side automation only, not human walkthroughs), correctly traces back to SURFACE-2026-06-06-04.
    - [ ] **Per drive_mode: full-autopilot, verify-human is SKIPPED per `feedback_operator_as_external.md`** (operator-as-X deviation: operator-as-feedback-reviewer is unavailable at the moment of this WP shipping; operator can review the harness on first downstream use, i.e. the Path A walkthrough). Mark this gate as `SKIPPED-full-autopilot` rather than removed; flag in retrospect.

  - [x] verify-codify  <!-- status: COMPLETE -->
    - [x] `tests/e2e/scripted-input.spec.ts` is the codification — 4 tests covering all 5 verify-self outcomes (the throttle-override outcome is implicitly covered by test 3 since `?config=aerobatic` with `hold:Throttle=1.0` depends on throttle override working end-to-end).
    - [x] **Discipline-level codification**: project-local CLAUDE.md `### Browser-walkthrough discipline` subsection landed in P1.6 — codifies the mandate for all future agent-side automated probes citing SURFACE-2026-06-06-04.
    - [x] Integration boundary covered: e2e tests cite the existing consuming surface `?debug=true&mission=free-flight` by name.
    - [x] Full Vitest run 632/634 — same baseline as build-time; no new regressions. Triage below.

## Test Triage

### Test Triage — pitch-envelope.test.ts > backflip: holding full +elevator for 5s reaches pitch > +90°
- Classification: **Obsolete test (intentionally superseded by Path A)**
- Confidence: high
- Evidence: Pause-note 2026-06-06 documents this assertion as wrong by Path A reasoning; Step 0 jet-experiment (this session) confirmed via aerobatic-config probe that Cessna-class T/W=0.61 physically cannot backflip from cruise. Assertion was written pre-objective-sharpening; needs flipping to `≤+90°` next session as part of SURFACE-2026-06-06-02 closure.
- Action: **Do NOT modify in this feature workflow.** Pre-existing scope, lives under separate SURFACE-2026-06-06-02 disposition (Path A). Carried forward unchanged.

### Test Triage — flightmodel.test.ts:368 perf-flake (1000 calls to applyForces complete in under 50 ms)
- Classification: **Flaky test (failure unrelated to new code)**
- Confidence: high (documented as SURFACE-2026-05-16-02 known flake in pause note)
- Evidence: Hardware/CI-jitter-sensitive perf gate; retry passed (1 fail → 0 fail on rerun).
- Action: **No modification.** Pre-existing flake, not introduced by this build, retry confirmed.

  - [x] P1.6 Append project-local CLAUDE.md mandate as `### Browser-walkthrough discipline` subsection under `## Development Conventions`, parallel to existing `### Physics-mechanism discipline`. Cites SURFACE-2026-06-06-04 as origin. (Initial draft was to global CLAUDE.md but operator directed it to project-local instead — global has no harness-shaped affordance to mandate, project does.)  <!-- status: COMPLETE -->

## Current Node
- **Path:** Feature > finalize
- **Active scope:** finalize (shipped at commit 14975f4)
- **Blocked:** none
- **Unvisited:** (none)
- **Open discoveries:** Pre-existing failures triaged (one obsolete-await-Path-A, one flake-passes-on-retry); neither blocks ship.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

[SURFACED-2026-06-06] feature-plan — wbs.md exceeds size guard (1023 lines), already in conversation context from feature-spec read (per skip rule); not re-read.
[SURFACED-2026-06-06] feature-plan — arch.md exceeds size guard (2645 lines), already in conversation context from feature-spec read (per pointer-only rule for plan); not re-read.
[SURFACED-2026-06-06] finalize — phugoid-probe.spec.ts could be refactored to use the new `?script=` harness as a dogfooding exercise (legacy tests use 30 × wall-clock 1s samples + getState() polling — exactly the pattern the harness eliminates). Filed in backlog as low-priority follow-up. NOT done in this finalize per single-knob discipline.

## Retrospect

- **What changed in our understanding:**
  - Vite's `vitest run` invokes Node, not jsdom — the `InputManager` constructor needs an explicit `EventTarget` arg in unit tests (the existing `input.test.ts` already followed this pattern). My runner test missed it on first write; caught and fixed in 1 cycle.
  - Playwright's test timing is not the only OS-jitter risk — there's an analogous risk *between* `isScriptComplete()` becoming true and `getScriptedLog()` being called. The log can grow by 0-N rows in that window. Solved by latching the log at first `isComplete()` (the `frozen` flag in the runner). This was caught by the determinism e2e test failing 2/6 times before the latch fix; passed 6/6 after. **Surprise:** this is a SECOND-order determinism risk that the spec didn't anticipate.
  - **Operator interrupt mid-finalize was load-bearing.** The phugoid-probe menu prune + CLAUDE.md quickstart were not in the original spec — the operator surfaced them mid-flow. Both fit naturally into finalize (the prune is a 5-line index.json edit; the quickstart enhances the mandate). Per the operator's "do them now" directive, Option 2 was chosen over Option 3 (separate task workflow). Trade-off accepted: one finalize commit that bundles three orthogonal-but-small changes vs three separate commits. The bundle is justified because all three are dev-infrastructure / discipline-level, not user-facing physics.

- **Assumptions that held:**
  - Synthesizing keys directly into `InputManager.state.keys` at the `onPhysics` boundary bypasses the DOM event layer cleanly; `controls.update(dt)` reads the synthesized state on the same tick. (AD-SH1 from spec.)
  - Path-traversal regex `/^[a-z0-9_-]+$/i` + hard-coded `/config/aircraft-${name}.json` prefix is enough defense (no need for additional sanitization).
  - The 4-test e2e suite (pitch-up + determinism + config-swap + path-traversal) covers all 5 verify-self outcomes (throttle override implicitly covered by config-swap test which depends on throttle override end-to-end).

- **Assumptions that were wrong:**
  - Initial spec did NOT call out the log-buffer-vs-observation race. The freeze-latch was added during build after the e2e determinism test surfaced the issue empirically. Lesson: even for a feature whose ENTIRE PURPOSE is determinism, secondary determinism risks can hide in observation-side timing.
  - Initial test (parser tick-counting) had a subtle off-by-one between "tick was processed" and "tick counter incremented." Caught at first Vitest run; the runner logic was correct, the test's mental model was off.

- **Approach delta:**
  - Plan said "P1.5 single Playwright test" — shipped 4 e2e tests (pitch-up, determinism, config-swap, path-traversal). Each covers a distinct observable outcome; bundling into one test would have made failure-attribution harder.
  - Plan deferred `logLevel=full` to future work. Held — not needed at ship.
  - Plan said "P1.6 lands at finalize." Shipped at build instead (P1.6 was the CLAUDE.md mandate; it doesn't depend on running code, so writing it inline with the impl was cleaner). At finalize: appended a separate Quickstart section in response to operator request.

## Communicate

**Feature complete:** Scripted-input browser harness (`?script=...`) has shipped at commit `14975f4`. It drives the in-browser game deterministically at the fixed-timestep physics tick boundary, replacing Playwright `dispatchEvent` (which is OS-scheduler-jitter dependent). The byte-identical-rerun e2e test (`tests/e2e/scripted-input.spec.ts` test 2) is the load-bearing determinism gate. To use: navigate to `localhost:5173/?debug=true&mission=free-flight&script=hold:ArrowUp@1.0:4.0`, await `window.__aircraft.isScriptComplete()`, read `window.__aircraft.getScriptedLog()`. Quickstart cheatsheet in `CLAUDE.md` under `### Browser-walkthrough discipline`.

Requester = operator — closure notice for self-record.

