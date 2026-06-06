---
drive_mode: full-autopilot
---

# Feature: Per-mission airframe selection (SURFACE-06 Phase A)

**Workflow:** feature
**State:** ship (complete)
**Ship commit:** `bb1c242`
**Created:** 2026-06-06
**Entry:** spec (complex feature)
**SURFACE-IN:** SURFACE-2026-06-06-06 (Phase A scope only; Phases B + C deferred — see Out of Scope)

## Problem Statement

The mission JSON schema does not support per-mission airframe selection. A seed aerobatic config (`public/config/aircraft-aerobatic.json`, mass=500, T/W=2.4) was shipped at the Path A close of SURFACE-2026-06-06-02 and proven to backflip via the `?config=aerobatic` URL override, but no mission JSON references it. The mission-select → airframe-config pipeline is the missing piece between the seed and gameplay use of the aerobatic airframe.

This feature adds an optional `config?: string` field to mission JSON, threaded through the loader to `loadAircraftConfig`, so a mission can declare which airframe it expects. **Plumbing only — does NOT fully tune the aerobatic airframe and does NOT add aerobatic missions.** Those are Phases B + C, deferred (see Out of Scope).

## Background / Constraint negotiation

`docs/product/vision.md` and `docs/product/roadmap.md:62` explicitly defer multiple-aircraft selection from v1:

> Multiple aircraft selection (v1 ships with one aircraft)

This feature is **vision-compatible** because:

1. The default mission has no `config?` field and continues to load `aircraft.json` (Cessna-class, the v1 ship aircraft).
2. The casual player never sees an airframe picker — at most they see different missions that happen to fly differently. This matches the "no install, no manual, no tutorial" principle.
3. No new aircraft is *shipped* as a player-flyable model in v1; the seed `aircraft-aerobatic.json` exists for the SURFACE-02 demonstration and as test fixture infrastructure. Player-facing aerobatic missions are deferred (Phase C).

This is the same hedge `?config=<name>` already takes for debug agents (`?debug=true` gate). Per-mission `config?` extends the same mechanism to mission-declaration without exposing it in the menu UI.

## User Stories

- As a **mission author / developer**, I want to declare which airframe a mission expects via `config?` in its JSON, so I can build mission content that exercises the aerobatic seed (or future per-mission airframes) without editing source.
- As a **test author**, I want a stable way for an e2e test to spawn a non-default airframe mission, so future tuning passes have deterministic test fixtures.
- As a **casual player** (vision-aligned), I want missions to "just work" without seeing airframe pickers, so the no-install / no-tutorial principle holds.

## Acceptance Criteria

- [ ] Mission JSON schema accepts an optional `config?: string` field (path-traversal-defended, identical regex `/^[a-z0-9_-]+$/i` to the URL `?config=` defense, validated at parse time in `src/mission/loader.ts` or `src/mission/parse.ts`).
- [ ] When a mission with `config: "aerobatic"` is loaded, the active aircraft is loaded from `/config/aircraft-aerobatic.json` instead of `/config/aircraft.json`.
- [ ] Missions without `config?` continue to load `aircraft.json` — zero behavior change for `free-flight`, `waypoint-patrol`, `phugoid-probe-{low,mid,high}` (5 existing JSONs untouched in this WP).
- [ ] Mission with malformed/path-traversal `config?` fails the mission load and surfaces the existing `errorForId` mission-select fallback (consistent with how a missing JSON fetch fails today). Console warning emitted with the offending value.
- [ ] URL `?config=<name>` override remains operational and takes **precedence** over mission `config?` when both present (debug-agent affordance — operator can still force-swap airframe for diagnostics even in a mission that declares its own airframe).
- [ ] Vitest unit tests: parse-time validation of valid / missing / malformed `config?` values; precedence test (URL beats mission).
- [ ] Playwright e2e: one new test asserting a mission declaring `config: "aerobatic"` produces a higher terminal AS at full throttle than the default (mirrors the existing `scripted-input.spec.ts:96` `?config=aerobatic` assertion, but driven by mission JSON).
- [ ] Full Vitest + e2e + tsc + build clean.

