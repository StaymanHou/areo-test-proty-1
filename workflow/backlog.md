# Backlog

Surface-notes from workflow runs. Consumed and resolved by higher-level workflows (arch revisions, new WPs, etc.).

## Open

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

### SURFACE-2026-05-09-01 — End-to-end browser test infrastructure not configured
- **Source:** feature:verify-codify (WP6 Phase 4)
- **Resolution:** Resolved by WP9.6 (2026-05-11). Adopted `@playwright/test` as a devDependency; minimal config at `playwright.config.ts` (Chromium-only, webServer auto-starts `npm run dev`, retries=0, workers=1, list reporter). Single load-bearing smoke test at `tests/e2e/casual-flight.spec.ts` — loads `/?debug=true`, waits for `window.__aircraft` to be defined, simulates 5s, asserts via `__aircraft.getState()` that `position.{x,y,z}` and `airspeed` are finite, `airspeed > 0` (aircraft moving), aircraft moved from spawn within loose bounds, and no `NaN`/`Infinity` in console or `pageerror` events. Doubles as the regression anchor for SURFACE-2026-05-11-05 (collider fix). New npm script `npm run test:e2e`. Vitest's exclude updated (`vitest.config.ts` created with `tests/e2e/**` excluded) to prevent Vitest/Playwright glob collision. CLAUDE.md "Testing" section updated.
  - **Cross-browser deferred to WP21** (Phase 3 polish) per the original re-target plan.
  - **Suite is intentionally tiny** (one test, one assertion cluster) to avoid the "Playwright tests are flaky" anti-pattern.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-11-05 — Aircraft has no collider; tunnels through terrain and NaN's the simulation under any non-trivial input
