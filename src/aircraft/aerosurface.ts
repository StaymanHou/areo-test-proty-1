import { Quaternion, Vector3 } from 'three';

// Khan & Nahon 2015 per-surface aerodynamic primitive.
// Pure math kernel — no Rapier coupling. WP5 wires outputs into a Rapier body.

export interface CurvePoint {
  alpha: number; // radians
  value: number; // CL or CD
}

export type LiftDragCurve = readonly CurvePoint[];

export interface AeroSurfaceConfig {
  // All vectors expressed in the parent body's local frame
  // (right-handed Y-up; nose −Z, right wing +X, top +Y per CONVENTIONS.md).
  position: Vector3; // application point on the body
  normal: Vector3;   // lift direction at α = 0 (must be unit length)
  chord: Vector3;    // direction along the surface chord (must be unit length, ⊥ to normal)
  area: number;      // m²
  clCurve: LiftDragCurve;
  cdCurve: LiftDragCurve;
  /** Maximum deflection magnitude in radians. Default ~25° (0.436 rad). */
  maxDeflectionRad?: number;
}

export const DEFAULT_MAX_DEFLECTION_RAD = (25 * Math.PI) / 180;

export interface BodyState {
  position: Vector3;
  quaternion: Quaternion;
  linvel: Vector3;
  angvel: Vector3; // body angular velocity in world frame
}

export const AIR_DENSITY = 1.225; // kg/m³, sea-level ISA. Phase 1 constant.

// Module-scoped scratch buffers — avoid allocation in the hot path.
// Safe because computeForce is single-threaded (browser main thread / physics tick).
const _scratchAngVelCross = new Vector3();
const _scratchPlaneN = new Vector3();
const _scratchProjected = new Vector3();
const _scratchAppOffset = new Vector3();
const _scratchAirflow = new Vector3();
const _scratchInvQ = new Quaternion();
const _scratchLocalFlow = new Vector3();
const _scratchLiftDir = new Vector3();
const _scratchDragDir = new Vector3();
const _scratchDeflectQ = new Quaternion();

export class AeroSurface {
  readonly position: Vector3;
  readonly normal: Vector3;
  readonly chord: Vector3;
  readonly area: number;
  readonly clCurve: LiftDragCurve;
  readonly cdCurve: LiftDragCurve;

  /** Rest (un-deflected) chord, snapshot at construction. */
  readonly restChord: Vector3;
  /** Rest (un-deflected) normal, snapshot at construction. */
  readonly restNormal: Vector3;
  /** Pre-baked rotation axis for deflections — `restNormal × restChord`, unit length. */
  readonly spanAxis: Vector3;
  readonly maxDeflectionRad: number;
  /** Current deflection angle in radians; signed. Mutated via setDeflection. */
  deflection = 0;

  constructor(config: AeroSurfaceConfig) {
    this.position = config.position.clone();
    this.normal = config.normal.clone().normalize();
    this.chord = config.chord.clone().normalize();
    this.area = config.area;
    this.clCurve = config.clCurve;
    this.cdCurve = config.cdCurve;
    this.maxDeflectionRad = config.maxDeflectionRad ?? DEFAULT_MAX_DEFLECTION_RAD;

    this.restNormal = this.normal.clone();
    this.restChord = this.chord.clone();
    // Span axis = normal × chord. If parallel, surface geometry is degenerate.
    const span = new Vector3().crossVectors(this.restNormal, this.restChord);
    if (span.lengthSq() < 1e-9) {
      throw new Error('AeroSurface: normal and chord must not be parallel');
    }
    this.spanAxis = span.normalize();
  }

