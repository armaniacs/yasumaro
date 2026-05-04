// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeHistoryEntryRow } from '../historyEntryRow.js';
import type { SavedUrlEntry } from '../../utils/storageUrls.js';
import { getMessage } from '../../popup/i18n.js';
import { removeSavedUrl } from '../../utils/storageUrls.js';
import { makeCleansingProgressBar } from '../cleansingStatsView.js';
import { makeRecordTypeBadge, makeMaskBadge, makeCleansedBadge } from '../historyBadges.js';
import { openTagEditModal } from '../historyTagEditModal.js';

vi.mock('../../popup/i18n.js', () => ({
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

function createMockState(overrides: Partial<Record<string, unknown>> = {}) {
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

describe('Basic Structure', () => {
  it('returns an HTMLElement with history-entry class', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row).toBeInstanceOf(HTMLElement);
    expect(row.className).toBe('history-entry');
  });

  it('contains history-entry-info child', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-info')).not.toBeNull();
  });

  it('contains edit and delete buttons', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-delete')).not.toBeNull();
    expect(row.querySelector('.history-entry-edit-btn')).not.toBeNull();
  });
});

describe('URL & Timestamp', () => {
  it('URL anchor has href, target=_blank, rel=noopener noreferrer', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ url: 'https://example.com/page' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const urlEl = row.querySelector('.history-entry-url') as HTMLAnchorElement;
    expect(urlEl).not.toBeNull();
    expect(urlEl.href).toBe('https://example.com/page');
    expect(urlEl.target).toBe('_blank');
    expect(urlEl.rel).toBe('noopener noreferrer');
  });

  it('timestamp matches toLocaleString format', () => {
    const ts = 1705300000000;
    const row = makeHistoryEntryRow(
      createMinimalEntry({ timestamp: ts }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const timeEl = row.querySelector('.history-entry-time');
    expect(timeEl).not.toBeNull();
    expect(timeEl!.textContent).toBe(new Date(ts).toLocaleString());
  });
});

describe('Badges', () => {
  it('makeRecordTypeBadge called with recordType', () => {
    makeHistoryEntryRow(
      createMinimalEntry({ recordType: 'manual' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(makeRecordTypeBadge).toHaveBeenCalledWith('manual');
  });

  it('makeMaskBadge called with maskedCount', () => {
    makeHistoryEntryRow(
      createMinimalEntry({ maskedCount: 5 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(makeMaskBadge).toHaveBeenCalledWith(5);
  });

  it('makeCleansedBadge called with cleansedReason', () => {
    makeHistoryEntryRow(
      createMinimalEntry({ cleansedReason: 'hard' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(makeCleansedBadge).toHaveBeenCalledWith('hard');
  });

  it('mask badge NOT rendered when maskedCount is 0', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ maskedCount: 0 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.mock-mask-badge')).toBeNull();
  });

  it('mask badge NOT rendered when maskedCount is undefined', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.mock-mask-badge')).toBeNull();
  });

  it('cleansed badge NOT rendered when cleansedReason is falsy', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.mock-cleansed-badge')).toBeNull();
  });
});

describe('AI Summary', () => {
  it('renders .history-entry-ai-summary when aiSummary is non-empty', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummary: 'This is a summary' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-ai-summary')).not.toBeNull();
  });

  it('does NOT render summary section when aiSummary is empty', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummary: '' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-ai-summary')).toBeNull();
  });

  it('does NOT render summary section when aiSummary is whitespace', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummary: '   ' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-ai-summary')).toBeNull();
  });
});

describe('Token Display', () => {
  it('shows .history-entry-tokens when sentTokens is present', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ sentTokens: 100 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-tokens')).not.toBeNull();
  });

  it('shows .history-entry-tokens when receivedTokens is present', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ receivedTokens: 200 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-tokens')).not.toBeNull();
  });

  it('shows AI provider/model info when no tokens but aiProvider is set', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiProvider: 'OpenAI', aiModel: 'gpt-4' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const tokensEl = row.querySelector('.history-entry-tokens');
    expect(tokensEl).not.toBeNull();
    expect(tokensEl!.textContent).toContain('OpenAI');
    expect(tokensEl!.textContent).toContain('gpt-4');
  });

  it('does NOT show token section when no token data', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-tokens')).toBeNull();
  });
});

