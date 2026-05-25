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
  type ScoreEnvelopes,
} from './score';

// D25 (2026-05-25 afternoon) — DEFAULT_ENVELOPES now ships uniform target=78
// + AS_ENVELOPE=30 + regimeMode=undefined (per arch.md Revision 2026-05-25
// afternoon — D25-ζ). D23's per-regime mode dispatch is still callable but
// no longer default; D21's per-regime targets {45, 60, 85} + AS_ENVELOPE=25
// are no longer default either. The D14/D21-era tests below were authored
// against the D21 numeric semantics (target_mid=60, AS_ENVELOPE=25) — preserve
// that intent by pinning the legacy D21 targets + envelope explicitly. New
// D25-era anti-regression tests at the DEFAULT_ENVELOPES describe block below
// assert on the new D25 defaults.
const LEGACY_LEVEL_CRUISE_ENVELOPES: ScoreEnvelopes = {
  ...DEFAULT_ENVELOPES,
  regimeMode: undefined,
  // D21 historical values — preserve the numeric expectations of D14/D21-era
  // tests authored against these constants. D25 changed only the defaults.
  targetAirspeed: { low: 45, mid: 60, high: 85 },
  AS_ENVELOPE: 25,
};

// D25 (2026-05-25 afternoon) — DEFAULT_ENVELOPES.regimeMode is now undefined.
// D23 mode-dispatch unit tests below relied on the previous DEFAULT_ENVELOPES
// having `regimeMode = {low:'controlled-descent', mid:'slow-flight-...',
// high:'level-cruise'}` and called `regimeScore(traj, DEFAULT_ENVELOPES)`
// expecting that dispatch. Under D25 they must explicitly opt into D23
// framing via this constant.
const D23_MODE_ENVELOPES: ScoreEnvelopes = {
  ...DEFAULT_ENVELOPES,
  regimeMode: {
    low: 'controlled-descent',
    mid: 'slow-flight-or-shallow-descent',
    high: 'level-cruise',
  },
};

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
    const s = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
    // `-(0+0+0+0)` is `-0` in JS; `Object.is(-0, 0)` is false. Use loose
    // equality (toBeCloseTo) so the sign of zero doesn't trip the assert.
    expect(s).toBeCloseTo(0, 12);
  });
});

describe('regimeScore — case (b) mild phugoid', () => {
  it('is finite negative for a small-amplitude oscillation within envelope', () => {
    const traj: RegimeTrajectory = { regime: 'mid', rows: mildPhugoid(600) };
    const s = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
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
    const s = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
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
    expect(regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES)).toBe(-1e9 + 100);
  });

  it('encodes time-to-NaN as -1e9 + nanTick (late NaN, must score higher than early)', () => {
    const earlyTraj: RegimeTrajectory = { regime: 'mid', rows: nanAtTick(600, 100) };
    const lateTraj: RegimeTrajectory = { regime: 'mid', rows: nanAtTick(600, 500) };
    const earlyScore = regimeScore(earlyTraj, LEGACY_LEVEL_CRUISE_ENVELOPES);
    const lateScore = regimeScore(lateTraj, LEGACY_LEVEL_CRUISE_ENVELOPES);
    expect(earlyScore).toBe(-1e9 + 100);
    expect(lateScore).toBe(-1e9 + 500);
    // Late NaN is "better" — under higher-is-better, lateScore > earlyScore
    // so the optimizer's gradient pulls the simplex toward later-NaN points.
    expect(lateScore).toBeGreaterThan(earlyScore);
  });

  it('finite-trajectory scores are always greater than any NaN-trajectory score', () => {
    const finite: RegimeTrajectory = { regime: 'mid', rows: levelCruise(600) };
    const veryLateNan: RegimeTrajectory = { regime: 'mid', rows: nanAtTick(600, 599) };
    expect(regimeScore(finite, LEGACY_LEVEL_CRUISE_ENVELOPES)).toBeGreaterThan(
      regimeScore(veryLateNan, LEGACY_LEVEL_CRUISE_ENVELOPES),
    );
  });
});

