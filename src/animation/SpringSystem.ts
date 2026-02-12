/**
 * SpringSystem — spring-based animation system using `wobble` for natural
 * bouncy piece movement (position x/y/z + scale x/y/z per piece).
 */
import * as THREE from 'three';
import { Spring } from 'wobble';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PieceSpringState {
  position: THREE.Vector3;
  scale: THREE.Vector3;
}

export interface SpringSystemAPI {
  /** Register springs for a new piece at a resting position. */
  addPiece(playerId: number, pieceId: number, position: THREE.Vector3): void;

  /** Trigger a multi-cell hop animation. Resolves when fully settled. */
  animateHop(
    playerId: number,
    pieceId: number,
    targets: THREE.Vector3[],
  ): Promise<void>;

  /** Snap piece to position instantly (no spring animation). */
  setPosition(
    playerId: number,
    pieceId: number,
    position: THREE.Vector3,
  ): void;

  /** Advance all springs and return current per-piece states. */
  update(dt: number): Map<string, PieceSpringState>;
}

// ---------------------------------------------------------------------------
// Spring presets
// ---------------------------------------------------------------------------

const POS_SPRING = { stiffness: 180, damping: 12, mass: 1 };
const SCALE_SPRING = { stiffness: 250, damping: 10, mass: 0.8 };

// Rest scale: squashed sphere
const REST_SCALE_X = 1.0;
const REST_SCALE_Y = 0.7;
const REST_SCALE_Z = 1.0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pieceKey(playerId: number, pieceId: number): string {
  return `${playerId}-${pieceId}`;
}

/** Create a wobble Spring that we drive manually (we stop its internal rAF
 *  loop and advance it ourselves via `updateConfig` target changes). */
function makeSpring(
  from: number,
  preset: { stiffness: number; damping: number; mass: number },
): Spring {
  return new Spring({
    fromValue: from,
    toValue: from,
    stiffness: preset.stiffness,
    damping: preset.damping,
    mass: preset.mass,
  });
}

/** Returns a promise that resolves when a spring reaches rest. */
function springAtRest(spring: Spring): Promise<void> {
  return new Promise<void>((resolve) => {
    if (spring.isAtRest && !spring.isAnimating) {
      resolve();
      return;
    }
    const listener = () => {
      if (spring.isAtRest) {
        spring.removeListener(listener);
        resolve();
      }
    };
    spring.onUpdate(listener);
    spring.onStop(listener);
  });
}

/** Wait for multiple springs to all reach rest. */
function allAtRest(springs: Spring[]): Promise<void> {
  return Promise.all(springs.map(springAtRest)).then(() => {});
}

/** Small delay helper (ms). */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// PieceSpringSet — the 6 springs belonging to a single game piece
// ---------------------------------------------------------------------------

interface PieceSpringSet {
  posX: Spring;
  posY: Spring;
  posZ: Spring;
  scaleX: Spring;
  scaleY: Spring;
  scaleZ: Spring;
  /** Base resting position (updated after each hop) */
  basePos: THREE.Vector3;
  /** True while a hop sequence is running. */
  hopping: boolean;
  /** Per-piece phase offset for idle breathing. */
  phase: number;
}

// ---------------------------------------------------------------------------
// SpringSystem implementation
// ---------------------------------------------------------------------------

