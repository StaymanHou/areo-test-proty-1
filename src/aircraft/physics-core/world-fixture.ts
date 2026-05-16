import RAPIER from '@dimforge/rapier3d-compat';

// Single source of truth for the physics world's collider geometry — ground
// plane + tower. Browser path (`src/main.ts` via `src/world/terrain.ts` and
// `src/world/landmarks.ts`) and Node path (`tools/tune/harness.ts` and
// `tests/parity-diff.test.ts`) both consume these constants and/or
// `createPhysicsWorld()`. Keeping the descriptor shapes in one place is
// load-bearing for the WP14.6 parity test: any drift between the browser
// world and the Node world breaks bit-identity over long trajectories.
//
// This module is part of `physics-core/` — it must NOT import from `three`
// or any browser-only API. Mesh construction lives on the consuming side
// (`src/world/`), which re-imports the shape constants below.

/** Ground plane half-extent in X and Z. Matches `FlatTerrain` default size 4000m. */
export const GROUND_SIZE = 4000;

/** Ground collider half-thickness in Y — Rapier sees a thin slab at y≈0. */
export const GROUND_HALF_THICKNESS = 0.1;

/** Ground plane height in world Y. */
export const GROUND_Y = 0;

/** Tower base position (XZ on ground, Y=0 base). */
export const TOWER_POSITION = { x: 40, y: 0, z: -250 } as const;

/** Tower footprint (square base side length). */
export const TOWER_FOOTPRINT = 8;

/** Tower height (mesh + collider). */
export const TOWER_HEIGHT = 30;

/** Build the ground collider descriptor consumed by browser + harness paths. */
export function groundColliderDesc(): RAPIER.ColliderDesc {
  const halfSize = GROUND_SIZE / 2;
  return RAPIER.ColliderDesc.cuboid(halfSize, GROUND_HALF_THICKNESS, halfSize)
    .setTranslation(0, GROUND_Y - GROUND_HALF_THICKNESS, 0);
}

/** Build the tower collider descriptor consumed by browser + harness paths. */
export function towerColliderDesc(): RAPIER.ColliderDesc {
  return RAPIER.ColliderDesc.cuboid(
    TOWER_FOOTPRINT / 2,
    TOWER_HEIGHT / 2,
    TOWER_FOOTPRINT / 2,
  ).setTranslation(
    TOWER_POSITION.x,
    TOWER_POSITION.y + TOWER_HEIGHT / 2,
    TOWER_POSITION.z,
  );
}

export interface PhysicsWorld {
  world: RAPIER.World;
}

/**
 * Construct a Rapier world matching the shipped browser scene — gravity
 * (0, -9.81, 0), ground plane, tower. Caller is responsible for `RAPIER.init()`
 * before calling (same contract as direct `new RAPIER.World(...)` use).
 */
export function createPhysicsWorld(): PhysicsWorld {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(groundColliderDesc());
  world.createCollider(towerColliderDesc());
  return { world };
}
