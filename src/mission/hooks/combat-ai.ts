// WP16 combat-ai hook — Phase 2 (player gun + projectile pool).
//
// The hook is the only WP16 entry into the mission runner per arch.md D11.
// `MissionRunner.tick` calls this once per physics tick BEFORE the objective
// evaluation pass, so any `destroy-target` ObjectiveState.completed flag we
// flip here is observed in the same tick (see runner.ts line 109-114).
//
// Phase 2 adds: gun input (Space), forward-firing projectile pool, despawn
// at range. Phase 3 layers the ground target + hit detection on top; Phase
// 4 adds the damage model + return-fire + combat HUD.
//
// State model:
//   - Per-mission state (CombatState) is module-level, NOT in the HookState
//     bag the runner provides. Reason: combat state is consumed by main.ts'
//     onRender (for projectile mesh sync) AND by window.__combat debug
//     accessors AND by tests. Routing through HookState would force the
//     runner to expose its private state — leaks layering.
//   - `resetCombatState()` is called by `registerCombatAi`'s start-mission
//     coupling (in main.ts on mission start). Tests call it directly via
//     `_resetCombatStateForTests`.
//   - The input provider is injected via `registerCombatAi(gunInputDown)` so
//     the hook is testable without a DOM `InputManager`. Production binds
//     to `() => input.isDown('Space')`.

import type { AircraftState } from '../../aircraft/physics-core/state';
import type { ObjectiveState } from '../types';
import { registerHook, type HookState } from './registry';

export const COMBAT_HOOK_NAME = 'combat-ai';

// Tunables — all in SI units. Phase 5 may adjust for casual difficulty;
// they live as module-level const so a Phase 5 tuning pass is a one-file edit
// (NOT in aircraft.json — combat tuning is not physics tuning per
// CLAUDE.md Rule #3 carve-out).
export const MUZZLE_SPEED = 600; // m/s — added to aircraft velocity at fire
export const MAX_RANGE = 1500; // m — despawn distance
export const ROF = 5; // rounds/sec
export const POOL_SIZE = 32;
// Phase 5 (P5.2) — tuned for casual difficulty: 3 hits to win.
export const TARGET_HP = 3;

// Phase 5 (P5.2) — target placement tuned for casual scripted approach:
// 600m forward of V_trim spawn. With the mig15 airframe (combat.json sets
// config:"mig15"), the cessna-like V_trim climb pattern is gone — the mig15
// dives + settles at ground level (y=0). To intersect that natural cruise
// corridor, target is at y=0 with tall halfExtents.y=8 (effective box height
// 16m — generous AABB that the level-cruising player intersects). Wide
// halfExtents.x/z=10 for casual aim tolerance. SURFACE-2026-06-07: this is a
// Phase 5 operator-as-external tuning deviation; re-validate at Phase 3
// playtest if/when ground-attack gameplay returns as a non-v1 goal.
export const TARGET_DEFAULT_POSITION: Vec3 = { x: 0, y: 0, z: -600 };
export const TARGET_DEFAULT_HALF_EXTENTS: Vec3 = { x: 10, y: 8, z: 10 };

// Phase 4 — return-fire tunables. Phase 5 (P5.2) — tuned for reachable loss
// path. RETURN_FIRE_SPEED bumped 200 → 400 m/s (still half the player's
// muzzle speed); RETURN_FIRE_ROF bumped 1 → 2/sec; lead shortened to 0.3s
// (long leads overshoot a slow-cruise V_trim player). PLAYER_HP reduced 10 →
// 6 so a 25s loiter under fire reliably ends in defeat (~6 hits / 25s × 2 ROF
// = ~12 shots — half of which need to land for the loss path).
export const PLAYER_HP = 6;
export const RETURN_FIRE_SPEED = 400; // m/s — fast enough to catch a fleeing player
export const RETURN_FIRE_ROF = 2; // rounds/sec — modest but lethal cumulatively
export const RETURN_FIRE_LEAD_SEC = 0.3;
export const RETURN_FIRE_POOL_SIZE = 16;
/** Player hitbox half-extents (AABB around aircraft.position). Phase 5 tuned 2 → 4 for casual hit tolerance. */
export const PLAYER_HALF_EXTENT = 4;

