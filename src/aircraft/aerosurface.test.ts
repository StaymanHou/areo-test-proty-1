import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  AeroSurface,
  AIR_DENSITY,
  type BodyState,
  buildSymmetricFlatPlateCurves,
  computeAeroForce,
  computeAirflowAtPoint,
  computeAngleOfAttack,
  createAeroSurface,
  createSymmetricFlatPlateCurves,
  DEFAULT_FLAT_PLATE_PARAMS,
  type LiftDragCurve,
  lookupLiftDragCurve,
} from './aerosurface';

const FLAT_CL: LiftDragCurve = [
  { alpha: -Math.PI / 2, value: 0 },
  { alpha: 0, value: 0 },
  { alpha: Math.PI / 2, value: 0 },
];
const FLAT_CD: LiftDragCurve = [
  { alpha: -Math.PI / 2, value: 1 },
  { alpha: 0, value: 0 },
  { alpha: Math.PI / 2, value: 1 },
];

function makeFlatPlateSurface(): AeroSurface {
  return createAeroSurface({
    position: new Vector3(0, 0, 0),
    normal: new Vector3(0, 1, 0),     // lift is +Y at α=0
    chord: new Vector3(0, 0, -1),     // chord points along −Z (aircraft nose)
    area: 1,
    clCurve: FLAT_CL,
    cdCurve: FLAT_CD,
  });
}

function makeIdentityBody(linvel = new Vector3(), angvel = new Vector3()): BodyState {
  return {
    position: new Vector3(),
    quaternion: new Quaternion(),
    linvel,
    angvel,
  };
}

describe('AeroSurface — Phase 1: shape and construction', () => {
  it('constructs with the expected shape and unit-normalized vectors', () => {
    const s = createAeroSurface({
      position: new Vector3(1, 2, 3),
      normal: new Vector3(0, 2, 0),    // not unit; should be normalized
      chord: new Vector3(0, 0, -3),    // not unit
      area: 2.5,
      clCurve: FLAT_CL,
      cdCurve: FLAT_CD,
    });

    expect(s.position).toEqual(new Vector3(1, 2, 3));
    expect(s.area).toBe(2.5);
    expect(s.normal.length()).toBeCloseTo(1, 9);
    expect(s.chord.length()).toBeCloseTo(1, 9);
    // Normal preserved direction
    expect(s.normal.y).toBeCloseTo(1, 9);
    // Chord preserved direction
    expect(s.chord.z).toBeCloseTo(-1, 9);
  });

  it('stores curves as references (no defensive copy required)', () => {
    const s = makeFlatPlateSurface();
    expect(s.clCurve).toBe(FLAT_CL);
    expect(s.cdCurve).toBe(FLAT_CD);
  });
});

describe('AeroSurface — Phase 1: airflow at point', () => {
  it('zero body velocity → zero airflow', () => {
    const body = makeIdentityBody();
    const out = new Vector3();
    computeAirflowAtPoint(body, new Vector3(1, 0, 0), out);
    expect(out.length()).toBeCloseTo(0, 9);
  });

  it('forward-moving body (along −Z) produces airflow toward +Z', () => {
    // Body moves at 10 m/s along −Z (typical aircraft "forward"); airflow comes from −Z direction onto the plane.
    const body = makeIdentityBody(new Vector3(0, 0, -10));
    const out = new Vector3();
    computeAirflowAtPoint(body, new Vector3(0, 0, 0), out);
    // airflow = −linvel = (0, 0, 10)
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(10, 9);
  });

  it('rotating body adds tangential airflow at offset points', () => {
    // Body at origin, angvel +Y (yaw left), point at +X (right wingtip).
    // angvel × r = (0,1,0) × (1,0,0) = (0,0,-1)*1? Let's compute: (a×b) for (0,1,0)×(1,0,0) = (1*0 - 0*0, 0*1 - 0*0, 0*0 - 1*1) = (0,0,-1).
    // Point velocity = linvel + angvel × r = (0,0,-1).
    // Airflow = −(0,0,-1) = (0,0,1).
    const body = makeIdentityBody(new Vector3(), new Vector3(0, 1, 0));
    const out = new Vector3();
    computeAirflowAtPoint(body, new Vector3(1, 0, 0), out);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(1, 9);
  });
});

