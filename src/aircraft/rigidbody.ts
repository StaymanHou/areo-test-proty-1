import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { AircraftConfig } from './config';
import type { BodyState } from './aerosurface';

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

export interface AircraftCreateOptions {
  /** Initial position in world frame. */
  position?: Vector3;
  /** Initial linear velocity in world frame. */
  linvel?: Vector3;
  /** If true, attach a placeholder mesh to the supplied scene. Default true. */
  attachMesh?: boolean;
}

const _identityRot = { x: 0, y: 0, z: 0, w: 1 };

export class Aircraft {
  readonly body: RAPIER.RigidBody;
  readonly mesh: Group;
  readonly config: AircraftConfig;

  // Reusable BodyState scratch — caller of getBodyState() reads this. Single
  // owner (the FlightModel) so reuse is safe.
  private readonly _state: BodyState = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    linvel: new Vector3(),
    angvel: new Vector3(),
  };

  constructor(world: RAPIER.World, config: AircraftConfig, opts: AircraftCreateOptions = {}) {
    this.config = config;
    const pos = opts.position ?? new Vector3(0, 0, 0);
    const linvel = opts.linvel ?? new Vector3(0, 0, 0);

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(linvel.x, linvel.y, linvel.z)
      // Mass + principal inertia in one call. `_identityRot` aligns inertia
      // tensor with the body axes (symmetric airframe assumption).
      .setAdditionalMassProperties(
        config.mass,
        { x: 0, y: 0, z: 0 },
        { x: config.inertia.x, y: config.inertia.y, z: config.inertia.z },
        _identityRot,
      );

    this.body = world.createRigidBody(desc);

    // Fuselage-shaped collider matching the visual placeholder (BoxGeometry(1, 0.6, 6)).
    // setDensity(0) keeps the body's configured mass authoritative — the collider would
    // otherwise add its auto-computed mass on top of setAdditionalMassProperties.
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.3, 3.0).setDensity(0);
    world.createCollider(colliderDesc, this.body);

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

  /** Fill the supplied BodyState from the Rapier body. Returns the same object for chaining. */
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

  /** Convenience: shared scratch state. Reused across calls — copy if retaining. */
  get bodyState(): BodyState {
    return this._state;
  }

  /**
   * Live-tuning entry point: replace the body's additional mass + principal
   * inertia. Wakes the body if it was sleeping.
   *
   * Call from GUI-event handlers, never the per-tick hot path.
   */
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

export function attachAircraftToScene(aircraft: Aircraft, scene: Scene): void {
  scene.add(aircraft.mesh);
}
