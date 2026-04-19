import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  Color,
} from 'three';

export interface RenderContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
}

export function createRenderContext(mount: HTMLElement): RenderContext {
  const scene = new Scene();
  scene.background = new Color(0x87ceeb);

  const camera = new PerspectiveCamera(
    60,
    mount.clientWidth / mount.clientHeight,
    0.1,
    2000,
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
