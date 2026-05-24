// WP14.14 — dump symmetric-mirror CSVs at the WP14.14 globalBest knobs.
// All-NaN-floor restart pattern means we expect all 3 regimes NaN within seconds;
// CSVs are evidence for the SURFACE-IN escalation and the search-vs-deploy ratio
// sanity check.
import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import * as fs from 'node:fs';

await RAPIER.init();

const OUT_DIR = '/tmp/wp14.14';
fs.mkdirSync(OUT_DIR, { recursive: true });

const regimes = [
  { regime: 'low', fixtureId: 'throttle-low' },
  { regime: 'mid', fixtureId: 'throttle-mid' },
  { regime: 'high', fixtureId: 'throttle-high' },
];

// WP14.14 globalBest, with --link expansion (surfaces.0.* mirrored to surfaces.1.*)
const knobs = {
  'surfaces.0.clQ': 1.9297385401483853,
  'surfaces.1.clQ': 1.9297385401483853,
  'surfaces.0.clAlphaDot': 0,
  'surfaces.1.clAlphaDot': 0,
  'surfaces.0.inducedDragK': 2.4355146341348983,
  'surfaces.1.inducedDragK': 2.4355146341348983,
  'surfaces.2.clQ': 3.47019003698146,
  'surfaces.2.clAlphaDot': 0.9234459773594567,
  'surfaces.2.inducedDragK': 2.28898292032748,
  'fuselageDrag.cd0': 0.44339893531151625,
  'fuselageDrag.area': 15.48378633776175,
};
const params = Object.entries(knobs).map(([k, v]) => `${k}=${v}`);

console.log('=== WP14.14 globalBest (symmetric-mirror via explicit surfaces.1.* expansion) ===');
for (const { regime, fixtureId } of regimes) {
  const fx = lookupFixture(fixtureId);
  const csv = runHarness({ fixture: fx, params, ticks: 1800 });
  const outPath = `${OUT_DIR}/sym-${regime}.csv`;
  fs.writeFileSync(outPath, csv);
  const lineCount = csv.split('\n').length - 1;
  // Detect first NaN tick if any
  const lines = csv.split('\n');
  let firstNaN = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].includes('NaN') || lines[i].includes('Infinity')) {
      firstNaN = i;
      break;
    }
  }
  console.log(`  wrote ${outPath} (${lineCount} ticks, firstNaN tick=${firstNaN === -1 ? 'none' : firstNaN})`);
}
