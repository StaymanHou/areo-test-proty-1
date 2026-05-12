import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Aircraft } from './rigidbody';
import { parseAircraftConfig, type AircraftConfig } from './config';

const baselineRaw = () => ({
  mass: 1000,
  inertia: { x: 1500, y: 3000, z: 1500 },
  thrust: { maxN: 6000 },
  surfaces: [
    {
      name: 'wing-left',
      position: { x: -2, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 6,
      curve: 'symmetric-flat-plate',
    },
    {
      name: 'wing-right',
      position: { x: 2, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 6,
      curve: 'symmetric-flat-plate',
    },
    {
      name: 'h-stab',
      position: { x: 0, y: 0, z: 3 },
      normal: { x: 0, y: 1, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 1.5,
      curve: 'symmetric-flat-plate',
    },
    {
      name: 'v-stab',
      position: { x: 0, y: 0.5, z: 3 },
      normal: { x: 1, y: 0, z: 0 },
      chord: { x: 0, y: 0, z: -1 },
      area: 1,
      curve: 'symmetric-flat-plate',
    },
  ],
});

let config: AircraftConfig;

beforeAll(async () => {
  await RAPIER.init();
  config = parseAircraftConfig(baselineRaw());
});

describe('Aircraft (rigidbody)', () => {
  it('creates a Rapier dynamic body at the requested position with the requested linvel', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 50, 0),
      linvel: new Vector3(0, 0, -30),
    });
    const t = aircraft.body.translation();
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(50);
    expect(t.z).toBeCloseTo(0);
    const lv = aircraft.body.linvel();
    expect(lv.z).toBeCloseTo(-30);
  });

  it('builds a placeholder mesh group with one fuselage + four surface meshes', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config);
    // 1 fuselage + 4 surfaces (wing-L, wing-R, h-stab, v-stab) = 5 children
    expect(aircraft.mesh.children).toHaveLength(5);
  });

  // Regression anchor for SURFACE-2026-05-11-05 (WP9 Phase 3): the body must
  // carry a collider so it impacts terrain instead of tunneling through. The
  // earlier bug was a structural omission, not a behavioral one — assert the
  // invariant directly.
  it('attaches at least one collider to the body so it can interact with terrain', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config);
    expect(aircraft.body.numColliders()).toBeGreaterThan(0);
  });

  // Behavioral regression anchor for SURFACE-2026-05-11-05: aircraft impacts a
  // ground collider rather than tunneling through. Mirrors the WP9.5 verify-self
  // targeted probe (teleport to y=3 with vy=-10, expect impact + bounded resting).
  it('aircraft body collides with a static ground plane (does not tunnel through)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;

    // Static ground collider at y=0, large enough that the aircraft cannot miss it.
    const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, -0.1, 0),
      groundBody,
    );

    const aircraft = new Aircraft(world, config, {
      position: new Vector3(0, 3, 0),
      linvel: new Vector3(0, -10, 0),
    });

    // Step the world for ~1 second of simulated time (60 ticks at 1/60s).
    for (let i = 0; i < 60; i++) {
      world.step();
    }

    const t = aircraft.body.translation();
    // Post-impact: y must be > 0 (above ground; the body settled or bounced).
    // Pre-fix this would have been a large negative number as the body tunneled.
    expect(Number.isFinite(t.y)).toBe(true);
    expect(t.y).toBeGreaterThan(0);
    // Generous upper bound: physically the bounce can't lift the body above its
    // initial drop height (energy conservation with restitution ≤ 1).
    expect(t.y).toBeLessThan(10);
  });

  it('syncMesh copies body translation + rotation to the Three.js mesh', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(10, 20, 30),
    });
    aircraft.syncMesh();
    expect(aircraft.mesh.position.x).toBeCloseTo(10);
    expect(aircraft.mesh.position.y).toBeCloseTo(20);
    expect(aircraft.mesh.position.z).toBeCloseTo(30);
  });

  it('readBodyState reflects current Rapier body state', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(1, 2, 3),
      linvel: new Vector3(4, 5, 6),
    });
    const state = aircraft.readBodyState();
    expect(state.position.x).toBeCloseTo(1);
    expect(state.position.y).toBeCloseTo(2);
    expect(state.position.z).toBeCloseTo(3);
    expect(state.linvel.x).toBeCloseTo(4);
    expect(state.linvel.y).toBeCloseTo(5);
    expect(state.linvel.z).toBeCloseTo(6);
  });

  it('mass + inertia from config show up in the physics simulation', () => {
    // Apply a known force, step once, check the resulting acceleration.
    // F = m·a → a = F/m. With m=1000 and F=10000 N along +X, a = 10 m/s² over dt=1/60s = ~0.167 m/s velocity.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // zero gravity for clean math
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config);
    aircraft.body.addForce({ x: 10000, y: 0, z: 0 }, true);
    world.step();
    const lv = aircraft.body.linvel();
    // Expected: F·dt/m = 10000 * (1/60) / 1000 = 0.16667 m/s
    expect(lv.x).toBeCloseTo(10000 / 60 / 1000, 3);
  });

  it('setMassProperties updates body mass observed via body.mass() (after step)', () => {
    // Note: body.mass() reflects total mass after the next physics step (per
    // Rapier docs). We step once to settle, then change, step again, and read.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config);
    world.step();
    // Rapier stores mass as f32 — relative precision ≈ 1e-6, absolute slack
    // around 1e-3 at mass~1000, ~3e-3 at mass~2500.
    expect(aircraft.body.mass()).toBeCloseTo(1000, 2);
    aircraft.setMassProperties(2500, new Vector3(4000, 8000, 4000));
    world.step();
    expect(aircraft.body.mass()).toBeCloseTo(2500, 2);
  });

  it('setMassProperties is idempotent', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config);
    aircraft.setMassProperties(1500, new Vector3(2000, 4000, 2000));
    world.step();
    const m1 = aircraft.body.mass();
    aircraft.setMassProperties(1500, new Vector3(2000, 4000, 2000));
    world.step();
    const m2 = aircraft.body.mass();
    expect(m1).toBeCloseTo(1500, 2);
    expect(m2).toBe(m1);
  });

  it('setMassProperties affects observed acceleration under a fixed force', () => {
    // F = m·a — doubling mass should halve the acceleration.
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    world.timestep = 1 / 60;
    const aircraft = new Aircraft(world, config);
    aircraft.setMassProperties(2000, new Vector3(3000, 6000, 3000));
    aircraft.body.addForce({ x: 10000, y: 0, z: 0 }, true);
    world.step();
    const lv = aircraft.body.linvel();
    // Expected: F·dt/m = 10000 * (1/60) / 2000 = 0.0833 m/s
    expect(lv.x).toBeCloseTo(10000 / 60 / 2000, 3);
  });

  it('setMassProperties wakes a sleeping body', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    aircraft.body.sleep();
    expect(aircraft.body.isSleeping()).toBe(true);
    aircraft.setMassProperties(1500, new Vector3(2000, 4000, 2000));
    expect(aircraft.body.isSleeping()).toBe(false);
  });
});

