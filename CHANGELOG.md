# Changelog

## 2026-05-16

- **Feature shipped:** WP14.7 Node Rapier-WASM harness — `tools/tune/harness.ts` boots Rapier-WASM in Node, accepts deep-path parameter overrides + fixture id + tick count via CLI, emits trajectory CSVs the browser path diffs to within `|Δ|<1e-6`; `parity-diff.test.ts` rewired with browser→(harness | synthetic) precedence and parity-of-divergence semantics; second of 3 WPs in the D14 cascade.
- **Feature shipped:** WP14.8 score function + Nelder-Mead optimizer + tune CLI — `tools/tune/score.ts` implements multi-regime envelope-probing fitness (NaN penalty encodes time-to-first-NaN as a gradient), `tools/tune/optimizer.ts` runs Nelder-Mead with K random restarts + local quadratic regression on the best simplex (dimension-agnostic from day one), `tools/tune/tune.ts` is the `npm run tune` CLI that wires them with the WP14.7 harness; third of 3 WPs in the D14 cascade — fully landed, WP14.5-retry now genuinely unblocked.
- **Milestone:** WP14.8: Score function + Nelder-Mead optimizer + tune CLI (D14 cascade step 3 of 3).
- **Feature shipped:** WP14.5-retry joint (clQ, clAlphaDot) optimizer search — ran `npm run tune` over the 4D joint parameter space for wing-left + h-stab; all 8 sampled points hit the NaN floor with degenerate regression Hessian; filed SURFACE-2026-05-16-04 as the consolidated mechanism-revision driver recommending Option A on both β4 (implicit-Euler form) and β5 (non-dimensional `cl_α̇ · c̄ / (2V)` form); `aircraft.json` + `tests/e2e/phugoid-probe.spec.ts` unchanged; D14 cascade's harness-optimizer delivered empirical evidence in 7.24s of wall-clock that would have taken weeks of hand-tuning.
- **Milestone:** WP14.5 (rescoped): `clAlphaDot` tuning pass via harness — escalated via SURFACE-2026-05-16-04 to forthcoming D15/D16 cascade.

## 2026-05-12

- **Feature shipped:** WP12 HUD — DOM overlay renders alt/airspeed/throttle, objective text, status banner, and projection-ready waypoint arrow in-mission per arch.md D12.
- **Task closed:** WP13 free-flight mission — added Escape-to-mission-select abort path; mission JSON already shipped at WP11 + HUD overlay at WP12.
- **Milestone:** Free flight mission (Phase 2 roadmap).
- **Feature shipped:** WP14 waypoint patrol mission — 2-waypoint glide-reachable patrol with ordered objective tracking + HUD waypoint-arrow wiring + 30s timeout fail; reduced scope from planned 4-waypoint loop because SURFACE-2026-05-12-01 (phugoid tuning side) gates sustained-throttle flight.
- **Milestone:** Waypoint navigation mission (Phase 2 roadmap).
- **Task closed:** WP14.5 `clAlphaDot` tuning pass — option-c disposition; 3 tuning attempts (+5/+10, +1/+2, -1/-2) all diverged catastrophically, surfacing SURFACE-2026-05-12-03 (β5 mechanism in `aerosurface.ts` is dimensionally mismatched and needs arch-level revision); no config change shipped, phugoid-probe spec landed under `test.skip` for re-use after the mechanism revision.
- **Feature shipped:** WP14.6 physics-core extraction + harness↔browser parity test — `src/aircraft/physics-core/` is now a framework-agnostic Node-runnable subset of the flight model, `tests/parity-diff.test.ts` asserts bit-identical trajectories between browser and in-process synthetic stub (1800 ticks, `|Δ|<1e-6`); first of 3 WPs in the D14 cascade; bonus fix to `Aircraft.reset()` clearing stale Rapier force accumulators.
