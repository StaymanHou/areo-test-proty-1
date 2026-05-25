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

// D23 (2026-05-24 night) — per-regime throttle-mode reframe per arch.md
// Revision 2026-05-24 (night). The score function dispatches per regime to
// mode-appropriate scoring logic. The 'level-cruise' mode preserves D21
// behavior exactly (refactored into levelCruiseScore); 'controlled-descent'
// (idle/low-throttle) and 'slow-flight-or-shallow-descent' (mid-throttle)
// implement mode-specific criteria reflecting that a real Cessna at idle
// DESCENDS and at low-mid throttle is in slow-flight, not level cruise.
// Back-compat: envelopes without `regimeMode` fall back to levelCruiseScore
// (= existing D21 behavior). All new fields are optional.

/** D23 per-regime throttle mode. Each regime is scored against mode-appropriate behavior. */
export type RegimeMode =
  | 'controlled-descent'              // low throttle: airframe should DESCEND at bounded sink rate
  | 'slow-flight-or-shallow-descent'  // mid throttle: slow flight or mild descent
  | 'level-cruise';                   // high throttle: D21 level-flight behavior

/**
 * D23 airframe constants for the T=D regime guard (level-cruise mode only).
 * If absent in envelopes, the T=D guard is a no-op (returns 0 penalty).
 * Keeping these in envelopes (instead of importing aircraft.json) preserves
 * score.ts as pure compute — no FS reads, testable in isolation.
 */
export interface AirframeConstants {
  mass: number;          // kg
  thrust_max: number;    // N
  S_wing: number;        // m²
  CD0: number;           // parasitic drag coefficient
  k_wing: number;        // induced drag coefficient
  cd0_fus_area: number;  // cd0_fus * area_fus (combined fuselage drag k)
  /** Throttle setting per regime label (0..1). Required when airframe present. */
  throttleByRegime: Readonly<Record<string, number>>;
}

/** Score envelopes per arch.md §D14.4 (extended D21 + D23 + D26). */
export interface ScoreEnvelopes {
  /** Allowable |alt - spawn_alt| amplitude in meters before penalty kicks in.
   *  D26 fallback: consumed when `altEnvelope` is absent OR when the regime
   *  label is not present in `altEnvelope`. Legacy callers (pre-D26) use this
   *  scalar uniformly across regimes. */
  ALT_ENVELOPE: number;
  /** D26 (arch.md Revision 2026-05-25 late afternoon) — per-regime alt envelope
   *  reflecting natural per-throttle alt behavior (T<<D descends, T≈D cruises,
   *  T>>D climbs). Missing/regime-not-present → fall back to scalar ALT_ENVELOPE.
   *  Unlike the AS dimension (where L=W trim AS is throttle-invariant per D25-ζ),
   *  the alt dimension legitimately differs per throttle. */
  altEnvelope?: Readonly<Record<string, number>>;
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
  // ------------------------- D23 additions (all optional) -------------------------
  /** Per-regime mode. Missing regime → fall back to 'level-cruise' (D21 behavior). */
  regimeMode?: Readonly<Record<string, RegimeMode>>;
  /** controlled-descent: minimum sink rate (m/s, positive = descending). */
  SINK_RATE_LOW_MIN?: number;
  /** controlled-descent: maximum sink rate (m/s). */
  SINK_RATE_LOW_MAX?: number;
  /** slow-flight: minimum sink rate (m/s, negative = mild climb OK). */
  SINK_RATE_MID_MIN?: number;
  /** slow-flight: maximum sink rate (m/s). */
  SINK_RATE_MID_MAX?: number;
  /** slow-flight: min allowable airspeed (m/s). */
  AS_MID_MIN?: number;
  /** slow-flight: max allowable airspeed (m/s). */
  AS_MID_MAX?: number;
  /** controlled-descent: min pitch (degrees from level, negative = nose-down). */
  PITCH_LOW_MIN_DEG?: number;
  /** controlled-descent: max pitch (degrees). */
  PITCH_LOW_MAX_DEG?: number;
  /** slow-flight: pitch envelope half-width (degrees, symmetric). */
  PITCH_MID_DEG?: number;
  /** level-cruise: pitch envelope half-width (degrees, symmetric). Currently unused — D21 doesn't penalize pitch directly. */
  PITCH_HIGH_DEG?: number;
  /** T=D guard (level-cruise only): tick to start checking (allow initial transient). */
  TD_GUARD_TICK_START?: number;
  /** T=D guard: tick to stop checking. */
  TD_GUARD_TICK_END?: number;
  /** T=D guard: allowable |T - D| imbalance (N) before penalty. */
  TD_IMBALANCE_LIMIT_N?: number;
  /** T=D guard: airframe constants. If absent, guard is no-op. */
  airframe?: AirframeConstants;
}

