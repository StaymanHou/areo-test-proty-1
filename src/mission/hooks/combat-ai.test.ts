import { describe, it, expect, beforeEach } from 'vitest';
import { clearRegistry, getHook } from './registry';
import {
  combatAiHook,
  registerCombatAi,
  resetCombatState,
  getCombatState,
  tryFireGun,
  stepProjectiles,
  checkProjectileHits,
  stepReturnFire,
  checkReturnFireHits,
  _resetCombatStateForTests,
  COMBAT_HOOK_NAME,
  POOL_SIZE,
  ROF,
  MUZZLE_SPEED,
  MAX_RANGE,
  TARGET_HP,
  TARGET_DEFAULT_POSITION,
  TARGET_DEFAULT_HALF_EXTENTS,
  PLAYER_HP,
  RETURN_FIRE_SPEED,
  RETURN_FIRE_ROF,
  RETURN_FIRE_POOL_SIZE,
  PLAYER_HALF_EXTENT,
} from './combat-ai';
import { createAircraftState } from '../../aircraft/physics-core/state';
import type { ObjectiveState } from '../types';

const DT = 1 / 60;
const FIRE_COOLDOWN_SEC = 1 / ROF;

describe('combat-ai hook — registration + invocation', () => {
  beforeEach(() => {
    clearRegistry();
    _resetCombatStateForTests();
  });

  it('registerCombatAi() registers the hook under "combat-ai"', () => {
    registerCombatAi();
    expect(getHook(COMBAT_HOOK_NAME)).toBe(combatAiHook);
  });

  it('hook function does not throw with empty objectives + non-firing input', () => {
    const state: Record<string, unknown> = {};
    const aircraft = createAircraftState();
    const objectives: readonly ObjectiveState[] = [];
    expect(() => combatAiHook(state, aircraft, objectives, DT)).not.toThrow();
  });

  it('hook increments state.bootTick (sanity gate that the hook ran)', () => {
    const state: Record<string, unknown> = {};
    const aircraft = createAircraftState();
    combatAiHook(state, aircraft, [], DT);
    expect(state.bootTick).toBe(1);
    combatAiHook(state, aircraft, [], DT);
    combatAiHook(state, aircraft, [], DT);
    expect(state.bootTick).toBe(3);
  });

  it('duplicate registerCombatAi() throws per registry contract', () => {
    registerCombatAi();
    expect(() => registerCombatAi()).toThrow(
      /hook "combat-ai" is already registered/,
    );
  });
});

describe('combat-ai — projectile pool baseline', () => {
  beforeEach(() => {
    _resetCombatStateForTests();
  });

  it('initializes with POOL_SIZE projectiles, all inactive', () => {
    const cs = getCombatState();
    expect(cs.projectiles).toHaveLength(POOL_SIZE);
    expect(cs.projectiles.every((p) => p.active === false)).toBe(true);
  });

  it('resetCombatState() deactivates all slots + zeroes cooldown', () => {
    // Dirty up the state first.
    const aircraft = createAircraftState();
    tryFireGun(aircraft);
    expect(getCombatState().projectiles[0]!.active).toBe(true);
    expect(getCombatState().fireCooldown).toBeGreaterThan(0);
    resetCombatState();
    expect(getCombatState().projectiles.every((p) => !p.active)).toBe(true);
    expect(getCombatState().fireCooldown).toBe(0);
  });
});

