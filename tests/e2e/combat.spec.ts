import { test, expect } from '@playwright/test';

// WP16 Phase 5 — Combat mission e2e gates (win + loss).
//
// Both cases drive scripted input via `?script=` per CLAUDE.md Browser-
// walkthrough discipline (no `page.keyboard.press`). The combat hook +
// runner contract is unit-tested in src/mission/hooks/combat-ai.test.ts +
// src/mission/runner.test.ts; this spec is the load-bearing end-to-end
// regression anchor that the full main.ts wiring (hook registration,
// failSignal callback, HUD HP rows, target mesh lifecycle) still works.

type CombatProjectile = {
  active: boolean;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  ageSec: number;
};

type CombatTargetSnapshot = {
  position: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
  hp: number;
  destroyed: boolean;
};

declare global {
  interface Window {
    __aircraft?: {
      isScriptComplete: () => boolean;
    };
    __combat?: {
      getProjectileSnapshot: () => CombatProjectile[];
      getReturnFireSnapshot: () => CombatProjectile[];
      getTargetSnapshot: () => CombatTargetSnapshot;
      getPlayerHp: () => number;
    };
  }
}

test('WP16 win path: scripted approach + sustained fire destroys the target within ~15s', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Throttle=0.5 keeps the mig15 airframe (combat.json sets config:"mig15")
  // in a level cruise corridor at y≈0 that intersects the target's AABB at
  // (0, 0, -600) halfExtents (10, 8, 10). Space held 2-12s gives the gun
  // time to land 3 hits (TARGET_HP=3) at MUZZLE_SPEED=600 m/s.
  await page.goto(
    '/?mission=combat&debug=true&script=hold:Throttle=0.5@0:15.0,hold:Space@2.0:12.0',
  );

  await page.waitForFunction(
    () =>
      typeof window.__combat !== 'undefined' &&
      typeof window.__combat.getTargetSnapshot === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // Poll for destruction — generous timeout since scripted approach can
  // take 10-15s to land all 3 hits depending on tick alignment.
  await page.waitForFunction(
    () => window.__combat!.getTargetSnapshot().destroyed === true,
    undefined,
    { timeout: 25_000 },
  );

  const target = await page.evaluate(() => window.__combat!.getTargetSnapshot());
  expect(target.destroyed).toBe(true);
  expect(target.hp).toBe(0);

  expect(pageErrors, `pageerror events: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('WP16 loss path: scripted loiter without firing → player HP reaches 0 within ~25s', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Throttle=0.5 keeps the mig15 in level cruise; Space is NOT held — the
  // target's return-fire (RETURN_FIRE_ROF=2/sec, RETURN_FIRE_SPEED=400 m/s)
  // closes the distance and lands enough hits to drop the player's PLAYER_HP=6
  // to 0. Target is alive throughout (HP stays at TARGET_HP=3).
  await page.goto('/?mission=combat&debug=true&script=hold:Throttle=0.5@0:25.0');

  await page.waitForFunction(
    () =>
      typeof window.__combat !== 'undefined' &&
      typeof window.__combat.getPlayerHp === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // Poll until player HP hits 0.
  await page.waitForFunction(
    () => window.__combat!.getPlayerHp() === 0,
    undefined,
    { timeout: 35_000 },
  );

  const playerHp = await page.evaluate(() => window.__combat!.getPlayerHp());
  const target = await page.evaluate(() => window.__combat!.getTargetSnapshot());
  expect(playerHp).toBe(0);
  // Target is alive — the loss came from return-fire, not from the player
  // somehow winning + the mission failing.
  expect(target.destroyed).toBe(false);

  expect(pageErrors, `pageerror events: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
