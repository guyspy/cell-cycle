import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export function createScene(canvas: HTMLCanvasElement) {
  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Scene
  const scene = new THREE.Scene();

  // Camera
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  camera.position.set(0, 30, 30);
  camera.lookAt(0, 0, 0);

  // Lighting — soft ambient only, cells glow via emissive + bloom
  const ambient = new THREE.AmbientLight(0x303050, 1.0);
  scene.add(ambient);

  // Very soft directional for subtle depth, not specular
  const directional = new THREE.DirectionalLight(0x6666aa, 0.3);
  directional.position.set(0, 30, 0);
  scene.add(directional);

  // Bloom post-processing
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2,  // strength — minimal neon glow
    0.2,  // radius — very tight halo
    0.6,  // threshold — only very bright emissive triggers bloom
  );
  composer.addPass(bloomPass);

  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, composer };
}
