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

// Spread radius — distance from cell center for clustered pieces.
const CLUSTER_SPREAD = 0.5;

// ---------------------------------------------------------------------------
// Cluster offset computation
// ---------------------------------------------------------------------------

/** Compute offsets for `count` pieces centered on a cell.
 *  Returns an array of (x, 0, z) offsets. */
function computeClusterOffsets(count: number): THREE.Vector3[] {
  if (count <= 1) return [new THREE.Vector3(0, 0, 0)];

  if (count === 2) {
    return [
      new THREE.Vector3(-CLUSTER_SPREAD * 0.5, 0, 0),
      new THREE.Vector3(CLUSTER_SPREAD * 0.5, 0, 0),
    ];
  }

  if (count === 3) {
    // Equilateral triangle centered at origin
    const r = CLUSTER_SPREAD;
    return [
      new THREE.Vector3(0, 0, -r),
      new THREE.Vector3(-r * Math.sin(Math.PI / 3), 0, r * 0.5),
      new THREE.Vector3(r * Math.sin(Math.PI / 3), 0, r * 0.5),
    ];
  }

  // 4+ pieces: evenly spaced ring
  const offsets: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    offsets.push(
      new THREE.Vector3(
        Math.sin(angle) * CLUSTER_SPREAD,
        0,
        Math.cos(angle) * CLUSTER_SPREAD,
      ),
    );
  }
  return offsets;
}

/** Get the base world position for a piece at a cell center (no cluster offset). */
function getCellBasePos(cells: CellConfig[], cellIndex: number): THREE.Vector3 {
  const cellPos = cells[cellIndex].position;
  return new THREE.Vector3(cellPos.x, cellPos.y + 0.5, cellPos.z);
}

/** Get piece world position with a specific cluster offset applied. */
function getCellPosWithOffset(cells: CellConfig[], cellIndex: number, offset: THREE.Vector3): THREE.Vector3 {
  const base = getCellBasePos(cells, cellIndex);
  return base.add(offset);
}

/** Convert hex color string to normalised vec3 */
function hexToVec3(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

// ---------------------------------------------------------------------------
// Cell occupancy helpers
// ---------------------------------------------------------------------------

interface OccupantInfo {
  playerId: number;
  pieceId: number;
}

/** Build a map from cellIndex -> list of pieces on that cell. */
function buildCellOccupancy(gameState: GameState): Map<number, OccupantInfo[]> {
  const map = new Map<number, OccupantInfo[]>();
  for (let pIdx = 0; pIdx < gameState.players.length; pIdx++) {
    const player = gameState.players[pIdx];
    for (const piece of player.pieces) {
      let list = map.get(piece.cellIndex);
      if (!list) {
        list = [];
        map.set(piece.cellIndex, list);
      }
      list.push({ playerId: pIdx, pieceId: piece.id });
    }
  }
  return map;
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

  // Register every piece — initially all at cell 0, use cluster offsets
  const initialOccupancy = buildCellOccupancy(state);
  for (let pIdx = 0; pIdx < state.players.length; pIdx++) {
    const player = state.players[pIdx];
    const color = hexToVec3(PLAYER_COLORS[pIdx] ?? player.color);

    for (let pieceId = 0; pieceId < player.pieces.length; pieceId++) {
      const cellIndex = player.pieces[pieceId].cellIndex;
      const occupants = initialOccupancy.get(cellIndex) ?? [];
      const offsets = computeClusterOffsets(occupants.length);
      // Find this piece's index within the occupant list
      const myIndex = occupants.findIndex(o => o.playerId === pIdx && o.pieceId === pieceId);
      const offset = offsets[myIndex >= 0 ? myIndex : 0];
      const pos = getCellPosWithOffset(cells, cellIndex, offset);

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

      // During the hop, the moving piece targets cell centers (no cluster offset)
      let current = fromCell;
      while (current !== toCell) {
        const next = (current + 1) % totalCells;
        targets.push(getCellBasePos(cells, next));
        current = next;
      }

      await springs.animateHop(playerId, pieceId, targets);

      // After the hop completes, recluster source and destination cells.
      // latestState is updated by the engine before pieceLanded fires,
      // but we can also recluster based on the state we'll get in updatePositions.
    },

    updatePositions(gameState) {
      const occupancy = buildCellOccupancy(gameState);

      for (let pIdx = 0; pIdx < gameState.players.length; pIdx++) {
        const player = gameState.players[pIdx];
        for (const piece of player.pieces) {
          const occupants = occupancy.get(piece.cellIndex) ?? [];
          const offsets = computeClusterOffsets(occupants.length);
          const myIndex = occupants.findIndex(o => o.playerId === pIdx && o.pieceId === piece.id);
          const offset = offsets[myIndex >= 0 ? myIndex : 0];
          const pos = getCellPosWithOffset(cells, piece.cellIndex, offset);
          springs.animateTo(pIdx, piece.id, pos);
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
