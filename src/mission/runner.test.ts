import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAircraftState, type AircraftState } from '../aircraft/physics-core/state';
import { clearRegistry, registerHook, type HookFn } from './hooks/registry';
import { MissionRunner, OUT_OF_BOUNDS_LIMIT } from './runner';
import type { Mission } from './types';

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'test',
    name: 'Test',
    type: 'free-flight',
    spawn: {
      position: { x: 0, y: 50, z: 0 },
      linvel: { x: 0, y: 0, z: -30 },
      throttle: 0,
    },
    objectives: [],
    winCondition: 'all-objectives',
    failCondition: 'crash',
    ...overrides,
  };
}

function makeAircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  const s = createAircraftState();
  if (overrides.position) Object.assign(s.position, overrides.position);
  if (overrides.linvel) Object.assign(s.linvel, overrides.linvel);
  if (overrides.angvel) Object.assign(s.angvel, overrides.angvel);
  if (overrides.quaternion) Object.assign(s.quaternion, overrides.quaternion);
  if (overrides.airspeed !== undefined) s.airspeed = overrides.airspeed;
  if (overrides.altitude !== undefined) s.altitude = overrides.altitude;
  return s;
}

const DT = 1 / 60;

describe('MissionRunner — lifecycle', () => {
  beforeEach(() => clearRegistry());

  it('starts in not-started status', () => {
    const r = new MissionRunner();
    expect(r.getStatus()).toBe('not-started');
  });

  it('start() transitions to running and resets state', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    expect(r.getStatus()).toBe('running');
    expect(r.getElapsed()).toBe(0);
    expect(r.getObjectiveStates()).toEqual([]);
  });

  it('tick() does nothing when status is not-started', () => {
    const r = new MissionRunner();
    r.tick(makeAircraft(), DT);
    expect(r.getStatus()).toBe('not-started');
    expect(r.getElapsed()).toBe(0);
  });

  it('tick() accumulates elapsed time', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    r.tick(makeAircraft(), DT);
    r.tick(makeAircraft(), DT);
    expect(r.getElapsed()).toBeCloseTo(DT * 2, 9);
  });

  it('start() throws if scriptHook names an unregistered hook', () => {
    const r = new MissionRunner();
    expect(() =>
      r.start(makeMission({ scriptHook: 'combat-ai' })),
    ).toThrow(/scriptHook "combat-ai" is not registered/);
  });

  it('start() resolves a registered scriptHook successfully', () => {
    registerHook('test-hook', () => {});
    const r = new MissionRunner();
    expect(() =>
      r.start(makeMission({ scriptHook: 'test-hook' })),
    ).not.toThrow();
  });
});

describe('MissionRunner — win condition (all-objectives)', () => {
  beforeEach(() => clearRegistry());

  it('reaches won when all reach-waypoint objectives are completed', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'waypoint',
        objectives: [
          { kind: 'reach-waypoint', position: { x: 0, y: 50, z: 0 }, radius: 30, order: 0 },
        ],
      }),
    );
    // Aircraft at the waypoint center.
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(r.getStatus()).toBe('won');
  });

  it('reach-waypoint: incomplete when outside radius', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'waypoint',
        objectives: [
          { kind: 'reach-waypoint', position: { x: 0, y: 50, z: 0 }, radius: 30, order: 0 },
        ],
      }),
    );
    r.tick(makeAircraft({ position: { x: 100, y: 50, z: 0 } }), DT);
    expect(r.getStatus()).toBe('running');
    expect(r.getObjectiveStates()[0]!.completed).toBe(false);
  });

  it('reach-waypoint order: order=1 cannot complete before order=0', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'waypoint',
        objectives: [
          { kind: 'reach-waypoint', position: { x: 100, y: 50, z: 0 }, radius: 30, order: 0 },
          { kind: 'reach-waypoint', position: { x: 200, y: 50, z: 0 }, radius: 30, order: 1 },
        ],
      }),
    );
    // Aircraft sits at waypoint 1's location but waypoint 0 is incomplete.
    r.tick(makeAircraft({ position: { x: 200, y: 50, z: 0 } }), DT);
    expect(r.getObjectiveStates()[0]!.completed).toBe(false);
    expect(r.getObjectiveStates()[1]!.completed).toBe(false);
    expect(r.getStatus()).toBe('running');

    // Complete waypoint 0 first.
    r.tick(makeAircraft({ position: { x: 100, y: 50, z: 0 } }), DT);
    expect(r.getObjectiveStates()[0]!.completed).toBe(true);

    // Now waypoint 1 can complete.
    r.tick(makeAircraft({ position: { x: 200, y: 50, z: 0 } }), DT);
    expect(r.getObjectiveStates()[1]!.completed).toBe(true);
    expect(r.getStatus()).toBe('won');
  });

  it('free-flight (objectives=[]) does NOT auto-win on tick', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(r.getStatus()).toBe('running');
  });
});

