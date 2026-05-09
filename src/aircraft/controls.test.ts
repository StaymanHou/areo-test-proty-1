import { describe, it, expect, beforeEach } from 'vitest';
import { InputManager, DEFAULT_KEY_MAP } from '../engine/input';
import { Controls } from './controls';

function makeTarget(): EventTarget {
  return new EventTarget();
}

function keyDown(target: EventTarget, code: string) {
  target.dispatchEvent(Object.assign(new Event('keydown'), { code }));
}

function keyUp(target: EventTarget, code: string) {
  target.dispatchEvent(Object.assign(new Event('keyup'), { code }));
}

describe('Controls', () => {
  let target: EventTarget;
  let input: InputManager;
  let controls: Controls;

  beforeEach(() => {
    target = makeTarget();
    input = new InputManager(target);
    controls = new Controls(input);
  });

  it('default values are all zero', () => {
    expect(controls.aileron).toBe(0);
    expect(controls.elevator).toBe(0);
    expect(controls.rudder).toBe(0);
    expect(controls.throttle).toBe(0);
  });

  it('holding rollRight ramps aileron toward +1 at default rate', () => {
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    // default stickRate=5.0, so 0.1s should produce 0.5
    controls.update(0.1);
    expect(controls.aileron).toBeCloseTo(0.5, 5);
    // after another 0.1s, full +1 (and clamps)
    controls.update(0.1);
    expect(controls.aileron).toBeCloseTo(1.0, 5);
    // further updates stay clamped
    controls.update(0.1);
    expect(controls.aileron).toBe(1);
  });

  it('holding rollLeft ramps aileron toward −1', () => {
    keyDown(target, DEFAULT_KEY_MAP.rollLeft);
    controls.update(0.1);
    expect(controls.aileron).toBeCloseTo(-0.5, 5);
    controls.update(0.5);
    expect(controls.aileron).toBe(-1);
  });

  it('releasing rollRight decays aileron back toward 0', () => {
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    controls.update(0.2);
    expect(controls.aileron).toBe(1);
    keyUp(target, DEFAULT_KEY_MAP.rollRight);
    controls.update(0.1);
    expect(controls.aileron).toBeCloseTo(0.5, 5);
    controls.update(0.5);
    expect(controls.aileron).toBe(0);
  });

  it('holding both rollLeft and rollRight cancels (axis ramps to 0)', () => {
    // First push aileron to +1
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    controls.update(0.5);
    expect(controls.aileron).toBe(1);
    // Now hold both
    keyDown(target, DEFAULT_KEY_MAP.rollLeft);
    controls.update(0.1);
    expect(controls.aileron).toBeCloseTo(0.5, 5);
    controls.update(0.5);
    expect(controls.aileron).toBe(0);
  });

  it('elevator and rudder follow the same axis pattern', () => {
    keyDown(target, DEFAULT_KEY_MAP.pitchUp);
    keyDown(target, DEFAULT_KEY_MAP.yawRight);
    controls.update(0.1);
    expect(controls.elevator).toBeCloseTo(0.5, 5);
    expect(controls.rudder).toBeCloseTo(0.5, 5);
  });

  it('pitchDown drives elevator negative', () => {
    keyDown(target, DEFAULT_KEY_MAP.pitchDown);
    controls.update(0.1);
    expect(controls.elevator).toBeCloseTo(-0.5, 5);
  });

  it('holding throttleUp ramps throttle 0→1 over 2s at default rate', () => {
    keyDown(target, DEFAULT_KEY_MAP.throttleUp);
    // simulate 60 ticks of 1/60s = 1 second
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    expect(controls.throttle).toBeCloseTo(0.5, 3);
    // simulate well past 2s → clamped
    for (let i = 0; i < 200; i++) controls.update(1 / 60);
    expect(controls.throttle).toBe(1);
  });

  it('releasing throttle keys holds the current throttle value', () => {
    keyDown(target, DEFAULT_KEY_MAP.throttleUp);
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    const held = controls.throttle;
    keyUp(target, DEFAULT_KEY_MAP.throttleUp);
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    expect(controls.throttle).toBe(held);
  });

  it('throttleDown decreases throttle from a non-zero starting value', () => {
    keyDown(target, DEFAULT_KEY_MAP.throttleUp);
    for (let i = 0; i < 200; i++) controls.update(1 / 60);
    expect(controls.throttle).toBe(1);
    keyUp(target, DEFAULT_KEY_MAP.throttleUp);
    keyDown(target, DEFAULT_KEY_MAP.throttleDown);
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    expect(controls.throttle).toBeCloseTo(0.5, 3);
  });

  it('throttle clamps at 0 (no negative)', () => {
    keyDown(target, DEFAULT_KEY_MAP.throttleDown);
    controls.update(10);
    expect(controls.throttle).toBe(0);
  });

  it('pressing both throttle keys holds throttle value', () => {
    keyDown(target, DEFAULT_KEY_MAP.throttleUp);
    controls.update(1.0); // throttle = 0.5
    keyDown(target, DEFAULT_KEY_MAP.throttleDown);
    const held = controls.throttle;
    controls.update(1.0);
    expect(controls.throttle).toBe(held);
  });

  it('honors a custom keyMap override', () => {
    const customControls = new Controls(input, {
      keyMap: { ...DEFAULT_KEY_MAP, rollRight: 'KeyJ' },
    });
    keyDown(target, 'KeyJ');
    customControls.update(0.1);
    expect(customControls.aileron).toBeCloseTo(0.5, 5);
  });

  it('honors custom stickRate', () => {
    const slow = new Controls(input, { stickRate: 1.0 });
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    slow.update(0.5);
    expect(slow.aileron).toBeCloseTo(0.5, 5);
  });

  it('honors custom throttleRate', () => {
    const fast = new Controls(input, { throttleRate: 1.0 });
    keyDown(target, DEFAULT_KEY_MAP.throttleUp);
    fast.update(0.5);
    expect(fast.throttle).toBeCloseTo(0.5, 5);
  });
});
