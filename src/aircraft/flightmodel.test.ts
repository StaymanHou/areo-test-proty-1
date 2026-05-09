import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Aircraft } from './rigidbody';
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
    // Per WP4's convention (CONVENTIONS.md), positive AoA arises when the relative wind
    // hits the underside of the wing — physically this happens when the body's velocity
    // vector has a component along −Y in body frame (descending-flightpath scenario for a
    // level-attitude wing, which is equivalent to a climbing flightpath with nose pitched
    // up by the same angle). We set linvel = (0, +5, -30) — a body moving forward AND
    // climbing. With identity body orientation, body-local airflow has −Y component,
    // which is positive AoA → positive lift along world +Y.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // disable gravity; isolate aero
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      linvel: new Vector3(0, 5, -30), // ~9.5° flight-path-angle climb
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
});
