import { describe, it, expect, beforeEach } from 'vitest';
import { PerspectiveCamera, Vector3, Quaternion } from 'three';
import { CameraController, CameraMode } from './camera';

const ORIGIN = new Vector3(0, 0, 0);
const IDENTITY = new Quaternion();
const DT = 1 / 60;

describe('CameraController', () => {
  let camera: PerspectiveCamera;
  let ctrl: CameraController;

  beforeEach(() => {
    camera = new PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 0, 0);
    ctrl = new CameraController(camera);
  });

  it('starts in Chase mode', () => {
    expect(ctrl.activeMode).toBe(CameraMode.Chase);
  });

  it('setMode switches to Cockpit and back', () => {
    ctrl.setMode(CameraMode.Cockpit);
    expect(ctrl.activeMode).toBe(CameraMode.Cockpit);
    ctrl.setMode(CameraMode.Chase);
    expect(ctrl.activeMode).toBe(CameraMode.Chase);
  });

  it('chase mode moves camera closer to desired position after one update', () => {
    // Target at origin; default chaseOffset is (0,3,8) so desired = (0,3,8)
    // Camera starts at (0,0,0) — far from desired
    const before = camera.position.distanceTo(new Vector3(0, 3, 8));
    ctrl.update(ORIGIN, IDENTITY, DT);
    const after = camera.position.distanceTo(new Vector3(0, 3, 8));
    expect(after).toBeLessThan(before);
  });

  it('chase mode does not snap to desired in one frame (lerp, not teleport)', () => {
    ctrl.update(ORIGIN, IDENTITY, DT);
    // Should not have jumped all the way to (0,3,8) in a single 1/60s step
    expect(camera.position.distanceTo(new Vector3(0, 3, 8))).toBeGreaterThan(0.01);
  });

  it('cockpit mode snaps camera exactly to target + offset (no lerp)', () => {
    ctrl.setMode(CameraMode.Cockpit);
    const target = new Vector3(10, 5, 3);
    ctrl.update(target, IDENTITY, DT);
    // With identity quaternion, cockpit offset (0,0.3,0) stays local = world
    expect(camera.position.x).toBeCloseTo(10);
    expect(camera.position.y).toBeCloseTo(5.3);
    expect(camera.position.z).toBeCloseTo(3);
  });

  it('cockpit mode copies target quaternion exactly', () => {
    ctrl.setMode(CameraMode.Cockpit);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    ctrl.update(ORIGIN, q, DT);
    expect(camera.quaternion.x).toBeCloseTo(q.x);
    expect(camera.quaternion.y).toBeCloseTo(q.y);
    expect(camera.quaternion.z).toBeCloseTo(q.z);
    expect(camera.quaternion.w).toBeCloseTo(q.w);
  });

  it('chase offset rotates with target orientation (camera stays behind rotated target)', () => {
    // Rotate target 180° around Y — offset (0,3,8) in local space should become (0,3,-8) in world
    const q180y = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    // Run enough frames for camera to converge close to desired
    for (let i = 0; i < 120; i++) ctrl.update(ORIGIN, q180y, DT);
    // Desired world position: origin + (0,3,8) rotated 180° around Y = (0,3,-8)
    expect(camera.position.z).toBeLessThan(0); // must be behind, not in front
    expect(camera.position.distanceTo(new Vector3(0, 3, -8))).toBeLessThan(0.1);
  });
});