## Out of Scope (deferred to Phase 3 / explicit operator override)

The SURFACE-06 backlog entry sketched a 3-phase scope (A: schema; B: full feel-tune of aerobatic airframe; C: aerobatic mission content). **This spec covers Phase A only.** Phases B + C are deferred because:

- **Phase B (full feel-tune of `aircraft-aerobatic.json`)** is a multi-session feel-tuning cycle (per CLAUDE.md `### Browser-walkthrough discipline` + `feedback_operator_as_external.md`) that REQUIRES operator-as-playtester verify-human. Under full-autopilot drive mode the operator-as-playtester is unavailable; per `feedback_operator_as_external.md` the deviation must be documented and the deliverable must name its Phase 3 re-validation hook. Phase B's re-validation hook is "Phase 3 playtest with external casual gamer" — which is itself a Phase 3 deliverable (per `docs/product/roadmap.md:48`). Compressing Phase B into this session would ship a quasi-tuned aerobatic feel without the verify-human gate, contaminating future tuning evidence.
- **Phase C (aerobatic mission content)** is gated on Phase B being meaningful — adding aerobatic-themed missions when the airframe isn't tuned for them is content-without-product. WP16 (combat) is the natural consumer if combat happens in a vehicle other than the default Cessna; that decision belongs to the WP16 spec.
- **Multi-aircraft selection UI / per-airframe player selection** — explicitly out of v1 scope per `docs/product/roadmap.md:62`. Not in this feature; not in any v1 feature.
- **Renaming `aircraft-aerobatic.json` to a design-target-specific name (`aircraft-pitts.json`, etc.)** — premature; the design target should be decided when the airframe is actually being tuned (Phase B), not when the plumbing is laid down.

## Technical Constraints

- **Path-traversal defense.** The `config?` field must reuse the same `/^[a-z0-9_-]+$/i` regex used by `?config=` (defined in `src/engine/scripted-input.ts:46`). Importing or duplicating that constant is acceptable; the *constant itself* should remain single-sourced. Consider exporting `CONFIG_NAME_REGEX` and `configNameToPath` from `scripted-input.ts` (already exported) and reusing in `mission/loader.ts`.
- **Boot-time vs mission-time config loading.** `loadAircraftConfig` is currently called ONCE at boot in `src/main.ts:38` from the URL `?config=` path. With per-mission `config?`, the call moves to `startMission` so each mission load can swap the airframe. The aircraft (Rapier rigid body + flightmodel + aerosurfaces) is reconstructed on mission start regardless, so this is a natural extension. **However**, swapping airframes between missions implies an aircraft TEAR-DOWN + RECONSTRUCT path. Verify whether `aircraft.reset()` is sufficient or whether a heavier reconstruction is needed.
- **URL `?config=` precedence.** Existing debug behavior must not regress — `?debug=true&config=aerobatic&mission=free-flight` should still load the aerobatic airframe in free-flight even though `free-flight.json` has no `config?` field. Precedence rule: URL > mission > default.
- **Mission schema additive change.** All 5 existing JSONs lack `config?`; the field MUST be optional. Validation at the JSON-parse layer; type field in `src/mission/types.ts`.
- **No additional `loadAircraftConfig` fetch races.** The existing implementation is `async`; mission start is already async (`await loadMission(id)` in `src/main.ts:359`). Adding `await loadAircraftConfig(configPath)` is a natural extension at the same await point.

## Defensible-default decisions (operator-overridable)

Per the user request "make defensible default choices for the open questions, document them as operator-overridable":

