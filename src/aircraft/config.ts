import { Vector3 } from 'three';
import {
  buildSymmetricFlatPlateCurves,
  DEFAULT_FLAT_PLATE_PARAMS,
  type LiftDragCurve,
  type SymmetricFlatPlateParams,
} from './aerosurface';

const CURVE_TYPES = ['symmetric-flat-plate'] as const;
export type CurveType = (typeof CURVE_TYPES)[number];

const FLAT_PLATE_PARAM_KEYS: ReadonlyArray<keyof SymmetricFlatPlateParams> = [
  'clSlope',
  'stallAlpha',
  'clPostStall',
  'cdMin',
  'cdStall',
  'cdMax',
];

export interface AircraftSurfaceConfig {
  name: string;
  position: Vector3;
  normal: Vector3;
  chord: Vector3;
  area: number;
  clCurve: LiftDragCurve;
  cdCurve: LiftDragCurve;
  /** Resolved curve identity — needed by the Phase D export to round-trip JSON. */
  curveType: CurveType;
  /** Resolved curve parameters (defaults filled in if input was a bare string). */
  curveParams: SymmetricFlatPlateParams;
  maxDeflectionRad?: number;
}

export interface AircraftConfig {
  mass: number;
  inertia: Vector3;
  thrust: { maxN: number };
  surfaces: AircraftSurfaceConfig[];
}

function parseCurve(
  value: unknown,
  where: string,
): { type: CurveType; params: SymmetricFlatPlateParams; cl: LiftDragCurve; cd: LiftDragCurve } {
  // Back-compat: bare string resolves to defaults for the named type.
  if (typeof value === 'string') {
    if (!(CURVE_TYPES as readonly string[]).includes(value)) {
      throw new Error(
        `aircraft config: ${where} must be one of: ${CURVE_TYPES.join(', ')} (got "${value}")`,
      );
    }
    const type = value as CurveType;
    const params = { ...DEFAULT_FLAT_PLATE_PARAMS };
    const { cl, cd } = buildSymmetricFlatPlateCurves(params);
    return { type, params, cl, cd };
  }

  if (typeof value !== 'object' || value === null) {
    throw new Error(`aircraft config: ${where} must be a string or object`);
  }
  const o = value as Record<string, unknown>;

  if (typeof o.type !== 'string' || !(CURVE_TYPES as readonly string[]).includes(o.type)) {
    throw new Error(
      `aircraft config: ${where}.type must be one of: ${CURVE_TYPES.join(', ')}`,
    );
  }
  const type = o.type as CurveType;

  // Strict: every parametric key must be present and numeric. No partial overrides.
  for (const key of FLAT_PLATE_PARAM_KEYS) {
    if (typeof o[key] !== 'number') {
      throw new Error(`aircraft config: ${where}.${key} must be a number`);
    }
  }
  const params: SymmetricFlatPlateParams = {
    clSlope: o.clSlope as number,
    stallAlpha: o.stallAlpha as number,
    clPostStall: o.clPostStall as number,
    cdMin: o.cdMin as number,
    cdStall: o.cdStall as number,
    cdMax: o.cdMax as number,
  };

  if (params.clSlope <= 0) {
    throw new Error(`aircraft config: ${where}.clSlope must be > 0`);
  }
  if (params.stallAlpha <= 0 || params.stallAlpha >= Math.PI / 2) {
    throw new Error(`aircraft config: ${where}.stallAlpha must be in (0, π/2)`);
  }
  if (params.clPostStall < 0) {
    throw new Error(`aircraft config: ${where}.clPostStall must be ≥ 0`);
  }
  if (params.cdMin < 0) {
    throw new Error(`aircraft config: ${where}.cdMin must be ≥ 0`);
  }
  if (params.cdStall < params.cdMin) {
    throw new Error(`aircraft config: ${where}.cdStall must be ≥ cdMin`);
  }
  if (params.cdMax < params.cdStall) {
    throw new Error(`aircraft config: ${where}.cdMax must be ≥ cdStall`);
  }

  const { cl, cd } = buildSymmetricFlatPlateCurves(params);
  return { type, params, cl, cd };
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
    const { type: curveType, params: curveParams, cl, cd } = parseCurve(
      s.curve,
      `surfaces[${i}].curve`,
    );
    let maxDeflectionRad: number | undefined;
    if (s.maxDeflectionRad !== undefined) {
      if (typeof s.maxDeflectionRad !== 'number' || s.maxDeflectionRad <= 0) {
        throw new Error(
          `aircraft config: surfaces[${i}].maxDeflectionRad must be a positive number`,
        );
      }
      maxDeflectionRad = s.maxDeflectionRad;
    }
    return {
      name: s.name,
      position: asVec3(s.position, `surfaces[${i}].position`),
      normal: asVec3(s.normal, `surfaces[${i}].normal`),
      chord: asVec3(s.chord, `surfaces[${i}].chord`),
      area: s.area,
      clCurve: cl,
      cdCurve: cd,
      curveType,
      curveParams,
      maxDeflectionRad,
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
