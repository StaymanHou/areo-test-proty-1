import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { AircraftBody } from '../src/aircraft/physics-core/rigidbody-core';
import { FlightModel } from '../src/aircraft/physics-core/flightmodel';
import { parseAircraftConfig, type AircraftConfig } from '../src/aircraft/physics-core/config';
import { step as physicsStep } from '../src/aircraft/physics-core/step';
import {
  TrajectoryBuffer,
  csvToTrajectory,
  type TrajectoryRow,
} from '../src/aircraft/physics-core/trajectory-buffer';
import { createPhysicsWorld } from '../src/aircraft/physics-core/world-fixture';
import { PARITY_FIXTURES, type ParityFixture } from './parity-fixtures';

// WP14.6 parity-diff. Loads the browser-emitted trajectory CSVs from
// `test-results/browser-trajectory-<id>.csv` (produced by
// `tests/e2e/parity.spec.ts`), and diffs them against a Node-side
// trajectory column-by-column.
//
// Node-side source precedence (WP14.7 Phase 3 — see arch.md Rev 2026-05-12
// §D14.3, CONVENTIONS.md `### src/aircraft/physics-core/ boundary`):
//   1. If `test-results/harness-trajectory-<id>.csv` exists (produced by
//      `npm run harness:parity`), diff browser-vs-harness. This is the
//      load-bearing acceptance check for WP14.7+: physics-core has one
//      browser caller (`src/main.ts`) and one Node caller
//      (`tools/tune/harness.ts`), both of which must produce identical
//      trajectories.
//   2. Else, fall back to the in-process synthetic stub (Vitest pure-TS
//      loop calling `physics-core/step()` with `AircraftBody`). This path
//      preserves the WP14.6 single-tool smoke contract: `npm run test`
//      alone (no Playwright, no harness) can still exercise parity-diff
//      end-to-end as long as a browser CSV is present.
//   3. If the browser CSV is missing too, skip with an explanatory log
//      — the test is fundamentally a browser-vs-something check.
//
// Tolerance: |Δ| < 1e-6 per scalar (angles use shortest-arc distance). The
// browser-side Rapier and the Node-side Rapier are the same WASM build at
// the same fixed-dt, so trajectory-level bit-identity is the structural
// expectation; the 1e-6 tolerance is engineering slack for f64 CSV
// round-trip noise (last-decimal-digit ULPs from Number.prototype.toString
// picking the shortest representation per row).
//
// Parity-of-divergence (WP14.7 Phase 1): some fixtures intentionally exercise
// known-unstable regimes (SURFACE-2026-05-16-01: β4 explicit-Euler instability
// above V_REF; SURFACE-2026-05-12-03: β5 phugoid). Trajectories in those
// regimes go non-finite (NaN/Infinity) deterministically. What parity-diff
// CAN prove is that both runners diverge at the same tick with the same
// values — including the same NaN/Infinity pattern. What it CANNOT prove is
// stability — that's a separate acceptance gate, blocked on the SURFACE
// items above. Until divergence, finite values must match within TOLERANCE.
// At and beyond divergence, the non-finite pattern must match (both NaN, or
// both same-signed Infinity). This is the honest contract: "the two runners
// are bit-identical, including in how they explode."

const CONFIG_PATH = path.resolve('public/config/aircraft.json');
const TEST_RESULTS_DIR = path.resolve('test-results');
const TOLERANCE = 1e-6;

let config: AircraftConfig;

beforeAll(async () => {
  await RAPIER.init();
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  config = parseAircraftConfig(raw);
});

function runSynthetic(fixture: ParityFixture): TrajectoryRow[] {
  // World construction is delegated to physics-core/world-fixture.ts — the
  // single source of truth shared with the browser path (src/main.ts via
  // src/world/{terrain,landmarks}.ts) and the WP14.7 Node harness. Drift
  // between paths breaks bit-identity over long trajectories.
  const { world } = createPhysicsWorld();

  const aircraft = new AircraftBody(world, config, {
    position: new Vector3(fixture.position.x, fixture.position.y, fixture.position.z),
    linvel: new Vector3(fixture.linvel.x, fixture.linvel.y, fixture.linvel.z),
  });
  const fm = new FlightModel(aircraft);
  const buf = new TrajectoryBuffer(fixture.ticks);
  const dt = 1 / 60;
  for (let i = 0; i < fixture.ticks; i++) {
    physicsStep(world, aircraft, fm, { throttle: fixture.throttle }, dt);
    buf.record(aircraft.readBodyState());
  }
  return buf.getRows();
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, Math.PI * 2 - d);
}

