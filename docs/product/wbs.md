---
stage: wbs
state: in-progress
updated: 2026-06-13 — **WP22 DONE (ship commit `f8d804b`).** Phase 3 milestone "Deploy to a public URL, shareable link" CHECKED. Live at https://staymanhou.github.io/areo-test-proty-1/. GitHub Pages picked after mid-feature host pivot (Cloudflare locked out via 2FA loss). Single-phase XS config-only feature: `.nvmrc` Node 22 pin + `vite.config.ts` base path + `public/.nojekyll` + `.github/workflows/deploy.yml` (actions/deploy-pages@v4). Mid-build discovery: 3 runtime fetch sites hardcoded leading-`/` URLs that broke under sub-path deploy; resolved inline via `import.meta.env.BASE_URL` prepend (SURFACE-2026-06-13-01). Operator playtest PASS. Code-quality review: 0 CRITICAL, 3 MAJOR + 4 MINOR auto-backlogged per Mode 3 (SURFACE-2026-06-13-QUALITY-* — vite base hardcoded, no CI test gate, unnecessary 404 fallback step, + 4 lows). 3 new WPs added to WBS at operator request: WP24 aircraft selection UI, WP25 read-only control manual, WP26 audio mix pass (quieter engine + volume control — surfaced at WP22 verify-human). Final gates: Vitest 793/793 + tsc + production build clean pre-ship. Earlier 2026-06-07 entry: **WP21 cross-browser QA dropped** (operator directive). Chromium-only is the v1 acceptance bar — extends WP9.6 / Phase 1 precedent. Cross-browser deferred to v1.x. Phase 3 critical path becomes `WP20(DONE) → WP22 deploy → WP23 playtest → v1 ship`. Earlier 2026-06-07 entry: **WP20 DONE (ship commit `28bc898`).** Phase 3 visual polish milestone CHECKED. Four-phase impl: (1) skybox cloud-blob stamping with deterministic seeded RNG + horizon haze band + DirectionalLight/AmbientLight + PCF soft shadows; (2) procedural Cessna + MiG-15 meshes via new `src/aircraft/aircraft-mesh.ts`; (3) CPU particle system (`src/world/particles.ts`, 256-pool, kind-tagged emit) for muzzle-flash/impact/ground-dust; (4) SURFACE-2026-06-07-02 close (key-hints re-anchored) + SURFACE-2026-06-07-01 close (target visual decoupled from collider). One e2e regression triaged + auto-fixed (Three.js PCFSoftShadowMap deprecation). Final gates: Vitest 793/793 + Playwright e2e 47/47 + tsc both clean + build clean. **Phase 3 critical path:** `... → WP18(DONE) → WP19(DONE) → WP20(DONE) → WP21 → WP22 → WP23 → ship`. WP21 cross-browser QA is the next item — depends on all three Phase-3 polish WPs (WP18+WP19+WP20) which are now all `[x]`. Earlier 2026-06-07 entry: **WP19 DONE (ship commit `7467f10`).** Phase 3 audio milestone CHECKED. Two-phase impl: (1) AudioEngine + engine-loop (sawtooth, throttle→90-340 Hz, 50ms ramp) + wind (filtered procedural pink-noise, airspeed→cutoff+gain, silent below AS=10); (2) one-shot SFX synthesizers (fire/impact/crash) + Safari autoplay resume on first user gesture + 16-slot ring buffer for verify-self introspection. New `MissionRunner.getFailReason()` accessor for the crash-trigger condition. Final gates: Vitest 741/741 + Playwright e2e 47/47 + tsc + build clean. 1 coverage-gap SURFACEd (-07-03, Phase 3 bundle): live crash-trigger verify-self deferred to WP21/WP23 — aerodynamic damping at V_trim spawn keeps |vY| below 2 m/s threshold on scripted dives; wiring is statically obvious and unit-tested at all three layers. **Phase 3 critical path:** `... → WP18(DONE) → WP19(DONE) → WP20 → WP21 → WP22 → WP23 → ship`. WP20 (visual polish, L) is the last Phase 3 content WP; WP21 cross-browser depends on it.
previous_updated: 2026-06-07 — **WP18 DONE (ship commit `63e07fa`).** Phase 3 onboarding milestone CHECKED. Three-phase impl: (1) inline splash overlay (index.html + main.ts setSplashStage/removeSplash helpers); (2) `KeyHintsOverlay` per-mission overlay with 20s fade tied to fixed-physics-tick timer (combat adds Fire/Space); (3) `tests/e2e/time-to-airborne.spec.ts` gate ≤30s budget (measured 1.1s, 27× safety margin). Final gates: Vitest 708/708 + Playwright e2e 42/42 + tsc + build clean. 1 cosmetic SURFACE filed (-07-02 lil-gui occlusion in `?debug=true` only; WP20 candidate). Test-only WP: `tests/e2e/phase2-integration.spec.ts` (8 new tests — 4 mission-select→play→terminal→return for each of the four missions + 4 FPS sanity probes at ≥30 FPS) + tightened `phugoid-probe.spec.ts` envelopes. Final gates: Vitest 700/700 + Playwright e2e 35/35 + tsc + build clean. All Phase 2 WPs `[x]`; Phase 3 unblocks.
---

