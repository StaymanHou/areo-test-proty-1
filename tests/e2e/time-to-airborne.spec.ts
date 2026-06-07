import { test, expect } from '@playwright/test';

// WP18 Phase 3 — Time-to-airborne gate.
//
// Codifies the vision-stated "new player airborne within 30 seconds of
// loading" claim (`docs/product/vision.md` — Success Metrics).
//
// Measurement: t0 captured immediately before page.goto; tFlying captured the
// first tick that `window.__aircraft.getState()` reports airspeed > 40 m/s
// AND every numeric field is finite. The 40 m/s threshold is well below the
// V_trim spawn AS of 78 m/s (per CLAUDE.md Rule #9), so this is satisfied
// at the first physics tick after click → startMission resolves.
//
// The gate measures the URL-open → click-mission → first-physics-tick path
// (boot + click + first-tick), NOT a takeoff roll. The four missions all
// spawn at V_trim per Rule #9, so the aircraft IS airborne at tick 0 of
// the mission run.

const URL = '/?debug=true';
const BUDGET_MS = 30_000;
const AS_THRESHOLD = 40;

type AircraftState = {
  position: { x: number; y: number; z: number };
  linvel: { x: number; y: number; z: number };
  angvel: { x: number; y: number; z: number };
  airspeed: number;
  throttle: number;
};

declare global {
  interface Window {
    __aircraft?: {
      getState: () => AircraftState;
    };
  }
}

test('time-to-airborne ≤ 30s on free-flight cold-load', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const t0 = Date.now();

  await page.goto(URL);
  await page.locator('[data-testid="mission-select"]').waitFor({ timeout: 15_000 });
  await page.locator('button[data-mission-id="free-flight"]').click();

  // Poll for the airborne condition: AS > 40 m/s AND every numeric field finite.
  await page.waitForFunction(
    (threshold) => {
      const w = window as unknown as { __aircraft?: { getState: () => AircraftState } };
      if (typeof w.__aircraft?.getState !== 'function') return false;
      const s = w.__aircraft.getState();
      const allFinite =
        Number.isFinite(s.position.x) &&
        Number.isFinite(s.position.y) &&
        Number.isFinite(s.position.z) &&
        Number.isFinite(s.linvel.x) &&
        Number.isFinite(s.linvel.y) &&
        Number.isFinite(s.linvel.z) &&
        Number.isFinite(s.angvel.x) &&
        Number.isFinite(s.angvel.y) &&
        Number.isFinite(s.angvel.z) &&
        Number.isFinite(s.airspeed) &&
        Number.isFinite(s.throttle);
      return allFinite && s.airspeed > threshold;
    },
    AS_THRESHOLD,
    { timeout: BUDGET_MS },
  );

  const elapsedMs = Date.now() - t0;
  expect(elapsedMs).toBeLessThanOrEqual(BUDGET_MS);

  // Final state check: still finite, still airborne.
  const finalState = await page.evaluate(() => window.__aircraft!.getState());
  expect(Number.isFinite(finalState.airspeed)).toBe(true);
  expect(finalState.airspeed).toBeGreaterThan(AS_THRESHOLD);

  // No JS errors during the airborne path.
  expect(pageErrors, `pageerror: ${pageErrors.join('; ')}`).toEqual([]);
});
