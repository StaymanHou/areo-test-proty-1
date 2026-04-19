---
feature: wp2-game-loop
phase: verify-codify
state: all-phases-complete
updated: 2026-04-19
source: docs/product/wbs.md (WP2)
---

# WP2: Fixed-timestep game loop

## Scope

Implement the decoupled physics-tick / render-tick loop per arch D1. Accumulator pattern: physics at a fixed 60 Hz, render at monitor refresh. No aircraft — a single falling Rapier cube synced to a Three.js mesh proves the loop. Verify stability under frame drops (tab backgrounding, throttled CPU).

**Out of scope:** input (WP3), camera beyond the existing static one (WP3), anything aircraft-related (WP4+).

## Architecture

No new modules beyond the arch.md skeleton. Fleshes out `src/engine/loop.ts`. No data models, no API endpoints. No architectural decisions — arch D1 already specifies the accumulator pattern.

## Implementation Phases

### Phase 1: Accumulator loop primitive ✓
- [x] `src/engine/loop.ts`: `GameLoop` class. `GameLoopOptions` (physicsDt, maxStepsPerFrame, now, raf, cancelRaf for test injection), `GameLoopCallbacks` (onPhysics, onRender). Public API: `start()`, `stop()`, `setPaused(p)`, `tickOnce(nowSeconds)`.
- [x] Spiral-of-death clamp: `maxStepsPerFrame` default 5; exceeding it discards the remaining accumulator rather than freezing.
- [x] rAF lifecycle: start/stop with cancel, injectable for tests.
- [x] Vitest installed + `npm test` / `npm run test:watch` scripts added to package.json.
- [x] 7 unit tests in `src/engine/loop.test.ts` passing: 60 ticks in 1s of per-frame advancement; one render per rAF regardless of physics step count; clamp at maxStepsPerFrame; alpha in [0,1); partial-frame accumulator correctness; pause skips physics but renders; unpause doesn't flood with accumulated physics from the paused window.

#### Implementation note
The constructor originally used TS parameter-properties (`private readonly cb: ...` in the ctor signature). TS rejected this under `erasableSyntaxOnly`. Converted to a plain field assignment — one extra line, fully compatible with the current strict tsconfig.

### Phase 2: Rapier world + demo cube ✓
- [x] `main.ts`: after `await RAPIER.init()`, create a `RAPIER.World` with gravity `{ x: 0, y: -9.81, z: 0 }`.
- [x] Static ground collider: 100×1×100 cuboid, translated to y=-0.5 (top face at y=0).
- [x] Dynamic rigid body: 1×1×1 box collider at `(0, 5, 0)`, restitution 0.4 so it bounces visibly.
- [x] Three.js `BoxGeometry(1,1,1)` with `MeshStandardMaterial` (orange) — added directional light so it's lit against the sky-blue bg.
- [x] GameLoop wired: `onPhysics(dt)` sets `world.timestep = dt` and calls `world.step()`; `onRender` copies body translation+rotation to mesh, then renders. (Moved Stats.js begin/end into onRender so FPS tracks the full render cost.)
- [x] Camera already looks toward origin from the scene-module defaults; cube is visible from ~6m back.

### Phase 3: Frame-drop stability verification (debug UI done; manual checks in verify-human)
- [x] lil-gui "Pause physics" toggle added; wires to `loop.setPaused`.
- [ ] Manual: background tab for ~10s → cube resumes cleanly, no burst catch-up (verify-human)
- [ ] Manual: Chrome CPU 6× throttle → physics stable, FPS degrades gracefully (verify-human)

## Testing Strategy

- **Unit:** GameLoop accumulator math (Phase 1) — Vitest. Pure logic, no DOM/WebGL, so fast and deterministic.
- **verify-auto:** `npm run build` clean · Vitest suite passes · dev server boots clean.
- **verify-human:** cube falls and rests on invisible ground in browser; debug-mode pause toggle works; tab backgrounding + CPU throttling → no glitches.
- **verify-codify:** the unit tests from Phase 1 already codify the accumulator behavior; nothing more to add.

## Migration Plan

N/A.

## Risks / notes

- **Vitest not yet installed.** Plan says to add it in Phase 1. Use `vitest` + `@vitest/ui` (optional) as dev deps. `jsdom` is NOT needed — GameLoop is environment-agnostic. Vite integrates Vitest automatically (same config).
- **Rapier `world.step()` API.** In `@dimforge/rapier3d-compat`, `world.timestep` is a field on the world; set it before each `step()`. Verify against actual types during build.
- **Interpolation `alpha` passed but unused.** This is intentional forward-compat. Document the plumbing in a comment so WP3 / camera work knows where to hook smoothing.
- **`GameLoop` stop/cleanup.** Needs to cancel rAF on stop to not leak during HMR. Small but easy to miss.

## Definition of done (for verify-human)

- [ ] `npm run dev` → browser shows a cube falling and coming to rest on an invisible ground plane
- [ ] Backgrounding the tab for 10+ seconds, then returning → cube continues normally (no jump, no freeze, no NaN)
- [ ] DevTools CPU 6× throttle → physics still looks correct (cube lands without tunneling through ground); FPS drops but no glitches
- [ ] `?debug=true` → lil-gui has a "Pause physics" toggle that works
- [ ] Vitest unit tests pass on `npm run test`
- [ ] `npm run build` → clean (one Rapier bundle-size warning is expected)
