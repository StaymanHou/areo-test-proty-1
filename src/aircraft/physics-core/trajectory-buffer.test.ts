import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  TrajectoryBuffer,
  trajectoryToCsv,
  csvToTrajectory,
  type TrajectoryRow,
} from './trajectory-buffer';
import type { BodyState } from './aerosurface';

function bs(opts: Partial<{ px: number; py: number; pz: number; vx: number; vy: number; vz: number }> = {}): BodyState {
  return {
    position: new Vector3(opts.px ?? 0, opts.py ?? 0, opts.pz ?? 0),
    quaternion: new Quaternion(),
    linvel: new Vector3(opts.vx ?? 0, opts.vy ?? 0, opts.vz ?? 0),
    angvel: new Vector3(),
  };
}

describe('TrajectoryBuffer', () => {
  it('records below capacity, length grows monotonically', () => {
    const buf = new TrajectoryBuffer(5);
    expect(buf.length).toBe(0);
    buf.record(bs({ py: 1 }));
    expect(buf.length).toBe(1);
    buf.record(bs({ py: 2 }));
    buf.record(bs({ py: 3 }));
    expect(buf.length).toBe(3);
  });

  it('records assign monotonically increasing tick numbers starting at 0', () => {
    const buf = new TrajectoryBuffer(10);
    for (let i = 0; i < 4; i++) buf.record(bs({ py: i }));
    const rows = buf.getRows();
    expect(rows.map((r) => r.tick)).toEqual([0, 1, 2, 3]);
  });

  it('captures position, velocity, and airspeed from BodyState', () => {
    const buf = new TrajectoryBuffer(5);
    buf.record(bs({ px: 1, py: 2, pz: 3, vx: 4, vy: 0, vz: 3 }));
    const [row] = buf.getRows();
    expect(row).toMatchObject({
      posX: 1, posY: 2, posZ: 3,
      vX: 4, vY: 0, vZ: 3,
      airspeed: 5, // hypot(4, 0, 3) = 5
    });
  });

  it('overwrites oldest rows in FIFO order when capacity is exceeded', () => {
    const buf = new TrajectoryBuffer(3);
    for (let i = 0; i < 5; i++) buf.record(bs({ py: i }));
    const rows = buf.getRows();
    expect(buf.length).toBe(3);
    expect(rows.map((r) => r.tick)).toEqual([2, 3, 4]); // oldest 0,1 dropped
    expect(rows.map((r) => r.posY)).toEqual([2, 3, 4]);
  });

  it('getRows returns chronological order across the ring boundary', () => {
    const buf = new TrajectoryBuffer(4);
    // Fill exactly capacity
    for (let i = 0; i < 4; i++) buf.record(bs({ py: i }));
    // Wrap by 3 — head should now point at slot 3
    for (let i = 4; i < 7; i++) buf.record(bs({ py: i }));
    const rows = buf.getRows();
    expect(rows.map((r) => r.tick)).toEqual([3, 4, 5, 6]);
  });

  it('reset() clears length and restarts tick counter at 0', () => {
    const buf = new TrajectoryBuffer(3);
    buf.record(bs());
    buf.record(bs());
    buf.reset();
    expect(buf.length).toBe(0);
    buf.record(bs({ py: 9 }));
    const [row] = buf.getRows();
    expect(row.tick).toBe(0);
    expect(row.posY).toBe(9);
  });

  it('returned rows are defensive copies — mutating them does not affect future reads', () => {
    const buf = new TrajectoryBuffer(3);
    buf.record(bs({ py: 1 }));
    const rows1 = buf.getRows();
    rows1[0].posY = 999;
    const rows2 = buf.getRows();
    expect(rows2[0].posY).toBe(1);
  });

  it('rejects non-positive or non-integer capacity', () => {
    expect(() => new TrajectoryBuffer(0)).toThrow();
    expect(() => new TrajectoryBuffer(-5)).toThrow();
    expect(() => new TrajectoryBuffer(1.5)).toThrow();
    expect(() => new TrajectoryBuffer(NaN)).toThrow();
  });
});

describe('trajectoryToCsv / csvToTrajectory', () => {
  it('round-trips an empty buffer to header-only CSV', () => {
    const csv = trajectoryToCsv([]);
    expect(csv).toBe('tick,posX,posY,posZ,vX,vY,vZ,pitch,yaw,roll,airspeed\n');
    expect(csvToTrajectory(csv)).toEqual([]);
  });

  it('round-trips a single row exactly (lossless for the numeric fields)', () => {
    const buf = new TrajectoryBuffer(3);
    buf.record(bs({ px: 1.5, py: 2.5, pz: 3.5, vx: 4.5, vy: -1.5, vz: 0.5 }));
    const rows = buf.getRows();
    const round: TrajectoryRow[] = csvToTrajectory(trajectoryToCsv(rows));
    expect(round).toHaveLength(1);
    // Per-field equality with `===` (treats ±0 as equal, unlike toEqual /
    // toBe which use Object.is — relevant for Euler.x of an identity
    // quaternion, which is -0; the CSV round-trip flattens it to +0).
    const keys: (keyof TrajectoryRow)[] = [
      'tick', 'posX', 'posY', 'posZ', 'vX', 'vY', 'vZ', 'pitch', 'yaw', 'roll', 'airspeed',
    ];
    for (const k of keys) {
      expect(round[0][k] === rows[0][k]).toBe(true);
    }
  });

  it('round-trips a many-row buffer preserving tick order', () => {
    const buf = new TrajectoryBuffer(50);
    for (let i = 0; i < 50; i++) buf.record(bs({ py: i * 0.1 }));
    const rows = buf.getRows();
    const round = csvToTrajectory(trajectoryToCsv(rows));
    expect(round).toHaveLength(50);
    expect(round.map((r) => r.tick)).toEqual(rows.map((r) => r.tick));
    for (let i = 0; i < 50; i++) {
      expect(round[i].posY).toBeCloseTo(rows[i].posY, 12);
    }
  });

  it('csvToTrajectory rejects malformed rows', () => {
    const bad = 'tick,posX,posY,posZ,vX,vY,vZ,pitch,yaw,roll,airspeed\n1,2,3\n';
    expect(() => csvToTrajectory(bad)).toThrow(/expected 11/);
  });
});