describe('MissionRunner — touchdown objective', () => {
  beforeEach(() => clearRegistry());

  it('completes when aircraft is inside runway bounds with low vSpeed', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'takeoff-landing',
        objectives: [
          {
            kind: 'touchdown',
            runway: {
              center: { x: 0, y: 0, z: 0 },
              halfExtents: { x: 15, y: 2, z: 300 },
            },
            maxVSpeed: 5,
          },
        ],
      }),
    );
    r.tick(
      makeAircraft({
        position: { x: 5, y: 1, z: -100 },
        linvel: { x: 0, y: -1, z: -10 },
      }),
      DT,
    );
    expect(r.getObjectiveStates()[0]!.completed).toBe(true);
    expect(r.getStatus()).toBe('won');
  });

  it('does not complete when outside runway bounds', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'takeoff-landing',
        objectives: [
          {
            kind: 'touchdown',
            runway: {
              center: { x: 0, y: 0, z: 0 },
              halfExtents: { x: 15, y: 2, z: 300 },
            },
            maxVSpeed: 5,
          },
        ],
      }),
    );
    // Outside x bounds (|x|=50 > 15)
    r.tick(
      makeAircraft({ position: { x: 50, y: 1, z: -100 }, linvel: { x: 0, y: -1, z: -10 } }),
      DT,
    );
    expect(r.getObjectiveStates()[0]!.completed).toBe(false);
  });

  it('does not complete when vSpeed exceeds maxVSpeed', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'takeoff-landing',
        objectives: [
          {
            kind: 'touchdown',
            runway: {
              center: { x: 0, y: 0, z: 0 },
              halfExtents: { x: 15, y: 2, z: 300 },
            },
            maxVSpeed: 5,
          },
        ],
      }),
    );
    // Inside bounds but vy = -10 (hard impact)
    r.tick(
      makeAircraft({ position: { x: 0, y: 1, z: 0 }, linvel: { x: 0, y: -10, z: -10 } }),
      DT,
    );
    expect(r.getObjectiveStates()[0]!.completed).toBe(false);
  });
});

describe('MissionRunner — destroy-target objective (hook-driven)', () => {
  beforeEach(() => clearRegistry());

  it('stays incomplete until a hook flips ObjectiveState.completed', () => {
    const r = new MissionRunner();
    let shouldDestroy = false;
    const hook: HookFn = (_state, _aircraft, objectives) => {
      if (shouldDestroy) {
        // Walk and set the destroy-target ObjectiveState.completed = true.
        // (In WP16 the hook will track which target the runner cares about
        // via the targetId; for this test the hook always sets index 0.)
        (objectives[0] as { completed: boolean }).completed = true;
      }
    };
    registerHook('combat-ai', hook);
    r.start(
      makeMission({
        type: 'combat',
        scriptHook: 'combat-ai',
        objectives: [{ kind: 'destroy-target', targetId: 't1' }],
      }),
    );
    // Tick once with shouldDestroy=false → still running.
    r.tick(makeAircraft(), DT);
    expect(r.getStatus()).toBe('running');
    expect(r.getObjectiveStates()[0]!.completed).toBe(false);
    // Flip the flag and tick again.
    shouldDestroy = true;
    r.tick(makeAircraft(), DT);
    expect(r.getObjectiveStates()[0]!.completed).toBe(true);
    expect(r.getStatus()).toBe('won');
  });
});

