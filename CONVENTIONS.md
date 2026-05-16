# Conventions

Project-wide rules. Keep this short. Deeper context lives in `docs/product/arch.md`.

## Coordinates

**Right-handed, Y-up.** Both Three.js and Rapier use this by default, so no transform is needed at the physics↔render sync boundary. If you think you need to flip an axis, you probably have a bug elsewhere — check first.

- +Y is up (altitude)
- +Z is backward (toward the camera in a default Three.js view)
- +X is right

Aircraft local frame follows the same convention: nose along −Z, right wing along +X, top of the plane toward +Y. All `AeroSurface` positions, normals, and chord directions are expressed in this local frame.

`AeroSurface.chord` points in the surface's **leading-edge-into-wind** direction — i.e., toward where the relative wind comes from in steady flight. For a wing on a forward-flying plane (nose at −Z), `chord = (0, 0, −1)`. The AoA convention follows from this: positive AoA means the relative wind has a component along `+normal` (wind from below pushing up into the underside of the surface), which produces positive lift on a flat-plate symmetric airfoil.

`AeroSurface.incidenceRad` is the surface's **fixed mount angle** about its span axis (`spanAxis = pre-incidence normal × chord`). It is applied once at construction (and re-applied by `setGeometry`) by rotating both `normal` and `chord` about `spanAxis` by `incidenceRad`. **Positive `incidenceRad` = leading edge up** → positive AoA at level body attitude with forward airflow → positive lift on a symmetric flat plate. Real-airframe trim is built from differential incidence: wings at a few degrees positive, h-stab near zero or slightly negative. Deflections (`setDeflection`) compose on top of the incidence-rotated rest snapshots — they are not affected by the rest convention. Default `incidenceRad = 0` preserves all pre-D10 fixture behavior bit-for-bit. See `arch.md` Revision 2026-05-11 (D10).

`AeroSurface.clQ` is the **pitch-rate damping coefficient** (β4). When set, it amplifies the rotation-induced contribution to the local airflow at the surface position by `(1 + clQ · max(v, V_REF) / V_REF)` in `computeAeroForce`, where `v = |bodyState.linvel|` and `V_REF = 30 m/s`. At `v ≤ V_REF` the factor reduces to `(1 + clQ)` — the original WP6.5 β4 form — preserving low-V calibration bit-for-bit. At `v > V_REF` the factor grows linearly with `v`, so the resulting damping moment scales as `V²`, matching the `V²` growth of the destabilizing pitch moment from `incidenceRad` and keeping the damping ratio constant across the high-V regime. No 1/V singularity. Default `clQ = 0` → no amplification → identical behavior to pre-β4. Wings and h-stab typically benefit from `clQ` in the [1, 16] range; v-stab usually leaves `clQ = 0` (v-stab damps yaw via the same mechanism, not pitch — but in a typical layout with `normal=+X`, the natural mechanism is already correct). See `arch.md` Revision 2026-05-11 ("Fallback path") and the resolution of `SURFACE-2026-05-11-03`.

`AeroSurface.clAlphaDot` is the **AoA-rate damping coefficient** (β5). When set AND the runtime supplies a positive physics `dt` to `computeAeroForce` AND a previous-tick AoA is cached on the surface, the lift coefficient is augmented by `clAlphaDot · dα/dt`, where `dα/dt = (α_now − α_prev) / dt`. **Positive `clAlphaDot` damps AoA rise** — additional lift in the +α direction during rising α produces a damping moment on the AoA oscillation that drives the phugoid mode (long-period coupled airspeed/altitude exchange, ~10–14s at the Phase 1 airframe). The finite difference uses the **physics `dt`** (fixed 1/60s in the runtime), not the variable render `dt` — pass `dt` through `FlightModel.applyForces(throttle, dt)`. **First-tick contract:** the first call to `computeAeroForce` for a surface has no previous-AoA reference, so the augmentation is skipped and `α_now` is recorded for the next call. `setGeometry` resets the previous-AoA cache because a rest-frame change invalidates AoA continuity. Default `clAlphaDot = 0` → no augmentation → identical behavior to pre-β5. Test fixtures and call sites that omit `dt` get pre-β5 behavior unconditionally (the augmentation is gated on `dt !== undefined`). Tuning is a per-mission Phase 2 concern; phugoid verification requires a ≥30s probe at non-zero throttle (single-period observation hides the mode). See `arch.md` Revision 2026-05-12 (D13) and `SURFACE-2026-05-11-04`.

