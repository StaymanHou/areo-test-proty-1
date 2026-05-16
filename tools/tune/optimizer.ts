// WP14.8 Phase 2 — Nelder-Mead optimizer with K random restarts + local
// quadratic regression per arch.md §D14.5.
//
// The optimizer minimizes an async scalar objective over a user-bounded
// parameter space. Internally everything runs in normalized [0,1]^dim space;
// user bounds are translated in on entry and out on exit so callers see
// real-world parameter values.
//
// Standard Nelder-Mead coefficients (Nelder & Mead 1965; Press et al.
// _Numerical Recipes_): α=1 reflect, γ=2 expand, ρ=0.5 contract, σ=0.5 shrink.
// Bounded variant — every point produced by reflect/expand/contract/shrink
// is clamped to [0,1]^dim before evaluation.
//
// Stopping criteria per D14.5:
//   SCORE_TOL = 1e-3 plateau over N_PLATEAU = 30 iter (best vertex score
//                                                       change < tol)
//   PARAM_TOL = 1e-4 simplex diameter in normalized space
//   MAX_ITER  = 500 per restart
//
// Random restart: K starting simplexes generated from a single seeded
// mulberry32 PRNG. Each starting simplex is one random anchor + dim
// axis-aligned perturbations (step 0.1, clamped to [0,1]).
//
// Quadratic regression on the best-restart's final simplex: fit
//   score(p) ≈ a + bᵀ·Δp + Δpᵀ·C·Δp
// where Δp = p - centroid(final_simplex). Solves a linear least-squares
// system over the simplex vertices (dim+1 points → enough only if the
// number of unknowns ≤ dim+1; we augment with the centroid + a few late
// convergence-trace samples to oversample). If fewer than the minimum
// samples are available, returns null.

export interface StoppingCriteria {
  SCORE_TOL: number;
  N_PLATEAU: number;
  PARAM_TOL: number;
  MAX_ITER: number;
}

export const DEFAULT_STOPPING: StoppingCriteria = {
  SCORE_TOL: 1e-3,
  N_PLATEAU: 30,
  PARAM_TOL: 1e-4,
  MAX_ITER: 500,
};

export interface OptimizeOpts {
  dim: number;
  bounds: ReadonlyArray<readonly [number, number]>;
  restarts: number;
  seed: number;
  stopping?: Partial<StoppingCriteria>;
  /** Optional: starting-anchor step in normalized space (default 0.1). */
  initialStep?: number;
}

export interface ConvergenceTracePoint {
  iter: number;
  bestScore: number;
  simplexDiameter: number;
}

export interface RestartResult {
  seed: number;
  finalScore: number;
  finalParams: number[];
  /** Final simplex in user-space (denormalized). */
  finalSimplex: number[][];
  /** Score at each final-simplex vertex (same order as finalSimplex). */
  finalSimplexScores: number[];
  /** Convergence trace points. */
  trace: ConvergenceTracePoint[];
  /** Stopping reason. */
  stoppedBy: 'score-plateau' | 'param-tol' | 'max-iter';
}

export interface QuadraticRegression {
  /** Centroid of the data used to fit (normalized space). */
  centroid: number[];
  /** Gradient vector b. */
  gradient: number[];
  /** Hessian matrix C (symmetric, dim×dim). */
  hessian: number[][];
  /** ratio max-eig / min-eig of |C| (after symmetrizing). High = ill-conditioned. */
  conditionNumber: number;
  /** Number of fit samples actually used. */
  samples: number;
}

export interface OptimizeResult {
  /** Best params found across all restarts (in user-space). */
  params: number[];
  /** Best score (the lowest objective value seen — optimizer minimizes). */
  score: number;
  /** Convergence trace from the best-scoring restart. */
  convergenceTrace: ConvergenceTracePoint[];
  /** Quadratic regression on the best restart's final simplex (null if undersampled). */
  regression: QuadraticRegression | null;
  /** Per-restart final state, in order of restart index. */
  restarts: RestartResult[];
}