# Work Breakdown Structure

T-shirt sizing: **XS** ≤ 2h · **S** ≤ half day · **M** ≤ 1 day · **L** ≤ 2–3 days · **XL** > 3 days (consider splitting).

---

## Phase 1 — Flight PoC — ARCHIVED

**Status:** complete (closed 2026-05-11 at WP9.6 ship — Chromium-only operator-as-tester bar, cross-browser deferred to WP21).

Full WP1-WP9.6 detail archived at [`archive/phase-1-flight-poc/wbs-cycle-WP1-WP9.6.md`](archive/phase-1-flight-poc/wbs-cycle-WP1-WP9.6.md). Includes: WP1 (project skeleton), WP2 (fixed-timestep loop), WP3 (input + camera), WP4 (aerosurface primitive), WP5 (flight model composition), WP6 (controls), WP6.5/6.6 (per-surface incidence + β4 damping), WP7 (flight-feel pass), WP8 (Phase 1 world), WP9 (Phase 1 verification), WP9.5 (collider + terrain impact), WP9.6 (@playwright/test adoption).

---

## Phase 2 — Mission System MVP

**Note:** Phase 2 opened with an arch revision (WP10) deciding the mission framework and HUD approach. That work is captured in the archived WBS along with the D14→D27 physics cascade that filled most of Phase 2's wall-clock.

### Completed Phase 2 WPs — ARCHIVED

WP10 through WP15 (including the WP14.* D14→D27 physics cascade and the WP14.20/14.21 per-mission-airframe extensions) are archived at [`archive/phase-2-physics-cascade/wbs-cycle-WP10-WP15.md`](archive/phase-2-physics-cascade/wbs-cycle-WP10-WP15.md). One-line summaries:

- **WP10 — Phase 2 arch revision** (DONE 2026-05-12). D11 mission framework + D12 HUD + D13 β5 damping.
- **WP10.5 — β5 (`clAlphaDot`) schema extension** (DONE 2026-05-12, commit `7b2018d`).
- **WP11 — Mission framework** (DONE 2026-05-12, commit `690788a`). Declarative-JSON missions + mission-select + MissionRunner.
- **WP12 — HUD** (DONE 2026-05-12, commit `dd9c0ed`). DOM overlay per D12.
- **WP13 — Free-flight mission** (DONE 2026-05-12, commit `cdeb77a`). Escape-key abort.
- **WP14 — Waypoint patrol mission** (DONE 2026-05-12, commit `a64b115`, reduced scope per SURFACE-2026-05-12-01).
- **WP14.5/6/7/8 — Physics tuning harness foundations** (DONE 2026-05-12 through 2026-05-16). Physics-core extraction + Node harness + score function + Nelder-Mead optimizer. Establishes `npm run tune`.
- **WP14.9b — β4 non-dim pitch-rate damping (D17)** (DONE 2026-05-17, commit `0df9a07`).
- **WP14.10 — β5 non-dim form (D16)** (DONE 2026-05-23, commit `27324aa`).
- **WP14.11 — Joint (clQ, clAlphaDot) tune retry** (ESCALATED 2026-05-23). Surfaced SURFACE-2026-05-23-01 → D18 architect cycle.
- **WP14.11.5 — D18 drag polar (induced + fuselage)** (DONE 2026-05-23, commit `a93c277`).
- **WP14.12 / 14.13 / 14.14 / 14.14b / 14.15 / 14.16 / 14.17 / 14.18 — D19/D20/D21/D22/D23 cascade** (all ESCALATED or DONE through 2026-05-24). Walked back at D24 post-integrator-fix.
- **WP14.19 — D24+D25+D26+D27 implementation** (CLOSED 2026-05-25, ship commit `eafc91e`, Branch B-accept). 16 SURFACEs closed at this WP; cascade end.
- **WP14.20 — Per-mission airframe selection (plumbing)** (DONE 2026-06-06, ship commit `bb1c242`). SURFACE-2026-06-06-06 Phase A.
- **WP14.21 — Jet airframe (MiG-15-class)** (DONE 2026-06-06, ship commit `01674bf`). Auxiliary; first consumer of WP14.20 plumbing.
- **WP15 — Takeoff/landing mission** (DONE 2026-06-06, ship commit `3a2902c`). Fourth Phase 2 mission completes the four-mission set; surfaces SURFACE-2026-06-06-09 (Cessna T/W=0.6 cannot take off from rest, mitigated via V_trim spawn convention).

