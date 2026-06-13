---
name: WP24 — Aircraft selection UI
type: feature
state: ship (complete)
ship_commit: f3daffb
created: 2026-06-13
drive_mode: full-autopilot
size: S–M
---

# Feature: WP24 — Aircraft selection UI

**Workflow:** feature
**State:** spec
**Created:** 2026-06-13
**Entry:** spec (complex feature — UI surface + roadmap-exclusion negotiation + 5 open questions)

## Problem Statement

Today the project has three tunable airframes on disk — `aircraft.json` (Cessna-class trainer, default), `aircraft-mig15.json` (jet, WP14.21), and `aircraft-aerobatic.json` (scripted-input-harness fixture, 2026-06-06) — but only the Cessna is reachable from the mission-select screen. The MiG-15 ships as a deep-link-only fixture (`?mission=jet-test` / `?mission=combat`) via per-mission `config?` plumbing (WP14.20). A casual player who opens the live URL never sees the jet exists. WP24 promotes per-mission `config?` to a **player-facing choice** on the mission-select screen.

The work also **negotiates a v1 roadmap exclusion**: `docs/product/roadmap.md:62` lists "Multiple aircraft selection (v1 ships with one aircraft)" as out-of-scope. That exclusion was written when no second airframe existed; the cost calculus has changed since WP14.21 shipped the jet. Spec entry decision: promote to v1 (this WP) or keep deferred.

The current per-mission `config?` plumbing has a known constraint inherited from WP14.20 Phase A: **mid-session airframe swap requires a full page reload** (`main.ts:661` warns + ignores; airframe is fixed at boot via `loadAircraftConfig(aircraftConfigPath)`). The UI must therefore drive the boot-time choice, not a mid-session toggle — which constrains the UX shape to "pick on mission-select before launching."

## User Stories

- **As a casual player**, I want to see all available aircraft on the mission-select screen so that I can try the jet without knowing about deep-link URLs.
- **As a casual player**, I want my last airframe choice to be remembered across page reloads so that I don't re-pick on every visit.
- **As a returning player** who likes the Cessna, I want the default selection to remain the Cessna so that the no-pick path is unchanged.
- **As a casual player**, I want to see why an airframe is grayed out (if any mission constrains it) so that the UI doesn't feel broken.

## Acceptance Criteria

The feature is done when:

1. **Mission-select shows an airframe picker** with at least two options visible: Cessna-class (default) and MiG-15-class. Visual treatment is functional, not polished — pattern matches existing `MissionSelectScreen` chrome (CSS-absolute overlay, sans-serif, dark theme; no new framework, per arch D8).
2. **Default selection is Cessna** on first load. Player choice persists via `localStorage` (key: `flightsim.aircraft.selected`, value: `'default' | 'mig15' | 'aerobatic'`). A returning player sees their previous pick pre-selected.
3. **Choice drives boot-time `loadAircraftConfig`**: when the player picks a mission, the selected airframe is what `Aircraft` + `FlightModel` are built from. Per-mission `config?` continues to work as a hard override per WP14.20 (Combat forces MiG-15 regardless of player pick — see §Open Questions for the per-mission-override policy).
4. **Per-mission overrides are visible**: missions that hard-pin an airframe via `config?` (currently `combat.json` → MiG-15) display the pinned airframe inline on the mission tile/button (e.g., "Combat [MiG-15]") so the player understands the picker doesn't apply to that mission.
5. **Mid-session swap is NOT implemented**: when the player returns to the mission-select screen after a mission (win/fail), they may change the picker; the next mission they launch reloads the page (or equivalent — see §Open Questions on whether to soft-reload via in-place teardown). Picking a different airframe and then launching MUST result in that airframe flying.
6. **No regression for the existing 4-mission set**: all four current missions (Free Flight, Waypoint Patrol, Takeoff & Landing, Combat) remain playable end-to-end via mission-select. Deep-link entry (`?mission=<id>`) keeps working.
7. **Tests:** at least one Playwright e2e exercising "pick MiG-15 → launch Free Flight → assert jet-shaped airframe spawns" + unit tests for the localStorage round-trip + tile-label-with-pinned-config rendering. Vitest + e2e all green pre-ship.
8. **Onboarding overlay** (WP18 key-hints) continues to work for all airframes; if the jet needs a different key-hint set (e.g., afterburner key — not currently planned), document the gap.

## Out of Scope

