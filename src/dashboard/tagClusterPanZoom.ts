/**
 * tagClusterPanZoom.ts
 * Mouse/wheel/touch-based pan and zoom controller for the Tag Cluster SVG.
 * Manipulates the SVG's viewBox attribute directly — no separate logical
 * coordinate system, no CSS transform. Mirrors TagClusterLoadingManager's
 * constructor-takes-svg / cleanup() lifecycle pattern.
 */

const MIN_SCALE = 0.3;
const MAX_SCALE = 3;
const DRAG_THRESHOLD_PX = 5;
const WHEEL_ZOOM_FACTOR = 1.1;
const BUTTON_ZOOM_FACTOR = 1.3;

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanZoomButtons {
  zoomInBtn?: HTMLElement | null;
  zoomOutBtn?: HTMLElement | null;
  resetBtn?: HTMLElement | null;
}

interface BoundListener {
  target: EventTarget;
  type: string;
  fn: EventListener;
}

export class TagClusterPanZoomController {
  private svgElement: SVGSVGElement;
  private baseWidth: number;
  private baseHeight: number;
  private viewBox: ViewBox;
  private buttons: PanZoomButtons;
  private listeners: BoundListener[] = [];

  // Mouse drag state
  private isDragging = false;
  private dragStartClientX = 0;
  private dragStartClientY = 0;
  private dragStartViewBoxX = 0;
  private dragStartViewBoxY = 0;
  private dragMoved = false;

  // Touch state (pan with 1 finger, pinch-zoom with 2)
  private activeTouches: Map<number, { x: number; y: number }> = new Map();
  private pinchStartDistance: number | null = null;
  private pinchStartScale = 1;

  constructor(svgElement: SVGSVGElement, canvasSize: { width: number; height: number }, buttons: PanZoomButtons = {}) {
    this.svgElement = svgElement;
    // Guard against a degenerate canvas size (would otherwise divide by zero
    // in zoomTo/panByClientDelta). computeCanvasSize() never returns zero,
    // but this keeps the controller robust on its own.
    this.baseWidth = canvasSize.width || 1;
    this.baseHeight = canvasSize.height || 1;
    this.viewBox = { x: 0, y: 0, width: this.baseWidth, height: this.baseHeight };
    this.buttons = buttons;
  }

  /** Apply the initial viewBox and bind all event listeners. */
  attach(): void {
    this.applyViewBox();

    this.on(this.svgElement, 'wheel', this.handleWheel as EventListener);
    this.on(this.svgElement, 'mousedown', this.handleMouseDown as EventListener);
    this.on(document, 'mousemove', this.handleMouseMove as EventListener);
    this.on(document, 'mouseup', this.handleMouseUp as EventListener);
    this.on(this.svgElement, 'touchstart', this.handleTouchStart as EventListener);
    this.on(this.svgElement, 'touchmove', this.handleTouchMove as EventListener);
    this.on(this.svgElement, 'touchend', this.handleTouchEnd as EventListener);

    if (this.buttons.zoomInBtn) {
      this.on(this.buttons.zoomInBtn, 'click', this.handleZoomInClick as EventListener);
    }
    if (this.buttons.zoomOutBtn) {
      this.on(this.buttons.zoomOutBtn, 'click', this.handleZoomOutClick as EventListener);
    }
    if (this.buttons.resetBtn) {
      this.on(this.buttons.resetBtn, 'click', this.handleResetClick as EventListener);
    }
  }

  /**
   * Whether the gesture that just ended (mouseup/touchend) moved past the
   * click/drag threshold. Callers (e.g. a node's click handler) should check
   * this and suppress their own click action when it returns true.
   */
  wasDragSuppressingClick(): boolean {
    return this.dragMoved;
  }

  zoomIn(): void {
    const cx = this.viewBox.x + this.viewBox.width / 2;
    const cy = this.viewBox.y + this.viewBox.height / 2;
    this.zoomBy(BUTTON_ZOOM_FACTOR, cx, cy);
  }

  zoomOut(): void {
    const cx = this.viewBox.x + this.viewBox.width / 2;
    const cy = this.viewBox.y + this.viewBox.height / 2;
    this.zoomBy(1 / BUTTON_ZOOM_FACTOR, cx, cy);
  }

  reset(): void {
    this.viewBox = { x: 0, y: 0, width: this.baseWidth, height: this.baseHeight };
    this.applyViewBox();
  }

  /** Remove all event listeners bound by attach(). Safe to call multiple times. */
  cleanup(): void {
    for (const { target, type, fn } of this.listeners) {
      target.removeEventListener(type, fn);
    }
    this.listeners = [];
  }

  private on(target: EventTarget, type: string, fn: EventListener): void {
    const options = type === 'wheel' || type === 'touchmove' || type === 'touchstart' ? { passive: false } : undefined;
    target.addEventListener(type, fn, options);
    this.listeners.push({ target, type, fn });
  }

  private handleZoomInClick = (): void => {
    this.zoomIn();
  };

  private handleZoomOutClick = (): void => {
    this.zoomOut();
  };

  private handleResetClick = (): void => {
    this.reset();
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.svgElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const svgPoint = this.clientToViewBoxPoint(e.clientX, e.clientY, rect);
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
    this.zoomBy(factor, svgPoint.x, svgPoint.y);
  };

