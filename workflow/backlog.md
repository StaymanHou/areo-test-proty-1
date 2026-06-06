# Backlog

Surface-notes from workflow runs. Consumed and resolved by higher-level workflows (arch revisions, new WPs, etc.).

## Open

### SURFACE-2026-06-06-04 — Need a deterministic scripted-input mode (URL query param) for headful in-browser feel-verification; Playwright dispatchEvent flow is unreliable for time-sensitive observations
- **Source:** feature:verify-self (controls-feel-pass Phase 2, 2026-06-06; operator directive)
- **Target level:** product:wbs (feature workflow — moderate scope: schema + game-loop hook + log buffer)
- **Type:** dev-infrastructure / verification-tooling
- **Priority:** medium (deferred until next time we have a feel-tuning feature that needs the same infrastructure — at minimum SURFACE-2026-06-06-02 pitch envelope diagnostic will want it)
- **Summary:** During controls-feel-pass Phase 2 verify-self, the agent's Playwright probe produced inconsistent roll-rate readings (107-150°/s mean / peak in one probe vs 179°/s in Vitest at the same physics state). Operator flagged Playwright's `dispatchEvent(new KeyboardEvent(...))` approach as unreliable for time-sensitive measurements. The Vitest test (`src/aircraft/roll-rate.test.ts`) is deterministic at the *physics-core* layer (bypasses controls.ts curve+ramp) but cannot exercise the full live in-game pipeline. The gap: there's no way to deterministically verify the *complete* in-game controls→flight pipeline (cubic curve + stickRate ramp + applyControls routing + physics step).
- **Proposed shape:** URL query-param scripted-input mode. Format suggestion: `?script=hold:KeyD@60:240` ("at game-tick 60, hold KeyD; release at tick 240"). Multiple scripts comma-separated. The game loop reads the script, applies key presses at the corresponding ticks (deterministic, no real-time scheduling), and records aircraft state per tick into a buffer accessible via `window.__aircraft.getScriptedLog()`. Playwright navigates the URL, waits for log completion, returns the structured log — no clicking, no race conditions.
- **Suggested action:** Schedule as a small task workflow when the next physics-feel-tuning need arises. Estimated 30-60 min: schema for the script string, a script-reader in `src/engine/` that hooks into the game loop and synthesizes key events at scheduled ticks, a log buffer exposed via `__aircraft` debug global, and one e2e test that uses it. Reusable infrastructure for all future controls/physics feel verification.
- **Why deferred from controls-feel-pass:** Vitest `roll-rate.test.ts` already codifies the physics-level acceptance criterion deterministically and is the load-bearing gate. The live in-game verification at Phase 2 is redundant given the Vitest gate; operator's verify-human covers the felt experience. Building the scripted-input mode now would scope-creep this feature.
- **Status:** pending

### SURFACE-2026-06-06-03 — Airframe has no aerodynamic roll-rate damping mechanism (no clP analogous to D17 clQ); terminal roll rate at full aileron equilibrates at ~550°/s with only weak β5-coupling damping
- **Source:** feature:build (controls-feel-pass Phase 2 verify-self, 2026-06-06)
- **Target level:** product:arch (new physics-mechanism layer analogous to D17 β4) OR product:wbs (if maxDeflectionRad cap proves sufficient at WP-feel-tuning level)
- **Type:** arch-mechanism-gap / flight-envelope / discovered by Vitest test `src/aircraft/roll-rate.test.ts`
- **Priority:** medium (deferred while controls-feel-pass Phase 2 attempts a maxDeflectionRad-cap workaround). Will become high if the workaround fails AND the operator wants tunable-roll-feel for combat WP16.
- **Summary:** D17 introduced β4 pitch-rate damping (`clQ`) and D16 introduced β5 AoA-rate damping (`clAlphaDot`), both as per-surface non-dimensional textbook forms. **Roll-rate damping (analogous β6, would conventionally be `clP`)** is absent from the codebase. Effect surfaced at controls-feel-pass Phase 2 verify-self: at full aileron deflection, terminal body-frame roll rate measured 550°/s in a deterministic Vitest harness (config from production aircraft.json). The agent's initial `inertia.z` 1500→6000 bump did not change this terminal — terminal is set by aileron-moment-vs-damping balance, not inertia. Inertia changes only the time to reach terminal. Operator's verify-human observation ("full rotation in <1s" = >360°/s) was correct; agent's Playwright probe misread sample-window as terminal when it was post-coupling.
- **Verified-by-test:** `src/aircraft/roll-rate.test.ts` (added at Phase 2 verify-codify attempt). Sign-convention anchors pass (+aileron → −angvel.z, −aileron → +angvel.z). Firm-gate assertion `sustained ≤ 200°/s` currently FAILS at 550°/s — load-bearing red until a roll-damping or moment-cap mechanism lands.
- **Hypotheses:**
  1. **Primary (workaround attempted in controls-feel-pass Phase 2 re-plan):** Cap `maxDeflectionRad` on wings (default 25° → ~10°) to reduce the moment at full input. Caps terminal rate but does NOT restore damping; transient response stays the same as before the cap (just at a lower terminal). This is a feel-knob, not a mechanism fix.
  2. **Proper fix (arch-level, deferred):** Add per-surface `clP?` field (β6 roll-rate damping) following the D17 pattern. Form: `cl += clP · ω_along_rollAxis · b / (2·max(V, V_REF))` where `b` is span (currently 4m moment arm × 2 = 8m wingspan). Schema-land WP + tune-deploy WP pair per CLAUDE.md Rule #6. Would be a real architect-level cycle.
