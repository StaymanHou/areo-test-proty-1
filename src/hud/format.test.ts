import { describe, it, expect } from 'vitest';
import { formatObjective, formatActiveObjective } from './format';
import type { Objective, ObjectiveState } from '../mission/types';

const wp = (order: number): Objective => ({
  kind: 'reach-waypoint',
  position: { x: 0, y: 0, z: 0 },
  radius: 50,
  order,
});

const td: Objective = {
  kind: 'touchdown',
  runway: { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 15, y: 1, z: 300 } },
  maxVSpeed: 2,
};

const dt: Objective = { kind: 'destroy-target', targetId: 'enemy-1' };

const state = (completed = false): ObjectiveState => ({ completed, meta: {} });

describe('formatObjective', () => {
  it('formats reach-waypoint with N/M counter', () => {
    expect(formatObjective(wp(0), state(), { index: 0, total: 3 })).toBe(
      'Fly to waypoint (1/3)',
    );
    expect(formatObjective(wp(1), state(), { index: 1, total: 3 })).toBe(
      'Fly to waypoint (2/3)',
    );
  });

  it('formats touchdown', () => {
    expect(formatObjective(td, state(), { index: 0, total: 1 })).toBe(
      'Touchdown on the runway',
    );
  });

  it('formats destroy-target when incomplete', () => {
    expect(formatObjective(dt, state(false), { index: 0, total: 1 })).toBe(
      'Destroy the target',
    );
  });

  it('returns null for completed destroy-target', () => {
    expect(formatObjective(dt, state(true), { index: 0, total: 1 })).toBeNull();
  });
});

describe('formatActiveObjective', () => {
  it('returns null for zero-objective missions (free-flight)', () => {
    expect(formatActiveObjective([], [])).toBeNull();
  });

  it('returns the first incomplete objective string', () => {
    const objs: Objective[] = [wp(0), wp(1), wp(2)];
    const states: ObjectiveState[] = [state(true), state(false), state(false)];
    expect(formatActiveObjective(objs, states)).toBe('Fly to waypoint (2/3)');
  });

  it('returns null when all objectives complete', () => {
    const objs: Objective[] = [wp(0), wp(1)];
    const states: ObjectiveState[] = [state(true), state(true)];
    expect(formatActiveObjective(objs, states)).toBeNull();
  });

  it('handles missing state entries (treats as incomplete)', () => {
    const objs: Objective[] = [wp(0)];
    expect(formatActiveObjective(objs, [])).toBe('Fly to waypoint (1/1)');
  });
});
