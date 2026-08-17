import { describe, it, expect, expectTypeOf } from 'vitest';
import { PageState, DEFAULT_CLEANSING_CONFIG, type CleansingConfig } from '../pageState.js';
import { CLEANSING_RULES } from '../../utils/aiSummaryCleaner/rules.js';
import type { RuleKey } from '../../utils/aiSummaryCleaner/types.js';

/**
 * Type-level completeness check: every RuleKey must map to a property
 * `aiSummaryCleansing${Capitalize<K>}` in CleansingConfig. This replaces the
 * old runtime loop test — the derived mapped type now enforces completeness at
 * compile time.
 */
type AssertAllRuleKeysPresent = {
    [K in RuleKey]: CleansingConfig[`aiSummaryCleansing${Capitalize<K>}`];
};

describe('DEFAULT_CLEANSING_CONFIG — rule flags derived from CLEANSING_RULES', () => {
  it('has every rule\'s aiSummaryCleansing<Key> property set to its defaultEnabled', () => {
    const config = DEFAULT_CLEANSING_CONFIG as Record<string, unknown>;
    for (const rule of CLEANSING_RULES) {
      const prop = `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}`;
      expect(config[prop], `${rule.key} -> ${prop}`).toBe(rule.defaultEnabled);
    }
  });

  it('type-level: all RuleKey entries map to CleansingConfig properties', () => {
    // This is a compile-time assertion: if AssertAllRuleKeysPresent has any
    // missing key, the test file will fail to compile.
    expectTypeOf<AssertAllRuleKeysPresent>().not.toBeNever;
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