The archive also contains the Phase 2-era Dependency map, Architectural-gaps section, and all Session Pause / WP-shipped narrative notes from 2026-05-09 through 2026-05-25.

### WP16: Combat mission — DONE (ship commit `5825f09`, 2026-06-07)
**Description:** Biggest Phase 2 risk (R6). Keep minimal per research: one simple AI enemy (air or ground), one weapon, hit detection, damage model. No AI pathfinding beyond "fly toward / turn toward player." Per **D11**, this is the only Phase 2 mission expected to register a `scriptHook` — the AI enemy logic lives in `src/mission/hooks/combat-ai.ts`. The internal AI architecture (behavior tree vs FSM) is a WP16-internal decision; arch.md does not pre-commit.
**Phase:** 2
**Dependencies:** WP11, WP12
**Size:** L
**Tasks:**
- [x] Weapon: forward-firing projectile (gun, 600 m/s muzzle, 5 ROF, 1500m range, 32-slot pool)
- [x] Projectile lifecycle: spawn, AABB hit detection (TS in combat-ai.ts — Rapier overhead not needed), despawn at lifetime
- [x] AI enemy: stationary ground-style target (chose stationary over AI-flown per "AI-flown aircraft" Out-of-Scope in WP16 spec). Returns fire at 400 m/s 2 ROF with 0.3s lead aim.
- [x] Damage model: PLAYER_HP=6, TARGET_HP=3; destroyed state (visual color + Z-tilt change)
- [x] `src/mission/hooks/combat-ai.ts` registered with the hook registry per D11
- [x] Mission JSON: `scriptHook: 'combat-ai'` + a `destroy-target` objective + `config: "mig15"` for casual playability
- [x] Win: target destroyed (objective.completed flips in same tick per D11). Fail: playerHp=0 → `MissionRunner.setHookFailFlag('shot down')` new API extension

### WP17: Phase 2 verification — DONE (ship commit `88054eb`, 2026-06-07)
**Description:** All four mission types playable end-to-end via mission-select. Exit-criteria check. Adds a ≥30s level-cruise probe per arch.md Rev 2026-05-12 D13 to validate β5 (`clAlphaDot`) damping under non-zero throttle, since phugoid behavior hides in single-period observation.
**Phase:** 2
**Dependencies:** WP13, WP14, WP15, WP16
**Size:** S
**Tasks:**
- [x] End-to-end mission-select → play → win/lose → return-to-select for each of the four mission types.
- [x] ≥30s Playwright probe at non-zero throttles (`0.05`, `0.15`, `0.4`) — assert bounded |altitude − spawn| and bounded pitch oscillation across the full window. Phugoid coverage per D13. (Memory `feedback_verify_self_envelope.md` applies.)
- [x] FPS check at Chromium across all four mission types (cross-browser sweep remains WP21).

---

