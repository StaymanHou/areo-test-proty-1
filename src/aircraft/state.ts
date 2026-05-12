// Typed plain-data AircraftState that consumers outside `aircraft/` read from.
// Decouples the mission layer (and any future read-only consumers like HUD,
// AI hooks) from three.js Vector3/Quaternion instances and from Rapier-internal
// scratch buffers. The adapter `toAircraftState` converts the per-tick `BodyState`
// scratch buffer (Vector3-based, owned by Aircraft) into this plain-data shape.
//
// Vec3Plain lives here rather than in `mission/types.ts` so the dep direction is
// `mission → aircraft`: aircraft is the lower-level module that produces state;
// mission is the higher-level module that consumes it. The mission types
// re-export Vec3Plain from this module.

import type { BodyState } from './aerosurface';

export interface Vec3Plain {
  x: number;
  y: number;
  z: number;
}

export interface QuatPlain {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface AircraftState {
  position: Vec3Plain;
  linvel: Vec3Plain;
  angvel: Vec3Plain;
  quaternion: QuatPlain;
  /** Magnitude of linear velocity (m/s). */
  airspeed: number;
  /**
   * Height above the world ground plane. Phase 1 terrain is flat at y=0
   * (arch D4), so altitude == position.y. When terrain becomes a heightmap
   * (Phase 3 polish per D4 swap point), the adapter computes
   * altitude = position.y − terrain.getHeight(position.x, position.z).
   */
  altitude: number;
}

/** Convenience factory: allocate a fresh AircraftState buffer for reuse. */
export function createAircraftState(): AircraftState {
  return {
    position: { x: 0, y: 0, z: 0 },
    linvel: { x: 0, y: 0, z: 0 },
    angvel: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    airspeed: 0,
    altitude: 0,
  };
}

/**
 * Copy a `BodyState` (Vector3/Quaternion-based, scratch-owned by `Aircraft`)
 * into the supplied `AircraftState` plain-data buffer. Allocation-free.
 *
 * The caller owns the buffer and is responsible for keeping the reference
 * stable across ticks (the mission runner allocates one at construction).
 */
export function toAircraftState(body: BodyState, out: AircraftState): AircraftState {
  out.position.x = body.position.x;
  out.position.y = body.position.y;
  out.position.z = body.position.z;
  out.linvel.x = body.linvel.x;
  out.linvel.y = body.linvel.y;
  out.linvel.z = body.linvel.z;
  out.angvel.x = body.angvel.x;
  out.angvel.y = body.angvel.y;
  out.angvel.z = body.angvel.z;
  out.quaternion.x = body.quaternion.x;
  out.quaternion.y = body.quaternion.y;
  out.quaternion.z = body.quaternion.z;
  out.quaternion.w = body.quaternion.w;
  // Compute scalars from primitives (no Vector3.length() — keeps this pure-data).
  const vx = body.linvel.x;
  const vy = body.linvel.y;
  const vz = body.linvel.z;
  out.airspeed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  // Flat-terrain altitude per arch D4. See JSDoc on `altitude` for the heightmap-swap path.
  out.altitude = body.position.y;
  return out;
}
