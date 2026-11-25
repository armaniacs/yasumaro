// @vitest-environment wasm-quickjs-dom
/**
 * exportLogsService-paging.test.ts
 * Keyset-paging unit tests for queryAllData (PBI 2026-11-26-04): the export
 * pages at QUERY_CAPS.plain rows per query with an inclusive `until` cursor,
 * dedupes page-boundary ties by id, freezes the row count at the first page,
 * and stops at MAX_EXPORT_ROWS.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QUERY_CAPS, MAX_EXPORT_ROWS } from '../../utils/limits.js';

const mockQueryLogs = vi.fn();

// exportLogsService calls the generic seam (sqliteClient.call('records', ...));
// the mock hands the payload straight to the stub so cursor assertions can
// read the exact query parameters.
vi.mock('../dashboardSqliteService.js', () => ({
  sqliteClient: { call: (...args: any[]) => mockQueryLogs(args[1]) },
  isServiceError: (result: object) => 'error' in result,
}));

// Deterministic signer (mirrors exportLogsService.test.ts): the paging tests
// assert row flow, not signature bytes, only that exportJson completes at the
// cap. Real-signer behavior is pinned by logExportSignature.test.ts.
vi.mock('../../utils/storage/encryptionSession.js', () => ({
  exportHmacSigner: {
    sign: vi.fn(async (payload: string) => `hmac(test-secret):${payload.length}`),
    verify: vi.fn(async (payload: string, sig: string) => sig === `hmac(test-secret):${payload.length}`),
  },
}));

import { queryAllData, exportJson } from '../exportLogsService.js';

interface LightRow {
  id: number;
  url: string;
  created_at: number;
}

const BASE = 1_700_000_000_000;

/** Lightweight row set in DESC created_at order (index 0 = newest). */
function descRows(count: number, gapMs: number): LightRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, url: 'u', created_at: BASE - i * gapMs }));
}

/** Seam double honouring the engine's inclusive `until` and the plain cap. */
function installPageStore(rows: LightRow[], total: number = rows.length): void {
  mockQueryLogs.mockImplementation((payload: { until?: number }) => {
    const until = typeof payload.until === 'number' ? payload.until : Number.POSITIVE_INFINITY;
    const page = rows.filter((row) => row.created_at <= until).slice(0, QUERY_CAPS.plain);
    return Promise.resolve({ data: { rows: page, total } });
  });
}

function payloads(): Array<{ subtype: string; limit?: number; orderBy?: string; orderDir?: string; until?: number }> {
  return mockQueryLogs.mock.calls.map((call) => call[0]);
}

describe('exportLogsService', () => {
  describe('queryAllData keyset paging (PBI 2026-11-26-04)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('exports 15,000 lightweight rows across two pages in newest-first order', async () => {
      installPageStore(descRows(15_000, 10));

      const rows = await queryAllData();

      expect(rows).toHaveLength(15_000);
      expect(mockQueryLogs).toHaveBeenCalledTimes(2);
      expect(rows[0]!.id).toBe(1);
      expect(rows[14_999]!.id).toBe(15_000);
      const sortedDesc = rows.every((row, i) => i === 0 || row.created_at <= rows[i - 1]!.created_at);
      expect(sortedDesc).toBe(true);
    });

    it('passes the previous page\'s oldest created_at as the second page\'s until', async () => {
      const store = descRows(15_000, 10);
      installPageStore(store);

      await queryAllData();

      const calls = payloads();
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call.subtype).toBe('query');
        expect(call.limit).toBe(QUERY_CAPS.plain);
        expect(call.orderBy).toBe('created_at');
        expect(call.orderDir).toBe('DESC');
      }
      // The first page is unbounded; only continuation pages carry the cursor.
      expect('until' in calls[0]!).toBe(false);
      expect(calls[1]!.until).toBe(store[QUERY_CAPS.plain - 1]!.created_at);
    });

    it('emits page-boundary rows sharing one timestamp exactly once', async () => {
      // Pairs share a timestamp, so the page boundary lands on a tie: page 1
      // ends with two rows at the same created_at that page 2 re-reads
      // inclusively. Dedup by id must count each row once.
      const rows = descRows(12_000, 10).map((row, i) => ({ ...row, created_at: BASE - Math.floor(i / 2) * 10 }));
      installPageStore(rows);

      const result = await queryAllData();

      expect(result).toHaveLength(12_000);
      const counts = new Map<number, number>();
      for (const row of result) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
      expect(counts.size).toBe(12_000);
      expect([...counts.values()].every((count) => count === 1)).toBe(true);
    });

    it('advances past a full page of boundary ties without stalling', async () => {
      // One page shares a single millisecond and one older row exists: the
      // second page re-reads the same ties, so the cursor must step back 1ms
      // to reach the older row (fetchAllPeriodRows precedent).
      const ties = descRows(QUERY_CAPS.plain, 10).map((row) => ({ ...row, created_at: BASE }));
      const oldest = { id: QUERY_CAPS.plain + 1, url: 'u', created_at: BASE - 5 };
      installPageStore([...ties, oldest]);

      const result = await queryAllData();

      expect(result).toHaveLength(QUERY_CAPS.plain + 1);
      expect(mockQueryLogs).toHaveBeenCalledTimes(3);
      expect(result[result.length - 1]!.id).toBe(QUERY_CAPS.plain + 1);
    });

    it('rejects with the 100,000 ceiling and .db guidance when the history exceeds MAX_EXPORT_ROWS', async () => {
      installPageStore(descRows(QUERY_CAPS.plain, 10), 150_000);

      // The first page is full, so the frozen total fires the cap before any
      // further page is fetched.
      let caught: unknown;
      try {
        await exportJson();
        expect.unreachable('exportJson must reject above MAX_EXPORT_ROWS');
      } catch (e) {
        caught = e;
      }
      const message = (caught as Error).message;
      expect(message).toContain('This export is limited to 100000 records, but 150000 are stored');
      expect(message).toContain('Use the .db export to capture the full history.');
      expect(mockQueryLogs).toHaveBeenCalledTimes(1);
    });

    it('completes a full export at exactly MAX_EXPORT_ROWS (100,000 rows)', async () => {
      installPageStore(descRows(MAX_EXPORT_ROWS, 10));

      const blob = await exportJson();
      const parsed = JSON.parse(await blob.text()) as { rows: LightRow[] };

      expect(parsed.rows).toHaveLength(MAX_EXPORT_ROWS);
      const ids = new Set(parsed.rows.map((row) => row.id));
      expect(ids.size).toBe(MAX_EXPORT_ROWS);
      expect(parsed.rows[0]!.id).toBe(1);
      expect(parsed.rows[MAX_EXPORT_ROWS - 1]!.id).toBe(MAX_EXPORT_ROWS);
      // The first page is unbounded; each continuation page re-reads one
      // boundary row, so 100,000 rows need 10 full pages plus a short 11th.
      expect(mockQueryLogs).toHaveBeenCalledTimes(11);
    });
  });
});
