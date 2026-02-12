/**
 * CellPieces - 3D slime/cell piece models and movement animation.
 */
import * as THREE from 'three';
import gsap from 'gsap';
import type { GameState, CellConfig } from '../types';
import { PLAYER_COLORS } from '../types';

// Per-piece offsets so pieces on the same cell don't overlap
const PIECE_OFFSETS: THREE.Vector3[] = [
  new THREE.Vector3(0, 0, -0.3),
  new THREE.Vector3(-0.3, 0, 0.2),
  new THREE.Vector3(0.3, 0, 0.2),
];

export interface PiecesManager {
  animateMove(playerId: number, pieceId: number, fromCell: number, toCell: number): Promise<void>;
  updatePositions(state: GameState): void;
  update(): void;
}

/** Create a single slime/cell piece mesh with eyes */
function createPieceMesh(color: string): THREE.Group {
  const group = new THREE.Group();

  // Body: squashed sphere (bun/mantou shape)
  const bodyGeo = new THREE.SphereGeometry(0.5, 32, 32);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.2,
    roughness: 0.2,
    metalness: 0.0,
    transparent: true,
    opacity: 0.85,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, 0.7, 1);
  group.add(body);

  // Eyes: two small dark spheres on the front face
  const eyeGeo = new THREE.SphereGeometry(0.08, 16, 16);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#1a1a2e', roughness: 0.3 });

  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.15, 0.08, 0.4);
  group.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.15, 0.08, 0.4);
  group.add(rightEye);

  return group;
}

