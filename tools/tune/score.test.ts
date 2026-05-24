import { describe, it, expect } from 'vitest';
import type { TrajectoryRow } from '../../src/aircraft/physics-core/trajectory-buffer';
import {
  score,
  regimeScore,
  firstNanTick,
  phugoidGrowthPenalty,
  levelFlightMaintenanceCheck,
  DEFAULT_ENVELOPES,
  type RegimeTrajectory,
} from './score';

// WP14.8 Phase 1 — score function coverage. Per the plan's case list:
//   (a) nominal level-cruise → finite negative near 0
//   (b) mild phugoid → moderate negative
//   (c) NaN at tick 100 → −1e9 − 100
//   (d) NaN at tick 500 → −1e9 − 500 (must beat case c)
//   (e) pitch-rate-blowup at tick 200 → large penalty
//   (f) multi-regime: low+mid pass, high NaN → score dominated by NaN penalty term
// Plus N-dim invariance: trajectories themselves don't carry a param vector,
// so "N-dim invariance" reduces to "score consumes only trajectories" — we
// confirm this structurally by passing identical trajectories under different
// regime labellings.

function makeRow(overrides: Partial<TrajectoryRow> & { tick: number }): TrajectoryRow {
  return {
    tick: overrides.tick,
    posX: overrides.posX ?? 0,
    posY: overrides.posY ?? 50,
    posZ: overrides.posZ ?? 0,
    vX: overrides.vX ?? 0,
    vY: overrides.vY ?? 0,
    vZ: overrides.vZ ?? -60,
    pitch: overrides.pitch ?? 0,
    yaw: overrides.yaw ?? 0,
    roll: overrides.roll ?? 0,
    airspeed: overrides.airspeed ?? 60,
  };
}

/** Steady level cruise — posY constant at 50, airspeed constant at 60 m/s (mid-target post-D21). */
function levelCruise(n: number, airspeed = 60): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makeRow({ tick: i, posY: 50, airspeed }));
  }
  return out;
}

/** Mild phugoid: ±5m altitude sinusoid, constant amplitude, centered on the post-D21 mid target. */
function mildPhugoid(n: number): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / 60;
    out.push(makeRow({
      tick: i,
      posY: 50 + 5 * Math.sin(2 * Math.PI * t / 5), // 5m amplitude, 5s period
      airspeed: 60 + 2 * Math.cos(2 * Math.PI * t / 5),
    }));
  }
  return out;
}

/** Trajectory that NaNs at a specific tick. Rows before are finite cruise (post-D21 mid target). */
function nanAtTick(n: number, nanTick: number): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    if (i >= nanTick) {
      out.push(makeRow({ tick: i, posY: NaN, airspeed: NaN }));
    } else {
      out.push(makeRow({ tick: i, posY: 50, airspeed: 60 }));
    }
  }
  return out;
}

/** Trajectory with a brief pitch-rate spike at a specific tick (post-D21 mid target). */
function pitchRateBlowup(n: number, blowupTick: number): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    // Sudden pitch jump = high pitch-rate
    const pitch = i === blowupTick ? Math.PI / 2 : 0; // 90° in one tick → 90°*60 = 5400 deg/s
    out.push(makeRow({ tick: i, pitch, posY: 50, airspeed: 60 }));
  }
  return out;
}

describe('firstNanTick', () => {
  it('returns null for all-finite trajectory', () => {
    expect(firstNanTick(levelCruise(100))).toBeNull();
  });

  it('returns the tick of the first NaN row', () => {
    expect(firstNanTick(nanAtTick(200, 73))).toBe(73);
  });

  it('detects Infinity as well as NaN', () => {
    const rows = levelCruise(10);
    const inf = makeRow({ tick: 5, posY: Infinity });
    rows[5] = inf;
    expect(firstNanTick(rows)).toBe(5);
  });

  it('returns null on an empty array', () => {
    expect(firstNanTick([])).toBeNull();
  });
});

