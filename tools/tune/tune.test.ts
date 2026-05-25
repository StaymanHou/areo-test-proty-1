import { describe, it, expect } from 'vitest';
import { parseArgs, buildObjective, composeResults, type TuneArgs, type HarnessFn } from './tune';
import { trajectoryToCsv, type TrajectoryRow } from '../../src/aircraft/physics-core/trajectory-buffer';
import type { OptimizeResult } from './optimizer';

// WP14.8 Phase 3 — tune CLI coverage. Tests use a mocked harness function so
// they run without Rapier WASM init (which would be expensive and is already
// covered by harness.test.ts). The mocked harness emits a deterministic CSV
// shaped by the input parameters — we can therefore assert that the optimizer
// receives the right inputs and the results-JSON shape is correct.

describe('parseArgs — happy path', () => {
  it('parses a minimal smoke command', () => {
    const args = parseArgs([
      '--knobs', 'surfaces.wings.clAlphaDot',
      '--bounds', '0..1',
      '--regimes', 'mid',
      '--restarts', '1',
      '--seed', '42',
    ]);
    expect(args.knobs).toEqual(['surfaces.wings.clAlphaDot']);
    expect(args.bounds).toEqual([[0, 1]]);
    expect(args.regimes).toEqual(['mid']);
    expect(args.restarts).toBe(1);
    expect(args.seed).toBe(42);
    expect(args.ticks).toBe(1800); // default
    expect(args.out).toBeUndefined(); // default
  });

  it('parses a multi-knob command per SURFACE-2026-05-16-01', () => {
    const args = parseArgs([
      '--knobs', 'surfaces.wings.clQ,surfaces.wings.clAlphaDot,surfaces.hstab.clQ,surfaces.hstab.clAlphaDot',
      '--bounds', '0..20,-10..20,0..20,-10..20',
      '--regimes', 'low,mid,high',
      '--restarts', '4',
      '--seed', '42',
    ]);
    expect(args.knobs).toHaveLength(4);
    expect(args.bounds).toEqual([[0, 20], [-10, 20], [0, 20], [-10, 20]]);
    expect(args.regimes).toEqual(['low', 'mid', 'high']);
  });

  it('uses defaults for restarts/seed/ticks/out when omitted', () => {
    const args = parseArgs(['--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid']);
    expect(args.restarts).toBe(4);
    expect(args.seed).toBe(42);
    expect(args.ticks).toBe(1800);
    expect(args.out).toBeUndefined();
  });

  it('parses --out and --ticks overrides', () => {
    const args = parseArgs([
      '--knobs', 'a.b',
      '--bounds', '0..1',
      '--regimes', 'mid',
      '--out', '/tmp/results.json',
      '--ticks', '600',
    ]);
    expect(args.out).toBe('/tmp/results.json');
    expect(args.ticks).toBe(600);
  });

  it('supports negative bounds (e.g., -10..20)', () => {
    const args = parseArgs(['--knobs', 'a.b', '--bounds', '-10..20', '--regimes', 'mid']);
    expect(args.bounds).toEqual([[-10, 20]]);
  });

  it('supports decimal bounds', () => {
    const args = parseArgs(['--knobs', 'a.b', '--bounds', '-0.5..2.5', '--regimes', 'mid']);
    expect(args.bounds).toEqual([[-0.5, 2.5]]);
  });
});

