# Changelog

## 2026-05-16

- **Feature shipped:** WP14.7 Node Rapier-WASM harness — `tools/tune/harness.ts` boots Rapier-WASM in Node, accepts deep-path parameter overrides + fixture id + tick count via CLI, emits trajectory CSVs the browser path diffs to within `|Δ|<1e-6`; `parity-diff.test.ts` rewired with browser→(harness | synthetic) precedence and parity-of-divergence semantics; second of 3 WPs in the D14 cascade.

## 2026-05-12

- **Feature shipped:** WP12 HUD — DOM overlay renders alt/airspeed/throttle, objective text, status banner, and projection-ready waypoint arrow in-mission per arch.md D12.
- **Task closed:** WP13 free-flight mission — added Escape-to-mission-select abort path; mission JSON already shipped at WP11 + HUD overlay at WP12.
- **Milestone:** Free flight mission (Phase 2 roadmap).
- **Feature shipped:** WP14 waypoint patrol mission — 2-waypoint glide-reachable patrol with ordered objective tracking + HUD waypoint-arrow wiring + 30s timeout fail; reduced scope from planned 4-waypoint loop because SURFACE-2026-05-12-01 (phugoid tuning side) gates sustained-throttle flight.
- **Milestone:** Waypoint navigation mission (Phase 2 roadmap).
- **Task closed:** WP14.5 `clAlphaDot` tuning pass — option-c disposition; 3 tuning attempts (+5/+10, +1/+2, -1/-2) all diverged catastrophically, surfacing SURFACE-2026-05-12-03 (β5 mechanism in `aerosurface.ts` is dimensionally mismatched and needs arch-level revision); no config change shipped, phugoid-probe spec landed under `test.skip` for re-use after the mechanism revision.
- **Feature shipped:** WP14.6 physics-core extraction + harness↔browser parity test — `src/aircraft/physics-core/` is now a framework-agnostic Node-runnable subset of the flight model, `tests/parity-diff.test.ts` asserts bit-identical trajectories between browser and in-process synthetic stub (1800 ticks, `|Δ|<1e-6`); first of 3 WPs in the D14 cascade; bonus fix to `Aircraft.reset()` clearing stale Rapier force accumulators.
