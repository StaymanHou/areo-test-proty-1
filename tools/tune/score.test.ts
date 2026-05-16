import { describe, it, expect } from 'vitest';
import type { TrajectoryRow } from '../../src/aircraft/physics-core/trajectory-buffer';
import {
  score,
  regimeScore,
  firstNanTick,
  phugoidGrowthPenalty,
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
    vZ: overrides.vZ ?? -30,
    pitch: overrides.pitch ?? 0,
    yaw: overrides.yaw ?? 0,
    roll: overrides.roll ?? 0,
    airspeed: overrides.airspeed ?? 30,
  };
}

/** Steady level cruise — posY constant at 50, airspeed constant at 30 m/s. */
function levelCruise(n: number, airspeed = 30): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makeRow({ tick: i, posY: 50, airspeed }));
  }
  return out;
}

/** Mild phugoid: ±5m altitude sinusoid, constant amplitude. */
function mildPhugoid(n: number): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / 60;
    out.push(makeRow({
      tick: i,
      posY: 50 + 5 * Math.sin(2 * Math.PI * t / 5), // 5m amplitude, 5s period
      airspeed: 30 + 2 * Math.cos(2 * Math.PI * t / 5),
    }));
  }
  return out;
}

/** Trajectory that NaNs at a specific tick. Rows before are finite cruise. */
function nanAtTick(n: number, nanTick: number): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    if (i >= nanTick) {
      out.push(makeRow({ tick: i, posY: NaN, airspeed: NaN }));
    } else {
      out.push(makeRow({ tick: i, posY: 50, airspeed: 30 }));
    }
  }
  return out;
}

/** Trajectory with a brief pitch-rate spike at a specific tick. */
function pitchRateBlowup(n: number, blowupTick: number): TrajectoryRow[] {
  const out: TrajectoryRow[] = [];
  for (let i = 0; i < n; i++) {
    // Sudden pitch jump = high pitch-rate
    const pitch = i === blowupTick ? Math.PI / 2 : 0; // 90° in one tick → 90°*60 = 5400 deg/s
    out.push(makeRow({ tick: i, pitch, posY: 50, airspeed: 30 }));
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
      { regime: 'low', rows: levelCruise(600, 25) }, // clean → 0
      { regime: 'mid', rows: levelCruise(600, 30) }, // clean → 0
      { regime: 'high', rows: nanAtTick(600, 50) },  // -1e9 + 50
    ];
    const total = score(trajectories, DEFAULT_ENVELOPES);
    // Total = 0 + 0 + (-1e9 + 50) = -1e9 + 50
    expect(total).toBe(-1e9 + 50);
    // NaN penalty dominates: the clean regimes contribute 0; the NaN regime's
    // huge negative dwarfs any finite-trajectory penalty.
    expect(total).toBeLessThan(-1e8);
  });

  it('passes all regimes with score ~0 when all three are clean cruise', () => {
    const trajectories: RegimeTrajectory[] = [
      { regime: 'low', rows: levelCruise(600, 25) },
      { regime: 'mid', rows: levelCruise(600, 30) },
      { regime: 'high', rows: levelCruise(600, 40) },
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
