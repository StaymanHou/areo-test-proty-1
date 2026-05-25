// WP14.19 — control regime per CLAUDE.md Rule #4: all post-fix mechanism knobs
// zeroed (clQ=0 per-surface, no clAlphaDot, no inducedDragK, no fuselageDrag).
// Compared to baseline + tuned, this disambiguates "the mechanism stack is doing
// something useful" vs "the result is dominated by other factors."
//
// Emits to /tmp/wp14.19/control-{low,mid,high}.csv.
import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import * as fs from 'node:fs';

await RAPIER.init();

const OUT_DIR = '/tmp/wp14.19';
fs.mkdirSync(OUT_DIR, { recursive: true });

// Control: explicitly zero every mechanism knob (β4, β5, D18 drag polar).
const knobs = {
  'surfaces.0.clQ': 0,
  'surfaces.1.clQ': 0,
  'surfaces.2.clQ': 0,
  'surfaces.0.clAlphaDot': 0,
  'surfaces.1.clAlphaDot': 0,
  'surfaces.2.clAlphaDot': 0,
  'surfaces.0.inducedDragK': 0,
  'surfaces.1.inducedDragK': 0,
  'surfaces.2.inducedDragK': 0,
  'fuselageDrag.cd0': 0,
  'fuselageDrag.area': 0,
};
const params = Object.entries(knobs).map(([k, v]) => `${k}=${v}`);

const regimes = [
  { regime: 'low', fixtureId: 'throttle-low' },
  { regime: 'mid', fixtureId: 'throttle-mid' },
  { regime: 'high', fixtureId: 'throttle-high' },
];

console.log('=== WP14.19 control regime (all mechanism knobs zeroed) ===');
for (const { regime, fixtureId } of regimes) {
  const fx = lookupFixture(fixtureId);
  const csv = runHarness({ fixture: fx, params, ticks: 1800 });
  const outPath = `${OUT_DIR}/control-${regime}.csv`;
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
