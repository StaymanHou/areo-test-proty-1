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

### Physics-mechanism discipline

Lessons codified from SURFACE-2026-05-10-01 (β-AoA sign convention bug) and SURFACE-2026-05-12-03 (β5 `clAlphaDot` mechanism diverges at every tuning value). Both shipped because pure-math tests passed for physically wrong behavior. Both rules below are MUST-follow for any new physics mechanism added under `src/aircraft/` (future β-coefficients, new aero terms, alternate force/moment routes).

1. **No sign-convention unit tests before live-system observation.** New physics mechanisms — any field added to `AeroSurfaceConfig` / `AircraftSurfaceConfig` that affects force/moment computation — require a Playwright probe at a non-zero coefficient before any sign-convention unit test (`"positive X produces +Y in regime Z"`) is written. Internal math consistency ≠ physical correctness; pure-math tests will pass for the destabilizing direction. The probe must observe the mechanism in at least two operating regimes (e.g. low- and high-throttle, or rising- and falling-α) for a ≥10s window. Only after live observation confirms the sign, write the unit test that codifies it. **Origin:** `aerosurface.test.ts:1135` codified the destabilizing direction of β5 as correct (the "rising α → +lift" assertion); WP14.5 disposed of that mechanism as untunable after 3 attempts.

2. **Schema-landing close requires a non-default verify-self, not just default-parity.** A WP that adds a new physics-mechanism schema field cannot close on the strength of `default value preserves prior behavior` parity tests alone. That's back-compat validation, not arch-decision validation. The close gate is a verify-self at a non-default value against the SURFACE the schema was introduced to address — i.e., the mechanism must demonstrably do its claimed job before the schema-land WP is declared done. Without this gate, a defective mechanism ships invisibly under `default=0` and surfaces only at the downstream tuning WP. **Origin:** WP10.5 closed β5 schema-landing on 256/256 Vitest parity; the mechanism was never observed at non-zero values until WP14.5, where it diverged in every regime tested. **Interpretation clarification (added 2026-05-17 post-WP14.9b):** "non-default coefficient" means "any non-default value that activates the mechanism observably and stays finite." It does NOT mean "the textbook-range value" or "the spec-quoted high-stress value" specifically. If the empirical stable region under the current `aircraft.json` parameters is narrower than the textbook reference suggested, Rule #2 is satisfied by ANY non-default value within the empirical stable region that (a) stays finite over the SURFACE-claimed regime, AND (b) is observably different from the control (clQ=0 or analog) trajectory. **Why:** Conflating "textbook-range non-default fails to stay finite" with "implementation is defective" routes the WP into a wrong escalation lane — the failure may be a tuning-bounds question (handled by the tuning WP, e.g. WP14.11) rather than a mechanism-implementation question (which would require arch revision). **Clarification origin:** WP14.9b verify-self — clQ=12 NaN'd at tick 687 but clQ=1 stayed finite 1800 ticks and observably differed from clQ=0; the empirical stable region `[0..~1.5]` was narrower than arch.md D17's "textbook 1–10" claim (SURFACE-2026-05-17-03). Reading Rule #2 as "clQ=12 must work" would have failed WP14.9b incorrectly; reading it as "clQ=1 satisfies, and the narrow stable region is a tuning concern" closed correctly.

3. **Physics-mechanism tuning runs through the harness, not hand-guessing.** Any WP that adjusts `aircraft.json` physics constants (mass, thrust, areas, β-coefficients, inertia) MUST run the harness optimizer (`npm run tune`) over an explicit parameter space and commit the optimizer's output artifact alongside the JSON change. Hand-guessing physics values is reserved for (a) initial schema-land WPs where defaults must be 0 anyway, and (b) the operator-as-architect explicitly choosing a value for non-physical reasons (e.g., gameplay feel override). **Origin:** WP14.5 exhausted the 3-attempt budget on 3 sparse points in a continuous parameter space; the mechanism may or may not have been tunable — the search density was too low to know.

