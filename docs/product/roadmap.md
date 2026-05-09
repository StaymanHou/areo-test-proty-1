---
stage: roadmap
state: in-progress
updated: 2026-05-09 (WP8)
---

# Roadmap

### Phase 1: Flight PoC
**Goal:** Prove the core loop — a plane flies in a browser with plausible physics and responsive controls.

**Milestones:**
- [x] Project skeleton: web stack chosen, dev server, deploy path
- [x] 6DOF rigid-body aircraft with plausible lift/drag/thrust/stall (WP2 loop, WP4 aerosurface, WP5 composition)
- [x] Keyboard flight controls (WP6 — keyboard only; mouse deferred to WP7/Phase 3 polish; "feel natural" finalized in WP7)
- [x] Single aircraft rendered in a minimal 3D world (terrain + sky) (WP8 — flat 4000m terrain, procedural skybox, runway, control tower)
- [ ] Runs at 60fps on a mid-range laptop in Chrome/Safari/Firefox (WP8 evidences 60fps for the world-rendering layer; full Phase 1 perf check is WP9 with cross-browser sweep)
- [x] Camera follows the aircraft (chase + cockpit view)

**Exit Criteria:** A developer can open the dev URL, take off, fly around, and crash — and it feels right. No missions, no UI chrome required.

---

### Phase 2: Mission System MVP
**Goal:** Add structured gameplay — the four mission types from the vision, each minimally playable.

**Milestones:**
- [ ] Mission framework: load mission definition, track objectives, win/lose states
- [ ] Free flight mission (no objectives, just a map)
- [ ] Waypoint navigation mission (fly through ordered checkpoints, timer)
- [ ] Takeoff/landing mission (airfield with runway, touchdown detection)
- [ ] Combat mission: basic weapons, one AI enemy (air or ground), damage model
- [ ] Mission select screen and in-mission HUD (altitude, speed, objective)

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
