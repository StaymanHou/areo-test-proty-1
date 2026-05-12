import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { BodyState } from './aerosurface';
import {
  createAircraftState,
  toAircraftState,
  type AircraftState,
} from './state';

function makeBodyState(): BodyState {
  return {
    position: new Vector3(10, 50, -100),
    quaternion: new Quaternion(0, 0, 0, 1),
    linvel: new Vector3(0, -5, -30),
    angvel: new Vector3(0.1, 0, 0.2),
  };
}

describe('AircraftState — createAircraftState', () => {
  it('returns a buffer with finite zero/identity values', () => {
    const s = createAircraftState();
    expect(s.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.linvel).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.angvel).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(s.airspeed).toBe(0);
    expect(s.altitude).toBe(0);
  });

  it('returns a fresh object each call (callers can hold independent buffers)', () => {
    const a = createAircraftState();
    const b = createAircraftState();
    expect(a).not.toBe(b);
    expect(a.position).not.toBe(b.position);
  });
});

describe('AircraftState — toAircraftState adapter', () => {
  it('copies position, linvel, angvel, quaternion verbatim', () => {
    const body = makeBodyState();
    const out = createAircraftState();
    toAircraftState(body, out);
    expect(out.position).toEqual({ x: 10, y: 50, z: -100 });
    expect(out.linvel).toEqual({ x: 0, y: -5, z: -30 });
    expect(out.angvel).toEqual({ x: 0.1, y: 0, z: 0.2 });
    expect(out.quaternion).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('computes airspeed as |linvel|', () => {
    const body = makeBodyState();
    const out = createAircraftState();
    toAircraftState(body, out);
    // |linvel| = sqrt(0² + 5² + 30²) = sqrt(925) ≈ 30.41
    expect(out.airspeed).toBeCloseTo(Math.sqrt(925), 6);
  });

  it('computes altitude as position.y (flat-terrain assumption per arch D4)', () => {
    const body = makeBodyState();
    const out = createAircraftState();
    toAircraftState(body, out);
    expect(out.altitude).toBe(50);
  });

  it('returns the supplied out buffer for chaining (no allocation)', () => {
    const body = makeBodyState();
    const out = createAircraftState();
    const ret = toAircraftState(body, out);
    expect(ret).toBe(out);
  });

  it('is allocation-free: nested objects keep their identity across calls', () => {
    const body = makeBodyState();
    const out = createAircraftState();
    const posRef = out.position;
    const linvelRef = out.linvel;
    const quatRef = out.quaternion;
    toAircraftState(body, out);
    expect(out.position).toBe(posRef);
    expect(out.linvel).toBe(linvelRef);
    expect(out.quaternion).toBe(quatRef);
  });

  it('handles zero linvel cleanly (airspeed = 0)', () => {
    const body: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel: new Vector3(0, 0, 0),
      angvel: new Vector3(),
    };
    const out = createAircraftState();
    toAircraftState(body, out);
    expect(out.airspeed).toBe(0);
  });

  it('produces finite values for a representative BodyState', () => {
    const body = makeBodyState();
    const out = createAircraftState();
    toAircraftState(body, out);
    const fields: Array<keyof AircraftState> = [
      'position',
      'linvel',
      'angvel',
      'quaternion',
      'airspeed',
      'altitude',
    ];
    for (const f of fields) {
      const v = out[f];
      if (typeof v === 'number') {
        expect(Number.isFinite(v)).toBe(true);
      } else {
        for (const key of Object.keys(v)) {
          expect(Number.isFinite((v as unknown as Record<string, number>)[key])).toBe(true);
        }
      }
    }
  });
});
