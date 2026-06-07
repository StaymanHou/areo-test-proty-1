---
workflow: feature
state: plan (complete)
created: 2026-06-07
wbs_ref: WP19
size: S
drive_mode: full-autopilot
---

# Feature: WP19 — Audio

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-06-07

## Problem Statement

v1 ships in silence. The vision is "casual gamer, 30 seconds to flying" — and silent flight feels broken to a casual audience even when the physics is plausible. WP19 adds the minimum audio surface to make the simulator feel alive: an engine loop that responds to throttle, wind that responds to airspeed, weapon fire + impact for combat, and a crash SFX for failed missions. All audio is synthesized from oscillators + filtered noise (no external assets in the bundle, no asset-licensing rabbit hole for v1); WP20 visual polish can later swap in recorded samples behind the same interface. Safari Web Audio latency / autoplay-restriction quirks (research R4) are addressed by resuming the AudioContext on the first user gesture (the mission-select click, already the boot flow's first interaction).

## Work Tree

- [x] Phase 1: Audio engine + continuous SFX (engine loop + wind)  <!-- 2026-06-07: closed; all 5 impl + 4 verify leaves complete -->
  **Observable outcomes:**
  - Browser: With `?debug=true`, opening `http://localhost:5173/`, clicking a mission card, and waiting 1s — `window.__audio.getState()` returns `{contextState: 'running', engineFreqHz: number > 0, engineGain: number ≥ 0, windGain: number ≥ 0}` with all fields finite.
  - Browser: After clicking free-flight and holding `ShiftLeft` (throttleUp) for 2s via scripted-input, `window.__audio.getState().engineFreqHz` is strictly greater than the value sampled at t=0 (throttle-responsive frequency).
  - Browser: After clicking free-flight and waiting 3s (airspeed climbs from V_trim toward steady cruise), `window.__audio.getState().windGain` is finite and `> 0` (airspeed-responsive noise gain).
  - Console: No JS errors, no unhandled-promise rejections, no `[AudioContext]` warnings from Three.js/Rapier interop.
  - CLI: `npm run test -- src/audio` exits 0 with new Vitest cases covering: AudioEngine construction, engine-loop frequency mapping (throttle 0 → idle Hz, throttle 1 → max Hz, monotonic), wind-noise gain mapping (airspeed 0 → 0, V_trim → mid, high-AS → max, monotonic), master gain clamping, resume()-on-gesture lifecycle.
  - CLI: `npx tsc --noEmit` clean. `npm run build` clean (audio module bundles cleanly into the existing Vite output).
  - [x] P1.1 Create `src/audio/audio-engine.ts` — `AudioEngine` class wrapping `AudioContext` + a master `GainNode`. Lazy-creates the context (deferred until first `resume()` call so SSR / test envs don't blow up). Public API: `start()`, `setMasterGain(v)`, `setEngineThrottle(t)`, `setWindAirspeed(as)`, `triggerFire()`/`triggerImpact()`/`triggerCrash()` (Phase 2 stubs in Phase 1), `getState()` for the debug accessor, `_resetForTests()`.
  - [x] P1.2 Create `src/audio/engine-loop.ts` — `EngineLoop` class wrapping an `OscillatorNode` (sawtooth, 90–340 Hz mapped from throttle 0→1) + a per-engine `GainNode` (0 at throttle=0, 0.2 at throttle=1). Throttle is applied on every `setThrottle(t)` call; values smoothed via `linearRampToValueAtTime` over 50ms to avoid clicks.
  - [x] P1.3 Create `src/audio/wind.ts` — `Wind` class wrapping a `BufferSource` (looped 1s pink-noise buffer, generated once at construction) + a `BiquadFilterNode` (lowpass, cutoff scaled by airspeed) + a `GainNode` (0 at AS<10, ramps to 0.15 at AS≥150). `setAirspeed(as)` updates filter cutoff + gain with 100ms ramp.
  - [x] P1.4 Create `src/audio/audio-engine.test.ts` — 13 Vitest cases (construction, start lifecycle, idempotency, throttle endpoints + monotonic + clamp, airspeed endpoints + monotonic + below-MIN_AS silent, masterGain clamp, pre-start no-op, reset, Phase 2 stub no-op). 13/13 GREEN.
  - [x] P1.5 Wire `AudioEngine` into `src/main.ts`: instantiated post-KeyHintsOverlay; `onPhysics` calls `setEngineThrottle` + `setWindAirspeed(aircraft.readBodyState().linvel.length())` each tick; `missionSelect.onSelect` + deep-link path both call `audioEngine.start()` (Safari autoplay unlock); `window.__audio = { getState: () => audioEngine.getState() }` exposed under `?debug=true`.
  - [x] verify-auto  <!-- 2026-06-07: src/audio Vitest 13/13 GREEN; tsc clean -->
  - [x] verify-self  <!-- 2026-06-07: 6/6 outcomes PASS. Click path: contextState=running, engineFreqHz=90 (idle, throttle=0), windGain=0.043 at AS≈50. Deep-link+hold:ShiftLeft: engineFreqHz=339 Hz (near 340 cap), windGain=0.063 at AS≈70. Console clean (only pre-existing favicon 404 + benign Vite HMR deprecation). Vitest 13/13, tsc 0, build 0. -->
  - [x] verify-human  <!-- 2026-06-07: SKIPPED per full-autopilot drive mode -->
  - [x] verify-codify  <!-- 2026-06-07: tests/e2e/audio.spec.ts created (3 cases pinning the main.ts integration boundary — click-path resume + scripted-throttle freq response + production no-debug-accessor). Full suites GREEN: Vitest 721/721, Playwright e2e 45/45. Triage entry for the one-shot warning-filter widening recorded above. -->

- [x] Phase 2: One-shot SFX (fire/impact/crash) + Safari resume guard  <!-- 2026-06-07: closed; all 7 impl + 4 verify leaves complete -->
  **Observable outcomes:**
  - Browser: With `?debug=true&mission=combat`, fire one shot via scripted-input `hold:Space@1.0:1.05` — `window.__audio.getRecentOneShots()` contains an entry `{type: 'fire', t_sec: ≈1.0}` within 50ms of the gun cooldown's actual fire tick (validates the audio trigger fires when combat-ai's projectile spawns).
  - Browser: Same combat mission — when a fired projectile's AABB sweep registers a hit on the target (combat-ai's existing kill path), `window.__audio.getRecentOneShots()` contains an `{type: 'impact', t_sec: ...}` entry.
  - Browser: With `?debug=true&mission=free-flight`, dive into terrain (scripted-input `hold:ArrowDown@0:5.0,hold:Throttle=0@0:5.0` or equivalent → runner emits status='failed' via crash) — `window.__audio.getRecentOneShots()` contains an `{type: 'crash', t_sec: ...}` entry.
  - Browser: On first mission-select click (the first user gesture), `window.__audio.getState().contextState` transitions from `'suspended'` to `'running'` (Safari/iOS guard satisfied per R4).
  - Console: No `AudioContext was not allowed to start` warnings (the resume-on-gesture guard suppresses them).
  - CLI: `npm run test -- src/audio` covers all three one-shot triggers + the resume-on-gesture lifecycle. Vitest stable across 3 consecutive runs.
  - CLI: `npm run test:e2e -- audio.spec.ts` PASSes the production e2e gate: load `/?debug=true&mission=free-flight`, wait for `window.__audio` to exist, assert `getState().contextState === 'running'` after first click, assert no console errors.
  - [x] P2.1 Create `src/audio/sfx.ts` — three one-shot synthesizers: `playFire` (saw-osc + lowpass sweep, 200ms), `playImpact` (noise via BufferSource + bandpass filter, 150ms), `playCrash` (saw + noise lowpass-sweep envelope, 800ms). Noise buffer cached per AudioContext via WeakMap. AudioEngine.triggerFire/Impact/Crash delegate to these.
  - [x] P2.2 Extended AudioEngine with `_recordOneShot` + `getRecentOneShots` — 16-slot ring buffer; cleared on `_resetForTests`. `window.__audio.getRecentOneShots` exposes it under `?debug=true`.
  - [x] P2.3 Safari autoplay guard already in P1.5: `missionSelect.onSelect` calls `audioEngine.start()` before `startMission`; deep-link path also calls `start()`. Try/catch wraps the call so a reject does NOT block mission start.
  - [x] P2.4 Wired one-shot triggers:
    - **Fire:** new `onFireFn` callback in `src/mission/hooks/combat-ai.ts`, invoked at the end of `tryFireGun` after the projectile slot activates. Registered via 4th arg to `registerCombatAi`. main.ts binds to `audioEngine.triggerFire`.
    - **Impact:** new `onImpactFn` callback, invoked in `checkProjectileHits` on every hit (per-hit, not only killing hit). 5th arg to `registerCombatAi`. main.ts binds to `audioEngine.triggerImpact`.
    - **Crash:** main.ts `statusChange` listener calls `audioEngine.triggerCrash()` when `status === 'failed' && !wasAborted() && getFailReason() === 'crash'`. Fires before the abort-branch so aborts stay silent.
  - [x] P2.5 Added `MissionRunner.getFailReason()`: 'crash' | 'timeout' | 'out-of-bounds' | 'hook' | null. Set at fail-eval; cleared by `start()`. Aborts do NOT set a reason (returns null). 7 new Vitest cases in `src/mission/runner.test.ts`.
  - [x] P2.6 Created `src/audio/sfx.test.ts` — 7 Vitest cases covering node-graph shape (oscillator types, gain count, filter types) + start/stop ordering + noise buffer caching.
  - [x] P2.7 Extended `tests/e2e/audio.spec.ts` — added the combat-mission scripted Space-fire test asserting `getRecentOneShots()` records a `'fire'` entry. Now 4 audio e2e cases total.
  - [x] verify-auto  <!-- 2026-06-07: Vitest scoped (audio+runner+combat-ai) 118/118 GREEN; tsc clean -->
  - [x] verify-self  <!-- 2026-06-07: 4/5 PASS, 1 coverage-gap. Fire trigger: 3 'fire' entries at t≈0.94/1.15/1.37 from combat+Space@1.0:1.5 (cooldown=0.2s honored). Impact trigger: 3 'impact' entries at t≈1.67/1.87/3.94 alongside 13 fires from combat+Space@1.0:5.0 (projectiles reached target). Console clean. Crash trigger: live-unverified — orchestrator-side re-run with 3 dive recipes (KeyS+Throttle=0 / KeyS+Throttle=1 / combat mig15) all glide to terrain with vY≈0 below 2 m/s threshold. Wiring statically obvious + unit-tested at runner.test getFailReason='crash' + audio-engine.test triggerCrash. Filed SURFACE-2026-06-07-03 as Phase 3 (WP21/WP23) coverage-gap to resolve. NOT a blocker. -->
  - [x] verify-human  <!-- 2026-06-07: SKIPPED per full-autopilot drive mode -->
  - [x] verify-codify  <!-- 2026-06-07: Added impact-trigger e2e to tests/e2e/audio.spec.ts (combat + 4s Space-fire, polls ring buffer for impact entry; tolerant of mission-ends-early on target destruction). Full Vitest 741/741 GREEN; full Playwright e2e 47/47 GREEN. One test-triage entry recorded above (script-complete vs mission-won wait-strategy fix). Crash trigger codification deferred per SURFACE-2026-06-07-03 to Phase 3. -->