describe('phugoidGrowthPenalty', () => {
  it('is zero for a constant trajectory', () => {
    expect(phugoidGrowthPenalty(levelCruise(120), DEFAULT_ENVELOPES)).toBe(0);
  });

  it('is zero for a constant-amplitude sinusoid (no growth)', () => {
    // mildPhugoid has constant amplitude across early/late halves
    const pen = phugoidGrowthPenalty(mildPhugoid(600), DEFAULT_ENVELOPES);
    expect(pen).toBeLessThan(1); // tiny residual from sample-boundary noise OK
  });

  it('is positive for a growing-amplitude trajectory', () => {
    // amplitude grows linearly with tick → late half has bigger envelope
    const rows: TrajectoryRow[] = [];
    for (let i = 0; i < 600; i++) {
      const amp = 1 + (i / 600) * 20; // grows 1 → 21m
      const t = i / 60;
      rows.push(makeRow({ tick: i, posY: 50 + amp * Math.sin(2 * Math.PI * t / 5) }));
    }
    expect(phugoidGrowthPenalty(rows, DEFAULT_ENVELOPES)).toBeGreaterThan(0);
  });

  it('is zero for a shrinking-amplitude (damped) trajectory', () => {
    const rows: TrajectoryRow[] = [];
    for (let i = 0; i < 600; i++) {
      const amp = 20 - (i / 600) * 19;
      const t = i / 60;
      rows.push(makeRow({ tick: i, posY: 50 + amp * Math.sin(2 * Math.PI * t / 5) }));
    }
    expect(phugoidGrowthPenalty(rows, DEFAULT_ENVELOPES)).toBe(0);
  });
});

describe('regimeScore — case (a) nominal level-cruise', () => {
  it('is at or near 0 (no penalties trigger) for a steady cruise inside envelopes', () => {
    const traj: RegimeTrajectory = { regime: 'mid', rows: levelCruise(600) };
    const s = regimeScore(traj, DEFAULT_ENVELOPES);
    // `-(0+0+0+0)` is `-0` in JS; `Object.is(-0, 0)` is false. Use loose
    // equality (toBeCloseTo) so the sign of zero doesn't trip the assert.
    expect(s).toBeCloseTo(0, 12);
  });
});

describe('regimeScore — case (b) mild phugoid', () => {
  it('is finite negative for a small-amplitude oscillation within envelope', () => {
    const traj: RegimeTrajectory = { regime: 'mid', rows: mildPhugoid(600) };
    const s = regimeScore(traj, DEFAULT_ENVELOPES);
    // ±5m altitude (within 50 envelope), ±2 m/s airspeed (within 30 envelope),
    // zero pitch-rate, no amplitude growth → score should be 0 or near-0.
    expect(s).toBeLessThanOrEqual(0);
    expect(s).toBeGreaterThan(-1); // not catastrophic
  });

  it('is more negative when the altitude amplitude exceeds the envelope', () => {
    const rows: TrajectoryRow[] = [];
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      rows.push(makeRow({ tick: i, posY: 50 + 80 * Math.sin(2 * Math.PI * t / 5) })); // 80m > 50 env
    }
    const traj: RegimeTrajectory = { regime: 'mid', rows };
    const s = regimeScore(traj, DEFAULT_ENVELOPES);
    expect(s).toBeLessThan(-100); // (80 - 50)^2 = 900, squared again in formula → much larger
  });
});

