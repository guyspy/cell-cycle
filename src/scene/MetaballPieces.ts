/**
 * MetaballPieces — renders game pieces as ray-marched metaballs with
 * spring-based animation.  Drop-in replacement for CellPieces.
 */
import * as THREE from 'three';
import type { GameState, CellConfig } from '../types';
import { PLAYER_COLORS } from '../types';
import type { PiecesManager } from './CellPieces';
import { metaballVertexShader, metaballFragmentShader } from '../shaders/metaballShader';
import { createSpringSystem } from '../animation/SpringSystem';

const MAX_PIECES = 8;

// Per-piece offsets (same as original CellPieces)
const PIECE_OFFSETS: THREE.Vector3[] = [
  new THREE.Vector3(0, 0, -0.3),
  new THREE.Vector3(-0.3, 0, 0.2),
  new THREE.Vector3(0.3, 0, 0.2),
];

function getPieceWorldPos(cells: CellConfig[], cellIndex: number, pieceId: number): THREE.Vector3 {
  const cellPos = cells[cellIndex].position;
  const offset = PIECE_OFFSETS[pieceId];
  return new THREE.Vector3(
    cellPos.x + offset.x,
    cellPos.y + 0.5 + offset.y,
    cellPos.z + offset.z,
  );
}

/** Convert hex color string to normalised vec3 */
function hexToVec3(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

export function createMetaballPieces(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  state: GameState,
  cells: CellConfig[],
): PiecesManager {
  // ── Spring system ────────────────────────────────────────────
  const springs = createSpringSystem();

  // Track piece metadata for uniform packing
  interface PieceMeta { playerId: number; pieceId: number; color: THREE.Vector3 }
  const pieceMetas: PieceMeta[] = [];

  // Register every piece
  for (let pIdx = 0; pIdx < state.players.length; pIdx++) {
    const player = state.players[pIdx];
    const color = hexToVec3(PLAYER_COLORS[pIdx] ?? player.color);

    for (let pieceId = 0; pieceId < player.pieces.length; pieceId++) {
      const pos = getPieceWorldPos(cells, 0, pieceId);
      springs.addPiece(pIdx, pieceId, pos);
      pieceMetas.push({ playerId: pIdx, pieceId, color });
    }
  }

  // ── Shader material ──────────────────────────────────────────
  const uniforms = {
    uPiecePositions: { value: new Array(MAX_PIECES).fill(null).map(() => new THREE.Vector3()) },
    uPieceScales:    { value: new Array(MAX_PIECES).fill(null).map(() => new THREE.Vector3(1, 0.7, 1)) },
    uPieceColors:    { value: new Array(MAX_PIECES).fill(null).map(() => new THREE.Vector3()) },
    uPieceCount:          { value: 0 },
    uInvProjectionMatrix: { value: new THREE.Matrix4() },
    uInvViewMatrix:       { value: new THREE.Matrix4() },
    uCameraPosition:      { value: new THREE.Vector3() },
    uResolution:          { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: metaballVertexShader,
    fragmentShader: metaballFragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  // Full-screen quad (NDC -1..1)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quad.renderOrder = 999;
  scene.add(quad);

  // Handle resize
  window.addEventListener('resize', () => {
    uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();

  // ── PiecesManager interface ──────────────────────────────────

  const manager: PiecesManager = {
    async animateMove(playerId, pieceId, fromCell, toCell) {
      const totalCells = cells.length;
      const targets: THREE.Vector3[] = [];

      let current = fromCell;
      while (current !== toCell) {
        const next = (current + 1) % totalCells;
        targets.push(getPieceWorldPos(cells, next, pieceId));
        current = next;
      }

      await springs.animateHop(playerId, pieceId, targets);
    },

    updatePositions(gameState) {
      for (let pIdx = 0; pIdx < gameState.players.length; pIdx++) {
        const player = gameState.players[pIdx];
        for (let pieceId = 0; pieceId < player.pieces.length; pieceId++) {
          const cellIndex = player.pieces[pieceId].cellIndex;
          const pos = getPieceWorldPos(cells, cellIndex, pieceId);
          springs.setPosition(pIdx, pieceId, pos);
        }
      }
    },

    update() {
      const dt = clock.getDelta();

      // Advance springs
      const springStates = springs.update(dt);

      // Pack uniforms
      let i = 0;
      for (const meta of pieceMetas) {
        if (i >= MAX_PIECES) break;
        const key = `${meta.playerId}-${meta.pieceId}`;
        const s = springStates.get(key);
        if (!s) continue;

        uniforms.uPiecePositions.value[i].copy(s.position);
        uniforms.uPieceScales.value[i].copy(s.scale);
        uniforms.uPieceColors.value[i].copy(meta.color);
        i++;
      }
      uniforms.uPieceCount.value = i;

      // Camera uniforms
      camera.updateMatrixWorld();
      uniforms.uInvProjectionMatrix.value.copy(camera.projectionMatrixInverse);
      uniforms.uInvViewMatrix.value.copy(camera.matrixWorld);
      uniforms.uCameraPosition.value.copy(camera.position);
    },
  };

  return manager;
}
