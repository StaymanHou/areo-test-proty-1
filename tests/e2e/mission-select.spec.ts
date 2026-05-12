import { test, expect } from '@playwright/test';

type AircraftSnapshot = {
  position: { x: number; y: number; z: number };
  linvel: { x: number; y: number; z: number };
  angvel: { x: number; y: number; z: number };
  eulerDeg: { pitch: number; yaw: number; roll: number };
  airspeed: number;
  throttle: number;
};

declare global {
  interface Window {
    __aircraft?: { getState: () => AircraftSnapshot };
  }
}

test('mission-select renders and lists the free-flight mission', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  // Wait for mission-select to render. The overlay is gated on
  // loadMissionList() resolving, so this also confirms the manifest fetch
  // succeeded.
  const select = page.locator('[data-testid="mission-select"]');
  await expect(select).toBeVisible({ timeout: 20_000 });

  // Free Flight button is present and labeled correctly.
  const freeFlightBtn = page.locator('button[data-mission-id="free-flight"]');
  await expect(freeFlightBtn).toBeVisible();
  await expect(freeFlightBtn).toHaveText('Free Flight');

  expect(pageErrors, `pageerror events: ${pageErrors.join('; ')}`).toEqual([]);
});

test('mission-select → click free-flight → aircraft finite + moved at 3s', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleNaN: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    if (/NaN|Infinity/i.test(text)) consoleNaN.push(text);
  });

  // ?debug=true keeps the __aircraft telemetry global available for assertions.
  await page.goto('/?debug=true');

  const select = page.locator('[data-testid="mission-select"]');
  await expect(select).toBeVisible({ timeout: 20_000 });

  // Click Free Flight → mission starts.
  await page.locator('button[data-mission-id="free-flight"]').click();

  // Mission-select should be hidden once the mission starts.
  await expect(select).toBeHidden({ timeout: 5_000 });

  // Wait for the __aircraft global to appear (set by debug telemetry path).
  await page.waitForFunction(
    () => typeof window.__aircraft !== 'undefined' && typeof window.__aircraft.getState === 'function',
    undefined,
    { timeout: 10_000 },
  );

  // Simulate for ~3 seconds.
  await page.waitForTimeout(3_000);

  const state = await page.evaluate<AircraftSnapshot>(() => window.__aircraft!.getState());

  // Finite, moving, no NaN — same shape as the casual-flight regression anchor.
  expect(Number.isFinite(state.position.x)).toBe(true);
  expect(Number.isFinite(state.position.y)).toBe(true);
  expect(Number.isFinite(state.position.z)).toBe(true);
  expect(Number.isFinite(state.airspeed)).toBe(true);
  expect(state.airspeed).toBeGreaterThan(0);
  // Aircraft moved from spawn (z went from 0 to negative).
  expect(state.position.z).toBeLessThan(-10);

  expect(pageErrors, `pageerror events: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console error messages: ${consoleErrors.join('; ')}`).toEqual([]);
  expect(consoleNaN, `console lines containing NaN/Infinity: ${consoleNaN.join('; ')}`).toEqual([]);
});

test('?mission=does-not-exist renders the mission-select with an error banner', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/?mission=does-not-exist');

  // Mission-select should render WITH the error banner.
  const select = page.locator('[data-testid="mission-select"]');
  await expect(select).toBeVisible({ timeout: 20_000 });
  const err = page.locator('[data-testid="mission-select-error"]');
  await expect(err).toBeVisible();
  await expect(err).toContainText('does-not-exist');

  // The mission list is still rendered (graceful fallback).
  const freeFlightBtn = page.locator('button[data-mission-id="free-flight"]');
  await expect(freeFlightBtn).toBeVisible();

  expect(pageErrors, `pageerror events: ${pageErrors.join('; ')}`).toEqual([]);
});