## Current Node
- **Path:** Feature > [all phases complete, ready to ship]
- **Active scope:** Phase 1 + Phase 2 CLOSED. All 9 impl + 8 verify leaves done. Ready for `/feature-ship`.
- **Blocked:** none
- **Unvisited (sequence-of-execution):** (none)

## Phase 2 build summary (2026-06-07)

**Files created (2):**
- `src/audio/sfx.ts` — `playFire` (200ms saw + lowpass sweep), `playImpact` (150ms noise + bandpass), `playCrash` (800ms saw + noise envelope). WeakMap-cached noise buffer per context.
- `src/audio/sfx.test.ts` — 7 Vitest cases on node-graph shape + caching.

**Files modified (5):**
- `src/audio/audio-engine.ts` — added 16-slot one-shot ring buffer; `triggerFire/Impact/Crash` delegate to sfx.ts (no-op before start). Exposes `getRecentOneShots()` (deep-copy).
- `src/audio/audio-engine.test.ts` — mock extended with `setValueAtTime` / `exponentialRampToValueAtTime` / filter `Q`; added Phase 2 describe block (6 new cases for trigger lifecycle + ring buffer wrap + reset).
- `src/mission/runner.ts` — added `FailReason` type, `_failReason` field, `getFailReason()` accessor; set at each `_status = 'failed'` site; cleared on `start()`. Aborts do NOT set a reason.
- `src/mission/runner.test.ts` — 7 new Vitest cases for `getFailReason`.
- `src/mission/hooks/combat-ai.ts` — new `onFireFn` / `onImpactFn` callbacks; `registerCombatAi` signature extended (back-compat — both default to no-op); `_resetCombatStateForTests` clears them. Invoked from `tryFireGun` + `checkProjectileHits`.
- `src/main.ts` — `registerCombatAi` 3rd/4th args bind to `audioEngine.triggerFire/triggerImpact`. `statusChange` handler triggers crash SFX on natural crash. `window.__audio.getRecentOneShots` exposed.
- `tests/e2e/audio.spec.ts` — added a 4th e2e: combat + scripted Space-fire asserts a 'fire' one-shot lands in the ring.

