// WP26 — Master-volume persistence. Mirrors the defensive localStorage pattern
// from `src/mission/aircraft-options.ts`: try/catch around storage access,
// clamp to [0, 1], reject NaN / non-finite / non-numeric, swallow storage
// exceptions (private-mode iframes, cookies-off, full-quota). Invalid /
// missing / throwing storage all collapse to DEFAULT_MASTER_VOLUME.

export const MASTER_VOLUME_STORAGE_KEY = 'flightsim.volume.master';
export const DEFAULT_MASTER_VOLUME = 0.5;

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Read the player's master-volume choice from localStorage. Returns
 * DEFAULT_MASTER_VOLUME on missing / invalid / inaccessible. Valid stored
 * values are parsed and clamped to [0, 1] defensively.
 */
export function getMasterVolume(): number {
  let raw: string | null;
  try {
    raw = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
  } catch {
    return DEFAULT_MASTER_VOLUME;
  }
  if (raw === null || raw === '') return DEFAULT_MASTER_VOLUME;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MASTER_VOLUME;
  return clamp01(parsed);
}

/**
 * Persist the player's master-volume choice. Non-finite inputs are rejected
 * (no-op); finite inputs are clamped to [0, 1] before writing. Storage
 * exceptions are swallowed — UX continues to function for the current session.
 */
export function setMasterVolume(v: number): void {
  if (!Number.isFinite(v)) return;
  const clamped = clamp01(v);
  try {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, String(clamped));
  } catch {
    // ignore — storage may be unavailable; in-session value still applies
  }
}
