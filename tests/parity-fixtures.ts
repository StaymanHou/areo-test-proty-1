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
 * All three spawn at (0, 50, 0); throttle + linvel.z (spawn airspeed) distinguish
 * the regimes. Each fixture's spawn AS is the per-regime L=W equilibrium under
 * the production WP14.10 baseline aircraft.json (mass=1000, S_wing=12, CD0≈0.02,
 * no inducedDragK, no fuselageDrag) computed from T=D at the regime's throttle.
 * See arch.md Revision 2026-05-25 — D24 for the derivation.
 *
 *   - low  (τ=0.05, thrust=300 N)  → V_eq = √(300/0.147)  ≈ 45 m/s  (controlled descent)
 *   - mid  (τ=0.15, thrust=900 N)  → V_eq = √(900/0.147)  ≈ 78 m/s  (matches incidence-induced CL=0.22)
 *   - high (τ=0.40, thrust=2400 N) → V_eq = √(2400/0.147) ≈ 128 m/s (high-speed cruise)
 *
 * D24 binds CLAUDE.md Rule #9 (initial-condition-equilibrium-consistency for
 * level-flight score-function fixtures): if aircraft.json mass / wing area /
 * thrust / CL_α changes, these spawn-AS constants MUST be re-derived alongside.
 *
 * History: spawn AS was -30 m/s for the WP14.5 → WP14.18 cascade era. SURFACE-
 * 2026-05-24-09 (fix at commit `46f9b42`) cleared the integrator pathology that
 * had been hiding the spawn-AS mismatch; D24 made the recalibration architecturally.
 */
export const PARITY_FIXTURES: readonly ParityFixture[] = [
  {
    id: 'throttle-low',
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -45 },
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
    linvel: { x: 0, y: 0, z: -128 },
    throttle: 0.4,
    ticks: 1800,
  },
] as const;