**Gates at Phase 2 impl close:**
- Vitest: **741/741** GREEN (was 721; +20: 7 sfx + 6 audio-engine Phase 2 + 7 runner getFailReason).
- `npx tsc --noEmit`: clean.
- `npm run build`: clean.
- Playwright audio.spec.ts: 4/4 GREEN.
- **Open discoveries:** none

## Phase 1 build summary (2026-06-07)

**Files created (4):**
- `src/audio/engine-loop.ts` — sawtooth OscillatorNode 90→340 Hz, gain 0→0.2, 50ms ramp.
- `src/audio/wind.ts` — looped 1s procedural pink-ish noise → BiquadFilterNode (lowpass 200→2000 Hz) → GainNode 0→0.15, 100ms ramp; fully silent below AS=10 m/s.
- `src/audio/audio-engine.ts` — `AudioEngine` singleton with lazy AudioContext (created on `start()` from user gesture per Safari R4), master gain (default 0.6, clamped [0,1]), per-tick `setEngineThrottle` / `setWindAirspeed`, Phase 2 trigger stubs, `getState()` deep snapshot, `_resetForTests()`.
- `src/audio/audio-engine.test.ts` — 13 Vitest cases via FakeAudioContext mock pattern (parallels `key-hints.test.ts` jsdom approach).

