import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

vi.mock('../../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {},
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
vi.mock('../../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {},
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

vi.mock('../../sqliteClient.js', () => ({}));

import { dispatchDashboardSqlite } from './dashboardSqliteTestHarness.js';

const VALID_TOKEN = 'valid-confirm-token-12345';

function createMockSqliteClient() {
  const result = {
    queryResult: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
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

describe('confirmToken constant-time comparison (CWE-208)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('正しい confirmToken で破壊的操作が成功する（ハッピーパス）', async () => {
    const client = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all', confirmToken: VALID_TOKEN } as any,
      client as any,
      { getConfirmToken: async () => VALID_TOKEN },
    );
    expect(result).toEqual({ success: true, data: undefined });
    expect(client.clearAllResult).toHaveBeenCalled();
  });

  it('長さが異なる不正トークンは拒否される', async () => {
    const client = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all', confirmToken: 'short' } as any,
      client as any,
      { getConfirmToken: async () => VALID_TOKEN },
    );
    expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
    expect(client.clearAllResult).not.toHaveBeenCalled();
  });

  it('先頭文字が異なる不正トークンは拒否される', async () => {
    const client = createMockSqliteClient();
    const invalid = 'x' + VALID_TOKEN.slice(1);
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all', confirmToken: invalid } as any,
      client as any,
      { getConfirmToken: async () => VALID_TOKEN },
    );
    expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
  });

  it('末尾文字が異なる不正トークンは拒否される', async () => {
    const client = createMockSqliteClient();
    const invalid = VALID_TOKEN.slice(0, -1) + 'X';
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all', confirmToken: invalid } as any,
      client as any,
      { getConfirmToken: async () => VALID_TOKEN },
    );
    expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
  });

  it('confirmToken 未指定は拒否される', async () => {
    const client = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all' } as any,
      client as any,
      { getConfirmToken: async () => VALID_TOKEN },
    );
    expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
  });

  it('読み取り系はトークン不要のまま動作する', async () => {
    const client = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'query', query: {} } as any,
      client as any,
      { getConfirmToken: async () => VALID_TOKEN },
    );
    expect(result).not.toEqual({ success: false, error: 'Confirmation token mismatch' });
    expect(client.queryResult).toHaveBeenCalled();
  });
});