export function createSpringSystem(): SpringSystemAPI {
  const pieces = new Map<string, PieceSpringSet>();
  /** Monotonically increasing elapsed time for idle oscillation. */
  let elapsed = 0;

  // -----------------------------------------------------------------------
  // addPiece
  // -----------------------------------------------------------------------

  function addPiece(
    playerId: number,
    pieceId: number,
    position: THREE.Vector3,
  ): void {
    const key = pieceKey(playerId, pieceId);

    const set: PieceSpringSet = {
      posX: makeSpring(position.x, POS_SPRING),
      posY: makeSpring(position.y, POS_SPRING),
      posZ: makeSpring(position.z, POS_SPRING),
      scaleX: makeSpring(REST_SCALE_X, SCALE_SPRING),
      scaleY: makeSpring(REST_SCALE_Y, SCALE_SPRING),
      scaleZ: makeSpring(REST_SCALE_Z, SCALE_SPRING),
      basePos: position.clone(),
      hopping: false,
      phase: pieceId + playerId * 3,
    };

    pieces.set(key, set);
  }

  // -----------------------------------------------------------------------
  // setPosition (instant snap)
  // -----------------------------------------------------------------------

  function setPosition(
    playerId: number,
    pieceId: number,
    position: THREE.Vector3,
  ): void {
    const key = pieceKey(playerId, pieceId);
    const set = pieces.get(key);
    if (!set) return;

    set.basePos.copy(position);

    // Stop any running animation and reset springs to the new value.
    for (const s of [set.posX, set.posY, set.posZ]) s.stop();
    set.posX.updateConfig({ fromValue: position.x, toValue: position.x }).stop();
    set.posY.updateConfig({ fromValue: position.y, toValue: position.y }).stop();
    set.posZ.updateConfig({ fromValue: position.z, toValue: position.z }).stop();
    set.scaleX.updateConfig({ fromValue: REST_SCALE_X, toValue: REST_SCALE_X }).stop();
    set.scaleY.updateConfig({ fromValue: REST_SCALE_Y, toValue: REST_SCALE_Y }).stop();
    set.scaleZ.updateConfig({ fromValue: REST_SCALE_Z, toValue: REST_SCALE_Z }).stop();
  }

  // -----------------------------------------------------------------------
  // animateHop — sequences through targets one cell at a time
  // -----------------------------------------------------------------------

  async function animateHop(
    playerId: number,
    pieceId: number,
    targets: THREE.Vector3[],
  ): Promise<void> {
    const key = pieceKey(playerId, pieceId);
    const set = pieces.get(key);
    if (!set || targets.length === 0) return;

    set.hopping = true;

    for (const target of targets) {
      await hopToCell(set, target);
    }

    // Record new base position and mark hop done
    set.basePos.copy(targets[targets.length - 1]);
    set.hopping = false;
  }

  /** Single cell-to-cell hop with squash-stretch dynamics. */
  async function hopToCell(set: PieceSpringSet, target: THREE.Vector3): Promise<void> {
    const currentY = set.posY.currentValue;

    // --- 1. Crouch ---
    setSpringTarget(set.scaleY, 0.45);
    setSpringTarget(set.scaleX, 1.3);
    setSpringTarget(set.scaleZ, 1.3);
    setSpringTarget(set.posY, currentY - 0.1);

    await delay(100);

    // --- 2. Launch ---
    setSpringTarget(set.scaleY, 1.1);
    setSpringTarget(set.scaleX, 0.8);
    setSpringTarget(set.scaleZ, 0.8);
    setSpringTarget(set.posY, target.y + 1.5);
    setSpringTarget(set.posX, target.x);
    setSpringTarget(set.posZ, target.z);

    await delay(100);

    // --- 3. Mid-air squish ---
    setSpringTarget(set.scaleY, 0.7);
    setSpringTarget(set.scaleX, 1.0);
    setSpringTarget(set.scaleZ, 1.0);

    // Wait for Y to start falling back (peak detection): we wait until the
    // position spring has passed the apex. Instead of exact peak detection we
    // simply wait for the Y spring to settle past its overshoot.
    await allAtRest([set.posX, set.posZ]);

    // --- 4. Land ---
    setSpringTarget(set.posY, target.y);
    setSpringTarget(set.scaleY, 0.4);
    setSpringTarget(set.scaleX, 1.4);
    setSpringTarget(set.scaleZ, 1.4);

    // Wait a moment then settle scale
    await delay(80);

    // --- 5. Settle ---
    setSpringTarget(set.scaleY, REST_SCALE_Y);
    setSpringTarget(set.scaleX, REST_SCALE_X);
    setSpringTarget(set.scaleZ, REST_SCALE_Z);

    // Wait for everything to come to rest before the next hop
    await allAtRest([
      set.posX,
      set.posY,
      set.posZ,
      set.scaleX,
      set.scaleY,
      set.scaleZ,
    ]);
  }

  /** Convenience: update a spring's toValue from its current position and restart. */
  function setSpringTarget(spring: Spring, toValue: number): void {
    spring.updateConfig({
      fromValue: spring.currentValue,
      toValue,
    }).start();
  }

  // -----------------------------------------------------------------------
  // update — called every frame
  // -----------------------------------------------------------------------

  function update(dt: number): Map<string, PieceSpringState> {
    elapsed += dt;

    const states = new Map<string, PieceSpringState>();

    for (const [key, set] of pieces) {
      // Idle breathing — only when not hopping
      if (!set.hopping) {
        const t = elapsed;
        const p = set.phase;
        const base = set.basePos;

        // Gently oscillate spring targets around the rest pose
        setIdleTarget(set.posY, base.y + Math.sin(t * 2 + p) * 0.08);
        setIdleTarget(set.scaleY, REST_SCALE_Y + Math.sin(t * 3 + p) * 0.03);
        setIdleTarget(set.scaleX, REST_SCALE_X - Math.sin(t * 3 + p) * 0.02);
        setIdleTarget(set.scaleZ, REST_SCALE_Z - Math.sin(t * 3 + p) * 0.02);
      }

      states.set(key, {
        position: new THREE.Vector3(
          set.posX.currentValue,
          set.posY.currentValue,
          set.posZ.currentValue,
        ),
        scale: new THREE.Vector3(
          set.scaleX.currentValue,
          set.scaleY.currentValue,
          set.scaleZ.currentValue,
        ),
      });
    }

    return states;
  }

  /** For idle breathing we directly set the spring target without restarting
   *  if it is already animating to a very close value, to avoid jitter. */
  function setIdleTarget(spring: Spring, target: number): void {
    // Only poke the spring if the target changed noticeably
    const diff = Math.abs((spring as any)._config?.toValue - target);
    if (diff > 0.001) {
      spring.updateConfig({
        fromValue: spring.currentValue,
        toValue: target,
      }).start();
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  return {
    addPiece,
    animateHop,
    setPosition,
    update,
  };
}
