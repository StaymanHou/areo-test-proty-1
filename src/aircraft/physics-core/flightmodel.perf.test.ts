import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Aircraft } from '../rigidbody';
import { FlightModel } from './flightmodel';
import { parseAircraftConfig, type AircraftConfig } from './config';

// Perf-only: excluded from `npm run test` (load-flaky wall-clock assertion).
// Run via `npm run test:perf`. Origin: SURFACE-2026-05-16-02.
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

describe('FlightModel — perf', () => {
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
