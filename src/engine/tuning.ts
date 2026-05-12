import GUI from 'lil-gui';
import { Vector3 } from 'three';
import {
  buildSymmetricFlatPlateCurves,
  type SymmetricFlatPlateParams,
} from '../aircraft/physics-core/aerosurface';
import type { Aircraft } from '../aircraft/rigidbody';
import type { FlightModel } from '../aircraft/physics-core/flightmodel';

// Live-tuning UI for the flight model. Wires lil-gui sliders to the Phase B
// mutators (Aircraft.setMassProperties, AeroSurface.setGeometry / setCurves,
// FlightModel.maxThrustN). All mutations happen at GUI-event time — the per-
// tick hot path is untouched.
//
// Gating: the caller is responsible for only invoking this under `?debug=true`.

const _scratchInertia = new Vector3();
const _scratchPos = new Vector3();
const _scratchNormal = new Vector3();
const _scratchChord = new Vector3();

interface BodyMirror {
  mass: number;
  ix: number;
  iy: number;
  iz: number;
}

interface ThrustMirror {
  maxN: number;
}

interface SurfaceMirror {
  px: number; py: number; pz: number;
  nx: number; ny: number; nz: number;
  cx: number; cy: number; cz: number;
  area: number;
  maxDeflectionRad: number;
  curveParams: SymmetricFlatPlateParams;
}

export interface FlightModelTuningHandle {
  /** Build the current tuning state as a JSON document matching aircraft.json. */
  buildExportJson(): string;
}

