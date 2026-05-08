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
