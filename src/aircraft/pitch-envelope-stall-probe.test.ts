import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion, Euler } from 'three';
import { Aircraft } from './rigidbody';
import { FlightModel } from './physics-core/flightmodel';
import { parseAircraftConfig } from './physics-core/config';
import { computeAngleOfAttack } from './physics-core/aerosurface';
import canonicalAircraftConfig from '../../public/config/aircraft.json' with { type: 'json' };

// Pitch-envelope STALL-equilibrium diagnostic probe for SURFACE-2026-06-06-02.
//
// Context: the prior plan's clQ=0 + clAlphaDot=0 probe refuted β4/β5 damping
// as the cause of the +55° backflip-ceiling (max pitch ≈ +56° regardless of
// damping coefficients). New hypothesis: stall-equilibrium — as body pitches
// up under elevator command, velocity vector lags body rotation, wing α
// grows, symmetric-flat-plate stalls around α=15-20°, lift collapses, pitch
// rate goes to zero at the equilibrium attitude (~+55° body pitch).
//
// This probe runs 4 scenarios at full +elevator hold for 5s, varying:
//   1. baseline:       AS=78,  thrust.maxN=6000 (production), throttle=0.3
//   2. high-thrust:    AS=78,  thrust.maxN=18000 (3×),         throttle=1.0
//   3. high-AS-entry:  AS=120, thrust.maxN=6000,                throttle=0.3
//   4. high-AS + thrust: AS=120, thrust.maxN=18000,              throttle=1.0
//
// For each scenario the probe records {maxPitchDeg, finalAlphaDeg at the
// max-pitch tick, terminalAS_mps at end-of-window}.
//
// Outcome classification:
//   - **Outcome A (stall):** all 4 scenarios max ≈ +55-65° AND wing α at
//     max-pitch ≈ 15-25°. Means even with extra energy reserve and thrust,
//     stall is the ceiling — fix path is structural (CL/CD curve revision).
//   - **Outcome B (energy):** high-thrust OR high-AS scenarios reach ≥ +90°.
//     Means energy budget at the loop apex is the constraint — fix path is
//     thrust.maxN bump or mission spawn AS bump.
//   - **Outcome C (other):** classification ambiguous; escalate.
//
// aircraft.json is NOT mutated; each scenario uses inline parseAircraftConfig
// override only for thrust.maxN. Spawn linvel varies per scenario.

beforeAll(async () => {
  await RAPIER.init();
});

const RAD2DEG = 180 / Math.PI;

function extractPitchDeg(q: { x: number; y: number; z: number; w: number }): number {
  const quat = new Quaternion(q.x, q.y, q.z, q.w);
  const euler = new Euler().setFromQuaternion(quat, 'YXZ');
  return euler.x * RAD2DEG;
}

interface ScenarioResult {
  name: string;
  spawnLinvelZ: number;
  thrustMaxN: number;
  throttle: number;
  maxPitchDeg: number;
  tickAtMaxPitch: number;
  alphaAtMaxPitchDeg: number;  // wing α at the max-pitch tick
  terminalAS_mps: number;
}