**Files modified (1):**
- `src/main.ts` — instantiates `AudioEngine` once; per-tick throttle + airspeed feed in `onPhysics`; `audioEngine.start()` called on first `missionSelect.onSelect` click AND on deep-link entry path (`?mission=`); `window.__audio.getState()` exposed under `?debug=true`.

**Gates at Phase 1 impl close:**
- Vitest: **721/721** GREEN (was 708/708, +13 new audio tests; zero regressions).
- `npx tsc --noEmit`: clean.
- `npx tsc --noEmit -p tsconfig.tools.json`: clean.
- `npm run build`: clean (pre-existing 500 kB warning is SURFACE-2026-04-19-01).

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
- [SURFACED-2026-06-07] WP19 Phase 2 verify-self — crash SFX trigger could not be live-verified via scripted-input dive; aerodynamic damping dissipates |vY| below 2 m/s threshold before terrain contact at V_trim spawn (3 dive recipes tested). Wiring statically obvious + unit-tested. Filed SURFACE-2026-06-07-03 (Phase 3 coverage-gap, bundle with WP21/WP23 — not a wiring bug, not blocking).

## Test Triage — audio: click-path resumes AudioContext and feeds per-tick state
- **Classification:** Obsolete test — overly strict console-warning whitelist
- **Confidence:** high
- **Evidence:** Test failed on a Chromium-headless WebGL warning `GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels (this message will no longer repeat)`. This is benign WebGL renderer noise unrelated to audio; it fires on the click test only because that test path renders one extra frame. The other 2/3 e2e tests in the file PASS (including the scripted-input-harness throttle assertion, which exercises the same wiring more rigorously).
- **Action:** Extending the `audioWarnings` filter to also drop `GL Driver Message` and `WebGL-` headless noise. Single-knob change to the same filter; test intent ("no audio-related warnings") preserved.

