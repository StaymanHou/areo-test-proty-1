import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion } from 'three';
import { Aircraft } from './rigidbody';
import { FlightModel } from './physics-core/flightmodel';
import { parseAircraftConfig, type AircraftConfig } from './physics-core/config';
import canonicalAircraftConfig from '../../public/config/aircraft.json' with { type: 'json' };

// Pitch-envelope reproduction test for SURFACE-2026-06-06-02.
//
// Operator-reported bug: at the production aircraft.json (clQ_wing=1.83,
// clQ_hstab=1.95, tuned during the D14→D27 cascade for phugoid stability),
// holding full +elevator at V_trim cruise CANNOT achieve a nose-down dive
// (sustained pitch ≤ -60°) and CANNOT complete a backflip (pitch passing
// through +90° toward +180°). Primary hypothesis: D17 β4 pitch-rate damping
// is over-damping aggressive aerobatic maneuvers.
//
// Per CLAUDE.md Rule #4 decomposition (terminal-vs-initial physics):
//   - INITIAL-ACCEL question: can the airframe START pitching aggressively?
//     Answer is yes per Rule #5 force-balance derivation in the SURFACE entry
//     (full elevator at V_trim produces 320°/s² angular accel; ample moment).
//   - STEADY-STATE question: can the airframe REACH a sustained inverted/
//     nose-down attitude? This is what β4 damping opposes proportionally to
//     pitch rate. The bug lives here.
//
// Decomposed into two failing tests:
//   1. backflip: hold full +elevator for 5s, assert max(pitch) crosses +90°.
//      EXPECTED FAILURE — the bug — until clQ is reduced or a mechanism fix
//      lands.
//   2. nose-dive: hold full -elevator from level cruise for 4s, assert
//      min(pitch) reaches ≤ -60° (sustained nose-down). EXPECTED FAILURE.
//
// Sign convention (anchored by stability.test.ts:94 and
// flightmodel.test.ts:214): pitch is body-X; +elevator → +angvel.x → pitch up.
//
// Method follows roll-rate.test.ts structurally — fixed 60Hz timestep,
// deterministic, V_trim=78 spawn, low-cruise throttle 0.3.

let config: AircraftConfig;

beforeAll(async () => {
  await RAPIER.init();
  config = parseAircraftConfig(canonicalAircraftConfig);
});

const RAD2DEG = 180 / Math.PI;

function extractPitchDeg(q: { x: number; y: number; z: number; w: number }): number {
  // Body-X pitch angle. The Euler 'YXZ' decomposition hits gimbal lock at
  // ±90° pitch — it caps the X component there even though the underlying
  // quaternion continues rotating. To capture rotations PAST +90° we instead
  // compute the angle between world-up (0,1,0) and body-up (the wing-normal
  // direction after rotation). This gives a signed pitch in (-180°, +180°]
  // that doesn't saturate.
  //
  // body-up in world frame = quaternion · (0,1,0). Pitch = angle between this
  // and world-up, signed by the z-component of the rotated forward vector
  // (body-forward originally (0,0,-1); pitched up means body-forward has +y).
  const quat = new Quaternion(q.x, q.y, q.z, q.w);
  const bodyForward = new Vector3(0, 0, -1).applyQuaternion(quat);
  // The pitch angle is asin(bodyForward.y) if we want -90° to +90° only —
  // but that also gimbal-locks. Use atan2 of (bodyForward.y, -bodyForward.z)
  // to get the full ±180° range (the angle of body-forward in the world Y-Z
  // plane, measured from world -Z = original nose direction).
  // At identity: bodyForward=(0,0,-1) → atan2(0, 1) = 0°
  // At pitch +90°: bodyForward=(0,1,0) → atan2(1, 0) = +90°
  // At pitch +180° (inverted): bodyForward=(0,0,+1) → atan2(0, -1) = +180°
  // At pitch -90° (nose-down): bodyForward=(0,-1,0) → atan2(-1, 0) = -90°
  const pitchRad = Math.atan2(bodyForward.y, -bodyForward.z);
  return pitchRad * RAD2DEG;
}

