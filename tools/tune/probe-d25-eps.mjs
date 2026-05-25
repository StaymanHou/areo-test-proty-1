// D25 architect cycle — empirical test of D25-ε hypothesis: spawn all 3 regimes
// at L=W trim AS (78 m/s) instead of D24's per-throttle T=D-derived spawn
// (45/78/128). Per Rule #5 independent derivation: L=W equilibrium AS for this
// airframe is determined by W/S/ρ/CL_at_trim_α, NOT by throttle. Throttle
// determines whether the airframe accelerates / cruises / decelerates from L=W,
// i.e., climbs / cruises / descends.
//
// Test: re-run the harness with spawn linvel.z = -78 for all 3 throttles
// (overriding the parity-fixture's per-regime spawn AS) and score under both
// D23 mode-dispatch envelopes and "all-level-cruise + target=78" envelopes.
import { runHarness } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import { csvToTrajectory } from '/Users/stayman/Tmp/test-proj/src/aircraft/physics-core/trajectory-buffer.ts';
import { regimeScore, DEFAULT_ENVELOPES } from '/Users/stayman/Tmp/test-proj/tools/tune/score.ts';
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

// Synthetic fixtures: same throttle as D24 fixtures, but spawn AS uniformly = 78.
const synthFx = (regime, throttle) => ({
  id: `eps-${regime}`,
  position: { x: 0, y: 50, z: 0 },
  linvel: { x: 0, y: 0, z: -78 },
  throttle,
  ticks: 1800,
});

const regimes = [
  { regime: 'low', fx: synthFx('low', 0.05) },
  { regime: 'mid', fx: synthFx('mid', 0.15) },
  { regime: 'high', fx: synthFx('high', 0.40) },
];

console.log('=== D25-ε: all 3 regimes spawn at L=W trim AS = 78 m/s; production aircraft.json baseline ===\n');

// "All-level-cruise + target=78 + AS_ENVELOPE=30" envelopes — D25-ε's natural framing.
const allLCTargetMid = {
  ...DEFAULT_ENVELOPES,
  regimeMode: undefined,
  targetAirspeed: { low: 78, mid: 78, high: 78 },
  AS_ENVELOPE: 30,
};

for (const { regime, fx } of regimes) {
  const csv = runHarness({ fixture: fx, params: [], ticks: 1800 });
  const rows = csvToTrajectory(csv);
  const traj = { regime, rows };
  const d23 = regimeScore(traj, DEFAULT_ENVELOPES);
  const d25e = regimeScore(traj, allLCTargetMid);
  const r0 = rows[0];
  const r60 = rows[60];
  const r600 = rows[600];
  const rLast = rows[rows.length - 1];
  console.log(`regime=${regime} throttle=${fx.throttle}:`);
  console.log(`  t=0: AS=${r0.airspeed.toFixed(1)} alt=${r0.posY.toFixed(1)} pitch=${(r0.pitch*180/Math.PI).toFixed(1)}°`);
  console.log(`  t=1s: AS=${r60.airspeed.toFixed(1)} alt=${r60.posY.toFixed(1)} pitch=${(r60.pitch*180/Math.PI).toFixed(1)}°`);
  console.log(`  t=10s: AS=${r600.airspeed.toFixed(1)} alt=${r600.posY.toFixed(1)} pitch=${(r600.pitch*180/Math.PI).toFixed(1)}°`);
  console.log(`  t=30s: AS=${rLast.airspeed.toFixed(1)} alt=${rLast.posY.toFixed(1)} pitch=${(rLast.pitch*180/Math.PI).toFixed(1)}°`);
  console.log(`  D23 mode dispatch: ${d23.toFixed(2)}`);
  console.log(`  D25-ε (all-LC + target=78): ${d25e.toFixed(2)}`);
}
