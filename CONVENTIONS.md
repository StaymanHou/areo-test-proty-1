# Conventions

Project-wide rules. Keep this short. Deeper context lives in `docs/product/arch.md`.

## Coordinates

**Right-handed, Y-up.** Both Three.js and Rapier use this by default, so no transform is needed at the physics↔render sync boundary. If you think you need to flip an axis, you probably have a bug elsewhere — check first.

- +Y is up (altitude)
- +Z is backward (toward the camera in a default Three.js view)
- +X is right

Aircraft local frame follows the same convention: nose along −Z, right wing along +X, top of the plane toward +Y. All `AeroSurface` positions, normals, and chord directions are expressed in this local frame.

## TypeScript

Strict mode is on (`"strict": true` in `tsconfig.json`). Do not use `any` without a one-line comment explaining why. Prefer narrow types over broad ones; let inference do the work when it can.

## Module layout

Every file in `src/` has a home dictated by `docs/product/arch.md`. Don't invent new top-level module dirs without updating arch.md. When in doubt:

- **engine/** — runtime mechanics that don't know about aircraft (loop, input, assets, debug)
- **world/** — what's rendered (scene, terrain, camera)
- **aircraft/** — the flying thing (rigidbody, aerosurface, flightmodel, controls)
- **mission/**, **hud/** — empty in Phase 1 (arch D5). Don't put Phase 2 code there yet.

## Debug UI

`lil-gui` panels and `Stats.js` counters **must** be gated on `?debug=true`. See `src/engine/debug.ts`. Never ship a debug panel visible to end users — they reveal internal state and ruin the "no-install, no-tutorial" first impression.

Check with `isDebugEnabled()` before mounting anything developer-facing.

## Physics

- Fixed-timestep physics at 60 Hz. Variable timestep breaks aerodynamic integration. Render at monitor refresh, interpolate poses if needed (WP2).
- Flight-model constants live in `public/config/aircraft.json`, not code. Tune via the lil-gui panel; export the preset back to JSON when it feels right (arch D3).
- Aerosurface is the primitive. Don't scatter ad-hoc lift/drag formulas through the codebase — extend the `AeroSurface` model.

## Phase discipline

WP1 code should not implement WP2+ behavior. Stubs in `src/aircraft/` and `src/engine/` are intentional — later WPs edit them. If you're tempted to pre-build something, resist; it usually means the next WP's plan is the place to have that conversation.
