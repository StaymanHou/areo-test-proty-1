import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
} from 'three';

export interface RenderContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
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
  mount.appendChild(renderer.domElement);

  scene.add(new HemisphereLight(0xffffff, 0x404040, 1.0));

  window.addEventListener('resize', () => {
    camera.aspect = mount.clientWidth / mount.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mount.clientWidth, mount.clientHeight);
  });

  return { scene, camera, renderer, canvas: renderer.domElement };
}
