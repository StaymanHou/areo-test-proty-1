import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Aircraft } from './rigidbody';
import { FlightModel } from './physics-core/flightmodel';
import { parseAircraftConfig, type AircraftConfig } from './physics-core/config';
import canonicalAircraftConfig from '../../public/config/aircraft.json' with { type: 'json' };

// SURFACE-2026-06-06-03 investigation spec. NOT a production gate. Probes
// three hypotheses about why sustained roll at full aileron equilibrates at
// ~550°/s under production aircraft.json despite `clQ_wing=1.83` already
// shipping a roll-damping mechanism (via D17 dampAxis = -Z on wings).
//
// Hypothesis (c) — sign defect: positive clQ_wing AMPLIFIES roll rather than
//   damping it. Test by comparing sustained roll at clQ_wing ∈ {0, 1.83, 10}.
// Hypothesis (b) — wrong reduced-frequency length: D17 uses chord (~1m); roll
//   damping textbook form uses wingspan (~8m), giving 8× larger damping at
//   the same coefficient. Test by computing predicted ΔCL with both lengths.
// Hypothesis (a) — undertuned: bump clQ_wing through a sweep, find the value
//   where sustained ≤ 200°/s.
//
// Investigation outcome ranks the three branches in the WIP retrospect.

const RAD2DEG = 180 / Math.PI;
const TICKS = 120; // 2s @ 60Hz
const DT = 1 / 60;

let baseConfig: AircraftConfig;

beforeAll(async () => {
  await RAPIER.init();
  baseConfig = parseAircraftConfig(canonicalAircraftConfig);
});

interface RollResult {
  label: string;
  clQ_wing: number;
  rollRatesDegS: number[];
  sustainedPeak: number;
  finalDegS: number;
  // For diagnostic: the dampAxis world-frame dot with angvel at t=1s
  // (sign matters for hypothesis c).
}

function runRollProbe(clQ_wing: number, label: string): RollResult {
  // Build a config with clQ_wing overridden on wing-left + wing-right only.
  // h-stab clQ stays at production value.
  const cfgRaw = JSON.parse(JSON.stringify(canonicalAircraftConfig));
  cfgRaw.surfaces[0].clQ = clQ_wing; // wing-left
  cfgRaw.surfaces[1].clQ = clQ_wing; // wing-right
  const cfg = parseAircraftConfig(cfgRaw);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const aircraft = new Aircraft(world, cfg, {
    position: new Vector3(0, 50, 0),
    linvel: new Vector3(0, 0, -78), // V_trim spawn
  });
  const fm = new FlightModel(aircraft);

  const rollRatesDegS: number[] = [];
  for (let i = 0; i < TICKS; i++) {
    fm.applyControls({ aileron: 1, elevator: 0, rudder: 0 });
    fm.applyForces(0.3, DT);
    world.timestep = DT;
    world.step();
    const av = aircraft.body.angvel();
    rollRatesDegS.push(av.z * RAD2DEG);
  }

  // Same sustained window as roll-rate.test.ts: t=0.5s..1.5s (ticks 30..89).
  const sustainedWindow = rollRatesDegS.slice(30, 90);
  const sustainedPeak = Math.max(...sustainedWindow.map(Math.abs));

  // Suppress unused-var warning while keeping the structure intentional.
  void baseConfig;

  return {
    label,
    clQ_wing,
    rollRatesDegS,
    sustainedPeak,
    finalDegS: rollRatesDegS[TICKS - 1]!,
  };
}