## Phase 3 — v1 Ship

### WP18: Onboarding pass — DONE (ship commit `63e07fa`, 2026-06-07)
**Description:** New player is flying within 30s. No tutorial — in-world prompts only. First-load UX.
**Phase:** 3
**Dependencies:** WP17
**Size:** M
**Tasks:**
- [x] Boot directly into a 1-screen mission select — picked this over "just-fly" because it surfaces the four mission types from the vision (mission-variety-over-depth principle). Mission-select unchanged from WP11; finalized as the boot-target.
- [x] On-screen key hints fade in during first minute — `src/hud/key-hints.ts` `KeyHintsOverlay` shows for 20s per mission start (opaque 10s, linear fade 10→20s, detach at 21s). Combat adds Fire/Space. Re-shown on every fresh mission entry.
- [x] Preload Rapier WASM in parallel with splash — splash inlined in `index.html` paints on first frame (before JS bundle parses); main.ts updates stage labels at each await ("Loading physics…" → "Loading scene…" → "Ready"). Existing `Promise.all` parallelism between `RAPIER.init()` and `loadAircraftConfig()` preserved.
- [x] Timed test: stopwatch from URL-open to airborne — `tests/e2e/time-to-airborne.spec.ts` codifies the vision-stated "30s to flying" claim. Measured 1.1s on dev cold-load (27× under budget).

### WP19: Audio — DONE (ship commit `7467f10`, 2026-06-07)
**Description:** Engine, wind, weapon, crash sounds. Web Audio API. Guard for Safari latency (R4).
**Phase:** 3
**Dependencies:** WP17
**Size:** S
**Tasks:**
- [x] Engine loop scaled by throttle — sawtooth oscillator, 90→340 Hz mapped from throttle 0→1, 50ms linear-ramp smoothing (`src/audio/engine-loop.ts`)
- [x] Wind tied to airspeed — looped procedural pink-noise BufferSource → BiquadFilter lowpass (200→2000 Hz) + GainNode (0→0.15); fully silent below AS=10 m/s (`src/audio/wind.ts`)
- [x] Weapon fire + impact SFX — synthesized saw-burst (fire, 200ms) + filtered-noise burst (impact, 150ms); wired via new `onFire`/`onImpact` callbacks on `registerCombatAi` (`src/audio/sfx.ts`)
- [x] Crash SFX — low-saw + filtered-noise envelope (800ms); fired from main.ts statusChange handler when `getFailReason() === 'crash'`. Added `MissionRunner.getFailReason()` accessor.
- [x] Safari audio check — AudioContext lazily created in `start()` and resumed on first user gesture (mission-select click + deep-link entry path); try/catch with console.warn for rare reject case

### WP20: Visual polish pass — DONE (ship commit `28bc898`, 2026-06-07)
**Description:** Replace placeholders. Nicer skybox, textured terrain (optional terrain upgrade to heightmap — swap via `terrain.ts` interface), better aircraft GLTF, basic particle effects (contrails, explosions, gunfire).
**Phase:** 3
**Dependencies:** WP17
**Size:** L
**Tasks:**
- [x] Skybox: cloud-blob stamping (deterministic seeded RNG, 6 blobs per side face) + horizon haze band; 256→512 face resolution. Procedural-improved path chosen over image-based cubemap to keep bundle deterministic.
- [x] Terrain: kept flat per D4 commitment + spec acceptance-criterion-5 default; texture unchanged from Phase 1. Heightmap upgrade deferred (still a clean swap via `terrain.ts` interface if Phase 3 polish later wants it).
- [x] Aircraft: procedural primitive meshes for Cessna (cylindrical fuselage + nose cone + high-wing struts + extruded fin) and MiG-15 (intake cone + dorsal hump + 35°-swept wings/h-stab/v-fin via ExtrudeGeometry) via new `src/aircraft/aircraft-mesh.ts`. GLTF + animated control surfaces deferred to v1.x per spec out-of-scope.
- [x] Particles: CPU-side `src/world/particles.ts` (256-pool, kind-tagged emit) with muzzle-flash (warm-yellow, 8p × 0.15s), impact (hot-orange, 16p × 0.4s), ground-dust (brown-grey, 24p × 0.8s, half-gravity). Shared Points mesh with AdditiveBlending. Wired to combat-ai fire/hit callbacks + main.ts crash branch. window.__particles debug accessor.
- [x] Lighting: HemisphereLight replaced with DirectionalLight (warm sun at (200,220,60), intensity 1.0) + AmbientLight (cool sky-tint, 0.45). PCF soft shadow, 1024² map, ±250m frustum, bias -0.0005. Aircraft/landmarks already had cast/receive set.
- [x] **Backlog close (Phase 4 polish sweep):** SURFACE-2026-06-07-02 (key-hints re-anchored bottom-left to clear lil-gui), SURFACE-2026-06-07-01 (target visual decoupled from AABB — collider unchanged, visual is now a 4m × 20m square ground building).

