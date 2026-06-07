import { test, expect, type Page } from '@playwright/test';

// WP18 Phase 2 — Key-hints overlay end-to-end.
//
// Observable outcomes (from wp18-onboarding.md WIP):
//   - Click a mission button → [data-testid="key-hints"] visible within ~1s.
//   - Hints text contains Pitch / Roll / Yaw / Throttle / Camera / Abort.
//     Combat mission also shows "Fire" + "Space".
//   - After ~21s of mission play (script-elapsed), key-hints is detached.
//   - pointer-events: none — does not block canvas clicks underneath.
//   - Per-mission re-show: return-to-menu, pick another mission, hints re-appear.

declare global {
  interface Window {
    __aircraft?: {
      getState: () => unknown;
      isScriptComplete: () => boolean;
    };
  }
}

const BASE = '/?debug=true';

async function clickMissionAndWaitForHud(page: Page, missionId: string): Promise<void> {
  await page.locator(`button[data-mission-id="${missionId}"]`).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __aircraft?: { getState?: () => unknown } };
    return typeof w.__aircraft?.getState === 'function';
  }, null, { timeout: 10_000 });
}

test('key-hints appears on Free Flight start with common bindings', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('[data-testid="mission-select"]')).toBeVisible();

  await clickMissionAndWaitForHud(page, 'free-flight');

  const hints = page.locator('[data-testid="key-hints"]');
  await expect(hints).toBeVisible({ timeout: 5_000 });

  const text = (await hints.textContent()) ?? '';
  expect(text).toContain('Pitch');
  expect(text).toContain('Roll');
  expect(text).toContain('Yaw');
  expect(text).toContain('Throttle');
  expect(text).toContain('Camera');
  expect(text).toContain('Abort');
  expect(text).toContain('W / S');

  // free-flight does NOT include the combat-only Fire/Space binding
  expect(text).not.toContain('Fire');
});

test('key-hints on Combat includes Fire / Space binding', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('[data-testid="mission-select"]')).toBeVisible();

  await clickMissionAndWaitForHud(page, 'combat');

  const hints = page.locator('[data-testid="key-hints"]');
  await expect(hints).toBeVisible({ timeout: 5_000 });

  const text = (await hints.textContent()) ?? '';
  expect(text).toContain('Fire');
  expect(text).toContain('Space');
});

test('key-hints detaches after ~21s of mission play (script-elapsed)', async ({ page }) => {
  // Use the scripted-input harness to advance physics time deterministically.
  // 25s of held throttle is enough to step past the 21s remove threshold.
  await page.goto(`${BASE}&mission=free-flight&script=hold:Throttle=0.6@0:25.0`);

  // Wait for the script to complete — `keyHints.update(dt)` ticks once per
  // physics step, so by isScriptComplete() the hint timer has logged 25s.
  await page.waitForFunction(() => {
    const w = window as unknown as { __aircraft?: { isScriptComplete?: () => boolean } };
    return w.__aircraft?.isScriptComplete?.() === true;
  }, null, { timeout: 30_000 });

  await expect(page.locator('[data-testid="key-hints"]')).toHaveCount(0);
});

test('key-hints re-appears on a fresh mission entry after return-to-menu', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('[data-testid="mission-select"]')).toBeVisible();

  // First entry — hints visible.
  await clickMissionAndWaitForHud(page, 'free-flight');
  await expect(page.locator('[data-testid="key-hints"]')).toBeVisible();

  // Abort via Escape → return to mission-select.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="mission-select"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="key-hints"]')).toHaveCount(0);

  // Second entry — hints re-appear with a fresh opacity (the previous timer
  // is cleared by show()).
  await page.locator('button[data-mission-id="waypoint-patrol"]').click();
  await expect(page.locator('[data-testid="key-hints"]')).toBeVisible({ timeout: 5_000 });
  const opacity = await page
    .locator('[data-testid="key-hints"]')
    .evaluate((el) => (el as HTMLElement).style.opacity);
  // Either '1' (just shown) or a string near 1 ('0.999', etc.).
  expect(parseFloat(opacity || '1')).toBeGreaterThanOrEqual(0.95);
});
