// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from './audio-engine';

// Minimal AudioContext mock — jsdom doesn't ship Web Audio. Records constructor
// calls + exposes the underlying .gain.value / .frequency.value for assertions.
// Matches the surface AudioEngine + EngineLoop + Wind use (createOscillator /
// createGain / createBiquadFilter / createBufferSource / createBuffer / resume
// / close / destination / currentTime / sampleRate).

interface FakeParam {
  value: number;
  cancelScheduledValues: (t: number) => void;
  linearRampToValueAtTime: (v: number, t: number) => void;
  setValueAtTime: (v: number, t: number) => void;
  exponentialRampToValueAtTime: (v: number, t: number) => void;
}
function makeParam(initial = 0): FakeParam {
  const p: FakeParam = {
    value: initial,
    cancelScheduledValues: () => {},
    // Set value immediately on ramp call — tests want to inspect the *target*,
    // not wait for jsdom to advance time. Matches AudioEngine.getState() which
    // reads .value as the post-ramp target.
    linearRampToValueAtTime: (v: number) => {
      p.value = v;
    },
    // setValueAtTime + exponentialRampToValueAtTime — needed by sfx.ts to not
    // throw at trigger time. Same "set value immediately" pattern.
    setValueAtTime: (v: number) => {
      p.value = v;
    },
    exponentialRampToValueAtTime: (v: number) => {
      p.value = v;
    },
  };
  return p;
}

interface FakeAudioBuffer {
  getChannelData: () => Float32Array;
}
interface FakeNode {
  connect: (n: unknown) => void;
  disconnect?: () => void;
}
interface FakeBufferSource extends FakeNode {
  buffer: FakeAudioBuffer | null;
  loop: boolean;
  start: () => void;
  stop: () => void;
}
interface FakeOscillator extends FakeNode {
  type: string;
  frequency: FakeParam;
  start: () => void;
  stop: () => void;
}
interface FakeGain extends FakeNode {
  gain: FakeParam;
}
interface FakeFilter extends FakeNode {
  type: string;
  frequency: FakeParam;
  Q: FakeParam;
}

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination: FakeNode = { connect: () => {} };
  resumeCalls = 0;
  closeCalls = 0;

  createOscillator(): FakeOscillator {
    return {
      type: 'sine',
      frequency: makeParam(440),
      start: () => {},
      stop: () => {},
      connect: () => {},
    };
  }
  createGain(): FakeGain {
    return { gain: makeParam(1), connect: () => {} };
  }
  createBiquadFilter(): FakeFilter {
    return {
      type: 'lowpass',
      frequency: makeParam(350),
      Q: makeParam(1),
      connect: () => {},
    };
  }
  createBufferSource(): FakeBufferSource {
    return {
      buffer: null,
      loop: false,
      start: () => {},
      stop: () => {},
      connect: () => {},
    };
  }
  createBuffer(_channels: number, length: number, _rate: number): FakeAudioBuffer {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
  }
}

