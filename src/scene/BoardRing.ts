import * as THREE from 'three';
import gsap from 'gsap';
import { CellConfig, BOARD_RADIUS, RING_WIDTH, RING_THICKNESS } from '../types';

const INNER_R = BOARD_RADIUS - RING_WIDTH / 2;
const OUTER_R = BOARD_RADIUS + RING_WIDTH / 2;
const GAP = 0.008; // fixed gap in radians between cells

export interface BoardManager {
  group: THREE.Group;
  pressCell(cellIndex: number): void;
}

/**
 * Create extruded geometry for one flat ring sector (annular wedge).
 */
function createRingSector(
  startAngle: number,
  endAngle: number,
  innerR: number = INNER_R,
  outerR: number = OUTER_R,
  thickness: number = RING_THICKNESS,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();

  shape.moveTo(Math.cos(startAngle) * outerR, Math.sin(startAngle) * outerR);
  shape.absarc(0, 0, outerR, startAngle, endAngle, false);
  shape.lineTo(Math.cos(endAngle) * innerR, Math.sin(endAngle) * innerR);
  shape.absarc(0, 0, innerR, endAngle, startAngle, true);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
  });

  geo.rotateX(-Math.PI / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function makeTextSprite(text: string, color: string, size = 1.2, bubble = false): THREE.Sprite {
  const res = 512;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;

  if (bubble) {
    // Cute bubble font with rounded outline
    const fontSize = 80;
    ctx.font = `600 ${fontSize}px "Fredoka", "Bubblegum Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Outer glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;

    // Stroke outline
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeText(text, res / 2, res / 2);

    // Fill
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText(text, res / 2, res / 2);

    // Inner highlight for bubble feel
    ctx.globalCompositeOperation = 'source-atop';
    const grad = ctx.createLinearGradient(0, res / 2 - fontSize / 2, 0, res / 2 + fontSize / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = grad;
    ctx.fillText(text, res / 2, res / 2);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.fillStyle = color;
    ctx.font = `bold ${text.length > 2 ? 48 : 64}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, res / 2, res / 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** Create a bouncing indicator with START text + downward arrow */
function makeStartIndicator(): THREE.Sprite {
  const res = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;
  const cx = res / 2;

  // "START" bubble text at the top
  ctx.font = '600 180px "Fredoka", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Outline
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeText('START', cx, 280);

  // Fill — use off-white so bloom doesn't blow it out
  ctx.fillStyle = '#b0b0b0';
  ctx.fillText('START', cx, 280);

  // Bubble highlight gradient
  ctx.globalCompositeOperation = 'source-atop';
  const grad = ctx.createLinearGradient(0, 180, 0, 380);
  grad.addColorStop(0, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  grad.addColorStop(1, 'rgba(200,200,255,0.2)');
  ctx.fillStyle = grad;
  ctx.fillText('START', cx, 280);
  ctx.globalCompositeOperation = 'source-over';

  // Downward-pointing triangle below text
  ctx.beginPath();
  ctx.moveTo(cx - 50, 560);
  ctx.lineTo(cx + 50, 560);
  ctx.lineTo(cx, 680);
  ctx.closePath();

  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#b0b0b0';
  ctx.fill();

  // Small dot under the arrow tip
  ctx.beginPath();
  ctx.arc(cx, 730, 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(176,176,176,0.6)';
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(12, 12, 1);
  return sprite;
}

export function createBoardRing(scene: THREE.Scene, cells: CellConfig[]): BoardManager {
  const group = new THREE.Group();
  const cellMeshes = new Map<number, THREE.Mesh>();

  for (const cell of cells) {
    const isStart = cell.index === 0;
    const isCp = cell.isCheckpoint;
    const cellColor = new THREE.Color(cell.color);

    // Use pre-computed variable-width angles from CellConfig
    const thetaStart = cell.angleStart + GAP;
    const thetaEnd = cell.angleEnd - GAP;

    // ── Main cell surface (neon tile) ──
    // Normalize emissive so all colors glow at the same perceived brightness
    const maxCh = Math.max(cellColor.r, cellColor.g, cellColor.b, 0.2);
    const baseTarget = isStart ? 0.12 : isCp ? 0.3 : 0.25;
    const geo = createRingSector(thetaStart, thetaEnd);
    const mat = new THREE.MeshStandardMaterial({
      color: cellColor,
      emissive: cellColor,
      emissiveIntensity: baseTarget / maxCh,
      metalness: 0.0,
      roughness: 1.0,
      transparent: true,
      opacity: isStart ? 0.85 : 0.65,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { cellIndex: cell.index };
    group.add(mesh);
    cellMeshes.set(cell.index, mesh);

    // ── Neon glow halo (larger, dimmer layer underneath for bloom to pick up) ──
    const glowPad = 0.012; // angular padding beyond cell edges
    const glowGeo = createRingSector(
      thetaStart - glowPad,
      thetaEnd + glowPad,
      INNER_R - 0.4,
      OUTER_R + 0.4,
      RING_THICKNESS * 0.3,
    );
    const glowMat = new THREE.MeshStandardMaterial({
      color: cellColor,
      emissive: cellColor,
      emissiveIntensity: (isStart ? 0.2 : isCp ? 0.5 : 0.4) / maxCh,
      metalness: 0.0,
      roughness: 1.0,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.position.y = -0.05;
    group.add(glowMesh);

    // ── Checkpoint: bright border strips ──
    if (isCp) {
      const stripMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: cellColor,
        emissiveIntensity: 0.6 / maxCh,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      });
      const sw = 0.006;
      group.add(new THREE.Mesh(
        createRingSector(thetaStart - sw, thetaStart, INNER_R - 0.15, OUTER_R + 0.15, RING_THICKNESS + 0.05),
        stripMat,
      ));
      group.add(new THREE.Mesh(
        createRingSector(thetaEnd, thetaEnd + sw, INNER_R - 0.15, OUTER_R + 0.15, RING_THICKNESS + 0.05),
        stripMat,
      ));
    }

    // ── START: extra bright overlay ──
    if (isStart) {
      const startGlow = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
      });
      group.add(new THREE.Mesh(
        createRingSector(thetaStart, thetaEnd, INNER_R + 0.3, OUTER_R - 0.3, RING_THICKNESS + 0.08),
        startGlow,
      ));
    }

    // ── Cell number label ──
    if (isStart) {
      const label = makeTextSprite('START', '#b0b0b0', 8, true);
      label.position.copy(cell.position);
      label.position.y += 5;
      group.add(label);

      gsap.to(label.position, {
        y: label.position.y + 1.2,
        duration: 0.8,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
    } else {
      const labelSize = isCp ? 7.5 : 5.0;
      const label = makeTextSprite(String(cell.index), cell.color, labelSize);
      label.position.copy(cell.position);
      label.position.y += 1.0;
      group.add(label);
    }
  }

  // Slight tilt
  group.rotation.x = THREE.MathUtils.degToRad(5);

  scene.add(group);

  return {
    group,
    pressCell(cellIndex: number) {
      const mesh = cellMeshes.get(cellIndex);
      if (!mesh) return;
      gsap.killTweensOf(mesh.position);
      gsap.to(mesh.position, {
        y: -0.25,
        duration: 0.12,
        ease: 'power2.in',
        onComplete: () => {
          gsap.to(mesh.position, {
            y: 0,
            duration: 0.5,
            ease: 'elastic.out(1, 0.3)',
          });
        },
      });
    },
  };
}