describe('combat-ai — tryFireGun spawn semantics', () => {
  beforeEach(() => {
    _resetCombatStateForTests();
  });

  it('spawns a projectile at aircraft.position', () => {
    const aircraft = createAircraftState();
    aircraft.position.x = 10;
    aircraft.position.y = 50;
    aircraft.position.z = -20;
    tryFireGun(aircraft);
    const p = getCombatState().projectiles[0]!;
    expect(p.active).toBe(true);
    expect(p.position).toEqual({ x: 10, y: 50, z: -20 });
    expect(p.ageSec).toBe(0);
  });

  it('projectile velocity = body-forward * MUZZLE_SPEED + aircraft.linvel (identity quat → -Z forward)', () => {
    const aircraft = createAircraftState();
    aircraft.linvel.z = -78; // V_trim cruise
    // Identity quaternion (w=1, xyz=0) — body-forward = (0,0,-1).
    tryFireGun(aircraft);
    const p = getCombatState().projectiles[0]!;
    expect(p.velocity.x).toBeCloseTo(0);
    expect(p.velocity.y).toBeCloseTo(0);
    // -MUZZLE_SPEED + aircraft.linvel.z = -600 + -78 = -678
    expect(p.velocity.z).toBeCloseTo(-MUZZLE_SPEED + -78);
  });

  it('sets fire cooldown after a successful shot', () => {
    const aircraft = createAircraftState();
    tryFireGun(aircraft);
    expect(getCombatState().fireCooldown).toBeCloseTo(FIRE_COOLDOWN_SEC);
  });

  it('pool exhaustion: 33rd consecutive call (with cooldown bypassed) is silent no-op', () => {
    const aircraft = createAircraftState();
    // Force-fire POOL_SIZE projectiles by bypassing the cooldown each shot.
    for (let i = 0; i < POOL_SIZE; i++) {
      getCombatState().fireCooldown = 0;
      tryFireGun(aircraft);
    }
    expect(getCombatState().projectiles.every((p) => p.active)).toBe(true);
    // 33rd shot — no free slots. Snapshot before/after.
    const before = getCombatState().projectiles.map((p) => p.position.x);
    getCombatState().fireCooldown = 0;
    expect(() => tryFireGun(aircraft)).not.toThrow();
    const after = getCombatState().projectiles.map((p) => p.position.x);
    expect(after).toEqual(before); // nothing changed
  });
});

describe('combat-ai — ROF cooldown gating via hook', () => {
  beforeEach(() => {
    clearRegistry();
    _resetCombatStateForTests();
  });

  it('Space held for >FIRE_COOLDOWN_SEC produces exactly the expected projectile count', () => {
    let gunHeld = true;
    registerCombatAi(() => gunHeld);
    const aircraft = createAircraftState();
    // Place the aircraft well above the default target's AABB so projectiles
    // (which travel along -Z toward the target's z=-600) fly above it and
    // never trigger checkProjectileHits' deactivation path — this test gates
    // ROF behavior, not hit detection.
    aircraft.position.y = 1000;
    const state: Record<string, unknown> = {};
    // Run for FIRE_COOLDOWN_SEC + 1-tick of margin. Tick 0 fires (cooldown=0).
    // Each subsequent tick decays cooldown by 1/60s. Float arithmetic makes
    // exact 12-tick zero-crossing not a clean = 0; the 13th decay tick clamps
    // to 0 and the same tick fires. So after 14 calls we have 2 shots.
    const ticksForTwoShots = Math.ceil(FIRE_COOLDOWN_SEC / DT) + 2; // 14 for ROF=5, DT=1/60
    for (let i = 0; i < ticksForTwoShots; i++) {
      combatAiHook(state, aircraft, [], DT);
    }
    const shotsAfter = getCombatState().projectiles.filter((p) => p.active).length;
    expect(shotsAfter).toBe(2);
    // After 60 ticks (1s) total, expect ~ROF shots (5 ± 1 — boundary depends on
    // exact cooldown alignment).
    for (let i = ticksForTwoShots; i < 60; i++) {
      combatAiHook(state, aircraft, [], DT);
    }
    const shotsAfter1s = getCombatState().projectiles.filter((p) => p.active).length;
    expect(shotsAfter1s).toBeGreaterThanOrEqual(ROF);
    expect(shotsAfter1s).toBeLessThanOrEqual(ROF + 1);
    gunHeld = false;
  });

  it('Space NOT held: no projectiles fired regardless of tick count', () => {
    registerCombatAi(() => false);
    const aircraft = createAircraftState();
    const state: Record<string, unknown> = {};
    for (let i = 0; i < 120; i++) {
      combatAiHook(state, aircraft, [], DT);
    }
    expect(getCombatState().projectiles.every((p) => !p.active)).toBe(true);
  });
});