describe('regimeScore — case (c)/(d) NaN encoding', () => {
  // Per intent of arch.md §D14.4 ("prefer-failing-later" under higher-is-better
  // semantics), NaN penalty encodes time-to-first-NaN as a positive offset:
  // `-1e9 + nanTick`. Earlier NaN → more negative score; later NaN → less
  // negative score; both far below any finite-trajectory score. The arch text
  // literally writes `- nan_tick` which is the inverse — see score.ts header
  // note and the SURFACE in this WP's WIP file.

  it('encodes time-to-NaN as -1e9 + nanTick (early NaN)', () => {
    const traj: RegimeTrajectory = { regime: 'mid', rows: nanAtTick(200, 100) };
    expect(regimeScore(traj, DEFAULT_ENVELOPES)).toBe(-1e9 + 100);
  });

  it('encodes time-to-NaN as -1e9 + nanTick (late NaN, must score higher than early)', () => {
    const earlyTraj: RegimeTrajectory = { regime: 'mid', rows: nanAtTick(600, 100) };
    const lateTraj: RegimeTrajectory = { regime: 'mid', rows: nanAtTick(600, 500) };
    const earlyScore = regimeScore(earlyTraj, DEFAULT_ENVELOPES);
    const lateScore = regimeScore(lateTraj, DEFAULT_ENVELOPES);
    expect(earlyScore).toBe(-1e9 + 100);
    expect(lateScore).toBe(-1e9 + 500);
    // Late NaN is "better" — under higher-is-better, lateScore > earlyScore
    // so the optimizer's gradient pulls the simplex toward later-NaN points.
    expect(lateScore).toBeGreaterThan(earlyScore);
  });

  it('finite-trajectory scores are always greater than any NaN-trajectory score', () => {
    const finite: RegimeTrajectory = { regime: 'mid', rows: levelCruise(600) };
    const veryLateNan: RegimeTrajectory = { regime: 'mid', rows: nanAtTick(600, 599) };
    expect(regimeScore(finite, DEFAULT_ENVELOPES)).toBeGreaterThan(
      regimeScore(veryLateNan, DEFAULT_ENVELOPES),
    );
  });
});

describe('regimeScore — case (e) pitch-rate blowup', () => {
  it('is heavily penalized when pitch-rate exceeds PITCH_RATE_LIMIT', () => {
    const traj: RegimeTrajectory = { regime: 'mid', rows: pitchRateBlowup(400, 200) };
    const s = regimeScore(traj, DEFAULT_ENVELOPES);
    // 90° pitch jump in one tick → ~5400 deg/s; (5400 - 360)^2 = ~25M; squared → ~6.5e14
    expect(s).toBeLessThan(-1e6);
  });
});

describe('score — case (f) multi-regime mixed pass/fail', () => {
  it('is dominated by the NaN regime even when other regimes are clean', () => {
    const trajectories: RegimeTrajectory[] = [
      { regime: 'low', rows: levelCruise(600, 45) },  // clean at post-D21 low target → 0
      { regime: 'mid', rows: levelCruise(600, 60) },  // clean at post-D21 mid target → 0
      { regime: 'high', rows: nanAtTick(600, 50) },   // -1e9 + 50
    ];
    const total = score(trajectories, DEFAULT_ENVELOPES);
    // Total = 0 + 0 + (-1e9 + 50) = -1e9 + 50
    expect(total).toBe(-1e9 + 50);
    // NaN penalty dominates: the clean regimes contribute 0; the NaN regime's
    // huge negative dwarfs any finite-trajectory penalty.
    expect(total).toBeLessThan(-1e8);
  });

  it('passes all regimes with score ~0 when all three are clean cruise (post-D21 targets)', () => {
    const trajectories: RegimeTrajectory[] = [
      { regime: 'low', rows: levelCruise(600, 45) },
      { regime: 'mid', rows: levelCruise(600, 60) },
      { regime: 'high', rows: levelCruise(600, 85) },
    ];
    expect(score(trajectories, DEFAULT_ENVELOPES)).toBe(0);
  });

  it('is the weighted sum of per-regime scores (verifies the top-level Σ)', () => {
    const t1: RegimeTrajectory = { regime: 'mid', rows: mildPhugoid(600) };
    const t2: RegimeTrajectory = { regime: 'high', rows: mildPhugoid(600) };
    const sum = score([t1, t2], DEFAULT_ENVELOPES);
    const s1 = regimeScore(t1, DEFAULT_ENVELOPES);
    const s2 = regimeScore(t2, DEFAULT_ENVELOPES);
    expect(sum).toBeCloseTo(s1 + s2, 9);
  });

  it('respects per-regime weights from envelopes', () => {
    const envelopes = {
      ...DEFAULT_ENVELOPES,
      weightRegime: { low: 1, mid: 2, high: 1 },
    };
    const t: RegimeTrajectory = { regime: 'mid', rows: mildPhugoid(600) };
    const single = score([t], envelopes);
    const sMid = regimeScore(t, envelopes);
    expect(single).toBeCloseTo(2 * sMid, 9);
  });
});