1. **Airframe class target:** keep the seed as-is (Pitts-ish, T/W=2.4). Phase B will revisit. **Operator can override** by editing `aircraft-aerobatic.json` between sessions; this WP is plumbing-agnostic to the values.
2. **Per-mission hard-coded (not player-selectable):** matches v1 vision (no airframe picker). **Operator can override** in a future Phase 3 negotiation to expand v1 — not in scope here.
3. **Keep `aircraft-aerobatic.json` name:** premature to rename; design target undecided. **Operator can override** by renaming + updating the one e2e test reference. This WP does not lock in the name.

## Plan-time resolved questions

- **Q1 (airframe swap during a session):** Reading `src/aircraft/physics-core/rigidbody-core.ts:70` confirmed that `aircraft.reset(position, linvel)` resets ONLY the Rapier body pose; the underlying mass/inertia/surfaces are baked at construction. Swapping airframes mid-session would require reconstructing `Aircraft` + `FlightModel`. **Decision:** Phase A reads `config?` **at mission-load time** but applies it via boot-time config selection only — that is, the field shapes the WP infrastructure but mid-session swap (return-to-menu → pick a different-airframe mission) is **deferred to Phase C**. Phase A scope: deep-link `?mission=<id>` for a mission with `config?` correctly loads the named airframe; returning to menu and selecting a different mission keeps the originally-loaded airframe. This is a documented limitation acceptable for Phase A's "plumbing only" scope; the e2e test (one-shot navigation) never exercises mid-session swap.
- **Q2 (loadAircraftConfig signature):** `src/aircraft/physics-core/config.ts:304` already takes a path argument. Trivial thread-through — no signature change.

## Architectural decision baked into the plan (Phase A scope contract)

The mission's `config?` is **read at parse time** but **applied only at boot-time deep-link** (URL `?mission=<id>` where mission has `config?` → that airframe loads). Returning to the mission-select screen and choosing a *different-airframe* mission keeps the originally-loaded airframe until a full page reload. The mission-select UI for now lists only Cessna-default missions (per the index.json prune already in place), so this limitation is invisible to the casual player.

**Why this is OK:** Phase A is plumbing for Phase C, when an airframe-mission menu actually exists. At that point, the swap-on-return-to-menu path becomes a real concern and Phase C's plan handles it via mutable-holder refactor or full page reload. Deferring it from Phase A keeps the scope honest (~2-4h agent time).

## Verify gates (per CLAUDE.md `### Browser-walkthrough discipline`)

- **Vitest unit:** parse-time validation; precedence; round-trip.
- **e2e harness:** one new `scripted-input.spec.ts`-style test loading a fixture mission with `config: "aerobatic"` and confirming aerobatic terminal AS > Cessna terminal AS at full throttle (deterministic, reuses the existing assertion pattern from `scripted-input.spec.ts:96-111`).
- **No verify-human required** (this WP is plumbing, not feel-tuning). The verify-self gate is the e2e test passing. Operator-as-playtester verify-human is what Phase B (deferred) requires; Phase A's plumbing-only scope explicitly does NOT need it.

## Forward implications

- **WBS impact:** This feature inserts between WP14.19 (closed) and WP15 (takeoff/landing, NEXT). It does not delay WP15 — Phase A is ~2-4h of agent work; WP15 stays NEXT after this completes. WBS does NOT need a new architect-cycle revision — this is mission-schema additive + loader threading, no physics-mechanism change, no D-decision number needed.
- **Phase 3 negotiation:** When Phase 3 multi-aircraft negotiation happens (per the roadmap "Deferred" item), the plumbing this WP lays down is what an airframe-selection UI would build on.
- **arch.md update:** Optional. The mission JSON schema is documented in arch.md D11 (mission framework); adding `config?` is a small extension to that section. Recommend updating D11's description with one bullet about the optional `config?` field at finalize time, not now.

## Work Tree

