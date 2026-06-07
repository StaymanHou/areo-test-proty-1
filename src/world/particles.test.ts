import { describe, it, expect, beforeEach } from 'vitest';
import {
  emit,
  update,
  getActiveCount,
  getSnapshot,
  resetParticles,
  _resetParticlesForTests,
  PARTICLE_POOL_SIZE,
} from './particles';

beforeEach(() => {
  _resetParticlesForTests();
});

describe('particles — emit + lifecycle', () => {
  it('starts with zero active particles', () => {
    expect(getActiveCount()).toBe(0);
  });

  it('emit("muzzle-flash") activates 8 particles by default', () => {
    emit('muzzle-flash', 0, 0, 0);
    expect(getActiveCount()).toBe(8);
  });

  it('emit("impact") activates 16 particles by default', () => {
    emit('impact', 0, 0, 0);
    expect(getActiveCount()).toBe(16);
  });

  it('emit("ground-dust") activates 24 particles by default', () => {
    emit('ground-dust', 0, 0, 0);
    expect(getActiveCount()).toBe(24);
  });

  it('emitted particles start at the supplied position', () => {
    emit('muzzle-flash', 10, 20, 30);
    const snap = getSnapshot().filter((p) => p.active);
    for (const p of snap) {
      expect(p.position.x).toBe(10);
      expect(p.position.y).toBe(20);
      expect(p.position.z).toBe(30);
    }
  });

  it('emitted muzzle-flash particles get the warm-yellow color and short life', () => {
    emit('muzzle-flash', 0, 0, 0);
    const snap = getSnapshot().filter((p) => p.active);
    for (const p of snap) {
      expect(p.kind).toBe('muzzle-flash');
      expect(p.lifeSec).toBeCloseTo(0.15, 3);
      expect(p.color.r).toBeGreaterThan(0.9);
      expect(p.color.g).toBeGreaterThan(0.7);
      expect(p.color.b).toBeLessThan(0.6);
    }
  });

  it('emitted impact particles get the hot-orange color', () => {
    emit('impact', 0, 0, 0);
    const snap = getSnapshot().filter((p) => p.active);
    expect(snap[0]!.kind).toBe('impact');
    expect(snap[0]!.color.r).toBeGreaterThan(0.9);
    expect(snap[0]!.color.g).toBeLessThan(0.7);
    expect(snap[0]!.color.b).toBeLessThan(0.4);
  });

  it('ground-dust particles get nonzero gravity (half-gravity)', () => {
    emit('ground-dust', 0, 0, 0);
    const snap = getSnapshot().filter((p) => p.active);
    for (const p of snap) {
      expect(p.kind).toBe('ground-dust');
      expect(p.gravity).toBeGreaterThan(0);
    }
  });

  it('non-dust particles have zero gravity', () => {
    emit('muzzle-flash', 0, 0, 0);
    emit('impact', 5, 5, 5);
    const snap = getSnapshot().filter((p) => p.active);
    for (const p of snap) {
      expect(p.gravity).toBe(0);
    }
  });
});

describe('particles — update + deactivation', () => {
  it('update advances particle positions by velocity * dt', () => {
    emit('muzzle-flash', 0, 0, 0);
    const before = getSnapshot().filter((p) => p.active)[0]!;
    const initialPos = { ...before.position };
    const initialVel = { ...before.velocity };
    update(0.05);
    const after = getSnapshot().filter((p) => p.active)[0]!;
    // After one tick the position should have advanced — at least one axis
    // moved (the unit-direction velocity is nonzero in at least one component).
    const moved = Math.abs(after.position.x - initialPos.x)
      + Math.abs(after.position.y - initialPos.y)
      + Math.abs(after.position.z - initialPos.z);
    expect(moved).toBeGreaterThan(0);
    // Velocity decays from drag (Math.pow(0.85, 0.05) ≈ 0.992 → slightly less).
    expect(Math.abs(after.velocity.x)).toBeLessThanOrEqual(Math.abs(initialVel.x) + 1e-6);
  });

  it('particles deactivate after their lifeSec elapses', () => {
    emit('muzzle-flash', 0, 0, 0); // life = 0.15s
    expect(getActiveCount()).toBe(8);
    update(0.2);
    expect(getActiveCount()).toBe(0);
  });

  it('impact particles last longer than muzzle-flash (0.4s vs 0.15s)', () => {
    emit('muzzle-flash', 0, 0, 0);
    emit('impact', 1, 0, 0);
    update(0.2); // kills muzzle-flash (0.15s life) but not impact (0.4s life)
    const stillActive = getSnapshot().filter((p) => p.active);
    for (const p of stillActive) {
      expect(p.kind).toBe('impact');
    }
    expect(stillActive.length).toBe(16);
  });

  it('update applies gravity to ground-dust velocity', () => {
    emit('ground-dust', 0, 100, 0); // high y so dust doesn't escape its life
    const before = getSnapshot().filter((p) => p.active)[0]!;
    const initialVy = before.velocity.y;
    update(0.05);
    const after = getSnapshot().filter((p) => p.active)[0]!;
    // -9.8 * 0.5 * 0.05 = -0.245 m/s applied each tick (then drag-scaled).
    // After one tick vy should be at most slightly less than initialVy.
    expect(after.velocity.y).toBeLessThan(initialVy);
  });
});

describe('particles — pool exhaustion + reset', () => {
  it('emit silently drops when pool is full', () => {
    // 24 dust + 24 dust + ... fills the pool quickly. PARTICLE_POOL_SIZE = 256.
    for (let i = 0; i < 20; i++) {
      emit('ground-dust', 0, 0, 0);
    }
    expect(getActiveCount()).toBe(PARTICLE_POOL_SIZE); // capped at pool size
    // Further emit should not throw and should not increase count.
    expect(() => emit('muzzle-flash', 0, 0, 0)).not.toThrow();
    expect(getActiveCount()).toBe(PARTICLE_POOL_SIZE);
  });

  it('resetParticles deactivates all particles', () => {
    emit('muzzle-flash', 0, 0, 0);
    emit('impact', 0, 0, 0);
    expect(getActiveCount()).toBeGreaterThan(0);
    resetParticles();
    expect(getActiveCount()).toBe(0);
  });

  it('getSnapshot returns a deep copy (mutations do not affect live state)', () => {
    emit('muzzle-flash', 0, 0, 0);
    const snap = getSnapshot();
    const activeIdx = snap.findIndex((p) => p.active);
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    snap[activeIdx]!.position.x = 999;
    snap[activeIdx]!.color.r = 0;
    // Live snapshot should still show the original values.
    const liveSnap = getSnapshot();
    expect(liveSnap[activeIdx]!.position.x).not.toBe(999);
    expect(liveSnap[activeIdx]!.color.r).toBeGreaterThan(0.9);
  });

  it('_resetParticlesForTests also reseeds the deterministic RNG (re-emit at same position is identical)', () => {
    emit('muzzle-flash', 0, 0, 0);
    const snap1 = getSnapshot().filter((p) => p.active).map((p) => ({ ...p.velocity }));
    _resetParticlesForTests();
    emit('muzzle-flash', 0, 0, 0);
    const snap2 = getSnapshot().filter((p) => p.active).map((p) => ({ ...p.velocity }));
    expect(snap1).toEqual(snap2);
  });

  it('countOverride limits the burst size', () => {
    emit('impact', 0, 0, 0, { countOverride: 4 });
    expect(getActiveCount()).toBe(4);
  });
});