describe('AeroSurface — Phase 1: angle of attack', () => {
  const normal = new Vector3(0, 1, 0);
  const chord = new Vector3(0, 0, -1);

  it('zero flow → AoA = 0', () => {
    const aoa = computeAngleOfAttack(new Vector3(0, 0, 0), normal, chord);
    expect(aoa).toBe(0);
  });

  it('flow opposite to chord (level flight relative wind) → AoA = 0', () => {
    // Plane flying forward (−Z); airflow at the wing flows toward +Z, opposite to chord.
    // This is level flight, no AoA.
    const aoa = computeAngleOfAttack(new Vector3(0, 0, 10), normal, chord);
    expect(aoa).toBeCloseTo(0, 9);
  });

  it('flow along +chord direction → AoA = ±π (reversed flow)', () => {
    // Wind blowing along −Z (same direction as chord, i.e., from tail to nose) — reversed
    // airflow. atan2(0, negative) = π.
    const aoa = computeAngleOfAttack(new Vector3(0, 0, -10), normal, chord);
    expect(Math.abs(aoa)).toBeCloseTo(Math.PI, 9);
  });

  it('flow purely along +normal direction → AoA = +π/2 (wind hitting underside)', () => {
    // Flow purely +Y means wind blowing straight up from below into the underside
    // of the wing. perp = flow·normal = (+1) → atan2(+1, 0) = +π/2.
    const aoa = computeAngleOfAttack(new Vector3(0, 1, 0), normal, chord);
    expect(aoa).toBeCloseTo(Math.PI / 2, 9);
  });

  it('flow purely along −normal → AoA = −π/2 (wind on top face)', () => {
    const aoa = computeAngleOfAttack(new Vector3(0, -1, 0), normal, chord);
    expect(aoa).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('flow at +10° AoA (descent with level wing → wind from below)', () => {
    // Plane descends with a level wing (linvel.y < 0). Relative airflow at the wing
    // is roughly toward +Z (opposite to chord) with a small +Y component (wind pushes
    // up under the wing from below). Construct: along = cos(α) along −chord (= +Z),
    // perp = sin(α) along +normal (= +Y).
    const angle = (10 * Math.PI) / 180;
    const flow = new Vector3(0, Math.sin(angle), Math.cos(angle));
    const aoa = computeAngleOfAttack(flow, normal, chord);
    expect(aoa).toBeCloseTo(angle, 6);
  });

  it('flow at −10° AoA is symmetric to +10° (sign convention regression test)', () => {
    // Mirror the +10° flow across the chord plane: flip the +normal component.
    const angle = (10 * Math.PI) / 180;
    const flow = new Vector3(0, -Math.sin(angle), Math.cos(angle));
    const aoa = computeAngleOfAttack(flow, normal, chord);
    expect(aoa).toBeCloseTo(-angle, 6);
  });

  it('spanwise flow (along normal × chord) is rejected and gives AoA = 0', () => {
    // normal × chord = (0,1,0) × (0,0,-1) = (1*(-1)-0*0, 0*0-0*(-1), 0*0-1*0) = (-1, 0, 0).
    // So spanwise axis is −X. Flow purely along −X is purely spanwise.
    const aoa = computeAngleOfAttack(new Vector3(-5, 0, 0), normal, chord);
    expect(aoa).toBe(0);
  });
});

describe('AeroSurface — Phase 2: piecewise-linear curve lookup', () => {
  const curve: LiftDragCurve = [
    { alpha: -1, value: -2 },
    { alpha: 0, value: 0 },
    { alpha: 1, value: 4 },
  ];

  it('returns endpoint values when alpha is at or below first knot', () => {
    expect(lookupLiftDragCurve(curve, -1)).toBe(-2);
    expect(lookupLiftDragCurve(curve, -10)).toBe(-2);
  });

  it('returns endpoint values when alpha is at or above last knot', () => {
    expect(lookupLiftDragCurve(curve, 1)).toBe(4);
    expect(lookupLiftDragCurve(curve, 10)).toBe(4);
  });

  it('interpolates linearly between knots', () => {
    expect(lookupLiftDragCurve(curve, -0.5)).toBeCloseTo(-1, 9); // halfway between -2 and 0
    expect(lookupLiftDragCurve(curve, 0.5)).toBeCloseTo(2, 9);   // halfway between 0 and 4
    expect(lookupLiftDragCurve(curve, 0.25)).toBeCloseTo(1, 9);
  });

  it('returns 0 for empty curve', () => {
    expect(lookupLiftDragCurve([], 0.5)).toBe(0);
  });
});

describe('AeroSurface — Phase 2: computeAeroForce', () => {
  const { cl, cd } = createSymmetricFlatPlateCurves();

  function makeFlatPlateAtOrigin(): AeroSurface {
    return createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: cl,
      cdCurve: cd,
    });
  }

  function makeBody(linvel: Vector3, opts: Partial<BodyState> = {}): BodyState {
    return {
      position: opts.position ?? new Vector3(),
      quaternion: opts.quaternion ?? new Quaternion(),
      linvel,
      angvel: opts.angvel ?? new Vector3(),
    };
  }

  it('zero airflow → zero force', () => {
    const s = makeFlatPlateAtOrigin();
    const body = makeBody(new Vector3());
    const result = computeAeroForce(s, body);
    expect(result.force.length()).toBeCloseTo(0, 9);
  });

  it('symmetric flat plate at α≈0 produces ~zero lift, small drag', () => {
    // Body moves forward (−Z) at 10 m/s with identity orientation. Airflow at the
    // surface is +Z, which is along +chord direction → AoA ≈ 0 → CL ≈ 0.
    const s = makeFlatPlateAtOrigin();
    const body = makeBody(new Vector3(0, 0, -10));
    const result = computeAeroForce(s, body);
    // Lift component along world Y should be ~0.
    expect(Math.abs(result.force.y)).toBeLessThan(1e-6);
    // Drag is small but nonzero (CD at α=0 is 0.02). Pushes body backward (+Z).
    const expectedDrag = 0.5 * AIR_DENSITY * 100 * 1 * 0.02;
    expect(result.force.z).toBeCloseTo(expectedDrag, 4);
  });

  it('pre-stall positive AoA produces positive lift along normal', () => {
    // Construct linvel that yields airflow at +10° AoA. With the corrected convention,
    // positive AoA means flow has +normal component (wind from below into underside).
    // Body descending with level wing: linvel = (0, −sin·v, −cos·v) → airflow at the wing
    // is (0, +sin·v, +cos·v), which has +Y (= +normal) component → positive AoA.
    const angle = (10 * Math.PI) / 180;
    const speed = 10;
    const linvel = new Vector3(0, -Math.sin(angle) * speed, -Math.cos(angle) * speed);
    const s = makeFlatPlateAtOrigin();
    const body = makeBody(linvel);
    const result = computeAeroForce(s, body);
    // Lift component along +Y is positive.
    expect(result.force.y).toBeGreaterThan(0);
    // Magnitude check: total Y-force = liftMag·normal.y + dragMag·airflowDir.y.
    // For identity body and our flat-plate curves at α=10°: CL = 2π·α, CD ≈ 0.05/15° linear.
    // Lift contribution: 0.5·ρ·v²·A·CL pushes +Y.
    // Drag direction is +airflow_normalized, so airflow.y = −sin(α) → drag pushes in −Y.
    // Loose tolerance — exact CL/CD comes from the curve, but order of magnitude must be right.
    const q = 0.5 * AIR_DENSITY * speed * speed * 1;
    const expectedLift = q * (2 * Math.PI * angle);
    // Force.y is at least 90% of pure lift estimate (drag subtracts a few %).
    expect(result.force.y).toBeGreaterThan(expectedLift * 0.9);
    expect(result.force.y).toBeLessThan(expectedLift * 1.05);
  });

  it('post-stall lift drops below pre-stall peak', () => {
    // Compare lift at α=15° (stall peak) vs α=30° (deep post-stall).
    // Body descending with level wing for both samples → positive AoA.
    const speed = 10;
    const s = makeFlatPlateAtOrigin();

    const a1 = (15 * Math.PI) / 180;
    const body1 = makeBody(new Vector3(0, -Math.sin(a1) * speed, -Math.cos(a1) * speed));
    const lift1 = computeAeroForce(s, body1).force.y;

    const a2 = (30 * Math.PI) / 180;
    const body2 = makeBody(new Vector3(0, -Math.sin(a2) * speed, -Math.cos(a2) * speed));
    // Snapshot before second call (force vector is reused — must capture).
    const lift2 = computeAeroForce(s, body2).force.y;

    expect(lift1).toBeGreaterThan(0);
    expect(lift2).toBeLessThan(lift1);
  });

  it('drag rises with |α| in pre-stall region', () => {
    const speed = 10;
    const s = makeFlatPlateAtOrigin();
    const dragAt = (angleDeg: number) => {
      const a = (angleDeg * Math.PI) / 180;
      const body = makeBody(new Vector3(0, Math.sin(a) * speed, -Math.cos(a) * speed));
      // Drag direction is +airflow_normalized; airflow is roughly (0, -sin, +cos) so
      // drag has a component along +Z. Use the +Z component as a drag proxy.
      return computeAeroForce(s, body).force.z;
    };
    const d0 = dragAt(0);
    const d5 = dragAt(5);
    const d10 = dragAt(10);
    expect(d5).toBeGreaterThan(d0);
    expect(d10).toBeGreaterThan(d5);
  });

  it('application point is correctly transformed for non-identity body pose', () => {
    // Surface at local (1, 0, 0). Body at world (10, 5, 0), rotated 90° around +Y.
    // Rotation Y by 90° turns +X → −Z (right-hand). So local (1,0,0) → world (0,0,-1).
    // Application point = body.position + rotated_local = (10, 5, 0) + (0, 0, -1) = (10, 5, -1).
    const s = createAeroSurface({
      position: new Vector3(1, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: cl,
      cdCurve: cd,
    });
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const body: BodyState = {
      position: new Vector3(10, 5, 0),
      quaternion: q,
      linvel: new Vector3(0, 0, -10), // some airflow so we don't early-return
      angvel: new Vector3(),
    };
    const result = computeAeroForce(s, body);
    expect(result.applicationPoint.x).toBeCloseTo(10, 6);
    expect(result.applicationPoint.y).toBeCloseTo(5, 6);
    expect(result.applicationPoint.z).toBeCloseTo(-1, 6);
  });

  it('lift varies smoothly through α=0 (sign-continuity regression test)', () => {
    // Sweep AoA from −10° to +10° in 5° steps. Lift along +Y should be:
    //   negative at negative α, ≈0 at α=0, positive at positive α.
    // Catches a class of bugs where the AoA convention flips sign and produces
    // discontinuous lift across the chord direction.
    // Per corrected convention: positive AoA = wind from below into underside.
    // Body with linvel.y = −sin·v (descending) gives airflow with +Y component
    // at the wing = positive AoA = positive lift.
    const speed = 10;
    const s = makeFlatPlateAtOrigin();
    const liftAt = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      const body = makeBody(new Vector3(0, -Math.sin(a) * speed, -Math.cos(a) * speed));
      return computeAeroForce(s, body).force.y;
    };
    const samples = [-10, -5, -1, 0, 1, 5, 10].map(liftAt);
    // Strictly monotonically increasing.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]!);
    }
    // Sign changes through zero.
    expect(samples[0]).toBeLessThan(0);  // -10°
    expect(samples[3]).toBeCloseTo(0, 5); // 0°
    expect(samples[6]).toBeGreaterThan(0); // +10°
  });

  it('result.force vector is reused — second call mutates first reference', () => {
    // Documents the no-allocation contract: if callers need to retain values, they must copy.
    const s = makeFlatPlateAtOrigin();
    const body1 = makeBody(new Vector3(0, 0, -10));
    const body2 = makeBody(new Vector3(0, 0, -20));
    const r1 = computeAeroForce(s, body1);
    const f1Ref = r1.force;
    const r2 = computeAeroForce(s, body2);
    expect(r2.force).toBe(f1Ref); // same reference, mutated
  });
});

