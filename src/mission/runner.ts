// MissionRunner — per arch.md Rev 2026-05-12 D11 and WP11 spec/plan.
// Owns the mission lifecycle (not-started → running → won | failed). Reads
// aircraft state via the typed `AircraftState` interface from `aircraft/state.ts`
// (NOT via the `window.__aircraft` debug global). Allocation-free per tick:
// the `objectiveStates` array is preallocated at `start()` and the event
// callbacks are looked up from a Map of arrays (no per-tick array growth
// unless `on()` is called).
//
// Win/fail evaluation:
//   - `winCondition === 'all-objectives'`: all objective states `completed`.
//   - `failCondition === 'crash'`: position.y ≤ 0 AND |linvel.y| > CRASH_VSPEED_THRESHOLD
//     (a hard impact, not a gentle touchdown).
//   - `failCondition === 'timeout'`: elapsed ≥ mission.timeoutSec.
//   - `failCondition === 'out-of-bounds'`: |position.x| OR |position.z| > OUT_OF_BOUNDS_LIMIT
//     (4000m terrain + 1000m buffer).
//
// Objective evaluation:
//   - `reach-waypoint`: sphere check, ordered (lower `order` must complete first).
//   - `touchdown`: AABB on the runway + gentle vSpeed. One-shot.
//   - `destroy-target`: hook-driven — runner inspects `objectiveState.completed`
//     which only the script hook (WP16 combat-ai) writes.

import type { AircraftState } from '../aircraft/physics-core/state';
import { getHook, type HookFn, type HookState } from './hooks/registry';
import type {
  Mission,
  MissionStatus,
  Objective,
  ObjectiveState,
  ReachWaypointObjective,
  TouchdownObjective,
} from './types';

/**
 * Vertical-speed threshold above which a ground impact counts as a crash.
 * Below this, the aircraft is "landing" rather than crashing — touchdown
 * objectives have their own `maxVSpeed` for a stricter gentle-touchdown check.
 */
export const CRASH_VSPEED_THRESHOLD = 2; // m/s — empirical Phase 2 starting value
/**
 * Out-of-bounds limit on |x| and |z|. Matches the 4000m × 4000m terrain extent
 * with a 1000m forgiveness buffer (terrain is centered on origin per arch D4).
 */
export const OUT_OF_BOUNDS_LIMIT = 5000;

export type MissionEvent = 'objectiveChange' | 'statusChange';
export type MissionEventListener = () => void;

export class MissionRunner {
  private _mission: Mission | null = null;
  private _status: MissionStatus = 'not-started';
  private _objectiveStates: ObjectiveState[] = [];
  private _hookFn: HookFn | undefined = undefined;
  private _hookState: HookState = {};
  private _elapsed = 0;
  private _aborted = false;
  /**
   * WP16 Phase 4 — hook-driven fail flag. Set by a script hook via
   * `setHookFailFlag(reason)`; observed in the next `tick()`'s fail-evaluation
   * pass (after the hook returns). Reset to null in `start()`.
   */
  private _hookFailFlag: string | null = null;
  private readonly _listeners = new Map<MissionEvent, MissionEventListener[]>();

  /**
   * Start a mission. Resets all per-mission state, preallocates the
   * `objectiveStates` array sized to `mission.objectives.length`, and resolves
   * the script hook if `mission.scriptHook` is set. Throws if the named hook
   * is not registered (developer mistake — surface it).
   *
   * Elapsed time for the `timeout` fail condition is tracked via dt accumulation
   * in `tick()` — `start()` resets the accumulator to 0.
   */
  start(mission: Mission): void {
    this._mission = mission;
    this._status = 'running';
    this._elapsed = 0;
    this._aborted = false;
    this._hookFailFlag = null;
    this._hookState = {};
    if (mission.scriptHook !== undefined) {
      const fn = getHook(mission.scriptHook);
      if (fn === undefined) {
        throw new Error(
          `mission runner: scriptHook "${mission.scriptHook}" is not registered`,
        );
      }
      this._hookFn = fn;
    } else {
      this._hookFn = undefined;
    }
    // Preallocate objective state array — sized to mission.objectives.length.
    // Reuse existing entries when possible to minimise GC churn on restart.
    if (this._objectiveStates.length !== mission.objectives.length) {
      this._objectiveStates = mission.objectives.map(() => ({
        completed: false,
        meta: {},
      }));
    } else {
      for (let i = 0; i < this._objectiveStates.length; i++) {
        const s = this._objectiveStates[i]!;
        s.completed = false;
        // Reset meta in place: delete all keys (preserves the object identity
        // so external references stay valid — the hook may hold one).
        for (const k of Object.keys(s.meta)) delete s.meta[k];
      }
    }
    this._emit('statusChange');
  }

