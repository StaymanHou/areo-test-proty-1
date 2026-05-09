import RAPIER from '@dimforge/rapier3d-compat';
import { DirectionalLight, Vector3 } from 'three';
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

  const aircraft = new Aircraft(world, config, {
    position: new Vector3(0, 50, 0),
    linvel: new Vector3(0, 0, -30),
  });
  scene.add(aircraft.mesh);

  const flightModel = new FlightModel(aircraft);
  const controls = new Controls(input);

  const loop = new GameLoop(
    {
      onPhysics: (dt) => {
        controls.update(dt);
        flightModel.applyControls(controls);
        flightModel.applyForces(controls.throttle);
        world.timestep = dt;
        world.step();
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
  }

  loop.start();
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
});
