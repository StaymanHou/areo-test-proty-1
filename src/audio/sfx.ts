// WP19 Phase 2 — One-shot synthesizers for fire / impact / crash SFX.
//
// Each function schedules short-lived AudioNodes (oscillator + gain envelope
// or noise burst), starts them at the current AudioContext time, and stops
// them at the documented duration. Nodes are discarded after stop; the GC
// reclaims them. No node pool — at the ROF rates the project ships (5/s gun,
// 2/s return fire), allocation overhead is negligible.
//
// All three use a `now + dur` schedule; they do not block. Caller responsible
// for the AudioContext being in the 'running' state before invoking.

const FIRE_DUR_SEC = 0.2;
const IMPACT_DUR_SEC = 0.15;
const CRASH_DUR_SEC = 0.8;

/** Reuses one noise buffer per AudioContext for impact + crash (cheap memo). */
const _noiseBufferCache = new WeakMap<AudioContext, AudioBuffer>();

function getNoiseBuffer(ctx: AudioContext, durSec: number): AudioBuffer {
  // Build a per-call buffer when the cached one is too short. Otherwise the
  // cached one suffices and we slice it at playback time via offset args.
  const cached = _noiseBufferCache.get(ctx);
  const needed = Math.ceil(ctx.sampleRate * Math.max(durSec, CRASH_DUR_SEC));
  if (cached !== undefined && cached.length >= needed) {
    return cached;
  }
  const buf = ctx.createBuffer(1, needed, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < needed; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  _noiseBufferCache.set(ctx, buf);
  return buf;
}

/**
 * Fire SFX — short sawtooth burst with a lowpass sweep down. ~200ms.
 * Output connects to `destination`, which is the AudioEngine's master gain.
 */
export function playFire(ctx: AudioContext, destination: AudioNode): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(900, now);
  osc.frequency.exponentialRampToValueAtTime(300, now + FIRE_DUR_SEC);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2500, now);
  filter.frequency.exponentialRampToValueAtTime(600, now + FIRE_DUR_SEC);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + FIRE_DUR_SEC);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  osc.start(now);
  osc.stop(now + FIRE_DUR_SEC);
}

/**
 * Impact SFX — filtered-noise burst with a fast decay envelope. ~150ms.
 * Output connects to `destination`.
 */
export function playImpact(ctx: AudioContext, destination: AudioNode): void {
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx, IMPACT_DUR_SEC);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1500;
  filter.Q.value = 1.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.6, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + IMPACT_DUR_SEC);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  source.start(now);
  source.stop(now + IMPACT_DUR_SEC);
}

/**
 * Crash SFX — low-frequency saw + noise envelope. ~800ms. Heavier and longer
 * than fire/impact — meant to register a definitive failure event.
 */
export function playCrash(ctx: AudioContext, destination: AudioNode): void {
  const now = ctx.currentTime;
  // Low saw component — the "thud" body.
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(120, now);
  saw.frequency.exponentialRampToValueAtTime(40, now + CRASH_DUR_SEC);

  const sawGain = ctx.createGain();
  sawGain.gain.setValueAtTime(0.5, now);
  sawGain.gain.exponentialRampToValueAtTime(0.001, now + CRASH_DUR_SEC);

  saw.connect(sawGain);
  sawGain.connect(destination);

  // Noise component — the "shatter" texture.
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx, CRASH_DUR_SEC);

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.setValueAtTime(1200, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(200, now + CRASH_DUR_SEC);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + CRASH_DUR_SEC);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(destination);

  saw.start(now);
  saw.stop(now + CRASH_DUR_SEC);
  noise.start(now);
  noise.stop(now + CRASH_DUR_SEC);
}
