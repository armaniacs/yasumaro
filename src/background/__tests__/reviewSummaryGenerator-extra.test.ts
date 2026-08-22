import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      REVIEW_SUMMARY_ENABLED: 'review_summary_enabled',
      REVIEW_SUMMARY_LAST_GENERATED_WEEK: 'review_summary_last_generated_week',
      REVIEW_SUMMARY_LAST_GENERATED_MONTH: 'review_summary_last_generated_month',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
    },
    getSettings: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      REVIEW_SUMMARY_ENABLED: 'review_summary_enabled',
      REVIEW_SUMMARY_LAST_GENERATED_WEEK: 'review_summary_last_generated_week',
      REVIEW_SUMMARY_LAST_GENERATED_MONTH: 'review_summary_last_generated_month',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
    },
    getSettings: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      REVIEW_SUMMARY_ENABLED: 'review_summary_enabled',
      REVIEW_SUMMARY_LAST_GENERATED_WEEK: 'review_summary_last_generated_week',
      REVIEW_SUMMARY_LAST_GENERATED_MONTH: 'review_summary_last_generated_month',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
    },
    getSettings: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      REVIEW_SUMMARY_ENABLED: 'review_summary_enabled',
      REVIEW_SUMMARY_LAST_GENERATED_WEEK: 'review_summary_last_generated_week',
      REVIEW_SUMMARY_LAST_GENERATED_MONTH: 'review_summary_last_generated_month',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
    },
    getSettings: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      REVIEW_SUMMARY_ENABLED: 'review_summary_enabled',
      REVIEW_SUMMARY_LAST_GENERATED_WEEK: 'review_summary_last_generated_week',
      REVIEW_SUMMARY_LAST_GENERATED_MONTH: 'review_summary_last_generated_month',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
    },
    getSettings: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      REVIEW_SUMMARY_ENABLED: 'review_summary_enabled',
      REVIEW_SUMMARY_LAST_GENERATED_WEEK: 'review_summary_last_generated_week',
      REVIEW_SUMMARY_LAST_GENERATED_MONTH: 'review_summary_last_generated_month',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
    },
    getSettings: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      REVIEW_SUMMARY_ENABLED: 'review_summary_enabled',
      REVIEW_SUMMARY_LAST_GENERATED_WEEK: 'review_summary_last_generated_week',
      REVIEW_SUMMARY_LAST_GENERATED_MONTH: 'review_summary_last_generated_month',
      LOCAL_MARKDOWN_EXPORT_PATH: 'local_markdown_export_path',
    },
    getSettings: vi.fn(),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn().mockResolvedValue(undefined),
  LogType: { INFO: 'INFO', ERROR: 'ERROR', WARN: 'WARN' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import {
  createReviewSummaryGenerator,
  generateStatsSection,
  generateReviewMarkdown,
} from '../reviewSummaryGenerator.js';
import type { AIService } from '../ai/AIService.js';
import type { AISummaryResult } from '../ai/AIService.js';
import type { SqliteClient } from '../sqliteClient.js';
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

/** AIService fake + fake SQLite queryを注入したgeneratorを組み立てる */
function createHarness() {
  const generateSummary = vi.fn<(content: string) => Promise<AISummaryResult>>();
  const aiService = {
    generateSummary,
    getSupportedModes: () => ['full_pipeline', 'local_only'],
    testConnection: vi.fn(),
  } as unknown as AIService;
  const queryResult = vi.fn();
  const sqliteClient = {
    queryResult,
    query: vi.fn().mockImplementation((op: any) => queryResult(op)),
  } as unknown as SqliteClient;
  const generator = createReviewSummaryGenerator({ aiService, sqliteClient });
  return { generateSummary, queryResult, sqliteClient, generator };
}

function mockRows(rows: unknown[], total = rows.length) {
  return { success: true, data: { rows, total } } as const;
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
    const { generator } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: false } as any);
    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
    expect(addLog).toHaveBeenCalledWith('INFO', 'Weekly review summary is disabled');
  });

  it('returns false when already generated for this week', async () => {
    const { generator } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      review_summary_last_generated_week: '2026-W28',
    } as any);
    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
    expect(addLog).toHaveBeenCalledWith('INFO', 'Weekly summary already generated for this week', expect.any(Object));
  });

  it('returns false when query fails', async () => {
    const { generator, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: true } as any);
    queryResult.mockResolvedValueOnce({
      success: false,
      error: { kind: 'unknown', message: 'Query failed', retriable: false },
    });
    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
  });

  it('returns false when entries array is empty', async () => {
    const { generator, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: true } as any);
    queryResult.mockResolvedValueOnce(mockRows([], 0));
    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
  });

  it('generates digest using the injected AIService when summaries exist', async () => {
    const { generator, generateSummary, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    queryResult.mockResolvedValueOnce(
      mockRows([makeEntry({ summary: 'First page summary' }), makeEntry({ summary: 'Second page summary' })])
    );
    generateSummary.mockResolvedValueOnce({ success: true, summary: 'AI digest text' });

    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(true);
    expect(generateSummary).toHaveBeenCalledWith(
      expect.stringContaining('週次振り返りダイジェスト')
    );
    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalled();
  });

  it('uses fallback digest when all entry summaries are null', async () => {
    const { generator, generateSummary, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    queryResult.mockResolvedValueOnce(mockRows([makeEntry({ summary: null }), makeEntry({ summary: null })]));

    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(true);
    expect(generateSummary).not.toHaveBeenCalled();
  });

  it('uses fallback digest when AI generation fails', async () => {
    const { generator, generateSummary, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    queryResult.mockResolvedValueOnce(mockRows([makeEntry({ summary: 'Some summary' })]));
    generateSummary.mockResolvedValueOnce({ success: false, summary: '' });

    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(true);
    expect(generateSummary).toHaveBeenCalled();
  });

  it('returns false when download fails and does not save week marker', async () => {
    const { generator, generateSummary, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    queryResult.mockResolvedValueOnce(mockRows([makeEntry()]));
    generateSummary.mockResolvedValueOnce({ success: true, summary: 'Digest' });
    (globalThis as any).chrome.downloads.download = vi.fn().mockRejectedValue(new Error('Download error'));

    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
    expect(result).toBe(false);
    expect((globalThis as any).chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('uses default export path when not configured', async () => {
    const { generator, generateSummary, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
    } as any);
    queryResult.mockResolvedValueOnce(mockRows([makeEntry()]));
    generateSummary.mockResolvedValueOnce({ success: true, summary: 'Digest' });
    (globalThis as any).chrome.downloads.download = vi.fn().mockResolvedValue({});

    const result = await generator.generateWeeklySummary(new Date('2026-07-08'));
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
    const { generator } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: false } as any);
    const result = await generator.generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(false);
  });

  it('returns false when already generated for this month', async () => {
    const { generator } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      review_summary_last_generated_month: '2026-07',
    } as any);
    const result = await generator.generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(false);
  });

  it('returns false when query fails', async () => {
    const { generator, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({ review_summary_enabled: true } as any);
    queryResult.mockResolvedValueOnce({
      success: false,
      error: { kind: 'unknown', message: 'Query failed', retriable: false },
    });
    const result = await generator.generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(false);
  });

  it('generates monthly summary with AI digest and saves', async () => {
    const { generator, generateSummary, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
      local_markdown_export_path: 'Yasumaro',
    } as any);
    queryResult.mockResolvedValueOnce(mockRows([makeEntry({ summary: 'Monthly entry' })]));
    generateSummary.mockResolvedValueOnce({ success: true, summary: 'Monthly digest' });

    const result = await generator.generateMonthlySummary(new Date('2026-07-15'));
    expect(result).toBe(true);
    expect(generateSummary).toHaveBeenCalledWith(
      expect.stringContaining('月次振り返りダイジェスト')
    );
    expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ review_summary_last_generated_month: '2026-07' })
    );
  });

  it('handles download failure correctly', async () => {
    const { generator, generateSummary, queryResult } = createHarness();
    vi.mocked(getSettings).mockResolvedValue({
      review_summary_enabled: true,
    } as any);
    queryResult.mockResolvedValueOnce(mockRows([makeEntry()]));
    generateSummary.mockResolvedValueOnce({ success: true, summary: 'Digest' });
    (globalThis as any).chrome.downloads.download = vi.fn().mockRejectedValue(new Error('Fail'));

    const result = await generator.generateMonthlySummary(new Date('2026-07-15'));
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
