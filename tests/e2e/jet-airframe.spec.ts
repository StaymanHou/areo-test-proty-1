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

declare global {
  interface Window {
    __aircraft?: {
      getState: () => unknown;
      getScriptedLog: () => ScriptedLogRow[];
      isScriptComplete: () => boolean;
    };
  }
}

async function runScript(
  page: import('@playwright/test').Page,
  query: string,
): Promise<ScriptedLogRow[]> {
  await page.goto(`/${query}`);
  await page.waitForFunction(
    () => typeof window.__aircraft !== 'undefined' &&
      typeof window.__aircraft.isScriptComplete === 'function',
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => window.__aircraft!.isScriptComplete() === true,
    undefined,
    { timeout: 30_000 },
  );
  return await page.evaluate(() => window.__aircraft!.getScriptedLog());
}

function assertAllFinite(log: ScriptedLogRow[]): void {
  for (const row of log) {
    const scalars = [
      row.position.x, row.position.y, row.position.z,
      row.linvel.x, row.linvel.y, row.linvel.z,
      row.angvel.x, row.angvel.y, row.angvel.z,
      row.pitch_deg, row.roll_deg, row.yaw_deg,
      row.AS_mps, row.alpha_deg, row.beta_deg,
    ];
    for (const v of scalars) {
      expect(Number.isFinite(v), `non-finite value at tick ${row.tick}`).toBe(true);
    }
  }
}

test('jet-airframe: ?mission=jet-test reaches jet-class terminal AS (> 120 m/s)', async ({ page }) => {
  // jet-test.json spawns at V_trim ≈ 180 m/s with throttle 0.5 (mission JSON).
  // Script overrides throttle to 1.0 for 5s; jet T/W ≈ 1.0 should sustain or
  // accelerate well above 120 m/s. Cessna control comparison uses free-flight
  // mission (spawn AS=78, T/W=0.6) → terminal stays well below.
  const log = await runScript(page, '?mission=jet-test&debug=true&script=hold:Throttle=1.0@0:5.0');

  expect(log.length).toBeGreaterThan(240); // at least 4s of recording
  assertAllFinite(log);

  const terminalAS = log[log.length - 1]!.AS_mps;
  expect(terminalAS).toBeGreaterThan(120);
});

test('jet-airframe: backflip — full-up elevator at full throttle crosses ±90° pitch', async ({ page }) => {
  // Aerobatic capability validation: with full-up elevator and full throttle,
  // the jet should pitch through inverted at least once in the window.
  // Acceptance: max(|pitch_deg|) ≥ 90 — proves backflip capability across airframe classes.
  const log = await runScript(
    page,
    '?mission=jet-test&debug=true&script=hold:ArrowUp@1.0:5.0,hold:Throttle=1.0@0:end',
  );

  expect(log.length).toBeGreaterThan(240);
  assertAllFinite(log);

  const maxAbsPitch = Math.max(...log.map((r) => Math.abs(r.pitch_deg)));
  expect(maxAbsPitch).toBeGreaterThanOrEqual(90);
});