### WP21: Cross-browser QA — DROPPED (2026-06-07, operator directive)
**Status:** Dropped from v1 scope. Chromium-only is the v1 acceptance bar — extends the operator-as-tester precedent from Phase 1 (WP9 closed Chromium-only with cross-browser deferred here). Cross-browser support becomes a v1.x concern; if WP23 playtest surfaces a Safari/Firefox regression that blocks a casual player, file a SURFACE and address inline. Playwright runner already supports all three engines natively (adopted WP9.6) so a future v1.x cross-browser WP is config-only.

### WP22: Deploy + share — DONE (ship commit `f8d804b`, 2026-06-13)
**Description:** Pick a static host (Vercel / Netlify / Cloudflare Pages — equivalent), deploy, public URL. Picked GitHub Pages after mid-feature host pivot (Cloudflare locked out via 2FA loss). Live URL: **https://staymanhou.github.io/areo-test-proty-1/**.
**Phase:** 3
**Dependencies:** WP20
**Size:** XS
**Tasks:**
- [x] `.nvmrc` pinning Node 22 + drift insurance
- [x] `vite.config.ts` with `base: '/areo-test-proty-1/'` (matches GitHub Pages URL path)
- [x] `public/.nojekyll` (skip Jekyll processing on `dist/`)
- [x] `.github/workflows/deploy.yml` — `actions/deploy-pages@v4` flow (build → upload artifact → deploy)
- [x] BASE_URL fix at runtime fetch sites (`src/mission/loader.ts` ×2, `src/engine/scripted-input.ts` ×1) — mid-build discovery, SURFACE-2026-06-13-01 filed and resolved inline
- [x] Verify-self via Playwright MCP against the live URL (8/8 observable outcomes); verify-human PASS by operator playtest

### WP23: Playtesting
**Description:** 3–5 casual players open the URL and complete a mission without help. Record observations; loop back if any mission is unclear.
**Phase:** 3
**Dependencies:** WP22
**Size:** S

### WP24: Aircraft selection UI
**Description:** Surface airframe choice (Cessna-class default, MiG-15-class jet) on the mission-select screen so players can pick before launching a mission. Today the jet ships as a deep-link-only fixture (`?mission=jet-test`, WP14.21) — this WP promotes per-mission `config?` plumbing (WP14.20) to a player-facing choice. Consider whether the choice is per-mission (each mission constrains airframe), free across all missions, or hybrid (default per mission + override). Default position: free across all four missions; per-mission override only if a mission becomes unplayable in a given airframe (e.g., true takeoff roll on Cessna per SURFACE-2026-06-06-09).
**Phase:** 3
**Dependencies:** WP22
**Size:** S–M (depends on per-mission default vs free; tuning second airframe to feel-quality bar is the variable cost)
**Vision-constraint note:** `docs/product/roadmap.md:62` lists "Multiple aircraft selection" as **out of scope for v1**. This WP **negotiates that exclusion** — the second airframe already exists (WP14.21) and only the UI + a feel-tuning pass are missing. Operator should confirm: (a) promote to v1 (this WP), or (b) keep deep-link-only and defer the UI to v1.x. The exclusion was originally written when no second airframe existed; the cost calculus has changed.
**Open questions for spec/plan time:**
- Per-mission constraint vs free choice (see Description).
- Does the aerobatic seed (`aircraft-aerobatic.json` from `scripted-input-harness` ship, 2026-06-06) become a third selectable option, or stay a test fixture? See SURFACE-2026-06-06-06 (Phase B feel-tune deferred).
- Naming on the UI — "Cessna" / "MiG-15" / "Aerobatic" vs class names ("Trainer" / "Jet" / "Aerobatic")?
- Where on the mission-select does the choice live — global toggle or per-mission tile?

