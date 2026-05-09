import RAPIER from '@dimforge/rapier3d-compat';
import {
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Texture,
} from 'three';
import { createCheckerTexture } from './textures';

export interface Terrain {
  getHeight(x: number, z: number): number;
  getMesh(): Mesh;
  getColliderDesc(): RAPIER.ColliderDesc;
}

export interface FlatTerrainOptions {
  size?: number;
  height?: number;
  textureRepeat?: number;
  texture?: Texture;
}

const COLLIDER_HALF_THICKNESS = 0.1;

export class FlatTerrain implements Terrain {
  readonly size: number;
  readonly height: number;
  readonly textureRepeat: number;
  private readonly mesh: Mesh;
  private readonly texture: Texture;

  constructor(opts: FlatTerrainOptions = {}) {
    this.size = opts.size ?? 4000;
    this.height = opts.height ?? 0;
    this.textureRepeat = opts.textureRepeat ?? 100;

    if (this.size <= 0) {
      throw new Error(`FlatTerrain: size must be positive, got ${this.size}`);
    }
    if (this.textureRepeat <= 0) {
      throw new Error(`FlatTerrain: textureRepeat must be positive, got ${this.textureRepeat}`);
    }

    this.texture = opts.texture ?? createCheckerTexture();
    this.texture.repeat.set(this.textureRepeat, this.textureRepeat);

    const geometry = new PlaneGeometry(this.size, this.size);
    geometry.rotateX(-Math.PI / 2);

    const material = new MeshStandardMaterial({
      map: this.texture,
      roughness: 1.0,
      metalness: 0.0,
    });

    this.mesh = new Mesh(geometry, material);
    this.mesh.position.set(0, this.height, 0);
    this.mesh.receiveShadow = true;
  }

  getHeight(_x: number, _z: number): number {
    return this.height;
  }

  getMesh(): Mesh {
    return this.mesh;
  }

  getColliderDesc(): RAPIER.ColliderDesc {
    const halfSize = this.size / 2;
    return RAPIER.ColliderDesc.cuboid(halfSize, COLLIDER_HALF_THICKNESS, halfSize)
      .setTranslation(0, this.height - COLLIDER_HALF_THICKNESS, 0);
  }
}