  /** Convert a client-space point to the current viewBox's coordinate space. */
  private clientToViewBoxPoint(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    return {
      x: this.viewBox.x + ((clientX - rect.left) / rect.width) * this.viewBox.width,
      y: this.viewBox.y + ((clientY - rect.top) / rect.height) * this.viewBox.height,
    };
  }

  /** Zoom by a relative factor, keeping (centerX, centerY) — in viewBox space — fixed on screen. */
  private zoomBy(factor: number, centerX: number, centerY: number): void {
    const currentScale = this.baseWidth / this.viewBox.width;
    this.zoomTo(currentScale * factor, centerX, centerY);
  }

  /** Zoom to an absolute scale, keeping (centerX, centerY) — in viewBox space — fixed on screen. */
  private zoomTo(scale: number, centerX: number, centerY: number): void {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const newWidth = this.baseWidth / newScale;
    const newHeight = this.baseHeight / newScale;

    const ratioX = (centerX - this.viewBox.x) / this.viewBox.width;
    const ratioY = (centerY - this.viewBox.y) / this.viewBox.height;
    this.viewBox = {
      x: centerX - ratioX * newWidth,
      y: centerY - ratioY * newHeight,
      width: newWidth,
      height: newHeight,
    };
    this.applyViewBox();
  }

  /** Pan by a delta expressed in client (screen) pixels, converted to viewBox space. */
  private panByClientDelta(dxClient: number, dyClient: number, rect: DOMRect): void {
    if (rect.width === 0 || rect.height === 0) return;
    const scaleX = this.viewBox.width / rect.width;
    const scaleY = this.viewBox.height / rect.height;
    this.viewBox = {
      ...this.viewBox,
      x: this.viewBox.x - dxClient * scaleX,
      y: this.viewBox.y - dyClient * scaleY,
    };
    this.applyViewBox();
  }

  /** Marks the current gesture as a drag once movement exceeds the click threshold. */
  private checkDragThreshold(dxClient: number, dyClient: number): void {
    if (!this.dragMoved && Math.hypot(dxClient, dyClient) > DRAG_THRESHOLD_PX) {
      this.dragMoved = true;
    }
  }

  private handleMouseDown = (e: MouseEvent): void => {
    this.isDragging = true;
    this.dragMoved = false;
    this.dragStartClientX = e.clientX;
    this.dragStartClientY = e.clientY;
    this.dragStartViewBoxX = this.viewBox.x;
    this.dragStartViewBoxY = this.viewBox.y;
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isDragging) return;
    const dxClient = e.clientX - this.dragStartClientX;
    const dyClient = e.clientY - this.dragStartClientY;
    this.checkDragThreshold(dxClient, dyClient);
    if (!this.dragMoved) return;

    const rect = this.svgElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scaleX = this.viewBox.width / rect.width;
    const scaleY = this.viewBox.height / rect.height;
    this.viewBox = {
      ...this.viewBox,
      x: this.dragStartViewBoxX - dxClient * scaleX,
      y: this.dragStartViewBoxY - dyClient * scaleY,
    };
    this.applyViewBox();
  };

  private handleMouseUp = (): void => {
    this.isDragging = false;
    // dragMoved is intentionally left as-is here: the click event that
    // follows mouseup fires next and needs to observe it via
    // wasDragSuppressingClick(). It gets reset on the next mousedown.
  };

  private handleTouchStart = (e: TouchEvent): void => {
    this.dragMoved = false;
    for (const t of Array.from(e.changedTouches)) {
      this.activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (this.activeTouches.size === 2) {
      e.preventDefault();
      this.pinchStartDistance = this.currentPinchDistance();
      this.pinchStartScale = this.baseWidth / this.viewBox.width;
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 2 && this.activeTouches.size === 2) {
      e.preventDefault();
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      if (this.pinchStartDistance) {
        const factor = distance / this.pinchStartDistance;
        const centerClientX = (t1.clientX + t2.clientX) / 2;
        const centerClientY = (t1.clientY + t2.clientY) / 2;
        const rect = this.svgElement.getBoundingClientRect();
        if (rect.width !== 0 && rect.height !== 0) {
          const svgPoint = this.clientToViewBoxPoint(centerClientX, centerClientY, rect);
          this.zoomTo(this.pinchStartScale * factor, svgPoint.x, svgPoint.y);
        }
      }
      this.updateActiveTouches(e.touches);
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      const prev = this.activeTouches.get(t.identifier);
      if (prev) {
        const dxPx = t.clientX - prev.x;
        const dyPx = t.clientY - prev.y;
        this.checkDragThreshold(dxPx, dyPx);
        const rect = this.svgElement.getBoundingClientRect();
        this.panByClientDelta(dxPx, dyPx, rect);
      }
      this.updateActiveTouches(e.touches);
    }
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      this.activeTouches.delete(t.identifier);
    }
    if (this.activeTouches.size < 2) {
      this.pinchStartDistance = null;
    }
  };

  private updateActiveTouches(touches: TouchList): void {
    for (const t of Array.from(touches)) {
      this.activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }

  private currentPinchDistance(): number {
    const pts = Array.from(this.activeTouches.values());
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private applyViewBox(): void {
    this.svgElement.setAttribute(
      'viewBox',
      `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`
    );
  }
}
