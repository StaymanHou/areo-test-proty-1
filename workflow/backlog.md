# Backlog

Surface-notes from workflow runs. Consumed and resolved by higher-level workflows (arch revisions, new WPs, etc.).

## Open

### SURFACE-2026-05-09-04 — Three.js CubeTexture data-upload contract is non-obvious; unit tests can't catch the failure
- **Source:** feature:build (WP8 Phase 4 verify-self back-loop)
- **Target level:** product:arch or process (lesson, not new WP)
- **Type:** lesson / tech-debt
- **Summary:** `new CubeTexture(images)` accepts any `images[]` value at the JS level, but Three's WebGL upload path (`uploadCubeTexture` in `three.module.js:12386`) requires either HTML images / canvases / ImageBitmap / ImageData (default branch), or `DataTexture` instances themselves (data-texture branch, detected via `image[0].isDataTexture === true`). Passing the raw `{data, width, height}` records (i.e. `DataTexture.image`) puts you in the default branch and `texSubImage2D` throws — corrupting WebGL state and blanking the canvas. **Caught at WP8 Phase 4 verify-self, not before**, because vitest unit tests only assert the JS-level shape (image count, sizes, filter), not the browser-side upload contract.
- **Context:** Same gotcha will recur whenever procedural / data-driven cube textures are used (irradiance maps, dynamic skyboxes, captured render-targets, etc.). The Phase 4 WIP file has a regression test (`skybox.test.ts: cube texture face entries are DataTexture instances`) that codifies the contract by checking `cubeTexture.images[i].isDataTexture === true`.
- **Suggested action:** No immediate work. If a future WP introduces another procedural cubemap (Phase 3 polish WP20 likely has a real skybox swap), reference this entry. Consider adding a lint-style check or a CONVENTIONS.md note: "When constructing a CubeTexture from procedural pixel data, pass DataTexture instances, not their `.image` records."
- **Priority:** low (one-time lesson; codified by regression test)
- **Status:** resolved-with-test (no further action needed)

### SURFACE-2026-05-09-05 — Phase 4 verify-self required WP7 trim to fully validate; need a verify-self-friendly trim
- **Source:** feature:build (WP8 Phase 4 verify-self back-loop)
- **Target level:** product:wbs (process; relates to WP9 verification approach)
- **Type:** process / observability gap
- **Summary:** WP8 Phase 4 had two observable outcomes (`horizon-tilt-after-roll`, `tower-parallax-on-approach`) that required sustained level flight to evaluate. Without WP7's tuning preset committed, the default-trim aircraft dives off-screen quickly, breaking continuity for these sustained-frame checks. The skybox-upload fix is verifiable from a single boot screenshot (P4.vs.1 PASS) — but anything requiring "fly for several seconds and observe X" needs a flyable trim.
- **Context:** This confirms the two-way dependency originally noted in SURFACE-2026-05-09-02. WP8's success is partially observable without WP7; WP7's success is partially observable without WP8. Both must land before WP9 can do its "developer takes off, flies, crashes" exit-criteria check.
- **Suggested action:** When `/session-resume`-ing WP7 Phase F, the first action after PF.1 (casual-player nomination) should be to commit the candidate preset block to `public/config/aircraft.json` BEFORE the external feel-check; then re-take WP8's deferred observability outcomes (P4.vs.2 + P4.vs.3) opportunistically during the WP7 feel-check, not as separate verify-self runs.
- **Priority:** medium (load-bearing for the WP7 → WP8 → WP9 chain)
- **Status:** pending

