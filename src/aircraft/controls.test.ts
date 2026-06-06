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
    // Existing ramp/throttle/keymap tests assert raw post-ramp values; pin to
    // 'linear' so the cubic curve doesn't perturb the math. Curve behavior is
    // covered in the separate `stickCurve` describe block below.
    controls = new Controls(input, { stickCurve: 'linear' });
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
      stickCurve: 'linear',
    });
    keyDown(target, 'KeyJ');
    customControls.update(0.1);
    expect(customControls.aileron).toBeCloseTo(0.5, 5);
  });

  it('honors custom stickRate', () => {
    const slow = new Controls(input, { stickRate: 1.0, stickCurve: 'linear' });
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    slow.update(0.5);
    expect(slow.aileron).toBeCloseTo(0.5, 5);
  });

  it('honors custom throttleRate', () => {
    const fast = new Controls(input, { throttleRate: 1.0, stickCurve: 'linear' });
    keyDown(target, DEFAULT_KEY_MAP.throttleUp);
    fast.update(0.5);
    expect(fast.throttle).toBeCloseTo(0.5, 5);
  });
});

describe('Controls — stickCurve', () => {
  let target: EventTarget;
  let input: InputManager;

  beforeEach(() => {
    target = makeTarget();
    input = new InputManager(target);
  });

  it('default curve is cubic expo (softens small inputs, preserves authority)', () => {
    const c = new Controls(input);
    expect(c.stickCurve).toBe('cubic');
  });

  it('cubic curve: half-deflection raw input outputs ~0.3125', () => {
    const c = new Controls(input); // default cubic
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    // stickRate=5.0, dt=0.1 → raw aileron = 0.5
    c.update(0.1);
    // f(0.5) = 0.5·0.5 + 0.5·0.125 = 0.25 + 0.0625 = 0.3125
    expect(c.aileron).toBeCloseTo(0.3125, 5);
  });

  it('cubic curve: small input is softened (raw 0.1 → 0.0505)', () => {
    const c = new Controls(input, { stickRate: 1.0 }); // slow ramp
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    // dt=0.1, stickRate=1.0 → raw=0.1
    c.update(0.1);
    // f(0.1) = 0.05 + 0.0005 = 0.0505
    expect(c.aileron).toBeCloseTo(0.0505, 5);
  });

  it('cubic curve: full deflection preserved (raw ±1 → ±1)', () => {
    const c = new Controls(input);
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    c.update(1.0); // raw clamps at +1
    expect(c.aileron).toBeCloseTo(1.0, 5);

    keyUp(target, DEFAULT_KEY_MAP.rollRight);
    keyDown(target, DEFAULT_KEY_MAP.rollLeft);
    c.update(1.0); // raw drives to -1
    expect(c.aileron).toBeCloseTo(-1.0, 5);
  });

  it('cubic curve: sign is preserved (odd function)', () => {
    const c = new Controls(input);
    keyDown(target, DEFAULT_KEY_MAP.rollLeft);
    c.update(0.1); // raw = -0.5
    expect(c.aileron).toBeCloseTo(-0.3125, 5);
  });

  it('cubic curve applies to all three stick axes (aileron, elevator, rudder)', () => {
    const c = new Controls(input);
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    keyDown(target, DEFAULT_KEY_MAP.pitchUp);
    keyDown(target, DEFAULT_KEY_MAP.yawRight);
    c.update(0.1);
    expect(c.aileron).toBeCloseTo(0.3125, 5);
    expect(c.elevator).toBeCloseTo(0.3125, 5);
    expect(c.rudder).toBeCloseTo(0.3125, 5);
  });

  it('cubic curve does not affect throttle', () => {
    const c = new Controls(input);
    keyDown(target, DEFAULT_KEY_MAP.throttleUp);
    c.update(1.0); // throttleRate=0.5, dt=1.0 → throttle = 0.5
    expect(c.throttle).toBeCloseTo(0.5, 5);
  });

  it('linear curve is pure pass-through (raw value equals output)', () => {
    const c = new Controls(input, { stickCurve: 'linear' });
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    c.update(0.1);
    expect(c.aileron).toBeCloseTo(0.5, 5);
    c.update(0.1);
    expect(c.aileron).toBeCloseTo(1.0, 5);
  });

  it('curve is applied at read-time — switching stickCurve mid-flight retunes feel without losing position', () => {
    const c = new Controls(input);
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    c.update(0.1); // raw = 0.5; cubic = 0.3125
    expect(c.aileron).toBeCloseTo(0.3125, 5);
    c.stickCurve = 'linear';
    c.update(0); // re-pump update with dt=0 to re-evaluate the curve
    expect(c.aileron).toBeCloseTo(0.5, 5);
  });
});

describe('Controls.resetSticks', () => {
  let target: EventTarget;
  let input: InputManager;

  beforeEach(() => {
    target = makeTarget();
    input = new InputManager(target);
  });

  it('zeros all three stick axes without touching throttle', () => {
    const c = new Controls(input, { stickCurve: 'linear' });
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    keyDown(target, DEFAULT_KEY_MAP.pitchUp);
    keyDown(target, DEFAULT_KEY_MAP.yawRight);
    keyDown(target, DEFAULT_KEY_MAP.throttleUp);
    c.update(0.5);
    expect(c.aileron).toBeCloseTo(1.0, 5);
    expect(c.elevator).toBeCloseTo(1.0, 5);
    expect(c.rudder).toBeCloseTo(1.0, 5);
    const throttleBefore = c.throttle;

    c.resetSticks();

    expect(c.aileron).toBe(0);
    expect(c.elevator).toBe(0);
    expect(c.rudder).toBe(0);
    expect(c.throttle).toBe(throttleBefore);
  });

  it('clears raw pre-curve buffer (subsequent zero-dt update keeps sticks at 0)', () => {
    const c = new Controls(input); // cubic default
    keyDown(target, DEFAULT_KEY_MAP.rollRight);
    c.update(0.5); // raw ramps to +1
    c.resetSticks();
    keyUp(target, DEFAULT_KEY_MAP.rollRight);
    c.update(0); // no input held; if raw weren't reset it'd still read non-zero
    expect(c.aileron).toBe(0);
  });
});