4. **Physics-mechanism verify-self requires a control regime alongside baseline + non-default.** The Rule #2 non-default verify-self proves "the mechanism does its claimed job at a non-default coefficient." It does NOT prove "the mechanism is the *driver* of any observed behavior" — for that, a control regime (mechanism disabled entirely, e.g. `clQ=0`, `clAlphaDot=0`) must run alongside in the same fixture. The control disambiguates "is this defect caused by my mechanism, or by something else interacting with it?" Without it, a verify-self failure can be misread as a different mechanism's bug, sending the WP into the wrong escalation lane. **Verify-self contract for physics-mechanism WPs:** one harness run at baseline (current aircraft.json), one at non-default per Rule #2, and one with the new mechanism's coefficient(s) set to 0. Compare; the control should be visibly different from both other runs (proves your mechanism is doing *something*); the baseline and non-default should differ from each other in the SURFACE-claimed direction (proves your mechanism is doing the *intended* thing). **Origin:** WP14.9 verify-self (2026-05-17) — the clQ=0 control was added ad-hoc during diagnostic interpretation when both baseline and clQ=12 NaN'd; it ruled out "second instability source" hypotheses cleanly and isolated β4 as the sole driver. Without it, the misframing of attempt-1's wrong-layer implementation could have been mistaken for a different mechanism's bug, routing into Option 2 (Form B re-evaluation) instead of Option 3 (full V-scaling reframe).

5. **Plan-time physics derivation precedes spec-text reading for new physics mechanisms.** Before reading the binding spec text in arch.md or wbs.md for any new physics-mechanism WP, do a 30-second derivation pass: (a) right-hand-rule any cross products in the formula, (b) dimensional-analyze the result (does ΔF scale as V? V²? V³? — compare to the destabilizing-moment scaling), (c) trace one numerical example through with concrete unit-quantity values. THEN read the spec text and compare. The aim is to catch arch-spec errata (sign-inverted cross products, misnamed factors, transcription bugs) at plan time instead of at first-failing-test time. **Origin:** The pattern fired 3× in 24 hours during the D14/D17 cascade: WP14.9 attempt-1 (D15 implementation-layer ambiguity — caught at verify-self, costing the WP); D17 arch.md authoring (cubic-V³ damping growth via dimensional analysis — caught at WP14.9 escalation, drove the reframe); WP14.9b (arch.md D17 `(position × normal)` cross-product order sign-inverted vs textbook damping convention — caught at first Vitest run, SURFACE-2026-05-17-02). Operator-as-architect makes the operator both spec author and implementer; this rule keeps the architect side honest by forcing derivation before implementation reads the architect's own spec text.

