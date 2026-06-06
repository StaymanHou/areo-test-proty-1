import { test, expect } from '@playwright/test';

type ScriptedLogRow = {
  tick: number;
  t_sec: number;
  position: { x: number; y: number; z: number };
  linvel: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  angvel: { x: number; y: number; z: number };
  pitch_deg: number;
  roll_deg: number;
  yaw_deg: number;
  AS_mps: number;
  alpha_deg: number;
  beta_deg: number;
  throttle: number;
};

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
    __aircraft?: {
      getState: () => AircraftSnapshot;
      getScriptedLog: () => ScriptedLogRow[];
      isScriptComplete: () => boolean;
    };
  }
}

test('WP15: ?mission=takeoff-landing deep-link loads, HUD shows objective, spawn state is finite at V_trim', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/?mission=takeoff-landing&debug=true');

  await page.waitForFunction(
    () =>
      typeof window.__aircraft !== 'undefined' &&
      typeof window.__aircraft.getState === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // HUD root attaches after the loop unpauses.
  await page.waitForSelector('[data-testid="hud-root"]', { timeout: 20_000 });

  // Read the first available state — the runner may have advanced a couple of
  // ticks but the aircraft should still be near spawn (z≈280, linvel.z≈-78).
  const state = await page.evaluate(() => window.__aircraft!.getState());

  for (const v of [
    state.position.x, state.position.y, state.position.z,
    state.linvel.x, state.linvel.y, state.linvel.z,
    state.angvel.x, state.angvel.y, state.angvel.z,
    state.airspeed,
  ]) {
    expect(Number.isFinite(v), `non-finite state value: ${v}`).toBe(true);
  }

  // V_trim spawn assertion — linvel.z is the load-bearing spawn invariant that
  // distinguishes this mission from a stationary-on-runway design. If this
  // assertion drifts it means the mission JSON was edited away from V_trim.
  expect(state.linvel.z, `linvel.z at spawn: ${state.linvel.z}`).toBeLessThan(-60);

  // HUD objective: "Fly to waypoint (N/4)" — N is 1 or 2 depending on how
  // quickly the runner ticked between mission start and our read (waypoint 1
  // at (0,30,-200) r=80 can be reached within ~1s of spawn at AS=78). Accept
  // 1, 2, or 3 to keep the test robust against tick-timing while still
  // asserting the (n/4) format that codifies the 4-objective shape.
  const objectiveText = await page
    .locator('[data-testid="hud-objective"]')
    .textContent();
  expect(objectiveText, `objective: ${objectiveText}`).toMatch(
    /^Fly to waypoint \([123]\/4\)$/,
  );

  expect(pageErrors, `pageerror events: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual(
    [],
  );
});

test('WP15: scripted rotate-and-climb arc reaches AS > 60 and altitude > 10 within 15s', async ({ page }) => {
  // Codified version of P1.1's investigative probe. Full-throttle for 15s,
  // KeyW pulse from 0.5-3.0s to force rotation. Aircraft spawns at V_trim
  // (78 m/s) so rotation can complete almost immediately, then climbs.
  await page.goto(
    '/?mission=takeoff-landing&debug=true&script=hold:Throttle=1.0@0:15.0,hold:KeyW@0.5:3.0',
  );

  await page.waitForFunction(
    () =>
      typeof window.__aircraft !== 'undefined' &&
      typeof window.__aircraft.isScriptComplete === 'function',
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => window.__aircraft!.isScriptComplete() === true,
    undefined,
    { timeout: 30_000 },
  );

  const log = await page.evaluate(() => window.__aircraft!.getScriptedLog());
  expect(log.length).toBeGreaterThan(800); // ~13s of recording at 60Hz

  // All values finite across all ticks (load-bearing — no NaN/Infinity).
  for (const row of log) {
    for (const v of [
      row.position.x, row.position.y, row.position.z,
      row.linvel.x, row.linvel.y, row.linvel.z,
      row.angvel.x, row.angvel.y, row.angvel.z,
      row.pitch_deg, row.roll_deg, row.yaw_deg,
      row.AS_mps, row.alpha_deg, row.beta_deg,
    ]) {
      expect(Number.isFinite(v), `non-finite at tick ${row.tick}`).toBe(true);
    }
  }

  const maxAS = Math.max(...log.map((r) => r.AS_mps));
  const maxY = Math.max(...log.map((r) => r.position.y));
  expect(maxAS, `max AS over window: ${maxAS.toFixed(1)}`).toBeGreaterThan(60);
  expect(maxY, `max altitude over window: ${maxY.toFixed(1)}`).toBeGreaterThan(
    10,
  );
});
