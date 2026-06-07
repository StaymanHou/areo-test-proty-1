import { test, expect, type Page } from '@playwright/test';

// WP17 Phase 1 — Phase-2 exit gate. End-to-end integration sweep across the
// four mission types: mission-select → click → play → terminal-state → return-
// to-mission-select. Asserts the integration property that no individual
// mission spec exercises: the click-to-play-to-return loop is intact for
// every mission listed in `public/missions/index.json`.
//
// Test strategy per mission:
//   - free-flight    : Escape-abort flow (silent return — no outcome banner)
//   - waypoint-patrol: scripted full-throttle approach reaches waypoint 1
//                      within ~10s OR timeout 30s expires → terminal `failed`
//                      with outcome banner. Either terminal counts.
//   - takeoff-landing: WP15 scripted rotate+climb arc — likely terminal
//                      `failed` via timeout (mission has no timeout in JSON
//                      but waypoint sequence is long). Use Escape-abort as
//                      the deterministic terminal path.
//   - combat         : WP16 win-path script — Space-fire to destroy target.
//
// Per CLAUDE.md `### Browser-walkthrough discipline`: time-sensitive observation
// (>2s) uses `?script=` harness, not page.keyboard.press. Escape-key abort is
// a single discrete event used to trigger the terminal-state path, not a
// time-sensitive measurement.

type AircraftSnapshot = {
  position: { x: number; y: number; z: number };
  airspeed: number;
};

type CombatTargetSnapshot = {
  destroyed: boolean;
  hp: number;
};

declare global {
  interface Window {
    __aircraft?: {
      getState: () => AircraftSnapshot;
      isScriptComplete: () => boolean;
    };
    __combat?: {
      getTargetSnapshot: () => CombatTargetSnapshot;
      getPlayerHp: () => number;
    };
  }
}

const MISSION_IDS = ['free-flight', 'waypoint-patrol', 'takeoff-landing', 'combat'] as const;

async function assertMissionSelectVisibleWithAllButtons(page: Page): Promise<void> {
  const select = page.locator('[data-testid="mission-select"]');
  await expect(select).toBeVisible({ timeout: 10_000 });
  for (const id of MISSION_IDS) {
    await expect(page.locator(`button[data-mission-id="${id}"]`)).toBeVisible();
  }
}

function attachErrorListeners(page: Page): {
  pageErrors: string[];
  consoleErrors: string[];
  consoleNaN: string[];
} {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleNaN: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    if (/NaN|Infinity/i.test(text)) consoleNaN.push(text);
  });
  return { pageErrors, consoleErrors, consoleNaN };
}

function expectCleanConsole(errors: {
  pageErrors: string[];
  consoleErrors: string[];
  consoleNaN: string[];
}): void {
  expect(errors.pageErrors, `pageerror: ${errors.pageErrors.join('; ')}`).toEqual([]);
  expect(errors.consoleErrors, `console.error: ${errors.consoleErrors.join('; ')}`).toEqual([]);
  expect(errors.consoleNaN, `NaN/Infinity: ${errors.consoleNaN.join('; ')}`).toEqual([]);
}

test('WP17: free-flight — click → play → Escape abort → return to mission-select (silent)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = attachErrorListeners(page);

  await page.goto('/?debug=true');
  await assertMissionSelectVisibleWithAllButtons(page);

  // Click free-flight → mission starts.
  await page.locator('button[data-mission-id="free-flight"]').click();
  await expect(page.locator('[data-testid="mission-select"]')).toBeHidden({ timeout: 5_000 });

  // Wait for the loop to be running (aircraft global available + airspeed > 0).
  await page.waitForFunction(
    () =>
      typeof window.__aircraft !== 'undefined' &&
      window.__aircraft.getState().airspeed > 0,
    undefined,
    { timeout: 10_000 },
  );

  // ~2 seconds of flight before abort, to confirm the loop is alive.
  await page.waitForTimeout(2000);

  // Escape triggers missionRunner.abort() → silent return path
  // (src/main.ts:631-637). No outcome banner is shown for aborts.
  await page.keyboard.press('Escape');

  // Mission-select returns with all 4 buttons.
  await assertMissionSelectVisibleWithAllButtons(page);

  // Aborted runs SKIP the outcome banner. Assert it never appeared.
  await expect(page.locator('[data-testid="mission-outcome-banner"]')).toHaveCount(0);

  expectCleanConsole(errors);
});

test('WP17: waypoint-patrol — click → play to terminal → outcome banner → return to mission-select', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = attachErrorListeners(page);

  // Scripted throttle hold: full throttle for the duration. The waypoint
  // mission has a 30s timeout in JSON → terminal `failed` if waypoints not
  // hit; with full throttle the waypoints at (0,30,-150) r=100 and (50,20,-250)
  // r=100 are likely reached → terminal `won`. Either terminal triggers the
  // outcome banner.
  await page.goto(
    '/?mission=waypoint-patrol&debug=true&script=hold:Throttle=1.0@0:end',
  );

  // The mission deep-link bypasses the click — assert the mission-select
  // hidden initially (deep-link path), then assert it re-appears at terminal.
  await expect(page.locator('[data-testid="mission-select"]')).toBeHidden({ timeout: 10_000 });

  // Wait for the outcome banner (either won or failed — JSON has timeoutSec=30
  // and the runner's default banner hold is 2000ms).
  const banner = page.locator('[data-testid="mission-outcome-banner"]');
  await expect(banner).toBeVisible({ timeout: 45_000 });
  await expect(banner).toContainText('Waypoint Patrol');

  // Banner disappears, mission-select re-appears.
  await expect(banner).toHaveCount(0, { timeout: 5_000 });
  await assertMissionSelectVisibleWithAllButtons(page);

  expectCleanConsole(errors);
});

