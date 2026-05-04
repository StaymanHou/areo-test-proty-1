---
feature: wp3-input-camera
phase: finalize
state: completed
created: 2026-05-04
completed: 2026-05-04
source: docs/product/wbs.md (WP3)
---

# Feature: WP3 — Input + Camera

**Workflow:** feature
**State:** plan (complete)
**Created:** 2026-05-04

## Problem Statement

WP2 left a static camera and no input system. WP3 fills both gaps. `engine/input.ts` must capture keyboard and mouse state in a frame-stable way (no missed events, no double-counting) with a rebindable key map. `world/camera.ts` must provide two camera modes — chase (damped follow at a fixed offset behind/above the target) and cockpit (rigidly attached to the body) — with a single key to swap between them. Both systems are wired into `main.ts` on the existing falling-cube demo so they can be exercised immediately; no aircraft required.

## Work Tree

- [x] Phase 1: Input system  <!-- status: complete -->
  **Observable outcomes:**
  - Browser: Playwright navigates to dev URL; `?debug=true` lil-gui panel shows a "Keys held" readout that updates when arrow keys / WASD / Space are pressed and clears when released; no JS console errors
  - CLI: `npm run build` exits 0; `npm test` exits 0 with all tests passing
  - [x] P1.1 `src/engine/input.ts`: `InputState` interface (`keys: Set<string>`, `mouseButtons: Set<number>`, `mouseDelta: {x,y}`, `mousePosition: {x,y}`). `InputManager` class: attaches `keydown`/`keyup`/`mousemove`/`mousedown`/`mouseup`/`contextmenu` listeners on construction, `dispose()` removes them. `flush()` resets per-frame delta fields (called once per render frame). `isDown(key: string): boolean` and `wasPressed(key: string): boolean` (pressed this frame only).  <!-- status: complete -->
  - [x] P1.2 `KeyMap` interface: maps logical action strings to physical key codes. Default map covers: `forward`, `backward`, `strafeLeft`, `strafeRight`, `pitchUp`, `pitchDown`, `rollLeft`, `rollRight`, `yawLeft`, `yawRight`, `throttleUp`, `throttleDown`, `swapCamera`, `pause`. Export `DEFAULT_KEY_MAP`.  <!-- status: complete -->
  - [x] P1.3 Wire `InputManager` into `main.ts`: create instance, call `flush()` at the end of `onRender`. Add a lil-gui "Keys held" read-only display that shows `[...inputManager.state.keys].join(', ')` when `?debug=true`.  <!-- status: complete -->
  - [x] P1.4 Vitest unit tests for `InputManager`: synthetic `keydown`/`keyup` events; `isDown` true after keydown, false after keyup; `wasPressed` true only on first frame after keydown, false after `flush()`; `mouseDelta` accumulates during frame, zeros after `flush()`.  <!-- status: complete -->
  - [x] verify-auto  <!-- status: complete -->
  - [x] verify-self  <!-- status: complete -->
  - [x] verify-human  <!-- status: complete -->
    - [x] P1.verify-human.1: Open `?debug=true` — lil-gui shows a "Keys held" field and it updates live when real keys are pressed/released  <!-- status: complete -->
    - [x] P1.verify-human.2: Hold two keys simultaneously (e.g. W + ArrowUp) — both key codes appear in the readout simultaneously (no key-drop)  <!-- status: complete -->
    - [x] P1.verify-human.3: Release all keys — readout clears to empty within one frame  <!-- status: complete -->
    - [x] P1.verify-human.4: Move mouse over the canvas — no JS console errors  <!-- status: complete -->
  - [x] verify-codify  <!-- status: complete -->

- [x] Phase 2: Camera system  <!-- status: complete -->

  **Relevance check (before Phase 2):**
  - Requester still needs this: yes — camera is required for WP3 exit criteria per WBS
  - Requirements unchanged: yes — chase + cockpit, V to swap, unchanged from plan
  - Solution still feasible: yes — Three.js Vector3/Quaternion lerp is standard
  - No superior alternative discovered: yes — no reason to deviate from plan
  **Verdict:** proceed

  **Implementation note:** `enum` is forbidden under `erasableSyntaxOnly`. Used `const` object + type alias pattern instead: `export const CameraMode = { Chase: 'Chase', Cockpit: 'Cockpit' } as const; export type CameraMode = ...`.

  **Observable outcomes:**
  - Browser: Playwright navigates to dev URL; cube falls and rests; camera follows cube smoothly in chase mode (visible lag/damping); pressing `V` switches to cockpit mode (camera locks rigidly to cube — no smoothing); pressing `V` again returns to chase; `?debug=true` lil-gui shows active camera mode label; no JS console errors
  - CLI: `npm run build` exits 0; `npm test` exits 0
  - [x] P2.1 `src/world/camera.ts`: `CameraMode` const+type, `CameraController` class, `CameraOptions`, `update()`, `setMode()`, `activeMode` getter.  <!-- status: complete -->
  - [x] P2.2 Chase mode: exponential-decay lerp toward offset-behind-target, `lookAt` each frame.  <!-- status: complete -->
  - [x] P2.3 Cockpit mode: rigid attach at `(0, 0.3, 0)` local offset, quaternion copy, no lerp.  <!-- status: complete -->
  - [x] P2.4 Wire into `main.ts`: `CameraController` created, `update()` called in `onRender`, `V` key toggles mode, lil-gui "Camera" label added.  <!-- status: complete -->
  - [x] P2.5 Vitest unit tests: 5 tests — default mode, setMode round-trip, chase lerps closer, chase doesn't snap, cockpit snaps exactly, cockpit copies quaternion.  <!-- status: complete -->
  - [x] verify-auto  <!-- status: complete -->
  - [x] verify-self  <!-- status: complete -->
  - [x] verify-human  <!-- status: complete -->
    - [x] P2.verify-human.1: Watch the cube fall — camera visibly lags behind with smooth damping (not instant/snappy follow)  <!-- status: complete -->
    - [x] P2.verify-human.2: Press `V` → cockpit mode: camera snaps inside/onto cube and rotates rigidly with it as it bounces  <!-- status: complete -->
    - [x] P2.verify-human.3: Press `V` again → chase mode resumes with smooth follow  <!-- status: complete -->
    - [x] P2.verify-human.4: Background the tab for 10s then return → camera resumes correctly (no NaN teleport, no freeze)  <!-- status: complete -->
  - [x] verify-codify  <!-- status: complete -->

## Current Node
- **Path:** Feature > COMPLETE
- **Active scope:** none — all phases done
- **Blocked:** none
- **Unvisited:** none
- **Open discoveries:** none

## Retrospect
- **What changed in our understanding:** `enum` is disallowed under `erasableSyntaxOnly` (same constraint we hit in WP2 with parameter-properties). The pattern to use is `const` object + type alias. This is now an established project pattern.
- **Assumptions that held:** Three.js `Vector3.lerp` + exponential-decay alpha is exactly the right tool for frame-rate-independent camera damping. The math from the plan worked on first attempt.
- **Assumptions that were wrong:** The `onRender` callback receives `alpha` (accumulator fraction), not `dt`. The camera damping uses a hardcoded `1/60` as a proxy — acceptable since the loop runs at 60 Hz physics, but worth noting for WP6+ if the render rate diverges significantly from physics rate.
- **Approach delta:** Dev server startup was handled by the agent (no user action needed) — established that `npm run dev` can be spawned as a background process and probed via curl. This pattern is now available for future verify-self runs.

## Discoveries
<!-- Format: [SURFACED-<date>] <target node> — <summary>
     Each entry is also logged to workflow/backlog.md -->