// Classify a number into a bit-identity-comparable kind. Two values are
// "the same kind" if they agree on this classifier. For finite values,
// equality of kind is necessary but not sufficient — magnitude diff still
// matters (TOLERANCE check). For non-finite values, equality of kind is
// itself the parity assertion (both NaN; or both +Infinity; or both
// -Infinity). Exported for unit testing in this file's tail block.
export type NonFiniteKind = 'NaN' | '+Infinity' | '-Infinity';
export function nonFiniteKind(x: number): NonFiniteKind | null {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return '+Infinity';
  if (x === -Infinity) return '-Infinity';
  return null;
}

// Node-side source precedence (WP14.7 Phase 3). Given the presence/absence
// of browser and harness CSVs at test-run time, decide what parity-diff
// should do for this fixture:
//   - 'skip' — browser CSV is the anchor; without it there's nothing to
//     compare. Skip with a log; the full pipeline produces both.
//   - 'use-harness' — both present; diff browser vs harness. This is the
//     WP14.7+ acceptance path and the one CI runs.
//   - 'use-synthetic' — browser present, harness absent. Fall back to the
//     in-process synthetic stub. Preserves the WP14.6 "Vitest-alone is a
//     smoke for everything except parity" contract.
// Exported so the tail-block tests can pin this contract directly; a
// future "simplification" that flipped the precedence (e.g. preferring
// synthetic when both present) would silently degrade the CI signal in
// most cases since CI always has both CSVs. Codifying it here prevents
// that drift.
export type NodeSourceDecision = 'skip' | 'use-harness' | 'use-synthetic';
export function pickNodeSource(
  browserCsvExists: boolean,
  harnessCsvExists: boolean,
): NodeSourceDecision {
  if (!browserCsvExists) return 'skip';
  return harnessCsvExists ? 'use-harness' : 'use-synthetic';
}

// =============================================================================
// D26 / WP14.19 — closed-form per-tick force budget anchor per
// `feedback_parity_tests_need_truth_anchor.md`. The parity-diff goldens above
// validate browser ≡ harness coupled-correctness; without an independent
// closed-form anchor a coordinated regression (both sides drifting together)
// can pass parity-diff while producing physically wrong behavior. This anchor
// validates the per-tick force budget invariant (CLAUDE.md Rule #7) directly:
// at thrust=2400 N (throttle=0.4) + mass=1000 kg + dt=1/60, ONE tick of
// gravity-and-thrust integration (aero zeroed by spawning at AS=0 + zero area
// is awkward; we use the natural-aero case and assert on per-tick acceleration
// is bounded by the expected F=ma envelope). The Rule #7 invariant: Δvz per
// tick under no-aero + thrust-only conditions equals exactly thrust/mass/Hz.
// =============================================================================
describe('D26 / WP14.19 — closed-form per-tick force budget anchor (Rule #7 invariant)', () => {
  it('thrust-only (aero zeroed by zero-area surfaces) at throttle=0.4 gives Δvz per tick = -0.040 m/s exactly', () => {
    // Per `feedback_parity_tests_need_truth_anchor.md`: validate the integrator
    // invariant independently of the browser/harness pair. At thrust=2400 N
    // (throttle=0.4) / mass=1000 kg / 60 Hz, the per-tick Δvz under no-aero
    // conditions must equal exactly -2.4/60 = -0.040 m/s (along thrust direction
    // = +Z body axis projected to world via identity quat at spawn). Any
    // deviation indicates the SURFACE-2026-05-24-09 integrator bug has
    // regressed (Rapier per-tick force accumulator not cleared) OR mass /
    // thrust / dt invariants have changed without coordinated test update.
    //
    // We zero aero via `surfaces.{0..3}.area=1e-6` overrides (same pattern
    // used by `tools/tune/probe-thrust-only.mjs` since SURFACE-09 investigation).
    // This isolates thrust + gravity; gravity acts on Y, thrust acts on +Z
    // body (= -Z world if pitch=0). Spawn at AS=30 along -Z to match the
    // probe-thrust-only convention.
    const { world } = createPhysicsWorld();
    // Build an aero-zeroed config by mutating area to ~0 for all surfaces.
    // (parseAircraftConfig has already validated the JSON; we mutate a copy.)
    const aeroZeroedConfig: AircraftConfig = {
      ...config,
      surfaces: config.surfaces.map((s) => ({ ...s, area: 1e-6 })),
    };
    const aircraft = new AircraftBody(world, aeroZeroedConfig, {
      position: new Vector3(0, 50, 0),
      linvel: new Vector3(0, 0, -30),
    });
    const fm = new FlightModel(aircraft);
    const dt = 1 / 60;
    // First tick. Snapshot vZ to a local scalar IMMEDIATELY — `readBodyState`
    // returns a mutable buffer that's overwritten on the next call (per the
    // "Three.js mutable-buffer trap" convention in CLAUDE.md → Testing).
    physicsStep(world, aircraft, fm, { throttle: 0.4 }, dt);
    const vZ_t1 = aircraft.readBodyState().linvel.z;
    // Expected: vZ went from -30 to -30 + (-2.4/60) = -30.040 m/s.
    // Thrust direction is +Z body = -Z world at pitch=0 (per CONVENTIONS.md);
    // throttle 0.4 × thrust_max=6000 = 2400 N; over dt=1/60 = 40 N·s impulse;
    // mass=1000 → Δvz = -0.040.
    expect(vZ_t1).toBeCloseTo(-30.040, 5);
    // Second tick — same Δvz; if this is -0.080 (n+1× compounding), Rule #7
    // is broken and SURFACE-09 has regressed.
    physicsStep(world, aircraft, fm, { throttle: 0.4 }, dt);
    const vZ_t2 = aircraft.readBodyState().linvel.z;
    expect(vZ_t2).toBeCloseTo(-30.080, 5);
    // Per-tick delta is constant under thrust-only (no aero damping).
    // Tolerance: 1e-5 m/s slack accommodates Rapier's f32-internal precision
    // through the WASM bridge (~9e-7 ULP noise per tick at this magnitude).
    // The structural assertion is that delta is bounded near -0.040, NOT
    // bit-exact — if SURFACE-09 regresses, delta becomes -0.080 (2× expected)
    // which would fail this assertion by 4 orders of magnitude.
    const deltaVz = vZ_t2 - vZ_t1;
    expect(deltaVz).toBeCloseTo(-0.040, 4);
  });
});

