import { describe, it, expect } from 'vitest';
import { parseMission } from './parse';

function validBaseline(): Record<string, unknown> {
  return {
    id: 'free-flight',
    name: 'Free Flight',
    type: 'free-flight',
    spawn: {
      position: { x: 0, y: 50, z: 0 },
      linvel: { x: 0, y: 0, z: -30 },
      throttle: 0,
    },
    objectives: [],
  };
}

describe('parseMission — happy path', () => {
  it('parses the minimal free-flight mission with all defaults filled', () => {
    const m = parseMission(validBaseline());
    expect(m.id).toBe('free-flight');
    expect(m.name).toBe('Free Flight');
    expect(m.type).toBe('free-flight');
    expect(m.spawn.position).toEqual({ x: 0, y: 50, z: 0 });
    expect(m.spawn.linvel).toEqual({ x: 0, y: 0, z: -30 });
    expect(m.spawn.throttle).toBe(0);
    expect(m.objectives).toEqual([]);
    expect(m.winCondition).toBe('all-objectives');
    expect(m.failCondition).toBe('crash');
    expect(m.timeoutSec).toBeUndefined();
    expect(m.scriptHook).toBeUndefined();
  });

  it('parses each Objective.kind (reach-waypoint, touchdown, destroy-target)', () => {
    const raw = validBaseline();
    raw.objectives = [
      { kind: 'reach-waypoint', position: { x: 100, y: 50, z: -200 }, radius: 30, order: 0 },
      {
        kind: 'touchdown',
        runway: {
          center: { x: 0, y: 0, z: 0 },
          halfExtents: { x: 15, y: 1, z: 300 },
        },
        maxVSpeed: 5,
      },
      { kind: 'destroy-target', targetId: 'enemy-1' },
    ];
    const m = parseMission(raw);
    expect(m.objectives).toHaveLength(3);
    expect(m.objectives[0]!.kind).toBe('reach-waypoint');
    expect(m.objectives[1]!.kind).toBe('touchdown');
    expect(m.objectives[2]!.kind).toBe('destroy-target');
  });

  it('accepts explicit winCondition + failCondition + timeoutSec + scriptHook', () => {
    const raw = validBaseline();
    raw.type = 'combat';
    raw.failCondition = 'timeout';
    raw.timeoutSec = 120;
    raw.winCondition = 'all-objectives';
    raw.scriptHook = 'combat-ai';
    raw.objectives = [{ kind: 'destroy-target', targetId: 't1' }];
    const m = parseMission(raw);
    expect(m.failCondition).toBe('timeout');
    expect(m.timeoutSec).toBe(120);
    expect(m.scriptHook).toBe('combat-ai');
  });
});

