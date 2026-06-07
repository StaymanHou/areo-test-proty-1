// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { playFire, playImpact, playCrash } from './sfx';

// Mock AudioContext shape parallel to audio-engine.test.ts but lighter — we
// only assert node counts + start/stop ordering. The same FakeAudioContext
// could be shared via a test helper, but a per-file mock keeps the surface
// each test relies on explicit and resilient to unrelated changes.

interface FakeParam {
  value: number;
  setValueAtTime: (v: number, t: number) => void;
  exponentialRampToValueAtTime: (v: number, t: number) => void;
  linearRampToValueAtTime: (v: number, t: number) => void;
  cancelScheduledValues: (t: number) => void;
}
function makeParam(initial = 0): FakeParam {
  const p: FakeParam = {
    value: initial,
    setValueAtTime: (v) => {
      p.value = v;
    },
    exponentialRampToValueAtTime: (v) => {
      p.value = v;
    },
    linearRampToValueAtTime: (v) => {
      p.value = v;
    },
    cancelScheduledValues: () => {},
  };
  return p;
}

interface NodeLog {
  oscillators: { type: string; started: boolean; stopped: boolean }[];
  gains: { value: number }[];
  filters: { type: string }[];
  bufferSources: { started: boolean; stopped: boolean }[];
  buffersCreated: number;
}

class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'running';
  currentTime = 1.5; // arbitrary non-zero
  sampleRate = 44100;
  destination = { connect: () => {} };
  log: NodeLog = {
    oscillators: [],
    gains: [],
    filters: [],
    bufferSources: [],
    buffersCreated: 0,
  };

  createOscillator() {
    const entry = { type: 'sine', started: false, stopped: false };
    this.log.oscillators.push(entry);
    return {
      get type() {
        return entry.type;
      },
      set type(v: string) {
        entry.type = v;
      },
      frequency: makeParam(440),
      start: () => {
        entry.started = true;
      },
      stop: () => {
        entry.stopped = true;
      },
      connect: () => {},
    };
  }
  createGain() {
    const param = makeParam(1);
    this.log.gains.push(param);
    return { gain: param, connect: () => {} };
  }
  createBiquadFilter() {
    const entry = { type: 'lowpass' };
    this.log.filters.push(entry);
    return {
      get type() {
        return entry.type;
      },
      set type(v: string) {
        entry.type = v;
      },
      frequency: makeParam(350),
      Q: makeParam(1),
      connect: () => {},
    };
  }
  createBufferSource() {
    const entry = { started: false, stopped: false };
    this.log.bufferSources.push(entry);
    return {
      buffer: null as null | { getChannelData: () => Float32Array },
      loop: false,
      start: () => {
        entry.started = true;
      },
      stop: () => {
        entry.stopped = true;
      },
      connect: () => {},
    };
  }
  createBuffer(_ch: number, length: number, _rate: number) {
    this.log.buffersCreated++;
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
}

let ctx: FakeAudioContext;
let dest: { connect: () => void };

beforeEach(() => {
  ctx = new FakeAudioContext();
  dest = { connect: () => {} };
});

describe('sfx', () => {
  describe('playFire', () => {
    it('creates a sawtooth oscillator + lowpass filter + gain envelope', () => {
      playFire(ctx as unknown as AudioContext, dest as unknown as AudioNode);
      expect(ctx.log.oscillators).toHaveLength(1);
      expect(ctx.log.oscillators[0]!.type).toBe('sawtooth');
      expect(ctx.log.filters).toHaveLength(1);
      expect(ctx.log.filters[0]!.type).toBe('lowpass');
      expect(ctx.log.gains).toHaveLength(1);
    });

    it('starts AND stops the oscillator', () => {
      playFire(ctx as unknown as AudioContext, dest as unknown as AudioNode);
      expect(ctx.log.oscillators[0]!.started).toBe(true);
      expect(ctx.log.oscillators[0]!.stopped).toBe(true);
    });
  });

  describe('playImpact', () => {
    it('creates a buffer source + bandpass filter + gain envelope', () => {
      playImpact(ctx as unknown as AudioContext, dest as unknown as AudioNode);
      expect(ctx.log.bufferSources).toHaveLength(1);
      expect(ctx.log.filters).toHaveLength(1);
      expect(ctx.log.filters[0]!.type).toBe('bandpass');
      expect(ctx.log.gains).toHaveLength(1);
      // Impact uses noise — must have allocated a buffer.
      expect(ctx.log.buffersCreated).toBeGreaterThanOrEqual(1);
    });

    it('starts AND stops the buffer source', () => {
      playImpact(ctx as unknown as AudioContext, dest as unknown as AudioNode);
      expect(ctx.log.bufferSources[0]!.started).toBe(true);
      expect(ctx.log.bufferSources[0]!.stopped).toBe(true);
    });
  });

  describe('playCrash', () => {
    it('creates a low sawtooth + a noise component (2 sources, 2 gains, 1 filter)', () => {
      playCrash(ctx as unknown as AudioContext, dest as unknown as AudioNode);
      expect(ctx.log.oscillators).toHaveLength(1);
      expect(ctx.log.oscillators[0]!.type).toBe('sawtooth');
      expect(ctx.log.bufferSources).toHaveLength(1);
      expect(ctx.log.gains).toHaveLength(2); // one for saw, one for noise
      expect(ctx.log.filters).toHaveLength(1);
      expect(ctx.log.filters[0]!.type).toBe('lowpass');
    });

    it('starts AND stops both the oscillator and buffer source', () => {
      playCrash(ctx as unknown as AudioContext, dest as unknown as AudioNode);
      expect(ctx.log.oscillators[0]!.started).toBe(true);
      expect(ctx.log.oscillators[0]!.stopped).toBe(true);
      expect(ctx.log.bufferSources[0]!.started).toBe(true);
      expect(ctx.log.bufferSources[0]!.stopped).toBe(true);
    });
  });

  it('noise buffer is cached per AudioContext — playImpact + playCrash share one buffer', () => {
    playImpact(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    const afterImpact = ctx.log.buffersCreated;
    playCrash(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    // After the second call, buffer count may have grown (crash needs ≥
    // CRASH_DUR_SEC samples; if impact's cached buffer was smaller it gets
    // re-allocated). The cache is observable per-context, so re-calling
    // playCrash a third time MUST NOT allocate again.
    const afterCrash1 = ctx.log.buffersCreated;
    playCrash(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    const afterCrash2 = ctx.log.buffersCreated;
    expect(afterCrash2).toBe(afterCrash1);
    expect(afterImpact).toBeGreaterThanOrEqual(1);
  });
});
