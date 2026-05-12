// Script-hook registry for missions. WP11 ships the registry empty —
// WP16 (combat) registers `combat-ai` here. The hook receives per-tick
// (state, aircraft, dt) and may mutate `state` (hook-private bag) and the
// runner's objective-state entries (notably destroy-target completion).
//
// Duplicate registration of the same name throws — silently overwriting
// would mask developer mistakes. Tests-only: use `clearRegistry()` to reset
// state between cases (do not call from production code).

import type { AircraftState } from '../../aircraft/physics-core/state';
import type { ObjectiveState } from '../types';

/** Hook-private mutable state. Runner provides a fresh `{}` per mission start. */
export type HookState = Record<string, unknown>;

/**
 * Signature for a registered hook. May mutate `state` and any
 * `ObjectiveState.completed` flags it cares about (notably destroy-target
 * targets, which only the hook knows how to "destroy"). Must be allocation-
 * free per tick (called inside the physics loop).
 *
 * `objectives` is the runner's per-mission ObjectiveState array — same length
 * and order as `mission.objectives` from `types.ts`.
 */
export type HookFn = (
  state: HookState,
  aircraft: AircraftState,
  objectives: readonly ObjectiveState[],
  dt: number,
) => void;

const _registry = new Map<string, HookFn>();

export function registerHook(name: string, fn: HookFn): void {
  if (name.length === 0) {
    throw new Error('hook registry: name must be a non-empty string');
  }
  if (_registry.has(name)) {
    throw new Error(`hook registry: hook "${name}" is already registered`);
  }
  _registry.set(name, fn);
}

export function getHook(name: string): HookFn | undefined {
  return _registry.get(name);
}

/** Test-only: clear all registered hooks. */
export function clearRegistry(): void {
  _registry.clear();
}
