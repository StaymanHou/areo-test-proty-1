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
  /**
   * Fixed mount angle of the surface about its span axis, in radians. Applied
   * once at construction time (and re-applied by `setGeometry`). Positive =
   * leading edge up → positive AoA at level body attitude with forward
   * airflow → positive lift. Default 0.
   */
  incidenceRad?: number;
  /**
   * Pitch-rate damping coefficient (β4). When non-zero, amplifies the
   * rotation-induced contribution to local airflow by `(1 + clQ · max(v,
   * V_REF) / V_REF)`. The `max(v, V_REF)` floor preserves WP6.5's low-V
   * β4 calibration bit-for-bit; above V_REF=30, amplification grows linearly
   * with v so the resulting damping moment scales as V², keeping damping
   * ratio constant across the flight envelope. No 1/V singularity. Default
   * 0 (no damping — pre-β4 behavior preserved). See CONVENTIONS.md and
   * SURFACE-2026-05-11-03.
   */
  clQ?: number;
  /**
   * AoA-rate damping coefficient (β5). When non-zero AND a physics `dt` is
   * supplied to `computeAeroForce`, the lift coefficient is augmented by
   * `clAlphaDot · dα/dt`, where `dα/dt = (α_now − α_prev) / dt` is the
   * finite-difference rate of change of local angle-of-attack between
   * consecutive ticks. Positive `clAlphaDot` produces additional lift in
   * the +α direction during rising α — damping the AoA oscillation that
   * drives the phugoid mode. Default 0 (no augmentation — pre-β5 behavior
   * preserved). First call has no augmentation (no previous AoA reference);
   * `setGeometry` resets the previous-AoA cache. See CONVENTIONS.md,
   * arch.md Revision 2026-05-12 (D13), and SURFACE-2026-05-11-04.
   */
  clAlphaDot?: number;
}

export const DEFAULT_MAX_DEFLECTION_RAD = (25 * Math.PI) / 180;

export interface BodyState {
  position: Vector3;
  quaternion: Quaternion;
  linvel: Vector3;
  angvel: Vector3; // body angular velocity in world frame
}

export const AIR_DENSITY = 1.225; // kg/m³, sea-level ISA. Phase 1 constant.

// β4 airspeed-scaling reference (arch.md Revision 2026-05-11 "Fallback path",
// SURFACE-2026-05-11-03). The β4 damping amplification on (ω × r) is
// (1 + clQ · max(v, V_REF) / V_REF). The `max(v, V_REF)` floor matters: WP6.5's
// β4 was calibrated at low airspeed (V < V_REF, descending-glide regime), and
// a naive `v / V_REF` would shrink damping below WP6.5 levels there. By
// flooring at V_REF, the formula reduces to (1 + clQ) for all v ≤ V_REF —
// preserving WP6.5 calibration bit-for-bit in the low-V regime. Above V_REF,
// amplification grows linearly with v so the damping moment scales as V²,
// matching the V² growth of the destabilizing pitch moment from `incidenceRad`
// and keeping the damping ratio constant across the high-V regime. No 1/V
// singularity. clQ=0 preserves pre-β4 behavior exactly.
const BETA4_V_REF = 30;

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
const _scratchSpan = new Vector3();

export class AeroSurface {
  // Geometry + curves are mutable via setGeometry / setCurves (WP7 live tuning).
  // Do not mutate these fields directly — re-baking restNormal/restChord/spanAxis
  // is required after geometry changes; setGeometry handles that atomically.
  position: Vector3;
  normal: Vector3;
  chord: Vector3;
  area: number;
  clCurve: LiftDragCurve;
  cdCurve: LiftDragCurve;