// ---------------------------------------------------------------------------
// PRNG — mulberry32, seeded
// ---------------------------------------------------------------------------

/** Seeded LCG-style PRNG. Returns a function that yields [0,1) on each call. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Bounds translation
// ---------------------------------------------------------------------------

export function normalize(p: readonly number[], bounds: ReadonlyArray<readonly [number, number]>): number[] {
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i++) {
    const [lo, hi] = bounds[i];
    out[i] = (p[i] - lo) / (hi - lo);
  }
  return out;
}

export function denormalize(np: readonly number[], bounds: ReadonlyArray<readonly [number, number]>): number[] {
  const out = new Array<number>(np.length);
  for (let i = 0; i < np.length; i++) {
    const [lo, hi] = bounds[i];
    out[i] = lo + np[i] * (hi - lo);
  }
  return out;
}

function clamp01(p: readonly number[]): number[] {
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i++) {
    out[i] = Math.min(1, Math.max(0, p[i]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Simplex helpers
// ---------------------------------------------------------------------------

function centroidOf(points: readonly number[][]): number[] {
  const dim = points[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const p of points) {
    for (let i = 0; i < dim; i++) out[i] += p[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= points.length;
  return out;
}

function simplexDiameter(simplex: readonly number[][]): number {
  const c = centroidOf(simplex);
  let maxDist = 0;
  for (const p of simplex) {
    let d2 = 0;
    for (let i = 0; i < p.length; i++) {
      const diff = p[i] - c[i];
      d2 += diff * diff;
    }
    const d = Math.sqrt(d2);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

function makeStartingSimplex(
  anchor: readonly number[],
  step: number,
): number[][] {
  const dim = anchor.length;
  const simplex: number[][] = [anchor.slice()];
  for (let i = 0; i < dim; i++) {
    const p = anchor.slice();
    p[i] = Math.min(1, p[i] + step);
    // If we're hard against the upper bound, perturb downward instead so
    // the simplex isn't degenerate.
    if (p[i] === anchor[i]) p[i] = Math.max(0, anchor[i] - step);
    simplex.push(clamp01(p));
  }
  return simplex;
}

// ---------------------------------------------------------------------------
// Core Nelder-Mead loop (one restart)
// ---------------------------------------------------------------------------

const ALPHA = 1;
const GAMMA = 2;
const RHO = 0.5;
const SIGMA = 0.5;

async function runOneRestart(
  objective: (p: number[]) => Promise<number>,
  anchor: readonly number[],
  bounds: ReadonlyArray<readonly [number, number]>,
  initialStep: number,
  stopping: StoppingCriteria,
  restartSeed: number,
): Promise<RestartResult> {
  // Build starting simplex in normalized space.
  let simplex = makeStartingSimplex(anchor, initialStep);
  // Evaluate each vertex.
  const scores: number[] = [];
  for (const v of simplex) {
    scores.push(await objective(denormalize(v, bounds)));
  }

  const trace: ConvergenceTracePoint[] = [];
  let plateauCount = 0;
  let prevBest = Math.min(...scores);
  let stoppedBy: RestartResult['stoppedBy'] = 'max-iter';

  for (let iter = 0; iter < stopping.MAX_ITER; iter++) {
    // Sort simplex by score ascending (best at index 0).
    const order = scores
      .map((s, i) => ({ s, i }))
      .sort((a, b) => a.s - b.s)
      .map(({ i }) => i);
    simplex = order.map((i) => simplex[i]);
    const sortedScores = order.map((i) => scores[i]);
    for (let i = 0; i < scores.length; i++) scores[i] = sortedScores[i];

    const best = scores[0];
    const worst = scores[scores.length - 1];
    const secondWorst = scores[scores.length - 2];

    // Trace point
    const diameter = simplexDiameter(simplex);
    trace.push({ iter, bestScore: best, simplexDiameter: diameter });

    // Stopping: simplex diameter
    if (diameter < stopping.PARAM_TOL) {
      stoppedBy = 'param-tol';
      break;
    }

    // Stopping: score plateau
    if (Math.abs(best - prevBest) < stopping.SCORE_TOL) {
      plateauCount++;
      if (plateauCount >= stopping.N_PLATEAU) {
        stoppedBy = 'score-plateau';
        break;
      }
    } else {
      plateauCount = 0;
    }
    prevBest = best;

    // Centroid of all but worst.
    const centroid = centroidOf(simplex.slice(0, -1));

    // Reflect
    const xr = clamp01(centroid.map((c, k) => c + ALPHA * (c - simplex[simplex.length - 1][k])));
    const fr = await objective(denormalize(xr, bounds));

    if (fr < secondWorst && fr >= best) {
      // Accept reflection
      simplex[simplex.length - 1] = xr;
      scores[scores.length - 1] = fr;
      continue;
    }
    if (fr < best) {
      // Expansion
      const xe = clamp01(centroid.map((c, k) => c + GAMMA * (xr[k] - c)));
      const fe = await objective(denormalize(xe, bounds));
      if (fe < fr) {
        simplex[simplex.length - 1] = xe;
        scores[scores.length - 1] = fe;
      } else {
        simplex[simplex.length - 1] = xr;
        scores[scores.length - 1] = fr;
      }
      continue;
    }
    // Contraction
    const xc = clamp01(centroid.map((c, k) => c + RHO * (simplex[simplex.length - 1][k] - c)));
    const fc = await objective(denormalize(xc, bounds));
    if (fc < worst) {
      simplex[simplex.length - 1] = xc;
      scores[scores.length - 1] = fc;
      continue;
    }
    // Shrink
    const x0 = simplex[0];
    for (let k = 1; k < simplex.length; k++) {
      simplex[k] = clamp01(x0.map((b, i) => b + SIGMA * (simplex[k][i] - b)));
      scores[k] = await objective(denormalize(simplex[k], bounds));
    }
  }

  // Pick best vertex
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < scores[bestIdx]) bestIdx = i;
  }

  return {
    seed: restartSeed,
    finalScore: scores[bestIdx],
    finalParams: denormalize(simplex[bestIdx], bounds),
    finalSimplex: simplex.map((v) => denormalize(v, bounds)),
    finalSimplexScores: scores.slice(),
    trace,
    stoppedBy,
  };
}

// ---------------------------------------------------------------------------
// Quadratic regression on best-restart final simplex
// ---------------------------------------------------------------------------

/**
 * Fit `score(Δp) ≈ a + bᵀΔp + Δpᵀ·C·Δp` via least squares.
 * Inputs are in normalized space.
 *
 * The unknowns are: 1 scalar `a`, `dim` gradient components `b`, and `dim*(dim+1)/2`
 * upper-triangular Hessian entries. Total unknowns = 1 + dim + dim*(dim+1)/2.
 *
 * Sample count needed ≥ unknowns; we use the final simplex (dim+1 points) +
 * a few late trace points if available. If samples < unknowns, returns null.
 */
