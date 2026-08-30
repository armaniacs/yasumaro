import { describe, it, expect, vi } from 'vitest';
import { handleAuditLogQuery } from '../opfsWorker/auditHandlers.js';
import type { SqliteRow } from '../sqliteEngine.js';

/**
 * The audit_log read path builds `LIMIT ?` from `payload.limit`. SQLite treats
 * `LIMIT -1` as unlimited, so a both-sided clamp must reach the bound value,
 * not just an upper cap.
 */
function makeCtx(captured: { limitParam?: unknown }) {
  return {
    engine: {
      exec: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(async (sql: string, params: unknown[]): Promise<SqliteRow[]> => {
        if (sql.includes('FROM audit_log ORDER BY')) {
          captured.limitParam = params[0];
          return [];
        }
        return [{ c: 0 } as unknown as SqliteRow];
      }),
    },
  } as never;
}

describe('handleAuditLogQuery limit clamp', () => {
  it.each([
    ['negative', -1, 100],
    ['zero', 0, 100],
    ['non-integer', 0.5, 100],
    ['huge', 1e9, 1000],
    ['normal', 50, 50],
  ])('clamps limit=%s to %s', async (_label, raw, expected) => {
    const captured: { limitParam?: unknown } = {};
    await handleAuditLogQuery(makeCtx(captured), { limit: raw as number });
    expect(captured.limitParam).toBe(expected);
  });
});
