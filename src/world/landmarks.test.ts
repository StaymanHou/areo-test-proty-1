import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Group, Mesh, PlaneGeometry, Vector3 } from 'three';
import { createRunway, createTower } from './landmarks';

beforeAll(async () => {
  await RAPIER.init();
});

describe('createRunway', () => {
  it('returns a Mesh and null colliderDesc (terrain handles ground collision)', () => {
    const r = createRunway();
    expect(r.mesh).toBeInstanceOf(Mesh);
    expect(r.colliderDesc).toBeNull();
  });

  it('uses default dimensions: 30m × 600m', () => {
    const { mesh } = createRunway();
    const params = (mesh.geometry as PlaneGeometry).parameters;
    expect(params.width).toBe(30);
    expect(params.height).toBe(600);
  });

  it('honours configured length and width', () => {
    const { mesh } = createRunway({ length: 800, width: 25 });
    const params = (mesh.geometry as PlaneGeometry).parameters;
    expect(params.width).toBe(25);
    expect(params.height).toBe(800);
  });

  it('positions the runway just above the configured y to avoid Z-fighting', () => {
    const { mesh } = createRunway({ position: new Vector3(0, 5, 0), yEpsilon: 0.05 });
    expect(mesh.position.y).toBeCloseTo(5.05, 6);
  });

  it('places runway at the origin by default', () => {
    const { mesh } = createRunway();
    expect(mesh.position.x).toBe(0);
    expect(mesh.position.z).toBe(0);
  });

  it('throws on non-positive length', () => {
    expect(() => createRunway({ length: 0 })).toThrow();
    expect(() => createRunway({ length: -100 })).toThrow();
  });

  it('throws on non-positive width', () => {
    expect(() => createRunway({ width: 0 })).toThrow();
  });

  it('runway long axis is aligned along world Z (matches spawn linvel direction)', () => {
    const { mesh } = createRunway({ length: 600, width: 30 });
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    const xExtent = bb.max.x - bb.min.x;
    const zExtent = bb.max.z - bb.min.z;
    expect(zExtent).toBeCloseTo(600, 4);
    expect(xExtent).toBeCloseTo(30, 4);
    expect(zExtent).toBeGreaterThan(xExtent);
  });
});

describe('createTower', () => {
  it('returns a Group containing two child meshes (body + cap)', () => {
    const t = createTower();
    expect(t.mesh).toBeInstanceOf(Group);
    expect(t.mesh.children).toHaveLength(2);
    expect(t.mesh.children[0]).toBeInstanceOf(Mesh);
    expect(t.mesh.children[1]).toBeInstanceOf(Mesh);
  });

  it('returns a ColliderDesc for the body', () => {
    const t = createTower();
    expect(t.colliderDesc).toBeInstanceOf(RAPIER.ColliderDesc);
  });

  it('uses default dimensions: 30m tall, 8m footprint', () => {
    const { colliderDesc } = createTower();
    const shape = colliderDesc.shape as RAPIER.Cuboid;
    expect(shape.halfExtents.x).toBeCloseTo(4, 6);
    expect(shape.halfExtents.y).toBeCloseTo(15, 6);
    expect(shape.halfExtents.z).toBeCloseTo(4, 6);
  });

  it('places the default tower at world (40, *, -250) — in front of the spawn flying along -Z — with collider centered at height/2', () => {
    const { colliderDesc } = createTower();
    expect(colliderDesc.translation.x).toBeCloseTo(40, 6);
    expect(colliderDesc.translation.y).toBeCloseTo(15, 6);
    expect(colliderDesc.translation.z).toBeCloseTo(-250, 6);
  });

  it('honours a custom position', () => {
    const { colliderDesc } = createTower({ position: new Vector3(-100, 0, -50), height: 20 });
    expect(colliderDesc.translation.x).toBeCloseTo(-100, 6);
    expect(colliderDesc.translation.y).toBeCloseTo(10, 6);
    expect(colliderDesc.translation.z).toBeCloseTo(-50, 6);
  });

  it('mesh group is positioned at the configured world location', () => {
    const t = createTower({ position: new Vector3(40, 0, -250) });
    expect(t.mesh.position.x).toBe(40);
    expect(t.mesh.position.z).toBe(-250);
  });

  it('body mesh sits with bottom at terrain height (y=0 in group local frame)', () => {
    const { mesh } = createTower({ height: 30 });
    const body = mesh.children[0] as Mesh;
    expect(body.position.y).toBeCloseTo(15, 6);
  });

  it('cap sits on top of the body', () => {
    const { mesh } = createTower({ height: 30 });
    const cap = mesh.children[1] as Mesh;
    expect(cap.position.y).toBeCloseTo(30.5, 6);
  });

  it('throws on non-positive height', () => {
    expect(() => createTower({ height: 0 })).toThrow();
  });

  it('throws on non-positive footprint', () => {
    expect(() => createTower({ footprint: 0 })).toThrow();
  });

  it('the returned colliderDesc can be instantiated by a Rapier world', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const { colliderDesc } = createTower();
    expect(() => world.createCollider(colliderDesc)).not.toThrow();
  });
});

describe('Tower as physical obstacle (integration)', () => {
  it('a body launched into the tower position does not pass through (collider stops it)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    const tower = createTower({ position: new Vector3(40, 0, -250), height: 30, footprint: 8 });
    world.createCollider(tower.colliderDesc);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(60, 15, -250)
        .setLinvel(-30, 0, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);

    for (let step = 0; step < 120; step++) {
      world.step();
    }

    const x = body.translation().x;
    expect(x).toBeGreaterThan(44);
  });
});
