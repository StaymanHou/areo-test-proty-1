import { Vector3 } from 'three';
import {
  AeroSurface,
  AIR_DENSITY,
  computeAeroForce,
  createAeroSurface,
} from './aerosurface';
import type { AircraftBody } from './rigidbody-core';

// Body-local thrust direction = nose forward = −Z (per CONVENTIONS.md).
const _thrustLocal = new Vector3(0, 0, -1);

// Reusable plain {x,y,z} buffers for Rapier API calls.
// Rapier copies values internally on each call, so reuse is safe.
const _forceBuf = { x: 0, y: 0, z: 0 };
const _pointBuf = { x: 0, y: 0, z: 0 };
const _thrustWorld = new Vector3();

export interface ControlInput {
  /** [-1, +1]; +1 commands roll right. */
  aileron: number;
  /** [-1, +1]; +1 commands nose up. */
  elevator: number;
  /** [-1, +1]; +1 commands nose right. */
  rudder: number;
}

interface ControlRoute {
  surface: AeroSurface;
  /** Sign multiplier applied to the control value. */
  sign: number;
  /** Which control axis drives this surface. */
  axis: 'aileron' | 'elevator' | 'rudder';
}

// Sign conventions (see CONVENTIONS.md). Signs determined empirically by the
// flight-model torque tests: a +control input must produce the documented body
// motion (+aileron → roll right; +elevator → nose up; +rudder → nose right).
// Geometry (standard surfaces: wing/h-stab normal=+Y, v-stab normal=+X, chord=−Z)
// fixes the spanAxis for each surface; the sign multiplier here decides which
// way the surface rotates about that axis to produce the commanded body motion.
const _aileronRightSign = +1;
const _aileronLeftSign = -1;
const _elevatorSign = +1;
const _rudderSign = +1;

export class FlightModel {
  readonly surfaces: AeroSurface[];
  // Typed as the framework-agnostic AircraftBody so the harness in WP14.7 can
  // construct a FlightModel directly. The browser-side Aircraft extends
  // AircraftBody (see ../rigidbody.ts) and is a valid substitution.
  readonly aircraft: AircraftBody;
  /** Mutable for WP7 live tuning; do not mutate during the per-tick hot path. */
  maxThrustN: number;

  private readonly routes: ControlRoute[];

  constructor(aircraft: AircraftBody) {
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
        maxDeflectionRad: s.maxDeflectionRad,
        incidenceRad: s.incidenceRad,
        clQ: s.clQ,
        clAlphaDot: s.clAlphaDot,
        inducedDragK: s.inducedDragK,
      }),
    );

    this.routes = [];
    for (let i = 0; i < aircraft.config.surfaces.length; i++) {
      const name = aircraft.config.surfaces[i]!.name;
      const surface = this.surfaces[i]!;
      if (name === 'wing-left') {
        this.routes.push({ surface, sign: _aileronLeftSign, axis: 'aileron' });
      } else if (name === 'wing-right') {
        this.routes.push({ surface, sign: _aileronRightSign, axis: 'aileron' });
      } else if (name === 'h-stab') {
        this.routes.push({ surface, sign: _elevatorSign, axis: 'elevator' });
      } else if (name === 'v-stab') {
        this.routes.push({ surface, sign: _rudderSign, axis: 'rudder' });
      }
    }
  }

  /**
   * Reset every surface's per-tick state to its post-construction baseline:
   * deflection zeroed (via `setDeflection(0)` which restores the rest-frame
   * normal/chord), and the WP10.5 β5 `prevAoA` cache cleared so the first
   * tick after this reset has no stale α reference. Used by the mission
   * runner on mission start / restart, paired with `Aircraft.reset`.
   * Allocation-free.
   */
  resetSurfaceState(): void {
    for (let i = 0; i < this.surfaces.length; i++) {
      const s = this.surfaces[i]!;
      s.setDeflection(0);
      s.prevAoA = undefined;
    }
  }

  /**
   * Translate normalized control inputs into per-surface deflections.
   * Each routed surface receives `controls[axis] * sign * surface.maxDeflectionRad`.
   * Surfaces not in any route are left at deflection 0.
   */
  applyControls(controls: ControlInput): void {
    for (let i = 0; i < this.routes.length; i++) {
      const r = this.routes[i]!;
      const value = controls[r.axis];
      r.surface.setDeflection(value * r.sign * r.surface.maxDeflectionRad);
    }
  }

  /**
   * Apply per-tick aerodynamic + thrust forces to the rigid body.
   * Gravity is handled by Rapier's world gravity setting.
   *
   * @param throttle Normalized throttle [0..1]. Clamped internally.
   * @param dt Physics timestep in seconds. Optional — only used to enable
   *           β5 (`clAlphaDot`) AoA-rate damping in `computeAeroForce`.
   *           Test fixtures that don't exercise β5 may omit it.
   */
  applyForces(throttle: number, dt?: number): void {
    const t = throttle < 0 ? 0 : throttle > 1 ? 1 : throttle;
    // Clear Rapier's per-tick user-force accumulator before applying this tick's
    // forces. Rapier persists addForce/addForceAtPoint values across world.step()
    // calls; without an explicit reset they compound multiplicatively (at tick n
    // the effective force is (n+1)× the intended). See SURFACE-2026-05-24-09.
    this.aircraft.body.resetForces(true);
    this.aircraft.body.resetTorques(true);
    const state = this.aircraft.readBodyState();

    // 1. Per-surface aerodynamic force at world application point.
    for (let i = 0; i < this.surfaces.length; i++) {
      const surface = this.surfaces[i]!;
      const result = computeAeroForce(surface, state, dt);
      // computeAeroForce returns shared Vector3s — consume immediately.
      _forceBuf.x = result.force.x;
      _forceBuf.y = result.force.y;
      _forceBuf.z = result.force.z;
      _pointBuf.x = result.applicationPoint.x;
      _pointBuf.y = result.applicationPoint.y;
      _pointBuf.z = result.applicationPoint.z;
      this.aircraft.body.addForceAtPoint(_forceBuf, _pointBuf, true);
    }

    // 1b. D18 fuselage parasitic drag (body-level, single force at body origin).
    // Magnitude: 0.5 · ρ · V² · area · cd0. Direction: -linvel / |linvel| (drag
    // opposes motion through still air). Applied at the body origin via
    // `addForce` (NOT `addForceAtPoint`) so the contribution is purely
    // translational with zero torque — fuselage drag is not a moment-arm
    // mechanism. Gated on `config.fuselageDrag` being present (default-absent
    // preserves pre-D18 behavior bit-for-bit). V > epsilon guard avoids 0/0
    // at body rest. See arch.md Revision 2026-05-23 (D18), CONVENTIONS.md,
    // and SURFACE-2026-05-23-01.
    const fuselageDrag = this.aircraft.config.fuselageDrag;
    if (fuselageDrag !== undefined) {
      const v = state.linvel.length();
      if (v > 1e-6) {
        const q = 0.5 * AIR_DENSITY * v * v;
        const mag = q * fuselageDrag.area * fuselageDrag.cd0;
        const invV = 1 / v;
        _forceBuf.x = -state.linvel.x * mag * invV;
        _forceBuf.y = -state.linvel.y * mag * invV;
        _forceBuf.z = -state.linvel.z * mag * invV;
        this.aircraft.body.addForce(_forceBuf, true);
      }
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