describe('AeroSurface — Phase 2: createSymmetricFlatPlateCurves', () => {
  it('returns symmetric CL: CL(−α) ≈ −CL(α)', () => {
    const { cl } = createSymmetricFlatPlateCurves();
    for (const a of [0.05, 0.1, 0.2, 0.5]) {
      expect(lookupLiftDragCurve(cl, a)).toBeCloseTo(-lookupLiftDragCurve(cl, -a), 6);
    }
  });

  it('returns symmetric CD: CD(α) ≈ CD(−α) and CD(0) is the minimum', () => {
    const { cd } = createSymmetricFlatPlateCurves();
    const cd0 = lookupLiftDragCurve(cd, 0);
    for (const a of [0.05, 0.1, 0.2, 0.5]) {
      expect(lookupLiftDragCurve(cd, a)).toBeCloseTo(lookupLiftDragCurve(cd, -a), 6);
      expect(lookupLiftDragCurve(cd, a)).toBeGreaterThan(cd0);
    }
  });
});

describe('AeroSurface — WP6: deflection support', () => {
  function makeStandardSurface(maxDeflectionRad?: number): AeroSurface {
    return createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: FLAT_CL,
      cdCurve: FLAT_CD,
      maxDeflectionRad,
    });
  }

  it('throws when normal and chord are parallel (degenerate span)', () => {
    expect(() =>
      createAeroSurface({
        position: new Vector3(),
        normal: new Vector3(0, 0, -1),
        chord: new Vector3(0, 0, -1),
        area: 1,
        clCurve: FLAT_CL,
        cdCurve: FLAT_CD,
      }),
    ).toThrow(/parallel/);
  });

  it('default maxDeflectionRad is ~25°', () => {
    const s = makeStandardSurface();
    expect(s.maxDeflectionRad).toBeCloseTo((25 * Math.PI) / 180, 6);
  });

  it('honors a custom maxDeflectionRad', () => {
    const s = makeStandardSurface(0.2);
    expect(s.maxDeflectionRad).toBe(0.2);
  });

  it('captures rest snapshots and pre-bakes spanAxis', () => {
    const s = makeStandardSurface();
    expect(s.restNormal.equals(new Vector3(0, 1, 0))).toBe(true);
    expect(s.restChord.equals(new Vector3(0, 0, -1))).toBe(true);
    // span = normal × chord = (0,1,0) × (0,0,-1) = (-1, 0, 0)
    expect(s.spanAxis.x).toBeCloseTo(-1, 6);
    expect(s.spanAxis.y).toBeCloseTo(0, 6);
    expect(s.spanAxis.z).toBeCloseTo(0, 6);
  });

  it('setDeflection(0) is identity — chord and normal exactly equal rest', () => {
    const s = makeStandardSurface();
    s.setDeflection(0.3);
    s.setDeflection(0);
    expect(s.chord.x).toBe(s.restChord.x);
    expect(s.chord.y).toBe(s.restChord.y);
    expect(s.chord.z).toBe(s.restChord.z);
    expect(s.normal.x).toBe(s.restNormal.x);
    expect(s.normal.y).toBe(s.restNormal.y);
    expect(s.normal.z).toBe(s.restNormal.z);
    expect(s.deflection).toBe(0);
  });

  it('setDeflection clamps to ±maxDeflectionRad', () => {
    const s = makeStandardSurface(0.2);
    s.setDeflection(0.5);
    expect(s.deflection).toBe(0.2);
    s.setDeflection(-0.5);
    expect(s.deflection).toBe(-0.2);
  });

  it('rotates chord by ~+0.3 rad about spanAxis (h-stab geometry)', () => {
    // standard surface: normal=+Y, chord=−Z, spanAxis = normal × chord = −X.
    // Rotating chord (0,0,-1) about unit axis (-1,0,0) by +0.3 rad (Rodrigues):
    //   chord' = (0, −sin(0.3), −cos(0.3))
    const s = makeStandardSurface();
    s.setDeflection(0.3);
    expect(s.chord.x).toBeCloseTo(0, 6);
    expect(s.chord.y).toBeCloseTo(-Math.sin(0.3), 6);
    expect(s.chord.z).toBeCloseTo(-Math.cos(0.3), 6);
    // Normal also rotates; remains perpendicular to chord.
    expect(s.normal.dot(s.chord)).toBeCloseTo(0, 6);
  });

  it('chord and normal stay perpendicular through deflection at multiple angles', () => {
    const s = makeStandardSurface(Math.PI / 3); // wide so we can sweep
    for (const angle of [-0.4, -0.1, 0, 0.1, 0.3, 0.6]) {
      s.setDeflection(angle);
      expect(s.normal.dot(s.chord)).toBeCloseTo(0, 6);
      // Both stay unit length.
      expect(s.normal.length()).toBeCloseTo(1, 6);
      expect(s.chord.length()).toBeCloseTo(1, 6);
    }
  });

  it('computeAeroForce with zero deflection equals pre-deflection reference', () => {
    // Regression guard: rest snapshot must reproduce original behavior bit-for-bit.
    const s = makeStandardSurface();
    const body: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, -10), // forward flight
      angvel: new Vector3(),
    };
    const r0 = computeAeroForce(s, body);
    const fxRef = r0.force.x, fyRef = r0.force.y, fzRef = r0.force.z;
    // Apply and revert deflection — should not perturb the rest force.
    s.setDeflection(0.4);
    s.setDeflection(0);
    const r1 = computeAeroForce(s, body);
    expect(r1.force.x).toBe(fxRef);
    expect(r1.force.y).toBe(fyRef);
    expect(r1.force.z).toBe(fzRef);
  });

  it('deflecting an h-stab in level airflow changes its produced force', () => {
    // Sanity check that deflection actually changes aerodynamic output.
    // Surface with curves that produce nonzero lift — use the symmetric flat-plate.
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const s = createAeroSurface({
      position: new Vector3(0, 0, 3),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: cl,
      cdCurve: cd,
    });
    const body: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, -30),
      angvel: new Vector3(),
    };
    const f0 = { x: 0, y: 0, z: 0 };
    const r0 = computeAeroForce(s, body);
    f0.x = r0.force.x; f0.y = r0.force.y; f0.z = r0.force.z;
    s.setDeflection(0.2);
    const r1 = computeAeroForce(s, body);
    // Lift component (Y) should differ — deflection changes effective AoA.
    expect(Math.abs(r1.force.y - f0.y)).toBeGreaterThan(0.1);
  });
});