- **Mid-session airframe swap** (no `Aircraft.replaceConfig()` route). Deferred to v1.x. Current WP14.20 Phase B disposition stands.
- **Tuning/feel pass on the MiG-15 or Aerobatic** beyond what shipped at WP14.21 + WP14.20 (SURFACE-2026-06-06-06 Phase B remains deferred). The picker exposes what's already on disk; if the jet feels different from the Cessna, that's the player's choice. If a specific mission becomes unplayable in a given airframe, the per-mission `config?` override is the escape hatch (per existing WP14.20 mechanism).
- **A third selectable airframe (Aerobatic)** unless §Open Questions Q3 resolves that direction. Default position: Aerobatic stays a test fixture.
- **Per-mission tile-level airframe override UI** (e.g., a small dropdown on each tile). Default position: global picker only.
- **Visual previews / thumbnails / aircraft 3D miniatures** in the picker. Default position: text labels only (WP25/WP26-class polish, not WP24).
- **In-mission airframe info display** beyond what HUD already shows. No new HUD element.
- **Cross-browser QA** (WP21 dropped; Chromium-only acceptance bar).
- **Roadmap.md text update** — that's a strategic-doc edit; will land at `/feature-finalize` (or via `/product-finalize` if it triggers an arch revision; this WP does NOT itself rewrite vision/roadmap).

## Technical Constraints

- **Boot-time airframe binding.** `src/main.ts` calls `loadAircraftConfig(aircraftConfigPath)` once, ~line 101, and the resulting config flows into `Aircraft` + `FlightModel` constructors. Per WP14.20, mid-session swap is unsupported (see `main.ts:661` warning). UI must operate within this constraint. **Implication:** "launch with picked airframe" requires either (a) a full `location.reload()` with the choice persisted in localStorage and read at boot, or (b) deferred boot — read picker pre-`loadAircraftConfig`. Default position: (b) (loadAircraftConfig is already gated on a localStorage/URL read; just add the picker as another input).
- **Per-mission `config?` override is binding** (WP14.20 D11 extension). Missions that set `"config": "mig15"` MUST get the MiG-15 regardless of the player's picker. Combat is currently the only such mission. The pinned-config label requirement (acceptance criterion 4) makes this visible.
- **Path-traversal-defended config-name regex** is already in place at `?config=` (per CLAUDE.md "Browser-walkthrough discipline" §scripted-input). Reuse `/^[a-z0-9_-]+$/i` for the localStorage value before passing into the config path (defensive; values come from our own UI, but defense-in-depth is cheap).
- **DOM overlay per D12**, no React/R3F (arch D8). Extend `src/mission/select.ts` in place; pattern matches existing CSS injection + button list. No new dependency.
- **No 3rd-party probe needed.** Pure UI + localStorage. localStorage is a settled web API (no probe WP precedent).
- **Active SURFACEs to keep in scope:**
  - SURFACE-2026-06-06-09 (Cessna T/W=0.6 cannot take off from rest in `takeoff-landing.json`, mitigated via V_trim spawn) — picker should NOT introduce a path where Cessna spawns at rest on the runway. Current spawn convention is already V_trim=78 for all missions; preserved.
  - SURFACE-2026-06-06-06 Phase B (Aerobatic feel-tune deferred) — keeps Aerobatic out of the picker unless Q3 resolves otherwise.

## Open Questions — RESOLVED (operator: full-autopilot, common sense)

All 5 proposals from spec accepted:

- **Q1: Vision-constraint negotiation** → **promote to v1**. The jet already exists; deferring exposes a discoverability gap. Roadmap text update lands at finalize.
- **Q2: Per-mission constraint vs free choice** → **free across all four missions; per-mission `config?` is a hard override** (existing WP14.20 mechanism). Combat stays forced-MiG-15. Tile labels surface the pinned-config inline.
- **Q3: Aerobatic seed disposition** → **stay test fixture, NOT selectable.** SURFACE-2026-06-06-06 Phase B deferred; shipping the untuned Aerobatic as a player option risks "this feels broken" feedback.
- **Q4: UI naming** → **class + airframe name**. "Trainer (Cessna)" / "Jet (MiG-15)".
- **Q5: UI location** → **global picker on the mission-select screen**, rendered above the mission-button list. Per-mission tiles label their pinned overrides inline.

## Implementation Notes (resolved at plan time)

