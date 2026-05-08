import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { parseAircraftConfig } from './config';

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
});
