import { describe, it, expect } from 'vitest';
import { PageState, DEFAULT_CLEANSING_CONFIG } from '../pageState.js';
import { CLEANSING_RULES } from '../../utils/aiSummaryCleaner/rules.js';

describe('DEFAULT_CLEANSING_CONFIG — rule flags derived from CLEANSING_RULES', () => {
  // DEFAULT_CLEANSING_CONFIG is assembled with `as unknown as CleansingConfig`
  // (PBI-20): the derived rule flags come from a plain Record<string, boolean>
  // that TypeScript cannot narrow back to the 32 named properties, so
  // completeness has to be checked at runtime here instead of at compile time.
  it('has every rule\'s aiSummaryCleansing<Key> property set to its defaultEnabled', () => {
    const config = DEFAULT_CLEANSING_CONFIG as unknown as Record<string, boolean>;
    for (const rule of CLEANSING_RULES) {
      const prop = `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}`;
      expect(config[prop], `${rule.key} -> ${prop}`).toBe(rule.defaultEnabled);
    }
  });
});

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
