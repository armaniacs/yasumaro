// @vitest-environment jsdom
/**
 * importLogsService-migration.test.ts
 * PBI 2026-11-06-03: 閲覧ログのプロファイル間移行モード。
 * 異鍵署名ファイルを `importFromJsonForMigration` で取り込めること、
 * 通常 `importFromJson` は拒否し続けること (VULN-035)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSqliteCall = vi.fn();
vi.mock('../dashboardSqliteService.js', () => ({
  sqliteClient: { call: (...args: unknown[]) => mockSqliteCall(...args) },
}));

// 移行先プロファイル (B) の鍵で検証する検証器。移行元 (A) の署名は通らない。
const fakeSignB = async (payload: string): Promise<string> =>
  `hmac(profile-b):${payload.length}:${payload.slice(0, 8)}`;
const fakeSignA = async (payload: string): Promise<string> =>
  `hmac(profile-a):${payload.length}:${payload.slice(0, 8)}`;
vi.mock('../../utils/storage/encryptionSession.js', () => ({
  exportHmacSigner: {
    sign: vi.fn(fakeSignB),
    verify: vi.fn(async (payload: string, sig: string) => sig === (await fakeSignB(payload))),
  },
}));

const mockLogWarn = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../utils/logger/api.js', () => ({
  logError: vi.fn(async () => {}),
  logInfo: vi.fn(async () => {}),
  logWarn: mockLogWarn,
}));

async function signedByA(
  rows: unknown[],
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const body = { version: 2, table: 'browsing_logs', rows, ...overrides };
  const signature = await fakeSignA(JSON.stringify(body, null, 2));
  return JSON.stringify({ ...body, signature });
}

function validRows(): Array<Record<string, unknown>> {
  return [
    { url: 'https://source.example.com/a', created_at: 1700000000000 },
    { url: 'https://source.example.com/b', created_at: 1700000001000, title: 'B' },
  ];
}

describe('importLogsService profile migration', () => {
  describe('importFromJsonForMigration', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockSqliteCall.mockResolvedValue({ data: { inserted: 2, skipped: 0, total: 2 } });
    });

    it('imports a log file signed by a different profile key', async () => {
      const { importFromJsonForMigration } = await import('../importLogsService.js');

      const result = await importFromJsonForMigration(await signedByA(validRows()));

      expect(result).toEqual({ inserted: 2, skipped: 0, total: 2 });
      expect(mockSqliteCall).toHaveBeenCalledWith('import', {
        subtype: 'import',
        rows: validRows(),
      });
    });

    it('imports an unsigned file while the normal path still rejects it', async () => {
      const { importFromJson, importFromJsonForMigration } = await import(
        '../importLogsService.js'
      );
      const unsigned = JSON.stringify({ version: 2, rows: validRows() });

      const migrated = await importFromJsonForMigration(unsigned);
      const normal = await importFromJson(unsigned);

      expect(migrated).toEqual({ inserted: 2, skipped: 0, total: 2 });
      expect(normal).toEqual({
        error: 'This log file is unsigned and cannot be imported. Re-export it from this extension.',
      });
    });

    it('rejects an invalid payload even in migration mode', async () => {
      const { importFromJsonForMigration } = await import('../importLogsService.js');

      const result = await importFromJsonForMigration('not json');

      expect(result).toEqual({ error: 'Invalid JSON format' });
      expect(mockSqliteCall).not.toHaveBeenCalled();
    });

    it('rejects a rowless file even in migration mode', async () => {
      const { importFromJsonForMigration } = await import('../importLogsService.js');
      const body = { version: 2, table: 'browsing_logs', rows: [] };
      const signature = await fakeSignA(JSON.stringify(body, null, 2));

      const result = await importFromJsonForMigration(JSON.stringify({ ...body, signature }));

      expect(result).toEqual({ error: 'No records found in file' });
      expect(mockSqliteCall).not.toHaveBeenCalled();
    });

    it('records an audit log entry when migration is applied', async () => {
      const { importFromJsonForMigration } = await import('../importLogsService.js');

      await importFromJsonForMigration(await signedByA(validRows()));

      expect(mockLogWarn).toHaveBeenCalledTimes(1);
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining('migration'),
        expect.objectContaining({ hadSignature: true }),
        undefined,
        'importLogsService.ts'
      );
    });
  });

  describe('importFromJson normal path (VULN-035 regression)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('rejects a log file signed by a different profile key', async () => {
      const { importFromJson } = await import('../importLogsService.js');

      const result = await importFromJson(await signedByA(validRows()));

      expect(result).toEqual({
        error: 'Log file signature verification failed. The file may be corrupted or was exported from a different browser profile.',
      });
      expect(mockSqliteCall).not.toHaveBeenCalled();
    });

    it('accepts an explicit verifier so tests can swap the HMAC secret', async () => {
      const { importFromJson } = await import('../importLogsService.js');
      const json = await signedByA(validRows());
      mockSqliteCall.mockResolvedValue({ data: { inserted: 2, skipped: 0, total: 2 } });
      const verifierA = {
        verify: async (payload: string, sig: string): Promise<boolean> =>
          sig === (await fakeSignA(payload)),
      };

      const result = await importFromJson(json, undefined, { verifier: verifierA });

      expect(result).toEqual({ inserted: 2, skipped: 0, total: 2 });
    });
  });
});
