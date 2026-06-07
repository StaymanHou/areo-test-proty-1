import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  Scene,
} from 'three';

// WP20 Phase 3 — CPU-side particle system. Single shared Points mesh + per-
// particle attributes (position, color, life). Kind-tagged emit API. Per-tick
// mutable singleton state — see CLAUDE.md "Per-tick mutable state" rule for
// the debug-accessor + reset-for-tests contract.

export type ParticleKind = 'muzzle-flash' | 'impact' | 'ground-dust';

export interface Particle {
  active: boolean;
  kind: ParticleKind;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  ageSec: number;
  lifeSec: number;
  // Initial color — alpha is computed from age/life ratio at update time.
  color: { r: number; g: number; b: number };
  size: number;
  /** Per-tick gravity multiplier (0 = no gravity, 1 = full -9.8 m/s²). */
  gravity: number;
}

export const PARTICLE_POOL_SIZE = 256;
const GRAVITY = -9.8;

interface ParticleSystem {
  particles: Particle[];
  geometry: BufferGeometry | null;
  points: Points | null;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  mounted: boolean;
}

function makeParticle(): Particle {
  return {
    active: false,
    kind: 'muzzle-flash',
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    ageSec: 0,
    lifeSec: 0,
    color: { r: 1, g: 1, b: 1 },
    size: 1,
    gravity: 0,
  };
}

let system: ParticleSystem = {
  particles: Array.from({ length: PARTICLE_POOL_SIZE }, makeParticle),
  geometry: null,
  points: null,
  positions: new Float32Array(PARTICLE_POOL_SIZE * 3),
  colors: new Float32Array(PARTICLE_POOL_SIZE * 3),
  sizes: new Float32Array(PARTICLE_POOL_SIZE),
  mounted: false,
};

