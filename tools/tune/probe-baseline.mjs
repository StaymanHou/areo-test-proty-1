import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import { csvToTrajectory } from '/Users/stayman/Tmp/test-proj/src/aircraft/physics-core/trajectory-buffer.ts';
import { score, DEFAULT_ENVELOPES, regimeScore } from '/Users/stayman/Tmp/test-proj/tools/tune/score.ts';
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

const regimes = [
  { regime: 'low', fixtureId: 'throttle-low' },
  { regime: 'mid', fixtureId: 'throttle-mid' },
  { regime: 'high', fixtureId: 'throttle-high' },
];

async function probeAt(overridesObj, label) {
  const params = Object.entries(overridesObj).map(([k, v]) => `${k}=${v}`);
  console.log(`=== ${label} ===`);
  let total = 0;
  for (const { regime, fixtureId } of regimes) {
    const fx = lookupFixture(fixtureId);
    const csv = runHarness({ fixture: fx, params, ticks: 1800 });
    const rows = csvToTrajectory(csv);
    const rs = regimeScore({ regime, rows }, DEFAULT_ENVELOPES);
    total += rs;
    const nanRow = rows.find(r => !Number.isFinite(r.posY) || !Number.isFinite(r.airspeed) || !Number.isFinite(r.pitch));
    const lastFin = [...rows].reverse().find(r => Number.isFinite(r.posY) && Number.isFinite(r.airspeed));
    console.log(`  regime=${regime} rows=${rows.length} score=${rs.toFixed(2)} firstNanTick=${nanRow ? nanRow.tick : 'none'} lastFinAlt=${lastFin?.posY?.toFixed(2)} lastFinAS=${lastFin?.airspeed?.toFixed(2)}`);
  }
  console.log(`  TOTAL: ${total.toFixed(2)}`);
}

await probeAt({ 'surfaces.0.clQ': 3, 'surfaces.0.clAlphaDot': 0, 'surfaces.2.clQ': 8, 'surfaces.2.clAlphaDot': 0 }, 'baseline (current aircraft.json: clQ=3,8; clAlphaDot=0)');
await probeAt({ 'surfaces.0.clQ': 0, 'surfaces.0.clAlphaDot': 0, 'surfaces.2.clQ': 0, 'surfaces.2.clAlphaDot': 0 }, 'zero baseline (clQ=0,0; clAlphaDot=0,0)');
await probeAt({ 'surfaces.0.clQ': 3, 'surfaces.0.clAlphaDot': 0.1, 'surfaces.2.clQ': 8, 'surfaces.2.clAlphaDot': 0.1 }, 'tiny clAlphaDot (clQ=3,8; clAlphaDot=0.1,0.1)');
await probeAt({ 'surfaces.0.clQ': 1, 'surfaces.0.clAlphaDot': 0, 'surfaces.2.clQ': 1, 'surfaces.2.clAlphaDot': 0 }, 'lower clQ (clQ=1,1; clAlphaDot=0)');
