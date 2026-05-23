import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Aircraft } from '../rigidbody';
import { FlightModel } from './flightmodel';
import { parseAircraftConfig, type AircraftConfig } from './config';
import { computeAeroForce } from './aerosurface';

const baselineRaw = () => ({
  mass: 1000,
  inertia: { x: 1500, y: 3000, z: 1500 },
  thrust: { maxN: 6000 },
  surfaces: [
    {
      name: 'wing-left',
      position: { x: -2, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 6,
      curve: 'symmetric-flat-plate',
    },
    {
      name: 'wing-right',
      position: { x: 2, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 6,
      curve: 'symmetric-flat-plate',
    },
    {
      name: 'h-stab',
      position: { x: 0, y: 0, z: 3 },
      normal: { x: 0, y: 1, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 1.5,
      curve: 'symmetric-flat-plate',
    },
    {
      name: 'v-stab',
      position: { x: 0, y: 0.5, z: 3 },
      normal: { x: 1, y: 0, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 1,
      curve: 'symmetric-flat-plate',
    },
  ],
});

let config: AircraftConfig;

beforeAll(async () => {
  await RAPIER.init();
  config = parseAircraftConfig(baselineRaw());
});

describe('FlightModel', () => {
  it('constructs N AeroSurface instances matching config.surfaces', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    expect(fm.surfaces).toHaveLength(4);
    expect(fm.maxThrustN).toBe(6000);
  });

  it('with no airflow and zero throttle, produces no measurable acceleration', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // zero gravity
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config); // linvel = 0
    const fm = new FlightModel(aircraft);
    fm.applyForces(0);
    world.step();
    const lv = aircraft.body.linvel();
    // Stationary + zero airflow + zero throttle = no force = no acceleration
    expect(Math.abs(lv.x)).toBeLessThan(1e-3);
    expect(Math.abs(lv.y)).toBeLessThan(1e-3);
    expect(Math.abs(lv.z)).toBeLessThan(1e-3);
  });

  it('thrust at full throttle produces forward (−Z) acceleration', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // zero gravity, no aero (stationary)
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    fm.applyForces(1.0); // full throttle
    world.step();
    const lv = aircraft.body.linvel();
    // F = 6000 N along −Z, m = 1000 kg → a = 6 m/s², over 1/60s → −0.1 m/s
    expect(lv.z).toBeCloseTo(-6 / 60, 3);
    expect(Math.abs(lv.x)).toBeLessThan(1e-3);
    expect(Math.abs(lv.y)).toBeLessThan(1e-3);
  });

  it('positive-AoA velocity vector produces positive lift on the wings', () => {
    // Per CONVENTIONS.md, positive AoA arises when the relative wind hits the underside
    // of the wing — wind has a +normal component in body frame. Physically this happens
    // when the body descends with a level wing: linvel.y < 0 → airflow at the wing has
    // +Y component → positive AoA → positive lift along world +Y. (Equivalent in body
    // frame to a level-flightpath plane with nose pitched up by the same angle.)
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // disable gravity; isolate aero
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      linvel: new Vector3(0, -5, -30), // ~9.5° descent flight path with level wing
    });
    const fm = new FlightModel(aircraft);
    fm.applyForces(0); // zero throttle — pure aero
    // Sample force directly from the underlying surfaces (rather than running world.step,
    // which integrates everything including drag and torques). We just want to confirm
    // the per-surface vertical force is positive at this AoA.
    let totalLiftY = 0;
    for (const surface of fm.surfaces) {
      // Skip the v-stab — its lift axis is sideways (X), not vertical.
      if (surface.normal.y > 0.5) {
        // Re-read body state on every iteration (computeAeroForce reuses output vectors).
        aircraft.readBodyState();
        const r = computeAeroForce(surface, aircraft.bodyState);
        totalLiftY += r.force.y;
      }
    }
    expect(totalLiftY).toBeGreaterThan(0);
  });

  it('throttle is clamped to [0, 1]', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    fm.applyForces(5.0); // over-cap, should clamp to 1
    world.step();
    const lv = aircraft.body.linvel();
    // Same as full-throttle test
    expect(lv.z).toBeCloseTo(-6 / 60, 3);
  });

  it('negative throttle is clamped to 0 (no reverse thrust)', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    fm.applyForces(-0.5);
    world.step();
    const lv = aircraft.body.linvel();
    expect(Math.abs(lv.x)).toBeLessThan(1e-3);
    expect(Math.abs(lv.y)).toBeLessThan(1e-3);
    expect(Math.abs(lv.z)).toBeLessThan(1e-3);
  });

  it('applyControls(0,0,0) leaves all surfaces at zero deflection', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    // Apply a non-zero deflection first, then reset.
    fm.applyControls({ aileron: 0.5, elevator: 0.5, rudder: 0.5 });
    expect(fm.surfaces.some((s) => s.deflection !== 0)).toBe(true);
    fm.applyControls({ aileron: 0, elevator: 0, rudder: 0 });
    for (const s of fm.surfaces) {
      expect(s.deflection).toBe(0);
    }
  });

  it('aileron routes to opposite signs on wing-left and wing-right', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    fm.applyControls({ aileron: 1, elevator: 0, rudder: 0 });
    const wingLeft = fm.surfaces[0]!;  // 'wing-left'
    const wingRight = fm.surfaces[1]!; // 'wing-right'
    // Both must be deflected, with opposite signs
    expect(wingLeft.deflection).not.toBe(0);
    expect(wingRight.deflection).not.toBe(0);
    expect(Math.sign(wingLeft.deflection)).toBe(-Math.sign(wingRight.deflection));
    // h-stab and v-stab should remain neutral
    expect(fm.surfaces[2]!.deflection).toBe(0);
    expect(fm.surfaces[3]!.deflection).toBe(0);
  });

  it('elevator routes only to h-stab', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    fm.applyControls({ aileron: 0, elevator: 1, rudder: 0 });
    expect(fm.surfaces[0]!.deflection).toBe(0); // wing-left
    expect(fm.surfaces[1]!.deflection).toBe(0); // wing-right
    expect(fm.surfaces[2]!.deflection).not.toBe(0); // h-stab
    expect(fm.surfaces[3]!.deflection).toBe(0); // v-stab
  });

  it('rudder routes only to v-stab', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    fm.applyControls({ aileron: 0, elevator: 0, rudder: 1 });
    expect(fm.surfaces[0]!.deflection).toBe(0); // wing-left
    expect(fm.surfaces[1]!.deflection).toBe(0); // wing-right
    expect(fm.surfaces[2]!.deflection).toBe(0); // h-stab
    expect(fm.surfaces[3]!.deflection).not.toBe(0); // v-stab
  });

  it('+aileron produces a roll-right torque (angvel z component is negative)', () => {
    // World frame at identity orientation: roll axis = body Z.
    // Right-hand rule: roll right (right wing +X going to −Y) means ω points along −Z.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      linvel: new Vector3(0, 0, -30), // forward flight
    });
    const fm = new FlightModel(aircraft);
    fm.applyControls({ aileron: 1, elevator: 0, rudder: 0 });
    fm.applyForces(0); // pure aero — isolate roll torque from other axes
    world.step();
    const av = aircraft.body.angvel();
    expect(av.z).toBeLessThan(-1e-3);
  });

  it('+elevator produces a pitch-up torque (angvel x component is positive)', () => {
    // Pitch up: nose (−Z) rotates toward +Y; right-hand rule → ω along +X.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      linvel: new Vector3(0, 0, -30),
    });
    const fm = new FlightModel(aircraft);
    fm.applyControls({ aileron: 0, elevator: 1, rudder: 0 });
    fm.applyForces(0);
    world.step();
    const av = aircraft.body.angvel();
    expect(av.x).toBeGreaterThan(1e-3);
  });

  it('+rudder produces a yaw-right torque (angvel y component is negative)', () => {
    // Yaw right: nose (−Z) rotates toward +X; right-hand rule → ω along −Y.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      linvel: new Vector3(0, 0, -30),
    });
    const fm = new FlightModel(aircraft);
    fm.applyControls({ aileron: 0, elevator: 0, rudder: 1 });
    fm.applyForces(0);
    world.step();
    const av = aircraft.body.angvel();
    expect(av.y).toBeLessThan(-1e-3);
  });

  it('zero controls + level airflow produces same per-surface forces as before WP6', () => {
    // Regression guard: with neutral controls, the flight model behaves identically
    // to the WP5 implementation. The pre-deflection reference is a matching FM with
    // applyControls never called (deflection stays 0).
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraftRef = new Aircraft(world, config, { linvel: new Vector3(0, 0, -30) });
    const fmRef = new FlightModel(aircraftRef);
    aircraftRef.readBodyState();
    const refForces = fmRef.surfaces.map((s) => {
      const f = computeAeroForce(s, aircraftRef.bodyState);
      return { x: f.force.x, y: f.force.y, z: f.force.z };
    });

    const aircraft = new Aircraft(world, config, { linvel: new Vector3(0, 0, -30) });
    const fm = new FlightModel(aircraft);
    fm.applyControls({ aileron: 0, elevator: 0, rudder: 0 });
    aircraft.readBodyState();
    for (let i = 0; i < fm.surfaces.length; i++) {
      const r = computeAeroForce(fm.surfaces[i]!, aircraft.bodyState);
      expect(r.force.x).toBeCloseTo(refForces[i]!.x, 6);
      expect(r.force.y).toBeCloseTo(refForces[i]!.y, 6);
      expect(r.force.z).toBeCloseTo(refForces[i]!.z, 6);
    }
  });

  it('WP6.5/D10: incidenceRad on JSON surfaces is threaded through to the constructed AeroSurfaces', () => {
    // Integration-boundary regression guard: a future refactor of the parse →
    // FlightModel surface-construction glue (currently flightmodel.ts:58) must
    // not silently drop the incidenceRad field. Anchor: with non-zero incidence
    // on the wings, the constructed surfaces' rest snapshots must reflect the
    // mount-angle rotation. The default-zero case is the regression baseline
    // (no other test changes), proven elsewhere by all pre-D10 tests passing
    // unchanged.
    const incidence = (2 * Math.PI) / 180; // +2° — a realistic wing setting
    const raw = baselineRaw();
    (raw.surfaces[0] as unknown as { incidenceRad: number }).incidenceRad = incidence;  // wing-left
    (raw.surfaces[1] as unknown as { incidenceRad: number }).incidenceRad = incidence;  // wing-right
    (raw.surfaces[2] as unknown as { incidenceRad: number }).incidenceRad = -incidence; // h-stab at -2°
    const cfg = parseAircraftConfig(raw);

    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, cfg);
    const fm = new FlightModel(aircraft);

    expect(fm.surfaces[0]!.incidenceRad).toBe(incidence);
    expect(fm.surfaces[1]!.incidenceRad).toBe(incidence);
    expect(fm.surfaces[2]!.incidenceRad).toBe(-incidence);
    expect(fm.surfaces[3]!.incidenceRad).toBe(0); // v-stab — left at default

    // And the rest snapshots reflect the rotation (chord gains a +Y / −Y
    // component depending on incidence sign). This proves the rotation actually
    // took effect — not just that the field was stored.
    expect(fm.surfaces[0]!.restChord.y).toBeCloseTo(Math.sin(incidence), 9);
    expect(fm.surfaces[2]!.restChord.y).toBeCloseTo(-Math.sin(incidence), 9);
    // V-stab unchanged from default.
    expect(fm.surfaces[3]!.restChord.y).toBeCloseTo(0, 12);
  });

  it('WP6.5/β4: clQ on JSON surfaces produces real pitch-rate damping in FlightModel', () => {
    // Integration-boundary regression guard: clQ must thread through
    // parseAircraftConfig → FlightModel construction → computeAeroForce
    // (via flightmodel.ts:58) such that the running physics shows damping.
    // Anchor: spin up a body with a +pitch rate, run one physics step with
    // and without clQ, and confirm the with-clQ version generates a stronger
    // restoring pitch torque (smaller angvel.x after the step).
    const withoutClQ = parseAircraftConfig(baselineRaw());
    const rawWith = baselineRaw();
    (rawWith.surfaces[0] as unknown as { clQ: number }).clQ = 3; // wing-left
    (rawWith.surfaces[1] as unknown as { clQ: number }).clQ = 3; // wing-right
    (rawWith.surfaces[2] as unknown as { clQ: number }).clQ = 8; // h-stab
    const withClQ = parseAircraftConfig(rawWith);

    // Both aircraft: forward flight at 30 m/s with an initial +pitch rate.
    // Zero gravity isolates aero torque; zero throttle isolates from thrust.
    // `AircraftCreateOptions` doesn't accept angvel — set it via Rapier directly.
    const initialPitchRate = 2.0; // rad/s
    const initial = { linvel: new Vector3(0, 0, -30) };

    const worldA = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worldA.timestep = 1 / 60;
    const aircraftA = new Aircraft(worldA, withoutClQ, initial);
    aircraftA.body.setAngvel({ x: initialPitchRate, y: 0, z: 0 }, true);
    const fmA = new FlightModel(aircraftA);
    fmA.applyForces(0);
    worldA.step();
    const avA = aircraftA.body.angvel();
    const avAx = avA.x;

    const worldB = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worldB.timestep = 1 / 60;
    const aircraftB = new Aircraft(worldB, withClQ, initial);
    aircraftB.body.setAngvel({ x: initialPitchRate, y: 0, z: 0 }, true);
    const fmB = new FlightModel(aircraftB);
    fmB.applyForces(0);
    worldB.step();
    const avB = aircraftB.body.angvel();
    const avBx = avB.x;

    // Sanity: clQ wired through to the constructed surfaces.
    expect(fmB.surfaces[0]!.clQ).toBe(3);
    expect(fmB.surfaces[1]!.clQ).toBe(3);
    expect(fmB.surfaces[2]!.clQ).toBe(8);
    expect(fmA.surfaces[0]!.clQ).toBe(0); // default

    // With clQ, the +pitch rate is damped more (avBx < avAx for positive
    // initial pitch rate). Both should be smaller than initialPitchRate
    // (damping is present even without clQ via the natural ω×r mechanism),
    // but the clQ version damps more strongly.
    expect(avAx).toBeLessThan(initialPitchRate);    // some natural damping
    expect(avBx).toBeLessThan(avAx);                // clQ amplifies it
    expect(avBx).toBeGreaterThan(0);                // not over-damped to reverse
  });

  it('1000 calls to applyForces complete in under 50 ms (allocation-free perf proxy)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config, {
      linvel: new Vector3(0, 0, -30),
    });
    const fm = new FlightModel(aircraft);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      fm.applyForces(0.5);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  // --- WP11: resetSurfaceState for mission restart ---

  it('resetSurfaceState zeros every surface deflection', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    fm.applyControls({ aileron: 0.5, elevator: 0.5, rudder: 0.5 });
    // Confirm deflections are non-zero before reset.
    expect(fm.surfaces.some((s) => s.deflection !== 0)).toBe(true);
    fm.resetSurfaceState();
    for (const s of fm.surfaces) {
      expect(s.deflection).toBe(0);
    }
  });

  it('resetSurfaceState clears the β5 prevAoA cache on every surface', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config, { linvel: new Vector3(0, 0, -30) });
    const fm = new FlightModel(aircraft);
    // Prime prevAoA with a tick that exercises the live path.
    fm.applyForces(0.5, 1 / 60);
    expect(fm.surfaces.some((s) => s.prevAoA !== undefined)).toBe(true);
    fm.resetSurfaceState();
    for (const s of fm.surfaces) {
      expect(s.prevAoA).toBeUndefined();
    }
  });
});

