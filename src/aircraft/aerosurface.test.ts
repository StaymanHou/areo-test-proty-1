import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  AeroSurface,
  AIR_DENSITY,
  type BodyState,
  computeAeroForce,
  computeAirflowAtPoint,
  computeAngleOfAttack,
  createAeroSurface,
  createSymmetricFlatPlateCurves,
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

  it('flow purely along −normal direction → AoA = +π/2 (wind hitting underside)', () => {
    // Flow purely −Y means wind blowing straight down into the top face. perp = −flow·normal
    // = −(−1) = 1 > 0 → +π/2.
    const aoa = computeAngleOfAttack(new Vector3(0, -1, 0), normal, chord);
    expect(aoa).toBeCloseTo(Math.PI / 2, 9);
  });

  it('flow purely along +normal → AoA = −π/2', () => {
    const aoa = computeAngleOfAttack(new Vector3(0, 1, 0), normal, chord);
    expect(aoa).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('flow at +10° AoA (level forward flight + slight upward pitch)', () => {
    // Plane flies forward (−Z) at 10 m/s, pitched slightly up. Relative airflow at the wing
    // is roughly toward +Z with a small −Y component (wind pushes up under the wing).
    // Construct: airflow with `along = cos(α)` along −chord (= +Z), `perp = sin(α)` along −normal (= −Y).
    const angle = (10 * Math.PI) / 180;
    const flow = new Vector3(0, -Math.sin(angle), Math.cos(angle));
    const aoa = computeAngleOfAttack(flow, normal, chord);
    expect(aoa).toBeCloseTo(angle, 6);
  });

  it('flow at −10° AoA is symmetric to +10° (sign convention regression test)', () => {
    // Mirror the +10° flow across the chord plane: flip the −normal component.
    const angle = (10 * Math.PI) / 180;
    const flow = new Vector3(0, Math.sin(angle), Math.cos(angle));
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
    // Construct linvel that yields airflow at +10° AoA: airflow has +Z and −Y components.
    // linvel = −airflow → (0, +sin10°, −cos10°) * 10.
    const angle = (10 * Math.PI) / 180;
    const speed = 10;
    const linvel = new Vector3(0, Math.sin(angle) * speed, -Math.cos(angle) * speed);
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
    const speed = 10;
    const s = makeFlatPlateAtOrigin();

    const a1 = (15 * Math.PI) / 180;
    const body1 = makeBody(new Vector3(0, Math.sin(a1) * speed, -Math.cos(a1) * speed));
    const lift1 = computeAeroForce(s, body1).force.y;

    const a2 = (30 * Math.PI) / 180;
    const body2 = makeBody(new Vector3(0, Math.sin(a2) * speed, -Math.cos(a2) * speed));
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
    // Sweep α from −10° to +10° in 5° steps. Lift along +Y should be:
    //   negative at negative α, ≈0 at α=0, positive at positive α.
    // Catches a class of bugs where the AoA convention flips sign and produces
    // discontinuous lift across the chord direction.
    const speed = 10;
    const s = makeFlatPlateAtOrigin();
    const liftAt = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      const body = makeBody(new Vector3(0, Math.sin(a) * speed, -Math.cos(a) * speed));
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