describe('parseArgs — error paths', () => {
  it('throws when --knobs is missing', () => {
    expect(() => parseArgs(['--bounds', '0..1', '--regimes', 'mid']))
      .toThrow(/--knobs/);
  });

  it('throws when --bounds is missing', () => {
    expect(() => parseArgs(['--knobs', 'a.b', '--regimes', 'mid']))
      .toThrow(/--bounds/);
  });

  it('throws when --regimes is missing', () => {
    expect(() => parseArgs(['--knobs', 'a.b', '--bounds', '0..1']))
      .toThrow(/--regimes/);
  });

  it('throws when --bounds count mismatches --knobs', () => {
    expect(() => parseArgs(['--knobs', 'a.b,c.d', '--bounds', '0..1', '--regimes', 'mid']))
      .toThrow(/--bounds count/);
  });

  it('throws on malformed bound', () => {
    expect(() => parseArgs(['--knobs', 'a.b', '--bounds', 'abc', '--regimes', 'mid']))
      .toThrow(/malformed bound/);
  });

  it('throws on bound where lo ≥ hi', () => {
    expect(() => parseArgs(['--knobs', 'a.b', '--bounds', '5..5', '--regimes', 'mid']))
      .toThrow(/lo must be less than hi/);
  });

  it('throws on unknown regime', () => {
    expect(() => parseArgs(['--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'extreme']))
      .toThrow(/unknown regime/);
  });

  it('throws on unknown CLI arg', () => {
    expect(() => parseArgs(['--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid', '--bogus', 'x']))
      .toThrow(/unknown argument/);
  });

  it('throws when --restarts is not a positive integer', () => {
    expect(() => parseArgs(['--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid', '--restarts', '0']))
      .toThrow(/positive integer/);
    expect(() => parseArgs(['--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid', '--restarts', '1.5']))
      .toThrow(/positive integer/);
  });
});

// Build a synthetic clean CSV for a given throttle regime so the score
// function returns ~0 under D23 per-regime mode dispatch. Trajectory shape
// D25 (2026-05-25 afternoon) — DEFAULT_ENVELOPES is now all-level-cruise with
// uniform target=78. Clean = "level cruise at V_trim=78 with no descent or
// pitch transient." All three throttles produce the same synthetic trajectory
// (the test isolates buildObjective's harness-dispatch behavior, not the
// per-regime mode dispatch — that's score.test.ts's domain). Under D25 score
// function: AS=78 vs target=78 = 0 dev → score 0; objective = -score = 0.
//
// History: pre-D23, this function produced level-cruise at all 3 throttles
// (AS=60). D23 (2026-05-24) reframed to mode-appropriate per-regime values
// {42/35/85}. D25 (2026-05-25) reverts to uniform level-cruise at V_trim=78.
function makeCleanCsv(_throttle: number): string {
  const rows: TrajectoryRow[] = [];
  for (let i = 0; i < 60; i++) {
    rows.push({
      tick: i,
      posX: 0, posY: 50, posZ: 0,
      vX: 0, vY: 0, vZ: -78,
      pitch: 0, yaw: 0, roll: 0,
      airspeed: 78,
    });
  }
  return trajectoryToCsv(rows);
}

describe('buildObjective', () => {
  it('calls the harness once per regime and aggregates the score', async () => {
    const calls: Array<{ ticks: number; params: readonly string[]; fixtureId: string }> = [];
    const mock: HarnessFn = ({ fixture, ticks, params }) => {
      calls.push({ ticks, params, fixtureId: fixture.id });
      return makeCleanCsv(fixture.throttle);
    };
    const obj = buildObjective(
      ['surfaces.wings.clAlphaDot'],
      ['low', 'mid', 'high'],
      60,
      mock,
    );
    const result = await obj([0.5]);
    // Three regimes → 3 harness calls
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.fixtureId)).toEqual(['throttle-low', 'throttle-mid', 'throttle-high']);
    // Each call gets the right parameter string
    for (const c of calls) {
      expect(c.params).toEqual(['surfaces.wings.clAlphaDot=0.5']);
      expect(c.ticks).toBe(60);
    }
    // Clean trajectories → score ~ 0; objective is -score → ~ 0
    expect(Math.abs(result)).toBeLessThan(1e-9);
  });

  it('builds the right parameter strings for multi-knob calls', async () => {
    const seen: Array<readonly string[]> = [];
    const mock: HarnessFn = ({ fixture, params }) => {
      seen.push(params);
      return makeCleanCsv(fixture.throttle);
    };
    const obj = buildObjective(
      ['surfaces.wings.clQ', 'surfaces.wings.clAlphaDot'],
      ['mid'],
      60,
      mock,
    );
    await obj([3.5, -2.1]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      'surfaces.wings.clQ=3.5',
      'surfaces.wings.clAlphaDot=-2.1',
    ]);
  });

  it('throws when param length mismatches knob count', async () => {
    const mock: HarnessFn = ({ fixture }) => makeCleanCsv(fixture.throttle);
    const obj = buildObjective(['a.b', 'c.d'], ['mid'], 60, mock);
    await expect(obj([1])).rejects.toThrow(/param length/);
  });
});

