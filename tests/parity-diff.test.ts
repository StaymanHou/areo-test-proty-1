import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { AircraftBody } from '../src/aircraft/physics-core/rigidbody-core';
import { FlightModel } from '../src/aircraft/physics-core/flightmodel';
import { parseAircraftConfig, type AircraftConfig } from '../src/aircraft/physics-core/config';
import { step as physicsStep } from '../src/aircraft/physics-core/step';
import {
  TrajectoryBuffer,
  csvToTrajectory,
  type TrajectoryRow,
} from '../src/aircraft/physics-core/trajectory-buffer';
import { PARITY_FIXTURES, type ParityFixture } from './parity-fixtures';

// WP14.6 parity-diff. Loads the browser-emitted trajectory CSVs from
// `test-results/browser-trajectory-<id>.csv` (produced by
// `tests/e2e/parity.spec.ts`), re-runs the same fixtures through a pure-TS
// loop calling `physics-core/step()` with `AircraftBody` (no Three.js mesh),
// and diffs column-by-column.
//
// Synthetic-stub status: at WP14.6 the "Node side" of this diff is the
// in-process Vitest pure-TS loop. WP14.7 will swap it for a real `tsx
// tools/tune/harness.ts` invocation. Same physics-core entry points, same
// Rapier-WASM build → same trajectories.
//
// Tolerance: |Δ| < 1e-6 per scalar (angles use shortest-arc distance). The
// browser-side Rapier and the Node-side Rapier are the same WASM build at
// the same fixed-dt, so bit-identity is the structural expectation; the
// 1e-6 tolerance is engineering slack for any incidental f32 round-trip.

const CONFIG_PATH = path.resolve('public/config/aircraft.json');
const TEST_RESULTS_DIR = path.resolve('test-results');
const TOLERANCE = 1e-6;

let config: AircraftConfig;

beforeAll(async () => {
  await RAPIER.init();
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  config = parseAircraftConfig(raw);
});

function runSynthetic(fixture: ParityFixture): TrajectoryRow[] {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  // Match the browser's world shape — a flat ground plane at y=0 + a tower at
  // (40, 0, -250). Without those colliders, Rapier's broad phase has fewer
  // candidates to consider and the first-tick integration diverges from the
  // browser trajectory. The ground+tower together replicate the shipped world.
  // Trampoline-thin (0.001m) cuboid for the ground — matches FlatTerrain's
  // collider descriptor. Tower uses a small static cuboid like the shipped one.
  // NOTE: terrain shape constants here track src/world/terrain.ts and
  // src/world/landmarks.ts; keep them in sync until WP14.7 provides a
  // canonical "world fixture" helper that both harness and tests consume.
  const groundDesc = RAPIER.ColliderDesc.cuboid(2000, 0.001, 2000).setTranslation(0, 0, 0);
  world.createCollider(groundDesc);
  const towerDesc = RAPIER.ColliderDesc.cuboid(4, 15, 4).setTranslation(40, 15, -250);
  world.createCollider(towerDesc);

  const aircraft = new AircraftBody(world, config, {
    position: new Vector3(fixture.position.x, fixture.position.y, fixture.position.z),
    linvel: new Vector3(fixture.linvel.x, fixture.linvel.y, fixture.linvel.z),
  });
  const fm = new FlightModel(aircraft);
  const buf = new TrajectoryBuffer(fixture.ticks);
  const dt = 1 / 60;
  for (let i = 0; i < fixture.ticks; i++) {
    physicsStep(world, aircraft, fm, { throttle: fixture.throttle }, dt);
    buf.record(aircraft.readBodyState());
  }
  return buf.getRows();
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, Math.PI * 2 - d);
}

describe('parity-diff: browser-emitted trajectory == synthetic-stub trajectory', () => {
  for (const fixture of PARITY_FIXTURES) {
    it(`fixture ${fixture.id}: ${fixture.ticks}-tick trajectory matches within |Δ|<${TOLERANCE}`, () => {
      const csvPath = path.join(TEST_RESULTS_DIR, `browser-trajectory-${fixture.id}.csv`);
      if (!fs.existsSync(csvPath)) {
        // The browser-side CSV is produced by `npm run test:e2e`. If Vitest
        // runs before Playwright (e.g., in a `npm run test` only flow), the
        // file won't exist yet — skip with an explanatory log rather than
        // fail. The full pipeline (Vitest + Playwright + Vitest) will hit
        // the assertions; CI runs both.
        console.log(
          `parity-diff: ${csvPath} not present — run \`npm run test:e2e\` first to produce it. Skipping this fixture.`,
        );
        return;
      }

      const browserRows = csvToTrajectory(fs.readFileSync(csvPath, 'utf-8'));
      const syntheticRows = runSynthetic(fixture);

      expect(browserRows.length, `row count mismatch for ${fixture.id}`).toBe(syntheticRows.length);

      for (let i = 0; i < browserRows.length; i++) {
        const b = browserRows[i];
        const s = syntheticRows[i];
        expect(b.tick, `tick mismatch at row ${i}`).toBe(s.tick);

        const scalarKeys: (keyof TrajectoryRow)[] = [
          'posX', 'posY', 'posZ', 'vX', 'vY', 'vZ', 'airspeed',
        ];
        for (const k of scalarKeys) {
          const diff = Math.abs((b[k] as number) - (s[k] as number));
          expect(
            diff,
            `${fixture.id} row ${i} field ${k}: |Δ|=${diff} > ${TOLERANCE} (browser=${b[k]}, synthetic=${s[k]})`,
          ).toBeLessThan(TOLERANCE);
        }

        const angleKeys: (keyof TrajectoryRow)[] = ['pitch', 'yaw', 'roll'];
        for (const k of angleKeys) {
          const diff = angleDiff(b[k] as number, s[k] as number);
          expect(
            diff,
            `${fixture.id} row ${i} field ${k}: shortest-arc Δ=${diff} > ${TOLERANCE} (browser=${b[k]}, synthetic=${s[k]})`,
          ).toBeLessThan(TOLERANCE);
        }
      }
    });
  }
});
