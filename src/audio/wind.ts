// WP19 Phase 1 — Wind: airspeed-driven filtered-noise loop.
//
// Generates 1s of pink-ish noise once at construction (in-memory AudioBuffer)
// and loops it through a lowpass filter. Airspeed maps to filter cutoff
// (200 Hz at AS=10, 2000 Hz at AS≥150) and gain (0 at AS<10, ramps to 0.15
// at AS≥150). Below AS=10 the wind is fully silent — silent taxi/idle.
//
// The noise buffer is generated procedurally (no asset files in the bundle)
// per the WP19 plan's no-external-assets constraint.

const MIN_AS = 10;
const MAX_AS = 150;
const MIN_CUTOFF_HZ = 200;
const MAX_CUTOFF_HZ = 2000;
const MAX_GAIN = 0.15;
const RAMP_SEC = 0.1;
const NOISE_BUFFER_SEC = 1;

function generatePinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * NOISE_BUFFER_SEC);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  // Voss-McCartney-ish pink-noise approximation. For v1 a simple low-passed
  // white noise via a running average is enough — the filter node below
  // does the heavy lifting at playback time.
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = 0.95 * last + 0.05 * white;
    data[i] = last * 3.5; // scale up since the running average attenuates
  }
  return buffer;
}

export class Wind {
  private _source: AudioBufferSourceNode;
  private _filter: BiquadFilterNode;
  private _gain: GainNode;
  private _ctx: AudioContext;
  private _started = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this._ctx = ctx;
    this._source = ctx.createBufferSource();
    this._source.buffer = generatePinkNoiseBuffer(ctx);
    this._source.loop = true;

    this._filter = ctx.createBiquadFilter();
    this._filter.type = 'lowpass';
    this._filter.frequency.value = MIN_CUTOFF_HZ;

    this._gain = ctx.createGain();
    this._gain.gain.value = 0;

    this._source.connect(this._filter);
    this._filter.connect(this._gain);
    this._gain.connect(destination);
  }

  /** Idempotent. */
  start(): void {
    if (this._started) return;
    this._source.start();
    this._started = true;
  }

  /**
   * Set airspeed in m/s. Drives lowpass cutoff + gain. Below MIN_AS the
   * wind is fully silent (gain = 0). Smoothed over RAMP_SEC.
   */
  setAirspeed(as: number): void {
    const clamped = Math.max(0, as);
    let targetGain: number;
    let targetCutoff: number;
    if (clamped < MIN_AS) {
      targetGain = 0;
      targetCutoff = MIN_CUTOFF_HZ;
    } else {
      const frac = Math.min(1, (clamped - MIN_AS) / (MAX_AS - MIN_AS));
      targetGain = MAX_GAIN * frac;
      targetCutoff = MIN_CUTOFF_HZ + (MAX_CUTOFF_HZ - MIN_CUTOFF_HZ) * frac;
    }
    const now = this._ctx.currentTime;
    this._gain.gain.cancelScheduledValues(now);
    this._gain.gain.linearRampToValueAtTime(targetGain, now + RAMP_SEC);
    this._filter.frequency.cancelScheduledValues(now);
    this._filter.frequency.linearRampToValueAtTime(targetCutoff, now + RAMP_SEC);
  }

  getGain(): number {
    return this._gain.gain.value;
  }

  getCutoffHz(): number {
    return this._filter.frequency.value;
  }
}
