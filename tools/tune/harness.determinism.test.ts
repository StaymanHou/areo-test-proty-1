import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// WP14.7 Phase 2 — subprocess determinism check. Two full `npm run harness`
// invocations against the same fixture must produce byte-identical CSVs.
// This is the strict version of the in-process determinism test in
// `harness.test.ts`; if it passes, the harness is suitable as the inner
// loop of the WP14.8 Nelder-Mead optimizer (whose convergence depends on
// objective-function determinism). Longer Vitest timeout — each run is a
// ~1800-tick simulation + Rapier-WASM init.

const tmpFiles: string[] = [];

afterAll(() => {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

function mkTmp(): string {
  const p = path.join(os.tmpdir(), `harness-det-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  tmpFiles.push(p);
  return p;
}

function runHarnessSubprocess(out: string, ticks: number): void {
  // `npm run harness` rather than `tsx tools/tune/harness.ts` directly so
  // the test exercises the actual published CLI surface (npm script + tsx +
  // file resolution). `execFileSync` with `npm` arg form avoids shell.
  execFileSync(
    'npm',
    ['run', 'harness', '--', '--fixture', 'throttle-mid', '--ticks', String(ticks), '--out', out],
    { stdio: 'pipe' },
  );
}

describe('harness CLI determinism (subprocess)', () => {
  it('two 1800-tick runs of throttle-mid produce byte-identical CSVs', { timeout: 60_000 }, () => {
    const a = mkTmp();
    const b = mkTmp();
    runHarnessSubprocess(a, 1800);
    runHarnessSubprocess(b, 1800);
    const bufA = fs.readFileSync(a);
    const bufB = fs.readFileSync(b);
    expect(bufA.equals(bufB)).toBe(true);
    // Sanity: 1801 lines (header + 1800 rows).
    expect(bufA.toString('utf-8').split('\n').filter((l) => l.length > 0).length).toBe(1801);
  });
});

// Batch-mode contract — codifies that `npm run harness:parity` (which is
// `--all-fixtures --out-dir <dir>`) writes one CSV per PARITY_FIXTURES
// entry at the expected path, with the expected row count. Until this
// test existed, the batch path was only verified by hand in verify-self;
// a regression that iterated zero fixtures, wrote to the wrong filename
// pattern, or skipped mkdirRecursive would not have been caught by the
// 6 parseArgs all-fixtures unit tests (those only assert on the parsed
// arg shape, not on execution).
describe('harness CLI --all-fixtures (subprocess)', () => {
  it('writes one CSV per PARITY_FIXTURES entry into the target directory', { timeout: 90_000 }, () => {
    const outDir = path.join(os.tmpdir(), `harness-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Track the dir for cleanup (afterAll only unlinks individual files;
    // remove the dir after we know the file names).
    execFileSync(
      'npm',
      ['run', 'harness', '--', '--all-fixtures', '--out-dir', outDir],
      { stdio: 'pipe' },
    );
    const expected = ['throttle-low', 'throttle-mid', 'throttle-high'];
    for (const id of expected) {
      const csvPath = path.join(outDir, `harness-trajectory-${id}.csv`);
      tmpFiles.push(csvPath);
      expect(fs.existsSync(csvPath), `expected ${csvPath} to exist`).toBe(true);
      const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter((l) => l.length > 0);
      // 1801 lines = 1 header + 1800 rows (PARITY_FIXTURES.ticks=1800).
      expect(lines.length, `${id} CSV line count`).toBe(1801);
      // Header sanity.
      expect(lines[0]).toBe('tick,posX,posY,posZ,vX,vY,vZ,pitch,yaw,roll,airspeed');
    }
    // afterAll handles file cleanup via tmpFiles; remove the (now empty) dir too.
    try { fs.rmdirSync(outDir); } catch { /* may have been removed already */ }
  });
});

// CLI error contract — codifies the verify-self observation that an unknown
// fixture exits non-zero with a stderr message naming the bad id and the
// three valid ids. Until this test existed, the contract was only checked
// by hand in verify-self; a regression that swallowed the error or
// returned exit 0 on a typo would ship invisibly.
describe('harness CLI error contract (subprocess)', () => {
  it('unknown fixture exits non-zero with a stderr message listing valid ids', { timeout: 30_000 }, () => {
    let caught: { status: number | null; stderr: string } | null = null;
    try {
      execFileSync(
        'npm',
        ['run', 'harness', '--', '--fixture', 'nonexistent-fixture-id', '--ticks', '60', '--out', '-'],
        { stdio: 'pipe' },
      );
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      caught = {
        status: err.status ?? null,
        stderr: err.stderr?.toString('utf-8') ?? '',
      };
    }
    expect(caught, 'subprocess should have thrown on non-zero exit').not.toBeNull();
    expect(caught!.status).not.toBe(0);
    expect(caught!.stderr).toMatch(/unknown fixture "nonexistent-fixture-id"/);
    expect(caught!.stderr).toMatch(/throttle-low/);
    expect(caught!.stderr).toMatch(/throttle-mid/);
    expect(caught!.stderr).toMatch(/throttle-high/);
  });
});