// D25 (arch.md Revision 2026-05-25 afternoon) — DEFAULT_ENVELOPES reverted to
// all-level-cruise framing with single L=W trim AS target=78 for all regimes.
// D24's per-throttle T=D-derived `targetAirspeed: {45, 60, 85}` (originally
// from D21) conflated T=D balance with L=W balance; under fixed integration +
// post-D24 fixtures + Rule #5 independent re-derivation, L=W trim AS is
// throttle-independent (V_trim = √(2·W/(ρ·S·CL_at_trim_α)) ≈ 78 m/s for the
// production WP14.10 aircraft.json). Throttle alone differentiates
// climb/cruise/descent FROM the common V_trim start. The D23 per-regime
// mode-dispatch (controlled-descent / slow-flight-or-shallow-descent /
// level-cruise) was an artifact of pre-fix integrator + pre-D24-fixture-recal
// era; under correct integration + V_trim spawn, all regimes ARE level cruise
// (just at different energy trajectories given throttle). The D23 mode-
// dispatch code (controlledDescentScore / slowFlightScore / regimeMode field)
// stays in score.ts as back-compat-callable; legacy Vitest cases may
// construct envelopes explicitly with `regimeMode` set per D23 framing.
export const DEFAULT_ENVELOPES: ScoreEnvelopes = {
  ALT_ENVELOPE: 50,
  // D26 (arch.md Revision 2026-05-25 late afternoon) — per-regime alt envelope.
  // Reflects natural per-throttle alt behavior under fixed integration + V_trim
  // spawn (D25-ζ): T<<D descends (low — allow 100m drop); T≈D cruises around
  // spawn (mid — ±50m phugoid amplitude); T>>D climbs (high — allow 200m gain).
  // Unlike D25's AS dimension (uniform target=78 because L=W trim is throttle-
  // independent), alt is legitimately throttle-dependent.
  altEnvelope: { low: 100, mid: 50, high: 200 },
  // D25 — AS_ENVELOPE 25→30 (+5 m/s for natural phugoid amplitude observed
  // in WP14.19 Phase 2 trajectories where AS oscillates 50-78 at mid). This
  // is a natural-amplitude widening, not a target-mismatch widening.
  AS_ENVELOPE: 30,
  PITCH_RATE_LIMIT: 360,
  // D25 — uniform L=W trim AS=78 for all regimes (replacing D21's per-regime
  // {45, 60, 85}). The L=W trim AS is throttle-independent for a fixed-α
  // airframe; throttle determines T-vs-D balance AT V_trim (climb/cruise/
  // descent) not V_trim itself. See arch.md Revision 2026-05-25 afternoon § D25.
  targetAirspeed: { low: 78, mid: 78, high: 78 },
  weightRegime: { low: 1, mid: 1, high: 1 },
  PHUGOID_WEIGHT: 1,
  TICK_HZ: 60,
  LEVEL_FLIGHT_WINDOW_SEC: 1.0,
  LEVEL_FLIGHT_ALT_DROP_MAX: 20,
  LEVEL_FLIGHT_AS_MIN: 10,
  // D25 — regimeMode reverted to undefined (engages back-compat level-cruise
  // fallback for all regimes; equivalently could set all to 'level-cruise').
  // The D23 mode dispatch was a pre-D24-fixture-recal-era artifact; under
  // V_trim spawn all regimes start at level flight regardless of throttle.
  // D23 mode-dispatch fields below (SINK_RATE_*, AS_MID_*, PITCH_*_DEG, TD_*)
  // are retained for back-compat callers that opt into D23 framing
  // explicitly; they are inert under the new default `regimeMode: undefined`.
  regimeMode: undefined,
  SINK_RATE_LOW_MIN: 1,
  SINK_RATE_LOW_MAX: 5,
  SINK_RATE_MID_MIN: -1,
  SINK_RATE_MID_MAX: 3,
  AS_MID_MIN: 25,
  AS_MID_MAX: 50,
  PITCH_LOW_MIN_DEG: -30,
  PITCH_LOW_MAX_DEG: 10,
  PITCH_MID_DEG: 20,
  PITCH_HIGH_DEG: 15,
  TD_GUARD_TICK_START: 600,
  TD_GUARD_TICK_END: 1800,
  TD_IMBALANCE_LIMIT_N: 500,
  // `airframe` intentionally undefined by default — T=D guard is no-op
  // unless the caller explicitly opts in. Optimizer / score-deployed.mjs
  // can populate this from aircraft.json knobs at call sites that need it.
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

/**
 * D23 T=D regime guard (level-cruise mode only).
 *
 * Sums squared |T - D| excursions above TD_IMBALANCE_LIMIT_N over the tick
 * window [TD_GUARD_TICK_START, TD_GUARD_TICK_END]. Drag is computed from
 * the airframe constants + per-tick airspeed; thrust is per-regime fixed
 * (throttle * thrust_max). No-op if `envelopes.airframe` is undefined or
 * the regime is missing from `throttleByRegime`.
 *
 * Drag model matches arch.md D18 + D21:
 *   q = 0.5 * rho * V²
 *   CL_req = W / (q * S)              (level-flight L=W assumption)
 *   D_par  = CD0 * q * S
 *   D_ind  = k_wing * CL_req² * q * S
 *   D_fus  = cd0_fus_area * q
 *   D_total = D_par + D_ind + D_fus
 */
function tdGuardPenalty(
  rows: readonly TrajectoryRow[],
  envelopes: ScoreEnvelopes,
  regime: string,
): number {
  const af = envelopes.airframe;
  if (!af) return 0;
  const throttle = af.throttleByRegime[regime];
  if (typeof throttle !== 'number') return 0;
  const limit = envelopes.TD_IMBALANCE_LIMIT_N ?? 500;
  const tickStart = envelopes.TD_GUARD_TICK_START ?? 600;
  const tickEnd = envelopes.TD_GUARD_TICK_END ?? 1800;
  const W = af.mass * 9.81;
  const T = throttle * af.thrust_max;
  const rho = 1.225;
  let penalty = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.tick < tickStart) continue;
    if (r.tick > tickEnd) break;
    const V = Math.max(r.airspeed, 1); // avoid div-by-zero at near-zero AS
    const q = 0.5 * rho * V * V;
    const qS = q * af.S_wing;
    const CL_req = W / qS;
    const D_par = af.CD0 * qS;
    const D_ind = af.k_wing * CL_req * CL_req * qS;
    const D_fus = af.cd0_fus_area * q;
    const D_total = D_par + D_ind + D_fus;
    const imbalance = Math.abs(T - D_total);
    const excess = Math.max(0, imbalance - limit);
    penalty += excess * excess;
  }
  return penalty;
}

