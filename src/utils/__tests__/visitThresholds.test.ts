import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/defaults.js';
import { StorageKeys } from '../storage/types.js';
import { DEFAULT_MIN_SCROLL_DEPTH, DEFAULT_MIN_VISIT_DURATION } from '../visitThresholds.js';

/**
 * visitThresholds.test.ts (PBI 2026-09-28-28)
 *
 * The static fallback constants and DEFAULT_SETTINGS must agree: content
 * scripts read the constants, repository readers fall back to DEFAULT_SETTINGS.
 * A silent divergence reintroduces the threshold mismatch this PBI removes.
 */
describe('visitThresholds', () => {
  it('matches DEFAULT_SETTINGS entries', () => {
    expect(DEFAULT_MIN_VISIT_DURATION).toBe(DEFAULT_SETTINGS[StorageKeys.MIN_VISIT_DURATION]);
    expect(DEFAULT_MIN_SCROLL_DEPTH).toBe(DEFAULT_SETTINGS[StorageKeys.MIN_SCROLL_DEPTH]);
  });

  it('holds sane magnitudes', () => {
    expect(DEFAULT_MIN_VISIT_DURATION).toBeGreaterThan(0);
    expect(DEFAULT_MIN_SCROLL_DEPTH).toBeGreaterThan(0);
    expect(DEFAULT_MIN_SCROLL_DEPTH).toBeLessThanOrEqual(100);
  });
});
