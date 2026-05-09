import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from 'three';
import { FlatTerrain, type Terrain } from './terrain';

beforeAll(async () => {
  await RAPIER.init();
});

describe('FlatTerrain', () => {
  it('satisfies the Terrain interface', () => {
    const t: Terrain = new FlatTerrain();
    expect(typeof t.getHeight).toBe('function');
    expect(typeof t.getMesh).toBe('function');
    expect(typeof t.getColliderDesc).toBe('function');
  });

  it('uses default size 4000m and height 0m', () => {
    const t = new FlatTerrain();
    expect(t.size).toBe(4000);
    expect(t.height).toBe(0);
  });

  it('honours configured size, height, and textureRepeat', () => {
    const t = new FlatTerrain({ size: 1000, height: 5, textureRepeat: 25 });
    expect(t.size).toBe(1000);
    expect(t.height).toBe(5);
    expect(t.textureRepeat).toBe(25);
  });

  it('throws on non-positive size', () => {
    expect(() => new FlatTerrain({ size: 0 })).toThrow();
    expect(() => new FlatTerrain({ size: -100 })).toThrow();
  });

  it('throws on non-positive textureRepeat', () => {
    expect(() => new FlatTerrain({ textureRepeat: 0 })).toThrow();
  });
});

describe('FlatTerrain.getHeight', () => {
  it('returns the configured constant height for any (x, z)', () => {
    const t = new FlatTerrain({ height: 7 });
    expect(t.getHeight(0, 0)).toBe(7);
    expect(t.getHeight(1234, -5678)).toBe(7);
    expect(t.getHeight(-1e9, 1e9)).toBe(7);
  });

  it('defaults to zero when no height is configured', () => {
    const t = new FlatTerrain();
    expect(t.getHeight(100, -200)).toBe(0);
  });
});

describe('FlatTerrain.getMesh', () => {
  it('returns a THREE.Mesh', () => {
    const t = new FlatTerrain({ size: 500 });
    const mesh = t.getMesh();
    expect(mesh).toBeInstanceOf(Mesh);
  });

  it('returns a mesh whose PlaneGeometry has the configured size', () => {
    const t = new FlatTerrain({ size: 250 });
    const mesh = t.getMesh();
    expect(mesh.geometry).toBeInstanceOf(PlaneGeometry);
    const params = (mesh.geometry as PlaneGeometry).parameters;
    expect(params.width).toBe(250);
    expect(params.height).toBe(250);
  });

  it('positions the mesh at the configured height in world Y', () => {
    const t = new FlatTerrain({ height: 12 });
    expect(t.getMesh().position.y).toBe(12);
  });

  it('applies textureRepeat to the bound texture', () => {
    const t = new FlatTerrain({ textureRepeat: 50 });
    const mesh = t.getMesh();
    const mat = mesh.material as MeshStandardMaterial;
    expect(mat.map).not.toBeNull();
    expect(mat.map!.repeat.x).toBe(50);
    expect(mat.map!.repeat.y).toBe(50);
  });

  it('returns the same mesh instance across calls (caches)', () => {
    const t = new FlatTerrain();
    expect(t.getMesh()).toBe(t.getMesh());
  });
});

describe('FlatTerrain.getColliderDesc', () => {
  it('returns a RAPIER.ColliderDesc', () => {
    const t = new FlatTerrain();
    const desc = t.getColliderDesc();
    expect(desc).toBeInstanceOf(RAPIER.ColliderDesc);
  });

  it('produces a cuboid with half-extents matching size/2', () => {
    const t = new FlatTerrain({ size: 1000 });
    const desc = t.getColliderDesc();
    const shape = desc.shape as RAPIER.Cuboid;
    expect(shape.halfExtents.x).toBeCloseTo(500, 6);
    expect(shape.halfExtents.z).toBeCloseTo(500, 6);
  });

  it('positions the collider so its top surface aligns with the visible mesh height', () => {
    const t = new FlatTerrain({ height: 0 });
    const desc = t.getColliderDesc();
    const halfThickness = (desc.shape as RAPIER.Cuboid).halfExtents.y;
    expect(desc.translation.y + halfThickness).toBeCloseTo(0, 6);
  });

  it('positions correctly at non-zero terrain heights', () => {
    const t = new FlatTerrain({ height: 25 });
    const desc = t.getColliderDesc();
    const halfThickness = (desc.shape as RAPIER.Cuboid).halfExtents.y;
    expect(desc.translation.y + halfThickness).toBeCloseTo(25, 6);
  });

  it('produces a descriptor that the world can instantiate without error', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const t = new FlatTerrain({ size: 200 });
    expect(() => world.createCollider(t.getColliderDesc())).not.toThrow();
  });
});

describe('FlatTerrain — codified integration behaviors', () => {
  it('keeps the mesh in the XZ plane (a vertex sampled from the geometry has y near terrain height)', () => {
    const t = new FlatTerrain({ size: 100, height: 7 });
    const mesh = t.getMesh();
    const positions = mesh.geometry.attributes.position;
    const v = new Vector3().fromBufferAttribute(positions, 0);
    v.applyMatrix4(mesh.matrixWorld);
    mesh.updateMatrixWorld();
    v.fromBufferAttribute(positions, 0).applyMatrix4(mesh.matrixWorld);
    expect(v.y).toBeCloseTo(7, 5);
  });

  it('a dynamic body dropped above the terrain comes to rest at the terrain top surface', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const terrainHeight = 0;
    const t = new FlatTerrain({ size: 200, height: terrainHeight });
    world.createCollider(t.getColliderDesc());

    const ballRadius = 1;
    const dropFromY = 20;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, dropFromY, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.ball(ballRadius), body);

    for (let step = 0; step < 600; step++) {
      world.step();
    }

    const finalY = body.translation().y;
    expect(finalY).toBeGreaterThan(terrainHeight);
    expect(finalY).toBeLessThan(terrainHeight + ballRadius * 2);
  });

  it('a body launched at terrain height does not fall through (collider sized correctly at default)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const t = new FlatTerrain();
    world.createCollider(t.getColliderDesc());

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(1500, 5, -1500),
    );
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);

    for (let step = 0; step < 300; step++) {
      world.step();
    }

    expect(body.translation().y).toBeGreaterThan(-2);
  });
});
