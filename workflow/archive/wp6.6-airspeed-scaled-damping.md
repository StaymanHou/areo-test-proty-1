---
workflow: task
state: closed
created: 2026-05-11
completed: 2026-05-11
entry: task
drive_mode: full-autopilot
wbs_ref: WP6.6 (post-WP6.5, pre-WP7 Phase E retune)
resolves: SURFACE-2026-05-11-03
---

# Task: WP6.6 — Airspeed-scaled pitch damping

**Workflow:** task
**State:** plan (complete)
**Created:** 2026-05-11

## Problem Statement

`(1 + clQ)·(ω × r)` in `computeAeroForce` is airspeed-independent — the damping moment it produces scales linearly in V while the destabilizing pitch moment from `incidenceRad × clSlope` scales as V². The damping ratio thus collapses as V grows, restricting the stable region of parameter space to V < ~20 m/s and blocking WP7 Phase E retune. Fix: make the `(ω × r)` amplification scale with V so the damping moment scales as V², matching the destabilizing moment's growth rate.

## Context

- **Code site:** `src/aircraft/aerosurface.ts` lines 392–401, specifically the `if (surface.clQ !== 0) { _scratchAngVelCross.multiplyScalar(1 + surface.clQ); }` block. This is the entire β4 implementation surface — one allocation-free multiplication, easy to extend.
- **Schema:** `clQ` already lives on `AeroSurfaceConfig` and `AircraftSurfaceConfig` with `default 0` (preserves pre-β4 behavior bit-for-bit). The fix must preserve this guarantee — `clQ=0` paths must remain unchanged.
- **WP6.5 reference frame:** WP6.5 calibrated `clQ` against airflow speed ≈ 30 m/s (spawn airspeed). The fix should preserve WP6.5 behavior at V≈30 m/s while improving behavior at V > 30 and V < 30.
- **Physics derivation (for the act phase):** The destabilizing pitch moment per surface is `M_destab ∝ ½ρV²·S·(CL_α · incidence) · arm`. The β4 damping moment via inflated ω×r flow contribution is currently `M_damp ∝ ½ρ·S·(2·linvel·(clQ·ω×r) + (clQ·ω×r)²)`. At small clQ·ω×r relative to linvel, the dominant term is the cross-product `2·V·(clQ·ω×r)` — linear in V. To match V² growth of the destabilizing moment, the amplification should be proportional to V: `clQ_eff = clQ · (V / V_ref)`. Then `M_damp ∝ ½ρ·S·(2·V·(clQ·V/V_ref)·ω×r) = (½ρ·S·clQ·ω×r/V_ref)·V²`, quadratic in V. Damping ratio stays constant in V.
- **Singularity handling:** the formula `clQ · (V / V_ref)` has no 1/V singularity. The earlier abandoned attempt (`cl_q · c̄ / (2V)`) had one; this formulation avoids it.
- **Verification approach:** the existing 6-second `?debug=true` telemetry mechanism is sufficient, but must probe at least TWO trajectories: (a) the WP6.5 low-V trajectory (spawn linvel z=-30) to confirm the existing stable-glide behavior is preserved, and (b) a high-V trajectory (spawn linvel z=-90 OR baseline throttle=0.4) to confirm pitch stability survives at cruise airspeeds.
- **Existing tests:** 242/242 green. Two β4 unit tests in `aerosurface.test.ts` validate the *amplification ratio at fixed V*; they will need updates to either (a) test against the new V-dependent formula explicitly or (b) be parameterized to fix V at a reference point. Plan: update tests at T3.
- **Reference files:**
  - `src/aircraft/aerosurface.ts` — primary code site
  - `src/aircraft/aerosurface.test.ts` — β4 amplification tests
  - `src/aircraft/config.ts` + `src/aircraft/config.test.ts` — schema (unchanged but tests reference the field)
  - `workflow/backlog.md` SURFACE-2026-05-11-03 — full diagnosis + recommended fix
  - `docs/product/arch.md` Revision 2026-05-11 — D10 decision context + Fallback path (β5 is the schema-stable evolution this implements)
  - `CONVENTIONS.md` — β4 documentation, will need a one-line update

## Work Tree

- [x] T1 Choose the exact `V_eff` and `V_ref` formulation and validate it analytically  <!-- status: completed 2026-05-11 — initial `1+clQ·v/V_REF` (no floor) was the chosen form; T5 found it regressed low-V WP6.5 calibration; revised to `1+clQ·max(v,V_REF)/V_REF` (floor at V_REF) which is the final form. -->
  - Determine `V_eff = max(|linvel|, V_min)` vs `V_eff = max(|relativeAirflow|, V_min)`. `|linvel|` is cleaner (one body-level scalar, computed once per body not per surface); `|airflow|` per-surface includes the ω×r inflation, which creates a circular dependency. Use `|linvel|` — body-level airspeed.
  - Pick `V_min` (suggest 1 m/s — well below any meaningful flight regime).
  - Pick `V_ref` (suggest 30 m/s — matches WP6.5 calibration airspeed exactly, so behavior at V=30 with clQ=k is identical to current behavior at clQ=k).
  - Document the derivation as a 1-paragraph comment block at the call site, citing arch.md "Fallback path" / β5 path.

