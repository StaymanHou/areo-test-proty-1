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
  mission/             # (Phase 2)
  hud/                 # (Phase 2)
public/
  models/              # GLTF aircraft, textures
  config/
    aircraft.json      # tunable flight model constants
CLAUDE.md              # this file
CONVENTIONS.md         # (Phase 1 WP1) — coord conventions, module rules
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
- **Phase discipline.** Phase 1 work does not implement Phase 2 systems (mission framework, HUD, AI). `mission/` and `hud/` are empty dirs in Phase 1 by design.
- **Write code for a casual-gamer audience.** "Feels right" beats "is accurate." When tuning a constant, the test is whether a non-pilot player says "yeah, that's how a plane should behave."

### Testing
- Unit tests for pure physics math (aerosurface lift/drag at known α, stall behavior). Test framework: Vitest (default with Vite, TBD at WP1).
- No integration tests for the render loop — validation is playtesting.

## Current Phase

**Phase 1 — Flight PoC** (see `docs/product/roadmap.md`).

**Goal:** Prove the core loop — a plane flies in a browser with plausible physics and responsive controls. No missions, no UI chrome.

**Exit criteria:** A developer can open the dev URL, take off, fly around, and crash — and it feels right. 60fps on a mid-range laptop in Chrome / Safari / Firefox.

**Status (2026-05-11, post-WP9.5):** WP1–WP8 all shipped. **WP9.5 DONE — collider fix shipped.** SURFACE-2026-05-11-05 RESOLVED: aircraft now impacts the terrain plane (verified via targeted teleport-to-ground probe — impacts at y=0.28m with velocity reversal, settles to bounded bounce; behavioral integration test added in `rigidbody.test.ts`). 246/246 tests green. WP9 is **UNBLOCKED** but its three BLOCKED leaves need a re-verification pass at next session — Phase 2 (FPS Chromium PASS) and Phase 4 (Playwright/test DEFER) outcomes carry forward unaffected. Remaining open SURFACE items: **SURFACE-2026-05-11-04** (phugoid is divergent under non-zero forcing — Phase 2 candidate, NOT gating Phase 1); SURFACE-2026-05-09-01 (`@playwright/test` adoption — recommended next, would compound nicely with WP9 re-verification); SURFACE-2026-05-11-02 (descending-glide vs level cruise — Phase 2 feel-tuning); SURFACE-2026-04-19-01 (bundle size — Phase 3). Prior WP7 disposition: empirically refuted single-knob improvements over WP6.5 baseline; shipped descending-glide attractor + operator-as-tester feel-check.

## Key Decisions

See `docs/product/arch.md` for the full list and rationale. Highlights:

- **D1: Fixed-timestep physics.** Accumulator pattern. Non-negotiable for stable aerodynamics.
- **D2: Aerosurface primitive** — per-surface lift/drag (Khan & Nahon 2015), not a monolithic flight model. Produces correct-feeling dynamics (banking-to-turn, stall, adverse yaw) without hand-coded rules.
- **D3: Flight-model constants in JSON.** Enables rapid tuning — the single biggest feel risk (R2 in research).
- **D4: Flat terrain in Phase 1.** Flat plane + skybox + 2–3 landmarks. Heightmap is a Phase 3 polish swap via the `terrain.ts` interface.
- **D6: No ECS in Phase 1.** Single aircraft, simple world. Reconsider at Phase 2 if entities multiply.
- **D9: Static deploy, backend-less.** Aligns with "no-install" vision principle.

## Key Risks

See `docs/product/research.md` for full list. The two that drive the critical path:

- **R2 — Flight-feel tuning is iterative.** Addressed by D3 (JSON config + lil-gui). Budget real time on WP7.
- **R6 — Combat mission scope creep.** Keep WP16 minimal: one AI, one weapon, simplified hit detection. Revisit if Phase 2 slips.
