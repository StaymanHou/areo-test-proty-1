import { test, expect } from '@playwright/test';

// WP19 Phase 1 — Audio engine + continuous SFX (engine loop + wind).
//
// These tests pin the integration boundary in src/main.ts that verify-self
// confirmed by hand: the AudioEngine is wired into the per-physics-tick loop
// (throttle + airspeed inputs), resumed on first user gesture (mission-select
// click OR deep-link entry), and exposed via window.__audio under ?debug=true.
//
// The browser-walkthrough discipline applies — time-sensitive observations
// (engineFreqHz responds to throttle) use the ?script= harness, not Playwright
// dispatchEvent.

type AudioState = {
  contextState: 'unset' | 'suspended' | 'running' | 'closed' | 'interrupted';
  engineFreqHz: number;
  engineGain: number;
  windGain: number;
  windCutoffHz: number;
  masterGain: number;
};

type OneShotEntry = { type: 'fire' | 'impact' | 'crash'; t_sec: number };

declare global {
  interface Window {
    __audio?: {
      getState: () => AudioState;
      getRecentOneShots: () => OneShotEntry[];
    };
    __aircraft?: {
      getState: () => unknown;
      isScriptComplete: () => boolean;
    };
  }
}

test('audio: click-path resumes AudioContext and feeds per-tick state', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });

  await page.goto('/?debug=true', { waitUntil: 'domcontentloaded' });

  // Wait for the mission-select screen — proves boot completed.
  await expect(page.locator('[data-testid="mission-select"]')).toBeVisible({
    timeout: 15_000,
  });

  // Pre-click: __audio is defined under ?debug=true but contextState is 'unset'
  // (AudioContext not created until first user gesture).
  const preClickState = await page.evaluate(() =>
    window.__audio ? window.__audio.getState() : null,
  );
  expect(preClickState).not.toBeNull();
  expect(preClickState!.contextState).toBe('unset');

  // Click the free-flight mission — this is the first user gesture, so
  // AudioEngine.start() resolves with contextState transitioning to 'running'.
  await page.locator('button[data-mission-id="free-flight"]').click();

  // Wait for the mission to start (window.__aircraft becomes available).
  await page.waitForFunction(
    () => typeof window.__aircraft?.getState === 'function',
    undefined,
    { timeout: 15_000 },
  );

  // Wait for AudioContext to resume + at least one physics tick to feed state.
  await page.waitForFunction(
    () => {
      const s = window.__audio?.getState();
      return s !== undefined && s.contextState === 'running';
    },
    undefined,
    { timeout: 5_000 },
  );

  // Settle a moment for the per-tick feed.
  await page.waitForTimeout(500);

  const postClick = (await page.evaluate(() =>
    window.__audio!.getState(),
  )) as AudioState;

  // Core contract: context running, every numeric field finite.
  expect(postClick.contextState).toBe('running');
  expect(Number.isFinite(postClick.engineFreqHz)).toBe(true);
  expect(Number.isFinite(postClick.engineGain)).toBe(true);
  expect(Number.isFinite(postClick.windGain)).toBe(true);
  expect(Number.isFinite(postClick.windCutoffHz)).toBe(true);
  expect(Number.isFinite(postClick.masterGain)).toBe(true);

  // Engine frequency ≥ idle (90 Hz). throttle starts at mission's spawn.throttle.
  expect(postClick.engineFreqHz).toBeGreaterThanOrEqual(90);
  // Aircraft spawns at V_trim ≈ 78 m/s (well above the 10 m/s wind floor),
  // so windGain MUST be strictly positive within 500ms of mission start.
  expect(postClick.windGain).toBeGreaterThan(0);

  // No console errors during the click → resume path.
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
  // Filter out the well-known Vite-client HMR deprecation noise + Chromium-
  // headless WebGL renderer messages (benign, unrelated to audio); fail on
  // any other warning of substance.
  const audioWarnings = consoleWarnings.filter(
    (w) =>
      !w.includes('using deprecated parameters for the initialization function') &&
      !w.includes('[vite]') &&
      !w.includes('GL Driver Message') &&
      !w.includes('WebGL-'),
  );
  expect(
    audioWarnings,
    `audio-related warnings: ${audioWarnings.join('; ')}`,
  ).toEqual([]);
});

