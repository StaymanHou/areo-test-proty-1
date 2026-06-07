import RAPIER from '@dimforge/rapier3d-compat';
import {
  Group,
  Scene,
} from 'three';
import type { AircraftConfig } from './physics-core/config';
import { AircraftBody, type AircraftBodyCreateOptions } from './physics-core/rigidbody-core';
import { buildAircraftMesh, inferAircraftVariant, type AircraftVariant } from './aircraft-mesh';

export interface AircraftCreateOptions extends AircraftBodyCreateOptions {
  /** If true, attach the mesh to the supplied scene. Default true. */
  attachMesh?: boolean;
  /** Override the auto-inferred mesh variant (cessna / mig15 / default). */
  meshVariant?: AircraftVariant;
}

export class Aircraft extends AircraftBody {
  readonly mesh: Group;

  constructor(world: RAPIER.World, config: AircraftConfig, opts: AircraftCreateOptions = {}) {
    super(world, config, opts);
    const variant = opts.meshVariant ?? inferAircraftVariant(config);
    this.mesh = buildAircraftMesh(config, variant);
    if (opts.attachMesh !== false && (opts as { scene?: Scene }).scene) {
      (opts as { scene?: Scene }).scene!.add(this.mesh);
    }
  }

  /** Copy Rapier body pose into the Three.js mesh group. Call once per render frame. */
  syncMesh(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

export function attachAircraftToScene(aircraft: Aircraft, scene: Scene): void {
  scene.add(aircraft.mesh);
}
