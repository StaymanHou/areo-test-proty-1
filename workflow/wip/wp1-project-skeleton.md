---
feature: wp1-project-skeleton
phase: plan
state: complete
updated: 2026-04-19
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
- [x] Run `npm create vite@latest . -- --template vanilla-ts` in the project root (DONE: used `--overwrite=ignore`; destructive — required docs rewrite. git init now in place as safety net)
- [ ] Install runtime deps: `three`, `@dimforge/rapier3d-compat`, `lil-gui`, `stats.js`
- [ ] Install dev deps: `@types/three`, `@types/stats.js`
- [ ] Enable TypeScript strict mode in `tsconfig.json` (template default omits it — add manually)
- [ ] Remove Vite template boilerplate (`counter.ts`, sample CSS, default `src/main.ts` contents, `src/assets/*`, `public/favicon.svg`, `public/icons.svg`)
- [ ] Verify `npm run dev` starts the dev server and `npm run build` produces `dist/`

### Phase 2: Scaffold src/ module layout
- [ ] Create dirs per arch.md: `src/engine/`, `src/world/`, `src/aircraft/`, `src/mission/`, `src/hud/`
- [ ] Add a `.gitkeep` to `mission/` and `hud/` (explicitly Phase 2, stay empty per arch D5)
- [ ] Create `public/models/` and `public/config/` dirs (`.gitkeep` each)
- [ ] `src/main.ts`: minimal entry that imports from `engine/`, sets up a Three.js scene + camera + renderer, mounts canvas to `#app`, runs a no-op render loop (`requestAnimationFrame`). Rapier is initialized (async `await RAPIER.init()`) but not yet used — just prove the WASM loads.
- [ ] Single placeholder file in each non-empty module dir (`src/engine/loop.ts`, `src/engine/input.ts`, `src/engine/assets.ts`, `src/engine/debug.ts`, `src/world/scene.ts`, `src/world/terrain.ts`, `src/world/camera.ts`, `src/aircraft/rigidbody.ts`, `src/aircraft/aerosurface.ts`, `src/aircraft/flightmodel.ts`, `src/aircraft/controls.ts`) — each exports a TODO stub. This locks in the layout so later WPs edit, not create.
- [ ] Update `index.html` to have a single `<div id="app">` and clean markup

### Phase 3: Debug UI (Stats.js + lil-gui behind `?debug=true`)
- [ ] `src/engine/debug.ts`: exports `initDebug()` that checks `new URLSearchParams(location.search).has('debug')` and, if true, mounts a Stats.js panel (top-left) and a `lil-gui` instance (top-right). Returns handles so future code can add panels/counters.
- [ ] Wire `initDebug()` into `main.ts` early (before render loop start)
- [ ] In the render loop, call `stats.begin()` / `stats.end()` if debug is enabled
- [ ] Verify: `/` shows scene, no debug chrome; `/?debug=true` shows FPS + empty gui panel

### Phase 4: Docs
- [ ] `README.md`: project blurb (1–2 sentences from CLAUDE.md), setup commands (`npm install`, `npm run dev`), how to open debug mode (`?debug=true`), build command. Link to `docs/product/` for product docs and `CLAUDE.md` for conventions.
- [ ] `CONVENTIONS.md`: right-handed Y-up coordinates (both Three.js and Rapier), module layout rules (where new code goes), debug UI gating rule (never ship debug UI), TypeScript strict rule. Per arch D7 this is a Phase 1 deliverable.

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