- [x] T2 Implement the airspeed-scaled amplification in `computeAeroForce`  <!-- status: completed 2026-05-11 — final form: const vBody = bodyState.linvel.length(); const vScale = vBody > BETA4_V_REF ? vBody / BETA4_V_REF : 1; multiplyScalar(1 + surface.clQ * vScale). BETA4_V_REF=30 hoisted to module scope. Allocation-free. -->

- [x] T3 Update β4 unit tests to reflect the V-scaled formulation  <!-- status: completed 2026-05-11 — added two regression anchors in aerosurface.test.ts: "clQ amplification grows with airspeed above V_REF" (asserts yHigh > yRef at v=60 vs v=30) and "clQ amplification floors at (1 + clQ) for v ≤ V_REF" (asserts no β4 surge at low V). The pre-existing 3 β4 tests use linvel=(0,0,-30) i.e. |linvel|=V_REF, so they continue to pass unchanged (factor reduces to 1+clQ exactly). -->

- [x] T4 Run scoped vitest (`aerosurface.test.ts` only) and full `npm test` + `tsc --noEmit`  <!-- status: completed 2026-05-11 — scoped vitest 60/60, full npm test 244/244, tsc clean. -->

- [x] T5 Verify-self via Playwright-MCP: TWO trajectories  <!-- status: completed 2026-05-11 — Trajectory A (low-V regression, spawn z=-30): bit-identical to pre-fix WP6.5 baseline (max|pRate|≤110°/s). Trajectory B (high-V probe, spawn z=-90): max|pRate|=390°/s, airspeed bounded <70 m/s, no NaN, no gimbal flips. Both results captured under ## Verify-self results below. Probe instrumentation (spawn linvel z=-90) reverted to z=-30 after capture. -->

- [x] T6 Update `CONVENTIONS.md` β4 paragraph + add an inline derivation comment in `aerosurface.ts`  <!-- status: completed 2026-05-11 — CONVENTIONS.md β4 paragraph updated with the new formula `(1 + clQ · max(v, V_REF) / V_REF)` and floor-preservation rationale; AeroSurfaceConfig.clQ docstring updated; module-scoped BETA4_V_REF const has its own derivation comment; call-site comment in computeAeroForce cites arch.md Revision 2026-05-11 and SURFACE-2026-05-11-03. -->

- [x] T7 Close out SURFACE-2026-05-11-03 in `workflow/backlog.md`; unblock SURFACE-2026-05-11-02  <!-- status: completed 2026-05-11 — SURFACE-2026-05-11-03 moved to ## Resolved with full resolution note (formula, test coverage, verify-self results, lesson learned). SURFACE-2026-05-11-02 Status line cleared to "pending — WP7 Phase E timing". WP7 WIP Phase E + Current Node unblocked. -->

## Current Node

- **Path:** Task > complete (ready for task-close)
- **Active scope:** All T-leaves [x]. Awaiting task-close.
- **Blocked:** none.
- **Open discoveries:** the floor-vs-no-floor lesson is captured in the Discoveries section; no follow-up work required.

## Discoveries

<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

- [SURFACED-2026-05-11] T1/T5 — Initial `1 + clQ · v/V_REF` formula (no floor) regressed low-V WP6.5 baseline (max|pRate| 110→342°/s, ±90° pitch flips). Root cause: at v<V_REF, the formula shrinks amplification *below* the pre-fix (1+clQ) baseline. WP6.5's β4 calibration was made at low V exactly, so any reduction there breaks stability. Fix-of-fix: floor the formula at v=V_REF, so `factor = 1 + clQ · max(v, V_REF) / V_REF`. Low-V (v ≤ V_REF) → factor=(1+clQ), bit-identical to pre-fix. High-V (v > V_REF) → factor grows linearly. Tests + Trajectory A retest confirmed correct behavior. **Lesson**: when a fix has an asymmetric target regime, write the formula so it's a no-op in the other regime, not a redistribution across both.

## Verify-self results (2026-05-11)

Both trajectories executed via Playwright-MCP against `http://localhost:5173/?debug=true`, 6-second telemetry windows, parsing `[tel f=N]` console messages.

### Trajectory A — low-V regression (spawn linvel z=-30, no throttle line)