describe('buildSymmetricFlatPlateCurves', () => {
  it('emits 7 CL knots and 5 CD knots', () => {
    const { cl, cd } = buildSymmetricFlatPlateCurves(DEFAULT_FLAT_PLATE_PARAMS);
    expect(cl).toHaveLength(7);
    expect(cd).toHaveLength(5);
  });

  it('with default params, evaluates identically to createSymmetricFlatPlateCurves', () => {
    const a = createSymmetricFlatPlateCurves();
    const b = buildSymmetricFlatPlateCurves(DEFAULT_FLAT_PLATE_PARAMS);
    // Sample CL/CD at a representative alpha grid and compare via lookup.
    const alphas = [-1.4, -0.5, -0.2, -0.05, 0, 0.05, 0.2, 0.5, 1.4];
    for (const α of alphas) {
      expect(lookupLiftDragCurve(b.cl, α)).toBe(lookupLiftDragCurve(a.cl, α));
      expect(lookupLiftDragCurve(b.cd, α)).toBe(lookupLiftDragCurve(a.cd, α));
    }
  });

  it('CL_max is derived as clSlope · stallAlpha', () => {
    const params = { ...DEFAULT_FLAT_PLATE_PARAMS, clSlope: 8, stallAlpha: 0.3 };
    const { cl } = buildSymmetricFlatPlateCurves(params);
    // The α=stallAlpha knot is index 4 in the 7-knot layout (after −π/2, −2α, −α, 0).
    expect(cl[4]!.alpha).toBeCloseTo(0.3, 12);
    expect(cl[4]!.value).toBeCloseTo(8 * 0.3, 12);
  });

  it('raising clSlope monotonically raises pre-stall CL at a fixed sub-stall alpha', () => {
    const lo = buildSymmetricFlatPlateCurves({ ...DEFAULT_FLAT_PLATE_PARAMS, clSlope: 4 });
    const hi = buildSymmetricFlatPlateCurves({ ...DEFAULT_FLAT_PLATE_PARAMS, clSlope: 9 });
    const α = 0.1; // ~5.7°, well pre-stall
    expect(lookupLiftDragCurve(hi.cl, α)).toBeGreaterThan(lookupLiftDragCurve(lo.cl, α));
  });

  it('raising cdMin raises drag at α = 0', () => {
    const lo = buildSymmetricFlatPlateCurves({ ...DEFAULT_FLAT_PLATE_PARAMS, cdMin: 0.02 });
    const hi = buildSymmetricFlatPlateCurves({ ...DEFAULT_FLAT_PLATE_PARAMS, cdMin: 0.10 });
    expect(lookupLiftDragCurve(hi.cd, 0)).toBeGreaterThan(lookupLiftDragCurve(lo.cd, 0));
  });

  it('CD knot endpoints reflect cdMax and stall knots reflect cdStall', () => {
    const { cd } = buildSymmetricFlatPlateCurves({
      ...DEFAULT_FLAT_PLATE_PARAMS,
      cdStall: 0.07,
      cdMax: 1.5,
    });
    expect(cd[0]!.value).toBeCloseTo(1.5, 12);
    expect(cd[cd.length - 1]!.value).toBeCloseTo(1.5, 12);
    expect(cd[1]!.value).toBeCloseTo(0.07, 12);
    expect(cd[3]!.value).toBeCloseTo(0.07, 12);
  });
});

