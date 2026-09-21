import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const shared = vi.hoisted(() => {
  const mutate = vi.fn().mockResolvedValue({ success: true, data: { id: 1 } });
  const query = vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
  class MockSqliteClient {
    mutate(op: unknown) {
      return mutate(op);
    }
    query(op: unknown) {
      return query(op);
    }
  }
  const getSharedSqliteClient = vi.fn(() => new MockSqliteClient());
  return { mutate, query, getSharedSqliteClient };
});

vi.mock('../../background/sqlite/offscreenGateway.js', () => ({
  getSharedSqliteClient: shared.getSharedSqliteClient,
}));

describe('auditLog lazy gateway resolution (PBI 2026-09-21-06)', () => {
  it('has no static import of the background gateway; resolves via await import', () => {
    const src = readFileSync(new URL('../auditLog.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import\s(?!type)[^;]*offscreenGateway/m);
    expect(src).toMatch(/await import\(|import\(['"]\.\.\/background\/sqlite\/offscreenGateway\.js['"]\)/);
  });

  it('does not resolve the shared client at import time; resolves at record time', async () => {
    shared.getSharedSqliteClient.mockClear();
    shared.mutate.mockClear();
    const mod = await import('../auditLog.js');
    expect(shared.getSharedSqliteClient).not.toHaveBeenCalled();
    await mod.recordAuditLog({ provider: 'gemini', url: 'https://example.com/lazy' });
    expect(shared.getSharedSqliteClient).toHaveBeenCalledTimes(1);
    expect(shared.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'insertAuditLog' }),
    );
  });

  it('reuses the cached client promise across calls (single dynamic import)', async () => {
    const mod = await import('../auditLog.js');
    shared.getSharedSqliteClient.mockClear();
    await mod.getAuditLogs();
    await mod.recordAuditLog({ provider: 'gemini', url: 'https://example.com/cached' });
    expect(shared.getSharedSqliteClient).not.toHaveBeenCalled();
  });
});