  tick(aircraft: AircraftState, dt: number): void {
    if (this._status !== 'running' || this._mission === null) return;
    this._elapsed += dt;

    // 1. Fire the script hook FIRST — it may mutate objective states (e.g.,
    //    destroy-target completion) which the objective-evaluation pass below
    //    must then observe in the same tick. Hook ordering relative to
    //    objective eval is deliberate; documented in arch.md D11.
    if (this._hookFn !== undefined) {
      this._hookFn(this._hookState, aircraft, this._objectiveStates, dt);
    }

    // 2. Objective evaluation (declarative kinds — destroy-target is
    //    hook-driven and only inspected here, not "evaluated").
    //    Ordering: among incomplete reach-waypoints, only the lowest `order`
    //    is eligible to complete this tick. Other kinds have no ordering.
    const mission = this._mission;
    let anyObjectiveChanged = false;
    // Find the lowest `order` among incomplete reach-waypoints.
    let minOpenWaypointOrder = Infinity;
    for (let i = 0; i < mission.objectives.length; i++) {
      const obj = mission.objectives[i]!;
      if (obj.kind !== 'reach-waypoint') continue;
      if (this._objectiveStates[i]!.completed) continue;
      if (obj.order < minOpenWaypointOrder) minOpenWaypointOrder = obj.order;
    }
    for (let i = 0; i < mission.objectives.length; i++) {
      const obj = mission.objectives[i]!;
      const state = this._objectiveStates[i]!;
      if (state.completed) continue;
      // Order gate: skip reach-waypoints that aren't the next-up.
      if (obj.kind === 'reach-waypoint' && obj.order !== minOpenWaypointOrder) {
        continue;
      }
      const justCompleted = evaluateObjective(obj, aircraft);
      if (justCompleted) {
        state.completed = true;
        anyObjectiveChanged = true;
      }
    }
    if (anyObjectiveChanged) {
      this._emit('objectiveChange');
    }

    // 3. Win evaluation (winCondition is parsed-defaulted to 'all-objectives').
    if ((mission.winCondition ?? 'all-objectives') === 'all-objectives') {
      // An empty objectives array does NOT auto-win — that would mean the
      // free-flight mission ends instantly. Free-flight has no win condition
      // in practice; it ends only on `crash`. Require ≥1 objective for a win.
      if (
        mission.objectives.length > 0 &&
        this._objectiveStates.every((s) => s.completed)
      ) {
        this._status = 'won';
        this._emit('statusChange');
        return;
      }
    }

    // 4. Fail evaluation.
    // 4a. Hook-driven fail flag — checked first so a hook signaling "player
    // shot down" (WP16 combat) terminates the mission regardless of the
    // declarative failCondition. Mutually exclusive with crash/timeout/oob.
    if (this._hookFailFlag !== null) {
      this._hookFailFlag = null;
      this._status = 'failed';
      this._emit('statusChange');
      return;
    }
    const failCondition = mission.failCondition ?? 'crash';
    if (failCondition === 'crash') {
      if (
        aircraft.position.y <= 0 &&
        Math.abs(aircraft.linvel.y) > CRASH_VSPEED_THRESHOLD
      ) {
        this._status = 'failed';
        this._emit('statusChange');
        return;
      }
    } else if (failCondition === 'timeout') {
      // `parseMission` enforces timeoutSec is present when failCondition='timeout'.
      if (this._elapsed >= mission.timeoutSec!) {
        this._status = 'failed';
        this._emit('statusChange');
        return;
      }
    } else if (failCondition === 'out-of-bounds') {
      if (
        Math.abs(aircraft.position.x) > OUT_OF_BOUNDS_LIMIT ||
        Math.abs(aircraft.position.z) > OUT_OF_BOUNDS_LIMIT
      ) {
        this._status = 'failed';
        this._emit('statusChange');
        return;
      }
    }
  }

