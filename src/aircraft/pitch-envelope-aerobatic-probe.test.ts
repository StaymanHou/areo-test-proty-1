import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion } from 'three';
import { Aircraft } from './rigidbody';
import { FlightModel } from './physics-core/flightmodel';
import { parseAircraftConfig } from './physics-core/config';
import { computeAngleOfAttack } from './physics-core/aerosurface';
import aerobaticConfig from '../../public/config/aircraft-aerobatic.json' with { type: 'json' };

// Step 0 jet-experiment probe for SURFACE-2026-06-06-02 (pause note 2026-06-06).
//
// Hypothesis: simulation IS physically faithful; the production Cessna-class
// airframe (T/W ≈ 0.61) cannot backflip from cruise because real Cessnas can't.
// An aerobatic-class airframe (T/W ≈ 2.4, half the mass) SHOULD reach +90° or
// past, just as a Pitts Special / Extra 300 does in reality.
//
// This probe is the inverse of pitch-envelope-stall-probe.test.ts but with
// the aerobatic config loaded. Same scenario structure, V_trim recomputed for
// the new airframe:
//   V_trim = √(2W / (ρ·S·CL)) = √(2·4905 / (1.225·8·0.22)) ≈ 67 m/s
//
// Outcome classification:
//   - JET-PASS: at least one scenario reaches maxPitch > +90° AND wing α
//     stays bounded (≤ stall+10°). Simulation faithful → Path A.
//   - JET-FAIL: aerobatic airframe ALSO caps near +55-90°. Post-stall aero
//     gap dominates → Path C (D28 Viterna-Corrigan revision).
//   - AMBIGUOUS: mixed/borderline results → operator decides.
//
// Uses gimbal-lock-free pitch extraction (atan2 on body-forward) because
// rotations past ±90° are exactly what we're trying to measure.

beforeAll(async () => {
  await RAPIER.init();
});

const RAD2DEG = 180 / Math.PI;

function extractPitchDeg(q: { x: number; y: number; z: number; w: number }): number {
  // Gimbal-lock-free: angle between body-forward and the horizontal plane.
  // body-forward originally (0,0,-1). After rotation, pitch =
  // atan2(bodyForward.y, -bodyForward.z). Range (-180°, +180°].
  const quat = new Quaternion(q.x, q.y, q.z, q.w);
  const bodyForward = new Vector3(0, 0, -1).applyQuaternion(quat);
  return Math.atan2(bodyForward.y, -bodyForward.z) * RAD2DEG;
}

interface ScenarioResult {
  name: string;
  spawnLinvelZ: number;
  thrustMaxN: number;
  throttle: number;
  maxPitchDeg: number;
  tickAtMaxPitch: number;
  alphaAtMaxPitchDeg: number;
  terminalAS_mps: number;
}

function runScenario(
  name: string,
  spawnLinvelZ: number,
  thrustMaxN: number,
  throttle: number,
): ScenarioResult {
  const cfg = parseAircraftConfig({
    ...aerobaticConfig,
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

  const wingSurface = fm.surfaces[0]!;

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

      worldOffset.copy(wingSurface.position).applyQuaternion(
        new Quaternion(q.x, q.y, q.z, q.w),
      );
      const lv = aircraft.body.linvel();
      const av = aircraft.body.angvel();
      angVelCross.set(av.x, av.y, av.z).cross(worldOffset);
      worldAirflow.set(lv.x, lv.y, lv.z).add(angVelCross).negate();
      invQuat.set(q.x, q.y, q.z, q.w).invert();
      localFlow.copy(worldAirflow).applyQuaternion(invQuat);
      const alphaRad = computeAngleOfAttack(localFlow, wingSurface.normal, wingSurface.chord);
      alphaAtMaxPitchDeg = alphaRad * RAD2DEG;
    }
  }

  const finalLv = aircraft.body.linvel();
  const terminalAS = Math.sqrt(finalLv.x * finalLv.x + finalLv.y * finalLv.y + finalLv.z * finalLv.z);

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

describe('Pitch envelope AEROBATIC-airframe jet-experiment probe (Step 0 of SURFACE-2026-06-06-02)', () => {
  it('runs scenarios on aerobatic config and classifies JET-PASS/FAIL/AMBIGUOUS', () => {
    // V_trim ≈ 67 m/s for aerobatic config (mass=500, S=8, CL=0.22 at 2° incidence)
    const V_TRIM = 67;
    const results: ScenarioResult[] = [];

    results.push(runScenario(`baseline (AS=${V_TRIM}, T=12000N, throttle=0.3)`, -V_TRIM, 12000, 0.3));
    results.push(runScenario(`cruise-full-thrust (AS=${V_TRIM}, T=12000N, throttle=1.0)`, -V_TRIM, 12000, 1.0));
    results.push(runScenario('high-AS-entry (AS=100, T=12000N, throttle=1.0)', -100, 12000, 1.0));
    results.push(runScenario('high-AS-entry (AS=120, T=12000N, throttle=1.0)', -120, 12000, 1.0));
    // Reference scenarios at production Cessna thrust to isolate mass/area effect alone
    results.push(runScenario('mass-area-only (AS=67, T=6000N, throttle=1.0)', -67, 6000, 1.0));

    // eslint-disable-next-line no-console
    console.log('\n=== AEROBATIC JET-EXPERIMENT RESULTS (mass=500, T_max=12000, S=8) ===');
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
    console.log('====================================================================\n');

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(Number.isFinite(r.maxPitchDeg)).toBe(true);
      expect(Number.isFinite(r.alphaAtMaxPitchDeg)).toBe(true);
      expect(Number.isFinite(r.terminalAS_mps)).toBe(true);
    }
  });
});
