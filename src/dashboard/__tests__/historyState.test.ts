// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createInitialState, getCachedMessage, HISTORY_PAGE_SIZE } from '../historyState.js';

vi.mock('../popup/i18n.js', () => ({
  getMessage: (key: string) => `i18n_${key}`,
}));

describe('HISTORY_PAGE_SIZE', () => {
  it('is 10', () => {
    expect(HISTORY_PAGE_SIZE).toBe(10);
  });
});

describe('createInitialState', () => {
  it('creates initial state with defaults', () => {
    const state = createInitialState();
    expect(state.entries).toEqual([]);
    expect(state.activeFilter).toBe('all');
    expect(state.activeTagFilter).toBeNull();
    expect(state.historyCurrentPage).toBe(0);
    expect(state.pendingPages).toEqual([]);
    expect(state.pendingUrlSet).toBeInstanceOf(Set);
    expect(state.editingUrl).toBeNull();
    expect(state.editingTags).toEqual([]);
    expect(state.tagEditTrapId).toBeNull();
  });
});

describe('getCachedMessage', () => {
  it('caches and returns same value on second call', () => {
    const first = getCachedMessage('uniqueKey', 'fallback1');
    const second = getCachedMessage('uniqueKey', 'fallback2');
    expect(second).toBe(first);
    expect(second).not.toBe('fallback2');
  });
});