### SURFACE-2026-05-09-02 — No-horizon viewport blocks visual confirmation of attitude
- **Source:** feature:build (WP7 Phase E tuning session)
- **Target level:** product:wbs
- **Type:** dependency / observability gap
- **Summary:** During the WP7 Phase E tuning session, bank and pitch attitudes were not visually confirmable because the chase-cam renders a uniform sky-blue viewport with no horizon, terrain, or landmark in frame. Tuning relied on the weak signal of "doesn't crash" + lil-gui Controls readouts.
- **Context:** Affects WP7 Phase F (external casual-player feel-check) — without spatial reference a non-developer cannot evaluate flight feel. Per the user's session-pause note before this run, WP8 first then WP7 was a viable order; this surfaces post-hoc evidence supporting that order.
- **Suggested action:** Either (a) merge WP8 (Phase 1 world: terrain + skybox + landmarks) before Phase F runs, OR (b) defer the WP7 Phase F feel-check until after WP8 lands. Phase F is primed to ESCALATE-pause for casual-player nomination — that's the natural decision point.
- **Priority:** medium (blocks WP7 Phase F's external feel-check from producing a useful verdict; not blocking the rest of WP7)
- **Resolution:** Resolved by WP8 Phase 4 (2026-05-09). The viewport now renders a gradient skybox + textured ground + runway + tower; horizon line is plainly visible. Verified at `wp8-p4-rev-boot.png`. Next: when WP7 resumes Phase F, the casual-player feel-check is now spatially-grounded and can produce a meaningful verdict.
- **Status:** resolved 2026-05-09

### SURFACE-2026-05-09-03 — `window.__aircraft` debug telemetry hook not implemented
- **Source:** feature:build (WP7 Phase E tuning session)
- **Target level:** product:wbs (likely WP9 Phase 1 verification, paired with SURFACE-2026-05-09-01)
- **Type:** observability gap / tooling
- **Summary:** WP7 Phase E tuning had no programmatic way to read aircraft pitch/altitude/airspeed/bank-angle. The only readouts were the existing lil-gui Controls panel and screenshots (uninformative without a horizon). Future tuning passes (and the proposed Playwright e2e infra in SURFACE-2026-05-09-01) would benefit from a debug-only `window.__aircraft` hook exposing live numeric state.
- **Context:** Mentioned in passing in WP6 retro and SURFACE-2026-05-09-01's "Suggested action" — WP9 already targets this. Phase E surfaces it again as a real (rather than hypothetical) gap.
- **Suggested action:** At WP9 (Phase 1 verification), add a debug-only `window.__aircraft = { body, flightModel, getState: () => ({...}) }` hook in `src/main.ts`'s `if (debug) {...}` block. Use it both for Playwright assertions and for a future tuning-readouts panel in lil-gui.
- **Priority:** low–medium (tracked alongside SURFACE-2026-05-09-01; both wait for WP9 timing)
- **Status:** pending

### SURFACE-2026-05-09-01 — End-to-end browser test infrastructure not configured
- **Source:** feature:verify-codify (WP6 Phase 4)
- **Target level:** product:wbs (likely WP9 Phase 1 verification, or a dedicated tooling WP)
- **Type:** gap / tech-debt
- **Summary:** The project tests via Vitest (unit/integration only). Browser-driven end-to-end verification is performed ad-hoc via Playwright MCP during workflow `verify-self` runs but is not codified into a runnable test suite. The `.playwright-mcp/` directory in the working tree is MCP scratch state, not a configured Playwright test runner.
- **Context:** Phase 4 of WP6 wired flight controls into the dev page. The integration-boundary check at verify-codify wanted to write a "consuming-surface" test, but the codebase has no harness to host it. Live Playwright via MCP served the codification role this iteration. As phases multiply (mission, HUD, combat), one-shot MCP runs won't scale — eventually we want CI-runnable browser tests for at least the critical input-→-motion path.
- **Suggested action:** At WP9 (Phase 1 verification), evaluate adding `@playwright/test` as a dev dep with one CI smoke: load page, dispatch a roll keypress, assert the aircraft body's yaw/pitch/roll changed via a debug-only `window.__aircraft` hook. Keep the suite tiny — single happy-path test per critical input — to avoid the "Playwright tests are flaky" trap.
- **Priority:** low (live verification is sufficient for now; the gap becomes real at Phase 2+)
- **Status:** pending

### SURFACE-2026-04-19-01 — Bundle size: Rapier WASM dominates build
- **Source:** feature:build (WP1 verify-auto)
- **Target level:** product:arch or feature (Phase 3 polish)
- **Type:** perf / tech-debt
- **Summary:** The first production build clocked in at ~2.7 MB unminified / ~978 KB gzipped — above Vite's default 500 KB warning threshold. Dominated by Rapier WASM which is currently bundled inline.
- **Context:** Relates to R1 in research.md (WASM load UX). At 978 KB gzipped, first-load on a mid-range connection is meaningful. WP18 (onboarding) already plans to preload WASM in parallel with splash — this is the mitigation. No action needed before Phase 3.
- **Suggested action:** Leave as-is for Phase 1/2. At Phase 3 WP18/WP21, measure real load time and consider: (a) code-splitting Rapier via dynamic import, (b) loading WASM from `@dimforge/rapier3d-compat`'s external `.wasm` file instead of inlining.
- **Priority:** low (tracked, not urgent)
- **Status:** pending

### SURFACE-2026-04-19-02 — Destructive-scaffold near-miss (already mitigated)
- **Source:** feature:build (WP1 Phase 1)
- **Target level:** process / tooling
- **Type:** lesson
- **Summary:** `npm create vite@latest . -- --template vanilla-ts --overwrite=ignore` **deletes** the existing directory contents (in Vite 9 the flag's name is misleading — "ignore" means "silently overwrite/ignore existing files", which effectively wipes non-template files). This destroyed `docs/product/`, `workflow/`, and `CLAUDE.md`. Full recovery possible only because all content was in the conversation transcript.
- **Context:** Root cause: took a risky action (a scaffolder that alters the whole dir) without first initializing git as a safety baseline. The WP1 plan itself had noted "scaffold into temp dir + copy" as a fallback — I should have used it.
- **Suggested action:** Memory note for future sessions: before running any scaffolder, auto-initializer, template, or CLI that might alter the working directory, **`git init` first** if not already a repo. If git exists, confirm clean or stash first. This is cheap insurance.
- **Priority:** low (already handled this time; captured as a future-session lesson)
- **Status:** resolved (recovery complete; future-session lesson captured)

## Resolved

### SURFACE-2026-05-08-01 — AoA sign convention "chord = into the wind"
- **Source:** feature:build (WP4 Phase 2)
- **Resolution:** Documented in `CONVENTIONS.md` §Coordinates during WP4 finalize. Convention is now: `chord` points leading-edge-into-wind; for a forward-flying plane chord = (0,0,−1); positive AoA = wind on underside → positive lift. Six Phase 1 tests rewritten to physical setups during the discovery fix.
- **Status:** resolved 2026-05-08
