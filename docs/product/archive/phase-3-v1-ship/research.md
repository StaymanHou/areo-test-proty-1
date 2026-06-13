---
stage: research
state: complete
updated: 2026-04-19
---

# Research

**Phase Focus:** Phase 1 — Flight PoC. Goal is proving the core loop (a plane flying plausibly in a browser at 60fps). Research covers the whole v1 stack since the same tools carry through Phase 2–3; deferred items (multiplayer, accounts, mobile) are excluded.

## Recommended Stack

- **Rendering: Three.js** — chosen over Babylon.js. Babylon is more "batteries-included" for games (integrated physics, GUI, Inspector, WebXR), but for a solo-dev casual sim the decisive factors are ecosystem depth (~300× weekly downloads vs Babylon/PlayCanvas), AI-assist friendliness (clear APIs, `llms.txt` support — matters heavily when developing with Claude Code), and lighter bundle size (~168KB vs ~1.4MB), which aligns with the no-install vision principle. We pick physics separately (see below), so Babylon's main advantage is neutralized.
- **Physics: Rapier (rapier3d via @dimforge/rapier3d-compat or rapier3d-simd)** — the clear 2026 default. Actively maintained by Dimforge, 2–5× faster than its 2024 version thanks to new SIMD WASM packages. cannon-es is the alternative for "simple scenes" but its last commit was years ago — unmaintained. Ammo.js is a legacy Bullet port, also unmaintained. For a game we expect to evolve for months, Rapier's maintenance trajectory matters more than cannon-es's simplicity.
- **Language: TypeScript** — standard for Three.js projects in 2026. Aircraft physics has non-trivial vector/matrix math; types catch a class of bugs that would be tedious to debug at runtime.
- **Build tool: Vite** — standard for browser 3D projects. Fast HMR, good TS support, targets modern browsers (Baseline Widely Available) which aligns with our "modern browsers only" scope.
- **Flight model approach: per-aero-surface lift/drag (Khan & Nahon 2015)** — decompose the aircraft into wing/tail/rudder surfaces, each computing its own lift/drag force from local airflow and angle of attack, summed into body-frame force + torque applied to the Rapier rigid body. Piecewise-linear CL/CD vs α curves (Gazebo LiftDragPlugin style) — simpler than full airfoil tables, accurate enough for "plausible not study-level." The popular `gasgiant/Aircraft-Physics` Unity project uses this exact approach; math translates cleanly to JS.
- **Dev UI: lil-gui** behind a `?debug=true` URL flag — standard pattern for tuning physics constants (lift coefficient, drag, thrust) during development without shipping a debug UI to end users.
- **Deployment: static hosting** (Vercel / Netlify / Cloudflare Pages) — no backend needed for v1. Build output is static files.

### Deferred / not-chosen-but-evaluated

- **React Three Fiber:** Viable if we want a React component model, but the app is primarily a render loop with minimal DOM UI. Vanilla Three.js is more direct and avoids reconciler overhead in the hot path. Reconsider if mission select / HUD grows complex.
- **Babylon.js:** See above. Would pick this if: VR cockpit support became v1 scope, the team was >1 dev, or we wanted an Inspector out of the box.
- **Jolt Physics:** Emerging contender, worth tracking but Rapier's web ecosystem (rapier.js bindings, community wrappers) is more mature.
- **JSBSim-style FDM:** Study-level fidelity, explicitly out of scope per vision.

## Trade-offs

- **Three.js vs Babylon.js:** Three.js wins on ecosystem + AI-assist + bundle size; loses on out-of-box features (HUD/GUI, physics integration, Inspector). We accept the cost of wiring physics ourselves because we'd do it anyway for custom flight dynamics — neither engine's built-in physics handles aerodynamic lift surfaces correctly.
- **Rapier vs cannon-es:** Rapier wins on performance and maintenance; cannon-es wins on zero-dependency simplicity (pure JS, no WASM). WASM adds a tiny load step but Rapier's bindings (`rapier3d-compat`) hide this. Net: Rapier.
- **Per-surface flight model vs single-body approximation:** Per-surface is more code but produces intuitive behavior (banking into a turn, adverse yaw, stall feel) without hand-authored rules. Single-body approximation would save time but routinely feels "wrong" to even casual players — the audience we're targeting notices when a plane banks but doesn't turn.
- **Vanilla Three.js vs React Three Fiber:** Vanilla is lighter and closer to the metal; R3F makes UI-heavy scenes easier. We have minimal UI (mission select + HUD) so vanilla wins.

