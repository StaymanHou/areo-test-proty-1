// Shared parity fixtures — consumed by both `tests/e2e/parity.spec.ts`
// (Playwright, browser-side trajectory emitter) and `tests/parity-diff.test.ts`
// (Vitest, synthetic-stub-then-Node-harness side). Same initial conditions →
// same trajectories under deterministic fixed-dt physics.
//
// WP14.6 ships a single fixture (throttle-mid). WP14.7 will add `throttle-low`
// (0.05) and `throttle-high` (0.4) for full envelope coverage per arch.md
// Rev 2026-05-12 (afternoon) §D14.3 and `feedback_verify_self_envelope.md`.

export interface ParityFixture {
  id: string;
  position: { x: number; y: number; z: number };
  linvel: { x: number; y: number; z: number };
  throttle: number;
  ticks: number;
}

/**
 * Spawn (0, 50, 0) + linvel (0, 0, -30) matches the WP9.6 casual-flight
 * baseline and the WP14.5 phugoid-probe fixtures. Throttle 0.15 is the
 * SURFACE-2026-05-12-01 mid-band that diverges with raw β5 — making it the
 * load-bearing fixture for the eventual WP14.5-retry tuning.
 */
export const PARITY_FIXTURES: readonly ParityFixture[] = [
  {
    id: 'throttle-mid',
    position: { x: 0, y: 50, z: 0 },
    linvel: { x: 0, y: 0, z: -30 },
    throttle: 0.15,
    ticks: 1800, // 30s at 60Hz
  },
] as const;