/**
 * D23 level-cruise score (= D21 behavior + optional T=D regime guard).
 *
 * This is the refactored body of the pre-D23 regimeScore — same precedence
 * (NaN > criterion 0 > envelope penalty) and same envelope penalty terms.
 * T=D guard is additive and gated on `envelopes.airframe`; if absent, it
 * contributes 0 (back-compat for callers that don't opt in).
 */
function levelCruiseScore(
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

  // D26 — per-regime alt envelope with fallback to scalar ALT_ENVELOPE.
  // Reflects natural per-throttle alt behavior (climb at T>>D, cruise at T≈D,
  // descent at T<<D). See arch.md Revision 2026-05-25 late afternoon § D26.
  const altEnv = envelopes.altEnvelope?.[trajectory.regime] ?? envelopes.ALT_ENVELOPE;
  const altPenalty = Math.max(0, maxAltDev - altEnv);
  const asPenalty = Math.max(0, maxAsDev - envelopes.AS_ENVELOPE);
  const prPenalty = Math.max(0, maxPitchRateDegPerSec - envelopes.PITCH_RATE_LIMIT);
  const phuPenalty = phugoidGrowthPenalty(rows, envelopes);
  const tdPenalty = tdGuardPenalty(rows, envelopes, trajectory.regime);

  return -(altPenalty * altPenalty + asPenalty * asPenalty + prPenalty * prPenalty + phuPenalty + tdPenalty);
}