- **localStorage key:** `flightsim.aircraft.selected`. Value: one of `'default' | 'mig15'` (extensible). On read, validate against the static known-airframe set AND `CONFIG_NAME_REGEX` (`/^[a-z0-9_-]+$/i`, defense-in-depth); fall back to `'default'` on any mismatch.
- **Airframe manifest:** hardcoded `AIRCRAFT_OPTIONS` array in `src/mission/select.ts` (or sibling module). Matches the mission-manifest precedent (WP11 used a JSON file because missions are content-data; airframes are a small fixed set of UI labels mapping to existing config files — array-in-code is simpler).
- **Boot-time resolution precedence:** `?config=<name>` (URL) > preloaded-mission `config?` (deep-link) > **localStorage `flightsim.aircraft.selected`** (NEW) > `'default'`. Insert the new fallback at `main.ts:78–97` resolution block. `?config=` and mission deep-link continue to work unchanged.
- **Mid-session swap policy:** `Aircraft`/`FlightModel`/`world` are constructed once at boot. When the player changes the picker on the mission-select screen and launches a mission, if the picked airframe differs from `resolvedConfigName`, **persist + `location.reload()`** — boot re-reads localStorage and rebuilds with the new airframe. No `Aircraft.replaceConfig()` work (out-of-scope per WP14.20 Phase B).
- **Per-mission override label:** mission JSONs already have a `config?` field. Eager-fetch the 4 manifest missions at boot (cheap, parallel) to build a `Map<missionId, configName | undefined>`. Tile button text becomes `"<missionName>"` or `"<missionName> [<airframeName>]"` for pinned. Already-tested mission parsing path (`parseMission`); just adding a manifest-side eager fetch.

## Work Tree

- [x] Phase 1: Airframe options + localStorage round-trip (pure data)
  **Observable outcomes:**
  - CLI: `npm run test` passes (new Vitest in `src/mission/aircraft-options.test.ts` covers: known-airframe list returns `{id:'default'|'mig15', className, airframeName}` records; `getSelectedAirframe()` returns `'default'` on empty/missing/invalid localStorage; `setSelectedAirframe('mig15')` round-trips; invalid id values rejected and fall back to `'default'`)
  - CLI: `npx tsc --noEmit` exits 0
  - Browser: window console no errors with `localStorage.setItem('flightsim.aircraft.selected', 'mig15')` then reload — no boot regression (existing Cessna-default behavior is unchanged because main.ts has NOT been wired yet in this phase; this only tests the pure module)
  - [x] P1.1 Create `src/mission/aircraft-options.ts` exporting: `AIRCRAFT_OPTIONS` (array of `{id, className, airframeName}`), `getSelectedAirframe(): AirframeId`, `setSelectedAirframe(id: AirframeId): void`, with localStorage key constant + `AIRFRAME_STORAGE_KEY`. Validate against the static set + `CONFIG_NAME_REGEX`. Also exported `resolveAirframeName()` (used by Phase 2; co-located here for cohesion).
  - [x] P1.2 Add Vitest `src/mission/aircraft-options.test.ts`: round-trip, default fallback for empty/null/invalid/throwing-storage, regex rejection, resolveAirframeName precedence. 21 tests, all green.
  - [x] verify-auto — tsc clean; scoped Vitest 21/21 green
  - [x] verify-self — no integration boundary (isolated new module); subagent confirmed no boot regression with localStorage='mig15' set; 0 console errors post-reload; mission-select visible
  - [x] verify-human — skipped per Mode 4 (full-autopilot)
  - [x] verify-codify — codified inline with impl (P1.2 wrote 21 Vitest cases mapping 1:1 to verify-self outcomes); full suite 814/814 green

- [x] Phase 2: Boot-time wiring — localStorage as fallback in resolution precedence

  **Relevance check (before Phase 2):**
  - Requester still needs this: yes — WP24 still in scope; jet still deep-link-only without this.
  - Requirements unchanged: yes — Phase 1 was pure data; no learnings that shift spec.
  - Solution still feasible: yes — `resolveAirframeName` is unit-tested; main.ts insertion is small.
  - No superior alternative discovered: yes.
  - **Verdict:** proceed.
  **Observable outcomes:**
  - Browser: with `localStorage['flightsim.aircraft.selected'] = 'mig15'` set, open `/?debug=true&mission=free-flight` (Free Flight has no per-mission `config?`) — `window.__aircraft.getState()` shows the MiG-15 airframe was loaded (verify via debug accessor: aircraft config thrust value distinguishes Cessna ~27000 from MiG-15 ~85000, OR via `window.__aircraftConfig?.id` debug export — to be added under `?debug=true`)
  - Browser: with `?config=mig15` AND `localStorage = 'default'`, MiG-15 wins (URL > localStorage precedence preserved)
  - Browser: with `?mission=combat` AND `localStorage = 'default'`, MiG-15 wins (preloaded-mission `config?` > localStorage)
  - CLI: `npm run test` passes; `npx tsc --noEmit` exits 0
  - [x] P2.1 Wired `resolveAirframeName()` into `main.ts:69–112`. Precedence: URL `?config=` > preloaded-mission `config?` > localStorage > default. Surfaces `window.__aircraftConfig = {name, source}` under `?debug=true`.
  - [x] P2.2 `resolveAirframeName` extracted into `aircraft-options.ts` at P1.1 and unit-tested with 8 precedence cases at P1.2 — Phase 2 needed no additional Vitest.
  - [x] verify-auto — tsc clean; Vite dev bundle serves and contains resolveAirframeName references
  - [x] verify-self — all 4 precedence outcomes PASS via subagent: storage>default, url>storage, mission>storage, clean-default; window.__aircraftConfig shape correct under ?debug=true; 0 config-related console errors
  - [x] verify-human — skipped per Mode 4 (full-autopilot)
  - [x] verify-codify — Phase 1's 8 unit tests on resolveAirframeName cover pure logic; Phase 3's consolidated picker-driven e2e will cover the main.ts wiring integration boundary (deferred to avoid duplicate e2e fixture). Full Vitest 814/814 green.

