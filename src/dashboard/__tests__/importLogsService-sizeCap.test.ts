/**
 * importLogsService-sizeCap.test.ts
 * Boundary pins for the pre-parse import text gate (MAX_IMPORT_TEXT_BYTES)
 * and the whole-file row cap (IMPORT_TOTAL_ROW_CAP), on both the normal and
 * the profile-migration path (PBI 2026-11-26-05).
 *
 * The exact-size case uses unparseable filler on purpose: the pin is that the
 * size gate did NOT fire (the parse stage is reached and reports its own
 * error), not that a valid 30 MiB document imports here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSqliteCall = vi.fn();
vi.mock('../dashboardSqliteService.js', () => ({
  sqliteClient: { call: (...args: unknown[]) => mockSqliteCall(...args) },
}));

// Deterministic crypto so the row-cap fixture can be signed in-test.
const fakeSign = async (payload: string) =>
  `hmac(test-secret):${payload.length}:${payload.slice(0, 8)}`;
vi.mock('../../utils/storage/encryptionSession.js', () => ({
  exportHmacSigner: {
    sign: vi.fn(fakeSign),
    verify: vi.fn(async (payload: string, sig: string) => sig === (await fakeSign(payload))),
  },
}));

import { MAX_IMPORT_TEXT_BYTES, IMPORT_TOTAL_ROW_CAP } from '../../utils/limits.js';

async function signedExport(rows: unknown[]): Promise<string> {
  const body = { version: 2, table: 'browsing_logs', rows };
  const signature = await fakeSign(JSON.stringify(body, null, 2));
  return JSON.stringify({ ...body, signature });
}

describe('import text size gate at 30 MiB (PBI 2026-11-26-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('importFromJson (normal path)', () => {
    it('lets a file of exactly MAX_IMPORT_TEXT_BYTES reach the parse stage', async () => {
      const { importFromJson } = await import('../importLogsService.js');
      const exactly = 'x'.repeat(MAX_IMPORT_TEXT_BYTES);
      const result = await importFromJson(exactly);
      // Parse failed, not the size gate: the reason is a JSON error.
      expect(result).toEqual({ error: 'Invalid JSON format' });
      expect(mockSqliteCall).not.toHaveBeenCalled();
    });

    it('rejects one byte over the limit with the limit value in the message', async () => {
      const { importFromJson } = await import('../importLogsService.js');
      const over = 'x'.repeat(MAX_IMPORT_TEXT_BYTES + 1);
      const result = await importFromJson(over);
      expect(result).toEqual({ error: 'Import file is too large (limit: 30 MiB)' });
      expect(mockSqliteCall).not.toHaveBeenCalled();
    });
  });

  describe('importFromJsonForMigration (migration path)', () => {
    it('lets a file of exactly MAX_IMPORT_TEXT_BYTES reach the parse stage', async () => {
      const { importFromJsonForMigration } = await import('../importLogsService.js');
      const exactly = 'x'.repeat(MAX_IMPORT_TEXT_BYTES);
      const result = await importFromJsonForMigration(exactly);
      expect(result).toEqual({ error: 'Invalid JSON format' });
      expect(mockSqliteCall).not.toHaveBeenCalled();
    });

    it('rejects one byte over the limit with the limit value in the message', async () => {
      const { importFromJsonForMigration } = await import('../importLogsService.js');
      const over = 'x'.repeat(MAX_IMPORT_TEXT_BYTES + 1);
      const result = await importFromJsonForMigration(over);
      expect(result).toEqual({ error: 'Import file is too large (limit: 30 MiB)' });
      expect(mockSqliteCall).not.toHaveBeenCalled();
    });
  });
});

describe('whole-file row cap (IMPORT_TOTAL_ROW_CAP, VULN-023 kept)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a 100,001-row file before any batch reaches SQLite', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const rows = Array.from({ length: IMPORT_TOTAL_ROW_CAP + 1 }, (_, i) => ({
      url: `https://example.com/${i}`,
      created_at: 1_700_000_000_000 - i,
    }));
    const result = await importFromJson(await signedExport(rows));
    expect(result).toEqual({ error: `Import exceeds the ${IMPORT_TOTAL_ROW_CAP} row limit` });
    expect(mockSqliteCall).not.toHaveBeenCalled();
  });

  // 100,000 rows exactly (one below this rejection) passing the gate is pinned
  // by logExportImportRoundtrip100k.test.ts, which also asserts
  // MAX_EXPORT_ROWS === IMPORT_TOTAL_ROW_CAP at the boundary.
});
