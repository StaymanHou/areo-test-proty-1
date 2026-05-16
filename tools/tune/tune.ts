import * as fs from 'node:fs';
import * as path from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  runHarness,
  lookupFixture,
} from './harness';
import { csvToTrajectory } from '../../src/aircraft/physics-core/trajectory-buffer';
import { score, DEFAULT_ENVELOPES, type RegimeTrajectory } from './score';
import { optimize, type OptimizeOpts, type OptimizeResult } from './optimizer';

// WP14.8 Phase 3 — tune CLI: glues optimizer + score + harness into a
// parameter-space search. Per arch.md §D14.5 + D14.6 the optimizer is
// Nelder-Mead with K random restarts; this CLI is the only public way
// to invoke it. Downstream WP14.5-retry will call it with --knobs
// covering (clQ, clAlphaDot) per surface, per SURFACE-2026-05-16-01.
//
// Usage:
//   npm run tune -- --knobs <comma-deep-paths> \
//                   --bounds <comma-lo..hi> \
//                   --regimes <comma-names> \
//                   [--restarts K=4] [--seed N=42] [--out <path>]
//                   [--ticks N=1800]
//
// Example (smoke):
//   npm run tune -- --knobs surfaces.wings.clAlphaDot \
//                   --bounds 0..1 --regimes mid --restarts 1 --seed 42
//
// Output:
//   Writes a results JSON to --out (default: tools/tune/results/<ISO>.json).
//   See ResultsJson interface for the shape.

export interface TuneArgs {
  knobs: string[];
  bounds: Array<[number, number]>;
  regimes: string[];
  restarts: number;
  seed: number;
  out: string | undefined; // undefined → default timestamped path
  ticks: number;
}

export interface ResultsJson {
  params: Record<string, number>;
  score: number;
  convergenceTrace: Array<{ iter: number; bestScore: number; simplexDiameter: number }>;
  regression: {
    centroid: number[];
    gradient: number[];
    hessian: number[][];
    conditionNumber: number;
    samples: number;
  } | null;
  restarts: Array<{ seed: number; finalScore: number; finalParams: Record<string, number> }>;
  meta: {
    knobs: string[];
    bounds: Array<[number, number]>;
    regimes: string[];
    restartsCount: number;
    seed: number;
    ticks: number;
    wallClockMs: number;
    timestamp: string;
  };
}

const REGIME_TO_FIXTURE: Readonly<Record<string, string>> = {
  low: 'throttle-low',
  mid: 'throttle-mid',
  high: 'throttle-high',
};

const DEFAULT_RESTARTS = 4;
const DEFAULT_SEED = 42;
const DEFAULT_TICKS = 1800;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv: readonly string[]): TuneArgs {
  let knobsRaw: string | undefined;
  let boundsRaw: string | undefined;
  let regimesRaw: string | undefined;
  let restarts = DEFAULT_RESTARTS;
  let seed = DEFAULT_SEED;
  let out: string | undefined;
  let ticks = DEFAULT_TICKS;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`tune: ${arg} requires a value`);
      i++;
      return v;
    };
    if (arg === '--knobs') knobsRaw = next();
    else if (arg === '--bounds') boundsRaw = next();
    else if (arg === '--regimes') regimesRaw = next();
    else if (arg === '--restarts') {
      const n = Number(next());
      if (!Number.isInteger(n) || n <= 0) throw new Error(`tune: --restarts must be a positive integer`);
      restarts = n;
    } else if (arg === '--seed') {
      const n = Number(next());
      if (!Number.isFinite(n)) throw new Error(`tune: --seed must be a finite number`);
      seed = n;
    } else if (arg === '--out') {
      out = next();
    } else if (arg === '--ticks') {
      const n = Number(next());
      if (!Number.isInteger(n) || n <= 0) throw new Error(`tune: --ticks must be a positive integer`);
      ticks = n;
    } else {
      throw new Error(`tune: unknown argument "${arg}"`);
    }
  }

  if (knobsRaw === undefined) throw new Error('tune: --knobs is required');
  if (boundsRaw === undefined) throw new Error('tune: --bounds is required');
  if (regimesRaw === undefined) throw new Error('tune: --regimes is required');

  const knobs = knobsRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const boundsList = boundsRaw.split(',').map((s) => s.trim());
  const regimes = regimesRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

  if (knobs.length === 0) throw new Error('tune: --knobs is empty');
  if (regimes.length === 0) throw new Error('tune: --regimes is empty');
  if (boundsList.length !== knobs.length) {
    throw new Error(`tune: --bounds count (${boundsList.length}) must equal --knobs count (${knobs.length})`);
  }

  const bounds: Array<[number, number]> = boundsList.map((b) => {
    const m = b.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
    if (!m) throw new Error(`tune: malformed bound "${b}" — expected lo..hi`);
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      throw new Error(`tune: bound "${b}" has non-finite endpoints`);
    }
    if (!(lo < hi)) throw new Error(`tune: bound "${b}" — lo must be less than hi`);
    return [lo, hi];
  });

  for (const r of regimes) {
    if (!(r in REGIME_TO_FIXTURE)) {
      const valid = Object.keys(REGIME_TO_FIXTURE).join(', ');
      throw new Error(`tune: unknown regime "${r}". Valid: ${valid}`);
    }
  }

  return { knobs, bounds, regimes, restarts, seed, out, ticks };
}