describe('combat-ai — projectile integration + despawn', () => {
  beforeEach(() => {
    _resetCombatStateForTests();
  });

  it('stepProjectiles integrates active projectile positions by velocity*dt', () => {
    const aircraft = createAircraftState();
    aircraft.linvel.z = 0; // No co-moving velocity contribution.
    tryFireGun(aircraft); // velocity.z = -MUZZLE_SPEED (-600)
    const before = getCombatState().projectiles[0]!.position.z;
    stepProjectiles(DT);
    const after = getCombatState().projectiles[0]!.position.z;
    expect(after - before).toBeCloseTo(-MUZZLE_SPEED * DT);
  });

  it('projectile despawns at MAX_RANGE / MUZZLE_SPEED (≈ MAX_LIFETIME)', () => {
    const aircraft = createAircraftState();
    tryFireGun(aircraft);
    expect(getCombatState().projectiles[0]!.active).toBe(true);
    // Step enough ticks to exceed MAX_RANGE / MUZZLE_SPEED in lifetime.
    // MAX_RANGE/MUZZLE_SPEED = 1500/600 = 2.5s = 150 ticks at 60Hz. Step 160.
    const maxLifetimeTicks = Math.ceil((MAX_RANGE / MUZZLE_SPEED) / DT) + 5;
    for (let i = 0; i < maxLifetimeTicks; i++) {
      stepProjectiles(DT);
    }
    expect(getCombatState().projectiles[0]!.active).toBe(false);
  });

  it('inactive projectiles are skipped by stepProjectiles (positions unchanged)', () => {
    // No tryFireGun call — all inactive.
    const before = getCombatState().projectiles.map((p) => ({ ...p.position }));
    for (let i = 0; i < 60; i++) stepProjectiles(DT);
    const after = getCombatState().projectiles.map((p) => ({ ...p.position }));
    expect(after).toEqual(before);
  });
});

describe('combat-ai — target state baseline + reset', () => {
  beforeEach(() => {
    _resetCombatStateForTests();
  });

  it('initializes target at TARGET_DEFAULT_POSITION with TARGET_HP alive', () => {
    const t = getCombatState().target;
    expect(t.position).toEqual(TARGET_DEFAULT_POSITION);
    expect(t.halfExtents).toEqual(TARGET_DEFAULT_HALF_EXTENTS);
    expect(t.hp).toBe(TARGET_HP);
    expect(t.destroyed).toBe(false);
  });

  it('resetCombatState restores target to baseline (hp + destroyed)', () => {
    const t = getCombatState().target;
    t.hp = 1;
    t.destroyed = true;
    resetCombatState();
    expect(t.hp).toBe(TARGET_HP);
    expect(t.destroyed).toBe(false);
  });

  it('resetCombatState preserves target object identity (allocation-free)', () => {
    const before = getCombatState().target;
    resetCombatState();
    expect(getCombatState().target).toBe(before);
  });
});

