import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { DEFAULT_FLAT_PLATE_PARAMS } from './aerosurface';
import { parseAircraftConfig } from './config';

// Vite-resolved JSON import — no Node types needed. ?import-style works in tests.
import canonicalAircraftConfig from '../../public/config/aircraft.json' with { type: 'json' };

const validBaseline = () => ({
  mass: 1000,
  inertia: { x: 1500, y: 3000, z: 1500 },
  thrust: { maxN: 6000 },
  surfaces: [
    {
      name: 'wing-left',
      position: { x: -2, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 6,
      curve: 'symmetric-flat-plate',
    },
  ],
});

describe('parseAircraftConfig', () => {
  it('parses a valid baseline config', () => {
    const cfg = parseAircraftConfig(validBaseline());
    expect(cfg.mass).toBe(1000);
    expect(cfg.inertia).toBeInstanceOf(Vector3);
    expect(cfg.inertia.x).toBe(1500);
    expect(cfg.thrust.maxN).toBe(6000);
    expect(cfg.surfaces).toHaveLength(1);
    expect(cfg.surfaces[0]!.position).toBeInstanceOf(Vector3);
    expect(cfg.surfaces[0]!.position.x).toBe(-2);
    expect(cfg.surfaces[0]!.normal).toBeInstanceOf(Vector3);
    expect(cfg.surfaces[0]!.chord).toBeInstanceOf(Vector3);
    expect(cfg.surfaces[0]!.area).toBe(6);
    // Curve is materialized from the library
    expect(cfg.surfaces[0]!.clCurve.length).toBeGreaterThan(0);
    expect(cfg.surfaces[0]!.cdCurve.length).toBeGreaterThan(0);
  });

  it('throws when mass is missing or non-positive', () => {
    const bad = validBaseline();
    (bad as unknown as { mass: number }).mass = 0;
    expect(() => parseAircraftConfig(bad)).toThrow(/mass/);

    const bad2 = validBaseline() as Partial<ReturnType<typeof validBaseline>>;
    delete bad2.mass;
    expect(() => parseAircraftConfig(bad2)).toThrow(/mass/);
  });

  it('throws when inertia is malformed', () => {
    const bad = validBaseline();
    (bad as unknown as { inertia: unknown }).inertia = { x: 1, y: 2 };
    expect(() => parseAircraftConfig(bad)).toThrow(/inertia/);
  });

  it('throws when thrust.maxN is missing', () => {
    const bad = validBaseline();
    (bad as unknown as { thrust: unknown }).thrust = {};
    expect(() => parseAircraftConfig(bad)).toThrow(/thrust\.maxN/);
  });

  it('throws when surfaces is empty', () => {
    const bad = validBaseline();
    bad.surfaces = [];
    expect(() => parseAircraftConfig(bad)).toThrow(/surfaces/);
  });

  it('throws when a surface has bad shape', () => {
    const bad = validBaseline();
    (bad.surfaces[0] as unknown as { position: unknown }).position = { x: 1, y: 2 };
    expect(() => parseAircraftConfig(bad)).toThrow(/position/);
  });

  it('throws when a surface references an unknown curve', () => {
    const bad = validBaseline();
    bad.surfaces[0]!.curve = 'totally-fake-curve';
    expect(() => parseAircraftConfig(bad)).toThrow(/curve/);
  });

  it('throws when the root is not an object', () => {
    expect(() => parseAircraftConfig(null)).toThrow();
    expect(() => parseAircraftConfig('hi')).toThrow();
  });

  it('maxDeflectionRad is undefined when absent (downstream defaults take over)', () => {
    const cfg = parseAircraftConfig(validBaseline());
    expect(cfg.surfaces[0]!.maxDeflectionRad).toBeUndefined();
  });

  it('parses an explicit maxDeflectionRad', () => {
    const raw = validBaseline();
    (raw.surfaces[0] as unknown as { maxDeflectionRad: number }).maxDeflectionRad = 0.4;
    const cfg = parseAircraftConfig(raw);
    expect(cfg.surfaces[0]!.maxDeflectionRad).toBe(0.4);
  });

  it('rejects non-positive maxDeflectionRad', () => {
    const bad = validBaseline();
    (bad.surfaces[0] as unknown as { maxDeflectionRad: number }).maxDeflectionRad = 0;
    expect(() => parseAircraftConfig(bad)).toThrow(/maxDeflectionRad/);
    const bad2 = validBaseline();
    (bad2.surfaces[0] as unknown as { maxDeflectionRad: number }).maxDeflectionRad = -0.1;
    expect(() => parseAircraftConfig(bad2)).toThrow(/maxDeflectionRad/);
  });

  it('rejects non-numeric maxDeflectionRad', () => {
    const bad = validBaseline();
    (bad.surfaces[0] as unknown as { maxDeflectionRad: unknown }).maxDeflectionRad = '0.4';
    expect(() => parseAircraftConfig(bad)).toThrow(/maxDeflectionRad/);
  });

  // --- Per-surface incidence (WP6.5 / D10) ---

  it('incidenceRad is undefined when absent (AeroSurface default 0 takes over downstream)', () => {
    const cfg = parseAircraftConfig(validBaseline());
    expect(cfg.surfaces[0]!.incidenceRad).toBeUndefined();
  });

  it('parses an explicit numeric incidenceRad (positive and negative)', () => {
    const raw = validBaseline();
    (raw.surfaces[0] as unknown as { incidenceRad: number }).incidenceRad = 0.035;
    const cfg = parseAircraftConfig(raw);
    expect(cfg.surfaces[0]!.incidenceRad).toBe(0.035);

    const raw2 = validBaseline();
    (raw2.surfaces[0] as unknown as { incidenceRad: number }).incidenceRad = -0.017;
    const cfg2 = parseAircraftConfig(raw2);
    expect(cfg2.surfaces[0]!.incidenceRad).toBe(-0.017);
  });

  it('rejects non-finite or non-numeric incidenceRad', () => {
    const bad = validBaseline();
    (bad.surfaces[0] as unknown as { incidenceRad: unknown }).incidenceRad = '0.035';
    expect(() => parseAircraftConfig(bad)).toThrow(/incidenceRad/);
    const bad2 = validBaseline();
    (bad2.surfaces[0] as unknown as { incidenceRad: number }).incidenceRad = NaN;
    expect(() => parseAircraftConfig(bad2)).toThrow(/incidenceRad/);
    const bad3 = validBaseline();
    (bad3.surfaces[0] as unknown as { incidenceRad: number }).incidenceRad = Infinity;
    expect(() => parseAircraftConfig(bad3)).toThrow(/incidenceRad/);
  });

  // --- Per-surface pitch-rate damping (WP6.5 Phase 3 / β4) ---

  it('clQ is undefined when absent (AeroSurface default 0 takes over downstream)', () => {
    const cfg = parseAircraftConfig(validBaseline());
    expect(cfg.surfaces[0]!.clQ).toBeUndefined();
  });

  it('parses an explicit numeric clQ (positive)', () => {
    const raw = validBaseline();
    (raw.surfaces[0] as unknown as { clQ: number }).clQ = 8;
    const cfg = parseAircraftConfig(raw);
    expect(cfg.surfaces[0]!.clQ).toBe(8);
  });

  it('rejects non-finite or non-numeric clQ', () => {
    const bad = validBaseline();
    (bad.surfaces[0] as unknown as { clQ: unknown }).clQ = '8';
    expect(() => parseAircraftConfig(bad)).toThrow(/clQ/);
    const bad2 = validBaseline();
    (bad2.surfaces[0] as unknown as { clQ: number }).clQ = NaN;
    expect(() => parseAircraftConfig(bad2)).toThrow(/clQ/);
  });

  // --- Parametric curve schema (WP7 Phase A) ---

  const validParametricCurve = () => ({
    type: 'symmetric-flat-plate',
    clSlope: 6.5,
    stallAlpha: 0.27,
    clPostStall: 0.5,
    cdMin: 0.025,
    cdStall: 0.06,
    cdMax: 1.1,
  });

  it('bare-string curve resolves to default params and exposes them on the surface', () => {
    const cfg = parseAircraftConfig(validBaseline());
    const s = cfg.surfaces[0]!;
    expect(s.curveType).toBe('symmetric-flat-plate');
    expect(s.curveParams.clSlope).toBeCloseTo(2 * Math.PI, 12);
    expect(s.curveParams.stallAlpha).toBeCloseTo((15 * Math.PI) / 180, 12);
    expect(s.curveParams.clPostStall).toBe(0.6);
    expect(s.curveParams.cdMin).toBe(0.02);
    expect(s.curveParams.cdStall).toBe(0.05);
    expect(s.curveParams.cdMax).toBe(1.2);
  });

  it('object-form curve parses with all 6 knobs', () => {
    const raw = validBaseline();
    raw.surfaces[0]!.curve = validParametricCurve() as unknown as string;
    const cfg = parseAircraftConfig(raw);
    const p = cfg.surfaces[0]!.curveParams;
    expect(p.clSlope).toBe(6.5);
    expect(p.stallAlpha).toBe(0.27);
    expect(p.clPostStall).toBe(0.5);
    expect(p.cdMin).toBe(0.025);
    expect(p.cdStall).toBe(0.06);
    expect(p.cdMax).toBe(1.1);
  });

  it('rejects partial object form (every knob required)', () => {
    const raw = validBaseline();
    const partial = { type: 'symmetric-flat-plate', clSlope: 7 };
    raw.surfaces[0]!.curve = partial as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/stallAlpha|number/);
  });

  it('rejects unknown curve.type', () => {
    const raw = validBaseline();
    const bad = { ...validParametricCurve(), type: 'totally-fake' };
    raw.surfaces[0]!.curve = bad as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/type/);
  });

  it('rejects clSlope ≤ 0', () => {
    const raw = validBaseline();
    const bad = { ...validParametricCurve(), clSlope: 0 };
    raw.surfaces[0]!.curve = bad as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/clSlope/);
  });

  it('rejects stallAlpha out of (0, π/2)', () => {
    const raw = validBaseline();
    raw.surfaces[0]!.curve = { ...validParametricCurve(), stallAlpha: 0 } as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/stallAlpha/);
    raw.surfaces[0]!.curve = { ...validParametricCurve(), stallAlpha: Math.PI / 2 } as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/stallAlpha/);
  });

  it('rejects clPostStall < 0', () => {
    const raw = validBaseline();
    raw.surfaces[0]!.curve = { ...validParametricCurve(), clPostStall: -0.01 } as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/clPostStall/);
  });

  it('rejects cdMin < 0', () => {
    const raw = validBaseline();
    raw.surfaces[0]!.curve = { ...validParametricCurve(), cdMin: -0.01 } as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/cdMin/);
  });

  it('rejects cdStall < cdMin', () => {
    const raw = validBaseline();
    raw.surfaces[0]!.curve = {
      ...validParametricCurve(),
      cdMin: 0.1,
      cdStall: 0.05,
    } as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/cdStall/);
  });

  it('rejects cdMax < cdStall', () => {
    const raw = validBaseline();
    raw.surfaces[0]!.curve = {
      ...validParametricCurve(),
      cdStall: 0.5,
      cdMax: 0.4,
    } as unknown as string;
    expect(() => parseAircraftConfig(raw)).toThrow(/cdMax/);
  });

  it('canonical public/config/aircraft.json on disk parses with the new schema', () => {
    // Codifies the integration-boundary invariant verified live in WP7 Phase A
    // verify-self: the shipped aircraft.json must keep parsing as the schema evolves.
    const cfg = parseAircraftConfig(canonicalAircraftConfig);
    expect(cfg.surfaces).toHaveLength(4);
    for (const s of cfg.surfaces) {
      expect(s.curveType).toBe('symmetric-flat-plate');
      expect(s.curveParams).toEqual(DEFAULT_FLAT_PLATE_PARAMS);
    }
  });
});
