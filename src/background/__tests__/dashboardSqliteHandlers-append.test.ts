/**
 * dashboardSqliteHandlers-append.test.ts
 * Tests for the append_to_obsidian handler in dashboardSqliteHandlers.ts
 * Covers Gap 1 (HIGH) and Gap 3 (MEDIUM) from coverage audit
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockGetAll = vi.hoisted(() => vi.fn());

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StorageKeys: {
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_ENABLED: 'obsidian_enabled',
    },
  };
});

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      setAll: vi.fn(),
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = vi.fn();
      getMany = vi.fn();
    },
  };
});

vi.mock('../obsidianClient.js', () => {
  const mockAppend = vi.fn().mockResolvedValue(undefined);
  return {
    ObsidianClient: class MockObsidianClient {
      appendToDailyNote = mockAppend;
    },
    __mockAppend: mockAppend,
  };
});

vi.mock('../../utils/markdownFormatter.js', () => ({
  formatEntriesToMarkdown: vi.fn((entries: unknown[]) => {
    if (!entries || entries.length === 0) return '';
    return entries.map((e: any) => `- ${e.title || 'Untitled'}`).join('\n');
  }),
}));

import { dispatchDashboardSqlite } from '../handlers/__tests__/dashboardSqliteTestHarness.js';

const APPEND_TOKEN = 'test-token';
import { ObsidianClient } from '../obsidianClient.js';
import { formatEntriesToMarkdown } from '../../dashboard/obsidianFormatter.js';
import { logError, logInfo } from '../../utils/logger.js';

// Helper to create a mock SqliteClient
function createMockSqliteClient(rows: unknown[] = []) {
  const result = {
    queryResult: vi.fn().mockResolvedValue({ success: true, data: { rows, total: rows.length } }),
    searchResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    toggleStarResult: vi.fn().mockResolvedValue({ success: true, data: { is_starred: 1 } }),
    deleteResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    updateResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    insertResult: vi.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
    getCountResult: vi.fn().mockResolvedValue({ success: true, data: 0 }),
    clearAllResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    getStatus: vi.fn().mockResolvedValue({ initialized: true }),
    runOpfsSpikeResult: vi.fn().mockResolvedValue({ success: true, data: {} }),
    restoreDbResult: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    backupDbResult: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array() }),
    purgeOldRecordsResult: vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } }),
    purgeContentResult: vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } }),
    queryAuditLogResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
  };
  // Core methods used by createSqliteClientDeps — delegate to the *Result wrappers above
  const client = {
    ...result,
    query: vi.fn().mockImplementation((op: any) => {
      if (op?.kind === 'search') return client.searchResult(op.text, op.limit, op.offset, op);
      if (op?.kind === 'count') return client.getCountResult();
      if (op?.kind === 'auditLog') return client.queryAuditLogResult(op);
      return client.queryResult(op);
    }),
    mutate: vi.fn().mockImplementation((op: any) => {
      switch (op.type) {
        case 'insert': return client.insertResult(op.record, op.traceId);
        case 'insertBatch': return client.insertBatchResult(op.records);
        case 'update': return client.updateResult(op.id, op.changes);
        case 'delete': return client.deleteResult(op.id);
        case 'toggleStar': return client.toggleStarResult(op.id);
        case 'insertAuditLog': return client.insertAuditLogResult(op.record);
        default: return Promise.resolve({ success: true, data: undefined });
      }
    }),
    maintain: vi.fn().mockImplementation((op: any) => {
      switch (op.type) {
        case 'init': return client.init ? client.init() : Promise.resolve({ success: true, data: true });
        case 'backup': return client.backupDbResult();
        case 'restore': return client.restoreDbResult(op.data);
        case 'clearAll': return client.clearAllResult();
        case 'purgeOldRecords': return client.purgeOldRecordsResult(op.retentionDays, op.maxRecords);
        case 'purgeContent': return client.purgeContentResult(op.retentionDays, op.maxRecords, op.includeStarred);
        case 'opfsSpike': return client.runOpfsSpikeResult();
        case 'healthCheck': return client.isSqliteHealthy ? client.isSqliteHealthy() : Promise.resolve(true);
        default: return Promise.resolve({ success: true, data: undefined });
      }
    }),
  };
  return client;
}

describe('handleDashboardSqlite — append_to_obsidian', () => {
  let mockSqliteClient: ReturnType<typeof createMockSqliteClient>;

  function setupSettings(overrides: Record<string, unknown> = {}) {
    const defaults = {
      obsidian_api_key: 'valid-api-key-123456',
      obsidian_enabled: true,
    };
    mockGetAll.mockResolvedValue({ ...defaults, ...overrides } as any);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteClient = createMockSqliteClient();
    setupSettings();
  });

  it('returns error when ids is empty array', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'No IDs provided' });
  });

  it('returns error when ids is not an array', async () => {
    // Intentionally malformed payload — verifies the runtime Array.isArray
    // guard, which is reachable in practice via the chrome.runtime.onMessage
    // wire (see the cast in service-worker.ts).
    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: 'not-an-array' } as any,
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'No IDs provided' });
  });

  it('returns error when ids is undefined', async () => {
    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN } as any,
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'No IDs provided' });
  });

  it('returns error when Obsidian API key is not configured', async () => {
    setupSettings({ obsidian_api_key: '' });

    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [1, 2] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'Obsidian API key not configured' });
  });

  it('returns error when Obsidian API key is too short', async () => {
    setupSettings({ obsidian_api_key: 'short' });

    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [1, 2] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'Obsidian API key not configured' });
  });

  it('proceeds even when OBSIDIAN_ENABLED is false (manual append ignores the flag)', async () => {
    setupSettings({ obsidian_enabled: false, obsidian_api_key: 'valid-api-key-123456' });
    const mockEntries = [{ id: 1, url: 'https://a.com', title: 'Page A', summary: 'Summary A' }];
    mockSqliteClient.queryResult.mockResolvedValue({ success: true, data: { rows: mockEntries, total: 1 } });

    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [1, 2] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    // Should reach ObsidianClient, not be blocked by the flag
    expect(result).not.toEqual({ success: false, error: 'Obsidian is disabled by user' });
  });

  it('returns error when no matching entries found', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    mockSqliteClient.queryResult.mockResolvedValue({
      success: true,
      data: { rows: [], total: 0 },
    });

    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [1, 2] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'No matching entries found' });
    // Verify the query was called with the targeted ids
    expect(mockSqliteClient.queryResult).toHaveBeenCalledWith(
      expect.objectContaining({ ids: [1, 2] })
    );
  });

  it('successfully appends entries to Obsidian', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    const mockEntries = [
      { id: 1, url: 'https://a.com', title: 'Page A', summary: 'Summary A' },
      { id: 2, url: 'https://b.com', title: 'Page B', summary: 'Summary B' },
    ];
    mockSqliteClient.queryResult.mockResolvedValue({ success: true, data: { rows: mockEntries, total: 2 } });

    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [1, 2] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: true, appended: 2 });
    expect(formatEntriesToMarkdown).toHaveBeenCalledWith(mockEntries);
    expect(logInfo).toHaveBeenCalledWith('Appended entries to Obsidian', { count: 2 });
  });

  it('returns error when Obsidian append fails', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    mockSqliteClient.queryResult.mockResolvedValue({
      success: true,
      data: { rows: [{ id: 1, url: 'https://a.com', title: 'Page A' }], total: 1 },
    });

    // Get the mock from the ObsidianClient class prototype
    const MockClass = vi.mocked(ObsidianClient);
    const instance = new MockClass();
    // The appendToDailyNote is shared via class field
    (instance.appendToDailyNote as any).mockRejectedValueOnce(new Error('Connection refused'));

    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [1] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: false, error: 'Connection refused' });
    expect(logError).toHaveBeenCalled();
  });

  it('queries by IDs correctly', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    const allEntries = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      url: `https://page${i + 1}.com`,
      title: `Page ${i + 1}`,
    }));
    // Mock returns all entries; handler passes IDs to SQL layer
    mockSqliteClient.queryResult.mockResolvedValue({ success: true, data: { rows: allEntries, total: 50 } });

    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [5, 25, 45] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: true, appended: 50 }); // all returned from mock
    expect(mockSqliteClient.queryResult).toHaveBeenCalledWith(
      expect.objectContaining({ ids: [5, 25, 45] })
    );
  });

  it('handles mixed valid and invalid IDs', async () => {
    setupSettings({ obsidian_api_key: 'valid-api-key-123456' });
    // SQL handles filtering; mock returns all matching entries
    mockSqliteClient.queryResult.mockResolvedValue({
      success: true,
      data: { rows: [{ id: 1, url: 'https://a.com', title: 'Exists' }], total: 1 },
    });

    const result = await dispatchDashboardSqlite(
      { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [1, 999] },
      mockSqliteClient as any,
      { getConfirmToken: async () => APPEND_TOKEN }
    );

    expect(result).toEqual({ success: true, appended: 1 });
    expect(mockSqliteClient.queryResult).toHaveBeenCalledWith(
      expect.objectContaining({ ids: [1, 999] })
    );
  });

  describe('VULN-001: MAX_APPEND_IDS bound enforcement', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockSqliteClient = createMockSqliteClient();
      setupSettings();
    });

    it('rejects ids array with more than 100 elements', async () => {
      const hugeIds = Array.from({ length: 101 }, (_, i) => i + 1);

      const result = await dispatchDashboardSqlite(
        { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: hugeIds },
        mockSqliteClient as any,
        { getConfirmToken: async () => APPEND_TOKEN }
      );

      expect(result).toEqual({ success: false, error: 'Maximum 100 IDs allowed' });
    });

    it('accepts ids array with exactly 100 elements', async () => {
      const ids = Array.from({ length: 100 }, (_, i) => i + 1);
      const mockEntries = ids.map(id => ({ id, url: `https://p${id}.com`, title: `Page ${id}` }));
      mockSqliteClient.queryResult.mockResolvedValue({ success: true, data: { rows: mockEntries, total: 100 } });

      const result = await dispatchDashboardSqlite(
        { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids },
        mockSqliteClient as any,
        { getConfirmToken: async () => APPEND_TOKEN }
      );

      expect(result).toEqual({ success: true, appended: 100 });
    });

    it('rejects ids array containing non-number elements', async () => {
      const result = await dispatchDashboardSqlite(
        { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [1, 'a', 3] } as any,
        mockSqliteClient as any,
        { getConfirmToken: async () => APPEND_TOKEN }
      );

      expect(result).toEqual({ success: false, error: 'All IDs must be finite numbers' });
    });

    it('rejects ids array containing NaN', async () => {
      const result = await dispatchDashboardSqlite(
        { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [NaN] },
        mockSqliteClient as any,
        { getConfirmToken: async () => APPEND_TOKEN }
      );
      expect(result).toEqual({ success: false, error: 'All IDs must be finite numbers' });
    });

    it('rejects ids array containing Infinity', async () => {
      const result = await dispatchDashboardSqlite(
        { subtype: 'append_to_obsidian', confirmToken: APPEND_TOKEN, ids: [Infinity] },
        mockSqliteClient as any,
        { getConfirmToken: async () => APPEND_TOKEN }
      );

      expect(result).toEqual({ success: false, error: 'All IDs must be finite numbers' });
    });
  });

  describe('VULN-006: bulk import row cap', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockSqliteClient = createMockSqliteClient();
      setupSettings();
    });

    it('rejects import with more than 5000 rows', async () => {
      const hugeRows = Array.from({ length: 5001 }, (_, i) => ({
        url: `https://e${i}.com`,
        created_at: Date.now(),
      }));

      const result = await dispatchDashboardSqlite(
        { subtype: 'import', rows: hugeRows, confirmToken: 'test-token' },
        mockSqliteClient as any,
        { getConfirmToken: async () => 'test-token' }
      );

      expect(result).toEqual({ success: false, error: 'Maximum 5000 rows allowed' });
    });

    it('accepts import at the row cap', async () => {
      const rows = Array.from({ length: 5000 }, (_, i) => ({
        url: `https://e${i}.com`,
        created_at: Date.now(),
      }));
      mockSqliteClient.insertResult.mockResolvedValue({ success: true, data: { id: 1 } });

      const result = await dispatchDashboardSqlite(
        { subtype: 'import', rows, confirmToken: 'test-token' },
        mockSqliteClient as any,
        { getConfirmToken: async () => 'test-token' }
      );

      expect(result.success).toBe(true);
      expect(result.inserted).toBe(5000);
    });
  });
});
