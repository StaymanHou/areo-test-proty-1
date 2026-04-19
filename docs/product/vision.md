---
stage: vision
state: complete
updated: 2026-04-19
---

# Vision — Web Flight Sim

## Vision

Browser-based flight simulator that lets anyone open a URL and be flying within seconds. Physics are plausible — lift, drag, thrust, stall, and 6DOF rigid-body motion behave recognizably — but tuned for accessibility rather than study-level accuracy. Small mission set (free flight, waypoint navigation, combat, takeoff/landing) gives players a reason to engage beyond sandbox flying.

The product answers: *can a casual gamer, with no install and no manual, have a satisfying 5-minute flight experience in a browser?*

## Target Audience

**Primary:** Casual browser gamers who want a quick, visually engaging flight experience without downloads, tutorials, or realism barriers. They land via a shared link, expect to be flying in under 30 seconds, and play sessions of 5–15 minutes.

**Secondary (not v1 focus):** Sim-curious players who might graduate to heavier sims if they enjoy this.

**Explicitly out of scope:** Study-level sim enthusiasts (DCS/MSFS audience). This is not competing with those — realism is "plausible" not "accurate."

## Success Metrics

**v1 definition of done:** A visitor can open the URL, pick from free flight / waypoint / combat / landing missions, fly with mouse+keyboard or similar, and complete a mission. Ships and is shareable.

**Qualitative signals:**
- New player airborne within 30 seconds of loading
- Flight model feels "right" to casual players — stalls, banking, throttle all behave intuitively
- At least one mission of each of the four types is completable and fun
- Runs at 60fps on a mid-range laptop in a modern browser

**Explicitly NOT v1 metrics:** multiplayer, user accounts, persistence/progression, monetization, mobile support.

## Core Principles

1. **No-install, no-tutorial.** If a player needs docs, the game failed. In-world prompts only.
2. **Plausible over perfect.** Flight model should feel real-enough to a casual player, not hold up to a pilot's scrutiny. Dampening and assists are fine.
3. **Browser-native constraints.** 60fps on mid-range hardware, reasonable load size, works on Chrome/Safari/Firefox latest. No WebGPU-only features yet.
4. **Mission variety over depth.** Four shallow mission types beats one deep one — the audience samples, they don't grind.
5. **Ship-and-share over polish.** v1 is a playable demo, not a finished product. Polish is a later phase.