describe('regimeScore — case (e) pitch-rate blowup', () => {
  it('is heavily penalized when pitch-rate exceeds PITCH_RATE_LIMIT', () => {
    const traj: RegimeTrajectory = { regime: 'mid', rows: pitchRateBlowup(400, 200) };
    const s = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
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
    const total = score(trajectories, LEGACY_LEVEL_CRUISE_ENVELOPES);
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
    expect(score(trajectories, LEGACY_LEVEL_CRUISE_ENVELOPES)).toBe(0);
  });

  it('is the weighted sum of per-regime scores (verifies the top-level Σ)', () => {
    const t1: RegimeTrajectory = { regime: 'mid', rows: mildPhugoid(600) };
    const t2: RegimeTrajectory = { regime: 'high', rows: mildPhugoid(600) };
    const sum = score([t1, t2], LEGACY_LEVEL_CRUISE_ENVELOPES);
    const s1 = regimeScore(t1, LEGACY_LEVEL_CRUISE_ENVELOPES);
    const s2 = regimeScore(t2, LEGACY_LEVEL_CRUISE_ENVELOPES);
    expect(sum).toBeCloseTo(s1 + s2, 9);
  });

  it('respects per-regime weights from envelopes', () => {
    const envelopes = {
      ...LEGACY_LEVEL_CRUISE_ENVELOPES,
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
    expect(regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES)).toBe(-1e9 + 30);
  });
});

describe('regimeScore — case (b) D21 criterion 0 passes for steady level cruise', () => {
  it('passes criterion 0 and falls through to the envelope-penalty path', () => {
    // Steady cruise at the post-D21 mid target (60 m/s) → criterion 0 passes,
    // criterion 2 envelope penalties are all zero → score is 0 (or near-0 with -0 sign).
    const traj: RegimeTrajectory = { regime: 'mid', rows: levelCruise(600) };
    expect(regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES)).toBeCloseTo(0, 12);
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
    expect(regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES)).toBe(-1e9 + 15);
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
    expect(regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES)).toBe(-1e9 + 20);
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
    const s = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
    expect(s).toBe(-100);
    expect(s).toBeGreaterThan(-1e8); // confirms NOT a NaN/criterion-0 floor score
  });

  it('does not short-circuit criterion 2 when criterion 0 passes', () => {
    // A trajectory whose mild phugoid is inside criterion 0 thresholds AND inside the new
    // tighter AS_ENVELOPE produces a near-zero score (criterion 2's envelope-penalty path).
    const traj: RegimeTrajectory = { regime: 'mid', rows: mildPhugoid(600) };
    const s = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
    // mildPhugoid post-D21 is centered on (50, 60), ±5m altitude (<<20m drop threshold)
    // and ±2 m/s airspeed (<<25 AS_ENVELOPE, well above 10 m/s min). Both criteria pass,
    // envelope penalty is zero.
    expect(s).toBeLessThanOrEqual(0);
    expect(s).toBeGreaterThan(-1);
  });
});

