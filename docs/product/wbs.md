---
stage: wbs
state: in-progress
updated: 2026-06-07 — WP16 combat mission DONE (ship commit `5825f09`). Closes Phase 2's last gameplay WP. Combat-ai hook ships per D11 (single hook, no FSM); MissionRunner extended with hook-driven fail flag for player-HP=0 loss path; DomHud extended with `setCombatHP(player, target)` for combat HP rows; mig15 airframe via per-mission `config:` plumbing (SURFACE-2026-06-06-06). **Phase 2 critical path:** `... → WP16(DONE) → WP17(NEXT, Phase 2 verification + level-cruise probe) → Phase 2 exit → Phase 3 ship work`.
previous_updated: 2026-06-06 — archived Phase 1 (WP1-WP9.6) + Phase 2 completed WPs (WP10-WP15) into `archive/phase-1-flight-poc/wbs-cycle-WP1-WP9.6.md` and `archive/phase-2-physics-cascade/wbs-cycle-WP10-WP15.md` per SURFACE-2026-06-06-08 (size-guard sweep). Live `wbs.md` retained the active critical-path WPs (WP16 + WP17) inline plus Phase 3 WPs inline. No work-content changes — pure structural curation.
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

### WP17: Phase 2 verification
**Description:** All four mission types playable end-to-end via mission-select. Exit-criteria check. Adds a ≥30s level-cruise probe per arch.md Rev 2026-05-12 D13 to validate β5 (`clAlphaDot`) damping under non-zero throttle, since phugoid behavior hides in single-period observation.
**Phase:** 2
**Dependencies:** WP13, WP14, WP15, WP16
**Size:** S
**Tasks:**
- [ ] End-to-end mission-select → play → win/lose → return-to-select for each of the four mission types.
- [ ] ≥30s Playwright probe at non-zero throttles (`0.05`, `0.15`, `0.4`) — assert bounded |altitude − spawn| and bounded pitch oscillation across the full window. Phugoid coverage per D13. (Memory `feedback_verify_self_envelope.md` applies.)
- [ ] FPS check at Chromium across all four mission types (cross-browser sweep remains WP21).

---

## Phase 3 — v1 Ship

### WP18: Onboarding pass
**Description:** New player is flying within 30s. No tutorial — in-world prompts only. First-load UX.
**Phase:** 3
**Dependencies:** WP17
**Size:** M
**Tasks:**
- [ ] Boot directly into a "just fly" state or a 1-screen mission select (test both)
- [ ] On-screen key hints fade in during first minute
- [ ] Preload Rapier WASM in parallel with splash (mitigates R1)
- [ ] Timed test: stopwatch from URL-open to airborne

### WP19: Audio
**Description:** Engine, wind, weapon, crash sounds. Web Audio API. Guard for Safari latency (R4).
**Phase:** 3
**Dependencies:** WP17
**Size:** S
**Tasks:**
- [ ] Engine loop scaled by throttle
- [ ] Wind tied to airspeed
- [ ] Weapon fire + impact SFX (if combat)
- [ ] Crash SFX
- [ ] Safari audio check

### WP20: Visual polish pass
**Description:** Replace placeholders. Nicer skybox, textured terrain (optional terrain upgrade to heightmap — swap via `terrain.ts` interface), better aircraft GLTF, basic particle effects (contrails, explosions, gunfire).
**Phase:** 3
**Dependencies:** WP17
**Size:** L
**Tasks:**
- [ ] Skybox: chosen art direction, 6 hi-res faces
- [ ] Terrain: decide upgrade vs keep flat (swap heightmap impl if upgrade)
- [ ] Aircraft: final GLTF with materials, animated control surfaces
- [ ] Particles: contrails, explosion, muzzle flash
- [ ] Lighting: directional sun + ambient

### WP21: Cross-browser QA
**Description:** Chrome, Safari, Firefox latest on desktop. 60fps on mid-range laptop. Fix compat regressions.
**Phase:** 3
**Dependencies:** WP18, WP19, WP20
**Size:** S
**Tasks:**
- [ ] Test each mission in each browser
- [ ] FPS meter on mid-range hardware (user's existing laptop is the reference machine)
- [ ] Input feel check (mouse sensitivity differs per browser)
- [ ] WASM load on slow connection (throttled network in devtools)

### WP22: Deploy + share
**Description:** Pick a static host (Vercel / Netlify / Cloudflare Pages — equivalent), deploy, public URL.
**Phase:** 3
**Dependencies:** WP21
**Size:** XS

### WP23: Playtesting
**Description:** 3–5 casual players open the URL and complete a mission without help. Record observations; loop back if any mission is unclear.
**Phase:** 3
**Dependencies:** WP22
**Size:** S

---

## Critical path

`... → WP16(DONE) → WP17(NEXT, Phase 2 verification) → Phase 2 exit → WP18 + WP19 + WP20 → WP21 → WP22 → WP23 → ship`.

Phase 1 and the D14→D27 physics cascade dependency map are preserved in the archived WBS.
