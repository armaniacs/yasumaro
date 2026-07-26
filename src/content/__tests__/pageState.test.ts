import { describe, it, expect } from 'vitest';
import { PageState } from '../pageState.js';

describe('PageState', () => {
  it('initializes with default values matching the pre-refactor module-level defaults', () => {
    const state = new PageState();
    expect(state.minVisitDuration).toBe(5);
    expect(state.minScrollDepth).toBe(50);
    expect(state.maxScrollPercentage).toBe(0);
    expect(state.isValidVisitReported).toBe(false);
    expect(state.checkIntervalId).toBeNull();
    expect(typeof state.startTime).toBe('number');
  });

  it('each instance is independent (no shared module-level state)', () => {
    const a = new PageState();
    const b = new PageState();
    a.isValidVisitReported = true;
    a.maxScrollPercentage = 80;
    expect(b.isValidVisitReported).toBe(false);
    expect(b.maxScrollPercentage).toBe(0);
  });
});