- **Suggested action sequence:**
  1. controls-feel-pass Phase 2 attempts `maxDeflectionRad` cap as the operator-as-architect workaround per CLAUDE.md Rule #3 carve-out (gameplay feel override).
  2. If Phase 2 closes with operator-accept on the feel: SURFACE remains open at medium priority, deferred to a future arch cycle for the proper clP mechanism.
  3. If Phase 2 fails: SURFACE escalates to high; product:arch cycle on β6 roll-rate damping becomes the next action (likely after SURFACE-2026-06-06-02 pitch envelope which is also potentially β-coefficient-level).
- **Memory anchor that fired this discovery:** `feedback_browser_walkthrough_load_bearing.md` — fifth observation, but in a new variant: operator's qualitative observation refuted agent's quantitative measurement. Lesson candidate: **agent-side numeric measurements need a separate codification gate (Vitest harness) that's deterministic and unambiguous; Playwright sample-window readings are not authoritative for steady-state flight quantities** because the aircraft attitude can change during the sample window in ways that decouple body-frame measurements from world-frame observations.
- **Status:** pending

### SURFACE-2026-06-06-02 — Aerobatic envelope unreachable: cannot nose-dive or backflip at V_trim (probable cause: D17 β4 pitch-rate damping tuned for phugoid stability is over-damping aggressive pitch maneuvers)
- **Source:** feature:verify-human (controls-feel-pass Phase 1, 2026-06-06)
- **Target level:** product:arch (suspected) OR product:wbs (if confirmed isolated to JSON knob) — depends on diagnostic outcome
- **Type:** flight-envelope / arch-tension / physics-tuning
- **Priority:** **high — designated IMMEDIATE-NEXT after `controls-feel-pass` closes** (operator directive 2026-06-06). Blocks combat WP16 aerobatic gameplay; less critical for WP15 takeoff/landing which needs nose-down flare authority specifically, not full loop capability. **Sequencing note:** the (a)/(b) `clQ=0` diagnostic probe runs first as a task-workflow spike to confirm β4 is the cause; if confirmed, escalates to product:arch cycle on D17 mechanism; if refuted, falls to stall/AS hypothesis as a WP-level fix.
- **Summary:** Operator reported during controls-feel-pass verify-human Phase 1: "Why can't I nose-dive or backflip?" at `localhost:5173/?mission=free-flight&debug=true`. Pitch on full ↑/↓ hold reaches some limit short of a true nose-dive (sustained pitch ≤ −60°) or aerobatic loop.

  **Quick force-balance derivation (per CLAUDE.md Rule #5 plan-time physics derivation):** At V_trim=78, q = 3727 Pa. Full elevator (±25°) on h-stab (S=1.5, arm=3m) gives pitch moment ≈ 8385 N·m. Ixx = 1500 → angular accel ≈ 320°/s². Time to reach 90°/s pitch rate ≈ 280ms. **The pitch *authority* is fine.** What can suppress the pitch *rate* despite ample moment: D17 β4 pitch-rate damping (`clQ`). Production `aircraft.json` ships `clQ_wing = 1.83`, `clQ_hstab = 1.95` — tuned during D14→D27 cascade specifically to damp phugoid divergence. The same damping that stabilizes phugoid OPPOSES aggressive pitch maneuvers proportionally to pitch rate. This is the most likely cause.

  Secondary cause for loop specifically (not nose-dive): at V_trim=78 with T/W=0.61, the airframe may stall before completing inverted apex — stall is α-limited around 15-20° for symmetric-flat-plate; loops need either higher thrust or initiation at higher AS.

- **Ranked hypotheses (revised from initial filing):**
  1. **D17 β4 pitch-rate damping over-damped for aerobatic flight** — `clQ_wing=1.83, clQ_hstab=1.95` is tuned for phugoid stability. Real arch-tension: phugoid-stable AND aerobatic-capable may be at odds with current mechanism. **Validation:** Playwright probe `localhost:5173/?mission=free-flight&debug=true`, hold ↑ for 5s, sample pitch trace at: (a) production knobs (baseline), (b) `clQ=0` on both surfaces (control). If (b) achieves loop and (a) does not, β4 is the cause.
  2. **Stall + AS budget at loop apex** — even with β4=0, loops may fail because the airframe stalls or loses AS at the inverted apex. Validation: probe with `clQ=0` AND `thrust.maxN += 50%`. If pitch rate ramps but AS collapses, stall/thrust is the constraint.
  3. **H-stab `maxDeflectionRad` (default 25°)** — probably not the cause (force balance above suggests ample moment), but cheap to verify by bumping to 35° and re-probing.

- **Suggested action:**
  - **Step 1 (cheap):** Run the (a)/(b) diagnostic above before opening a WP. ~15 min Playwright probe. If β4 is confirmed as primary cause, the fix is NOT a one-JSON-knob change — it's an arch-level question of whether to add an α-rate-gated or pitch-rate-gated damping that suppresses *only the sustained low-frequency phugoid* and not the *high-frequency aerobatic input*. Possibly a frequency-domain filter on `clQ` or a Reynolds-/α-conditioned damping curve.
  - **Step 2 (conditional):** If diagnostic confirms β4 is the cause → escalate to product:arch (`/product-arch` cycle) — likely a new SURFACE-driven mechanism iteration on D17. If diagnostic confirms stall/AS is the cause → WP-level fix (bump `thrust.maxN` or add a stall-region CD softening to allow higher α before lift collapses). If `maxDeflectionRad` is the cause → trivial JSON bump.

- **Why NOT fixed in controls-feel-pass Phase 2 (the roll-rate phase that's about to start):**
  - **Single-knob discipline** per `feedback_surface_or_means_or.md` — roll-rate fix and pitch-envelope fix are orthogonal physics axes; bundling violates.
  - **Diagnostic uncertainty** — until the (a)/(b) probe runs, we don't know whether this is a JSON knob or an arch-mechanism question. If it's an arch question, it must NOT be smuggled into a feel-tuning task; it needs its own architect cycle per CLAUDE.md Rules #5/6.
  - **Phase 3 playtest re-validation hook (`feedback_operator_as_external.md`)** — under full-autopilot, deferring this is the documented path. The Phase 3 hook for both this AND the roll-rate fix is the same playtest session, so they can be validated together later.

- **Memory anchor that fired this verify:** `feedback_browser_walkthrough_load_bearing.md` (4th observation) — only live operator walkthrough surfaced this. No e2e probe checks aerobatic envelope.
- **Status:** pending

### SURFACE-2026-06-06-01 — Default keymap binds pitch to ArrowUp/ArrowDown instead of W/S (operator expects WASD as unified flight stick)
- **Source:** task:act (controls-feel-pass T1, 2026-06-06)
- **Target level:** task (one-line edit to `DEFAULT_KEY_MAP` in `src/engine/input.ts`)
- **Type:** UX-papercut / default-keymap
- **Priority:** medium (operator reported "W and S doesn't work" during T1 feel-check — they expected WASD as the unified stick like most modern flight games)
- **Summary:** `src/engine/input.ts:15-27`'s `DEFAULT_KEY_MAP` binds `pitchUp: 'ArrowUp', pitchDown: 'ArrowDown'`, with roll on A/D. Most modern flight-sim and game players expect W/S = pitch, A/D = roll (WASD as the unified flight stick) with arrows as alternates. Operator hit this at the controls-feel-pass T1 feel-check and reported "W and S doesn't work" — the controls aren't broken, the default binding is unconventional.
- **Suggested action:** Rebind `pitchUp: 'KeyW', pitchDown: 'KeyS'` in `DEFAULT_KEY_MAP`. Update `src/aircraft/controls.test.ts` references if any test asserts on the old default. Could optionally retain ArrowUp/ArrowDown as alternates by extending `KeyMap` to support arrays, but that's a bigger schema change — defer unless requested.
- **Why deferred from controls-feel-pass:** Per `feedback_surface_or_means_or.md`, the parent task picked ONE knob (cubic input curve for stick sensitivity). The keymap fix is orthogonal and ships as a separate one-commit task.
- **Status:** pending

### SURFACE-2026-05-24-05 — Search-vs-deploy parity-diff under `--link`: optimizer-internal evaluation produces score 1.50× more negative than `score-deployed.mjs` re-score at bit-identical params
- **Source:** feature:build (WP14.14 Phase 1, 2026-05-24)
- **Target level:** product:wbs (tooling fix or methodology investigation; not arch-layer because the underlying harness is deterministic per-call — md5-stable CSVs at re-runs — and the divergence is between two presumably-equivalent evaluation paths)
- **Type:** tooling-bug / methodology-gap / parity-diff
- **Priority:** medium (diagnostic concern, not blocking; the `--link` flag's "search-airframe = deploy-airframe" claim is slightly less load-bearing than the D20 architect cycle assumed; future tune WPs need to re-validate the ratio is 1.0 OR derive deployment scores via `score-deployed.mjs` explicitly)
- **Summary:** At WP14.14 globalBest knobs (deterministic per harness invocation — `md5sum` stable across re-runs), the optimizer's reported `score=−2,999,996,805` vs the `score-deployed.mjs` total at the dumped CSVs `−2,003,066,074`. **Ratio = 1.497×.** Under `--link surfaces.0.*=surfaces.1.*` the optimizer's evaluation airframe should be bit-identical to the deployment airframe at the same params, and the score functions are identical (`score-deployed.mjs` imports `score.ts` directly), so the ratio should be exactly 1.0. The 1.50× deviation indicates one of: (a) the optimizer evaluates at a *different* simplex vertex than the one stored as `finalParams[bestIdx]` (off-by-one in optimizer.ts:310–311), (b) the optimizer's internal `runHarness` invocations share some state (Rapier world singleton? RNG sequence?) that the fresh dump-script's `runHarness` does not, or (c) the `--link` expansion in `buildObjective` produces a slightly different `params` array than the explicit `surfaces.1.*` overrides in the dump script (e.g. ordering or precision-of-string-conversion in `params.push(${k}=${v})`).
- **Evidence:**
  - Optimizer-reported score at globalBest: −2,999,996,805 (from `tools/tune/results/wp14.14-linked-widened-tune.json` → `.score`)
  - Dump-script CSVs at same globalBest: deterministic (md5 stable across 2 re-runs); per-regime firstNaN ticks: low=1123, mid=none, high=1712
  - Deployed score at CSVs: −2,003,066,074 (from `npx tsx tools/tune/score-deployed.mjs ...`)
  - Ratio computation: 2,999,996,805 / 2,003,066,074 = 1.497
- **Hypothesis ranking:**
  1. **Most likely:** `buildObjective` constructs the `params` array differently from `dump-wp14.14.mjs`. Both invoke `runHarness({ ..., params })`, but `buildObjective` passes the optimizer's normalized simplex-vertex floats, while the dump script passes JS Number.toString() of the stored params from JSON. If the storage→load roundtrip loses precision (e.g. `2.4355146341348983` → ... → `2.4355146341348983` survives `JSON.parse`, but the harness may parse `${k}=${v}` strings that hit `parseFloat` differently than the original Float64). Worth checking via a unit-test that the params array matches bit-for-bit.
  2. **Secondary:** Off-by-one in `optimizer.ts:310-311` — `simplex[bestIdx]` and `scores[bestIdx]` index into different generations. Read the optimizer history at the final restart: does the trace's last `bestScore` match `scores[bestIdx]` against `simplex[bestIdx]`?
  3. **Tertiary:** Harness-state-leakage. Check `createPhysicsWorld()` for any module-scoped state; check `runHarness` for any cached state that survives across calls.
- **Suggested action:**
  1. Write a Vitest case that calls the optimizer with `--restarts 1 --seed 42` and small bounds, then re-evaluates `runHarness` at the returned `finalParams[bestIdx]`. Assert the returned `score` matches the re-evaluation within 1e-6 relative.
  2. If the test fails: ranked-hypothesis investigation per above.
  3. If the test passes: the parity-diff is something else (config-file caching? read of `public/config/aircraft.json` differing between optimizer process and dump-script process?). Worth checking that `runHarness` reads the same `aircraft.json` content in both contexts.
- **Why medium priority:** the ratio of 1.50× is not 1.0 but is also not the 10,000× of pre-tooling-fix asymmetric search. The optimizer's score is still a usable proxy for branch decisions (Branch B was clear at either −2.003e9 or −2.999e9 — both saturate the threshold). The methodology-fix at `tune-cli-link-flag` is mostly load-bearing; the residual 1.50× is a methodology gap that needs further investigation but doesn't invalidate the cascade's evidence base.
- **Memory anchor that fired this WP:** `feedback_tune_cli_search_vs_deploy.md` (all four uses) — the rule "always re-score the deployed config via `score-deployed.mjs`" was load-bearing at WP14.14 P1.4. Without it, WP14.14 would have reported −2.999e9 as the deployed score and the architect-cycle interpretation would have missed the partial-success in the mid regime (visible only via per-regime breakdown of the deployed CSVs, not the optimizer's aggregate score). The rule's *practical value* survives the parity-diff bug; the rule's *theoretical foundation* (`--link` makes search = deploy) is the part that needs the fix.
- **Status:** open
- **Blocks:** nothing (diagnostic concern; future tune-pass WPs should keep using `score-deployed.mjs` as the binding gate while this parity-diff is investigated)

### SURFACE-2026-05-24-02 — Axis-naming error in arch.md Revision 2026-05-23 line 800 + propagation through SURFACE-23-01 and SURFACE-24-01 prose ("Iyy" used where "Ixx" is the pitch-axis inertia in our Y-up convention)
- **Source:** product:arch (D19 architect cycle, 2026-05-24 — Rule #5 plan-time derivation catch)
- **Target level:** docs (arch.md prose correction + backlog SURFACE-23-01/24-01 status notes; non-binding for any active WP)
- **Type:** docs-errata / sign-convention-misnaming
- **Priority:** low (non-blocking for D19 cascade; the D19 revision explicitly notes the error and re-anchors to Ixx; cleanup is a future-revision doc fix)
- **Summary:** arch.md Revision 2026-05-23 line 800 reads "Inertia tensor (SURFACE rank 2). Symptomatic, not causal. Iyy=3000 vs Cessna-class ≈1346 is ~2.2× heavy." This mis-names the pitch-axis inertia: in this project's right-handed Y-up convention, pitch is rotation about body X (confirmed by `src/aircraft/stability.test.ts:94` and `src/aircraft/physics-core/flightmodel.test.ts:214`), so the pitch-axis inertia is `inertia.x = Ixx`, not `inertia.y = Iyy`. Cessna 172's pitch-axis inertia in NASA-aero convention (Z-down) is Iyy ≈ 1346 kg·m²; mapped into our Y-up convention that becomes Ixx ≈ 1346. Current `aircraft.json` has `Ixx=1500` (already Cessna-class — only 1.11× heavy) and `Iyy=3000` (yaw inertia in our convention, 1.64× a Cessna's yaw inertia). The error propagated into SURFACE-2026-05-24-01's "halve Iyy 3000→1500" primary candidate prose, which the D19 architect cycle (2026-05-24) re-derived per CLAUDE.md Rule #5 and chose NOT to adopt (the inertia candidate is mis-anchored AND has weak causal mechanism for the airspeed-overshoot symptom; D19 picks bound-widening as the highest-leverage single option instead).
- **Suggested action:**
  1. Correct arch.md Revision 2026-05-23 line 800: replace "Iyy=3000 vs Cessna-class ≈1346 is ~2.2× heavy. Halving Iyy speeds the phugoid period by `√2 ≈ 1.41×`" with "In our right-handed Y-up convention, pitch is about body X, so pitch-axis inertia is `Ixx=1500` (not `Iyy`). Current Ixx is already Cessna-class (Cessna 172 pitch inertia ≈ 1346 kg·m² in NASA convention, mapping to our Ixx). `Iyy=3000` is yaw inertia in our Y-up convention, which doesn't directly couple to the airspeed-overshoot symptom."
  2. Update SURFACE-2026-05-24-01's "Recommended next architect cycle" prose to note: candidate #1 (inertia-tensor revision) was re-derived at the D19 architect cycle and (a) is mis-anchored on Iyy vs Ixx, (b) has weak causal mechanism for the airspeed-overshoot symptom; D19 chose bound-widening as the highest-leverage option instead.
- **Why low priority:** The arch.md D19 revision (Revision 2026-05-24) explicitly documents the error and re-anchors. No active WP depends on the corrected prose. Cleanup is opportunistic.
- **Memory anchor that fired this WP:** CLAUDE.md Rule #5 (plan-time physics derivation precedes spec-text reading) — this is the first time Rule #5 has fired at the *architect-cycle* stage, catching a SURFACE-IN author's primary-candidate recommendation. Prior firings caught spec errata at *implementation* stage (β-AoA sign convention, D15 layer ambiguity, D17 cross-product order). Lesson candidate (NOT yet persisted to memory pending a second observation per `feedback_memory_active_recall.md` discipline): the SURFACE-IN author's "Recommended next architect cycle" section is a *suggestion*, not a *binding*; the architect-cycle side must independently derive its choice. Defer memory write until a second firing confirms the pattern.
- **Status:** open
- **Blocks:** nothing (non-blocking doc fix)

### SURFACE-2026-05-17-02 — arch.md D17 dampAxis cross-product order is sign-inverted vs textbook damping convention
- **Source:** feature:build (WP14.9b Phase 1, 2026-05-17)
- **Target level:** product:arch (D17 errata — single-character fix to literal spec text)
- **Type:** arch-errata / sign-convention
- **Priority:** medium (cosmetic — implementation already proceeds with the corrected sign per CLAUDE.md Rule #1 live-derivation; arch.md prose just needs to match what the code does)
- **Summary:** arch.md D17 (Revision 2026-05-17) and the WP14.9b WBS entry both specify `dampAxis = (position × normal).normalized()`. By right-hand rule on the canonical h-stab (`position=(0,0,3), normal=(0,1,0)`), this gives `(−1, 0, 0)` = anti-pitch axis. The textbook β4 damping convention requires `dot(angular_velocity, dampAxis) · clQ > 0` for damping in the moment direction (positive pitch rate × positive clQ → positive ΔCL → upward force at aft surface → nose-down moment → damps the pitch). With the literal arch.md order, `dot((1,0,0), (−1,0,0)) = −1`, so ΔCL is negative — that's ANTI-damping (amplifies the +pitch rate). The corrected order is `(normal × position)`, giving `(+1,0,0)` = +pitch axis = correct damping sign.
- **Verified across all 3 surface types under the corrected order:** h-stab → +X (pitch damping); wing-right → −Z (anti-roll damping when right wing goes down on +roll); wing-left → +Z (opposite, correct); v-stab → primarily −Y (yaw-damping direction).
- **Evidence:** WP14.9b Vitest run after attempt-1 implementation with literal arch.md sign: `positive clQ amplifies rotation-induced airflow → larger damping force on rotating body` failed at line 868 (dampedY < undampedY because ΔCL was reducing total CL, not adding to it). After flipping the cross-product order in code, behavior aligns with the test's expectation.
- **Suggested action:** arch.md D17 prose update (single-character fix: `(position × normal)` → `(normal × position)` in lines ~697-700 of `docs/product/arch.md` AND in the Risk 3 v-stab derivation example). WP14.9b WBS entry has the same literal text — update both. The dampAxis field-doc in `aerosurface.ts` already records the deviation + reasoning. No code change needed beyond what WP14.9b already shipped.
- **Status:** open
- **Relationship to other SURFACEs:** This is a sub-finding of the broader D17 cascade — it does NOT block WP14.9b close (the code is correct; only the arch prose needs updating). Closes when the arch.md errata commit lands.

### SURFACE-2026-05-16-03 — arch.md §D14.4 NaN-penalty formula has wrong sign vs stated intent
- **Source:** feature:build (WP14.8 Phase 1, 2026-05-16)
- **Target level:** product:arch (doc-typo level — one character)
- **Type:** doc-bug / arch-text-typo
- **Priority:** low (does not affect any code; intent is unambiguous and was followed)
- **Summary:** arch.md §D14.4 literally writes the NaN penalty as `-1e9 - tick_of_first_NaN` while the surrounding text says "Higher is better" AND "the optimizer can move *toward* later-NaN regions" (prefer-failing-later). Under higher-is-better, `-1e9 - tick` makes EARLIER NaN score higher (better), which is the opposite of the stated intent. The correct formula honoring the intent is `-1e9 + tick_of_first_NaN`. WP14.8 Phase 1's `tools/tune/score.ts` implements the intent-correct formula; the file header documents the discrepancy.
- **Suggested action:** One-character edit to arch.md §D14.4 — change `-1e9 - tick_of_first_NaN` to `-1e9 + tick_of_first_NaN`. No code change needed (score.ts already correct).
- **Verification approach:** N/A — text edit.
- **Status:** pending

### SURFACE-2026-05-16-02 — Wall-clock perf assertion in `flightmodel.test.ts:368` is load-flaky
- **Source:** feature:verify-codify (WP14.7 Phases 1/2/3, 2026-05-16)
- **Target level:** task (small test-refactor)
- **Type:** test-design / flake
- **Priority:** low (does not affect ship readiness; full-suite reliably passes within 1-3 runs; pre-existing — not introduced by any WP14.7 change)
- **Summary:** The Phase 1 codify cycle, Phase 2 codify cycle, and Phase 3 verify-self cycle all observed at least one failure of `src/aircraft/physics-core/flightmodel.test.ts:368` (`expect(elapsed).toBeLessThan(50)` after 1000 `applyForces` calls). Failure values were ~50.8ms, ~52.0ms — 1.6%-4% over a 50ms wall-clock threshold. The same test passes 19/19 in isolation consistently; the flake only manifests under full-suite parallelism. Triaged each occurrence as load-induced under the codify discipline; no code or test modification was made (triage hard rule). No occurrence affected ship — every full-suite run that flaked was followed by a clean re-run.
- **Update 2026-05-16 (WP14.8 Phase 3 codify):** Worst-case sustained-flake run observed — 3 consecutive full-suite failures at 86.68ms / 79+ms (vs the prior 50-75ms range), then a 4th full-suite run came back 516/516 green. Isolation run of the same test consistently passes in ~38ms (well under the 50ms threshold). The widened tail confirms the flake is system-load-induced — running multiple `npm run test` invocations in close succession during a single agent session can stack CPU contention. **Action recommendation reaffirmed:** option (a) relative-baseline rework or option (b) move to a perf-only invocation. Priority remains low but the heavier-tail observation suggests the fix should land sooner than later if codify cycles continue to take 4+ retries.
- **Suggested action:** rework the perf assertion. Two reasonable shapes:
  - **(a) Relative baseline:** measure a known-cheap reference op (e.g. 1000 empty `for` iterations) at the start of the test, scale the threshold proportionally. Removes the absolute wall-clock dependency.
  - **(b) Move to a perf-only test invocation:** tag the test with a Vitest tag like `@perf` and exclude from `npm run test`; run only via `npm run test:perf`. Keeps the regression signal for explicit perf-monitoring runs without flaking CI.
- **Rationale for low priority:** the flake is observed about 1 in 3 full-suite runs and is always resolved by a single re-run. It does not block any feature. The perf-proxy intent (catch a regression that would 10× the per-tick cost) is still useful but a 50ms threshold at 1000 calls = 50 μs/call is too tight a margin for wall-clock measurement on a loaded CPU.
- **Status:** pending

### SURFACE-2026-05-12-02 — Test-only probe missions are listed on player-facing mission-select
- **Source:** task:act (WP14.5 T1, 2026-05-12)
- **Target level:** feature:plan (small UX cleanup) or task
- **Type:** test-fixture / UX-papercut
- **Priority:** low
- **Summary:** The three `phugoid-probe-{low,mid,high}` JSON files (test fixtures for WP14.5's ≥30s probe) had to be added to `public/missions/index.json` because `src/main.ts:353` gates `?mission=<id>` deep-link auto-start on manifest membership (`missionManifest.some(m => m.id === requestedMissionId)`). They now appear on the mission-select screen alongside Free Flight and Waypoint Patrol.
- **Context:** Two clean fixes possible — (a) make the deep-link permissive: drop the manifest check, try to load the JSON directly, show error screen on fetch failure (the load already has the error path); (b) add a `hidden?: boolean` field to manifest entries and filter on render. Option (a) is smaller and also enables direct-URL access to any mission JSON that exists, which is useful for dev/test. Option (b) preserves manifest-as-allow-list discipline. Don't pick until someone asks.
- **Suggested action:** Pick (a) or (b) after WP14.5 is closed; tiny task workflow.
- **Status:** pending

### SURFACE-2026-05-11-02 — β1+β4 stable state is a descending glide, not level cruise (parameter-tuning gap)
- **Source:** feature:build (WP6.5 Phase 3 verify-self, 2026-05-11)
- **Target level:** product:wbs (WP7 Phase E retune — already paused and queued)
- **Type:** parameter-tuning / feel
- **Priority:** medium (load-bearing for WP9 verification: "developer takes off, flies around, crashes" needs an aircraft that can hold airspeed)
- **Summary:** With wings incidenceRad=+2°, h-stab incidenceRad=-1°, wings clQ=3, h-stab clQ=8, the airframe is dynamically stable (max|pRate|=149°/s, no tumble). But airspeed bleeds 30→2 m/s and altitude trends 50→33m within the 6s observation window. The system is in a low-energy descending glide because at mass=1000 kg, spawn airspeed v=30 m/s, and zero throttle, lift is only ~14.8% of weight. Force balance for level flight requires v≈90 m/s OR baseline throttle ≈ 0.4 OR reduced mass.
- **Context:** WP6.5 closed the *architectural* gap (no level-trim equilibrium / dynamic instability). The remaining "feels like flight" tuning is exactly WP7 Phase E's job. WP7 was already paused awaiting WP6.5; it now resumes with a clean stable baseline to tune against.
- **Suggested action:** At WP7 Phase E entry: experiment with (a) baseline `throttle = 0.4` at spawn (cheapest — `Controls` class might need a constructor option), (b) `mass = 500–700 kg` (changes ground feel), (c) `area = 9–10 m²` per wing (changes visual feel of wing size). Iterate via lil-gui live; export preset to `aircraft.json` when it feels right. The strong physical priors (incidence 0–4°, clQ 0–16, lift/weight ratio ~1 at cruise speed) make this a bounded search — likely 1–2 lil-gui sessions.
- **Status:** WP7 Phase E disposition 2026-05-11 — the "level cruise" goal is **not closable within Phase 1 scope** due to SURFACE-2026-05-11-04 (phugoid undamped). Phase E shipped option (c) (accept descending glide). This entry stays open as a candidate for Phase 2 if the casual-player feel-check (Phase F AC #7) rejects the descending glide as unplayable.

### SURFACE-2026-04-19-01 — Bundle size: Rapier WASM dominates build
- **Source:** feature:build (WP1 verify-auto)
- **Target level:** product:arch or feature (Phase 3 polish)
- **Type:** perf / tech-debt
- **Summary:** The first production build clocked in at ~2.7 MB unminified / ~978 KB gzipped — above Vite's default 500 KB warning threshold. Dominated by Rapier WASM which is currently bundled inline.
- **Context:** Relates to R1 in research.md (WASM load UX). At 978 KB gzipped, first-load on a mid-range connection is meaningful. WP18 (onboarding) already plans to preload WASM in parallel with splash — this is the mitigation. No action needed before Phase 3.
- **Suggested action:** Leave as-is for Phase 1/2. At Phase 3 WP18/WP21, measure real load time and consider: (a) code-splitting Rapier via dynamic import, (b) loading WASM from `@dimforge/rapier3d-compat`'s external `.wasm` file instead of inlining.
- **Priority:** low (tracked, not urgent)
- **Status:** pending

## Resolved

### 2026-05-25 cascade close — 16 SURFACEs resolved at WP14.19 ship (commits `46f9b42` integrator fix + `b69d267` D27 arch + `5ad9e7f` D27 impl + `eafc91e` ship)

All 16 SURFACEs below closed-by-WP14.19 ship Branch B-accept (deployed -7,287; 3 mission types coherent at V_trim spawn; cascade behavioral + structural close). The full content of each entry remains accessible via `git log -- workflow/backlog.md` if archeology is needed; one-line closures here:

- **SURFACE-2026-05-25-03 (D27 driver, recency-bias):** Closed by mission JSON spawn AS update to V_trim=78 in all 5 mission files (`public/missions/phugoid-probe-{low,mid,high}.json` + `free-flight.json` + `waypoint-patrol.json`); 3 browser walkthroughs confirm coherent V_trim flight; CLAUDE.md Rule #9 scope extended.
- **SURFACE-2026-05-25-02 (D26 driver, bound-pressure-as-clean-widen):** Closed by D26-β per-regime `altEnvelope: {low:100, mid:50, high:200}` in `tools/tune/score.ts`; the 88% `inducedDragK_wing` bound-pressure was a side effect of high-regime climb-suppression — D26-β eliminated the structural cause; optimizer no longer pushes the bound.
- **SURFACE-2026-05-25-01 (D25 driver, score-function envelope mis-calibration):** Closed by D25-ζ uniform spawn AS=78 + score-function reversion to all-level-cruise (target=78 uniform; AS_ENVELOPE 25→30); CLAUDE.md Rule #9 amended to remove D24's erroneous "at the fixture's throttle" qualifier.
- **SURFACE-2026-05-24-09 (CRITICAL, integrator-fix root cause):** Behavioral close at WP14.19 ship `eafc91e`. Architectural close was at task `fix-resetforces-bug` commit `46f9b42` (Rapier per-tick force accumulator: `body.resetForces(true) + resetTorques(true)` added before `applyForces`). CLAUDE.md Rule #7 (per-tick energy-budget sanity check) codified post-fix.
- **SURFACE-2026-05-24-08 (D23 refutation):** Superseded-by-SURFACE-09; the c0-floor cluster the WP14.18 tune saw was integrator-pathology-driven; collapsed to 0/4 under fixed integration at WP14.18b re-tune.
- **SURFACE-2026-05-24-07 (D23-α/β refutation, D23 cycle driver):** Closed-by-cascade-walk-back; D23-γ-evolved mode dispatch was correct for the broken-integrator era but D25 reverted to all-level-cruise once integrator + spawn AS were correct.
- **SURFACE-2026-05-24-06 (D22 cycle driver, drag bounds):** Closed-by-cascade-walk-back; D22's drag bounds revision was integrator-pathology-driven; under fixed integration the gaming corner vanished.
- **SURFACE-2026-05-24-04 (D20 refutation, attempt-3 escalation):** Closed-by-cascade-walk-back; D20 bound-widening was integrator-pathology-driven; the empirical optimum sits near WP14.13 bounds under fixed integration.
- **SURFACE-2026-05-24-03 (D19 widened-bounds refutation, tooling-fix driver):** Closed-by-cascade-walk-back; the search-vs-deploy 0.67× ratio was integrator-pathology-driven; `--link` tooling fix at task `tune-cli-link-flag` is retained.
- **SURFACE-2026-05-24-01 (D18 insufficient, inertia revision candidate):** Closed-by-cascade-walk-back; D18 drag polar IS shipped at WP14.19 D26-β globalBest; the "insufficient" verdict was integrator-pathology-driven.
- **SURFACE-2026-05-23-01 (third-mechanism-layer needed, D18 driver):** Closed-by-cascade-walk-back; D18 drag polar IS the third mechanism layer and IS shipped in production aircraft.json at WP14.19 ship; the "no flyable point" verdict was integrator-pathology-driven.
- **SURFACE-2026-05-17-03 (D17 empirical stable clQ region narrower than textbook):** Closed-by-cascade-walk-back; clQ values at WP14.19 globalBest are within the empirical stable region; arch.md Rule #2 clarification at WP14.9b post-mortem stands.
- **SURFACE-2026-05-17-01 (D15 Form A insufficient):** Closed-by-cascade-walk-back; D17 superseded D15; β4 non-dimensional form is the surviving mechanism, shipped at WP14.9b commit `0df9a07`.
- **SURFACE-2026-05-16-04 (β5+β4 NaN-poisoned joint space):** Closed-by-cascade-walk-back; the NaN-poisoning was integrator-pathology-driven; under fixed integration β4+β5+D18 joint space is finite (Vitest 592/592 + e2e 15/15 confirm).
- **SURFACE-2026-05-16-01 (β4 explicit-Euler instability):** Closed-by-cascade-walk-back; D17 non-dimensional form is V-scaled and stable above V_REF; shipped at WP14.9b.
- **SURFACE-2026-05-12-03 (β5 mechanism diverges at any tuning value):** Closed-by-cascade-walk-back; D16 non-dimensional form (parallel to D17) ships at WP14.10 commit `27324aa`; under fixed integration converges.
- **SURFACE-2026-05-12-01 (Phase 2 waypoint missions need non-zero clAlphaDot):** Closed-by-cascade-walk-back; aircraft.json now ships D26-β globalBest with non-zero clAlphaDot wing+hstab; waypoint-patrol mission verified coherent at V_trim=78.
- **SURFACE-2026-05-11-04 (Phugoid undamped at Phase 1 airframe):** Closed-by-cascade-walk-back; β4 + β5 + drag polar (D17+D16+D18) at D26-β globalBest in production aircraft.json damp the phugoid mode coherently; observable at `localhost:5173/?mission=phugoid-probe-mid&debug=true` (alt 50→108→0 over 30s).
- **Status:** resolved 2026-05-25

