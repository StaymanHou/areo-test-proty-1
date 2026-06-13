import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  Euler,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { createRenderContext } from './world/scene';
import * as particles from './world/particles';
import { initDebug } from './engine/debug';
import { GameLoop } from './engine/loop';
import { InputManager, DEFAULT_KEY_MAP } from './engine/input';
import { CameraController, CameraMode } from './world/camera';
import { loadAircraftConfig } from './aircraft/physics-core/config';
import { Aircraft } from './aircraft/rigidbody';
import { FlightModel } from './aircraft/physics-core/flightmodel';
import { Controls } from './aircraft/controls';
import { attachFlightModelTuning } from './engine/tuning';
import { FlatTerrain } from './world/terrain';
import { createProceduralSkybox } from './world/skybox';
import { createRunway, createTower } from './world/landmarks';
import { createAircraftState, toAircraftState } from './aircraft/physics-core/state';
import { TrajectoryBuffer } from './aircraft/physics-core/trajectory-buffer';
import { step as physicsStep } from './aircraft/physics-core/step';
import { loadMission, loadMissionList } from './mission/loader';
import { MissionRunner } from './mission/runner';
import { MissionSelectScreen } from './mission/select';
import { resolveAirframeName, getSelectedAirframe } from './mission/aircraft-options';
import type { Mission, MissionManifestEntry } from './mission/types';
import {
  registerCombatAi,
  resetCombatState,
  getCombatState,
  POOL_SIZE as PROJECTILE_POOL_SIZE,
  RETURN_FIRE_POOL_SIZE,
} from './mission/hooks/combat-ai';
import { DomHud } from './hud/dom-hud';
import { KeyHintsOverlay } from './hud/key-hints';
import { formatActiveObjective, getActiveWaypointPosition } from './hud/format';
import { parseScriptSpec, configNameToPath } from './engine/scripted-input';
import { ScriptedInputRunner } from './engine/scripted-input-runner';
import { AudioEngine } from './audio/audio-engine';

// WP18 — splash overlay helpers. The splash element is inlined in index.html
// so it paints on first frame, BEFORE the JS bundle parses. These helpers let
// main.ts update its stage label and detach it once mission-select renders.
function setSplashStage(text: string): void {
  const el = document.getElementById('splash-stage');
  if (el !== null) el.textContent = text;
}
function removeSplash(): void {
  const el = document.getElementById('splash');
  if (el !== null) el.remove();
}

