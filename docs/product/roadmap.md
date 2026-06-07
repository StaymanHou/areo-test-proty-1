---
stage: roadmap
state: in-progress
updated: 2026-06-07 — **WP17 shipped — Phase 2 verification** at ship commit `88054eb`. Phase 2 exit gate closed: 4-mission integration sweep (`tests/e2e/phase2-integration.spec.ts` — 4 click-to-terminal-to-return tests + 4 FPS sanity probes ≥30 FPS) + tightened `phugoid-probe.spec.ts` spawn-relative envelopes. Final gates: Vitest 700/700 + Playwright e2e 35/35 + tsc + build clean. All Phase 2 WPs complete. **Phase 3 (v1 ship) UNBLOCKS**: WP18 onboarding + WP19 audio + WP20 visual polish → WP21 cross-browser QA → WP22 deploy → WP23 playtesting. Earlier 2026-06-07 — WP16 shipped — combat mission at ship commit `5825f09`. All four Phase 2 mission types now playable from main screen. Earlier 2026-06-06 (late evening) — **WP15 shipped — takeoff/landing mission** at ship commit `3a2902c`. Fourth Phase 2 mission complete; Phase 2 exit-criteria milestone "Takeoff/landing mission (airfield with runway, touchdown detection)" CHECKED. Phase 2 critical path was: only WP16 combat remains for Phase 2 exit criteria. Mission ships at V_trim=78 spawn (CLAUDE.md Rule #9 convention) — true-takeoff-roll gameplay deferred per filed SURFACE-2026-06-06-09 (Cessna T/W=0.6 structurally cannot take off from rest on 600m runway). Earlier 2026-06-06 entry: **WP14.21 shipped — MiG-15-class jet airframe** at ship commit `01674bf`. First consumer of WP14.20 per-mission `config?` plumbing. Deep-link-only `?mission=jet-test` (NOT in home menu) per Option α resolution of `docs/product/roadmap.md:62` v1 multi-aircraft exclusion. Operator playtest PASS. AUXILIARY to Phase 2 exit criteria (the four v1 missions stay Cessna-default; jet is a verification-of-airframe-faithfulness fixture, not v1 menu-surfaced gameplay). No Phase 2 milestones advance at this commit (WP15 takeoff/landing + WP16 combat still pending). Earlier 2026-06-06 evening entry: **WP14.20 shipped — per-mission airframe selection plumbing** at ship commit `bb1c242`; closes SURFACE-2026-06-06-06 Phase A. Plumbing-only — Phase B feel-tune of aerobatic airframe + Phase C aerobatic mission content remain deferred per `docs/product/roadmap.md:62` (multiple-aircraft v1 exclusion). No Phase 2 exit-criteria milestone advances at this commit (WP15 + WP16 still pending). Earlier 2026-05-25 entry: **WP14.19 CLOSED — D14→D27 physics cascade end on Branch B-accept**, ship commit `eafc91e`. The 11-day D14→D27 cascade closed structurally + behaviorally: integrator fix at `fix-resetforces-bug` (46f9b42) + spawn AS uniformization to V_trim=78 in parity-fixtures (D24/D25) + per-regime alt envelopes (D26-β) + mission JSON spawn AS recalibration (D27). Phase 2 mission content milestones unblock: WP15 takeoff/landing + WP16 combat. Phase 2 exit-criteria gate (4 mission types playable from main screen) advances from "3-of-4 + 1 pending physics cascade" to "3-of-4 + 1 pending WP15 takeoff/landing impl + WP16 combat impl." Earlier 2026-05-12 entry: WP10–WP14 — Phase 2 arch revision + β5 schema + mission framework + HUD + free-flight + waypoint all shipped 2026-05-12.)
---

# Roadmap

### Phase 1: Flight PoC
**Goal:** Prove the core loop — a plane flies in a browser with plausible physics and responsive controls.

**Milestones:**
- [x] Project skeleton: web stack chosen, dev server, deploy path
- [x] 6DOF rigid-body aircraft with plausible lift/drag/thrust/stall (WP2 loop, WP4 aerosurface, WP5 composition)
- [x] Keyboard flight controls (WP6 — keyboard only; mouse deferred to Phase 3 polish; "feel natural" dispositioned in WP7 Phase F as PASS at the "bounded, controllable, non-tumbling" bar via operator-as-tester; the original "external casual player finds it natural" bar from Q4 research was not met — the descending-glide gameplay survives single-pilot operator review but has not been validated by an external tester. If external feedback rejects the descending-glide in Phase 3 playtesting, SURFACE-2026-05-11-04 — phugoid undamped — is the escalation path)
- [x] Single aircraft rendered in a minimal 3D world (terrain + sky) (WP8 — flat 4000m terrain, procedural skybox, runway, control tower)
- [~] Runs at 60fps on a mid-range laptop in Chrome/Safari/Firefox — Chromium PASS (WP9 Phase 2: 60.01 fps avg, 56.82 min, 0 spikes). WebKit + Firefox deferred to WP21 cross-browser QA (Playwright runner now adopted at WP9.6 supports all three engines natively, so WP21 is a config-only expansion).
- [x] Camera follows the aircraft (chase + cockpit view)

**Exit Criteria:** A developer can open the dev URL, take off, fly around, and crash — and it feels right. No missions, no UI chrome required.

---

### Phase 2: Mission System MVP
**Goal:** Add structured gameplay — the four mission types from the vision, each minimally playable.

**Milestones:**
- [x] Mission framework: load mission definition, track objectives, win/lose states — WP11 (2026-05-12, commit `690788a`)
- [x] Free flight mission (no objectives, just a map) — WP13 (mission JSON shipped at WP11; Escape-to-menu abort closed it 2026-05-12)
- [x] Waypoint navigation mission (fly through ordered checkpoints, timer) — WP14 (reduced-scope glide-reachable patrol shipped 2026-05-12, commit `a64b115`; high-energy patrol awaits WP14.5 clAlphaDot tuning)
- [x] Takeoff/landing mission (airfield with runway, touchdown detection) — WP15 (shipped 2026-06-06, commit `3a2902c`)
- [x] Combat mission: basic weapons, one AI enemy (air or ground), damage model — WP16 (shipped 2026-06-07, commit `5825f09`)
- [x] Mission select screen and in-mission HUD (altitude, speed, objective) — WP11 mission-select + WP12 HUD (2026-05-12, commits `690788a` + `dd9c0ed`)

**Exit Criteria:** From the main screen a player can pick any of the four mission types, play it to completion (or failure), and return to mission select.

---

### Phase 3: v1 Ship
**Goal:** Polish the PoC + MVP into something shareable — a playable demo that a casual gamer enjoys for 5–15 minutes.

**Milestones:**
- [ ] Onboarding: new player is flying within 30 seconds — no tutorial, in-world prompts only
- [ ] Audio: engine, wind, weapon, crash sounds
- [ ] Visual polish pass: skybox, terrain textures, aircraft model, basic effects (contrails, explosions)
- [ ] Cross-browser QA: Chrome, Safari, Firefox latest on desktop
- [ ] Deploy to a public URL, shareable link
- [ ] Playtesting: 3–5 casual players complete at least one mission without help

**Exit Criteria:** A shareable URL where a casual gamer can fly and complete a mission in under 5 minutes of first visit, at 60fps on a mid-range laptop.

---

## Deferred (not on roadmap)

The following are explicitly out of scope for v1 and not on the roadmap — noted here to prevent scope creep:

- Multiplayer
- User accounts, progression, persistence
- Mobile / touch controls
- Monetization
- Multiple aircraft selection (v1 ships with one aircraft)
- Mission editor / user-generated content
- Campaign / mission chains
- Study-level flight model refinements
