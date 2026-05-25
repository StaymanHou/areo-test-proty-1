import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const fx = { ...lookupFixture('throttle-high'), throttle: 0 };
const csv = runHarness({ fixture: fx, ticks: 60, params: [
  'surfaces.0.area=1e-6','surfaces.1.area=1e-6','surfaces.2.area=1e-6','surfaces.3.area=1e-6',
]});
const lines = csv.trim().split('\n');
const hdr = lines[0].split(',');
const idx = { posY: hdr.indexOf('posY'), posZ: hdr.indexOf('posZ'), vY: hdr.indexOf('vY'), vZ: hdr.indexOf('vZ'), as: hdr.indexOf('airspeed') };
console.log('NO AERO + ZERO THROTTLE (only gravity should act)');
console.log('tick | posY  | posZ   |  vY    |  vZ    |  AS  ');
for (let i = 0; i < lines.length - 1; i += 6) {
  const r = lines[i+1].split(',');
  console.log(String(i).padStart(3) + ' | ' + (+r[idx.posY]).toFixed(2).padStart(6) + ' | ' + (+r[idx.posZ]).toFixed(2).padStart(7) + ' | ' + (+r[idx.vY]).toFixed(2).padStart(6) + ' | ' + (+r[idx.vZ]).toFixed(2).padStart(7) + ' | ' + (+r[idx.as]).toFixed(2));
}
console.log('Expected at tick 60: vY = -9.81 m/s, vZ = -30 m/s (gravity only), AS = sqrt(30² + 9.81²) ≈ 31.6 m/s');
