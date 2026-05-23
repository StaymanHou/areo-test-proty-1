import * as fs from 'node:fs';
import * as path from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { AircraftBody } from '../../src/aircraft/physics-core/rigidbody-core';
import { FlightModel } from '../../src/aircraft/physics-core/flightmodel';
import { parseAircraftConfig } from '../../src/aircraft/physics-core/config';
import { step as physicsStep } from '../../src/aircraft/physics-core/step';
import {
  TrajectoryBuffer,
  trajectoryToCsv,
} from '../../src/aircraft/physics-core/trajectory-buffer';
import { createPhysicsWorld } from '../../src/aircraft/physics-core/world-fixture';
import { PARITY_FIXTURES, type ParityFixture } from '../../tests/parity-fixtures';

// WP14.7 Phase 2 — Node Rapier-WASM CLI harness. Single-probe driver: given a
// fixture id + tick count + optional deep-path parameter overrides, runs the
// same physics-core pipeline the browser game loop runs, records each tick
// into a TrajectoryBuffer, and emits a CSV. The CSV must be bit-identical to
// the browser-side emitter for the same fixture under the same parameters —
// that's the parity contract enforced by `tests/parity-diff.test.ts`.
//
// Caller responsibilities for the CLI form:
//   tsx tools/tune/harness.ts --fixture <id> --ticks <N>
//     [--params <deep.path=value,deep.path=value>]
//     [--out <path|->]            (default: stdout)
//
// Or the parity batch form (used by `npm run harness:parity`):
//   tsx tools/tune/harness.ts --all-fixtures --out-dir <dir>
//     [--params <deep.path=value,deep.path=value>]
//
// `--all-fixtures` iterates `PARITY_FIXTURES` (writing each fixture's full
// `fixture.ticks` to `<out-dir>/harness-trajectory-<id>.csv`). Mutually
// exclusive with `--fixture` / `--ticks` / `--out`.
//
// Equivalent via npm script: `npm run harness -- ...`. When piping stdout
// to a file or another command, prefer `npm run --silent harness -- ...`
// so npm's progress banner ("> test-proj@0.0.0 harness ...") doesn't
// pollute the CSV. The WP14.8 optimizer uses `--out <file>` rather than
// stdout, so this matters only for ad-hoc human use.
//
// The pure helpers below (`parseArgs`, `applyParamOverrides`, `runHarness`)
// are exported so the unit tests in `harness.test.ts` can exercise them
// without spawning subprocesses. The subprocess determinism check lives in
// `harness.determinism.test.ts`.

export type HarnessArgs =
  | { mode: 'single'; fixture: string; ticks: number; params: string[]; out: string }
  | { mode: 'all-fixtures'; params: string[]; outDir: string };

export function parseArgs(argv: readonly string[]): HarnessArgs {
  let fixture: string | undefined;
  let ticks: number | undefined;
  let params: string[] = [];
  let out: string | undefined;
  let allFixtures = false;
  let outDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`harness: --${arg.slice(2)} requires a value`);
      i++;
      return v;
    };
    if (arg === '--fixture') {
      fixture = next();
    } else if (arg === '--ticks') {
      const raw = next();
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`harness: --ticks must be a positive integer, got "${raw}"`);
      }
      ticks = n;
    } else if (arg === '--params') {
      const raw = next();
      params = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    } else if (arg === '--out') {
      out = next();
    } else if (arg === '--all-fixtures') {
      allFixtures = true;
    } else if (arg === '--out-dir') {
      outDir = next();
    } else {
      throw new Error(`harness: unknown argument "${arg}"`);
    }
  }

  if (allFixtures) {
    if (fixture !== undefined || ticks !== undefined || out !== undefined) {
      throw new Error('harness: --all-fixtures is mutually exclusive with --fixture / --ticks / --out');
    }
    if (outDir === undefined) {
      throw new Error('harness: --all-fixtures requires --out-dir <dir>');
    }
    return { mode: 'all-fixtures', params, outDir };
  }

  if (fixture === undefined) throw new Error('harness: --fixture <id> is required');
  if (ticks === undefined) throw new Error('harness: --ticks <N> is required');
  return { mode: 'single', fixture, ticks, params, out: out ?? '-' };
}

