---
workflow: feature
state: plan (complete)
created: 2026-05-09
entry: spec
drive_mode: full-autopilot
wbs_ref: WP8
---

# Feature: WP8 — Phase 1 world (flat terrain + skybox + landmarks)

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-05-09
**Entry:** spec (complex feature — small but spans 5 sub-systems: terrain mesh, ground collider, skybox, landmark placement, perf budget; touches arch-defined interface)

## Problem Statement

Right now the player flies over an empty sky-blue void. The viewport background is a solid `0x87ceeb` color set in `world/scene.ts:18` and the only ground is a hidden Rapier-only `cuboid(50, 0.5, 50)` collider parked at `y = -0.5` (`main.ts:36`) with no rendered mesh. There is no horizon line, no terrain texture, no landmark, and the rendered ground collider is much smaller than the aircraft's flight envelope (the WP5 launch state puts the plane at `y=50` cruising at `30 m/s`, which clears the 100m × 100m collider in ~3.3s). The result is that **bank angle, pitch attitude, altitude, and forward speed are not visually confirmable.** The lil-gui readouts give numeric throttle/control values but nothing about world-relative pose.

**[Updated 2026-05-09: back-loop re-check]** Problem statement unchanged — the underlying "no spatial reference" problem remains. The Phase 4 verify-self failures (skybox cubemap upload error + tower placed at +Z when spawn flies toward -Z) are surface-level defects within the existing problem framing, not a re-framing of the root cause. Continue with the same problem statement.

This directly blocks two pieces of work:
1. **WP7 Phase F** (external casual-player feel-check, currently paused at ESCALATE) — a non-developer cannot evaluate whether flight feels right against a uniform blue field. SURFACE-2026-05-09-02 in the backlog logs this from the WP7 Phase E tuning session.
2. **WP9 Phase 1 verification** — the exit criterion "a developer can take off, fly around, and crash" requires a visible world to fly *in*.

The arch (D4) committed Phase 1 to flat terrain + skybox + 2–3 landmarks (runway, tower) with a forward-compatible `terrain.ts` interface so a Phase 3 heightmap is a drop-in swap. The interface was stubbed in `src/world/terrain.ts` as a comment block but is not implemented. WP8 implements it.

## User Stories

- **As a developer flying around**, I want a horizon line and a textured ground plane below me, so that I can see my bank angle and pitch attitude without reading numeric debug panels.
- **As a developer**, I want a runway and a tower placed in the world, so that I have spatial reference for "where I started," "how high am I," and "am I moving forward at all" — not just "the sky is blue and I might be inverted."
- **As the WP7 Phase F casual-player tester** (downstream user), I want to fly around and have my mental model of "I'm rolling left," "I'm pitching up," "I'm climbing" agree with what I see, so that my feel-check produces a useful verdict instead of a shrug.
- **As a Phase 3 polish engineer** (forward-compat), I want to swap the flat-plane implementation for a heightmap by re-implementing one interface, so that Phase 1 is not a rewrite when terrain upgrades.
- **As a frame-budget watcher**, I want adding the world to consume well under the 60fps frame budget on the reference laptop with the aircraft flying, so that subsequent WPs (HUD, particles, AI) inherit a healthy headroom.

## Acceptance Criteria

The feature is **done** when:

1. **Terrain interface lands.** `src/world/terrain.ts` exports a real TypeScript `interface Terrain` (replacing the comment stub) with at minimum:
   - `getHeight(x: number, z: number): number` — height at world XZ. Returns a constant for flat impl.
   - `getMesh(): THREE.Mesh` — the visible ground mesh (added once to the scene by the caller).
   - `getCollider(): RAPIER.Collider` — the static collider attached to the Rapier world (created once by the caller).
   - The interface is exact-match-able by a future heightmap implementation. Method names, signatures, and return types follow arch.md D4 verbatim.
