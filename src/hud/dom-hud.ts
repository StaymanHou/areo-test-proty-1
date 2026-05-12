// DomHud — DOM-overlay HUD per arch.md Rev 2026-05-12 D12.
//
// Visual layout (bare-bones; visual polish is WP20):
//   ┌─────────────────────────────────────────────────────────┐
//   │ airspeed                  objective              altitude│
//   │ throttle                                                │
//   │                                                         │
//   │                     [STATUS BANNER]                     │
//   │                                                         │
//   │                                                         │
//   │                   [waypoint arrow ▲]                    │
//   └─────────────────────────────────────────────────────────┘
//
// CSS injection mirrors `mission/select.ts`: module-scoped `_cssInjected`
// flag + one-time `<style>` append on first `show()`. No separate stylesheet.
//
// Allocation-free hot path: DOM node references cached on construction; only
// `textContent` and `style.left/top/display` writes per frame. The waypoint
// arrow uses a module-scoped scratch THREE.Vector3 for projection.

import { Vector3 } from 'three';
import type { Camera } from 'three';
import type { AircraftState, Vec3Plain } from '../aircraft/state';
import type { HUD, HudStatus } from './HUD';

const ROOT_CLASS = 'hud-root';
const CSS = `
  .${ROOT_CLASS} {
    position: absolute;
    inset: 0;
    pointer-events: none;
    color: #fff;
    font-family: sans-serif;
    font-size: 1.1rem;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    z-index: 50;
  }
  .${ROOT_CLASS} .hud-tl {
    position: absolute; top: 1rem; left: 1rem;
    display: flex; flex-direction: column; gap: 0.25rem;
  }
  .${ROOT_CLASS} .hud-tr {
    position: absolute; top: 1rem; right: 1rem;
    text-align: right;
  }
  .${ROOT_CLASS} .hud-tc {
    position: absolute; top: 1rem; left: 50%; transform: translateX(-50%);
    text-align: center;
  }
  .${ROOT_CLASS} .hud-banner {
    position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%);
    font-size: 2.5rem;
    background: rgba(0, 0, 0, 0.75);
    padding: 1rem 2rem;
    border-radius: 8px;
  }
  .${ROOT_CLASS} .hud-banner.won { color: #6f6; }
  .${ROOT_CLASS} .hud-banner.failed { color: #f66; }
  .${ROOT_CLASS} .hud-arrow {
    position: absolute;
    width: 0; height: 0;
    border-left: 12px solid transparent;
    border-right: 12px solid transparent;
    border-bottom: 20px solid #ff6;
    transform: translate(-50%, -50%);
    pointer-events: none;
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

// Module-scoped scratch — reused across all DomHud instances (single-instance
// in practice) and across every render frame. Phase 2 (P2.1) uses this for
// THREE.Vector3.project() without per-frame allocation.
const _scratchProject = new Vector3();

export interface DomHudOpts {
  /** Mount point. Defaults to `document.body`. */
  root?: HTMLElement;
}

export class DomHud implements HUD {
  private readonly _camera: Camera;
  private readonly _canvasEl: HTMLElement;
  private readonly _mount: HTMLElement;

  private _root: HTMLDivElement;
  private _airspeedEl: HTMLSpanElement;
  private _throttleEl: HTMLSpanElement;
  private _altitudeEl: HTMLSpanElement;
  private _objectiveEl: HTMLDivElement;
  private _bannerEl: HTMLDivElement;
  private _arrowEl: HTMLDivElement;

  private _shown = false;

  constructor(camera: Camera, canvasEl: HTMLElement, opts: DomHudOpts = {}) {
    this._camera = camera;
    this._canvasEl = canvasEl;
    this._mount = opts.root ?? document.body;

    const root = document.createElement('div');
    root.className = ROOT_CLASS;
    root.setAttribute('data-testid', 'hud-root');

    const tl = document.createElement('div');
    tl.className = 'hud-tl';
    const airspeedLine = document.createElement('div');
    airspeedLine.append('AS ');
    const airspeed = document.createElement('span');
    airspeed.setAttribute('data-testid', 'hud-airspeed');
    airspeed.textContent = '0';
    airspeedLine.appendChild(airspeed);
    airspeedLine.append(' m/s');
    tl.appendChild(airspeedLine);

    const throttleLine = document.createElement('div');
    throttleLine.append('THR ');
    const throttle = document.createElement('span');
    throttle.setAttribute('data-testid', 'hud-throttle');
    throttle.textContent = '0';
    throttleLine.appendChild(throttle);
    throttleLine.append('%');
    tl.appendChild(throttleLine);
    root.appendChild(tl);

    const tr = document.createElement('div');
    tr.className = 'hud-tr';
    tr.append('ALT ');
    const altitude = document.createElement('span');
    altitude.setAttribute('data-testid', 'hud-altitude');
    altitude.textContent = '0';
    tr.appendChild(altitude);
    tr.append(' m');
    root.appendChild(tr);

    const objective = document.createElement('div');
    objective.className = 'hud-tc';
    objective.setAttribute('data-testid', 'hud-objective');
    objective.textContent = '';
    objective.style.display = 'none';
    root.appendChild(objective);

    const banner = document.createElement('div');
    banner.className = 'hud-banner';
    banner.setAttribute('data-testid', 'hud-status-banner');
    banner.textContent = '';
    banner.style.display = 'none';
    root.appendChild(banner);

    const arrow = document.createElement('div');
    arrow.className = 'hud-arrow';
    arrow.setAttribute('data-testid', 'hud-waypoint-arrow');
    arrow.style.display = 'none';
    root.appendChild(arrow);

    this._root = root;
    this._airspeedEl = airspeed;
    this._throttleEl = throttle;
    this._altitudeEl = altitude;
    this._objectiveEl = objective;
    this._bannerEl = banner;
    this._arrowEl = arrow;
  }

  show(): void {
    if (this._shown) return;
    ensureCss();
    this._mount.appendChild(this._root);
    this._shown = true;
  }

  hide(): void {
    if (!this._shown) return;
    if (this._root.parentNode !== null) this._root.parentNode.removeChild(this._root);
    this._shown = false;
  }

  setAircraftState(state: AircraftState): void {
    if (!this._shown) return;
    this._altitudeEl.textContent = String(Math.round(state.altitude));
    this._airspeedEl.textContent = String(Math.round(state.airspeed));
  }

  setThrottle(throttle: number): void {
    if (!this._shown) return;
    this._throttleEl.textContent = String(Math.round(throttle * 100));
  }

  setObjective(text: string | null): void {
    if (!this._shown) return;
    if (text === null) {
      this._objectiveEl.style.display = 'none';
      this._objectiveEl.textContent = '';
    } else {
      this._objectiveEl.style.display = '';
      this._objectiveEl.textContent = text;
    }
  }

  setStatus(status: HudStatus, text?: string): void {
    if (!this._shown) return;
    if (status === 'flying') {
      this._bannerEl.style.display = 'none';
      this._bannerEl.textContent = '';
      this._bannerEl.className = 'hud-banner';
    } else {
      this._bannerEl.style.display = '';
      this._bannerEl.textContent = text ?? (status === 'won' ? 'MISSION COMPLETE' : 'MISSION FAILED');
      this._bannerEl.className = `hud-banner ${status}`;
    }
  }

  setWaypointArrow(worldPos: Vec3Plain | null): void {
    if (!this._shown) return;
    if (worldPos === null) {
      this._arrowEl.style.display = 'none';
      return;
    }
    _scratchProject.set(worldPos.x, worldPos.y, worldPos.z);
    _scratchProject.project(this._camera);
    const ndcX = _scratchProject.x;
    const ndcY = _scratchProject.y;
    const ndcZ = _scratchProject.z;
    // Behind camera (z > 1 in NDC after project) or off-screen → hide.
    if (ndcZ > 1 || ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) {
      this._arrowEl.style.display = 'none';
      return;
    }
    const w = this._canvasEl.clientWidth;
    const h = this._canvasEl.clientHeight;
    const left = (ndcX * 0.5 + 0.5) * w;
    const top = (-ndcY * 0.5 + 0.5) * h;
    this._arrowEl.style.display = '';
    this._arrowEl.style.left = `${left}px`;
    this._arrowEl.style.top = `${top}px`;
  }
}