/**
 * D23 controlled-descent score (idle/low throttle).
 *
 * A real Cessna at idle DESCENDS. Success means the airframe is in a
 * bounded sink rate, finite airspeed, pitch within nose-down envelope,
 * no inverted/vertical attitude.
 *
 * Precedence (matches level-cruise):
 *   1. NaN/Infinity → -1e9 + firstNanTick
 *   2. Mode-specific criterion 0 in first 1s window (AS positive, pitch in
 *      bounds, not inverted) → -1e9 + failTick
 *   3. Mode-specific envelope penalty: sink-rate excursion + pitch excursion.
 *
 * Sink rate is computed from posY successive differences: positive sink =
 * descending. Inverted attitude (|pitch| > 90°) fails criterion 0.
 */
function controlledDescentScore(
  trajectory: RegimeTrajectory,
  envelopes: ScoreEnvelopes,
): number {
  const rows = trajectory.rows;
  if (rows.length === 0) return -1e9;
  const nanTick = firstNanTick(rows);
  if (nanTick !== null) return -1e9 + nanTick;

  const sinkMin = envelopes.SINK_RATE_LOW_MIN ?? 1;
  const sinkMax = envelopes.SINK_RATE_LOW_MAX ?? 5;
  const pitchMinDeg = envelopes.PITCH_LOW_MIN_DEG ?? -30;
  const pitchMaxDeg = envelopes.PITCH_LOW_MAX_DEG ?? 10;
  const dtSec = 1 / envelopes.TICK_HZ;
  const windowTicks = Math.floor(envelopes.LEVEL_FLIGHT_WINDOW_SEC * envelopes.TICK_HZ);

  // Mode-specific criterion 0: in first 1s, AS positive + pitch within bounds + not inverted.
  for (let i = 0; i < Math.min(windowTicks, rows.length); i++) {
    const r = rows[i];
    const pitchDeg = r.pitch * (180 / Math.PI);
    if (r.airspeed <= 0) return -1e9 + r.tick;
    if (Math.abs(pitchDeg) > 90) return -1e9 + r.tick; // inverted/vertical
    if (pitchDeg < pitchMinDeg || pitchDeg > pitchMaxDeg) return -1e9 + r.tick;
  }

  // Mode-specific criterion 2 envelope penalty.
  let maxSinkExcess = 0;
  let maxPitchExcessDeg = 0;
  for (let i = 1; i < rows.length; i++) {
    // Sink rate (m/s, positive = descending). vY is up-positive; descent = -vY.
    const sinkRate = -rows[i].vY;
    if (sinkRate < sinkMin) {
      const excess = sinkMin - sinkRate;
      if (excess > maxSinkExcess) maxSinkExcess = excess;
    } else if (sinkRate > sinkMax) {
      const excess = sinkRate - sinkMax;
      if (excess > maxSinkExcess) maxSinkExcess = excess;
    }
    const pitchDeg = rows[i].pitch * (180 / Math.PI);
    if (pitchDeg < pitchMinDeg) {
      const ex = pitchMinDeg - pitchDeg;
      if (ex > maxPitchExcessDeg) maxPitchExcessDeg = ex;
    } else if (pitchDeg > pitchMaxDeg) {
      const ex = pitchDeg - pitchMaxDeg;
      if (ex > maxPitchExcessDeg) maxPitchExcessDeg = ex;
    }
  }
  // Suppress unused-var lint for dtSec (kept for potential future per-tick alt-derived sink rate)
  void dtSec;
  return -(maxSinkExcess * maxSinkExcess + maxPitchExcessDeg * maxPitchExcessDeg);
}

