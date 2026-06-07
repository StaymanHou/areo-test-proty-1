import { describe, it, expect, beforeAll } from 'vitest';
import { Group, Mesh, CylinderGeometry, ExtrudeGeometry, ConeGeometry, Vector3 } from 'three';
import { buildAircraftMesh, inferAircraftVariant } from './aircraft-mesh';
import { parseAircraftConfig, type AircraftConfig } from './physics-core/config';

const cessnaLikeRaw = () => ({
  mass: 1000,
  inertia: { x: 1500, y: 3000, z: 1500 },
  thrust: { maxN: 6000 },
  surfaces: [
    { name: 'wing-left', position: { x: -2, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, chord: { x: 0, y: 0, z: -1 }, area: 6, curve: 'symmetric-flat-plate' },
    { name: 'wing-right', position: { x: 2, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, chord: { x: 0, y: 0, z: -1 }, area: 6, curve: 'symmetric-flat-plate' },
    { name: 'h-stab', position: { x: 0, y: 0, z: 3 }, normal: { x: 0, y: 1, z: 0 }, chord: { x: 0, y: 0, z: -1 }, area: 1.5, curve: 'symmetric-flat-plate' },
    { name: 'v-stab', position: { x: 0, y: 0.5, z: 3 }, normal: { x: 1, y: 0, z: 0 }, chord: { x: 0, y: 0, z: -1 }, area: 1, curve: 'symmetric-flat-plate' },
  ],
});

const mig15LikeRaw = () => ({
  ...cessnaLikeRaw(),
  mass: 3000,
  thrust: { maxN: 30000 },
});

let cessnaConfig: AircraftConfig;
let mig15Config: AircraftConfig;

beforeAll(() => {
  cessnaConfig = parseAircraftConfig(cessnaLikeRaw());
  mig15Config = parseAircraftConfig(mig15LikeRaw());
});

describe('inferAircraftVariant', () => {
  it('selects cessna for low-thrust airframes', () => {
    expect(inferAircraftVariant(cessnaConfig)).toBe('cessna');
  });

  it('selects mig15 for high-thrust airframes (thrust ≥ 20000 N)', () => {
    expect(inferAircraftVariant(mig15Config)).toBe('mig15');
  });

  it('threshold sits at 20000 N exactly', () => {
    const borderRaw = { ...cessnaLikeRaw(), thrust: { maxN: 20000 } };
    const borderConfig = parseAircraftConfig(borderRaw);
    expect(inferAircraftVariant(borderConfig)).toBe('mig15');
    const justBelowRaw = { ...cessnaLikeRaw(), thrust: { maxN: 19999 } };
    const justBelowConfig = parseAircraftConfig(justBelowRaw);
    expect(inferAircraftVariant(justBelowConfig)).toBe('cessna');
  });
});

describe('buildAircraftMesh', () => {
  it('default variant returns the 5-child placeholder shape (back-compat)', () => {
    const group = buildAircraftMesh(cessnaConfig, 'default');
    expect(group).toBeInstanceOf(Group);
    expect(group.children).toHaveLength(5);
  });

  it('cessna variant returns a Group with multiple child meshes including a cylindrical fuselage', () => {
    const group = buildAircraftMesh(cessnaConfig, 'cessna');
    expect(group).toBeInstanceOf(Group);
    expect(group.children.length).toBeGreaterThanOrEqual(4);
    const hasCylinderFuselage = group.children.some(
      (c) => c instanceof Mesh && c.geometry instanceof CylinderGeometry,
    );
    expect(hasCylinderFuselage).toBe(true);
  });

  it('cessna variant has a tapered nose (ConeGeometry)', () => {
    const group = buildAircraftMesh(cessnaConfig, 'cessna');
    const hasCone = group.children.some(
      (c) => c instanceof Mesh && c.geometry instanceof ConeGeometry,
    );
    expect(hasCone).toBe(true);
  });

  it('mig15 variant returns a Group with multiple child meshes including a non-Box wing (swept ExtrudeGeometry)', () => {
    const group = buildAircraftMesh(mig15Config, 'mig15');
    expect(group).toBeInstanceOf(Group);
    expect(group.children.length).toBeGreaterThanOrEqual(4);
    const hasExtrudedWing = group.children.some(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    );
    expect(hasExtrudedWing).toBe(true);
  });

  it('cessna and mig15 variants produce visibly distinct child sets', () => {
    const cessna = buildAircraftMesh(cessnaConfig, 'cessna');
    const mig15 = buildAircraftMesh(mig15Config, 'mig15');
    // Different overall geometry profile: count of ExtrudeGeometry children
    // differs (mig15 has many swept surfaces; cessna has at most a tail fin).
    const cessnaExtruded = cessna.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ).length;
    const mig15Extruded = mig15.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ).length;
    expect(mig15Extruded).toBeGreaterThan(cessnaExtruded);
  });

  it('every child mesh in every variant has castShadow=true', () => {
    for (const variant of ['default', 'cessna', 'mig15'] as const) {
      const config = variant === 'mig15' ? mig15Config : cessnaConfig;
      const group = buildAircraftMesh(config, variant);
      for (const child of group.children) {
        expect(
          (child as { castShadow?: boolean }).castShadow,
          `variant ${variant} child without castShadow`,
        ).toBe(true);
      }
    }
  });

  it('mesh does not throw on minimal config (smoke)', () => {
    expect(() => buildAircraftMesh(cessnaConfig, 'cessna')).not.toThrow();
    expect(() => buildAircraftMesh(mig15Config, 'mig15')).not.toThrow();
    expect(() => buildAircraftMesh(cessnaConfig, 'default')).not.toThrow();
  });

  it('mesh positions reference the AeroSurface positions from the config (cessna h-stab is at config h-stab position)', () => {
    const group = buildAircraftMesh(cessnaConfig, 'cessna');
    const hStabSurface = cessnaConfig.surfaces.find((s) => s.name === 'h-stab')!;
    // At least one mesh child should sit at the h-stab z position.
    const hasHStabAtZ = group.children.some((c) => {
      const m = c as Mesh;
      // Tail in cessna variant is at exactly s.position; check Z roughly equals.
      return Math.abs(m.position.z - hStabSurface.position.z) < 0.01;
    });
    expect(hasHStabAtZ).toBe(true);
    // sanity that we used a Vector3 import (silences TS noise if any)
    expect(new Vector3()).toBeInstanceOf(Vector3);
  });
});
