import * as THREE from 'three';
import gsap from 'gsap';
import type { CellConfig } from '../types';

const OVERVIEW_POS = new THREE.Vector3(0, 40, 30);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 0);
const FOLLOW_OFFSET = new THREE.Vector3(3, 10, 8);
const LERP_FACTOR = 0.08;
const MIN_ZOOM = 20;
const MAX_ZOOM = 80;

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private cells: CellConfig[];

  private targetPosition = OVERVIEW_POS.clone();
  private targetLookAt = OVERVIEW_TARGET.clone();
  private currentLookAt = OVERVIEW_TARGET.clone();

  private isFollowing = false;

  // Orbit state
  private isDragging = false;
  private previousMouse = { x: 0, y: 0 };
  private orbitAngle = 0; // horizontal angle around Y
  private orbitDistance = OVERVIEW_POS.length();

  constructor(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    cells: CellConfig[],
  ) {
    this.camera = camera;
    this.renderer = renderer;
    this.cells = cells;

    this.setupMouseControls();
  }

  setOverview(): void {
    this.isFollowing = false;
    this.targetPosition.copy(OVERVIEW_POS);
    this.targetLookAt.copy(OVERVIEW_TARGET);
    this.camera.position.copy(OVERVIEW_POS);
    this.currentLookAt.copy(OVERVIEW_TARGET);
    this.camera.lookAt(OVERVIEW_TARGET);

    // Derive orbit state from overview position
    this.orbitDistance = OVERVIEW_POS.length();
    this.orbitAngle = Math.atan2(OVERVIEW_POS.x, OVERVIEW_POS.z);
  }

  followPiece(targetPosition: THREE.Vector3): void {
    this.isFollowing = true;

    const destination = targetPosition.clone().add(FOLLOW_OFFSET);
    const lookTarget = targetPosition.clone();

    gsap.killTweensOf(this.targetPosition);
    gsap.killTweensOf(this.targetLookAt);

    gsap.to(this.targetPosition, {
      x: destination.x,
      y: destination.y,
      z: destination.z,
      duration: 0.8,
      ease: 'power2.inOut',
    });

    gsap.to(this.targetLookAt, {
      x: lookTarget.x,
      y: lookTarget.y,
      z: lookTarget.z,
      duration: 0.8,
      ease: 'power2.inOut',
    });
  }

  easeToOverview(): void {
    gsap.killTweensOf(this.targetPosition);
    gsap.killTweensOf(this.targetLookAt);

    const tl = gsap.timeline();

    tl.to(this.targetPosition, {
      x: OVERVIEW_POS.x,
      y: OVERVIEW_POS.y,
      z: OVERVIEW_POS.z,
      duration: 1.5,
      delay: 0.5,
      ease: 'power2.inOut',
    });

    tl.to(
      this.targetLookAt,
      {
        x: OVERVIEW_TARGET.x,
        y: OVERVIEW_TARGET.y,
        z: OVERVIEW_TARGET.z,
        duration: 1.5,
        ease: 'power2.inOut',
      },
      '<', // start at the same time as previous
    );

    tl.call(() => {
      this.isFollowing = false;
      this.orbitDistance = OVERVIEW_POS.length();
      this.orbitAngle = Math.atan2(OVERVIEW_POS.x, OVERVIEW_POS.z);
    });
  }

  update(): void {
    // Lerp camera position toward target
    this.camera.position.lerp(this.targetPosition, LERP_FACTOR);

    // Lerp lookAt target
    this.currentLookAt.lerp(this.targetLookAt, LERP_FACTOR);
    this.camera.lookAt(this.currentLookAt);
  }

  private setupMouseControls(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (this.isFollowing) return;
      this.isDragging = true;
      this.previousMouse.x = e.clientX;
      this.previousMouse.y = e.clientY;
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isDragging || this.isFollowing) return;

      const dx = e.clientX - this.previousMouse.x;
      this.previousMouse.x = e.clientX;
      this.previousMouse.y = e.clientY;

      // Rotate orbit angle based on horizontal mouse movement
      this.orbitAngle -= dx * 0.005;

      this.updateOrbitPosition();
    });

    canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
    });

    canvas.addEventListener('wheel', (e: WheelEvent) => {
      if (this.isFollowing) return;
      e.preventDefault();

      this.orbitDistance += e.deltaY * 0.05;
      this.orbitDistance = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.orbitDistance));

      this.updateOrbitPosition();
    }, { passive: false });
  }

  private updateOrbitPosition(): void {
    // Compute camera position on a sphere around the center
    // Keep the same elevation ratio as the overview
    const elevationRatio = OVERVIEW_POS.y / OVERVIEW_POS.length();
    const y = this.orbitDistance * elevationRatio;
    const horizontalDist = Math.sqrt(
      this.orbitDistance * this.orbitDistance - y * y,
    );

    this.targetPosition.set(
      Math.sin(this.orbitAngle) * horizontalDist,
      y,
      Math.cos(this.orbitAngle) * horizontalDist,
    );
    this.targetLookAt.copy(OVERVIEW_TARGET);
  }
}