function runScenario(
  name: string,
  spawnLinvelZ: number,
  thrustMaxN: number,
  throttle: number,
): ScenarioResult {
  // Build per-scenario config: clone baseline JSON, override thrust.maxN.
  const cfg = parseAircraftConfig({
    ...canonicalAircraftConfig,
    thrust: { maxN: thrustMaxN },
  });

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const aircraft = new Aircraft(world, cfg, {
    position: new Vector3(0, 200, 0),
    linvel: new Vector3(0, 0, spawnLinvelZ),
  });
  const fm = new FlightModel(aircraft);

  const dt = 1 / 60;
  const ticks = 300; // 5s

  let maxPitchDeg = -Infinity;
  let tickAtMaxPitch = 0;
  let alphaAtMaxPitchDeg = 0;
  let terminalAS = 0;

  // Wing (surfaces[0]) is the surface whose α we track. Read its body-local
  // normal and chord (these are the AeroSurface's per-construction values,
  // possibly rotated by incidence).
  const wingSurface = fm.surfaces[0]!;

  // Scratch for α computation
  const worldAirflow = new Vector3();
  const worldOffset = new Vector3();
  const invQuat = new Quaternion();
  const localFlow = new Vector3();
  const angVelCross = new Vector3();

  for (let i = 0; i < ticks; i++) {
    fm.applyControls({ aileron: 0, elevator: 1, rudder: 0 });
    fm.applyForces(throttle, dt);
    world.timestep = dt;
    world.step();

    const q = aircraft.body.rotation();
    const pitchDeg = extractPitchDeg(q);
    if (pitchDeg > maxPitchDeg) {
      maxPitchDeg = pitchDeg;
      tickAtMaxPitch = i;

      // Compute wing α at this tick.
      // 1. World offset of the wing application point: bodyQuat · surface.position
      worldOffset.copy(wingSurface.position).applyQuaternion(
        new Quaternion(q.x, q.y, q.z, q.w),
      );
      // 2. World airflow at the wing: -(linvel + ω × r)
      const lv = aircraft.body.linvel();
      const av = aircraft.body.angvel();
      angVelCross.set(av.x, av.y, av.z).cross(worldOffset);
      worldAirflow.set(lv.x, lv.y, lv.z).add(angVelCross).negate();
      // 3. Rotate world airflow into body-local frame
      invQuat.set(q.x, q.y, q.z, q.w).invert();
      localFlow.copy(worldAirflow).applyQuaternion(invQuat);
      // 4. α from body-local flow + surface normal + chord
      const alphaRad = computeAngleOfAttack(localFlow, wingSurface.normal, wingSurface.chord);
      alphaAtMaxPitchDeg = alphaRad * RAD2DEG;
    }
  }

  // Terminal AS = |linvel| at last tick
  const finalLv = aircraft.body.linvel();
  terminalAS = Math.sqrt(finalLv.x * finalLv.x + finalLv.y * finalLv.y + finalLv.z * finalLv.z);

  return {
    name,
    spawnLinvelZ,
    thrustMaxN,
    throttle,
    maxPitchDeg: Math.round(maxPitchDeg * 10) / 10,
    tickAtMaxPitch,
    alphaAtMaxPitchDeg: Math.round(alphaAtMaxPitchDeg * 10) / 10,
    terminalAS_mps: Math.round(terminalAS * 10) / 10,
  };
}

describe('Pitch envelope stall-probe diagnostic (SURFACE-2026-06-06-02 hypothesis #2)', () => {
  it('runs 4 scenarios and logs results for Outcome A/B/C classification', () => {
    const results: ScenarioResult[] = [];

    results.push(runScenario('baseline (AS=78, T=6000N, throttle=0.3)', -78, 6000, 0.3));
    results.push(runScenario('high-thrust (AS=78, T=18000N, throttle=1.0)', -78, 18000, 1.0));
    results.push(runScenario('high-AS-entry (AS=120, T=6000N, throttle=0.3)', -120, 6000, 0.3));
    results.push(runScenario('high-AS+thrust (AS=120, T=18000N, throttle=1.0)', -120, 18000, 1.0));
    // Extreme upper bound — if even this can't break +90°, stall is the ceiling.
    results.push(runScenario('extreme (AS=120, T=60000N=10x, throttle=1.0)', -120, 60000, 1.0));

    // Diagnostic dump — visible in Vitest output. Not an assertion; this is a
    // probe, not a regression test. The classification is the agent's job
    // post-run (recorded into WIP discoveries).
    // eslint-disable-next-line no-console
    console.log('\n=== STALL-PROBE RESULTS ===');
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${r.name}\n` +
        `    maxPitch=${r.maxPitchDeg}° at tick ${r.tickAtMaxPitch} ` +
        `(t=${(r.tickAtMaxPitch / 60).toFixed(2)}s), ` +
        `wing α at max-pitch=${r.alphaAtMaxPitchDeg}°, ` +
        `terminal AS=${r.terminalAS_mps} m/s`,
      );
    }
    console.log('===========================\n');

    // Sanity: all 4 scenarios ran. The probe assertion is just that no
    // scenario produced NaN — we want to read the numbers, not constrain them.
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(Number.isFinite(r.maxPitchDeg)).toBe(true);
      expect(Number.isFinite(r.alphaAtMaxPitchDeg)).toBe(true);
      expect(Number.isFinite(r.terminalAS_mps)).toBe(true);
    }
  });
});