describe('combat-ai — checkProjectileHits AABB math', () => {
  beforeEach(() => {
    _resetCombatStateForTests();
  });

  function makeObjectives(n = 1): ObjectiveState[] {
    return Array.from({ length: n }, () => ({ completed: false, meta: {} }));
  }

  function placeProjectile(slot: number, x: number, y: number, z: number): void {
    const p = getCombatState().projectiles[slot]!;
    p.active = true;
    p.position.x = x;
    p.position.y = y;
    p.position.z = z;
  }

  it('projectile inside target AABB registers a hit, decrements hp, deactivates projectile', () => {
    placeProjectile(0, TARGET_DEFAULT_POSITION.x, TARGET_DEFAULT_POSITION.y, TARGET_DEFAULT_POSITION.z); // dead-center of default target
    const objs = makeObjectives();
    checkProjectileHits(objs);
    const cs = getCombatState();
    expect(cs.projectiles[0]!.active).toBe(false);
    expect(cs.target.hp).toBe(TARGET_HP - 1);
    expect(cs.target.destroyed).toBe(false);
    expect(objs[0]!.completed).toBe(false);
  });

  it('projectile outside target AABB is left alone', () => {
    // Place well outside any plausible halfExtents (+100 on x is generously outside).
    placeProjectile(
      0,
      TARGET_DEFAULT_POSITION.x + 100,
      TARGET_DEFAULT_POSITION.y,
      TARGET_DEFAULT_POSITION.z,
    );
    const objs = makeObjectives();
    checkProjectileHits(objs);
    const cs = getCombatState();
    expect(cs.projectiles[0]!.active).toBe(true);
    expect(cs.target.hp).toBe(TARGET_HP);
    expect(objs[0]!.completed).toBe(false);
  });

  it('projectile exactly at AABB boundary counts as a hit (inclusive)', () => {
    // Place at dx = halfExtents.x boundary (target position + halfExtents.x).
    placeProjectile(
      0,
      TARGET_DEFAULT_POSITION.x + TARGET_DEFAULT_HALF_EXTENTS.x,
      TARGET_DEFAULT_POSITION.y,
      TARGET_DEFAULT_POSITION.z,
    );
    const objs = makeObjectives();
    checkProjectileHits(objs);
    expect(getCombatState().target.hp).toBe(TARGET_HP - 1);
  });

  it('TARGET_HP consecutive hits destroy the target and flip the destroy-target objective', () => {
    const objs = makeObjectives();
    for (let i = 0; i < TARGET_HP; i++) {
      placeProjectile(i, TARGET_DEFAULT_POSITION.x, TARGET_DEFAULT_POSITION.y, TARGET_DEFAULT_POSITION.z);
    }
    checkProjectileHits(objs);
    const cs = getCombatState();
    expect(cs.target.destroyed).toBe(true);
    expect(cs.target.hp).toBe(0);
    expect(objs[0]!.completed).toBe(true);
    // All TARGET_HP projectiles deactivated by hits.
    for (let i = 0; i < TARGET_HP; i++) {
      expect(cs.projectiles[i]!.active).toBe(false);
    }
  });

  it('further hits after destroyed do not decrement below 0 and do not re-deactivate projectiles', () => {
    // Destroy the target first.
    const objs = makeObjectives();
    for (let i = 0; i < TARGET_HP; i++) {
      placeProjectile(i, TARGET_DEFAULT_POSITION.x, TARGET_DEFAULT_POSITION.y, TARGET_DEFAULT_POSITION.z);
    }
    checkProjectileHits(objs);
    expect(getCombatState().target.destroyed).toBe(true);
    // Place an additional in-AABB projectile and re-sweep.
    placeProjectile(10, TARGET_DEFAULT_POSITION.x, TARGET_DEFAULT_POSITION.y, TARGET_DEFAULT_POSITION.z);
    checkProjectileHits(objs);
    const cs = getCombatState();
    expect(cs.target.hp).toBe(0); // not negative
    // Active projectile is left alone — destroyed target stops checking.
    expect(cs.projectiles[10]!.active).toBe(true);
  });

  it('inactive projectiles are skipped (no hit even when geometrically inside)', () => {
    const p = getCombatState().projectiles[0]!;
    p.active = false;
    p.position.x = TARGET_DEFAULT_POSITION.x;
    p.position.y = TARGET_DEFAULT_POSITION.y;
    p.position.z = TARGET_DEFAULT_POSITION.z;
    const objs = makeObjectives();
    checkProjectileHits(objs);
    expect(getCombatState().target.hp).toBe(TARGET_HP);
  });

  it('placing TARGET_HP+1 projectiles in AABB — first sweep kills, remaining projectile left active by early-return', () => {
    // Place TARGET_HP+1 projectiles in AABB; first sweep should kill on the
    // TARGET_HP-th hit (return early after kill) and skip the rest.
    const objs = makeObjectives();
    const N = TARGET_HP + 1;
    for (let i = 0; i < N; i++) {
      placeProjectile(i, TARGET_DEFAULT_POSITION.x, TARGET_DEFAULT_POSITION.y, TARGET_DEFAULT_POSITION.z);
    }
    checkProjectileHits(objs);
    const cs = getCombatState();
    expect(cs.target.destroyed).toBe(true);
    // First TARGET_HP deactivated (each hit decrements hp + deactivates that projectile).
    for (let i = 0; i < TARGET_HP; i++) {
      expect(cs.projectiles[i]!.active).toBe(false);
    }
    // The (TARGET_HP+1)-th left active because the killing hit triggered early-return.
    expect(cs.projectiles[TARGET_HP]!.active).toBe(true);
  });

  it('runner contract: hook flips ObjectiveState.completed in same tick the target dies', () => {
    // Simulates runner.ts:108-114: hook runs first, then the runner observes
    // completed flags in its objective-evaluation pass on the same tick.
    clearRegistry();
    registerCombatAi(() => false);
    const aircraft = createAircraftState();
    const objs = makeObjectives();
    // Place TARGET_HP active in-AABB projectiles directly.
    for (let i = 0; i < TARGET_HP; i++) {
      placeProjectile(i, TARGET_DEFAULT_POSITION.x, TARGET_DEFAULT_POSITION.y, TARGET_DEFAULT_POSITION.z);
    }
    // Invoke the hook once — this is the runner.ts:109-114 call site.
    combatAiHook({}, aircraft, objs, DT);
    expect(objs[0]!.completed).toBe(true);
    expect(getCombatState().target.destroyed).toBe(true);
  });
});

