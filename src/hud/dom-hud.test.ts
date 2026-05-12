// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerspectiveCamera } from 'three';
import { DomHud } from './dom-hud';
import type { AircraftState } from '../aircraft/state';

function freshAircraftState(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    position: { x: 0, y: 0, z: 0 },
    linvel: { x: 0, y: 0, z: 0 },
    angvel: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    airspeed: 0,
    altitude: 0,
    ...overrides,
  };
}

function makeCanvas(w = 800, h = 600): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
  return el;
}

describe('DomHud', () => {
  let camera: PerspectiveCamera;
  let canvas: HTMLElement;
  let hud: DomHud;

  beforeEach(() => {
    document.body.innerHTML = '';
    camera = new PerspectiveCamera(75, 800 / 600, 0.1, 5000);
    canvas = makeCanvas();
    hud = new DomHud(camera, canvas);
  });

  afterEach(() => {
    hud.hide();
  });

  it('show() attaches the root with the hud-root testid', () => {
    expect(document.querySelector('[data-testid="hud-root"]')).toBeNull();
    hud.show();
    const root = document.querySelector('[data-testid="hud-root"]');
    expect(root).not.toBeNull();
  });

  it('hide() detaches the root', () => {
    hud.show();
    hud.hide();
    expect(document.querySelector('[data-testid="hud-root"]')).toBeNull();
  });

  it('show() is idempotent — calling twice does not create duplicate roots', () => {
    hud.show();
    hud.show();
    const roots = document.querySelectorAll('[data-testid="hud-root"]');
    expect(roots).toHaveLength(1);
  });

  it('hide() is idempotent — calling before show is a no-op', () => {
    hud.hide();
    hud.hide();
    expect(document.querySelector('[data-testid="hud-root"]')).toBeNull();
  });

  it('setAircraftState writes rounded altitude and airspeed', () => {
    hud.show();
    hud.setAircraftState(freshAircraftState({ altitude: 123.4, airspeed: 45.7 }));
    expect(document.querySelector('[data-testid="hud-altitude"]')!.textContent).toBe('123');
    expect(document.querySelector('[data-testid="hud-airspeed"]')!.textContent).toBe('46');
  });

  it('setThrottle writes an integer percent', () => {
    hud.show();
    hud.setThrottle(0.456);
    expect(document.querySelector('[data-testid="hud-throttle"]')!.textContent).toBe('46');
    hud.setThrottle(1);
    expect(document.querySelector('[data-testid="hud-throttle"]')!.textContent).toBe('100');
    hud.setThrottle(0);
    expect(document.querySelector('[data-testid="hud-throttle"]')!.textContent).toBe('0');
  });

  it('setObjective(text) shows the objective with that text', () => {
    hud.show();
    hud.setObjective('Fly to waypoint (1/3)');
    const el = document.querySelector<HTMLElement>('[data-testid="hud-objective"]')!;
    expect(el.textContent).toBe('Fly to waypoint (1/3)');
    expect(el.style.display).not.toBe('none');
  });

  it('setObjective(null) hides the objective', () => {
    hud.show();
    hud.setObjective('something');
    hud.setObjective(null);
    const el = document.querySelector<HTMLElement>('[data-testid="hud-objective"]')!;
    expect(el.style.display).toBe('none');
  });

  it('setStatus("flying") hides the banner', () => {
    hud.show();
    hud.setStatus('won', 'YOU WIN');
    hud.setStatus('flying');
    const el = document.querySelector<HTMLElement>('[data-testid="hud-status-banner"]')!;
    expect(el.style.display).toBe('none');
  });

  it('setStatus("won", text) shows the banner with text + won class', () => {
    hud.show();
    hud.setStatus('won', 'YOU WIN');
    const el = document.querySelector<HTMLElement>('[data-testid="hud-status-banner"]')!;
    expect(el.style.display).not.toBe('none');
    expect(el.textContent).toBe('YOU WIN');
    expect(el.className).toContain('won');
  });

  it('setStatus("failed") shows banner with default text + failed class', () => {
    hud.show();
    hud.setStatus('failed');
    const el = document.querySelector<HTMLElement>('[data-testid="hud-status-banner"]')!;
    expect(el.style.display).not.toBe('none');
    expect(el.textContent).toBe('MISSION FAILED');
    expect(el.className).toContain('failed');
  });

  it('set methods are no-ops before show()', () => {
    hud.setAircraftState(freshAircraftState({ altitude: 999, airspeed: 999 }));
    hud.setThrottle(0.99);
    hud.setObjective('should not appear');
    hud.setStatus('won', 'should not appear');
    // Root is not attached at all.
    expect(document.querySelector('[data-testid="hud-root"]')).toBeNull();
    // After show, the existing nodes' text reflects the initial state (0s, hidden),
    // not the pre-show calls.
    hud.show();
    expect(document.querySelector('[data-testid="hud-altitude"]')!.textContent).toBe('0');
    expect(document.querySelector('[data-testid="hud-airspeed"]')!.textContent).toBe('0');
    expect(document.querySelector('[data-testid="hud-throttle"]')!.textContent).toBe('0');
    const objective = document.querySelector<HTMLElement>('[data-testid="hud-objective"]')!;
    expect(objective.style.display).toBe('none');
    const banner = document.querySelector<HTMLElement>('[data-testid="hud-status-banner"]')!;
    expect(banner.style.display).toBe('none');
  });

  it('respects opts.root mount', () => {
    const customRoot = document.createElement('div');
    customRoot.id = 'custom';
    document.body.appendChild(customRoot);
    const customHud = new DomHud(camera, canvas, { root: customRoot });
    customHud.show();
    expect(customRoot.querySelector('[data-testid="hud-root"]')).not.toBeNull();
    customHud.hide();
  });

  describe('setWaypointArrow projection', () => {
    // Camera at origin looking down -Z (Three.js default). World -Z is "ahead".
    beforeEach(() => {
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);
      camera.updateMatrixWorld(true);
    });

    it('positions arrow on-screen when target is in front of camera', () => {
      hud.show();
      hud.setWaypointArrow({ x: 0, y: 0, z: -50 });
      const arrow = document.querySelector<HTMLElement>('[data-testid="hud-waypoint-arrow"]')!;
      expect(arrow.style.display).not.toBe('none');
      // Target directly ahead → arrow centered at canvas midpoint (400, 300) for 800x600.
      expect(arrow.style.left).toBe('400px');
      expect(arrow.style.top).toBe('300px');
    });

    it('hides arrow when target is behind camera', () => {
      hud.show();
      hud.setWaypointArrow({ x: 0, y: 0, z: 50 }); // behind camera (+Z)
      const arrow = document.querySelector<HTMLElement>('[data-testid="hud-waypoint-arrow"]')!;
      expect(arrow.style.display).toBe('none');
    });

    it('hides arrow when target is far off-screen (left)', () => {
      hud.show();
      hud.setWaypointArrow({ x: -10000, y: 0, z: -50 });
      const arrow = document.querySelector<HTMLElement>('[data-testid="hud-waypoint-arrow"]')!;
      expect(arrow.style.display).toBe('none');
    });

    it('hides arrow when setWaypointArrow(null)', () => {
      hud.show();
      hud.setWaypointArrow({ x: 0, y: 0, z: -50 });
      const arrow = document.querySelector<HTMLElement>('[data-testid="hud-waypoint-arrow"]')!;
      expect(arrow.style.display).not.toBe('none');
      hud.setWaypointArrow(null);
      expect(arrow.style.display).toBe('none');
    });

    it('re-shows arrow when toggled back to non-null', () => {
      hud.show();
      hud.setWaypointArrow({ x: 0, y: 0, z: -50 });
      hud.setWaypointArrow(null);
      hud.setWaypointArrow({ x: 0, y: 0, z: -100 });
      const arrow = document.querySelector<HTMLElement>('[data-testid="hud-waypoint-arrow"]')!;
      expect(arrow.style.display).not.toBe('none');
    });

    it('positions arrow to right side for target right of camera', () => {
      hud.show();
      hud.setWaypointArrow({ x: 10, y: 0, z: -50 });
      const arrow = document.querySelector<HTMLElement>('[data-testid="hud-waypoint-arrow"]')!;
      expect(arrow.style.display).not.toBe('none');
      // Target right of center → left > 400 (canvas mid-x).
      const left = parseFloat(arrow.style.left);
      expect(left).toBeGreaterThan(400);
    });

    it('positions arrow to upper area for target above camera (lower top px)', () => {
      hud.show();
      hud.setWaypointArrow({ x: 0, y: 10, z: -50 });
      const arrow = document.querySelector<HTMLElement>('[data-testid="hud-waypoint-arrow"]')!;
      expect(arrow.style.display).not.toBe('none');
      // Target above camera → top < 300 (canvas mid-y, with top:0 at screen top).
      const top = parseFloat(arrow.style.top);
      expect(top).toBeLessThan(300);
    });

    it('setWaypointArrow is a no-op before show()', () => {
      hud.setWaypointArrow({ x: 0, y: 0, z: -50 });
      // No DOM is attached yet, nothing to verify on; after show, arrow is hidden by default.
      hud.show();
      const arrow = document.querySelector<HTMLElement>('[data-testid="hud-waypoint-arrow"]')!;
      expect(arrow.style.display).toBe('none');
    });
  });
});
