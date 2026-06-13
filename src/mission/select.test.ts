// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MissionSelectScreen } from './select';
import type { MissionManifestEntry } from './types';
import { AIRFRAME_STORAGE_KEY, getSelectedAirframe } from './aircraft-options';
import { MASTER_VOLUME_STORAGE_KEY, getMasterVolume } from '../audio/master-volume';

const MISSIONS: MissionManifestEntry[] = [
  { id: 'free-flight', name: 'Free Flight' },
  { id: 'waypoint-1', name: 'Waypoint Patrol' },
];

describe('MissionSelectScreen', () => {
  let screen: MissionSelectScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
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

describe('MissionSelectScreen — aircraft picker (WP24)', () => {
  let screen: MissionSelectScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    screen = new MissionSelectScreen();
  });

  afterEach(() => {
    screen.hide();
  });

  it('renders an aircraft-picker with at least Trainer (Cessna) + Jet (MiG-15)', () => {
    screen.show(MISSIONS);
    const picker = document.querySelector('[data-testid="aircraft-picker"]');
    expect(picker).not.toBeNull();
    const buttons = picker!.querySelectorAll('button[data-airframe-id]');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const ids = Array.from(buttons).map((b) => b.getAttribute('data-airframe-id'));
    expect(ids).toContain('default');
    expect(ids).toContain('mig15');
  });

  it('button labels read "<Class> (<Airframe>)"', () => {
    screen.show(MISSIONS);
    const defaultBtn = document.querySelector('button[data-airframe-id="default"]');
    const jetBtn = document.querySelector('button[data-airframe-id="mig15"]');
    expect(defaultBtn!.textContent).toBe('Trainer (Cessna)');
    expect(jetBtn!.textContent).toBe('Jet (MiG-15)');
  });

  it('selected button has the selected class + aria-pressed=true', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'mig15');
    screen.show(MISSIONS);
    const jetBtn = document.querySelector('button[data-airframe-id="mig15"]')!;
    const defaultBtn = document.querySelector('button[data-airframe-id="default"]')!;
    expect(jetBtn.classList.contains('aircraft-picker-button-selected')).toBe(true);
    expect(jetBtn.getAttribute('aria-pressed')).toBe('true');
    expect(defaultBtn.classList.contains('aircraft-picker-button-selected')).toBe(false);
    expect(defaultBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('default selection is "default" when localStorage is empty', () => {
    screen.show(MISSIONS);
    const defaultBtn = document.querySelector('button[data-airframe-id="default"]')!;
    expect(defaultBtn.classList.contains('aircraft-picker-button-selected')).toBe(true);
  });

  it('clicking a picker button persists to localStorage and updates selected highlight', () => {
    screen.show(MISSIONS);
    expect(getSelectedAirframe()).toBe('default');
    const jetBtn = document.querySelector<HTMLButtonElement>('button[data-airframe-id="mig15"]')!;
    jetBtn.click();
    expect(getSelectedAirframe()).toBe('mig15');
    expect(jetBtn.classList.contains('aircraft-picker-button-selected')).toBe(true);
    const defaultBtn = document.querySelector('button[data-airframe-id="default"]')!;
    expect(defaultBtn.classList.contains('aircraft-picker-button-selected')).toBe(false);
  });

  it('clicking a picker button does NOT trigger mission onSelect', () => {
    const cb = vi.fn();
    screen.onSelect(cb);
    screen.show(MISSIONS);
    const jetBtn = document.querySelector<HTMLButtonElement>('button[data-airframe-id="mig15"]')!;
    jetBtn.click();
    expect(cb).not.toHaveBeenCalled();
  });

  it('mission button shows pinned-config suffix when pinnedConfigs has a mapping', () => {
    const pinnedConfigs = new Map([['combat-1', 'mig15']]);
    const missions: MissionManifestEntry[] = [
      { id: 'free-flight', name: 'Free Flight' },
      { id: 'combat-1', name: 'Combat' },
    ];
    screen.show(missions, { pinnedConfigs });
    const ffBtn = document.querySelector('button[data-mission-id="free-flight"]')!;
    const combatBtn = document.querySelector('button[data-mission-id="combat-1"]')!;
    expect(ffBtn.textContent).toBe('Free Flight');
    expect(combatBtn.textContent).toBe('Combat [MiG-15]');
  });

  it('mission button without pinned config renders raw name even when pinnedConfigs has unrelated entries', () => {
    const pinnedConfigs = new Map([['other-mission', 'mig15']]);
    screen.show(MISSIONS, { pinnedConfigs });
    const ffBtn = document.querySelector('button[data-mission-id="free-flight"]')!;
    expect(ffBtn.textContent).toBe('Free Flight');
  });

  it('mission button with unknown pinned config gracefully falls back to raw config name', () => {
    const pinnedConfigs = new Map([['free-flight', 'su27-future-airframe']]);
    screen.show(MISSIONS, { pinnedConfigs });
    const ffBtn = document.querySelector('button[data-mission-id="free-flight"]')!;
    expect(ffBtn.textContent).toBe('Free Flight [su27-future-airframe]');
  });
});

describe('MissionSelectScreen — master volume slider (WP26)', () => {
  let screen: MissionSelectScreen;

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    screen = new MissionSelectScreen();
  });

  afterEach(() => {
    screen.hide();
  });

  it('renders a master-volume slider with min=0, max=1, step=0.05', () => {
    screen.show(MISSIONS);
    const slider = document.querySelector<HTMLInputElement>(
      'input[data-testid="master-volume-slider"]',
    );
    expect(slider).not.toBeNull();
    expect(slider!.type).toBe('range');
    expect(slider!.min).toBe('0');
    expect(slider!.max).toBe('1');
    expect(slider!.step).toBe('0.05');
  });

  it('initial slider value matches getMasterVolume() (default 0.1 on fresh storage)', () => {
    screen.show(MISSIONS);
    const slider = document.querySelector<HTMLInputElement>(
      'input[data-testid="master-volume-slider"]',
    )!;
    expect(Number(slider.value)).toBeCloseTo(0.1, 6);
  });

  it('initial slider value reflects a previously-persisted master volume', () => {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, '0.75');
    screen.show(MISSIONS);
    const slider = document.querySelector<HTMLInputElement>(
      'input[data-testid="master-volume-slider"]',
    )!;
    expect(Number(slider.value)).toBeCloseTo(0.75, 6);
  });

  it('value-display label shows percent of current slider value', () => {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, '0.3');
    screen.show(MISSIONS);
    const valueLabel = document.querySelector('[data-testid="master-volume-value"]');
    expect(valueLabel!.textContent).toBe('30%');
  });

  it('input event persists the new value to localStorage and updates the % label', () => {
    screen.show(MISSIONS);
    const slider = document.querySelector<HTMLInputElement>(
      'input[data-testid="master-volume-slider"]',
    )!;
    slider.value = '0.8';
    slider.dispatchEvent(new Event('input'));
    expect(getMasterVolume()).toBeCloseTo(0.8, 6);
    const valueLabel = document.querySelector('[data-testid="master-volume-value"]');
    expect(valueLabel!.textContent).toBe('80%');
  });

  it('input event fires onVolumeChange callback with the new value', () => {
    const cb = vi.fn();
    screen.onVolumeChange(cb);
    screen.show(MISSIONS);
    const slider = document.querySelector<HTMLInputElement>(
      'input[data-testid="master-volume-slider"]',
    )!;
    slider.value = '0.4';
    slider.dispatchEvent(new Event('input'));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(0.4);
  });

  it('input event with no onVolumeChange callback still persists (UI-only mode)', () => {
    screen.show(MISSIONS);
    const slider = document.querySelector<HTMLInputElement>(
      'input[data-testid="master-volume-slider"]',
    )!;
    slider.value = '0.65';
    expect(() => slider.dispatchEvent(new Event('input'))).not.toThrow();
    expect(getMasterVolume()).toBeCloseTo(0.65, 6);
  });

  it('slider input does NOT trigger mission onSelect', () => {
    const cb = vi.fn();
    screen.onSelect(cb);
    screen.show(MISSIONS);
    const slider = document.querySelector<HTMLInputElement>(
      'input[data-testid="master-volume-slider"]',
    )!;
    slider.value = '0.2';
    slider.dispatchEvent(new Event('input'));
    expect(cb).not.toHaveBeenCalled();
  });
});
