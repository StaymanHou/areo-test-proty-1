import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type Texture,
} from 'three';
import { createRunwayStripeTexture } from './textures';

export interface RunwayOptions {
  length?: number;
  width?: number;
  position?: Vector3;
  yEpsilon?: number;
  texture?: Texture;
}

export interface RunwayResult {
  mesh: Mesh;
  colliderDesc: RAPIER.ColliderDesc | null;
}

export function createRunway(opts: RunwayOptions = {}): RunwayResult {
  const length = opts.length ?? 600;
  const width = opts.width ?? 30;
  const position = opts.position ?? new Vector3(0, 0, 0);
  const yEpsilon = opts.yEpsilon ?? 0.05;

  if (length <= 0 || width <= 0) {
    throw new Error(`createRunway: length and width must be positive (got ${length}, ${width})`);
  }

  const texture = opts.texture ?? createRunwayStripeTexture();
  const geometry = new PlaneGeometry(width, length);
  geometry.rotateX(-Math.PI / 2);

  const material = new MeshStandardMaterial({
    map: texture,
    roughness: 0.9,
    metalness: 0.0,
  });

  const mesh = new Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.position.y += yEpsilon;
  mesh.receiveShadow = true;

  return { mesh, colliderDesc: null };
}

export interface TowerOptions {
  height?: number;
  footprint?: number;
  position?: Vector3;
  bodyColor?: number;
  capColor?: number;
}

export interface TowerResult {
  mesh: Group;
  colliderDesc: RAPIER.ColliderDesc;
}

export function createTower(opts: TowerOptions = {}): TowerResult {
  const height = opts.height ?? 30;
  const footprint = opts.footprint ?? 8;
  const position = opts.position ?? new Vector3(40, 0, -250);
  const bodyColor = opts.bodyColor ?? 0xc8c8c8;
  const capColor = opts.capColor ?? 0xc83232;

  if (height <= 0 || footprint <= 0) {
    throw new Error(`createTower: height and footprint must be positive (got ${height}, ${footprint})`);
  }

  const group = new Group();
  group.position.copy(position);

  const body = new Mesh(
    new BoxGeometry(footprint, height, footprint),
    new MeshStandardMaterial({ color: bodyColor, roughness: 0.8 }),
  );
  body.position.y = height / 2;
  body.castShadow = true;
  group.add(body);

  const cap = new Mesh(
    new BoxGeometry(footprint * 1.4, 1, footprint * 1.4),
    new MeshStandardMaterial({ color: capColor, roughness: 0.6 }),
  );
  cap.position.y = height + 0.5;
  cap.castShadow = true;
  group.add(cap);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(footprint / 2, height / 2, footprint / 2)
    .setTranslation(position.x, position.y + height / 2, position.z);

  return { mesh: group, colliderDesc };
}
