// Score harness CSVs as a deployed (symmetric-mirror) airframe.
//
// The optimizer in `tune.ts` tunes a knob set the operator specifies. If the
// operator-deployable configuration enforces a constraint (e.g. wing-left ==
// wing-right) that the optimizer does NOT enforce during search (because the
// tune CLI has no native knob-linking), the optimizer's reported score reflects
// the unconstrained search-space airframe, NOT the deployed airframe. This
// utility closes that gap: run the harness with the mirroring constraint
// applied, then feed those CSVs through this script to compute the score the
// deployed airframe would actually receive.
//
// First fired by WP14.11 (joint clQ/clAlphaDot tune) where surfaces.0 + .2
// were knobs but surfaces.1 mirrored surfaces.0 in production; see
// SURFACE-2026-05-23-01 for the search-vs-deploy gap.
//
// Usage: tsx tools/tune/score-deployed.mjs <low.csv> <mid.csv> <high.csv>

import * as fs from 'node:fs';
import { csvToTrajectory } from '../../src/aircraft/physics-core/trajectory-buffer.ts';
import { score, DEFAULT_ENVELOPES, regimeScore } from './score.ts';

const [, , lowCsv, midCsv, highCsv] = process.argv;
if (!lowCsv || !midCsv || !highCsv) {
  console.error('usage: node score-deployed.mjs <low.csv> <mid.csv> <high.csv>');
  process.exit(1);
}

const trajectories = [
  { regime: 'low', rows: csvToTrajectory(fs.readFileSync(lowCsv, 'utf8')) },
  { regime: 'mid', rows: csvToTrajectory(fs.readFileSync(midCsv, 'utf8')) },
  { regime: 'high', rows: csvToTrajectory(fs.readFileSync(highCsv, 'utf8')) },
];

console.log('Per-regime scores:');
for (const t of trajectories) {
  console.log(`  ${t.regime}: rows=${t.rows.length} score=${regimeScore(t, DEFAULT_ENVELOPES).toFixed(2)}`);
}
const total = score(trajectories, DEFAULT_ENVELOPES);
console.log(`Total (weighted sum, default envelopes): ${total.toFixed(2)}`);