  /**
   * Set the current deflection angle (radians) and update `chord`/`normal` in
   * place from the rest snapshot rotated about `spanAxis` by the clamped angle.
   *
   * Allocation-free: uses a module-scoped scratch quaternion.
   */
  setDeflection(rad: number): void {
    let clamped = rad < -this.maxDeflectionRad
      ? -this.maxDeflectionRad
      : rad > this.maxDeflectionRad
        ? this.maxDeflectionRad
        : rad;
    if (clamped === 0) {
      // Normalize signed-zero to +0 so deflection comparisons are sign-stable.
      clamped = 0;
      this.deflection = 0;
      this.chord.copy(this.restChord);
      this.normal.copy(this.restNormal);
      return;
    }
    this.deflection = clamped;
    _scratchDeflectQ.setFromAxisAngle(this.spanAxis, clamped);
    this.chord.copy(this.restChord).applyQuaternion(_scratchDeflectQ);
    this.normal.copy(this.restNormal).applyQuaternion(_scratchDeflectQ);
  }
}

export function createAeroSurface(config: AeroSurfaceConfig): AeroSurface {
  return new AeroSurface(config);
}

/**
 * Compute the world-frame airflow at a point on the body.
 * Airflow at a point = −(linvel + angvel × r), where r is offset from body origin.
 * Result is written into `out`.
 */
export function computeAirflowAtPoint(
  bodyState: BodyState,
  worldOffset: Vector3,
  out: Vector3,
): Vector3 {
  // angvel × r (world frame)
  _scratchAngVelCross.copy(bodyState.angvel).cross(worldOffset);
  // velocity of the point: linvel + angvel × r
  out.copy(bodyState.linvel).add(_scratchAngVelCross);
  // airflow is opposite to point's motion through the air
  out.negate();
  return out;
}

/**
 * Compute angle of attack given local-frame airflow, surface normal, and chord.
 *
 * Convention: `chord` points in the surface's "forward into the wind" direction,
 * i.e., for a wing on a plane moving in −Z, chord = (0,0,−1). In level flight the
 * relative airflow at the wing flows toward +Z, which is opposite to chord, so
 * `airflow · chord` is negative. We measure AoA as the angle between airflow and
 * `−chord`. Positive AoA means flow has a component along `−normal` (wind hitting
 * the underside of the wing), which produces positive lift on a flat-plate
 * symmetric surface.
 *
 * Returns radians in (−π, π].
 */
export function computeAngleOfAttack(
  localFlow: Vector3,
  normal: Vector3,
  chord: Vector3,
): number {
  // Spanwise axis = normal × chord. Reject the spanwise component of flow.
  _scratchPlaneN.copy(normal).cross(chord).normalize();
  const spanComponent = localFlow.dot(_scratchPlaneN);
  _scratchProjected.copy(localFlow).addScaledVector(_scratchPlaneN, -spanComponent);

  const projLen = _scratchProjected.length();
  if (projLen < 1e-9) return 0;

  // AoA = signed angle between projected flow and `−chord`.
  // along = projected · (−chord);  perp = −projected · normal.
  const along = -_scratchProjected.dot(chord);
  const perp = -_scratchProjected.dot(normal);
  return Math.atan2(perp, along);
}

/**
 * Piecewise-linear interpolation through a sorted curve.
 * Clamps at endpoints. Curve must have at least one point; behavior with empty
 * curves is undefined (callers must supply valid curves).
 */
export function lookupLiftDragCurve(curve: LiftDragCurve, alpha: number): number {
  const n = curve.length;
  if (n === 0) return 0;
  if (alpha <= curve[0]!.alpha) return curve[0]!.value;
  if (alpha >= curve[n - 1]!.alpha) return curve[n - 1]!.value;
  // Linear scan is fine: real CL/CD curves have ≤ 8 knots.
  for (let i = 1; i < n; i++) {
    const hi = curve[i]!;
    if (alpha <= hi.alpha) {
      const lo = curve[i - 1]!;
      const t = (alpha - lo.alpha) / (hi.alpha - lo.alpha);
      return lo.value + t * (hi.value - lo.value);
    }
  }
  return curve[n - 1]!.value;
}

/**
 * Build a Gazebo-style symmetric flat-plate CL/CD curve pair.
 * Pre-stall: linear CL slope 2π·α (thin-airfoil theory) up to stall_alpha.
 * Post-stall: drops toward flat-plate region near ±π/2.
 * CD: small at α=0, rises with |α|, peaks near ±π/2.
 *
 * These are sane defaults for tests and a WP5 starting point — WP7 tunes for feel.
 */
