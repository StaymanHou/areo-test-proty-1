import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { parseAircraftConfig, type AircraftConfig } from '../aircraft/physics-core/config';
import { Aircraft } from '../aircraft/rigidbody';
import { FlightModel } from '../aircraft/physics-core/flightmodel';
import { computeAeroForce, type BodyState } from '../aircraft/physics-core/aerosurface';
import { attachFlightModelTuning } from './tuning';

// Test fake for lil-gui. Records every (target, key) → onChange callback so a
// test can synthesize a slider drag by mutating the target then invoking the
// captured callback.
interface FakeController {
  target: object;
  key: string;
  displayName: string;
  onChangeCb?: () => void;
}
class FakeGUI {
  controllers: FakeController[] = [];
  folders: FakeGUI[] = [];

  add(target: object, key: string): {
    name: (n: string) => unknown;
    onChange: (cb: () => void) => unknown;
  } {
    const ctrl: FakeController = { target, key, displayName: key };
    this.controllers.push(ctrl);
    const fluent = {
      name(n: string) {
        ctrl.displayName = n;
        return fluent;
      },
      onChange(cb: () => void) {
        ctrl.onChangeCb = cb;
        return fluent;
      },
    };
    return fluent;
  }
  addFolder(_name: string): FakeGUI {
    const f = new FakeGUI();
    this.folders.push(f);
    return f;
  }

  /** Recursive lookup by display-name path, e.g. ["wing-left", "area"]. */
  findController(displayName: string): FakeController | undefined {
    for (const c of this.controllers) {
      if (c.displayName === displayName) return c;
    }
    for (const f of this.folders) {
      const hit = f.findController(displayName);
      if (hit) return hit;
    }
    return undefined;
  }
}

const baselineRaw = () => ({
  mass: 1000,
  inertia: { x: 1500, y: 3000, z: 1500 },
  thrust: { maxN: 6000 },
  surfaces: [
    { name: 'wing-left',  position: { x: -2, y: 0,   z: 0 }, normal: { x: 0, y: 1, z: 0 }, chord: { x: 0, y: 0, z: -1 }, area: 6, curve: 'symmetric-flat-plate' },
    { name: 'wing-right', position: { x:  2, y: 0,   z: 0 }, normal: { x: 0, y: 1, z: 0 }, chord: { x: 0, y: 0, z: -1 }, area: 6, curve: 'symmetric-flat-plate' },
    { name: 'h-stab',     position: { x:  0, y: 0,   z: 3 }, normal: { x: 0, y: 1, z: 0 }, chord: { x: 0, y: 0, z: -1 }, area: 1.5, curve: 'symmetric-flat-plate' },
    { name: 'v-stab',     position: { x:  0, y: 0.5, z: 3 }, normal: { x: 1, y: 0, z: 0 }, chord: { x: 0, y: 0, z: -1 }, area: 1, curve: 'symmetric-flat-plate' },
  ],
});

let config: AircraftConfig;
beforeAll(async () => {
  await RAPIER.init();
  config = parseAircraftConfig(baselineRaw());
});

function buildHarness() {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = 1 / 60;
  const aircraft = new Aircraft(world, config);
  const flightModel = new FlightModel(aircraft);
  const gui = new FakeGUI();
  // Cast: FakeGUI implements just the add/addFolder surface tuning.ts uses.
  const handle = attachFlightModelTuning(
    gui as unknown as Parameters<typeof attachFlightModelTuning>[0],
    aircraft,
    flightModel,
  );
  return { world, aircraft, flightModel, gui, handle };
}