describe('parseMission — top-level validation', () => {
  it('rejects non-object root', () => {
    expect(() => parseMission(null)).toThrow(/root must be an object/);
    expect(() => parseMission('foo')).toThrow(/root must be an object/);
    expect(() => parseMission(42)).toThrow(/root must be an object/);
  });

  it('rejects missing or empty id / name', () => {
    const noId = validBaseline();
    delete noId.id;
    expect(() => parseMission(noId)).toThrow(/id/);

    const emptyName = validBaseline();
    emptyName.name = '';
    expect(() => parseMission(emptyName)).toThrow(/name/);
  });

  it('rejects unknown mission type', () => {
    const bad = validBaseline();
    bad.type = 'race';
    expect(() => parseMission(bad)).toThrow(/type must be one of/);
  });

  it('rejects unknown top-level field', () => {
    const bad = validBaseline();
    (bad as Record<string, unknown>).weather = 'sunny';
    expect(() => parseMission(bad)).toThrow(/unknown field "weather"/);
  });

  it('rejects missing spawn', () => {
    const bad = validBaseline();
    delete bad.spawn;
    expect(() => parseMission(bad)).toThrow(/spawn must be an object/);
  });

  it('rejects throttle outside [0, 1]', () => {
    const lo = validBaseline();
    (lo.spawn as Record<string, unknown>).throttle = -0.1;
    expect(() => parseMission(lo)).toThrow(/throttle must be in/);
    const hi = validBaseline();
    (hi.spawn as Record<string, unknown>).throttle = 1.5;
    expect(() => parseMission(hi)).toThrow(/throttle must be in/);
  });

  it('rejects non-finite values in spawn vectors', () => {
    const bad = validBaseline();
    (bad.spawn as { position: { x: number } }).position.x = NaN;
    expect(() => parseMission(bad)).toThrow(/spawn\.position\.x/);
  });

  it('rejects non-array objectives', () => {
    const bad = validBaseline();
    bad.objectives = 'none';
    expect(() => parseMission(bad)).toThrow(/objectives must be an array/);
  });

  it('rejects bad winCondition / failCondition enum', () => {
    const badWin = validBaseline();
    badWin.winCondition = 'survive';
    expect(() => parseMission(badWin)).toThrow(/winCondition must be one of/);

    const badFail = validBaseline();
    badFail.failCondition = 'explode';
    expect(() => parseMission(badFail)).toThrow(/failCondition must be one of/);
  });

  it('rejects timeoutSec ≤ 0', () => {
    const bad = validBaseline();
    bad.timeoutSec = 0;
    expect(() => parseMission(bad)).toThrow(/timeoutSec must be > 0/);
  });

  it('rejects failCondition "timeout" without timeoutSec', () => {
    const bad = validBaseline();
    bad.failCondition = 'timeout';
    expect(() => parseMission(bad)).toThrow(/timeout.*requires a positive timeoutSec/);
  });

  it('rejects empty scriptHook string', () => {
    const bad = validBaseline();
    bad.scriptHook = '';
    expect(() => parseMission(bad)).toThrow(/scriptHook must be a non-empty string/);
  });
});

describe('parseMission — Objective validation', () => {
  it('rejects unknown objective kind', () => {
    const bad = validBaseline();
    bad.objectives = [{ kind: 'collect-coin', position: { x: 0, y: 0, z: 0 } }];
    expect(() => parseMission(bad)).toThrow(/kind must be one of/);
  });

  it('reach-waypoint: rejects non-positive radius', () => {
    const bad = validBaseline();
    bad.objectives = [
      { kind: 'reach-waypoint', position: { x: 0, y: 0, z: 0 }, radius: 0, order: 0 },
    ];
    expect(() => parseMission(bad)).toThrow(/radius must be > 0/);
  });

  it('reach-waypoint: rejects non-integer or negative order', () => {
    const badFloat = validBaseline();
    badFloat.objectives = [
      { kind: 'reach-waypoint', position: { x: 0, y: 0, z: 0 }, radius: 30, order: 1.5 },
    ];
    expect(() => parseMission(badFloat)).toThrow(/order must be a non-negative integer/);

    const badNeg = validBaseline();
    badNeg.objectives = [
      { kind: 'reach-waypoint', position: { x: 0, y: 0, z: 0 }, radius: 30, order: -1 },
    ];
    expect(() => parseMission(badNeg)).toThrow(/order must be a non-negative integer/);
  });

  it('reach-waypoint: rejects unknown sub-field', () => {
    const bad = validBaseline();
    bad.objectives = [
      {
        kind: 'reach-waypoint',
        position: { x: 0, y: 0, z: 0 },
        radius: 30,
        order: 0,
        bonus: true,
      },
    ];
    expect(() => parseMission(bad)).toThrow(/unknown field "bonus"/);
  });

  it('touchdown: rejects missing runway', () => {
    const bad = validBaseline();
    bad.objectives = [{ kind: 'touchdown', maxVSpeed: 5 }];
    expect(() => parseMission(bad)).toThrow(/runway must be an object/);
  });

  it('touchdown: rejects non-positive maxVSpeed', () => {
    const bad = validBaseline();
    bad.objectives = [
      {
        kind: 'touchdown',
        runway: {
          center: { x: 0, y: 0, z: 0 },
          halfExtents: { x: 15, y: 1, z: 300 },
        },
        maxVSpeed: -1,
      },
    ];
    expect(() => parseMission(bad)).toThrow(/maxVSpeed must be > 0/);
  });

  it('destroy-target: rejects empty targetId', () => {
    const bad = validBaseline();
    bad.objectives = [{ kind: 'destroy-target', targetId: '' }];
    expect(() => parseMission(bad)).toThrow(/targetId must be a non-empty string/);
  });
});