describe('AeroSurface.setGeometry', () => {
  it('partial update of area only leaves geometry untouched', () => {
    const s = makeFlatPlateSurface();
    const restNormal0 = s.restNormal.clone();
    const restChord0 = s.restChord.clone();
    const spanAxis0 = s.spanAxis.clone();
    s.setGeometry({ area: 9 });
    expect(s.area).toBe(9);
    expect(s.restNormal).toEqual(restNormal0);
    expect(s.restChord).toEqual(restChord0);
    expect(s.spanAxis).toEqual(spanAxis0);
  });

  it('partial update of position only leaves geometry untouched', () => {
    const s = makeFlatPlateSurface();
    const spanAxis0 = s.spanAxis.clone();
    s.setGeometry({ position: new Vector3(5, 6, 7) });
    expect(s.position.x).toBe(5);
    expect(s.position.y).toBe(6);
    expect(s.position.z).toBe(7);
    expect(s.spanAxis).toEqual(spanAxis0);
  });

  it('updating normal+chord re-bakes restNormal/restChord/spanAxis', () => {
    const s = makeFlatPlateSurface();
    // Original: normal=(0,1,0), chord=(0,0,-1), spanAxis=normal×chord=(1,0,0).
    // Switch to v-stab geometry: normal=(1,0,0), chord=(0,0,-1) → spanAxis=(0,1,0).
    s.setGeometry({ normal: new Vector3(1, 0, 0), chord: new Vector3(0, 0, -1) });
    expect(s.restNormal.x).toBeCloseTo(1, 12);
    expect(s.restNormal.y).toBeCloseTo(0, 12);
    expect(s.restNormal.z).toBeCloseTo(0, 12);
    expect(s.restChord.x).toBeCloseTo(0, 12);
    expect(s.restChord.z).toBeCloseTo(-1, 12);
    expect(s.spanAxis.x).toBeCloseTo(0, 9);
    expect(s.spanAxis.y).toBeCloseTo(1, 9);
    expect(s.spanAxis.z).toBeCloseTo(0, 9);
  });

  it('renormalizes non-unit normal and chord', () => {
    const s = makeFlatPlateSurface();
    s.setGeometry({ normal: new Vector3(0, 5, 0), chord: new Vector3(0, 0, -3) });
    expect(s.normal.length()).toBeCloseTo(1, 12);
    expect(s.chord.length()).toBeCloseTo(1, 12);
  });

  it('resets deflection to 0 after geometry change', () => {
    const s = makeFlatPlateSurface();
    s.setDeflection(0.2);
    expect(s.deflection).toBeCloseTo(0.2, 12);
    s.setGeometry({ normal: new Vector3(1, 0, 0), chord: new Vector3(0, 0, -1) });
    expect(s.deflection).toBe(0);
    // chord/normal should match the new rest snapshots (no residual rotation).
    expect(s.normal.x).toBeCloseTo(1, 12);
    expect(s.chord.z).toBeCloseTo(-1, 12);
  });

  it('throws on degenerate geometry (parallel normal and chord)', () => {
    const s = makeFlatPlateSurface();
    expect(() =>
      s.setGeometry({ normal: new Vector3(1, 0, 0), chord: new Vector3(2, 0, 0) }),
    ).toThrow(/parallel/);
  });

  it('does not retain references to caller Vector3s', () => {
    const s = makeFlatPlateSurface();
    const callerPos = new Vector3(1, 2, 3);
    s.setGeometry({ position: callerPos });
    callerPos.set(99, 99, 99);
    expect(s.position.x).toBe(1);
    expect(s.position.y).toBe(2);
    expect(s.position.z).toBe(3);
  });
});

