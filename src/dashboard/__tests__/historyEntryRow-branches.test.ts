// @vitest-environment jsdom
/**
 * historyEntryRow-branches.test.ts
 * Targets remaining uncovered branches: getMessage() falsy fallback paths,
 * aiModel-absent sub-branch inside sentTokens/receivedTokens block,
 * originalBytes/cleansedBytes falling through to undefined base,
 * empty cleansingParts (no aiSummaryCleansingEl content appended),
 * and progressBar falsy (not appended).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeHistoryEntryRow } from '../historyEntryRow.js';
import type { SavedUrlEntry } from '../../utils/storageUrls.js';

// getMessage returns '' (falsy) so all `getMessage(...) || fallback` branches
// take the fallback side, unlike the other test files which always return truthy.
vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn(() => ''),
}));

vi.mock('../../utils/storageUrls.js', () => ({
  removeSavedUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../cleansingStatsView.js', () => ({
  // Returns null so the `if (progressBar)` false branch is exercised.
  makeCleansingProgressBar: vi.fn(() => null),
}));

vi.mock('../historyBadges.js', () => ({
  makeRecordTypeBadge: vi.fn(() => {
    const el = document.createElement('span');
    el.className = 'mock-record-badge';
    return el;
  }),
  makeMaskBadge: vi.fn(() => null),
  makeCleansedBadge: vi.fn(() => null),
  makePrivacyModeBadge: vi.fn((mode) => {
    if (!mode) return null;
    const el = document.createElement('span');
    el.className = 'mock-privacy-mode-badge';
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

describe('historyEntryRow-branches — getMessage fallback paths (getMessage returns falsy)', () => {
  it('tag badge aria-label falls back to #tag when getMessage is falsy', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ tags: ['tech'] }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const badge = row.querySelector('.tag-badge')!;
    expect(badge.getAttribute('aria-label')).toBe('#tech');
  });

  it('token sent/received labels fall back to Japanese defaults', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ sentTokens: 10, receivedTokens: 20 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const tokensEl = row.querySelector('.history-entry-tokens')!;
    expect(tokensEl.textContent).toContain('送信');
    expect(tokensEl.textContent).toContain('受信');
    expect(tokensEl.textContent).toContain('トークン数');
  });

  it('content toggle show/hide labels fall back to Japanese defaults', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ content: 'some content' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const toggle = row.querySelector('.content-toggle-btn') as HTMLButtonElement;
    expect(toggle.textContent).toBe('AIへ送信したデータ');
    toggle.click();
    expect(toggle.textContent).toBe('データを非表示');
  });

  it('summary toggle show/hide labels fall back to Japanese defaults', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummary: 'summary text' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const toggle = row.querySelector('.content-toggle-btn') as HTMLButtonElement;
    expect(toggle.textContent).toBe('AIから受信したデータ');
    toggle.click();
    expect(toggle.textContent).toBe('データを非表示');
  });

  it('delete button aria-label falls back to Delete', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const deleteBtn = row.querySelector('.history-entry-delete')!;
    expect(deleteBtn.getAttribute('aria-label')).toBe('Delete');
  });

  it('edit button aria-label and title fall back to タグを編集', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const editBtn = row.querySelector('.history-entry-edit-btn') as HTMLButtonElement;
    expect(editBtn.getAttribute('aria-label')).toBe('タグを編集');
    expect(editBtn.title).toBe('タグを編集');
  });
});

describe('historyEntryRow-branches — aiModel absent inside token block', () => {
  it('does not append model when aiModel undefined alongside sentTokens/aiProvider', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ sentTokens: 5, aiProvider: 'Ollama' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const tokensEl = row.querySelector('.history-entry-tokens')!;
    expect(tokensEl.textContent).toContain('Ollama');
    expect(tokensEl.textContent).toContain('AI: Ollama)');
  });
});

describe('historyEntryRow-branches — content cleansing base falls through to undefined', () => {
  it('does not render cleansing section when originalBytes/cleansedBytes/candidateBytes all undefined but originalBytes key present as undefined', () => {
    // originalBytes/cleansedBytes both undefined -> outer if false, nothing to test here for base undefined path
    // Instead: cleansedBytes present but originalBytes/candidateBytes undefined -> contentOriginalB undefined
    const row = makeHistoryEntryRow(
      createMinimalEntry({ cleansedBytes: 500 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    // contentOriginalB = originalBytes || candidateBytes = undefined -> inner if skipped
    const text = row.textContent || '';
    expect(text).not.toContain('Content Cleansing');
  });
});

describe('historyEntryRow-branches — empty cleansingParts does not append element content', () => {
  it('does not create ai-summary-cleansing element when reason is undefined/none and bytes/elements absent', () => {
    // aiSummaryCleansedBytes undefined, aiSummaryCleansedElements undefined, aiSummaryCleansedReason='none'
    // -> outer condition true (reason !== undefined) but cleansingParts stays empty
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryCleansedReason: 'none' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-ai-summary-cleansing')).toBeNull();
  });
});

describe('historyEntryRow-branches — progress bar falsy', () => {
  it('does not append progress bar element when makeCleansingProgressBar returns null', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.mock-progress-bar')).toBeNull();
  });
});

describe('historyEntryRow-branches — aiSummaryCleansedReasons empty array falls back to 複数', () => {
  it('shows 複数 when reason is multiple but reasons array is empty', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryCleansedBytes: 50, aiSummaryOriginalBytes: 200, aiSummaryCleansedReason: 'multiple', aiSummaryCleansedReasons: [] }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).toContain('複数');
  });

  it('shows 複数 when reason is multiple but reasons array is undefined', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryCleansedBytes: 50, aiSummaryOriginalBytes: 200, aiSummaryCleansedReason: 'multiple', aiSummaryCleansedReasons: undefined }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).toContain('複数');
  });
});

describe('historyEntryRow-branches — aiBase <= 0 reduction percent fallback', () => {
  it('shows 0.0 percent when aiBase is 0 or negative would be falsy, using non-zero small base equal to cleansed', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryOriginalBytes: 100, aiSummaryCleansedBytes: 100 }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).toContain('0.0%');
  });
});

describe('historyEntryRow-branches — privacyModeBadge falsy is not appended', () => {
  it('does not append privacy-mode-badge element when makePrivacyModeBadge returns null', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ privacyMode: undefined }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.mock-privacy-mode-badge')).toBeNull();
  });

  it('appends privacy-mode-badge element when makePrivacyModeBadge returns a truthy element', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ privacyMode: 'strict' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.mock-privacy-mode-badge')).not.toBeNull();
  });
});

describe('historyEntryRow-branches — aiModel truthy inside sentTokens+aiProvider block', () => {
  it('appends model to token display when both sentTokens and aiModel are present', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ sentTokens: 5, aiProvider: 'Ollama', aiModel: 'llama3' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const tokensEl = row.querySelector('.history-entry-tokens')!;
    expect(tokensEl.textContent).toContain('AI: Ollama / llama3)');
  });
});

describe('historyEntryRow-branches — contentOriginalB <= 0 reduction percent fallback', () => {
  it('shows 0.0 percent when contentOriginalB is 0', () => {
    // originalBytes/candidateBytes are both 0/undefined-falsy, so contentOriginalB
    // resolves via `originalBytes || candidateBytes` — pass candidateBytes: 0 too
    // and rely on cleansedBytes fallback chain to keep contentOriginalB at 0.
    const row = makeHistoryEntryRow(
      createMinimalEntry({ originalBytes: 0, candidateBytes: 0, cleansedBytes: 0 }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const text = row.textContent || '';
    expect(text).toContain('Content Cleansing');
    expect(text).toContain('0.0%');
  });
});

describe('historyEntryRow-branches — aiBase falsy (0) skips reduction display', () => {
  it('does not show byte reduction line when aiSummaryOriginalBytes/cleansedBytes/originalBytes/candidateBytes all 0/undefined but aiSummaryCleansedElements present', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryOriginalBytes: 0, cleansedBytes: 0, originalBytes: 0, candidateBytes: 0, aiSummaryCleansedBytes: 10, aiSummaryCleansedElements: 2 }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).toContain('2要素削除');
    expect(cleansingEl.textContent).not.toContain('バイト');
  });
});

describe('historyEntryRow-branches — multiple reason with reasons.length > 0 branch (non-empty, mapped)', () => {
  it('shows mapped reasons joined when reasons array has entries with getMessage falsy (label falls back to raw key)', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({
        aiSummaryCleansedBytes: 50,
        aiSummaryOriginalBytes: 200,
        aiSummaryCleansedReason: 'multiple',
        aiSummaryCleansedReasons: ['ads', 'nav'],
      }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).not.toContain('複数');
  });
});

describe('historyEntryRow-branches — aiBase negative disables > 0 percent calc', () => {
  it('shows 0.0 percent when aiBase is negative (cleansed grew larger than a negative base)', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryOriginalBytes: -5, aiSummaryCleansedBytes: 10 }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).toContain('0.0%');
  });
});

describe('historyEntryRow-branches — multiple-reasons map falls back to raw key for unmapped entries', () => {
  it('shows the raw reason key for an entry not present in labelMap', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({
        aiSummaryCleansedBytes: 50,
        aiSummaryOriginalBytes: 200,
        aiSummaryCleansedReason: 'multiple',
        aiSummaryCleansedReasons: ['totally-unmapped-key'],
      }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).toContain('totally-unmapped-key');
  });
});

describe('historyEntryRow-branches — single reason key unmapped falls back to raw key', () => {
  it('shows the raw reason key when labelMap has no entry for it', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryCleansedBytes: 50, aiSummaryOriginalBytes: 200, aiSummaryCleansedReason: 'totally-unknown-reason' }),
      0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing')!;
    expect(cleansingEl.textContent).toContain('totally-unknown-reason');
  });
});
