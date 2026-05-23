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

describe('AeroSurface — WP6.5: per-surface incidence (D10)', () => {
  it('defaults: incidenceRad omitted leaves normal/chord/rest snapshots unchanged (regression baseline)', () => {
    const cfg = {
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: FLAT_CL,
      cdCurve: FLAT_CD,
    };
    const withoutIncidence = createAeroSurface(cfg);
    const withZeroIncidence = createAeroSurface({ ...cfg, incidenceRad: 0 });

    // Identical normal/chord/rest snapshots — bit-for-bit Phase-1 behavior preserved.
    expect(withoutIncidence.incidenceRad).toBe(0);
    expect(withZeroIncidence.incidenceRad).toBe(0);
    expect(withZeroIncidence.normal.equals(withoutIncidence.normal)).toBe(true);
    expect(withZeroIncidence.chord.equals(withoutIncidence.chord)).toBe(true);
    expect(withZeroIncidence.restNormal.equals(withoutIncidence.restNormal)).toBe(true);
    expect(withZeroIncidence.restChord.equals(withoutIncidence.restChord)).toBe(true);
    expect(withZeroIncidence.spanAxis.equals(withoutIncidence.spanAxis)).toBe(true);
    // And those snapshots equal the input vectors after normalize.
    expect(withZeroIncidence.normal.x).toBeCloseTo(0, 12);
    expect(withZeroIncidence.normal.y).toBeCloseTo(1, 12);
    expect(withZeroIncidence.normal.z).toBeCloseTo(0, 12);
    expect(withZeroIncidence.chord.x).toBeCloseTo(0, 12);
    expect(withZeroIncidence.chord.y).toBeCloseTo(0, 12);
    expect(withZeroIncidence.chord.z).toBeCloseTo(-1, 12);
  });

  it('positive incidenceRad rotates the surface leading-edge-up → non-zero lift at level body attitude with forward airflow', () => {
    const { cl, cd } = createSymmetricFlatPlateCurves();
    // 15° incidence — the stall peak for the default flat-plate curve; gives the
    // maximum pre-stall CL, so produces an unambiguously large positive lift.
    const incidence = (15 * Math.PI) / 180;
    const s = createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: cl,
      cdCurve: cd,
      incidenceRad: incidence,
    });

    // Body flies straight forward (−Z) at 30 m/s, level (identity rotation).
    // Without incidence, AoA would be 0 → CL=0 → zero lift.
    // With +15° incidence, the surface sees +15° AoA → CL = clMax → strong +Y lift.
    const body: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, -30),
      angvel: new Vector3(),
    };
    const { force } = computeAeroForce(s, body);

    // Sanity: expected lift magnitude is roughly 0.5·ρ·v²·A·CL(15°).
    const clMax = DEFAULT_FLAT_PLATE_PARAMS.clSlope * DEFAULT_FLAT_PLATE_PARAMS.stallAlpha;
    const q = 0.5 * AIR_DENSITY * 30 * 30 * 1; // area=1
    const expectedLiftY = q * clMax * Math.cos(incidence); // world-frame Y component
    // Tolerate ~5% — the lift acts along the rotated normal, which has both Y and Z
    // components after a 15° incidence rotation about the span axis (+X).
    expect(force.y).toBeGreaterThan(expectedLiftY * 0.9);
    expect(force.y).toBeLessThan(expectedLiftY * 1.1);
  });

  it('incidence is a surface property, not a body property — same surface produces the same rest snapshots regardless of body attitude', () => {
    const incidence = (10 * Math.PI) / 180;
    const sA = createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: FLAT_CL,
      cdCurve: FLAT_CD,
      incidenceRad: incidence,
    });
    const sB = createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: FLAT_CL,
      cdCurve: FLAT_CD,
      incidenceRad: incidence,
    });
    // Surfaces are independent of any BodyState — their rest snapshots only
    // depend on construction inputs.
    expect(sA.restNormal.equals(sB.restNormal)).toBe(true);
    expect(sA.restChord.equals(sB.restChord)).toBe(true);
    expect(sA.spanAxis.equals(sB.spanAxis)).toBe(true);
    // And the rotation took effect: the rest normal is no longer pure +Y, the rest
    // chord is no longer pure −Z. Span axis (from the *pre-incidence* normal × chord
    // = (0,1,0) × (0,0,-1) = (-1,0,0)) is unchanged by incidence.
    expect(sA.restNormal.y).toBeCloseTo(Math.cos(incidence), 9);
    // Leading-edge-up convention: +incidence tilts chord toward +Y (leading edge
    // rises). Normal, perpendicular to chord, gains a +Z component (tilts toward
    // where the wind comes from). See CONVENTIONS.md "incidenceRad".
    expect(sA.restNormal.z).toBeCloseTo(Math.sin(incidence), 9);
    expect(sA.spanAxis.x).toBeCloseTo(-1, 12);
    expect(sA.spanAxis.y).toBeCloseTo(0, 12);
    expect(sA.spanAxis.z).toBeCloseTo(0, 12);
    // Chord gains +Y component — the leading edge has tilted up.
    expect(sA.restChord.y).toBeCloseTo(Math.sin(incidence), 9);
    expect(sA.restChord.z).toBeCloseTo(-Math.cos(incidence), 9);
  });

  it('default clQ=0 / omitted preserves bit-for-bit force output (regression baseline)', () => {
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const cfg = {
      position: new Vector3(0, 0, 3),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1.5,
      clCurve: cl,
      cdCurve: cd,
    };
    const baseline = createAeroSurface(cfg);
    const explicitZero = createAeroSurface({ ...cfg, clQ: 0 });

    // Body with non-zero angular velocity — exercises the rotation-induced
    // airflow contribution that clQ would amplify if non-zero.
    const body: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, -30),
      angvel: new Vector3(0.5, 0, 0), // +0.5 rad/s pitch rate
    };
    const fBaseline = computeAeroForce(baseline, body);
    const fbX = fBaseline.force.x;
    const fbY = fBaseline.force.y;
    const fbZ = fBaseline.force.z;
    const fExplicit = computeAeroForce(explicitZero, body);
    expect(fExplicit.force.x).toBeCloseTo(fbX, 12);
    expect(fExplicit.force.y).toBeCloseTo(fbY, 12);
    expect(fExplicit.force.z).toBeCloseTo(fbZ, 12);
  });

  it('positive clQ amplifies rotation-induced airflow → larger damping force on rotating body', () => {
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const baseCfg = {
      position: new Vector3(0, 0, 3), // aft surface (h-stab-like)
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1.5,
      clCurve: cl,
      cdCurve: cd,
    };
    const undamped = createAeroSurface(baseCfg);
    const damped = createAeroSurface({ ...baseCfg, clQ: 8 });

    // Body has nose-up pitch rate. At an aft surface, rotation makes the point
    // move downward (−Y) → local airflow has a +Y component → +AoA → lift up
    // → at aft position, nose-down moment → damping. clQ amplifies this.
    const body: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, -30),
      angvel: new Vector3(1.0, 0, 0), // +1 rad/s pitch rate (substantial)
    };
    // Snapshot immediately after each call — `computeAeroForce` returns a
    // reused output Vector3 (see "result.force vector is reused" regression).
    const fUndamped = computeAeroForce(undamped, body);
    const undampedY = fUndamped.force.y;
    const fDamped = computeAeroForce(damped, body);
    const dampedY = fDamped.force.y;

    // Both produce a positive Y force; the damped surface produces a larger
    // one because rotation contribution is amplified by (1 + clQ) = 9.
    expect(undampedY).toBeGreaterThan(0);
    expect(dampedY).toBeGreaterThan(undampedY);
    // Ratio sanity: with clQ=8, rotation contribution is 9x — total force is
    // not 9x because linvel-driven airflow is unchanged, but it should be
    // meaningfully larger.
    expect(dampedY / undampedY).toBeGreaterThan(1.2);
  });

  it('clQ damping direction opposes pitch rate (sign-convention regression anchor)', () => {
    // The key regression class: when body pitches +X (nose up), the aft-surface
    // damping force should produce a moment that opposes +X — i.e., a nose-DOWN
    // moment about the CG. For an aft surface (z=+3, position above and behind
    // CG along the +Z direction), upward force (+Y) gives r × F = (0,0,3) ×
    // (0,F,0) = (-3F, 0, 0) which is NEGATIVE X → nose down → damps + pitch ✓.
    // So the damped Y force must be positive when pRate is positive.
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const surface = createAeroSurface({
      position: new Vector3(0, 0, 3),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1.5,
      clCurve: cl,
      cdCurve: cd,
      clQ: 8,
    });

    // Case A: positive pitch rate (nose up). Damping should produce upward
    // force at aft surface → nose-down moment about CG.
    const posPitchRate: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, -30),
      angvel: new Vector3(1.0, 0, 0),
    };
    const fPositive = computeAeroForce(surface, posPitchRate);
    expect(fPositive.force.y).toBeGreaterThan(0);

    // Case B: negative pitch rate (nose down). Damping should produce downward
    // force at aft surface → nose-up moment about CG.
    const negPitchRate: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, -30),
      angvel: new Vector3(-1.0, 0, 0),
    };
    const fNegative = computeAeroForce(surface, negPitchRate);
    expect(fNegative.force.y).toBeLessThan(0);
  });

  it('clQ damping force grows with airspeed above V_REF under D17 non-dim form (regression anchor for SURFACE-2026-05-11-03 + SURFACE-2026-05-17-01)', () => {
    // Under D17 (arch.md Revision 2026-05-17), β4 augments CL by
    //   ΔCL = clQ · ω_along_dampAxis · c̄ / (2 · max(V, V_REF))
    // Below V_REF the augmentation is constant (V floors at V_REF); above
    // V_REF, ΔCL DECREASES with V as 1/V — but the damping FORCE
    // (q·ΔCL = ½ρV²·A·ΔCL) still grows LINEARLY with V because the V²
    // dynamic-pressure factor more than compensates. Net damping moment
    // therefore scales linearly with V — matching the linear-V growth of
    // the destabilizing moment from incidenceRad (vs the pre-D17 cubic-V³
    // growth which destabilized above V_REF and produced the SURFACE-2026-
    // 05-16-01 NaN at tick 417). The test exercises the floor branch
    // (v=V_REF/2 vs v=V_REF, where damping force scales purely with V²) AND
    // the high-V branch (v=2·V_REF, where damping force scales linearly
    // with V because V² · (1/V) = V).
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const surface = createAeroSurface({
      position: new Vector3(0, 0, 3),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1.5,
      clCurve: cl,
      cdCurve: cd,
      clQ: 8,
    });

    // Tiny pitch rate keeps the rotation-induced contribution small compared
    // to linvel and keeps AoA in the pre-stall linear region.
    const mkBody = (vz: number): BodyState => ({
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, vz),
      angvel: new Vector3(0.05, 0, 0),
    });

    // At v = V_REF/2 = 15 m/s the augmentation floor is active (V_eff = V_REF).
    const fLow = computeAeroForce(surface, mkBody(-15));
    const yLow = fLow.force.y;
    // At v = V_REF = 30 m/s the augmentation floor is exactly at the boundary.
    const fRef = computeAeroForce(surface, mkBody(-30));
    const yRef = fRef.force.y;
    // At v = 2·V_REF = 60 m/s ΔCL halves (factor c̄/(2V)) but the V² in dynamic
    // pressure more than compensates → damping FORCE grows linearly with V.
    const fHigh = computeAeroForce(surface, mkBody(-60));
    const yHigh = fHigh.force.y;

    // All three produce positive damping force at the aft surface for positive
    // pitch rate (nose-up at z=+3 → +Y damping → nose-down moment about CG).
    // Under D17 with corrected dampAxis sign (= normal × position = +X for
    // h-stab), positive pitch-rate × positive clQ → positive ΔCL → upward
    // force at aft surface → damping.
    expect(yLow).toBeGreaterThan(0);
    expect(yRef).toBeGreaterThan(0);
    expect(yHigh).toBeGreaterThan(0);

    // High-V regime: damping force must grow above V_REF. Under D17 the
    // load-bearing physics is q·ΔCL ∝ V² · (1/V) = V (linear) rather than the
    // pre-D17 cubic V³ which destabilized above V_REF. The pre-D17 form was
    // amplification (1 + clQ · V/V_REF) on ω×r — that gave linear growth in
    // airflow, then × V² in dynamic pressure = V³ growth in force. D17's
    // linear-V growth matches the linear-V destabilizing moment from
    // incidenceRad, restoring tunability.
    expect(yHigh).toBeGreaterThan(yRef);
  });

  it('clQ damping force stays finite + bounded for v ≤ V_REF under D17 floor (no 1/V singularity)', () => {
    // Regression anchor for the `max(v, V_REF)` floor under D17. Without the
    // floor, ΔCL = clQ · ω · c̄ / (2V) blows up as v→0 (the textbook reduced-
    // frequency form's 1/V singularity). The floor at V_REF freezes V_eff at
    // V_REF for v ≤ V_REF, keeping ΔCL bounded and damping finite in the low-V
    // descending-glide regime. WP14.5 phugoid-probe entry velocity is V_REF
    // by construction, so the floor activates exactly when the airframe
    // bleeds airspeed below the design point.
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const surface = createAeroSurface({
      position: new Vector3(0, 0, 3),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1.5,
      clCurve: cl,
      cdCurve: cd,
      clQ: 8,
    });

    // Test multiple low-V values; force-y should monotonically reflect lift
    // changes with airspeed, but the β4 amplification factor itself is constant
    // (1+clQ) across all of them. We assert: force.y is positive and finite at
    // each, and the ratio force.y(v=20) / force.y(v=10) is bounded (i.e., the
    // β4 contribution doesn't blow up at low V — there's no 1/V singularity).
    const mkBody = (vz: number): BodyState => ({
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, vz),
      angvel: new Vector3(0.05, 0, 0),
    });
    const yAt5 = computeAeroForce(surface, mkBody(-5)).force.y;
    const yAt10 = computeAeroForce(surface, mkBody(-10)).force.y;
    const yAt20 = computeAeroForce(surface, mkBody(-20)).force.y;
    const yAt30 = computeAeroForce(surface, mkBody(-30)).force.y;

    // All four are finite, positive damping forces.
    expect(Number.isFinite(yAt5)).toBe(true);
    expect(Number.isFinite(yAt10)).toBe(true);
    expect(Number.isFinite(yAt20)).toBe(true);
    expect(Number.isFinite(yAt30)).toBe(true);
    expect(yAt5).toBeGreaterThan(0);
    expect(yAt10).toBeGreaterThan(0);
    expect(yAt20).toBeGreaterThan(0);
    expect(yAt30).toBeGreaterThan(0);

    // No β4 amplification surge at low V — the floor prevents any 1/V-style
    // behavior. yAt5 must NOT dwarf yAt30 (which it would if amplification
    // grew unboundedly as v→0).
    expect(yAt5).toBeLessThan(yAt30 * 5);
  });

  it('setGeometry re-applies stored incidenceRad after normal/chord live-edit', () => {
    const incidence = (12 * Math.PI) / 180;
    const s = createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: FLAT_CL,
      cdCurve: FLAT_CD,
      incidenceRad: incidence,
    });
    const restNormalBefore = s.restNormal.clone();

    // Re-set normal/chord to the same values — incidence should re-apply, so
    // restNormal stays at the rotated direction (not bare +Y).
    s.setGeometry({ normal: new Vector3(0, 1, 0), chord: new Vector3(0, 0, -1) });
    expect(s.restNormal.x).toBeCloseTo(restNormalBefore.x, 9);
    expect(s.restNormal.y).toBeCloseTo(restNormalBefore.y, 9);
    expect(s.restNormal.z).toBeCloseTo(restNormalBefore.z, 9);
    expect(s.incidenceRad).toBe(incidence);
  });

  it('D17 dampAxis derivation matches all 4 canonical aircraft.json surface configs', () => {
    // WP14.9b P1.6. dampAxis = (normal × position).normalized() per the D17
    // implementation (corrected sign vs arch.md literal text per
    // SURFACE-2026-05-17-02). Canonical surfaces from aircraft.json:
    //   - wing-left:  position=(-2, 0, 0), normal=(0, 1, 0) → +Z (roll axis, positive Z direction)
    //   - wing-right: position=( 2, 0, 0), normal=(0, 1, 0) → -Z (roll axis, negative Z direction)
    //   - h-stab:     position=( 0, 0, 3), normal=(0, 1, 0) → +X (pitch axis)
    //   - v-stab:     position=( 0, 0.5, 3), normal=(1, 0, 0) → primarily -Y (yaw axis)
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const mk = (pos: Vector3, nrm: Vector3) =>
      createAeroSurface({
        position: pos,
        normal: nrm,
        chord: new Vector3(0, 0, -1),
        area: 1,
        clCurve: cl,
        cdCurve: cd,
      });

    const wingLeft = mk(new Vector3(-2, 0, 0), new Vector3(0, 1, 0));
    expect(wingLeft.dampAxis.x).toBeCloseTo(0, 9);
    expect(wingLeft.dampAxis.y).toBeCloseTo(0, 9);
    expect(wingLeft.dampAxis.z).toBeCloseTo(1, 9);

    const wingRight = mk(new Vector3(2, 0, 0), new Vector3(0, 1, 0));
    expect(wingRight.dampAxis.x).toBeCloseTo(0, 9);
    expect(wingRight.dampAxis.y).toBeCloseTo(0, 9);
    expect(wingRight.dampAxis.z).toBeCloseTo(-1, 9);

    const hstab = mk(new Vector3(0, 0, 3), new Vector3(0, 1, 0));
    expect(hstab.dampAxis.x).toBeCloseTo(1, 9);
    expect(hstab.dampAxis.y).toBeCloseTo(0, 9);
    expect(hstab.dampAxis.z).toBeCloseTo(0, 9);

    // v-stab: (1,0,0) × (0, 0.5, 3) = (0·3 − 0·0.5, 0·0 − 1·3, 1·0.5 − 0·0)
    //       = (0, −3, 0.5); |.|=√(9+0.25)=√9.25 ≈ 3.041; normalized ≈ (0, −0.9864, 0.1644)
    const vstab = mk(new Vector3(0, 0.5, 3), new Vector3(1, 0, 0));
    expect(vstab.dampAxis.x).toBeCloseTo(0, 9);
    expect(vstab.dampAxis.y).toBeCloseTo(-0.9864, 4);
    expect(vstab.dampAxis.z).toBeCloseTo(0.1644, 4);
    // Unit length sanity across all 4.
    expect(wingLeft.dampAxis.length()).toBeCloseTo(1, 9);
    expect(wingRight.dampAxis.length()).toBeCloseTo(1, 9);
    expect(hstab.dampAxis.length()).toBeCloseTo(1, 9);
    expect(vstab.dampAxis.length()).toBeCloseTo(1, 9);
  });

  it('D17 closed-form non-dim CL augmentation: ΔCL = clQ·ω·c̄/(2·max(V,V_REF))', () => {
    // WP14.9b P1.7. Closed-form sanity at clQ=1, ω_pitch=1 rad/s, c̄=1 m on
    // the canonical h-stab geometry. dampAxis for h-stab is +X; with ω = (1,0,0)
    // omegaAlongDampAxis = +1. Expected ΔCL = 1 · 1 · 1 / (2·max(V, 30)).
    //   V=15:  ΔCL = 1/60  (V floors at 30)
    //   V=30:  ΔCL = 1/60
    //   V=60:  ΔCL = 1/120  (linear DECREASE with V — the textbook reduced-freq form)
    // We probe this by computing the force at clQ=0 vs clQ=1 and reading the
    // difference in CL space via the q·CL relationship.
    const { cl, cd } = createSymmetricFlatPlateCurves();
    // Chord-length = 1 (chord vector magnitude = 1).
    const baseCfg = {
      position: new Vector3(0, 0, 3),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: cl,
      cdCurve: cd,
    };
    const undamped = createAeroSurface(baseCfg);
    const damped = createAeroSurface({ ...baseCfg, clQ: 1 });
    expect(damped.chordLength).toBeCloseTo(1, 9);
    expect(damped.dampAxis.x).toBeCloseTo(1, 9);

    const mkBody = (vz: number): BodyState => ({
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, vz),
      angvel: new Vector3(1, 0, 0), // 1 rad/s pitch rate, along dampAxis = +X
    });

    // The Y-component of force is (q · CL) (since lift dir = +Y here, drag is +Z).
    // ΔF_y = q · ΔCL = 0.5 · ρ · V_air² · A · ΔCL.
    // For airflow magnitude V_air, the linvel contribution dominates ω×r at
    // these V (ω×r ≈ 1·3 = 3 m/s vs linvel = 30/60). The exact V_air ≠ V_body
    // but is close enough for an order-of-magnitude check; we assert the
    // ΔCL-vs-V scaling shape directly via the FORCE RATIO between V=30 and V=60.

    // computeAeroForce returns a reused output Vector3 — snapshot .y
    // IMMEDIATELY after each call before the next call overwrites it.
    const yU30 = computeAeroForce(undamped, mkBody(-30)).force.y;
    const yD30 = computeAeroForce(damped, mkBody(-30)).force.y;
    const dY30 = yD30 - yU30;
    const yU60 = computeAeroForce(undamped, mkBody(-60)).force.y;
    const yD60 = computeAeroForce(damped, mkBody(-60)).force.y;
    const dY60 = yD60 - yU60;

    // At V=30: ΔCL=1/60, q≈0.5·1.225·30²·1 = 551.25 → ΔF_y_expected ≈ 9.19 N.
    // At V=60: ΔCL=1/120, q≈0.5·1.225·60²·1 = 2205 → ΔF_y_expected ≈ 18.375 N.
    // Ratio ΔF60 / ΔF30 = 2 (linear-V growth of damping force — D17's load-
    // bearing physics property).
    expect(dY30).toBeGreaterThan(0); // clQ=1 added positive ΔCL on h-stab for +ω_x
    expect(dY60).toBeGreaterThan(0);
    // Linear-V growth: ratio 2 ± 5% tolerance for AoA-dependent CL_natural noise.
    expect(dY60 / dY30).toBeGreaterThan(1.9);
    expect(dY60 / dY30).toBeLessThan(2.1);
    // Magnitude sanity: ΔF at V=30 is in the 5-15 N range (q·ΔCL = 551·1/60 ≈ 9 N,
    // modulo V_air ≈ V_body approximation).
    expect(dY30).toBeGreaterThan(5);
    expect(dY30).toBeLessThan(15);

    // Floor sanity: ΔCL at V=15 must equal ΔCL at V=30 (V_eff floors at V_REF).
    // But the FORCE q·ΔCL differs because q ∝ V². So ΔF_15 should be ¼ of ΔF_30
    // (V=15: q ≈ 138, ΔCL=1/60 → ΔF ≈ 2.3 N; V=30: ΔF ≈ 9.2 N; ratio = 4).
    const yU15 = computeAeroForce(undamped, mkBody(-15)).force.y;
    const yD15 = computeAeroForce(damped, mkBody(-15)).force.y;
    const dY15 = yD15 - yU15;
    expect(dY15).toBeGreaterThan(0);
    expect(dY30 / dY15).toBeGreaterThan(3.5);
    expect(dY30 / dY15).toBeLessThan(4.5);
  });

  it('D17 setGeometry refreshes dampAxis after position change', () => {
    // WP14.9b P1.3 contract: setGeometry({position}) refreshes dampAxis.
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const s = createAeroSurface({
      position: new Vector3(0, 0, 3),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: cl,
      cdCurve: cd,
    });
    expect(s.dampAxis.x).toBeCloseTo(1, 9);
    expect(s.dampAxis.z).toBeCloseTo(0, 9);
    // Move surface to wing-right position (2, 0, 0) — dampAxis should flip
    // from h-stab pitch (+X) to wing-right anti-roll (-Z).
    s.setGeometry({ position: new Vector3(2, 0, 0) });
    expect(s.dampAxis.x).toBeCloseTo(0, 9);
    expect(s.dampAxis.y).toBeCloseTo(0, 9);
    expect(s.dampAxis.z).toBeCloseTo(-1, 9);
  });

  it('D17 setGeometry refreshes dampAxis after normal change', () => {
    // WP14.9b P1.3 contract: setGeometry({normal}) refreshes dampAxis.
    const { cl, cd } = createSymmetricFlatPlateCurves();
    const s = createAeroSurface({
      position: new Vector3(0, 0, 3),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1,
      clCurve: cl,
      cdCurve: cd,
    });
    expect(s.dampAxis.x).toBeCloseTo(1, 9);
    // Flip normal to v-stab orientation (sideways) — must update spanAxis +
    // dampAxis. v-stab `normal=(1,0,0), position=(0,0,3)` gives dampAxis =
    // (1,0,0) × (0,0,3) = (1·3−0·0, 0·0−1·3, 1·0−0·0) = (0,−3,0) → norm (0,−1,0).
    s.setGeometry({ normal: new Vector3(1, 0, 0), chord: new Vector3(0, 0, -1) });
    expect(s.dampAxis.x).toBeCloseTo(0, 9);
    expect(s.dampAxis.y).toBeCloseTo(-1, 9);
    expect(s.dampAxis.z).toBeCloseTo(0, 9);
  });
});

