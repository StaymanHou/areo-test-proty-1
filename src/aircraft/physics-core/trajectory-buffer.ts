import { Euler } from 'three';
import type { BodyState } from './aerosurface';

// Fixed-capacity ring buffer for per-tick trajectory rows. Used by the WP14.6
// browser-side parity hook (`window.__aircraft.getTrajectory()`) and by the
// WP14.7 Node harness to emit trajectory CSVs.
//
// The buffer is intentionally pre-allocated — `record()` is called once per
// fixed physics tick and writes into existing slots (no allocation in the hot
// path). `getRows()` returns a sliced array of populated rows in chronological
// order; that one slice is the only allocation per read.

export interface TrajectoryRow {
  tick: number;
  posX: number;
  posY: number;
  posZ: number;
  vX: number;
  vY: number;
  vZ: number;
  /** Pitch in radians (Euler YXZ, x component). */
  pitch: number;
  /** Yaw in radians (Euler YXZ, y component). */
  yaw: number;
  /** Roll in radians (Euler YXZ, z component). */
  roll: number;
  /** Magnitude of linear velocity (m/s). */
  airspeed: number;
}

const DEFAULT_CAPACITY = 1800; // 30s @ 60Hz physics

export class TrajectoryBuffer {
  readonly capacity: number;
  private readonly slots: TrajectoryRow[];
  private head = 0;
  private filled = 0;
  private tickCounter = 0;
  // Reusable Euler scratch — module-scoped would be slightly faster but this
  // keeps the buffer self-contained (multiple instances possible in tests).
  private readonly _euler = new Euler(0, 0, 0, 'YXZ');

  constructor(capacity: number = DEFAULT_CAPACITY) {
    if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isInteger(capacity)) {
      throw new Error(`TrajectoryBuffer: capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.slots = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.slots[i] = {
        tick: 0,
        posX: 0, posY: 0, posZ: 0,
        vX: 0, vY: 0, vZ: 0,
        pitch: 0, yaw: 0, roll: 0,
        airspeed: 0,
      };
    }
  }

  /** Record one tick. Allocation-free. */
  record(state: BodyState): void {
    this._euler.setFromQuaternion(state.quaternion, 'YXZ');
    const row = this.slots[this.head];
    row.tick = this.tickCounter++;
    row.posX = state.position.x;
    row.posY = state.position.y;
    row.posZ = state.position.z;
    row.vX = state.linvel.x;
    row.vY = state.linvel.y;
    row.vZ = state.linvel.z;
    row.pitch = this._euler.x;
    row.yaw = this._euler.y;
    row.roll = this._euler.z;
    row.airspeed = Math.hypot(state.linvel.x, state.linvel.y, state.linvel.z);
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
  }

  /** Number of rows currently recorded (≤ capacity). */
  get length(): number {
    return this.filled;
  }

  /**
   * Return populated rows in chronological order. Returns an array of plain
   * objects — the returned rows are copies, mutating them does not affect the
   * buffer. One allocation per call (the array + N copy objects).
   */
  getRows(): TrajectoryRow[] {
    const out: TrajectoryRow[] = new Array(this.filled);
    const start = this.filled < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.filled; i++) {
      const src = this.slots[(start + i) % this.capacity];
      out[i] = {
        tick: src.tick,
        posX: src.posX, posY: src.posY, posZ: src.posZ,
        vX: src.vX, vY: src.vY, vZ: src.vZ,
        pitch: src.pitch, yaw: src.yaw, roll: src.roll,
        airspeed: src.airspeed,
      };
    }
    return out;
  }

  /** Clear the buffer + reset the tick counter. */
  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.tickCounter = 0;
  }
}

/** Serialize trajectory rows to CSV. Includes a header row. */
export function trajectoryToCsv(rows: readonly TrajectoryRow[]): string {
  const header = 'tick,posX,posY,posZ,vX,vY,vZ,pitch,yaw,roll,airspeed';
  if (rows.length === 0) return header + '\n';
  const lines: string[] = new Array(rows.length + 1);
  lines[0] = header;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines[i + 1] = `${r.tick},${r.posX},${r.posY},${r.posZ},${r.vX},${r.vY},${r.vZ},${r.pitch},${r.yaw},${r.roll},${r.airspeed}`;
  }
  return lines.join('\n') + '\n';
}

/** Parse a trajectory CSV back into rows (for the parity-diff test). */
export function csvToTrajectory(csv: string): TrajectoryRow[] {
  const lines = csv.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  // First line is header
  const out: TrajectoryRow[] = new Array(lines.length - 1);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length !== 11) {
      throw new Error(`csvToTrajectory: row ${i} has ${cols.length} columns, expected 11`);
    }
    out[i - 1] = {
      tick: +cols[0],
      posX: +cols[1], posY: +cols[2], posZ: +cols[3],
      vX: +cols[4], vY: +cols[5], vZ: +cols[6],
      pitch: +cols[7], yaw: +cols[8], roll: +cols[9],
      airspeed: +cols[10],
    };
  }
  return out;
}
