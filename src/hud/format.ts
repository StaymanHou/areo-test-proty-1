// HUD objective formatting. Maps `Objective` discriminated union to a one-line
// human-readable string for the HUD's objective slot. Pure-function — easy to
// unit test, no DOM access.

import type { Vec3Plain } from '../aircraft/state';
import type { Objective, ObjectiveState } from '../mission/types';

/**
 * Format a one-line HUD objective string. `state` is informational — used to
 * indicate completion count for ordered waypoint chains.
 *
 * Returns `null` if the objective should be hidden (e.g., a completed
 * destroy-target whose completion is set by a script hook).
 */
export function formatObjective(
  objective: Objective,
  state: ObjectiveState | undefined,
  context: { index: number; total: number },
): string | null {
  switch (objective.kind) {
    case 'reach-waypoint':
      return `Fly to waypoint (${context.index + 1}/${context.total})`;
    case 'touchdown':
      return 'Touchdown on the runway';
    case 'destroy-target':
      return state?.completed === true ? null : 'Destroy the target';
  }
}

/**
 * Pick the first incomplete objective from a parallel pair of arrays and
 * format it. Returns `null` when all objectives are complete or there are
 * none (e.g., free-flight missions with zero objectives).
 */
export function formatActiveObjective(
  objectives: readonly Objective[],
  states: readonly ObjectiveState[],
): string | null {
  if (objectives.length === 0) return null;
  for (let i = 0; i < objectives.length; i++) {
    const state = states[i];
    if (state === undefined || !state.completed) {
      return formatObjective(objectives[i]!, state, {
        index: i,
        total: objectives.length,
      });
    }
  }
  return null;
}

/**
 * Pick the world position of the next incomplete `reach-waypoint` objective.
 * Returns `null` when none is found (zero waypoints, all complete, or all
 * objectives are non-`reach-waypoint` kinds). Returns the position reference
 * directly — caller (DomHud) is expected to copy it into a scratch vector
 * before mutating, since this is the source-of-truth field.
 */
export function getActiveWaypointPosition(
  objectives: readonly Objective[],
  states: readonly ObjectiveState[],
): Vec3Plain | null {
  for (let i = 0; i < objectives.length; i++) {
    const obj = objectives[i]!;
    if (obj.kind !== 'reach-waypoint') continue;
    const state = states[i];
    if (state === undefined || !state.completed) {
      return obj.position;
    }
  }
  return null;
}
