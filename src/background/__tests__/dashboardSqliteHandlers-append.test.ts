/**
 * dashboardSqliteHandlers-append.test.ts
 * Tests for the append_to_obsidian handler in dashboardSqliteHandlers.ts
 * Covers Gap 1 (HIGH) and Gap 3 (MEDIUM) from coverage audit
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    OBSIDIAN_API_KEY: 'obsidian_api_key',
    OBSIDIAN_ENABLED: 'obsidian_enabled',
  },
  getSettings: vi.fn(),
}));

vi.mock('../obsidianClient.js', () => {
  const mockAppend = vi.fn().mockResolvedValue(undefined);
  return {
    ObsidianClient: class MockObsidianClient {
      appendToDailyNote = mockAppend;
    },
    __mockAppend: mockAppend,
  };
});

vi.mock('../../dashboard/obsidianFormatter.js', () => ({
  formatEntriesToMarkdown: vi.fn((entries: unknown[]) => {
    if (!entries || entries.length === 0) return '';
    return entries.map((e: any) => `- ${e.title || 'Untitled'}`).join('\n');
  }),
}));

import { handleDashboardSqlite } from '../handlers/dashboardSqliteHandlers.js';
import { ObsidianClient } from '../obsidianClient.js';
import { formatEntriesToMarkdown } from '../../dashboard/obsidianFormatter.js';
import { logError, logInfo } from '../../utils/logger.js';
import { getSettings } from '../../utils/storage.js';

// Helper to create a mock SqliteClient
function createMockSqliteClient(rows: unknown[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, total: rows.length }),
    search: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    toggleStar: vi.fn().mockResolvedValue({ is_starred: 1 }),
    delete: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockResolvedValue(true),
    insert: vi.fn().mockResolvedValue(true),
    getCount: vi.fn().mockResolvedValue(0),
    clearAll: vi.fn().mockResolvedValue(true),
    getStatus: vi.fn().mockResolvedValue({ initialized: true }),
    runOpfsSpike: vi.fn().mockResolvedValue({ success: true }),
  };
}

describe('handleDashboardSqlite — append_to_obsidian', () => {
  let mockSqliteClient: ReturnType<typeof createMockSqliteClient>;

  function setupSettings(overrides: Record<string, unknown> = {}) {
    const defaults = {
      obsidian_api_key: 'valid-api-key-123456',
      obsidian_enabled: true,
    };
    vi.mocked(getSettings).mockResolvedValue({ ...defaults, ...overrides } as any);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteClient = createMockSqliteClient();
    setupSettings();
  });

  it('returns error when ids is empty array', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [] },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: false, error: 'No IDs provided' });
  });

  it('returns error when ids is not an array', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: 'not-an-array' },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: false, error: 'No IDs provided' });
  });

  it('returns error when ids is undefined', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian' },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: false, error: 'No IDs provided' });
  });

  it('returns error when Obsidian API key is not configured', async () => {
    setupSettings({ obsidian_api_key: '' });

    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [1, 2] },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: false, error: 'Obsidian API key not configured' });
  });

  it('returns error when Obsidian API key is too short', async () => {
    setupSettings({ obsidian_api_key: 'short' });

    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [1, 2] },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: false, error: 'Obsidian API key not configured' });
  });

  it('returns error when Obsidian is disabled by user', async () => {
    setupSettings({ obsidian_enabled: false, obsidian_api_key: 'valid-api-key-123456' });

    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [1, 2] },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: false, error: 'Obsidian is disabled by user' });
  });

  it('returns error when no matching entries found', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    mockSqliteClient.query.mockResolvedValue({
      rows: [{ id: 10 }, { id: 20 }],
      total: 2,
    });

    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [1, 2] }, // IDs 1,2 don't exist
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: false, error: 'No matching entries found' });
  });

  it('successfully appends entries to Obsidian', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    const mockEntries = [
      { id: 1, url: 'https://a.com', title: 'Page A', summary: 'Summary A' },
      { id: 2, url: 'https://b.com', title: 'Page B', summary: 'Summary B' },
    ];
    mockSqliteClient.query.mockResolvedValue({ rows: mockEntries, total: 2 });

    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [1, 2] },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: true, appended: 2 });
    expect(formatEntriesToMarkdown).toHaveBeenCalledWith(mockEntries);
    expect(logInfo).toHaveBeenCalledWith('Appended entries to Obsidian', { count: 2 });
  });

  it('returns error when Obsidian append fails', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    mockSqliteClient.query.mockResolvedValue({
      rows: [{ id: 1, url: 'https://a.com', title: 'Page A' }],
      total: 1,
    });

    // Get the mock from the ObsidianClient class prototype
    const MockClass = vi.mocked(ObsidianClient);
    const instance = new MockClass();
    // The appendToDailyNote is shared via class field
    (instance.appendToDailyNote as any).mockRejectedValueOnce(new Error('Connection refused'));

    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [1] },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: false, error: 'Connection refused' });
    expect(logError).toHaveBeenCalled();
  });

  it('filters entries correctly when multiple pages exist', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    // Simulate a large result set with various IDs
    const allEntries = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      url: `https://page${i + 1}.com`,
      title: `Page ${i + 1}`,
    }));
    mockSqliteClient.query.mockResolvedValue({ rows: allEntries, total: 50 });

    // Select entries with specific IDs
    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [5, 25, 45] },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: true, appended: 3 });
    // Verify the formatter received only the filtered entries
    const filteredEntries = allEntries.filter(e => [5, 25, 45].includes(e.id));
    expect(formatEntriesToMarkdown).toHaveBeenCalledWith(filteredEntries);
  });

  it('handles mixed valid and invalid IDs', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    mockSqliteClient.query.mockResolvedValue({
      rows: [{ id: 1, url: 'https://a.com', title: 'Exists' }],
      total: 1,
    });

    // Request IDs [1, 999] but only 1 exists
    const result = await handleDashboardSqlite(
      { subtype: 'append_to_obsidian', ids: [1, 999] },
      mockSqliteClient as any
    );

    expect(result).toEqual({ success: true, appended: 1 });
  });
});
