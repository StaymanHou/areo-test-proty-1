import { DEFAULT_KEY_MAP, type InputManager, type KeyMap } from '../engine/input';

export interface ControlsOptions {
  keyMap?: KeyMap;
  /** Stick axis ramp rate (units of axis-value per second). Default 5.0 → full-scale in 0.2s. */
  stickRate?: number;
  /** Throttle ramp rate (units of throttle per second). Default 0.5 → 0→1 in 2s. */
  throttleRate?: number;
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

  private readonly input: InputManager;

  constructor(input: InputManager, options: ControlsOptions = {}) {
    this.input = input;
    this.keyMap = { ...DEFAULT_KEY_MAP, ...(options.keyMap ?? {}) };
    this.stickRate = options.stickRate ?? 5.0;
    this.throttleRate = options.throttleRate ?? 0.5;
  }

  /**
   * Integrate input state into the four control values.
   * Stick axes ramp toward commanded direction (or 0 if neutral) at `stickRate`.
   * Throttle ramps only while a throttle key is held; otherwise it holds.
   */
  update(dt: number): void {
    const k = this.keyMap;
    const im = this.input;

    this.aileron = rampAxis(
      this.aileron,
      axisCommand(im.isDown(k.rollLeft), im.isDown(k.rollRight)),
      this.stickRate,
      dt,
    );
    this.elevator = rampAxis(
      this.elevator,
      axisCommand(im.isDown(k.pitchDown), im.isDown(k.pitchUp)),
      this.stickRate,
      dt,
    );
    this.rudder = rampAxis(
      this.rudder,
      axisCommand(im.isDown(k.yawLeft), im.isDown(k.yawRight)),
      this.stickRate,
      dt,
    );

    const tUp = im.isDown(k.throttleUp);
    const tDown = im.isDown(k.throttleDown);
    if (tUp && !tDown) {
      this.throttle = clamp01(this.throttle + this.throttleRate * dt);
    } else if (tDown && !tUp) {
      this.throttle = clamp01(this.throttle - this.throttleRate * dt);
    }
    // Both pressed or neither pressed → throttle holds.
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