  getStatus(): MissionStatus {
    return this._status;
  }

  /**
   * Hook-driven fail signal — sets a flag observed in the next `tick()`'s
   * fail-evaluation pass. Used by script hooks (e.g. WP16 combat-ai when
   * player HP reaches 0). No-op if the runner is not currently running.
   * The `reason` argument is currently informational only — the runner
   * does not surface it on the status-change event (Phase 4 keeps the
   * fail surface minimal).
   */
  setHookFailFlag(reason?: string): void {
    if (this._status !== 'running') return;
    this._hookFailFlag = reason ?? '';
  }

  /**
   * Player-initiated abort. Sets status to 'failed' and marks the run as
   * aborted so listeners can distinguish "player chose to leave" from a real
   * fail (crash / timeout / out-of-bounds) and skip the outcome banner. No-op
   * if the runner is not currently running. `start()` clears the abort flag,
   * so a restart after abort behaves normally.
   */
  abort(): void {
    if (this._status !== 'running') return;
    this._aborted = true;
    this._status = 'failed';
    this._emit('statusChange');
  }

  /**
   * True if the most recent terminal status transition came from `abort()`
   * rather than a natural fail condition. Cleared by `start()`.
   */
  wasAborted(): boolean {
    return this._aborted;
  }

  getObjectiveStates(): readonly ObjectiveState[] {
    return this._objectiveStates;
  }

  getElapsed(): number {
    return this._elapsed;
  }

  on(event: MissionEvent, cb: MissionEventListener): void {
    let arr = this._listeners.get(event);
    if (arr === undefined) {
      arr = [];
      this._listeners.set(event, arr);
    }
    arr.push(cb);
  }

  off(event: MissionEvent, cb: MissionEventListener): void {
    const arr = this._listeners.get(event);
    if (arr === undefined) return;
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }

  private _emit(event: MissionEvent): void {
    const arr = this._listeners.get(event);
    if (arr === undefined) return;
    for (let i = 0; i < arr.length; i++) arr[i]!();
  }
}

// Declarative-kind evaluators. Ordering for reach-waypoint is enforced by
// the caller (MissionRunner.tick). destroy-target is hook-driven — the runner
// doesn't evaluate it; the hook mutates `objectiveState.completed` directly.
function evaluateObjective(obj: Objective, aircraft: AircraftState): boolean {
  if (obj.kind === 'reach-waypoint') {
    return evaluateReachWaypoint(obj, aircraft);
  }
  if (obj.kind === 'touchdown') {
    return evaluateTouchdown(obj, aircraft);
  }
  // destroy-target: hook-driven; the runner inspects ObjectiveState.completed
  // (which the hook flipped); this evaluator path is unreachable in practice
  // because `tick` skips already-completed objectives.
  return false;
}

function evaluateReachWaypoint(
  obj: ReachWaypointObjective,
  aircraft: AircraftState,
): boolean {
  const dx = aircraft.position.x - obj.position.x;
  const dy = aircraft.position.y - obj.position.y;
  const dz = aircraft.position.z - obj.position.z;
  return dx * dx + dy * dy + dz * dz <= obj.radius * obj.radius;
}

function evaluateTouchdown(
  obj: TouchdownObjective,
  aircraft: AircraftState,
): boolean {
  const { center, halfExtents } = obj.runway;
  if (Math.abs(aircraft.position.x - center.x) > halfExtents.x) return false;
  if (Math.abs(aircraft.position.y - center.y) > halfExtents.y) return false;
  if (Math.abs(aircraft.position.z - center.z) > halfExtents.z) return false;
  // Gentle vSpeed check — only the magnitude of the vertical component matters.
  return Math.abs(aircraft.linvel.y) <= obj.maxVSpeed;
}