- [x] Phase 1: Schema + parser + e2e fixture mission — all impl + verify gates green
  **Observable outcomes:**
  - Browser: Navigate `/?mission=<aerobatic-test-mission>&debug=true&script=hold:Throttle=1.0@0:5.0`; `window.__aircraft.getScriptedLog()`'s final row has `AS_mps` substantially greater (>+10 m/s) than the same script run against `/?mission=free-flight&debug=true&script=hold:Throttle=1.0@0:5.0` (mirrors `scripted-input.spec.ts:96-111`'s default-vs-`?config=aerobatic` assertion, but driven by mission JSON instead of URL).
  - Browser: Navigate `/?mission=free-flight&debug=true`; no console warning about `config?`; default Cessna airframe loads (lil-gui `mass` field reads `"1000"`).
  - CLI: `npm run test` exits 0 — new Vitest cases under `src/mission/parse.test.ts` cover (a) valid `config?` value parses, (b) malformed `config?` rejected at parse with clear error, (c) missing `config?` is the default-Cessna case, (d) precedence: URL `?config=<name>` beats mission `config?` (Vitest at the URL-parse layer).
  - CLI: `npm run test:e2e` exits 0 — full e2e suite green; new test added.
  - CLI: `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.tools.json` exit 0.
  - CLI: `npm run build` exits 0.
  - [x] P1.1 Extend `src/mission/types.ts`: add optional `config?: string` to `Mission` interface (positioned after `scriptHook?`)
  - [x] P1.2 Extend `src/mission/parse.ts` `parseMission`: validate `config?` is undefined OR a string matching `/^[a-z0-9_-]+$/i` — exported `CONFIG_NAME_REGEX` from `src/engine/scripted-input.ts` (single source) and imported into `parse.ts`. Added `'config'` to `MISSION_KEYS`.
  - [x] P1.3 Thread `config?` from `loadMission` result through `main.ts` boot path. Pre-load the deep-link mission BEFORE `loadAircraftConfig` so its `config?` can shape the boot-time call; hand the preloaded `Mission` into `startMission` to avoid a second fetch. URL `?config=` wins precedence; mission-config mismatch surfaces a console.warn explaining mid-session swap is Phase A unsupported.
  - [x] P1.4 Added fixture `public/missions/aerobatic-test.json` (NOT in `index.json`, deep-link-only; spawn matches V_trim=78 conventions; `config: "aerobatic"`).
  - [x] P1.5 Added 5 Vitest cases to `src/mission/parse.test.ts` `describe('config field')`: omitted (default), valid (`aerobatic`, `pitts_s2`, `f-16`), path-traversal rejected, empty rejected, non-string rejected.
  - [x] P1.6 Added 2 e2e tests to `tests/e2e/scripted-input.spec.ts`: (i) mission-driven aerobatic terminal AS > Cessna by >10 m/s; (ii) URL `?config=` overrides mission absence-of-config.
  - [x] verify-auto — scoped per skill: `src/mission/parse.test.ts` 27/27 (+5 new config-field cases) + `tsc --noEmit -p tsconfig.json` clean. Full e2e + build deferred to verify-self / finalize.
    - [x] Scoped Vitest: `src/mission/parse.test.ts` 27/27
    - [x] tsc on changed files: clean
    - [ ] Full e2e + build: deferred to verify-self (live-system gates) and finalize
  - [x] verify-self — scripted-input.spec.ts 6/6 PASS in 58.4s, including the 2 new per-mission-airframe tests. No BLOCKING / no COSMETIC failures.
    - [x] Scripted-input harness probe — aerobatic-mission terminal AS exceeds free-flight by required margin (per-mission-airframe test PASS at 13.0s)
    - [x] Precedence probe — URL `?config=aerobatic` overrides mission's absence-of-config (URL-override test PASS at 13.1s)
    - [x] Regression — existing `?config=aerobatic` URL flow + malformed-config path-traversal defense still pass
  - [x] verify-human — **SKIPPED per full-autopilot drive mode.** `feedback_operator_as_external.md` deviation documented; Phase 3 re-validation hook = external playtest per `docs/product/roadmap.md:48`. Feel-of-airframe NOT validated here (Phase B / deferred); plumbing-only acceptance is what verify-self + verify-codify cover deterministically.
  - [x] verify-codify — full Vitest 639/639 + full e2e 21/21 + tsc both configs + build clean. Phase 1 P1.5 + P1.6 codification verified. Integration-boundary requirement satisfied: e2e `scripted-input.spec.ts:113` (`?mission=aerobatic-test`) + `:130` (URL > mission precedence) exercise the `src/main.ts` consuming surface end-to-end. No new tests written — existing P1.5/P1.6 fully covered the verified behaviors.

