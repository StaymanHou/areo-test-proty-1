// WP14.18-investigation probe — identify the energy-injecting mechanism.
//
// Runs the harness at WP14.18 globalBest for 60 ticks (1s @ 60Hz) under
// high-regime fixture (throttle=0.4, spawn alt=50, vZ=-30). Then re-runs
// with each of {β4 clQ, β5 clAlphaDot, D18 per-surface inducedDragK, D18
// fuselageDrag} individually zeroed. For each variant computes per-tick
// translational mechanical energy and compares ΔE to the thrust power
// budget. Energy injection = ΔE_observed - ΔE_expected > 0.
//
// Reads globalBest from tools/tune/results/wp14.18-d23-tune.json.
// Writes nothing to disk; all output to stdout.

import { runHarness, lookupFixture } from '/Users/stayman/Tmp/test-proj/tools/tune/harness.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import * as fs from 'node:fs';

await RAPIER.init();

const MASS = 1000;
const G = 9.81;
const THRUST_MAX = 6000;
const FIXTURE_ID = 'throttle-high';
const TICKS = 60;
const DT = 1 / 60;

const results = JSON.parse(
  fs.readFileSync(
    '/Users/stayman/Tmp/test-proj/tools/tune/results/wp14.18-d23-tune.json',
    'utf8',
  ),
);
const best = results.params;

// Build symmetric-mirror knobs (surfaces.0.* mirrored to surfaces.1.*)
function buildKnobs(overrides = {}) {
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
    ...overrides,
  };
  return Object.entries(knobs).map(([k, v]) => `${k}=${v}`);
}

function parseRows(csv) {
  const lines = csv.trim().split('\n');
  const hdr = lines[0].split(',');
  const idx = {
    posY: hdr.indexOf('posY'),
    vX: hdr.indexOf('vX'),
    vY: hdr.indexOf('vY'),
    vZ: hdr.indexOf('vZ'),
    as: hdr.indexOf('airspeed'),
    pitch: hdr.indexOf('pitch'),
  };
  return lines.slice(1).map((l) => {
    const r = l.split(',');
    return {
      posY: +r[idx.posY],
      vX: +r[idx.vX],
      vY: +r[idx.vY],
      vZ: +r[idx.vZ],
      as: +r[idx.as],
      pitch: +r[idx.pitch],
    };
  });
}

function energyBalance(rows, throttle) {
  const E = rows.map((r) => 0.5 * MASS * (r.vX ** 2 + r.vY ** 2 + r.vZ ** 2) + MASS * G * r.posY);
  let cumThrustPower = 0;
  const lines = [
    'tick |   AS  | pitch° |   vZ  |   vY  |     E      |    ΔE    | thrust·v·dt | ΔE_inject',
  ];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const dE = i === 0 ? 0 : E[i] - E[i - 1];
    // Thrust acts along body -Z rotated by pitch into world. At positive pitch θ,
    // thrust world = (0, sin θ, -cos θ) · |T|. Power = T_world · v.
    const T = throttle * THRUST_MAX;
    const tX = 0;
    const tY = T * Math.sin(r.pitch);
    const tZ = -T * Math.cos(r.pitch);
    const power = tX * r.vX + tY * r.vY + tZ * r.vZ;
    const thrustWorkThisTick = i === 0 ? 0 : power * DT;
    cumThrustPower += thrustWorkThisTick;
    const inject = dE - thrustWorkThisTick;
    if (i % 5 === 0 || i === rows.length - 1) {
      lines.push(
        `${String(i).padStart(4)} | ${r.as.toFixed(1).padStart(5)} | ${(r.pitch * 180 / Math.PI).toFixed(1).padStart(6)} | ${r.vZ.toFixed(1).padStart(5)} | ${r.vY.toFixed(1).padStart(5)} | ${E[i].toFixed(0).padStart(10)} | ${dE.toFixed(0).padStart(8)} | ${thrustWorkThisTick.toFixed(0).padStart(11)} | ${inject.toFixed(0).padStart(9)}`,
      );
    }
  }
  const totalDE = E[rows.length - 1] - E[0];
  const totalThrust = cumThrustPower;
  const totalInject = totalDE - totalThrust;
  return { lines, totalDE, totalThrust, totalInject, finalAS: rows[rows.length - 1].as, finalPitchDeg: rows[rows.length - 1].pitch * 180 / Math.PI };
}

function runVariant(label, overrides) {
  const fx = lookupFixture(FIXTURE_ID);
  const params = buildKnobs(overrides);
  const csv = runHarness({ fixture: fx, ticks: TICKS, params });
  const rows = parseRows(csv);
  const eb = energyBalance(rows, fx.throttle);
  console.log(`\n=== ${label} ===`);
  eb.lines.forEach((l) => console.log(l));
  console.log(`TOTAL over ${TICKS} ticks: ΔE=${eb.totalDE.toFixed(0)} J, thrustWork=${eb.totalThrust.toFixed(0)} J, INJECTED=${eb.totalInject.toFixed(0)} J | finalAS=${eb.finalAS.toFixed(1)} pitch=${eb.finalPitchDeg.toFixed(1)}°`);
  return eb;
}

