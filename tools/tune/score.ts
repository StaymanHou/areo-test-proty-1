import type { TrajectoryRow } from '../../src/aircraft/physics-core/trajectory-buffer';

// WP14.8 Phase 1 — envelope-probing fitness function per arch.md §D14.4.
// WP14.14b (D21, 2026-05-24) — criterion 0 "level-flight-maintenance" probe
// added + per-regime targetAirspeed re-calibrated to L=W equilibrium values
// (45/60/85 m/s) + AS_ENVELOPE tightened 30→25 m/s. See arch.md Revision
// 2026-05-24 (evening) D21 for the L=W equilibrium derivation and the
// "diagnostic infrastructure precedes mechanism interpretation" rule.
//
// Precedence ordering (binding):
//   1. NaN/Infinity in any row → return -1e9 + firstNanTick (criterion 1)
//   2. Finite but fails criterion 0 (level-flight-maintenance in first
//      LEVEL_FLIGHT_WINDOW_SEC) → return -1e9 + failTick (criterion 0)
//   3. Finite and passes criterion 0 → existing envelope-penalty sum
//      (criterion 2)
// Both criterion 1 and criterion 0 use the same -1e9 + tick encoding so the
// optimizer's gradient prefers later-failing points uniformly.
//
// Higher score is better. NaN trajectories receive a large negative penalty
// that ENCODES TIME-TO-FIRST-NAN as a GRADIENT TOWARD LATER NaN: the
// encoding is `-1e9 + firstNanTick`. A trajectory that NaNs at tick 500
// scores -1e9 + 500 = -999999500; one that NaNs at tick 100 scores
// -1e9 + 100 = -999999900. Late > early under higher-is-better, so the
// optimizer's gradient pulls toward later-NaN regions even when every
// sampled point explodes — this is the "prefer-failing-later" intent in
// arch.md §D14.4.
//
// Note on arch text: arch.md §D14.4 literally writes `-1e9 - tick_of_first_NaN`
// while also stating "Higher is better" and "the optimizer can move toward
// later-NaN regions." The literal formula contradicts the stated intent
// under higher-is-better semantics — earlier NaN would score better, not
// worse. The implementation honors the stated *intent* (prefer later NaN);
// the typo in arch.md is surfaced for fix-on-next-arch-revision.
//
// Finite trajectories receive a softer negative score composed of altitude,
// airspeed, pitch-rate, and phugoid-growth penalties (each
// `max(0, observed - envelope)**2`).
//
// The multi-regime sum is `Σ weight_regime · regime_score(trajectory)`. The
// score function does NOT call the harness — it consumes already-emitted
// trajectories, so it is pure compute and dimension-agnostic (the parameter
// vector is the optimizer's concern; the score consumes only trajectories).
//
// Envelope constants are module-level (DEFAULT_ENVELOPES); call sites pass
// them through so tests can drive non-default envelopes.

/** One sampled regime: a labelled trajectory. */
export interface RegimeTrajectory {
  /** Regime label, e.g. `'low'`, `'mid'`, `'high'`. */
  regime: string;
  /** Per-tick rows in chronological order (output of TrajectoryBuffer.getRows). */
  rows: readonly TrajectoryRow[];
}

/** Score envelopes per arch.md §D14.4. */
export interface ScoreEnvelopes {
  /** Allowable |alt - spawn_alt| amplitude in meters before penalty kicks in. */
  ALT_ENVELOPE: number;
  /** Allowable |airspeed - target_airspeed| amplitude in m/s before penalty. */
  AS_ENVELOPE: number;
  /** Max |pitch_rate| in degrees/second before penalty (matches WP6.5 budget). */
  PITCH_RATE_LIMIT: number;
  /** Per-regime target airspeed (m/s). Missing regime → fall back to 30. */
  targetAirspeed: Readonly<Record<string, number>>;
  /** Per-regime weight in the top-level sum. Missing regime → 1. */
  weightRegime: Readonly<Record<string, number>>;
  /** Coefficient on the phugoid growth-rate penalty (after squaring). */
  PHUGOID_WEIGHT: number;
  /** Physics tick rate (Hz). Used to convert tick indices → seconds. */
  TICK_HZ: number;
  /** D21 criterion 0: duration of the level-flight-maintenance check window (seconds from spawn). */
  LEVEL_FLIGHT_WINDOW_SEC: number;
  /** D21 criterion 0: max allowable altitude drop in the window before criterion 0 fails (meters, positive). */
  LEVEL_FLIGHT_ALT_DROP_MAX: number;
  /** D21 criterion 0: min allowable airspeed at any point in the window before criterion 0 fails (m/s). */
  LEVEL_FLIGHT_AS_MIN: number;
}

