/**
 * logExportImportRoundtrip100k.test.ts
 * Round-trip pin at the export ceiling (PBI 2026-11-26-04): 100,000
 * lightweight rows exported through the real exportJson (real HMAC signer)
 * re-import through importFromJson with zero duplicates skipped.
 *
 * The rows are lightweight (the schema's optional columns are absent, as in
 * real rows that only carry url + created_at) so the pretty-printed file
 * stays near 8 MB, well inside the 30 MiB import text gate. The full-fidelity
 * counterpart at real-data row lengths lives in
 * logExportImportRoundtripFullFidelity.test.ts (PBI 2026-11-26-05).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUERY_CAPS, MAX_EXPORT_ROWS, MAX_IMPORT_TEXT_BYTES, IMPORT_TOTAL_ROW_CAP } from '../../utils/limits.js';

const mockQueryLogs = vi.fn();
const mockImportLogs = vi.fn();

// Same seam routing as logExportSignature.test.ts: 'import' ops go to the
// import stub, everything else to the query stub.
vi.mock('../dashboardSqliteService.js', () => ({
  isServiceError: (result: object) => 'error' in result,
  sqliteClient: {
    call: (...args: unknown[]) => (args[0] === 'import' ? mockImportLogs(args[1]) : mockQueryLogs(args[1])),
  },
}));

import { exportJson } from '../exportLogsService.js';
import { importFromJson } from '../importLogsService.js';

const PAGE = QUERY_CAPS.plain;
const TOTAL = MAX_EXPORT_ROWS;
const BASE = 1_700_000_000_000;

// 100,000 lightweight rows in DESC created_at order (index 0 = newest).
const ALL_ROWS = Array.from({ length: TOTAL }, (_, i) => ({
  id: i + 1,
  url: 'u',
  created_at: BASE - i,
}));

describe('log export/import round-trip at 100,000 rows (PBI 2026-11-26-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryLogs.mockImplementation((payload: { until?: number }) => {
      const until = typeof payload.until === 'number' ? payload.until : Number.POSITIVE_INFINITY;
      const page = ALL_ROWS.filter((row) => row.created_at <= until).slice(0, PAGE);
      return Promise.resolve({ data: { rows: page, total: TOTAL } });
    });
    mockImportLogs.mockImplementation((payload: { rows: Array<{ id: number }> }) =>
      Promise.resolve({ data: { inserted: payload.rows.length, skipped: 0, total: payload.rows.length } }),
    );
  });

  it('exports 100,000 rows and re-imports all of them with zero duplicates skipped', async () => {
    const blob = await exportJson();
    const text = await blob.text();

    // The lightweight file sits comfortably inside the import text gate, so
    // the round-trip stays reachable at the exact row-cap boundary.
    expect(text.length).toBeLessThanOrEqual(MAX_IMPORT_TEXT_BYTES);

    const result = await importFromJson(text);
    expect(result).toEqual({ inserted: TOTAL, skipped: 0, total: TOTAL });

    // Batch pin: importValidatedRows sends 200-row messages
    // (importLogsService BATCH_SIZE), so 100,000 rows take 500 calls.
    expect(mockImportLogs).toHaveBeenCalledTimes(500);
    // The row count sits exactly at the import pre-check cap: one more row
    // and importFromJson would reject the file before batching.
    expect(TOTAL).toBe(IMPORT_TOTAL_ROW_CAP);
  });
});
