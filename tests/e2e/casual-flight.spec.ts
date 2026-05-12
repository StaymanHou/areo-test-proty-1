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

test('casual flight: aircraft remains finite, moves from spawn, no NaN/Infinity (WP9 regression anchor)', async ({ page }) => {
  const consoleErrors: string[] = [];
  const consoleNaN: string[] = [];
  const pageErrors: string[] = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    if (/NaN|Infinity/i.test(text)) consoleNaN.push(text);
  });

  await page.goto('/?debug=true');

  await page.waitForFunction(
    () => typeof window.__aircraft !== 'undefined' && typeof window.__aircraft.getState === 'function',
    undefined,
    { timeout: 20_000 },
  );

  await page.waitForTimeout(5_000);

  const state = await page.evaluate<AircraftSnapshot>(() => window.__aircraft!.getState());

  expect(Number.isFinite(state.position.x), `position.x not finite: ${state.position.x}`).toBe(true);
  expect(Number.isFinite(state.position.y), `position.y not finite: ${state.position.y}`).toBe(true);
  expect(Number.isFinite(state.position.z), `position.z not finite: ${state.position.z}`).toBe(true);
  expect(Number.isFinite(state.airspeed), `airspeed not finite: ${state.airspeed}`).toBe(true);
  expect(Number.isFinite(state.linvel.y), `linvel.y not finite: ${state.linvel.y}`).toBe(true);

  expect(state.airspeed, `airspeed should be > 0 (aircraft moving), got ${state.airspeed}`).toBeGreaterThan(0);

  expect(Math.abs(state.position.x)).toBeLessThan(1000);
  expect(Math.abs(state.position.z - -150)).toBeLessThan(1000);

  expect(pageErrors, `pageerror events: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console error messages: ${consoleErrors.join('; ')}`).toEqual([]);
  expect(consoleNaN, `console lines containing NaN/Infinity: ${consoleNaN.join('; ')}`).toEqual([]);
});
