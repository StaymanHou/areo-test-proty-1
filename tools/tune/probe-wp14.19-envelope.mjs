// WP14.19 diagnostic — re-score the baseline harness CSVs (production aircraft.json
// at new D24 spawn-AS fixtures) under HYPOTHETICAL envelopes that cover the new
// equilibrium AS values per regime. Tests whether the residual -1e9 c0-floor is
// driven by D23 envelope mis-calibration vs by a genuine physics gap.
//
// Per arch.md D24 derivation, L=W equilibrium AS at low/mid/high throttles is
// ~45/78/128 m/s under the production baseline (no inducedDragK, no fuselageDrag).
// D23's existing per-regime mode envelopes assume the WP14.5-era spawn AS=30
// where mid throttle was the slow-flight/pattern regime. Under the new fixtures
// all three regimes spawn at level-cruise speed for their throttle, so each
// regime should be measured as level-cruise around its OWN equilibrium AS.
//
// This probe runs only `regimeScore` with mode='level-cruise' on each fixture
// (back-compat default behavior, ignoring D23 mode dispatch) plus the existing
// D23 envelope/mode dispatch result for comparison.
import * as fs from 'node:fs';
import { csvToTrajectory } from '/Users/stayman/Tmp/test-proj/src/aircraft/physics-core/trajectory-buffer.ts';
import { regimeScore, DEFAULT_ENVELOPES } from '/Users/stayman/Tmp/test-proj/tools/tune/score.ts';

const csvs = {
  low: '/tmp/wp14.19/baseline-low.csv',
  mid: '/tmp/wp14.19/baseline-mid.csv',
  high: '/tmp/wp14.19/baseline-high.csv',
};

// Per-regime target AS per D24 derivation.
const TARGET_AS = { low: 45, mid: 78, high: 128 };

// Build "all-level-cruise" envelopes: each regime is level-cruise around its
// own equilibrium AS. AS_ENVELOPE 25 m/s tolerance per the existing D21
// AS_ENVELOPE default. Override DEFAULT_ENVELOPES.regimeMode to absent so all
// regimes fall back to levelCruiseScore (per the back-compat behavior).
const allLevelCruiseEnvelopes = {
  ...DEFAULT_ENVELOPES,
  regimeMode: undefined,  // force back-compat → all regimes use levelCruiseScore
  targetAirspeed: { low: TARGET_AS.low, mid: TARGET_AS.mid, high: TARGET_AS.high },
};

console.log('=== WP14.19 envelope diagnostic: baseline @ new fixtures ===\n');
console.log('Hypothesis: under fixed integration + spawn at L=W equilibrium, all 3 regimes are at level-cruise for their throttle.');
console.log('Test: re-score baseline CSVs with regimeMode=undefined (all level-cruise) + targetAirspeed = derived equilibrium values.\n');

for (const regime of ['low', 'mid', 'high']) {
  const rows = csvToTrajectory(fs.readFileSync(csvs[regime], 'utf8'));
  const traj = { regime, rows };
  const d23Score = regimeScore(traj, DEFAULT_ENVELOPES);
  const allLCScore = regimeScore(traj, allLevelCruiseEnvelopes);
  const firstAS = rows[0]?.airspeed?.toFixed(2);
  const lastAS = rows[rows.length - 1]?.airspeed?.toFixed(2);
  const firstAlt = rows[0]?.posY?.toFixed(2);
  const lastAlt = rows[rows.length - 1]?.posY?.toFixed(2);
  console.log(`regime=${regime} target=${TARGET_AS[regime]} spawn AS=${firstAS} (final ${lastAS}); alt ${firstAlt}→${lastAlt}`);
  console.log(`  D23 mode dispatch (existing): ${d23Score.toFixed(2)}`);
  console.log(`  All-level-cruise + derived targets: ${allLCScore.toFixed(2)}`);
}
