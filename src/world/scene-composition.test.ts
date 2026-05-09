import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CubeTexture, Mesh, Group } from 'three';
import { FlatTerrain } from './terrain';
import { createProceduralSkybox } from './skybox';
import { createRunway, createTower } from './landmarks';

beforeAll(async () => {
  await RAPIER.init();
});

describe('Phase 1 world composition (mirrors main.ts wiring)', () => {
  it('the same construction order main.ts uses does not throw and produces a valid scene graph', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    const terrain = new FlatTerrain({ size: 4000, height: 0, textureRepeat: 100 });
    const terrainMesh = terrain.getMesh();
    expect(terrainMesh).toBeInstanceOf(Mesh);
    expect(() => world.createCollider(terrain.getColliderDesc())).not.toThrow();

    const { cubeTexture: skybox } = createProceduralSkybox();
    expect(skybox).toBeInstanceOf(CubeTexture);

    const runway = createRunway();
    expect(runway.mesh).toBeInstanceOf(Mesh);
    expect(runway.colliderDesc).toBeNull();

    const tower = createTower();
    expect(tower.mesh).toBeInstanceOf(Group);
    expect(() => world.createCollider(tower.colliderDesc)).not.toThrow();
  });

  it('skybox has the data-texture upload-path contract intact', () => {
    const { cubeTexture } = createProceduralSkybox();
    expect(cubeTexture.images.length).toBe(6);
    for (let i = 0; i < 6; i++) {
      const face = cubeTexture.images[i] as { isDataTexture?: boolean };
      expect(face.isDataTexture).toBe(true);
    }
  });

  it('default tower is in front of the default spawn (aircraft flying along -Z)', () => {
    const tower = createTower();
    expect(tower.colliderDesc.translation.z).toBeLessThan(0);
  });

  it('default runway is centered at the origin (under the default spawn)', () => {
    const runway = createRunway();
    expect(runway.mesh.position.x).toBe(0);
    expect(runway.mesh.position.z).toBe(0);
  });

  it('terrain extent is large enough for several minutes of cruise without exiting', () => {
    const terrain = new FlatTerrain();
    const cruiseSpeedMs = 30;
    const minRunwaySecs = 60;
    expect(terrain.size / 2).toBeGreaterThanOrEqual(cruiseSpeedMs * minRunwaySecs);
  });

  it('runway is along world Z (matches the spawn linvel direction)', () => {
    const runway = createRunway();
    runway.mesh.geometry.computeBoundingBox();
    const bb = runway.mesh.geometry.boundingBox!;
    const xExtent = bb.max.x - bb.min.x;
    const zExtent = bb.max.z - bb.min.z;
    expect(zExtent).toBeGreaterThan(xExtent);
  });
});
