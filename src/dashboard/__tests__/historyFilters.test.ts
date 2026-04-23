// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  getFilteredEntries,
  renderPendingReason,
  updateTagFilterIndicator,
} from '../historyFilters.js';
import type { SavedUrlEntry } from '../../utils/storageUrls.js';

vi.mock('../../popup/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

describe('getFilteredEntries', () => {
  const entries: SavedUrlEntry[] = [
    { url: 'https://example.com/1', title: 'Test 1', timestamp: 1, recordType: 'auto' },
    { url: 'https://example.com/2', title: 'Test 2', timestamp: 2, recordType: 'manual' },
    { url: 'https://example.com/3', title: 'Test 3', timestamp: 3, maskedCount: 5 },
    { url: 'https://example.com/4', title: 'Test 4', timestamp: 4, cleansedReason: 'hard' },
    { url: 'https://tag.com/5', title: 'Test 5', timestamp: 5, tags: ['tech'] },
  ] as SavedUrlEntry[];

  it('returns all entries when filter is all', () => {
    expect(getFilteredEntries(entries, 'all', null, '').length).toBe(5);
  });

  it('filters by auto recordType', () => {
    const result = getFilteredEntries(entries, 'auto', null, '');
    expect(result.length).toBe(4); // auto + entries without explicit recordType
    expect(result[0].url).toBe('https://example.com/1');
  });

  it('filters by manual recordType', () => {
    const result = getFilteredEntries(entries, 'manual', null, '');
    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://example.com/2');
  });

  it('filters by masked', () => {
    const result = getFilteredEntries(entries, 'masked', null, '');
    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://example.com/3');
  });

  it('filters by cleansed', () => {
    const result = getFilteredEntries(entries, 'cleansed', null, '');
    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://example.com/4');
  });

  it('filters by search text', () => {
    const result = getFilteredEntries(entries, 'all', null, 'tag');
    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://tag.com/5');
  });

  it('filters by tag', () => {
    const result = getFilteredEntries(entries, 'all', 'tech', '');
    expect(result.length).toBe(1);
    expect(result[0].url).toBe('https://tag.com/5');
  });

  it('returns empty for unmatched tag', () => {
    expect(getFilteredEntries(entries, 'all', 'nonexistent', '').length).toBe(0);
  });
});

describe('renderPendingReason', () => {
  it('returns localized cache-control reason', () => {
    expect(renderPendingReason('cache-control')).toBe('i18n_pendingReasonCache');
  });

  it('returns localized set-cookie reason', () => {
    expect(renderPendingReason('set-cookie')).toBe('i18n_pendingReasonCookie');
  });

  it('returns localized authorization reason', () => {
    expect(renderPendingReason('authorization')).toBe('i18n_pendingReasonAuth');
  });

  it('returns raw reason for unknown', () => {
    expect(renderPendingReason('unknown')).toBe('unknown');
  });
});

describe('updateTagFilterIndicator', () => {
  it('creates indicator when tag filter is active', () => {
    document.body.innerHTML = '<div class="history-controls"></div>';
    const state = { activeTagFilter: 'tech' } as Parameters<typeof updateTagFilterIndicator>[0];
    updateTagFilterIndicator(state, () => {});
    expect(document.getElementById('tagFilterIndicator')).not.toBeNull();
  });

  it('removes existing indicator when tag filter is null', () => {
    document.body.innerHTML = '<div class="history-controls"></div>';
    const state1 = { activeTagFilter: 'tech' } as Parameters<typeof updateTagFilterIndicator>[0];
    updateTagFilterIndicator(state1, () => {});
    const state2 = { activeTagFilter: null } as Parameters<typeof updateTagFilterIndicator>[0];
    updateTagFilterIndicator(state2, () => {});
    expect(document.getElementById('tagFilterIndicator')).toBeNull();
  });
});