// Derived (used in stepProjectiles / tryFireGun).
const FIRE_COOLDOWN_SEC = 1 / ROF;
const MAX_LIFETIME_SEC = MAX_RANGE / MUZZLE_SPEED;
const RETURN_FIRE_COOLDOWN_SEC = 1 / RETURN_FIRE_ROF;
// Return-fire lifetime: enough to reach max engagement range at RETURN_FIRE_SPEED.
// 2000m / 200m/s = 10s; bounds the projectile lifetime so the pool recycles.
const RETURN_FIRE_MAX_LIFETIME_SEC = 10;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Projectile {
  active: boolean;
  position: Vec3;
  velocity: Vec3;
  ageSec: number;
}

export interface TargetState {
  position: Vec3;
  halfExtents: Vec3;
  hp: number;
  destroyed: boolean;
}

export interface CombatState {
  projectiles: Projectile[];
  /** Seconds remaining before the next shot can be fired. */
  fireCooldown: number;
  /** Per-tick counter — kept as a sanity check that the hook is invoked. */
  bootTick: number;
  /** Ground target — set by resetCombatState; mutated by checkProjectileHits. */
  target: TargetState;
  /** Phase 4 — player hitpoints; decremented by return-fire hits. */
  playerHp: number;
  /** Phase 4 — return-fire projectile pool + per-target cooldown. */
  returnFire: {
    cooldown: number;
    pool: Projectile[];
  };
}

function makeProjectile(): Projectile {
  return {
    active: false,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    ageSec: 0,
  };
}

function makeTarget(): TargetState {
  return {
    position: { ...TARGET_DEFAULT_POSITION },
    halfExtents: { ...TARGET_DEFAULT_HALF_EXTENTS },
    hp: TARGET_HP,
    destroyed: false,
  };
}

/**
 * Module-level singleton — see file header for why this isn't in the runner's
 * HookState bag. Reset by `resetCombatState()` on mission start.
 */
let combatState: CombatState = {
  projectiles: Array.from({ length: POOL_SIZE }, makeProjectile),
  fireCooldown: 0,
  bootTick: 0,
  target: makeTarget(),
  playerHp: PLAYER_HP,
  returnFire: {
    cooldown: RETURN_FIRE_COOLDOWN_SEC, // wait one cadence before first shot
    pool: Array.from({ length: RETURN_FIRE_POOL_SIZE }, makeProjectile),
  },
};

/** The provider returns true when the player is holding the gun trigger (Space in production). */
type GunInputProvider = () => boolean;
let gunInputDownFn: GunInputProvider = () => false;

/**
 * Callback invoked when the hook needs to fail the mission (e.g. playerHp=0).
 * Production binds to `() => missionRunner.setHookFailFlag('shot down')`. Tests
 * pass a controlled spy. Default no-op so unit tests for non-fail paths don't
 * need to provide one.
 */
type FailSignalCallback = (reason?: string) => void;
let failSignalFn: FailSignalCallback = () => {};

/**
 * WP19 — audio trigger callbacks. Fire on player gun discharge (tryFireGun)
 * and on projectile-hits-target (checkProjectileHits). Default no-ops so unit
 * tests not concerned with audio can ignore the wiring.
 *
 * WP20 Phase 3 widened the signature to pass the event position so visual
 * particle effects can emit at the right spot. Audio callbacks that don't
 * care about position just ignore the argument.
 */
type TriggerPos = { x: number; y: number; z: number };
type TriggerCallback = (pos: TriggerPos) => void;
let onFireFn: TriggerCallback = () => {};
let onImpactFn: TriggerCallback = () => {};

/** Returns the live combat state — used by main.ts onRender for mesh sync + window.__combat. */
export function getCombatState(): CombatState {
  return combatState;
}

/**
 * Reset the combat state to a fresh per-mission baseline. Reuses the existing
 * projectile object identities (keeps the pool allocation-free across resets).
 * Called by main.ts on `startMission`; tests call `_resetCombatStateForTests`.
 */
