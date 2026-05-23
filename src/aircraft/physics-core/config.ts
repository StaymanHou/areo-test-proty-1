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
  /**
   * Fixed mount angle of the surface relative to the fuselage longitudinal axis,
   * in radians. Rotates the surface about its span axis at construction time.
   * Positive = leading edge up → positive AoA at level body attitude with forward
   * airflow → positive lift. Default 0 (unchanged Phase-1 behavior).
   * See arch.md Revision 2026-05-11 (D10) and CONVENTIONS.md.
   */
  incidenceRad?: number;
  /**
   * Pitch-rate damping coefficient (β4). When non-zero and the body has angular
   * velocity, the surface generates an additional aerodynamic force opposing
   * the local pitch motion at its position. Default undefined → no damping.
   * See arch.md Revision 2026-05-11 ("Fallback path"/β4 hedge) and CONVENTIONS.md.
   */
  clQ?: number;
  /**
   * AoA-rate damping coefficient (β5). When non-zero AND the runtime supplies
   * a physics dt to `computeAeroForce`, lift is augmented by `clAlphaDot · dα/dt`,
   * damping the phugoid mode. Default undefined → no augmentation.
   * See arch.md Revision 2026-05-12 (D13), CONVENTIONS.md, and SURFACE-2026-05-11-04.
   */
  clAlphaDot?: number;
  /**
   * Induced-drag coefficient (D18). When non-zero, the drag coefficient is
   * augmented by `inducedDragK · cl²` after β4/β5 CL augmentation, applying
   * the textbook lifting-line drag-polar coupling `CD_i = CL² / (π·AR·e)`
   * with `k = 1/(π·AR·e)` treated as a tunable primary knob. Sign: must be
   * ≥ 0 (drag always opposes motion). Default undefined → no augmentation.
   * See arch.md Revision 2026-05-23 (D18), CONVENTIONS.md, and SURFACE-2026-05-23-01.
   */
  inducedDragK?: number;
}

export interface AircraftConfig {
  mass: number;
  inertia: Vector3;
  thrust: { maxN: number };
  surfaces: AircraftSurfaceConfig[];
  /**
   * Body-level fuselage parasitic drag (D18). When present, a single drag
   * force of magnitude `0.5·ρ·V²·area·cd0` is applied at the body origin
   * opposite to the linear velocity vector. Applied at the body origin so
   * the force contributes zero torque — fuselage drag is a pure
   * translational damping term. Both `cd0` and `area` must be ≥ 0. When
   * absent (default), no fuselage drag is applied (pre-D18 behavior).
   * See arch.md Revision 2026-05-23 (D18) and SURFACE-2026-05-23-01.
   */
  fuselageDrag?: { cd0: number; area: number };
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
    let incidenceRad: number | undefined;
    if (s.incidenceRad !== undefined) {
      if (typeof s.incidenceRad !== 'number' || !Number.isFinite(s.incidenceRad)) {
        throw new Error(
          `aircraft config: surfaces[${i}].incidenceRad must be a finite number`,
        );
      }
      incidenceRad = s.incidenceRad;
    }
    let clQ: number | undefined;
    if (s.clQ !== undefined) {
      if (typeof s.clQ !== 'number' || !Number.isFinite(s.clQ)) {
        throw new Error(
          `aircraft config: surfaces[${i}].clQ must be a finite number`,
        );
      }
      clQ = s.clQ;
    }
    let clAlphaDot: number | undefined;
    if (s.clAlphaDot !== undefined) {
      if (typeof s.clAlphaDot !== 'number' || !Number.isFinite(s.clAlphaDot)) {
        throw new Error(
          `aircraft config: surfaces[${i}].clAlphaDot must be a finite number`,
        );
      }
      clAlphaDot = s.clAlphaDot;
    }
    let inducedDragK: number | undefined;
    if (s.inducedDragK !== undefined) {
      if (typeof s.inducedDragK !== 'number' || !Number.isFinite(s.inducedDragK)) {
        throw new Error(
          `aircraft config: surfaces[${i}].inducedDragK must be a finite number`,
        );
      }
      if (s.inducedDragK < 0) {
        throw new Error(
          `aircraft config: surfaces[${i}].inducedDragK must be ≥ 0 (drag opposes motion; negative values are unphysical)`,
        );
      }
      inducedDragK = s.inducedDragK;
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
      incidenceRad,
      clQ,
      clAlphaDot,
      inducedDragK,
    };
  });

  let fuselageDrag: { cd0: number; area: number } | undefined;
  if (r.fuselageDrag !== undefined) {
    if (typeof r.fuselageDrag !== 'object' || r.fuselageDrag === null) {
      throw new Error('aircraft config: fuselageDrag must be an object');
    }
    const f = r.fuselageDrag as Record<string, unknown>;
    if (typeof f.cd0 !== 'number' || !Number.isFinite(f.cd0)) {
      throw new Error('aircraft config: fuselageDrag.cd0 must be a finite number');
    }
    if (f.cd0 < 0) {
      throw new Error('aircraft config: fuselageDrag.cd0 must be ≥ 0');
    }
    if (typeof f.area !== 'number' || !Number.isFinite(f.area)) {
      throw new Error('aircraft config: fuselageDrag.area must be a finite number');
    }
    if (f.area < 0) {
      throw new Error('aircraft config: fuselageDrag.area must be ≥ 0');
    }
    fuselageDrag = { cd0: f.cd0, area: f.area };
  }

  return {
    mass: r.mass,
    inertia,
    thrust: { maxN: thrustMaxN },
    surfaces,
    fuselageDrag,
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
