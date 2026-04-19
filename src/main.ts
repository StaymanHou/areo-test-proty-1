import RAPIER from '@dimforge/rapier3d-compat';
import { createRenderContext } from './world/scene';
import { initDebug } from './engine/debug';

async function bootstrap() {
  const mount = document.querySelector<HTMLDivElement>('#app');
  if (!mount) throw new Error('#app mount not found');

  const rapierReady = RAPIER.init();

  const { scene, camera, renderer } = createRenderContext(mount);
  const debug = initDebug();

  await rapierReady;
  // Rapier is loaded; WP2 will create a world and start stepping it.

  function frame() {
    debug?.stats.begin();
    renderer.render(scene, camera);
    debug?.stats.end();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
});
