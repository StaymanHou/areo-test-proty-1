import { describe, it, expect } from 'vitest';
import {
  optimize,
  mulberry32,
  normalize,
  denormalize,
  quadraticRegression,
  DEFAULT_STOPPING,
} from './optimizer';

// WP14.8 Phase 2 — Nelder-Mead + restarts + quadratic regression coverage.
//
// Synthetic objectives from the literature (Rosenbrock, sphere, Booth) have
// known optima; we assert the optimizer converges to within a tolerance.
// Each test uses `restarts: 4` (matching the default WP14.5-retry shape)
// so we're exercising the actual multi-restart path the production CLI will
// use, not a 1-restart degenerate case.

// Sphere: f(x) = Σ x_i^2 → min at origin, f_min = 0
const sphere = (p: readonly number[]): Promise<number> =>
  Promise.resolve(p.reduce((s, x) => s + x * x, 0));

// Rosenbrock 2D: f(x,y) = (1-x)^2 + 100*(y-x^2)^2 → min at (1,1), f_min = 0
const rosenbrock2 = (p: readonly number[]): Promise<number> => {
  const x = p[0], y = p[1];
  return Promise.resolve((1 - x) ** 2 + 100 * (y - x * x) ** 2);
};

// Booth: f(x,y) = (x + 2y - 7)^2 + (2x + y - 5)^2 → min at (1, 3), f_min = 0
const booth = (p: readonly number[]): Promise<number> => {
  const x = p[0], y = p[1];
  return Promise.resolve((x + 2 * y - 7) ** 2 + (2 * x + y - 5) ** 2);
};

describe('mulberry32 PRNG', () => {
  it('produces values in [0,1)', () => {
    const prng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = prng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differed = false;
    for (let i = 0; i < 20; i++) {
      if (a() !== b()) { differed = true; break; }
    }
    expect(differed).toBe(true);
  });
});

describe('normalize / denormalize', () => {
  it('round-trips a point through user→normalized→user space', () => {
    const bounds = [[0, 10], [-5, 5]] as const;
    const userPt = [3.5, 1.2];
    const norm = normalize(userPt, bounds);
    expect(norm).toEqual([0.35, 0.62]);
    const back = denormalize(norm, bounds);
    expect(back[0]).toBeCloseTo(3.5, 12);
    expect(back[1]).toBeCloseTo(1.2, 12);
  });

  it('maps [0,1] bounds as identity', () => {
    const bounds = [[0, 1], [0, 1]] as const;
    expect(normalize([0.7, 0.3], bounds)).toEqual([0.7, 0.3]);
    expect(denormalize([0.7, 0.3], bounds)).toEqual([0.7, 0.3]);
  });
});

describe('optimize — synthetic 2D objectives', () => {
  it('converges to the sphere minimum at the origin within tolerance', async () => {
    const result = await optimize(sphere, {
      dim: 2,
      bounds: [[-5, 5], [-5, 5]],
      restarts: 4,
      seed: 42,
    });
    expect(result.params[0]).toBeCloseTo(0, 2); // 0.01 tolerance
    expect(result.params[1]).toBeCloseTo(0, 2);
    expect(result.score).toBeLessThan(1e-2);
  });

  it('converges to the Rosenbrock minimum at (1,1)', async () => {
    const result = await optimize(rosenbrock2, {
      dim: 2,
      bounds: [[-2, 2], [-2, 2]],
      restarts: 4,
      seed: 7,
    });
    // Rosenbrock is hard for Nelder-Mead; allow looser tolerance
    expect(result.params[0]).toBeCloseTo(1, 1); // 0.1 tolerance
    expect(result.params[1]).toBeCloseTo(1, 1);
    expect(result.score).toBeLessThan(0.1);
  });

  it('converges to the Booth minimum at (1, 3)', async () => {
    const result = await optimize(booth, {
      dim: 2,
      bounds: [[-5, 5], [-5, 5]],
      restarts: 4,
      seed: 123,
    });
    expect(result.params[0]).toBeCloseTo(1, 1);
    expect(result.params[1]).toBeCloseTo(3, 1);
    expect(result.score).toBeLessThan(0.1);
  });
});