test('audio: deep-link + scripted throttle-up raises engineFreqHz above idle', async ({
  page,
}) => {
  await page.goto(
    '/?debug=true&mission=free-flight&script=hold:ShiftLeft@0.5:2.5',
    { waitUntil: 'domcontentloaded' },
  );

  // Wait for the harness to land and the scripted window to complete.
  await page.waitForFunction(
    () => typeof window.__aircraft?.isScriptComplete === 'function',
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => window.__aircraft!.isScriptComplete() === true,
    undefined,
    { timeout: 30_000 },
  );

  // AudioContext should also be running by now (deep-link path calls start()).
  await page.waitForFunction(
    () => window.__audio?.getState().contextState === 'running',
    undefined,
    { timeout: 5_000 },
  );

  const state = (await page.evaluate(() =>
    window.__audio!.getState(),
  )) as AudioState;

  // ShiftLeft (throttleUp) was held for 2s, so throttle is ≈1.0. Engine
  // frequency mapping is 90→340 Hz; expect well above 200 Hz (mid throttle).
  expect(state.contextState).toBe('running');
  expect(state.engineFreqHz).toBeGreaterThan(200);
  expect(state.engineGain).toBeGreaterThan(0);

  // Free-flight stays at/above V_trim, so wind remains audible.
  expect(state.windGain).toBeGreaterThan(0);
  expect(state.windCutoffHz).toBeGreaterThan(200); // above MIN_CUTOFF
});

test('audio: __audio is not exposed in production (no ?debug=true)', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Mission-select still renders; debug accessor must NOT be defined.
  await expect(page.locator('[data-testid="mission-select"]')).toBeVisible({
    timeout: 15_000,
  });

  const hasAudio = await page.evaluate(
    () => typeof window.__audio !== 'undefined',
  );
  expect(hasAudio).toBe(false);
});

// WP19 Phase 2 — one-shot SFX triggers (fire / impact / crash).

test('audio: combat mission with scripted Space-fire records a fire one-shot', async ({
  page,
}) => {
  await page.goto(
    '/?debug=true&mission=combat&script=hold:Space@1.0:1.2',
    { waitUntil: 'domcontentloaded' },
  );

  await page.waitForFunction(
    () => typeof window.__aircraft?.isScriptComplete === 'function',
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => window.__aircraft!.isScriptComplete() === true,
    undefined,
    { timeout: 30_000 },
  );

  const oneShots = await page.evaluate(() =>
    window.__audio!.getRecentOneShots(),
  );
  // The 200ms Space hold should let combat-ai fire at least one round
  // (FIRE_COOLDOWN_SEC = 1/5 = 0.2s; first shot fires immediately upon
  // input). One or more 'fire' entries expected.
  const fires = oneShots.filter((e) => e.type === 'fire');
  expect(
    fires.length,
    `expected ≥1 fire trigger; ring=${JSON.stringify(oneShots)}`,
  ).toBeGreaterThanOrEqual(1);
});

test('audio: combat with sustained fire records ≥1 impact one-shot (projectile hits target)', async ({
  page,
}) => {
  // Combat mission spawns at (0,50,0) flying -78 m/s toward target at (0,0,-600).
  // Projectile speed = MUZZLE_SPEED(600) + aircraft.linvel.z = 678 m/s; reaches
  // the target in ≈0.9s. Hold Space for 4s; projectiles hit + destroy the
  // 3-HP target inside the window, which ends the mission ('won') and pauses
  // the physics loop before the script window completes. Wait on impacts
  // appearing in the ring buffer rather than isScriptComplete (which never
  // flips when the loop pauses on win).
  await page.goto(
    '/?debug=true&mission=combat&script=hold:Space@1.0:5.0',
    { waitUntil: 'domcontentloaded' },
  );

  await page.waitForFunction(
    () => typeof window.__audio?.getRecentOneShots === 'function',
    undefined,
    { timeout: 20_000 },
  );

  // Poll until at least one impact is recorded (or timeout).
  await page.waitForFunction(
    () => {
      const ring = window.__audio?.getRecentOneShots?.() ?? [];
      return ring.some((e) => e.type === 'impact');
    },
    undefined,
    { timeout: 15_000, polling: 200 },
  );

  const oneShots = await page.evaluate(() =>
    window.__audio!.getRecentOneShots(),
  );
  const fires = oneShots.filter((e) => e.type === 'fire');
  const impacts = oneShots.filter((e) => e.type === 'impact');

  // Sanity: shooting actually happened (each impact requires a prior fire).
  expect(
    fires.length,
    `expected ≥1 fire before any impact; ring=${JSON.stringify(oneShots)}`,
  ).toBeGreaterThanOrEqual(1);

  // The main assertion: impact trigger fires on projectile-vs-target hits.
  expect(
    impacts.length,
    `expected ≥1 impact trigger; ring=${JSON.stringify(oneShots)}`,
  ).toBeGreaterThanOrEqual(1);
});