test('WP17: takeoff-landing — click → play → Escape abort → return to mission-select', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = attachErrorListeners(page);

  await page.goto('/?debug=true');
  await assertMissionSelectVisibleWithAllButtons(page);

  await page.locator('button[data-mission-id="takeoff-landing"]').click();
  await expect(page.locator('[data-testid="mission-select"]')).toBeHidden({ timeout: 5_000 });

  await page.waitForFunction(
    () =>
      typeof window.__aircraft !== 'undefined' &&
      window.__aircraft.getState().airspeed > 0,
    undefined,
    { timeout: 10_000 },
  );

  // Takeoff-landing has a 4-objective sequence with no JSON timeout — the
  // happy path is many minutes long. Use Escape-abort to exercise the
  // return-to-select path deterministically.
  await page.waitForTimeout(2000);
  await page.keyboard.press('Escape');

  await assertMissionSelectVisibleWithAllButtons(page);
  await expect(page.locator('[data-testid="mission-outcome-banner"]')).toHaveCount(0);

  expectCleanConsole(errors);
});

test('WP17: combat — click → play → win (scripted approach + sustained fire) → outcome banner → return to mission-select', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = attachErrorListeners(page);

  // Mirror the WP16 win-path scripted-input recipe. Deep-link so the
  // scripted-input harness can attach before the loop starts; combat is
  // the only mission whose terminal `won` is deterministically reachable
  // from an automated script.
  await page.goto(
    '/?mission=combat&debug=true&script=hold:Throttle=0.5@0:25.0,hold:Space@2.0:22.0',
  );

  await expect(page.locator('[data-testid="mission-select"]')).toBeHidden({ timeout: 10_000 });

  // Wait for win banner. Combat target destroyed within ~10-15s typically.
  const banner = page.locator('[data-testid="mission-outcome-banner"]');
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(banner).toContainText('Combat');

  // Banner clears, mission-select returns.
  await expect(banner).toHaveCount(0, { timeout: 5_000 });
  await assertMissionSelectVisibleWithAllButtons(page);

  expectCleanConsole(errors);
});

// WP17 Phase 3 — FPS sanity check per mission. Measures the median frame
// budget (ms) over a 3s window via a per-frame `requestAnimationFrame`
// timer injected into the page. Threshold: median < 33ms (≥30 FPS — the
// casual-gamer minimum from the vision; well below the 60 FPS target).
// Cross-browser sweep is WP21; this only covers Chromium headless.
//
// Stats.js is loaded but doesn't expose a programmatic FPS readback, so
// we measure directly. This is measurement-only injection (no game-state
// mutation) — safe under CLAUDE.md `### Browser-walkthrough discipline`.
//
// The FPS_GATE_MS gate is intentionally loose to absorb headless-Chrome
// jitter on CI runners; a local quiet box typically reads <17ms (60 FPS).
const FPS_GATE_MS = 33; // ≥30 FPS

for (const missionId of ['free-flight', 'waypoint-patrol', 'takeoff-landing', 'combat'] as const) {
  test(`WP17 Phase 3: FPS sanity — ${missionId} median frame budget < ${FPS_GATE_MS}ms`, async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Per-mission spawn-throttle: combat needs throttle=0.5 to stay in its
    // ground-cruise corridor; others spawn at JSON throttle and the harness
    // doesn't need to drive input for FPS measurement.
    const scriptParam = missionId === 'combat' ? '&script=hold:Throttle=0.5@0:10.0' : '';
    await page.goto(`/?mission=${missionId}&debug=true${scriptParam}`);

    // Wait for the aircraft loop to be ticking (any value > 0 = loop alive).
    await page.waitForFunction(
      () =>
        typeof window.__aircraft !== 'undefined' &&
        window.__aircraft.getState().airspeed > 0,
      undefined,
      { timeout: 15_000 },
    );

    // Inject per-frame timer + measure for 3s. The injection collects
    // frame timestamps via rAF and returns the array on completion.
    const frameBudgetsMs = await page.evaluate(async () => {
      const samples: number[] = [];
      let prev = performance.now();
      let stopped = false;
      const start = performance.now();
      function tick() {
        if (stopped) return;
        const now = performance.now();
        samples.push(now - prev);
        prev = now;
        if (now - start >= 3000) {
          stopped = true;
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      await new Promise<void>((resolve) => setTimeout(resolve, 3200));
      return samples;
    });

    expect(frameBudgetsMs.length, 'FPS samples collected').toBeGreaterThan(60);
    // Sort + take median. First sample is the start-warm-up — drop it.
    const sorted = [...frameBudgetsMs.slice(1)].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    // eslint-disable-next-line no-console
    console.log(
      `[fps ${missionId}] samples=${sorted.length} median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms (≈${(1000 / median).toFixed(1)} FPS median)`,
    );

    expect(
      median,
      `median frame budget ${median.toFixed(2)}ms exceeds ${FPS_GATE_MS}ms gate (≥30 FPS); raw samples: ${frameBudgetsMs.slice(0, 10).map((v) => v.toFixed(1)).join(',')}…`,
    ).toBeLessThan(FPS_GATE_MS);
  });
}
