import { describe, it, expect } from 'vitest';
import { parseScriptSpec, configNameToPath } from './scripted-input';

function paramsOf(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('parseScriptSpec', () => {
  it('returns null plan when no script and no config supplied', () => {
    const result = parseScriptSpec(paramsOf(''));
    expect(result.plan).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('parses a single hold:key event with seconds → ticks @ 60Hz', () => {
    const result = parseScriptSpec(paramsOf('script=hold:ArrowUp@1.0:4.0'));
    expect(result.plan).not.toBeNull();
    expect(result.plan!.events).toEqual([
      { kind: 'key', code: 'ArrowUp', startTick: 60, endTick: 240 },
    ]);
    expect(result.plan!.settleTicks).toBe(60);
    expect(result.plan!.configName).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('parses comma-separated multi-key script', () => {
    const result = parseScriptSpec(
      paramsOf('script=hold:KeyD@0:2.0,hold:ArrowUp@1.0:5.0'),
    );
    expect(result.plan!.events).toHaveLength(2);
    expect(result.plan!.events[0]).toEqual({
      kind: 'key',
      code: 'KeyD',
      startTick: 0,
      endTick: 120,
    });
    expect(result.plan!.events[1]).toEqual({
      kind: 'key',
      code: 'ArrowUp',
      startTick: 60,
      endTick: 300,
    });
  });

  it('parses throttle override with float value', () => {
    const result = parseScriptSpec(paramsOf('script=hold:Throttle=0.6@0:5.0'));
    expect(result.plan!.events).toEqual([
      { kind: 'throttle', value: 0.6, startTick: 0, endTick: 300 },
    ]);
  });

  it('parses @start:end keyword for unbounded hold', () => {
    const result = parseScriptSpec(paramsOf('script=hold:ArrowUp@0:end'));
    expect(result.plan!.events[0]!.endTick).toBe('end');
  });

  it('warns and skips malformed segments without throwing', () => {
    const result = parseScriptSpec(
      paramsOf('script=hold:ArrowUp@1.0:4.0,garbage,hold:KeyD@0:2.0'),
    );
    expect(result.plan!.events).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('garbage');
  });

  it('rejects throttle values outside [0,1]', () => {
    const result = parseScriptSpec(paramsOf('script=hold:Throttle=1.5@0:5'));
    expect(result.plan!.events).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('rejects negative start times', () => {
    const result = parseScriptSpec(paramsOf('script=hold:ArrowUp@-1:4'));
    expect(result.plan!.events).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('rejects end <= start', () => {
    const result = parseScriptSpec(paramsOf('script=hold:ArrowUp@4:4'));
    expect(result.plan!.events).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('accepts valid config name', () => {
    const result = parseScriptSpec(paramsOf('config=aerobatic'));
    expect(result.plan).not.toBeNull();
    expect(result.plan!.configName).toBe('aerobatic');
    expect(result.warnings).toEqual([]);
  });

  it('rejects path-traversal in config name', () => {
    const result = parseScriptSpec(paramsOf('config=../etc/passwd'));
    expect(result.plan).toBeNull(); // no script, rejected config → null plan
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('rejected');
  });

  it('rejects config name with slashes', () => {
    const result = parseScriptSpec(paramsOf('config=foo/bar'));
    expect(result.warnings).toHaveLength(1);
  });

  it('combines script and config in single plan', () => {
    const result = parseScriptSpec(
      paramsOf('script=hold:ArrowUp@1.0:4.0&config=aerobatic'),
    );
    expect(result.plan!.events).toHaveLength(1);
    expect(result.plan!.configName).toBe('aerobatic');
  });
});

describe('configNameToPath', () => {
  it('returns default path for null', () => {
    expect(configNameToPath(null)).toBe('/config/aircraft.json');
  });

  it('builds config-prefixed path for named config', () => {
    expect(configNameToPath('aerobatic')).toBe('/config/aircraft-aerobatic.json');
  });
});
