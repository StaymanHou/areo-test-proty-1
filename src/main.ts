import RAPIER from '@dimforge/rapier3d-compat';
import { DirectionalLight, Euler, Vector3 } from 'three';
import { createRenderContext } from './world/scene';
import { initDebug } from './engine/debug';
import { GameLoop } from './engine/loop';
import { InputManager, DEFAULT_KEY_MAP } from './engine/input';
import { CameraController, CameraMode } from './world/camera';
import { loadAircraftConfig } from './aircraft/config';
import { Aircraft } from './aircraft/rigidbody';
import { FlightModel } from './aircraft/flightmodel';
import { Controls } from './aircraft/controls';
import { attachFlightModelTuning } from './engine/tuning';
import { FlatTerrain } from './world/terrain';
import { createProceduralSkybox } from './world/skybox';
import { createRunway, createTower } from './world/landmarks';
import { createAircraftState, toAircraftState } from './aircraft/state';
import { loadMission, loadMissionList } from './mission/loader';
import { MissionRunner } from './mission/runner';
import { MissionSelectScreen } from './mission/select';
import type { Mission, MissionManifestEntry } from './mission/types';
import { DomHud } from './hud/dom-hud';
import { formatActiveObjective } from './hud/format';

async function bootstrap() {
  const mount = document.querySelector<HTMLDivElement>('#app');
  if (!mount) throw new Error('#app mount not found');

  const rapierReady = RAPIER.init();
  const configReady = loadAircraftConfig('/config/aircraft.json');

  const { scene, camera, renderer } = createRenderContext(mount);
  const debug = initDebug();
  const input = new InputManager();
  const cameraController = new CameraController(camera);

  const sun = new DirectionalLight(0xffffff, 0.8);
  sun.position.set(5, 10, 7);
  scene.add(sun);

  await rapierReady;
  const config = await configReady;

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const terrain = new FlatTerrain({ size: 4000, height: 0, textureRepeat: 100 });
  scene.add(terrain.getMesh());
  world.createCollider(terrain.getColliderDesc());

  scene.background = createProceduralSkybox().cubeTexture;

  const runway = createRunway();
  scene.add(runway.mesh);

  const tower = createTower();
  scene.add(tower.mesh);
  world.createCollider(tower.colliderDesc);

  // Aircraft spawns at a placeholder (0,0,0). Aircraft.reset(spawn) is called
  // by startMission() before the loop unpauses, so the placeholder is never
  // visually observed during normal play.
  const aircraft = new Aircraft(world, config, {
    position: new Vector3(0, 0, 0),
    linvel: new Vector3(0, 0, 0),
  });
  scene.add(aircraft.mesh);

  const flightModel = new FlightModel(aircraft);
  const controls = new Controls(input);

  // WP11 mission framework wiring.
  const missionSelect = new MissionSelectScreen();
  const missionRunner = new MissionRunner();
  const aircraftStateBuf = createAircraftState();
  let activeMission: Mission | null = null;
  let missionManifest: MissionManifestEntry[] = [];

  // WP12 HUD wiring (D12 DOM-overlay).
  const hud = new DomHud(camera, renderer.domElement);

  const loop = new GameLoop(
    {
      onPhysics: (dt) => {
        controls.update(dt);
        flightModel.applyControls(controls);
        flightModel.applyForces(controls.throttle, dt);
        world.timestep = dt;
        world.step();
        // Tick the mission runner AFTER the physics step so it observes
        // post-step aircraft state for objective/win/fail evaluation.
        if (missionRunner.getStatus() === 'running') {
          toAircraftState(aircraft.readBodyState(), aircraftStateBuf);
          missionRunner.tick(aircraftStateBuf, dt);
        }
      },
      onRender: () => {
        aircraft.syncMesh();

        if (input.wasActionPressed('swapCamera', DEFAULT_KEY_MAP)) {
          cameraController.setMode(
            cameraController.activeMode === CameraMode.Chase
              ? CameraMode.Cockpit
              : CameraMode.Chase,
          );
        }

        cameraController.update(aircraft.mesh.position, aircraft.mesh.quaternion, 1 / 60);

        // WP12 HUD per-frame update. Hot path — `hud` no-ops when not shown.
        if (missionRunner.getStatus() === 'running') {
          toAircraftState(aircraft.readBodyState(), aircraftStateBuf);
          hud.setAircraftState(aircraftStateBuf);
          hud.setThrottle(controls.throttle);
          // Phase 2 missions have no active-waypoint surface yet; WP14 will
          // wire the next-waypoint position into this call.
          hud.setWaypointArrow(null);
        }

        debug?.stats.begin();
        renderer.render(scene, camera);
        debug?.stats.end();
        input.flush();
      },
    },
    { physicsDt: 1 / 60 },
  );

  if (debug) {
    const state = { paused: false };
    debug.gui.add(state, 'paused').name('Pause physics').onChange((v: boolean) => {
      loop.setPaused(v);
    });

    const inputDisplay = { keysHeld: '', camera: cameraController.activeMode };
    const keysController = debug.gui.add(inputDisplay, 'keysHeld').name('Keys held').listen();
    keysController.disable();
    const camController = debug.gui.add(inputDisplay, 'camera').name('Camera').listen();
    camController.disable();

    const controlsFolder = debug.gui.addFolder('Controls');
    const liveValues = { aileron: 0, elevator: 0, rudder: 0, throttle: 0 };
    controlsFolder.add(liveValues, 'aileron').listen().disable();
    controlsFolder.add(liveValues, 'elevator').listen().disable();
    controlsFolder.add(liveValues, 'rudder').listen().disable();
    controlsFolder.add(liveValues, 'throttle').listen().disable();

    const bindingsFolder = controlsFolder.addFolder('Bindings');
    bindingsFolder.add(controls.keyMap, 'rollLeft').name('rollLeft (KeyboardEvent.code)');
    bindingsFolder.add(controls.keyMap, 'rollRight').name('rollRight');
    bindingsFolder.add(controls.keyMap, 'pitchUp').name('pitchUp');
    bindingsFolder.add(controls.keyMap, 'pitchDown').name('pitchDown');
    bindingsFolder.add(controls.keyMap, 'yawLeft').name('yawLeft');
    bindingsFolder.add(controls.keyMap, 'yawRight').name('yawRight');
    bindingsFolder.add(controls.keyMap, 'throttleUp').name('throttleUp');
    bindingsFolder.add(controls.keyMap, 'throttleDown').name('throttleDown');
    bindingsFolder.close();

    const updateDebugDisplay = () => {
      inputDisplay.keysHeld = [...input.state.keys].join(', ');
      inputDisplay.camera = cameraController.activeMode;
      liveValues.aileron = controls.aileron;
      liveValues.elevator = controls.elevator;
      liveValues.rudder = controls.rudder;
      liveValues.throttle = controls.throttle;
      requestAnimationFrame(updateDebugDisplay);
    };
    updateDebugDisplay();

    attachFlightModelTuning(debug.gui, aircraft, flightModel);

    const telemetryFolder = debug.gui.addFolder('Telemetry');
    const tel = {
      altitude: 0,
      airspeed: 0,
      vSpeed: 0,
      pitchDeg: 0,
      rollDeg: 0,
      yawDeg: 0,
      pitchRateDegS: 0,
      rollRateDegS: 0,
      yawRateDegS: 0,
    };
    telemetryFolder.add(tel, 'altitude').name('altitude (m)').listen().disable();
    telemetryFolder.add(tel, 'airspeed').name('airspeed (m/s)').listen().disable();
    telemetryFolder.add(tel, 'vSpeed').name('vertical speed (m/s)').listen().disable();
    telemetryFolder.add(tel, 'pitchDeg').name('pitch (°)').listen().disable();
    telemetryFolder.add(tel, 'rollDeg').name('roll (°)').listen().disable();
    telemetryFolder.add(tel, 'yawDeg').name('yaw (°)').listen().disable();
    telemetryFolder.add(tel, 'pitchRateDegS').name('pitch rate (°/s)').listen().disable();
    telemetryFolder.add(tel, 'rollRateDegS').name('roll rate (°/s)').listen().disable();
    telemetryFolder.add(tel, 'yawRateDegS').name('yaw rate (°/s)').listen().disable();
    telemetryFolder.open();

    const RAD2DEG = 180 / Math.PI;
    const telemetryEuler = new Euler(0, 0, 0, 'YXZ');
    const updateTelemetry = () => {
      const s = aircraft.readBodyState();
      telemetryEuler.setFromQuaternion(s.quaternion, 'YXZ');
      tel.altitude = +s.position.y.toFixed(2);
      tel.airspeed = +s.linvel.length().toFixed(2);
      tel.vSpeed = +s.linvel.y.toFixed(2);
      tel.pitchDeg = +(telemetryEuler.x * RAD2DEG).toFixed(2);
      tel.rollDeg = +(telemetryEuler.z * RAD2DEG).toFixed(2);
      tel.yawDeg = +(telemetryEuler.y * RAD2DEG).toFixed(2);
      tel.pitchRateDegS = +(s.angvel.x * RAD2DEG).toFixed(2);
      tel.rollRateDegS = +(s.angvel.z * RAD2DEG).toFixed(2);
      tel.yawRateDegS = +(s.angvel.y * RAD2DEG).toFixed(2);
      requestAnimationFrame(updateTelemetry);
    };
    updateTelemetry();

    let telemetryFrame = 0;
    const telemetryLog = () => {
      const s = aircraft.readBodyState();
      telemetryEuler.setFromQuaternion(s.quaternion, 'YXZ');
      console.log(
        `[tel f=${telemetryFrame}] alt=${s.position.y.toFixed(2)} ` +
          `as=${s.linvel.length().toFixed(2)} vs=${s.linvel.y.toFixed(2)} ` +
          `pitch=${(telemetryEuler.x * RAD2DEG).toFixed(2)}° ` +
          `roll=${(telemetryEuler.z * RAD2DEG).toFixed(2)}° ` +
          `yaw=${(telemetryEuler.y * RAD2DEG).toFixed(2)}° ` +
          `pRate=${(s.angvel.x * RAD2DEG).toFixed(1)}°/s ` +
          `rRate=${(s.angvel.z * RAD2DEG).toFixed(1)}°/s ` +
          `yRate=${(s.angvel.y * RAD2DEG).toFixed(1)}°/s`,
      );
      telemetryFrame++;
    };
    setInterval(telemetryLog, 100);
    telemetryLog();

    (window as unknown as { __aircraft: unknown }).__aircraft = {
      body: aircraft.body,
      flightModel,
      getState: () => {
        const s = aircraft.readBodyState();
        telemetryEuler.setFromQuaternion(s.quaternion, 'YXZ');
        return {
          position: { x: s.position.x, y: s.position.y, z: s.position.z },
          linvel: { x: s.linvel.x, y: s.linvel.y, z: s.linvel.z },
          angvel: { x: s.angvel.x, y: s.angvel.y, z: s.angvel.z },
          eulerDeg: {
            pitch: telemetryEuler.x * RAD2DEG,
            yaw: telemetryEuler.y * RAD2DEG,
            roll: telemetryEuler.z * RAD2DEG,
          },
          airspeed: s.linvel.length(),
          throttle: controls.throttle,
        };
      },
    };
  }

  // WP11 boot flow: load the manifest, then either auto-start a mission named
  // in `?mission=<id>` or render the mission-select screen. The loop starts
  // paused; `startMission` unpauses it once the mission is ready.
  loop.setPaused(true);
  loop.start();

  async function startMission(id: string): Promise<void> {
    let mission: Mission;
    try {
      mission = await loadMission(id);
    } catch (err) {
      console.error(`Failed to load mission "${id}":`, err);
      // Re-show the select screen with the error state.
      missionSelect.show(missionManifest, { errorForId: id });
      return;
    }
    activeMission = mission;
    aircraft.reset(mission.spawn.position, mission.spawn.linvel);
    flightModel.resetSurfaceState();
    // Reset live control state (avoids the prior mission's stick deflections
    // carrying over into a fresh start).
    controls.aileron = 0;
    controls.elevator = 0;
    controls.rudder = 0;
    controls.throttle = mission.spawn.throttle;
    missionRunner.start(mission);
    missionSelect.hide();
    // WP12 — HUD lifecycle: show on mission start, set initial objective +
    // status, then unpause the loop so onRender starts feeding per-frame data.
    hud.show();
    hud.setStatus('flying');
    hud.setObjective(
      formatActiveObjective(mission.objectives, missionRunner.getObjectiveStates()),
    );
    loop.setPaused(false);
  }

  // WP12 — re-render the objective string when any objective state changes.
  missionRunner.on('objectiveChange', () => {
    if (activeMission === null) return;
    hud.setObjective(
      formatActiveObjective(activeMission.objectives, missionRunner.getObjectiveStates()),
    );
  });

  // Status-change listener — on terminal state (won/failed), pause the loop,
  // briefly show the outcome banner, then return to the select screen.
  missionRunner.on('statusChange', () => {
    const status = missionRunner.getStatus();
    if (status !== 'won' && status !== 'failed') return;
    if (activeMission === null) return;
    const missionName = activeMission.name;
    loop.setPaused(true);
    hud.setStatus(status);
    void missionSelect.showOutcome(status, missionName).then(() => {
      activeMission = null;
      hud.hide();
      missionSelect.show(missionManifest);
    });
  });

  missionSelect.onSelect((id) => {
    void startMission(id);
  });

  try {
    missionManifest = await loadMissionList();
  } catch (err) {
    console.error('Failed to load mission manifest:', err);
    missionManifest = [];
  }

  // `?mission=<id>` deep-link: if present, try auto-start. If the id is not in
  // the manifest, fall back to the select screen with an error.
  const params = new URLSearchParams(window.location.search);
  const requestedMissionId = params.get('mission');
  if (requestedMissionId !== null) {
    if (missionManifest.some((m) => m.id === requestedMissionId)) {
      await startMission(requestedMissionId);
    } else {
      missionSelect.show(missionManifest, { errorForId: requestedMissionId });
    }
  } else {
    missionSelect.show(missionManifest);
  }
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
});
