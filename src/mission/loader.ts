// Mission loader — fetches static JSON from `public/missions/`. Mirrors the
// shape of `loadAircraftConfig` in `src/aircraft/config.ts`: a thin fetch
// wrapper that delegates to the strict parser. Error shape:
//   "mission loader: fetch /missions/<id>.json → <status> <statusText>"
//
// The path layout (`public/missions/<id>.json` for missions, `index.json` for
// the manifest) is binding per arch.md Rev 2026-05-12 D11. No directory
// listing needed — the manifest IS the discoverability mechanism (static
// hosts don't expose directory indexes by default; this is intentional per
// arch D9 "static deploy, backend-less").

import { parseMission } from './parse';
import type { Mission, MissionManifestEntry } from './types';

export async function loadMission(id: string): Promise<Mission> {
  const url = `${import.meta.env.BASE_URL}missions/${id}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `mission loader: fetch ${url} → ${res.status} ${res.statusText}`,
    );
  }
  const raw = await res.json();
  return parseMission(raw);
}

export async function loadMissionList(): Promise<MissionManifestEntry[]> {
  const url = `${import.meta.env.BASE_URL}missions/index.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `mission loader: fetch ${url} → ${res.status} ${res.statusText}`,
    );
  }
  const raw = await res.json();
  return parseMissionManifest(raw);
}

function parseMissionManifest(raw: unknown): MissionManifestEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error('mission manifest: root must be an array');
  }
  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`mission manifest: entry[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id.length === 0) {
      throw new Error(`mission manifest: entry[${i}].id must be a non-empty string`);
    }
    if (typeof e.name !== 'string' || e.name.length === 0) {
      throw new Error(`mission manifest: entry[${i}].name must be a non-empty string`);
    }
    return { id: e.id, name: e.name };
  });
}