export const DEFAULT_ENVELOPES: ScoreEnvelopes = {
  ALT_ENVELOPE: 50,
  AS_ENVELOPE: 25,
  PITCH_RATE_LIMIT: 360,
  // D21 — re-calibrated from {low:25, mid:30, high:40} to airframe L=W
  // equilibrium AS at throttles 0.05/0.15/0.40 per arch.md Revision
  // 2026-05-24 (evening). See the L=W derivation in arch.md §D21.
  targetAirspeed: { low: 45, mid: 60, high: 85 },
  weightRegime: { low: 1, mid: 1, high: 1 },
  PHUGOID_WEIGHT: 1,
  TICK_HZ: 60,
  LEVEL_FLIGHT_WINDOW_SEC: 1.0,
  LEVEL_FLIGHT_ALT_DROP_MAX: 20,
  LEVEL_FLIGHT_AS_MIN: 10,
};

/**
 * Result of the D21 criterion 0 "level-flight-maintenance" check.
 * `passed: true` → trajectory maintained altitude and airspeed thresholds
 * across the first `LEVEL_FLIGHT_WINDOW_SEC` from spawn.
 * `passed: false` → the trajectory either dropped more than
 * `LEVEL_FLIGHT_ALT_DROP_MAX` below spawn or fell below `LEVEL_FLIGHT_AS_MIN`
 * airspeed within the window. `failTick` is the first offending row's tick
 * (used for the -1e9 + failTick prefer-failing-later encoding).
 */
export type LevelFlightCheckResult =
  | { passed: true }
  | { passed: false; failTick: number; failReason: 'altitude_drop' | 'airspeed_collapse' };

/**
 * D21 criterion 0: does the trajectory maintain level flight for the first
 * `LEVEL_FLIGHT_WINDOW_SEC` seconds from spawn? "Level flight" means:
 * altitude stays within `LEVEL_FLIGHT_ALT_DROP_MAX` of spawn altitude AND
 * airspeed stays at or above `LEVEL_FLIGHT_AS_MIN`. Caller must ensure rows
 * are finite (this function does not re-check for NaN — NaN takes
 * precedence over criterion 0 per the precedence ordering documented in
 * the file header).
 */
export function levelFlightMaintenanceCheck(
  rows: readonly TrajectoryRow[],
  envelopes: ScoreEnvelopes,
): LevelFlightCheckResult {
  if (rows.length === 0) return { passed: true };
  const spawnAlt = rows[0].posY;
  const windowTicks = Math.floor(envelopes.LEVEL_FLIGHT_WINDOW_SEC * envelopes.TICK_HZ);
  const end = Math.min(windowTicks, rows.length);
  for (let i = 0; i < end; i++) {
    const r = rows[i];
    if (r.posY < spawnAlt - envelopes.LEVEL_FLIGHT_ALT_DROP_MAX) {
      return { passed: false, failTick: r.tick, failReason: 'altitude_drop' };
    }
    if (r.airspeed < envelopes.LEVEL_FLIGHT_AS_MIN) {
      return { passed: false, failTick: r.tick, failReason: 'airspeed_collapse' };
    }
  }
  return { passed: true };
}

/** First tick at which any per-row column is non-finite, or null if all rows finite. */
export function firstNanTick(rows: readonly TrajectoryRow[]): number | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (
      !Number.isFinite(r.posX) || !Number.isFinite(r.posY) || !Number.isFinite(r.posZ) ||
      !Number.isFinite(r.vX) || !Number.isFinite(r.vY) || !Number.isFinite(r.vZ) ||
      !Number.isFinite(r.pitch) || !Number.isFinite(r.yaw) || !Number.isFinite(r.roll) ||
      !Number.isFinite(r.airspeed)
    ) {
      return r.tick;
    }
  }
  return null;
}

/**
 * Phugoid growth penalty: linear-regress alt-amplitude across the trajectory.
 * Strategy: split rows into early half and late half; for each half compute
 * (max(posY) - min(posY)) as a coarse amplitude proxy. Growth-rate = (late -
 * early) / window_seconds. Penalty = max(0, growth_rate)**2 * PHUGOID_WEIGHT.
 * A trajectory whose altitude envelope shrinks (negative growth) contributes
 * zero — that's the "damped" attractor we want to find.
 */
