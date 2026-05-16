import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PARITY_FIXTURES, type ParityFixture } from '../parity-fixtures';

// Parity-test browser emitter. Loads `/?debug=true&mission=free-flight`
// to get a `window.__aircraft.runFixture()` hook, drives one or more fixtures
// deterministically, writes the resulting trajectory CSVs to
// `test-results/` so `tests/parity-diff.test.ts` (Vitest) can diff them
// against the synthetic-stub-then-Node-harness side.
//
// Fixtures are defined in `tests/parity-fixtures.ts` and consumed in lockstep
// by this spec, `parity-diff.test.ts`, and `tools/tune/harness.ts`. WP14.7
// extended coverage from mid-only to low/mid/high per
// `feedback_verify_self_envelope.md`.

type TrajectoryRow = {
  tick: number;
  posX: number; posY: number; posZ: number;
  vX: number; vY: number; vZ: number;
  pitch: number; yaw: number; roll: number;
  airspeed: number;
};

declare global {
  interface Window {
    __aircraft?: {
      runFixture: (f: {
        position: { x: number; y: number; z: number };
        linvel: { x: number; y: number; z: number };
        throttle: number;
        ticks: number;
      }) => TrajectoryRow[];
    };
  }
}

function trajectoryToCsv(rows: TrajectoryRow[]): string {
  const header = 'tick,posX,posY,posZ,vX,vY,vZ,pitch,yaw,roll,airspeed';
  const lines = rows.map(
    (r) => `${r.tick},${r.posX},${r.posY},${r.posZ},${r.vX},${r.vY},${r.vZ},${r.pitch},${r.yaw},${r.roll},${r.airspeed}`,
  );
  return [header, ...lines].join('\n') + '\n';
}

for (const fixture of PARITY_FIXTURES) {
  test(`parity emitter @ ${fixture.id}: runFixture produces ${fixture.ticks}-row trajectory CSV`, async ({ page }) => {
    await page.goto('/?mission=free-flight&debug=true');
    await page.waitForFunction(
      () => typeof window.__aircraft !== 'undefined' && typeof window.__aircraft.runFixture === 'function',
      undefined,
      { timeout: 20_000 },
    );

    const fixtureForBrowser: ParityFixture = fixture;
    const rows = await page.evaluate<TrajectoryRow[], ParityFixture>(
      (f) => window.__aircraft!.runFixture(f),
      fixtureForBrowser,
    );

    expect(rows.length).toBe(fixture.ticks);
    // Tick column must be monotonic 0..ticks-1
    expect(rows[0].tick).toBe(0);
    expect(rows[rows.length - 1].tick).toBe(fixture.ticks - 1);

    // Persist CSV for the Vitest parity-diff to consume.
    const outDir = path.resolve('test-results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `browser-trajectory-${fixture.id}.csv`);
    fs.writeFileSync(outPath, trajectoryToCsv(rows), 'utf-8');
  });
}
