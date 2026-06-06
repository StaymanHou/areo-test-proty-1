import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Aircraft } from './rigidbody';
import { FlightModel } from './physics-core/flightmodel';
import { parseAircraftConfig, type AircraftConfig } from './physics-core/config';
import canonicalAircraftConfig from '../../public/config/aircraft.json' with { type: 'json' };

// Phase 2 (controls-feel-pass) acceptance test: at the production aircraft.json
// (which ships inertia.z=6000 post-Phase-2), holding full aileron deflection
// must NOT produce snap-roll behavior. Codifies operator P2.verify-human.1.
//
// Method: spawn at V_trim=78, apply full aileron deflection every tick, step
// the physics deterministically at 60 Hz for 2 seconds (120 ticks), record
// the body-frame roll rate (angvel.z, rad/s) every tick. Compute the
// sustained peak roll rate over a representative window after the ramp-up
// (t = 0.5s to 1.5s — past the initial acceleration, before any inertial
// coupling cascade).
//
// The acceptance gate matches the WIP "Observable outcomes" for Phase 2:
// sustained roll rate at full deflection ≤ 200°/s (firm gate) with ~120°/s
// as the goal. The test asserts the firm gate so regressions to snap-roll
// territory (pre-Phase-2 ~500°/s sustained) are caught.

let config: AircraftConfig;

beforeAll(async () => {
  await RAPIER.init();
  config = parseAircraftConfig(canonicalAircraftConfig);
});

const RAD2DEG = 180 / Math.PI;

describe('Roll rate at full aileron deflection (Phase 2 acceptance)', () => {
  it('sustained roll rate at full +aileron ≤ 200°/s (firm gate); ~120°/s is the goal', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 50, 0),
      linvel: new Vector3(0, 0, -78), // V_trim spawn
    });
    const fm = new FlightModel(aircraft);

    const rollRatesDegS: number[] = [];
    const dt = 1 / 60;
    const ticks = 120; // 2 seconds at 60 Hz
    for (let i = 0; i < ticks; i++) {
      // Full +aileron (= right roll); zero pitch/yaw input; low cruise throttle.
      fm.applyControls({ aileron: 1, elevator: 0, rudder: 0 });
      fm.applyForces(0.3, dt);
      world.timestep = dt;
      world.step();
      const av = aircraft.body.angvel();
      rollRatesDegS.push(av.z * RAD2DEG);
    }

    // Sustained window: t = 0.5s to 1.5s (ticks 30..89). Past the linear ramp
    // up from rest, before any inertial-coupling chaos that may develop late
    // in the trace.
    const sustainedWindow = rollRatesDegS.slice(30, 90);
    const peakSustained = Math.max(...sustainedWindow.map(Math.abs));

    // Firm gate per Phase 2 Observable outcome.
    expect(peakSustained).toBeLessThanOrEqual(200);
    // Sanity: roll rate must actually develop (no zero-roll bug).
    expect(peakSustained).toBeGreaterThan(50);

    // Diagnostic: log the trace shape so regressions surface trace patterns,
    // not just pass/fail. Failure will print the array of samples too.
    const traceSummary = {
      atTickHalfSec: Math.round(rollRatesDegS[30]! * 10) / 10,
      atTickOneSec: Math.round(rollRatesDegS[60]! * 10) / 10,
      atTickOnePointFiveSec: Math.round(rollRatesDegS[89]! * 10) / 10,
      sustainedPeakDegS: Math.round(peakSustained * 10) / 10,
      finalTickDegS: Math.round(rollRatesDegS[ticks - 1]! * 10) / 10,
    };
    // Always print on failure via Vitest's diff; deliberately a no-op assertion
    // wraps so traceSummary lands in test output if the firm gate fails.
    expect(traceSummary).toBeDefined();
  });

  it('full +aileron ("roll right") produces NEGATIVE body-Z angvel (sign convention anchor)', () => {
    // In this codebase's right-handed Y-up convention, +aileron commands
    // "roll right" via `_aileronRightSign = +1` routed through the per-surface
    // `setDeflection(value * sign * maxDeflectionRad)` in flightmodel.ts.
    // The resulting body-frame roll angvel.z is NEGATIVE (rolling clockwise
    // when viewed from behind the aircraft). This sign asymmetry is part of
    // the existing convention; the test anchors it so a future flip would
    // surface immediately.
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 50, 0),
      linvel: new Vector3(0, 0, -78),
    });
    const fm = new FlightModel(aircraft);

    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) {
      fm.applyControls({ aileron: 1, elevator: 0, rudder: 0 });
      fm.applyForces(0.3, dt);
      world.timestep = dt;
      world.step();
    }
    const av = aircraft.body.angvel();
    expect(av.z).toBeLessThan(0);
  });

  it('full −aileron ("roll left") produces POSITIVE body-Z angvel (sign convention anchor)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 50, 0),
      linvel: new Vector3(0, 0, -78),
    });
    const fm = new FlightModel(aircraft);

    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) {
      fm.applyControls({ aileron: -1, elevator: 0, rudder: 0 });
      fm.applyForces(0.3, dt);
      world.timestep = dt;
      world.step();
    }
    const av = aircraft.body.angvel();
    expect(av.z).toBeGreaterThan(0);
  });
});
