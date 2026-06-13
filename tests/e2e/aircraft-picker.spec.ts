// WP24 — aircraft selection UI: end-to-end coverage for the integration
// boundary between the picker on the mission-select screen and main.ts's
// boot-time airframe resolution. The unit tests cover the pure logic
// (`src/mission/aircraft-options.test.ts`, `src/mission/select.test.ts`);
// this spec exercises the consuming surface (the live mission-select page +
// boot path).

import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __aircraftConfig?: { name: string | null; source: string };
  }
}

const STORAGE_KEY = 'flightsim.aircraft.selected';

// No beforeEach: Playwright runs each test in a fresh browser context, so
// localStorage starts empty per test. An init-script-based clear would
// re-fire on every navigation (including the picker's reload), wiping the
// just-persisted pick before the post-reload boot read.

test('mission-select renders the aircraft picker with at least two airframe buttons', async ({ page }) => {
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="mission-select"]', { timeout: 20_000 });

  const picker = page.locator('[data-testid="aircraft-picker"]');
  await expect(picker).toBeVisible();

  const buttons = picker.locator('button[data-airframe-id]');
  await expect(buttons).toHaveCount(2);

  await expect(page.locator('button[data-airframe-id="default"]')).toContainText('Trainer');
  await expect(page.locator('button[data-airframe-id="mig15"]')).toContainText('Jet');
});

test('default selection is Cessna when localStorage is empty', async ({ page }) => {
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="aircraft-picker"]', { timeout: 20_000 });

  const defaultBtn = page.locator('button[data-airframe-id="default"]');
  await expect(defaultBtn).toHaveAttribute('aria-pressed', 'true');

  const jetBtn = page.locator('button[data-airframe-id="mig15"]');
  await expect(jetBtn).toHaveAttribute('aria-pressed', 'false');
});

test('clicking the Jet picker persists to localStorage and updates highlight', async ({ page }) => {
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="aircraft-picker"]', { timeout: 20_000 });

  await page.click('button[data-airframe-id="mig15"]');

  const storageValue = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(storageValue).toBe('mig15');

  await expect(page.locator('button[data-airframe-id="mig15"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[data-airframe-id="default"]')).toHaveAttribute('aria-pressed', 'false');
});

test('Combat tile labels its pinned MiG-15 airframe inline', async ({ page }) => {
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="mission-select"]', { timeout: 20_000 });

  // Phase-2 missions: free-flight, waypoint-patrol, takeoff-landing are free-pick;
  // combat pins mig15. Wait briefly for the eager pinned-config fetches to land
  // before snapshotting (they run after `loadMissionList()` and re-show the menu).
  await expect(page.locator('button[data-mission-id="combat"]')).toContainText('[MiG-15]', {
    timeout: 10_000,
  });
  await expect(page.locator('button[data-mission-id="free-flight"]')).not.toContainText('[');
});

test('pick MiG-15 → launch Free Flight → boot reloads with mig15 airframe loaded', async ({ page }) => {
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="aircraft-picker"]', { timeout: 20_000 });

  // Pick the jet
  await page.click('button[data-airframe-id="mig15"]');

  // Launch Free Flight — picker→mission mismatch triggers a reload because
  // boot loaded Cessna (default) but localStorage now says mig15. After the
  // reload, boot reads localStorage and __aircraftConfig.name === 'mig15'.
  await page.click('button[data-mission-id="free-flight"]');

  await page.waitForFunction(
    () => typeof window.__aircraftConfig !== 'undefined' && window.__aircraftConfig.name === 'mig15',
    undefined,
    { timeout: 20_000 },
  );

  const cfg = await page.evaluate(() => window.__aircraftConfig);
  expect(cfg).toEqual({ name: 'mig15', source: 'storage' });
});

test('pick Cessna (default) → launch Free Flight → no reload, mission starts inline with default', async ({ page }) => {
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="aircraft-picker"]', { timeout: 20_000 });

  // Default is already selected — clicking it should be a no-op.
  await page.click('button[data-mission-id="free-flight"]');

  // Mission should start without reload. __aircraftConfig still says default.
  await page.waitForFunction(
    () => typeof window.__aircraftConfig !== 'undefined' && window.__aircraftConfig.source === 'default',
    undefined,
    { timeout: 10_000 },
  );

  const cfg = await page.evaluate(() => window.__aircraftConfig);
  expect(cfg).toEqual({ name: null, source: 'default' });
});