export function createCellPieces(
  scene: THREE.Scene,
  state: GameState,
  cells: CellConfig[],
): PiecesManager {
  // pieces[playerId][pieceId] = Group (mesh)
  const pieces: THREE.Group[][] = [];
  // Track base Y positions for idle animation
  const basePositions: THREE.Vector3[][] = [];
  const clock = new THREE.Clock();
  const movingPieces = new Set<string>();

  // Create meshes for each player's pieces
  for (let pIdx = 0; pIdx < state.players.length; pIdx++) {
    const player = state.players[pIdx];
    pieces[pIdx] = [];
    basePositions[pIdx] = [];

    for (let pieceId = 0; pieceId < player.pieces.length; pieceId++) {
      const mesh = createPieceMesh(PLAYER_COLORS[pIdx] ?? player.color);
      scene.add(mesh);
      pieces[pIdx][pieceId] = mesh;

      // Initial position at cell 0 (START) with per-piece offset
      const cellPos = cells[0].position;
      const offset = PIECE_OFFSETS[pieceId];
      const pos = new THREE.Vector3(
        cellPos.x + offset.x,
        cellPos.y + 0.5 + offset.y,
        cellPos.z + offset.z,
      );
      mesh.position.copy(pos);
      basePositions[pIdx][pieceId] = pos.clone();
    }
  }

  /** Compute the world position for a piece on a given cell */
  function getPieceWorldPos(cellIndex: number, pieceId: number): THREE.Vector3 {
    const cellPos = cells[cellIndex].position;
    const offset = PIECE_OFFSETS[pieceId];
    return new THREE.Vector3(
      cellPos.x + offset.x,
      cellPos.y + 0.5 + offset.y,
      cellPos.z + offset.z,
    );
  }

  const manager: PiecesManager = {
    async animateMove(playerId, pieceId, fromCell, toCell) {
      const mesh = pieces[playerId]?.[pieceId];
      if (!mesh) return;

      const key = `${playerId}-${pieceId}`;
      movingPieces.add(key);

      const tl = gsap.timeline();
      const totalCells = cells.length;

      // Determine the step direction (always forward on the ring)
      let current = fromCell;
      while (current !== toCell) {
        const next = (current + 1) % totalCells;
        const target = getPieceWorldPos(next, pieceId);
        const hopDur = 0.35;
        const t0 = tl.duration();

        // ── Anticipation squash (crouch before jump) ──
        tl.to(mesh.scale, {
          y: 0.45, x: 1.3, z: 1.3,
          duration: 0.12,
          ease: 'power2.in',
        }, t0);
        tl.to(mesh.position, {
          y: target.y - 0.1,
          duration: 0.12,
          ease: 'power2.in',
        }, t0);

        // ── Stretch upward on takeoff ──
        tl.to(mesh.scale, {
          y: 1.1, x: 0.8, z: 0.8,
          duration: 0.1,
          ease: 'power3.out',
        }, t0 + 0.12);

        // ── Horizontal movement ──
        tl.to(mesh.position, {
          x: target.x, z: target.z,
          duration: hopDur,
          ease: 'power1.inOut',
        }, t0 + 0.12);

        // ── Y arc: hop up then fall ──
        tl.to(mesh.position, {
          y: target.y + 1.5,
          duration: hopDur * 0.4,
          ease: 'power2.out',
        }, t0 + 0.12);
        tl.to(mesh.position, {
          y: target.y,
          duration: hopDur * 0.6,
          ease: 'bounce.out',
        }, t0 + 0.12 + hopDur * 0.4);

        // ── Mid-air: round up with subtle tilt ──
        tl.to(mesh.scale, {
          y: 0.7, x: 1.0, z: 1.0,
          duration: 0.08,
          ease: 'sine.inOut',
        }, t0 + 0.22);
        tl.to(mesh.rotation, {
          z: mesh.rotation.z + Math.PI * 0.05,
          duration: hopDur * 0.4,
          ease: 'sine.inOut',
        }, t0 + 0.12);
        tl.to(mesh.rotation, {
          z: 0,
          duration: 0.12,
          ease: 'power2.out',
        }, t0 + 0.12 + hopDur * 0.4);

        // ── Landing squash ──
        const landTime = t0 + 0.12 + hopDur;
        tl.to(mesh.scale, {
          y: 0.4, x: 1.4, z: 1.4,
          duration: 0.06,
          ease: 'power3.in',
        }, landTime);

        // ── Bounce recovery ──
        tl.to(mesh.scale, {
          y: 0.9, x: 0.85, z: 0.85,
          duration: 0.1,
          ease: 'power2.out',
        }, landTime + 0.06);
        tl.to(mesh.scale, {
          y: 0.65, x: 1.05, z: 1.05,
          duration: 0.08,
          ease: 'power1.in',
        }, landTime + 0.16);
        tl.to(mesh.scale, {
          y: 0.7, x: 1.0, z: 1.0,
          duration: 0.15,
          ease: 'elastic.out(1, 0.4)',
        }, landTime + 0.24);

        current = next;
      }

      // Update base position after move
      const finalPos = getPieceWorldPos(toCell, pieceId);
      basePositions[playerId][pieceId] = finalPos.clone();

      return new Promise<void>((resolve) => {
        tl.eventCallback('onComplete', () => {
          movingPieces.delete(key);
          resolve();
        });
      });
    },

    updatePositions(state) {
      for (let pIdx = 0; pIdx < state.players.length; pIdx++) {
        const player = state.players[pIdx];
        if (!pieces[pIdx]) continue;

        for (let pieceId = 0; pieceId < player.pieces.length; pieceId++) {
          const mesh = pieces[pIdx][pieceId];
          if (!mesh) continue;

          const cellIndex = player.pieces[pieceId].cellIndex;
          const pos = getPieceWorldPos(cellIndex, pieceId);

          mesh.position.copy(pos);
          basePositions[pIdx][pieceId] = pos.clone();
        }
      }
    },

    update() {
      const time = clock.getElapsedTime();

      for (let pIdx = 0; pIdx < pieces.length; pIdx++) {
        for (let pieceId = 0; pieceId < pieces[pIdx].length; pieceId++) {
          const mesh = pieces[pIdx][pieceId];
          const base = basePositions[pIdx][pieceId];
          if (!mesh || !base) continue;

          // Skip idle animation for pieces currently in a GSAP move
          const key = `${pIdx}-${pieceId}`;
          if (movingPieces.has(key)) continue;

          // Gentle sine-wave idle bounce with per-piece phase offset
          const phase = pieceId + pIdx * 3;
          mesh.position.y = base.y + Math.sin(time * 2 + phase) * 0.08;
          mesh.scale.y = 0.7 + Math.sin(time * 3 + phase) * 0.03;
          mesh.scale.x = 1.0 - Math.sin(time * 3 + phase) * 0.02;
          mesh.scale.z = 1.0 - Math.sin(time * 3 + phase) * 0.02;
        }
      }
    },
  };

  return manager;
}
