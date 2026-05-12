import { describe, it, expect } from 'vitest';
import { formatObjective, formatActiveObjective, getActiveWaypointPosition } from './format';
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

describe('getActiveWaypointPosition', () => {
  const at = (x: number, y: number, z: number, order: number): Objective => ({
    kind: 'reach-waypoint',
    position: { x, y, z },
    radius: 100,
    order,
  });

  it('returns the position of the first incomplete reach-waypoint', () => {
    const objs: Objective[] = [at(0, 30, -150, 0), at(50, 20, -250, 1)];
    const states: ObjectiveState[] = [state(false), state(false)];
    expect(getActiveWaypointPosition(objs, states)).toEqual({ x: 0, y: 30, z: -150 });
  });

  it('skips completed reach-waypoints to the next one', () => {
    const objs: Objective[] = [at(0, 30, -150, 0), at(50, 20, -250, 1)];
    const states: ObjectiveState[] = [state(true), state(false)];
    expect(getActiveWaypointPosition(objs, states)).toEqual({ x: 50, y: 20, z: -250 });
  });

  it('returns null when no reach-waypoint objectives exist', () => {
    expect(getActiveWaypointPosition([], [])).toBeNull();
    expect(getActiveWaypointPosition([td], [state(false)])).toBeNull();
  });

  it('returns null when all reach-waypoints are complete', () => {
    const objs: Objective[] = [at(0, 30, -150, 0), at(50, 20, -250, 1)];
    const states: ObjectiveState[] = [state(true), state(true)];
    expect(getActiveWaypointPosition(objs, states)).toBeNull();
  });

  it('skips non-reach-waypoint kinds', () => {
    const objs: Objective[] = [td, at(0, 30, -150, 0)];
    const states: ObjectiveState[] = [state(false), state(false)];
    expect(getActiveWaypointPosition(objs, states)).toEqual({ x: 0, y: 30, z: -150 });
  });

  it('handles missing state entries (treats as incomplete)', () => {
    const objs: Objective[] = [at(0, 30, -150, 0)];
    expect(getActiveWaypointPosition(objs, [])).toEqual({ x: 0, y: 30, z: -150 });
  });
});