describe('parity-diff: browser-emitted trajectory == node-side trajectory', () => {
  for (const fixture of PARITY_FIXTURES) {
    it(`fixture ${fixture.id}: ${fixture.ticks}-tick trajectory matches within |Δ|<${TOLERANCE}`, () => {
      const browserCsvPath = path.join(TEST_RESULTS_DIR, `browser-trajectory-${fixture.id}.csv`);
      const harnessCsvPath = path.join(TEST_RESULTS_DIR, `harness-trajectory-${fixture.id}.csv`);

      const decision = pickNodeSource(
        fs.existsSync(browserCsvPath),
        fs.existsSync(harnessCsvPath),
      );

      if (decision === 'skip') {
        // The browser-side CSV is produced by `npm run test:e2e`. If Vitest
        // runs before Playwright (e.g., in a `npm run test` only flow), the
        // file won't exist yet — skip with an explanatory log rather than
        // fail. The full pipeline (Vitest + Playwright + harness:parity +
        // Vitest) will hit the assertions; CI runs the full pipeline.
        console.log(
          `parity-diff: ${browserCsvPath} not present — run \`npm run test:e2e\` first to produce it. Skipping this fixture.`,
        );
        return;
      }

      const browserRows = csvToTrajectory(fs.readFileSync(browserCsvPath, 'utf-8'));

      let nodeRows: TrajectoryRow[];
      let nodeSource: string;
      if (decision === 'use-harness') {
        nodeRows = csvToTrajectory(fs.readFileSync(harnessCsvPath, 'utf-8'));
        nodeSource = 'harness';
      } else {
        // decision === 'use-synthetic'
        nodeRows = runSynthetic(fixture);
        nodeSource = 'synthetic-stub';
      }

      expect(browserRows.length, `row count mismatch for ${fixture.id} (node source: ${nodeSource})`).toBe(nodeRows.length);

      for (let i = 0; i < browserRows.length; i++) {
        const b = browserRows[i];
        const n = nodeRows[i];
        expect(b.tick, `tick mismatch at row ${i} (node source: ${nodeSource})`).toBe(n.tick);

        const scalarKeys: (keyof TrajectoryRow)[] = [
          'posX', 'posY', 'posZ', 'vX', 'vY', 'vZ', 'airspeed',
        ];
        for (const k of scalarKeys) {
          const bv = b[k] as number;
          const nv = n[k] as number;
          const bk = nonFiniteKind(bv);
          const nk = nonFiniteKind(nv);
          if (bk !== null || nk !== null) {
            // Parity-of-divergence: both runners must produce the same kind
            // of non-finite (both NaN, or both same-signed Infinity). If one
            // diverged and the other didn't, that's a real parity break.
            expect(
              bk,
              `${fixture.id} row ${i} field ${k}: divergence-kind mismatch (browser=${bv}, ${nodeSource}=${nv})`,
            ).toBe(nk);
            continue;
          }
          const diff = Math.abs(bv - nv);
          expect(
            diff,
            `${fixture.id} row ${i} field ${k}: |Δ|=${diff} > ${TOLERANCE} (browser=${bv}, ${nodeSource}=${nv})`,
          ).toBeLessThan(TOLERANCE);
        }

        const angleKeys: (keyof TrajectoryRow)[] = ['pitch', 'yaw', 'roll'];
        for (const k of angleKeys) {
          const bv = b[k] as number;
          const nv = n[k] as number;
          const bk = nonFiniteKind(bv);
          const nk = nonFiniteKind(nv);
          if (bk !== null || nk !== null) {
            expect(
              bk,
              `${fixture.id} row ${i} field ${k}: divergence-kind mismatch (browser=${bv}, ${nodeSource}=${nv})`,
            ).toBe(nk);
            continue;
          }
          const diff = angleDiff(bv, nv);
          expect(
            diff,
            `${fixture.id} row ${i} field ${k}: shortest-arc Δ=${diff} > ${TOLERANCE} (browser=${bv}, ${nodeSource}=${nv})`,
          ).toBeLessThan(TOLERANCE);
        }
      }
    });
  }
});

