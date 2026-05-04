import { describe, it, expect, beforeEach } from 'vitest';
import { InputManager } from './input';

function makeTarget() {
  // Minimal EventTarget that supports addEventListener/removeEventListener
  return new EventTarget();
}

function keyDown(target: EventTarget, code: string) {
  target.dispatchEvent(Object.assign(new Event('keydown'), { code }));
}

function keyUp(target: EventTarget, code: string) {
  target.dispatchEvent(Object.assign(new Event('keyup'), { code }));
}

function mouseMove(target: EventTarget, movementX: number, movementY: number) {
  target.dispatchEvent(
    Object.assign(new Event('mousemove'), { movementX, movementY, clientX: 0, clientY: 0 }),
  );
}

describe('InputManager', () => {
  let target: EventTarget;
  let im: InputManager;

  beforeEach(() => {
    target = makeTarget();
    im = new InputManager(target);
  });

  it('isDown true after keydown, false after keyup', () => {
    keyDown(target, 'KeyW');
    expect(im.isDown('KeyW')).toBe(true);
    keyUp(target, 'KeyW');
    expect(im.isDown('KeyW')).toBe(false);
  });

  it('wasPressed true on the frame the key is first pressed', () => {
    keyDown(target, 'KeyW');
    expect(im.wasPressed('KeyW')).toBe(true);
  });

  it('wasPressed false after flush()', () => {
    keyDown(target, 'KeyW');
    im.flush();
    expect(im.wasPressed('KeyW')).toBe(false);
  });

  it('wasPressed false if key was already held before this frame', () => {
    keyDown(target, 'KeyW');
    im.flush(); // first frame over — key still held
    keyDown(target, 'KeyW'); // repeat keydown (key still held, no state change)
    expect(im.wasPressed('KeyW')).toBe(false);
  });

  it('mouseDelta accumulates multiple moves in one frame', () => {
    mouseMove(target, 3, 4);
    mouseMove(target, 1, 2);
    expect(im.state.mouseDelta.x).toBe(4);
    expect(im.state.mouseDelta.y).toBe(6);
  });

  it('mouseDelta resets to zero after flush()', () => {
    mouseMove(target, 10, 20);
    im.flush();
    expect(im.state.mouseDelta.x).toBe(0);
    expect(im.state.mouseDelta.y).toBe(0);
  });

  it('dispose removes all listeners (no events processed after dispose)', () => {
    im.dispose();
    keyDown(target, 'KeyW');
    expect(im.isDown('KeyW')).toBe(false);
  });

  it('simultaneous multi-key hold — all keys reported as down', () => {
    keyDown(target, 'KeyW');
    keyDown(target, 'ArrowUp');
    keyDown(target, 'Space');
    expect(im.isDown('KeyW')).toBe(true);
    expect(im.isDown('ArrowUp')).toBe(true);
    expect(im.isDown('Space')).toBe(true);
    expect(im.state.keys.size).toBe(3);
  });
});
