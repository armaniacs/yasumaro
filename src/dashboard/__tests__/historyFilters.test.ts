// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { shouldFallbackToTextSearch } from '../historyFilters.js';

/**
 * PBI 2026-09-11-09: after the legacy panel-history removal only the
 * SQLite panel's tag-fallback decision survives in historyFilters.ts.
 * The getFilteredEntries / updateTagFilterIndicator / renderPendingReason
 * re-export tests were deleted with the legacy panel.
 */
describe('shouldFallbackToTextSearch', () => {
  it('returns null for a manual source', () => {
    expect(shouldFallbackToTextSearch('manual', { rows: [], total: 0 }, 'AI')).toBeNull();
  });

  it('returns null when the tag filter has hits', () => {
    expect(shouldFallbackToTextSearch('tag', { rows: [1], total: 1 }, 'AI')).toBeNull();
  });

  it('returns the trimmed tag (leading # stripped) when the tag filter is empty', () => {
    expect(shouldFallbackToTextSearch('tag', { rows: [], total: 0 }, '#教育')).toBe('教育');
    expect(shouldFallbackToTextSearch('tag', { rows: [], total: 0 }, '  AI  ')).toBe('AI');
  });

  it('returns null for an empty tag', () => {
    expect(shouldFallbackToTextSearch('tag', { rows: [], total: 0 }, '#')).toBeNull();
    expect(shouldFallbackToTextSearch('tag', { rows: [], total: 0 }, null)).toBeNull();
  });
});
