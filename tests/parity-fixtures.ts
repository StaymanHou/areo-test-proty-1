// Shared parity fixtures — consumed by `tests/e2e/parity.spec.ts` (Playwright,
// browser-side trajectory emitter), `tests/parity-diff.test.ts` (Vitest,
// synthetic-stub + WP14.7 harness side), and `tools/tune/harness.ts` (Node
// CLI driver). Same initial conditions → same trajectories under deterministic
// fixed-dt physics.
//
// WP14.7 extends coverage to the full throttle envelope (low / mid / high)
// per arch.md Rev 2026-05-12 (afternoon) §D14.3 and the
// `feedback_verify_self_envelope.md` lesson — single-fixture parity is a
// trajectory check, not an envelope check.

export interface ParityFixture {
  id: string;
  position: { x: number; y: number; z: number };
  linvel: { x: number; y: number; z: number };
  throttle: number;
  ticks: number;
}

/**
 * All three fixtures spawn at (0, 50, 0) with `linvel.z = -78` — the airframe's
 * **L=W trim AS** under the production WP14.10 baseline aircraft.json. Throttle
 * alone distinguishes the regimes (climb / cruise / descent from the common
 * trim AS). See arch.md Revision 2026-05-25 afternoon — D25 for the derivation.
 *
 * **L=W trim AS derivation (throttle-independent):**
 *   V_trim = √(2·W / (ρ·S·CL_at_trim_α))
 *          = √(2·9810 / (1.225·12·0.22))
 *          ≈ 78 m/s
 *   where W=9810 N (mass=1000), ρ=1.225, S=12 m² (two wings × 6 m²),
 *   CL≈0.22 at incidenceRad=0.0349 (the wings' fixed AoA).
 *
 * **Throttle determines T=D balance AT V_trim (climb/cruise/descent):**
 *   - low  (τ=0.05, T=300 N):   T << D(V=78)≈894 N → airframe must decelerate;
 *                               as V drops below V_trim, L drops below W → descent.
 *   - mid  (τ=0.15, T=900 N):   T ≈ D(V=78)=894 N → level cruise (T=D AND L=W).
 *                               This is the airframe's design cruise throttle.
 *   - high (τ=0.40, T=2400 N):  T >> D(V=78)≈894 N → airframe accelerates;
 *                               as V grows above V_trim, L grows above W → climb.
 *
 * D24 (arch.md 2026-05-25) FIRST attempted per-throttle T=D-derived spawn AS
 * {45, 78, 128}. That derivation was structurally wrong: T=D-derived V is the
 * AS where the airframe stops accelerating along its velocity vector, NOT the
 * AS where lift balances weight. At V=45 (low), lift = 0.33×W → airframe drops
 * out of the sky; at V=128 (high), lift = 2.7×W → airframe rocket-climbs. Only
 * mid coincided (because at mid throttle T=D AND L=W are simultaneously
 * satisfied at V_trim=78). D25 (arch.md 2026-05-25 afternoon) corrects to
 * uniform spawn AS = V_trim for all regimes.
 *
 * D25 binds CLAUDE.md Rule #9 (initial-condition-equilibrium-consistency for
 * level-flight score-function fixtures, amended at D25 to remove the erroneous
 * "at the fixture's throttle" qualifier): if aircraft.json mass / wing area /
 * CL_at_trim_α changes, V_trim MUST be re-derived alongside (thrust no longer
 * enters this derivation; it only determines T-vs-D balance AT V_trim).
 *
 * History: spawn AS was -30 m/s for the WP14.5 → WP14.18 cascade era under the
 * broken integrator (SURFACE-2026-05-24-09; fix at commit `46f9b42`). D24
 * recalibrated to per-throttle T=D-derived {45, 78, 128}. D25 corrected to
 * uniform V_trim=78.
 */
export const PARITY_FIXTURES: readonly ParityFixture[] = [
  {
    id: 'throttle-low',
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -78 },
    throttle: 0.05,
    ticks: 1800, // 30s at 60Hz
  },
  {
    id: 'throttle-mid',
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -78 },
    throttle: 0.15,
    ticks: 1800,
  },
  {
    id: 'throttle-high',
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -78 },
    throttle: 0.4,
    ticks: 1800,
  },
] as const;