export function resetCombatState(): void {
  for (let i = 0; i < combatState.projectiles.length; i++) {
    const p = combatState.projectiles[i]!;
    p.active = false;
    p.position.x = 0;
    p.position.y = 0;
    p.position.z = 0;
    p.velocity.x = 0;
    p.velocity.y = 0;
    p.velocity.z = 0;
    p.ageSec = 0;
  }
  combatState.fireCooldown = 0;
  combatState.bootTick = 0;
  // Reset target in place — preserves object identity so external references
  // (e.g., debug accessors, render-side mesh sync if cached) stay valid.
  const t = combatState.target;
  t.position.x = TARGET_DEFAULT_POSITION.x;
  t.position.y = TARGET_DEFAULT_POSITION.y;
  t.position.z = TARGET_DEFAULT_POSITION.z;
  t.halfExtents.x = TARGET_DEFAULT_HALF_EXTENTS.x;
  t.halfExtents.y = TARGET_DEFAULT_HALF_EXTENTS.y;
  t.halfExtents.z = TARGET_DEFAULT_HALF_EXTENTS.z;
  t.hp = TARGET_HP;
  t.destroyed = false;
  // Phase 4 — reset player HP + return-fire pool (allocation-free; reuses
  // existing pool object identities).
  combatState.playerHp = PLAYER_HP;
  combatState.returnFire.cooldown = RETURN_FIRE_COOLDOWN_SEC;
  for (let i = 0; i < combatState.returnFire.pool.length; i++) {
    const p = combatState.returnFire.pool[i]!;
    p.active = false;
    p.position.x = 0;
    p.position.y = 0;
    p.position.z = 0;
    p.velocity.x = 0;
    p.velocity.y = 0;
    p.velocity.z = 0;
    p.ageSec = 0;
  }
}

/**
 * Rotate the body-forward vector (0, 0, -1) by the aircraft's world-quaternion
 * to produce the world-frame forward unit vector. Allocation-free; writes into
 * the provided `out` object. Pure-math — no Three.js dep at this layer.
 */
function bodyForwardToWorld(
  quat: { x: number; y: number; z: number; w: number },
  out: { x: number; y: number; z: number },
): void {
  // v' = q * v * q^-1 where v = (0, 0, -1). The closed-form for rotating
  // (0,0,-1) by quat (x,y,z,w) is:
  //   out.x = -2 * (x*z + w*y)
  //   out.y = -2 * (y*z - w*x)
  //   out.z = -(1 - 2*(x*x + y*y))
  const { x, y, z, w } = quat;
  out.x = -2 * (x * z + w * y);
  out.y = -2 * (y * z - w * x);
  out.z = -(1 - 2 * (x * x + y * y));
}

/**
 * Hook entry — runs once per physics tick before the runner's objective
 * evaluation pass. Allocation-free.
 */
export function combatAiHook(
  state: HookState,
  aircraft: AircraftState,
  objectives: readonly ObjectiveState[],
  dt: number,
): void {
  // Lazy-init a per-mission bootTick on the HookState bag (preserves the
  // Phase 1 contract that the hook is verifiably invoked). The combatState
  // singleton has its own bootTick used by tests.
  const t = (state.bootTick as number | undefined) ?? 0;
  state.bootTick = t + 1;
  combatState.bootTick++;

  // Cooldown decay — clamp at 0 to avoid negative drift accumulating.
  if (combatState.fireCooldown > 0) {
    combatState.fireCooldown -= dt;
    if (combatState.fireCooldown < 0) combatState.fireCooldown = 0;
  }

  // Fire the gun if (a) input held, (b) cooldown elapsed, (c) a slot is free.
  if (gunInputDownFn() && combatState.fireCooldown <= 0) {
    tryFireGun(aircraft);
  }

  // Step active projectiles forward; despawn beyond MAX_LIFETIME.
  stepProjectiles(dt);

  // Per-tick AABB sweep — projectile vs target. On the same tick a projectile
  // lands the killing hit, target.destroyed flips true AND the destroy-target
  // ObjectiveState.completed flag flips true; the runner's objective evaluator
  // observes it in the same tick (runner.ts:108-114).
  checkProjectileHits(objectives);

  // Phase 4 — return-fire: spawn aimed projectiles at the player while the
  // target is alive, integrate them, AABB-check against the player. On
  // playerHp <= 0 → failSignal('shot down') (runner observes in same tick's
  // fail-evaluation pass via setHookFailFlag).
  stepReturnFire(aircraft, dt);
  checkReturnFireHits(aircraft);
}

/**
 * Spawn a projectile at the aircraft's current position, traveling in the
 * aircraft's body-forward direction at MUZZLE_SPEED + aircraft linvel. The
 * aircraft-velocity addition keeps the gun "co-moving" with the platform —
 * a stationary muzzle in body frame becomes a forward-firing tracer in world
 * frame regardless of aircraft speed. Allocation-free.
 *
 * Exported for test isolation; production callers use combatAiHook.
 */
