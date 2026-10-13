/**
 * auditLogCodec.test.ts
 * Pins both backends' audit_log decode through the shared rowCodec: the same
 * wire shape and the same Number/String coercion semantics (id/created_at →
 * Number, provider/url → String), so a column insertion can no longer
 * silently diverge the positional and named readers.
 */
import { describe, it, expect, vi } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { handleAuditLogQuery } from '../opfsWorker/auditHandlers.js';
import { AUDIT_LOG_COLUMNS } from '../rowCodec.js';
import type { SqliteValue } from '../sqliteEngine.js';
import type { AuditLogEntry } from '../../utils/sqlite-types.js';

const EXPECTED_ROW = [
  { id: 7, provider: 'gemini', url: 'https://example.com/x', created_at: 1700000000000 },
];

function positionalRow(): SqliteValue[] {
  return [7, 'gemini', 'https://example.com/x', 1700000000000];
}

function namedRow(): Record<string, SqliteValue> {
  return { id: 7, provider: 'gemini', url: 'https://example.com/x', created_at: 1700000000000 };
}

function assertCoercion(row: AuditLogEntry): void {
  expect(typeof row.id).toBe('number');
  expect(typeof row.created_at).toBe('number');
  expect(typeof row.provider).toBe('string');
  expect(typeof row.url).toBe('string');
}

describe('audit_log shared codec decode', () => {
  it('AUDIT_LOG_COLUMNS matches the buildAuditLogStatements SELECT order', () => {
    expect(AUDIT_LOG_COLUMNS).toEqual(['id', 'provider', 'url', 'created_at']);
  });

  it('IdbVfsBackend decodes positionally via the shared codec', async () => {
    const host = {
      execWithCache: vi.fn(async (sql: string, _params?: SqliteValue[], callback?: (row: SqliteValue[]) => void) => {
        if (sql.includes('FROM audit_log ORDER BY')) callback?.(positionalRow());
      }),
      idbEngine: {},
      fts5Available: false,
      cachedCompileOptions: null,
    };
    const backend = new IdbVfsBackend(host as never);
    const result = await backend.queryAuditLog({ limit: 10, offset: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows).toEqual(EXPECTED_ROW);
      assertCoercion(result.rows[0]!);
    }
  });

  it('opfs auditHandlers decodes by name via the shared codec', async () => {
    const engine = {
      exec: vi.fn(async (): Promise<void> => undefined),
      query: vi.fn(async (sql: string): Promise<Record<string, SqliteValue>[]> => {
        if (sql.includes('FROM audit_log ORDER BY')) return [namedRow()];
        return [{ c: 1 }];
      }),
      queryValue: vi.fn(async (): Promise<SqliteValue> => 1),
      close: vi.fn(async (): Promise<void> => undefined),
    };
    const result = await handleAuditLogQuery({ engine: engine as never }, { limit: 10, offset: 0 });
    expect(result.rows).toEqual(EXPECTED_ROW);
    assertCoercion(result.rows[0]!);
  });
});
