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
 * All three spawn at (0, 50, 0) + linvel (0, 0, -30) — same initial conditions
 * as the WP14.5 phugoid-probe missions and the WP9.6 casual-flight baseline.
 * Throttle distinguishes the three regimes:
 *   - low  (0.05) — close to the zero-throttle descending-glide attractor
 *   - mid  (0.15) — SURFACE-2026-05-12-01 mid-band; load-bearing for WP14.5-retry
 *   - high (0.40) — sustained-throttle regime where the phugoid diverges
 */
export const PARITY_FIXTURES: readonly ParityFixture[] = [
  {
    id: 'throttle-low',
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -30 },
    throttle: 0.05,
    ticks: 1800, // 30s at 60Hz
  },
  {
    id: 'throttle-mid',
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -30 },
    throttle: 0.15,
    ticks: 1800,
  },
  {
    id: 'throttle-high',
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -30 },
    throttle: 0.4,
    ticks: 1800,
  },
] as const;