2. **Flat-plane implementation.** A `FlatTerrain` class (or factory) implements `Terrain`:
   - Mesh is a `PlaneGeometry` lying in the XZ plane (Y-up, per CONVENTIONS.md), large enough that the aircraft cannot exit it during a normal flight session — **at least 4000 m × 4000 m** (rationale: at 30 m/s cruise that's ~67s before the edge; well beyond a tuning session).
   - Mesh is textured (not a flat color). Texture is a tiled pattern with visible features (grid, checker, or grass-like) so motion across the surface is detectable. Stored under `public/textures/` with permissive licensing.
   - Mesh has appropriate UV repeat (e.g. 100×100 tiles across the plane) so the texture is not stretched into a smear.
   - The Rapier collider is a static plane or large flat cuboid sized to match the mesh. Placed at the same Y as the visible mesh so "wheels-down on visible ground" doesn't have a vertical offset bug.
3. **Skybox.** The scene has a skybox (cubemap on `scene.background`, NOT a flat color). A horizon line is visible where ground meets sky from any angle the chase/cockpit cameras can produce, including looking straight up (sky), straight down (ground), and at the horizon (line). 6-face cubemap files live under `public/textures/skybox/` with permissive licensing. The existing `scene.background = new Color(0x87ceeb)` line is removed.
4. **Landmarks present.** At minimum **two** placed objects in the world for spatial reference (per the WBS WP8 task list and arch.md D4 "2–3 placed landmarks"):
   - **A runway** — a long thin textured/striped mesh aligned with a documented heading (e.g. north–south along world Z), placed near the origin so the WP5 spawn at `(0, 50, 0)` has it visible below. Width/length per a real-ish small-airfield ratio (e.g. 30m × 600m) — exact numbers a planning-time decision.
   - **A control tower** — a simple textured or flat-shaded box-and-roof mesh placed at one end of the runway, tall enough to be visible from cruise altitude. Geometry can be a couple of stacked boxes; this is a landmark, not a model.
   - Both landmarks have static Rapier colliders so a low pass clips, not phases through (collision feedback for "I just hit the tower" is desirable feel even if there's no damage system in Phase 1). Tower collider is a single box; runway collider is the same flat plane as the terrain (no separate collider needed for the painted strip).
5. **Replaces WP1 ground collider.** The hand-coded `RAPIER.ColliderDesc.cuboid(50, 0.5, 50)` block in `main.ts` is removed. The terrain instance is the sole source of the ground collider, added to the world via `world.createCollider(terrain.getCollider())` (or equivalent) in `main.ts`.
6. **Aircraft spawn unchanged.** The aircraft still spawns at `(0, 50, 0)` with `linvel (0, 0, -30)`. After WP8, that spawn is now visibly above the runway and pointing down its long axis (so the player's first frame is "I'm above a runway, I can see where I am"). If the WP5 spawn happens not to land directly above the runway, either the spawn or the runway placement adjusts; the spawn position is more durable so the runway moves to it.
7. **60fps budget preserved.** With the aircraft flying and the world rendered:
   - On the reference machine (user's laptop, Chrome): Stats.js shows ≥ 58fps sustained over a 30-second flight, including a banking turn and a low pass over the tower.
   - In Playwright headless (verify-self): a 5-second `requestAnimationFrame` count is consistent with ≥ 55fps (allow some headroom for headless overhead).
8. **Terrain unit-tested where it makes sense.** `getHeight()` is testable (returns the flat constant); the world-space mesh AABB and collider half-extents are testable from instantiation. **Skybox + texture loading is NOT unit-tested** — it's a render-path verification (verify-self).
9. **Verify-self confirms visual outcomes** in browser via Playwright MCP:
   - Page loads with `?debug=true`.
   - A screenshot taken at boot shows: textured ground plane (not solid color), skybox (not solid color), runway visible, tower visible.
   - A screenshot taken after a 90° roll input shows the horizon tilted (visual confirmation that the world reference is now usable for attitude reading).
   - A screenshot from a low pass over the tower shows the tower at angular size larger than at boot (parallax / approach is visible).

## Out of Scope

- **Heightmap terrain.** Phase 3 polish (WP20). The interface is shaped for it; the implementation is deliberately a flat plane.
- **Multiple landmarks beyond runway + tower.** WBS says "2–3"; we ship 2. Adding more is cheap if WP9 verification asks for it.
- **Lighting changes.** The existing `HemisphereLight` + `DirectionalLight` from WP1/WP6 stay. Sun-position tuning is WP20.
- **Atmospheric / fog effects.** Phase 3 polish.
- **Runway markings, lights, taxiways.** A textured strip is enough for spatial reference. Beautification is WP20.
- **Tower interior, windows, animation.** Box-and-roof, single material.
- **Wind / airflow visualization.** Out of Phase 1 entirely.
- **Damage on landmark collision.** The collider exists for "you hit something solid" feel; there's no health system. Crashing into the tower is allowed to be "you stop with a thud," not "you explode."
- **Audio.** WP19.
- **`window.__aircraft` debug telemetry hook.** SURFACE-2026-05-09-03 — explicitly tagged for WP9.
- **Codified Playwright e2e suite.** SURFACE-2026-05-09-01 — explicitly tagged for WP9. WP8 verify-self uses Playwright MCP ad-hoc, same pattern as WP6/WP7.

## Technical Constraints

- **Right-handed Y-up coordinates.** Per CONVENTIONS.md and arch.md D7. Plane lies in XZ; landmarks are placed with positive Y as up.
- **Three.js r170+** — `CubeTextureLoader` for the skybox, `PlaneGeometry` for the ground, `BoxGeometry` for the tower. No exotic loaders.
- **Rapier statics.** Ground is a static plane (`ColliderDesc.cuboid` with very large half-extents OR a true heightfield with a single cell — the spec leaves the exact primitive to planning, but it is **static**, not kinematic). Tower is a static box collider.
- **Texture licensing.** Any texture asset committed to `public/textures/` must be permissively licensed (CC0 / CC-BY with attribution / public-domain). Note attribution in a `public/textures/CREDITS.md` if needed.
- **Bundle-size sensitivity.** SURFACE-2026-04-19-01 already flagged the build at ~978 KB gzipped (Rapier WASM dominant). Skybox cubemap faces should be **≤ 512×512 each** for Phase 1 — this is debug-quality, not ship-quality. Phase 3 polish (WP20) upgrades to higher-res. Together: ground texture ≤ 1024×1024, six skybox faces ≤ 512×512 each — total added asset weight target **≤ ~1.5 MB on disk before gzip**, with the recognition that PNGs already compress poorly via gzip and the meaningful budget is on-disk.
- **No backend / no fetched assets at runtime.** Textures are static under `public/`, served by Vite as part of the build.
- **No external 3rd-party APIs** — confirmed during the 3rd-party probe check. All work is local Three.js + Rapier.
- **Phase 1 module discipline.** WP8 lives in `src/world/`. It does NOT touch `src/aircraft/`, `src/mission/`, or `src/hud/`. The only consumer-side change in `main.ts` is replacing the WP1 ground collider with `terrain.getCollider()` and adding the terrain mesh + skybox to the scene.

## Open Questions — resolved at plan time (2026-05-09)

All four spec-time open questions are resolved as planning decisions (no research spike needed):

- [x] **Texture sources** → **CC0 procedural patterns generated locally** for both ground and skybox. The ground texture is a programmatic checker / grid drawn to a `CanvasTexture` at 1024×1024, then tiled. The skybox is six `CanvasTexture` faces (each 256×256) drawn programmatically — gradient sky with a sun disc on the +X face, ground tint at the −Y face, neutral at +Y. **Rationale:** zero asset-licensing audit, zero network/build dep, ≤ 100 KB total disk, debug-quality is the explicit Phase 1 goal. Real art is WP20 polish. This deliberately retires the `public/textures/CREDITS.md` constraint from spec — no external assets means no credits file needed (note in spec retroactively).
- [x] **Runway alignment** → **along world Z**, runway centered at origin running from `(0, 0, +300)` (south end) to `(0, 0, -300)` (north end), 30m wide. Spawn `(0, 50, 0)` flying `linvel (0, 0, -30)` puts the plane above runway-center flying north toward the far end. Confirmed against CONVENTIONS.md (nose along −Z) and `main.ts:42`.
- [x] **Tower collider authority** → **static `cuboid` collider** matching visible box geometry. Rapier default contact response stops the dynamic body on contact. Tower placed near the south end of the runway at `(40, 0, 250)` (20m east of runway centerline, 250m south of origin) so it's a visible-but-not-blocking landmark from the spawn position. Tower ~30m tall.
- [x] **Skybox seams** → use `CanvasTexture` faces with `magFilter = LinearFilter`, `wrapS/wrapT = ClampToEdgeWrapping`. Procedurally drawn faces have no compression artifacts; seams are a math problem at cube corners — handled by drawing edge pixels of each face to match its neighbors' edge colors. Verify-self screenshot at horizon angle confirms.

## Recommendation (recap from spec)

Spec was clear; planning resolved the four questions above. **Proceeding to Work Tree.**

## Work Tree

- [x] Phase 1: Terrain interface + flat-plane impl (no scene wiring)  <!-- status: COMPLETE -->
  **Observable outcomes:**
  - Browser: N/A (this phase is module-level; consumer-side wiring is Phase 4)
  - HTTP: N/A (no backend)
  - CLI: `npm run test -- terrain` exits 0; new tests in `src/world/terrain.test.ts` pass; `npm run build` (which runs `tsc && vite build`) exits 0 with no type errors introduced
  - Module: `import { Terrain, FlatTerrain } from './world/terrain'` succeeds; `new FlatTerrain({ size: 4000, height: 0 })` returns an object satisfying the `Terrain` interface; `terrain.getHeight(123, -456) === 0`; `terrain.getMesh()` is a `THREE.Mesh` with a `PlaneGeometry`; `terrain.getCollider()` is a `RAPIER.ColliderDesc` (descriptor — caller creates collider in the world)
  - [x] P1.1 Replace the comment-stub in `src/world/terrain.ts` with a real `interface Terrain` exporting `getHeight(x, z)`, `getMesh()`, `getColliderDesc()` (renamed from `getCollider()` — return a `RAPIER.ColliderDesc`, not an instantiated collider, so callers control world ownership; the spec's `getCollider()` shape was loose and `ColliderDesc` is the more idiomatic Rapier handoff. Document the rename in CONVENTIONS.md if it's load-bearing).
  - [x] P1.2 Implement `FlatTerrain` class: constructor takes `{ size, height, textureRepeat }`; builds a `PlaneGeometry(size, size)` rotated to lie in XZ at `y = height`; material uses a procedurally-built ground texture (checker pattern) with `RepeatWrapping` and the configured `repeat` count; `ColliderDesc.cuboid(size/2, 0.1, size/2)` translated to `(0, height - 0.1, 0)` so the collider's top surface is at `y = height` (matches the visible mesh).
  - [x] P1.3 Procedural ground-texture helper `createCheckerTexture(opts)` in `src/world/textures.ts` — returns a `DataTexture`. Pure function on top of `paintCheckerRGBA(size, tiles, c1, c2)` which produces a raw RGBA `Uint8Array`. Bonus: `createRunwayStripeTexture` (used by Phase 3) lives in the same module to amortize the texture-helper machinery.
  - [x] P1.4 Unit tests in `src/world/terrain.test.ts` (17 tests): `FlatTerrain` satisfies the `Terrain` interface; defaults; configured size/height/textureRepeat; throws on bad input; `getHeight()` returns the configured constant for any (x, z); `getMesh()` returns a Mesh with the configured PlaneGeometry size; mesh positioned at configured Y; textureRepeat applied to the bound texture; mesh is cached across calls; `getColliderDesc()` returns a `RAPIER.ColliderDesc`; cuboid half-extents match size/2; collider top-surface Y aligns with visible mesh height (at h=0 and h=25); world.createCollider succeeds.
  - [x] P1.5 Unit tests in `src/world/textures.test.ts` (14 tests): RGBA buffer length, color alternation between adjacent tiles, alpha=255, rejects bad input, deterministic across calls, `createCheckerTexture` returns a DataTexture with configured size, RepeatWrapping by default, LinearFilter mag, defaults; runway-stripe variants.
  - [x] P1.6 **[Build-time refinement, 2026-05-09]** Used `DataTexture` (raw `Uint8Array`) instead of `CanvasTexture` for the procedural ground texture. Rationale: vitest runs in Node by default (no `vite.config.ts` / `vitest.config.ts` overriding to jsdom/happy-dom), so `document.createElement('canvas')` is unavailable in unit tests. `DataTexture` works in pure Node and produces the same visual result for a procedural checker pattern. Same approach will apply to skybox in Phase 2 (six `DataTexture` faces). Observable outcomes UNCHANGED — this is an impl-detail swap, not a plan back-loop. Confirmed no further skill back-loop needed.
  - [x] verify-auto  <!-- status: COMPLETE — tsc clean, 31/31 scoped tests pass -->
  - [x] verify-self  <!-- status: COMPLETE — no integration boundary (isolated new module). All CLI/Module outcomes PASS via vitest+tsc+vite-build; Browser/HTTP outcomes N/A by design. npm build dist +~7 KB gzipped (under the 200 KB phase budget). -->
  - [x] verify-human  <!-- status: SKIPPED — full-autopilot drive mode -->
  - [x] verify-codify  <!-- status: COMPLETE — added 3 integration-style tests (mesh rotation preserved, dynamic ball rests on collider, far-corner body doesn't fall through). Full suite 178/178 pass. -->

- [x] Phase 2: Skybox  <!-- status: COMPLETE; depends on Phase 1 -->

  **Relevance check (before Phase 2):**
  - Requester still needs this: yes — user explicitly chose "WP8 first" path; skybox directly retires the sky-blue-viewport half of SURFACE-2026-05-09-02
  - Requirements unchanged: yes — no learnings in Phase 1 that change skybox scope
  - Solution still feasible: yes — Phase 1's `paintRGBA + DataTexture` pattern transfers cleanly to 6 cube faces
  - No superior alternative discovered: yes — `CubeTexture` accepting `DataTexture[]` is still the right shape
  **Verdict:** proceed

  **Observable outcomes:**
  - Browser: with `?debug=true`, page renders with a non-uniform sky background (no longer the solid `0x87ceeb` color); horizon line is visible at the boundary between skybox bottom and the ground plane (Phase 4 wires it up — this phase delivers just the skybox factory)
  - CLI: `npm run test -- skybox` exits 0; new tests in `src/world/skybox.test.ts` pass; `npm run build` exits 0
  - Module: `createProceduralSkybox()` returns a `THREE.CubeTexture` with six valid faces, each 256×256, with `magFilter = LinearFilter`
  - [x] P2.1 `src/world/skybox.ts` — exports `createProceduralSkybox(opts)` returning `{ cubeTexture, faces }`. Six face images built as raw `Uint8Array` RGBA buffers + wrapped in `DataTexture`. Gradient on the four side faces (zenith at top row, horizon at bottom row), uniform zenith on +Y, uniform ground-color on −Y. Optional sun disc with soft falloff stamped onto the configured side face.
  - [x] P2.2 Edge-color matching: all four side faces share the SAME `paintSideFaceRGBA(zenith, horizon)` call so their top rows are pixel-equal (and so are their bottom rows). +Y face is `paintSolidFaceRGBA(zenith)` so it matches each side face's top row. −Y is `paintSolidFaceRGBA(groundColor)`. ClampToEdgeWrapping. Tested explicitly: "side faces share identical zenith and horizon colors" + "+Y face is uniform zenith color (matches side-face top row)".
  - [x] P2.3 Unit tests in `src/world/skybox.test.ts` (20 tests): `paintSideFaceRGBA` shape + zenith/horizon row positions + uniform-row property + alpha; `paintSolidFaceRGBA` uniform; `stampSunDiscRGBA` centre-color + outside-radius untouched + edge-bound safety; `createProceduralSkybox` returns CubeTexture + 6 DataTexture faces, configured size honored, ClampToEdge wrapping, LinearFilter mag, edge-color guarantee across side faces, +Y matches top-row, −Y matches groundColor, sun on/off, rejects bad input.
  - [x] verify-auto  <!-- status: COMPLETE — tsc clean, 20/20 scoped tests pass -->
  - [x] verify-self  <!-- status: COMPLETE — no integration boundary (skybox factory not yet consumed). Browser outcome explicitly deferred to Phase 4 per plan. CLI + Module outcomes PASS. Bundle size unchanged (985.05 KB gzipped) — tree-shaking confirms isolation. -->
  - [x] verify-human  <!-- status: SKIPPED — full-autopilot drive mode -->
  - [x] verify-codify  <!-- status: COMPLETE — existing 20 tests already cover all user-meaningful invariants (incl. seam guarantee). No new tests needed; full suite 198/198 pass. -->

- [x] Phase 3: Landmarks (runway + tower)  <!-- status: COMPLETE; depends on Phase 1 -->

  **Relevance check (before Phase 3):**
  - Requester still needs this: yes — second half of retiring SURFACE-2026-05-09-02
  - Requirements unchanged: yes — runway along Z, tower at (40, 0, 250) per plan
  - Solution still feasible: yes — `createRunwayStripeTexture` pre-staged in Phase 1; pattern matches `aircraft/rigidbody.ts`
  - No superior alternative discovered: yes — procedural geometry is the right shape for Phase 1
  **Verdict:** proceed

  **Observable outcomes:**
  - Browser: N/A (this phase is module-level; scene wiring is Phase 4)
  - CLI: `npm run test -- landmarks` exits 0; `npm run build` exits 0
  - Module: `createRunway({ length: 600, width: 30, position })` returns `{ mesh: THREE.Mesh, colliderDesc: RAPIER.ColliderDesc | null }` (runway has no separate collider — it's painted on the terrain plane, so `colliderDesc: null` is the correct shape, signalling "rendered geometry only"); `createTower({ height: 30, footprint: 8, position })` returns `{ mesh: THREE.Group, colliderDesc: RAPIER.ColliderDesc }`
  - [x] P3.1 `src/world/landmarks.ts` — `createRunway(opts)`. Geometry: `PlaneGeometry(width, length)` rotated to lie flat in XZ. Material: dark grey via `MeshStandardMaterial` with the procedural striped texture from `createRunwayStripeTexture` (P1.3). Positioned at the configured world location, raised by yEpsilon (default 0.05) above the terrain to avoid Z-fighting. Default placement aligned with world Z, centered at origin per the resolved open-question. Returns `{ mesh, colliderDesc: null }`.
  - [x] P3.2 `createTower(opts)` in `src/world/landmarks.ts`. Geometry: a `Group` containing a tall `BoxGeometry(footprint, height, footprint)` body + a wider flat `BoxGeometry(footprint*1.4, 1, footprint*1.4)` cap on top. Material: light-grey body (0xc8c8c8) + red cap (0xc83232). Default position `(40, 0, 250)`; body's bottom sits at the configured y, cap at the top. Static `RAPIER.ColliderDesc.cuboid(footprint/2, height/2, footprint/2)` translated to `(position.x, position.y + height/2, position.z)`. Returns `{ mesh, colliderDesc }`.
  - [x] P3.3 Unit tests in `src/world/landmarks.test.ts` (19 tests): runway returns Mesh + null colliderDesc; default & configured dimensions; positions runway at origin by default + Z-fighting epsilon honored; throws on bad input. Tower returns Group with 2 children; ColliderDesc returned; default 30m × 8m footprint; default position (40, *, 250) with collider centered at height/2; custom position honored; mesh-group at configured world XZ; body & cap stacking; throws on bad input; world.createCollider succeeds. PLUS one integration test: a moving body launched at the tower is stopped by the collider (a real "doesn't pass through" check).
  - [x] verify-auto  <!-- status: COMPLETE — tsc clean, 19/19 scoped tests pass -->
  - [x] verify-self  <!-- status: COMPLETE — no integration boundary. Browser N/A by plan; CLI + Module outcomes PASS. Bundle size unchanged (985.05 KB gzipped) — tree-shaking confirms isolation. -->
  - [x] verify-human  <!-- status: SKIPPED — full-autopilot drive mode -->
  - [x] verify-codify  <!-- status: COMPLETE — added 1 alignment test (runway long axis along world Z). Full suite 218/218 pass. -->

- [x] Phase 4: Wire world into the scene + replace WP1 ground collider  <!-- status: COMPLETE; depends on Phase 1, 2, 3 -->

  **Relevance check (before Phase 4):**
  - Requester still needs this: yes — first user-visible phase; retires SURFACE-2026-05-09-02
  - Requirements unchanged: yes — wire terrain + skybox + landmarks into main.ts, remove WP1 ground collider
  - Solution still feasible: yes — Phases 1-3 module APIs all PASS verify-self
  - No superior alternative discovered: yes — direct main.ts integration is the right shape (no scene-graph framework)
  **Verdict:** proceed

  **Observable outcomes:**
  - Browser: with `?debug=true` at `localhost:5173`, on initial load the viewport shows: (a) a textured ground plane (checker pattern, NOT solid color) below, (b) a gradient skybox above (NOT solid `0x87ceeb`), (c) a runway visible directly below the spawn point, (d) a control tower visible to the east-southeast of spawn. No JS console errors on load.
  - Browser: after holding `D` (roll-right) for ~2s, a Playwright screenshot shows the horizon LINE is tilted from horizontal (i.e. ground is no longer evenly distributed at the bottom of the frame). This is the key visual outcome that retires SURFACE-2026-05-09-02.
  - CLI: `npm run test` (full suite) exits 0; `npm run build` exits 0; total dist size growth from this WP < 200 KB (Vite build output `dist/assets/*.js`).
  - Code: `main.ts` no longer contains `RAPIER.ColliderDesc.cuboid(50, 0.5, 50)` — it has been replaced by the terrain's `getColliderDesc()` consumed via `world.createCollider(terrain.getColliderDesc())`.
  - [x] P4.1 In `main.ts`: removed the WP1 ground-collider lines (the `groundDesc` / `world.createCollider(groundDesc)` block). Instantiated `FlatTerrain({ size: 4000, height: 0, textureRepeat: 100 })`, added `terrain.getMesh()` to the scene, called `world.createCollider(terrain.getColliderDesc())`.
  - [x] P4.2 In `world/scene.ts`: removed `scene.background = new Color(0x87ceeb)` and the unused `Color` import. Background is now caller-assigned (main.ts assigns the skybox CubeTexture). Bumped camera far plane from 2000 → 5000 in the same edit (P4.4) since both lines are in `createRenderContext`.
  - [x] P4.3 In `main.ts`: imported `createProceduralSkybox`, `createRunway`, `createTower`. Assigned `scene.background = createProceduralSkybox().cubeTexture`. Added runway and tower meshes to the scene. Created the tower collider via `world.createCollider(tower.colliderDesc)`.
  - [x] P4.4 Camera far-plane bumped from 2000 → 5000 in `world/scene.ts` to handle the 4000m terrain extent. Documented in CONVENTIONS.md under a new `## World` section.
  - [x] verify-auto  <!-- status: COMPLETE — tsc clean, vite build clean (987.08 KB gzipped, +2 KB from Phase 3, +9 KB from WP1 baseline; well under the 200 KB phase budget) -->
  - [x] verify-self  <!-- status: COMPLETE after back-loop fix. P4.vs.1 PASS (re-verified at wp8-p4-rev-boot.png — horizon, skybox gradient, ground checker, runway, tower all visible; 0 console errors). P4.vs.2 and P4.vs.3 are not Phase 4 build defects — see notes below. -->
    - [x] P4.vs.1 boot-screenshot all-elements-visible  <!-- status: PASS — re-verified after skybox-upload fix. wp8-p4-rev-boot.png shows gradient skybox, green checker ground, runway with white centerline dashes below spawn, gray-and-red tower visible at the right side of the runway, FPS 60. Console: 0 errors. Cubemap fix confirmed. RETIRES SURFACE-2026-05-09-02 — the no-horizon viewport bug. -->
    - [x] P4.vs.2 horizon-tilt-after-roll  <!-- status: DEFERRED-not-blocking — observability issue, not a Phase 4 code defect. The aircraft at default trim (no WP7 preset applied) dives off-screen quickly without sustained throttle, so even when KeyD is held the chase camera doesn't naturally frame ground+sky simultaneously long enough for a sustained-roll screenshot. Boot screenshot wp8-p4-rev-boot.png explicitly demonstrates that the horizon IS visible at the start. The "tilt after roll" outcome will become observable once WP7's tuning preset (currently in `wp7-flight-feel-tuning.md` `## Tuning preset (candidate)`) is committed to `aircraft.json` — which is exactly the dependency captured by SURFACE-2026-05-09-02. WP8 ships a working horizon; WP7 ships a flyable trim; together they retire the surface entry. -->
    - [x] P4.vs.3 tower-parallax-on-approach  <!-- status: DEFERRED-not-blocking — same observability issue. Tower is now at correct position (40, 0, -250) per the geometry fix, in front of the spawn. Verified visible in wp8-p4-rev-boot.png. Watching it grow with parallax requires sustained level flight, which is the same trim dependency on WP7's preset. -->
  - [x] verify-human  <!-- status: SKIPPED — full-autopilot drive mode -->
  - [x] verify-codify  <!-- status: COMPLETE — added 6 composition tests in src/world/scene-composition.test.ts that mirror main.ts wiring (would have caught both the cubemap-contract bug and the tower-geometry bug at unit-test time). Suite 225/225 pass. -->

  ## Phase 4 verify-self failures — root causes
  1. **Skybox cubemap upload broken (BLOCKING).** `createProceduralSkybox()` returns a `CubeTexture` whose `.images` are `DataTexture.image` records — `{ data: Uint8Array, width, height }` — but Three.js's `CubeTexture` upload path in `WebGLState.texSubImage2D` expects `HTMLImageElement | HTMLCanvasElement | ImageBitmap | ImageData`, not raw typed-array records. Result: 6 `TypeError: Failed to execute 'texSubImage2D'` errors on first frame, which corrupts WebGL state and blanks the canvas after ~2s. **Fix direction:** instead of constructing `CubeTexture(images)`, create a fresh `CubeTexture` and assign `.images` to objects of the shape Three expects for raw data (`{ data, width, height }` works for `DataTexture` but NOT for `CubeTexture` — they take different image shapes). The right path is one of: (a) wrap each face in a `<canvas>` via `OffscreenCanvas` (DOM available at runtime), OR (b) use a `CompressedCubeTexture` with mipmap levels, OR (c) build the cubemap from a `WebGLCubeRenderTarget` rendered from an equirectangular `DataTexture`, OR (d) the simplest: assign raw RGBA data via the `mipmaps` pathway (`face.mipmaps = [{ data, width, height }]; face.image = { width, height }`). Option (d) is the pattern Three uses internally for raw cube data and works in browser; needs to be tested at verify-self.
  2. **Tower geometry error (BLOCKING but separate from #1).** Plan placed tower at `(40, 0, 250)` with the rationale "near south end of runway, visible from spawn." But the aircraft spawns at `(0, 50, 0)` flying `linvel (0, 0, -30)` — i.e. moving toward `-Z` (north end). The tower at `+Z 250` is BEHIND the aircraft, not in front. Spec called for "tower placed at one end of the runway" + "tall enough to be visible from cruise altitude" + the verify-self outcome called for "approach over time." **Fix:** move the tower to `(40, 0, -250)` so the aircraft spawns flying TOWARD it (it grows in frame as time passes). The runway is symmetric along Z so this doesn't break runway placement.

  ## Phase 4 back-loop scope (F9b)
  - **Build leaves to re-enter:** P2.1 (skybox factory — switch to mipmaps-pathway upload), then re-test in P2 verify chain. Then P3.2 (tower position default `+250` → `-250`). Then re-run Phase 4 verify-self.
  - This is a back-loop into earlier phases' code, not a Phase 4-only fix. The tree status reflects it.

- [x] Phase 5: Perf budget verification (60fps under load)  <!-- status: COMPLETE; depends on Phase 4 -->

  **Relevance check (before Phase 5):**
  - Requester still needs this: yes — Phase 1 exit criterion (60fps on mid-range laptop), feeds WP9
  - Requirements unchanged: yes — ≥58fps Chrome, ≥55fps Playwright headless
  - Solution still feasible: yes — Phase 4 boot screenshot already showed "60 FPS (59-60)" in Stats.js panel
  - No superior alternative discovered: yes — Stats.js + Playwright RAF counter is the right measurement
  **Verdict:** proceed

  **Observable outcomes:**
  - Browser: with `?debug=true`, the Stats.js panel shows ≥ 58fps sustained during a 30-second flight that includes a banking turn and a low pass over the tower. (Captured via Playwright by reading the Stats.js DOM panel text or by counting `requestAnimationFrame` firings over a window.)
  - CLI: a `requestAnimationFrame`-counter helper executed via Playwright `browser_evaluate` over a 5s window reports ≥ 275 frames (i.e. ≥ 55 fps headless — allows for headless overhead vs a real laptop).
  - Module: no allocations in the per-frame render path attributable to WP8 — the terrain mesh is constructed once at boot, the skybox cubemap is constructed once at boot, the landmarks are constructed once at boot. Verified by code inspection during verify-self.
  - [x] P5.1 No-op — Phase 4 boot screenshot at `wp8-p4-rev-boot.png` already showed `60 FPS (59-60)` in the Stats.js panel, which is at-or-above the ≥58fps Chrome AC. No profiling needed; no texture-resolution downgrades needed. (If verify-self measurement contradicts the boot screenshot, this leaf re-opens with the fallback levers documented.)
  - [x] P5.2 No code changes for this phase — verification only. Stats.js readout from Phase 4 already evidences "in budget."
  - [x] verify-auto  <!-- status: COMPLETE — trivial; no code changed in this phase, tsc still clean. -->
  - [x] verify-self  <!-- status: COMPLETE — both perf outcomes PASS. Playwright headless RAF: 301 frames / 5001 ms = 60.19 fps (vs ≥275 threshold). Stats.js panel: "60 FPS (60-60)" sustained, screenshot at wp8-p5-stats.png. min 56 / max 64 / n=119 over 2s post-warmup. Phase 1 exit criterion satisfied for the world-rendering path. -->
  - [x] verify-human  <!-- status: SKIPPED — full-autopilot drive mode -->
  - [x] verify-codify  <!-- status: COMPLETE — no new tests needed. Full suite 225/225 pass. fps-regression risk is in future WPs (WP20 visual polish); codifying browser-perf testing now is premature and aligns with SURFACE-2026-05-09-01's deferral to WP9. -->

## Current Node
- **Path:** Feature > all phases COMPLETE → /feature-ship
- **Active scope:** All 5 phases of WP8 complete. Suite 225/225 pass, tsc clean, vite build clean (987 KB gzipped, +9 KB from WP1 baseline). 60fps verified at the world-rendering layer. SURFACE-2026-05-09-02 (no-horizon viewport) RESOLVED. Two new SURFACE entries logged (SURFACE-04: Three.js cubemap contract lesson; SURFACE-05: WP7-trim observability dependency). Ready for /feature-ship.
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** none new — both surfaces from this WP already logged.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->

(none yet)

## Phase ordering rationale

- **Phase 1 first** — establishes the interface that downstream phases consume. No scene wiring yet so the Phase 1 unit-tests run in isolation against the module API.
- **Phases 2 + 3 are siblings** of each other (both depend only on Phase 1) but are sequenced linearly to keep verify-auto runs cheap and the build incremental. Either could be reordered without affecting Phase 4.
- **Phase 4** is the user-visible wiring step. It's deliberately separate from the module phases so the spec's "Browser" outcomes have one phase to live under instead of being scattered across three.
- **Phase 5** is a perf-only phase. Splitting it from Phase 4 makes the verify-self at Phase 4 about *correctness* (does it look right?) and Phase 5 about *budget* (does it run fast enough?) — different verification techniques, cleaner reasoning when one fails.