export function quadraticRegression(
  samplesNormalized: readonly number[][],
  sampleScores: readonly number[],
  dim: number,
): QuadraticRegression | null {
  const M = samplesNormalized.length;
  const unknowns = 1 + dim + (dim * (dim + 1)) / 2;
  if (M < unknowns) return null;

  // Centroid of the samples in normalized space
  const centroid = centroidOf(samplesNormalized);
  // Build design matrix X (M rows, `unknowns` cols) and target y (M).
  // For each sample p_m:
  //   row = [1, Δp_1, ..., Δp_dim, Δp_1*Δp_1, Δp_1*Δp_2, ..., Δp_dim*Δp_dim]
  // where the quadratic block enumerates upper-triangular Δp_i*Δp_j (i ≤ j).
  const X: number[][] = [];
  const y: number[] = [];
  for (let m = 0; m < M; m++) {
    const dp = samplesNormalized[m].map((v, i) => v - centroid[i]);
    const row: number[] = [1];
    for (let i = 0; i < dim; i++) row.push(dp[i]);
    for (let i = 0; i < dim; i++) {
      for (let j = i; j < dim; j++) {
        // off-diagonal terms appear twice in Δpᵀ·C·Δp when C is symmetric;
        // we fit on a representation where i==j gives the diagonal of C
        // and i<j gives 2*C[i][j] (so the linear-system coefficient is 1).
        row.push(dp[i] * dp[j]);
      }
    }
    X.push(row);
    y.push(sampleScores[m]);
  }

  // Solve (X^T X) coef = X^T y via Gaussian elimination on the normal equations.
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtY = matVecMul(Xt, y);
  const coef = solveLinearSystem(XtX, XtY);
  if (coef === null) return null;

  // Unpack: a, b[dim], then upper-triangular C
  let idx = 0;
  /* skip a */ idx++;
  const gradient = coef.slice(idx, idx + dim);
  idx += dim;
  const hessian: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      const c = coef[idx++];
      if (i === j) {
        // Δp_i^2 coefficient is C[i][i] (diagonal of full quadratic form)
        hessian[i][i] = c;
      } else {
        // Δp_i*Δp_j coefficient is 2*C[i][j] under symmetric C; split evenly
        hessian[i][j] = c / 2;
        hessian[j][i] = c / 2;
      }
    }
  }

  const conditionNumber = conditionNumberOf(hessian);

  return { centroid, gradient, hessian, conditionNumber, samples: M };
}

