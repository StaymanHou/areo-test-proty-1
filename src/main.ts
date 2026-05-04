import RAPIER from '@dimforge/rapier3d-compat';
import { BoxGeometry, Mesh, MeshStandardMaterial, DirectionalLight } from 'three';
import { createRenderContext } from './world/scene';
import { initDebug } from './engine/debug';
import { GameLoop } from './engine/loop';
import { InputManager, DEFAULT_KEY_MAP } from './engine/input';
import { CameraController, CameraMode } from './world/camera';

async function bootstrap() {
  const mount = document.querySelector<HTMLDivElement>('#app');
  if (!mount) throw new Error('#app mount not found');

  const rapierReady = RAPIER.init();

  const { scene, camera, renderer } = createRenderContext(mount);
  const debug = initDebug();
  const input = new InputManager();
  const cameraController = new CameraController(camera);

  const sun = new DirectionalLight(0xffffff, 0.8);
  sun.position.set(5, 10, 7);
  scene.add(sun);

  await rapierReady;

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const groundDesc = RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0);
  world.createCollider(groundDesc);

  const cubeBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0);
  const cubeBody = world.createRigidBody(cubeBodyDesc);
  const cubeColliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setRestitution(0.4);
  world.createCollider(cubeColliderDesc, cubeBody);

  const cubeMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0xff6633 }),
  );
  scene.add(cubeMesh);

  const loop = new GameLoop(
    {
      onPhysics: (dt) => {
        world.timestep = dt;
        world.step();
      },
      onRender: () => {
        const t = cubeBody.translation();
        const r = cubeBody.rotation();
        cubeMesh.position.set(t.x, t.y, t.z);
        cubeMesh.quaternion.set(r.x, r.y, r.z, r.w);

        if (input.wasActionPressed('swapCamera', DEFAULT_KEY_MAP)) {
          cameraController.setMode(
            cameraController.activeMode === CameraMode.Chase
              ? CameraMode.Cockpit
              : CameraMode.Chase,
          );
        }

        // Use physics dt as the render delta — good enough for camera damping at 60 Hz
        cameraController.update(cubeMesh.position, cubeMesh.quaternion, 1 / 60);

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
    const updateDebugDisplay = () => {
      inputDisplay.keysHeld = [...input.state.keys].join(', ');
      inputDisplay.camera = cameraController.activeMode;
      requestAnimationFrame(updateDebugDisplay);
    };
    updateDebugDisplay();
  }

  loop.start();
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
});
