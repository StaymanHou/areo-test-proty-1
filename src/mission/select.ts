// Mission-select DOM overlay per arch.md Rev 2026-05-12 D12 — CSS-absolute
// `<div>` rendered on top of the canvas. Bare-bones styling: just enough to
// be readable. Visual polish is WP20 (Phase 3 polish pass).
//
// The mission-select screen owns its own DOM ownership lifecycle: `show()`
// attaches the overlay to `document.body`; `hide()` detaches it. It also
// renders a small post-mission outcome banner via `showOutcome()` — used by
// the return-to-select flow in `main.ts`.

import type { MissionManifestEntry, MissionStatus } from './types';

const ROOT_CLASS = 'mission-select';
const BUTTON_CLASS = 'mission-select-button';
const ERROR_CLASS = 'mission-select-error';
const OUTCOME_CLASS = 'mission-outcome-banner';

// One-time CSS injection. Keeps the styling self-contained (no separate
// stylesheet to wire into index.html).
let _cssInjected = false;
function ensureCss(): void {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .${ROOT_CLASS} {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.75);
      color: #eee;
      font-family: sans-serif;
      z-index: 100;
      pointer-events: auto;
    }
    .${ROOT_CLASS} h1 {
      font-size: 2rem;
      margin: 0 0 1.5rem;
    }
    .${ROOT_CLASS} ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .${BUTTON_CLASS} {
      font-size: 1.1rem;
      padding: 0.6rem 1.4rem;
      background: #246;
      color: #fff;
      border: 1px solid #48a;
      border-radius: 4px;
      cursor: pointer;
      min-width: 12rem;
    }
    .${BUTTON_CLASS}:hover { background: #357; }
    .${ERROR_CLASS} {
      margin: 0 0 1rem;
      padding: 0.5rem 1rem;
      background: #6b2020;
      border: 1px solid #b44;
      border-radius: 4px;
      color: #fee;
    }
    .${OUTCOME_CLASS} {
      position: absolute;
      top: 30%;
      left: 50%;
      transform: translateX(-50%);
      font-family: sans-serif;
      font-size: 2.5rem;
      color: #fff;
      background: rgba(0, 0, 0, 0.75);
      padding: 1rem 2rem;
      border-radius: 8px;
      z-index: 99;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

export interface ShowOpts {
  /** Mission id that failed to load (deep-link to a missing mission). */
  errorForId?: string;
}

export class MissionSelectScreen {
  private _root: HTMLDivElement | null = null;
  private _onSelect: ((id: string) => void) | undefined = undefined;

  show(missions: readonly MissionManifestEntry[], opts: ShowOpts = {}): void {
    ensureCss();
    if (this._root !== null) this.hide();

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    // data-testid for Playwright assertions in mission-select.spec.ts
    root.setAttribute('data-testid', 'mission-select');

    const heading = document.createElement('h1');
    heading.textContent = 'Web Flight Sim';
    root.appendChild(heading);

    if (opts.errorForId !== undefined) {
      const err = document.createElement('p');
      err.className = ERROR_CLASS;
      err.setAttribute('data-testid', 'mission-select-error');
      err.textContent = `Mission "${opts.errorForId}" not found. Pick another:`;
      root.appendChild(err);
    }

    const list = document.createElement('ul');
    for (const m of missions) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = BUTTON_CLASS;
      btn.setAttribute('data-mission-id', m.id);
      btn.textContent = m.name;
      btn.addEventListener('click', () => {
        if (this._onSelect !== undefined) this._onSelect(m.id);
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
    root.appendChild(list);

    document.body.appendChild(root);
    this._root = root;
  }

  hide(): void {
    if (this._root === null) return;
    this._root.remove();
    this._root = null;
  }

  isShown(): boolean {
    return this._root !== null;
  }

  onSelect(cb: (id: string) => void): void {
    this._onSelect = cb;
  }

  /**
   * Display a transient outcome banner ("MISSION COMPLETE" / "MISSION FAILED").
   * Resolves after `holdMs` (default 2000). The runner caller is expected to
   * show the select screen again after this resolves.
   */
  async showOutcome(status: MissionStatus, missionName: string, holdMs = 2000): Promise<void> {
    ensureCss();
    const banner = document.createElement('div');
    banner.className = OUTCOME_CLASS;
    banner.setAttribute('data-testid', 'mission-outcome-banner');
    banner.textContent =
      status === 'won'
        ? `MISSION COMPLETE — ${missionName}`
        : status === 'failed'
          ? `MISSION FAILED — ${missionName}`
          : `${status.toUpperCase()} — ${missionName}`;
    document.body.appendChild(banner);
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        banner.remove();
        resolve();
      }, holdMs);
    });
  }
}