### WP25: In-game control manual (read-only)
**Description:** Read-only reference card listing the active keymap (pitch / roll / yaw / throttle / fire, plus camera + Escape-to-menu). Reached from the mission-select screen via a "Controls" button or from in-mission via a pause/help key (e.g. `?` or `H`). Closes the gap between the 20s key-hints overlay (WP18) and a player who alt-tabs away and comes back having forgotten the bindings. No rebinding — just a static reference. Static HTML overlay (same DOM-overlay pattern as `src/hud/key-hints.ts` and `src/hud/dom-hud.ts` per D12). Content rendered from `DEFAULT_KEY_MAP` so it stays in sync if keymap changes (single source of truth).
**Phase:** 3
**Dependencies:** WP22
**Size:** XS–S
**Open questions for spec/plan time:**
- Trigger key — `?` (matches Vim/many games) vs `H` vs both?
- Mission-select entry — dedicated tile/button, or a small `(?)` icon in a corner?
- In-mission trigger — pause the runner while open, or non-blocking overlay?
- Does the manual list mission objectives too, or just controls? (Recommend just controls — objectives stay in HUD per D12.)

### WP26: Audio mix pass — quieter engine + volume control
**Description:** Operator playtest at WP22 deploy (2026-06-13) flagged engine-loop sound as too loud. Lower the engine baseline gain (currently set during WP19 — see `src/audio/engine-loop.ts`) AND add a master volume control surface so players can adjust to taste. Likely a slider in the HUD or mission-select chrome; persist via localStorage so the choice survives page reloads. Consider whether wind / SFX get the same master multiplier or separate sliders (recommend: single master for v1 simplicity).
**Phase:** 3
**Dependencies:** WP22 (so the fix ships to the live URL)
**Size:** S
**Open questions for spec/plan time:**
- Single master slider, or per-channel (engine/wind/SFX)? Recommend master-only for v1.
- Slider location — mission-select corner, HUD corner, in a small pause/settings overlay? (WP25 control manual could share the same surface.)
- Persistence — localStorage with a key like `flightsim.volume.master` (0..1 float)? Default value if absent — 0.5? Lower per the operator's "too loud" feedback.
- Should the engine-loop baseline gain in `src/audio/engine-loop.ts` be lowered as the default (independent of the master slider), so the at-1.0 master is the new "loud"? Recommend yes — slider centered around a comfortable default, not forcing the user to drag every load.

---

## Critical path

`... → WP17(DONE) → WP18(DONE) → WP19(DONE) → WP20(DONE) → WP22(DONE) → WP23 → ship`. (WP21 cross-browser QA dropped 2026-06-07 — Chromium-only acceptance; cross-browser to v1.x.)

**WP24, WP25, WP26 are not on the critical path** — all three depend on WP22 deploy completing so they ship to the same URL. WP24 negotiates the v1 multi-aircraft exclusion (`roadmap.md:62`); WP25 is straightforward Phase 3 polish; WP26 fixes the engine-loop loudness flagged at WP22 verify-human (2026-06-13). Sequence after WP22: either before WP23 playtest (so testers see them) or after (if WP23 surfaces them as needs). Recommend slotting all three before WP23 so the playtest feedback covers the full v1 surface. **WP26 is the highest priority of the three** — it addresses a concrete operator-flagged playtest issue, while WP24/WP25 are speculative.

## Session Pause — 2026-06-07 15:00
Paused. See `workflow/.session.md` to resume. WP19 shipped (`7467f10`) + finalized (`b03140e`); Phase 3 milestone "Audio: engine, wind, weapon, crash sounds" CHECKED. Operator-queued next entry: WP20 visual polish (L) — recommended `/feature-spec` given art-direction scope. Drive mode: full-autopilot.

Phase 1 and the D14→D27 physics cascade dependency map are preserved in the archived WBS.