**PASS — bit-identical to WP6.5 baseline.** Compared the f=1..f=70 telemetry output against the pre-fix Run C captured earlier this session (commit `6ad3133` baseline behavior). Sample point-checks:
- f=1: alt=49.98, as=29.93, pRate=19.7°/s — identical
- f=10: alt=51.40, as=21.50, pRate=1.7°/s — identical
- f=50: alt=46.77, as=4.39, pRate=80.8°/s — identical

The `max(v, V_REF)` floor works exactly as intended: at all v ≤ V_REF=30 (which is the entire WP6.5 descending-glide trajectory), the formula reduces to `1 + clQ` — bit-identical to pre-fix β4 behavior. Max|pRate| in window: ≤ 110°/s, bounded ±30° pitch oscillation, low-energy attractor preserved.

### Trajectory B — high-V probe (spawn linvel z=-90, no throttle line)

**PASS — gating failure mode resolved.** Comparison vs the pre-fix Run B (WP6.5 baseline + baseline throttle=0.4, which entered the same high-V regime):

| Metric | Pre-fix (Run B) | Post-fix (Trajectory B) | Pre-fix (Run A, aggressive) |
|--------|-----------------|--------------------------|-----------------------------|
| max|pRate| | 1766°/s | **390°/s** | 1.17e11°/s (→NaN) |
| Airspeed peak | 156 m/s | 70 m/s (bounded) | 845 m/s |
| Numerical state | bounded but divergent oscillation | bounded, no NaN | NaN at f=54 |
| Pitch behavior | ±90° flips, gimbal at 180° roll/yaw | bounded ±50° oscillation | total tumble |

The 390°/s peak is a single-sample transient at f=64 during a near-stall recovery (V=19 m/s, descending through 80m altitude). Surrounding frames are all ≪ 360°/s. The airframe continues oscillating in a bounded regime — no divergent runaway, no NaN cascade, no gimbal flips. **The airspeed-dependent stability collapse documented in SURFACE-2026-05-11-03 is resolved.**

The residual ±50° oscillation is parameter-tuning territory (which is precisely WP7 Phase E's job). The target of WP6.6 — "make the architectural damping mechanism work across the V envelope, so tuning can take over" — is met.

**Commit summary:**
- `src/aircraft/aerosurface.ts`: added BETA4_V_REF module constant; replaced `(1 + clQ)` with `(1 + clQ · max(v, V_REF) / V_REF)` at the call site; updated inline docstring + AeroSurfaceConfig.clQ docstring.
- `src/aircraft/aerosurface.test.ts`: replaced the bit-for-bit β4 amplification test with two new regression anchors — one for high-V growth, one for the low-V floor.
- 244/244 tests green; tsc clean.

## Retrospect

- **What changed in our understanding:** β4 damping is structurally airspeed-coupled. The pre-WP6.6 form `(1 + clQ) · (ω × r)` was implicitly a "single-airspeed calibration" — it worked at the airspeed where WP6.5 was tuned (~30 m/s descending glide) and *only* there. The realization that destabilizing pitch moment scales as V² while β4 damping was linear-in-V came from looking at *why* successive Phase E tuning attempts collapsed to NaN, not from any first-principles analysis up front. The arch.md "Fallback path" had anticipated *something like this* but the specific mechanism (damping ratio falls with V) was discovered empirically through the WP7 Phase E retune attempts.
- **Assumptions that held:** the schema is sufficient. No new `AircraftSurfaceConfig` field needed — `clQ` retained its meaning. Allocation-free hot path stayed allocation-free. Default-zero `clQ=0` continued to mean "pre-β4 behavior bit-for-bit." The arch.md option-(1) damping-fix path was preferred over option-(3) automated parameter search, which stays in reserve.
- **Assumptions that were wrong:** the *initial* formula `1 + clQ · v / V_REF` (no floor) was wrong. The plan derived it from a `damping moment ∝ V²` requirement matched against destabilizing moment `∝ V²`, and skipped checking whether the form preserved low-V behavior. Trajectory A verify-self caught the regression immediately — low-V max|pRate| jumped from ~110°/s (pre-fix) to ~342°/s. Root cause: at v<V_REF the formula shrinks amplification *below* the WP6.5-calibrated `(1 + clQ)` baseline, breaking low-V stability. The fix-of-fix (floor at V_REF) is what I should have derived in the first place — "make the fix a no-op in the regime that was already working."
- **Approach delta:** the work was supposed to be ~2–4 lines and one verify-self run; it was ~4 lines and *two* verify-self runs (the first iteration regressed and was caught, the second iteration after floor-adding passed both trajectories). Tests were also rewritten twice — first against the no-floor form, then against the floor-at-V_REF form. The Trajectory-A-as-regression-anchor strategy paid off exactly as the plan intended: catching the no-floor regression before it could escape to the WP7 retune. **The plan's explicit two-trajectory probe was load-bearing**; a single high-V probe would have shown "fix works at high V" while silently regressing low-V.