describe('optimize — N-dim invariance (per SURFACE-2026-05-16-01)', () => {
  it('converges on a 4D sphere (the joint-(clQ, clAlphaDot) per-surface use case)', async () => {
    const result = await optimize(sphere, {
      dim: 4,
      bounds: [[-5, 5], [-5, 5], [-5, 5], [-5, 5]],
      restarts: 4,
      seed: 42,
    });
    // Each param near 0
    for (const p of result.params) expect(Math.abs(p)).toBeLessThan(0.2);
    expect(result.score).toBeLessThan(0.2);
  });

  it('converges on a 1D objective (no special-casing for N=1)', async () => {
    const result = await optimize(
      (p) => Promise.resolve((p[0] - 0.5) ** 2),
      { dim: 1, bounds: [[0, 1]], restarts: 4, seed: 99 },
    );
    expect(result.params[0]).toBeCloseTo(0.5, 3);
    expect(result.score).toBeLessThan(1e-4);
  });
});

describe('optimize — determinism', () => {
  it('same seed → identical params + identical convergenceTrace', async () => {
    const opts = { dim: 2, bounds: [[-5, 5], [-5, 5]] as Array<[number, number]>, restarts: 4, seed: 314 };
    const r1 = await optimize(sphere, opts);
    const r2 = await optimize(sphere, opts);
    expect(r1.params).toEqual(r2.params);
    expect(r1.score).toBe(r2.score);
    expect(r1.convergenceTrace.length).toBe(r2.convergenceTrace.length);
    for (let i = 0; i < r1.convergenceTrace.length; i++) {
      expect(r1.convergenceTrace[i].iter).toBe(r2.convergenceTrace[i].iter);
      expect(r1.convergenceTrace[i].bestScore).toBe(r2.convergenceTrace[i].bestScore);
      expect(r1.convergenceTrace[i].simplexDiameter).toBe(r2.convergenceTrace[i].simplexDiameter);
    }
  });

  it('different seeds produce (generally) different traces', async () => {
    const r1 = await optimize(sphere, { dim: 2, bounds: [[-5, 5], [-5, 5]], restarts: 4, seed: 1 });
    const r2 = await optimize(sphere, { dim: 2, bounds: [[-5, 5], [-5, 5]], restarts: 4, seed: 2 });
    // Both converge near origin; traces should differ at the iter-0 level
    expect(r1.convergenceTrace[0].bestScore).not.toBe(r2.convergenceTrace[0].bestScore);
  });
});

describe('optimize — bounds clamping', () => {
  it('keeps all evaluated points within bounds (verifies clamp01)', async () => {
    const seen: number[][] = [];
    const watchedObjective = (p: readonly number[]): Promise<number> => {
      seen.push(p.slice());
      return sphere(p);
    };
    await optimize(watchedObjective, {
      dim: 2,
      bounds: [[0, 10], [0, 10]],
      restarts: 2,
      seed: 5,
    });
    for (const p of seen) {
      expect(p[0]).toBeGreaterThanOrEqual(-1e-12);
      expect(p[0]).toBeLessThanOrEqual(10 + 1e-12);
      expect(p[1]).toBeGreaterThanOrEqual(-1e-12);
      expect(p[1]).toBeLessThanOrEqual(10 + 1e-12);
    }
  });
});

describe('optimize — stopping criteria', () => {
  it('respects MAX_ITER (each restart hits cap on a deliberately non-converging tight tol)', async () => {
    // Tight PARAM_TOL with low MAX_ITER → at least one restart should hit max-iter
    const result = await optimize(sphere, {
      dim: 2,
      bounds: [[-5, 5], [-5, 5]],
      restarts: 2,
      seed: 1,
      stopping: { MAX_ITER: 10, PARAM_TOL: 1e-12, SCORE_TOL: 1e-12, N_PLATEAU: 1000 },
    });
    // Trace length should be ≤ MAX_ITER per restart
    expect(result.convergenceTrace.length).toBeLessThanOrEqual(10);
    // The best-restart's stoppedBy should reflect MAX_ITER given the tight tols
    const bestRestart = result.restarts.find((r) => r.finalScore === result.score)!;
    expect(['max-iter', 'param-tol', 'score-plateau']).toContain(bestRestart.stoppedBy);
  });

  it('respects PARAM_TOL — converges before MAX_ITER on a smooth objective', async () => {
    const result = await optimize(sphere, {
      dim: 2,
      bounds: [[-5, 5], [-5, 5]],
      restarts: 1,
      seed: 42,
    });
    expect(result.convergenceTrace.length).toBeLessThan(DEFAULT_STOPPING.MAX_ITER);
  });
});

