import { describe, it, expect } from 'vitest';
import { GameLoop } from './loop';

interface Harness {
  loop: GameLoop;
  physicsCalls: number[];
  renderCalls: number[];
  now: () => number;
  setNow: (t: number) => void;
  rafCallbacks: FrameRequestCallback[];
  flushRaf: (at: number) => void;
}

function makeHarness(physicsDt = 1 / 60, maxStepsPerFrame = 5): Harness {
  let current = 0;
  const rafCallbacks: FrameRequestCallback[] = [];
  const physicsCalls: number[] = [];
  const renderCalls: number[] = [];

  const loop = new GameLoop(
    {
      onPhysics: (dt) => physicsCalls.push(dt),
      onRender: (alpha) => renderCalls.push(alpha),
    },
    {
      physicsDt,
      maxStepsPerFrame,
      now: () => current,
      raf: (cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      },
      cancelRaf: () => {},
    },
  );

  return {
    loop,
    physicsCalls,
    renderCalls,
    now: () => current,
    setNow: (t) => {
      current = t;
    },
    rafCallbacks,
    flushRaf: (at) => {
      current = at;
      const pending = rafCallbacks.splice(0, rafCallbacks.length);
      for (const cb of pending) cb(at * 1000);
    },
  };
}

describe('GameLoop', () => {
  it('1 second of wall time at 60 Hz with per-frame ticks runs 60 physics steps', () => {
    const h = makeHarness();
    h.setNow(0);
    h.loop.start();

    for (let i = 1; i <= 60; i++) {
      h.flushRaf(i / 60);
    }

    expect(h.physicsCalls.length).toBe(60);
    for (const dt of h.physicsCalls) {
      expect(dt).toBeCloseTo(1 / 60, 10);
    }
    expect(h.renderCalls.length).toBe(60);
  });

  it('renders once per rAF regardless of how many physics steps ran', () => {
    const h = makeHarness();
    h.setNow(0);
    h.loop.start();

    h.flushRaf(1 / 60);
    h.flushRaf(2 / 60);
    h.flushRaf(3 / 60);

    expect(h.renderCalls.length).toBe(3);
    expect(h.physicsCalls.length).toBe(3);
  });

  it('clamps catch-up to maxStepsPerFrame when a large time gap occurs', () => {
    const h = makeHarness(1 / 60, 5);
    h.setNow(0);
    h.loop.start();

    h.flushRaf(2.0);

    expect(h.physicsCalls.length).toBe(5);
  });

  it('alpha is in [0, 1]', () => {
    const h = makeHarness();
    h.setNow(0);
    h.loop.start();

    for (let i = 1; i <= 30; i++) {
      h.flushRaf(i / 120);
    }

    for (const alpha of h.renderCalls) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('accumulator advances physics on partial-frame intervals correctly', () => {
    const h = makeHarness();
    h.setNow(0);
    h.loop.start();

    h.flushRaf(1 / 120);
    expect(h.physicsCalls.length).toBe(0);

    h.flushRaf(2 / 120);
    expect(h.physicsCalls.length).toBe(1);

    h.flushRaf(3 / 120);
    expect(h.physicsCalls.length).toBe(1);

    h.flushRaf(4 / 120);
    expect(h.physicsCalls.length).toBe(2);
  });

  it('pausing skips physics but still calls onRender', () => {
    const h = makeHarness();
    h.setNow(0);
    h.loop.start();

    h.loop.setPaused(true);
    h.flushRaf(1.0);

    expect(h.physicsCalls.length).toBe(0);
    expect(h.renderCalls.length).toBe(1);
  });

  it('unpausing does not flood with accumulated physics from the paused window', () => {
    const h = makeHarness();
    h.setNow(0);
    h.loop.start();

    h.loop.setPaused(true);
    h.flushRaf(5.0);
    h.loop.setPaused(false);

    h.flushRaf(5.1);
    expect(h.physicsCalls.length).toBeLessThanOrEqual(6);
    expect(h.physicsCalls.length).toBeGreaterThan(0);
  });
});