  /** Rest (un-deflected) chord, refreshed by setGeometry. Incidence-rotated. */
  restChord: Vector3;
  /** Rest (un-deflected) normal, refreshed by setGeometry. Incidence-rotated. */
  restNormal: Vector3;
  /** Pre-baked rotation axis for deflections — original (pre-incidence) normal × chord, unit length. */
  spanAxis: Vector3;
  /** Mutable for WP7 live tuning; do not mutate during the per-tick hot path. */
  maxDeflectionRad: number;
  /** Current deflection angle in radians; signed. Mutated via setDeflection. */
  deflection = 0;
  /** Fixed mount angle about the span axis. Re-applied by setGeometry on geometry edits. */
  incidenceRad: number;
  /** Pitch-rate damping coefficient. 0 = no damping. */
  clQ: number;
  /** AoA-rate damping coefficient (β5). 0 = no augmentation. */
  clAlphaDot: number;
  /**
   * Cached chord length in metres (captured BEFORE `chord` is normalized to a
   * unit vector). Read-only after construction unless `setGeometry({chord})` is
   * called — `setGeometry` refreshes it. Used by D16 (β5 non-dimensional form,
   * WP14.10) to scale the AoA-rate damping by `c̄ / (2V)`. Computed once at
   * construction; never allocated per tick.
   */
  chordLength: number;
  /**
   * Previous-tick local AoA cache for the β5 finite difference. `undefined`
   * means "no previous reading" — augmentation is skipped and the current
   * AoA is recorded. Reset to `undefined` by `setGeometry` because a
   * rest-frame change invalidates AoA continuity.
   */
  prevAoA: number | undefined = undefined;

