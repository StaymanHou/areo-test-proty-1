// WP14.19 — dump 1800-tick harness CSVs at the production aircraft.json baseline
// (clQ=3/3/8/-, no clAlphaDot, no inducedDragK, no fuselageDrag) under the new
// D24 parity-fixtures spawn-AS conditions (low/mid/high = -45/-78/-128 m/s).
// Emits to /tmp/wp14.19/baseline-{low,mid,high}.csv.
import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import * as fs from 'node:fs';

await RAPIER.init();

const OUT_DIR = '/tmp/wp14.19';
fs.mkdirSync(OUT_DIR, { recursive: true });

// Baseline: NO param overrides; the harness reads aircraft.json defaults.
// surfaces.0 wing-left clQ=3 incidence=0.0349
// surfaces.1 wing-right clQ=3 incidence=0.0349
// surfaces.2 h-stab     clQ=8 incidence=-0.0175
// surfaces.3 v-stab     (no clQ)
// no clAlphaDot per-surface; no top-level inducedDragK or fuselageDrag.
const params = [];

const regimes = [
  { regime: 'low', fixtureId: 'throttle-low' },
  { regime: 'mid', fixtureId: 'throttle-mid' },
  { regime: 'high', fixtureId: 'throttle-high' },
];

console.log('=== WP14.19 baseline (production aircraft.json, new D24 spawn-AS fixtures) ===');
for (const { regime, fixtureId } of regimes) {
  const fx = lookupFixture(fixtureId);
  const csv = runHarness({ fixture: fx, params, ticks: 1800 });
  const outPath = `${OUT_DIR}/baseline-${regime}.csv`;
  fs.writeFileSync(outPath, csv);
  const lines = csv.split('\n');
  const lineCount = lines.length - 1;
  let firstNaN = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].includes('NaN') || lines[i].includes('Infinity')) {
      firstNaN = i;
      break;
    }
  }
  console.log(`  wrote ${outPath} (${lineCount} ticks, firstNaN tick=${firstNaN === -1 ? 'none' : firstNaN}, fixture spawn AS=${Math.abs(fx.linvel.z)})`);
}
