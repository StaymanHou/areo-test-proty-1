import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const fx = lookupFixture('throttle-high');
const csv = runHarness({ fixture: fx, ticks: 60, params: [
  'surfaces.0.area=1e-6','surfaces.1.area=1e-6','surfaces.2.area=1e-6','surfaces.3.area=1e-6',
]});
const lines = csv.trim().split('\n');
const hdr = lines[0].split(',');
const idx = { posY: hdr.indexOf('posY'), posZ: hdr.indexOf('posZ'), vY: hdr.indexOf('vY'), vZ: hdr.indexOf('vZ') };
console.log('NO AERO + throttle=0.4 (thrust=2400 N on 1000 kg airframe; expect ΔvZ = 2.4 m/s² acceleration)');
console.log('tick |  posZ   |   vZ    | dt vz | Δvz/tick (m/s)');
let prevVz = -30;
for (let i = 0; i < lines.length - 1; i++) {
  const r = lines[i+1].split(',');
  const vz = +r[idx.vZ];
  const dvz = vz - prevVz;
  if (i < 10 || i % 5 === 0) {
    console.log(String(i).padStart(3) + ' | ' + (+r[idx.posZ]).toFixed(3).padStart(8) + ' | ' + vz.toFixed(3).padStart(7) + ' | ' + dvz.toFixed(4).padStart(8) + ' | expect=' + ((-2.4)/60).toFixed(4));
  }
  prevVz = vz;
}
console.log('Expected Δvz per tick at 60Hz with thrust=2400 / mass=1000 → Δvz = -2.4/60 = -0.040 m/s');
