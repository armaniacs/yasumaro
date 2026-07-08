/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TagClusterPanZoomController } from '../tagClusterPanZoom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvg(width = 800, height = 600): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  document.body.appendChild(svg);
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect);
  return svg;
}

function getViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } {
  const raw = svg.getAttribute('viewBox') || '0 0 0 0';
  const [x, y, width, height] = raw.split(' ').map(Number);
  return { x, y, width, height };
}

function wheel(svg: SVGSVGElement, deltaY: number, clientX = 400, clientY = 300): void {
  const event = new WheelEvent('wheel', { deltaY, clientX, clientY, bubbles: true, cancelable: true });
  svg.dispatchEvent(event);
}

function mouseDown(svg: SVGSVGElement, clientX: number, clientY: number): void {
  svg.dispatchEvent(new MouseEvent('mousedown', { clientX, clientY, bubbles: true }));
}

function mouseMove(clientX: number, clientY: number): void {
  document.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, bubbles: true }));
}

function mouseUp(): void {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

// jsdom does not implement TouchEvent fully in all versions, so build a
// minimal pseudo Touch/TouchEvent pair that satisfies the controller's usage
// (e.changedTouches, e.touches, t.identifier/clientX/clientY, preventDefault).
interface FakeTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}

function makeTouchEvent(type: string, touches: FakeTouch[], changedTouches: FakeTouch[] = touches): Event {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: FakeTouch[];
    changedTouches: FakeTouch[];
  };
  Object.defineProperty(event, 'touches', { value: touches, configurable: true });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches, configurable: true });
  return event;
}

describe('TagClusterPanZoomController', () => {
  let svg: SVGSVGElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    svg = createSvg(800, 600);
  });

  it('sets initial viewBox on attach()', () => {
    const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
    controller.attach();

    expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
  });

  describe('wheel zoom', () => {
    it('zooms in (shrinks viewBox) on negative deltaY', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      wheel(svg, -100);

      const vb = getViewBox(svg);
      expect(vb.width).toBeLessThan(800);
      expect(vb.height).toBeLessThan(600);
    });

    it('zooms out (grows viewBox) on positive deltaY', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      wheel(svg, 100);

      const vb = getViewBox(svg);
      expect(vb.width).toBeGreaterThan(800);
      expect(vb.height).toBeGreaterThan(600);
    });

    it('does not zoom in past MAX_SCALE (viewBox never shrinks below baseSize / 3)', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      for (let i = 0; i < 50; i++) {
        wheel(svg, -100);
      }

      const vb = getViewBox(svg);
      expect(vb.width).toBeGreaterThanOrEqual(800 / 3 - 0.001);
      expect(vb.height).toBeGreaterThanOrEqual(600 / 3 - 0.001);
    });

    it('does not zoom out past MIN_SCALE (viewBox never grows beyond baseSize / 0.3)', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      for (let i = 0; i < 50; i++) {
        wheel(svg, 100);
      }

      const vb = getViewBox(svg);
      expect(vb.width).toBeLessThanOrEqual(800 / 0.3 + 0.001);
      expect(vb.height).toBeLessThanOrEqual(600 / 0.3 + 0.001);
    });
  });

  describe('mouse drag pan', () => {
    it('moves viewBox x/y on drag past threshold', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      mouseDown(svg, 400, 300);
      mouseMove(360, 270);
      mouseUp();

      const vb = getViewBox(svg);
      expect(vb.x).not.toBe(0);
      expect(vb.y).not.toBe(0);
    });
  });

  describe('wasDragSuppressingClick', () => {
    it('returns false when drag distance stays under the threshold', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      mouseDown(svg, 400, 300);
      mouseMove(402, 301); // < 5px
      mouseUp();

      expect(controller.wasDragSuppressingClick()).toBe(false);
    });

    it('returns true when drag distance exceeds the threshold', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      mouseDown(svg, 400, 300);
      mouseMove(420, 320); // > 5px
      mouseUp();

      expect(controller.wasDragSuppressingClick()).toBe(true);
    });

    it('resets to false on the next mousedown', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      mouseDown(svg, 400, 300);
      mouseMove(420, 320);
      mouseUp();
      expect(controller.wasDragSuppressingClick()).toBe(true);

      mouseDown(svg, 100, 100);
      expect(controller.wasDragSuppressingClick()).toBe(false);
    });
  });

  describe('reset', () => {
    it('restores the base viewBox via reset()', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      wheel(svg, -100);
      mouseDown(svg, 400, 300);
      mouseMove(360, 270);
      mouseUp();

      controller.reset();

      expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
    });

    it('restores the base viewBox via resetBtn click', () => {
      const resetBtn = document.createElement('button');
      document.body.appendChild(resetBtn);
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 }, { resetBtn });
      controller.attach();

      wheel(svg, -100);
      resetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
    });
  });

  describe('zoom buttons', () => {
    it('zoomInBtn click shrinks the viewBox', () => {
      const zoomInBtn = document.createElement('button');
      document.body.appendChild(zoomInBtn);
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 }, { zoomInBtn });
      controller.attach();

      zoomInBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const vb = getViewBox(svg);
      expect(vb.width).toBeLessThan(800);
      expect(vb.height).toBeLessThan(600);
    });

    it('zoomOutBtn click grows the viewBox', () => {
      const zoomOutBtn = document.createElement('button');
      document.body.appendChild(zoomOutBtn);
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 }, { zoomOutBtn });
      controller.attach();

      zoomOutBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const vb = getViewBox(svg);
      expect(vb.width).toBeGreaterThan(800);
      expect(vb.height).toBeGreaterThan(600);
    });
  });

  describe('pinch zoom (touch)', () => {
    it('shrinks viewBox when the finger distance widens', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      const start = [
        { identifier: 1, clientX: 380, clientY: 300 },
        { identifier: 2, clientX: 420, clientY: 300 },
      ];
      svg.dispatchEvent(makeTouchEvent('touchstart', start));

      const moved = [
        { identifier: 1, clientX: 300, clientY: 300 },
        { identifier: 2, clientX: 500, clientY: 300 },
      ];
      svg.dispatchEvent(makeTouchEvent('touchmove', moved));

      const vb = getViewBox(svg);
      expect(vb.width).toBeLessThan(800);
      expect(vb.height).toBeLessThan(600);
    });

    it('grows viewBox when the finger distance narrows', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();

      const start = [
        { identifier: 1, clientX: 300, clientY: 300 },
        { identifier: 2, clientX: 500, clientY: 300 },
      ];
      svg.dispatchEvent(makeTouchEvent('touchstart', start));

      const moved = [
        { identifier: 1, clientX: 380, clientY: 300 },
        { identifier: 2, clientX: 420, clientY: 300 },
      ];
      svg.dispatchEvent(makeTouchEvent('touchmove', moved));

      const vb = getViewBox(svg);
      expect(vb.width).toBeGreaterThan(800);
      expect(vb.height).toBeGreaterThan(600);
    });
  });

  describe('cleanup', () => {
    it('removes listeners so wheel events no longer change the viewBox', () => {
      const controller = new TagClusterPanZoomController(svg, { width: 800, height: 600 });
      controller.attach();
      controller.cleanup();

      wheel(svg, -100);

      expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
    });
  });
});
