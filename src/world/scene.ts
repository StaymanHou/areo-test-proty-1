import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  DirectionalLight,
  AmbientLight,
  PCFShadowMap,
} from 'three';

export interface RenderContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
  sun: DirectionalLight;
  ambient: AmbientLight;
}

export function createRenderContext(mount: HTMLElement): RenderContext {
  const scene = new Scene();

  const camera = new PerspectiveCamera(
    60,
    mount.clientWidth / mount.clientHeight,
    0.1,
    5000,
  );
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 0, 0);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  mount.appendChild(renderer.domElement);

  // Directional sun — direction matches the procedural-skybox sun (px face).
  const sun = new DirectionalLight(0xffeecc, 1.0);
  sun.position.set(200, 220, 60);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -250;
  sun.shadow.camera.right = 250;
  sun.shadow.camera.top = 250;
  sun.shadow.camera.bottom = -250;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 800;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new AmbientLight(0xb0c8e0, 0.45);
  scene.add(ambient);

  window.addEventListener('resize', () => {
    camera.aspect = mount.clientWidth / mount.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mount.clientWidth, mount.clientHeight);
  });

  return { scene, camera, renderer, canvas: renderer.domElement, sun, ambient };
}