console.log('==================================================================');
console.log('WP14.18 globalBest energy-balance probe — 60 ticks @ high regime');
console.log('==================================================================');
console.log('Globalbest knobs:', JSON.stringify(best, null, 2));

const baseline = runVariant('BASELINE (full WP14.18 globalBest)', {});
const noClQ = runVariant('β4 ZEROED (clQ = 0 on all surfaces)', {
  'surfaces.0.clQ': 0, 'surfaces.1.clQ': 0, 'surfaces.2.clQ': 0,
});
const noClAlphaDot = runVariant('β5 ZEROED (clAlphaDot = 0 on all surfaces)', {
  'surfaces.0.clAlphaDot': 0, 'surfaces.1.clAlphaDot': 0, 'surfaces.2.clAlphaDot': 0,
});
const noInducedDrag = runVariant('D18 induced-drag ZEROED (inducedDragK = 0 on all surfaces)', {
  'surfaces.0.inducedDragK': 0, 'surfaces.1.inducedDragK': 0, 'surfaces.2.inducedDragK': 0,
});
const noFuselageDrag = runVariant('D18 fuselage-drag ZEROED (fuselageDrag.cd0 = 0)', {
  'fuselageDrag.cd0': 0,
});
const allNew = runVariant('ALL new mechanisms zeroed (β4 + β5 + induced-drag + fuselage-drag)', {
  'surfaces.0.clQ': 0, 'surfaces.1.clQ': 0, 'surfaces.2.clQ': 0,
  'surfaces.0.clAlphaDot': 0, 'surfaces.1.clAlphaDot': 0, 'surfaces.2.clAlphaDot': 0,
  'surfaces.0.inducedDragK': 0, 'surfaces.1.inducedDragK': 0, 'surfaces.2.inducedDragK': 0,
  'fuselageDrag.cd0': 0,
});
const noAeroSurfaces = runVariant('ALL aerosurface area = 1e-6 (effectively zero aero)', {
  'surfaces.0.area': 1e-6, 'surfaces.1.area': 1e-6, 'surfaces.2.area': 1e-6, 'surfaces.3.area': 1e-6,
  'fuselageDrag.cd0': 0,
});

console.log('\n==================================================================');
console.log('SUMMARY — net injected energy per variant (lower=more dissipative; higher=injection)');
console.log('==================================================================');
console.log(`BASELINE                    : ${baseline.totalInject.toFixed(0).padStart(10)} J  AS=${baseline.finalAS.toFixed(1).padStart(5)} pitch=${baseline.finalPitchDeg.toFixed(1).padStart(6)}°`);
console.log(`β4 zeroed (no clQ)          : ${noClQ.totalInject.toFixed(0).padStart(10)} J  AS=${noClQ.finalAS.toFixed(1).padStart(5)} pitch=${noClQ.finalPitchDeg.toFixed(1).padStart(6)}°`);
console.log(`β5 zeroed (no clAlphaDot)   : ${noClAlphaDot.totalInject.toFixed(0).padStart(10)} J  AS=${noClAlphaDot.finalAS.toFixed(1).padStart(5)} pitch=${noClAlphaDot.finalPitchDeg.toFixed(1).padStart(6)}°`);
console.log(`D18 induced-drag zeroed     : ${noInducedDrag.totalInject.toFixed(0).padStart(10)} J  AS=${noInducedDrag.finalAS.toFixed(1).padStart(5)} pitch=${noInducedDrag.finalPitchDeg.toFixed(1).padStart(6)}°`);
console.log(`D18 fuselage-drag zeroed    : ${noFuselageDrag.totalInject.toFixed(0).padStart(10)} J  AS=${noFuselageDrag.finalAS.toFixed(1).padStart(5)} pitch=${noFuselageDrag.finalPitchDeg.toFixed(1).padStart(6)}°`);
console.log(`ALL new mechanisms zeroed   : ${allNew.totalInject.toFixed(0).padStart(10)} J  AS=${allNew.finalAS.toFixed(1).padStart(5)} pitch=${allNew.finalPitchDeg.toFixed(1).padStart(6)}°`);
console.log(`NO aero (only thrust+gravity): ${noAeroSurfaces.totalInject.toFixed(0).padStart(10)} J  AS=${noAeroSurfaces.finalAS.toFixed(1).padStart(5)} pitch=${noAeroSurfaces.finalPitchDeg.toFixed(1).padStart(6)}°`);
console.log('\nVariant whose ΔE_inject drops dramatically (toward zero or negative) = the energy-injecting mechanism.');
