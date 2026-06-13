// Scripted-input harness — parser for URL-string input scripts.
//
// Purpose: deterministic, fixed-timestep-keyed input scheduling for headless
// browser verification of physics-feel behaviors. Replaces Playwright
// `dispatchEvent` (which is OS-scheduler-jitter dependent) per
// SURFACE-2026-06-06-04.
//
// URL grammar:
//   ?script=<event>[,<event>...]
//
// Event forms:
//   hold:<KeyCode>@<startSec>:<endSec>            — synthesize key-down for KeyboardEvent.code
//   hold:<KeyCode>@<startSec>:end                 — same, held until log buffer fills
//   hold:Throttle=<float>@<startSec>:<endSec>     — set Controls.throttle each tick in window
//   hold:Throttle=<float>@<startSec>:end          — same, held until log buffer fills
//
// Time unit: seconds (operator preference). Internally converted to ticks
// via `Math.round(s * 60)` at the 60 Hz fixed-timestep rate.
//
// Validation: config-name regex `/^[a-z0-9_-]+$/i` is the path-traversal
// defense for `?config=<name>` — see `parseConfigName`.

export type ScriptedEvent =
  | { kind: 'key'; code: string; startTick: number; endTick: number | 'end' }
  | { kind: 'throttle'; value: number; startTick: number; endTick: number | 'end' };

export interface ScriptedInputPlan {
  events: ScriptedEvent[];
  /** Ticks of post-script-end settle window before isComplete() returns true. */
  settleTicks: number;
  /** Aircraft config name, e.g. 'aerobatic' → /config/aircraft-aerobatic.json. null = default. */
  configName: string | null;
  /** Tick count after which the buffer stops appending. Capacity ring buffer. */
  logCapacityTicks: number;
}

export interface ParseResult {
  plan: ScriptedInputPlan | null;
  /** Warnings emitted to console.warn at boot — surfaces malformed input non-fatally. */
  warnings: string[];
}

const TICK_RATE_HZ = 60;
const DEFAULT_SETTLE_TICKS = 60; // 1 second
const DEFAULT_LOG_CAPACITY = 3600; // 60 seconds @ 60 Hz
/** Path-traversal defense for `?config=<name>` and mission JSON `config?` field. */
export const CONFIG_NAME_REGEX = /^[a-z0-9_-]+$/i;

/**
 * Parse the URL search params into a ScriptedInputPlan. Returns
 * `{plan: null}` when no `?script=` was supplied (silent no-op — harness
 * inactive). Returns warnings array for malformed segments without throwing —
 * caller logs each warning via console.warn.
 */
export function parseScriptSpec(params: URLSearchParams): ParseResult {
  const warnings: string[] = [];
  const rawScript = params.get('script');
  const rawConfig = params.get('config');
  const configName = parseConfigName(rawConfig, warnings);

  // No script and no config-only-use → null plan (harness inactive).
  // Config-only-use is valid (still want the runner to record telemetry).
  if (rawScript === null && configName === null) {
    return { plan: null, warnings };
  }

  const events: ScriptedEvent[] = [];
  if (rawScript !== null) {
    for (const segment of rawScript.split(',')) {
      const trimmed = segment.trim();
      if (trimmed === '') continue;
      const parsed = parseSegment(trimmed);
      if (parsed === null) {
        warnings.push(`scripted-input: malformed script segment "${trimmed}" — ignored`);
        continue;
      }
      events.push(parsed);
    }
  }

  // If a config was supplied but no script, we still emit a plan so the
  // runner records telemetry against the swapped config. settleTicks=0 since
  // there's no script to settle; isComplete() returns false until log fills.
  return {
    plan: {
      events,
      settleTicks: DEFAULT_SETTLE_TICKS,
      configName,
      logCapacityTicks: DEFAULT_LOG_CAPACITY,
    },
    warnings,
  };
}

function parseSegment(segment: string): ScriptedEvent | null {
  // Form: hold:<Target>@<start>:<end>
  if (!segment.startsWith('hold:')) return null;
  const body = segment.slice('hold:'.length);
  const atIdx = body.indexOf('@');
  if (atIdx < 0) return null;
  const target = body.slice(0, atIdx);
  const window = body.slice(atIdx + 1);
  const colonIdx = window.indexOf(':');
  if (colonIdx < 0) return null;
  const startStr = window.slice(0, colonIdx);
  const endStr = window.slice(colonIdx + 1);

  const startSec = Number.parseFloat(startStr);
  if (!Number.isFinite(startSec) || startSec < 0) return null;
  const startTick = Math.round(startSec * TICK_RATE_HZ);

  let endTick: number | 'end';
  if (endStr === 'end') {
    endTick = 'end';
  } else {
    const endSec = Number.parseFloat(endStr);
    if (!Number.isFinite(endSec) || endSec <= startSec) return null;
    endTick = Math.round(endSec * TICK_RATE_HZ);
  }

  // Throttle special-case: target is `Throttle=<float>`
  if (target.startsWith('Throttle=')) {
    const valueStr = target.slice('Throttle='.length);
    const value = Number.parseFloat(valueStr);
    if (!Number.isFinite(value) || value < 0 || value > 1) return null;
    return { kind: 'throttle', value, startTick, endTick };
  }

  // Key form: target is a KeyboardEvent.code string (e.g. ArrowUp, KeyD).
  // Minimal validation: non-empty, alphanumeric + a few common symbols.
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(target)) return null;
  return { kind: 'key', code: target, startTick, endTick };
}

/**
 * Parse `?config=<name>` with path-traversal defense. Returns the validated
 * name or null (absent OR rejected). Rejection emits a warning.
 */
function parseConfigName(raw: string | null, warnings: string[]): string | null {
  if (raw === null || raw === '') return null;
  if (!CONFIG_NAME_REGEX.test(raw)) {
    warnings.push(
      `scripted-input: ?config=${JSON.stringify(raw)} rejected (must match /^[a-z0-9_-]+$/i); falling back to default config`,
    );
    return null;
  }
  return raw;
}

/**
 * Resolve a validated config name to its public URL path. Caller is
 * responsible for passing only a value returned by parseScriptSpec — no
 * additional validation here.
 */
export function configNameToPath(name: string | null): string {
  const base = import.meta.env.BASE_URL;
  if (name === null) return `${base}config/aircraft.json`;
  return `${base}config/aircraft-${name}.json`;
}

/** Tick rate (Hz) — exported for the runner to convert seconds<->ticks. */
export const SCRIPTED_INPUT_TICK_RATE_HZ = TICK_RATE_HZ;