describe('DEFAULT_ENVELOPES — D25 anti-regression on the corrected constants', () => {
  it('targetAirspeed defaults are uniform L=W trim AS=78 for all regimes (D25-ζ; throttle-independent)', () => {
    // D25 corrected D24's per-throttle T=D-derived {45, 78, 128} (and D21's
    // {45, 60, 85}) to uniform V_trim=78 — L=W trim AS is throttle-independent
    // for a fixed-α airframe. See arch.md Revision 2026-05-25 afternoon § D25.
    expect(DEFAULT_ENVELOPES.targetAirspeed.low).toBe(78);
    expect(DEFAULT_ENVELOPES.targetAirspeed.mid).toBe(78);
    expect(DEFAULT_ENVELOPES.targetAirspeed.high).toBe(78);
  });

  it('AS_ENVELOPE widened from 25 to 30 (+5 m/s for natural phugoid amplitude)', () => {
    // D25 widened AS_ENVELOPE from D21's 25 to 30 to accommodate the natural
    // phugoid amplitude observed under fixed integration at V_trim spawn.
    expect(DEFAULT_ENVELOPES.AS_ENVELOPE).toBe(30);
  });

  it('regimeMode default is undefined (D25 reverted D23 mode dispatch; back-compat fallback to all-level-cruise)', () => {
    // D25 reverted D23's per-regime mode-dispatch default. D23 mode-dispatch
    // code stays in score.ts as back-compat-callable; legacy tests construct
    // envelopes with `regimeMode` explicitly per D23 framing.
    expect(DEFAULT_ENVELOPES.regimeMode).toBeUndefined();
  });

  it('LEVEL_FLIGHT_* criterion 0 defaults match arch.md D21 spec (unchanged at D25)', () => {
    expect(DEFAULT_ENVELOPES.LEVEL_FLIGHT_WINDOW_SEC).toBe(1.0);
    expect(DEFAULT_ENVELOPES.LEVEL_FLIGHT_ALT_DROP_MAX).toBe(20);
    expect(DEFAULT_ENVELOPES.LEVEL_FLIGHT_AS_MIN).toBe(10);
  });

  it('catches accidental revert to pre-D25 targetAirspeed (D21 {45, 60, 85} or D24/early-WP14 {25, 30, 40})', () => {
    // The D14→D24 cascade went through multiple per-regime targetAirspeed
    // sets ({25, 30, 40}, {45, 60, 85}, {45, 78, 128}). D25 corrected to
    // uniform 78 per Rule #5 derivation. Catch any silent regression to a
    // per-regime non-uniform default.
    expect(DEFAULT_ENVELOPES.targetAirspeed.mid).not.toBe(30); // pre-D21 value
    expect(DEFAULT_ENVELOPES.targetAirspeed.mid).not.toBe(60); // D21 value
    // low/high must equal mid under D25 (uniform V_trim).
    expect(DEFAULT_ENVELOPES.targetAirspeed.low).toBe(DEFAULT_ENVELOPES.targetAirspeed.mid);
    expect(DEFAULT_ENVELOPES.targetAirspeed.high).toBe(DEFAULT_ENVELOPES.targetAirspeed.mid);
  });
});

// =============================================================================
// WP14.17 (D23-γ-evolved) — per-regime throttle-mode reframe + T=D regime guard
// Seven new cases per arch.md Revision 2026-05-24 (night) "Test additions
// binding for WP14.17" list. Tests use non-round numbers per
// `project_test_param_round_numbers.md` convention where applicable.
// =============================================================================

/** Build a trajectory with explicit per-tick (posY, vY, pitch, airspeed) for D23 mode tests. */
function buildTrajectory(spec: {
  n: number;
  posY: (i: number) => number;
  vY: (i: number) => number;
  pitchRad: (i: number) => number;
  airspeed: (i: number) => number;
}): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < spec.n; i++) {
    out.push(makeRow({
      tick: i,
      posY: spec.posY(i),
      vY: spec.vY(i),
      pitch: spec.pitchRad(i),
      airspeed: spec.airspeed(i),
    }));
  }
  return out;
}

describe('regimeScore D23 t1 — controlled-descent mode, descending trajectory', () => {
  it('returns near-zero score for sink≈3.1 m/s, AS finite, pitch nose-down 20°', () => {
    // Sink rate 3.1 m/s is within [1, 5] envelope; pitch -20° (nose-down) is within [-30, +10].
    // AS positive throughout. No criterion-0 failures, no envelope excursions → score ≈ 0.
    const rows = buildTrajectory({
      n: 600,
      posY: (i) => 100 - 3.1 * (i / 60),
      vY: () => -3.1,
      pitchRad: () => -20 * Math.PI / 180,
      airspeed: () => 42.1,
    });
    const traj: RegimeTrajectory = { regime: 'low', rows };
    const s = regimeScore(traj, D23_MODE_ENVELOPES);
    expect(s).toBeGreaterThanOrEqual(-10);
    expect(s).toBeLessThanOrEqual(0);
  });
});