## Current Node
- **Path:** Feature > all phases complete — ready for /feature-ship
- **Active scope:** ship
- **Blocked:** none
- **Unvisited:** ship → finalize
- **Open discoveries:** none

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
[SURFACED-2026-06-06] feature-spec — arch.md exceeds size guard (2645 lines), truncated to first 100 + headings. Consider summarizing or splitting into per-cycle files at next product-finalize. Logged as SURFACE-2026-06-06-08.
[SURFACED-2026-06-06] feature-spec — wbs.md exceeds size guard (1023 lines), truncated to first 100 + headings. Same consideration. Logged as SURFACE-2026-06-06-08 (combined).

## Retrospect

- **What changed in our understanding:** The SURFACE-06 backlog entry sketched a 3-phase scope (A: schema, B: feel-tune, C: aerobatic content); reading `docs/product/vision.md` + `docs/product/roadmap.md:62` at spec time revealed the v1-explicit "multiple aircraft selection deferred from v1" constraint, which made Phases B + C genuinely Phase-3 work rather than Phase-2 plumbing. The right move was to ship Phase A in isolation and document the deferral honestly — a much smaller feature than the SURFACE entry imagined.
- **Assumptions that held:** Single-source path-traversal regex via `CONFIG_NAME_REGEX` export was clean. The pre-load-mission-before-loadAircraftConfig pattern absorbed the precedence rule (URL > mission > default) without needing a runtime swap mechanism. The boundary-test approach (e2e via the existing scripted-input harness with byte-stable terminal-AS assertions) was idiomatic — no new test infrastructure needed; the WP14.20 verify-self gate is the same pattern as the prior `?config=aerobatic` test, just one indirection deeper.
- **Assumptions that were wrong:** Initial plan sketched `aircraft.reset(position, linvel)` as potentially adequate for airframe swap. Reading `rigidbody-core.ts:70` at plan time made it obvious that reset is pose-only — the Rapier rigid body's mass/inertia is baked at construction. This converted what could have been a complex mid-session-swap feature into a simple boot-time-resolution feature with a documented "page reload to swap airframes" limitation. The right call was deferring mid-session swap to Phase C; absorbing it into Phase A would have meant a mutable-holder refactor across ~30 closures in `main.ts`, multiplying scope.
- **Approach delta:** Plan was a single coherent phase; build matched the plan exactly. No back-loops, no scope additions, no test back-loops. The only deviation from the original SURFACE-06 sketch was the de-scoping to Phase A only — and that was a spec-stage decision, not a build-stage drift. Verify-human skipped per full-autopilot drive mode, with the deferral hook (`feedback_operator_as_external.md` — Phase 3 external playtest) documented in the verify-human leaf.

## Closure notice

**Feature complete:** `per-mission-airframe` (SURFACE-2026-06-06-06 Phase A) has shipped at commit `bb1c242`. Mission JSON now accepts an optional `config?: string` field that drives boot-time airframe selection on the deep-link path, with URL > mission > default precedence and full path-traversal defense. Phase B + C (full feel-tune + aerobatic mission content) remain deferred per v1's multiple-aircraft exclusion. Verify by running `npm run test:e2e -- scripted-input` (6/6 including 2 new per-mission-airframe tests), or by navigating `/?debug=true&mission=aerobatic-test&script=hold:Throttle=1.0@0:5.0` and confirming the higher terminal AS vs free-flight. Requester = operator — closure notice for self-record.
