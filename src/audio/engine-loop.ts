// WP19 Phase 1 — Engine loop: throttle-driven sawtooth oscillator.
//
// Throttle 0..1 maps linearly to frequency 90..340 Hz (idle to redline)
// and gain 0..0.2 (silent at idle so a stopped throttle ≠ humming wing).
// Smoothed via linearRampToValueAtTime over RAMP_SEC to avoid clicks when
// the throttle changes abruptly (e.g. Throttle=0 immediately after fire).

const IDLE_HZ = 90;
const REDLINE_HZ = 340;
const MIN_GAIN = 0;
const MAX_GAIN = 0.2;
const RAMP_SEC = 0.05;

export class EngineLoop {
  private _osc: OscillatorNode;
  private _gain: GainNode;
  private _ctx: AudioContext;
  private _started = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this._ctx = ctx;
    this._osc = ctx.createOscillator();
    this._osc.type = 'sawtooth';
    this._osc.frequency.value = IDLE_HZ;

    this._gain = ctx.createGain();
    this._gain.gain.value = MIN_GAIN;

    this._osc.connect(this._gain);
    this._gain.connect(destination);
  }

  /** Idempotent — calling start() twice is harmless. */
  start(): void {
    if (this._started) return;
    this._osc.start();
    this._started = true;
  }

  /**
   * Set throttle in [0, 1]. Out-of-range values are clamped. Frequency and
   * gain ramp over RAMP_SEC to avoid audible discontinuities.
   */
  setThrottle(t: number): void {
    const clamped = Math.max(0, Math.min(1, t));
    const targetFreq = IDLE_HZ + (REDLINE_HZ - IDLE_HZ) * clamped;
    const targetGain = MIN_GAIN + (MAX_GAIN - MIN_GAIN) * clamped;
    const now = this._ctx.currentTime;
    this._osc.frequency.cancelScheduledValues(now);
    this._osc.frequency.linearRampToValueAtTime(targetFreq, now + RAMP_SEC);
    this._gain.gain.cancelScheduledValues(now);
    this._gain.gain.linearRampToValueAtTime(targetGain, now + RAMP_SEC);
  }

  /** Current oscillator frequency (post-ramp target). */
  getFrequencyHz(): number {
    return this._osc.frequency.value;
  }

  /** Current gain value (post-ramp target). */
  getGain(): number {
    return this._gain.gain.value;
  }
}
