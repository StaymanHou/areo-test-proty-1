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

test('scripted-input: hold:ArrowUp causes measurable pitch-up over the window', async ({ page }) => {
  const log = await runScript(
    page,
    '?mission=free-flight&debug=true&script=hold:ArrowUp@1.0:4.0',
  );

  expect(log.length).toBeGreaterThan(240); // at least ~4s of recording

  // Pre-window pitch should be near baseline. Post-window pitch should be
  // measurably higher. We sample the max pitch in the [60..240] tick range
  // (1-4s) and assert it exceeds +20°.
  const inWindow = log.filter((r) => r.tick >= 60 && r.tick <= 240);
  expect(inWindow.length).toBeGreaterThan(0);
  const maxPitch = Math.max(...inWindow.map((r) => r.pitch_deg));
  expect(maxPitch).toBeGreaterThan(20);
});

test('scripted-input: deterministic — two identical URL runs produce byte-identical logs', async ({ page }) => {
  const logA = await runScript(
    page,
    '?mission=free-flight&debug=true&script=hold:ArrowUp@1.0:3.0',
  );
  const logB = await runScript(
    page,
    '?mission=free-flight&debug=true&script=hold:ArrowUp@1.0:3.0',
  );

  // Byte-identical via JSON.stringify — the load-bearing determinism gate.
  // Surface the first divergent tick for diagnostic if mismatch.
  if (JSON.stringify(logA) !== JSON.stringify(logB)) {
    const minLen = Math.min(logA.length, logB.length);
    for (let i = 0; i < minLen; i++) {
      const a = JSON.stringify(logA[i]);
      const b = JSON.stringify(logB[i]);
      if (a !== b) {
        // eslint-disable-next-line no-console
        console.log(`first divergence at tick ${i}:\n  A: ${a}\n  B: ${b}`);
        break;
      }
    }
    if (logA.length !== logB.length) {
      // eslint-disable-next-line no-console
      console.log(`length diff: A=${logA.length} B=${logB.length}`);
    }
  }
  expect(JSON.stringify(logA)).toBe(JSON.stringify(logB));
});

test('scripted-input: ?config=aerobatic produces different flight behavior vs default', async ({ page }) => {
  const queryBase = 'mission=free-flight&debug=true&script=hold:Throttle=1.0@0:5.0';

  const logDefault = await runScript(page, `?${queryBase}`);
  const logAerobatic = await runScript(page, `?${queryBase}&config=aerobatic`);

  // At full throttle for 5s, the aerobatic airframe (mass=500, T_max=12000)
  // should reach a substantially higher terminal AS than the default
  // Cessna-class airframe (mass=1000, T_max=6000). Specifically, aerobatic
  // T/W ≈ 2.4 vs default 0.61 — terminal AS gap should be measurable.
  const terminalDefault = logDefault[logDefault.length - 1]!.AS_mps;
  const terminalAerobatic = logAerobatic[logAerobatic.length - 1]!.AS_mps;

  // Aerobatic should have higher terminal AS by at least 10 m/s.
  expect(terminalAerobatic - terminalDefault).toBeGreaterThan(10);
});

test('scripted-input: malformed ?config= falls back to default with a warning', async ({ page }) => {
  const consoleWarnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });

  // ../etc/passwd should be rejected by the path-traversal regex
  await page.goto(
    '/?mission=free-flight&debug=true&script=hold:ArrowUp@0.5:1.5&config=' +
      encodeURIComponent('../etc/passwd'),
  );
  await page.waitForFunction(
    () => typeof window.__aircraft !== 'undefined' &&
      typeof window.__aircraft.isScriptComplete === 'function',
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => window.__aircraft!.isScriptComplete() === true,
    undefined,
    { timeout: 15_000 },
  );

  // Page loaded successfully (game still running) → fell back to default
  const log = await page.evaluate(() => window.__aircraft!.getScriptedLog());
  expect(log.length).toBeGreaterThan(0);

  // And a warning was emitted
  expect(consoleWarnings.some((w) => w.includes('rejected'))).toBe(true);
});
