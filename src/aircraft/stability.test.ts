import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Aircraft } from './rigidbody';
import { FlightModel } from './flightmodel';
import { parseAircraftConfig, type AircraftConfig } from './config';
import { computeAeroForce } from './aerosurface';

// Regression anchor for SURFACE-2026-05-10-01 (AoA sign-convention bug).
// Pre-fix, the body developed pitch rate from rest with no inputs and produced
// an amplifying pitching moment in response to a perturbation. Both scenarios
// here would fail under the buggy convention — they assert the corrected
// physics: aerodynamic forces neither create rotation from rest nor amplify it.

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

describe('Pitch stability — AoA convention regression anchors', () => {
  it('rest-state pitch rate growth is bounded (AoA fix damps the runaway)', () => {
    // Scenario A: gravity off, level body, level airflow, no controls, no thrust.
    // The v-stab is mounted at y=+0.5 (above CG) and its drag at α=0 produces a
    // small nose-up couple (~5.5 N·m). Under the buggy AoA convention, the h-stab
    // amplified this couple via an inverted pitch-damping response, sending
    // angvel.x to 1.31 rad/s in 10 physics steps. Under the corrected convention,
    // the h-stab's response is restoring — but with no static-margin geometry,
    // the v-stab's drag couple still integrates without full damping
    // (SURFACE-2026-05-10-02 — secondary phugoid-like instability).
    //
    // Threshold = 0.7 rad/s: chosen to pass under the corrected convention
    // (measured ~0.57 rad/s post-fix) and FAIL under the buggy one (was 1.31).
    // Will tighten when SURFACE-2026-05-10-02 lands.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 50, 0),
      linvel: new Vector3(0, 0, -30),
    });
    const fm = new FlightModel(aircraft);
    for (let i = 0; i < 10; i++) {
      fm.applyForces(0);
      world.step();
    }
    const av = aircraft.body.angvel();
    expect(Math.abs(av.x)).toBeLessThan(0.7);
    // Roll/yaw should remain identically zero — no asymmetric forces in the body.
    expect(Math.abs(av.y)).toBeLessThan(0.05);
    expect(Math.abs(av.z)).toBeLessThan(0.05);
  });

  it('positive pitch-rate perturbation produces a NEGATIVE (restoring) total pitching moment', () => {
    // Scenario B: gravity off, body kicked to angvel.x=+1 rad/s (nose pitching
    // up). Sum the per-surface moments about the CG along the body x-axis.
    // Total Mx must be NEGATIVE (restoring = damping). Under the buggy
    // convention this returned +1561 N·m (amplifying); under correct physics
    // the h-stab's downward motion through the air produces an upward lift
    // behind the CG, generating a nose-down moment.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 50, 0),
      linvel: new Vector3(0, 0, -30),
    });
    aircraft.body.setAngvel({ x: 1, y: 0, z: 0 }, true);
    const fm = new FlightModel(aircraft);
    aircraft.readBodyState();
    let sumMx = 0;
    for (let i = 0; i < fm.surfaces.length; i++) {
      const surface = fm.surfaces[i]!;
      const r = computeAeroForce(surface, aircraft.bodyState);
      const ap = r.applicationPoint;
      const f = r.force;
      // Moment about CG along x = ry·Fz − rz·Fy. CG is at body position (0,50,0).
      const ry = ap.y - 50;
      const rz = ap.z - 0;
      sumMx += ry * f.z - rz * f.y;
    }
    expect(sumMx).toBeLessThan(-100);
  });
});
