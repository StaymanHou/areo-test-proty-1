// WP18 Phase 2 — Key-hints overlay.
//
// Bare-bones DOM overlay showing control bindings during the first ~20s of
// each mission run. Opaque for 10s, linear fade to 0 over the next 10s, then
// detached at 21s. Re-shown per mission entry (each new mission resets the
// timer).
//
// Visual layout (top-right of the screen, below the HUD-tr altitude block):
//   ┌────────────────────────┐
//   │ Controls               │
//   │ Pitch ............ W/S │
//   │ Roll ............. A/D │
//   │ Yaw .............. Q/E │
//   │ Throttle ..... Shift/Ctrl│
//   │ Camera ............. V │
//   │ Abort .......... Esc   │
//   │ Fire (combat) ... Space│  ← combat-only
//   └────────────────────────┘
//
// Allocation-free hot path: DOM root cached on construction; `update()` only
// writes `style.opacity` per frame. Lives in the existing onRender loop —
// see main.ts wiring.

import type { MissionType } from '../mission/types';

const ROOT_CLASS = 'key-hints-root';
const CSS = `
  .${ROOT_CLASS} {
    position: absolute;
    top: 5rem;
    right: 1rem;
    padding: 0.6rem 0.9rem;
    background: rgba(0, 0, 0, 0.55);
    color: #eee;
    font-family: sans-serif;
    font-size: 0.85rem;
    border-radius: 4px;
    pointer-events: none;
    z-index: 60;
    line-height: 1.5;
    transition: none;
  }
  .${ROOT_CLASS} h3 {
    margin: 0 0 0.3rem;
    font-size: 0.95rem;
    color: #fff;
    letter-spacing: 0.04em;
  }
  .${ROOT_CLASS} .kh-row {
    display: flex;
    justify-content: space-between;
    gap: 1.5rem;
    min-width: 12rem;
  }
  .${ROOT_CLASS} .kh-key {
    font-family: monospace;
    color: #ffd;
  }
`;

let _cssInjected = false;
function ensureCss(): void {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const OPAQUE_SEC = 10;
const FADE_END_SEC = 20;
const REMOVE_SEC = 21;

// Common hints for every mission. Order matters — most-used first.
const COMMON_HINTS: ReadonlyArray<[string, string]> = [
  ['Pitch', 'W / S'],
  ['Roll', 'A / D'],
  ['Yaw', 'Q / E'],
  ['Throttle', 'Shift / Ctrl'],
  ['Camera', 'V'],
  ['Abort', 'Esc'],
];

const COMBAT_EXTRA: ReadonlyArray<[string, string]> = [['Fire', 'Space']];

export class KeyHintsOverlay {
  private _root: HTMLDivElement | null = null;
  private _elapsedSec = 0;

  /**
   * Show the overlay for a fresh mission. Resets the fade timer and re-mounts
   * the DOM if it was previously hidden.
   */
  show(missionType: MissionType): void {
    ensureCss();
    if (this._root !== null) this._root.remove();

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.setAttribute('data-testid', 'key-hints');
    root.style.opacity = '1';

    const heading = document.createElement('h3');
    heading.textContent = 'Controls';
    root.appendChild(heading);

    const hints: ReadonlyArray<[string, string]> =
      missionType === 'combat' ? [...COMMON_HINTS, ...COMBAT_EXTRA] : COMMON_HINTS;

    for (const [label, key] of hints) {
      const row = document.createElement('div');
      row.className = 'kh-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const keyEl = document.createElement('span');
      keyEl.className = 'kh-key';
      keyEl.textContent = key;
      row.appendChild(labelEl);
      row.appendChild(keyEl);
      root.appendChild(row);
    }

    document.body.appendChild(root);
    this._root = root;
    this._elapsedSec = 0;
  }

  /**
   * Tick the fade timer. Called from the render loop with the per-frame dt.
   * Drives opacity linearly from 1.0 (≤10s) to 0.0 (≥20s); detaches the DOM
   * at 21s so it stops consuming layout work for the rest of the mission.
   */
  update(dtSec: number): void {
    if (this._root === null) return;
    this._elapsedSec += dtSec;
    if (this._elapsedSec >= REMOVE_SEC) {
      this._root.remove();
      this._root = null;
      return;
    }
    let opacity = 1;
    if (this._elapsedSec > OPAQUE_SEC) {
      const fadeFrac = (this._elapsedSec - OPAQUE_SEC) / (FADE_END_SEC - OPAQUE_SEC);
      opacity = Math.max(0, 1 - fadeFrac);
    }
    this._root.style.opacity = opacity.toFixed(3);
  }

  /**
   * Force-hide regardless of timer. Called when a mission ends so the next
   * `show()` starts from a clean slate. Idempotent.
   */
  hide(): void {
    if (this._root !== null) {
      this._root.remove();
      this._root = null;
    }
    this._elapsedSec = 0;
  }

  /** Test-only inspection. */
  isMounted(): boolean {
    return this._root !== null;
  }

  /** Test-only inspection. */
  getElapsedSec(): number {
    return this._elapsedSec;
  }

  /** Test-only inspection. */
  getOpacity(): number {
    if (this._root === null) return 0;
    const v = parseFloat(this._root.style.opacity);
    return Number.isFinite(v) ? v : 1;
  }
}
