import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { AircraftConfig } from './config';
import type { BodyState } from './aerosurface';
import type { Vec3Plain } from './state';

// Framework-agnostic Rapier wrapper for the aircraft body. Owns the rigid body
// + collider + per-call BodyState scratch. Runnable in Node (used by the
// WP14.7 harness) — uses only Rapier and Three's pure-math classes (Vector3,
// Quaternion). The browser-side `Aircraft` (in `../rigidbody.ts`) extends this
// to add Three.js scene-graph mesh ownership.

export interface AircraftBodyCreateOptions {
  /** Initial position in world frame. */
  position?: Vector3;
  /** Initial linear velocity in world frame. */
  linvel?: Vector3;
}

const _identityRot = { x: 0, y: 0, z: 0, w: 1 };

export class AircraftBody {
  readonly body: RAPIER.RigidBody;
  readonly config: AircraftConfig;

  private readonly _state: BodyState = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    linvel: new Vector3(),
    angvel: new Vector3(),
  };

  constructor(world: RAPIER.World, config: AircraftConfig, opts: AircraftBodyCreateOptions = {}) {
    this.config = config;
    const pos = opts.position ?? new Vector3(0, 0, 0);
    const linvel = opts.linvel ?? new Vector3(0, 0, 0);

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(linvel.x, linvel.y, linvel.z)
      .setAdditionalMassProperties(
        config.mass,
        { x: 0, y: 0, z: 0 },
        { x: config.inertia.x, y: config.inertia.y, z: config.inertia.z },
        _identityRot,
      );

    this.body = world.createRigidBody(desc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.3, 3.0).setDensity(0);
    world.createCollider(colliderDesc, this.body);
  }

  readBodyState(out: BodyState = this._state): BodyState {
    const t = this.body.translation();
    const r = this.body.rotation();
    const lv = this.body.linvel();
    const av = this.body.angvel();
    out.position.set(t.x, t.y, t.z);
    out.quaternion.set(r.x, r.y, r.z, r.w);
    out.linvel.set(lv.x, lv.y, lv.z);
    out.angvel.set(av.x, av.y, av.z);
    return out;
  }

  get bodyState(): BodyState {
    return this._state;
  }

  reset(position: Vec3Plain, linvel: Vec3Plain): void {
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.setRotation(_identityRot, true);
    this.body.setLinvel({ x: linvel.x, y: linvel.y, z: linvel.z }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  setMassProperties(mass: number, inertia: Vector3): void {
    this.body.setAdditionalMassProperties(
      mass,
      { x: 0, y: 0, z: 0 },
      { x: inertia.x, y: inertia.y, z: inertia.z },
      _identityRot,
      true,
    );
  }
}