export function createSymmetricFlatPlateCurves(): { cl: LiftDragCurve; cd: LiftDragCurve } {
  const stall = (15 * Math.PI) / 180; // ~15° stall
  const cl: CurvePoint[] = [
    { alpha: -Math.PI / 2, value: 0 },
    { alpha: -stall * 2, value: -0.6 },     // post-stall
    { alpha: -stall, value: -2 * Math.PI * stall }, // stall peak (negative)
    { alpha: 0, value: 0 },
    { alpha: stall, value: 2 * Math.PI * stall },   // stall peak (positive)
    { alpha: stall * 2, value: 0.6 },       // post-stall
    { alpha: Math.PI / 2, value: 0 },
  ];
  const cd: CurvePoint[] = [
    { alpha: -Math.PI / 2, value: 1.2 },
    { alpha: -stall, value: 0.05 },
    { alpha: 0, value: 0.02 },
    { alpha: stall, value: 0.05 },
    { alpha: Math.PI / 2, value: 1.2 },
  ];
  return { cl, cd };
}

export interface AeroForceResult {
  /** Force vector in world frame (N). Reused across calls — copy if you need to retain. */
  readonly force: Vector3;
  /** Application point in world frame. Reused across calls — copy if you need to retain. */
  readonly applicationPoint: Vector3;
}

const _outForce = new Vector3();
const _outAppPoint = new Vector3();
const _result: AeroForceResult = { force: _outForce, applicationPoint: _outAppPoint };

/**
 * Compute the aerodynamic force this surface applies to its body.
 *
 * Returns world-frame force + world-frame application point. The returned object's
 * vectors are reused across calls — callers must copy the values if they need to
 * retain them past the next invocation.
 *
 * Formula: F_lift = 0.5·ρ·v²·A·CL applied along world normal;
 *          F_drag = 0.5·ρ·v²·A·CD applied opposite to world airflow.
 *
 * Lift is applied along the surface normal in the world frame (rotated by body
 * quaternion). Drag is applied opposite the world airflow direction.
 */
export function computeAeroForce(
  surface: AeroSurface,
  bodyState: BodyState,
): AeroForceResult {
  // 1. Application point in world frame: bodyPos + bodyQuat·position.
  _scratchAppOffset.copy(surface.position).applyQuaternion(bodyState.quaternion);
  _outAppPoint.copy(bodyState.position).add(_scratchAppOffset);

  // 2. Airflow at application point in world frame.
  // worldOffset (from body origin to point) is _scratchAppOffset.
  computeAirflowAtPoint(bodyState, _scratchAppOffset, _scratchAirflow);
  const v2 = _scratchAirflow.lengthSq();
  if (v2 < 1e-12) {
    _outForce.set(0, 0, 0);
    return _result;
  }

  // 3. AoA: rotate world airflow into the body local frame, then evaluate.
  _scratchInvQ.copy(bodyState.quaternion).invert();
  _scratchLocalFlow.copy(_scratchAirflow).applyQuaternion(_scratchInvQ);
  const alpha = computeAngleOfAttack(_scratchLocalFlow, surface.normal, surface.chord);

  // 4. Curve lookup.
  const cl = lookupLiftDragCurve(surface.clCurve, alpha);
  const cd = lookupLiftDragCurve(surface.cdCurve, alpha);

  // 5. Magnitudes.
  const q = 0.5 * AIR_DENSITY * v2 * surface.area;
  const liftMag = q * cl;
  const dragMag = q * cd;

  // 6. Lift direction = world-frame surface normal.
  _scratchLiftDir.copy(surface.normal).applyQuaternion(bodyState.quaternion);
  // 7. Drag direction = +airflow_world / |airflow|.
  //    Drag opposes the body's motion through the air. Body moves opposite
  //    to airflow (airflow = −velocity), so drag pushes along +airflow.
  const v = Math.sqrt(v2);
  _scratchDragDir.copy(_scratchAirflow).divideScalar(v);

  // 8. Combine.
  _outForce.copy(_scratchLiftDir).multiplyScalar(liftMag);
  _outForce.addScaledVector(_scratchDragDir, dragMag);

  return _result;
}
