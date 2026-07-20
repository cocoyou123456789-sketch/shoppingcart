import {
  MathUtils,
  PerspectiveCamera,
  Vector3,
} from "three";

type ControlEvent = "change" | "start" | "end";
type ControlListener = () => void;

export class AvatarOrbitControls {
  readonly target = new Vector3();
  enablePan = false;
  enableDamping = false;
  dampingFactor = 0.06;
  autoRotate = false;
  autoRotateSpeed = 1;
  minDistance = 0;
  maxDistance = Infinity;

  private readonly listeners = new Map<ControlEvent, Set<ControlListener>>();
  private activePointer: number | null = null;
  private previousX = 0;
  private previousY = 0;
  private disposed = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly element: HTMLElement,
  ) {
    element.addEventListener("pointerdown", this.handlePointerDown);
    element.addEventListener("pointermove", this.handlePointerMove);
    element.addEventListener("pointerup", this.handlePointerEnd);
    element.addEventListener("pointercancel", this.handlePointerEnd);
    element.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  addEventListener(type: ControlEvent, listener: ControlListener) {
    const listeners = this.listeners.get(type) ?? new Set<ControlListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: ControlEvent, listener: ControlListener) {
    this.listeners.get(type)?.delete(listener);
  }

  getDistance() {
    return this.camera.position.distanceTo(this.target);
  }

  dollyIn(scale: number) {
    this.setDistance(this.getDistance() * scale);
  }

  dollyOut(scale: number) {
    this.setDistance(this.getDistance() / scale);
  }

  update(deltaSeconds = 0) {
    if (this.autoRotate && deltaSeconds > 0) {
      this.orbit(-deltaSeconds * this.autoRotateSpeed * 0.42, 0);
      return true;
    }
    this.camera.lookAt(this.target);
    return false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.element.removeEventListener("pointerdown", this.handlePointerDown);
    this.element.removeEventListener("pointermove", this.handlePointerMove);
    this.element.removeEventListener("pointerup", this.handlePointerEnd);
    this.element.removeEventListener("pointercancel", this.handlePointerEnd);
    this.element.removeEventListener("wheel", this.handleWheel);
    this.listeners.clear();
  }

  private dispatch(type: ControlEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  private setDistance(distance: number) {
    const offset = this.camera.position.clone().sub(this.target);
    const currentDistance = Math.max(0.0001, offset.length());
    const nextDistance = MathUtils.clamp(
      distance,
      this.minDistance,
      this.maxDistance,
    );
    offset.multiplyScalar(nextDistance / currentDistance);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    this.dispatch("change");
  }

  private orbit(thetaDelta: number, phiDelta: number) {
    const offset = this.camera.position.clone().sub(this.target);
    const radius = MathUtils.clamp(
      Math.max(0.0001, offset.length()),
      this.minDistance,
      this.maxDistance,
    );
    const theta = Math.atan2(offset.x, offset.z) + thetaDelta;
    const phi = MathUtils.clamp(
      Math.acos(MathUtils.clamp(offset.y / radius, -1, 1)) + phiDelta,
      0.18,
      Math.PI - 0.18,
    );
    const horizontalRadius = Math.sin(phi) * radius;
    offset.set(
      Math.sin(theta) * horizontalRadius,
      Math.cos(phi) * radius,
      Math.cos(theta) * horizontalRadius,
    );
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    this.dispatch("change");
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (this.activePointer !== null || event.button !== 0) return;
    this.activePointer = event.pointerId;
    this.previousX = event.clientX;
    this.previousY = event.clientY;
    this.element.setPointerCapture?.(event.pointerId);
    this.dispatch("start");
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.activePointer) return;
    const deltaX = event.clientX - this.previousX;
    const deltaY = event.clientY - this.previousY;
    this.previousX = event.clientX;
    this.previousY = event.clientY;
    if (Math.abs(deltaX) + Math.abs(deltaY) < 0.2) return;
    this.orbit(-deltaX * 0.008, -deltaY * 0.006);
  };

  private readonly handlePointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.activePointer) return;
    this.activePointer = null;
    if (this.element.hasPointerCapture?.(event.pointerId)) {
      this.element.releasePointerCapture?.(event.pointerId);
    }
    this.dispatch("end");
  };

  private readonly handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.dispatch("start");
    this.setDistance(
      this.getDistance() * Math.exp(MathUtils.clamp(event.deltaY, -80, 80) * 0.002),
    );
    this.dispatch("end");
  };
}
