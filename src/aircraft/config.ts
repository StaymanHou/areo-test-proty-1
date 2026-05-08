import { Vector3 } from 'three';
import { createSymmetricFlatPlateCurves, type LiftDragCurve } from './aerosurface';

// Phase 1 supports a single named curve; tunable per-surface curves arrive in WP7.
const CURVE_LIBRARY: Record<string, () => { cl: LiftDragCurve; cd: LiftDragCurve }> = {
  'symmetric-flat-plate': createSymmetricFlatPlateCurves,
};

export interface AircraftSurfaceConfig {
  name: string;
  position: Vector3;
  normal: Vector3;
  chord: Vector3;
  area: number;
  clCurve: LiftDragCurve;
  cdCurve: LiftDragCurve;
}

export interface AircraftConfig {
  mass: number;
  inertia: Vector3;
  thrust: { maxN: number };
  surfaces: AircraftSurfaceConfig[];
}

function asVec3(value: unknown, where: string): Vector3 {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { x?: unknown }).x !== 'number' ||
    typeof (value as { y?: unknown }).y !== 'number' ||
    typeof (value as { z?: unknown }).z !== 'number'
  ) {
    throw new Error(`aircraft config: ${where} must be {x:number, y:number, z:number}`);
  }
  const v = value as { x: number; y: number; z: number };
  return new Vector3(v.x, v.y, v.z);
}

export function parseAircraftConfig(raw: unknown): AircraftConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('aircraft config: root must be an object');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.mass !== 'number' || r.mass <= 0) {
    throw new Error('aircraft config: mass must be a positive number');
  }
  const inertia = asVec3(r.inertia, 'inertia');
  if (inertia.x <= 0 || inertia.y <= 0 || inertia.z <= 0) {
    throw new Error('aircraft config: inertia components must be positive');
  }

  if (typeof r.thrust !== 'object' || r.thrust === null) {
    throw new Error('aircraft config: thrust must be an object');
  }
  const thrustMaxN = (r.thrust as Record<string, unknown>).maxN;
  if (typeof thrustMaxN !== 'number' || thrustMaxN < 0) {
    throw new Error('aircraft config: thrust.maxN must be a non-negative number');
  }

  if (!Array.isArray(r.surfaces) || r.surfaces.length === 0) {
    throw new Error('aircraft config: surfaces must be a non-empty array');
  }

  const surfaces: AircraftSurfaceConfig[] = r.surfaces.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`aircraft config: surfaces[${i}] must be an object`);
    }
    const s = entry as Record<string, unknown>;
    if (typeof s.name !== 'string' || s.name.length === 0) {
      throw new Error(`aircraft config: surfaces[${i}].name must be a non-empty string`);
    }
    if (typeof s.area !== 'number' || s.area <= 0) {
      throw new Error(`aircraft config: surfaces[${i}].area must be a positive number`);
    }
    if (typeof s.curve !== 'string' || !(s.curve in CURVE_LIBRARY)) {
      throw new Error(
        `aircraft config: surfaces[${i}].curve must be one of: ${Object.keys(CURVE_LIBRARY).join(', ')}`,
      );
    }
    const { cl, cd } = CURVE_LIBRARY[s.curve]!();
    return {
      name: s.name,
      position: asVec3(s.position, `surfaces[${i}].position`),
      normal: asVec3(s.normal, `surfaces[${i}].normal`),
      chord: asVec3(s.chord, `surfaces[${i}].chord`),
      area: s.area,
      clCurve: cl,
      cdCurve: cd,
    };
  });

  return {
    mass: r.mass,
    inertia,
    thrust: { maxN: thrustMaxN },
    surfaces,
  };
}

export async function loadAircraftConfig(url: string): Promise<AircraftConfig> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`aircraft config: fetch ${url} → ${res.status} ${res.statusText}`);
  }
  const raw = await res.json();
  return parseAircraftConfig(raw);
}
