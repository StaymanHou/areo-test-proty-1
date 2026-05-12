import type RAPIER from '@dimforge/rapier3d-compat';
import type { AircraftBody } from './rigidbody-core';
import type { FlightModel } from './flightmodel';

// Single-tick composable driver — the smallest unit of "advance the simulation
// by one fixed-dt step." The browser game loop in `src/main.ts` runs the same
// sequence inline (with controls input + post-step mission tick); the WP14.7
// Node harness will call this directly in a tight `while` loop.
//
// Caller responsibilities:
//   - Provide a stable `dt` (60 Hz fixed timestep per arch D1; pass-through to
//     Rapier via `world.timestep`).
//   - Throttle is a scalar in [0, 1]; control deflections (aileron/elevator/
//     rudder) are NOT applied here — those come from `Controls` in the browser
//     path. Harness fixtures use pre-set deflections via `FlightModel`'s
//     existing per-surface state (default: zero deflection).
//
// No allocation in the hot path — both `flightModel.applyForces` and Rapier's
// `world.step` are allocation-free.

export interface StepInputs {
  /** Throttle scalar [0, 1]. */
  throttle: number;
}

export function step(
  world: RAPIER.World,
  _aircraft: AircraftBody,
  flightModel: FlightModel,
  inputs: StepInputs,
  dt: number,
): void {
  flightModel.applyForces(inputs.throttle, dt);
  world.timestep = dt;
  world.step();
}