describe('composeResults — JSON shape per spec acceptance #4', () => {
  function makeFakeOptimizeResult(): OptimizeResult {
    return {
      params: [3.5],
      score: 10, // optimizer-space score (negative of higher-is-better)
      convergenceTrace: [
        { iter: 0, bestScore: 100, simplexDiameter: 0.5 },
        { iter: 1, bestScore: 80, simplexDiameter: 0.3 },
        { iter: 2, bestScore: 10, simplexDiameter: 0.05 },
      ],
      regression: {
        centroid: [3.5],
        gradient: [0.1],
        hessian: [[2]],
        conditionNumber: 1,
        samples: 3,
      },
      restarts: [
        {
          seed: 1234,
          finalScore: 10,
          finalParams: [3.5],
          finalSimplex: [[3.5], [3.6]],
          finalSimplexScores: [10, 12],
          trace: [],
          stoppedBy: 'param-tol',
        },
      ],
    };
  }

  const baseArgs: TuneArgs = {
    knobs: ['surfaces.wings.clAlphaDot'],
    bounds: [[-10, 20]],
    regimes: ['mid'],
    restarts: 1,
    seed: 42,
    out: undefined,
    ticks: 1800,
    links: [],
  };

  it('produces the documented top-level keys', () => {
    const r = composeResults(baseArgs, makeFakeOptimizeResult(), 123, '2026-05-16T12:34:56.789Z');
    expect(Object.keys(r).sort()).toEqual(['convergenceTrace', 'meta', 'params', 'regression', 'restarts', 'score'].sort());
  });

  it('keys params by deep-path knob name', () => {
    const r = composeResults(baseArgs, makeFakeOptimizeResult(), 0, 'ts');
    expect(r.params).toEqual({ 'surfaces.wings.clAlphaDot': 3.5 });
  });

  it('flips score sign back to higher-is-better at the JSON boundary', () => {
    const r = composeResults(baseArgs, makeFakeOptimizeResult(), 0, 'ts');
    // optimizer.score = 10 (which is -score_higher_better = -(-10) = 10)
    // so user-facing score = -10
    expect(r.score).toBe(-10);
    // Same flip applies to convergenceTrace.bestScore
    expect(r.convergenceTrace[0].bestScore).toBe(-100);
    expect(r.convergenceTrace[2].bestScore).toBe(-10);
  });

  it('passes through regression unchanged when present', () => {
    const r = composeResults(baseArgs, makeFakeOptimizeResult(), 0, 'ts');
    expect(r.regression).not.toBeNull();
    expect(r.regression?.hessian).toEqual([[2]]);
    expect(r.regression?.conditionNumber).toBe(1);
    expect(r.regression?.samples).toBe(3);
  });

  it('emits null regression when optimizer returned null', () => {
    const opt = makeFakeOptimizeResult();
    opt.regression = null;
    const r = composeResults(baseArgs, opt, 0, 'ts');
    expect(r.regression).toBeNull();
  });

  it('records meta fields with wallClockMs + timestamp + reproducibility inputs', () => {
    const r = composeResults(baseArgs, makeFakeOptimizeResult(), 12345, '2026-05-16T12:34:56.789Z');
    expect(r.meta).toEqual({
      knobs: ['surfaces.wings.clAlphaDot'],
      bounds: [[-10, 20]],
      regimes: ['mid'],
      restartsCount: 1,
      seed: 42,
      ticks: 1800,
      wallClockMs: 12345,
      timestamp: '2026-05-16T12:34:56.789Z',
      links: [],
    });
  });

  it('records each restart with its seed, final score (flipped), and keyed params', () => {
    const r = composeResults(baseArgs, makeFakeOptimizeResult(), 0, 'ts');
    expect(r.restarts).toHaveLength(1);
    expect(r.restarts[0].seed).toBe(1234);
    expect(r.restarts[0].finalScore).toBe(-10);
    expect(r.restarts[0].finalParams).toEqual({ 'surfaces.wings.clAlphaDot': 3.5 });
  });

  it('preserves links in meta when present (SURFACE-2026-05-24-03 reproducibility)', () => {
    const argsWithLinks: TuneArgs = {
      ...baseArgs,
      links: [{ src: 'surfaces.0', dst: 'surfaces.1' }],
    };
    const r = composeResults(argsWithLinks, makeFakeOptimizeResult(), 0, 'ts');
    expect(r.meta.links).toEqual([{ src: 'surfaces.0', dst: 'surfaces.1' }]);
  });
});

// ---------------------------------------------------------------------------
// SURFACE-2026-05-24-03 — `--link` flag for symmetric-mirror search
// ---------------------------------------------------------------------------

describe('parseArgs --link (SURFACE-2026-05-24-03)', () => {
  it('defaults links to empty array when --link is omitted', () => {
    const args = parseArgs(['--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid']);
    expect(args.links).toEqual([]);
  });

  it('parses a single --link src=dst', () => {
    const args = parseArgs([
      '--knobs', 'surfaces.0.clQ',
      '--bounds', '0..3',
      '--regimes', 'mid',
      '--link', 'surfaces.0=surfaces.1',
    ]);
    expect(args.links).toEqual([{ src: 'surfaces.0', dst: 'surfaces.1' }]);
  });

  it('parses repeated --link flags into an array', () => {
    const args = parseArgs([
      '--knobs', 'a.b',
      '--bounds', '0..1',
      '--regimes', 'mid',
      '--link', 'surfaces.0=surfaces.1',
      '--link', 'surfaces.4=surfaces.5',
    ]);
    expect(args.links).toEqual([
      { src: 'surfaces.0', dst: 'surfaces.1' },
      { src: 'surfaces.4', dst: 'surfaces.5' },
    ]);
  });

  it('throws on --link without an = sign', () => {
    expect(() => parseArgs([
      '--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid',
      '--link', 'surfaces.0',
    ])).toThrow(/malformed --link/);
  });

  it('throws on --link with empty src', () => {
    expect(() => parseArgs([
      '--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid',
      '--link', '=surfaces.1',
    ])).toThrow(/malformed --link/);
  });

  it('throws on --link with empty dst', () => {
    expect(() => parseArgs([
      '--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid',
      '--link', 'surfaces.0=',
    ])).toThrow(/malformed --link/);
  });

  it('throws when src equals dst (self-link is meaningless)', () => {
    expect(() => parseArgs([
      '--knobs', 'a.b', '--bounds', '0..1', '--regimes', 'mid',
      '--link', 'surfaces.0=surfaces.0',
    ])).toThrow(/src and dst must differ/);
  });
});

