import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  parseArgs,
  applyParamOverrides,
  lookupFixture,
  runHarness,
} from './harness';

// WP14.7 Phase 2 — in-process unit coverage for the harness pure helpers
// plus a single in-process determinism check. The subprocess byte-identity
// check lives in `harness.determinism.test.ts` (longer Vitest timeout).

describe('parseArgs — single mode', () => {
  it('parses the minimal happy path', () => {
    const args = parseArgs(['--fixture', 'throttle-mid', '--ticks', '60']);
    expect(args).toEqual({ mode: 'single', fixture: 'throttle-mid', ticks: 60, params: [], out: '-' });
  });

  it('parses --out and --params (comma-separated)', () => {
    const args = parseArgs([
      '--fixture', 'throttle-low',
      '--ticks', '120',
      '--params', 'surfaces.0.clQ=1,surfaces.1.clQ=2',
      '--out', '/tmp/out.csv',
    ]);
    expect(args.mode).toBe('single');
    if (args.mode !== 'single') throw new Error('expected single mode');
    expect(args.fixture).toBe('throttle-low');
    expect(args.ticks).toBe(120);
    expect(args.params).toEqual(['surfaces.0.clQ=1', 'surfaces.1.clQ=2']);
    expect(args.out).toBe('/tmp/out.csv');
  });

  it('throws when --fixture is missing', () => {
    expect(() => parseArgs(['--ticks', '60'])).toThrow(/--fixture/);
  });

  it('throws when --ticks is missing', () => {
    expect(() => parseArgs(['--fixture', 'throttle-mid'])).toThrow(/--ticks/);
  });

  it('throws when --ticks is not a positive integer', () => {
    expect(() => parseArgs(['--fixture', 'throttle-mid', '--ticks', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--fixture', 'throttle-mid', '--ticks', '-5'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--fixture', 'throttle-mid', '--ticks', '3.5'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--fixture', 'throttle-mid', '--ticks', 'abc'])).toThrow(/positive integer/);
  });

  it('throws on unknown argument', () => {
    expect(() => parseArgs(['--fixture', 'throttle-mid', '--ticks', '60', '--nope', 'x'])).toThrow(/unknown argument/);
  });

  it('filters empty entries from --params', () => {
    const args = parseArgs(['--fixture', 'throttle-mid', '--ticks', '60', '--params', 'a.b=1,, , c.d=2']);
    if (args.mode !== 'single') throw new Error('expected single mode');
    expect(args.params).toEqual(['a.b=1', 'c.d=2']);
  });
});

describe('parseArgs — all-fixtures mode', () => {
  it('parses --all-fixtures + --out-dir', () => {
    const args = parseArgs(['--all-fixtures', '--out-dir', 'test-results']);
    expect(args).toEqual({ mode: 'all-fixtures', params: [], outDir: 'test-results' });
  });

  it('accepts --params alongside --all-fixtures', () => {
    const args = parseArgs(['--all-fixtures', '--out-dir', '/tmp/x', '--params', 'surfaces.0.clQ=1']);
    expect(args.mode).toBe('all-fixtures');
    if (args.mode !== 'all-fixtures') throw new Error('expected all-fixtures');
    expect(args.params).toEqual(['surfaces.0.clQ=1']);
    expect(args.outDir).toBe('/tmp/x');
  });

  it('throws when --out-dir is missing', () => {
    expect(() => parseArgs(['--all-fixtures'])).toThrow(/--out-dir/);
  });

  it('throws when --all-fixtures is combined with --fixture', () => {
    expect(() => parseArgs(['--all-fixtures', '--out-dir', '/tmp/x', '--fixture', 'throttle-mid'])).toThrow(/mutually exclusive/);
  });

  it('throws when --all-fixtures is combined with --ticks', () => {
    expect(() => parseArgs(['--all-fixtures', '--out-dir', '/tmp/x', '--ticks', '60'])).toThrow(/mutually exclusive/);
  });

  it('throws when --all-fixtures is combined with --out', () => {
    expect(() => parseArgs(['--all-fixtures', '--out-dir', '/tmp/x', '--out', '-'])).toThrow(/mutually exclusive/);
  });
});

describe('applyParamOverrides', () => {
  it('sets an existing leaf', () => {
    const cfg = { surfaces: [{ clQ: 3, clAlphaDot: 0 }] };
    applyParamOverrides(cfg, ['surfaces.0.clQ=1.5']);
    expect(cfg.surfaces[0].clQ).toBe(1.5);
    expect(cfg.surfaces[0].clAlphaDot).toBe(0);
  });

  it('creates a leaf that does not yet exist (optimizer use case)', () => {
    // clAlphaDot defaults to 0 in parseAircraftConfig and is typically absent
    // from aircraft.json. The optimizer must be able to sweep it.
    const cfg: Record<string, unknown> = { surfaces: [{ clQ: 3 }] };
    applyParamOverrides(cfg, ['surfaces.0.clAlphaDot=5']);
    expect((cfg.surfaces as { clAlphaDot?: number }[])[0]!.clAlphaDot).toBe(5);
  });

  it('applies multiple overrides in order', () => {
    const cfg = { a: { b: 1 }, c: { d: 2 } };
    applyParamOverrides(cfg, ['a.b=10', 'c.d=20']);
    expect(cfg.a.b).toBe(10);
    expect(cfg.c.d).toBe(20);
  });

  it('coerces numeric strings, including scientific notation and negatives', () => {
    const cfg = { x: { y: 0 } };
    applyParamOverrides(cfg, ['x.y=-1.5e2']);
    expect(cfg.x.y).toBe(-150);
  });

  it('throws when an intermediate segment does not resolve', () => {
    const cfg = { surfaces: [{ clQ: 3 }] };
    expect(() => applyParamOverrides(cfg, ['surfaces.99.clQ=1'])).toThrow(/does not resolve at segment "99"/);
  });

  it('throws on malformed entry (no =)', () => {
    expect(() => applyParamOverrides({}, ['no-equals-here'])).toThrow(/malformed/);
  });

  it('throws on malformed entry (empty value)', () => {
    expect(() => applyParamOverrides({ a: 1 }, ['a='])).toThrow(/malformed/);
  });

  it('throws when value is not a finite number', () => {
    expect(() => applyParamOverrides({ a: 1 }, ['a=hello'])).toThrow(/not a finite number/);
    expect(() => applyParamOverrides({ a: 1 }, ['a=Infinity'])).toThrow(/not a finite number/);
  });
});

describe('lookupFixture', () => {
  it('returns the matching fixture', () => {
    const fx = lookupFixture('throttle-mid');
    expect(fx.id).toBe('throttle-mid');
    expect(fx.throttle).toBe(0.15);
  });

  it('throws on unknown id with a list of valid ids', () => {
    expect(() => lookupFixture('nonexistent')).toThrow(/unknown fixture/);
    expect(() => lookupFixture('nonexistent')).toThrow(/throttle-low/);
    expect(() => lookupFixture('nonexistent')).toThrow(/throttle-mid/);
    expect(() => lookupFixture('nonexistent')).toThrow(/throttle-high/);
  });
});

describe('runHarness (in-process)', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('produces a CSV with the expected header and 60 data rows for ticks=60', () => {
    const csv = runHarness({ fixture: lookupFixture('throttle-mid'), ticks: 60, params: [] });
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(61); // header + 60 data rows
    expect(lines[0]).toBe('tick,posX,posY,posZ,vX,vY,vZ,pitch,yaw,roll,airspeed');
    // First data row's tick column is 0
    expect(lines[1]!.split(',')[0]).toBe('0');
    // Last data row's tick column is 59
    expect(lines[60]!.split(',')[0]).toBe('59');
  });

  it('produces byte-identical output across two in-process runs (determinism, no subprocess)', () => {
    const a = runHarness({ fixture: lookupFixture('throttle-mid'), ticks: 120, params: [] });
    const b = runHarness({ fixture: lookupFixture('throttle-mid'), ticks: 120, params: [] });
    expect(a).toBe(b);
  });

  it('produces a different trajectory when a meaningful parameter is overridden', () => {
    // throttle-high drives body |v| above V_REF=30 sufficiently to make β4
    // active. Changing the wings' clQ from default 3 → 0 (which short-
    // circuits the β4 amplification block via `if (clQ !== 0)`) must change
    // the trajectory observably within the first 400 ticks.
    const baseline = runHarness({ fixture: lookupFixture('throttle-high'), ticks: 400, params: [] });
    const altered = runHarness({
      fixture: lookupFixture('throttle-high'),
      ticks: 400,
      params: ['surfaces.0.clQ=0', 'surfaces.1.clQ=0', 'surfaces.2.clQ=0'],
    });
    expect(altered).not.toBe(baseline);
  });

  it('WP14.10 / D16: β5 non-dimensional form stays finite over 600 ticks at non-default clAlphaDot in throttle-mid', () => {
    // Codification of WP14.10's verify-self Rule #2 gate (CLAUDE.md
    // physics-mechanism discipline). Under D16's c̄/(2V) non-dim factor,
    // clAlphaDot in the textbook range 1–10 must produce a finite trajectory
    // for at least 600 ticks (10 s @ 60 Hz). The pre-D16 raw-rate form
    // NaN'd within 85–199 ticks at clAlphaDot=0.1 per SURFACE-2026-05-16-04
    // evidence; a regression that drops the V_REF floor or the c̄/(2V)
    // factor would surface here.
    const csv = runHarness({
      fixture: lookupFixture('throttle-mid'),
      ticks: 600,
      params: [
        'surfaces.0.clAlphaDot=5',
        'surfaces.1.clAlphaDot=5',
        'surfaces.2.clAlphaDot=8',
        'surfaces.3.clAlphaDot=0',
      ],
    });
    expect(csv).not.toMatch(/NaN/i);
    expect(csv).not.toMatch(/Infinity/i);
    const dataRows = csv.split('\n').filter((l) => l.length > 0).slice(1);
    expect(dataRows.length).toBe(600);
  });

  it('WP14.10 / D16: explicit clAlphaDot=0 produces bit-identical trajectory to omitted (live default-zero parity)', () => {
    // Codification of WP14.10's verify-self Rule #4 gate. The D16 gate
    // `if (clAlphaDot !== 0 && ...)` skips the augmentation block when
    // clAlphaDot=0, so the trajectory must be byte-identical to baseline.
    // This catches any future refactor that accidentally activates the
    // augmentation block at default-zero (e.g. removing the !== 0 guard).
    const baseline = runHarness({
      fixture: lookupFixture('throttle-mid'),
      ticks: 300,
      params: [],
    });
    const explicitZero = runHarness({
      fixture: lookupFixture('throttle-mid'),
      ticks: 300,
      params: [
        'surfaces.0.clAlphaDot=0',
        'surfaces.1.clAlphaDot=0',
        'surfaces.2.clAlphaDot=0',
        'surfaces.3.clAlphaDot=0',
      ],
    });
    expect(explicitZero).toBe(baseline);
  });
});