describe('SURFACE-06-03 investigation — roll damping mechanism', () => {
  it('Hypothesis (c) — sign probe: clQ_wing ∈ {0, 1.83, 10} sustained-peak comparison', () => {
    const noClQ = runRollProbe(0, 'clQ_wing=0 (control, β4 off on wings)');
    const prodClQ = runRollProbe(1.83057709056884, 'clQ_wing=1.83 (production)');
    const bigClQ = runRollProbe(10, 'clQ_wing=10 (large non-default)');

    // Diagnostic output (always emitted via expect.fail-style summary at end).
    const summary = {
      clQ_0_sustainedPeak: Math.round(noClQ.sustainedPeak * 10) / 10,
      clQ_1p83_sustainedPeak: Math.round(prodClQ.sustainedPeak * 10) / 10,
      clQ_10_sustainedPeak: Math.round(bigClQ.sustainedPeak * 10) / 10,
      clQ_0_final: Math.round(noClQ.finalDegS * 10) / 10,
      clQ_1p83_final: Math.round(prodClQ.finalDegS * 10) / 10,
      clQ_10_final: Math.round(bigClQ.finalDegS * 10) / 10,
    };

    // Hypothesis (c) diagnosis: if clQ=10 sustained > clQ=0 sustained,
    // clQ is anti-damping wings. Investigation-only; record but don't fail.
    const isAntiDamping = bigClQ.sustainedPeak > noClQ.sustainedPeak;
    const isCorrectlyDamping = bigClQ.sustainedPeak < noClQ.sustainedPeak;

    // Sanity assertions (any of these failing would mean the test rig itself is broken):
    expect(noClQ.sustainedPeak).toBeGreaterThan(50); // Roll DOES develop
    expect(prodClQ.sustainedPeak).toBeGreaterThan(50);
    expect(bigClQ.sustainedPeak).toBeGreaterThan(0);

    // Diagnostic summary captured via test name for visibility:
    console.log('[Hypothesis-c summary]', JSON.stringify(summary, null, 2));
    console.log('[Hypothesis-c diagnosis]', {
      isAntiDamping,
      isCorrectlyDamping,
      delta_clQ10_minus_clQ0: Math.round((bigClQ.sustainedPeak - noClQ.sustainedPeak) * 10) / 10,
      delta_clQ10_minus_clQ1p83: Math.round((bigClQ.sustainedPeak - prodClQ.sustainedPeak) * 10) / 10,
    });
  });

  it('Hypothesis (b) — reduced-frequency length: arithmetic prediction at observed sustained', () => {
    // Run production baseline and compute predicted ΔCL contribution from
    // the D17 formula at the OBSERVED sustained roll rate, using both
    // chord (current) and wingspan (textbook for roll-axis).
    const prodClQ = runRollProbe(1.83057709056884, 'clQ_wing=1.83');
    const omegaRad = prodClQ.sustainedPeak / RAD2DEG;
    const V = 78; // V_trim
    const chord = 1; // wing chord (approx — matches aircraft.json wing-left chord)
    const wingspan = 8; // wing-right.position.x − wing-left.position.x = 2 − (−2) = 4m moment arm × 2 = 8m
    const clQ = 1.83057709056884;

    const predictedDeltaCL_chord = (clQ * omegaRad * chord) / (2 * V);
    const predictedDeltaCL_span = (clQ * omegaRad * wingspan) / (2 * V);
    const damping_amplification_factor = wingspan / chord;

    console.log('[Hypothesis-b arithmetic]', {
      omegaRadPerSec: Math.round(omegaRad * 100) / 100,
      observedSustainedDegS: Math.round(prodClQ.sustainedPeak * 10) / 10,
      predictedDeltaCL_chord: Math.round(predictedDeltaCL_chord * 10000) / 10000,
      predictedDeltaCL_span: Math.round(predictedDeltaCL_span * 10000) / 10000,
      damping_amplification_factor_if_span_substituted: damping_amplification_factor,
      interpretation: `If formula used span (${wingspan}m) instead of chord (${chord}m), the same clQ would produce ${damping_amplification_factor}× larger damping ΔCL. Predicted sustained roll under wingspan formula at current clQ ≈ (observed) / ${damping_amplification_factor}`,
      predicted_sustained_under_span_formula_approx: Math.round((prodClQ.sustainedPeak / damping_amplification_factor) * 10) / 10,
    });

    expect(predictedDeltaCL_span).toBeGreaterThan(predictedDeltaCL_chord);
  });

  it('Hypothesis (a) — undertuned: sweep clQ_wing ∈ {1.83, 3, 5, 8, 12, 20} find sustained ≤ 200', () => {
    const sweep = [1.83057709056884, 3, 5, 8, 12, 20];
    const results = sweep.map((q) => runRollProbe(q, `clQ_wing=${q}`));

    const summary = results.map((r) => ({
      clQ_wing: r.clQ_wing,
      sustainedPeakDegS: Math.round(r.sustainedPeak * 10) / 10,
      finalDegS: Math.round(r.finalDegS * 10) / 10,
      meetsGate: r.sustainedPeak <= 200,
    }));

    // Find the smallest clQ that meets the gate.
    const firstMeetingGate = results.find((r) => r.sustainedPeak <= 200);

    console.log('[Hypothesis-a sweep]', JSON.stringify(summary, null, 2));
    console.log('[Hypothesis-a diagnosis]', {
      gate: '≤ 200°/s sustained',
      firstClQ_meetingGate: firstMeetingGate?.clQ_wing ?? 'none in sweep range',
      withinTextbookBound_0to15: firstMeetingGate ? firstMeetingGate.clQ_wing <= 15 : false,
    });

    // Investigation-only — no firm gate.
    expect(results.length).toBe(sweep.length);
  });
});
