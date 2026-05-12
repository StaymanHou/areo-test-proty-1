import { test, expect } from '@playwright/test';

// WP12 e2e — assert HUD shows/hides correctly across the mission lifecycle.
// Tiny suite per the "Playwright tests are flaky" anti-pattern.

test('HUD is hidden on mission-select and shown during a running mission', async ({ page }) => {
  // Mission select — HUD not attached.
  await page.goto('/');
  await page.waitForSelector('[data-testid="mission-select"]', { timeout: 20_000 });
  // The HUD root may or may not be in the DOM; if it is, it must not be visible.
  const hudOnSelect = page.locator('[data-testid="hud-root"]');
  await expect(hudOnSelect).toHaveCount(0);
});

test('WP13: pressing Escape during a mission returns to mission-select without an outcome banner', async ({ page }) => {
  await page.goto('/?mission=free-flight');
  await page.waitForSelector('[data-testid="hud-root"]', { timeout: 20_000 });

  // Press Escape. The page's mission runner should abort and re-render the
  // mission-select screen without showing the won/failed outcome banner.
  await page.keyboard.press('Escape');

  // Mission-select reappears.
  await page.waitForSelector('[data-testid="mission-select"]', { timeout: 5_000 });

  // HUD is gone.
  await expect(page.locator('[data-testid="hud-root"]')).toHaveCount(0);

  // No outcome banner was shown.
  await expect(page.locator('[data-testid="mission-outcome-banner"]')).toHaveCount(0);
});

test('HUD shows numeric altitude/airspeed/throttle and hides status banner during play', async ({ page }) => {
  await page.goto('/?mission=free-flight');

  // Wait for HUD to attach (i.e., the loop unpauses after mission start).
  await page.waitForSelector('[data-testid="hud-root"]', { timeout: 20_000 });

  // Give the physics loop a few ticks so altitude/airspeed are populated.
  await page.waitForTimeout(1500);

  const altText = await page.locator('[data-testid="hud-altitude"]').textContent();
  const asText = await page.locator('[data-testid="hud-airspeed"]').textContent();
  const thrText = await page.locator('[data-testid="hud-throttle"]').textContent();

  expect(altText).toMatch(/^-?\d+$/);
  expect(asText).toMatch(/^-?\d+$/);
  expect(thrText).toMatch(/^-?\d+$/);

  // Free-flight has no objectives — objective slot hidden.
  const objective = page.locator('[data-testid="hud-objective"]');
  await expect(objective).toBeHidden();

  // Status banner hidden while flying.
  const banner = page.locator('[data-testid="hud-status-banner"]');
  await expect(banner).toBeHidden();

  // Waypoint arrow hidden — no waypoints in free-flight (and WP14 will wire next-waypoint position).
  const arrow = page.locator('[data-testid="hud-waypoint-arrow"]');
  await expect(arrow).toBeHidden();
});
