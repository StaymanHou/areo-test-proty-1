// WP26 — Master-volume slider: end-to-end coverage for the integration
// boundary between the slider on the mission-select screen, the AudioEngine
// (real-time `setMasterGain` apply), and the persisted-boot path. Unit tests
// cover the pure logic (`src/audio/master-volume.test.ts`, slider rendering
// in `src/mission/select.test.ts`); this spec exercises the live page.

import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __audio?: {
      getState: () => {
        contextState: string;
        engineFreqHz: number;
        engineGain: number;
        windGain: number;
        windCutoffHz: number;
        masterGain: number;
      };
    };
  }
}

const STORAGE_KEY = 'flightsim.volume.master';

test('mission-select renders the master-volume slider with default value 0.5', async ({ page }) => {
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="mission-select"]', { timeout: 20_000 });

  const slider = page.locator('input[data-testid="master-volume-slider"]');
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute('type', 'range');
  await expect(slider).toHaveValue('0.5');

  const valueLabel = page.locator('[data-testid="master-volume-value"]');
  await expect(valueLabel).toHaveText('50%');
});

test('dragging the slider applies in real time and persists to localStorage', async ({ page }) => {
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="master-volume-slider"]', { timeout: 20_000 });

  // Set the slider value + dispatch input event (Playwright's `fill` on a
  // range input does this via the real input handler).
  await page.locator('input[data-testid="master-volume-slider"]').evaluate((el: HTMLInputElement) => {
    el.value = '0.8';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // localStorage write fired synchronously inside the input handler.
  const storageValue = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  expect(Number(storageValue)).toBeCloseTo(0.8, 5);

  await expect(page.locator('[data-testid="master-volume-value"]')).toHaveText('80%');
});

test('persisted master volume is honored on reload (boot-from-storage)', async ({ page }) => {
  // First load: set the value via the slider, then reload.
  await page.goto('/?debug=true');
  await page.waitForSelector('[data-testid="master-volume-slider"]', { timeout: 20_000 });

  await page.locator('input[data-testid="master-volume-slider"]').evaluate((el: HTMLInputElement) => {
    el.value = '0.25';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Reload — AudioEngine constructor reads getMasterVolume() at boot.
  await page.reload();
  await page.waitForSelector('[data-testid="master-volume-slider"]', { timeout: 20_000 });

  // Slider initial value reflects the persisted choice.
  await expect(page.locator('input[data-testid="master-volume-slider"]')).toHaveValue('0.25');
  await expect(page.locator('[data-testid="master-volume-value"]')).toHaveText('25%');

  // User-gesture click resumes the AudioContext so __audio.getState() reflects
  // a running master gain node (the boot path applies `_masterGainValue` to
  // the master node when start() creates the context).
  await page.click('body');

  // Read master gain from the live audio engine. The constructor read
  // getMasterVolume()=0.25 at boot; start() applies that to the master node.
  await expect
    .poll(
      async () =>
        await page.evaluate(() => (window.__audio?.getState().masterGain ?? -1)),
      { timeout: 5_000 },
    )
    .toBeCloseTo(0.25, 2);
});