export function tryFireGun(aircraft: AircraftState): void {
  // Find the first inactive slot — linear scan over POOL_SIZE=32 is fine.
  let slot = -1;
  for (let i = 0; i < combatState.projectiles.length; i++) {
    if (!combatState.projectiles[i]!.active) {
      slot = i;
      break;
    }
  }
  if (slot === -1) {
    // Pool exhausted — silently drop the shot. Casual-gameplay scenario is
    // rare; tightening the pool is a Phase 5 tuning concern.
    return;
  }
  const p = combatState.projectiles[slot]!;
  // Forward unit in world frame.
  bodyForwardToWorld(aircraft.quaternion, p.velocity);
  // Scale to MUZZLE_SPEED, add aircraft velocity (co-moving muzzle).
  p.velocity.x = p.velocity.x * MUZZLE_SPEED + aircraft.linvel.x;
  p.velocity.y = p.velocity.y * MUZZLE_SPEED + aircraft.linvel.y;
  p.velocity.z = p.velocity.z * MUZZLE_SPEED + aircraft.linvel.z;
  p.position.x = aircraft.position.x;
  p.position.y = aircraft.position.y;
  p.position.z = aircraft.position.z;
  p.ageSec = 0;
  p.active = true;
  combatState.fireCooldown = FIRE_COOLDOWN_SEC;
  // WP19 — audio trigger; WP20 — particle trigger (position-aware).
  // Default no-op when no callback registered.
  onFireFn(p.position);
}

/**
 * Integrate active projectiles by `dt`, age them, deactivate those past
 * MAX_LIFETIME_SEC. Allocation-free.
 *
 * Exported for test isolation.
 */
export function stepProjectiles(dt: number): void {
  for (let i = 0; i < combatState.projectiles.length; i++) {
    const p = combatState.projectiles[i]!;
    if (!p.active) continue;
    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;
    p.position.z += p.velocity.z * dt;
    p.ageSec += dt;
    if (p.ageSec >= MAX_LIFETIME_SEC) {
      p.active = false;
    }
  }
}

/**
 * Per-tick AABB sweep — for each active projectile, if it falls within the
 * (alive) target's AABB, deactivate the projectile and decrement target.hp.
 * On hp reaching 0, set destroyed=true and flip the destroy-target objective
 * (first ObjectiveState entry — combat.json has exactly one objective; the
 * runner observes the flip in the same tick per arch.md D11 / runner.ts:108).
 *
 * Allocation-free; exported for test isolation.
 */
export function checkProjectileHits(objectives: readonly ObjectiveState[]): void {
  const target = combatState.target;
  if (target.destroyed) return;
  const tx = target.position.x;
  const ty = target.position.y;
  const tz = target.position.z;
  const hx = target.halfExtents.x;
  const hy = target.halfExtents.y;
  const hz = target.halfExtents.z;
  for (let i = 0; i < combatState.projectiles.length; i++) {
    const p = combatState.projectiles[i]!;
    if (!p.active) continue;
    if (
      Math.abs(p.position.x - tx) <= hx &&
      Math.abs(p.position.y - ty) <= hy &&
      Math.abs(p.position.z - tz) <= hz
    ) {
      // Snapshot impact position before deactivating the projectile.
      const hitPos = { x: p.position.x, y: p.position.y, z: p.position.z };
      p.active = false;
      target.hp--;
      // WP19 — audio trigger; WP20 — particle trigger (position-aware).
      // Fires on every hit (including the killing hit).
      onImpactFn(hitPos);
      if (target.hp <= 0) {
        target.hp = 0;
        target.destroyed = true;
        // Combat missions ship with exactly one destroy-target objective at
        // index 0 (per combat.json). Flip the first not-yet-completed state.
        for (let j = 0; j < objectives.length; j++) {
          const s = objectives[j]!;
          if (!s.completed) {
            s.completed = true;
            break;
          }
        }
        // No need to keep scanning further projectiles — the mission is won.
        return;
      }
    }
  }
}

/**
 * Phase 4 — integrate return-fire pool + spawn new projectiles aimed at the
 * player. Cooldown decays each tick; on cooldown expiry, if target is alive
 * and a slot is free, spawn a projectile aimed at the player's lead position
 * (aircraft.position + aircraft.linvel * RETURN_FIRE_LEAD_SEC). Active
 * projectiles integrate by velocity*dt and despawn at RETURN_FIRE_MAX_LIFETIME_SEC.
 *
 * Allocation-free; exported for test isolation.
 */
