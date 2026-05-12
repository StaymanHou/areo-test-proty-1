import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from 'three';
import type { AircraftConfig } from './physics-core/config';
import { AircraftBody, type AircraftBodyCreateOptions } from './physics-core/rigidbody-core';

// Visual placeholder: fuselage box + L/R wing slabs (purely cosmetic; physics is single body).
function buildPlaceholderMesh(config: AircraftConfig): Group {
  const group = new Group();
  const fuselage = new Mesh(
    new BoxGeometry(1, 0.6, 6),
    new MeshStandardMaterial({ color: 0x4488ff }),
  );
  group.add(fuselage);

  const wingMat = new MeshStandardMaterial({ color: 0x2266cc });
  for (const s of config.surfaces) {
    if (s.name === 'wing-left' || s.name === 'wing-right') {
      const wing = new Mesh(new BoxGeometry(3, 0.1, 1.2), wingMat);
      wing.position.copy(s.position);
      group.add(wing);
    } else if (s.name === 'h-stab') {
      const tail = new Mesh(new BoxGeometry(2, 0.1, 0.6), wingMat);
      tail.position.copy(s.position);
      group.add(tail);
    } else if (s.name === 'v-stab') {
      const fin = new Mesh(new BoxGeometry(0.1, 1, 0.6), wingMat);
      fin.position.copy(s.position);
      group.add(fin);
    }
  }
  return group;
}

export interface AircraftCreateOptions extends AircraftBodyCreateOptions {
  /** If true, attach a placeholder mesh to the supplied scene. Default true. */
  attachMesh?: boolean;
}

export class Aircraft extends AircraftBody {
  readonly mesh: Group;

  constructor(world: RAPIER.World, config: AircraftConfig, opts: AircraftCreateOptions = {}) {
    super(world, config, opts);
    this.mesh = buildPlaceholderMesh(config);
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
