# Web Flight Sim

## Project Overview

Browser-based flight simulator for casual gamers. A player opens a URL and is flying within 30 seconds — no install, no tutorial, no account. Physics are plausible (6DOF rigid body with lift/drag/thrust/stall on per-surface aero model) but tuned for accessibility rather than study-level accuracy. v1 ships four mission types: free flight, waypoint navigation, takeoff/landing, and combat.

**Not goals for v1:** multiplayer, accounts, persistence, mobile, monetization, mission editor, multiple aircraft.

See `docs/product/vision.md` for the full vision.

## Tech Stack

- **TypeScript** (strict) — catches math bugs in physics code
- **Three.js** (r170+) — rendering. Chosen over Babylon.js for ecosystem depth, AI-assist friendliness, and smaller bundle.
- **Rapier3D** (`@dimforge/rapier3d-compat`, optionally `rapier3d-simd` for perf) — physics. 2–5× faster than alternatives in 2026; cannon-es and Ammo.js are unmaintained.
- **Vite** — build + dev server with HMR
- **lil-gui** — in-dev tuning UI behind `?debug=true`
- **stats.js** — FPS counter, on from day one
- **No backend. No database.** Static deploy to Vercel / Netlify / Cloudflare Pages.

## Project Structure

```
docs/product/          # vision, roadmap, research, arch, wbs, context — durable reference
workflow/              # transient workflow state (wip/, backlog.md, archive/)
src/
  main.ts              # entry
  engine/              # game loop, input, assets, debug UI
  world/               # scene, terrain, camera
  aircraft/            # rigidbody, aerosurface, flightmodel, controls
  mission/             # Phase 2 (WP11): loader.ts, runner.ts, parse.ts, select.ts, hooks/
  hud/                 # Phase 2 (WP12): HUD interface + dom-hud.ts implementation
public/
  models/              # GLTF aircraft, textures
  missions/            # Phase 2 (WP11): declarative-JSON mission definitions
  config/
    aircraft.json      # tunable flight model constants
tests/e2e/             # Playwright smoke (WP9.6) + Phase 2 mission-level probes
CLAUDE.md              # this file
CONVENTIONS.md         # coord conventions, module rules, β1/β4/β5 sign conventions
```

## Getting Started

### Prerequisites
- Node.js 18+
- Modern browser (Chrome / Safari / Firefox latest)

### Setup
```
npm install
npm run dev
```

Open the printed URL. Append `?debug=true` for the lil-gui tuning panel and Stats.js FPS counter.

### Build & Deploy
```
npm run build    # outputs static files to dist/
```
Deploy `dist/` to any static host.

No Docker. No backend.

## Development Conventions

- **TypeScript strict mode** — `strict: true` in `tsconfig.json`. No `any` without a comment explaining why.
- **Fixed-timestep physics, variable-timestep render.** Non-negotiable. See arch D1. Rapier produces wrong results at variable dt.
- **Right-handed Y-up coordinates** for both Three.js and Rapier — they align, no transform at the sync boundary. Document any exception.
- **Aerosurface as first-class primitive.** Every lift-producing part is an `AeroSurface`. Don't add ad-hoc lift/drag formulas elsewhere — extend the aerosurface model.
- **Flight-model constants live in `public/config/aircraft.json`**, not in code. Tune via lil-gui, export back to JSON.
- **Debug UI gated on `?debug=true`.** Never ship debug panels to end users.
- **No framework (React/R3F).** Vanilla Three.js. Revisit if mission-select / HUD grows beyond basic DOM overlays.
- **Phase discipline.** Phase 1 closed 2026-05-12 (post-WP10 arch revision). Phase 2 populates `mission/` and `hud/` per D11/D12. Phase 2 work does not pre-implement Phase 3 polish (audio, visual replacement, onboarding) — those are WP18+ deliverables. AI architecture (behavior tree vs FSM) is a WP16-internal decision, not an arch decision.
- **Write code for a casual-gamer audience.** "Feels right" beats "is accurate." When tuning a constant, the test is whether a non-pilot player says "yeah, that's how a plane should behave."

