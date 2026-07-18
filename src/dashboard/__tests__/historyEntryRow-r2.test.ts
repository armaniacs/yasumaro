// @vitest-environment jsdom
/**
 * historyEntryRow-r2.test.ts
 * R2: Cover remaining branches — tag badge active state, content toggle ID
 * uniqueness, aiDuration/aiProvider-only display, byte reduction edge cases,
 * AI summary cleansing reason=none, and event-handler wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeHistoryEntryRow } from '../historyEntryRow.js';
import type { SavedUrlEntry } from '../../utils/storageUrls.js';
import { openTagEditModal } from '../historyTagEditModal.js';
import { removeSavedUrl } from '../../utils/storageUrls.js';

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key, subs) => subs ? `${key}:${subs}` : key),
}));

vi.mock('../../utils/storageUrls.js', () => ({
  removeSavedUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../cleansingStatsView.js', () => ({
  makeCleansingProgressBar: vi.fn(() => {
    const el = document.createElement('div');
    el.className = 'mock-progress-bar';
    return el;
  }),
}));

vi.mock('../historyBadges.js', () => ({
  makeRecordTypeBadge: vi.fn(() => {
    const el = document.createElement('span');
    el.className = 'mock-record-badge';
    return el;
  }),
  makeMaskBadge: vi.fn((count) => {
    if (!count) return null;
    const el = document.createElement('span');
    el.className = 'mock-mask-badge';
    return el;
  }),
  makeCleansedBadge: vi.fn((reason) => {
    if (!reason) return null;
    const el = document.createElement('span');
    el.className = 'mock-cleansed-badge';
    return el;
  }),
}));

vi.mock('../historyTagEditModal.js', () => ({
  openTagEditModal: vi.fn(),
}));

vi.mock('../historyState.js', () => ({
  getCachedMessage: vi.fn((key, fallback) => fallback || key),
}));

function createMinimalEntry(overrides: Partial<SavedUrlEntry> = {}): SavedUrlEntry {
  return {
    url: 'https://example.com',
    timestamp: 1705300000000,
    recordType: 'normal',
    ...overrides,
  } as SavedUrlEntry;
}

function createMockState(overrides: Record<string, unknown> = {}) {
  return {
    activeTagFilter: null,
    entries: [],
    historyCurrentPage: 0,
    ...overrides,
  };
}

function createMockElements() {
  return {
    tagEditModal: document.createElement('div'),
    tagEditUrl: document.createElement('div'),
    currentTagsList: document.createElement('div'),
    noCurrentTagsMsg: document.createElement('div'),
    tagCategorySelect: document.createElement('select'),
    addTagBtn: document.createElement('button'),
    closeTagEditModalBtn: document.createElement('button'),
    saveTagEditsBtn: document.createElement('button'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('historyEntryRow-r2 — Tag badge active state', () => {
  it('adds filter-active class when activeTagFilter matches', () => {
    const state = createMockState({ activeTagFilter: 'tech' });
    const row = makeHistoryEntryRow(
      createMinimalEntry({ tags: ['tech', 'news'] }), 0, 0, state, createMockElements(), vi.fn(), vi.fn(),
    );
    const badges = row.querySelectorAll('.tag-badge') as NodeListOf<HTMLButtonElement>;
    expect(badges[0].classList.contains('filter-active')).toBe(true);
    expect(badges[0].getAttribute('aria-pressed')).toBe('true');
    expect(badges[1].classList.contains('filter-active')).toBe(false);
    expect(badges[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking tag badge toggles filter and resets page', () => {
    const state = createMockState({ activeTagFilter: 'tech', historyCurrentPage: 3 });
    const onTagFilterChange = vi.fn();
    const row = makeHistoryEntryRow(
      createMinimalEntry({ tags: ['tech', 'news'] }), 0, 0, state, createMockElements(), onTagFilterChange, vi.fn(),
    );
    const newsBadge = row.querySelectorAll('.tag-badge')[1] as HTMLButtonElement;
    newsBadge.click();
    expect(state.activeTagFilter).toBe('news');
    expect(state.historyCurrentPage).toBe(0);
    expect(onTagFilterChange).toHaveBeenCalled();
  });

  it('clicking already-active tag badge clears filter', () => {
    const state = createMockState({ activeTagFilter: 'tech' });
    const onTagFilterChange = vi.fn();
    const row = makeHistoryEntryRow(
      createMinimalEntry({ tags: ['tech'] }), 0, 0, state, createMockElements(), onTagFilterChange, vi.fn(),
    );
    const badge = row.querySelector('.tag-badge') as HTMLButtonElement;
    badge.click();
    expect(state.activeTagFilter).toBeNull();
  });
});

describe('historyEntryRow-r2 — Token display with aiDuration and aiProvider', () => {
  it('shows aiDuration in token display when present with sentTokens', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ sentTokens: 100, receivedTokens: 200, aiDuration: 1500 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const tokensEl = row.querySelector('.history-entry-tokens')!;
    expect(tokensEl.textContent).toContain('1.5');
  });

  it('shows aiProvider/model with duration when no token data', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiProvider: 'OpenAI', aiModel: 'gpt-4', aiDuration: 2500 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const tokensEl = row.querySelector('.history-entry-tokens')!;
    expect(tokensEl.textContent).toContain('OpenAI');
    expect(tokensEl.textContent).toContain('gpt-4');
    expect(tokensEl.textContent).toContain('2.5');
  });

  it('shows aiProvider without model when aiModel is undefined and no tokens', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiProvider: 'Gemini' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const tokensEl = row.querySelector('.history-entry-tokens')!;
    expect(tokensEl.textContent).toContain('Gemini');
  });
});

describe('historyEntryRow-r2 — Content extraction edge cases', () => {
  it('calculates reduction percentage correctly at 0% reduction', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ pageBytes: 100, candidateBytes: 100 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const reductionEl = row.querySelector('.history-entry-token-reduction')!;
    expect(reductionEl.textContent).toContain('0.0%');
  });
});

describe('historyEntryRow-r2 — Content cleansing edge cases', () => {
  it('shows 0.0% reduction when originalBytes is 0 with candidateBytes as base', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ originalBytes: 0, cleansedBytes: 0, candidateBytes: 100, pageBytes: 100, originalTokens: 10, cleansedTokens: 5 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const text = row.textContent!;
    expect(text).toContain('Content Cleansing');
    expect(text).toContain('0.0');
  });

  it('shows cleansing with only originalBytes/cleansedBytes (no tokens)', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ originalBytes: 5000, cleansedBytes: 3000 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const text = row.textContent!;
    expect(text).toContain('Content Cleansing');
    expect(text).toContain('3000');
  });

  it('uses candidateBytes as fallback for originalBytes in AI summary cleansing', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ candidateBytes: 4000, cleansedBytes: undefined, originalBytes: undefined, aiSummaryCleansedBytes: 1000 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl).not.toBeNull();
  });
});

describe('historyEntryRow-r2 — AI summary cleansing reason=none', () => {
  it('does not show reason when aiSummaryCleansedReason is "none"', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryCleansedBytes: 100, aiSummaryCleansedReason: 'none', aiSummaryCleansedElements: 3 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).toContain('3要素削除');
    expect(cleansingEl.textContent).not.toContain('理由');
  });
});

describe('historyEntryRow-r2 — content toggle ID uniqueness', () => {
  it('creates content toggle with unique id based on start+index', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ content: 'visible content', aiSummary: 'AI summary' }), 1, 5, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const contentArea = row.querySelector('#content-entry-6')!;
    expect(contentArea).not.toBeNull();
    const summaryArea = row.querySelector('#summary-entry-6')!;
    expect(summaryArea).not.toBeNull();
  });
});

describe('historyEntryRow-r2 — No tag badges when tags empty', () => {
  it('shows add-tag button when tags is empty array', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ tags: [] }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.tag-add-inline-btn')).not.toBeNull();
  });

  it('add-tag button click opens tag edit modal with empty tags', () => {
    const state = createMockState();
    const elements = createMockElements();
    const row = makeHistoryEntryRow(
      createMinimalEntry({ url: 'https://example.com', tags: [] }), 0, 0, state, elements, vi.fn(), vi.fn(),
    );
    row.querySelector('.tag-add-inline-btn')!.click();
    expect(openTagEditModal).toHaveBeenCalledWith(state, elements, 'https://example.com', []);
  });
});

describe('historyEntryRow-r2 — Delete button wiring', () => {
  it('removes entry from state even when not found', async () => {
    const entry = createMinimalEntry({ url: 'https://example.com' });
    const state = createMockState({ entries: [] });
    const onApplyFilters = vi.fn();
    const row = makeHistoryEntryRow(entry, 0, 0, state, createMockElements(), vi.fn(), onApplyFilters);
    (row.querySelector('.history-entry-delete') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(removeSavedUrl).toHaveBeenCalledWith('https://example.com');
    });
  });
});

describe('historyEntryRow-r2 — Edit button wiring', () => {
  it('click calls openTagEditModal with tags array', () => {
    const state = createMockState();
    const elements = createMockElements();
    const row = makeHistoryEntryRow(
      createMinimalEntry({ url: 'https://test.com', tags: ['a', 'b'] }), 0, 0, state, elements, vi.fn(), vi.fn(),
    );
    (row.querySelector('.history-entry-edit-btn') as HTMLButtonElement).click();
    expect(openTagEditModal).toHaveBeenCalledWith(state, elements, 'https://test.com', ['a', 'b']);
  });

  it('edit button has correct aria-label', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const editBtn = row.querySelector('.history-entry-edit-btn') as HTMLButtonElement;
    expect(editBtn.getAttribute('aria-label')).toBe('editTags');
  });
});