## Risks

- **R1 — WASM load UX.** Rapier ships as WASM; first-time page load includes fetching ~300KB of physics WASM. Mitigation: preload the WASM in parallel with the mission-select screen so it's ready by the time the player clicks "Fly." Verify on slow connections during Phase 3 cross-browser QA.
- **R2 — Flight-feel tuning is iterative.** Per-surface lift/drag physics is correct in principle, but "feels right to a casual player" depends on dozens of constants (CL slope, stall angle, control authority, damping). Budget time in Phase 1 for tuning — this is the single largest feel risk. Mitigation: lil-gui debug panel for live-tuning; save working presets in a JSON config.
- **R3 — Terrain generation not yet scoped.** Roadmap mentions "minimal 3D world (terrain + sky)" in Phase 1 but doesn't specify approach (heightmap? procedural? flat plane + skybox?). Lowest-risk v1 choice: flat textured plane + skybox + a few placed landmarks. Defer real terrain to Phase 3 polish. Flag this for arch.
- **R4 — Audio latency in browsers.** Web Audio API has known latency quirks on Safari in particular. Not a Phase 1 risk but flag for Phase 3.
- **R5 — 60fps on mid-range laptops.** Achievable with Three.js + Rapier for a single aircraft and simple terrain, but we haven't measured. Mitigation: add an FPS counter early (Stats.js), profile continuously, budget a perf pass per phase.
- **R6 — Combat mission scope creep.** AI enemies, weapons, damage model, hit detection are all in Phase 2. This is the biggest/most complex mission type. Mitigation: keep combat minimal for MVP (one stationary or very simple AI, one weapon, simplified hit detection). Revisit scope if Phase 2 slips.

## Roadmap Impact

No roadmap invalidation. The three phases (Flight PoC → Mission MVP → v1 Ship) still make sense with this stack. Research surfaces one scope note for arch: **terrain strategy needs an explicit decision** (flag R3). Recommend `/product-arch` next (transition P5).

## References

- [Three.js vs Babylon.js vs PlayCanvas | Comparison Guide 2026 (Utsubo)](https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison)
- [Babylon.js vs Three.js: Choosing the Right 3D Framework (DEV)](https://dev.to/devin-rosario/babylonjs-vs-threejs-choosing-the-right-3d-framework-for-long-term-team-scalability-col)
- [Rapier 2025 review and 2026 goals — Dimforge](https://dimforge.com/blog/2026/01/09/the-year-2025-in-dimforge/)
- [Rapier vs Cannon performance — three.js forum](https://discourse.threejs.org/t/rapier-vs-cannon-performance/53475)
- [Web Game Dev — Physics overview](https://www.webgamedev.com/physics)
- [Three.js Physics manual](https://threejs.org/manual/en/physics.html)
- [NASA Beginner's Guide to Aeronautics (lift/drag equations)](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/bga-simulations/)
- [Gazebo LiftDragPlugin tutorial — piecewise-linear aero model](https://classic.gazebosim.org/tutorials?tut=aerodynamics)
- [gasgiant/Aircraft-Physics — per-surface flight model (Khan & Nahon 2015)](https://github.com/gasgiant/Aircraft-Physics)
- [JSBSim Open Source Flight Dynamics Model (reference only, out of scope)](https://jsbsim.sourceforge.net/)
- [pachoclo/vite-threejs-ts-template](https://github.com/pachoclo/vite-threejs-ts-template)
- [Vite Getting Started](https://vite.dev/guide/)