## TypeScript

Strict mode is on (`"strict": true` in `tsconfig.json`). Do not use `any` without a one-line comment explaining why. Prefer narrow types over broad ones; let inference do the work when it can.

## Module layout

Every file in `src/` has a home dictated by `docs/product/arch.md`. Don't invent new top-level module dirs without updating arch.md. When in doubt:

- **engine/** — runtime mechanics that don't know about aircraft (loop, input, assets, debug)
- **world/** — what's rendered (scene, terrain, camera)
- **aircraft/** — the flying thing (rigidbody, aerosurface, flightmodel, controls)
- **aircraft/physics-core/** — the framework-agnostic subset of aircraft/ (see below)
- **mission/**, **hud/** — empty in Phase 1 (arch D5). Don't put Phase 2 code there yet.

### `src/aircraft/physics-core/` boundary

Per arch.md Revision 2026-05-12 (afternoon) §D14.2, modules under `src/aircraft/physics-core/` must be **importable from Node** — they run in the WP14.7 harness without any browser environment.

**Split criterion (intent, not literal):** a file belongs under `physics-core/` if and only if it does **not require a browser API to run**. The naive "imports `three`?" rule is wrong — Three.js exports `Vector3` and `Quaternion` as pure-math classes that work fine in Node. The actual constraint is:

- ✅ Allowed inside `physics-core/`: `Vector3`, `Quaternion`, `Euler` (math primitives); Rapier; standard JS math.
- ❌ Not allowed inside `physics-core/`: `Scene`, `Mesh`, `Group`, `BoxGeometry`, `MeshStandardMaterial`, `Camera`, any DOM, `window.*`, `requestAnimationFrame`, `fetch` to relative paths (use `fs.readFile` or pass the parsed object in).

Modules outside `physics-core/` (e.g., `src/aircraft/rigidbody.ts`) may freely use Three.js rendering primitives. The browser-side `Aircraft` class wraps `AircraftBody` from `physics-core/rigidbody-core.ts` to add Three.js mesh ownership; the harness uses `AircraftBody` directly.

After WP14.7 Phase 3, `physics-core/` has exactly two production callers: one browser caller (`src/main.ts` via the game loop) and one Node caller (`tools/tune/harness.ts`). Both must produce identical trajectories for the same fixture under the same parameters — that's the load-bearing acceptance contract for the WP14.8 Nelder-Mead optimizer (its objective function evaluates `tools/tune/harness.ts` and compares to a reference trajectory; optimizer convergence depends on harness determinism and on harness↔browser parity, so a player tuning live in the browser experiences the same physics the optimizer was fitted against).

The boundary is enforced by the `tests/parity-diff.test.ts` parity test, which uses a precedence: prefer `test-results/harness-trajectory-<id>.csv` (produced by `npm run harness:parity`) for the Node side when available, falling back to an in-process Vitest synthetic stub when only the browser CSV is present. Both runners must remain bit-identical to `|Δ|<1e-6` on all finite trajectory rows; non-finite rows must match in *kind* (NaN-vs-NaN, +Infinity-vs-+Infinity, -Infinity-vs--Infinity) — the parity-of-divergence semantics added in WP14.7 Phase 1.7 to accommodate the SURFACE-2026-05-16-01 β4 instability that the throttle-high fixture exercises by design. The fallback synthetic-stub path preserves the "Vitest-alone is a smoke for everything except parity" contract WP14.6 established. A real parity drift between the two surfaces surfaces a real bug — including the `Aircraft.reset()` force-accumulator bug that the parity test caught during WP14.6 build.

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

## World

The Phase 1 world is a flat 4000 m × 4000 m textured plane with a procedural cubemap skybox, a runway centered at the origin running along world Z, and a control tower at `(40, 0, 250)`. See `src/world/terrain.ts`, `src/world/skybox.ts`, and `src/world/landmarks.ts`. The chase camera's far plane is 5000 m to keep the horizon visible from any cruise altitude inside the terrain extent — adjust if you grow the terrain or need to see beyond it.

## Phase discipline

WP1 code should not implement WP2+ behavior. Stubs in `src/aircraft/` and `src/engine/` are intentional — later WPs edit them. If you're tempted to pre-build something, resist; it usually means the next WP's plan is the place to have that conversation.