describe('Aircraft — WP11: reset() for mission restart', () => {
  it('teleports body to the supplied position', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const aircraft = new Aircraft(world, config, {
      position: new Vector3(100, 200, -50),
      linvel: new Vector3(1, 2, 3),
    });
    aircraft.reset({ x: 0, y: 50, z: 0 }, { x: 0, y: 0, z: -30 });
    const t = aircraft.body.translation();
    expect(t.x).toBe(0);
    expect(t.y).toBe(50);
    expect(t.z).toBe(0);
  });

  it('sets linear velocity to the supplied value', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    aircraft.reset({ x: 0, y: 50, z: 0 }, { x: 5, y: -2, z: -30 });
    const lv = aircraft.body.linvel();
    expect(lv.x).toBe(5);
    expect(lv.y).toBe(-2);
    expect(lv.z).toBe(-30);
  });

  it('zeros angular velocity', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    aircraft.body.setAngvel({ x: 1, y: 2, z: 3 }, true);
    aircraft.reset({ x: 0, y: 50, z: 0 }, { x: 0, y: 0, z: -30 });
    const av = aircraft.body.angvel();
    expect(av.x).toBe(0);
    expect(av.y).toBe(0);
    expect(av.z).toBe(0);
  });

  it('resets rotation to identity', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    // Rotate the body to a non-identity quaternion (90° about X — nose up).
    aircraft.body.setRotation(
      { x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) },
      true,
    );
    aircraft.reset({ x: 0, y: 50, z: 0 }, { x: 0, y: 0, z: -30 });
    const r = aircraft.body.rotation();
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.z).toBe(0);
    expect(r.w).toBe(1);
  });

  it('does not add additional colliders (no aircraft-state leakage on restart)', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const aircraft = new Aircraft(world, config);
    const colliderCountBefore = aircraft.body.numColliders();
    aircraft.reset({ x: 0, y: 50, z: 0 }, { x: 0, y: 0, z: -30 });
    expect(aircraft.body.numColliders()).toBe(colliderCountBefore);
  });
});