- [x] Phase 3: Mission-select picker UI + reload-after-change

  **Relevance check (before Phase 3):**
  - Requester still needs this: yes — picker is the only player-facing surface.
  - Requirements unchanged: yes — Phase 2 verify-self confirmed precedence.
  - Solution still feasible: yes — select.ts already extensible; mission JSONs already have `config?`.
  - No superior alternative discovered: yes.
  - **Verdict:** proceed.
  **Observable outcomes:**
  - Browser: `/` shows the mission-select screen with a new airframe picker above the mission button list. Picker has 2 segmented buttons: "Trainer (Cessna)" + "Jet (MiG-15)". Cessna selected by default; clicking Jet visually selects it (highlighted border/background) and persists to localStorage.
  - Browser: mission tiles show `[MiG-15]` suffix on Combat (pinned-config); other 3 tiles render unchanged.
  - Browser: with picker = Jet, click Free Flight → page reloads → mission starts with the MiG-15 airframe loaded (verifiable via `window.__aircraftConfig.name === 'mig15'`).
  - Browser: with picker = Cessna (default), no reload occurs when clicking a mission (same-airframe path); mission starts inline.
  - Browser: Playwright snapshot of mission-select has `[data-testid=aircraft-picker]` with 2 buttons; `[data-testid=mission-select]` unchanged for the mission list.
  - CLI: `npm run test:e2e -- --grep "aircraft"` includes the new test and passes.
  - [x] P3.1 Extended `MissionSelectScreen.show()` with `_buildAircraftPicker()` rendering the picker block above the mission list. CSS injected for `.aircraft-picker` + buttons + selected state. data-testid=`aircraft-picker`, per-button `data-airframe-id`.
  - [x] P3.2 Picker click handler wired to `setSelectedAirframe(id)` + inline highlight update via aria-pressed + class toggle.
  - [x] P3.3 Mission-tile label via `formatMissionButtonText()` — appends ` [<airframeName>]` from `pinnedConfigs` map; `ShowOpts.pinnedConfigs?` added; back-compat preserved (default empty map).
  - [x] P3.4 `main.ts` onSelect: computes `effectiveNext` (missionPinned ?? picker); on mismatch with `resolvedConfigName`, `window.location.assign('?mission=<id>')` so deep-link auto-start handles post-reload mission launch.
  - [x] P3.5 Eager-fetched all manifest missions in parallel after `loadMissionList()`; built `pinnedConfigs: Map<string, string>`; passed to all 4 `missionSelect.show(...)` call sites.
  - [x] verify-auto — tsc clean; scoped Vitest select.test.ts 17/17; Playwright e2e file lists 6 tests cleanly
  - [x] verify-self — all 5 outcomes PASS via subagent: picker renders DOM-before-list with correct labels + aria-pressed; Combat tile shows `[MiG-15]` pinned suffix; click persists + highlights; pick-Jet→Free-Flight reload yields {name:'mig15', source:'storage'}; pick-default inline-launches with no reload, {name:null, source:'default'}; 0 console errors across all 5 scenarios
  - [x] verify-human — skipped per Mode 4 (full-autopilot)
  - [x] verify-codify — 9 new Vitest cases in select.test.ts + 6 new Playwright e2e in aircraft-picker.spec.ts (integration-boundary coverage); 1 e2e bug caught and fixed at codify (init-script clearing localStorage across reload; replaced with default per-test fresh context). Full Vitest 823/823 + e2e 53/53 green.

## Current Node
- **Path:** Feature > ship
- **Active scope:** All 3 phases complete. Vitest 823/823 + e2e 53/53 + tsc clean. Ready for ship.
- **Blocked:** none
- **Unvisited:** Phase 1 verify-self / verify-human / verify-codify; Phase 2 (boot-time wiring); Phase 3 (picker UI + reload-after-change).
- **Open discoveries:** none

