import { PerspectiveCamera, Vector3, Quaternion } from 'three';

export const CameraMode = {
  Chase: 'Chase',
  Cockpit: 'Cockpit',
} as const;

export type CameraMode = (typeof CameraMode)[keyof typeof CameraMode];

export interface CameraOptions {
  chaseOffset?: Vector3;
  chaseDamping?: number;
  fov?: number;
}

export class CameraController {
  private readonly camera: PerspectiveCamera;
  private readonly chaseOffset: Vector3;
  private readonly chaseDamping: number;
  private mode: CameraMode = CameraMode.Chase as CameraMode;

  // Reusable scratch objects — avoids per-frame allocation
  private readonly _desired = new Vector3();
  private readonly _cockpitOffset = new Vector3();
  private readonly _chaseUp = new Vector3();

  constructor(camera: PerspectiveCamera, options: CameraOptions = {}) {
    this.camera = camera;
    this.chaseOffset = options.chaseOffset ?? new Vector3(0, 3, 8);
    this.chaseDamping = options.chaseDamping ?? 0.1;
    if (options.fov !== undefined) {
      this.camera.fov = options.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  get activeMode(): CameraMode {
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  update(targetPosition: Vector3, targetQuaternion: Quaternion, dt: number): void {
    if (this.mode === CameraMode.Chase) {
      this._updateChase(targetPosition, targetQuaternion, dt);
    } else {
      this._updateCockpit(targetPosition, targetQuaternion);
    }
  }

  private _updateChase(targetPosition: Vector3, targetQuaternion: Quaternion, dt: number): void {
    // Desired = target position + offset rotated into target's local frame
    this._desired.copy(this.chaseOffset).applyQuaternion(targetQuaternion).add(targetPosition);

    // Exponential-decay lerp — frame-rate independent
    const alpha = 1 - Math.exp(-this.chaseDamping * 60 * dt);
    this.camera.position.lerp(this._desired, alpha);

    // Body-up rotated into world space — prevents lookAt's default world-+Y reference
    // from snapping the camera 180° when the aircraft inverts (gimbal lock).
    this._chaseUp.set(0, 1, 0).applyQuaternion(targetQuaternion);
    this.camera.up.copy(this._chaseUp);
    this.camera.lookAt(targetPosition);
  }

  private _updateCockpit(targetPosition: Vector3, targetQuaternion: Quaternion): void {
    // Sit slightly above the body origin in local space
    this._cockpitOffset.set(0, 0.3, 0).applyQuaternion(targetQuaternion);
    this.camera.position.copy(targetPosition).add(this._cockpitOffset);
    this.camera.quaternion.copy(targetQuaternion);
  }
}
