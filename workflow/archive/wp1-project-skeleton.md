---
feature: wp1-project-skeleton
phase: finalize
state: completed
updated: 2026-04-19
completed: 2026-04-19
source: docs/product/wbs.md (WP1)
---

# WP1: Project skeleton & dev loop

## Scope

Initialize the Vite + TypeScript + Three.js + Rapier project. Boot an empty scene that renders, with HMR, Stats.js FPS counter, and a lil-gui panel gated on `?debug=true`. Scaffold the `src/` module layout from `docs/product/arch.md`. Write a minimal README and a `CONVENTIONS.md`.

**Out of scope (deferred to later WPs):** game loop / fixed-timestep physics (WP2), input/camera (WP3), aerosurface (WP4), flight model (WP5), controls (WP6), tuning (WP7), terrain (WP8).

## Architecture

No new data models or API endpoints. No architectural decisions — all decisions made in `docs/product/arch.md`. This WP implements the skeleton those decisions describe.

## Implementation Phases

### Phase 1: Vite + TypeScript bootstrap
- [x] Run `npm create vite@latest . -- --template vanilla-ts` in the project root (used `--overwrite=ignore`; destructive — required docs rewrite. git init now in place as safety net)
- [x] Install runtime deps: `three`, `@dimforge/rapier3d-compat`, `lil-gui`, `stats.js`
- [x] Install dev deps: `@types/three`, `@types/stats.js`
- [x] Enable TypeScript strict mode in `tsconfig.json` (template default omits it — added manually)
- [x] Remove Vite template boilerplate (`counter.ts`, sample CSS, default `src/main.ts` contents, `src/assets/*`, `public/favicon.svg`, `public/icons.svg`)
- [x] Verify `npm run build` produces `dist/` (passed; bundle size warning is Rapier WASM — expected per R1)

### Phase 2: Scaffold src/ module layout
- [x] Create dirs per arch.md: `src/engine/`, `src/world/`, `src/aircraft/`, `src/mission/`, `src/hud/`
- [x] Add a `.gitkeep` to `mission/` and `hud/` (explicitly Phase 2, stay empty per arch D5)
- [x] Create `public/models/` and `public/config/` dirs (`.gitkeep` each)
- [x] `src/main.ts`: minimal entry. Sets up Three.js via `world/scene.ts`, mounts canvas to `#app`, awaits `RAPIER.init()` (proves WASM loads), runs a no-op render loop.
- [x] Placeholder file in each non-empty module dir (engine/loop, engine/input, engine/assets, engine/debug, world/scene, world/terrain, world/camera, aircraft/rigidbody, aircraft/aerosurface, aircraft/flightmodel, aircraft/controls). `scene.ts` and `debug.ts` are real; rest are TODO stubs.
- [x] Update `index.html` to a single `<div id="app">` with canvas-friendly styles

### Phase 3: Debug UI (Stats.js + lil-gui behind `?debug=true`)
- [x] `src/engine/debug.ts`: exports `isDebugEnabled()` + `initDebug()`. Returns `{ stats, gui }` handles or null.
- [x] Wire `initDebug()` into `main.ts` before the render loop
- [x] Render loop calls `stats.begin()` / `stats.end()` via optional chaining
- [ ] Verify: `/` shows scene, no debug chrome; `/?debug=true` shows FPS + empty gui panel (defer to verify-human)

### Phase 4: Docs
- [x] `README.md`: blurb, setup, `?debug=true` note, build command, link to CLAUDE.md and docs/product/
- [x] `CONVENTIONS.md`: right-handed Y-up coords, TS strict, module layout, debug UI gating, physics rules, phase discipline

## Testing Strategy

Skeleton WP has no unit tests (no behavior yet). Verification is:

- **verify-auto:** `npm run build` succeeds with no TypeScript errors; `npm run dev` boots cleanly; no console errors or warnings on load.
- **verify-human:** open dev URL, confirm empty scene renders; open `?debug=true`, confirm Stats.js FPS shows and lil-gui panel appears; confirm `npm run build` produces a deployable `dist/`.
- **verify-codify:** nothing to codify — there is no behavior to freeze. WP2 will add the first unit-testable surface (game loop).

## Migration Plan

N/A — greenfield.

## Incident note (2026-04-19)

During Phase 1 bootstrap, `npm create vite@latest . -- --overwrite=ignore` deleted the existing `docs/product/`, `workflow/`, and `CLAUDE.md` (Vite 9 `--overwrite=ignore` silently overwrites the dir contrary to the name). Recovery: docs/CLAUDE.md/WIP rewritten verbatim from conversation transcript; `git init` run as safety baseline. No content lost. Lesson logged for session-reflect later.

## Definition of done (for verify-human)

- [ ] `npm install && npm run dev` → browser shows an empty Three.js scene, no errors in console
- [ ] Visiting `?debug=true` → Stats.js FPS counter visible; lil-gui panel visible (may be empty)
- [ ] `npm run build` → produces `dist/` with no TypeScript errors
- [ ] `src/` has the full module skeleton from arch.md (engine/, world/, aircraft/, mission/, hud/)
- [ ] `README.md` and `CONVENTIONS.md` exist and cover the points listed in Phase 4