describe('AeroSurface.setCurves', () => {
  it('replaces clCurve/cdCurve and a subsequent computeAeroForce uses the new curves', () => {
    // Start with a zero-CL curve so lift is zero, then swap to a high-CL curve.
    const ZERO_CL: LiftDragCurve = [
      { alpha: -Math.PI / 2, value: 0 },
      { alpha: 0, value: 0 },
      { alpha: Math.PI / 2, value: 0 },
    ];
    const HIGH_CL: LiftDragCurve = [
      { alpha: -Math.PI / 2, value: 0 },
      { alpha: 0, value: 0 },
      { alpha: 0.2, value: 5 }, // very high CL at 0.2 rad
      { alpha: Math.PI / 2, value: 0 },
    ];
    const ZERO_CD: LiftDragCurve = [
      { alpha: -Math.PI / 2, value: 0 },
      { alpha: 0, value: 0 },
      { alpha: Math.PI / 2, value: 0 },
    ];
    const s = createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: ZERO_CL,
      cdCurve: ZERO_CD,
    });
    // α=+10° flow (body descending with level wing → wind from below into underside).
    const angle = (10 * Math.PI) / 180;
    const speed = 10;
    const linvel = new Vector3(0, -Math.sin(angle) * speed, -Math.cos(angle) * speed);
    const body: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel,
      angvel: new Vector3(),
    };
    const liftBefore = computeAeroForce(s, body).force.y;
    expect(liftBefore).toBeCloseTo(0, 9);

    s.setCurves(HIGH_CL, ZERO_CD);
    const liftAfter = computeAeroForce(s, body).force.y;
    expect(liftAfter).toBeGreaterThan(0);
    // Sanity: 0.5·ρ·v²·A·CL with CL ~ interp at α=10° ≈ 2.5 should be ~150 N.
    expect(liftAfter).toBeGreaterThan(50);
  });
});
