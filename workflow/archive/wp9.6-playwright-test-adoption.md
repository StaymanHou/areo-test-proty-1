---
workflow: feature
state: ship (complete)
created: 2026-05-11
shipped: 2026-05-11 (commit 70b2c2b)
wp: WP9.6
drive_mode: full-autopilot
parent_phase: 1
closes_surfaces:
  - SURFACE-2026-05-09-01   # @playwright/test adoption
  - re-verifies SURFACE-2026-05-11-05  # collider fix durability (regression anchor)
---

# Feature: WP9.6 — Adopt @playwright/test as the WP9 regression anchor

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-05-11
**Drive mode:** full-autopilot

## Problem Statement

WP9 Phase 1 verification's casual-playthrough leaf was BLOCKED by SURFACE-2026-05-11-05 (no aircraft collider → tunneling → NaN). WP9.5 shipped the collider fix and verified it via a Playwright-MCP teleport-to-ground probe, but the *running-system* casual-flight pathway was not re-verified end-to-end, and the verification was ad-hoc (MCP-driven, not codified). SURFACE-2026-05-09-01's 2026-05-11 update explicitly recommends "fold @playwright/test adoption into the WP9.5 follow-up so the first smoke test IS the WP9 Phase 3 regression anchor." This WP does exactly that: adopts `@playwright/test` minimally, writes ONE smoke test = the previously BLOCKED WP9 casual-flight probe, hangs an `npm run test:e2e` script off it, and runs that script as verify-auto. Net outcome: WP9 Phase 1 fully closes, SURFACE-2026-05-09-01 closes, and the project gains a CI-runnable browser-test runner with a single load-bearing test (small surface area = avoids "Playwright tests are flaky" trap per the backlog rationale).

Scope is intentionally tight: Chromium engine only (WebKit/Firefox stays at WP21 cross-browser); ONE happy-path test; reuse existing `window.__aircraft` debug hook + `?debug=true` query string; no headless config tuning, no fixtures, no parallelism, no CI integration (CI is Phase 3 concern).

## Work Tree

