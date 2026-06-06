import { describe, it, expect, beforeEach } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { ScriptedInputRunner } from './scripted-input-runner';
import type { ScriptedInputPlan } from './scripted-input';
import { InputManager } from './input';
import { Controls } from '../aircraft/controls';

function makeBodyState() {
  return {
    position: new Vector3(0, 100, 0),
    quaternion: new Quaternion(0, 0, 0, 1),
    linvel: new Vector3(0, 0, -78),
    angvel: new Vector3(0, 0, 0),
  };
}

function basePlan(overrides: Partial<ScriptedInputPlan> = {}): ScriptedInputPlan {
  return {
    events: [],
    settleTicks: 60,
    configName: null,
    logCapacityTicks: 600,
    ...overrides,
  };
}

describe('ScriptedInputRunner', () => {
  let input: InputManager;
  let controls: Controls;
  let body: ReturnType<typeof makeBodyState>;

  beforeEach(() => {
    input = new InputManager(new EventTarget());
    controls = new Controls(input);
    body = makeBodyState();
  });

  it('synthesizes key-down for the active window only', () => {
    const plan = basePlan({
      events: [{ kind: 'key', code: 'ArrowUp', startTick: 60, endTick: 120 }],
    });
    const runner = new ScriptedInputRunner(plan, input, controls);

    // Pre-window
    for (let i = 0; i < 60; i++) runner.tick(body);
    expect(input.state.keys.has('ArrowUp')).toBe(false);

    // In-window
    runner.tick(body);
    expect(input.state.keys.has('ArrowUp')).toBe(true);

    // Continue through window — tickIdx is now 61 after the in-window tick above.
    // End-tick exclusive: ticks 60..119 are in-window; tick 120 is out.
    for (let i = 0; i < 59; i++) runner.tick(body); // processes tickIdx 61..119; key still held
    expect(input.state.keys.has('ArrowUp')).toBe(true);
    runner.tick(body); // processes tickIdx=120 (out of window) → released
    expect(input.state.keys.has('ArrowUp')).toBe(false);
  });

  it('writes throttle override directly to controls.throttle', () => {
    const plan = basePlan({
      events: [{ kind: 'throttle', value: 0.6, startTick: 0, endTick: 60 }],
    });
    const runner = new ScriptedInputRunner(plan, input, controls);

    controls.throttle = 0; // baseline
    runner.tick(body); // tick 0
    expect(controls.throttle).toBe(0.6);

    for (let i = 0; i < 60; i++) runner.tick(body);
    // Window ends at tick 60; tick 60 is NOT in window (endTick exclusive)
    expect(controls.throttle).toBe(0.6); // still last-set; runner does not reset throttle
  });

  it('isComplete waits for settle window after last endTick', () => {
    const plan = basePlan({
      events: [{ kind: 'key', code: 'KeyD', startTick: 0, endTick: 60 }],
      settleTicks: 30,
    });
    const runner = new ScriptedInputRunner(plan, input, controls);

    for (let i = 0; i < 60; i++) runner.tick(body);
    expect(runner.isComplete()).toBe(false); // end reached, not settled

    for (let i = 0; i < 29; i++) runner.tick(body);
    expect(runner.isComplete()).toBe(false);

    runner.tick(body); // tick 90 = 60 endTick + 30 settle
    expect(runner.isComplete()).toBe(true);
  });

  it('appends one log row per tick up to capacity', () => {
    const plan = basePlan({ logCapacityTicks: 5 });
    const runner = new ScriptedInputRunner(plan, input, controls);
    for (let i = 0; i < 10; i++) runner.tick(body);
    const log = runner.getLog();
    expect(log).toHaveLength(5);
    expect(log[0]!.tick).toBe(0);
    expect(log[4]!.tick).toBe(4);
  });

  it('log row contains expected flight-feel fields', () => {
    const plan = basePlan();
    const runner = new ScriptedInputRunner(plan, input, controls);
    runner.tick(body);
    const row = runner.getLog()[0]!;
    expect(row.tick).toBe(0);
    expect(row.t_sec).toBe(0);
    expect(row.position).toEqual({ x: 0, y: 100, z: 0 });
    expect(row.AS_mps).toBeCloseTo(78, 5);
    // At identity quaternion + level flight (linvel=-Z), alpha/beta ≈ 0
    expect(Math.abs(row.alpha_deg)).toBeLessThan(0.01);
    expect(Math.abs(row.beta_deg)).toBeLessThan(0.01);
    expect(row.throttle).toBe(0);
  });

  it('overlapping key events leave both keys held during overlap', () => {
    const plan = basePlan({
      events: [
        { kind: 'key', code: 'KeyD', startTick: 0, endTick: 60 },
        { kind: 'key', code: 'ArrowUp', startTick: 30, endTick: 90 },
      ],
    });
    const runner = new ScriptedInputRunner(plan, input, controls);

    for (let i = 0; i < 30; i++) runner.tick(body);
    expect(input.state.keys.has('KeyD')).toBe(true);
    expect(input.state.keys.has('ArrowUp')).toBe(false);

    runner.tick(body); // tick 30
    expect(input.state.keys.has('KeyD')).toBe(true);
    expect(input.state.keys.has('ArrowUp')).toBe(true);

    for (let i = 0; i < 30; i++) runner.tick(body); // through tick 60
    expect(input.state.keys.has('KeyD')).toBe(false); // released at endTick 60
    expect(input.state.keys.has('ArrowUp')).toBe(true);
  });

  it('end-keyword event held to log capacity', () => {
    const plan = basePlan({
      events: [{ kind: 'key', code: 'ArrowUp', startTick: 0, endTick: 'end' }],
      logCapacityTicks: 100,
    });
    const runner = new ScriptedInputRunner(plan, input, controls);
    for (let i = 0; i < 99; i++) runner.tick(body);
    expect(input.state.keys.has('ArrowUp')).toBe(true);
    // Not complete until log fills (unbounded path)
    expect(runner.isComplete()).toBe(false);
    runner.tick(body); // tick 99 fills log to 100 rows
    expect(runner.isComplete()).toBe(true);
  });

  it('isComplete waits for settle window even with no events scheduled', () => {
    const plan = basePlan(); // empty events
    const runner = new ScriptedInputRunner(plan, input, controls);
    // settleTicks=60, maxEndTick=0 → complete when tickIdx ≥ 60
    for (let i = 0; i < 59; i++) runner.tick(body); // tickIdx = 59
    expect(runner.isComplete()).toBe(false);
    runner.tick(body); // tickIdx = 60
    expect(runner.isComplete()).toBe(true);
  });
});
