// Test: does calling resetForces between ticks fix the thrust-accumulation bug?
import RAPIER from '@dimforge/rapier3d-compat';
import * as fs from 'node:fs';
import { Vector3 } from 'three';
import { AircraftBody } from '/Users/stayman/Tmp/test-proj/src/aircraft/physics-core/rigidbody-core.ts';
import { FlightModel } from '/Users/stayman/Tmp/test-proj/src/aircraft/physics-core/flightmodel.ts';
import { createPhysicsWorld } from '/Users/stayman/Tmp/test-proj/src/aircraft/physics-core/world-fixture.ts';
import { parseAircraftConfig } from '/Users/stayman/Tmp/test-proj/src/aircraft/physics-core/config.ts';

await RAPIER.init();

const raw = JSON.parse(fs.readFileSync('/Users/stayman/Tmp/test-proj/public/config/aircraft.json', 'utf-8'));
// Tiny aero areas to isolate thrust
raw.surfaces[0].area = 1e-6;
raw.surfaces[1].area = 1e-6;
raw.surfaces[2].area = 1e-6;
raw.surfaces[3].area = 1e-6;
const config = parseAircraftConfig(raw);

const { world } = createPhysicsWorld();
const aircraft = new AircraftBody(world, config, {
  position: new Vector3(0, 50, 0),
  linvel: new Vector3(0, 0, -30),
});
const fm = new FlightModel(aircraft);
const dt = 1/60;
const throttle = 0.4;

console.log('WITH resetForces() between ticks:');
console.log('tick |   vZ    | Δvz/tick (m/s) | expected -0.040');
let prevVz = -30;
for (let i = 0; i < 30; i++) {
  // *** Add resetForces before applying new forces ***
  aircraft.body.resetForces(true);
  aircraft.body.resetTorques(true);
  fm.applyForces(throttle, dt);
  world.timestep = dt;
  world.step();
  const state = aircraft.readBodyState();
  const dvz = state.linvel.z - prevVz;
  if (i < 10 || i % 5 === 0) {
    console.log(String(i).padStart(3) + ' | ' + state.linvel.z.toFixed(3).padStart(7) + ' | ' + dvz.toFixed(4).padStart(8));
  }
  prevVz = state.linvel.z;
}
