import * as THREE from 'three';

// ============================================================
// BOARD CONFIGURATION
// ============================================================

export const TOTAL_CELLS = 61; // 0 = START, 1-60 = board cells
export const BOARD_RADIUS = 20; // center radius of the ring
export const RING_WIDTH = 3;    // radial width of the ring (outer - inner)
export const RING_THICKNESS = 0.2; // vertical thickness of the flat ring

export interface CellConfig {
  index: number;
  color: string;       // hex color
  zone: 'start' | 'green' | 'yellow' | 'blue' | 'purple';
  isCheckpoint: boolean;
  angle: number;       // center angle in radians
  angleStart: number;  // start of arc (for variable-width cells)
  angleEnd: number;    // end of arc
  position: THREE.Vector3; // 3D world position
}

export const ZONE_COLORS = {
  start:  '#FFFFFF',
  green:  '#4CAF50',
  yellow: '#FFC107',
  blue:   '#2196F3',
  purple: '#9C27B0',
} as const;

export const CHECKPOINT_CELLS = [25, 52, 56] as const;

export function getCellZone(index: number): CellConfig['zone'] {
  if (index === 0) return 'start';
  if (index <= 25) return 'green';
  if (index <= 40) return 'yellow';
  if (index <= 52) return 'blue';
  return 'purple';
}

export function getCellColor(index: number): string {
  return ZONE_COLORS[getCellZone(index)];
}

export function isCheckpoint(index: number): boolean {
  return (CHECKPOINT_CELLS as readonly number[]).includes(index);
}

/** Cell size weight: START=4x, checkpoint=3x, normal=1x */
export function getCellWeight(index: number): number {
  if (index === 0) return 4;
  if (isCheckpoint(index)) return 3;
  return 1;
}

/** Pre-compute all 61 cell configs with variable-width arcs.
 *  Clockwise direction. START is 4x, checkpoints are 3x. */
export function buildCellConfigs(): CellConfig[] {
  // Compute total weight for proportional sizing
  let totalWeight = 0;
  for (let i = 0; i < TOTAL_CELLS; i++) totalWeight += getCellWeight(i);

  const cells: CellConfig[] = [];
  let cumWeight = 0;

  for (let i = 0; i < TOTAL_CELLS; i++) {
    const w = getCellWeight(i);
    const startFrac = cumWeight / totalWeight;
    const endFrac = (cumWeight + w) / totalWeight;
    const centerFrac = (cumWeight + w / 2) / totalWeight;

    // Clockwise: reverse direction
    const angleStart = (1 - endFrac) * Math.PI * 2;
    const angleEnd = (1 - startFrac) * Math.PI * 2;
    const angle = (1 - centerFrac) * Math.PI * 2;

    const x = Math.sin(angle) * BOARD_RADIUS;
    const y = RING_THICKNESS;
    const z = Math.cos(angle) * BOARD_RADIUS;

    cells.push({
      index: i,
      color: getCellColor(i),
      zone: getCellZone(i),
      isCheckpoint: isCheckpoint(i),
      angle,
      angleStart,
      angleEnd,
      position: new THREE.Vector3(x, y, z),
    });

    cumWeight += w;
  }
  return cells;
}

// ============================================================
// GAME STATE
// ============================================================

export interface Piece {
  id: number;         // 0, 1, 2
  cellIndex: number;  // current cell (0 = START)
  isAtCheckpoint: boolean;
}

export interface Player {
  id: number;
  name: string;
  color: string;      // player's piece tint color
  pieces: Piece[];
}

export interface GameState {
  players: Player[];
  currentPlayerIndex: number;
  diceValue: number | null;      // null = not rolled yet this turn
  phase: 'rolling' | 'selecting' | 'moving' | 'turnEnd';
  selectedPieceId: number | null;
}

export const PLAYER_COLORS = ['#FF6B9D', '#00E5FF', '#FFEA00', '#76FF03'];

// ============================================================
// EVENTS (simple pub/sub for decoupling modules)
// ============================================================

export type GameEvent =
  | { type: 'diceRolled'; value: number }
  | { type: 'pieceSelected'; playerId: number; pieceId: number }
  | { type: 'pieceMoving'; playerId: number; pieceId: number; from: number; to: number }
  | { type: 'pieceLanded'; playerId: number; pieceId: number; cellIndex: number }
  | { type: 'turnEnd' }
  | { type: 'phaseChanged'; phase: GameState['phase'] };

type EventHandler = (event: GameEvent) => void;

class EventBusClass {
  private handlers: EventHandler[] = [];
  on(handler: EventHandler) { this.handlers.push(handler); }
  off(handler: EventHandler) { this.handlers = this.handlers.filter(h => h !== handler); }
  emit(event: GameEvent) { this.handlers.forEach(h => h(event)); }
}

export const EventBus = new EventBusClass();
