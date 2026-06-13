// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AIRCRAFT_OPTIONS,
  AIRFRAME_STORAGE_KEY,
  getSelectedAirframe,
  setSelectedAirframe,
  resolveAirframeName,
} from './aircraft-options';

describe('AIRCRAFT_OPTIONS', () => {
  it('contains at least the default + mig15 entries', () => {
    const ids = AIRCRAFT_OPTIONS.map((o) => o.id);
    expect(ids).toContain('default');
    expect(ids).toContain('mig15');
  });

  it('puts default first (display order)', () => {
    expect(AIRCRAFT_OPTIONS[0].id).toBe('default');
  });

  it('every option has class + airframe labels', () => {
    for (const opt of AIRCRAFT_OPTIONS) {
      expect(opt.className.length).toBeGreaterThan(0);
      expect(opt.airframeName.length).toBeGreaterThan(0);
    }
  });
});

describe('getSelectedAirframe', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns "default" when storage is empty', () => {
    expect(getSelectedAirframe()).toBe('default');
  });

  it('returns the stored value when valid', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'mig15');
    expect(getSelectedAirframe()).toBe('mig15');
  });

  it('returns "default" when stored value is empty string', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, '');
    expect(getSelectedAirframe()).toBe('default');
  });

  it('returns "default" when stored value is an unknown id', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'su27');
    expect(getSelectedAirframe()).toBe('default');
  });

  it('returns "default" when stored value violates CONFIG_NAME_REGEX', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, '../etc/passwd');
    expect(getSelectedAirframe()).toBe('default');
  });

  it('returns "default" when localStorage.getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(getSelectedAirframe()).toBe('default');
    spy.mockRestore();
  });
});

describe('setSelectedAirframe', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists a valid id', () => {
    setSelectedAirframe('mig15');
    expect(localStorage.getItem(AIRFRAME_STORAGE_KEY)).toBe('mig15');
  });

  it('round-trips through getSelectedAirframe', () => {
    setSelectedAirframe('mig15');
    expect(getSelectedAirframe()).toBe('mig15');
    setSelectedAirframe('default');
    expect(getSelectedAirframe()).toBe('default');
  });

  it('rejects unknown ids (no write)', () => {
    // @ts-expect-error testing runtime guard against bad id
    setSelectedAirframe('su27');
    expect(localStorage.getItem(AIRFRAME_STORAGE_KEY)).toBeNull();
  });

  it('swallows storage exceptions silently', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    expect(() => setSelectedAirframe('mig15')).not.toThrow();
    spy.mockRestore();
  });
});

describe('resolveAirframeName — precedence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('URL config wins over mission, storage, default', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'mig15');
    const r = resolveAirframeName({ urlConfig: 'aerobatic', missionConfig: 'mig15' });
    expect(r).toEqual({ name: 'aerobatic', source: 'url' });
  });

  it('mission config wins over storage when URL is null', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'mig15');
    const r = resolveAirframeName({ urlConfig: null, missionConfig: 'mig15' });
    expect(r).toEqual({ name: 'mig15', source: 'mission' });
  });

  it('storage wins when URL is null AND mission has no config?', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'mig15');
    const r = resolveAirframeName({ urlConfig: null, missionConfig: undefined });
    expect(r).toEqual({ name: 'mig15', source: 'storage' });
  });

  it('returns default {name: null, source: "default"} when nothing is set', () => {
    const r = resolveAirframeName({ urlConfig: null, missionConfig: undefined });
    expect(r).toEqual({ name: null, source: 'default' });
  });

  it('storage = "default" collapses to source: default (null name)', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'default');
    const r = resolveAirframeName({ urlConfig: null, missionConfig: null });
    expect(r).toEqual({ name: null, source: 'default' });
  });

  it('treats empty-string urlConfig as null (falls through to next layer)', () => {
    const r = resolveAirframeName({ urlConfig: '', missionConfig: 'mig15' });
    expect(r).toEqual({ name: 'mig15', source: 'mission' });
  });

  it('treats empty-string missionConfig as absent (falls through to storage)', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'mig15');
    const r = resolveAirframeName({ urlConfig: null, missionConfig: '' });
    expect(r).toEqual({ name: 'mig15', source: 'storage' });
  });

  it('injected storedConfig overrides actual localStorage', () => {
    localStorage.setItem(AIRFRAME_STORAGE_KEY, 'mig15');
    const r = resolveAirframeName({
      urlConfig: null,
      missionConfig: undefined,
      storedConfig: 'default',
    });
    expect(r).toEqual({ name: null, source: 'default' });
  });
});
