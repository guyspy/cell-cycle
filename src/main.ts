/**
 * Cell Cycle - Board Game
 * Main entry point. Wires together all modules.
 */
import { createScene } from './scene/SceneSetup';
import { createBoardRing } from './scene/BoardRing';
import { createSpaceBackground } from './scene/SpaceBackground';
import { createMetaballPieces } from './scene/MetaballPieces';
import { GameEngine } from './game/GameEngine';
import { CameraController } from './camera/CameraController';
import { UIManager } from './ui/UIManager';
import { buildCellConfigs, EventBus } from './types';

function showError(msg: string) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:16px;background:red;color:white;font-size:14px;z-index:9999;white-space:pre-wrap';
  el.textContent = msg;
  document.body.appendChild(el);
}

async function init() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-overlay') as HTMLDivElement;

  // Build cell layout data
  const cells = buildCellConfigs();

  // Scene setup
  const { scene, camera, renderer, composer } = createScene(canvas);

  // Space background (stars, nebula)
  createSpaceBackground(scene);

  // Board ring with colored cells
  const board = createBoardRing(scene, cells);

  // Game engine (logic)
  const numPlayers = 2; // local multiplayer: 2 players for now
  const engine = new GameEngine(numPlayers);

  // Cell pieces (3D representations)
  const piecesManager = createMetaballPieces(scene, camera, engine.getState(), cells);

  // Camera controller
  const cameraCtrl = new CameraController(camera, renderer);

  // UI overlay
  const ui = new UIManager(uiRoot, engine, cameraCtrl);

  // Listen for events to sync 3D with game state
  EventBus.on(async (event) => {
    try {
      if (event.type === 'pieceMoving') {
        const { playerId, pieceId, from, to } = event;
        // Camera follows the moving piece
        cameraCtrl.followPiece(cells[to].position);
        // Animate the piece
        await piecesManager.animateMove(playerId, pieceId, from, to);
        // Notify engine movement is done
        engine.onMoveComplete();
      }
      if (event.type === 'pieceLanded') {
        piecesManager.updatePositions(engine.getState());
        if ('cellIndex' in event) board.pressCell(event.cellIndex);
        cameraCtrl.easeToOverview();
      }
      if (event.type === 'diceRolled' || event.type === 'phaseChanged') {
        ui.update();
      }
    } catch (err) {
      showError(`Event handler error [${event.type}]: ${err}`);
    }
  });

  // Initial camera position: overview of the whole board
  cameraCtrl.setOverview();

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    cameraCtrl.update();
    piecesManager.update();
    composer.render();
  }
  animate();

  // Initial UI render
  ui.update();

  console.log('[CellCycle] Init complete. State:', engine.getState());
}

init().catch((err) => {
  console.error(err);
  showError(`Init error: ${err}`);
});