describe('Content Extraction Stats', () => {
  it('shows .history-entry-token-reduction when pageBytes and candidateBytes are present', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ pageBytes: 10000, candidateBytes: 5000 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const reductionEl = row.querySelector('.history-entry-token-reduction');
    expect(reductionEl).not.toBeNull();
    expect(reductionEl!.textContent).toContain('10000');
    expect(reductionEl!.textContent).toContain('5000');
  });

  it('shows reduction percentage correctly', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ pageBytes: 10000, candidateBytes: 5000 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const reductionEl = row.querySelector('.history-entry-token-reduction');
    const reduction = 10000 - 5000;
    const percent = ((reduction / 10000) * 100).toFixed(1);
    expect(reductionEl!.textContent).toContain(`${percent}%`);
  });
});

describe('Content Cleansing Stats', () => {
  it('shows cleansing section when originalTokens and cleansedTokens are present', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ originalTokens: 1000, cleansedTokens: 500 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const text = row.textContent || '';
    expect(text).toContain('Content Cleansing');
  });

  it('shows cleansing section when originalBytes and cleansedBytes are present', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ originalBytes: 2000, cleansedBytes: 1000 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const text = row.textContent || '';
    expect(text).toContain('Content Cleansing');
  });
});

describe('Fallback Triggered', () => {
  it('shows .history-entry-fallback when entry.fallbackTriggered is true', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ fallbackTriggered: true }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-fallback')).not.toBeNull();
  });

  it('does NOT show fallback when fallbackTriggered is false', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ fallbackTriggered: false }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-fallback')).toBeNull();
  });
});

describe('AI Summary Cleansing', () => {
  it('shows cleansing stats when aiSummaryCleansedBytes is present with base', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryCleansedBytes: 200, aiSummaryOriginalBytes: 1000 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.history-entry-ai-summary-cleansing')).not.toBeNull();
  });

  it('shows reason mapping for single reasons', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryCleansedBytes: 100, aiSummaryCleansedReason: 'alt' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing');
    expect(cleansingEl!.textContent).toContain('historyAiSummaryCleansedReasonAlt');
  });

  it('shows multiple reason with first 3 sub-reasons', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({
        aiSummaryCleansedBytes: 100,
        aiSummaryCleansedReason: 'multiple',
        aiSummaryCleansedReasons: ['ads', 'nav', 'social', 'alt'],
      }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing');
    expect(cleansingEl!.textContent).toContain('historyAiSummaryCleansedReasonAds');
    expect(cleansingEl!.textContent).toContain('historyAiSummaryCleansedReasonNav');
    expect(cleansingEl!.textContent).toContain('historyAiSummaryCleansedReasonSocial');
    expect(cleansingEl!.textContent).not.toContain('historyAiSummaryCleansedReasonAlt');
  });

  it('shows aiSummaryCleansedElements count', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummaryCleansedBytes: 100, aiSummaryCleansedElements: 5 }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const cleansingEl = row.querySelector('.history-entry-ai-summary-cleansing');
    expect(cleansingEl!.textContent).toContain('5');
  });
});

describe('Tag Badges', () => {
  it('renders .tag-badges with buttons when tags present', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ tags: ['tech', 'news'] }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const tagBadges = row.querySelector('.tag-badges');
    expect(tagBadges).not.toBeNull();
    expect(tagBadges!.querySelectorAll('.tag-badge').length).toBe(2);
  });

  it('each tag badge has # prefix', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ tags: ['tech'] }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const badge = row.querySelector('.tag-badge');
    expect(badge!.textContent).toContain('#tech');
  });

  it('shows .tag-add-inline-btn when tags is empty', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ tags: [] }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.tag-add-inline-btn')).not.toBeNull();
  });

  it('shows .tag-add-inline-btn when tags is undefined', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.tag-add-inline-btn')).not.toBeNull();
  });

  it('clicking tag badge toggles filter state', () => {
    const entry = createMinimalEntry({ tags: ['tech'] });
    const state = createMockState({ activeTagFilter: null });
    const onTagFilterChange = vi.fn();
    const row = makeHistoryEntryRow(entry, 0, 0, state, createMockElements(), onTagFilterChange, vi.fn());
    const badge = row.querySelector('.tag-badge') as HTMLButtonElement;
    badge.click();
    expect(state.activeTagFilter).toBe('tech');
    expect(onTagFilterChange).toHaveBeenCalled();
    badge.click();
    expect(state.activeTagFilter).toBeNull();
  });
});