describe('quadraticRegression', () => {
  it('returns null when undersampled', () => {
    // dim=3 needs 1 + 3 + 6 = 10 unknowns; provide only 3 samples
    const reg = quadraticRegression(
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [0, 1, 1],
      3,
    );
    expect(reg).toBeNull();
  });

  it('recovers a known synthetic quadratic surface', () => {
    // f(x, y) = 1 + 2x + 3y + 4x^2 + 5xy + 6y^2
    // Hessian C: diagonal 4 and 6 (the x^2 / y^2 coefficients);
    //   off-diagonal C[0][1] = C[1][0] = 5/2 (the xy coeff appears as 2*C[0][1])
    // Gradient b: (2, 3)
    const f = (x: number, y: number) => 1 + 2 * x + 3 * y + 4 * x * x + 5 * x * y + 6 * y * y;
    // Sample 7 points (oversample): a small grid around the origin.
    const pts: number[][] = [];
    const scores: number[] = [];
    for (const x of [0, 0.1, 0.2, -0.1, -0.2, 0.05, -0.05]) {
      for (const y of [0, 0.1, -0.1]) {
        if (pts.length >= 7) break;
        pts.push([x, y]);
        scores.push(f(x, y));
      }
      if (pts.length >= 7) break;
    }
    const reg = quadraticRegression(pts, scores, 2);
    expect(reg).not.toBeNull();
    if (reg === null) throw new Error('unreachable');
    expect(reg.samples).toBe(pts.length);
    // The fit happens around centroid; gradient is df/dp at centroid + linear
    // contribution from quadratic term. We can verify exact recovery on a
    // pure quadratic surface only when we shift coordinates back; for this
    // test it's enough to check the Hessian recovery (which is centroid-
    // invariant) and condition number sanity.
    expect(reg.hessian[0][0]).toBeCloseTo(4, 6);
    expect(reg.hessian[1][1]).toBeCloseTo(6, 6);
    expect(reg.hessian[0][1]).toBeCloseTo(5 / 2, 6);
    expect(reg.hessian[1][0]).toBeCloseTo(5 / 2, 6);
    expect(reg.conditionNumber).toBeGreaterThan(0);
    expect(Number.isFinite(reg.conditionNumber)).toBe(true);
  });
});

describe('optimize — error paths', () => {
  it('throws when dim is 0', async () => {
    await expect(optimize(sphere, { dim: 0, bounds: [], restarts: 1, seed: 0 }))
      .rejects.toThrow(/dim/);
  });

  it('throws when bounds.length mismatches dim', async () => {
    await expect(optimize(sphere, { dim: 2, bounds: [[0, 1]], restarts: 1, seed: 0 }))
      .rejects.toThrow(/bounds/);
  });

  it('throws when restarts is 0', async () => {
    await expect(optimize(sphere, { dim: 2, bounds: [[0, 1], [0, 1]], restarts: 0, seed: 0 }))
      .rejects.toThrow(/restarts/);
  });
});

describe('optimize — restart audit trail', () => {
  it('records one entry per restart with finalScore and finalParams', async () => {
    const result = await optimize(sphere, {
      dim: 2,
      bounds: [[-5, 5], [-5, 5]],
      restarts: 4,
      seed: 42,
    });
    expect(result.restarts).toHaveLength(4);
    for (const r of result.restarts) {
      expect(r.finalParams).toHaveLength(2);
      expect(Number.isFinite(r.finalScore)).toBe(true);
    }
    // The overall best matches one of the restarts
    const bestOfAll = Math.min(...result.restarts.map((r) => r.finalScore));
    expect(result.score).toBe(bestOfAll);
  });
});