### Testing
- Unit tests for pure physics math (aerosurface lift/drag at known α, stall behavior). Test framework: Vitest (default with Vite, TBD at WP1). Run via `npm run test`.
- End-to-end browser tests: `@playwright/test` (adopted WP9.6). Run via `npm run test:e2e`. Lives under `tests/e2e/`. Currently a single load-bearing smoke (`casual-flight.spec.ts`) — the WP9.5 collider-fix regression anchor; loads `?debug=true`, waits 5s, asserts via `window.__aircraft.getState()` that altitude/airspeed are finite, aircraft moved from spawn, no NaN/Infinity in console. Chromium-only at this phase (cross-browser is WP21). Keep this suite tiny per the "Playwright tests are flaky" trap noted in SURFACE-2026-05-09-01.
- No integration tests for the render loop — validation is playtesting.
- **Three.js mutable-buffer trap when testing `computeAeroForce` and similar reused-output APIs.** `computeAeroForce` returns an `AeroForceResult` whose `.force` and `.applicationPoint` Vector3s are reused across invocations (allocation-free hot path; documented in the function's JSDoc + the `result.force vector is reused` regression test). When writing tests that compare force outputs across two or more calls, snapshot scalars (`const yA = computeAeroForce(...).force.y;`) into local consts IMMEDIATELY after each call. Do NOT hold the returned object handle and read `.force.y` later — both handles point at the same buffer, the second call has already overwritten the first, and your delta computation will silently return 0. Existing tests in `aerosurface.test.ts:858` and similar sites already follow this pattern with an explicit "Snapshot immediately after each call" comment; treat that comment as a binding convention for new tests. Recurring foot-gun — caught at WP14.9b P1.7 closed-form non-dim test (first version returned `dY30 = 0` due to buffer aliasing).

## Current Phase

**Phase 2 — Mission System MVP** (see `docs/product/roadmap.md`).

**Goal:** Add structured gameplay — the four mission types from the vision (free flight, waypoint, takeoff/landing, combat), each minimally playable, with mission-select + in-mission HUD.

**Exit criteria:** From the main screen a player can pick any of the four mission types, play it to completion (or failure), and return to mission select.

**Status (2026-05-17, post-WP14.9b):** Phase 1 closed (WP1–WP9.6, 246/246 Vitest + 1/1 Playwright). Phase 2 progress: WP10/10.5/11/12/13/14 shipped 2026-05-12; D14 cascade landed (WP14.6 ✓, WP14.7 ✓, WP14.8 ✓, WP14.5-retry ✓ as escalation-with-evidence). WP14.9 ESCALATED 2026-05-17 → SURFACE-2026-05-17-01 (attempt-1 D15 implementation refuted at verify-self). **D17 arch revision landed 2026-05-17** (`docs/product/arch.md` Revision 2026-05-17): supersedes D15 with textbook non-dimensional pitch-rate-damping form `cl += clQ · ω_along_dampAxis · c̄ / (2 · max(V, V_REF))`, structurally parallel to D16's β5 treatment — both fixes are now non-dimensionalization fixes. **CLAUDE.md Rule #4 added 2026-05-17** (physics-mechanism verify-self requires control regime). **WP14.9b shipped 2026-05-17 (commit `0df9a07`)** — D17 impl landed: `dampAxis` cached field on `AeroSurface` (sign-corrected `(normal × position)` vs arch.md literal text per SURFACE-2026-05-17-02 errata), WP6.6 amplification block removed, step-4b CL augmentation added before β5 branch. verify-self triple gate passed at clQ=1 (Rule #2) + clQ=0 (Rule #4) + Rule #1 live observation across throttle-low/high; baseline clQ=3,3,8,0 NaN at tick 482 (expected per WBS WP14.9b close gate — WP14.11 retunes). Tally: 520/520 Vitest + 3/3 parity Playwright + tsc strict (both configs) + build clean. **WBS cascade:** WP14.9 (ESCALATED) → **WP14.9b ✓** → **WP14.10 (D16 β5 impl, NEXT)** → WP14.11 (joint tune; SURFACE-2026-05-17-03 recommends tightening bounds from `[0..15]` to `[0..2]` per surface based on WP14.9b empirical stable region). Phase 2 mission content (WP15/WP16/WP17) remains paused at post-WP14 line. Open SURFACE items: **SURFACE-2026-05-16-04 (high — β5 side blocks WP14.10)**; **SURFACE-2026-05-17-03 (high — WP14.11 bounds revision)**; SURFACE-2026-05-17-01 + SURFACE-2026-05-16-01 (partial — D17 impl side closed by WP14.9b, awaiting WP14.11 for full close); SURFACE-2026-05-17-02 (medium — arch.md errata, non-blocking); SURFACE-2026-05-12-03 (partial — superseded by -16-04); SURFACE-2026-05-12-01 (medium — blocked-by -16-04); SURFACE-2026-05-11-04 (partial); SURFACE-2026-05-11-02 (medium); SURFACE-2026-05-16-03 (low — arch.md doc typo); SURFACE-2026-05-16-02 (low — perf flake); SURFACE-2026-05-12-02 (low — test-mission pollution); SURFACE-2026-04-19-01 (Phase 3 — bundle).

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