describe('regimeScore D23 t2 — controlled-descent mode, climbing trajectory (sink-rate violation)', () => {
  it('returns penalty proportional to sink-rate violation when trajectory climbs', () => {
    // Sink rate -2.1 m/s = climbing — outside [1, 5] envelope (below min).
    // Criterion 0 passes (pitch nose-down 5° within [-30, +10], AS positive, not inverted in first 1s).
    // Per-tick sink excess = SINK_RATE_LOW_MIN(1) - (-2.1) = 3.1; max excess = 3.1; pitch within envelope so 0.
    // Score = -(3.1² + 0²) = -9.61.
    const rows = buildTrajectory({
      n: 600,
      posY: (i) => 50 + 2.1 * (i / 60),
      vY: () => 2.1,
      pitchRad: () => -5 * Math.PI / 180,
      airspeed: () => 42.1,
    });
    const traj: RegimeTrajectory = { regime: 'low', rows };
    const s = regimeScore(traj, D23_MODE_ENVELOPES);
    expect(s).toBeLessThanOrEqual(-9);
    expect(s).toBeGreaterThan(-15);
  });
});

describe('regimeScore D23 t3 — slow-flight-or-shallow-descent mode, in-envelope trajectory', () => {
  it('returns near-zero score for AS=35 m/s, sink=1.1 m/s, level pitch', () => {
    // AS 35 within [25, 50], sink 1.1 within [-1, 3], pitch 0 within ±20° → score ≈ 0.
    const rows = buildTrajectory({
      n: 600,
      posY: (i) => 100 - 1.1 * (i / 60),
      vY: () => -1.1,
      pitchRad: () => 0,
      airspeed: () => 35.1,
    });
    const traj: RegimeTrajectory = { regime: 'mid', rows };
    const s = regimeScore(traj, D23_MODE_ENVELOPES);
    expect(s).toBeGreaterThanOrEqual(-10);
    expect(s).toBeLessThanOrEqual(0);
  });
});

describe('regimeScore D23 t4 — level-cruise mode preserves D21 behavior (parity)', () => {
  it('returns the same score as legacy D21 behavior for a level-cruise trajectory', () => {
    // Steady cruise at high-target AS (85 m/s); regime='high' routes through level-cruise mode.
    // Should match legacy (regimeMode=undefined) score bit-for-bit.
    const rows = levelCruise(600, 85);
    const traj: RegimeTrajectory = { regime: 'high', rows };
    const d23Score = regimeScore(traj, DEFAULT_ENVELOPES);
    const legacyScore = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
    expect(d23Score).toBe(legacyScore);
    expect(d23Score).toBeCloseTo(0, 12);
  });
});

describe('regimeScore D23 t5 — back-compat: regimeMode missing falls back to level-cruise', () => {
  it('produces identical output to regimeMode=level-cruise when regimeMode is undefined', () => {
    const rows = levelCruise(600, 85);
    const traj: RegimeTrajectory = { regime: 'high', rows };
    // LEGACY envelopes have regimeMode: undefined.
    const legacyScore = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
    // Build an envelope that explicitly maps 'high' to level-cruise.
    const explicitLevelCruise: ScoreEnvelopes = {
      ...DEFAULT_ENVELOPES,
      regimeMode: { high: 'level-cruise' },
    };
    const explicitScore = regimeScore(traj, explicitLevelCruise);
    expect(legacyScore).toBe(explicitScore);
  });

  it('falls back to level-cruise when regimeMode is present but regime label is missing from it', () => {
    const rows = levelCruise(600, 85);
    const traj: RegimeTrajectory = { regime: 'unknown-regime', rows };
    // 'unknown-regime' is not in regimeMode → fallback to level-cruise.
    // levelCruiseScore uses targetAirspeed; 'unknown-regime' isn't in
    // targetAirspeed either, so the fallback target is 30 m/s (per
    // levelCruiseScore default in score.ts).
    // Under LEGACY (AS_ENVELOPE=25): AS 85 vs target 30 = 55 dev; excess 30 → penalty 900.
    // Under DEFAULT (D25: AS_ENVELOPE=30): AS 85 vs target 30 = 55 dev; excess 25 → penalty 625.
    // The fallback PATH (level-cruise) is taken identically by both; the numeric values
    // differ because LEGACY pins D21's AS_ENVELOPE=25 and DEFAULT now has D25's 30.
    const sLegacy = regimeScore(traj, LEGACY_LEVEL_CRUISE_ENVELOPES);
    expect(sLegacy).toBe(-900);
    const sD23 = regimeScore(traj, DEFAULT_ENVELOPES);
    expect(sD23).toBe(-625);
  });
});