export function phugoidGrowthPenalty(
  rows: readonly TrajectoryRow[],
  envelopes: ScoreEnvelopes,
): number {
  if (rows.length < 4) return 0; // not enough samples to split
  const mid = Math.floor(rows.length / 2);
  let earlyMin = Infinity, earlyMax = -Infinity;
  let lateMin = Infinity, lateMax = -Infinity;
  for (let i = 0; i < mid; i++) {
    const y = rows[i].posY;
    if (y < earlyMin) earlyMin = y;
    if (y > earlyMax) earlyMax = y;
  }
  for (let i = mid; i < rows.length; i++) {
    const y = rows[i].posY;
    if (y < lateMin) lateMin = y;
    if (y > lateMax) lateMax = y;
  }
  const earlyAmp = earlyMax - earlyMin;
  const lateAmp = lateMax - lateMin;
  const windowSec = rows.length / envelopes.TICK_HZ;
  const growthRate = (lateAmp - earlyAmp) / windowSec;
  if (growthRate <= 0) return 0;
  return growthRate * growthRate * envelopes.PHUGOID_WEIGHT;
}

/** Score one regime's trajectory. Returns a non-positive number; higher is better. */
export function regimeScore(
  trajectory: RegimeTrajectory,
  envelopes: ScoreEnvelopes,
): number {
  const rows = trajectory.rows;
  if (rows.length === 0) {
    // No data is worse than failing at tick 0 — same NaN floor, no gradient.
    return -1e9;
  }
  const nanTick = firstNanTick(rows);
  if (nanTick !== null) {
    // Prefer-failing-later gradient: later NaN scores higher (less negative).
    // See file-header note on the arch.md sign typo.
    return -1e9 + nanTick;
  }

  // D21 criterion 0 — level-flight-maintenance probe. Only fires for finite
  // trajectories; NaN takes precedence above. Failure uses the same
  // -1e9 + failTick prefer-failing-later encoding as criterion 1.
  const lfCheck = levelFlightMaintenanceCheck(rows, envelopes);
  if (!lfCheck.passed) {
    return -1e9 + lfCheck.failTick;
  }

  const spawnAlt = rows[0].posY;
  const targetAS = trajectory.regime in envelopes.targetAirspeed
    ? envelopes.targetAirspeed[trajectory.regime]
    : 30;

  let maxAltDev = 0;
  let maxAsDev = 0;
  let maxPitchRateDegPerSec = 0;
  const dtSec = 1 / envelopes.TICK_HZ;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const altDev = Math.abs(r.posY - spawnAlt);
    if (altDev > maxAltDev) maxAltDev = altDev;
    const asDev = Math.abs(r.airspeed - targetAS);
    if (asDev > maxAsDev) maxAsDev = asDev;
    if (i > 0) {
      const dPitch = rows[i].pitch - rows[i - 1].pitch;
      // pitch is radians; convert rate to deg/s
      const rateDegPerSec = Math.abs((dPitch / dtSec) * (180 / Math.PI));
      if (rateDegPerSec > maxPitchRateDegPerSec) maxPitchRateDegPerSec = rateDegPerSec;
    }
  }

  const altPenalty = Math.max(0, maxAltDev - envelopes.ALT_ENVELOPE);
  const asPenalty = Math.max(0, maxAsDev - envelopes.AS_ENVELOPE);
  const prPenalty = Math.max(0, maxPitchRateDegPerSec - envelopes.PITCH_RATE_LIMIT);
  const phuPenalty = phugoidGrowthPenalty(rows, envelopes);

  return -(altPenalty * altPenalty + asPenalty * asPenalty + prPenalty * prPenalty + phuPenalty);
}

/**
 * Multi-regime weighted score per D14.4. Higher is better.
 * Pure compute — no parameter vector input; this consumes trajectories the
 * harness has already produced. The optimizer is the one that maps params →
 * trajectories via the harness and then calls this function.
 */
export function score(
  trajectories: readonly RegimeTrajectory[],
  envelopes: ScoreEnvelopes = DEFAULT_ENVELOPES,
): number {
  let total = 0;
  for (const t of trajectories) {
    const w = t.regime in envelopes.weightRegime ? envelopes.weightRegime[t.regime] : 1;
    total += w * regimeScore(t, envelopes);
  }
  return total;
}