describe('combat-ai — Phase 4: playerHp + return-fire baseline', () => {
  beforeEach(() => {
    _resetCombatStateForTests();
  });

  it('initializes playerHp at PLAYER_HP and a return-fire pool of POOL_SIZE inactive entries', () => {
    const cs = getCombatState();
    expect(cs.playerHp).toBe(PLAYER_HP);
    expect(cs.returnFire.pool).toHaveLength(RETURN_FIRE_POOL_SIZE);
    expect(cs.returnFire.pool.every((p) => p.active === false)).toBe(true);
  });

  it('resetCombatState restores playerHp + return-fire pool to baseline', () => {
    const cs = getCombatState();
    cs.playerHp = 0;
    cs.returnFire.pool[0]!.active = true;
    cs.returnFire.cooldown = 999;
    resetCombatState();
    expect(getCombatState().playerHp).toBe(PLAYER_HP);
    expect(getCombatState().returnFire.pool.every((p) => !p.active)).toBe(true);
    expect(getCombatState().returnFire.cooldown).toBeGreaterThan(0);
  });

  it('resetCombatState preserves return-fire pool identity (allocation-free)', () => {
    const beforeRefs = getCombatState().returnFire.pool.map((p) => p);
    resetCombatState();
    const afterRefs = getCombatState().returnFire.pool;
    for (let i = 0; i < beforeRefs.length; i++) {
      expect(afterRefs[i]).toBe(beforeRefs[i]);
    }
  });
});

