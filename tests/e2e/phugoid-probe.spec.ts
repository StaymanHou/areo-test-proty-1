import { test, expect } from '@playwright/test';

// WP14.5 — ≥30s phugoid probe at throttle ∈ {0.05, 0.15, 0.4}. The arch.md
// Rev 2026-05-12 D13 verification gate for the β5 (`clAlphaDot`) tuning pass.
//
// Refactored 2026-06-06 (SURFACE-2026-06-06-05): uses the scripted-input
// harness instead of `getState()` polling. Per-tick log replaces 30 ×
// page.waitForTimeout(1000) samples. The harness latches a byte-stable log
// when isScriptComplete() first returns true, so the assertions read the
// full ~60s flight deterministically.
//
// Prior context preserved for archaeology:
// SKIPPED 2026-05-12 per WP14.5 disposition (SURFACE-2026-05-12-03 — β5
// mechanism diverged at every tuning value tried; needed non-dim form).
// UN-SKIPPED 2026-05-25 at WP14.19 Phase 4 after the D14→D26 cascade
// (fix-resetforces-bug + D24+D25+D26 architect cycles) resolved the
// underlying integrator + score-function defects.

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
      getScriptedLog: () => ScriptedLogRow[];
      isScriptComplete: () => boolean;
    };
  }
}

// Generous OUTER envelope — never-exceed guard. The point is no NaN + no runaway.
const MAX_ABS_ALTITUDE_M = 5_000;
const MAX_AIRSPEED_M_PER_S = 200;
const MAX_ABS_PITCH_DEG = 180;

// WP17 Phase 2 — per-probe spawn-relative phugoid envelopes. Tighter inner gates
// than the outer never-exceed values above, sized to ≥1.5× the WP17 baseline run
// captured 2026-06-07. Spawn alt = 50m (mission JSON), initial pitch ≈ 0°.
//
// Baseline (2026-06-07): low → maxAbsAltDelta=59m maxPitch=18°
//                        mid → maxAbsAltDelta=59m maxPitch=18°
//                        high→ maxAbsAltDelta=142m maxPitch=14.4°
//
// Codifies arch.md D13 phugoid-damping coverage. If these envelopes regress, the
// β5 (`clAlphaDot`) damping tune has shifted and needs to be re-examined.
for (const probe of [
  { id: 'phugoid-probe-low', throttle: 0.05, maxAltDeltaM: 100, maxPitchDeltaDeg: 27 },
  { id: 'phugoid-probe-mid', throttle: 0.15, maxAltDeltaM: 100, maxPitchDeltaDeg: 27 },
  { id: 'phugoid-probe-high', throttle: 0.4, maxAltDeltaM: 250, maxPitchDeltaDeg: 30 },
]) {
  test(`phugoid probe @ throttle=${probe.throttle}: 60s bounded, no NaN`, async ({ page }) => {
    // `@0:end` fills the 3600-tick log buffer (60s @ 60Hz of physics wall-clock);
    // plus Vite cold start + Chromium boot. 150s gives comfortable headroom.
    test.setTimeout(150_000);

    await page.goto(
      `/?mission=${probe.id}&debug=true&script=hold:Throttle=${probe.throttle}@0:end`,
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
      { timeout: 120_000 },
    );

    const log = await page.evaluate(() => window.__aircraft!.getScriptedLog());

    expect(log.length).toBeGreaterThan(60); // sanity — at least ~1s recorded

    // WP17 Phase 2 — spawn-relative baselines for the tighter envelope gates.
    const spawnAlt = log[0]!.position.y;
    const initialPitch = log[0]!.pitch_deg;

    // Scan ALL rows (not 30 samples), so transient runaways can't slip between samples.
    let maxAbsAlt = 0;
    let maxAS = 0;
    let maxAbsPitch = 0;
    let maxAbsAltDelta = 0;
    let maxAbsPitchDelta = 0;
    for (const r of log) {
      if (
        !Number.isFinite(r.position.y) ||
        !Number.isFinite(r.AS_mps) ||
        !Number.isFinite(r.pitch_deg)
      ) {
        throw new Error(
          `non-finite state at tick ${r.tick} (t≈${r.t_sec.toFixed(2)}s): alt=${r.position.y} AS=${r.AS_mps} pitch=${r.pitch_deg}`,
        );
      }
      const absAlt = Math.abs(r.position.y);
      const absPitch = Math.abs(r.pitch_deg);
      const absAltDelta = Math.abs(r.position.y - spawnAlt);
      const absPitchDelta = Math.abs(r.pitch_deg - initialPitch);
      if (absAlt > maxAbsAlt) maxAbsAlt = absAlt;
      if (r.AS_mps > maxAS) maxAS = r.AS_mps;
      if (absPitch > maxAbsPitch) maxAbsPitch = absPitch;
      if (absAltDelta > maxAbsAltDelta) maxAbsAltDelta = absAltDelta;
      if (absPitchDelta > maxAbsPitchDelta) maxAbsPitchDelta = absPitchDelta;
    }

    // Coarse-grained sampling for the diagnostic log only — every ~1s, mirrors
    // the pre-refactor output so historical baselines stay comparable.
    const stride = Math.max(1, Math.floor(log.length / 30));
    const altSamples: number[] = [];
    const asSamples: number[] = [];
    for (let i = 0; i < log.length; i += stride) {
      altSamples.push(log[i]!.position.y);
      asSamples.push(log[i]!.AS_mps);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[probe throttle=${probe.throttle}] ticks=${log.length} maxAbsAlt=${maxAbsAlt.toFixed(1)}m maxAS=${maxAS.toFixed(1)}m/s maxAbsPitch=${maxAbsPitch.toFixed(1)}° | spawnAlt=${spawnAlt.toFixed(1)}m initialPitch=${initialPitch.toFixed(1)}° maxAbsAltDelta=${maxAbsAltDelta.toFixed(1)}m maxAbsPitchDelta=${maxAbsPitchDelta.toFixed(1)}°`,
    );
    // eslint-disable-next-line no-console
    console.log(`  alt samples: ${altSamples.map((v) => v.toFixed(0)).join(',')}`);
    // eslint-disable-next-line no-console
    console.log(`  AS  samples: ${asSamples.map((v) => v.toFixed(0)).join(',')}`);

    expect(maxAbsAlt, `|altitude| exceeded ${MAX_ABS_ALTITUDE_M}m at some tick`).toBeLessThan(
      MAX_ABS_ALTITUDE_M,
    );
    expect(maxAS, `airspeed exceeded ${MAX_AIRSPEED_M_PER_S}m/s at some tick`).toBeLessThan(
      MAX_AIRSPEED_M_PER_S,
    );
    expect(
      maxAbsPitch,
      `|pitch| exceeded ${MAX_ABS_PITCH_DEG}° at some tick (gimbal flip?)`,
    ).toBeLessThanOrEqual(MAX_ABS_PITCH_DEG);

    // WP17 Phase 2 — tighter spawn-relative phugoid envelope gates.
    expect(
      maxAbsAltDelta,
      `|alt − spawn| exceeded ${probe.maxAltDeltaM}m envelope (spawn=${spawnAlt.toFixed(1)}m)`,
    ).toBeLessThan(probe.maxAltDeltaM);
    expect(
      maxAbsPitchDelta,
      `|pitch − initial| exceeded ${probe.maxPitchDeltaDeg}° envelope (initial=${initialPitch.toFixed(1)}°)`,
    ).toBeLessThan(probe.maxPitchDeltaDeg);
  });
}