// ---------------------------------------------------------------------------
// Score-objective closure builder
// ---------------------------------------------------------------------------

export type HarnessFn = (opts: { fixture: ReturnType<typeof lookupFixture>; ticks: number; params: readonly string[] }) => string;

/**
 * Build the optimizer objective. The optimizer minimizes; the score function
 * is "higher is better" — so the objective returns `-score`. NaN/Infinity in
 * the score (shouldn't happen — score returns finite numbers, including the
 * -1e9 + nanTick floor) defends with a large positive sentinel.
 */
export function buildObjective(
  knobs: readonly string[],
  regimes: readonly string[],
  ticks: number,
  harnessFn: HarnessFn = runHarness,
): (userParams: number[]) => Promise<number> {
  return async (userParams: number[]): Promise<number> => {
    if (userParams.length !== knobs.length) {
      throw new Error(`objective: param length (${userParams.length}) mismatches knob count (${knobs.length})`);
    }
    const paramStrings = knobs.map((k, i) => `${k}=${userParams[i]}`);
    const trajectories: RegimeTrajectory[] = [];
    for (const regime of regimes) {
      const fixtureId = REGIME_TO_FIXTURE[regime];
      const fixture = lookupFixture(fixtureId);
      const csv = harnessFn({ fixture, ticks, params: paramStrings });
      const rows = csvToTrajectory(csv);
      trajectories.push({ regime, rows });
    }
    const s = score(trajectories, DEFAULT_ENVELOPES);
    if (!Number.isFinite(s)) return 1e12; // defensive — should never happen
    return -s; // optimizer minimizes; we want to maximize score
  };
}

// ---------------------------------------------------------------------------
// Results JSON composition
// ---------------------------------------------------------------------------

export function composeResults(args: TuneArgs, opt: OptimizeResult, wallClockMs: number, timestamp: string): ResultsJson {
  const paramsByKnob: Record<string, number> = {};
  args.knobs.forEach((k, i) => { paramsByKnob[k] = opt.params[i]; });

  return {
    params: paramsByKnob,
    score: -opt.score, // back to higher-is-better
    convergenceTrace: opt.convergenceTrace.map((t) => ({ ...t, bestScore: -t.bestScore })),
    regression: opt.regression ? {
      centroid: opt.regression.centroid,
      gradient: opt.regression.gradient,
      hessian: opt.regression.hessian,
      conditionNumber: opt.regression.conditionNumber,
      samples: opt.regression.samples,
    } : null,
    restarts: opt.restarts.map((r) => {
      const fp: Record<string, number> = {};
      args.knobs.forEach((k, i) => { fp[k] = r.finalParams[i]; });
      return { seed: r.seed, finalScore: -r.finalScore, finalParams: fp };
    }),
    meta: {
      knobs: args.knobs,
      bounds: args.bounds,
      regimes: args.regimes,
      restartsCount: args.restarts,
      seed: args.seed,
      ticks: args.ticks,
      wallClockMs,
      timestamp,
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  await RAPIER.init();

  const objective = buildObjective(args.knobs, args.regimes, args.ticks);
  const optimizeOpts: OptimizeOpts = {
    dim: args.knobs.length,
    bounds: args.bounds,
    restarts: args.restarts,
    seed: args.seed,
  };

  const t0 = Date.now();
  const result = await optimize(objective, optimizeOpts);
  const wallClockMs = Date.now() - t0;
  const timestamp = new Date().toISOString();

  const results = composeResults(args, result, wallClockMs, timestamp);

  // Resolve output path
  let outPath: string;
  if (args.out !== undefined) {
    outPath = args.out;
  } else {
    const safeStamp = timestamp.replace(/[:.]/g, '-');
    outPath = path.resolve('tools/tune/results', `${safeStamp}.json`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  process.stdout.write(`tune: wrote ${outPath}\n`);
  process.stdout.write(`tune: best score=${results.score} params=${JSON.stringify(results.params)}\n`);
}

// Only run main when this module is executed directly (matches harness.ts pattern).
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
