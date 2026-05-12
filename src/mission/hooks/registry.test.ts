import { describe, it, expect, beforeEach } from 'vitest';
import { clearRegistry, getHook, registerHook, type HookFn } from './registry';

const noop: HookFn = () => {};

describe('hook registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('registers and retrieves a hook by name', () => {
    registerHook('combat-ai', noop);
    expect(getHook('combat-ai')).toBe(noop);
  });

  it('returns undefined for an unregistered name', () => {
    expect(getHook('nope')).toBeUndefined();
  });

  it('rejects empty name', () => {
    expect(() => registerHook('', noop)).toThrow(/name must be a non-empty string/);
  });

  it('rejects duplicate registration', () => {
    registerHook('combat-ai', noop);
    expect(() => registerHook('combat-ai', noop)).toThrow(
      /hook "combat-ai" is already registered/,
    );
  });

  it('clearRegistry resets state', () => {
    registerHook('combat-ai', noop);
    clearRegistry();
    expect(getHook('combat-ai')).toBeUndefined();
    // After clear, the same name can be re-registered.
    registerHook('combat-ai', noop);
    expect(getHook('combat-ai')).toBe(noop);
  });
});