describe('regimeScore D23 t6 — T=D regime guard (level-cruise mode)', () => {
  it('fires when |T-D| > limit at tick >= TD_GUARD_TICK_START', () => {
    // Build a level-cruise trajectory at the airframe's high-regime equilibrium (V≈85 m/s).
    // Then construct two test scenarios:
    //  (balanced) airframe constants such that at V=85, D ≈ T (small imbalance, within limit).
    //  (imbalanced) AS sufficiently below equilibrium that D >> T (induced drag explodes at low V).
    const airframe = {
      mass: 1000,
      thrust_max: 6000,
      S_wing: 12,
      CD0: 0.02,
      k_wing: 0.278,           // WP14.16 globalBest
      cd0_fus_area: 0.190,     // WP14.16 globalBest cd0_fus * area_fus
      throttleByRegime: { high: 0.40 },
    };
    const envelopesWithAirframe: ScoreEnvelopes = {
      ...DEFAULT_ENVELOPES,
      airframe,
    };

    // Balanced: cruise at V≈85 m/s where D≈T=2400N. Should produce 0 or small TD penalty.
    const balancedRows = levelCruise(1800, 85);
    const balancedTraj: RegimeTrajectory = { regime: 'high', rows: balancedRows };
    const balancedScore = regimeScore(balancedTraj, envelopesWithAirframe);

    // Imbalanced after tick 600: AS collapses to 30 m/s (way below equilibrium → induced drag blows up).
    // Construct rows: level at V=85 for first 600 ticks, then drop AS to 30 for ticks 600..1800.
    // But criterion 0 fires at tick 0 if posY drop > 20 — keep posY constant; only change AS.
    const imbalancedRows: TrajectoryRow[] = [];
    for (let i = 0; i < 1800; i++) {
      const airspeed = i < 600 ? 85 : 30;
      imbalancedRows.push(makeRow({ tick: i, posY: 50, airspeed }));
    }
    const imbalancedTraj: RegimeTrajectory = { regime: 'high', rows: imbalancedRows };
    const imbalancedScore = regimeScore(imbalancedTraj, envelopesWithAirframe);

    // Imbalanced has a TD penalty contribution AND an AS-envelope penalty (AS=30 vs target=85 → 55 dev,
    // AS_ENVELOPE=25 → excess 30 → asPenalty²=900). So we expect imbalanced < balanced.
    expect(imbalancedScore).toBeLessThan(balancedScore);

    // To prove the TD guard specifically fires (not just AS envelope), compare to the same imbalanced
    // trajectory under envelopes WITHOUT airframe (TD guard no-op):
    const envelopesNoAirframe: ScoreEnvelopes = { ...DEFAULT_ENVELOPES, airframe: undefined };
    const imbalancedNoTdScore = regimeScore(imbalancedTraj, envelopesNoAirframe);
    // The score with airframe should be MORE negative (additional TD penalty term):
    expect(imbalancedScore).toBeLessThan(imbalancedNoTdScore);
  });

  it('is a no-op before TD_GUARD_TICK_START (transient allowance)', () => {
    const airframe = {
      mass: 1000,
      thrust_max: 6000,
      S_wing: 12,
      CD0: 0.02,
      k_wing: 0.278,
      cd0_fus_area: 0.190,
      throttleByRegime: { high: 0.40 },
    };
    // Trajectory with imbalance only in first 500 ticks (before TD_GUARD_TICK_START=600).
    // After tick 500, AS settles at equilibrium and stays there.
    const rows: TrajectoryRow[] = [];
    for (let i = 0; i < 1800; i++) {
      const airspeed = i < 500 ? 30 : 85;
      rows.push(makeRow({ tick: i, posY: 50, airspeed }));
    }
    const traj: RegimeTrajectory = { regime: 'high', rows };
    const envWithAf: ScoreEnvelopes = { ...DEFAULT_ENVELOPES, airframe };
    const envNoAf: ScoreEnvelopes = { ...DEFAULT_ENVELOPES, airframe: undefined };
    const scoreWithGuard = regimeScore(traj, envWithAf);
    const scoreNoGuard = regimeScore(traj, envNoAf);
    // Should be approximately equal — the TD guard is no-op before tick 600 and zero penalty after
    // because AS settled at equilibrium. The AS-envelope penalty (AS=30 vs target=85, capped at maxAsDev)
    // dominates both scores identically.
    expect(scoreWithGuard).toBe(scoreNoGuard);
  });
});