/**
 * D23 slow-flight-or-shallow-descent score (mid throttle).
 *
 * Mid throttle is pattern-speed / slow-flight regime — the airframe may
 * descend slowly or maintain altitude, AS within slow-flight envelope.
 * Pitch envelope is symmetric (±PITCH_MID_DEG) reflecting that slow flight
 * may include slight nose-up trim for AoA.
 */
function slowFlightScore(
  trajectory: RegimeTrajectory,
  envelopes: ScoreEnvelopes,
): number {
  const rows = trajectory.rows;
  if (rows.length === 0) return -1e9;
  const nanTick = firstNanTick(rows);
  if (nanTick !== null) return -1e9 + nanTick;

  const asMin = envelopes.AS_MID_MIN ?? 25;
  const asMax = envelopes.AS_MID_MAX ?? 50;
  const sinkMin = envelopes.SINK_RATE_MID_MIN ?? -1;
  const sinkMax = envelopes.SINK_RATE_MID_MAX ?? 3;
  const pitchHalfDeg = envelopes.PITCH_MID_DEG ?? 20;
  const windowTicks = Math.floor(envelopes.LEVEL_FLIGHT_WINDOW_SEC * envelopes.TICK_HZ);

  // Mode-specific criterion 0: in first 1s, AS within [asMin, asMax] + pitch within ±half + not inverted.
  for (let i = 0; i < Math.min(windowTicks, rows.length); i++) {
    const r = rows[i];
    const pitchDeg = r.pitch * (180 / Math.PI);
    if (r.airspeed < asMin || r.airspeed > asMax) return -1e9 + r.tick;
    if (Math.abs(pitchDeg) > 90) return -1e9 + r.tick;
    if (Math.abs(pitchDeg) > pitchHalfDeg) return -1e9 + r.tick;
  }

  // Mode-specific criterion 2 envelope penalty.
  let maxAsExcess = 0;
  let maxSinkExcess = 0;
  let maxPitchExcessDeg = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.airspeed < asMin) {
      const ex = asMin - r.airspeed;
      if (ex > maxAsExcess) maxAsExcess = ex;
    } else if (r.airspeed > asMax) {
      const ex = r.airspeed - asMax;
      if (ex > maxAsExcess) maxAsExcess = ex;
    }
    const sinkRate = -r.vY;
    if (sinkRate < sinkMin) {
      const ex = sinkMin - sinkRate;
      if (ex > maxSinkExcess) maxSinkExcess = ex;
    } else if (sinkRate > sinkMax) {
      const ex = sinkRate - sinkMax;
      if (ex > maxSinkExcess) maxSinkExcess = ex;
    }
    const pitchDeg = r.pitch * (180 / Math.PI);
    const pitchExcess = Math.max(0, Math.abs(pitchDeg) - pitchHalfDeg);
    if (pitchExcess > maxPitchExcessDeg) maxPitchExcessDeg = pitchExcess;
  }
  return -(maxAsExcess * maxAsExcess + maxSinkExcess * maxSinkExcess + maxPitchExcessDeg * maxPitchExcessDeg);
}

/**
 * Score one regime's trajectory. Returns a non-positive number; higher is better.
 *
 * D23 dispatches on `envelopes.regimeMode?.[trajectory.regime]`:
 *   - 'controlled-descent' → controlledDescentScore (idle/low throttle)
 *   - 'slow-flight-or-shallow-descent' → slowFlightScore (mid throttle)
 *   - 'level-cruise' → levelCruiseScore (= D21 behavior)
 *   - missing/undefined → levelCruiseScore (back-compat default)
 *
 * Back-compat: envelopes without `regimeMode` get D21 behavior unchanged.
 */
export function regimeScore(
  trajectory: RegimeTrajectory,
  envelopes: ScoreEnvelopes,
): number {
  const mode = envelopes.regimeMode?.[trajectory.regime];
  switch (mode) {
    case 'controlled-descent':
      return controlledDescentScore(trajectory, envelopes);
    case 'slow-flight-or-shallow-descent':
      return slowFlightScore(trajectory, envelopes);
    case 'level-cruise':
    case undefined:
      return levelCruiseScore(trajectory, envelopes);
  }
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
