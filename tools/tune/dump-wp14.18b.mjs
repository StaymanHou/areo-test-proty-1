// WP14.18b — dump symmetric-mirror CSVs at the WP14.18b post-integrator-fix globalBest.
// Reads from tools/tune/results/wp14.18b-postfix-tune.json; emits to /tmp/wp14.18b.
import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import * as fs from 'node:fs';

await RAPIER.init();

const OUT_DIR = '/tmp/wp14.18b';
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = JSON.parse(fs.readFileSync('/Users/stayman/Tmp/test-proj/tools/tune/results/wp14.18b-postfix-tune.json', 'utf8'));
const best = results.params;

const knobs = {
  'surfaces.0.clQ': best['surfaces.0.clQ'],
  'surfaces.1.clQ': best['surfaces.0.clQ'],
  'surfaces.0.clAlphaDot': best['surfaces.0.clAlphaDot'],
  'surfaces.1.clAlphaDot': best['surfaces.0.clAlphaDot'],
  'surfaces.0.inducedDragK': best['surfaces.0.inducedDragK'],
  'surfaces.1.inducedDragK': best['surfaces.0.inducedDragK'],
  'surfaces.2.clQ': best['surfaces.2.clQ'],
  'surfaces.2.clAlphaDot': best['surfaces.2.clAlphaDot'],
  'surfaces.2.inducedDragK': best['surfaces.2.inducedDragK'],
  'fuselageDrag.cd0': best['fuselageDrag.cd0'],
  'fuselageDrag.area': best['fuselageDrag.area'],
};
const params = Object.entries(knobs).map(([k, v]) => `${k}=${v}`);

const regimes = [
  { regime: 'low', fixtureId: 'throttle-low' },
  { regime: 'mid', fixtureId: 'throttle-mid' },
  { regime: 'high', fixtureId: 'throttle-high' },
];

console.log('=== WP14.18b globalBest (post-integrator-fix; symmetric-mirror via explicit surfaces.1.* expansion) ===');
console.log('knobs:', JSON.stringify(knobs, null, 2));
for (const { regime, fixtureId } of regimes) {
  const fx = lookupFixture(fixtureId);
  const csv = runHarness({ fixture: fx, params, ticks: 1800 });
  const outPath = `${OUT_DIR}/sym-${regime}.csv`;
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
  console.log(`  wrote ${outPath} (${lineCount} ticks, firstNaN tick=${firstNaN === -1 ? 'none' : firstNaN})`);
}
