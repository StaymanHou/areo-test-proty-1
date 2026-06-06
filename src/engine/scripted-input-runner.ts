// Scripted-input runner — drives the in-game pipeline deterministically at
// the fixed-timestep tick boundary.
//
// Design (AD-SH1 from spec): writes directly to `InputManager.state.keys` and
// `Controls.throttle` at each onPhysics callback. The DOM event layer
// (KeyboardEvent / dispatchEvent) is bypassed entirely — that's the determinism
// win.
//
// Hot-path discipline: per-tick log row is appended to a pre-allocated array;
// no Vector3 / Quaternion allocations in the tick handler. The Euler
// extraction reuses a module-scoped scratch Euler.

import { Euler, Quaternion, Vector3 } from 'three';
import type { InputManager } from './input';
import type { Controls } from '../aircraft/controls';
import type { ScriptedEvent, ScriptedInputPlan } from './scripted-input';
import type { BodyState } from '../aircraft/physics-core/aerosurface';

export interface ScriptedLogRow {
  tick: number;
  t_sec: number;
  position: { x: number; y: number; z: number };
  linvel: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  angvel: { x: number; y: number; z: number };
  pitch_deg: number;
  roll_deg: number;
  yaw_deg: number;
  AS_mps: number;
  /** Wing-frame angle of attack (degrees). Computed body-local. */
  alpha_deg: number;
  /** Body-frame sideslip angle (degrees). */
  beta_deg: number;
  throttle: number;
}

const RAD2DEG = 180 / Math.PI;

// Module-scoped scratch buffers for the per-tick alpha/beta + euler extraction.
// Vector3/Quaternion/Euler are re-used across calls — allocation-free hot path.
const _scratchEuler = new Euler(0, 0, 0, 'YXZ');
const _scratchQuatInv = new Quaternion();
const _scratchLocalFlow = new Vector3();
const _scratchBodyForward = new Vector3();
const _BODY_FORWARD_REF = Object.freeze(new Vector3(0, 0, -1));

/**
 * Drives in-game input deterministically based on a parsed ScriptedInputPlan.
 * Constructed once at boot when `?script=...` is present; ticked from main.ts
 * `onPhysics` after `controls.update(dt)` so writes shadow user input.
 */
export class ScriptedInputRunner {
  private readonly plan: ScriptedInputPlan;
  private readonly input: InputManager;
  private readonly controls: Controls;
  private readonly log: ScriptedLogRow[] = [];

  /** Tick counter, increments once per onPhysics. */
  private tickIdx = 0;
  /** Cache: max endTick across all events (resolved to plan.logCapacityTicks for 'end'). */
  private readonly maxEndTick: number;
  /** Currently held keys synthesized by this runner; cleared at end-of-window. */
  private readonly heldKeys = new Set<string>();
  /**
   * Latched true the first tick `isComplete()` would return true. Subsequent
   * ticks no-op on log append so the log buffer is byte-stable across
   * Playwright observation timing. Critical for the determinism gate.
   */
  private frozen = false;

  constructor(plan: ScriptedInputPlan, input: InputManager, controls: Controls) {
    this.plan = plan;
    this.input = input;
    this.controls = controls;
    this.maxEndTick = computeMaxEndTick(plan);
  }

  /**
   * Per-tick entry point. Called from main.ts onPhysics AFTER controls.update(dt)
   * — this ordering matters: scripted writes shadow the user's input for the
   * same tick.
   */
  tick(bodyState: BodyState): void {
    // Once isComplete latches true, the runner stops touching state. This
    // makes the log buffer byte-stable across Playwright observation timing
    // (the determinism gate) — without this, the log can grow by 0-N rows
    // between `isScriptComplete()===true` and `getScriptedLog()`.
    if (this.frozen) return;

    // 1. Apply key events: synthesize key-down for each active event.
    //    Track which keys are active this tick so we can release stale holds.
    const activeKeysThisTick = new Set<string>();
    for (const ev of this.plan.events) {
      if (!isActiveAt(ev, this.tickIdx, this.plan.logCapacityTicks)) continue;
      if (ev.kind === 'key') {
        this.input.state.keys.add(ev.code);
        activeKeysThisTick.add(ev.code);
      } else {
        // throttle override — write directly to Controls.throttle each tick
        this.controls.throttle = ev.value;
      }
    }

    // Release previously-held keys that are no longer active.
    for (const code of this.heldKeys) {
      if (!activeKeysThisTick.has(code)) {
        this.input.state.keys.delete(code);
      }
    }
    this.heldKeys.clear();
    for (const code of activeKeysThisTick) this.heldKeys.add(code);

    // 2. Append log row (capacity-bounded).
    if (this.log.length < this.plan.logCapacityTicks) {
      this.log.push(buildLogRow(this.tickIdx, bodyState, this.controls.throttle));
    }

    this.tickIdx += 1;

    // 3. Latch frozen on transition to complete. Release any keys still held
    //    so the rest of the game loop doesn't see ghost input.
    if (this.checkCompleteRaw()) {
      this.frozen = true;
      for (const code of this.heldKeys) this.input.state.keys.delete(code);
      this.heldKeys.clear();
    }
  }