## Test Triage — audio: combat with sustained fire records ≥1 impact one-shot
- **Classification:** Code regression in the test — wait-strategy doesn't survive mission-ends-early
- **Confidence:** high
- **Evidence:** Test waits on `isScriptComplete() === true` (timeout 30s). The scripted Space@1.0:5.0 fires ~20 shots over 4s; target has only TARGET_HP=3 hits to destroy. Once destroyed, `mission.status` transitions to `'won'`, the loop pauses, the scripted-input runner stops advancing, and `isScriptComplete()` never flips true. CLAUDE.md harness docs: "log buffer freezes the first tick `isScriptComplete()` returns true" — but that requires the script to actually reach its end, which it can't when the mission ends inside the window.
- **Action:** Replace the wait-strategy with a poll on the ring-buffer's impact count (the actual outcome under test). Same test intent (impact trigger fires after projectile hits) but tolerant of the loop pausing on win. Single-knob change to the same test; impl untouched.

## Design notes

**Per-tick mutable state convention (CLAUDE.md "Per-tick mutable state — debug accessor + test reset"):** `AudioEngine` is a module-level singleton accessed each physics tick. It MUST ship with (a) `window.__audio` deep-copy accessor under `?debug=true`, and (b) `_resetForTests()` helper preserving object identity. Both are planned at P1.1 + P1.5 — not retrofit.

**Bundle size:** No new assets (no `.mp3`/`.wav`/`.ogg` files). All sounds are synthesized from `OscillatorNode` + `AudioBufferSourceNode` with in-memory generated noise. The audio module adds ~3–5KB of TypeScript to the bundle; no impact on the existing pre-known SURFACE-2026-04-19-01 bundle-size flag.

**R4 (Safari Web Audio latency) mitigation:** Two layers — (1) `AudioContext.resume()` is called from the first user-gesture handler (mission-select click) per spec.whatwg.org/#allowed-to-start; (2) one-shot SFX use precomputed buffer-source nodes for fire/impact rather than per-trigger `decodeAudioData` (which has documented Safari latency). The engine loop + wind use long-lived nodes that don't pay startup cost per tick. Anything beyond this is a Phase 3 cross-browser-QA concern (WP21) — not WP19's gate.

**Not in scope (deferred to Phase 3 / WP20 polish):**
- Recorded audio samples (replaces synthesized SFX behind the same `AudioEngine` interface)
- Doppler effect on projectiles
- Stereo / positional audio (current engine is mono)
- Volume / mute UI control (operator can implement via `audioEngine.setMasterGain` in lil-gui under `?debug=true` if desired during dev; production end-users use system volume)
- Engine startup / shutdown transitions (instant on / instant off at mission start / end)