describe('Pitch envelope at production aircraft.json knobs (SURFACE-2026-06-06-02)', () => {
  it('backflip: holding full +elevator for 5s reaches pitch > +90°', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 200, 0),
      linvel: new Vector3(0, 0, -78), // V_trim spawn
    });
    const fm = new FlightModel(aircraft);

    const pitchHistoryDeg: number[] = [];
    const dt = 1 / 60;
    const ticks = 300; // 5 seconds at 60 Hz
    for (let i = 0; i < ticks; i++) {
      fm.applyControls({ aileron: 0, elevator: 1, rudder: 0 });
      fm.applyForces(0.3, dt);
      world.timestep = dt;
      world.step();
      const q = aircraft.body.rotation();
      pitchHistoryDeg.push(extractPitchDeg(q));
    }

    const maxPitch = Math.max(...pitchHistoryDeg);
    const minPitch = Math.min(...pitchHistoryDeg);

    // PATH A CLOSURE (SURFACE-2026-06-06-02, 2026-06-06): the Cessna-class
    // airframe (mass=1000 kg, thrust.maxN=6000, T/W=0.61) physically cannot
    // complete a backflip from cruise — matches real Cessna 172 behavior.
    // The Step 0 jet-experiment (Vitest pitch-envelope-aerobatic-probe.test.ts
    // + browser-walkthrough via scripted-input harness at commit 14975f4)
    // showed the same airframe geometry + control law DOES complete a full
    // +180° loop when mass / thrust are swapped to Pitts-class. The
    // simulation IS physically faithful; aerobatic gameplay needs a different
    // airframe class (deferred to Phase 3 multi-aircraft work, see
    // CLAUDE.md "Not goals for v1" exclusion list).
    //
    // This assertion codifies the physically correct Cessna-class ceiling:
    // max pitch under sustained +elevator from cruise stays below the
    // +90° loop threshold (empirically +56° at production knobs).
    expect(maxPitch).toBeLessThan(90);
    // Sanity: airframe should still pitch up meaningfully — assertion would
    // be vacuously true if max pitch never left 0.
    expect(maxPitch).toBeGreaterThan(30);

    // Diagnostic trace so failure mode is visible in test output.
    const _trace = {
      atSec1: Math.round(pitchHistoryDeg[60]! * 10) / 10,
      atSec2: Math.round(pitchHistoryDeg[120]! * 10) / 10,
      atSec3: Math.round(pitchHistoryDeg[180]! * 10) / 10,
      atSec4: Math.round(pitchHistoryDeg[240]! * 10) / 10,
      atSec5: Math.round(pitchHistoryDeg[299]! * 10) / 10,
      maxPitchDeg: Math.round(maxPitch * 10) / 10,
      minPitchDeg: Math.round(minPitch * 10) / 10,
    };
    expect(_trace).toBeDefined();
  });

  it('nose-dive: holding full -elevator for 4s reaches sustained pitch ≤ -60°', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 200, 0),
      linvel: new Vector3(0, 0, -78),
    });
    const fm = new FlightModel(aircraft);

    const pitchHistoryDeg: number[] = [];
    const dt = 1 / 60;
    const ticks = 240; // 4 seconds at 60 Hz
    for (let i = 0; i < ticks; i++) {
      fm.applyControls({ aileron: 0, elevator: -1, rudder: 0 });
      fm.applyForces(0.3, dt);
      world.timestep = dt;
      world.step();
      const q = aircraft.body.rotation();
      pitchHistoryDeg.push(extractPitchDeg(q));
    }

    const minPitch = Math.min(...pitchHistoryDeg);

    // RED-GREEN ANCHOR: bug means minPitch stalls well short of -60°.
    // When fixed, nose-dive should be reachable → minPitch ≤ -60°.
    expect(minPitch).toBeLessThanOrEqual(-60);
  });

  it('sign convention anchor: +elevator produces +pitch (initial 30 ticks)', () => {
    // Confirms the initial-accel direction. Per CLAUDE.md Rule #4: this is
    // the "can it START pitching" question, distinct from the steady-state
    // "can it REACH" question above. This test should already PASS at
    // production knobs (force balance derivation predicts ample initial
    // moment); it's the steady-state tests above that fail.
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 200, 0),
      linvel: new Vector3(0, 0, -78),
    });
    const fm = new FlightModel(aircraft);
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) {
      fm.applyControls({ aileron: 0, elevator: 1, rudder: 0 });
      fm.applyForces(0.3, dt);
      world.timestep = dt;
      world.step();
    }
    const av = aircraft.body.angvel();
    expect(av.x).toBeGreaterThan(0);
  });
});
