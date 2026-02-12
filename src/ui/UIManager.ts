import { GameEngine } from '../game/GameEngine';
import { CameraController } from '../camera/CameraController';
import type { GameState } from '../types';

const GLASS_BG = 'rgba(10, 10, 30, 0.7)';
const GLASS_BORDER = '1px solid rgba(255, 255, 255, 0.1)';
const RADIUS = '12px';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export class UIManager {
  private root: HTMLDivElement;
  private engine: GameEngine;
  private cameraCtrl: CameraController;

  // DOM containers
  private playerBar!: HTMLDivElement;
  private diceArea!: HTMLDivElement;
  private pieceSelectorArea!: HTMLDivElement;
  private transitionOverlay!: HTMLDivElement;
  private diceResultDisplay!: HTMLDivElement;

  private turnTransitionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    root: HTMLDivElement,
    engine: GameEngine,
    cameraCtrl: CameraController,
  ) {
    this.root = root;
    this.engine = engine;
    this.cameraCtrl = cameraCtrl;

    this.injectStyles();
    this.buildDOM();
  }

  update(): void {
    const state = this.engine.getState();
    this.renderPlayerBar(state);
    this.renderDiceArea(state);
    this.renderPieceSelector(state);
    this.handleTurnTransition(state);
  }

  // ── Styles ──────────────────────────────────────────────────

  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      .cc-ui {
        position: absolute;
        inset: 0;
        pointer-events: none;
        font-family: ${FONT};
        color: #fff;
        z-index: 10;
      }
      .cc-ui * {
        box-sizing: border-box;
      }
      .cc-glass {
        background: ${GLASS_BG};
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: ${GLASS_BORDER};
        border-radius: ${RADIUS};
      }
      .cc-player-bar {
        position: absolute;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        pointer-events: auto;
        min-width: 280px;
        text-align: center;
        transition: all 0.3s ease;
      }
      .cc-player-bar__name {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .cc-player-bar__dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
      }
      .cc-player-bar__pieces {
        display: flex;
        gap: 12px;
        justify-content: center;
        font-size: 13px;
        opacity: 0.85;
      }
      .cc-dice-area {
        position: absolute;
        bottom: 32px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        pointer-events: auto;
        transition: all 0.3s ease;
      }
      .cc-dice-btn {
        padding: 14px 36px;
        font-size: 20px;
        font-weight: 700;
        border: none;
        border-radius: ${RADIUS};
        cursor: pointer;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #fff;
        font-family: ${FONT};
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        pointer-events: auto;
      }
      .cc-dice-btn:hover {
        transform: scale(1.06);
        box-shadow: 0 0 20px rgba(139, 92, 246, 0.5);
      }
      .cc-dice-btn:active {
        transform: scale(0.97);
      }
      .cc-dice-result {
        font-size: 56px;
        font-weight: 800;
        opacity: 0;
        transform: scale(0.3);
        transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        text-shadow: 0 0 30px rgba(255,255,255,0.4);
      }
      .cc-dice-result.cc-visible {
        opacity: 1;
        transform: scale(1);
      }
      .cc-piece-selector {
        position: absolute;
        bottom: 32px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 12px;
        pointer-events: auto;
        transition: all 0.3s ease;
      }
      .cc-piece-card {
        padding: 12px 20px;
        border-radius: ${RADIUS};
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        text-align: center;
        transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.3s ease;
        pointer-events: auto;
        min-width: 100px;
      }
      .cc-piece-card:not(.cc-stuck):hover {
        transform: translateY(-4px);
        box-shadow: 0 6px 20px rgba(255,255,255,0.15);
      }
      .cc-piece-card.cc-stuck {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .cc-transition-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        font-weight: 700;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.5s ease;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
      }
      .cc-transition-overlay.cc-visible {
        opacity: 1;
      }
      .cc-transition-inner {
        padding: 24px 48px;
      }
      .cc-hidden {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  // ── DOM Construction ────────────────────────────────────────

  private buildDOM(): void {
    this.root.className = 'cc-ui';

    // Player info bar
    this.playerBar = document.createElement('div');
    this.playerBar.className = 'cc-player-bar cc-glass';
    this.root.appendChild(this.playerBar);

    // Dice area (button + result)
    this.diceArea = document.createElement('div');
    this.diceArea.className = 'cc-dice-area';
    this.root.appendChild(this.diceArea);

    this.diceResultDisplay = document.createElement('div');
    this.diceResultDisplay.className = 'cc-dice-result';
    this.diceArea.appendChild(this.diceResultDisplay);

    const diceBtn = document.createElement('button');
    diceBtn.className = 'cc-dice-btn';
    diceBtn.textContent = 'Roll Dice';
    diceBtn.addEventListener('click', () => {
      this.engine.rollDice();
    });
    this.diceArea.appendChild(diceBtn);

    // Piece selector
    this.pieceSelectorArea = document.createElement('div');
    this.pieceSelectorArea.className = 'cc-piece-selector cc-hidden';
    this.root.appendChild(this.pieceSelectorArea);

    // Turn transition overlay
    this.transitionOverlay = document.createElement('div');
    this.transitionOverlay.className = 'cc-transition-overlay';
    const inner = document.createElement('div');
    inner.className = 'cc-transition-inner cc-glass';
    this.transitionOverlay.appendChild(inner);
    this.root.appendChild(this.transitionOverlay);
  }

  // ── Player Bar ──────────────────────────────────────────────

  private renderPlayerBar(state: GameState): void {
    const player = state.players[state.currentPlayerIndex];

    const piecesHTML = player.pieces
      .map((p) => {
        const icon = p.isAtCheckpoint ? '\u{1F512}' : '\u{25CF}';
        return `<span>${icon} ${p.cellIndex}</span>`;
      })
      .join('');

    this.playerBar.innerHTML = `
      <div class="cc-player-bar__name">
        <span class="cc-player-bar__dot" style="background:${player.color}"></span>
        ${player.name}'s Turn
      </div>
      <div class="cc-player-bar__pieces">${piecesHTML}</div>
    `;
  }

  // ── Dice ────────────────────────────────────────────────────

  private renderDiceArea(state: GameState): void {
    const diceBtn = this.diceArea.querySelector('.cc-dice-btn') as HTMLButtonElement;

    if (state.phase === 'rolling') {
      this.diceArea.classList.remove('cc-hidden');
      diceBtn.classList.remove('cc-hidden');
      this.diceResultDisplay.classList.remove('cc-visible');
      this.diceResultDisplay.textContent = '';
    } else if (state.phase === 'selecting' && state.diceValue !== null) {
      // Show dice result with animation, hide button
      diceBtn.classList.add('cc-hidden');
      this.diceResultDisplay.textContent = String(state.diceValue);
      // Trigger reflow so transition fires
      void this.diceResultDisplay.offsetWidth;
      this.diceResultDisplay.classList.add('cc-visible');

      // Hide the dice area after a moment (piece selector takes over)
      setTimeout(() => {
        this.diceArea.classList.add('cc-hidden');
      }, 800);
    } else {
      this.diceArea.classList.add('cc-hidden');
    }
  }

  // ── Piece Selector ──────────────────────────────────────────

  private renderPieceSelector(state: GameState): void {
    if (state.phase !== 'selecting') {
      this.pieceSelectorArea.classList.add('cc-hidden');
      return;
    }

    const player = state.players[state.currentPlayerIndex];
    this.pieceSelectorArea.classList.remove('cc-hidden');
    this.pieceSelectorArea.innerHTML = '';

    player.pieces.forEach((piece) => {
      const card = document.createElement('div');
      card.className = 'cc-piece-card cc-glass';

      if (piece.isAtCheckpoint) {
        card.classList.add('cc-stuck');
        card.innerHTML = `
          <div>\u{1F512} Stuck</div>
          <div style="margin-top:4px;opacity:0.6">Cell ${piece.cellIndex}</div>
        `;
      } else {
        card.style.borderColor = player.color;
        card.style.boxShadow = `0 0 8px ${player.color}44`;
        card.innerHTML = `
          <div>Piece ${piece.id + 1}</div>
          <div style="margin-top:4px;opacity:0.7">Cell ${piece.cellIndex}</div>
        `;
        card.addEventListener('click', () => {
          this.engine.selectPiece(piece.id);
        });
      }

      this.pieceSelectorArea.appendChild(card);
    });
  }

  // ── Turn Transition ─────────────────────────────────────────

  private handleTurnTransition(state: GameState): void {
    if (state.phase !== 'turnEnd') {
      this.transitionOverlay.classList.remove('cc-visible');
      if (this.turnTransitionTimer) {
        clearTimeout(this.turnTransitionTimer);
        this.turnTransitionTimer = null;
      }
      return;
    }

    const nextIdx =
      (state.currentPlayerIndex + 1) % state.players.length;
    const nextPlayer = state.players[nextIdx];
    const inner = this.transitionOverlay.querySelector(
      '.cc-transition-inner',
    ) as HTMLDivElement;
    inner.innerHTML = `
      <span style="color:${nextPlayer.color}">${nextPlayer.name}</span>'s Turn
    `;

    this.transitionOverlay.classList.add('cc-visible');

    this.turnTransitionTimer = setTimeout(() => {
      this.transitionOverlay.classList.remove('cc-visible');
      this.engine.nextTurn();
      this.turnTransitionTimer = null;
    }, 1500);
  }
}