describe('score — structural / dimension-agnostic', () => {
  it('consumes only trajectories, not parameter vectors (verified structurally)', () => {
    // The signature is `score(trajectories, envelopes)`. There is no param
    // vector input. This is N-dim safe by construction — adding more
    // optimizer knobs does not change the score function's API.
    const t1: RegimeTrajectory = { regime: 'mid', rows: levelCruise(60) };
    const t2: RegimeTrajectory = { regime: 'mid', rows: levelCruise(60) };
    expect(score([t1], DEFAULT_ENVELOPES)).toBe(score([t2], DEFAULT_ENVELOPES));
  });

  it('handles an empty trajectory list as score 0', () => {
    expect(score([], DEFAULT_ENVELOPES)).toBe(0);
  });

  it('penalizes an empty rows array with -1e9 (treat as immediate failure)', () => {
    const t: RegimeTrajectory = { regime: 'mid', rows: [] };
    expect(regimeScore(t, DEFAULT_ENVELOPES)).toBe(-1e9);
  });
});

// =============================================================================
// WP14.14b (D21) — criterion 0 level-flight-maintenance probe + envelope re-cal
// Cases (a)–(e) per arch.md Revision 2026-05-24 (evening) verify-self contract.
// =============================================================================

/** Trajectory that drops `dropMeters` below spawnAlt at exactly `dropTick`, otherwise level. */
function altitudeDropAtTick(n: number, dropTick: number, dropMeters: number, spawnAlt = 50): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    const posY = i >= dropTick ? spawnAlt - dropMeters : spawnAlt;
    out.push(makeRow({ tick: i, posY, airspeed: 60 }));
  }
  return out;
}

/** Trajectory whose airspeed collapses to `collapseTo` m/s at `collapseTick`, otherwise level cruise. */
function airspeedCollapseAtTick(n: number, collapseTick: number, collapseTo: number): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    const airspeed = i >= collapseTick ? collapseTo : 60;
    out.push(makeRow({ tick: i, posY: 50, airspeed }));
  }
  return out;
}

describe('levelFlightMaintenanceCheck (D21 criterion 0) — direct unit coverage', () => {
  it('passes for a steady level cruise across the full window', () => {
    const result = levelFlightMaintenanceCheck(levelCruise(120), DEFAULT_ENVELOPES);
    expect(result.passed).toBe(true);
  });

  it('passes for an empty trajectory (no failure can be detected)', () => {
    const result = levelFlightMaintenanceCheck([], DEFAULT_ENVELOPES);
    expect(result.passed).toBe(true);
  });

  it('passes when altitude drop is exactly at the threshold (strict < comparison)', () => {
    // Drop exactly LEVEL_FLIGHT_ALT_DROP_MAX (20m) — should NOT trigger (strict less-than).
    const rows = altitudeDropAtTick(120, 10, DEFAULT_ENVELOPES.LEVEL_FLIGHT_ALT_DROP_MAX);
    const result = levelFlightMaintenanceCheck(rows, DEFAULT_ENVELOPES);
    expect(result.passed).toBe(true);
  });

  it('honors LEVEL_FLIGHT_WINDOW_SEC — a failure beyond the window is ignored', () => {
    // Default window is 1.0s = 60 ticks. Drop at tick 90 is beyond the window.
    const rows = altitudeDropAtTick(120, 90, 50);
    const result = levelFlightMaintenanceCheck(rows, DEFAULT_ENVELOPES);
    expect(result.passed).toBe(true);
  });

  it('respects a custom LEVEL_FLIGHT_WINDOW_SEC that extends the check', () => {
    // Same trajectory as above (drop at tick 90, 50m drop). With a 2.0s window,
    // the check now covers ticks 0..120 and catches the drop.
    const rows = altitudeDropAtTick(150, 90, 50);
    const result = levelFlightMaintenanceCheck(rows, {
      ...DEFAULT_ENVELOPES,
      LEVEL_FLIGHT_WINDOW_SEC: 2.0,
    });
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failTick).toBe(90);
      expect(result.failReason).toBe('altitude_drop');
    }
  });
});

