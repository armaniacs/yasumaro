// @vitest-environment jsdom
/**
 * sqliteHistoryPanel-rendering.test.ts
 * Tests for the diagnostic metadata rendering in sqliteHistoryPanel
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _test } from '../sqliteHistoryPanel.js';
import type { BrowsingLogEntry } from '../dashboardSqliteService.js';

const { formatDiagnosticMetadataHtml, buildCleansingProgressBarHtml, updateTagFilterBar, renderCalendarNav } = _test;

// Mock chrome.i18n.getMessage for tests that render HTML
beforeEach(() => {
  (globalThis as any).chrome = {
    i18n: {
      getMessage: vi.fn((key: string) => {
        const defaults: Record<string, string> = {
          historyToday: 'Today',
          historyYesterday: 'Yesterday',
          historyLast7Days: 'Last 7 days',
          historyLast30Days: 'Last 30 days',
          clearAllFilters: 'Clear all filters',
          historyDateYear: '年',
          historyDateMonth: '月',
          historyDateDay: '日',
          clearTagFilter: 'Clear tag filter',
        };
        return defaults[key] || key;
      }),
    },
    runtime: { getURL: vi.fn((p: string) => p) },
  };
});

describe('formatDiagnosticMetadataHtml', () => {
  it('returns empty string when no metric data is present', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toBe('');
  });

  it('renders AI summary in styled box', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      summary: 'This is a test summary',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-ai-summary');
    expect(html).toContain('This is a test summary');
  });

  it('renders token info with sent/received tokens, duration, and AI provider', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      sent_tokens: 328,
      received_tokens: 278,
      ai_duration_ms: 1300,
      ai_provider: 'openai',
      ai_model: 'gpt-oss-120b',
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-tokens');
    expect(html).toContain('328');
    expect(html).toContain('278');
    expect(html).toContain('1.3秒');
    expect(html).toContain('openai');
    expect(html).toContain('gpt-oss-120b');
  });

  it('renders content extraction byte reduction', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      page_bytes: 324740,
      candidate_bytes: 190,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-token-reduction');
    expect(html).toContain('324740');
    expect(html).toContain('190');
    expect(html).toContain('99.9%');
  });

  it('renders Content Cleansing metrics', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      original_tokens: 48,
      cleansed_tokens: 48,
      original_bytes: 184,
      cleansed_bytes: 184,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('Content Cleansing');
    expect(html).toContain('48');
    expect(html).toContain('184');
  });

  it('renders AI Summary Cleansing metrics', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      ai_summary_original_bytes: 184,
      ai_summary_cleansed_bytes: 184,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-ai-summary-cleansing');
    expect(html).toContain('184');
  });

  it('renders cleansing progress bar', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      page_bytes: 324740,
      candidate_bytes: 190,
      ai_summary_cleansed_bytes: 184,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('cleansing-progress-wrapper');
    expect(html).toContain('cleansing-progress-bar');
  });

  it('renders all metrics together for a fully-populated entry', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      summary: 'Test summary',
      sent_tokens: 328,
      received_tokens: 278,
      ai_duration_ms: 1300,
      ai_provider: 'openai',
      ai_model: 'gpt-oss-120b',
      page_bytes: 324740,
      candidate_bytes: 190,
      original_tokens: 48,
      cleansed_tokens: 48,
      original_bytes: 184,
      cleansed_bytes: 184,
      ai_summary_original_bytes: 184,
      ai_summary_cleansed_bytes: 184,
    };
    const html = formatDiagnosticMetadataHtml(entry);
    expect(html).toContain('history-entry-ai-summary');
    expect(html).toContain('history-entry-tokens');
    expect(html).toContain('history-entry-token-reduction');
    expect(html).toContain('history-entry-ai-summary-cleansing');
    expect(html).toContain('cleansing-progress-wrapper');
  });
});

describe('buildCleansingProgressBarHtml', () => {
  it('returns empty string when page_bytes is missing', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
    };
    expect(buildCleansingProgressBarHtml(entry)).toBe('');
  });

  it('returns HTML when page_bytes and sentToAI are present', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://example.com',
      created_at: Date.now(),
      page_bytes: 324740,
      ai_summary_cleansed_bytes: 184,
    };
    const html = buildCleansingProgressBarHtml(entry);
    expect(html).toContain('cleansing-progress-wrapper');
    expect(html).toContain('cleansing-progress-bar');
  });
});

describe('updateTagFilterBar', () => {
  it('removes existing bar when activeTagFilter is null', () => {
    const container = document.createElement('div');
    const existingBar = document.createElement('div');
    existingBar.id = 'sqlite-tag-filter-bar';
    container.appendChild(existingBar);

    updateTagFilterBar(container, null, vi.fn());

    expect(container.querySelector('#sqlite-tag-filter-bar')).toBeNull();
  });

  it('creates tag filter bar when activeTagFilter is set', () => {
    const container = document.createElement('div');
    updateTagFilterBar(container, 'test-tag', vi.fn());

    const bar = container.querySelector('#sqlite-tag-filter-bar');
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain('test-tag');
  });

  it('calls onClear when clear button is clicked', () => {
    const container = document.createElement('div');
    const onClear = vi.fn();
    updateTagFilterBar(container, 'test-tag', onClear);

    const clearBtn = container.querySelector('#sqlite-tag-filter-clear') as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    clearBtn.click();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('does not recreate bar if active tag is unchanged', () => {
    const container = document.createElement('div');
    updateTagFilterBar(container, 'tag1', vi.fn());
    const firstBar = container.querySelector('#sqlite-tag-filter-bar');
    updateTagFilterBar(container, 'tag1', vi.fn());
    const secondBar = container.querySelector('#sqlite-tag-filter-bar');
    expect(secondBar).toBe(firstBar);
  });
});

describe('renderCalendarNav', () => {
  it('renders calendar with month heading', () => {
    const container = document.createElement('div');
    renderCalendarNav(container, '2026-07-13',
      { searchQuery: '', activeTagFilter: null },
      { onDateSelect: vi.fn(), onRangeSelect: vi.fn(), onClearFilters: vi.fn() },
    );

    expect(container.querySelector('.sqlite-calendar-days')).not.toBeNull();
    expect(container.textContent).toContain('2026-07');
  });

  it('shows clear filters button when date filter is active', () => {
    const container = document.createElement('div');
    renderCalendarNav(container, '2026-07-13',
      { searchQuery: '', activeTagFilter: null },
      { onDateSelect: vi.fn(), onRangeSelect: vi.fn(), onClearFilters: vi.fn() },
    );

    const clearBtn = container.querySelector('#sqlite-clear-all-filters');
    expect(clearBtn).not.toBeNull();
  });

  it('hides clear filters button when no filters are active', () => {
    const container = document.createElement('div');
    renderCalendarNav(container, null,
      { searchQuery: '', activeTagFilter: null },
      { onDateSelect: vi.fn(), onRangeSelect: vi.fn(), onClearFilters: vi.fn() },
    );

    const clearBtn = container.querySelector('#sqlite-clear-all-filters');
    expect(clearBtn).toBeNull();
  });
});