- [x] Phase 1: Adopt @playwright/test + smoke test = WP9 casual-flight regression anchor  <!-- status: done -->
  **Observable outcomes:**
  - CLI: `npm run test:e2e` exits 0 with a single test passing in ≤30s on Chromium
  - CLI: `npm run test` (existing Vitest suite) still exits 0 with all prior unit/integration tests passing (no Vitest-↔-Playwright collision; Playwright tests are in their own directory excluded from Vitest's glob)
  - CLI: `npm run build` (tsc + vite build) still exits 0; no type errors introduced
  - Test contract: the smoke test loads `http://localhost:5173/?debug=true` (Vite dev server, started via Playwright's `webServer` config), waits ~5s of simulation, then asserts via `window.__aircraft.getState()`:
    - `Number.isFinite(state.position.y) === true` (altitude finite)
    - `Number.isFinite(state.airspeed) === true` (airspeed finite)
    - `state.airspeed > 0` (aircraft is moving — not frozen / not NaN-via-zero)
    - `Math.abs(state.position.x - 0) < 1000 && Math.abs(state.position.z - (-150)) < 1000` (aircraft moved from spawn but stayed in-world; -150z ≈ 5s of v=-30 m/s flight; loose bounds avoid coupling to specific aero behavior)
    - No JS console errors on the page (`page.on('pageerror')` collector empty)
  - Console: no `[tel f=...]` lines show `airspeed=NaN` during the run (collected via `page.on('console')` filter — fails the test if any line contains `NaN` or `Infinity`)
  - Project-state outcome: `workflow/backlog.md` lists SURFACE-2026-05-09-01 in the **Resolved** section with a link to the test file
  - [x] P1.1 Install `@playwright/test` as devDependency; run `npx playwright install chromium` for the browser binary  <!-- status: done -->
  - [x] P1.2 Create `playwright.config.ts` at repo root: testDir=`tests/e2e`, projects=[{name:'chromium', use: devices['Desktop Chrome']}], webServer={command:'npm run dev', url:'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout:60_000}, timeout:30_000, retries:0, workers:1, reporter:'list'  <!-- status: done -->
  - [x] P1.3 Create `tests/e2e/casual-flight.spec.ts` with the single smoke test described above. Use the `window.__aircraft.getState()` global; use `page.waitForFunction` to wait until `__aircraft` is defined (handles Rapier WASM + aircraft config async load); use `page.waitForTimeout(5000)` for the 5s simulation window after that  <!-- status: done -->
  - [x] P1.4 Add `"test:e2e": "playwright test"` to `package.json` scripts. Created `vitest.config.ts` with `exclude: [..., 'tests/e2e/**']` to prevent Vitest glob collision. Confirmed Vitest still runs 246/246 unaffected.  <!-- status: done -->
  - [x] P1.5 Update `.gitignore`: added `/test-results/`, `/playwright-report/`, `/blob-report/`, `/playwright/.cache/`  <!-- status: done -->
  - [x] P1.6 Updated `CLAUDE.md` "Testing" section + Phase 1 status line (status pre-written for post-success; will be re-confirmed at verify-self)  <!-- status: done -->
  - [x] P1.7 Resolved SURFACE-2026-05-09-01 in `workflow/backlog.md`; appended regression-anchor note to SURFACE-2026-05-11-05  <!-- status: done -->
  - [x] verify-auto  <!-- status: done — tsc clean (after @types/node added for playwright.config.ts); npx playwright test --list resolves 1 test; Vitest 246/246 green; .gitignore artifacts confirmed -->
  - [x] verify-self  <!-- status: done — all 6 CLI outcomes PASS. npm run test:e2e 1/1 in 9.0s; npm run test 246/246 in 0.41s; npm run build clean in 134ms. No integration boundary (isolated new artifacts only). -->
  - [x] verify-human  <!-- status: SKIPPED — full-autopilot drive mode; verify-self gates acceptance -->
  - [x] verify-codify  <!-- status: done — feature deliverable IS the codified regression test (tests/e2e/casual-flight.spec.ts). No additional tests needed. Final confirmation: 246/246 Vitest + 1/1 Playwright green. No integration boundary. -->

## Current Node
- **Path:** Feature > (all phases complete) > ship
- **Active scope:** ready for /feature-ship — single-phase WP, all verification gates passed (verify-human skipped per full-autopilot)
- **Blocked:** none
- **Unvisited:** none (single-phase feature)
- **Open discoveries:** none

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

## Notes / Design Decisions

- **Why a single phase?** Per "small/simple feature" criteria: no new data models, no arch decisions (already discussed in SURFACE-2026-05-09-01), describable in ≤4 sentences, ~30 min agent work, ~50 LoC across config + test + script + docs.
- **Why Chromium-only?** Per backlog Update 2026-05-11: WebKit/Firefox cross-browser is explicitly WP21 (Phase 3 polish). Adding all three engines now adds CI complexity for marginal value at Phase 1.
- **Why `reuseExistingServer: !process.env.CI`?** Allows the local dev (with Vite HMR already running on :5173) to be reused if present; in CI a fresh server is started. Standard Playwright pattern.
- **Why ≤30s test timeout?** Smoke is supposed to be fast. ~5s simulation + ~10s WASM+config load budget + 15s slack.
- **Why not check phugoid stability?** Out-of-scope per the user's explicit directive — SURFACE-2026-05-11-04 is Phase 2 work. The test bounds (`|x|<1000m`, `|z+150|<1000m`) are intentionally loose so the descending-glide attractor passes; we only check FINITE + MOVING, not "stable cruise".
- **Why exclude `tests/e2e/` from Vitest?** Vitest's default glob is `**/*.{test,spec}.?(c|m)[jt]s?(x)` which WOULD pick up `tests/e2e/*.spec.ts`. They use different test APIs (Playwright vs Vitest) so collision is real. P1.4 step explicitly handles this — likely needs `exclude: ['tests/e2e/**']` added to `vitest.config.ts` (create one if it doesn't exist) or to vite.config.ts's test field.
- **Why verify-codify still in the tree if the deliverable IS a test?** Trivially complete — the feature codifies itself. verify-codify will note "regression anchored by the feature deliverable itself" and pass through.
- **verify-human SKIPPED:** full-autopilot mode per drive_mode field. verify-self gates acceptance.

## Retrospect

- **What changed in our understanding:** A `@playwright/test`-style adoption in a Vite + Vitest project has one trap that wasn't in the plan: Vitest's default glob `**/*.{test,spec}.?(c|m)[jt]s?(x)` happily picks up `tests/e2e/*.spec.ts` even though those use Playwright's API. The fix (creating `vitest.config.ts` with an `exclude`) is mechanical, but if missed it would have caused a non-obvious Vitest failure on the next CI run. The plan flagged this (P1.4) and the build step caught it cleanly.
- **Assumptions that held:** The `window.__aircraft.getState()` hook (codified by WP7 / SURFACE-2026-05-09-03) was directly load-bearing — the smoke test consumes it as-is, no changes needed. The descending-glide attractor produced a passing trajectory at 5s with the loose bounds (|x|<1000, |z+150|<1000) the plan picked.
- **Assumptions that were wrong:** I didn't anticipate needing `@types/node`. `playwright.config.ts` references `process.env.CI`, and the project's `tsconfig.json` doesn't include `"node"` in `types`. Caught at verify-auto, added in-flight. Cost: one extra `npm install` step. No behavioral impact.
- **Approach delta:** Implementation matched the plan exactly across P1.1–P1.7; the only deviation was the unplanned `@types/node` install at verify-auto. The 7-task decomposition turned out about right — none of the tasks were skippable, none needed sub-decomposition. Verify-auto caught the type-check issue early (cheap), verify-self surfaced no further issues (the test was green first time), verify-codify was trivially complete (the feature deliverable IS the codified test). All gates passed first time.

## Risk register (single-phase, kept brief)

| Risk | Mitigation |
|------|------------|
| Vite dev server doesn't boot in 60s (cold install) | webServer.timeout=60000; verify-auto runs `npm run dev` once first to warm caches |
| Playwright Chromium binary not installed | P1.1 runs `npx playwright install chromium` explicitly; verify-auto re-runs if missing |
| `window.__aircraft` not defined yet at 5s mark (slow WASM) | use `page.waitForFunction(() => (window as any).__aircraft, {timeout: 20_000})` before the 5s simulation window |
| Test flakes on shared `:5173` port | `reuseExistingServer` allows local Vite to be reused; in autopilot we control the dev server lifecycle, no port contention |
| SURFACE-2026-05-11-04 (phugoid divergent under forcing) trips the FINITE assertion if simulation runs > ~8s under throttle | Test sends NO control inputs (just lets the descending-glide attractor run for 5s). 5s window is well below the ~10–14s phugoid period. Bounds are loose enough that the descending-glide trajectory (alt 50→~33m, airspeed 30→~2 m/s) passes comfortably |

