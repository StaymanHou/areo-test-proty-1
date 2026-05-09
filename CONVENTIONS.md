# Conventions

Project-wide rules. Keep this short. Deeper context lives in `docs/product/arch.md`.

## Coordinates

**Right-handed, Y-up.** Both Three.js and Rapier use this by default, so no transform is needed at the physics↔render sync boundary. If you think you need to flip an axis, you probably have a bug elsewhere — check first.

- +Y is up (altitude)
- +Z is backward (toward the camera in a default Three.js view)
- +X is right

Aircraft local frame follows the same convention: nose along −Z, right wing along +X, top of the plane toward +Y. All `AeroSurface` positions, normals, and chord directions are expressed in this local frame.

`AeroSurface.chord` points in the surface's **leading-edge-into-wind** direction — i.e., toward where the relative wind comes from in steady flight. For a wing on a forward-flying plane (nose at −Z), `chord = (0, 0, −1)`. The AoA convention follows from this: positive AoA means the relative wind has a component along `−normal` (wind hitting the underside of the surface), which produces positive lift on a flat-plate symmetric airfoil.

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

## Control sign conventions

`Controls` produces four normalized values:

- `aileron ∈ [-1, +1]` — `+1` rolls right (right wing dips)
- `elevator ∈ [-1, +1]` — `+1` pitches nose up
- `rudder ∈ [-1, +1]` — `+1` yaws nose right
- `throttle ∈ [0, 1]` — `+1` is full forward thrust

`FlightModel.applyControls` translates these into per-surface deflections via a routing table (wing-left/right ← aileron, h-stab ← elevator, v-stab ← rudder). Deflection is applied by rotating both `chord` and `normal` together about a pre-baked `spanAxis = restNormal × restChord`, which preserves their perpendicularity by construction. The routing-table sign multipliers were determined empirically by the per-axis torque tests in `flightmodel.test.ts` — flipping a sign there is the right fix if `+control` produces the wrong body motion.

Default key bindings (US-QWERTY): `A/D` roll, arrows pitch (`↑` = nose up), `Q/E` yaw, `Shift/Ctrl` throttle up/down, `V` swap camera. Override per-instance via `new Controls(input, { keyMap })` or live in dev via the lil-gui Controls > Bindings folder (`?debug=true` only).

## Phase discipline

WP1 code should not implement WP2+ behavior. Stubs in `src/aircraft/` and `src/engine/` are intentional — later WPs edit them. If you're tempted to pre-build something, resist; it usually means the next WP's plan is the place to have that conversation.