describe('regimeScore — case (a) D21 criterion 0 altitude-drop encoding', () => {
  it('fails criterion 0 when altitude drops 50m at tick 30 (drop exceeds 20m threshold)', () => {
    // Spawn altitude 50m; drop to 0m at tick 30 — exceeds LEVEL_FLIGHT_ALT_DROP_MAX (20m).
    const rows = altitudeDropAtTick(200, 30, 50);
    const result = levelFlightMaintenanceCheck(rows, DEFAULT_ENVELOPES);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failTick).toBe(30);
      expect(result.failReason).toBe('altitude_drop');
    }
    // Regime score should return -1e9 + failTick (prefer-failing-later encoding).
    const traj: RegimeTrajectory = { regime: 'mid', rows };
    expect(regimeScore(traj, DEFAULT_ENVELOPES)).toBe(-1e9 + 30);
  });
});

describe('regimeScore — case (b) D21 criterion 0 passes for steady level cruise', () => {
  it('passes criterion 0 and falls through to the envelope-penalty path', () => {
    // Steady cruise at the post-D21 mid target (60 m/s) → criterion 0 passes,
    // criterion 2 envelope penalties are all zero → score is 0 (or near-0 with -0 sign).
    const traj: RegimeTrajectory = { regime: 'mid', rows: levelCruise(600) };
    expect(regimeScore(traj, DEFAULT_ENVELOPES)).toBeCloseTo(0, 12);
  });
});

describe('regimeScore — case (c) D21 criterion 0 airspeed-collapse encoding', () => {
  it('fails criterion 0 when airspeed collapses to 5 m/s at tick 15 (below 10 m/s threshold)', () => {
    const rows = airspeedCollapseAtTick(200, 15, 5);
    const result = levelFlightMaintenanceCheck(rows, DEFAULT_ENVELOPES);
    expect(result.passed).toBe(false);
    if (!result.passed) {
      expect(result.failTick).toBe(15);
      expect(result.failReason).toBe('airspeed_collapse');
    }
    const traj: RegimeTrajectory = { regime: 'mid', rows };
    expect(regimeScore(traj, DEFAULT_ENVELOPES)).toBe(-1e9 + 15);
  });
});

describe('regimeScore — case (d) D21 precedence: NaN > criterion 0', () => {
  it('returns NaN-tick score when both NaN-at-tick-20 and would-fail-criterion-0-at-tick-30 are present', () => {
    // Construct a trajectory that has BOTH:
    //   1. NaN at tick 20 (would score -1e9 + 20 under criterion 1)
    //   2. Altitude drop > 20m starting at tick 30 (would score -1e9 + 30 under criterion 0
    //      if NaN didn't fire first)
    // NaN check runs first in regimeScore, so the score must be -1e9 + 20, not -1e9 + 30.
    const rows: TrajectoryRow[] = [];
    for (let i = 0; i < 100; i++) {
      let posY = 50;
      let airspeed = 60;
      if (i === 20) {
        posY = NaN;
        airspeed = NaN;
      } else if (i >= 30) {
        posY = 0; // 50m drop — would fail criterion 0
      }
      rows.push(makeRow({ tick: i, posY, airspeed }));
    }
    const traj: RegimeTrajectory = { regime: 'mid', rows };
    expect(regimeScore(traj, DEFAULT_ENVELOPES)).toBe(-1e9 + 20);
  });
});

