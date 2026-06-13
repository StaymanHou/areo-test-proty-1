// Mission-select DOM overlay per arch.md Rev 2026-05-12 D12 — CSS-absolute
// `<div>` rendered on top of the canvas. Bare-bones styling: just enough to
// be readable. Visual polish is WP20 (Phase 3 polish pass).
//
// The mission-select screen owns its own DOM ownership lifecycle: `show()`
// attaches the overlay to `document.body`; `hide()` detaches it. It also
// renders a small post-mission outcome banner via `showOutcome()` — used by
// the return-to-select flow in `main.ts`.

import type { MissionManifestEntry, MissionStatus } from './types';
import {
  AIRCRAFT_OPTIONS,
  getSelectedAirframe,
  setSelectedAirframe,
  type AirframeId,
} from './aircraft-options';
import { getMasterVolume, setMasterVolume } from '../audio/master-volume';

const ROOT_CLASS = 'mission-select';
const BUTTON_CLASS = 'mission-select-button';
const ERROR_CLASS = 'mission-select-error';
const OUTCOME_CLASS = 'mission-outcome-banner';
const PICKER_CLASS = 'aircraft-picker';
const PICKER_BUTTON_CLASS = 'aircraft-picker-button';
const PICKER_BUTTON_SELECTED_CLASS = 'aircraft-picker-button-selected';
const VOLUME_CLASS = 'master-volume';

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
    .${PICKER_CLASS} {
      display: flex;
      flex-direction: row;
      gap: 0.5rem;
      margin: 0 0 1.5rem;
      align-items: center;
    }
    .${PICKER_CLASS}-label {
      font-size: 0.95rem;
      color: #bbb;
      margin-right: 0.5rem;
    }
    .${PICKER_BUTTON_CLASS} {
      font-size: 0.95rem;
      padding: 0.4rem 1rem;
      background: #1a2a3a;
      color: #bbb;
      border: 1px solid #335;
      border-radius: 4px;
      cursor: pointer;
    }
    .${PICKER_BUTTON_CLASS}:hover { background: #233; }
    .${PICKER_BUTTON_SELECTED_CLASS} {
      background: #246;
      color: #fff;
      border-color: #48a;
    }
    .${VOLUME_CLASS} {
      display: flex;
      flex-direction: row;
      gap: 0.5rem;
      margin: 0 0 1.5rem;
      align-items: center;
    }
    .${VOLUME_CLASS}-label {
      font-size: 0.95rem;
      color: #bbb;
      margin-right: 0.5rem;
    }
    .${VOLUME_CLASS}-slider {
      width: 10rem;
      cursor: pointer;
    }
    .${VOLUME_CLASS}-value {
      font-size: 0.9rem;
      color: #888;
      min-width: 2.5rem;
      text-align: right;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Render the mission-button text. If the mission has a pinned config
 * (e.g. Combat → MiG-15), suffix the airframe name so the player
 * understands the picker doesn't apply to that mission.
 */
function formatMissionButtonText(
  m: MissionManifestEntry,
  pinnedConfigs: ReadonlyMap<string, string> | undefined,
): string {
  if (pinnedConfigs === undefined) return m.name;
  const pinned = pinnedConfigs.get(m.id);
  if (pinned === undefined) return m.name;
  // Map the config-name back to its display airframeName. Unknown
  // config-names render the raw config name as a graceful fallback.
  const opt = AIRCRAFT_OPTIONS.find((o) => o.id === pinned);
  const label = opt !== undefined ? opt.airframeName : pinned;
  return `${m.name} [${label}]`;
}

export interface ShowOpts {
  /** Mission id that failed to load (deep-link to a missing mission). */
  errorForId?: string;
  /**
   * Map of mission-id → pinned-config-name (e.g. 'mig15') for missions that
   * declare a `config?` in their JSON. Tiles render the pinned airframe label
   * inline (e.g. "Combat [MiG-15]"). Missing entries mean the mission is
   * free-pick — uses whatever airframe the player chose.
   */
  pinnedConfigs?: ReadonlyMap<string, string>;
}

export class MissionSelectScreen {
  private _root: HTMLDivElement | null = null;
  private _onSelect: ((id: string) => void) | undefined = undefined;
  private _onVolumeChange: ((v: number) => void) | undefined = undefined;

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

    root.appendChild(this._buildAircraftPicker());
    root.appendChild(this._buildVolumeSlider());

    const pinnedConfigs = opts.pinnedConfigs;
    const list = document.createElement('ul');
    for (const m of missions) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = BUTTON_CLASS;
      btn.setAttribute('data-mission-id', m.id);
      btn.textContent = formatMissionButtonText(m, pinnedConfigs);
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

  private _buildAircraftPicker(): HTMLDivElement {
    const picker = document.createElement('div');
    picker.className = PICKER_CLASS;
    picker.setAttribute('data-testid', 'aircraft-picker');

    const label = document.createElement('span');
    label.className = `${PICKER_CLASS}-label`;
    label.textContent = 'Aircraft:';
    picker.appendChild(label);

    const currentId = getSelectedAirframe();
    const buttonsById = new Map<AirframeId, HTMLButtonElement>();

    for (const opt of AIRCRAFT_OPTIONS) {
      const btn = document.createElement('button');
      btn.className = PICKER_BUTTON_CLASS;
      btn.setAttribute('data-airframe-id', opt.id);
      btn.textContent = `${opt.className} (${opt.airframeName})`;
      if (opt.id === currentId) {
        btn.classList.add(PICKER_BUTTON_SELECTED_CLASS);
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.setAttribute('aria-pressed', 'false');
      }
      btn.addEventListener('click', () => {
        setSelectedAirframe(opt.id);
        for (const [id, b] of buttonsById) {
          const selected = id === opt.id;
          b.classList.toggle(PICKER_BUTTON_SELECTED_CLASS, selected);
          b.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
      });
      buttonsById.set(opt.id, btn);
      picker.appendChild(btn);
    }

    return picker;
  }

  private _buildVolumeSlider(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = VOLUME_CLASS;
    container.setAttribute('data-testid', 'master-volume');

    const label = document.createElement('span');
    label.className = `${VOLUME_CLASS}-label`;
    label.textContent = 'Volume:';
    container.appendChild(label);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.className = `${VOLUME_CLASS}-slider`;
    slider.setAttribute('data-testid', 'master-volume-slider');
    slider.setAttribute('aria-label', 'Master volume');

    const initial = getMasterVolume();
    slider.value = String(initial);

    const valueLabel = document.createElement('span');
    valueLabel.className = `${VOLUME_CLASS}-value`;
    valueLabel.setAttribute('data-testid', 'master-volume-value');
    valueLabel.textContent = `${Math.round(initial * 100)}%`;

    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      if (!Number.isFinite(v)) return;
      setMasterVolume(v);
      valueLabel.textContent = `${Math.round(v * 100)}%`;
      if (this._onVolumeChange !== undefined) this._onVolumeChange(v);
    });

    container.appendChild(slider);
    container.appendChild(valueLabel);
    return container;
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

  onVolumeChange(cb: (v: number) => void): void {
    this._onVolumeChange = cb;
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
