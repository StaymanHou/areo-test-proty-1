// WP14.5-retry Phase 2B — dump per-regime CSV trajectories at two evidence
// points: (1) the optimizer's global-best params from wp14.5-retry.json (the
// worst-case "best" point — all 3 regimes NaN), and (2) the current
// aircraft.json baseline (the least-bad sampled point, still high-regime NaN).
// These CSVs are escalation evidence attached to the new SURFACE.
import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import * as fs from 'node:fs';
import * as path from 'node:path';

await RAPIER.init();

const OUT_DIR = '/Users/stayman/Tmp/test-proj/tools/tune/results';

const regimes = [
  { regime: 'low', fixtureId: 'throttle-low' },
  { regime: 'mid', fixtureId: 'throttle-mid' },
  { regime: 'high', fixtureId: 'throttle-high' },
];

async function dumpAt(label, overridesObj, prefix) {
  const params = Object.entries(overridesObj).map(([k, v]) => `${k}=${v}`);
  console.log(`=== ${label} ===`);
  for (const { regime, fixtureId } of regimes) {
    const fx = lookupFixture(fixtureId);
    const csv = runHarness({ fixture: fx, params, ticks: 1800 });
    const outPath = path.join(OUT_DIR, `${prefix}-${regime}.csv`);
    fs.writeFileSync(outPath, csv);
    const lineCount = csv.split('\n').length - 1;
    console.log(`  wrote ${outPath} (${lineCount} lines including header)`);
  }
}

// Optimizer global best
await dumpAt(
  'optimizer-global-best (from wp14.5-retry.json)',
  {
    'surfaces.0.clQ': 12.022075038403273,
    'surfaces.0.clAlphaDot': 3.44871676992625,
    'surfaces.2.clQ': 17.049315869808197,
    'surfaces.2.clAlphaDot': 10.09202124318108,
  },
  'wp14.5-retry-traj-best',
);

// Current aircraft.json baseline
await dumpAt(
  'baseline (current aircraft.json — clQ=3,8; clAlphaDot=0,0)',
  {
    'surfaces.0.clQ': 3,
    'surfaces.0.clAlphaDot': 0,
    'surfaces.2.clQ': 8,
    'surfaces.2.clAlphaDot': 0,
  },
  'wp14.5-retry-traj-baseline',
);