describe('attachFlightModelTuning', () => {
  it('mass slider onChange propagates to body.mass()', () => {
    const { world, aircraft, gui } = buildHarness();
    world.step();
    const c = gui.findController('mass');
    expect(c).toBeDefined();
    (c!.target as { mass: number }).mass = 2500;
    c!.onChangeCb!();
    world.step();
    // Rapier f32 precision — see WP7 Phase B notes.
    expect(aircraft.body.mass()).toBeCloseTo(2500, 2);
  });

  it('thrust maxN slider onChange propagates to flightModel.maxThrustN', () => {
    const { flightModel, gui } = buildHarness();
    const c = gui.findController('maxN');
    expect(c).toBeDefined();
    (c!.target as { maxN: number }).maxN = 12000;
    c!.onChangeCb!();
    expect(flightModel.maxThrustN).toBe(12000);
  });

  it('surface area slider onChange propagates to surface.area', () => {
    const { flightModel, gui } = buildHarness();
    const c = gui.findController('area');
    expect(c).toBeDefined();
    (c!.target as { area: number }).area = 9.5;
    c!.onChangeCb!();
    // First surface in the harness is "wing-left"; first 'area' controller hit is its.
    expect(flightModel.surfaces[0]!.area).toBe(9.5);
  });

  it('surface position.x slider onChange propagates to surface.position.x', () => {
    const { flightModel, gui } = buildHarness();
    const c = gui.findController('position.x');
    expect(c).toBeDefined();
    (c!.target as { px: number }).px = -3.5;
    c!.onChangeCb!();
    expect(flightModel.surfaces[0]!.position.x).toBe(-3.5);
  });

  it('surface clSlope slider onChange swaps curves so subsequent computeAeroForce returns different lift', () => {
    const { flightModel, gui } = buildHarness();
    const surface = flightModel.surfaces[0]!; // wing-left
    // α = +5° pre-stall flow (body descending with level wing → wind from below).
    const angle = (5 * Math.PI) / 180;
    const speed = 10;
    const linvel = new Vector3(0, -Math.sin(angle) * speed, -Math.cos(angle) * speed);
    const body: BodyState = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      linvel,
      angvel: new Vector3(),
    };
    const liftBefore = computeAeroForce(surface, body).force.y;

    const c = gui.findController('clSlope');
    expect(c).toBeDefined();
    (c!.target as { clSlope: number }).clSlope = 12; // ~2× default 2π
    c!.onChangeCb!();

    const liftAfter = computeAeroForce(surface, body).force.y;
    expect(liftAfter).toBeGreaterThan(liftBefore * 1.3);
  });

  it('exposes a Flight Model folder containing Body, Thrust, and one folder per surface', () => {
    const { gui } = buildHarness();
    // Top-level GUI has exactly one child folder ("Flight Model").
    expect(gui.folders).toHaveLength(1);
    const flightModel = gui.folders[0]!;
    // 2 (Body, Thrust) + 4 (per surface) = 6 sub-folders. Each surface folder
    // also adds a Curve sub-folder, but those are nested inside the surface
    // folder, not direct children of Flight Model.
    expect(flightModel.folders).toHaveLength(6);
  });

  it('buildExportJson produces valid JSON parseable by parseAircraftConfig', () => {
    const { handle } = buildHarness();
    const json = handle.buildExportJson();
    expect(() => JSON.parse(json)).not.toThrow();
    const raw = JSON.parse(json);
    const cfg = parseAircraftConfig(raw);
    expect(cfg.surfaces).toHaveLength(4);
    expect(cfg.mass).toBe(1000);
  });

  it('exported preset round-trips: parsed values match the live mirror state', () => {
    const { handle, gui } = buildHarness();
    // Mutate via GUI to a known state, then export.
    const massCtrl = gui.findController('mass')!;
    (massCtrl.target as { mass: number }).mass = 2200;
    massCtrl.onChangeCb!();
    const thrustCtrl = gui.findController('maxN')!;
    (thrustCtrl.target as { maxN: number }).maxN = 9000;
    thrustCtrl.onChangeCb!();
    const areaCtrl = gui.findController('area')!; // first surface (wing-left)
    (areaCtrl.target as { area: number }).area = 7.25;
    areaCtrl.onChangeCb!();
    const clSlopeCtrl = gui.findController('clSlope')!;
    (clSlopeCtrl.target as { clSlope: number }).clSlope = 9.5;
    clSlopeCtrl.onChangeCb!();

    const cfg = parseAircraftConfig(JSON.parse(handle.buildExportJson()));
    expect(cfg.mass).toBe(2200);
    expect(cfg.thrust.maxN).toBe(9000);
    expect(cfg.surfaces[0]!.area).toBe(7.25);
    expect(cfg.surfaces[0]!.curveParams.clSlope).toBe(9.5);
    // Untouched curve knobs default through the original config (unchanged).
    expect(cfg.surfaces[0]!.curveParams.stallAlpha).toBeCloseTo(
      (15 * Math.PI) / 180,
      12,
    );
  });

  it('always emits curve as the object form, even though config was loaded from a bare string', () => {
    const { handle } = buildHarness();
    const raw = JSON.parse(handle.buildExportJson()) as {
      surfaces: Array<{ curve: unknown }>;
    };
    for (const s of raw.surfaces) {
      expect(typeof s.curve).toBe('object');
      const c = s.curve as Record<string, unknown>;
      expect(c.type).toBe('symmetric-flat-plate');
      expect(typeof c.clSlope).toBe('number');
      expect(typeof c.stallAlpha).toBe('number');
      expect(typeof c.cdMax).toBe('number');
    }
  });
});