  /** Defensive snapshot of the log buffer (chronological). */
  getLog(): ScriptedLogRow[] {
    // Shallow copy — rows are plain data so JSON.stringify is stable.
    return this.log.slice();
  }

  /**
   * True after all scripted events have ended AND the settle window has elapsed,
   * OR if the runner has been frozen (deterministic latch). Once true, stays true.
   */
  isComplete(): boolean {
    return this.frozen || this.checkCompleteRaw();
  }

  private checkCompleteRaw(): boolean {
    if (this.maxEndTick === Number.POSITIVE_INFINITY) {
      return this.log.length >= this.plan.logCapacityTicks;
    }
    return this.tickIdx >= this.maxEndTick + this.plan.settleTicks;
  }
}

function isActiveAt(
  ev: ScriptedEvent,
  tickIdx: number,
  logCapacity: number,
): boolean {
  if (tickIdx < ev.startTick) return false;
  const end = ev.endTick === 'end' ? logCapacity : ev.endTick;
  return tickIdx < end;
}

function computeMaxEndTick(plan: ScriptedInputPlan): number {
  // If no events, complete immediately (settleTicks still applies).
  if (plan.events.length === 0) return 0;
  let max = 0;
  let hasUnbounded = false;
  for (const ev of plan.events) {
    if (ev.endTick === 'end') {
      hasUnbounded = true;
    } else if (ev.endTick > max) {
      max = ev.endTick;
    }
  }
  // Unbounded events without any bounded counterpart → infinity (log-fill gate).
  if (hasUnbounded && max === 0) return Number.POSITIVE_INFINITY;
  return max;
}

function buildLogRow(
  tickIdx: number,
  body: BodyState,
  throttle: number,
): ScriptedLogRow {
  // Euler from quaternion (YXZ — matches main.ts telemetry convention). Used
  // for roll/yaw which don't suffer the pitch-axis gimbal-lock problem.
  _scratchEuler.setFromQuaternion(body.quaternion, 'YXZ');

  // Pitch derived from body-forward via atan2 — gimbal-lock-free across the
  // full ±180° rotation range. Euler YXZ .x caps at ±90° even when the body
  // has rotated past that, which would hide a backflip. (Same fix shape as
  // pitch-envelope.test.ts extractPitchDeg.)
  _scratchBodyForward.copy(_BODY_FORWARD_REF).applyQuaternion(body.quaternion);
  const pitchRad = Math.atan2(_scratchBodyForward.y, -_scratchBodyForward.z);

  // Body-local airflow for alpha/beta. World linvel rotated by inverse body quat.
  _scratchQuatInv.copy(body.quaternion).invert();
  _scratchLocalFlow.copy(body.linvel).applyQuaternion(_scratchQuatInv);

  // For a body whose nominal forward axis is -Z (per CONVENTIONS.md), the
  // body-frame airflow components are:
  //   localFlow.x = lateral component → drives β (sideslip)
  //   localFlow.y = vertical component → drives α (angle of attack)
  //   localFlow.z = longitudinal component (negative when moving forward)
  //
  // α = atan2(localFlow.y, -localFlow.z)   (positive when nose pitches into rising flow)
  // β = atan2(localFlow.x, -localFlow.z)
  const fwd = -_scratchLocalFlow.z;
  const alphaRad = Math.atan2(_scratchLocalFlow.y, fwd);
  const betaRad = Math.atan2(_scratchLocalFlow.x, fwd);

  const lv = body.linvel;
  const AS = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);

  return {
    tick: tickIdx,
    t_sec: tickIdx / 60,
    position: { x: body.position.x, y: body.position.y, z: body.position.z },
    linvel: { x: lv.x, y: lv.y, z: lv.z },
    rotation: {
      x: body.quaternion.x,
      y: body.quaternion.y,
      z: body.quaternion.z,
      w: body.quaternion.w,
    },
    angvel: { x: body.angvel.x, y: body.angvel.y, z: body.angvel.z },
    pitch_deg: pitchRad * RAD2DEG,
    roll_deg: _scratchEuler.z * RAD2DEG,
    yaw_deg: _scratchEuler.y * RAD2DEG,
    AS_mps: AS,
    alpha_deg: alphaRad * RAD2DEG,
    beta_deg: betaRad * RAD2DEG,
    throttle,
  };
}