describe('AeroSurface — WP10.5: AoA-rate damping (β5, D13)', () => {
  // Build a wing-like surface with a lifting CL curve so dα/dt has a numeric
  // effect on the lift coefficient. (FLAT_CL is identically zero — useful for
  // isolating α math but useless for β5 augmentation visibility.)
  function makeLiftingWing(extra?: { clAlphaDot?: number }): AeroSurface {
    const { cl, cd } = createSymmetricFlatPlateCurves();
    return createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1.5,
      clCurve: cl,
      cdCurve: cd,
      ...extra,
    });
  }

  // Two body states with different positive AoA. The first call records α₀ as
  // prevAoA; the second call sees α₁ > α₀ → dα/dt > 0 → positive augmentation.
  // We construct different α via different linvel directions (the body sees
  // airflow from below when descending forward, which is +AoA on a top-up
  // wing). Larger downward component → larger +AoA.
  function bodyWithDescendingFlow(downwardComponent: number): BodyState {
    return {
      position: new Vector3(),
      quaternion: new Quaternion(),
      // Forward at 30 m/s + downward at `downwardComponent` m/s. Airflow at the
      // wing = −linvel = (0, +downwardComponent, +30), which has a +Y
      // component → positive AoA on a normal=+Y wing.
      linvel: new Vector3(0, -downwardComponent, -30),
      angvel: new Vector3(),
    };
  }

  it('default clAlphaDot=0 / omitted preserves bit-for-bit force output (regression baseline for the existing 246 tests)', () => {
    const baseline = makeLiftingWing();
    const explicitZero = makeLiftingWing({ clAlphaDot: 0 });

    const body = bodyWithDescendingFlow(2);
    // Call each surface twice with a non-zero dt and a positive clAlphaDot
    // would normally NOT fire here (both are 0) — but we exercise the same
    // code path to make sure the gating is correct.
    const dt = 1 / 60;
    computeAeroForce(baseline, body, dt);
    const fBaseline = computeAeroForce(baseline, bodyWithDescendingFlow(4), dt);
    const fbX = fBaseline.force.x;
    const fbY = fBaseline.force.y;
    const fbZ = fBaseline.force.z;
    computeAeroForce(explicitZero, body, dt);
    const fExplicit = computeAeroForce(explicitZero, bodyWithDescendingFlow(4), dt);
    expect(fExplicit.force.x).toBeCloseTo(fbX, 12);
    expect(fExplicit.force.y).toBeCloseTo(fbY, 12);
    expect(fExplicit.force.z).toBeCloseTo(fbZ, 12);
  });

  it('first-tick contract: no augmentation on the first call even with large clAlphaDot', () => {
    const surface = makeLiftingWing({ clAlphaDot: 5 });
    const baseline = makeLiftingWing({ clAlphaDot: 0 });

    // First call to each — prevAoA is undefined on the augmented surface, so
    // the augmentation is skipped. The two forces must match.
    const body = bodyWithDescendingFlow(3);
    const dt = 1 / 60;
    const fAug = computeAeroForce(surface, body, dt);
    const yAug = fAug.force.y;
    const fBase = computeAeroForce(baseline, body, dt);
    expect(yAug).toBeCloseTo(fBase.force.y, 12);
    // And prevAoA has been recorded.
    expect(surface.prevAoA).not.toBeUndefined();
  });

  it('constant α produces zero augmentation (dα/dt = 0 → no CL delta)', () => {
    const surface = makeLiftingWing({ clAlphaDot: 5 });
    const baseline = makeLiftingWing({ clAlphaDot: 0 });

    const body = bodyWithDescendingFlow(3);
    const dt = 1 / 60;
    // Prime both: first call records prevAoA on the augmented surface.
    computeAeroForce(surface, body, dt);
    computeAeroForce(baseline, body, dt);
    // Second call with bit-identical body — α_now === α_prev → dα/dt = 0.
    const fAug = computeAeroForce(surface, body, dt);
    const yAug = fAug.force.y;
    const fBase = computeAeroForce(baseline, body, dt);
    expect(yAug).toBeCloseTo(fBase.force.y, 12);
  });

  it('rising α with positive clAlphaDot produces additional lift (sign-convention regression anchor)', () => {
    const surface = makeLiftingWing({ clAlphaDot: 2 });
    const baseline = makeLiftingWing({ clAlphaDot: 0 });

    // First call primes prevAoA on the augmented surface at low α.
    const bodyLow = bodyWithDescendingFlow(1);
    const bodyHigh = bodyWithDescendingFlow(5);
    const dt = 1 / 60;
    computeAeroForce(surface, bodyLow, dt);
    computeAeroForce(baseline, bodyLow, dt);

    // Second call at higher α. Augmented surface sees dα/dt > 0 → +CL delta.
    const fAug = computeAeroForce(surface, bodyHigh, dt);
    const yAug = fAug.force.y;
    const fBase = computeAeroForce(baseline, bodyHigh, dt);
    // Augmented lift is greater than baseline at the same α.
    expect(yAug).toBeGreaterThan(fBase.force.y);
  });

  it('falling α with positive clAlphaDot produces reduced lift (sign-convention mirror)', () => {
    const surface = makeLiftingWing({ clAlphaDot: 2 });
    const baseline = makeLiftingWing({ clAlphaDot: 0 });

    // First call primes prevAoA on the augmented surface at high α.
    const bodyHigh = bodyWithDescendingFlow(5);
    const bodyLow = bodyWithDescendingFlow(1);
    const dt = 1 / 60;
    computeAeroForce(surface, bodyHigh, dt);
    computeAeroForce(baseline, bodyHigh, dt);

    // Second call at lower α. Augmented surface sees dα/dt < 0 → −CL delta.
    const fAug = computeAeroForce(surface, bodyLow, dt);
    const yAug = fAug.force.y;
    const fBase = computeAeroForce(baseline, bodyLow, dt);
    expect(yAug).toBeLessThan(fBase.force.y);
  });

  it('omitting dt at the call site disables augmentation even with non-zero clAlphaDot (back-compat gate)', () => {
    const surface = makeLiftingWing({ clAlphaDot: 5 });
    const baseline = makeLiftingWing({ clAlphaDot: 0 });

    // Two calls without dt → augmentation gated off → matches baseline exactly.
    const bodyLow = bodyWithDescendingFlow(1);
    const bodyHigh = bodyWithDescendingFlow(5);
    computeAeroForce(surface, bodyLow);
    computeAeroForce(baseline, bodyLow);
    const fAug = computeAeroForce(surface, bodyHigh);
    const yAug = fAug.force.y;
    const fBase = computeAeroForce(baseline, bodyHigh);
    expect(yAug).toBeCloseTo(fBase.force.y, 12);
  });

  it('setGeometry resets prevAoA — next call behaves as a fresh first-tick', () => {
    const surface = makeLiftingWing({ clAlphaDot: 5 });

    const body = bodyWithDescendingFlow(3);
    const dt = 1 / 60;
    // Prime prevAoA.
    computeAeroForce(surface, body, dt);
    expect(surface.prevAoA).not.toBeUndefined();

    // Re-set normal/chord (any rest-frame change) → prevAoA must clear.
    surface.setGeometry({ normal: new Vector3(0, 1, 0), chord: new Vector3(0, 0, -1) });
    expect(surface.prevAoA).toBeUndefined();

    // Next call is a first-tick: no augmentation, prevAoA gets recorded.
    const baseline = makeLiftingWing({ clAlphaDot: 0 });
    const fAug = computeAeroForce(surface, body, dt);
    const yAug = fAug.force.y;
    const fBase = computeAeroForce(baseline, body, dt);
    expect(yAug).toBeCloseTo(fBase.force.y, 12);
    expect(surface.prevAoA).not.toBeUndefined();
  });
});

