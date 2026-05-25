// D26-ε empirical test — raise spawn altitude 50→500 and re-score at the
// current WP14.19 Phase 2 globalBest. Hypothesis: the residual -14,881 gap
// is dominated by ground impact at t=25-30s; raising spawn alt gives the
// score function a clean phugoid observation window before ground effects.
//
// Reads the wp14.19-d24-tune.json globalBest knobs; runs harness at synth
// fixtures with linvel.z=-78 (D25-ζ) + position.y=500 (D26-ε).
import { runHarness } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import { csvToTrajectory } from '/Users/stayman/Tmp/test-proj/src/aircraft/physics-core/trajectory-buffer.ts';
import { regimeScore, DEFAULT_ENVELOPES } from '/Users/stayman/Tmp/test-proj/tools/tune/score.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import * as fs from 'node:fs';

await RAPIER.init();

const results = JSON.parse(fs.readFileSync('/Users/stayman/Tmp/test-proj/tools/tune/results/wp14.19-d24-tune.json', 'utf8'));
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

console.log('=== D26-ε empirical test: spawn alt 50→500 at WP14.19 tuned globalBest ===\n');

for (const [regime, throttle] of [['low', 0.05], ['mid', 0.15], ['high', 0.40]]) {
  const fx = {
    id: `eps-${regime}`,
    position: { x: 0, y: 500, z: 0 },  // D26-ε: 50 → 500
    linvel: { x: 0, y: 0, z: -78 },     // D25-ζ unchanged
    throttle,
    ticks: 1800,
  };
  const csv = runHarness({ fixture: fx, params, ticks: 1800 });
  const rows = csvToTrajectory(csv);
  const traj = { regime, rows };
  const s = regimeScore(traj, DEFAULT_ENVELOPES);
  const t0 = rows[0], t300 = rows[300], t900 = rows[900], t1800 = rows[rows.length-1];
  console.log(`regime=${regime} throttle=${throttle}:`);
  console.log(`  t=0:    alt=${t0.posY.toFixed(1)} AS=${t0.airspeed.toFixed(1)} pitch=${(t0.pitch*180/Math.PI).toFixed(1)}°`);
  console.log(`  t=5s:   alt=${t300.posY.toFixed(1)} AS=${t300.airspeed.toFixed(1)} pitch=${(t300.pitch*180/Math.PI).toFixed(1)}°`);
  console.log(`  t=15s:  alt=${t900.posY.toFixed(1)} AS=${t900.airspeed.toFixed(1)} pitch=${(t900.pitch*180/Math.PI).toFixed(1)}°`);
  console.log(`  t=30s:  alt=${t1800.posY.toFixed(1)} AS=${t1800.airspeed.toFixed(1)} pitch=${(t1800.pitch*180/Math.PI).toFixed(1)}°`);
  console.log(`  D25-ζ envelope score: ${s.toFixed(2)}`);
}
