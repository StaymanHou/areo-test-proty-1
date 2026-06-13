// WP19 — AudioEngine: singleton owner of the AudioContext + master gain.
//
// Construction is allocation-only (no AudioContext is created until start() is
// called from a user-gesture handler, per Safari/iOS autoplay restrictions —
// research R4). Once start() is called, the engine spins up the engine-loop
// oscillator and the wind buffer-source; both run continuously for the rest
// of the session. setEngineThrottle() and setWindAirspeed() are the per-tick
// hot path — two scalar writes, no allocations.
//
// Per the project's per-tick mutable state convention (CLAUDE.md), exports
// getState() for the window.__audio debug accessor and _resetForTests() to
// rebuild the singleton for Vitest.

import { EngineLoop } from './engine-loop';
import { Wind } from './wind';
import { playFire, playImpact, playCrash } from './sfx';
import { getMasterVolume } from './master-volume';

/**
 * AudioContext constructor type. Browsers also expose a webkitAudioContext
 * fallback on older Safari — we sniff for it but don't bake the union into
 * the public type since lib.dom.d.ts already covers the standard one.
 */
type AudioCtxCtor = typeof AudioContext;

declare global {
  interface Window {
    webkitAudioContext?: AudioCtxCtor;
  }
}

export interface AudioEngineState {
  // 'unset' = AudioContext not yet created; otherwise mirrors AudioContextState
  // (Safari adds 'interrupted' beyond the standard 'suspended'/'running'/'closed').
  contextState: 'unset' | AudioContextState;
  engineFreqHz: number;
  engineGain: number;
  windGain: number;
  windCutoffHz: number;
  masterGain: number;
}

export type OneShotType = 'fire' | 'impact' | 'crash';
export interface OneShotEntry {
  type: OneShotType;
  t_sec: number;
}

const ONE_SHOT_RING_SIZE = 16;

export class AudioEngine {
  private _ctx: AudioContext | null = null;
  private _master: GainNode | null = null;
  private _engineLoop: EngineLoop | null = null;
  private _wind: Wind | null = null;
  private _masterGainValue: number;
  private _startInFlight: Promise<void> | null = null;
  // Ring buffer of recent one-shot triggers (debug-only, deep-copied on read).
  private _oneShots: OneShotEntry[] = [];
  private _oneShotCursor = 0;

  constructor() {
    // Read the persisted master-volume at construction so the engine starts
    // at the player's last choice. Missing/invalid storage collapses to
    // DEFAULT_MASTER_VOLUME (0.5) per master-volume.ts.
    this._masterGainValue = getMasterVolume();
  }

  /**
   * Resolve and instantiate the AudioContext, then resume it. Idempotent —
   * subsequent calls return the same in-flight promise (or resolve immediately
   * if already running). MUST be called from a user-gesture handler in Safari
   * for the resume() to succeed; throws-as-warning are caught by the caller.
   */
  start(): Promise<void> {
    if (this._ctx !== null && this._ctx.state === 'running') {
      return Promise.resolve();
    }
    if (this._startInFlight !== null) return this._startInFlight;

    this._startInFlight = (async () => {
      if (this._ctx === null) {
        const Ctor: AudioCtxCtor | undefined =
          typeof window !== 'undefined'
            ? (window.AudioContext ?? window.webkitAudioContext)
            : undefined;
        if (Ctor === undefined) {
          throw new Error('AudioContext is not available in this environment');
        }
        this._ctx = new Ctor();
        this._master = this._ctx.createGain();
        this._master.gain.value = this._masterGainValue;
        this._master.connect(this._ctx.destination);

        this._engineLoop = new EngineLoop(this._ctx, this._master);
        this._wind = new Wind(this._ctx, this._master);
        this._engineLoop.start();
        this._wind.start();
      }
      if (this._ctx.state === 'suspended') {
        await this._ctx.resume();
      }
    })();
    return this._startInFlight;
  }

  /** Master gain in [0, 1]. Clamped. Applied immediately. */
  setMasterGain(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this._masterGainValue = clamped;
    if (this._master !== null) {
      this._master.gain.value = clamped;
    }
  }

  /** Per-tick — throttle in [0, 1]. No-op before start(). */
  setEngineThrottle(t: number): void {
    if (this._engineLoop === null) return;
    this._engineLoop.setThrottle(t);
  }

  /** Per-tick — airspeed in m/s. No-op before start(). */
  setWindAirspeed(as: number): void {
    if (this._wind === null) return;
    this._wind.setAirspeed(as);
  }

  /**
   * One-shot SFX triggers. No-op before start() (the AudioContext hasn't been
   * resumed yet — calling from a pre-gesture path would be a soft warning at
   * best in Safari and a confusing dropped sound elsewhere). The trigger is
   * also recorded in the debug ring buffer regardless of context state so
   * tests can observe trigger intent independently of audio output.
   */
  triggerFire(): void {
    this._recordOneShot('fire');
    if (this._ctx === null || this._master === null) return;
    if (this._ctx.state !== 'running') return;
    playFire(this._ctx, this._master);
  }
  triggerImpact(): void {
    this._recordOneShot('impact');
    if (this._ctx === null || this._master === null) return;
    if (this._ctx.state !== 'running') return;
    playImpact(this._ctx, this._master);
  }
  triggerCrash(): void {
    this._recordOneShot('crash');
    if (this._ctx === null || this._master === null) return;
    if (this._ctx.state !== 'running') return;
    playCrash(this._ctx, this._master);
  }

  /**
   * Returns up to ONE_SHOT_RING_SIZE most recent one-shot triggers in
   * chronological order (oldest first). Always deep-copies — caller can hold
   * the array safely. Returns [] if no triggers have fired.
   */
  getRecentOneShots(): OneShotEntry[] {
    return this._oneShots.map((e) => ({ type: e.type, t_sec: e.t_sec }));
  }

  private _recordOneShot(type: OneShotType): void {
    const t_sec = this._ctx === null ? 0 : this._ctx.currentTime;
    const entry: OneShotEntry = { type, t_sec };
    if (this._oneShots.length < ONE_SHOT_RING_SIZE) {
      this._oneShots.push(entry);
    } else {
      this._oneShots[this._oneShotCursor] = entry;
      this._oneShotCursor = (this._oneShotCursor + 1) % ONE_SHOT_RING_SIZE;
    }
  }

  /** Deep-copied snapshot for the window.__audio debug accessor. */
  getState(): AudioEngineState {
    return {
      contextState: this._ctx === null ? 'unset' : this._ctx.state,
      engineFreqHz: this._engineLoop?.getFrequencyHz() ?? 0,
      engineGain: this._engineLoop?.getGain() ?? 0,
      windGain: this._wind?.getGain() ?? 0,
      windCutoffHz: this._wind?.getCutoffHz() ?? 0,
      masterGain: this._masterGainValue,
    };
  }

  /**
   * Test-only reset. Tears down the context if one was created and clears
   * all node references so the next start() rebuilds from scratch. Closing
   * the context is best-effort (close() may reject in some test envs).
   */
  _resetForTests(): void {
    if (this._ctx !== null) {
      void this._ctx.close().catch(() => {
        /* test env may not support close() */
      });
    }
    this._ctx = null;
    this._master = null;
    this._engineLoop = null;
    this._wind = null;
    this._masterGainValue = getMasterVolume();
    this._startInFlight = null;
    this._oneShots = [];
    this._oneShotCursor = 0;
  }
}