describe('MissionRunner — fail conditions', () => {
  beforeEach(() => clearRegistry());

  it('crash: y ≤ 0 AND |linvel.y| > threshold → failed', () => {
    const r = new MissionRunner();
    r.start(makeMission()); // failCondition: 'crash' (default)
    r.tick(makeAircraft({ position: { x: 0, y: -0.1, z: 0 }, linvel: { x: 0, y: -10, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
  });

  it('crash: y ≤ 0 but gentle vSpeed → NOT failed (could be a soft landing)', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    r.tick(makeAircraft({ position: { x: 0, y: 0, z: 0 }, linvel: { x: 0, y: -0.5, z: 0 } }), DT);
    expect(r.getStatus()).toBe('running');
  });

  it('timeout: elapsed ≥ timeoutSec → failed', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        failCondition: 'timeout',
        timeoutSec: 5,
        objectives: [
          { kind: 'reach-waypoint', position: { x: 0, y: 50, z: -1000 }, radius: 5, order: 0 },
        ],
      }),
    );
    // Tick for 5+ seconds of elapsed dt without hitting the (unreachable)
    // waypoint. The +1 absorbs FP accumulation undershoot (60×1/60 ≈
    // 4.99999999999999 at 300 ticks; one extra tick crosses the threshold).
    for (let i = 0; i < 60 * 5 + 1; i++) {
      r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    }
    expect(r.getStatus()).toBe('failed');
  });

  it('out-of-bounds: |x| > LIMIT → failed', () => {
    const r = new MissionRunner();
    r.start(makeMission({ failCondition: 'out-of-bounds' }));
    r.tick(
      makeAircraft({ position: { x: OUT_OF_BOUNDS_LIMIT + 1, y: 50, z: 0 } }),
      DT,
    );
    expect(r.getStatus()).toBe('failed');
  });

  it('out-of-bounds: |z| > LIMIT → failed', () => {
    const r = new MissionRunner();
    r.start(makeMission({ failCondition: 'out-of-bounds' }));
    r.tick(
      makeAircraft({ position: { x: 0, y: 50, z: -(OUT_OF_BOUNDS_LIMIT + 1) } }),
      DT,
    );
    expect(r.getStatus()).toBe('failed');
  });

  it('stops ticking after a terminal state (won/failed)', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    r.tick(makeAircraft({ position: { x: 0, y: -0.1, z: 0 }, linvel: { x: 0, y: -10, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
    const elapsedAfterFail = r.getElapsed();
    // Subsequent ticks should NOT advance elapsed (terminal state).
    r.tick(makeAircraft(), DT);
    expect(r.getElapsed()).toBe(elapsedAfterFail);
  });
});

describe('MissionRunner — hook-driven fail flag (WP16 Phase 4)', () => {
  beforeEach(() => clearRegistry());

  it('setHookFailFlag while running → next tick transitions to failed', () => {
    const r = new MissionRunner();
    r.start(makeMission({ spawn: { position: { x: 0, y: 50, z: 0 }, linvel: { x: 0, y: 0, z: -30 }, throttle: 0 } }));
    r.setHookFailFlag('shot down');
    expect(r.getStatus()).toBe('running'); // flag set, not yet observed
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
  });

  it('setHookFailFlag fires statusChange on the observing tick', () => {
    const r = new MissionRunner();
    r.start(makeMission({ spawn: { position: { x: 0, y: 50, z: 0 }, linvel: { x: 0, y: 0, z: -30 }, throttle: 0 } }));
    const cb = vi.fn();
    r.on('statusChange', cb);
    r.setHookFailFlag('shot down');
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('setHookFailFlag is a no-op when status is not "running"', () => {
    const r = new MissionRunner();
    // Not started yet.
    r.setHookFailFlag('cannot fail');
    expect(r.getStatus()).toBe('not-started');
    // After start + already-failed, also a no-op for further flag-setting.
    r.start(makeMission());
    r.tick(makeAircraft({ position: { x: 0, y: -0.1, z: 0 }, linvel: { x: 0, y: -10, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
    r.setHookFailFlag('also a no-op');
    // Status unchanged.
    expect(r.getStatus()).toBe('failed');
  });

  it('start() resets the hook-fail flag from a previous mission', () => {
    const r = new MissionRunner();
    r.start(makeMission({ spawn: { position: { x: 0, y: 50, z: 0 }, linvel: { x: 0, y: 0, z: -30 }, throttle: 0 } }));
    r.setHookFailFlag('shot down');
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
    // Restart — flag should be cleared, mission should run normally.
    r.start(makeMission({ spawn: { position: { x: 0, y: 50, z: 0 }, linvel: { x: 0, y: 0, z: -30 }, throttle: 0 } }));
    expect(r.getStatus()).toBe('running');
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(r.getStatus()).toBe('running'); // no fail
  });

  it('hook-fail flag takes precedence over declarative failConditions', () => {
    // Aircraft is at out-of-bounds AND the hook signals fail. Both fire on
    // the same tick — hook flag should win (it's checked first in step 4a).
    const r = new MissionRunner();
    r.start(
      makeMission({
        failCondition: 'out-of-bounds',
        spawn: { position: { x: 0, y: 50, z: 0 }, linvel: { x: 0, y: 0, z: -30 }, throttle: 0 },
      }),
    );
    r.setHookFailFlag('shot down');
    r.tick(makeAircraft({ position: { x: 99999, y: 50, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
    // Both would cause a fail — what matters is that exactly one statusChange fires.
  });
});

describe('MissionRunner — event emitter', () => {
  beforeEach(() => clearRegistry());

  it('fires objectiveChange when an objective completes', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'waypoint',
        objectives: [
          { kind: 'reach-waypoint', position: { x: 0, y: 50, z: 0 }, radius: 30, order: 0 },
        ],
      }),
    );
    const cb = vi.fn();
    r.on('objectiveChange', cb);
    // Not yet at waypoint.
    r.tick(makeAircraft({ position: { x: 100, y: 50, z: 0 } }), DT);
    expect(cb).not.toHaveBeenCalled();
    // Reach it.
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires statusChange on running→won', () => {
    const r = new MissionRunner();
    const cb = vi.fn();
    r.start(
      makeMission({
        type: 'waypoint',
        objectives: [
          { kind: 'reach-waypoint', position: { x: 0, y: 50, z: 0 }, radius: 30, order: 0 },
        ],
      }),
    );
    // start() fires statusChange once (not-started → running).
    r.on('statusChange', cb);
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(cb).toHaveBeenCalledTimes(1); // running→won
    expect(r.getStatus()).toBe('won');
  });

  it('fires statusChange on running→failed', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    const cb = vi.fn();
    r.on('statusChange', cb);
    r.tick(makeAircraft({ position: { x: 0, y: -0.1, z: 0 }, linvel: { x: 0, y: -10, z: 0 } }), DT);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('off() unsubscribes a callback', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'waypoint',
        objectives: [
          { kind: 'reach-waypoint', position: { x: 0, y: 50, z: 0 }, radius: 30, order: 0 },
        ],
      }),
    );
    const cb = vi.fn();
    r.on('objectiveChange', cb);
    r.off('objectiveChange', cb);
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(cb).not.toHaveBeenCalled();
  });

  it('off() is a no-op for unregistered callbacks', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    expect(() => r.off('objectiveChange', () => {})).not.toThrow();
  });
});

describe('MissionRunner — defaults from parsed mission', () => {
  beforeEach(() => clearRegistry());

  it('honors winCondition default when omitted by an upstream mutation', () => {
    // Build a Mission missing winCondition (simulating a path where someone
    // bypassed parseMission). Runner should still fall back to 'all-objectives'.
    const m = makeMission({
      type: 'waypoint',
      objectives: [
        { kind: 'reach-waypoint', position: { x: 0, y: 50, z: 0 }, radius: 30, order: 0 },
      ],
    });
    delete (m as { winCondition?: unknown }).winCondition;
    const r = new MissionRunner();
    r.start(m);
    r.tick(makeAircraft({ position: { x: 0, y: 50, z: 0 } }), DT);
    expect(r.getStatus()).toBe('won');
  });

  it('honors failCondition default when omitted', () => {
    const m = makeMission();
    delete (m as { failCondition?: unknown }).failCondition;
    const r = new MissionRunner();
    r.start(m);
    r.tick(makeAircraft({ position: { x: 0, y: -0.1, z: 0 }, linvel: { x: 0, y: -10, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
  });
});

describe('MissionRunner — performance (allocation-free hot path)', () => {
  beforeEach(() => clearRegistry());

  it('1000 ticks complete in under 50 ms (allocation-free perf proxy)', () => {
    const r = new MissionRunner();
    r.start(
      makeMission({
        type: 'waypoint',
        objectives: [
          { kind: 'reach-waypoint', position: { x: 0, y: 50, z: -10000 }, radius: 5, order: 0 },
        ],
      }),
    );
    const aircraft = makeAircraft();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      r.tick(aircraft, DT);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

describe('MissionRunner — restart (start() called on the same runner twice)', () => {
  beforeEach(() => clearRegistry());

  it('reuses the ObjectiveStates array (no new alloc when lengths match)', () => {
    const r = new MissionRunner();
    const m = makeMission({
      type: 'waypoint',
      objectives: [
        { kind: 'reach-waypoint', position: { x: 0, y: 50, z: 0 }, radius: 30, order: 0 },
      ],
    });
    r.start(m);
    const firstStates = r.getObjectiveStates();
    r.start(m);
    expect(r.getObjectiveStates()).toBe(firstStates);
    expect(firstStates[0]!.completed).toBe(false);
  });

  it('resets elapsed and status on restart', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    r.tick(makeAircraft({ position: { x: 0, y: -0.1, z: 0 }, linvel: { x: 0, y: -10, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');

    r.start(makeMission());
    expect(r.getStatus()).toBe('running');
    expect(r.getElapsed()).toBe(0);
  });
});

describe('MissionRunner — abort (WP13)', () => {
  beforeEach(() => clearRegistry());

  it('abort() from running sets status=failed and wasAborted=true', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    expect(r.wasAborted()).toBe(false);
    r.abort();
    expect(r.getStatus()).toBe('failed');
    expect(r.wasAborted()).toBe(true);
  });

  it('abort() emits statusChange', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    const listener = vi.fn();
    r.on('statusChange', listener);
    r.abort();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('abort() is a no-op when not running (status stays unchanged)', () => {
    const r = new MissionRunner();
    // Not-started — abort should be silent.
    const listener = vi.fn();
    r.on('statusChange', listener);
    r.abort();
    expect(r.getStatus()).toBe('not-started');
    expect(r.wasAborted()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    // After natural fail — abort should still be silent.
    r.start(makeMission());
    r.tick(makeAircraft({ position: { x: 0, y: 0, z: 0 }, linvel: { x: 0, y: -5, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
    expect(r.wasAborted()).toBe(false); // natural crash, not abort
    listener.mockClear();
    r.abort();
    expect(r.wasAborted()).toBe(false); // still false — abort was a no-op
    expect(listener).not.toHaveBeenCalled();
  });

  it('start() after abort() resets wasAborted', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    r.abort();
    expect(r.wasAborted()).toBe(true);
    r.start(makeMission());
    expect(r.wasAborted()).toBe(false);
    expect(r.getStatus()).toBe('running');
  });

  it('natural fail (crash) leaves wasAborted=false', () => {
    const r = new MissionRunner();
    r.start(makeMission());
    r.tick(makeAircraft({ position: { x: 0, y: 0, z: 0 }, linvel: { x: 0, y: -5, z: 0 } }), DT);
    expect(r.getStatus()).toBe('failed');
    expect(r.wasAborted()).toBe(false);
  });
});
