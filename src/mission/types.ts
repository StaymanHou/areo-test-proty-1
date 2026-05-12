// Binding mission types per arch.md Revision 2026-05-12 (D11).
//
// Missions are declarative JSON files in `public/missions/<id>.json`. The
// runner (see `runner.ts`) reads aircraft state via the typed `AircraftState`
// interface in `src/aircraft/state.ts` — NOT via the `window.__aircraft`
// debug global, which is Phase 1 telemetry plumbing.
//
// `Vec3Plain` is re-exported from `src/aircraft/state.ts` to unify type
// identity: `AircraftState.position` and `SpawnConfig.position` are the same
// shape and trivially comparable.

export type { Vec3Plain } from '../aircraft/physics-core/state';
import type { Vec3Plain } from '../aircraft/physics-core/state';

export const MISSION_TYPES = [
  'free-flight',
  'waypoint',
  'takeoff-landing',
  'combat',
] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

export const FAIL_CONDITIONS = ['crash', 'timeout', 'out-of-bounds'] as const;
export type FailCondition = (typeof FAIL_CONDITIONS)[number];

export const WIN_CONDITIONS = ['all-objectives'] as const;
export type WinCondition = (typeof WIN_CONDITIONS)[number];

export const OBJECTIVE_KINDS = [
  'reach-waypoint',
  'touchdown',
  'destroy-target',
] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

export interface SpawnConfig {
  position: Vec3Plain;
  linvel: Vec3Plain;
  /** [0, 1] — clamped by the runner before applying to controls. */
  throttle: number;
}

export interface ReachWaypointObjective {
  kind: 'reach-waypoint';
  position: Vec3Plain;
  /** Sphere radius in meters. */
  radius: number;
  /** Sequential index — lower must complete before higher. */
  order: number;
}

export interface TouchdownObjective {
  kind: 'touchdown';
  runway: {
    center: Vec3Plain;
    halfExtents: Vec3Plain;
  };
  /** Max vertical-speed magnitude (m/s) at touchdown. */
  maxVSpeed: number;
}

export interface DestroyTargetObjective {
  kind: 'destroy-target';
  /** Opaque target identifier — interpreted by the script hook (WP16 combat-ai). */
  targetId: string;
}

export type Objective =
  | ReachWaypointObjective
  | TouchdownObjective
  | DestroyTargetObjective;

export interface Mission {
  id: string;
  name: string;
  type: MissionType;
  spawn: SpawnConfig;
  objectives: Objective[];
  /** Defaults to 'all-objectives' when omitted. */
  winCondition?: WinCondition;
  /** Defaults to 'crash' when omitted. */
  failCondition?: FailCondition;
  /** Required when failCondition === 'timeout'; otherwise ignored. */
  timeoutSec?: number;
  /** Registered script-hook name; throws at runner.start if name is not registered. */
  scriptHook?: string;
}

/** Manifest entry for `public/missions/index.json` — drives the mission-select UI. */
export interface MissionManifestEntry {
  id: string;
  name: string;
}

export type MissionStatus = 'not-started' | 'running' | 'won' | 'failed';

/**
 * Per-objective runtime state held by `MissionRunner`. The `completed` flag
 * is what the runner inspects for the win-condition evaluation; `meta` is a
 * free-form bag for runner-internal bookkeeping (e.g., touchdown
 * Objective's first-touch timestamp) and may also be mutated by script
 * hooks (the destroy-target hook sets `completed = true` from WP16).
 */
export interface ObjectiveState {
  completed: boolean;
  meta: Record<string, unknown>;
}