### Testing
- Unit tests for pure physics math (aerosurface lift/drag at known α, stall behavior). Test framework: Vitest (default with Vite, TBD at WP1). Run via `npm run test`.
- End-to-end browser tests: `@playwright/test` (adopted WP9.6). Run via `npm run test:e2e`. Lives under `tests/e2e/`. Currently a single load-bearing smoke (`casual-flight.spec.ts`) — the WP9.5 collider-fix regression anchor; loads `?debug=true`, waits 5s, asserts via `window.__aircraft.getState()` that altitude/airspeed are finite, aircraft moved from spawn, no NaN/Infinity in console. Chromium-only at this phase (cross-browser is WP21). Keep this suite tiny per the "Playwright tests are flaky" trap noted in SURFACE-2026-05-09-01.
- No integration tests for the render loop — validation is playtesting.

## Current Phase

**Phase 2 — Mission System MVP** (see `docs/product/roadmap.md`).

**Goal:** Add structured gameplay — the four mission types from the vision (free flight, waypoint, takeoff/landing, combat), each minimally playable, with mission-select + in-mission HUD.

**Exit criteria:** From the main screen a player can pick any of the four mission types, play it to completion (or failure), and return to mission select.

**Status (2026-05-12, post-WP10):** Phase 1 closed at the Chromium-only / operator-as-tester bar (WP1–WP9 + WP9.5 + WP9.6 all shipped, 246/246 Vitest + 1/1 Playwright green). **WP10 closed 2026-05-12 — Phase 2 arch revision shipped three decisions (D11/D12/D13).** Next WP is **WP10.5** (β5 `clAlphaDot` schema extension, XS — closes the SURFACE-2026-05-11-04 phugoid mode architecturally before mission feature WPs begin), then **WP11** (mission framework — declarative JSON + script hook per D11) and **WP12** (HUD — DOM overlay per D12) in parallel. Remaining open SURFACE items: **SURFACE-2026-05-11-04** (phugoid — addressed by D13 schema landing in WP10.5, tuning deferred to whichever mission first surfaces the need); SURFACE-2026-05-11-02 (descending-glide vs level cruise — depends on phugoid fix); SURFACE-2026-04-19-01 (bundle size — Phase 3).

## Key Decisions

See `docs/product/arch.md` for the full list and rationale. Highlights:

- **D1: Fixed-timestep physics.** Accumulator pattern. Non-negotiable for stable aerodynamics.
- **D2: Aerosurface primitive** — per-surface lift/drag (Khan & Nahon 2015), not a monolithic flight model. Produces correct-feeling dynamics (banking-to-turn, stall, adverse yaw) without hand-coded rules.
- **D3: Flight-model constants in JSON.** Enables rapid tuning — the single biggest feel risk (R2 in research).
- **D4: Flat terrain in Phase 1.** Flat plane + skybox + 2–3 landmarks. Heightmap is a Phase 3 polish swap via the `terrain.ts` interface.
- **D6: No ECS in Phase 1.** Single aircraft, simple world. Reconsider at Phase 2 if entities multiply.
- **D9: Static deploy, backend-less.** Aligns with "no-install" vision principle.
- **D10/D11/D12/D13 (Phase 1→2 boundary):**
  - **D10:** Per-surface `incidenceRad` (β1) is the trim mechanism (shipped WP6.5).
  - **D11:** Missions are declarative JSON files in `public/missions/`; combat (WP16) registers an optional `scriptHook` for AI enemy behavior. Other three mission types are declarative-pure.
  - **D12:** HUD is a DOM overlay (`src/hud/dom-hud.ts`) implementing a `HUD` interface; waypoint arrows project world coords via `THREE.Vector3.project()`. Three.js ortho is the Phase 3 swap point.
  - **D13:** Per-surface `clAlphaDot` (β5) is the phugoid-damping mechanism (lands in WP10.5; default 0; tuning per Phase 2 mission as needed).

## Key Risks

See `docs/product/research.md` for full list. The two that drive the critical path:

- **R2 — Flight-feel tuning is iterative.** Addressed by D3 (JSON config + lil-gui). Budget real time on WP7.
- **R6 — Combat mission scope creep.** Keep WP16 minimal: one AI, one weapon, simplified hit detection. Revisit if Phase 2 slips.
