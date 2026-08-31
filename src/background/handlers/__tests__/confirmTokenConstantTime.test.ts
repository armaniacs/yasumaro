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
vi.mock('../../../utils/storage.js', async (importOriginal) => {
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
  const client = {
    query: vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } }),
    mutate: vi.fn().mockResolvedValue({ success: true, data: { is_starred: 1 } }),
    maintain: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    getStatus: vi.fn().mockResolvedValue({ initialized: true }),
  };
  return client as any;
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
    expect(client.maintain).toHaveBeenCalledWith(expect.objectContaining({ type: 'clearAll' }));
  });

  it('長さが異なる不正トークンは拒否される', async () => {
    const client = createMockSqliteClient();
    const result = await dispatchDashboardSqlite(
      { subtype: 'clear_all', confirmToken: 'short' } as any,
      client as any,
      { getConfirmToken: async () => VALID_TOKEN },
    );
    expect(result).toEqual({ success: false, error: 'Confirmation token mismatch' });
    expect(client.maintain).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'clearAll' }));
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
    expect(client.query).toHaveBeenCalled();
  });
});