describe('buildObjective --link expansion (SURFACE-2026-05-24-03)', () => {
  it('emits a mirror entry for each knob matching the src prefix', async () => {
    const seen: Array<readonly string[]> = [];
    const mock: HarnessFn = ({ fixture, params }) => {
      seen.push(params);
      return makeCleanCsv(fixture.throttle);
    };
    const obj = buildObjective(
      ['surfaces.0.clQ'],
      ['mid'],
      60,
      mock,
      [{ src: 'surfaces.0', dst: 'surfaces.1' }],
    );
    await obj([1.5]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([
      'surfaces.0.clQ=1.5',
      'surfaces.1.clQ=1.5', // <- mirror
    ]);
  });

  it('expands multi-knob mirror for all knobs starting with the src prefix', async () => {
    const seen: Array<readonly string[]> = [];
    const mock: HarnessFn = ({ fixture, params }) => {
      seen.push(params);
      return makeCleanCsv(fixture.throttle);
    };
    const obj = buildObjective(
      ['surfaces.0.clQ', 'surfaces.0.clAlphaDot', 'surfaces.0.inducedDragK'],
      ['mid'],
      60,
      mock,
      [{ src: 'surfaces.0', dst: 'surfaces.1' }],
    );
    await obj([1.6, 3.5, 1.2]);
    expect(seen[0]).toEqual([
      'surfaces.0.clQ=1.6',
      'surfaces.0.clAlphaDot=3.5',
      'surfaces.0.inducedDragK=1.2',
      'surfaces.1.clQ=1.6',
      'surfaces.1.clAlphaDot=3.5',
      'surfaces.1.inducedDragK=1.2',
    ]);
  });

  it('does NOT mirror knobs that do not match the src prefix', async () => {
    const seen: Array<readonly string[]> = [];
    const mock: HarnessFn = ({ fixture, params }) => {
      seen.push(params);
      return makeCleanCsv(fixture.throttle);
    };
    const obj = buildObjective(
      ['surfaces.0.clQ', 'surfaces.2.clQ', 'fuselageDrag.cd0'],
      ['mid'],
      60,
      mock,
      [{ src: 'surfaces.0', dst: 'surfaces.1' }],
    );
    await obj([1.6, 2.1, 0.5]);
    expect(seen[0]).toEqual([
      'surfaces.0.clQ=1.6',
      'surfaces.2.clQ=2.1',
      'fuselageDrag.cd0=0.5',
      'surfaces.1.clQ=1.6', // mirror only of surfaces.0.*
    ]);
  });

  it('omitting links preserves pre-link behavior (no mirror entries)', async () => {
    const seen: Array<readonly string[]> = [];
    const mock: HarnessFn = ({ fixture, params }) => {
      seen.push(params);
      return makeCleanCsv(fixture.throttle);
    };
    const obj = buildObjective(
      ['surfaces.0.clQ'],
      ['mid'],
      60,
      mock,
    ); // no links arg → default empty
    await obj([1.5]);
    expect(seen[0]).toEqual(['surfaces.0.clQ=1.5']);
  });

  it('handles repeated links — wings AND another pair mirrored', async () => {
    const seen: Array<readonly string[]> = [];
    const mock: HarnessFn = ({ fixture, params }) => {
      seen.push(params);
      return makeCleanCsv(fixture.throttle);
    };
    const obj = buildObjective(
      ['surfaces.0.clQ', 'surfaces.4.clQ'],
      ['mid'],
      60,
      mock,
      [
        { src: 'surfaces.0', dst: 'surfaces.1' },
        { src: 'surfaces.4', dst: 'surfaces.5' },
      ],
    );
    await obj([1.1, 2.2]);
    expect(seen[0]).toEqual([
      'surfaces.0.clQ=1.1',
      'surfaces.4.clQ=2.2',
      'surfaces.1.clQ=1.1', // mirror from link 1
      'surfaces.5.clQ=2.2', // mirror from link 2
    ]);
  });
});