// Install the mock on the global before each test.
beforeEach(() => {
  (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
  (window as unknown as { AudioContext: typeof AudioContext }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
});

describe('AudioEngine', () => {
  it('construction is allocation-only — no AudioContext until start()', () => {
    const eng = new AudioEngine();
    expect(eng.getState().contextState).toBe('unset');
  });

  it('start() creates the context and resumes it', async () => {
    const eng = new AudioEngine();
    await eng.start();
    expect(eng.getState().contextState).toBe('running');
  });

  it('start() is idempotent — second call resolves without re-creating', async () => {
    const eng = new AudioEngine();
    await eng.start();
    const stateBefore = eng.getState();
    await eng.start();
    const stateAfter = eng.getState();
    expect(stateAfter.contextState).toBe('running');
    // Frequency/gain didn't reset to defaults (proves nodes weren't rebuilt).
    expect(stateAfter.engineFreqHz).toBe(stateBefore.engineFreqHz);
  });

  it('setEngineThrottle(0) → idle frequency 90 Hz, gain 0', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.setEngineThrottle(0);
    const s = eng.getState();
    expect(s.engineFreqHz).toBeCloseTo(90, 1);
    expect(s.engineGain).toBeCloseTo(0, 3);
  });

  it('setEngineThrottle(1) → redline frequency 340 Hz, gain 0.2', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.setEngineThrottle(1);
    const s = eng.getState();
    expect(s.engineFreqHz).toBeCloseTo(340, 1);
    expect(s.engineGain).toBeCloseTo(0.2, 3);
  });

  it('setEngineThrottle is monotonic in throttle and clamps out-of-range', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.setEngineThrottle(0.25);
    const f25 = eng.getState().engineFreqHz;
    eng.setEngineThrottle(0.5);
    const f50 = eng.getState().engineFreqHz;
    eng.setEngineThrottle(0.75);
    const f75 = eng.getState().engineFreqHz;
    expect(f25).toBeLessThan(f50);
    expect(f50).toBeLessThan(f75);
    // Clamp: throttle=2.0 must produce the same freq as throttle=1.
    eng.setEngineThrottle(2.0);
    expect(eng.getState().engineFreqHz).toBeCloseTo(340, 1);
    eng.setEngineThrottle(-0.5);
    expect(eng.getState().engineFreqHz).toBeCloseTo(90, 1);
  });

  it('setWindAirspeed(0) → silent (gain=0) and below-MIN_AS keeps gain at 0', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.setWindAirspeed(0);
    expect(eng.getState().windGain).toBe(0);
    eng.setWindAirspeed(5);
    expect(eng.getState().windGain).toBe(0);
    eng.setWindAirspeed(9.9);
    expect(eng.getState().windGain).toBe(0);
  });

  it('setWindAirspeed maps high airspeed to max gain (0.15) and high cutoff', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.setWindAirspeed(200); // above MAX_AS=150 → clamped to max
    const s = eng.getState();
    expect(s.windGain).toBeCloseTo(0.15, 3);
    expect(s.windCutoffHz).toBeCloseTo(2000, 0);
  });

  it('setWindAirspeed is monotonic between MIN_AS and MAX_AS', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.setWindAirspeed(20);
    const g20 = eng.getState().windGain;
    eng.setWindAirspeed(80);
    const g80 = eng.getState().windGain;
    eng.setWindAirspeed(140);
    const g140 = eng.getState().windGain;
    expect(g20).toBeLessThan(g80);
    expect(g80).toBeLessThan(g140);
  });

  it('setMasterGain clamps to [0, 1]', () => {
    const eng = new AudioEngine();
    eng.setMasterGain(0.4);
    expect(eng.getState().masterGain).toBeCloseTo(0.4, 3);
    eng.setMasterGain(2.0);
    expect(eng.getState().masterGain).toBe(1);
    eng.setMasterGain(-0.5);
    expect(eng.getState().masterGain).toBe(0);
  });

  it('setEngineThrottle and setWindAirspeed are no-ops before start()', () => {
    const eng = new AudioEngine();
    eng.setEngineThrottle(0.5);
    eng.setWindAirspeed(80);
    // Should not throw, should not allocate a context.
    expect(eng.getState().contextState).toBe('unset');
    expect(eng.getState().engineFreqHz).toBe(0);
    expect(eng.getState().windGain).toBe(0);
  });

  it('_resetForTests returns to clean baseline', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.setEngineThrottle(0.8);
    expect(eng.getState().contextState).toBe('running');
    eng._resetForTests();
    expect(eng.getState().contextState).toBe('unset');
    expect(eng.getState().engineFreqHz).toBe(0);
    expect(eng.getState().masterGain).toBeCloseTo(0.6, 3);
  });

  it('trigger methods are safe before start() — record but do not play', () => {
    const eng = new AudioEngine();
    // Pre-start: should not throw, and should record the intent in the ring.
    expect(() => eng.triggerFire()).not.toThrow();
    expect(() => eng.triggerImpact()).not.toThrow();
    expect(() => eng.triggerCrash()).not.toThrow();
    const ring = eng.getRecentOneShots();
    expect(ring.map((e) => e.type)).toEqual(['fire', 'impact', 'crash']);
    // t_sec is 0 when no context exists yet.
    expect(ring[0]!.t_sec).toBe(0);
  });
});

describe('AudioEngine — Phase 2 one-shot triggers', () => {
  it('triggerFire after start records a fire entry with currentTime', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.triggerFire();
    const ring = eng.getRecentOneShots();
    expect(ring).toHaveLength(1);
    expect(ring[0]!.type).toBe('fire');
    expect(ring[0]!.t_sec).toBeGreaterThanOrEqual(0);
  });

  it('triggerImpact records an impact entry', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.triggerImpact();
    const ring = eng.getRecentOneShots();
    expect(ring).toHaveLength(1);
    expect(ring[0]!.type).toBe('impact');
  });

  it('triggerCrash records a crash entry', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.triggerCrash();
    const ring = eng.getRecentOneShots();
    expect(ring).toHaveLength(1);
    expect(ring[0]!.type).toBe('crash');
  });

  it('ring buffer holds up to 16 entries then wraps oldest-out', async () => {
    const eng = new AudioEngine();
    await eng.start();
    for (let i = 0; i < 20; i++) eng.triggerFire();
    const ring = eng.getRecentOneShots();
    // We have 16 fires; should NOT exceed cap.
    expect(ring).toHaveLength(16);
    expect(ring.every((e) => e.type === 'fire')).toBe(true);
  });

  it('getRecentOneShots returns a fresh deep-copied array each call', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.triggerFire();
    const r1 = eng.getRecentOneShots();
    eng.triggerImpact();
    // r1 was captured before the impact trigger; it must NOT include impact.
    expect(r1.map((e) => e.type)).toEqual(['fire']);
    const r2 = eng.getRecentOneShots();
    expect(r2.map((e) => e.type)).toEqual(['fire', 'impact']);
  });

  it('_resetForTests clears the one-shot ring', async () => {
    const eng = new AudioEngine();
    await eng.start();
    eng.triggerFire();
    eng.triggerImpact();
    expect(eng.getRecentOneShots()).toHaveLength(2);
    eng._resetForTests();
    expect(eng.getRecentOneShots()).toHaveLength(0);
  });
});
