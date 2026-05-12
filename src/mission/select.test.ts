// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MissionSelectScreen } from './select';
import type { MissionManifestEntry } from './types';

const MISSIONS: MissionManifestEntry[] = [
  { id: 'free-flight', name: 'Free Flight' },
  { id: 'waypoint-1', name: 'Waypoint Patrol' },
];

describe('MissionSelectScreen', () => {
  let screen: MissionSelectScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    screen = new MissionSelectScreen();
  });

  afterEach(() => {
    screen.hide();
  });

  it('show() renders a list of mission buttons matching the manifest', () => {
    screen.show(MISSIONS);
    const root = document.querySelector('[data-testid="mission-select"]');
    expect(root).not.toBeNull();
    const buttons = root!.querySelectorAll('button[data-mission-id]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute('data-mission-id')).toBe('free-flight');
    expect(buttons[0]!.textContent).toBe('Free Flight');
    expect(buttons[1]!.getAttribute('data-mission-id')).toBe('waypoint-1');
  });

  it('hide() removes the overlay from the DOM', () => {
    screen.show(MISSIONS);
    expect(document.querySelector('[data-testid="mission-select"]')).not.toBeNull();
    screen.hide();
    expect(document.querySelector('[data-testid="mission-select"]')).toBeNull();
  });

  it('isShown() reflects the overlay state', () => {
    expect(screen.isShown()).toBe(false);
    screen.show(MISSIONS);
    expect(screen.isShown()).toBe(true);
    screen.hide();
    expect(screen.isShown()).toBe(false);
  });

  it('clicking a button fires onSelect(id)', () => {
    const cb = vi.fn();
    screen.onSelect(cb);
    screen.show(MISSIONS);
    const btn = document.querySelector<HTMLButtonElement>('button[data-mission-id="waypoint-1"]');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('waypoint-1');
  });

  it('show() with errorForId renders an error banner', () => {
    screen.show(MISSIONS, { errorForId: 'does-not-exist' });
    const err = document.querySelector('[data-testid="mission-select-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain('does-not-exist');
    // Mission list still rendered (graceful fallback).
    const buttons = document.querySelectorAll('button[data-mission-id]');
    expect(buttons).toHaveLength(2);
  });

  it('show() called twice replaces the existing overlay (no duplicate)', () => {
    screen.show(MISSIONS);
    screen.show(MISSIONS);
    const roots = document.querySelectorAll('[data-testid="mission-select"]');
    expect(roots).toHaveLength(1);
  });

  it('showOutcome("won") renders a banner then removes it after the hold', async () => {
    vi.useFakeTimers();
    const promise = screen.showOutcome('won', 'Free Flight', 1000);
    // Immediately after the call, the banner should be in the DOM.
    const banner = document.querySelector('[data-testid="mission-outcome-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('MISSION COMPLETE');
    expect(banner!.textContent).toContain('Free Flight');
    // Advance time past the hold; banner is removed.
    vi.advanceTimersByTime(1000);
    await promise;
    expect(document.querySelector('[data-testid="mission-outcome-banner"]')).toBeNull();
    vi.useRealTimers();
  });

  it('showOutcome("failed") banner says MISSION FAILED', async () => {
    vi.useFakeTimers();
    const promise = screen.showOutcome('failed', 'Waypoint Patrol', 500);
    const banner = document.querySelector('[data-testid="mission-outcome-banner"]');
    expect(banner!.textContent).toContain('MISSION FAILED');
    vi.advanceTimersByTime(500);
    await promise;
    vi.useRealTimers();
  });
});