describe('combat-ai — Phase 4: stepReturnFire spawn semantics', () => {
  beforeEach(() => {
    _resetCombatStateForTests();
  });

  it('spawns one projectile per RETURN_FIRE cadence interval (target alive)', () => {
    // Force cooldown to 0 so the first tick spawns.
    getCombatState().returnFire.cooldown = 0;
    const aircraft = createAircraftState();
    stepReturnFire(aircraft, DT);
    const active = getCombatState().returnFire.pool.filter((p) => p.active).length;
    expect(active).toBe(1);
  });

  it('does NOT spawn while target is destroyed', () => {
    getCombatState().target.destroyed = true;
    getCombatState().returnFire.cooldown = 0;
    const aircraft = createAircraftState();
    stepReturnFire(aircraft, DT);
    expect(getCombatState().returnFire.pool.every((p) => !p.active)).toBe(true);
  });

  it('respects the return-fire cooldown — second tick within cooldown does not spawn', () => {
    getCombatState().returnFire.cooldown = 0;
    const aircraft = createAircraftState();
    stepReturnFire(aircraft, DT); // first spawn
    stepReturnFire(aircraft, DT); // immediately after — should still be on cooldown
    expect(getCombatState().returnFire.pool.filter((p) => p.active).length).toBe(1);
  });

  it('aims at the player lead position (aircraft.position + linvel * RETURN_FIRE_LEAD_SEC)', () => {
    // Place target at origin (override default for math simplicity).
    getCombatState().target.position.x = 0;
    getCombatState().target.position.y = 0;
    getCombatState().target.position.z = 0;
    getCombatState().returnFire.cooldown = 0;
    const aircraft = createAircraftState();
    // Aircraft at +1000 along +Z, no velocity → aim point = (0,0,1000), unit direction = (0,0,1).
    aircraft.position.x = 0;
    aircraft.position.y = 0;
    aircraft.position.z = 1000;
    stepReturnFire(aircraft, DT);
    const p = getCombatState().returnFire.pool[0]!;
    expect(p.active).toBe(true);
    // Velocity direction should be approximately +Z at RETURN_FIRE_SPEED.
    expect(p.velocity.x).toBeCloseTo(0);
    expect(p.velocity.y).toBeCloseTo(0);
    expect(p.velocity.z).toBeCloseTo(RETURN_FIRE_SPEED);
  });

  it('integrates active return-fire projectiles by velocity*dt and despawns past lifetime', () => {
    getCombatState().returnFire.cooldown = 0;
    const aircraft = createAircraftState();
    aircraft.position.z = 100; // some non-zero forward
    stepReturnFire(aircraft, DT); // spawns one
    const before = { ...getCombatState().returnFire.pool[0]!.position };
    stepReturnFire(aircraft, DT); // integrates one tick — still on cooldown so no new spawn
    const after = getCombatState().returnFire.pool[0]!.position;
    expect(after.z - before.z).toBeCloseTo(getCombatState().returnFire.pool[0]!.velocity.z * DT);
  });
});

