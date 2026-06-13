// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_MASTER_VOLUME,
  MASTER_VOLUME_STORAGE_KEY,
  getMasterVolume,
  setMasterVolume,
} from './master-volume';

describe('getMasterVolume', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns DEFAULT_MASTER_VOLUME when storage is empty', () => {
    expect(getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
  });

  it('returns the stored value when valid', () => {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, '0.8');
    expect(getMasterVolume()).toBeCloseTo(0.8, 6);
  });

  it('clamps stored value > 1 to 1', () => {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, '1.5');
    expect(getMasterVolume()).toBe(1);
  });

  it('clamps stored value < 0 to 0', () => {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, '-0.3');
    expect(getMasterVolume()).toBe(0);
  });

  it('returns default when stored value is non-numeric string', () => {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, 'loud');
    expect(getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
  });

  it('returns default when stored value is empty string', () => {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, '');
    expect(getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
  });

  it('returns default when stored value is "NaN"', () => {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, 'NaN');
    expect(getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
  });

  it('returns default when localStorage.getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(getMasterVolume()).toBe(DEFAULT_MASTER_VOLUME);
    spy.mockRestore();
  });
});

describe('setMasterVolume', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists a valid value', () => {
    setMasterVolume(0.3);
    expect(localStorage.getItem(MASTER_VOLUME_STORAGE_KEY)).toBe('0.3');
  });

  it('clamps > 1 before persisting', () => {
    setMasterVolume(2.0);
    expect(Number(localStorage.getItem(MASTER_VOLUME_STORAGE_KEY))).toBe(1);
  });

  it('clamps < 0 before persisting', () => {
    setMasterVolume(-1);
    expect(Number(localStorage.getItem(MASTER_VOLUME_STORAGE_KEY))).toBe(0);
  });

  it('rejects NaN (no write)', () => {
    setMasterVolume(NaN);
    expect(localStorage.getItem(MASTER_VOLUME_STORAGE_KEY)).toBeNull();
  });

  it('rejects Infinity (no write)', () => {
    setMasterVolume(Infinity);
    expect(localStorage.getItem(MASTER_VOLUME_STORAGE_KEY)).toBeNull();
  });

  it('round-trips through getMasterVolume', () => {
    setMasterVolume(0.42);
    expect(getMasterVolume()).toBeCloseTo(0.42, 6);
  });

  it('swallows storage exceptions silently', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => setMasterVolume(0.7)).not.toThrow();
    spy.mockRestore();
  });
});