async function bootstrap() {
  const mount = document.querySelector<HTMLDivElement>('#app');
  if (!mount) throw new Error('#app mount not found');

  // Parse URL query params early — needed for ?config= (aircraft selection)
  // and ?script= (deterministic input harness, gated on ?debug=true).
  const urlParams = new URLSearchParams(window.location.search);
  const debugEnabled = urlParams.get('debug') === 'true';
  const scriptedInput = parseScriptSpec(urlParams);
  for (const w of scriptedInput.warnings) console.warn(w);

  // Airframe config resolution — precedence (WP24):
  //   URL ?config= > preloaded-mission `config?` > localStorage pick > default.
  // When the URL has no ?config= but does have ?mission=<id> and the mission
  // declares its own `config?`, we pre-load that mission so its `config?` can
  // shape the boot-time `loadAircraftConfig` call. The pre-loaded mission is
  // handed to startMission below to avoid a second fetch.
  // Mid-session swap is still unsupported — the mission-select picker (WP24
  // Phase 3) calls location.reload() when the player changes airframe between
  // missions, so the new pick is honored via this same boot path on reload.
  // SURFACE-2026-06-06-06 (Phase B feel-tune deferred; Phase C swap deferred).
  const urlConfigName = scriptedInput.plan?.configName ?? null;
  const requestedMissionId = urlParams.get('mission');
  let preloadedMission: Mission | null = null;
  let missionConfig: string | null | undefined = null;
  if (urlConfigName === null && requestedMissionId !== null) {
    try {
      preloadedMission = await loadMission(requestedMissionId);
      missionConfig = preloadedMission.config;
    } catch (err) {
      // Pre-load failed — fall back to default airframe; startMission below
      // re-attempts the fetch and surfaces the error via errorForId path.
      console.warn(
        `mission pre-load failed for "${requestedMissionId}" (will retry at startMission):`,
        err,
      );
    }
  }
  const airframeResolution = resolveAirframeName({
    urlConfig: urlConfigName,
    missionConfig,
  });
  const resolvedConfigName: string | null = airframeResolution.name;
  const aircraftConfigPath = configNameToPath(resolvedConfigName);

  // Debug accessor — surface resolved airframe + its source for verify-self
  // probes and developer inspection. Gated on ?debug=true to keep the prod
  // boot path side-effect-free.
  if (debugEnabled) {
    (window as unknown as { __aircraftConfig: { name: string | null; source: string } }).__aircraftConfig = {
      name: resolvedConfigName,
      source: airframeResolution.source,
    };
  }

  setSplashStage('Loading physics…');
  const rapierReady = RAPIER.init();
  const configReady = loadAircraftConfig(aircraftConfigPath);

  const { scene, camera, renderer } = createRenderContext(mount);
  const debug = initDebug();
  const input = new InputManager();
  const cameraController = new CameraController(camera);

  await rapierReady;
  const config = await configReady;
  setSplashStage('Loading scene…');

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const terrain = new FlatTerrain({ size: 4000, height: 0, textureRepeat: 100 });
  scene.add(terrain.getMesh());
  world.createCollider(terrain.getColliderDesc());

  scene.background = createProceduralSkybox().cubeTexture;

  // WP20 Phase 3 — particle system. Mount the shared Points mesh on the scene
  // once at boot. emit() calls below fire kind-tagged bursts; update() runs
  // per-render-frame to advance them. Pool is allocation-free; debug accessor
  // exposed at `window.__particles` under ?debug=true.
  particles.mount(scene);

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

  // WP16 — register the combat-ai script hook so `combat.json` (which sets
  // `scriptHook: 'combat-ai'`) resolves successfully at MissionRunner.start.
  // Must run before any combat mission is started; boot-once is correct.
  // The input provider closes over `input` so the hook can sample Space each
  // physics tick without coupling combat-ai.ts to InputManager directly.
  // Phase 4: failSignal binds to MissionRunner so the hook can terminate the
  // mission as a loss when player HP reaches 0 (closes over missionRunner —
  // it's hoisted via const above, no TDZ issue at registration time).
  registerCombatAi(
    () => input.isDown('Space'),
    (reason) => missionRunner.setHookFailFlag(reason),
    // WP19 — audio triggers. Fire-and-forget; AudioEngine no-ops if the
    // context isn't running yet (e.g., before the first user gesture).
    // WP19 audio + WP20 particle triggers. Both fire on player gun discharge.
    (pos) => {
      audioEngine.triggerFire();
      particles.emit('muzzle-flash', pos.x, pos.y, pos.z);
    },
    (pos) => {
      audioEngine.triggerImpact();
      particles.emit('impact', pos.x, pos.y, pos.z);
    },
  );

  // WP16 Phase 2 — projectile mesh pool. Pre-allocated once at boot; per-frame
  // `onRender` syncs visibility + position from the plain-data combatState pool.
  // Yellow 0.5m sphere matches a tracer-class visual at v1 polish level
  // (WP20 replaces with proper muzzle-flash + tracer particles).
  const projectileGeo = new SphereGeometry(0.5, 8, 8);
  const projectileMat = new MeshBasicMaterial({ color: 0xffff00 });
  const projectileMeshes: Mesh[] = [];
  for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
    const m = new Mesh(projectileGeo, projectileMat);
    m.visible = false;
    scene.add(m);
    projectileMeshes.push(m);
  }

  // WP16 Phase 3 — ground target mesh. WP20 Phase 4 (SURFACE-2026-06-07-01):
  // visual is decoupled from the hit-detection AABB. The collider stays at
  // halfExtents=(10,8,10), y=0 (gameplay-tuned at WP16 Phase 5 P5.2 for the
  // mig15 ground-cruise corridor and remains unchanged). The visual is rendered
  // as a short, broad ground building (4 m tall, 20 m square base) sitting on
  // the terrain at y=0..4 — matches the spec's "ground target" silhouette
  // without changing the gameplay AABB. Hazard-orange while alive; switches to
  // dark-grey + 90° Z tilt on destruction (visual feedback for the win path).
  const TARGET_ALIVE_COLOR = 0xff6a00;
  const TARGET_DEAD_COLOR = 0x222222;
  const TARGET_VISUAL_HEIGHT = 4; // m, mesh y-extent
  const TARGET_VISUAL_Y_OFFSET = TARGET_VISUAL_HEIGHT / 2; // sit on ground
  const targetGeo = new BoxGeometry(20, TARGET_VISUAL_HEIGHT, 20);
  const targetMat = new MeshLambertMaterial({ color: TARGET_ALIVE_COLOR });
  const targetMesh = new Mesh(targetGeo, targetMat);
  targetMesh.castShadow = true;
  targetMesh.visible = false;
  scene.add(targetMesh);

  // WP16 Phase 4 — return-fire projectile mesh pool (dark-red spheres,
  // visually distinguishable from the player's yellow projectiles). Same
  // sync pattern as projectileMeshes: pre-allocated once, per-frame visibility
  // + position sync from the plain-data return-fire pool.
  const returnFireGeo = new SphereGeometry(0.5, 8, 8);
  const returnFireMat = new MeshBasicMaterial({ color: 0x882020 });
  const returnFireMeshes: Mesh[] = [];
  for (let i = 0; i < RETURN_FIRE_POOL_SIZE; i++) {
    const m = new Mesh(returnFireGeo, returnFireMat);
    m.visible = false;
    scene.add(m);
    returnFireMeshes.push(m);
  }
  const aircraftStateBuf = createAircraftState();
  let activeMission: Mission | null = null;
  let missionManifest: MissionManifestEntry[] = [];

  // WP12 HUD wiring (D12 DOM-overlay).
  const hud = new DomHud(camera, renderer.domElement);

  // WP18 Phase 2 — Key-hints overlay. Shown for ~20s after each mission start
  // then auto-fades; re-shown on every fresh mission entry.
  const keyHints = new KeyHintsOverlay();

  // WP19 — AudioEngine. Allocation-only at construction; the AudioContext is
  // created and resumed on the first user gesture (mission-select click) per
  // Safari/iOS autoplay restrictions (research R4). Phase 1 wires the per-tick
  // throttle + airspeed inputs; Phase 2 wires the one-shot trigger callbacks.
  const audioEngine = new AudioEngine();

  // WP14.6 trajectory buffer — allocated only under ?debug=true. Records one
  // row per fixed physics tick from `onPhysics` for the parity-test hook
  // `window.__aircraft.getTrajectory()`. Null in production (no allocation
  // on the hot path for end-user play).
  let trajectoryBuffer: TrajectoryBuffer | null = null;

  // Scripted-input harness — debug-only, instantiated when ?script=... is
  // present alongside ?debug=true. Drives input deterministically at the
  // physics-tick boundary; bypasses the DOM keyboard event layer to avoid
  // Playwright dispatchEvent jitter. See SURFACE-2026-06-06-04.
  let scriptedRunner: ScriptedInputRunner | null = null;
  if (debugEnabled && scriptedInput.plan !== null) {
    scriptedRunner = new ScriptedInputRunner(scriptedInput.plan, input, controls);
  } else if (!debugEnabled && scriptedInput.plan !== null) {
    console.warn('scripted-input: ?script= ignored — also requires ?debug=true');
  }

  // WP20 Phase 3 — wall-clock tracker for particle update dt. Initialized to 0
  // so the first frame uses a 1/60 fallback (avoids a Number.MAX dt on cold-load).
  let lastRenderMs = 0;

  const loop = new GameLoop(
    {
      onPhysics: (dt) => {
        // Scripted input runs BEFORE controls.update so synthesized keys land
        // in `input.state.keys` in time for this tick's controls integration.
        // Throttle override is written directly to controls.throttle and is
        // not affected by `controls.update` unless a real ShiftLeft/ControlLeft
        // is also held (intentional: user input can fight scripts in debug).
        if (scriptedRunner !== null) {
          scriptedRunner.tick(aircraft.readBodyState());
        }
        controls.update(dt);
        flightModel.applyControls(controls);
        flightModel.applyForces(controls.throttle, dt);
        world.timestep = dt;
        world.step();
        // Record post-step state into the trajectory buffer (debug-only).
        if (trajectoryBuffer !== null) {
          trajectoryBuffer.record(aircraft.readBodyState());
        }
        // WP19 — feed audio engine each physics tick. No-op until first
        // user gesture resumes the AudioContext. Two scalar writes, no alloc.
        {
          const bs = aircraft.readBodyState();
          audioEngine.setEngineThrottle(controls.throttle);
          audioEngine.setWindAirspeed(bs.linvel.length());
        }
        // Tick the mission runner AFTER the physics step so it observes
        // post-step aircraft state for objective/win/fail evaluation.
        if (missionRunner.getStatus() === 'running') {
          toAircraftState(aircraft.readBodyState(), aircraftStateBuf);
          missionRunner.tick(aircraftStateBuf, dt);
          // WP18 Phase 2 — key-hints fade timer. Ticked at the fixed-timestep
          // physics rate so the 20s fade is wall-clock-stable AND deterministic
          // under the `?script=` harness (which can advance physics faster than
          // wall-clock for e2e probes). Only ticks while mission is running —
          // a paused mission does NOT burn the hint window.
          keyHints.update(dt);
        }
      },
      onRender: () => {
        // WP20 Phase 3 — particle system update on each render frame. dt is
        // wall-clock-derived so visual effects advance independently of the
        // fixed-physics-tick (matches "variable-step is fine for visuals").
        const nowMs = performance.now();
        const dtSec = lastRenderMs === 0 ? 1 / 60 : Math.min(0.1, (nowMs - lastRenderMs) / 1000);
        lastRenderMs = nowMs;
        particles.update(dtSec);

        aircraft.syncMesh();

        if (input.wasActionPressed('swapCamera', DEFAULT_KEY_MAP)) {
          cameraController.setMode(
            cameraController.activeMode === CameraMode.Chase
              ? CameraMode.Cockpit
              : CameraMode.Chase,
          );
        }

        cameraController.update(aircraft.mesh.position, aircraft.mesh.quaternion, 1 / 60);

        // WP16 Phase 2 — projectile mesh sync. The pool is shared (allocated
        // once at boot); `visible` flips off when the slot is inactive so
        // non-combat missions cost zero render work. Hot path — read-only of
        // the plain-data projectile array, no allocations.
        {
          const cs = getCombatState();
          for (let i = 0; i < cs.projectiles.length; i++) {
            const p = cs.projectiles[i]!;
            const m = projectileMeshes[i]!;
            m.visible = p.active;
            if (p.active) {
              m.position.set(p.position.x, p.position.y, p.position.z);
            }
          }
          // WP16 Phase 3 — target mesh sync. Visibility/lifecycle is driven by
          // activeMission.type below in startMission/status-change handlers;
          // here we only sync the destruction visual (color + tilt) and the
          // world position. The target's position is static per mission, but
          // re-syncing it each frame avoids a separate startMission write.
          if (targetMesh.visible) {
            const t = cs.target;
            // Visual sits on terrain (y = AABB_center + visual_half_height).
            targetMesh.position.set(
              t.position.x,
              t.position.y + TARGET_VISUAL_Y_OFFSET,
              t.position.z,
            );
            if (t.destroyed) {
              (targetMesh.material as MeshLambertMaterial).color.setHex(
                TARGET_DEAD_COLOR,
              );
              targetMesh.rotation.z = Math.PI / 2;
            } else {
              (targetMesh.material as MeshLambertMaterial).color.setHex(
                TARGET_ALIVE_COLOR,
              );
              targetMesh.rotation.z = 0;
            }
          }
          // WP16 Phase 4 — return-fire mesh sync. Same pattern as projectiles.
          for (let i = 0; i < cs.returnFire.pool.length; i++) {
            const p = cs.returnFire.pool[i]!;
            const m = returnFireMeshes[i]!;
            m.visible = p.active;
            if (p.active) {
              m.position.set(p.position.x, p.position.y, p.position.z);
            }
          }
        }

        // WP12 HUD per-frame update. Hot path — `hud` no-ops when not shown.
        if (missionRunner.getStatus() === 'running') {
          toAircraftState(aircraft.readBodyState(), aircraftStateBuf);
          hud.setAircraftState(aircraftStateBuf);
          hud.setThrottle(controls.throttle);
          // WP14 — feed the next-incomplete reach-waypoint position to the
          // HUD arrow each frame. `null` when there's none (free-flight,
          // all complete, or non-waypoint missions). The helper is cheap
          // (O(objectives), no allocation).
          hud.setWaypointArrow(
            activeMission === null
              ? null
              : getActiveWaypointPosition(
                  activeMission.objectives,
                  missionRunner.getObjectiveStates(),
                ),
          );
          // WP16 Phase 4 — feed combat HP rows. Combat missions show both;
          // non-combat missions pass (null,null) which hides the rows.
          if (activeMission !== null && activeMission.type === 'combat') {
            const cs = getCombatState();
            hud.setCombatHP(cs.playerHp, cs.target.destroyed ? 0 : cs.target.hp);
          } else {
            hud.setCombatHP(null, null);
          }

          // WP13 — player-initiated return to mission-select via Escape.
          if (input.wasActionPressed('returnToMenu', DEFAULT_KEY_MAP)) {
            missionRunner.abort();
          }
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

    // WP14.6 trajectory recording (debug-only). Capacity 1800 = 30s @ 60Hz —
    // enough for the WP14.5 phugoid-probe envelope. Records post-step state
    // each physics tick (see `onPhysics` in the GameLoop config above).
    trajectoryBuffer = new TrajectoryBuffer(1800);

    (window as unknown as { __aircraft: unknown }).__aircraft = {
      body: aircraft.body,
      flightModel,
      controls,
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
      // WP14.6 — defensive snapshot of the trajectory ring buffer (debug-only).
      // Each call returns a fresh array of copied rows in chronological order.
      // Returns `[]` if no ticks have been recorded yet.
      getTrajectory: () => (trajectoryBuffer === null ? [] : trajectoryBuffer.getRows()),
      // Scripted-input harness (SURFACE-2026-06-06-04). Returns a structured
      // per-tick log of the in-game state under a deterministic input script,
      // or `[]` when no `?script=` was supplied. `isScriptComplete()` returns
      // true once all scheduled events plus a settle window have elapsed,
      // letting Playwright `page.waitForFunction(...)` return deterministically.
      getScriptedLog: () => (scriptedRunner === null ? [] : scriptedRunner.getLog()),
      isScriptComplete: () => (scriptedRunner === null ? false : scriptedRunner.isComplete()),
      // WP14.6 — deterministic-replay hook for the parity test. Pauses the
      // game loop, resets the body to the fixture state (zero control surface
      // deflections + β5 prev-AoA cache via FlightModel.resetSurfaceState),
      // clears the trajectory buffer, then advances exactly `ticks` fixed-dt
      // physics steps via `physicsStep`. Returns the resulting trajectory.
      // Does NOT unpause afterwards — caller can either resume or leave paused.
      runFixture: (fixture: {
        position: { x: number; y: number; z: number };
        linvel: { x: number; y: number; z: number };
        throttle: number;
        ticks: number;
      }) => {
        loop.setPaused(true);
        aircraft.reset(fixture.position, fixture.linvel);
        flightModel.resetSurfaceState();
        if (trajectoryBuffer === null) {
          throw new Error('runFixture: trajectoryBuffer not allocated (debug-only)');
        }
        trajectoryBuffer.reset();
        const dt = 1 / 60;
        for (let i = 0; i < fixture.ticks; i++) {
          physicsStep(world, aircraft, flightModel, { throttle: fixture.throttle }, dt);
          trajectoryBuffer.record(aircraft.readBodyState());
        }
        return trajectoryBuffer.getRows();
      },
    };

    // WP16 Phase 2 — debug accessor for the combat projectile pool. Returns a
    // deep-copied snapshot so test assertions can hold the array across ticks
    // without seeing in-flight mutations. Active-only filtering is left to the
    // caller (cheap — POOL_SIZE=32).
    (window as unknown as { __combat: unknown }).__combat = {
      getProjectileSnapshot: () => {
        const cs = getCombatState();
        return cs.projectiles.map((p) => ({
          active: p.active,
          position: { x: p.position.x, y: p.position.y, z: p.position.z },
          velocity: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
          ageSec: p.ageSec,
        }));
      },
      getFireCooldown: () => getCombatState().fireCooldown,
      // WP16 Phase 3 — target snapshot. Returns a shallow-copied view so test
      // assertions can hold the object across ticks without seeing in-flight
      // hp mutations from the same-tick AABB sweep.
      getTargetSnapshot: () => {
        const t = getCombatState().target;
        return {
          position: { x: t.position.x, y: t.position.y, z: t.position.z },
          halfExtents: { x: t.halfExtents.x, y: t.halfExtents.y, z: t.halfExtents.z },
          hp: t.hp,
          destroyed: t.destroyed,
        };
      },
      // WP16 Phase 4 — return-fire pool snapshot + player HP accessors.
      // Deep-copy the return-fire pool (same allocation-free convention as
      // getProjectileSnapshot — caller can hold the snapshot across ticks).
      getReturnFireSnapshot: () => {
        const cs = getCombatState();
        return cs.returnFire.pool.map((p) => ({
          active: p.active,
          position: { x: p.position.x, y: p.position.y, z: p.position.z },
          velocity: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
          ageSec: p.ageSec,
        }));
      },
      getReturnFireCooldown: () => getCombatState().returnFire.cooldown,
      getPlayerHp: () => getCombatState().playerHp,
    };

    // WP19 — audio engine debug accessor. Deep-copied state snapshot per the
    // per-tick mutable state convention. `getState()` and `getRecentOneShots()`
    // both return fresh objects/arrays each call.
    (window as unknown as { __audio: unknown }).__audio = {
      getState: () => audioEngine.getState(),
      getRecentOneShots: () => audioEngine.getRecentOneShots(),
    };

    // WP20 Phase 3 — particle system debug accessor. Deep-copied snapshot per
    // the per-tick mutable state convention.
    (window as unknown as { __particles: unknown }).__particles = {
      getActiveCount: () => particles.getActiveCount(),
      getSnapshot: () => particles.getSnapshot(),
    };
  }

  // WP11 boot flow: load the manifest, then either auto-start a mission named
  // in `?mission=<id>` or render the mission-select screen. The loop starts
  // paused; `startMission` unpauses it once the mission is ready.
  loop.setPaused(true);
  loop.start();

  async function startMission(id: string, preloaded: Mission | null = null): Promise<void> {
    let mission: Mission;
    if (preloaded !== null && preloaded.id === id) {
      mission = preloaded;
    } else {
      try {
        mission = await loadMission(id);
      } catch (err) {
        console.error(`Failed to load mission "${id}":`, err);
        // Re-show the select screen with the error state.
        missionSelect.show(missionManifest, { errorForId: id, pinnedConfigs });
        return;
      }
    }
    // If the mission declares its own `config?` but the boot path already
    // loaded a different airframe (URL ?config= won precedence, OR the user
    // returned to the menu and picked a mission that wants a different
    // airframe), surface that as a console.warn so debug agents and Phase C
    // implementers can spot the mismatch. The currently-loaded airframe wins
    // — mid-session swap is deferred to Phase C (full page reload required).
    if (mission.config !== undefined && mission.config !== resolvedConfigName) {
      console.warn(
        `mission "${id}" declares config="${mission.config}" but boot loaded "${resolvedConfigName ?? 'default'}" — mid-session airframe swap not supported (Phase A); reload page to apply mission's config.`,
      );
    }
    activeMission = mission;
    aircraft.reset(mission.spawn.position, mission.spawn.linvel);
    flightModel.resetSurfaceState();
    // WP16 — reset projectile pool + cooldown so the new mission starts clean.
    // (Combat-only state; resetting it for non-combat missions is a cheap no-op
    // that also clears any tracers left over from a prior combat mission when
    // returning to the menu.)
    resetCombatState();
    // WP20 Phase 3 — clear any particles from the prior mission so a re-
    // entered combat mission doesn't show stale muzzle-flash residue.
    particles.resetParticles();
    // WP16 Phase 3 — show the target only for combat missions. Reset the
    // visual state explicitly so a previously-destroyed target re-appearing in
    // a re-played combat mission shows the alive (orange + upright) visual.
    if (mission.type === 'combat') {
      const t = getCombatState().target;
      targetMesh.position.set(
        t.position.x,
        t.position.y + TARGET_VISUAL_Y_OFFSET,
        t.position.z,
      );
      (targetMesh.material as MeshLambertMaterial).color.setHex(TARGET_ALIVE_COLOR);
      targetMesh.rotation.z = 0;
      targetMesh.visible = true;
    } else {
      targetMesh.visible = false;
    }
    // Reset live control state (avoids the prior mission's stick deflections
    // carrying over into a fresh start). `resetSticks()` clears both the raw
    // pre-curve buffer and the public fields; throttle is set explicitly.
    controls.resetSticks();
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
    // WP18 Phase 2 — show the key-hints overlay for the first ~20s of every
    // mission run. Fresh `show()` resets the timer + opacity so a replay of
    // the same mission shows hints again.
    keyHints.show(mission.type);
    // WP18 — drop the splash on the auto-start (?mission=) path. No-op if
    // mission-select already removed it (the menu path).
    removeSplash();
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
  // briefly show the outcome banner, then return to the select screen. WP13:
  // player-initiated aborts (via Escape) skip the outcome banner entirely.
  missionRunner.on('statusChange', () => {
    const status = missionRunner.getStatus();
    if (status !== 'won' && status !== 'failed') return;
    if (activeMission === null) return;
    loop.setPaused(true);

    // WP19 — crash SFX on natural crash fails (not on abort, not on
    // timeout/oob/hook). Trigger before the abort-branch so an aborted run
    // is silent (matches the no-banner abort UX). WP20 Phase 3 — fire a
    // ground-dust particle burst at the aircraft's last position too.
    if (
      status === 'failed' &&
      !missionRunner.wasAborted() &&
      missionRunner.getFailReason() === 'crash'
    ) {
      audioEngine.triggerCrash();
      const bs = aircraft.readBodyState();
      particles.emit('ground-dust', bs.position.x, bs.position.y, bs.position.z);
    }

    if (missionRunner.wasAborted()) {
      // Silent return — no banner, no delay.
      activeMission = null;
      hud.hide();
      keyHints.hide();
      targetMesh.visible = false;
      missionSelect.show(missionManifest, { pinnedConfigs });
      return;
    }

    const missionName = activeMission.name;
    hud.setStatus(status);
    void missionSelect.showOutcome(status, missionName).then(() => {
      activeMission = null;
      hud.hide();
      keyHints.hide();
      targetMesh.visible = false;
      missionSelect.show(missionManifest, { pinnedConfigs });
    });
  });

  // WP26 — slider drags forward to AudioEngine for real-time apply. Persistence
  // is handled inside the slider's `input` handler (calls setMasterVolume(v))
  // so the choice survives reloads regardless of this callback being wired.
  missionSelect.onVolumeChange((v) => {
    audioEngine.setMasterGain(v);
  });

  missionSelect.onSelect((id) => {
    // WP24 Phase 3 — reload-after-airframe-change. Boot binds the airframe
    // once (Aircraft/FlightModel/world constructed pre-mission); mid-session
    // swap is unsupported. The picker has persisted the player's choice to
    // localStorage — if it differs from what boot loaded AND the mission
    // doesn't pin its own config (which would override the picker anyway),
    // reload so the new pick is honored via the boot path. Per-mission
    // pinned configs still win — no reload when the mission's pinned
    // airframe matches the currently-loaded airframe.
    const pickedAirframe: string = getSelectedAirframe(); // 'default' | 'mig15' | …
    const picked: string | null = pickedAirframe === 'default' ? null : pickedAirframe;
    const missionPinned = pinnedConfigs.get(id) ?? null;
    const effectiveNext = missionPinned ?? picked;
    if (effectiveNext !== resolvedConfigName) {
      // The picker writes the choice to localStorage on click; boot reads it.
      // Include `?mission=<id>` so the deep-link auto-start runs the chosen
      // mission immediately after reload (instead of dropping the player
      // back on the menu).
      const url = new URL(window.location.href);
      url.searchParams.set('mission', id);
      window.location.assign(url.toString());
      return;
    }
    // WP19 — first user-gesture is the Safari autoplay unlock for Web Audio.
    // Fire-and-forget: failures only log, never block mission start.
    void audioEngine.start().catch((err) => {
      console.warn('AudioEngine.start() rejected:', err);
    });
    void startMission(id);
  });

  try {
    missionManifest = await loadMissionList();
  } catch (err) {
    console.error('Failed to load mission manifest:', err);
    missionManifest = [];
  }

  // WP24 Phase 3 — eager-fetch every manifest mission's JSON so the picker can
  // label per-mission pinned-config overrides inline (e.g. "Combat [MiG-15]").
  // Phase 2 has 4 missions; parallel fetch is cheap. Failures are non-fatal —
  // a mission with no entry in pinnedConfigs renders as free-pick.
  const pinnedConfigs = new Map<string, string>();
  await Promise.all(
    missionManifest.map(async (entry) => {
      try {
        const m = await loadMission(entry.id);
        if (m.config !== undefined) pinnedConfigs.set(entry.id, m.config);
      } catch {
        // Manifest entry exists but JSON failed to fetch — drop silently;
        // tile renders as free-pick, deep-link path will surface the error.
      }
    }),
  );

  // `?mission=<id>` deep-link: if present, try auto-start. We hand off to
  // startMission() unconditionally — it loads the JSON directly (independent
  // of the manifest) and falls back to the select-with-error path if the
  // fetch fails. The manifest only governs which missions appear in the
  // menu UI; deep-link load works for any mission whose JSON exists.
  // `preloadedMission` is the result of the early mission fetch done above
  // for per-mission airframe config resolution — re-using it avoids a second
  // network request.
  if (requestedMissionId !== null) {
    // WP19 — attempt to resume audio on the deep-link path too. May fail in
    // Safari if the URL was opened without a gesture; harmless if so.
    void audioEngine.start().catch((err) => {
      console.warn('AudioEngine.start() rejected (deep-link path):', err);
    });
    await startMission(requestedMissionId, preloadedMission);
  } else {
    setSplashStage('Ready');
    missionSelect.show(missionManifest, { pinnedConfigs });
    // WP18 — mission-select is now the visible "start" surface; drop the splash.
    removeSplash();
  }
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
});
