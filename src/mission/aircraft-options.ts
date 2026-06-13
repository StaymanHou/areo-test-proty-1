// Aircraft selection — player-facing airframe choice surfaced on the
// mission-select screen (WP24).
//
// Today the project ships 2 player-facing airframes (the third,
// `aircraft-aerobatic.json`, stays a test fixture pending SURFACE-2026-06-06-06
// Phase B feel-tune). Additional airframes are added by appending to
// `AIRCRAFT_OPTIONS` AND placing `public/config/aircraft-<id>.json` for
// non-default ids.
//
// Storage: `localStorage` under `AIRFRAME_STORAGE_KEY`. The pick persists
// across page reloads. localStorage is required because the airframe is
// bound at boot — mid-session swap is unsupported per WP14.20 Phase B; the
// mission-select screen triggers a `location.reload()` when the player
// changes airframe between missions (handled in Phase 3 of WP24).
//
// Defense-in-depth: storage values are validated against both the static
// known-id set AND the CONFIG_NAME_REGEX path-traversal defense before being
// passed to the loader. Invalid / missing / throwing storage all collapse to
// the default airframe.

import { CONFIG_NAME_REGEX } from '../engine/scripted-input';

export const AIRFRAME_STORAGE_KEY = 'flightsim.aircraft.selected';

export type AirframeId = 'default' | 'mig15';

export interface AirframeOption {
  /** Stable id used in URLs, localStorage, and as the config-file suffix. */
  id: AirframeId;
  /** Class label shown first in the UI — casual-gamer-readable. */
  className: string;
  /** Specific airframe name shown in parentheses for aviation-curious players. */
  airframeName: string;
}

/**
 * Player-facing airframe list. Display order matches the order in this array.
 * Default (Cessna-class) is first by convention.
 */
export const AIRCRAFT_OPTIONS: readonly AirframeOption[] = [
  { id: 'default', className: 'Trainer', airframeName: 'Cessna' },
  { id: 'mig15', className: 'Jet', airframeName: 'MiG-15' },
];

const KNOWN_IDS: ReadonlySet<string> = new Set(AIRCRAFT_OPTIONS.map((o) => o.id));

/**
 * Read the player's selected airframe id from localStorage. Returns
 * `'default'` on missing / invalid / inaccessible (storage may throw in
 * private-mode iframes or with disabled cookies).
 */
export function getSelectedAirframe(): AirframeId {
  let raw: string | null;
  try {
    raw = localStorage.getItem(AIRFRAME_STORAGE_KEY);
  } catch {
    return 'default';
  }
  if (raw === null || raw === '') return 'default';
  if (!CONFIG_NAME_REGEX.test(raw)) return 'default';
  if (!KNOWN_IDS.has(raw)) return 'default';
  return raw as AirframeId;
}

/**
 * Persist the player's airframe choice. Invalid ids are rejected (no-op);
 * the caller is responsible for passing only known ids. Storage exceptions
 * are swallowed — picker UX continues to function for the current session.
 */
export function setSelectedAirframe(id: AirframeId): void {
  if (!KNOWN_IDS.has(id)) return;
  try {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, id);
  } catch {
    // ignore — storage may be unavailable; the picker still works in-session
  }
}

/**
 * Boot-time resolution: which airframe should `loadAircraftConfig` load?
 * Precedence: URL `?config=` > preloaded-mission `config?` > localStorage
 * pick > default. The first three are nullable inputs from the caller;
 * localStorage is read internally.
 *
 * Returned shape includes `source` so the caller can surface it via the
 * `window.__aircraftConfig` debug accessor (?debug=true only). `name` is
 * `null` when the default (Cessna) is selected — the loader path
 * (`configNameToPath(null)`) maps null → `aircraft.json`.
 */
export interface AirframeResolution {
  /** Config name suffix, or null for the default Cessna. */
  name: string | null;
  source: 'url' | 'mission' | 'storage' | 'default';
}

export function resolveAirframeName(inputs: {
  urlConfig: string | null;
  missionConfig: string | null | undefined;
  storedConfig?: AirframeId; // injectable for tests; defaults to localStorage read
}): AirframeResolution {
  if (inputs.urlConfig !== null && inputs.urlConfig !== '') {
    return { name: inputs.urlConfig, source: 'url' };
  }
  const missionConfig = inputs.missionConfig;
  if (missionConfig !== null && missionConfig !== undefined && missionConfig !== '') {
    return { name: missionConfig, source: 'mission' };
  }
  const stored = inputs.storedConfig ?? getSelectedAirframe();
  if (stored !== 'default') {
    return { name: stored, source: 'storage' };
  }
  return { name: null, source: 'default' };
}
