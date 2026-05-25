import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const fx = lookupFixture('throttle-high');
const csv = runHarness({ fixture: fx, ticks: 60, params: [
  'surfaces.0.area=1e-6','surfaces.1.area=1e-6','surfaces.2.area=1e-6','surfaces.3.area=1e-6',
]});
const lines = csv.trim().split('\n');
const hdr = lines[0].split(',');
const idx = { tick: hdr.indexOf('tick'), posY: hdr.indexOf('posY'), posZ: hdr.indexOf('posZ'), vX: hdr.indexOf('vX'), vY: hdr.indexOf('vY'), vZ: hdr.indexOf('vZ'), as: hdr.indexOf('airspeed') };
console.log('tick | posY  | posZ   |  vY    |  vZ    |  AS   | expected vZ');
for (let i = 0; i < lines.length - 1; i += 6) {
  const r = lines[i+1].split(',');
  const expectedVZ = -30 - 2.4 * (i / 60);
  console.log(String(i).padStart(3) + ' | ' + (+r[idx.posY]).toFixed(2).padStart(6) + ' | ' + (+r[idx.posZ]).toFixed(2).padStart(7) + ' | ' + (+r[idx.vY]).toFixed(2).padStart(6) + ' | ' + (+r[idx.vZ]).toFixed(2).padStart(7) + ' | ' + (+r[idx.as]).toFixed(2).padStart(6) + ' | ' + expectedVZ.toFixed(2));
}