## Discoveries

<!-- Format: [SURFACED-<date>] <target node> — <summary> -->

## Test Triage — aircraft-picker.spec.ts "pick MiG-15 → launch Free Flight → boot reloads with mig15"
Classification: Test bug (newly-written test has wrong setup) — `context.addInitScript()` re-runs on EVERY page navigation including the post-click reload, which wipes `localStorage['flightsim.aircraft.selected']` between the picker click and the boot read, causing the reload to boot with default Cessna instead of MiG-15.
Confidence: high — Playwright docs confirm addInitScript fires on every page load (including reload); the verify-self subagent's manual repro of the SAME scenario PASSed because it used page.evaluate() (one-shot, not init-script).
Evidence: tests/e2e/aircraft-picker.spec.ts:18-27 — beforeEach uses `context.addInitScript(removeItem)`.
Action: Replace with a one-shot `await page.evaluate(() => localStorage.removeItem(...))` after the first navigate, OR use `await context.clearCookies()` / a per-test isolated context. Going with: drop the init-script approach; do `await page.goto('/'); await page.evaluate(...)` at the start of each test (or omit if test doesn't depend on starting-clean state, since Playwright runs each test in a fresh browser context by default — so localStorage is naturally empty).

---

## Notes for verify-* (plan-time guidance)

- **verify-self:** Use Playwright MCP against `npm run dev`. Each phase has a concrete browser observable; Phase 2 + Phase 3 require interacting with localStorage either via `page.evaluate(() => localStorage.setItem(...))` or via clicking the picker.
- **verify-human:** Phase 3 only (Phases 1 + 2 are non-visible to end users). Operator picks Jet, launches Free Flight, confirms the jet flies. Picks Cessna, launches Combat, confirms tile shows `[MiG-15]` and the mission still uses MiG-15 (pinned-config override). Picks back to Cessna, launches Free Flight, confirms Cessna flies.
- **verify-codify:** Phase 3 codifies the e2e (`tests/e2e/aircraft-picker.spec.ts`): pick MiG-15 → Free Flight → assert via `window.__aircraftConfig.name === 'mig15'`. Phase 1 codified inline via Vitest. Phase 2 codified via Vitest on `resolveAirframeName` + Playwright (in Phase 3 e2e).

## Roadmap.md update (at finalize)

Per Q1 resolution: `docs/product/roadmap.md:62` "Multiple aircraft selection (v1 ships with one aircraft)" — strike from out-of-scope list; replace with v1 line item if needed. `feature-finalize` handles this.

---

## Retrospect

- **What changed in our understanding:** Nothing fundamental — the spec's 5 proposed Q-resolutions all stood through implementation. The only surprise was a self-inflicted test bug at codify (Playwright `context.addInitScript()` re-firing on EVERY navigation, including reloads, which wiped the just-persisted localStorage pick between picker click and post-reload boot read). Caught on first full e2e run and fixed cheaply (~5 min) by dropping the init-script in favor of Playwright's default per-test fresh context.
- **Assumptions that held:** (a) `resolveAirframeName` is extractable as pure logic and unit-testable in isolation — verified by 8 precedence cases in Phase 1. (b) `MissionSelectScreen.show()` is the right extension point — picker block injected cleanly above the mission list with no signature break (back-compat preserved via optional `pinnedConfigs?` in `ShowOpts`). (c) Boot-time binding via localStorage + `window.location.assign(?mission=<id>)` reload works in practice, not just in theory (verify-self confirmed). (d) Eager-fetch of all 4 manifest missions for the `pinnedConfigs` map is cheap (no observable boot-time hit). (e) Mode 4 full-autopilot skipping verify-human worked correctly through 3 phases — no human-only signal was needed.
- **Assumptions that were wrong:** Only one — that `context.addInitScript()` could be used as a clean per-test localStorage clear. Documented in the Test Triage section; the lesson is that Playwright's default isolation is already sufficient for localStorage between tests, so the init-script was redundant AND harmful.
- **Approach delta:** Tracked the plan closely. Only deviation: P2.2 was satisfied by Phase 1's existing 8 unit tests (resolveAirframeName precedence) rather than writing new Phase-2-specific Vitest. Phase 3's e2e (`tests/e2e/aircraft-picker.spec.ts`) consolidated the integration-boundary verification that the plan had open between Phase 2 and Phase 3. Net: 30 lines fewer than the original plan estimate, 3 phases ran tip-to-tip in one orchestrator session with no back-loops.