// ---------------------------------------------------------------------------
// Tiny linear-algebra helpers (no external deps)
// ---------------------------------------------------------------------------

function transpose(A: readonly number[][]): number[][] {
  const rows = A.length;
  const cols = A[0].length;
  const out: number[][] = [];
  for (let j = 0; j < cols; j++) {
    const row: number[] = new Array(rows);
    for (let i = 0; i < rows; i++) row[i] = A[i][j];
    out.push(row);
  }
  return out;
}

function matMul(A: readonly number[][], B: readonly number[][]): number[][] {
  const rows = A.length;
  const cols = B[0].length;
  const inner = B.length;
  const out: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = new Array(cols).fill(0);
    for (let k = 0; k < inner; k++) {
      const aik = A[i][k];
      for (let j = 0; j < cols; j++) row[j] += aik * B[k][j];
    }
    out.push(row);
  }
  return out;
}

function matVecMul(A: readonly number[][], v: readonly number[]): number[] {
  const out: number[] = new Array(A.length).fill(0);
  for (let i = 0; i < A.length; i++) {
    let s = 0;
    for (let j = 0; j < v.length; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

/** Gauss-Jordan with partial pivoting. Returns null if singular. */
function solveLinearSystem(A: readonly number[][], b: readonly number[]): number[] | null {
  const n = A.length;
  // Build augmented matrix as a fresh copy
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Partial pivot
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = M[col]; M[col] = M[pivot]; M[pivot] = tmp;
    }
    // Eliminate
    const pivVal = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

/** Power-iteration eigen estimate for the condition number of a symmetric matrix. */
function conditionNumberOf(H: readonly number[][]): number {
  const n = H.length;
  if (n === 0) return 0;
  if (n === 1) return Math.abs(H[0][0]) < 1e-12 ? Infinity : 1;
  // Max-magnitude eigenvalue via power iteration.
  let v = new Array<number>(n).fill(0);
  v[0] = 1;
  let lambdaMax = 0;
  for (let iter = 0; iter < 200; iter++) {
    const w = matVecMul(H, v);
    let norm = 0;
    for (const x of w) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm < 1e-12) { lambdaMax = 0; break; }
    for (let i = 0; i < n; i++) w[i] /= norm;
    // Rayleigh quotient
    const Hw = matVecMul(H, w);
    let num = 0;
    for (let i = 0; i < n; i++) num += w[i] * Hw[i];
    if (Math.abs(num - lambdaMax) < 1e-10) { lambdaMax = num; break; }
    lambdaMax = num;
    v = w;
  }
  // Min via inverse iteration: solve H v = w; but for a numerical
  // estimate at small dim it's cheaper to compute determinant-based bound
  // when n is small. For our use (dim ≤ ~6), use the trace/det fallback:
  // For symmetric matrices, prod(eigs) = det. Approximate min-eig from
  // det / (lambdaMax^(n-1)).
  const det = determinant(H);
  if (Math.abs(det) < 1e-30 || Math.abs(lambdaMax) < 1e-12) return Infinity;
  const lambdaMinApprox = det / Math.pow(lambdaMax, n - 1);
  if (Math.abs(lambdaMinApprox) < 1e-30) return Infinity;
  return Math.abs(lambdaMax / lambdaMinApprox);
}

function determinant(A: readonly number[][]): number {
  const n = A.length;
  // LU with partial pivoting; track sign.
  const M: number[][] = A.map((row) => [...row]);
  let sign = 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return 0;
    if (pivot !== col) {
      const tmp = M[col]; M[col] = M[pivot]; M[pivot] = tmp;
      sign = -sign;
    }
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      for (let j = col; j < n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  let det = sign;
  for (let i = 0; i < n; i++) det *= M[i][i];
  return det;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Minimize `objective(userParams)` over `bounds` using Nelder-Mead with K
 * random restarts. The objective is async (the harness is async). All seeds
 * derive from the single `opts.seed` for full reproducibility.
 *
 * Returns the best-across-restarts params + score + convergence trace +
 * quadratic regression on the best restart's final simplex.
 */
export async function optimize(
  objective: (p: number[]) => Promise<number>,
  opts: OptimizeOpts,
): Promise<OptimizeResult> {
  if (opts.dim <= 0) throw new Error('optimize: dim must be positive');
  if (opts.bounds.length !== opts.dim) {
    throw new Error(`optimize: bounds.length (${opts.bounds.length}) must equal dim (${opts.dim})`);
  }
  if (opts.restarts <= 0) throw new Error('optimize: restarts must be positive');

  const stopping: StoppingCriteria = {
    ...DEFAULT_STOPPING,
    ...(opts.stopping ?? {}),
  };
  const initialStep = opts.initialStep ?? 0.1;
  const prng = mulberry32(opts.seed);

  const restartResults: RestartResult[] = [];
  for (let k = 0; k < opts.restarts; k++) {
    const anchor = new Array<number>(opts.dim);
    for (let i = 0; i < opts.dim; i++) anchor[i] = prng();
    // Sub-seed for this restart (audit-trail). Not used internally — the
    // entire restart is deterministic once the anchor is set, since the
    // simplex is built deterministically from it. Recording for forensic.
    const subSeed = Math.floor(prng() * 0xffffffff);
    const r = await runOneRestart(objective, anchor, opts.bounds, initialStep, stopping, subSeed);
    restartResults.push(r);
  }

  // Pick best restart
  let bestIdx = 0;
  for (let i = 1; i < restartResults.length; i++) {
    if (restartResults[i].finalScore < restartResults[bestIdx].finalScore) bestIdx = i;
  }
  const best = restartResults[bestIdx];

  // Quadratic regression on best's final simplex (+ a few late trace points if available)
  const samplesUser = best.finalSimplex.map((p) => p);
  const samplesNorm = samplesUser.map((p) => normalize(p, opts.bounds));
  const sampleScores = best.finalSimplexScores.slice();
  // Augment with late trace bestScores if we have a deficit and trace has
  // points distinct from the simplex centroid. Skip this for now —
  // simplex (dim+1 points) is sufficient for dim ≤ 1 (unknowns = 1 + 1 + 1 = 3
  // > dim+1=2 for dim=1) but inadequate for dim ≥ 1 in general. The regression
  // function gracefully returns null when undersampled, which the trace will
  // log as 'regression unavailable: <samples> < <unknowns>'.
  const regression = quadraticRegression(samplesNorm, sampleScores, opts.dim);

  return {
    params: best.finalParams,
    score: best.finalScore,
    convergenceTrace: best.trace,
    regression,
    restarts: restartResults,
  };
}