export function stepReturnFire(aircraft: AircraftState, dt: number): void {
  const rf = combatState.returnFire;
  // Cooldown decay (clamped at 0).
  if (rf.cooldown > 0) {
    rf.cooldown -= dt;
    if (rf.cooldown < 0) rf.cooldown = 0;
  }
  // Spawn a new round if (a) target alive, (b) cooldown elapsed, (c) slot free.
  if (!combatState.target.destroyed && rf.cooldown <= 0) {
    let slot = -1;
    for (let i = 0; i < rf.pool.length; i++) {
      if (!rf.pool[i]!.active) {
        slot = i;
        break;
      }
    }
    if (slot !== -1) {
      const p = rf.pool[slot]!;
      // Lead-aim point: where the aircraft will be in RETURN_FIRE_LEAD_SEC.
      const aimX = aircraft.position.x + aircraft.linvel.x * RETURN_FIRE_LEAD_SEC;
      const aimY = aircraft.position.y + aircraft.linvel.y * RETURN_FIRE_LEAD_SEC;
      const aimZ = aircraft.position.z + aircraft.linvel.z * RETURN_FIRE_LEAD_SEC;
      // Direction from target to aim point (unit vector).
      let dx = aimX - combatState.target.position.x;
      let dy = aimY - combatState.target.position.y;
      let dz = aimZ - combatState.target.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Defensive: if aim point is exactly at target (degenerate), fire +Z.
      if (dist > 1e-6) {
        dx /= dist;
        dy /= dist;
        dz /= dist;
      } else {
        dx = 0;
        dy = 0;
        dz = 1;
      }
      p.position.x = combatState.target.position.x;
      p.position.y = combatState.target.position.y;
      p.position.z = combatState.target.position.z;
      p.velocity.x = dx * RETURN_FIRE_SPEED;
      p.velocity.y = dy * RETURN_FIRE_SPEED;
      p.velocity.z = dz * RETURN_FIRE_SPEED;
      p.ageSec = 0;
      p.active = true;
      rf.cooldown = RETURN_FIRE_COOLDOWN_SEC;
    }
  }
  // Integrate active return-fire projectiles + despawn.
  for (let i = 0; i < rf.pool.length; i++) {
    const p = rf.pool[i]!;
    if (!p.active) continue;
    p.position.x += p.velocity.x * dt;
    p.position.y += p.velocity.y * dt;
    p.position.z += p.velocity.z * dt;
    p.ageSec += dt;
    if (p.ageSec >= RETURN_FIRE_MAX_LIFETIME_SEC) {
      p.active = false;
    }
  }
}

/**
 * Per-tick AABB sweep — return-fire projectile vs player. Player AABB is
 * ±PLAYER_HALF_EXTENT around aircraft.position. On hit: deactivate projectile,
 * decrement playerHp. On playerHp <= 0, invoke failSignalFn (production binds
 * to MissionRunner.setHookFailFlag).
 *
 * Allocation-free; exported for test isolation.
 */
export function checkReturnFireHits(aircraft: AircraftState): void {
  if (combatState.playerHp <= 0) return;
  const ax = aircraft.position.x;
  const ay = aircraft.position.y;
  const az = aircraft.position.z;
  const h = PLAYER_HALF_EXTENT;
  const pool = combatState.returnFire.pool;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]!;
    if (!p.active) continue;
    if (
      Math.abs(p.position.x - ax) <= h &&
      Math.abs(p.position.y - ay) <= h &&
      Math.abs(p.position.z - az) <= h
    ) {
      p.active = false;
      combatState.playerHp--;
      if (combatState.playerHp <= 0) {
        combatState.playerHp = 0;
        failSignalFn('shot down');
        return;
      }
    }
  }
}

/**
 * Register the combat-ai hook with an input provider and an optional fail
 * signal callback. The input provider returns true when the player is
 * holding the gun trigger; the fail-signal callback is invoked when the
 * hook needs to terminate the mission as a loss (e.g. playerHp=0).
 * Production binds the input provider to `() => input.isDown('Space')` and
 * the fail signal to `() => missionRunner.setHookFailFlag('shot down')`.
 *
 * Throws on duplicate registration per the registry contract.
 */
export function registerCombatAi(
  gunInputDown: GunInputProvider = () => false,
  failSignal: FailSignalCallback = () => {},
  onFire: TriggerCallback = () => {},
  onImpact: TriggerCallback = () => {},
): void {
  gunInputDownFn = gunInputDown;
  failSignalFn = failSignal;
  onFireFn = onFire;
  onImpactFn = onImpact;
  registerHook(COMBAT_HOOK_NAME, combatAiHook);
}

/** Test-only: reset state to a clean baseline AND reset the input + fail callbacks. */
export function _resetCombatStateForTests(): void {
  resetCombatState();
  gunInputDownFn = () => false;
  failSignalFn = () => {};
  onFireFn = () => {};
  onImpactFn = () => {};
}
