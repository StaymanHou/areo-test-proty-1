import { Vector3 } from 'three';
import {
  AeroSurface,
  computeAeroForce,
  createAeroSurface,
} from './aerosurface';
import type { Aircraft } from './rigidbody';

// Body-local thrust direction = nose forward = −Z (per CONVENTIONS.md).
const _thrustLocal = new Vector3(0, 0, -1);

// Reusable plain {x,y,z} buffers for Rapier API calls.
// Rapier copies values internally on each call, so reuse is safe.
const _forceBuf = { x: 0, y: 0, z: 0 };
const _pointBuf = { x: 0, y: 0, z: 0 };
const _thrustWorld = new Vector3();

export class FlightModel {
  readonly surfaces: AeroSurface[];
  readonly aircraft: Aircraft;
  readonly maxThrustN: number;

  constructor(aircraft: Aircraft) {
    this.aircraft = aircraft;
    this.maxThrustN = aircraft.config.thrust.maxN;
    this.surfaces = aircraft.config.surfaces.map((s) =>
      createAeroSurface({
        position: s.position,
        normal: s.normal,
        chord: s.chord,
        area: s.area,
        clCurve: s.clCurve,
        cdCurve: s.cdCurve,
      }),
    );
  }

  /**
   * Apply per-tick aerodynamic + thrust forces to the rigid body.
   * Gravity is handled by Rapier's world gravity setting.
   *
   * @param throttle Normalized throttle [0..1]. Clamped internally.
   */
  applyForces(throttle: number): void {
    const t = throttle < 0 ? 0 : throttle > 1 ? 1 : throttle;
    const state = this.aircraft.readBodyState();

    // 1. Per-surface aerodynamic force at world application point.
    for (let i = 0; i < this.surfaces.length; i++) {
      const surface = this.surfaces[i]!;
      const result = computeAeroForce(surface, state);
      // computeAeroForce returns shared Vector3s — consume immediately.
      _forceBuf.x = result.force.x;
      _forceBuf.y = result.force.y;
      _forceBuf.z = result.force.z;
      _pointBuf.x = result.applicationPoint.x;
      _pointBuf.y = result.applicationPoint.y;
      _pointBuf.z = result.applicationPoint.z;
      this.aircraft.body.addForceAtPoint(_forceBuf, _pointBuf, true);
    }

    // 2. Thrust along body −Z, rotated into world frame.
    if (t > 0 && this.maxThrustN > 0) {
      _thrustWorld.copy(_thrustLocal).applyQuaternion(state.quaternion);
      const mag = t * this.maxThrustN;
      _forceBuf.x = _thrustWorld.x * mag;
      _forceBuf.y = _thrustWorld.y * mag;
      _forceBuf.z = _thrustWorld.z * mag;
      this.aircraft.body.addForce(_forceBuf, true);
    }
  }
}