describe('FlightModel — WP14.11.5: D18 fuselage drag', () => {
  // D18 fuselage drag is a body-level force at the body origin:
  //   F = −0.5 · ρ · V² · area · cd0 · (linvel / |linvel|)
  // applied via `addForce` (NOT `addForceAtPoint`) so the contribution is
  // purely translational with zero torque. Gated on `config.fuselageDrag`
  // being present (default-absent preserves pre-D18 behavior bit-for-bit).
  //
  // Approach: compare baseline vs fuselage-drag configs at the same body
  // state. Read the accumulated force via `body.userForce()` after a single
  // applyForces() call. Diff = the fuselage drag contribution in isolation.
  //
  // (Rapier exposes `body.userForce()` to read the accumulated user-applied
  // force this tick; `resetForces` clears it before world.step.)
  const AIR_DENSITY = 1.225;

  function configWithFuselageDrag(cd0: number, area: number): AircraftConfig {
    const raw = baselineRaw() as ReturnType<typeof baselineRaw> & {
      fuselageDrag?: { cd0: number; area: number };
    };
    raw.fuselageDrag = { cd0, area };
    return parseAircraftConfig(raw);
  }

  it('closed-form: ΔF_fuselage = 0.5 · ρ · V² · area · cd0 at V=30 m/s along −Z', () => {
    const cd0 = 0.3;
    const area = 1.5;
    const V = 30;
    const expectedMag = 0.5 * AIR_DENSITY * V * V * area * cd0;
    // Predicted: 0.5 · 1.225 · 900 · 1.5 · 0.3 = 248.0625 N.

    // Baseline config (no fuselageDrag) and augmented config (fuselageDrag set).
    const cfgBaseline = config;
    const cfgAugmented = configWithFuselageDrag(cd0, area);

    // Two worlds, two aircraft — read userForce() right after applyForces.
    const wBase = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const acBase = new Aircraft(wBase, cfgBaseline, { linvel: new Vector3(0, 0, -V) });
    const fmBase = new FlightModel(acBase);
    fmBase.applyForces(0); // no thrust — isolate aero + (no) fuselage drag
    const fBase = acBase.body.userForce();

    const wAug = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const acAug = new Aircraft(wAug, cfgAugmented, { linvel: new Vector3(0, 0, -V) });
    const fmAug = new FlightModel(acAug);
    fmAug.applyForces(0);
    const fAug = acAug.body.userForce();

    // Δforce should equal the fuselage drag vector: along +Z (opposite to
    // linvel which is −Z), magnitude = 0.5·ρ·V²·area·cd0.
    const dFx = fAug.x - fBase.x;
    const dFy = fAug.y - fBase.y;
    const dFz = fAug.z - fBase.z;
    expect(Math.abs(dFx)).toBeLessThan(1e-6);
    expect(Math.abs(dFy)).toBeLessThan(1e-6);
    expect(dFz).toBeCloseTo(expectedMag, 4); // ≈ 248.06 N along +Z
  });

  it('direction: fuselage drag force is anti-parallel to linvel (opposes motion)', () => {
    const cd0 = 0.5;
    const area = 2.0;
    // Use an off-axis linvel to confirm direction works in 3D, not just +Z.
    const lv = new Vector3(15, -10, -25); // arbitrary direction; |lv| = √(225+100+625) = √950 ≈ 30.82
    const cfgBaseline = config;
    const cfgAugmented = configWithFuselageDrag(cd0, area);

    const wBase = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const acBase = new Aircraft(wBase, cfgBaseline, { linvel: lv.clone() });
    const fmBase = new FlightModel(acBase);
    fmBase.applyForces(0);
    const fBase = acBase.body.userForce();

    const wAug = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const acAug = new Aircraft(wAug, cfgAugmented, { linvel: lv.clone() });
    const fmAug = new FlightModel(acAug);
    fmAug.applyForces(0);
    const fAug = acAug.body.userForce();

    // Δforce (the fuselage drag contribution) must be anti-parallel to linvel.
    // Check by dot product: dot(Δforce, linvel) / (|Δforce|·|linvel|) ≈ −1.
    const dF = new Vector3(fAug.x - fBase.x, fAug.y - fBase.y, fAug.z - fBase.z);
    const dFmag = dF.length();
    expect(dFmag).toBeGreaterThan(0);
    const cosTheta = dF.dot(lv) / (dFmag * lv.length());
    expect(cosTheta).toBeCloseTo(-1, 6);
  });

  it('V=0 guard: zero linvel produces zero fuselage drag and no NaN', () => {
    const cfgAugmented = configWithFuselageDrag(0.3, 1.5);
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    // No linvel passed → defaults to (0,0,0); the V > 1e-6 guard must skip
    // the fuselage-drag branch entirely (no NaN from 1/v at v=0).
    const aircraft = new Aircraft(world, cfgAugmented);
    const fm = new FlightModel(aircraft);
    fm.applyForces(0);
    const force = aircraft.body.userForce();
    // All per-surface aero forces at zero airflow also return zero per
    // computeAeroForce's `v2 < 1e-12` guard, so total accumulated force is 0.
    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
    expect(force.z).toBe(0);
    expect(Number.isFinite(force.x)).toBe(true);
    expect(Number.isFinite(force.y)).toBe(true);
    expect(Number.isFinite(force.z)).toBe(true);
  });
});
