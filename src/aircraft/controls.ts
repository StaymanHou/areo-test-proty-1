import { DEFAULT_KEY_MAP, type InputManager, type KeyMap } from '../engine/input';

/** Input-curve shape applied to the three stick axes (aileron/elevator/rudder). */
export type StickCurve = 'linear' | 'cubic';

export interface ControlsOptions {
  keyMap?: KeyMap;
  /** Stick axis ramp rate (units of axis-value per second). Default 5.0 → full-scale in 0.2s. */
  stickRate?: number;
  /** Throttle ramp rate (units of throttle per second). Default 0.5 → 0→1 in 2s. */
  throttleRate?: number;
  /**
   * Input curve applied to ramped stick value before exposing on the public fields.
   * `'linear'`: pass-through, output = input.
   * `'cubic'` (default): pure cubic `x³` — strong small-input softening, full-deflection authority preserved.
   *   At x=0.1 → 0.001 (~99% softer); at x=0.5 → 0.125 (75% softer); at x=1 → 1 (unchanged).
   *   Strength was iterated up from `0.5·x + 0.5·x³` at controls-feel-pass verify-human attempt 1
   *   (operator reported the mild blend still felt too jerky on A/D taps).
   */
  stickCurve?: StickCurve;
}

export class Controls {
  /** Roll command, [-1, +1]. +1 = roll right. */
  aileron = 0;
  /** Pitch command, [-1, +1]. +1 = nose up. */
  elevator = 0;
  /** Yaw command, [-1, +1]. +1 = nose right. */
  rudder = 0;
  /** Throttle, [0, 1]. Stateful — survives across frames. */
  throttle = 0;

  readonly keyMap: KeyMap;
  stickRate: number;
  throttleRate: number;
  stickCurve: StickCurve;

  private readonly input: InputManager;
  // Raw (pre-curve) ramped axis values. Ramping happens in raw space so the
  // ramp rate is independent of the curve shape; the curve is applied at read
  // time to produce the public aileron/elevator/rudder fields.
  private rawAileron = 0;
  private rawElevator = 0;
  private rawRudder = 0;

  constructor(input: InputManager, options: ControlsOptions = {}) {
    this.input = input;
    this.keyMap = { ...DEFAULT_KEY_MAP, ...(options.keyMap ?? {}) };
    this.stickRate = options.stickRate ?? 5.0;
    this.throttleRate = options.throttleRate ?? 0.5;
    this.stickCurve = options.stickCurve ?? 'cubic';
  }

  /**
   * Integrate input state into the four control values.
   * Stick axes ramp toward commanded direction (or 0 if neutral) at `stickRate`,
   * then are passed through `stickCurve` before being exposed publicly.
   * Throttle ramps only while a throttle key is held; otherwise it holds.
   */
  update(dt: number): void {
    const k = this.keyMap;
    const im = this.input;

    this.rawAileron = rampAxis(
      this.rawAileron,
      axisCommand(im.isDown(k.rollLeft), im.isDown(k.rollRight)),
      this.stickRate,
      dt,
    );
    this.rawElevator = rampAxis(
      this.rawElevator,
      axisCommand(im.isDown(k.pitchDown), im.isDown(k.pitchUp)),
      this.stickRate,
      dt,
    );
    this.rawRudder = rampAxis(
      this.rawRudder,
      axisCommand(im.isDown(k.yawLeft), im.isDown(k.yawRight)),
      this.stickRate,
      dt,
    );

    const curve = this.stickCurve;
    this.aileron = applyCurve(this.rawAileron, curve);
    this.elevator = applyCurve(this.rawElevator, curve);
    this.rudder = applyCurve(this.rawRudder, curve);

    const tUp = im.isDown(k.throttleUp);
    const tDown = im.isDown(k.throttleDown);
    if (tUp && !tDown) {
      this.throttle = clamp01(this.throttle + this.throttleRate * dt);
    } else if (tDown && !tUp) {
      this.throttle = clamp01(this.throttle - this.throttleRate * dt);
    }
    // Both pressed or neither pressed → throttle holds.
  }

  /**
   * Zero all three stick axes (raw + public) without touching throttle.
   * Used at mission start so the prior mission's stick deflection does not
   * carry into a fresh spawn.
   */
  resetSticks(): void {
    this.rawAileron = 0;
    this.rawElevator = 0;
    this.rawRudder = 0;
    this.aileron = 0;
    this.elevator = 0;
    this.rudder = 0;
  }
}

function axisCommand(neg: boolean, pos: boolean): number {
  return (pos ? 1 : 0) - (neg ? 1 : 0);
}

function rampAxis(current: number, target: number, rate: number, dt: number): number {
  const step = rate * dt;
  if (current < target) return Math.min(target, current + step);
  if (current > target) return Math.max(target, current - step);
  return current;
}

function applyCurve(x: number, curve: StickCurve): number {
  if (curve === 'linear') return x;
  // Pure cubic: x³. Odd function so sign is preserved; |output| ≤ |input|.
  // At x=0.5 → 0.125 (75% softer than linear); at x=±1 → ±1 (full authority preserved).
  return x * x * x;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
