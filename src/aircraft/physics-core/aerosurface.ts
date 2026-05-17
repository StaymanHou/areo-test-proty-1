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
   * Pitch-rate damping coefficient (β4). Under D17 (arch.md Revision
   * 2026-05-17) this is a dimensionless O(1) coefficient (textbook range
   * 1–10 per Etkin & Reid Table 5.4). When non-zero, the lift coefficient
   * is augmented by `clQ · ω_along_dampAxis · c̄ / (2 · max(V, V_REF))`,
   * where `dampAxis = (position × restNormal).normalized()` is the
   * surface's rotation-damping axis (roll Z for wings, pitch X for h-stab,
   * primarily yaw Y for v-stab). The factor `c̄ / (2V)` is the standard
   * reduced-frequency normalization; the `max(V, V_REF)` floor avoids the
   * `1/V` singularity. The resulting damping force grows linearly with V
   * (matching ½ρV² dynamic pressure × ΔCL ∝ 1/V). Replaces the pre-D17
   * WP6.5/WP6.6 airflow-amplification form. Default 0 (no augmentation —
   * pre-β4 behavior preserved). See CONVENTIONS.md, arch.md D17 (Revision
   * 2026-05-17), and SURFACE-2026-05-17-01.
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

// Shared β4/β5 reference airspeed (arch.md D17 + D16). Both β4 (pitch-rate
// damping) and β5 (AoA-rate damping) augment CL by a `c̄ / (2 · max(V, V_REF))`
// factor — the textbook reduced-frequency normalization. The `max(V, V_REF)`
// floor avoids the `1/V` singularity at low airspeed and anchors the damping
// scale in the descending-glide attractor regime. The same physical role
// applies to both; one constant per arch.md "shared reference airspeed"
// rationale. Pre-D17 this constant was scoped to β4's now-removed airflow-
// amplification form; under D17 it is the floor for the CL-augmentation
// denominator. Value (30 m/s) matches WP14.5 phugoid-probe entry velocity
// and the aircraft spawn airspeed.
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
const _scratchDampAxis = new Vector3();
const _scratchDampAxisWorld = new Vector3();

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
  /**
   * Pre-baked damping axis for D17 β4 pitch-rate damping. Computed as
   * `(normal × position).normalized()` BEFORE the incidence rotation is
   * applied to normal/chord (matches `spanAxis` derivation timing).
   * Geometrically: the body-frame axis along which positive angular
   * velocity produces a CL augmentation that opposes the motion (damping).
   * For canonical configs: h-stab `normal=(0,1,0), position=(0,0,r)` →
   * dampAxis = `(0,1,0)×(0,0,r) = (r,0,0)/r = +X` (pitch axis). Wing-right
   * `normal=(0,1,0), position=(2,0,0)` → dampAxis = `(0,1,0)×(2,0,0) =
   * (0,0,−2)/2 = −Z` (anti-roll). Wing-left → `+Z`. V-stab
   * `normal=(1,0,0), position=(0,0.5,3)` → primarily −Y (anti-yaw).
   *
   * **Cross-product order note:** arch.md D17 (Revision 2026-05-17) prose
   * specifies `(position × normal)` literally, but that gives the wrong
   * sign — verified analytically by tracing the moment-direction chain
   * (positive pitch rate at +Z aft surface needs +Y damping force = +ΔCL,
   * which requires `dot(ω, dampAxis) > 0` for ω = (1,0,0), which requires
   * dampAxis = +X). The corrected order is `(normal × position)`. Surfaced
   * to product:arch as SURFACE-2026-05-17-02 for an arch.md errata.
   *
   * Refreshed by `setGeometry({position?, normal?})`. If the geometric
   * cross product degenerates (position parallel to normal, e.g. a
   * CG-coincident surface — physically nonsensical), the axis falls back
   * to a zero vector and β4 augmentation contributes zero by virtue of
   * the dot product. Mutable only via setGeometry.
   */
  dampAxis: Vector3;
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

    // D17 β4 damping axis = (normal × position).normalized(), pre-incidence.
    // `this.normal` at this point is the pre-incidence rest normal (incidence
    // is applied below). Cross-product order is `(normal × position)`, NOT the
    // `(position × normal)` literal in arch.md D17 prose — see dampAxis
    // field-doc above for sign-correction analysis. Position-coincident-with-CG
    // surfaces (lengthSq < tolerance) get a zero dampAxis; β4 augmentation then
    // contributes zero by virtue of the dot product. Physically irrelevant —
    // a real lift surface always has a non-zero CG offset.
    const damp = new Vector3().crossVectors(this.normal, this.position);
    if (damp.lengthSq() < 1e-9) {
      this.dampAxis = new Vector3(0, 0, 0);
    } else {
      this.dampAxis = damp.normalize();
    }

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

      // D17: refresh dampAxis from pre-incidence normal × position. Must be
      // computed BEFORE the incidence rotation below — matches the
      // constructor's ordering.
      _scratchDampAxis.crossVectors(this.normal, this.position);
      if (_scratchDampAxis.lengthSq() < 1e-9) {
        this.dampAxis.set(0, 0, 0);
      } else {
        this.dampAxis.copy(_scratchDampAxis).normalize();
      }

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
    } else if (opts.position !== undefined) {
      // Position-only change: dampAxis depends on position too. restNormal is
      // the post-incidence rest normal; for a pure position change we don't
      // re-bake spanAxis (normal didn't change), so we use restNormal
      // directly. The small incidence-tilt of restNormal vs the pre-incidence
      // normal makes this an approximation, but for typical incidence values
      // (≤2° per aircraft.json) the dampAxis tilt is sub-degree — well below
      // the geometric uncertainty in the position itself. For surfaces where
      // this matters, recompute from scratch by passing `normal` too.
      _scratchDampAxis.crossVectors(this.restNormal, this.position);
      if (_scratchDampAxis.lengthSq() < 1e-9) {
        this.dampAxis.set(0, 0, 0);
      } else {
        this.dampAxis.copy(_scratchDampAxis).normalize();
      }
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
  // Airflow = −(linvel + ω × r). The `ω × r` cross product is the linear
  // airflow contribution from body rotation — physically the velocity of
  // the surface's application point through the air due to angular motion.
  // Under D17 (arch.md Revision 2026-05-17), β4 (pitch-rate damping) no
  // longer scales this airflow — it enters at the CL level (step 4b)
  // instead, as a standard non-dimensional reduced-frequency term
  // `clQ · ω_along_dampAxis · c̄ / (2·max(V, V_REF))`. This matches the
  // textbook unsteady-aero treatment (Etkin & Reid §5.10) and the parallel
  // β5 treatment (D16). Pre-D17 the airflow chain was amplified by
  // `(1 + clQ · max(v,V_REF)/V_REF)` — that produced cubic V³ damping-
  // force growth (linear amplification × V² dynamic pressure) and NaN'd
  // above V_REF (SURFACE-2026-05-16-01, SURFACE-2026-05-17-01). The D17
  // form produces linear-V damping-force growth, matching the linear-V
  // growth of the destabilizing incidence moment.
  _scratchAngVelCross.copy(bodyState.angvel).cross(_scratchAppOffset);
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

  // 4b. β4 — D17 non-dimensional pitch-rate damping. CL augmentation form:
  //   ΔCL = clQ · ω_along_dampAxis · c̄ / (2 · max(V, V_REF))
  // where dampAxis is the surface's pre-baked damping axis (roll for wings,
  // pitch for h-stab, primarily yaw for v-stab) rotated into the world
  // frame. The factor `c̄ / (2V)` is the textbook reduced-frequency
  // normalization; the `max(V, V_REF)` floor avoids the 1/V singularity.
  // Gated on clQ ≠ 0 so the default surface preserves pre-β4 behavior
  // bit-for-bit (the gate is the same shape as pre-D17; only the body of
  // the branch changed). Sign: dampAxis = (position × restNormal); for an
  // aft surface (position = (0,0,+r)) with restNormal = (0,1,0),
  // dampAxis = (−1,0,0) — anti-pitch direction. Positive body pitch rate
  // (nose-up, +ω_y... actually +ω_x in body-Y-up) produces negative
  // dot(angvel, dampAxis), so ΔCL < 0 on the aft surface, which produces
  // downward lift, which produces nose-down moment, which damps the pitch.
  // See arch.md D17 (Revision 2026-05-17), CONVENTIONS.md, SURFACE-2026-05-17-01.
  if (surface.clQ !== 0) {
    _scratchDampAxisWorld.copy(surface.dampAxis).applyQuaternion(bodyState.quaternion);
    const omegaAlongDampAxis = bodyState.angvel.dot(_scratchDampAxisWorld);
    const vBody = bodyState.linvel.length();
    const vEff = vBody > BETA4_V_REF ? vBody : BETA4_V_REF;
    cl += surface.clQ * omegaAlongDampAxis * surface.chordLength / (2 * vEff);
  }

  // 4c. β5 — AoA-rate damping. Gated on BOTH clAlphaDot ≠ 0 AND a physics
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
