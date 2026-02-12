import {
  GameState,
  Player,
  Piece,
  EventBus,
  PLAYER_COLORS,
  CHECKPOINT_CELLS,
  isCheckpoint,
  TOTAL_CELLS,
} from '../types';

export class GameEngine {
  private state: GameState;

  constructor(numPlayers: number = 2) {
    const players: Player[] = [];
    const count = Math.min(numPlayers, PLAYER_COLORS.length);

    for (let i = 0; i < count; i++) {
      const pieces: Piece[] = [];
      for (let p = 0; p < 3; p++) {
        pieces.push({ id: p, cellIndex: 0, isAtCheckpoint: false });
      }
      players.push({
        id: i,
        name: `Player ${i + 1}`,
        color: PLAYER_COLORS[i],
        pieces,
      });
    }

    this.state = {
      players,
      currentPlayerIndex: 0,
      diceValue: null,
      phase: 'rolling',
      selectedPieceId: null,
    };
  }

  getState(): GameState {
    return this.state;
  }

  getCurrentPlayer(): Player {
    return this.state.players[this.state.currentPlayerIndex];
  }

  rollDice(): number {
    const value = Math.floor(Math.random() * 6) + 1;
    this.state.diceValue = value;
    this.state.phase = 'selecting';

    EventBus.emit({ type: 'diceRolled', value });

    // Check if any of the current player's pieces can actually move
    const player = this.getCurrentPlayer();
    const hasMovablePiece = player.pieces.some((p) => !p.isAtCheckpoint);

    if (!hasMovablePiece) {
      // All pieces are stuck at checkpoints — skip this turn
      EventBus.emit({ type: 'phaseChanged', phase: 'selecting' });
      this.nextTurn();
      return value;
    }

    EventBus.emit({ type: 'phaseChanged', phase: 'selecting' });
    return value;
  }

  /**
   * Calculate where a piece will actually land after rolling `steps` from `startCell`.
   * If the path crosses a checkpoint the piece hasn't already reached, it stops there.
   * The piece also cannot exceed cell 60.
   */
  private calculateTarget(startCell: number, steps: number): number {
    let current = startCell;

    for (let i = 0; i < steps; i++) {
      const next = current + 1;

      // Don't go past the last cell
      if (next >= TOTAL_CELLS) {
        return TOTAL_CELLS - 1; // stay at 60
      }

      current = next;

      // If this cell is a checkpoint and the piece wasn't already on or past it,
      // the piece must stop here.
      if (isCheckpoint(current) && startCell < current) {
        return current;
      }
    }

    return current;
  }

  selectPiece(pieceId: number): void {
    const player = this.getCurrentPlayer();
    const piece = player.pieces.find((p) => p.id === pieceId);

    if (!piece) return;
    if (piece.isAtCheckpoint) return; // can't move a piece stuck at a checkpoint
    if (this.state.diceValue === null) return;
    if (this.state.phase !== 'selecting') return;

    const from = piece.cellIndex;
    const to = this.calculateTarget(from, this.state.diceValue);

    // If the piece can't actually move anywhere, ignore
    if (to === from) return;

    this.state.selectedPieceId = pieceId;
    this.state.phase = 'moving';

    EventBus.emit({ type: 'pieceSelected', playerId: player.id, pieceId });
    EventBus.emit({ type: 'pieceMoving', playerId: player.id, pieceId, from, to });
  }

  onMoveComplete(): void {
    const player = this.getCurrentPlayer();
    const piece = player.pieces.find(
      (p) => p.id === this.state.selectedPieceId,
    );

    if (!piece || this.state.diceValue === null) return;

    const target = this.calculateTarget(piece.cellIndex, this.state.diceValue);
    piece.cellIndex = target;
    piece.isAtCheckpoint = isCheckpoint(target);

    EventBus.emit({
      type: 'pieceLanded',
      playerId: player.id,
      pieceId: piece.id,
      cellIndex: target,
    });

    // Set phase to turnEnd so UI can show transition overlay.
    // UI will call nextTurn() after the transition animation.
    this.state.phase = 'turnEnd';
    EventBus.emit({ type: 'phaseChanged', phase: 'turnEnd' });
  }

  nextTurn(): void {
    this.state.currentPlayerIndex =
      (this.state.currentPlayerIndex + 1) % this.state.players.length;
    this.state.diceValue = null;
    this.state.selectedPieceId = null;
    this.state.phase = 'rolling';

    EventBus.emit({ type: 'turnEnd' });
    EventBus.emit({ type: 'phaseChanged', phase: 'rolling' });
  }
}
