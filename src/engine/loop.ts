export interface GameLoopOptions {
  physicsDt?: number;
  maxStepsPerFrame?: number;
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
  cancelRaf?: (handle: number) => void;
}

export interface GameLoopCallbacks {
  onPhysics: (dt: number) => void;
  onRender: (alpha: number) => void;
}

export class GameLoop {
  private readonly physicsDt: number;
  private readonly maxStepsPerFrame: number;
  private readonly now: () => number;
  private readonly raf: (cb: FrameRequestCallback) => number;
  private readonly cancelRaf: (handle: number) => void;

  private readonly cb: GameLoopCallbacks;
  private accumulator = 0;
  private lastTime = 0;
  private rafHandle: number | null = null;
  private paused = false;

  constructor(cb: GameLoopCallbacks, options: GameLoopOptions = {}) {
    this.cb = cb;
    this.physicsDt = options.physicsDt ?? 1 / 60;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;
    this.now = options.now ?? (() => performance.now() / 1000);
    this.raf = options.raf ?? requestAnimationFrame.bind(window);
    this.cancelRaf = options.cancelRaf ?? cancelAnimationFrame.bind(window);
  }

  start(): void {
    if (this.rafHandle !== null) return;
    this.lastTime = this.now();
    this.accumulator = 0;
    this.schedule();
  }

  stop(): void {
    if (this.rafHandle !== null) {
      this.cancelRaf(this.rafHandle);
      this.rafHandle = null;
    }
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (!p) this.lastTime = this.now();
  }

  tickOnce(nowSeconds: number): void {
    const frameTime = Math.max(0, nowSeconds - this.lastTime);
    this.lastTime = nowSeconds;

    if (this.paused) {
      this.cb.onRender(0);
      return;
    }

    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= this.physicsDt && steps < this.maxStepsPerFrame) {
      this.cb.onPhysics(this.physicsDt);
      this.accumulator -= this.physicsDt;
      steps += 1;
    }

    if (this.accumulator >= this.physicsDt) {
      this.accumulator = 0;
    }

    const alpha = this.accumulator / this.physicsDt;
    this.cb.onRender(alpha);
  }

  private schedule(): void {
    this.rafHandle = this.raf(() => {
      this.tickOnce(this.now());
      if (this.rafHandle !== null) this.schedule();
    });
  }
}

export const PHYSICS_HZ = 60;