describe('regimeScore — case (e) D21 precedence: criterion 0 PASS → criterion 2 envelope evaluated normally', () => {
  it('returns the envelope-penalty score when criterion 0 passes but airspeed deviates outside AS_ENVELOPE', () => {
    // Steady "cruise" at airspeed 95 m/s vs post-D21 mid target 60 m/s → deviation = 35 m/s.
    // AS_ENVELOPE post-D21 is 25 m/s, so asPenalty = max(0, 35 - 25) = 10.
    // Per score.ts:159-164, the final score is -(altPenalty^2 + asPenalty^2 + prPenalty^2 + phuPenalty)
    // = -(0 + 100 + 0 + 0) = -100. Criterion 0 passes; this is the envelope-penalty path.
    const rows = levelCruise(600, 95);
    const lf = levelFlightMaintenanceCheck(rows, DEFAULT_ENVELOPES);
    expect(lf.passed).toBe(true);
    const traj: RegimeTrajectory = { regime: 'mid', rows };
    const s = regimeScore(traj, DEFAULT_ENVELOPES);
    expect(s).toBe(-100);
    expect(s).toBeGreaterThan(-1e8); // confirms NOT a NaN/criterion-0 floor score
  });

  it('does not short-circuit criterion 2 when criterion 0 passes', () => {
    // A trajectory whose mild phugoid is inside criterion 0 thresholds AND inside the new
    // tighter AS_ENVELOPE produces a near-zero score (criterion 2's envelope-penalty path).
    const traj: RegimeTrajectory = { regime: 'mid', rows: mildPhugoid(600) };
    const s = regimeScore(traj, DEFAULT_ENVELOPES);
    // mildPhugoid post-D21 is centered on (50, 60), ±5m altitude (<<20m drop threshold)
    // and ±2 m/s airspeed (<<25 AS_ENVELOPE, well above 10 m/s min). Both criteria pass,
    // envelope penalty is zero.
    expect(s).toBeLessThanOrEqual(0);
    expect(s).toBeGreaterThan(-1);
  });
});

describe('DEFAULT_ENVELOPES — D21 anti-regression on the recalibrated constants', () => {
  it('targetAirspeed defaults match the D21-derived L=W equilibrium {low:45, mid:60, high:85}', () => {
    expect(DEFAULT_ENVELOPES.targetAirspeed.low).toBe(45);
    expect(DEFAULT_ENVELOPES.targetAirspeed.mid).toBe(60);
    expect(DEFAULT_ENVELOPES.targetAirspeed.high).toBe(85);
  });

  it('AS_ENVELOPE tightened from the pre-D21 value of 30 to 25', () => {
    expect(DEFAULT_ENVELOPES.AS_ENVELOPE).toBe(25);
  });

  it('LEVEL_FLIGHT_* criterion 0 defaults match arch.md D21 spec', () => {
    expect(DEFAULT_ENVELOPES.LEVEL_FLIGHT_WINDOW_SEC).toBe(1.0);
    expect(DEFAULT_ENVELOPES.LEVEL_FLIGHT_ALT_DROP_MAX).toBe(20);
    expect(DEFAULT_ENVELOPES.LEVEL_FLIGHT_AS_MIN).toBe(10);
  });

  it('catches accidental revert to pre-D21 targetAirspeed mid=30', () => {
    // If a refactor ever sets targetAirspeed.mid back to 30 it would silently
    // re-introduce the bug that the entire D14/D17/D18/D19/D20 cascade ran on.
    expect(DEFAULT_ENVELOPES.targetAirspeed.mid).not.toBe(30);
  });
});