export function attachFlightModelTuning(
  gui: GUI,
  aircraft: Aircraft,
  flightModel: FlightModel,
): FlightModelTuningHandle {
  const root = gui.addFolder('Flight Model');

  // --- Body mirror (closure-scoped; source of truth for mass/inertia exports) ---
  const body: BodyMirror = {
    mass: aircraft.config.mass,
    ix: aircraft.config.inertia.x,
    iy: aircraft.config.inertia.y,
    iz: aircraft.config.inertia.z,
  };
  const applyBody = () => {
    _scratchInertia.set(body.ix, body.iy, body.iz);
    aircraft.setMassProperties(body.mass, _scratchInertia);
  };

  // --- Per-surface mirrors (closure-scoped; cover curveParams which surface.* doesn't expose) ---
  const surfaceMirrors: SurfaceMirror[] = flightModel.surfaces.map((surface, i) => {
    const cfg = aircraft.config.surfaces[i]!;
    return {
      px: surface.position.x, py: surface.position.y, pz: surface.position.z,
      nx: surface.normal.x,   ny: surface.normal.y,   nz: surface.normal.z,
      cx: surface.chord.x,    cy: surface.chord.y,    cz: surface.chord.z,
      area: surface.area,
      maxDeflectionRad: surface.maxDeflectionRad,
      curveParams: { ...cfg.curveParams },
    };
  });

  // --- Export button (top of Flight Model folder for reachability) ---
  root.add({
    export: () => {
      const json = buildExportJson();
      const writer = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      if (writer) {
        writer(json).catch(() => console.log(json));
      } else {
        console.log(json);
      }
    },
  }, 'export').name('Export preset (copy JSON)');

  // --- Body sub-folder ---
  const bodyFolder = root.addFolder('Body');
  bodyFolder.add(body, 'mass', 100, 5000).onChange(applyBody);
  bodyFolder.add(body, 'ix', 100, 10000).name('inertia.x').onChange(applyBody);
  bodyFolder.add(body, 'iy', 100, 10000).name('inertia.y').onChange(applyBody);
  bodyFolder.add(body, 'iz', 100, 10000).name('inertia.z').onChange(applyBody);

  // --- Thrust ---
  const thrust: ThrustMirror = { maxN: flightModel.maxThrustN };
  const thrustFolder = root.addFolder('Thrust');
  thrustFolder.add(thrust, 'maxN', 0, 20000).onChange(() => {
    flightModel.maxThrustN = thrust.maxN;
  });

  // --- Per-surface ---
  for (let i = 0; i < flightModel.surfaces.length; i++) {
    const surface = flightModel.surfaces[i]!;
    const cfg = aircraft.config.surfaces[i]!;
    const m = surfaceMirrors[i]!;

    const folder = root.addFolder(cfg.name);

    const applyGeometry = () => {
      _scratchPos.set(m.px, m.py, m.pz);
      _scratchNormal.set(m.nx, m.ny, m.nz);
      _scratchChord.set(m.cx, m.cy, m.cz);
      surface.setGeometry({
        position: _scratchPos,
        normal: _scratchNormal,
        chord: _scratchChord,
        area: m.area,
      });
    };
    folder.add(m, 'px', -5, 5).name('position.x').onChange(applyGeometry);
    folder.add(m, 'py', -5, 5).name('position.y').onChange(applyGeometry);
    folder.add(m, 'pz', -5, 5).name('position.z').onChange(applyGeometry);
    folder.add(m, 'nx', -1, 1).name('normal.x').onChange(applyGeometry);
    folder.add(m, 'ny', -1, 1).name('normal.y').onChange(applyGeometry);
    folder.add(m, 'nz', -1, 1).name('normal.z').onChange(applyGeometry);
    folder.add(m, 'cx', -1, 1).name('chord.x').onChange(applyGeometry);
    folder.add(m, 'cy', -1, 1).name('chord.y').onChange(applyGeometry);
    folder.add(m, 'cz', -1, 1).name('chord.z').onChange(applyGeometry);
    folder.add(m, 'area', 0.1, 15).onChange(applyGeometry);
    folder.add(m, 'maxDeflectionRad', 0, 1).onChange(() => {
      surface.maxDeflectionRad = m.maxDeflectionRad;
    });

    const applyCurves = () => {
      const { cl, cd } = buildSymmetricFlatPlateCurves(m.curveParams);
      surface.setCurves(cl, cd);
    };
    const curveFolder = folder.addFolder('Curve');
    curveFolder.add(m.curveParams, 'clSlope', 0.1, 15).onChange(applyCurves);
    curveFolder.add(m.curveParams, 'stallAlpha', 0.05, 1.5).onChange(applyCurves);
    curveFolder.add(m.curveParams, 'clPostStall', 0, 2).onChange(applyCurves);
    curveFolder.add(m.curveParams, 'cdMin', 0, 0.5).onChange(applyCurves);
    curveFolder.add(m.curveParams, 'cdStall', 0, 1).onChange(applyCurves);
    curveFolder.add(m.curveParams, 'cdMax', 0, 3).onChange(applyCurves);
  }

  // --- Export builder. Always emits the object curve form for round-trip clarity. ---
  function buildExportJson(): string {
    const doc = {
      mass: body.mass,
      inertia: { x: body.ix, y: body.iy, z: body.iz },
      thrust: { maxN: thrust.maxN },
      surfaces: flightModel.surfaces.map((_surface, i) => {
        const cfg = aircraft.config.surfaces[i]!;
        const m = surfaceMirrors[i]!;
        return {
          name: cfg.name,
          position: { x: m.px, y: m.py, z: m.pz },
          normal:   { x: m.nx, y: m.ny, z: m.nz },
          chord:    { x: m.cx, y: m.cy, z: m.cz },
          area: m.area,
          maxDeflectionRad: m.maxDeflectionRad,
          curve: {
            type: 'symmetric-flat-plate',
            clSlope: m.curveParams.clSlope,
            stallAlpha: m.curveParams.stallAlpha,
            clPostStall: m.curveParams.clPostStall,
            cdMin: m.curveParams.cdMin,
            cdStall: m.curveParams.cdStall,
            cdMax: m.curveParams.cdMax,
          },
        };
      }),
    };
    return JSON.stringify(doc, null, 2);
  }

  return { buildExportJson };
}