/** Deterministic small RNG so unit tests can assert specific particle states. */
let rngState = 0x12345678;
function rng(): number {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function findInactiveSlot(): number {
  for (let i = 0; i < system.particles.length; i++) {
    if (!system.particles[i]!.active) return i;
  }
  return -1;
}

function activate(
  p: Particle,
  kind: ParticleKind,
  px: number,
  py: number,
  pz: number,
  vx: number,
  vy: number,
  vz: number,
  lifeSec: number,
  color: { r: number; g: number; b: number },
  size: number,
  gravity: number,
): void {
  p.active = true;
  p.kind = kind;
  p.position.x = px;
  p.position.y = py;
  p.position.z = pz;
  p.velocity.x = vx;
  p.velocity.y = vy;
  p.velocity.z = vz;
  p.ageSec = 0;
  p.lifeSec = lifeSec;
  p.color.r = color.r;
  p.color.g = color.g;
  p.color.b = color.b;
  p.size = size;
  p.gravity = gravity;
}

export interface EmitOptions {
  /** Override the kind defaults for unit-test determinism. Optional. */
  countOverride?: number;
}

/**
 * Emit a kind-tagged particle burst at the given world position. Allocation-
 * free — reuses pool slots. If the pool is full, the burst silently drops.
 */
export function emit(
  kind: ParticleKind,
  px: number,
  py: number,
  pz: number,
  opts: EmitOptions = {},
): void {
  let count: number;
  let life: number;
  let color: { r: number; g: number; b: number };
  let size: number;
  let gravity: number;
  let speed: number;
  let hemispherical: boolean;

  switch (kind) {
    case 'muzzle-flash':
      count = opts.countOverride ?? 8;
      life = 0.15;
      color = { r: 1.0, g: 0.86, b: 0.39 }; // warm yellow ≈ (255, 220, 100)
      size = 2.0;
      gravity = 0;
      speed = 4;
      hemispherical = false;
      break;
    case 'impact':
      count = opts.countOverride ?? 16;
      life = 0.4;
      color = { r: 1.0, g: 0.55, b: 0.2 }; // hot orange ≈ (255, 140, 50)
      size = 1.2;
      gravity = 0;
      speed = 8;
      hemispherical = false;
      break;
    case 'ground-dust':
      count = opts.countOverride ?? 24;
      life = 0.8;
      color = { r: 0.55, g: 0.43, b: 0.31 }; // brown-grey ≈ (140, 110, 80)
      size = 1.6;
      gravity = 0.5; // half-gravity for floatier feel
      speed = 5;
      hemispherical = true;
      break;
  }

  for (let i = 0; i < count; i++) {
    const slot = findInactiveSlot();
    if (slot === -1) return; // pool exhausted
    const p = system.particles[slot]!;
    // Random unit direction (or hemispherical-up for dust).
    const theta = rng() * Math.PI * 2;
    const phi = hemispherical ? rng() * Math.PI * 0.5 : (rng() - 0.5) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const dx = Math.cos(theta) * cosPhi;
    const dy = sinPhi;
    const dz = Math.sin(theta) * cosPhi;
    const v = speed * (0.6 + rng() * 0.4);
    activate(p, kind, px, py, pz, dx * v, dy * v, dz * v, life, color, size, gravity);
  }
}

/**
 * Advance particles by `dt`. Updates position, age, and writes positions +
 * colors into the buffer attributes. Marks attributes `needsUpdate`. Safe to
 * call before `mount()` (will skip buffer writes if geometry is null).
 */
export function update(dtSec: number): void {
  for (let i = 0; i < system.particles.length; i++) {
    const p = system.particles[i]!;
    if (!p.active) continue;
    p.position.x += p.velocity.x * dtSec;
    p.position.y += p.velocity.y * dtSec;
    p.position.z += p.velocity.z * dtSec;
    if (p.gravity !== 0) p.velocity.y += GRAVITY * p.gravity * dtSec;
    // Simple drag decay so streaks don't fly forever.
    const dragFactor = Math.pow(0.85, dtSec);
    p.velocity.x *= dragFactor;
    p.velocity.y *= dragFactor;
    p.velocity.z *= dragFactor;
    p.ageSec += dtSec;
    if (p.ageSec >= p.lifeSec) p.active = false;
  }

  if (!system.geometry) return;

  // Write all 256 slots to the buffer — inactive get size=0 (collapsed) so
  // they don't render.
  const positions = system.positions;
  const colors = system.colors;
  const sizes = system.sizes;
  for (let i = 0; i < system.particles.length; i++) {
    const p = system.particles[i]!;
    const i3 = i * 3;
    positions[i3] = p.position.x;
    positions[i3 + 1] = p.position.y;
    positions[i3 + 2] = p.position.z;
    if (p.active) {
      const alpha = Math.max(0, 1 - p.ageSec / p.lifeSec);
      colors[i3] = p.color.r * alpha;
      colors[i3 + 1] = p.color.g * alpha;
      colors[i3 + 2] = p.color.b * alpha;
      sizes[i] = p.size;
    } else {
      colors[i3] = 0;
      colors[i3 + 1] = 0;
      colors[i3 + 2] = 0;
      sizes[i] = 0;
    }
  }
  (system.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  (system.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
}

/**
 * Build the shared Points mesh and add it to the scene. Idempotent — calling
 * twice is a no-op (does not double-mount).
 */
export function mount(scene: Scene): void {
  if (system.mounted) return;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(system.positions, 3));
  geometry.setAttribute('color', new BufferAttribute(system.colors, 3));
  const material = new PointsMaterial({
    size: 0.6,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  // Render-after-opaque hint; particles are additive so depthWrite=false above
  // is the load-bearing setting.
  points.renderOrder = 999;
  scene.add(points);
  system.geometry = geometry;
  system.points = points;
  system.mounted = true;
  // Silence unused-import if PointsMaterial was the only Color consumer.
  void Color;
}

/** Count currently-active particles. Used by debug accessor + unit tests. */
export function getActiveCount(): number {
  let n = 0;
  for (let i = 0; i < system.particles.length; i++) {
    if (system.particles[i]!.active) n++;
  }
  return n;
}

/** Deep-copy snapshot of all particle state — for debug accessor reads. */
export function getSnapshot(): Particle[] {
  return system.particles.map((p) => ({
    active: p.active,
    kind: p.kind,
    position: { ...p.position },
    velocity: { ...p.velocity },
    ageSec: p.ageSec,
    lifeSec: p.lifeSec,
    color: { ...p.color },
    size: p.size,
    gravity: p.gravity,
  }));
}

/** Reset all particles to inactive baseline. Preserves object identity. */
export function resetParticles(): void {
  for (let i = 0; i < system.particles.length; i++) {
    const p = system.particles[i]!;
    p.active = false;
    p.ageSec = 0;
    p.lifeSec = 0;
  }
  rngState = 0x12345678;
}

/** Test-only: reset state to a clean baseline. */
export function _resetParticlesForTests(): void {
  resetParticles();
  // Drop the Points mesh too so a re-mount in a different test scene works.
  system.geometry = null;
  system.points = null;
  system.mounted = false;
}
