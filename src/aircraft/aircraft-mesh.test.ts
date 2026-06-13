import { describe, it, expect, beforeAll } from 'vitest';
import { Box3, Group, Mesh, CylinderGeometry, ExtrudeGeometry, ConeGeometry, Vector3 } from 'three';
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

describe('buildAircraftMesh — mig15 mesh orientation (regression: post-WP24 wings-on-edge)', () => {
  // Box3.setFromObject() walks world transforms (rotations, parent groups) and
  // reports the AABB in world coordinates — exactly the on-screen footprint a
  // player sees. A flat wing has: span (X) max, thickness (Y) min, chord (Z)
  // middle. A wing-on-edge has: span (X) max, chord (Y) middle, thickness (Z)
  // min — the dimensions sit on the wrong axes.

  // Candidate selection uses each mesh's `.position` (the surface-anchor)
  // instead of bbox center because (a) position is invariant under any
  // orientation fix we apply, and (b) the h-stab and v-stab share a z-anchor
  // but differ in y. Using position gives unambiguous filters.

  it('mig15 wings render flat (span > chord > thickness; thickness along world Y)', () => {
    const group = buildAircraftMesh(mig15Config, 'mig15');
    const extruded = group.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ) as Mesh[];
    // Wing meshes anchor at z = wing-surface-z − rootChord/2 (fixture wing-surface z=0,
    // rootChord=1.6 → position.z = -0.8). Filter is wider than h-stab (z>1).
    const wingCandidates = extruded.filter((m) => m.position.z < 0 && m.position.z > -1.5);
    expect(wingCandidates.length, 'no wing-candidate ExtrudeGeometries at z≈0').toBeGreaterThan(0);
    for (const wing of wingCandidates) {
      const bbox = new Box3().setFromObject(wing);
      const size = new Vector3();
      bbox.getSize(size);
      expect(size.x, `wing span (X=${size.x.toFixed(2)}) should be largest dimension`).toBeGreaterThan(size.z);
      expect(size.z, `wing chord (Z=${size.z.toFixed(2)}) should be larger than thickness (Y=${size.y.toFixed(2)})`).toBeGreaterThan(size.y);
      expect(size.y, `wing thickness (Y=${size.y.toFixed(2)}) should be < 0.5m (extrusion depth ~0.08m)`).toBeLessThan(0.5);
    }
  });

  it('mig15 h-stab renders flat (thin in Y, chord-along-Z)', () => {
    const group = buildAircraftMesh(mig15Config, 'mig15');
    const extruded = group.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ) as Mesh[];
    // h-stab anchor: fixture y=0, z near tail (z≈2-3). Distinguish from v-stab
    // which anchors at y≈0.5.
    const hStabCandidates = extruded.filter(
      (m) => m.position.z > 1 && Math.abs(m.position.y) < 0.2,
    );
    expect(hStabCandidates.length, 'no h-stab-candidate ExtrudeGeometries (z>1, |y|<0.2)').toBeGreaterThan(0);
    for (const tail of hStabCandidates) {
      const bbox = new Box3().setFromObject(tail);
      const size = new Vector3();
      bbox.getSize(size);
      expect(size.y, `h-stab thickness (Y=${size.y.toFixed(2)}) should be < 0.5m`).toBeLessThan(0.5);
      expect(size.z, `h-stab chord (Z=${size.z.toFixed(2)}) should be larger than thickness (Y=${size.y.toFixed(2)})`).toBeGreaterThan(size.y);
    }
  });

  it('mig15 wings extend rearward (chord trailing edge in world +Z, aircraft flies along -Z)', () => {
    // The aircraft flies along world -Z (forward). The wing's trailing edge
    // should sit BEHIND the mesh anchor (mesh.position.z), and sweep + chord
    // mean the trailing edge extends significantly into +Z while only a
    // small fraction (~0.5 × rootChord) sits forward of the anchor (the
    // mesh is anchored at chord midpoint, so half the chord sits in -Z).
    // Asymmetry test: |max.z − anchor| should be MUCH greater than
    // |min.z − anchor| (sweep adds ~+2.2m to trailing-edge Z but nothing
    // to leading-edge Z; ratio should be roughly 2:1 or more).
    const group = buildAircraftMesh(mig15Config, 'mig15');
    const extruded = group.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ) as Mesh[];
    const wingCandidates = extruded.filter((m) => m.position.z < 0 && m.position.z > -1.5);
    expect(wingCandidates.length).toBeGreaterThan(0);
    for (const wing of wingCandidates) {
      const bbox = new Box3().setFromObject(wing);
      const anchor = wing.position.z;
      const extentBehind = bbox.max.z - anchor; // how far behind anchor
      const extentForward = anchor - bbox.min.z; // how far in front
      expect(extentBehind, `wing extent behind anchor (${extentBehind.toFixed(2)}m) should be > 1.5m due to chord + sweep`).toBeGreaterThan(1.5);
      expect(extentBehind, `wing extent behind anchor should exceed extent forward (behind=${extentBehind.toFixed(2)}, forward=${extentForward.toFixed(2)})`).toBeGreaterThan(extentForward);
    }
  });

  it('mig15 h-stab extends rearward (chord trailing edge in world +Z relative to h-stab root)', () => {
    const group = buildAircraftMesh(mig15Config, 'mig15');
    const extruded = group.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ) as Mesh[];
    const hStabCandidates = extruded.filter(
      (m) => m.position.z > 1 && Math.abs(m.position.y) < 0.2,
    );
    expect(hStabCandidates.length).toBeGreaterThan(0);
    for (const tail of hStabCandidates) {
      const bbox = new Box3().setFromObject(tail);
      const anchor = tail.position.z;
      const extentBehind = bbox.max.z - anchor;
      const extentForward = anchor - bbox.min.z;
      expect(extentBehind, `h-stab extent behind anchor (${extentBehind.toFixed(2)}m) should be > 0.8m`).toBeGreaterThan(0.8);
      expect(extentBehind, `h-stab extent behind anchor should exceed extent forward (behind=${extentBehind.toFixed(2)}, forward=${extentForward.toFixed(2)})`).toBeGreaterThan(extentForward);
    }
  });

  it('mig15 v-stab is correctly vertical (height-along-Y, thin in X)', () => {
    const group = buildAircraftMesh(mig15Config, 'mig15');
    const extruded = group.children.filter(
      (c) => c instanceof Mesh && c.geometry instanceof ExtrudeGeometry,
    ) as Mesh[];
    // v-stab anchor: fixture y=0.5 (mounted on top of fuselage), z near tail.
    const vStabCandidates = extruded.filter(
      (m) => m.position.y > 0.3 && m.position.z > 1,
    );
    expect(vStabCandidates.length, 'no v-stab-candidate ExtrudeGeometries (y>0.3, z>1)').toBeGreaterThan(0);
    for (const fin of vStabCandidates) {
      const bbox = new Box3().setFromObject(fin);
      const size = new Vector3();
      bbox.getSize(size);
      expect(size.y, `v-stab height (Y=${size.y.toFixed(2)}) should be > 0.5m`).toBeGreaterThan(0.5);
      expect(size.x, `v-stab thickness (X=${size.x.toFixed(2)}) should be < 0.3m`).toBeLessThan(0.3);
    }
  });
});
