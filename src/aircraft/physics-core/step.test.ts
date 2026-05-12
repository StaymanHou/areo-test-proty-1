import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Aircraft } from '../rigidbody';
import { FlightModel } from './flightmodel';
import { parseAircraftConfig, type AircraftConfig } from './config';
import { step } from './step';

// Minimal config — single zero-incidence wing, no h-stab/v-stab. Enough to
// instantiate FlightModel + Aircraft for the wrapper-contract checks below.
const minimalRaw = () => ({
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
  ],
});

let config: AircraftConfig;

beforeAll(async () => {
  await RAPIER.init();
  config = parseAircraftConfig(minimalRaw());
});

describe('step() — physics-core single-tick driver', () => {
  it('advances the world by exactly one tick and sets world.timestep to dt', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config, { linvel: new Vector3(0, 0, -10) });
    const fm = new FlightModel(aircraft);

    const dt = 1 / 60;
    step(world, aircraft, fm, { throttle: 0 }, dt);

    // Loose precision (~5e-7) — Rapier's world.timestep setter round-trips
    // through f32, so f64 1/60 acquires ~8.7e-10 of truncation error. The
    // production sequence in src/main.ts does the same round-trip; this is
    // the structural contract, not a high-precision numerical claim.
    expect(world.timestep).toBeCloseTo(dt, 6);
  });

  it('applies thrust per the throttle input — full throttle produces forward (−Z) acceleration', () => {
    // Zero gravity + stationary spawn isolates thrust as the only force source.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config); // linvel = 0
    const fm = new FlightModel(aircraft);
    step(world, aircraft, fm, { throttle: 1 }, 1 / 60);
    const lv = aircraft.body.linvel();
    expect(lv.z).toBeLessThan(0); // −Z is forward per CONVENTIONS.md
    expect(Math.abs(lv.x)).toBeLessThan(1e-3);
  });

  it('throttle=0 + stationary + zero gravity produces no measurable motion (matches inline-tick path)', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    const fm = new FlightModel(aircraft);
    step(world, aircraft, fm, { throttle: 0 }, 1 / 60);
    const lv = aircraft.body.linvel();
    expect(Math.abs(lv.x)).toBeLessThan(1e-3);
    expect(Math.abs(lv.y)).toBeLessThan(1e-3);
    expect(Math.abs(lv.z)).toBeLessThan(1e-3);
  });

  it('two sequential step() calls produce identical trajectory to inline (flightModel.applyForces + world.step) sequence — determinism contract for the WP14.7 harness', () => {
    // Two identical worlds, two identical aircraft. World A advances via step();
    // World B advances via the same sequence inlined. After two ticks the
    // body states must be bit-identical — this is the contract the harness
    // depends on for parity with the browser inline path.
    const worldA = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraftA = new Aircraft(worldA, config, { linvel: new Vector3(0, 0, -30) });
    const fmA = new FlightModel(aircraftA);

    const worldB = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraftB = new Aircraft(worldB, config, { linvel: new Vector3(0, 0, -30) });
    const fmB = new FlightModel(aircraftB);

    const dt = 1 / 60;

    // World A: via step()
    step(worldA, aircraftA, fmA, { throttle: 0.3 }, dt);
    step(worldA, aircraftA, fmA, { throttle: 0.3 }, dt);

    // World B: inline
    fmB.applyForces(0.3, dt);
    worldB.timestep = dt;
    worldB.step();
    fmB.applyForces(0.3, dt);
    worldB.timestep = dt;
    worldB.step();

    const tA = aircraftA.body.translation();
    const tB = aircraftB.body.translation();
    const lvA = aircraftA.body.linvel();
    const lvB = aircraftB.body.linvel();

    expect(tA.x).toBeCloseTo(tB.x, 12);
    expect(tA.y).toBeCloseTo(tB.y, 12);
    expect(tA.z).toBeCloseTo(tB.z, 12);
    expect(lvA.x).toBeCloseTo(lvB.x, 12);
    expect(lvA.y).toBeCloseTo(lvB.y, 12);
    expect(lvA.z).toBeCloseTo(lvB.z, 12);
  });
});