// Codification block — unit coverage for the parity-of-divergence helper
// added in WP14.7 Phase 1.7. Until this block landed, `nonFiniteKind` was
// exercised only indirectly via the throttle-high fixture happening to
// produce matching NaN/Infinity patterns in both runners. That's a fragile
// coupling: a future change that made the classifier collapse `+Infinity`
// and `-Infinity` to the same kind would silently let parity-failure cases
// through. These tests pin the contract directly.
describe('nonFiniteKind: parity-of-divergence classifier', () => {
  it('returns null for finite numbers (positive, negative, zero, signed-zero)', () => {
    expect(nonFiniteKind(0)).toBeNull();
    expect(nonFiniteKind(-0)).toBeNull();
    expect(nonFiniteKind(1.5)).toBeNull();
    expect(nonFiniteKind(-1e308)).toBeNull();
    expect(nonFiniteKind(Number.MAX_VALUE)).toBeNull();
    expect(nonFiniteKind(Number.MIN_VALUE)).toBeNull();
  });

  it('distinguishes NaN, +Infinity, and -Infinity as separate kinds', () => {
    expect(nonFiniteKind(NaN)).toBe('NaN');
    expect(nonFiniteKind(Infinity)).toBe('+Infinity');
    expect(nonFiniteKind(-Infinity)).toBe('-Infinity');
  });

  it('treats +Infinity and -Infinity as DIFFERENT kinds (signed-infinity is load-bearing)', () => {
    // If both runners diverge but in opposite directions, that is a real
    // parity break — the integrator is asymmetric between them. The parity-
    // of-divergence assertion must catch this.
    expect(nonFiniteKind(Infinity)).not.toBe(nonFiniteKind(-Infinity));
  });

  it('treats NaN as distinct from both +Infinity and -Infinity', () => {
    // NaN-vs-Infinity is a particularly insidious parity break: one runner
    // hit 0/0 while the other hit overflow. These are not the same failure
    // mode and must not be treated as parity-success.
    expect(nonFiniteKind(NaN)).not.toBe(nonFiniteKind(Infinity));
    expect(nonFiniteKind(NaN)).not.toBe(nonFiniteKind(-Infinity));
  });

  it('rejects NaN identity collapse (NaN !== NaN, but classifier returns same string)', () => {
    // Sanity: in JS NaN !== NaN, so a naive `b === s` comparison fails for
    // matching NaN values. The classifier-based dispatch must succeed
    // because `nonFiniteKind(NaN) === nonFiniteKind(NaN)` returns true (both
    // are the string 'NaN').
    expect(NaN === NaN).toBe(false);
    expect(nonFiniteKind(NaN) === nonFiniteKind(NaN)).toBe(true);
  });
});

// Codification block — pins the WP14.7 Phase 3 precedence contract. The
// fixture tests above exercise either the harness or synthetic branch at
// test-run time depending on ambient filesystem state, which means CI
// (where both CSVs are always present) never exercises the synthetic
// fallback — a future inversion of the precedence would silently degrade
// the CI signal. These four cases pin all four corners of the truth
// table directly.
describe('pickNodeSource: Phase 3 precedence', () => {
  it('returns "skip" when the browser CSV is absent (regardless of harness)', () => {
    expect(pickNodeSource(false, false)).toBe('skip');
    expect(pickNodeSource(false, true)).toBe('skip');
  });

  it('returns "use-harness" when both browser and harness CSVs are present (WP14.7+ acceptance path)', () => {
    expect(pickNodeSource(true, true)).toBe('use-harness');
  });

  it('returns "use-synthetic" when browser is present but harness is absent (WP14.6 fallback contract)', () => {
    expect(pickNodeSource(true, false)).toBe('use-synthetic');
  });

  it('prefers harness over synthetic when both are available — pinning the precedence direction', () => {
    // Direct restatement of the prefer-harness rule. If someone "simplifies"
    // pickNodeSource to always-synthetic or always-harness, this test
    // catches the half they got wrong.
    expect(pickNodeSource(true, true)).not.toBe('use-synthetic');
    expect(pickNodeSource(true, false)).not.toBe('use-harness');
  });
});