- **Source:** feature:build (WP9 Phase 3 operator-as-tester probe, 2026-05-11)
- **Resolution:** Resolved-with-test by WP9.5 (2026-05-11). One-line addition in `src/aircraft/rigidbody.ts` constructor: `world.createCollider(ColliderDesc.cuboid(0.5, 0.3, 3.0).setDensity(0), this.body)` — matching the fuselage placeholder geometry (`BoxGeometry(1, 0.6, 6)`). `setDensity(0)` keeps the existing `setAdditionalMassProperties` configuration authoritative (otherwise the collider's auto-computed mass would stack on top).
  - **Test coverage:** two new tests in `src/aircraft/rigidbody.test.ts` — (1) structural anchor "attaches at least one collider to the body so it can interact with terrain" (`numColliders() > 0`), (2) behavioral integration "aircraft body collides with a static ground plane (does not tunnel through)" (creates a Rapier world with a static ground collider, drops the aircraft from y=3 with vy=-10, steps 60 ticks, asserts final y > 0). Total 246/246 tests green; tsc clean.
  - **Verification (verify-self):** targeted teleport-to-ground probe via Playwright-MCP — body to y=3 with vy=-10, observed impact at t=0.3 (alt=0.28m, vy reversed to +0.30), then bounded bouncing motion in 1.5–6.4m range. `anyNaN=false`, `collisionDetected=true`. Long-horizon no-input 30s also clean.
  - **Lesson captured (verify-self method):** the original WP9 Phase 3 regression-anchor probe (the gentle casual-input session) was over-broad. It exercised BOTH the tunneling pathology this WP fixes AND the SURFACE-2026-05-11-04 phugoid-divergent-under-forcing pathology that's explicitly out-of-scope. Running it post-fix produced a misleading FAIL signal because the now-stable aircraft climbs to ~110m where it hits the unrelated divergent mode. The targeted teleport probe isolates the collider's contract directly. **General lesson candidate for `/session-store-learning`:** when a regression-anchor exercises multiple defect zones, isolate each zone with a targeted probe; broad probes mask success on one fix when a different defect lights up.
  - **Codified regression anchor:** WP9.6 (2026-05-11) added `tests/e2e/casual-flight.spec.ts` — a `npm run test:e2e` smoke that watches `window.__aircraft.getState()` for 5s and fails on NaN/Infinity. This is the durable regression-anchor for the collider fix; the targeted teleport probe served as the one-shot verify-self proof.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-09-05 — Phase 4 verify-self required WP7 trim to fully validate (resolved by disposition)
- **Source:** feature:build (WP8 Phase 4 verify-self back-loop, 2026-05-09)
- **Resolution:** Closed-by-implementation 2026-05-11 at WP7 finalize. The original surface expected a WP7-committed-tuned-preset (level cruise) to enable sustained-frame observation of WP8's deferred outcomes (`horizon-tilt-after-roll`, `tower-parallax-on-approach`). WP7's actual disposition was option (c) — ship the WP6.5 baseline (descending glide) unchanged — because the phugoid is undamped (SURFACE-2026-05-11-04) and no single-knob tune produces a usable long-horizon cruise. The descending-glide trajectory IS observable for 6+ seconds before significant altitude loss, which proved sufficient for WP8's Phase F verify-self outcomes during the WP7 verify-self subagent run (multiple successful long-horizon Playwright probes documented in the WP7 archive). The two-way dependency the surface noted is now moot. If WP9 finds that the descending-glide trajectory IS still too short for some cross-browser observation, the right path is to use the `?debug=true` paused state (the debug GUI has a "Pause physics" toggle) for any sustained-frame visual check, not a tuning fix.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-09-03 — `window.__aircraft` debug telemetry hook
- **Source:** feature:build (WP7 Phase E tuning session, 2026-05-09)
- **Resolution:** Implemented in `src/main.ts` inside the existing `if (debug)` block during the Phase F back-loop diagnosis (2026-05-10). Adds: a `Telemetry` lil-gui folder with read-only displays for altitude/airspeed/vertical speed/pitch/roll/yaw + their rates; a `window.__aircraft` global exposing `{ body, flightModel, getState() }`; a 100 ms `[tel f=N]` `console.log` line carrying the full kinematic state. Gated on `?debug=true`. Used heavily and successfully as the verify-self mechanism for WP6.5 and WP6.6 — the back-loop diagnosis tooling became the project's primary aero-physics observability infrastructure. No tests written (debug-only helper). Surface closed retroactively during WP6.6 task-close (2026-05-11) on the observation that it had been silently providing service for two work-packages.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-11-03 — β1+β4 stability margin is not robust to airspeed (damping ratio collapses as V grows)
- **Source:** feature:build (WP7 Phase E retune, 2026-05-11)
- **Resolution:** Resolved-with-test by WP6.6 (2026-05-11). One-line change in `src/aircraft/aerosurface.ts` `computeAeroForce`: replaced the airspeed-independent `(1 + clQ)` β4 amplification on `(ω × r)` with `(1 + clQ · max(v, V_REF) / V_REF)` where `v = |bodyState.linvel|` and `V_REF = 30 m/s`. The `max(v, V_REF)` floor preserves WP6.5's low-V β4 calibration bit-for-bit (the formula reduces to `(1 + clQ)` for all v ≤ V_REF — exactly matching pre-fix); above V_REF the amplification grows linearly with v so the damping moment scales as V², matching the V² growth of the destabilizing pitch moment from `incidenceRad`. No 1/V singularity. Schema unchanged (`clQ` keeps its meaning).
  - **Test coverage:** two new regression anchors in `src/aircraft/aerosurface.test.ts` — one asserting the high-V growth branch (`yHigh > yRef` at v=60 vs v=30), one asserting the low-V floor doesn't blow up (forces at v=5,10,20,30 are all finite and bounded). Existing β4 default-zero-parity and sign-convention tests preserved unchanged. Total 244/244 tests green, tsc clean.
  - **Verification:** two Playwright-MCP verify-self trajectories at `?debug=true`:
    - Trajectory A (low-V regression, spawn linvel z=-30): output bit-identical to the pre-fix WP6.5 baseline (max|pRate| ≤ 110°/s, bounded ±30° pitch). The floor branch does its job — no behavior change in the WP6.5 regime.
    - Trajectory B (high-V probe, spawn linvel z=-90, 3·V_REF): max|pRate| = 390°/s (single transient at f=64 during near-stall recovery, surrounding frames ≪ 360°/s), airspeed bounded < 70 m/s, no NaN, no gimbal flips. **Dramatic improvement vs the pre-fix high-V failure modes:** the previous Run A (mass=700, thrust=8000, throttle=0.4) collapsed to NaN at f=54 (airspeed 845 m/s); the previous Run B (WP6.5 baseline + throttle=0.4) produced max|pRate|=1766°/s with ±90° pitch flips. The post-fix Trajectory B has max|pRate| ~4.5× lower than pre-fix Run B, ~3e8× lower than pre-fix Run A, and is bounded throughout.
  - **Residual:** ±50° pitch oscillation at high-V is parameter-tuning territory (precisely WP7 Phase E's job). The architectural goal — "make β4 damping work across the V envelope so tuning can take over" — is met.
  - **Lessons captured:** the initial implementation (no floor: `1 + clQ · v / V_REF`) regressed low-V by shrinking amplification below the WP6.5-calibrated `(1 + clQ)` baseline. When a fix targets an asymmetric problem (here: only high-V was broken), write the formula to be a no-op in the unaffected regime, not a redistribution across both. Caught by Trajectory A retest before commit.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-10-02 — Phase 1 airframe has no level-trim equilibrium (architectural) + SURFACE-2026-05-11-01 — β1 alone is dynamically unstable
- **Source:** feature:build (AoA sign-convention fix Phase 2 verify-self, 2026-05-10; deepened in static-margin geometry fix attempt, 2026-05-10; β1-alone divergence finding 2026-05-11)
- **Resolution:** Resolved-with-test by WP6.5 (2026-05-11). Two-phase implementation:
  - **β1 (`incidenceRad`)** per arch.md Revision 2026-05-11 / D10 — per-surface mount angle gives the airframe a level-trim equilibrium. Wings +2°, h-stab −1°, v-stab 0.
  - **β4 (`clQ`)** per arch.md "Fallback path" hedge — per-surface pitch-rate damping amplifies the natural ω×r damping mechanism by `(1 + clQ)`. Wings clQ=3, h-stab clQ=8, v-stab clQ=0. No 1/V singularity (a key correction over the prior abandoned attempt's standard `cl_q · c̄ / (2V)` form, which NaN'd at low airspeed).
  - **Verification:** live telemetry 6s window at `http://localhost:5174/?debug=true` showed max|pRate|=149.10°/s (target <360, pass by 2.4×), no gimbal flips, no JS errors. β1 alone produced 8401°/s divergence; β1+β4 brings it to 149 — full stability achieved.
  - **Test coverage:** 7 unit tests in `src/aircraft/aerosurface.test.ts` (default-zero parity for both incidence and clQ, positive-incidence positive-lift, surface-property invariance, sign-convention regression anchors, amplification ratio) + 6 unit tests in `src/aircraft/config.test.ts` (absent / explicit numeric / non-finite-throws for both fields) + 2 integration-boundary tests in `src/aircraft/flightmodel.test.ts` (asserts `incidenceRad` and `clQ` thread through `parseAircraftConfig → FlightModel.surfaces` and produce real-physics behavior). Total 242/242 tests green, tsc clean.
  - **Caveat (deferred to WP7 Phase E retune):** the verified-stable state is a descending glide, not level flight — airspeed bleeds from 30 to ~2 m/s and altitude trends down 50→33m within bounds. The cause is parametric (mass=1000 too high for spawn airspeed v=30 to produce lift=weight without thrust; lift~mg balance only at v≈90 m/s). The architectural goal of WP6.5 ("spawn airborne, no tumble, bounded pitch rate") is fully achieved; making the aircraft hold a useful cruise state is a parameter-tuning concern for WP7.
- **Lessons captured in archived plan:**
  - The β1 static-margin path was empirically refuted in the prior abandoned attempt before β1's actual mechanism was understood — confirmation that "structural property of the schema" (not parameters) was the real gap.
  - The dynamic-instability finding (200× discrepancy between my linearized analytical model and observed angular acceleration) is a useful frame for any future tuning work: linear-stability analysis underestimates the real divergence rate because stall regime + descent-induced AoA coupling are first-order, not perturbative.
  - The agent's first-try sign error on the incidence rotation (P1.6 catch — `-incidenceRad` not `+incidenceRad` per the canonical span axis) demonstrates that **physical-sign tests** ("positive incidence → positive lift") are the only reliable convention anchor. Pure-math identity tests would have passed.
  - Operator instinct to stop-and-escalate after Phase 2 failure (rather than have the agent unilaterally pick A/B/C) preserved the option to choose between path (A) damping or (C) automated tuning-search; (A) succeeded, (C) deferred.
- **Status:** resolved 2026-05-11

### SURFACE-2026-05-10-01 — AoA sign-convention bug in `computeAngleOfAttack` causes divergent pitch instability
- **Source:** feature:build (WP7 Phase F → Phase E back-loop → code investigation, 2026-05-10)
- **Resolution:** Resolved-with-test by commit `2bd5119` (`fix(aero): correct AoA sign convention`). Phase 1 flipped the sign of `perp` in `src/aircraft/aerosurface.ts` `computeAngleOfAttack` and updated `CONVENTIONS.md`. Phase 2 flipped the four routing-table sign multipliers in `flightmodel.ts` (aileron L/R, elevator, rudder) so `+control` still produces the documented body motion under the corrected physics, and corrected 13 test setups whose physics embedded the same sign error. Phase 3 added `src/aircraft/stability.test.ts` with two regression-anchor tests that would have failed under the buggy convention (rest-state |angvel.x| < 0.7 rad/s after 10 steps, was 1.31; perturbation Mx < −100 N·m restoring, was +1561 amplifying). Final 227/227 tests green. **Note:** SURFACE-2026-05-08-01 (resolved 2026-05-08) had documented the *chord-direction* convention but baked the sign-flip in question into the test fixtures it produced — a reminder that conventions need an independent physical check, not just internal consistency. Lesson captured in archived plan retrospect.
- **Status:** resolved 2026-05-10

### SURFACE-2026-05-09-04 — Three.js CubeTexture data-upload contract is non-obvious
- **Source:** feature:build (WP8 Phase 4 verify-self back-loop)
- **Resolution:** Resolved-with-test in WP8 Phase 4 back-loop. Codified by `skybox.test.ts: cube texture face entries are DataTexture instances` and `scene-composition.test.ts: skybox has the data-texture upload-path contract intact`. Lesson for future procedural-cubemap WPs (likely WP20 visual polish): pass `DataTexture` instances to `new CubeTexture(...)`, not the raw `.image` records. Three's `uploadCubeTexture` (three.module.js:12411) inspects `image[0].isDataTexture` to choose the upload branch; the wrong branch throws `texSubImage2D` and corrupts WebGL state.
- **Status:** resolved 2026-05-09

### SURFACE-2026-05-09-02 — No-horizon viewport blocks visual confirmation of attitude
- **Source:** feature:build (WP7 Phase E tuning session)
- **Resolution:** Resolved by WP8 (2026-05-09). Viewport now renders gradient skybox + textured ground + runway + tower; horizon line plainly visible. Verified at the WP8 Phase 4 boot screenshot. Unblocks WP7 Phase F (external casual-player feel-check).
- **Status:** resolved 2026-05-09

### SURFACE-2026-04-19-02 — Destructive-scaffold near-miss
- **Source:** feature:build (WP1 Phase 1)
- **Resolution:** Recovery complete via conversation transcript at the time. Lesson captured in user's auto-memory (`feedback_pre_scaffold_checklist.md`, `feedback_read_cli_flags.md`) and global CLAUDE.md "Pre-risky-action checklist" — `git init` baseline + read flag docs before running scaffolders / template generators / `--overwrite` CLIs.
- **Status:** resolved 2026-04-19

### SURFACE-2026-05-08-01 — AoA sign convention "chord = into the wind"
- **Source:** feature:build (WP4 Phase 2)
- **Resolution:** Documented in `CONVENTIONS.md` §Coordinates during WP4 finalize. Convention is now: `chord` points leading-edge-into-wind; for a forward-flying plane chord = (0,0,−1); positive AoA = wind on underside → positive lift. Six Phase 1 tests rewritten to physical setups during the discovery fix.
- **Status:** resolved 2026-05-08