describe('score D23 t7 — multi-regime dispatch sums correctly per mode', () => {
  it('returns weighted sum dispatching each regime to its mode', () => {
    // Construct 3 trajectories each in their mode's "near-zero penalty" region:
    //   low (controlled-descent): sink 3.1 m/s, pitch -20°, AS 42 — near-zero.
    //   mid (slow-flight): AS 35.1, sink 1.1 m/s, level pitch — near-zero.
    //   high (level-cruise): AS 85 cruise — near-zero (matches D21 mid-target dispatch).
    const lowRows = buildTrajectory({
      n: 600,
      posY: (i) => 100 - 3.1 * (i / 60),
      vY: () => -3.1,
      pitchRad: () => -20 * Math.PI / 180,
      airspeed: () => 42.1,
    });
    const midRows = buildTrajectory({
      n: 600,
      posY: (i) => 100 - 1.1 * (i / 60),
      vY: () => -1.1,
      pitchRad: () => 0,
      airspeed: () => 35.1,
    });
    const highRows = levelCruise(600, 85);
    const trajectories: RegimeTrajectory[] = [
      { regime: 'low', rows: lowRows },
      { regime: 'mid', rows: midRows },
      { regime: 'high', rows: highRows },
    ];
    // D25: explicit D23 mode envelopes (DEFAULT_ENVELOPES.regimeMode is now undefined).
    const total = score(trajectories, D23_MODE_ENVELOPES);
    // Each individual regime's score should be ≥ -10 (near-zero region per t1/t3/t4).
    // Total = sum ≥ -30 and ≤ 0.
    expect(total).toBeGreaterThanOrEqual(-30);
    expect(total).toBeLessThanOrEqual(0);

    // Sanity: verify each per-regime call dispatches to its mode by comparing to direct mode calls.
    const sLow = regimeScore({ regime: 'low', rows: lowRows }, D23_MODE_ENVELOPES);
    const sMid = regimeScore({ regime: 'mid', rows: midRows }, D23_MODE_ENVELOPES);
    const sHigh = regimeScore({ regime: 'high', rows: highRows }, D23_MODE_ENVELOPES);
    expect(total).toBeCloseTo(sLow + sMid + sHigh, 9);
  });

  it('penalizes mode-inappropriate trajectories (low-regime cruise scores far worse than low-regime descent)', () => {
    // A "level cruise" trajectory submitted as the low regime → controlled-descent mode
    // criterion 0 fires (sink=0 outside [1, 5], pitch=0 within bounds; criterion 0 only checks AS+pitch
    // in first window. So criterion 0 passes; envelope penalty for sink violation kicks in:
    // per-tick sink rate is 0, SINK_RATE_LOW_MIN=1 → excess 1 → penalty 1.
    const cruiseRows = levelCruise(600, 42);
    const lowCruiseTraj: RegimeTrajectory = { regime: 'low', rows: cruiseRows };
    const sCruiseAsLow = regimeScore(lowCruiseTraj, DEFAULT_ENVELOPES);
    // Compare to the proper descent at same regime — descent should score better.
    const descentRows = buildTrajectory({
      n: 600,
      posY: (i) => 100 - 3.1 * (i / 60),
      vY: () => -3.1,
      pitchRad: () => -20 * Math.PI / 180,
      airspeed: () => 42.1,
    });
    const sDescentAsLow = regimeScore({ regime: 'low', rows: descentRows }, DEFAULT_ENVELOPES);
    expect(sDescentAsLow).toBeGreaterThan(sCruiseAsLow);
  });
});
