// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { makeGraphNodeAccessible } from '../graphNodeA11y.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeCircle(): SVGCircleElement {
  return document.createElementNS(SVG_NS, 'circle');
}

describe('makeGraphNodeAccessible', () => {
  it('exposes nodes to keyboard and assistive tech', () => {
    const circle = makeCircle();
    makeGraphNodeAccessible(circle, '#ai (12)', () => {});
    expect(circle.getAttribute('tabindex')).toBe('0');
    expect(circle.getAttribute('role')).toBe('button');
    expect(circle.getAttribute('aria-label')).toBe('#ai (12)');
  });

  it('activates with Enter', () => {
    const circle = makeCircle();
    const onActivate = vi.fn();
    makeGraphNodeAccessible(circle, '#ai (12)', onActivate);
    circle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('activates with Space and prevents scroll', () => {
    const circle = makeCircle();
    const onActivate = vi.fn();
    makeGraphNodeAccessible(circle, '#ai (12)', onActivate);
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    circle.dispatchEvent(event);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores unrelated keys', () => {
    const circle = makeCircle();
    const onActivate = vi.fn();
    makeGraphNodeAccessible(circle, '#ai (12)', onActivate);
    circle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    circle.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onActivate).not.toHaveBeenCalled();
  });
});
