// @vitest-environment jsdom
/**
 * scrollMonitor.safeSide.test.ts (review S2)
 * When no viewport is readable, the update maintains the current max
 * (safe side, gate stays closed) instead of degrading to the raw
 * scrollHeight, which over-reports depth on an unreadable layout.
 */
import { describe, it, expect } from 'vitest';
import { ScrollMonitor } from '../scrollMonitor.js';
import { PageState } from '../pageState.js';

function stubWindowMetrics(metrics: { scrollY: number; innerHeight: number; clientHeight: number; scrollHeight: number }): () => void {
  const prevScrollY = window.scrollY;
  const prevInnerHeight = window.innerHeight;
  const prevClientHeight = document.documentElement.clientHeight;
  const prevScrollHeight = document.documentElement.scrollHeight;
  Object.defineProperty(window, 'scrollY', { value: metrics.scrollY, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: metrics.innerHeight, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: metrics.clientHeight, writable: true, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: metrics.scrollHeight, writable: true, configurable: true });
  return () => {
    Object.defineProperty(window, 'scrollY', { value: prevScrollY, writable: true, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: prevInnerHeight, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: prevClientHeight, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: prevScrollHeight, writable: true, configurable: true });
  };
}

describe('ScrollMonitor — unreadable viewport maintains the max (S2)', () => {
  it('maintains the current max instead of degrading to raw scrollHeight', () => {
    // scrollHeight alone would read 1500/1600 = 93.75% — a gate-opening
    // over-report from an unreadable layout.
    const restore = stubWindowMetrics({ scrollY: 1500, innerHeight: NaN, clientHeight: NaN, scrollHeight: 1600 });
    try {
      const pageState = new PageState();
      pageState.maxScrollPercentage = 30;
      const next = new ScrollMonitor(pageState).updateFromWindow();
      expect(next).toBe(30);
      expect(pageState.maxScrollPercentage).toBe(30);
    } finally {
      restore();
    }
  });

  it('recovers on the next valid read after maintaining', () => {
    const bad = stubWindowMetrics({ scrollY: 1500, innerHeight: NaN, clientHeight: NaN, scrollHeight: 1600 });
    const pageState = new PageState();
    pageState.maxScrollPercentage = 30;
    try {
      expect(new ScrollMonitor(pageState).updateFromWindow()).toBe(30);
    } finally {
      bad();
    }
    const good = stubWindowMetrics({ scrollY: 900, innerHeight: 600, clientHeight: 600, scrollHeight: 1600 });
    try {
      // viewport 600 -> docHeight 1000 -> 90%.
      expect(new ScrollMonitor(pageState).updateFromWindow()).toBe(90);
      expect(pageState.maxScrollPercentage).toBe(90);
    } finally {
      good();
    }
  });
});
