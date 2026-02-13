import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import gsap from 'gsap';

const OVERVIEW_POS = new THREE.Vector3(0, 40, 30);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 0);
const FOLLOW_OFFSET = new THREE.Vector3(3, 10, 8);

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private controls: MapControls;

  private isFollowing = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
  ) {
    this.camera = camera;

    this.controls = new MapControls(camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.controls.minPolarAngle = Math.PI * 0.1;
    this.controls.panSpeed = 1.0;
    this.controls.rotateSpeed = 0.5;
    this.controls.listenToKeyEvents(window);
  }

  setOverview(): void {
    this.isFollowing = false;
    this.controls.enabled = true;
    this.camera.position.copy(OVERVIEW_POS);
    this.controls.target.copy(OVERVIEW_TARGET);
    this.camera.lookAt(OVERVIEW_TARGET);
    this.controls.update();
  }

  followPiece(targetPosition: THREE.Vector3): void {
    this.isFollowing = true;
    this.controls.enabled = false;

    const destination = targetPosition.clone().add(FOLLOW_OFFSET);
    const lookTarget = targetPosition.clone();

    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);

    gsap.to(this.camera.position, {
      x: destination.x,
      y: destination.y,
      z: destination.z,
      duration: 0.8,
      ease: 'power2.inOut',
    });

    gsap.to(this.controls.target, {
      x: lookTarget.x,
      y: lookTarget.y,
      z: lookTarget.z,
      duration: 0.8,
      ease: 'power2.inOut',
    });
  }

  easeToOverview(): void {
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);

    const tl = gsap.timeline();

    tl.to(this.camera.position, {
      x: OVERVIEW_POS.x,
      y: OVERVIEW_POS.y,
      z: OVERVIEW_POS.z,
      duration: 1.5,
      delay: 0.5,
      ease: 'power2.inOut',
    });

    tl.to(
      this.controls.target,
      {
        x: OVERVIEW_TARGET.x,
        y: OVERVIEW_TARGET.y,
        z: OVERVIEW_TARGET.z,
        duration: 1.5,
        ease: 'power2.inOut',
      },
      '<',
    );

    tl.call(() => {
      this.isFollowing = false;
      this.controls.enabled = true;
    });
  }

  update(): void {
    if (this.isFollowing) {
      // During GSAP animations, just update the camera lookAt manually
      this.camera.lookAt(this.controls.target);
    } else {
      // MapControls handles camera updates (including damping)
      this.controls.update();
    }
  }
}
