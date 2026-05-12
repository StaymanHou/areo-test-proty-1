// HUD interface per arch.md Rev 2026-05-12 D12. The interface is the Phase 3
// swap point: a future `three-hud.ts` (THREE.js orthographic camera impl)
// could replace `dom-hud.ts` without touching consumers. v1 ships `DomHud`.

import type { AircraftState, Vec3Plain } from '../aircraft/physics-core/state';

export type HudStatus = 'flying' | 'won' | 'failed';

export interface HUD {
  /** Update altitude/airspeed numeric readouts. Called every render frame. */
  setAircraftState(state: AircraftState): void;
  /**
   * Set throttle readout. Separate from `setAircraftState` because throttle is
   * a controls-layer concept, not part of the physics readout. Range [0, 1].
   */
  setThrottle(throttle: number): void;
  /**
   * Set the current-objective text (or null to hide the objective line).
   * Driven by `MissionRunner` `objectiveChange` events.
   */
  setObjective(text: string | null): void;
  /**
   * Project a world-space target to screen coords and position the waypoint
   * arrow. Pass `null` to hide the arrow (no active waypoint).
   */
  setWaypointArrow(worldPos: Vec3Plain | null): void;
  /**
   * Show/hide the status banner. `'flying'` hides the banner; `'won'` or
   * `'failed'` show it with the optional `text`.
   */
  setStatus(status: HudStatus, text?: string): void;
  /** Attach HUD DOM to the page. Idempotent. */
  show(): void;
  /** Detach HUD DOM from the page. Idempotent. */
  hide(): void;
}