  constructor(config: AeroSurfaceConfig) {
    this.position = config.position.clone();
    this.normal = config.normal.clone().normalize();
    // Capture chord length BEFORE normalize() — see chordLength field doc.
    this.chordLength = config.chord.length();
    this.chord = config.chord.clone().normalize();
    this.area = config.area;
    this.clCurve = config.clCurve;
    this.cdCurve = config.cdCurve;
    this.maxDeflectionRad = config.maxDeflectionRad ?? DEFAULT_MAX_DEFLECTION_RAD;
    this.incidenceRad = config.incidenceRad ?? 0;
    this.clQ = config.clQ ?? 0;
    this.clAlphaDot = config.clAlphaDot ?? 0;

    // Span axis = (pre-incidence) normal × chord. If parallel, surface geometry is degenerate.
    const span = new Vector3().crossVectors(this.normal, this.chord);
    if (span.lengthSq() < 1e-9) {
      throw new Error('AeroSurface: normal and chord must not be parallel');
    }
    this.spanAxis = span.normalize();

    // Apply fixed mount-angle (incidence) about the span axis. Default 0 leaves
    // normal/chord unchanged — preserves all pre-D10 fixture behavior bit-for-bit.
    // Sign: rotate by −incidenceRad so that for the canonical wing layout
    // (normal=+Y, chord=−Z, spanAxis=normal×chord=−X) a +incidenceRad value tilts
    // the leading edge UP (chord gains a +Y component), producing positive AoA
    // at level body attitude with forward airflow → positive lift. See
    // CONVENTIONS.md for the convention statement.
    if (this.incidenceRad !== 0) {
      _scratchDeflectQ.setFromAxisAngle(this.spanAxis, -this.incidenceRad);
      this.normal.applyQuaternion(_scratchDeflectQ);
      this.chord.applyQuaternion(_scratchDeflectQ);
    }

    // Rest snapshots are taken AFTER incidence — deflections compose on top.
    this.restNormal = this.normal.clone();
    this.restChord = this.chord.clone();
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

  /**
   * Live-tuning entry point: update one or more geometric fields and re-bake
   * the rest snapshots + spanAxis. Resets deflection to 0 because the prior
   * deflection angle is meaningless against new rest snapshots.
   *
   * Call from GUI-event handlers, never the per-tick hot path.
   */
  setGeometry(opts: {
    position?: Vector3;
    normal?: Vector3;
    chord?: Vector3;
    area?: number;
  }): void {
    if (opts.position !== undefined) {
      this.position.copy(opts.position);
    }
    if (opts.area !== undefined) {
      this.area = opts.area;
    }
    if (opts.normal !== undefined) {
      this.normal.copy(opts.normal).normalize();
    }
    if (opts.chord !== undefined) {
      // Capture length BEFORE normalize — same contract as the constructor.
      this.chordLength = opts.chord.length();
      this.chord.copy(opts.chord).normalize();
    }
    if (opts.normal !== undefined || opts.chord !== undefined) {
      // Re-bake spanAxis from the (now-current, pre-incidence) normal+chord,
      // then re-apply stored incidence, then snapshot rest. Matches constructor.
      _scratchSpan.crossVectors(this.normal, this.chord);
      if (_scratchSpan.lengthSq() < 1e-9) {
        throw new Error('AeroSurface.setGeometry: normal and chord must not be parallel');
      }
      this.spanAxis.copy(_scratchSpan).normalize();
      if (this.incidenceRad !== 0) {
        // Sign matches the constructor — see comment there.
        _scratchDeflectQ.setFromAxisAngle(this.spanAxis, -this.incidenceRad);
        this.normal.applyQuaternion(_scratchDeflectQ);
        this.chord.applyQuaternion(_scratchDeflectQ);
      }
      this.restNormal.copy(this.normal);
      this.restChord.copy(this.chord);
      this.deflection = 0;
      // β5: rest-frame change invalidates AoA continuity (the next call's
      // α_now is measured against a different rest frame than the cached
      // α_prev would have been). Clear the cache so the next call behaves
      // as a fresh first-tick — no augmentation, then record the new α.
      this.prevAoA = undefined;
    }
  }

  /**
   * Live-tuning entry point: replace the CL/CD curve references.
   * Allocation-free (just two reference assignments).
   */
  setCurves(cl: LiftDragCurve, cd: LiftDragCurve): void {
    this.clCurve = cl;
    this.cdCurve = cd;
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
 * `−chord`. Positive AoA means flow has a component along `+normal` (wind from
 * below pushing up into the underside of the wing), which produces positive lift
 * on a flat-plate symmetric surface.
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
  // along = projected · (−chord);  perp = projected · normal.
  // Positive perp = flow has a +normal component = wind from below pushing up
  // into the underside of a top-up wing = positive AoA = positive lift.
  const along = -_scratchProjected.dot(chord);
  const perp = _scratchProjected.dot(normal);
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
 * Tunable knobs for the symmetric-flat-plate CL/CD curve family.
 * CL_max is derived as `clSlope · stallAlpha` — exposing both invites contradictory inputs.
 * Validation lives in `parseAircraftConfig`.
 */
export interface SymmetricFlatPlateParams {
  /** Pre-stall CL slope in rad⁻¹. Thin-airfoil theory gives 2π. */
  clSlope: number;
  /** Stall angle of attack in radians (where CL peaks). */
  stallAlpha: number;
  /** CL value at 2·stallAlpha (post-stall plateau). */
  clPostStall: number;
  /** CD at α = 0 (parasite drag floor). */
  cdMin: number;
  /** CD at ±stallAlpha. */
  cdStall: number;
  /** CD at ±π/2 (broadside drag peak). */
  cdMax: number;
}

/** Defaults reproduce the original `createSymmetricFlatPlateCurves` output exactly. */
export const DEFAULT_FLAT_PLATE_PARAMS: SymmetricFlatPlateParams = {
  clSlope: 2 * Math.PI,
  stallAlpha: (15 * Math.PI) / 180,
  clPostStall: 0.6,
  cdMin: 0.02,
  cdStall: 0.05,
  cdMax: 1.2,
};

/**
 * Build a Gazebo-style symmetric flat-plate CL/CD curve pair from 6 knobs.
 * Pre-stall: linear CL slope `clSlope·α` (thin-airfoil theory) up to `stallAlpha`.
 * Post-stall: drops toward flat-plate region near ±π/2.
 * CD: `cdMin` at α=0, rising through `cdStall` to `cdMax` at ±π/2.
 *
 * Always emits 7 CL knots and 5 CD knots in the same shape as the legacy default.
 */
export function buildSymmetricFlatPlateCurves(
  params: SymmetricFlatPlateParams,
): { cl: LiftDragCurve; cd: LiftDragCurve } {
  const { clSlope, stallAlpha, clPostStall, cdMin, cdStall, cdMax } = params;
  const clMax = clSlope * stallAlpha;
  const cl: CurvePoint[] = [
    { alpha: -Math.PI / 2, value: 0 },
    { alpha: -stallAlpha * 2, value: -clPostStall },
    { alpha: -stallAlpha, value: -clMax },
    { alpha: 0, value: 0 },
    { alpha: stallAlpha, value: clMax },
    { alpha: stallAlpha * 2, value: clPostStall },
    { alpha: Math.PI / 2, value: 0 },
  ];
  const cd: CurvePoint[] = [
    { alpha: -Math.PI / 2, value: cdMax },
    { alpha: -stallAlpha, value: cdStall },
    { alpha: 0, value: cdMin },
    { alpha: stallAlpha, value: cdStall },
    { alpha: Math.PI / 2, value: cdMax },
  ];
  return { cl, cd };
}

/**
 * Sane defaults for tests and a WP5 starting point. Thin wrapper around
 * `buildSymmetricFlatPlateCurves(DEFAULT_FLAT_PLATE_PARAMS)`.
 */
export function createSymmetricFlatPlateCurves(): { cl: LiftDragCurve; cd: LiftDragCurve } {
  return buildSymmetricFlatPlateCurves(DEFAULT_FLAT_PLATE_PARAMS);
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
  dt?: number,
): AeroForceResult {
  // 1. Application point in world frame: bodyPos + bodyQuat·position.
  _scratchAppOffset.copy(surface.position).applyQuaternion(bodyState.quaternion);
  _outAppPoint.copy(bodyState.position).add(_scratchAppOffset);

  // 2. Airflow at application point in world frame.
  // Airflow = −(linvel + ω × r). With β4 (clQ>0), the rotation contribution is
  // amplified by (1 + clQ · max(v, V_REF) / V_REF). The floor at V_REF makes the
  // formula degenerate to (1 + clQ) for all v ≤ V_REF — bit-identical to WP6.5
  // β4 calibration in the low-V regime. Above V_REF, amplification grows
  // linearly with v so the damping moment scales as V², matching the V² growth
  // of the destabilizing lift moment from `incidenceRad` and keeping damping
  // ratio constant. No 1/V singularity; clQ=0 preserves pre-β4 behavior exactly.
  // See arch.md Revision 2026-05-11 ("Fallback path") and SURFACE-2026-05-11-03.
  _scratchAngVelCross.copy(bodyState.angvel).cross(_scratchAppOffset);
  if (surface.clQ !== 0) {
    const vBody = bodyState.linvel.length();
    const vScale = vBody > BETA4_V_REF ? vBody / BETA4_V_REF : 1;
    _scratchAngVelCross.multiplyScalar(1 + surface.clQ * vScale);
  }
  _scratchAirflow.copy(bodyState.linvel).add(_scratchAngVelCross).negate();
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
  let cl = lookupLiftDragCurve(surface.clCurve, alpha);
  const cd = lookupLiftDragCurve(surface.cdCurve, alpha);

  // 4b. β5 — AoA-rate damping. Gated on BOTH clAlphaDot ≠ 0 AND a physics
  // dt being supplied AND a previous-tick AoA being cached. The triple
  // gate keeps test fixtures that call computeAeroForce(surface, body)
  // without dt — and surfaces with default clAlphaDot=0 — at bit-for-bit
  // pre-β5 behavior. Sign: positive clAlphaDot adds lift in the +α
  // direction on a rising α, which produces a damping moment on the AoA
  // oscillation that drives the phugoid mode. See arch.md Rev 2026-05-12
  // (D13), CONVENTIONS.md, and SURFACE-2026-05-11-04.
  if (
    surface.clAlphaDot !== 0 &&
    dt !== undefined &&
    dt > 0 &&
    surface.prevAoA !== undefined
  ) {
    const dAlphaDt = (alpha - surface.prevAoA) / dt;
    cl += surface.clAlphaDot * dAlphaDt;
  }
  // Unconditionally cache α_now for the next call's finite difference.
  // Even when augmentation is skipped, the cache must be primed so the
  // following tick can compute a valid dα/dt.
  surface.prevAoA = alpha;

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