export function applyParamOverrides(
  config: Record<string, unknown>,
  overrides: readonly string[],
): void {
  for (const override of overrides) {
    const eq = override.indexOf('=');
    if (eq <= 0 || eq === override.length - 1) {
      throw new Error(`harness: malformed --params entry "${override}" — expected key.path=value`);
    }
    const pathStr = override.slice(0, eq);
    const rawValue = override.slice(eq + 1);
    const numValue = Number(rawValue);
    if (!Number.isFinite(numValue)) {
      throw new Error(`harness: --params value for "${pathStr}" is not a finite number: "${rawValue}"`);
    }

    const segments = pathStr.split('.');
    let cursor: unknown = config;
    // Intermediate-path segments: the LEAF is allowed to be absent (many
    // tunable fields default to 0 and are not declared in `aircraft.json` —
    // clAlphaDot is the canonical example; D18's `inducedDragK` follows the
    // same pattern). For intermediates, two cases:
    //   (a) cursor is a plain object and the next segment is missing → auto-
    //       create `{}` for the path. This supports D18's top-level optional
    //       `fuselageDrag?: { cd0, area }` shape: `fuselageDrag.cd0=0.3` on
    //       baseline aircraft.json (no `fuselageDrag` parent) creates the
    //       parent object on the fly so the leaf assignment can land.
    //   (b) cursor is an array and the next index is out of range → still
    //       throw. Array indices that don't exist are real path typos (e.g.
    //       `surfaces.99.foo` when there are only 4 surfaces). Auto-creating
    //       array elements would silently mask the typo and is unsafe.
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      if (typeof cursor !== 'object' || cursor === null) {
        throw new Error(`harness: --params path "${pathStr}" — parent at segment "${seg}" is not an object`);
      }
      const obj = cursor as Record<string, unknown>;
      if (!(seg in obj)) {
        if (Array.isArray(cursor)) {
          throw new Error(`harness: --params path "${pathStr}" does not resolve at segment "${seg}"`);
        }
        // Auto-create missing intermediate object segment (D18 support).
        obj[seg] = {};
      }
      cursor = obj[seg];
      // Arrays are object-typed in JS; this handles `surfaces.0.clQ` style as well,
      // since `'0' in array` is true for index 0.
    }
    const leaf = segments[segments.length - 1]!;
    if (typeof cursor !== 'object' || cursor === null) {
      throw new Error(`harness: --params path "${pathStr}" — parent of leaf "${leaf}" is not an object`);
    }
    (cursor as Record<string, unknown>)[leaf] = numValue;
  }
}

export function lookupFixture(id: string): ParityFixture {
  const fx = PARITY_FIXTURES.find((f) => f.id === id);
  if (fx === undefined) {
    const valid = PARITY_FIXTURES.map((f) => f.id).join(', ');
    throw new Error(`harness: unknown fixture "${id}". Valid ids: ${valid}`);
  }
  return fx;
}

const DEFAULT_CONFIG_PATH = path.resolve('public/config/aircraft.json');

/**
 * Run the harness in-process. RAPIER must be initialized by the caller via
 * `await RAPIER.init()` before invoking this. Returns the CSV body.
 */
export function runHarness(opts: {
  fixture: ParityFixture;
  ticks: number;
  params: readonly string[];
  configPath?: string;
}): string {
  const raw = JSON.parse(fs.readFileSync(opts.configPath ?? DEFAULT_CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
  applyParamOverrides(raw, opts.params);
  const config = parseAircraftConfig(raw);

  const { world } = createPhysicsWorld();
  const aircraft = new AircraftBody(world, config, {
    position: new Vector3(opts.fixture.position.x, opts.fixture.position.y, opts.fixture.position.z),
    linvel: new Vector3(opts.fixture.linvel.x, opts.fixture.linvel.y, opts.fixture.linvel.z),
  });
  const fm = new FlightModel(aircraft);
  const buf = new TrajectoryBuffer(opts.ticks);
  const dt = 1 / 60;

  for (let i = 0; i < opts.ticks; i++) {
    physicsStep(world, aircraft, fm, { throttle: opts.fixture.throttle }, dt);
    buf.record(aircraft.readBodyState());
  }

  return trajectoryToCsv(buf.getRows());
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  await RAPIER.init();
  if (args.mode === 'single') {
    const fixture = lookupFixture(args.fixture);
    const csv = runHarness({ fixture, ticks: args.ticks, params: args.params });
    if (args.out === '-') {
      process.stdout.write(csv);
    } else {
      fs.writeFileSync(args.out, csv);
    }
    return;
  }
  // mode === 'all-fixtures'
  fs.mkdirSync(args.outDir, { recursive: true });
  for (const fixture of PARITY_FIXTURES) {
    const csv = runHarness({ fixture, ticks: fixture.ticks, params: args.params });
    const outPath = path.join(args.outDir, `harness-trajectory-${fixture.id}.csv`);
    fs.writeFileSync(outPath, csv);
  }
}

// Only run main when this module is executed directly (not when imported by
// the test file). `import.meta.url` ends with the file path; we treat any
// invocation where process.argv[1] resolves to this file as a direct run.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
