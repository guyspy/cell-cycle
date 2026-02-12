import * as THREE from 'three';

/**
 * Create a procedural radial-gradient canvas texture for nebula sprites.
 */
function makeNebulaTexture(color: THREE.Color, size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);

  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);

  gradient.addColorStop(0, `rgba(${r},${g},${b},0.3)`);
  gradient.addColorStop(0.4, `rgba(${r},${g},${b},0.1)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createSpaceBackground(scene: THREE.Scene): void {
  // --- Starfield ---
  const starCount = 3000;
  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    // Random point in a sphere (reject sampling for uniform distribution)
    let x: number, y: number, z: number;
    do {
      x = (Math.random() - 0.5) * 2;
      y = (Math.random() - 0.5) * 2;
      z = (Math.random() - 0.5) * 2;
    } while (x * x + y * y + z * z > 1);

    const radius = 150 + Math.random() * 50; // spread between 150-200
    positions[i * 3] = x * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = z * radius;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.4,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
  });

  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // --- Nebula clouds ---
  const nebulaConfigs: { color: THREE.Color; position: THREE.Vector3; scale: number }[] = [
    {
      color: new THREE.Color(0x3a0066), // deep purple
      position: new THREE.Vector3(-80, 40, -120),
      scale: 80,
    },
    {
      color: new THREE.Color(0x0d47a1), // deep blue
      position: new THREE.Vector3(90, -30, -100),
      scale: 60,
    },
    {
      color: new THREE.Color(0x00695c), // teal
      position: new THREE.Vector3(30, 60, -140),
      scale: 70,
    },
    {
      color: new THREE.Color(0x1a237e), // indigo
      position: new THREE.Vector3(-50, -50, -90),
      scale: 55,
    },
  ];

  for (const cfg of nebulaConfigs) {
    const tex = makeNebulaTexture(cfg.color);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(cfg.position);
    sprite.scale.set(cfg.scale, cfg.scale, 1);
    scene.add(sprite);
  }
}
