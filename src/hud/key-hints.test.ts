// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyHintsOverlay } from './key-hints';

describe('KeyHintsOverlay', () => {
  let hints: KeyHintsOverlay;

  beforeEach(() => {
    document.body.innerHTML = '';
    hints = new KeyHintsOverlay();
  });

  afterEach(() => {
    hints.hide();
  });

  it('show() mounts root with the key-hints testid', () => {
    expect(document.querySelector('[data-testid="key-hints"]')).toBeNull();
    hints.show('free-flight');
    expect(document.querySelector('[data-testid="key-hints"]')).not.toBeNull();
    expect(hints.isMounted()).toBe(true);
  });

  it('hide() detaches the root and resets the elapsed timer', () => {
    hints.show('free-flight');
    hints.update(5);
    expect(hints.getElapsedSec()).toBeGreaterThan(0);
    hints.hide();
    expect(document.querySelector('[data-testid="key-hints"]')).toBeNull();
    expect(hints.isMounted()).toBe(false);
    expect(hints.getElapsedSec()).toBe(0);
  });

  it('show() lists common bindings — Pitch, Roll, Yaw, Throttle, Camera, Abort', () => {
    hints.show('free-flight');
    const root = document.querySelector('[data-testid="key-hints"]');
    const text = root?.textContent ?? '';
    expect(text).toContain('Pitch');
    expect(text).toContain('Roll');
    expect(text).toContain('Yaw');
    expect(text).toContain('Throttle');
    expect(text).toContain('Camera');
    expect(text).toContain('Abort');
    expect(text).toContain('W / S'); // pitch keys
    expect(text).toContain('Esc'); // abort key
  });

  it('show("combat") includes the Fire/Space binding; non-combat does NOT', () => {
    hints.show('combat');
    expect(document.querySelector('[data-testid="key-hints"]')?.textContent).toContain('Fire');
    expect(document.querySelector('[data-testid="key-hints"]')?.textContent).toContain('Space');

    hints.show('free-flight');
    const ffText = document.querySelector('[data-testid="key-hints"]')?.textContent ?? '';
    expect(ffText).not.toContain('Fire');
    expect(ffText).not.toContain('Space');
  });

  it('update() leaves opacity at 1.0 during the first 10s', () => {
    hints.show('free-flight');
    hints.update(0); // tick at t=0
    expect(hints.getOpacity()).toBe(1);
    hints.update(5);
    expect(hints.getOpacity()).toBe(1);
    hints.update(4.999); // total elapsed = 9.999s
    expect(hints.getOpacity()).toBe(1);
  });

  it('update() linearly fades opacity from 1.0→0.0 between 10s and 20s', () => {
    hints.show('free-flight');
    hints.update(15); // total elapsed = 15s — halfway through fade
    expect(hints.getOpacity()).toBeCloseTo(0.5, 2);
  });

  it('update() detaches the overlay after the remove threshold (~21s)', () => {
    hints.show('free-flight');
    hints.update(22);
    expect(document.querySelector('[data-testid="key-hints"]')).toBeNull();
    expect(hints.isMounted()).toBe(false);
  });

  it('show() resets the elapsed timer — replay-friendly per mission entry', () => {
    hints.show('free-flight');
    hints.update(15);
    expect(hints.getOpacity()).toBeLessThan(1);
    hints.show('free-flight'); // fresh re-entry
    expect(hints.getElapsedSec()).toBe(0);
    expect(hints.getOpacity()).toBe(1);
    expect(document.querySelectorAll('[data-testid="key-hints"]')).toHaveLength(1);
  });
});