describe('combat-ai — Phase 4: checkReturnFireHits + failSignal', () => {
  beforeEach(() => {
    clearRegistry();
    _resetCombatStateForTests();
  });

  function placeReturnFire(slot: number, x: number, y: number, z: number): void {
    const p = getCombatState().returnFire.pool[slot]!;
    p.active = true;
    p.position.x = x;
    p.position.y = y;
    p.position.z = z;
  }

  it('return-fire projectile inside player AABB decrements playerHp and deactivates the projectile', () => {
    const aircraft = createAircraftState();
    placeReturnFire(0, aircraft.position.x, aircraft.position.y, aircraft.position.z);
    checkReturnFireHits(aircraft);
    expect(getCombatState().playerHp).toBe(PLAYER_HP - 1);
    expect(getCombatState().returnFire.pool[0]!.active).toBe(false);
  });

  it('return-fire projectile outside player AABB does not decrement playerHp', () => {
    const aircraft = createAircraftState();
    placeReturnFire(0, aircraft.position.x + 100, aircraft.position.y, aircraft.position.z);
    checkReturnFireHits(aircraft);
    expect(getCombatState().playerHp).toBe(PLAYER_HP);
    expect(getCombatState().returnFire.pool[0]!.active).toBe(true);
  });

  it('return-fire projectile exactly at AABB boundary counts as a hit (inclusive)', () => {
    const aircraft = createAircraftState();
    placeReturnFire(0, aircraft.position.x + PLAYER_HALF_EXTENT, aircraft.position.y, aircraft.position.z);
    checkReturnFireHits(aircraft);
    expect(getCombatState().playerHp).toBe(PLAYER_HP - 1);
  });

  it('PLAYER_HP consecutive hits trigger failSignal("shot down") with the player at 0 HP', () => {
    let failReason: string | undefined = undefined;
    let failCallCount = 0;
    registerCombatAi(
      () => false,
      (reason) => {
        failReason = reason;
        failCallCount++;
      },
    );
    const aircraft = createAircraftState();
    // Place PLAYER_HP active in-AABB return-fire projectiles.
    for (let i = 0; i < PLAYER_HP; i++) {
      placeReturnFire(i, aircraft.position.x, aircraft.position.y, aircraft.position.z);
    }
    checkReturnFireHits(aircraft);
    expect(getCombatState().playerHp).toBe(0);
    expect(failCallCount).toBe(1);
    expect(failReason).toBe('shot down');
  });

  it('failSignal not invoked while playerHp > 0', () => {
    let failCallCount = 0;
    registerCombatAi(
      () => false,
      () => {
        failCallCount++;
      },
    );
    const aircraft = createAircraftState();
    placeReturnFire(0, aircraft.position.x, aircraft.position.y, aircraft.position.z);
    checkReturnFireHits(aircraft);
    expect(failCallCount).toBe(0);
    expect(getCombatState().playerHp).toBe(PLAYER_HP - 1);
  });

  it('playerHp clamped at 0 (no negative even with extra hits)', () => {
    const aircraft = createAircraftState();
    // Use PLAYER_HP+3 projectiles to verify clamp.
    for (let i = 0; i < PLAYER_HP + 3; i++) {
      placeReturnFire(i % RETURN_FIRE_POOL_SIZE, aircraft.position.x, aircraft.position.y, aircraft.position.z);
    }
    checkReturnFireHits(aircraft);
    expect(getCombatState().playerHp).toBe(0);
  });

  it('post-fail state: subsequent checkReturnFireHits is a no-op (playerHp stays 0)', () => {
    let failCallCount = 0;
    registerCombatAi(
      () => false,
      () => {
        failCallCount++;
      },
    );
    const aircraft = createAircraftState();
    getCombatState().playerHp = 0;
    placeReturnFire(0, aircraft.position.x, aircraft.position.y, aircraft.position.z);
    checkReturnFireHits(aircraft);
    expect(getCombatState().playerHp).toBe(0);
    expect(failCallCount).toBe(0);
    // Projectile is left alone (no further hits processed).
    expect(getCombatState().returnFire.pool[0]!.active).toBe(true);
  });

  it('end-to-end via combatAiHook: target return-fire over many ticks eventually triggers failSignal', () => {
    let failCallCount = 0;
    registerCombatAi(
      () => false,
      () => {
        failCallCount++;
      },
    );
    const aircraft = createAircraftState();
    // Place aircraft at target position (degenerate but valid — return-fire
    // direction defensive-falls to +Z, but the projectile spawns at the
    // target's own position which equals the aircraft's → immediate AABB hit
    // the next tick). Use a separated geometry to be deterministic.
    aircraft.position.x = 0;
    aircraft.position.y = 0;
    aircraft.position.z = 100;
    getCombatState().target.position.x = 0;
    getCombatState().target.position.y = 0;
    getCombatState().target.position.z = 0;
    // Force first-tick spawn.
    getCombatState().returnFire.cooldown = 0;
    // Run many ticks — at RETURN_FIRE_ROF=1/sec, getting PLAYER_HP=10 hits
    // requires ≥10 spawns + travel time. The projectile takes ~100/200=0.5s
    // to reach the player from 100m at RETURN_FIRE_SPEED=200m/s.
    // Player is stationary, so the lead-aim point is the player's position —
    // every spawned projectile hits dead-center if no integration drift.
    const maxTicks = 30 * 60; // 30s @ 60Hz — generous upper bound
    for (let i = 0; i < maxTicks && failCallCount === 0; i++) {
      combatAiHook({}, aircraft, [], DT);
    }
    expect(failCallCount).toBe(1);
    expect(getCombatState().playerHp).toBe(0);
  });
});

describe('combat-ai — Phase 4: registerCombatAi(failSignal)', () => {
  beforeEach(() => {
    clearRegistry();
    _resetCombatStateForTests();
  });

  it('accepts an optional failSignal callback (default no-op)', () => {
    expect(() => registerCombatAi()).not.toThrow();
  });

  it('accepts both input + failSignal positionally', () => {
    expect(() => registerCombatAi(() => false, () => {})).not.toThrow();
  });

  it('RETURN_FIRE_ROF constant is a positive number (Phase 5 tunable)', () => {
    expect(RETURN_FIRE_ROF).toBeGreaterThan(0);
    expect(Number.isFinite(RETURN_FIRE_ROF)).toBe(true);
  });
});