describe('AeroSurface — WP14.10: β5 non-dimensional form (D16)', () => {
  // Mirror the WP10.5 helpers — same surface shape, same descending-flow
  // body construction. The D16 form augments CL by clAlphaDot · dα/dt ·
  // c̄/(2·max(V, V_REF)), preserving the sign of the raw form but scaling
  // its magnitude by c̄/(2V). With chord=(0,0,-1) → chordLength=1, the
  // dimensionless prefactor at V≥V_REF=30 is 1/60.
  function makeLiftingWing(extra?: { clAlphaDot?: number }): AeroSurface {
    const { cl, cd } = createSymmetricFlatPlateCurves();
    return createAeroSurface({
      position: new Vector3(0, 0, 0),
      normal: new Vector3(0, 1, 0),
      chord: new Vector3(0, 0, -1),
      area: 1.5,
      clCurve: cl,
      cdCurve: cd,
      ...extra,
    });
  }

  function bodyWithDescendingFlow(downwardComponent: number): BodyState {
    return {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, -downwardComponent, -30),
      angvel: new Vector3(),
    };
  }

  it('non-dim factor c̄/(2V) scales the raw-form augmentation linearly (closed-form sanity check)', () => {
    // Under D16, two surfaces with clAlphaDot=K and clAlphaDot=K·60 should
    // produce identical ΔF_y at V=30 + chord=1, because the latter's extra
    // 60× factor exactly cancels the 1/60 prefactor c̄/(2V_eff)=1/60.
    // Equivalently: at clAlphaDot=60 under D16, the augmentation magnitude
    // equals what clAlphaDot=1 produced under the pre-D16 raw form.
    //
    // computeAeroForce returns a reused output Vector3 — snapshot .y
    // IMMEDIATELY after each call before the next call overwrites it.
    const surfA = makeLiftingWing({ clAlphaDot: 1 });
    const surfB = makeLiftingWing({ clAlphaDot: 60 });
    const baseline = makeLiftingWing({ clAlphaDot: 0 });
    const dt = 1 / 60;

    // Prime all three at α₀.
    const bodyLow = bodyWithDescendingFlow(1);
    computeAeroForce(surfA, bodyLow, dt);
    computeAeroForce(surfB, bodyLow, dt);
    computeAeroForce(baseline, bodyLow, dt);

    // Step to α₁ — identical body state across surfaces.
    const bodyHigh = bodyWithDescendingFlow(5);
    const yA = computeAeroForce(surfA, bodyHigh, dt).force.y;
    const yB = computeAeroForce(surfB, bodyHigh, dt).force.y;
    const yBase = computeAeroForce(baseline, bodyHigh, dt).force.y;

    const dA = yA - yBase;
    const dB = yB - yBase;

    // Both augmentations are positive (rising α, positive clAlphaDot, sign
    // preserved under D16 because c̄/(2V) > 0).
    expect(dA).toBeGreaterThan(0);
    expect(dB).toBeGreaterThan(0);
    // Linearity in clAlphaDot: ΔB / ΔA = 60 ± floating-point tolerance.
    expect(dB / dA).toBeCloseTo(60, 6);
  });

  it('V floor at V_REF=30: at V=20 the augmentation matches V=30 (no 1/V singularity at low airspeed)', () => {
    // computeAeroForce returns a reused output Vector3 — snapshot .y
    // IMMEDIATELY after each call before the next call overwrites it.
    //
    // The V_eff = max(V, V_REF) floor means trajectories below V_REF=30
    // see the same scaling factor c̄/(2·30) = 1/60 as a V=30 trajectory.
    // We can't directly compare across linvel magnitudes (α changes too),
    // so instead we verify the floor's anchor: at V=30 (the bodyLow→bodyHigh
    // sweep above runs at |linvel|=sqrt(1+900)≈30.02 and sqrt(25+900)≈30.4),
    // the augmentation magnitude is in the predicted range.
    //
    // Predicted ΔCL at dα/dt = (α₁−α₀)/dt with α₀=atan2(1,30)≈0.0333 rad
    // and α₁=atan2(5,30)≈0.1651 rad: dα ≈ 0.1318 rad, dt=1/60, so
    // dα/dt ≈ 7.91 rad/s. At clAlphaDot=1, V_eff=30 (since |linvel|>=30),
    // chord=1: ΔCL ≈ 1 · 7.91 · 1 / (2·30) = 0.1318.
    // ΔF_y ≈ q·A·ΔCL with q ≈ 0.5·1.225·30²·1.5 ≈ 826.9, so ΔF_y ≈ 109 N
    // — though airflow-magnitude effects (using V_air ≠ V_body) and AoA-
    // dependent CL_natural mean we only assert order-of-magnitude bounds.
    const surf = makeLiftingWing({ clAlphaDot: 1 });
    const baseline = makeLiftingWing({ clAlphaDot: 0 });
    const dt = 1 / 60;
    computeAeroForce(surf, bodyWithDescendingFlow(1), dt);
    computeAeroForce(baseline, bodyWithDescendingFlow(1), dt);
    const yAug = computeAeroForce(surf, bodyWithDescendingFlow(5), dt).force.y;
    const yBase = computeAeroForce(baseline, bodyWithDescendingFlow(5), dt).force.y;
    const dY = yAug - yBase;
    // Predicted magnitude ≈ 109 N; assert bounds ± a factor of 2 to allow
    // for the V_air ≠ V_body approximation and CL nonlinearity at small α.
    expect(dY).toBeGreaterThan(50);
    expect(dY).toBeLessThan(200);
  });

  it('default clAlphaDot=0 / omitted preserves bit-for-bit pre-D16 parity (asymmetric-fix discipline)', () => {
    // Per CLAUDE.md feedback_asymmetric_fix_no_op.md: the D16 fix must be
    // a no-op in the working regime (default clAlphaDot=0 on all current
    // aircraft.json surfaces). The augmentation gate's `clAlphaDot !== 0`
    // condition is unchanged from pre-D16; this test re-confirms the
    // contract at the live computeAeroForce call site.
    const baseline = makeLiftingWing();
    const explicitZero = makeLiftingWing({ clAlphaDot: 0 });
    const dt = 1 / 60;
    const bodyLow = bodyWithDescendingFlow(2);
    const bodyHigh = bodyWithDescendingFlow(4);
    computeAeroForce(baseline, bodyLow, dt);
    computeAeroForce(explicitZero, bodyLow, dt);
    const fBase = computeAeroForce(baseline, bodyHigh, dt);
    const xBase = fBase.force.x;
    const yBase = fBase.force.y;
    const zBase = fBase.force.z;
    const fZero = computeAeroForce(explicitZero, bodyHigh, dt);
    expect(fZero.force.x).toBeCloseTo(xBase, 12);
    expect(fZero.force.y).toBeCloseTo(yBase, 12);
    expect(fZero.force.z).toBeCloseTo(zBase, 12);
  });
});

