import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
const mockGenerateSummary = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    REVIEW_SUMMARY_ENABLED: 'review_summary_enabled',
    REVIEW_SUMMARY_LAST_GENERATED_WEEK: 'review_summary_last_generated_week',
    REVIEW_SUMMARY_LAST_GENERATED_MONTH: 'review_summary_last_generated_month',
    LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
  },
  getSettings: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn().mockResolvedValue(undefined),
  LogType: { INFO: 'INFO', ERROR: 'ERROR', WARN: 'WARN' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../aiClient.js', () => ({
  AIClient: class MockAIClient {
    generateSummary = mockGenerateSummary;
  },
}));

vi.mock('../sqliteClient.js', () => {
  class MockSqliteClient {
    query = mockQuery;
  }
  return {
    SqliteClient: MockSqliteClient,
    getSharedSqliteClient: () => new MockSqliteClient(),
  };
});

import { generateWeeklySummary, generateMonthlySummary, generateStatsSection, generateReviewMarkdown } from '../reviewSummaryGenerator.js';
import { getSettings } from '../../utils/storage.js';
import { addLog } from '../../utils/logger.js';

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    url: 'https://example.com/article',
    title: 'Example Article',
    summary: 'This is a summary.',
    tags: '#example',
    created_at: Date.now(),
    domain: 'example.com',
    visit_duration: 30000,
    scroll_ratio: 0.8,
    is_starred: 0,
    ...overrides,
  };
}

describe('generateWeeklySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).chrome.downloads = {
      download: vi.fn().mockResolvedValue({}),
    };
    (globalThis as any).chrome.storage.local.set = vi.fn().mockResolvedValue(undefined);
  });

  it('returns false when feature is disabled', async () => {
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: false } as any);
    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
    expect(addLog).toHaveBeenCalledWith('INFO', 'Weekly review summary is disabled');
  });

  it('returns false when already generated for this week', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      review_summary_last_generated_week: '2026-W28',
    } as any);
    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
    expect(addLog).toHaveBeenCalledWith('INFO', 'Weekly summary already generated for this week', expect.any(Object));
  });

  it('returns false when query returns null', async () => {
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: true } as any);
    mockQuery.mockResolvedValueOnce(null);
    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
  });

  it('returns false when entries array is empty', async () => {
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: true } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], total: 0 });
    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
  });

  it('generates digest using AI when summaries exist', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    mockQuery.mockResolvedValueOnce({
      rows: [makeEntry({ summary: 'First page summary' }), makeEntry({ summary: 'Second page summary' })],
      total: 2,
    });
    mockGenerateSummary.mockResolvedValueOnce({ success: true, summary: 'AI digest text' });

    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(true);
    expect(mockGenerateSummary).toHaveBeenCalled();
    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalled();
  });

  it('uses fallback digest when all entry summaries are null', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    mockQuery.mockResolvedValueOnce({
      rows: [makeEntry({ summary: null }), makeEntry({ summary: null })],
      total: 2,
    });

    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(true);
    expect(mockGenerateSummary).not.toHaveBeenCalled();
  });

  it('uses fallback digest when AI generation fails', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    mockQuery.mockResolvedValueOnce({
      rows: [makeEntry({ summary: 'Some summary' })],
      total: 1,
    });
    mockGenerateSummary.mockResolvedValueOnce({ success: false, summary: '' });

    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(true);
    expect(mockGenerateSummary).toHaveBeenCalled();
  });

  it('returns false when download fails and does not save week marker', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    mockQuery.mockResolvedValueOnce({
      rows: [makeEntry()],
      total: 1,
    });
    mockGenerateSummary.mockResolvedValueOnce({ success: true, summary: 'Digest' });
    (globalThis as any).chrome.downloads.download = vi.fn().mockRejectedValue(new Error('Download error'));

    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
    expect((globalThis as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('uses default export path when not configured', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
    } as any);
    mockQuery.mockResolvedValueOnce({
      rows: [makeEntry()],
      total: 1,
    });
    mockGenerateSummary.mockResolvedValueOnce({ success: true, summary: 'Digest' });
    (globalThis as any).chrome.downloads.download = vi.fn().mockResolvedValue({});

    const result = await generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(true);
    expect((globalThis as any).chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: expect.stringContaining('Yasumaro/') })
    );
  });
});

describe('generateMonthlySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).chrome.downloads = {
      download: vi.fn().mockResolvedValue({}),
    };
    (globalThis as any).chrome.storage.local.set = vi.fn().mockResolvedValue(undefined);
  });

  it('returns false when feature is disabled', async () => {
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: false } as any);
    const result = await generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(false);
  });

  it('returns false when already generated for this month', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      review_summary_last_generated_month: '2026-07',
    } as any);
    const result = await generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(false);
  });

  it('returns false when no entries found', async () => {
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: true } as any);
    mockQuery.mockResolvedValueOnce(null);
    const result = await generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(false);
  });

  it('generates monthly summary with AI digest and saves', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    mockQuery.mockResolvedValueOnce({
      rows: [makeEntry({ summary: 'Monthly entry' })],
      total: 1,
    });
    mockGenerateSummary.mockResolvedValueOnce({ success: true, summary: 'Monthly digest' });

    const result = await generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(true);
    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ review_summary_last_generated_month: '2026-07' })
    );
  });

  it('handles download failure correctly', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
    } as any);
    mockQuery.mockResolvedValueOnce({
      rows: [makeEntry()],
      total: 1,
    });
    mockGenerateSummary.mockResolvedValueOnce({ success: true, summary: 'Digest' });
    (globalThis as any).chrome.downloads.download = vi.fn().mockRejectedValue(new Error('Fail'));

    const result = await generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(false);
    expect((globalThis as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe('generateStatsSection (edge cases)', () => {
  it('handles entries with null visit_duration', () => {
    const entries = [makeEntry({ visit_duration: null })];
    const stats = generateStatsSection(entries);
    expect(stats).toContain('**Total entries:** 1');
  });

  it('handles entries with null domain', () => {
    const entries = [makeEntry({ domain: null })];
    const stats = generateStatsSection(entries);
    expect(stats).toContain('unknown');
  });

  it('handles many entries and only includes top 10 domains', () => {
    const entries = Array.from({ length: 15 }, (_, i) => makeEntry({ domain: `domain${i}.com` }));
    const stats = generateStatsSection(entries);
    expect(stats).toContain('domain0.com: 1 entries');
    expect(stats).toContain('domain9.com: 1 entries');
    expect(stats).not.toContain('domain10.com');
  });
});

describe('generateReviewMarkdown (edge cases)', () => {
  it('uses URL as title when title is missing', () => {
    const entries = [makeEntry({ title: null })];
    const markdown = generateReviewMarkdown('Test', entries, 'digest');
    expect(markdown).toContain('https://example.com/article');
  });

  it('shows "No summary available" when summary is missing', () => {
    const entries = [makeEntry({ summary: null })];
    const markdown = generateReviewMarkdown('Test', entries, 'digest');
    expect(markdown).toContain('No summary available');
  });

  it('handles unknown domain by parsing from URL', () => {
    const entries = [makeEntry({ domain: null })];
    const markdown = generateReviewMarkdown('Test', entries, 'digest');
    expect(markdown).toContain('example.com');
  });
});
