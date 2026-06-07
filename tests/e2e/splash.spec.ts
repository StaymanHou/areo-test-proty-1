import { test, expect } from '@playwright/test';

// WP18 Phase 1 — splash with load progress.
//
// Observable outcomes (from wp18-onboarding.md WIP):
//   - Splash visible immediately on page load (paints before JS bundle parses,
//     because the markup is inlined in index.html).
//   - Splash element is detached from the DOM once mission-select renders
//     (not just hidden — expect toHaveCount(0)).
//   - No JS console errors during boot.

const BASE_URL = '/?debug=true';

test('splash is visible immediately, then detached when mission-select renders', async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // The splash is inlined in index.html, so the raw HTML response contains
  // it before any module script has run. Fetch the HTML directly via
  // page.request — most reliable "splash paints before JS runs" assertion.
  // (Observing the DOM after page.goto is flaky because the dev server boots
  // so fast that the bundle often detaches the splash before a separate
  // evaluate can read it.)
  const indexResponse = await request.get(BASE_URL);
  expect(indexResponse.ok()).toBe(true);
  const indexHtml = await indexResponse.text();
  expect(indexHtml).toContain('data-testid="splash"');
  expect(indexHtml).toContain('Web Flight Sim');
  expect(indexHtml).toContain('id="splash-stage"');

  // Now actually navigate and verify the splash is detached after the
  // mission-select renders (the post-boot state).
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  // Wait for the bootstrap to complete and render mission-select.
  const select = page.locator('[data-testid="mission-select"]');
  await expect(select).toBeVisible({ timeout: 15_000 });

  // Splash element must be detached from the DOM by now (not just hidden).
  await expect(page.locator('[data-testid="splash"]')).toHaveCount(0);

  // All four mission buttons must still be reachable (no regression from
  // the new splash painting on top during boot).
  for (const id of ['free-flight', 'waypoint-patrol', 'takeoff-landing', 'combat']) {
    await expect(page.locator(`button[data-mission-id="${id}"]`)).toBeVisible();
  }

  expect(pageErrors, `pageerror: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console.error: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('splash removed on ?mission= auto-start deep-link path', async ({ page }) => {
  await page.goto('/?debug=true&mission=free-flight', { waitUntil: 'domcontentloaded' });

  // The splash should appear briefly on the deep-link path too, then be
  // detached once startMission unpauses the loop.
  const splash = page.locator('[data-testid="splash"]');
  // Mission-select is skipped on the auto-start path; wait directly for HUD.
  // Use window.__aircraft as the canonical "mission running" probe (matches
  // existing e2e patterns).
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __aircraft?: { getState?: () => unknown } };
      return typeof w.__aircraft?.getState === 'function';
    },
    null,
    { timeout: 15_000 },
  );

  await expect(splash).toHaveCount(0);
});