describe('Content Toggle', () => {
  it('content toggle button present when content is non-empty', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ content: 'Some content' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.content-toggle-btn')).not.toBeNull();
  });

  it('content toggle button NOT present when content is empty', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ content: '' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.content-toggle-btn')).toBeNull();
  });

  it('clicking toggle shows/hides content', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ content: 'Some content' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const toggle = row.querySelector('.content-toggle-btn') as HTMLButtonElement;
    const contentArea = row.querySelector('.content-preview') as HTMLElement;
    expect(contentArea.classList.contains('hidden')).toBe(true);
    toggle.click();
    expect(contentArea.classList.contains('hidden')).toBe(false);
    toggle.click();
    expect(contentArea.classList.contains('hidden')).toBe(true);
  });

  it('aria-expanded toggles correctly', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ content: 'Some content' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const toggle = row.querySelector('.content-toggle-btn') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('AI Summary Toggle', () => {
  it('summary toggle present when aiSummary is non-empty', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummary: 'AI summary' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const toggles = row.querySelectorAll('.content-toggle-btn');
    expect(toggles.length).toBe(1);
    expect(toggles[0].getAttribute('aria-controls')).toBe('summary-entry-0');
  });

  it('toggle shows/hides summary content', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry({ aiSummary: 'AI summary' }), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    const toggle = row.querySelector('.content-toggle-btn') as HTMLButtonElement;
    const summaryArea = row.querySelector('#summary-entry-0') as HTMLElement;
    expect(summaryArea.classList.contains('hidden')).toBe(true);
    toggle.click();
    expect(summaryArea.classList.contains('hidden')).toBe(false);
  });
});

describe('Delete Button', () => {
  it('calls removeSavedUrl(url) on click', async () => {
    const entry = createMinimalEntry({ url: 'https://example.com/test' });
    const state = createMockState({ entries: [entry] });
    const onApplyFilters = vi.fn();
    const row = makeHistoryEntryRow(entry, 0, 0, state, createMockElements(), vi.fn(), onApplyFilters);
    const deleteBtn = row.querySelector('.history-entry-delete') as HTMLButtonElement;
    deleteBtn.click();
    await vi.waitFor(() => {
      expect(removeSavedUrl).toHaveBeenCalledWith('https://example.com/test');
    });
  });

  it('calls onApplyFilters(false) on click', async () => {
    const entry = createMinimalEntry();
    const state = createMockState({ entries: [entry] });
    const onApplyFilters = vi.fn();
    const row = makeHistoryEntryRow(entry, 0, 0, state, createMockElements(), vi.fn(), onApplyFilters);
    const deleteBtn = row.querySelector('.history-entry-delete') as HTMLButtonElement;
    deleteBtn.click();
    await vi.waitFor(() => {
      expect(onApplyFilters).toHaveBeenCalledWith(false);
    });
  });

  it('removes entry from state.entries', async () => {
    const entry = createMinimalEntry({ url: 'https://example.com/remove-me' });
    const state = createMockState({ entries: [entry, { url: 'https://other.com' } as SavedUrlEntry] });
    const row = makeHistoryEntryRow(entry, 0, 0, state, createMockElements(), vi.fn(), vi.fn());
    expect(state.entries.length).toBe(2);
    const deleteBtn = row.querySelector('.history-entry-delete') as HTMLButtonElement;
    deleteBtn.click();
    await vi.waitFor(() => {
      expect(state.entries.length).toBe(1);
      expect(state.entries[0].url).toBe('https://other.com');
    });
  });
});

describe('Edit Button', () => {
  it('calls openTagEditModal on click with correct args', async () => {
    const entry = createMinimalEntry({ url: 'https://example.com/edit-me', tags: ['tag1'] });
    const state = createMockState();
    const elements = createMockElements();
    const row = makeHistoryEntryRow(entry, 0, 0, state, elements, vi.fn(), vi.fn());
    const editBtn = row.querySelector('.history-entry-edit-btn') as HTMLButtonElement;
    editBtn.click();
    expect(openTagEditModal).toHaveBeenCalledWith(state, elements, 'https://example.com/edit-me', ['tag1']);
  });

  it('passes empty array when tags is undefined', async () => {
    const entry = createMinimalEntry({ url: 'https://example.com' });
    const state = createMockState();
    const elements = createMockElements();
    const row = makeHistoryEntryRow(entry, 0, 0, state, elements, vi.fn(), vi.fn());
    const editBtn = row.querySelector('.history-entry-edit-btn') as HTMLButtonElement;
    editBtn.click();
    expect(openTagEditModal).toHaveBeenCalledWith(state, elements, 'https://example.com', []);
  });
});

describe('Progress Bar', () => {
  it('makeCleansingProgressBar called with entry', () => {
    const entry = createMinimalEntry();
    makeHistoryEntryRow(entry, 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn());
    expect(makeCleansingProgressBar).toHaveBeenCalledWith(entry);
  });

  it('progress bar appended when return value is truthy', () => {
    const row = makeHistoryEntryRow(
      createMinimalEntry(), 0, 0, createMockState(), createMockElements(), vi.fn(), vi.fn(),
    );
    expect(row.querySelector('.mock-progress-bar')).not.toBeNull();
  });
});
