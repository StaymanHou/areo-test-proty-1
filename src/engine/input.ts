export interface InputState {
  keys: Set<string>;
  mouseButtons: Set<number>;
  mouseDelta: { x: number; y: number };
  mousePosition: { x: number; y: number };
}

export type ActionName =
  | 'forward' | 'backward' | 'strafeLeft' | 'strafeRight'
  | 'pitchUp' | 'pitchDown' | 'rollLeft' | 'rollRight'
  | 'yawLeft' | 'yawRight' | 'throttleUp' | 'throttleDown'
  | 'swapCamera' | 'pause';

export type KeyMap = Record<ActionName, string>;

export const DEFAULT_KEY_MAP: KeyMap = {
  forward:      'KeyW',
  backward:     'KeyS',
  strafeLeft:   'KeyA',
  strafeRight:  'KeyD',
  pitchUp:      'ArrowUp',
  pitchDown:    'ArrowDown',
  rollLeft:     'ArrowLeft',
  rollRight:    'ArrowRight',
  yawLeft:      'KeyQ',
  yawRight:     'KeyE',
  throttleUp:   'ShiftLeft',
  throttleDown: 'ControlLeft',
  swapCamera:   'KeyV',
  pause:        'KeyP',
};

export class InputManager {
  readonly state: InputState = {
    keys: new Set(),
    mouseButtons: new Set(),
    mouseDelta: { x: 0, y: 0 },
    mousePosition: { x: 0, y: 0 },
  };

  private readonly pressedThisFrame = new Set<string>();

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.state.keys.has(e.code)) this.pressedThisFrame.add(e.code);
    this.state.keys.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.state.keys.delete(e.code);
  };
  private readonly onMouseMove = (e: MouseEvent) => {
    this.state.mouseDelta.x += e.movementX;
    this.state.mouseDelta.y += e.movementY;
    this.state.mousePosition.x = e.clientX;
    this.state.mousePosition.y = e.clientY;
  };
  private readonly onMouseDown = (e: MouseEvent) => {
    this.state.mouseButtons.add(e.button);
  };
  private readonly onMouseUp = (e: MouseEvent) => {
    this.state.mouseButtons.delete(e.button);
  };
  private readonly onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    target.addEventListener('mousemove', this.onMouseMove as EventListener);
    target.addEventListener('mousedown', this.onMouseDown as EventListener);
    target.addEventListener('mouseup', this.onMouseUp as EventListener);
    target.addEventListener('contextmenu', this.onContextMenu);
    this.target = target;
  }

  private readonly target: EventTarget;

  isDown(code: string): boolean {
    return this.state.keys.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  isActionDown(action: ActionName, keyMap: KeyMap = DEFAULT_KEY_MAP): boolean {
    return this.isDown(keyMap[action]);
  }

  wasActionPressed(action: ActionName, keyMap: KeyMap = DEFAULT_KEY_MAP): boolean {
    return this.wasPressed(keyMap[action]);
  }

  flush(): void {
    this.pressedThisFrame.clear();
    this.state.mouseDelta.x = 0;
    this.state.mouseDelta.y = 0;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener);
    this.target.removeEventListener('mousemove', this.onMouseMove as EventListener);
    this.target.removeEventListener('mousedown', this.onMouseDown as EventListener);
    this.target.removeEventListener('mouseup', this.onMouseUp as EventListener);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
  }
}
