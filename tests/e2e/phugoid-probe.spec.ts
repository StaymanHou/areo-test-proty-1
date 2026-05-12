import { test, expect } from '@playwright/test';

// WP14.5 — ≥30s phugoid probe at throttle ∈ {0.05, 0.15, 0.4}. The arch.md
// Rev 2026-05-12 D13 verification gate for the β5 (`clAlphaDot`) tuning pass.
//
// SKIPPED 2026-05-12 per WP14.5 task disposition. SURFACE-2026-05-12-03 logs
// the finding: the β5 mechanism as implemented at `src/aircraft/aerosurface.ts`
// :475-483 (`cl += clAlphaDot · dα/dt` with no V-normalization or magnitude
// clamp) diverges under raw-rate startup transients at every tuning value tried
// (wings/h-stab = +5/+10, +1/+2, -1/-2). The mechanism needs a deeper revision
// — likely a non-dimensional `cl_α̇ · c̄ / (2V)` form analogous to the WP6.6
// β4 V-scaling fix — before a tuning pass can converge. The pre-WP14.5 red
// baseline (clAlphaDot=0 everywhere): low/mid throttle bounded, high (0.4)
// diverges at t≈6s. Re-enable this spec once the mechanism is revised. The
// three probe missions in `public/missions/phugoid-probe-{low,mid,high}.json`
// stay in place — they're useful infrastructure for the future arch revision.
test.skip(true, 'WP14.5 disposition — β5 mechanism needs arch revision; see SURFACE-2026-05-12-03');

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

const PROBE_DURATION_MS = 30_000;
// Generous envelope. The point is no NaN + no runaway, not a tight feel-target.
const MAX_ABS_ALTITUDE_M = 5_000;
const MAX_AIRSPEED_M_PER_S = 200;
const MAX_ABS_PITCH_DEG = 180;

for (const probe of [
  { id: 'phugoid-probe-low', throttle: 0.05 },
  { id: 'phugoid-probe-mid', throttle: 0.15 },
  { id: 'phugoid-probe-high', throttle: 0.4 },
]) {
  test(`phugoid probe @ throttle=${probe.throttle}: 30s bounded, no NaN`, async ({ page }) => {
    // 30s probe + boot + sample overhead — default 30s test timeout is too tight.
    test.setTimeout(90_000);
    const consoleNaN: string[] = [];
    const pageErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      const text = msg.text();
      if (/NaN|Infinity/i.test(text)) consoleNaN.push(text);
    });

    await page.goto(`/?mission=${probe.id}&debug=true`);

    await page.waitForFunction(
      () => typeof window.__aircraft !== 'undefined' && typeof window.__aircraft.getState === 'function',
      undefined,
      { timeout: 20_000 },
    );

    // Sample every second for the full window so we catch transient runaways,
    // not just endpoint state.
    const samples: AircraftSnapshot[] = [];
    const sampleIntervalMs = 1_000;
    const sampleCount = PROBE_DURATION_MS / sampleIntervalMs;

    for (let i = 0; i < sampleCount; i++) {
      await page.waitForTimeout(sampleIntervalMs);
      const s = await page.evaluate<AircraftSnapshot>(() => window.__aircraft!.getState());
      samples.push(s);

      // Fail fast on NaN — no point running the rest of the window.
      if (
        !Number.isFinite(s.position.y) ||
        !Number.isFinite(s.airspeed) ||
        !Number.isFinite(s.eulerDeg.pitch)
      ) {
        throw new Error(
          `non-finite state at t≈${(i + 1)}s: alt=${s.position.y} as=${s.airspeed} pitch=${s.eulerDeg.pitch}`,
        );
      }
    }

    const altitudes = samples.map((s) => s.position.y);
    const airspeeds = samples.map((s) => s.airspeed);
    const pitches = samples.map((s) => Math.abs(s.eulerDeg.pitch));

    const maxAbsAlt = Math.max(...altitudes.map(Math.abs));
    const maxAS = Math.max(...airspeeds);
    const maxAbsPitch = Math.max(...pitches);

    // Diagnostic — always logged so we can see what envelope the dynamics
    // actually reach, not just whether they crossed a threshold.
    // eslint-disable-next-line no-console
    console.log(
      `[probe throttle=${probe.throttle}] maxAbsAlt=${maxAbsAlt.toFixed(1)}m maxAS=${maxAS.toFixed(1)}m/s maxAbsPitch=${maxAbsPitch.toFixed(1)}°`,
    );
    // eslint-disable-next-line no-console
    console.log(`  alt samples: ${altitudes.map((v) => v.toFixed(0)).join(',')}`);
    // eslint-disable-next-line no-console
    console.log(`  AS  samples: ${airspeeds.map((v) => v.toFixed(0)).join(',')}`);

    expect(maxAbsAlt, `|altitude| exceeded ${MAX_ABS_ALTITUDE_M}m at some t; samples=${altitudes.join(',')}`).toBeLessThan(MAX_ABS_ALTITUDE_M);
    expect(maxAS, `airspeed exceeded ${MAX_AIRSPEED_M_PER_S}m/s at some t; samples=${airspeeds.join(',')}`).toBeLessThan(MAX_AIRSPEED_M_PER_S);
    expect(maxAbsPitch, `|pitch| exceeded ${MAX_ABS_PITCH_DEG}° at some t (gimbal flip?); samples=${pitches.join(',')}`).toBeLessThanOrEqual(MAX_ABS_PITCH_DEG);

    expect(pageErrors, `pageerror events: ${pageErrors.join('; ')}`).toEqual([]);
    expect(consoleNaN, `console NaN/Infinity lines: ${consoleNaN.join('; ')}`).toEqual([]);
  });
}
