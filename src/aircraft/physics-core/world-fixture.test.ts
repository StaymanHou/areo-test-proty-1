import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { FlatTerrain } from '../../world/terrain';
import { createTower } from '../../world/landmarks';
import {
  createPhysicsWorld,
  groundColliderDesc,
  towerColliderDesc,
  GROUND_SIZE,
  GROUND_HALF_THICKNESS,
  GROUND_Y,
  TOWER_POSITION,
  TOWER_FOOTPRINT,
  TOWER_HEIGHT,
} from './world-fixture';

beforeAll(async () => {
  await RAPIER.init();
});

describe('createPhysicsWorld', () => {
  it('returns a Rapier World with the project gravity vector', () => {
    const { world } = createPhysicsWorld();
    expect(world).toBeInstanceOf(RAPIER.World);
    expect(world.gravity.x).toBe(0);
    expect(world.gravity.y).toBeCloseTo(-9.81, 6);
    expect(world.gravity.z).toBe(0);
  });

  it('attaches exactly two static colliders (ground + tower)', () => {
    const { world } = createPhysicsWorld();
    let n = 0;
    world.forEachCollider(() => {
      n++;
    });
    expect(n).toBe(2);
  });
});

describe('shape descriptors', () => {
  it('groundColliderDesc matches FlatTerrain.getColliderDesc() at default size/height', () => {
    const fromFixture = groundColliderDesc();
    const fromTerrain = new FlatTerrain().getColliderDesc();

    const a = fromFixture.shape as RAPIER.Cuboid;
    const b = fromTerrain.shape as RAPIER.Cuboid;
    expect(a.halfExtents.x).toBeCloseTo(b.halfExtents.x, 9);
    expect(a.halfExtents.y).toBeCloseTo(b.halfExtents.y, 9);
    expect(a.halfExtents.z).toBeCloseTo(b.halfExtents.z, 9);

    expect(fromFixture.translation.x).toBeCloseTo(fromTerrain.translation.x, 9);
    expect(fromFixture.translation.y).toBeCloseTo(fromTerrain.translation.y, 9);
    expect(fromFixture.translation.z).toBeCloseTo(fromTerrain.translation.z, 9);
  });

  it('towerColliderDesc matches createTower().colliderDesc at defaults', () => {
    const fromFixture = towerColliderDesc();
    const fromTower = createTower().colliderDesc;

    const a = fromFixture.shape as RAPIER.Cuboid;
    const b = fromTower.shape as RAPIER.Cuboid;
    expect(a.halfExtents.x).toBeCloseTo(b.halfExtents.x, 9);
    expect(a.halfExtents.y).toBeCloseTo(b.halfExtents.y, 9);
    expect(a.halfExtents.z).toBeCloseTo(b.halfExtents.z, 9);

    expect(fromFixture.translation.x).toBeCloseTo(fromTower.translation.x, 9);
    expect(fromFixture.translation.y).toBeCloseTo(fromTower.translation.y, 9);
    expect(fromFixture.translation.z).toBeCloseTo(fromTower.translation.z, 9);
  });
});

describe('exported shape constants', () => {
  it('GROUND_* constants describe a flat slab covering the playable area', () => {
    expect(GROUND_SIZE).toBeGreaterThan(0);
    expect(GROUND_HALF_THICKNESS).toBeGreaterThan(0);
    expect(GROUND_Y).toBe(0);
  });

  it('TOWER_* constants place the obstacle in front of the spawn (negative Z)', () => {
    expect(TOWER_POSITION.z).toBeLessThan(0);
    expect(TOWER_FOOTPRINT).toBeGreaterThan(0);
    expect(TOWER_HEIGHT).toBeGreaterThan(0);
  });
});
